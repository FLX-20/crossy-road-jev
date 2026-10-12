import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../core/game.js';
import { World, laneObjects, trainState } from '../core/lanes.js';
import { simulate } from '../core/replay.js';
import { mulberry32 } from '../core/rng.js';
import { HOP_TICKS, TICK_RATE, COL_MIN, COL_MAX, PLAYER_HALF } from '../core/config.js';

/** Play `ticks` ticks with seeded random inputs; returns the game and its action log. */
function randomRun(seed, ticks, inputSeed = 99) {
  const rng = mulberry32(inputSeed);
  const game = new Game({ seed });
  const actions = [];
  while (game.tick < ticks && game.alive) {
    if (rng.chance(0.08)) {
      const move = rng.pick(['up', 'up', 'up', 'left', 'right', 'down']);
      if (game.queueMove(move) !== 'ignored') actions.push({ tick: game.tick, move });
    }
    game.step();
  }
  return { game, actions };
}

function findRow(seed, type, predicate = () => true) {
  const world = new World(seed);
  for (let row = 3; row < 2000; row++) {
    const lane = world.lane(row);
    if (lane.type === type && predicate(lane)) return row;
  }
  throw new Error(`no ${type} row`);
}

/** Put the player on `row` at column `x` (standing, not riding). */
function placeAt(game, row, x) {
  Object.assign(game.player, { row, x, visRow: row, hop: null, ride: null, queued: null });
  game.prev.x = x;
  game.prev.visRow = row;
}

test('same seed and inputs give identical games, and replay reproduces them', () => {
  for (const seed of [1, 2, 3, 12345]) {
    const a = randomRun(seed, 3000);
    const b = randomRun(seed, 3000);
    assert.equal(a.game.checksum(), b.game.checksum());
    const replay = simulate(seed, a.actions, a.game.tick);
    assert.equal(replay.checksum, a.game.checksum());
    assert.equal(replay.score, a.game.score);
  }
});

test('different seeds give different worlds', () => {
  const sig = (seed) => {
    const w = new World(seed);
    return Array.from({ length: 40 }, (_, i) => w.lane(i + 1).type[0]).join('');
  };
  assert.notEqual(sig(1), sig(2));
});

test('every world is passable for 5000 rows (static reachability)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const world = new World(seed);
    let reach = new Set([0]); // reachable columns in the current row
    for (let row = 1; row <= 5000; row++) {
      const lane = world.lane(row);
      let cells;
      if (lane.type === 'grass') {
        const open = [];
        for (let c = COL_MIN; c <= COL_MAX; c++) if (!lane.blocked.has(c)) open.push(c);
        // Entering columns, then sideways along contiguous open cells.
        cells = new Set(open.filter((c) => reach.has(c)));
        let grew = true;
        while (grew) {
          grew = false;
          for (const c of open) if (!cells.has(c) && (cells.has(c - 1) || cells.has(c + 1))) { cells.add(c); grew = true; }
        }
      } else if (lane.type === 'river' && lane.pads.length) {
        cells = new Set(lane.pads.filter((c) => reach.has(c)));
      } else {
        // Roads and rails allow free sideways movement; logs pass every column.
        cells = new Set();
        for (let c = COL_MIN; c <= COL_MAX; c++) cells.add(c);
        if (reach.size === 0) cells.clear();
      }
      assert.ok(cells.size > 0, `seed ${seed}: row ${row} (${lane.type}) unreachable`);
      reach = cells;
    }
  }
});

test('grass rows keep at least 3 open playable cells', () => {
  const world = new World(8);
  for (let row = 1; row < 3000; row++) {
    const lane = world.lane(row);
    if (lane.type !== 'grass') continue;
    let open = 0;
    for (let c = COL_MIN; c <= COL_MAX; c++) if (!lane.blocked.has(c)) open++;
    assert.ok(open >= 3, `row ${row}`);
  }
});

test('a car or truck in the player lane kills them', () => {
  const game = new Game({ seed: 3 });
  const row = findRow(3, 'road');
  placeAt(game, row, 0);
  for (let i = 0; i < 60 * 30 && game.alive; i++) game.step();
  assert.equal(game.alive, false);
  assert.ok(['car', 'truck'].includes(game.death.cause));
  const lane = game.lane(row);
  const hit = laneObjects(lane, game.tick).some((o) => o.x1 > -PLAYER_HALF && o.x0 < PLAYER_HALF);
  assert.ok(hit, 'a vehicle overlaps the player at death');
});

