// What an AI player perceives: like an accessibility tree for the game. Everything here is a fact taken from
// the simulation at the moment of observation (positions, speeds, arrival times). It never suggests a move.

import { TICK_RATE, HOP_TICKS, PLAYER_HALF, EAGLE_ROWS, CAM_BASE_SPEED, CARRY_LIMIT, COL_MIN, COL_MAX, RAIL, LAND_TOLERANCE } from './config.js';
import { laneObjects, trainState, approachTimes } from './lanes.js';
import { roundCol } from './game.js';

export const VIEW_AHEAD = 8;
export const VIEW_BEHIND = 2;
const MAP_MIN = -6;
const MAP_MAX = 6;
const H = PLAYER_HALF;

const r2 = (v) => Math.round(v * 100) / 100;
const sec = (v) => (v === Infinity ? 'never' : r2(v).toFixed(2));
const fx = (x) => (Number.isInteger(r2(x)) ? String(r2(x)) : r2(x).toFixed(2));
const dirName = (d) => (d > 0 ? 'right' : 'left');

/**
 * Build the observation for the current tick.
 * @param {import('./game.js').Game} game
 * @param {{annotate?: boolean, recentActions?: object[], delayS?: number, delayRangeS?: [number, number]}} options
 *   annotate=false omits the per-move sentences and verdicts. delayS is the player's typical delay before a move
 *   takes effect and delayRangeS its recent min and max, so the verdicts hold however long a decision takes.
 */
export function observe(game, { annotate = true, recentActions = [], delayS = 0, delayRangeS = [delayS, delayS] } = {}) {
  const p = game.player;
  const lanes = [];
  const map = [];
  for (let dy = VIEW_AHEAD; dy >= -VIEW_BEHIND; dy--) {
    lanes.push(laneInfo(game, p.row + dy, dy));
    map.push(mapLine(game, p.row + dy, dy));
  }
  const obs = {
    t: r2(game.tick / TICK_RATE),
    tick: game.tick,
    alive: game.alive,
    deathCause: game.death?.cause ?? null,
    score: game.score,
    coins: game.coins,
    player: { row: p.row, x: r2(p.x), onLog: !!(p.ride || p.hop?.ride), hopping: !!p.hop, facing: p.facing },
    eagle: eagleInfo(game),
    lanes,
    map,
    recentActions,
    yourDelayS: r2(delayS),
  };
  const ticks = (v) => Math.round(v * TICK_RATE);
  if (annotate) {
    const described = describeMoves(game, { typical: ticks(delayS), min: ticks(delayRangeS[0]), max: ticks(delayRangeS[1]) });
    obs.moves = Object.fromEntries(Object.entries(described).map(([m, d]) => [m, `${TAG[d.verdict]} ${d.text}`]));
    obs.safety = Object.fromEntries(Object.entries(described).map(([m, d]) => [m, d.verdict]));
  }
  return obs;
}

function eagleInfo(game) {
  if (!game.started) return { cameraMoving: false, rowsBehindCamera: 0, limit: EAGLE_ROWS, secondsIfIdle: null };
  const behind = game.camRow - game.player.row;
  return {
    cameraMoving: true,
    rowsBehindCamera: r2(behind),
    limit: EAGLE_ROWS,
    secondsIfIdle: r2(Math.max(0, (EAGLE_ROWS - behind) / CAM_BASE_SPEED)),
  };
}

function laneInfo(game, row, dy) {
  const lane = game.lane(row);
  const info = { dy, row, type: lane.type };
  const objs = laneObjects(lane, game.tick).filter((o) => o.x1 > MAP_MIN - 0.5 && o.x0 < MAP_MAX + 0.5);
  const span = (o) => ({ from: r2(o.x0), to: r2(o.x1) });
  if (lane.type === 'grass') {
    info.trees = lane.blockers.filter((b) => b.col >= COL_MIN && b.col <= COL_MAX).map((b) => b.col).sort((a, b) => a - b);
  } else if (lane.type === 'road') {
    Object.assign(info, { flow: dirName(lane.dir), speed: r2(lane.speed), vehicles: objs.map((o) => ({ kind: o.kind, ...span(o) })) });
  } else if (lane.type === 'river') {
    if (lane.pads.length) info.lilyPads = lane.pads;
    else Object.assign(info, { flow: dirName(lane.dir), speed: r2(lane.speed), logs: objs.map(span) });
  } else {
    const ts = trainState(lane, game.tick / TICK_RATE);
    Object.assign(info, { flow: dirName(lane.dir), signal: ts.flashing ? 'flashing' : 'off' });
    if (ts.passing) info.train = span(ts);
    else if (ts.flashing) info.trainEntersViewIn = r2(ts.untilNext);
  }
  const coins = lane.coins.filter((c) => !game.collected.has(`${row}:${c}`));
  if (coins.length) info.coins = coins;
  return info;
}

