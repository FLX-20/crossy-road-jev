import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../core/game.js';
import { observe } from '../core/observe.js';
import { mulberry32 } from '../core/rng.js';
import { HOP_TICKS, TICK_RATE, ACTIONS } from '../core/config.js';

/** Rebuild the game as it was observed at `tick`, before any input given at that tick (a "what if" fork). */
function replayTo(seed, actions, tick) {
  const g = new Game({ seed });
  let i = 0;
  while (g.tick < tick) {
    while (i < actions.length && actions[i].tick <= g.tick) g.queueMove(actions[i++].move);
    g.step();
  }
  return g;
}

test('observation has the documented shape', () => {
  const g = new Game({ seed: 3 });
  for (let i = 0; i < 30; i++) g.step();
  const o = observe(g);
  for (const key of ['t', 'tick', 'alive', 'score', 'coins', 'player', 'eagle', 'lanes', 'map', 'moves', 'recentActions']) assert.ok(key in o, key);
  assert.equal(o.lanes.length, 11);
  assert.equal(o.map.length, 11);
  assert.deepEqual(Object.keys(o.moves).sort(), [...ACTIONS].sort());
  for (const a of ACTIONS) {
    assert.ok(['safe', 'danger', 'blocked'].includes(o.safety[a]), a);
    assert.ok(o.moves[a].startsWith(`${o.safety[a].toUpperCase()}.`), o.moves[a]);
  }
  assert.match(o.map[8], /@/, 'the player is drawn on the dy=0 line');
  assert.equal(observe(g, { annotate: false }).moves, undefined);
  assert.equal(observe(g, { annotate: false }).safety, undefined);
  JSON.stringify(o); // serializable
});

test('SAFE verdicts hold when the move arrives anywhere within the stated delay range', () => {
  const range = [0.2, 0.35];
  let checked = 0;
  for (const seed of [21, 22, 23, 24, 25, 26]) {
    const rng = mulberry32(seed);
    const g = new Game({ seed });
    const actions = [];
    while (g.alive && g.tick < 60 * 60) {
      if (g.tick % 7 === 0) {
        const o = observe(g, { delayS: 0.27, delayRangeS: range });
        for (const dir of ['up', 'down', 'left', 'right']) {
          if (o.safety[dir] !== 'safe') continue;
          const lag = Math.round((range[0] + rng.next() * (range[1] - range[0])) * TICK_RATE);
          const fork = replayTo(seed, actions, g.tick);
          for (let i = 0; i < lag && fork.alive; i++) fork.step();
          fork.queueMove(dir);
          for (let i = 0; i < HOP_TICKS * 2 + 2 && fork.alive; i++) fork.step();
          assert.equal(fork.alive, true, `seed ${seed} tick ${g.tick} ${dir} after ${lag} ticks: ${o.moves[dir]} -> ${fork.death?.cause}`);
          checked++;
        }
      }
      if (rng.chance(0.05)) {
        const move = rng.pick(['up', 'up', 'up', 'left', 'right']);
        if (g.queueMove(move) !== 'ignored') actions.push({ tick: g.tick, move });
      }
      g.step();
    }
  }
  assert.ok(checked > 200, `only ${checked} cases`);
});

