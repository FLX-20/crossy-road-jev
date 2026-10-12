// The deterministic Crossy Road simulation. No DOM, no wall clock: call step() 60 times per simulated second.
// Inputs are applied with queueMove() between steps; (seed, [{tick, move}]) always replays to the same game.

import {
  TICK_RATE, COL_MIN, COL_MAX, CARRY_LIMIT, HOP_TICKS, PLAYER_HALF, LAND_TOLERANCE,
  CAM_BASE_SPEED, CAM_CATCHUP, EAGLE_ROWS, LANE_PERIOD,
} from './config.js';
import { World, laneObjects, wrap } from './lanes.js';
import { hash32 } from './rng.js';

export const roundCol = (x) => Math.floor(x + 0.5);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DELTA = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] };

export class Game {
  constructor({ seed = 1 } = {}) {
    this.seed = seed >>> 0;
    this.world = new World(this.seed);
    this.tick = 0;
    this.player = { row: 0, x: 0, visRow: 0, facing: 'up', hop: null, queued: null, ride: null };
    this.prev = { x: 0, visRow: 0 };
    this.alive = true;
    this.death = null;
    this.score = 0;
    this.coins = 0;
    this.collected = new Set();
    this.started = false;
    this.camRow = 0;
    this.hops = 0;
    this.events = [];
  }

  lane(row) {
    return this.world.lane(row);
  }

  objects(row, tick = this.tick) {
    return laneObjects(this.lane(row), tick);
  }

  /** Left edge of object i of a moving lane at `tick`. */
  objX0(lane, i, tick = this.tick) {
    const obj = lane.objs[i];
    return -LANE_PERIOD / 2 + wrap(obj.off + lane.dir * lane.speed * (tick / TICK_RATE), LANE_PERIOD);
  }

  /**
   * Where a hop in `dir` would go from state `p` ({row, x, ride}; the player by default), without performing it.
   * {ok:false, reason:'tree'|'edge'} or {ok:true, toRow, toX, ride}.
   */
  planHop(dir, p = this.player) {
    const [dRow, dX] = DELTA[dir];
    const toRow = p.row + dRow;
    const target = this.lane(toRow);
    let toX;
    let ride = null;
    if (dRow === 0) {
      toX = p.x + dX;
      if (p.ride) {
        if (Math.abs(toX) > CARRY_LIMIT - 0.2) return { ok: false, reason: 'edge', toRow, toX };
        ride = { i: p.ride.i, fromOff: p.ride.off, toOff: p.ride.off + dX };
      } else if (toX < COL_MIN || toX > COL_MAX) {
        return { ok: false, reason: 'edge', toRow, toX };
      }
    } else {
      toX = target.type === 'river' ? p.x : clamp(roundCol(p.x), COL_MIN, COL_MAX);
    }
    if (target.type === 'grass' && target.blocked.has(roundCol(toX))) return { ok: false, reason: 'tree', toRow, toX };
    return { ok: true, toRow, toX, ride };
  }

  /** Apply a player input now. Returns 'moved' | 'queued' | 'blocked' | 'ignored' | 'wait' | 'dead'. */
  queueMove(dir) {
    if (!this.alive) return 'dead';
    if (dir === 'wait') return 'wait';
    if (!DELTA[dir]) return 'ignored';
    if (this.player.hop) {
      if (this.player.queued) return 'ignored';
      this.player.queued = dir;
      return 'queued';
    }
    return this.startHop(dir);
  }

  startHop(dir) {
    const p = this.player;
    p.facing = dir;
    const plan = this.planHop(dir);
    if (!plan.ok) {
      this.events.push({ type: 'blocked', dir, reason: plan.reason });
      return 'blocked';
    }
    p.hop = { fromRow: p.row, toRow: plan.toRow, fromX: p.x, toX: plan.toX, t: 0, ride: plan.ride, dir };
    p.ride = null;
    p.row = plan.toRow;
    this.started = true;
    this.hops++;
    if (p.row > this.score) this.score = p.row;
    this.events.push({ type: 'hop', dir });
    return 'moved';
  }