/** One line of the ASCII map. Columns -6..6; the bars mark the play area (-4..4). */
function mapLine(game, row, dy) {
  const lane = game.lane(row);
  const objs = laneObjects(lane, game.tick);
  const p = game.player;
  const coins = new Set(lane.coins.filter((c) => !game.collected.has(`${row}:${c}`)));
  let cells = '';
  for (let c = MAP_MIN; c <= MAP_MAX; c++) {
    if (c === COL_MIN) cells += '|';
    const covered = objs.find((o) => o.x1 > c - 0.35 && o.x0 < c + 0.35);
    let ch;
    if (lane.type === 'grass') ch = lane.blocked.has(c) ? 'T' : coins.has(c) ? '$' : '.';
    else if (lane.type === 'road') ch = covered ? (covered.kind === 'truck' ? 'K' : 'C') : coins.has(c) ? '$' : '=';
    else if (lane.type === 'river') ch = lane.pads.length ? (lane.pads.includes(c) ? 'O' : '~') : covered ? 'L' : '~';
    else ch = covered ? 'R' : '#';
    if (dy === 0 && game.alive && c === roundCol(p.x)) ch = '@';
    cells += ch;
    if (c === COL_MAX) cells += '|';
  }
  let flow = '';
  if ((lane.type === 'road' || lane.type === 'river') && lane.speed > 0) flow = `${lane.dir > 0 ? '>>' : '<<'} ${lane.speed.toFixed(1)}/s`;
  else if (lane.type === 'river') flow = 'pads';
  else if (lane.type === 'rail') {
    const ts = trainState(lane, game.tick / TICK_RATE);
    flow = ts.passing ? `TRAIN ${lane.dir > 0 ? '>>' : '<<'}` : ts.flashing ? `SIGNAL ${lane.dir > 0 ? '>>' : '<<'}` : 'quiet';
  }
  return `${dy >= 0 ? '+' : ''}${dy} row ${String(row).padStart(3)} ${lane.type.padEnd(5)} ${flow.padEnd(9)} ${cells}`;
}

// ---- per-move sentences ----
// Every action gets a verdict computed from the simulation — 'safe', 'danger' (the action can kill you, given the
// player's delay range) or 'blocked' — and a sentence that starts with it.

const TAG = { safe: 'SAFE.', danger: 'DANGER.', blocked: 'BLOCKED.', over: 'GAME OVER.' };
const MARGIN = 3; // ticks of slack on each side of a timing window

function describeMoves(game, lag = { typical: 0, min: 0, max: 0 }) {
  if (!game.alive) {
    const d = { verdict: 'over', text: `The game is over (${game.death.cause}).` };
    return { up: d, down: d, left: d, right: d, wait: d };
  }
  const up = hopMove(game, 'up', lag);
  return {
    up,
    down: hopMove(game, 'down', lag),
    left: hopMove(game, 'left', lag),
    right: hopMove(game, 'right', lag),
    wait: waitMove(game, lag, up.verdict),
  };
}

/**
 * How long the player would have to wait where they are until the hop forward is SAFE, found by simulating ahead
 * without input and checking the hop every few ticks. Infinity if not within `horizon` ticks (or if they die first).
 */
function forwardOpensIn(game, lag, horizon) {
  const g = game.clone();
  for (let k = 3; k <= horizon; k += 3) {
    for (let i = 0; i < 3 && g.alive; i++) g.step();
    if (!g.alive) return Infinity;
    if (hopMove(g, 'up', lag).verdict === 'safe') return k / TICK_RATE;
  }
  return Infinity;
}

function laneLabel(lane) {
  if (lane.type === 'grass') return 'grass';
  if (lane.type === 'road') return `road, ${lane.objs[0]?.kind ?? 'car'}s moving ${dirName(lane.dir)} at ${sec(lane.speed)} cells/s`;
  if (lane.type === 'river') {
    return lane.pads.length ? `river with lily pads at x=${lane.pads.join(', ')}` : `river, logs drifting ${dirName(lane.dir)} at ${sec(lane.speed)} cells/s`;
  }
  return `railway, trains run ${dirName(lane.dir)}`;
}

