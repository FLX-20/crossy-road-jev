// Three.js view of a Game: an orthographic camera at the original's angle, baked voxel rows built and dropped
// as the camera moves, moving objects positioned from the simulation's pure functions of time.

import * as THREE from 'three';
import { COL_MAX, TICK_RATE } from '/core/config.js';
import { laneObjects, trainState } from '/core/lanes.js';
import { hash32 } from '/core/rng.js';
import * as M from './models.js';
import { PlayerAnimator } from './anim.js';

const GROUND_HALF = 26;
const DECOR_HALF = 18; // purely visual trees beyond the simulated ±11 columns
const CAM_OFFSET = new THREE.Vector3(2.6, 10, 7.4);
const SUN_OFFSET = new THREE.Vector3(-5, 14, 4);
const LOOK_AHEAD = 1.6; // rows between the camera row and the screen center (more on tall screens)
const COLORS = {
  grass: ['#bdec6a', '#b3e260'],
  road: '#555a69',
  line: '#e9e9e9',
  water: '#5ccbf7',
  gravel: '#8c8178',
  tie: '#6b4a2f',
  steel: '#c9d1d9',
};

export class Renderer {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a2f3d');
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -40, 120);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a9ab0', 1.7));
    this.sun = new THREE.DirectionalLight('#fff8ea', 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 0.5, far: 60 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.player = new PlayerAnimator(this.scene);
    this.rows = new Map();
    this.moverGeometry = new Map();
    this.target = new THREE.Vector3();
    this.camX = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setGame(game) {
    for (const entry of this.rows.values()) this.dropRow(entry);
    this.rows.clear();
    this.game = game;
    this.player.reset();
    this.camX = 0;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    const aspect = w / h;
    let halfH = 6.3;
    let halfW = halfH * aspect;
    if (halfW < 6.4) {
      halfW = 6.4;
      halfH = halfW / aspect;
    }
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
    // How many rows the view spans: the ground is seen at an angle, and the yaw tilts the screen corners.
    const flat = Math.hypot(CAM_OFFSET.x, CAM_OFFSET.z);
    const depth = halfH / Math.sin(Math.atan2(CAM_OFFSET.y, flat)) + (halfW * CAM_OFFSET.x) / flat;
    this.lookAhead = LOOK_AHEAD + Math.max(0, (halfH - 6.3) * 0.45);
    this.rowsBelow = Math.ceil(depth - this.lookAhead) + 2;
    this.rowsAbove = Math.ceil(depth + this.lookAhead) + 3;
    const reach = Math.max(18, depth + 4);
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Draw the game at tick + alpha (alpha in [0,1) interpolates between simulation steps). */
  render(alpha, dt, now) {
    const g = this.game;
    if (!g) return;
    const tickF = g.tick + alpha;
    this.player.update(g, alpha, dt, now);

    const camRow = g.camRow;
    const followX = Math.max(-2.2, Math.min(2.2, this.player.x * 0.6));
    this.camX += (followX - this.camX) * (1 - Math.exp(-4 * dt));
    this.target.set(this.camX, 0, -(camRow + this.lookAhead));
    this.camera.position.copy(this.target).add(CAM_OFFSET);
    this.camera.lookAt(this.target);
    this.sun.position.copy(this.target).add(SUN_OFFSET);
    this.sun.target.position.copy(this.target);

    const lo = Math.floor(camRow) - this.rowsBelow;
    const hi = Math.ceil(camRow) + this.rowsAbove;
    for (const [row, entry] of this.rows) {
      if (row < lo || row > hi) {
        this.dropRow(entry);
        this.rows.delete(row);
      }
    }
    for (let row = lo; row <= hi; row++) {
      let entry = this.rows.get(row);
      if (!entry) {
        entry = this.buildRow(row);
        this.rows.set(row, entry);
      }
      this.updateRow(entry, tickF, now);
    }
    this.gl.render(this.scene, this.camera);
  }

  // ---- rows ----

  buildRow(row) {
    const g = this.game;
    const lane = g.lane(row);
    const group = new THREE.Group();
    group.position.z = -row;
    const statics = new THREE.Group();
    const entry = { row, lane, group, movers: [], coins: new Map(), lamps: null, train: null, staticMesh: null };

    if (lane.type === 'grass') {
      statics.add(M.box(GROUND_HALF * 2, 0.5, 1, COLORS.grass[lane.shade], 0, -0.5, 0));
      for (const b of lane.blockers) {
        const m = b.kind === 'rock' ? M.rock() : M.tree(b.h);
        m.position.x = b.col;
        statics.add(m);
      }
      for (let col = -DECOR_HALF; col <= DECOR_HALF; col++) {
        if (Math.abs(col) <= 11 || hash32(row, col, 7) % 100 > 55) continue;
        const m = M.tree(1 + (hash32(row, col) % 3));
        m.position.x = col;
        statics.add(m);
      }
    } else if (lane.type === 'road') {
      statics.add(M.box(GROUND_HALF * 2, 0.5, 1, COLORS.road, 0, -0.54, 0));
      if (g.lane(row + 1).type === 'road') {
        for (let x = -GROUND_HALF + 0.5; x < GROUND_HALF; x += 1.6) statics.add(M.box(0.7, 0.02, 0.08, COLORS.line, x, -0.045, -0.5, { shadow: false }));
      }
      lane.objs.forEach((obj) => entry.movers.push(this.mover(obj, lane)));
    } else if (lane.type === 'river') {
      statics.add(M.box(GROUND_HALF * 2, 0.5, 1, COLORS.water, 0, -0.72, 0));
      for (const col of lane.pads) {
        const m = M.lilyPad();
        m.position.x = col;
        statics.add(m);
      }
      lane.objs.forEach((obj) => entry.movers.push(this.mover(obj, lane)));
    } else {
      statics.add(M.box(GROUND_HALF * 2, 0.5, 1, COLORS.gravel, 0, -0.52, 0));
      for (let x = -GROUND_HALF + 0.4; x < GROUND_HALF; x += 0.8) statics.add(M.box(0.24, 0.06, 0.92, COLORS.tie, x, -0.02, 0));
      for (const z of [-0.27, 0.27]) statics.add(M.box(GROUND_HALF * 2, 0.08, 0.08, COLORS.steel, 0, 0.02, z));
      const signal = M.railSignal();
      signal.position.set(COL_MAX + 0.95, 0, 0.42);
      signal.rotation.y = Math.PI;
      group.add(signal);
      entry.lamps = signal.userData.lamps;
      const inner = new THREE.Group();
      inner.add(M.bakedMesh(M.bakeGeometry(M.train(lane.cars, lane.trainLen))));
      inner.position.x = -lane.trainLen / 2;
      const train = new THREE.Group();
      train.add(inner);
      train.rotation.y = lane.dir > 0 ? 0 : Math.PI;
      train.visible = false;
      entry.train = train;
      group.add(train);
    }
    for (const col of lane.coins) {
      const c = M.coin();
      c.position.x = col;
      entry.coins.set(col, c);
      group.add(c);
    }
    entry.staticMesh = M.bakedMesh(M.bakeGeometry(statics));
    group.add(entry.staticMesh);
    for (const m of entry.movers) group.add(m);
    this.scene.add(group);
    return entry;
  }

  mover(obj, lane) {
    const key = `${obj.kind}|${obj.len}|${obj.color ?? ''}`;
    let geometry = this.moverGeometry.get(key);
    if (!geometry) {
      const model = obj.kind === 'log' ? M.log(obj.len) : obj.kind === 'truck' ? M.truck(obj.len, obj.color) : M.car(obj.len, obj.color);
      geometry = M.bakeGeometry(model);
      this.moverGeometry.set(key, geometry);
    }
    const mesh = M.bakedMesh(geometry);
    if (lane.dir < 0) mesh.rotation.y = Math.PI;
    return mesh;
  }

  dropRow(entry) {
    this.scene.remove(entry.group);
    entry.staticMesh.geometry.dispose();
  }

  updateRow(entry, tickF, now) {
    const lane = entry.lane;
    if (entry.movers.length) {
      for (const o of laneObjects(lane, tickF)) {
        const m = entry.movers[o.i];
        m.position.x = o.x0 + o.len / 2;
        m.visible = Math.abs(m.position.x) < GROUND_HALF - 2;
      }
    }
    if (entry.train) {
      const ts = trainState(lane, tickF / TICK_RATE);
      entry.train.visible = ts.passing;
      if (ts.passing) entry.train.position.x = ts.x0 + lane.trainLen / 2;
      const blink = ts.flashing && Math.floor(tickF / 12) % 2 === 0;
      entry.lamps[0].material = ts.flashing && blink ? M.LAMP_ON : M.LAMP_OFF;
      entry.lamps[1].material = ts.flashing && !blink ? M.LAMP_ON : M.LAMP_OFF;
      entry.flashing = ts.flashing && !ts.passing;
    }
    for (const [col, c] of entry.coins) {
      c.visible = !this.game.collected.has(`${entry.row}:${col}`);
      c.rotation.y = now / 300;
    }
  }

  /** Rail lanes near the player whose signal is flashing (for the bell sound). */
  flashingNear(row, range = 4) {
    for (const [r, e] of this.rows) if (e.flashing && Math.abs(r - row) <= range) return true;
    return false;
  }
}
