// Voxel models built from boxes, in the flat-colored style of the original. Geometry and materials are shared.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COL_MAX } from '/core/config.js';

const OUTSIDE_SHADE = 0.6; // brightness outside the play area, like the original's darkened sides
const EDGE = COL_MAX + 0.5;

/**
 * Darken whatever is drawn outside the play area (|x| > 4.5 in world space), per pixel in the shader, so the
 * border is exact for the ground and for everything standing or driving on it.
 */
function darkenOutside(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldX = (modelMatrix * vec4(transformed, 1.0)).x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldX;')
      .replace('#include <dithering_fragment>',
        `#include <dithering_fragment>\ngl_FragColor.rgb *= mix(1.0, ${OUTSIDE_SHADE.toFixed(2)}, smoothstep(${(EDGE - 0.02).toFixed(2)}, ${(EDGE + 0.02).toFixed(2)}, abs(vWorldX)));`);
  };
  material.customProgramCacheKey = () => 'darken-outside';
  return material;
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map();
export const VERTEX_COLORED = darkenOutside(new THREE.MeshLambertMaterial({ vertexColors: true }));

/**
 * Merge every mesh under `root` into one geometry with per-vertex colors taken from each mesh's material,
 * so a whole model (or a whole row of scenery) costs one draw call.
 */
export function bakeGeometry(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const c = o.material.color;
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
    parts.push(g);
  });
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

export function bakedMesh(geometry, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, VERTEX_COLORED);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function mat(color, { emissive = null, transparent = false, opacity = 1 } = {}) {
  const key = `${color}|${emissive}|${opacity}`;
  if (!materials.has(key)) {
    const m = darkenOutside(new THREE.MeshLambertMaterial({ color, transparent, opacity }));
    if (emissive) m.emissive = new THREE.Color(emissive);
    materials.set(key, m);
  }
  return materials.get(key);
}

