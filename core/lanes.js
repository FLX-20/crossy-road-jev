// Procedural lanes. Rows are generated strictly in order from one seeded stream, so the world depends only
// on the seed, never on how the player moves. Moving objects are pure functions of time (no stored state).

import {
  COL_MIN, COL_MAX, VIEW_HALF, LANE_PERIOD, DIFFICULTY_ROWS, START_WALL_ROW,
  ROAD, RIVER, RAIL, GRASS, COIN_CHANCE_ROAD, TICK_RATE,
} from './config.js';
import { mulberry32, hash32 } from './rng.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrap = (a, p) => a - Math.floor(a / p) * p;

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(hash32(this.seed, 0x51ed));
    this.lanes = new Map();
    this.next = 1;
    this.pathCol = 0;
    this.chunk = null;
    this.lastChunkType = 'grass';
    this.lastRiverDir = 1;
    for (let row = 0; row >= -12; row--) this.lanes.set(row, this.startLane(row));
  }

  /** The lane at `row`, generating rows up to it on demand. */
  lane(row) {
    while (row >= this.next) this.generate();
    return this.lanes.get(row) ?? this.wallLane(row);
  }

  // ---- generation ----

  startLane(row) {
    const blockers = [];
    const wall = row <= START_WALL_ROW;
    for (let col = -VIEW_HALF; col <= VIEW_HALF; col++) {
      const inside = col >= COL_MIN && col <= COL_MAX;
      const roll = this.rng.next();
      if (wall || !inside) {
        if (!inside && roll > 0.65 && !wall) continue;
        blockers.push(this.blocker(col));
      } else if (row < 0 && Math.abs(col) >= 2 && roll < 0.25) {
        blockers.push(this.blocker(col));
      }
    }
    return grassLane(row, 0, blockers, []);
  }

  wallLane(row) {
    const blockers = [];
    for (let col = -VIEW_HALF; col <= VIEW_HALF; col++) blockers.push({ col, kind: 'tree', h: 2 + (hash32(row, col) % 2) });
    return grassLane(row, 0, blockers, []);
  }

  blocker(col) {
    const r = this.rng.next();
    if (r < 0.18) return { col, kind: 'rock', h: 1 };
    return { col, kind: 'tree', h: 1 + this.rng.int(1, 3) };
  }

  generate() {
    const row = this.next++;
    const d = Math.min(1, row / DIFFICULTY_ROWS);
    if (!this.chunk || this.chunk.left === 0) this.chunk = this.newChunk(row, d);
    this.chunk.left--;
    const lane = this[`make_${this.chunk.type}`](row, d);
    lane.difficulty = d;
    this.lanes.set(row, lane);
    if (this.lanes.size > 400) {
      // Keep memory bounded on very long runs; old rows are never visited again (the eagle comes first).
      for (const key of this.lanes.keys()) { if (key < row - 300) this.lanes.delete(key); else break; }
    }
  }

  newChunk(row, d) {
    const rng = this.rng;
    let type;
    if (row <= 2) type = 'grass';
    else if (this.lastChunkType !== 'grass' && rng.chance(0.72)) type = 'grass';
    else {
      const weights = [['road', 0.5], ['river', lerp(0.26, 0.32, d)], ['rail', row < 8 ? 0.06 : lerp(0.16, 0.22, d)]]
        .filter(([t]) => t !== this.lastChunkType);
      const total = weights.reduce((s, [, w]) => s + w, 0);
      let roll = rng.next() * total;
      type = weights[weights.length - 1][0];
      for (const [t, w] of weights) { if ((roll -= w) < 0) { type = t; break; } }
    }
    const size = {
      grass: () => (row <= 2 ? 3 - row : rng.int(1, d < 0.5 ? 3 : 2)),
      road: () => rng.int(1, Math.round(lerp(3, 5, d))),
      river: () => rng.int(1, Math.round(lerp(2, 4, d))),
      rail: () => rng.int(1, 2),
    }[type]();
    this.lastChunkType = type;
    if (type === 'river') this.lastRiverDir = rng.chance(0.5) ? 1 : -1;
    return { type, left: size };
  }

  make_grass(row, d) {
    const rng = this.rng;
    // A random-walk path column stays open on every grass row (and its next position too, so the walk is
    // walkable between two adjacent grass rows). This guarantees the world is always passable.
    const nextPath = clamp(this.pathCol + rng.int(-1, 1), COL_MIN + 1, COL_MAX - 1);
    const keep = new Set([this.pathCol, nextPath]);
    this.pathCol = nextPath;
    const p = lerp(GRASS.treeChance[0], GRASS.treeChance[1], d);
    let blockers = [];
    for (let col = -VIEW_HALF; col <= VIEW_HALF; col++) {
      const inside = col >= COL_MIN && col <= COL_MAX;
      const roll = rng.next();
      if (!inside) { if (roll < 0.6) blockers.push(this.blocker(col)); }
      else if (!keep.has(col) && roll < p) blockers.push(this.blocker(col));
    }
    let insideBlocked = blockers.filter((b) => b.col >= COL_MIN && b.col <= COL_MAX);
    while (COL_MAX - COL_MIN + 1 - insideBlocked.length < GRASS.minOpen) {
      const drop = insideBlocked[rng.int(0, insideBlocked.length - 1)];
      blockers = blockers.filter((b) => b !== drop);
      insideBlocked = insideBlocked.filter((b) => b !== drop);
    }
    const coins = [];
    if (rng.chance(GRASS.coinChance)) {
      const blocked = new Set(blockers.map((b) => b.col));
      const open = [];
      for (let c = COL_MIN; c <= COL_MAX; c++) if (!blocked.has(c)) open.push(c);
      coins.push(rng.pick(open));
    }
    return grassLane(row, row & 1, blockers, coins);
  }

  make_road(row, d) {
    const rng = this.rng;
    const dir = rng.chance(0.5) ? 1 : -1;
    const truck = rng.chance(ROAD.truckChance);
    const speed = lerp(ROAD.carSpeed[0], ROAD.carSpeed[1], d) * rng.range(0.75, 1.25) * (truck ? ROAD.truckFactor : 1);
    const extra = lerp(ROAD.extraGap[0], ROAD.extraGap[1], d);
    const color = rng.pick(truck ? ROAD.truckColors : ROAD.colors);
    const objs = [];
    let pos = rng.range(0, 3);
    for (;;) {
      const len = truck ? rng.pick(ROAD.truckLens) : ROAD.carLen;
      if (pos + len + ROAD.minGap > LANE_PERIOD) break;
      objs.push({ off: pos, len, kind: truck ? 'truck' : 'car', color: truck ? color : rng.pick(ROAD.colors) });
      pos += len + ROAD.minGap + rng.range(0, extra);
    }
    const coins = rng.chance(COIN_CHANCE_ROAD) ? [rng.int(COL_MIN, COL_MAX)] : [];
    return { row, type: 'road', dir, speed, objs, coins };
  }

  make_river(row, d) {
    const rng = this.rng;
    if (rng.chance(RIVER.padChance)) {
      const pads = new Set([this.pathCol]);
      const extra = rng.int(1, 3);
      for (let i = 0; i < extra; i++) pads.add(rng.int(COL_MIN, COL_MAX));
      return { row, type: 'river', dir: 0, speed: 0, objs: [], pads: [...pads].sort((a, b) => a - b), coins: [] };
    }
    const dir = (this.lastRiverDir = -this.lastRiverDir);
    const speed = lerp(RIVER.logSpeed[0], RIVER.logSpeed[1], d) * rng.range(0.85, 1.15);
    const maxLen = Math.round(lerp(RIVER.logLens[1], RIVER.logLens[0] + 1, d));
    const extra = lerp(RIVER.extraGap[0], RIVER.extraGap[1], d);
    const objs = [];
    let pos = rng.range(0, 2);
    for (;;) {
      const len = rng.int(RIVER.logLens[0], maxLen);
      if (pos + len + RIVER.minGap > LANE_PERIOD) break;
      objs.push({ off: pos, len, kind: 'log' });
      pos += len + RIVER.minGap + rng.range(0, extra);
    }
    return { row, type: 'river', dir, speed, objs, pads: [], coins: [] };
  }

  make_rail(row, d) {
    const rng = this.rng;
    const dir = rng.chance(0.5) ? 1 : -1;
    const period = lerp(RAIL.period[0], RAIL.period[1], d) + rng.range(-1, 1);
    const cars = rng.int(RAIL.cars[0], RAIL.cars[1]);
    return {
      row, type: 'rail', dir, speed: RAIL.speed, period,
      phase: rng.range(0, period), cars, trainLen: RAIL.locoLen + cars * RAIL.carLen, coins: [],
    };
  }
}