  step() {
    this.tick++;
    const p = this.player;
    this.prev.x = p.x;
    this.prev.visRow = p.visRow;
    if (!this.alive) return;

    if (p.hop) {
      const h = p.hop;
      h.t++;
      const f = h.t / HOP_TICKS;
      if (h.ride) {
        const x0 = this.objX0(this.lane(h.fromRow), h.ride.i);
        p.x = x0 + h.ride.fromOff + (h.ride.toOff - h.ride.fromOff) * f;
      } else {
        p.x = h.fromX + (h.toX - h.fromX) * f;
      }
      p.visRow = h.fromRow + (h.toRow - h.fromRow) * f;
      if (h.t >= HOP_TICKS) {
        p.hop = null;
        p.visRow = p.row;
        this.land();
      }
    } else if (p.ride) {
      p.x = this.objX0(this.lane(p.row), p.ride.i) + p.ride.off;
    }

    if (this.alive) this.checkHazards();
    if (this.alive && p.ride && Math.abs(p.x) > CARRY_LIMIT) this.kill('carried');
    if (this.alive && this.started) {
      const ahead = p.row - this.camRow;
      this.camRow += Math.max(CAM_BASE_SPEED, ahead * CAM_CATCHUP) / TICK_RATE;
      if (this.camRow - p.row > EAGLE_ROWS) this.kill('eagle');
    }
    if (this.alive && !p.hop && p.queued) {
      const q = p.queued;
      p.queued = null;
      this.startHop(q);
    }
  }

  land() {
    const p = this.player;
    const lane = this.lane(p.row);
    if (lane.type === 'river') {
      const spot = this.riverLanding(lane, p.x, this.tick);
      if (!spot) {
        this.kill('water');
        return;
      }
      p.x = spot.x;
      p.ride = spot.ride;
    } else {
      p.ride = null;
      p.x = roundCol(p.x);
    }
    this.events.push({ type: 'land', row: p.row });
    const col = roundCol(p.x);
    const key = `${p.row}:${col}`;
    if (lane.coins.includes(col) && !this.collected.has(key)) {
      this.collected.add(key);
      this.coins++;
      this.events.push({ type: 'coin', row: p.row, col });
    }
  }

  /** Where a landing at x in a river lane at `tick` ends up: {x, ride} or null for open water. */
  riverLanding(lane, x, tick) {
    if (lane.pads.length) {
      const c = roundCol(x);
      return lane.pads.includes(c) ? { x: c, ride: null } : null;
    }
    for (let i = 0; i < lane.objs.length; i++) {
      const x0 = this.objX0(lane, i, tick);
      const len = lane.objs[i].len;
      if (x >= x0 - LAND_TOLERANCE && x <= x0 + len + LAND_TOLERANCE) {
        const off = clamp(Math.floor(x - x0) + 0.5, 0.5, len - 0.5);
        return { x: x0 + off, ride: { i, off } };
      }
    }
    return null;
  }

  checkHazards() {
    const p = this.player;
    const lane = this.lane(p.row);
    if (lane.type !== 'road' && lane.type !== 'rail') return;
    for (const o of laneObjects(lane, this.tick)) {
      if (o.x1 > p.x - PLAYER_HALF && o.x0 < p.x + PLAYER_HALF) {
        this.kill(o.kind);
        return;
      }
    }
  }

  kill(cause) {
    const p = this.player;
    this.alive = false;
    this.death = { cause, tick: this.tick, row: p.row, x: p.x, visRow: p.visRow };
    p.queued = null;
    p.hop = null;
    this.events.push({ type: 'death', cause });
  }

  /** An independent copy for "what if" simulation (the world is shared; it depends only on the seed). */
  clone() {
    const g = Object.assign(Object.create(Game.prototype), this);
    g.player = structuredClone(this.player);
    g.prev = { ...this.prev };
    g.death = this.death && { ...this.death };
    g.collected = new Set(this.collected);
    g.events = [];
    return g;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  checksum() {
    const p = this.player;
    return hash32(this.tick, p.row, Math.round(p.x * 1000), this.alive ? 1 : 0, this.score, this.coins, Math.round(this.camRow * 1000));
  }
}