/** A box of size (w, h, d) whose bottom-center sits at (x, y, z). */
export function box(w, h, d, color, x = 0, y = 0, z = 0, { shadow = true, material = null } = {}) {
  const m = new THREE.Mesh(UNIT, material ?? mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function group(...children) {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}

// ---- player ----

/** The chicken, facing -z (forward). Its body is in a child group so it can be squashed around its feet. */
export function chicken() {
  const W = '#ffffff';
  const body = group(
    box(0.08, 0.1, 0.08, '#f39c12', -0.11, 0, 0.02),
    box(0.08, 0.1, 0.08, '#f39c12', 0.11, 0, 0.02),
    box(0.52, 0.42, 0.56, W, 0, 0.08, 0.02),
    box(0.42, 0.36, 0.36, W, 0, 0.42, -0.08),
    box(0.06, 0.2, 0.32, '#f4f4f4', -0.29, 0.18, 0.04),
    box(0.06, 0.2, 0.32, '#f4f4f4', 0.29, 0.18, 0.04),
    box(0.26, 0.22, 0.12, W, 0, 0.3, 0.34),
    box(0.12, 0.14, 0.22, '#e5413a', 0, 0.78, -0.08),
    box(0.14, 0.1, 0.14, '#f39c12', 0, 0.56, -0.31),
    box(0.08, 0.1, 0.06, '#e5413a', 0, 0.46, -0.29),
    box(0.04, 0.06, 0.06, '#1d1d2b', -0.215, 0.62, -0.14),
    box(0.04, 0.06, 0.06, '#1d1d2b', 0.215, 0.62, -0.14),
  );
  const root = group(body);
  root.userData.body = body;
  return root;
}

export function eagle() {
  const brown = '#5b3a1e';
  const wingL = group(box(1.2, 0.08, 0.6, brown, -0.6, 0, 0));
  const wingR = group(box(1.2, 0.08, 0.6, brown, 0.6, 0, 0));
  wingL.position.set(-0.3, 0.35, 0);
  wingR.position.set(0.3, 0.35, 0);
  const g = group(
    box(0.6, 0.38, 1.0, brown, 0, 0.15, 0),
    box(0.42, 0.38, 0.4, '#f4f4f4', 0, 0.3, -0.62),
    box(0.16, 0.14, 0.2, '#f2c94c', 0, 0.36, -0.9),
    box(0.4, 0.1, 0.4, brown, 0, 0.2, 0.7),
    box(0.05, 0.06, 0.06, '#1d1d2b', -0.22, 0.5, -0.7),
    box(0.05, 0.06, 0.06, '#1d1d2b', 0.22, 0.5, -0.7),
    box(0.08, 0.25, 0.08, '#f2c94c', -0.15, -0.15, 0.1),
    box(0.08, 0.25, 0.08, '#f2c94c', 0.15, -0.15, 0.1),
    wingL, wingR,
  );
  g.userData.wings = [wingL, wingR];
  g.scale.setScalar(1.3);
  return g;
}

// ---- vehicles ----

/** A car of length `len` centered on x = 0, driving toward +x (mirror for -x). */
export function car(len, color) {
  const w = 0.74;
  return group(
    box(len, 0.34, w, color, 0, 0.12, 0),
    box(len * 0.52, 0.24, w - 0.08, '#2d3a4a', -len * 0.08, 0.46, 0),
    box(len * 0.52, 0.08, w - 0.06, color, -len * 0.08, 0.7, 0),
    box(0.06, 0.1, 0.16, '#fff6c2', len / 2, 0.28, -0.24, { shadow: false }),
    box(0.06, 0.1, 0.16, '#fff6c2', len / 2, 0.28, 0.24, { shadow: false }),
    box(0.06, 0.08, 0.14, '#ff5a4f', -len / 2, 0.3, -0.26, { shadow: false }),
    box(0.06, 0.08, 0.14, '#ff5a4f', -len / 2, 0.3, 0.26, { shadow: false }),
    ...wheels([-len * 0.3, len * 0.3], w),
  );
}

export function truck(len, color) {
  const w = 0.8;
  const cab = 0.78;
  const trailer = len - cab - 0.08;
  return group(
    box(cab, 0.62, w, '#e5413a', len / 2 - cab / 2, 0.12, 0),
    box(0.06, 0.24, w - 0.12, '#2d3a4a', len / 2, 0.44, 0),
    box(trailer, 0.86, w + 0.04, color, -len / 2 + trailer / 2, 0.16, 0),
    box(trailer, 0.04, w + 0.06, '#c8ccd2', -len / 2 + trailer / 2, 1.02, 0),
    ...wheels([len / 2 - cab / 2, -len / 2 + 0.4, -len / 2 + trailer * 0.55], w),
  );
}

function wheels(xs, w) {
  const out = [];
  for (const x of xs) for (const z of [-w / 2, w / 2]) out.push(box(0.3, 0.28, 0.12, '#24242c', x, 0, z));
  return out;
}

/** A train (locomotive + cars) spanning x = 0..len, with the locomotive at the +x end (mirror for -x). */
export function train(cars, len) {
  const g = new THREE.Group();
  const loco = 3.2;
  g.add(box(loco - 0.1, 1.05, 0.86, '#d93a3a', len - loco / 2, 0.14, 0));
  g.add(box(0.9, 0.32, 0.9, '#2d3a4a', len - loco + 0.7, 0.86, 0));
  g.add(box(0.08, 0.5, 0.7, '#f2c94c', len - 0.04, 0.3, 0));
  g.add(box(loco - 0.1, 0.12, 0.9, '#3a3a46', len - loco / 2, 1.19, 0));
  for (let i = 0; i < cars; i++) {
    const x = len - loco - 3 * i - 1.5;
    const color = i % 2 ? '#3b6fd8' : '#4a83e8';
    g.add(box(2.85, 0.95, 0.84, color, x, 0.14, 0));
    g.add(box(2.3, 0.22, 0.86, '#cfe3f7', x, 0.62, 0, { shadow: false }));
    g.add(box(2.85, 0.08, 0.88, '#2e4f99', x, 1.09, 0));
  }
  for (let x = 0.6; x < len; x += 1.5) g.add(box(0.3, 0.22, 0.9, '#24242c', x, 0, 0));
  return g;
}

// ---- river ----

export function log(len) {
  return group(
    box(len - 0.08, 0.3, 0.78, '#8b5a2b', 0, -0.18, 0),
    box(len - 0.3, 0.06, 0.6, '#a06a35', 0, 0.12, 0),
    box(0.06, 0.26, 0.7, '#d9a86c', -len / 2 + 0.04, -0.16, 0, { shadow: false }),
    box(0.06, 0.26, 0.7, '#d9a86c', len / 2 - 0.04, -0.16, 0, { shadow: false }),
  );
}

const PAD = new THREE.CylinderGeometry(0.4, 0.4, 0.06, 10);
export function lilyPad() {
  const m = new THREE.Mesh(PAD, mat('#3f9e42'));
  m.position.y = -0.2;
  m.receiveShadow = true;
  const g = group(m, box(0.12, 0.08, 0.12, '#f7a8c8', 0.12, -0.17, -0.1, { shadow: false }));
  return g;
}

// ---- grass decor ----

export function tree(h) {
  const leaves = 0.42 * h + 0.25;
  return group(
    box(0.32, 0.36, 0.32, '#8b5a2b', 0, 0, 0),
    box(0.78, leaves, 0.78, h % 2 ? '#3fa34d' : '#4bb257', 0, 0.36, 0),
    box(0.78, 0.06, 0.78, '#5cc46a', 0, 0.36 + leaves, 0, { shadow: false }),
  );
}

export function rock() {
  return group(box(0.78, 0.46, 0.7, '#9aa0a6', 0, 0, 0), box(0.5, 0.12, 0.44, '#b6bcc2', 0.06, 0.46, -0.04));
}

const COIN = new THREE.CylinderGeometry(0.22, 0.22, 0.07, 14);
export function coin() {
  const m = new THREE.Mesh(COIN, mat('#ffd23f', { emissive: '#4a3a00' }));
  m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  const g = group(m);
  g.position.y = 0.45;
  return g;
}

// ---- railway signal ----

export function railSignal() {
  const lamp = (x) => box(0.18, 0.18, 0.1, '#5a1e1e', x, 1.22, -0.12, { shadow: false });
  const left = lamp(-0.13);
  const right = lamp(0.13);
  const g = group(
    box(0.12, 1.5, 0.12, '#9ba3ad', 0, 0, 0),
    box(0.5, 0.26, 0.1, '#2b2b33', 0, 1.18, -0.06),
    left, right,
    box(0.5, 0.08, 0.5, '#6d747d', 0, 0, 0),
  );
  g.userData.lamps = [left, right];
  return g;
}

export const LAMP_OFF = mat('#5a1e1e');
export const LAMP_ON = mat('#ff3b3b', { emissive: '#ff2020' });

export function splashParticle() {
  return box(0.14, 0.14, 0.14, '#e8f8ff', 0, 0, 0, { shadow: false });
}
