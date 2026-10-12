// Re-simulate a recorded run. Used to verify that a session's result matches its seed and moves.

import { Game } from './game.js';
import { TICK_RATE } from './config.js';

/**
 * Apply each action before the step that follows its tick, exactly as a live session does.
 * @param {number} seed
 * @param {{tick:number, move:string}[]} actions sorted by tick
 * @param {number} [endTick] stop here if still alive (a session that hit its time cap)
 */
export function simulate(seed, actions, endTick) {
  const game = new Game({ seed });
  const last = actions.length ? actions[actions.length - 1].tick : 0;
  // Without an explicit end, the camera guarantees death (eagle) shortly after the last input.
  const limit = endTick ?? last + 120 * TICK_RATE;
  let i = 0;
  while (game.tick < limit) {
    while (i < actions.length && actions[i].tick <= game.tick) game.queueMove(actions[i++].move);
    if (!game.alive) break;
    game.step();
  }
  // Inputs logged at the final tick (a run stopped right after an action) were applied live too.
  while (i < actions.length && actions[i].tick <= game.tick) game.queueMove(actions[i++].move);
  return {
    score: game.score,
    coins: game.coins,
    alive: game.alive,
    deathCause: game.death?.cause ?? null,
    endTick: game.tick,
    checksum: game.checksum(),
  };
}
