// HTTP server: serves the game, hosts realtime sessions in which Jev plays, and streams them to browser
// viewers over Server-Sent Events. No framework, localhost only.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.js';
import { createJevAgent } from '../agents/jev.js';
import { runAgent } from '../agents/runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = {
  '/web/': path.join(ROOT, 'web'),
  '/core/': path.join(ROOT, 'core'),
  '/vendor/three/': path.join(ROOT, 'node_modules', 'three', 'build'),
  '/vendor/three-addons/': path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Live sessions, kept for 30 minutes after they end so a reloaded page can still show the run. */
const sessions = new Map();

function registerSession(session) {
  sessions.set(session.id, session);
  session.once('end', () => setTimeout(() => sessions.delete(session.id), 30 * 60 * 1000).unref());
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, urlPath) {
  let file = null;
  if (urlPath === '/' || urlPath === '/index.html') file = path.join(ROOT, 'web', 'index.html');
  for (const [prefix, dir] of Object.entries(STATIC)) {
    if (urlPath.startsWith(prefix)) {
      const candidate = path.resolve(dir, '.' + decodeURIComponent(urlPath.slice(prefix.length - 1)));
      if (candidate.startsWith(dir + path.sep)) file = candidate;
    }
  }
  if (!file) return sendJson(res, 404, { error: 'Not found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function sessionInfo(s) {
  return { id: s.id, seed: s.seed, agent: s.agent, model: s.model, ended: s.ended, tick: s.game.tick, score: s.game.score, createdAt: s.createdAt };
}

function streamSession(req, res, s) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  s.pump();
  send('hello', { ...sessionInfo(s), actions: s.actions, result: s.result ? { score: s.result.score, endTick: s.result.endTick } : null });
  if (s.ended) return res.end();
  const onAction = (d) => send('action', d);
  const onTick = (d) => send('tick', d);
  const onStart = (d) => send('start', d);
  const onDecision = (d) => send('decision', d);
  const onEnd = (r) => { send('end', { score: r.score, endTick: r.endTick, deathCause: r.deathCause, endReason: r.endReason }); res.end(); };
  s.on('action', onAction);
  s.on('tick', onTick);
  s.on('start', onStart);
  s.on('decision', onDecision);
  s.once('end', onEnd);
  req.on('close', () => {
    s.off('action', onAction);
    s.off('tick', onTick);
    s.off('start', onStart);
    s.off('decision', onDecision);
    s.off('end', onEnd);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (parts[1] === 'sessions' && parts.length === 2 && method === 'POST') {
    let agent;
    try {
      agent = createJevAgent();
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const session = new Session({ seed: Math.floor(Math.random() * 1e6), agent: agent.name, model: agent.model });
    registerSession(session);
    session.start();
    runAgent(session, agent, { log: console.log })
      .then((result) => console.log(`[${session.id}] jev finished: score ${result.score}, ${result.endReason}`))
      .catch((err) => console.error(`[${session.id}]`, err));
    return sendJson(res, 201, sessionInfo(session));
  }

  if (parts[1] === 'sessions' && parts.length === 4 && parts[3] === 'events' && method === 'GET') {
    const s = sessions.get(parts[2]);
    if (!s) return sendJson(res, 404, { error: 'No such session.' });
    return streamSession(req, res, s);
  }
  return sendJson(res, 404, { error: 'Unknown API route.' });
}

export function startServer({ port = Number(process.env.PORT) || 3000, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET') await serveStatic(res, url.pathname);
      else sendJson(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer();
  const { port } = server.address();
  console.log(`Crossy Road running at http://localhost:${port}`);
  console.log(process.env.TYPESAFE_API_KEY ? 'Jev: API key set.' : 'Jev: no API key. Put TYPESAFE_API_KEY in .env to use "Watch Jev".');
}
