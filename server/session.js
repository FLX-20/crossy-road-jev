// A realtime game session: the simulation advances with the wall clock at 60 ticks/s whether or not the
// player has decided. The agent observes and acts asynchronously.

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Game } from '../core/game.js';
import { observe } from '../core/observe.js';
import { simulate } from '../core/replay.js';
import { TICK_RATE } from '../core/config.js';

const r2 = (v) => Math.round(v * 100) / 100;

export class Session extends EventEmitter {
  constructor({ seed = 1, agent = 'jev', model = null, maxSeconds = 600 } = {}) {
    super();
    this.id = randomUUID().slice(0, 8);
    this.seed = seed >>> 0;
    this.agent = agent;
    this.model = model;
    this.maxTicks = Math.round(maxSeconds * TICK_RATE);
    this.game = new Game({ seed: this.seed });
    this.actions = []; // [{tick, move}] — everything needed to replay the run
    this.recent = []; // last few actions with their immediate result, shown to the agent
    this.decisions = []; // per-decision timing and metadata, filled by the runner
    this.ended = false;
    this.result = null;
    this.check = null;
    this.createdAt = new Date().toISOString();
  }

  start() {
    this.t0 = performance.now();
    this.timer = setInterval(() => this.pump(), 4);
    this.heartbeat = setInterval(() => {
      this.pump();
      if (!this.ended) this.emit('tick', { tick: this.game.tick, check: this.check });
    }, 100);
    this.emit('start', { seed: this.seed });
    return this;
  }

  /** Advance the simulation to the current wall-clock tick. */
  pump() {
    if (this.ended || this.t0 === undefined) return;
    const target = Math.floor(((performance.now() - this.t0) * TICK_RATE) / 1000);
    const g = this.game;
    while (g.tick < target && !this.ended) {
      g.step();
      g.events.length = 0;
      // Checksums are taken right after a step, before any input for that tick, so replicas can compare
      // at exactly the same point.
      if (g.tick % 30 === 0) this.check = { tick: g.tick, checksum: g.checksum() };
      if (!g.alive) this.finish(g.death.cause);
      else if (g.tick >= this.maxTicks) this.finish('timeout');
    }
  }

  observe() {
    this.pump();
    // The player's typical delay between observing and acting (median of its last 5 decisions).
    const recent = this.decisions.filter((d) => !d.error).slice(-5).map((d) => d.latencyMs).sort((a, b) => a - b);
    const delayS = recent.length ? recent[Math.floor(recent.length / 2)] / 1000 : 0;
    const delayRangeS = recent.length ? [recent[0] / 1000, recent[recent.length - 1] / 1000] : [0, 0];
    return observe(this.game, { recentActions: this.recent.slice(), delayS, delayRangeS });
  }

  /** Apply a move now. Returns {tick, result}; tick is when it took effect. */
  act(move) {
    this.pump();
    const g = this.game;
    if (this.ended || !g.alive) return { tick: g.tick, result: 'dead' };
    const result = g.queueMove(move);
    if (move !== 'wait' && result !== 'ignored') {
      this.actions.push({ tick: g.tick, move });
      this.emit('action', { tick: g.tick, move });
    }
    this.recent.push({ t: r2(g.tick / TICK_RATE), move, result });
    if (this.recent.length > 8) this.recent.shift();
    return { tick: g.tick, result };
  }

  recordDecision(decision) {
    this.decisions.push(decision);
    const { move, latencyMs, confidence, error } = decision;
    this.emit('decision', { move, latencyMs, confidence, error });
  }

  finish(reason) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    const g = this.game;
    const replay = simulate(this.seed, this.actions, g.tick);
    const latencies = this.decisions.filter((d) => d.latencyMs != null && !d.error).map((d) => d.latencyMs).sort((a, b) => a - b);
    const pct = (p) => (latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]) : null);
    this.result = {
      id: this.id,
      seed: this.seed,
      agent: this.agent,
      model: this.model,
      score: g.score,
      coins: g.coins,
      endReason: reason,
      deathCause: g.death?.cause ?? null,
      durationS: r2(g.tick / TICK_RATE),
      endTick: g.tick,
      hops: g.hops,
      decisions: this.decisions.length,
      errors: this.decisions.filter((d) => d.error).length,
      latencyMs: { p50: pct(0.5), p95: pct(0.95), mean: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null },
      verified: replay.score === g.score && replay.checksum === g.checksum(),
      checksum: g.checksum(),
      actions: this.actions,
      decisionLog: this.decisions,
    };
    this.emit('end', this.result);
  }
}