const DEATH_TEXT = {
  car: 'a car hits you', truck: 'a truck hits you', train: 'a train hits you', water: 'you drown',
  carried: 'the log carries you off the edge', eagle: 'the eagle takes you',
};

/**
 * Where the player will stand once the current hop and any queued hop have landed (or now, if idle), and the
 * ticks until then; a move decided now starts from there. Found by simulating ahead without new input.
 * `dies` is set when the player is killed before getting there.
 */
function settledState(game) {
  const p = game.player;
  if (!p.hop && !p.queued) return { st: { row: p.row, x: p.x, ride: p.ride }, delay: 0 };
  const g = game.clone();
  while (g.alive && (g.player.hop || g.player.queued)) g.step();
  const q = g.player;
  const st = { row: q.row, x: q.x, ride: q.ride && { ...q.ride } };
  if (!g.alive) st.dies = g.death.cause;
  return { st, delay: g.tick - game.tick };
}

/** Seconds the player needs to decide again and hop away (used to judge whether a spot is a trap). */
function escapeTime(lag) {
  return (2 * Math.max(lag.max, HOP_TICKS) + HOP_TICKS + MARGIN) / TICK_RATE;
}

/** `lag` = ticks between this observation and the move arriving ({typical, min, max}). */
function hopMove(game, dir, lag) {
  const { st, delay } = settledState(game);
  const prefix = delay ? `You are mid-hop; this move starts when you land in ${sec(delay / TICK_RATE)} s. ` : '';
  const plan = game.planHop(dir, st);
  const verb = {
    up: `Hop forward to row ${plan.toRow}`,
    down: `Hop back to row ${plan.toRow}`,
    left: `Hop left to x=${fx(plan.toX)}`,
    right: `Hop right to x=${fx(plan.toX)}`,
  }[dir];
  const treeAhead = !st.ride && game.planHop('up', st).reason === 'tree';
  if (!plan.ok) {
    let text = `${prefix}${verb}: blocked by ${plan.reason === 'tree' ? 'a tree' : 'the edge of the play area'}, so you would stay where you are.`;
    if (dir === 'up' && treeAhead) text += ` Trees never move. ${routeText(wayForward(game, st), st.row)}`;
    return { verdict: 'blocked', text };
  }
  const lane = game.lane(plan.toRow);
  // A move that arrives mid-hop waits for the landing; one that arrives later starts on arrival.
  const startTick = game.tick + Math.max(delay, lag.typical);
  const landTick = startTick + HOP_TICKS;
  let result;
  if (lane.type === 'grass') {
    const coin = lane.coins.includes(roundCol(plan.toX)) && !game.collected.has(`${plan.toRow}:${roundCol(plan.toX)}`);
    result = { verdict: 'safe', text: `Safe ground${coin ? ' with a coin' : ''}.` };
  } else if (lane.type === 'road' || lane.type === 'rail') {
    // Hopping off a moving log: the column depends on when the move arrives, so check every possible one.
    const columns = [...new Set(rideColumns(game, st, dir, delay, lag))];
    const checks = columns.map((c) => hopSafety(game, lane, c, delay, lag));
    result = checks.find((c) => c.verdict === 'danger') ?? checks[0];
    if (columns.length > 1) result = { ...result, text: `The log is carrying you, so you land at x=${columns.join(' or x=')} depending on your delay. ${result.text}` };
    if (result.verdict === 'safe' && dir === 'up') result.text += ` ${aheadNote(game, plan.toRow + 1, columns[0], landTick - game.tick, lag)}`;
  } else {
    // x at landing tick t: sideways along a log moves with it; forward/back off a log starts wherever the log
    // has carried the player when the hop begins; otherwise the planned x.
    const from = game.lane(st.row);
    const xAt = (t) => (plan.ride ? game.objX0(lane, plan.ride.i, t) + plan.ride.toOff
      : st.ride && plan.toRow !== st.row ? game.objX0(from, st.ride.i, t - HOP_TICKS) + st.ride.off
        : plan.toX);
    // The landing has to work whenever, within the player's delay range, the move happens to arrive.
    const lands = [lag.min - MARGIN, lag.max + MARGIN].map((l) => game.tick + Math.max(delay, Math.max(0, l)) + HOP_TICKS);
    const safeAcrossRange = lands.every((t) => game.riverLanding(lane, xAt(t), t));
    result = riverLanding(game, lane, xAt(landTick), landTick, safeAcrossRange, lag);
  }
  let text = `${prefix}${verb} (${laneLabel(lane)}). ${result.text}`;
  let { verdict } = result;
  if (treeAhead && (dir === 'left' || dir === 'right')) {
    const way = wayForward(game, st)[dir];
    text += way
      ? ` This heads around the tree ahead: row ${st.row + 1} is open at x=${way.col}${way.hops > 1 ? `, ${way.hops} hops ${dir}` : ', right after this hop'}.`
      : ' There is no way forward on this side.';
  }
  const caught = caughtBeforeMove(game, delay, lag);
  if (caught) {
    verdict = 'danger';
    text += ` But ${caught} before this move can take effect.`;
  }
  if (dir === 'down' && game.started) {
    const behind = game.camRow - plan.toRow;
    text += ` You would be ${sec(behind)} rows behind the camera; the eagle strikes beyond ${EAGLE_ROWS}.`;
    if (behind > EAGLE_ROWS - 0.6) verdict = 'danger';
  }
  return { verdict, text };
}

