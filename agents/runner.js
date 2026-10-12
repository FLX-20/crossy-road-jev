// The realtime agent loop: observe, wait for the agent's decision while the world keeps moving, act, repeat.

import { performance } from 'node:perf_hooks';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive `session` with `agent` until the episode ends. Resolves with the session result.
 * @param {import('../server/session.js').Session} session
 */
export async function runAgent(session, agent, { log = () => {} } = {}) {
  const done = new Promise((resolve) => session.once('end', resolve));
  while (!session.ended) {
    const obs = session.observe();
    if (!obs.alive) break;
    const t0 = performance.now();
    let decision;
    try {
      decision = await agent.decide(obs);
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      session.recordDecision({ observedTick: obs.tick, latencyMs, error: String(err.message ?? err).slice(0, 300) });
      log(`[${session.id}] ${agent.name} error after ${latencyMs} ms: ${err.message}`);
      if (err.fatal) {
        session.finish('agent-error');
        break;
      }
      await sleep(250);
      continue;
    }
    const latencyMs = Math.round(performance.now() - t0);
    if (session.ended) break;
    const { move } = decision;
    const { tick, result } = session.act(move);
    session.recordDecision({ observedTick: obs.tick, appliedTick: tick, latencyMs, move, result, ...decision.meta });
  }
  return done;
}
