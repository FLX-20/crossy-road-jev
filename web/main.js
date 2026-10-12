// Browser entry: menu, human play, and watching Jev play a live session on the server.
// Both modes drive the same deterministic Game; only the source of inputs differs.

import { Game } from '/core/game.js';
import { TICK_RATE } from '/core/config.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { SessionFeed } from './net.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / TICK_RATE;
const WATCH_DELAY = 12; // ticks the replica trails the server, so inputs arrive before they are needed
const CAUSES = {
  car: 'Hit by a car', truck: 'Hit by a truck', train: 'Hit by a train', water: 'Fell in the water',
  carried: 'Carried off by a log', eagle: 'Taken by the eagle', timeout: 'Time limit reached',
  'agent-error': 'Agent error',
};
const AGENT_LABEL = { jev: 'JEV' };

const renderer = new Renderer($('game'));
const hud = new Hud();
const sfx = new Sfx();
const params = new URLSearchParams(location.search);

let mode = 'menu'; // menu | play | watch
let game = null;
let actions = []; // human inputs [{tick, move}] for the current play
let acc = 0;
let paused = false;
let feed = null;
let deathAt = null;
let overShown = false;
let lastBell = 0;
let last = performance.now();
let top = 0;
try {
  top = Number(localStorage.getItem('crossy-top')) || 0;
} catch { /* storage unavailable */ }

const randomSeed = () => Math.floor(Math.random() * 1e6);
const show = (id, on) => $(id).classList.toggle('hidden', !on);

function newGame(seed) {
  game = new Game({ seed });
  actions = [];
  acc = 0;
  deathAt = null;
  overShown = false;
  renderer.setGame(game);
  show('gameover', false);
}

function setUrl(query) {
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

// ---- modes ----

function toMenu() {
  feed?.close();
  feed = null;
  mode = 'menu';
  paused = false;
  setUrl('');
  newGame(randomSeed());
  hud.badge(null);
  show('pause', false);
  show('menu', true);
}

function startPlay() {
  // The menu's background world becomes the play world, unless it has been used already.
  if (!game || game.started || mode !== 'menu') newGame(randomSeed());
  mode = 'play';
  paused = false;
  show('menu', false);
  hud.badge(null);
}

async function startWatchJev() {
  sfx.unlock();
  show('menu-error', false);
  let res;
  let body;
  try {
    res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'jev' }),
    });
    body = await res.json();
  } catch (err) {
    res = { ok: false };
    body = { error: `Could not reach the server: ${err.message}` };
  }
  if (!res.ok) {
    if (mode !== 'menu') toMenu();
    $('menu-error').textContent = body.error;
    show('menu-error', true);
    return;
  }
  startWatch(body.id);
}

function startWatch(id) {
  feed?.close();
  feed = new SessionFeed(id);
  feed.next = 0;
  mode = 'watch';
  game = null;
  setUrl(`watch=${encodeURIComponent(id)}`);
  show('menu', false);
  show('gameover', false);
  hud.badge('Connecting…');
}

// ---- input ----

function hop(dir) {
  sfx.unlock();
  if (mode === 'menu' && !$('menu').classList.contains('hidden')) startPlay();
  if (mode !== 'play' || paused || !game.alive) return;
  const result = game.queueMove(dir);
  if (result !== 'ignored' && result !== 'dead') actions.push({ tick: game.tick, move: dir });
}

new Input($('game'), {
  onMove: hop,
  onCharge: (on) => { renderer.player.charging = on && mode === 'play' && !paused; },
  onKey: (e) => {
    if (e.code === 'KeyM') sfx.toggleMute();
    else if (e.code === 'Escape' && mode === 'play' && game.alive) {
      paused = !paused;
      show('pause', paused);
    } else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (overShown) $('again-btn').click();
      else if (mode === 'menu') startPlay();
    }
  },
});

$('play-btn').addEventListener('click', () => { sfx.unlock(); startPlay(); });
$('watch-btn').addEventListener('click', startWatchJev);
$('menu-btn').addEventListener('click', toMenu);
$('again-btn').addEventListener('click', () => {
  if (mode === 'play') newGame(randomSeed());
  else if (mode === 'watch') startWatchJev();
});

// ---- game over ----

