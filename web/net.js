// Follows a live server session over Server-Sent Events. The browser runs its own copy of the deterministic
// simulation and applies the streamed actions at the exact ticks the server applied them.

import { TICK_RATE } from '/core/config.js';

export class SessionFeed {
  constructor(id) {
    this.id = id;
    this.info = null;
    this.actions = [];
    this.safeTick = 0; // the replica may step while its tick is below this (all inputs up to here are known)
    this.beat = null;
    this.checks = new Map();
    this.decision = null;
    this.ended = false;
    this.end = null;
    this.error = null;
    this.es = new EventSource(`/api/sessions/${encodeURIComponent(id)}/events`);
    const on = (type, fn) => this.es.addEventListener(type, (e) => fn(JSON.parse(e.data)));
    on('hello', (d) => {
      this.info = d;
      this.actions = d.actions;
      this.safeTick = Math.max(this.safeTick, d.tick);
      this.beat = { tick: d.tick, at: performance.now() };
      if (d.result) this.finish({ endTick: d.result.endTick, score: d.result.score });
    });
    on('action', (d) => {
      this.actions.push(d);
      this.safeTick = Math.max(this.safeTick, d.tick);
    });
    on('tick', (d) => {
      this.safeTick = Math.max(this.safeTick, d.tick);
      this.beat = { tick: d.tick, at: performance.now() };
      if (d.check) this.checks.set(d.check.tick, d.check.checksum);
    });
    on('decision', (d) => { this.decision = d; });
    on('end', (d) => this.finish(d));
    this.es.addEventListener('error', () => {
      if (!this.ended) this.error = 'Connection to the session lost; retrying…';
    });
    this.es.addEventListener('open', () => { this.error = null; });
  }

  finish(d) {
    this.ended = true;
    this.end = d;
    this.safeTick = Math.max(this.safeTick, d.endTick);
    this.es.close();
  }

  /** The server's current tick, estimated from the last heartbeat. */
  serverTick(now) {
    if (!this.beat) return 0;
    return this.beat.tick + ((now - this.beat.at) * TICK_RATE) / 1000;
  }

  close() {
    this.es.close();
  }
}