/** What kills the player before a move decided now can start, simulated without new input (null if nothing). */
function caughtBeforeMove(game, hopLeft, lag) {
  const g = game.clone();
  const until = game.tick + Math.max(hopLeft, lag.max) + MARGIN;
  while (g.alive && g.tick < until) g.step();
  return g.alive ? null : DEATH_TEXT[g.death.cause];
}

/**
 * When a tree or rock blocks the hop forward: the nearest column on each side, reachable by sideways hops along
 * this row, from which the hop forward is open. {left?: {col, hops}, right?: {col, hops}}; null while on a log.
 */
function wayForward(game, st) {
  if (st.ride) return null;
  const lane = game.lane(st.row);
  const ahead = game.lane(st.row + 1);
  const passable = (c) => c >= COL_MIN && c <= COL_MAX
    && (lane.type === 'grass' ? !lane.blocked.has(c) : lane.type === 'river' ? lane.pads.includes(c) : true);
  const openAhead = (c) => (ahead.type === 'grass' ? !ahead.blocked.has(c) : ahead.type === 'river' && ahead.pads.length ? ahead.pads.includes(c) : true);
  const out = {};
  const col = roundCol(st.x);
  for (const [side, step] of [['left', -1], ['right', 1]]) {
    for (let c = col + step, hops = 1; passable(c); c += step, hops++) {
      if (openAhead(c)) {
        out[side] = { col: c, hops };
        break;
      }
    }
  }
  return out;
}

function routeText(route, row) {
  const sides = ['left', 'right'].filter((s) => route[s]).sort((a, b) => route[a].hops - route[b].hops);
  if (!sides.length) return 'There is no way forward from this part of the row; go back and around.';
  const say = (s) => `x=${route[s].col} (${route[s].hops} hop${route[s].hops > 1 ? 's' : ''} ${s})`;
  return `The nearest way forward is at ${say(sides[0])}${sides[1] ? `; another at ${say(sides[1])}` : ''}, where row ${row + 1} is open.`;
}

/** A short look one lane further: can the player keep going forward right after landing? */
function aheadNote(game, row, x, landIn, lag) {
  const lane = game.lane(row);
  if (lane.type === 'grass') {
    return lane.blocked.has(roundCol(x)) ? `Beyond it, a tree blocks row ${row} at this column.` : `Beyond it, row ${row} is grass.`;
  }
  if (lane.type === 'river') return `Beyond it, row ${row} is river.`;
  const next = hopSafety(game, lane, x, 0, lag, landIn);
  return next.verdict === 'safe'
    ? `Beyond it, row ${row} (${lane.type}) is clear right after you land, so you can keep going.`
    : `Beyond it, row ${row} (${lane.type}) is not clear right after you land, so you would have to wait on this ${lane.type === 'rail' ? 'track' : 'road'}.`;
}