function grassLane(row, shade, blockers, coins) {
  return { row, type: 'grass', shade, blockers, blocked: new Set(blockers.map((b) => b.col)), coins };
}

// ---- moving objects as pure functions of time ----

/** Left edge of a periodic object at time t (seconds). */
function objX0(lane, obj, t) {
  return -LANE_PERIOD / 2 + wrap(obj.off + lane.dir * lane.speed * t, LANE_PERIOD);
}

/** Train state on a rail lane at time t. */
export function trainState(lane, t) {
  const local = wrap(t - lane.phase, lane.period);
  const passTime = (2 * RAIL.edge + lane.trainLen) / lane.speed;
  const passing = local < passTime;
  const front = -lane.dir * RAIL.edge + lane.dir * lane.speed * local;
  const untilNext = lane.period - local; // seconds until the next train's front enters the view
  return {
    passing,
    flashing: passing || untilNext <= RAIL.warnSeconds,
    x0: lane.dir > 0 ? front - lane.trainLen : front,
    x1: lane.dir > 0 ? front : front + lane.trainLen,
    untilNext,
    local,
    passTime,
  };
}

/** All solid or rideable objects in a lane at time `tick` (may be fractional), as [x0, x1] spans. */
export function laneObjects(lane, tick) {
  const t = tick / TICK_RATE;
  if (lane.type === 'road' || lane.type === 'river') {
    return lane.objs.map((obj, i) => {
      const x0 = objX0(lane, obj, t);
      return { i, kind: obj.kind, x0, x1: x0 + obj.len, len: obj.len, color: obj.color };
    });
  }
  if (lane.type === 'rail') {
    const s = trainState(lane, t);
    return s.passing ? [{ i: 0, kind: 'train', x0: s.x0, x1: s.x1, len: lane.trainLen }] : [];
  }
  return [];
}

/**
 * Seconds until a periodic lane object first overlaps the span [a, b], and seconds until it has fully passed.
 * Returns {hit, clear} per object; hit = 0 means overlapping now.
 */
export function approachTimes(lane, obj, tick, a, b) {
  const t = tick / TICK_RATE;
  const x0 = objX0(lane, obj, t);
  const x1 = x0 + obj.len;
  if (lane.speed === 0) return { hit: x1 > a && x0 < b ? 0 : Infinity, clear: Infinity };
  const v = lane.speed;
  if (x1 > a && x0 < b) {
    const clear = lane.dir > 0 ? (b - x0) / v : (x1 - a) / v;
    return { hit: 0, clear };
  }
  // Distance along the direction of travel until the leading edge reaches the span (wrapping around).
  const dist = lane.dir > 0 ? wrap(a - x1, LANE_PERIOD) : wrap(x0 - b, LANE_PERIOD);
  return { hit: dist / v, clear: (dist + obj.len + (b - a)) / v };
}