test('move sentences agree with what the move actually does', () => {
  const checked = { drown: 0, log: 0, grass: 0, blocked: 0, roadClear: 0, railQuiet: 0, safeHop: 0 };
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const rng = mulberry32(seed * 7);
    const g = new Game({ seed });
    const actions = [];
    while (g.alive && g.tick < 60 * 60) {
      if (!g.player.hop && g.tick % 9 === 0) {
        const o = observe(g);
        for (const dir of ['up', 'down', 'left', 'right']) {
          const text = o.moves[dir];
          const fork = replayTo(seed, actions, g.tick);
          const result = fork.queueMove(dir);
          for (let i = 0; i < HOP_TICKS + 1 && fork.alive; i++) fork.step();
          const cause = fork.death?.cause;
          const label = `seed ${seed} tick ${g.tick} ${dir}: ${text} -> ${result}/${cause}`;
          if (text.includes('blocked by')) {
            assert.equal(result, 'blocked', label);
            checked.blocked++;
          } else if (text.includes('you would drown')) {
            assert.equal(cause, 'water', label);
            checked.drown++;
          } else if (text.includes('a log is under you') || text.includes('you land safely')) {
            assert.notEqual(cause, 'water', label);
            checked.log++;
          } else if (text.includes('Safe ground')) {
            assert.ok(!['car', 'truck', 'train', 'water'].includes(cause), label);
            checked.grass++;
          }
          if (o.safety[dir] === 'safe') {
            assert.equal(fork.alive, true, label);
            checked.safeHop++;
          }
          if ((dir === 'up' || dir === 'down') && text.includes('Nothing is at that spot')) {
            assert.ok(!['car', 'truck', 'train'].includes(cause), label);
            checked.roadClear++;
          }
          if ((dir === 'up' || dir === 'down') && text.includes('railway signal is off')) {
            assert.notEqual(cause, 'train', label);
            checked.railQuiet++;
          }
        }
      }
      if (rng.chance(0.06)) {
        const move = rng.pick(['up', 'up', 'up', 'left', 'right']);
        if (g.queueMove(move) !== 'ignored') actions.push({ tick: g.tick, move });
      }
      g.step();
    }
  }
  for (const [kind, n] of Object.entries(checked)) assert.ok(n > 0, `no "${kind}" cases were exercised`);
});

test('in front of a tree, the descriptions point the way around instead of suggesting a wait', () => {
  const g = new Game({ seed: 9 });
  let row = 2;
  let col = null;
  // A grass row whose next row has a tree at some open column of this row.
  for (; row < 400 && col === null; row++) {
    const here = g.lane(row);
    const ahead = g.lane(row + 1);
    if (here.type !== 'grass' || ahead.type !== 'grass') continue;
    for (let c = -3; c <= 3; c++) if (!here.blocked.has(c) && ahead.blocked.has(c)) col = c;
  }
  row--;
  Object.assign(g.player, { row, x: col, visRow: row });
  g.started = true;
  g.camRow = row;
  const o = observe(g);
  assert.equal(o.safety.up, 'blocked');
  assert.match(o.moves.up, /Trees never move\. (The nearest way forward is at x=-?\d|There is no way forward)/);
  assert.match(o.moves.wait, /Waiting does not help/);
  assert.doesNotMatch(o.moves.wait, /You can wait about/);
  const sideways = [o.moves.left, o.moves.right].filter((t) => t.startsWith('SAFE.'));
  assert.ok(sideways.every((t) => /heads around the tree ahead|no way forward on this side/.test(t)), sideways.join('\n'));
});

test('"the hop forward becomes SAFE in about X s" comes true when the player waits', () => {
  const lagS = { delayS: 0.25, delayRangeS: [0.2, 0.32] };
  let checked = 0;
  for (const seed of [41, 42, 43, 44, 45]) {
    const rng = mulberry32(seed);
    const g = new Game({ seed });
    const actions = [];
    while (g.alive && g.tick < 60 * 40 && checked < 60) {
      if (g.tick % 11 === 0 && !g.player.hop) {
        const o = observe(g, lagS);
        const m = /hop forward becomes SAFE in about ([\d.]+) s/.exec(o.moves.wait);
        if (m) {
          const fork = replayTo(seed, actions, g.tick);
          const target = g.tick + Math.round(Number(m[1]) * TICK_RATE);
          while (fork.alive && fork.tick < target) fork.step();
          assert.equal(observe(fork, lagS).safety.up, 'safe', `seed ${seed} tick ${g.tick}: ${o.moves.wait}`);
          checked++;
        }
      }
      if (rng.chance(0.05)) {
        const move = rng.pick(['up', 'up', 'up', 'left', 'right']);
        if (g.queueMove(move) !== 'ignored') actions.push({ tick: g.tick, move });
      }
      g.step();
    }
  }
  assert.ok(checked > 5, `only ${checked} cases`);
});