function waitMove(game, lag, upVerdict) {
  const p = game.player;
  const { st, delay } = settledState(game);
  const lane = game.lane(st.row);
  let text = delay ? `You are mid-hop and land in ${sec(delay / TICK_RATE)} s. ` : '';
  text += `Wait at row ${st.row}, x=${fx(st.x)} (${laneLabel(lane)}). `;
  let verdict = 'safe';
  if (st.dies) return { verdict: 'danger', text: `${text}Before that, ${DEATH_TEXT[st.dies]}.` };
  const caught = caughtBeforeMove(game, delay, lag);
  if (caught) return { verdict: 'danger', text: `${text}Before your next move can take effect, ${caught}.` };
  if (lane.type === 'grass') text += 'Nothing can hit you here.';
  else if (lane.type === 'road' || lane.type === 'rail') {
    const w = waitSafety(game, lane, st.x, delay, lag);
    verdict = w.verdict;
    text += w.text;
  } else if (st.ride || (p.hop && !lane.pads.length)) {
    const edge = lane.dir > 0 ? (CARRY_LIMIT - st.x) / lane.speed : (st.x + CARRY_LIMIT) / lane.speed;
    if (edge < escapeTime(lag)) verdict = 'danger';
    text += `You ride a log drifting ${dirName(lane.dir)} and are carried off the edge in ${sec(Math.max(0, edge))} s unless you hop off.`;
  } else text += 'You are on a lily pad; it does not move.';
  const treeAhead = !st.ride && game.planHop('up', st).reason === 'tree';
  let useless = treeAhead;
  if (treeAhead) text += ` Waiting does not help: a tree blocks the way forward, and trees never move. ${routeText(wayForward(game, st), st.row)}`;
  else if (upVerdict !== 'safe' && verdict === 'safe') {
    // Will standing here ever lead anywhere? Look ahead until the eagle would come (at most 6 s).
    const idle = game.started ? eagleInfo(game).secondsIfIdle - escapeTime(lag) : 6;
    const opens = forwardOpensIn(game, lag, Math.round(Math.min(6, Math.max(0, idle)) * TICK_RATE));
    if (opens < Infinity) text += ` If you wait here, the hop forward becomes SAFE in about ${sec(opens)} s.`;
    else {
      useless = true;
      text += ' Waiting does not help: the hop forward from this spot does not become SAFE before the eagle comes. Hop sideways or go back to find another way.';
    }
  }
  if (!game.started) text += ' The eagle cannot come before your first hop.';
  else {
    const idle = eagleInfo(game).secondsIfIdle;
    if (idle < escapeTime(lag) + 0.5) verdict = 'danger';
    text += idle < 2.5 || useless
      ? ` The eagle strikes in ${sec(idle)} s unless you move forward.`
      : ` You can wait about ${sec(idle)} s before the eagle comes.`;
  }
  return { verdict, text };
}

/** When the next hazard occupies [x-H, x+H] on a road or rail lane: {kind, hit, clear} in seconds from now. */
function occupancy(game, lane, x) {
  if (lane.type === 'road') {
    return lane.objs.map((obj) => ({ kind: obj.kind, ...approachTimes(lane, obj, game.tick, x - H, x + H) }));
  }
  const ts = trainState(lane, game.tick / TICK_RATE);
  const a = x - H;
  const b = x + H;
  const dist = (front) => (lane.dir > 0 ? a - front : front - b); // distance from the train's front to the spot
  const span = (lane.trainLen + 2 * H) / lane.speed;
  const out = [];
  if (ts.passing) {
    const front = lane.dir > 0 ? ts.x1 : ts.x0;
    const tail = lane.dir > 0 ? ts.x0 : ts.x1;
    if (ts.x1 > a && ts.x0 < b) out.push({ kind: 'train', hit: 0, clear: (lane.dir > 0 ? b - tail : tail - a) / lane.speed });
    else if (dist(front) >= 0) out.push({ kind: 'train', hit: dist(front) / lane.speed, clear: dist(front) / lane.speed + span });
  }
  const next = ts.untilNext + dist(-lane.dir * RAIL.edge) / lane.speed;
  out.push({ kind: 'train', hit: next, clear: next + span });
  return out;
}

/** Columns a forward/back hop from a log can land in, across the player's delay range (just plan.toX otherwise). */
function rideColumns(game, st, dir, hopLeft, lag) {
  if (!st.ride || dir === 'left' || dir === 'right') return [game.planHop(dir, st).toX];
  const lane = game.lane(st.row);
  const out = [];
  for (let l = Math.max(0, lag.min - MARGIN); l <= lag.max + MARGIN; l++) {
    const t = game.tick + Math.max(hopLeft, l);
    const plan = game.planHop(dir, { ...st, x: game.objX0(lane, st.ride.i, t) + st.ride.off });
    if (plan.ok) out.push(plan.toX);
  }
  return out.length ? out : [game.planHop(dir, st).toX];
}

