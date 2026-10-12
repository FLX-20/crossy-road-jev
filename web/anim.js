// Player animation: hop arc, squash and stretch, turning, and one death animation per cause.
// Visual only; nothing here feeds back into the simulation.

import * as THREE from 'three';
import { HOP_TICKS } from '/core/config.js';
import { chicken, eagle, splashParticle, bakeGeometry, bakedMesh } from './models.js';

const ANGLE = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };
const HOP_HEIGHT = 0.42;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - t) * (1 - t);

/** Height of the surface the chicken stands on. */
export function laneBaseY(lane, onLog) {
  if (lane.type === 'river') return onLog ? 0.1 : -0.17;
  if (lane.type === 'road') return -0.04;
  return 0;
}

export class PlayerAnimator {
  constructor(scene) {
    this.root = new THREE.Group();
    this.body = bakedMesh(bakeGeometry(chicken()));
    this.root.add(this.body);
    scene.add(this.root);
    this.eagle = eagle();
    this.eagle.visible = false;
    scene.add(this.eagle);
    this.scene = scene;
    this.particles = [];
    this.charging = false;
    this.reset();
  }

  reset() {
    this.angle = 0;
    this.base = 0;
    this.hopFromBase = 0;
    this.landAt = -1e9;
    this.death = null;
    this.x = 0;
    this.z = 0;
    this.root.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    this.eagle.visible = false;
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
  }

  onEvent(e, now) {
    if (e.type === 'hop') this.hopFromBase = this.base;
    if (e.type === 'land') this.landAt = now;
  }

  update(game, alpha, dt, now) {
    if (!game.alive) {
      this.updateDeath(game, dt, now);
      return;
    }
    const p = game.player;
    const x = lerp(game.prev.x, p.x, alpha);
    const row = lerp(game.prev.visRow, p.visRow, alpha);
    let y;
    let sy = 1;
    let sxz = 1;
    const lane = game.lane(p.row);
    if (p.hop) {
      const f = Math.min(1, (p.hop.t + alpha) / HOP_TICKS);
      const toBase = lane.type === 'river' ? (lane.pads.length ? -0.17 : 0.1) : laneBaseY(lane, false);
      this.base = lerp(this.hopFromBase, toBase, f);
      y = this.base + 4 * HOP_HEIGHT * f * (1 - f);
      sy = 1 + 0.6 * f * (1 - f);
    } else {
      const target = laneBaseY(lane, !!p.ride);
      this.base += (target - this.base) * Math.min(1, dt * 30);
      y = this.base;
      const k = 1 - (now - this.landAt) / 90;
      if (this.charging) {
        sy = 0.72;
        sxz = 1.14;
      } else if (k > 0) {
        sy = 1 - 0.18 * k;
        sxz = 1 + 0.1 * k;
      }
    }
    let diff = ANGLE[p.facing] - this.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.angle += diff * Math.min(1, dt * 25);
    this.root.position.set(x, y, -row);
    this.root.rotation.set(0, this.angle, 0);
    this.body.scale.set(sxz, sy, sxz);
    this.x = x;
    this.z = -row;
  }

  updateDeath(game, dt, now) {
    if (!this.death) this.startDeath(game, now);
    const d = this.death;
    const t = (now - d.t0) / 1000;
    const r = this.root;
    switch (d.cause) {
      case 'car':
      case 'truck': {
        const k = Math.min(1, t / 0.06);
        this.body.scale.set(lerp(1, 1.5, k), lerp(1, 0.12, k), lerp(1, 1.5, k));
        r.position.set(d.x, -0.03, d.z);
        break;
      }
      case 'train':
        r.position.set(d.x + d.dir * 24 * t, d.y + 3 * t, d.z);
        r.rotation.z += dt * 14 * d.dir;
        r.visible = t < 1.2;
        break;
      case 'water':
      case 'carried':
        r.position.set(d.x, -0.15 - 1.8 * t, d.z);
        r.visible = t < 0.4;
        break;
      case 'eagle': {
        const e = this.eagle;
        e.visible = true;
        const flap = Math.sin(t * 22) * 0.6;
        e.userData.wings[0].rotation.z = flap;
        e.userData.wings[1].rotation.z = -flap;
        if (t < 0.5) {
          const s = ease(t / 0.5);
          e.position.set(d.x, lerp(9, 0.9, s), lerp(d.z - 9, d.z, s));
          e.rotation.set(0.3, Math.PI, 0);
          r.position.set(d.x, d.y, d.z);
        } else {
          const s = (t - 0.5) / 1.2;
          e.position.set(d.x, 0.9 + 10 * s, d.z - 12 * s);
          e.rotation.set(-0.35, 0, 0);
          r.position.set(d.x, e.position.y - 0.75, e.position.z);
          e.visible = s < 1;
          r.visible = s < 1;
        }
        break;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.v.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      if (p.mesh.position.y < -0.6) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  startDeath(game, now) {
    const dd = game.death;
    const lane = game.lane(dd.row);
    this.death = { cause: dd.cause, t0: now, x: dd.x, z: -dd.visRow, y: this.root.position.y, dir: lane.dir || 1 };
    if (dd.cause === 'water' || dd.cause === 'carried') {
      for (let i = 0; i < 14; i++) {
        const mesh = splashParticle();
        mesh.position.set(dd.x, -0.15, -dd.visRow);
        const a = (i / 14) * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random()), 3 + Math.random() * 2.5, Math.sin(a) * (1 + Math.random()));
        this.scene.add(mesh);
        this.particles.push({ mesh, v });
      }
    }
  }
}