test('a train kills the player, after its signal flashes', () => {
  const game = new Game({ seed: 4 });
  const row = findRow(4, 'rail');
  while (trainState(game.lane(row), game.tick / TICK_RATE).flashing) game.step();
  placeAt(game, row, 0);
  game.started = false; // keep the eagle away
  let warned = false;
  for (let i = 0; i < 60 * 15 && game.alive; i++) {
    const s = trainState(game.lane(row), game.tick / TICK_RATE);
    if (s.flashing && !s.passing) warned = true;
    game.step();
  }
  assert.equal(game.death?.cause, 'train');
  assert.ok(warned, 'the signal flashed before the train arrived');
});

test('landing on open water drowns; landing on a log rides it until carried off', () => {
  const seed = 6;
  const row = findRow(seed, 'river', (l) => l.objs.length > 0);
  // Find a tick where x = 0 is open water at landing time, and one where a log is there.
  const probe = new Game({ seed });
  let waterTick = null;
  let logTick = null;
  for (let t = 0; t < 2000 && (waterTick === null || logTick === null); t++) {
    const spot = probe.riverLanding(probe.lane(row), 0, t + HOP_TICKS);
    if (!spot && waterTick === null) waterTick = t;
    if (spot && logTick === null) logTick = t;
  }

  const wet = new Game({ seed });
  while (wet.tick < waterTick) wet.step();
  placeAt(wet, row - 1, 0);
  wet.started = false;
  assert.equal(wet.queueMove('up'), 'moved');
  for (let i = 0; i < HOP_TICKS + 1; i++) wet.step();
  assert.equal(wet.death?.cause, 'water');

  const dry = new Game({ seed });
  while (dry.tick < logTick) dry.step();
  placeAt(dry, row - 1, 0);
  dry.started = false;
  assert.equal(dry.queueMove('up'), 'moved');
  for (let i = 0; i < HOP_TICKS + 1; i++) dry.step();
  assert.equal(dry.alive, true);
  assert.ok(dry.player.ride, 'riding a log');
  const x0 = dry.player.x;
  dry.step();
  assert.notEqual(dry.player.x, x0, 'the log carries the player');
  for (let i = 0; i < 60 * 20 && dry.alive; i++) dry.step();
  assert.equal(dry.death?.cause, 'carried');
});

test('the eagle comes about 7.5 s after the player stops moving', () => {
  const game = new Game({ seed: 1 });
  game.queueMove('up');
  const start = game.tick;
  while (game.alive && game.tick < 60 * 20) game.step();
  assert.equal(game.death.cause, 'eagle');
  const seconds = (game.tick - start) / TICK_RATE;
  assert.ok(seconds > 6.5 && seconds < 9, `${seconds} s`);
});

test('the eagle is not called before the first move', () => {
  const game = new Game({ seed: 1 });
  for (let i = 0; i < 60 * 30; i++) game.step();
  assert.equal(game.alive, true);
});

test('trees block hops without moving the player', () => {
  const seed = 2;
  const row = findRow(seed, 'grass', (l) => [...l.blocked].some((c) => c > COL_MIN && c <= COL_MAX));
  const game = new Game({ seed });
  const lane = game.lane(row);
  const tree = [...lane.blocked].find((c) => c > COL_MIN && c <= COL_MAX);
  placeAt(game, row, tree - 1);
  game.started = false;
  assert.equal(game.queueMove('right'), 'blocked');
  assert.equal(game.player.x, tree - 1);
  assert.equal(game.player.facing, 'right');
  assert.equal(game.player.hop, null);
});

test('the start wall stops going back, and the play-area edge stops sideways hops', () => {
  const game = new Game({ seed: 1 });
  placeAt(game, -3, 0);
  game.lane(-3).blocked.delete(0);
  assert.equal(game.queueMove('down'), 'blocked');
  placeAt(game, 0, COL_MAX);
  assert.equal(game.queueMove('right'), 'blocked');
});

test('one input is buffered during a hop', () => {
  const game = new Game({ seed: 1 });
  assert.equal(game.queueMove('up'), 'moved');
  assert.equal(game.queueMove('up'), 'queued');
  assert.equal(game.queueMove('up'), 'ignored');
  for (let i = 0; i < HOP_TICKS * 2 + 2 && game.alive; i++) game.step();
  assert.equal(game.player.row, 2);
  assert.equal(game.score, 2);
});

test('coins are collected once on landing', () => {
  const seed = 11;
  const world = new World(seed);
  let row = 1;
  while (!(world.lane(row).type === 'grass' && world.lane(row).coins.length)) row++;
  const game = new Game({ seed });
  const col = game.lane(row).coins[0];
  placeAt(game, row - 1, col);
  game.started = false;
  const below = game.lane(row - 1);
  if (below.type === 'river') below.pads.push(col);
  assert.equal(game.queueMove('up'), 'moved');
  for (let i = 0; i < HOP_TICKS + 1; i++) game.step();
  assert.equal(game.coins, 1);
  assert.ok(game.collected.has(`${row}:${col}`));
});