function showGameOver() {
  overShown = true;
  const cause = CAUSES[game.death?.cause] ?? (feed?.end?.endReason ? CAUSES[feed.end.endReason] : 'Run ended');
  let title = 'GAME OVER';
  let detail = `Score ${game.score} · Coins ${game.coins} · ${cause} · seed ${game.seed}`;
  let again = 'PLAY AGAIN';
  if (mode === 'watch') {
    title = `${AGENT_LABEL[feed.info?.agent] ?? 'AGENT'} SCORED ${game.score}`;
    detail = [feed.info?.model, cause, `seed ${game.seed}`].filter(Boolean).join(' · ');
    again = 'WATCH AGAIN';
  }
  $('go-title').textContent = title;
  $('go-detail').textContent = detail;
  $('again-btn').textContent = again;
  show('gameover', true);
  if (mode === 'play' && game.score > top) {
    top = game.score;
    try {
      localStorage.setItem('crossy-top', String(top));
    } catch { /* storage unavailable */ }
  }
}

// ---- per-mode stepping ----

function stepLocal(dt) {
  if (paused) return acc / STEP;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 12) {
    game.step();
    acc -= STEP;
    n++;
  }
  if (n === 12) acc = 0;
  return acc / STEP;
}

function stepFeed(now) {
  const f = feed;
  if (!f.info) return 0;
  if (!game || game.seed !== f.info.seed) newGame(f.info.seed);
  const est = f.serverTick(now) - WATCH_DELAY;
  const target = f.ended ? f.safeTick : Math.min(f.safeTick, Math.floor(est));
  let n = 0;
  while (game.tick < target && n < 5000) {
    while (f.next < f.actions.length && f.actions[f.next].tick <= game.tick) game.queueMove(f.actions[f.next++].move);
    game.step();
    n++;
    const expected = f.checks.get(game.tick);
    if (expected !== undefined && expected !== game.checksum()) {
      f.desync = true;
      console.warn(`Replica diverged from the server at tick ${game.tick}.`);
    }
  }
  if (f.ended && game.tick >= f.safeTick) {
    // Inputs at the final tick were applied on the server too.
    while (f.next < f.actions.length && f.actions[f.next].tick <= game.tick) game.queueMove(f.actions[f.next++].move);
  }
  if (n > 10) game.events.length = 0; // fast-forward on join: skip the burst of sounds
  const d = f.decision;
  const label = `${AGENT_LABEL[f.info.agent] ?? f.info.agent}${f.info.model ? ` ${f.info.model}` : ''} · seed ${f.info.seed}`;
  const latest = d ? (d.error ? ` · error: ${d.error}` : ` · ${d.move} ${d.latencyMs} ms${d.confidence != null ? ` · conf ${d.confidence.toFixed(2)}` : ''}`) : '';
  hud.badge(`${label}${latest}${f.error ? ` · ${f.error}` : ''}${f.desync ? ' · DESYNC' : ''}`);
  if (f.ended && game.tick >= f.safeTick && game.alive && !overShown && deathAt == null) deathAt = now;
  return f.ended ? 0 : Math.max(0, Math.min(1, est - game.tick));
}

function playEvent(e) {
  if (e.type === 'hop') sfx.hop();
  else if (e.type === 'blocked') sfx.blocked();
  else if (e.type === 'coin') sfx.coin();
  else if (e.type === 'death') {
    if (e.cause === 'car' || e.cause === 'truck') sfx.squash();
    else if (e.cause === 'train') sfx.train();
    else if (e.cause === 'eagle') sfx.eagle();
    else sfx.splash();
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let alpha = 0;
  if (mode === 'menu' || mode === 'play') alpha = stepLocal(dt);
  else if (mode === 'watch') alpha = stepFeed(now);

  if (game) {
    for (const e of game.drainEvents()) {
      renderer.player.onEvent(e, now);
      playEvent(e);
    }
    renderer.render(alpha, dt, now);
    hud.update(game.score, mode === 'play' || mode === 'menu' ? Math.max(top, game.score) : game.score, game.coins);
    if (game.alive && mode !== 'menu' && renderer.flashingNear(game.player.row) && now - lastBell > 330) {
      lastBell = now;
      sfx.bell();
    }
    if (!game.alive && deathAt == null) deathAt = now;
    if (deathAt != null && !overShown && now - deathAt > 1300 && mode !== 'menu') showGameOver();
  }
  requestAnimationFrame(frame);
}

// ---- boot ----

// Read-only handle for debugging and browser automation.
window.crossy = { get game() { return game; }, get mode() { return mode; }, get actions() { return actions; } };

if (params.get('watch')) startWatch(params.get('watch'));
else toMenu();
requestAnimationFrame(frame);