/** Waiting on a road or rail lane: is there time to decide again and still hop away before the next hazard? */
function waitSafety(game, lane, x, hopLeft, lag) {
  const first = occupancy(game, lane, x).sort((p, q) => p.hit - q.hit)[0];
  if (!first || first.hit === Infinity) return { verdict: 'safe', text: 'Nothing is coming.' };
  if (first.hit === 0) return { verdict: 'danger', text: `A ${first.kind} is at your spot right now.` };
  if (first.hit < Math.max(hopLeft, lag.max) / TICK_RATE + escapeTime(lag)) {
    return { verdict: 'danger', text: `A ${first.kind} reaches you ${sec(first.hit)} s from now, too soon to hop away after another decision. Leave this lane now.` };
  }
  return { verdict: 'safe', text: `The next ${first.kind} reaches you ${sec(first.hit)} s from now.` };
}

/**
 * Is the spot free from the earliest moment the hop could start until the latest moment the player could have
 * hopped on again? `hopLeft` = ticks until the current hop lands; `lag` = the player's delay range in ticks;
 * `offset` = ticks until the decision is made (0 = now; a later hop for look-ahead).
 */
function hopSafety(game, lane, x, hopLeft, lag, offset = 0) {
  const earliest = Math.max(hopLeft, lag.min) + offset;
  const latest = Math.max(hopLeft, lag.max) + offset;
  const t0 = Math.max(0, earliest - MARGIN) / TICK_RATE;
  const t1 = (latest + HOP_TICKS + Math.max(lag.max, HOP_TICKS) + MARGIN) / TICK_RATE;
  const typical = (Math.max(hopLeft, lag.typical) + offset) / TICK_RATE;
  const when = lag.max ? `when your move lands (about ${sec(typical)} s from now, given your usual delay)` : 'when you hop';
  const occ = occupancy(game, lane, x).sort((p, q) => p.hit - q.hit);
  const blocking = occ.filter((o) => o.hit < t1 && o.clear > t0);
  if (blocking.length) {
    const gone = Math.max(...blocking.map((o) => o.clear));
    return { verdict: 'danger', text: `A ${blocking[0].kind} is at that spot ${when}, so you would be hit. That spot is clear again ${sec(gone)} s from now.` };
  }
  let text = `Nothing is at that spot ${when}`;
  const next = occ.find((o) => o.hit >= t1);
  // A quiet signal reveals nothing about the next train, so neither does this text.
  const signalOff = lane.type === 'rail' && !trainState(lane, game.tick / TICK_RATE).flashing;
  if (signalOff) text += ' (the railway signal is off)';
  else if (next && next.hit !== Infinity) text += `; the next ${next.kind} reaches it ${sec(next.hit)} s from now`;
  return { verdict: 'safe', text: `${text}.` };
}

function riverLanding(game, lane, x, landTick, safeAcrossRange, lag) {
  const spot = game.riverLanding(lane, x, landTick);
  if (lane.pads.length) {
    return spot && safeAcrossRange
      ? { verdict: 'safe', text: `A lily pad is at x=${spot.x}: you land safely.` }
      : { verdict: 'danger', text: `Open water at x=${fx(x)}: you would drown. Lily pads are at x=${lane.pads.join(', ')}.` };
  }
  if (spot && !safeAcrossRange) {
    return { verdict: 'danger', text: 'The end of a log is right at that spot, so depending on your delay you land on it or in open water and drown. Wait for more of the log to be under that spot.' };
  }
  if (spot) {
    const x0 = game.objX0(lane, spot.ride.i, landTick);
    const len = lane.objs[spot.ride.i].len;
    const edge = lane.dir > 0 ? (CARRY_LIMIT - spot.x) / lane.speed : (spot.x + CARRY_LIMIT) / lane.speed;
    const soon = edge < escapeTime(lag) + HOP_TICKS / TICK_RATE;
    return {
      verdict: soon ? 'danger' : 'safe',
      text: `When you land, a log is under you (spanning x=${fx(x0)}..${fx(x0 + len)}); it would carry you off the edge in ${sec(Math.max(0, edge))} s${soon ? ', too soon to hop off again' : ' unless you hop off'}.`,
    };
  }
  let best = Infinity;
  for (const obj of lane.objs) best = Math.min(best, approachTimes(lane, obj, landTick, x - LAND_TOLERANCE, x + LAND_TOLERANCE).hit);
  const fromNow = best + (landTick - game.tick) / TICK_RATE;
  return { verdict: 'danger', text: `When you land there is open water: you would drown. The nearest log is under that spot ${sec(fromNow)} s from now (a hop takes ${sec(HOP_TICKS / TICK_RATE)} s).` };
}
