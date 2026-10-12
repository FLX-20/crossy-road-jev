import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// A stand-in for the TypeSafe API: answers "up" twice (rows 1-2 are always grass), then rejects the key, which ends the session.
let jevRequests = [];
const jevMock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  jevRequests.push({ headers: req.headers, body: JSON.parse(raw) });
  await new Promise((r) => setTimeout(r, 60));
  const ok = jevRequests.length <= 2;
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(ok ? { answers: { move: { type: 'choice', choice: 'up', confidence: 0.9 } } } : { error: { message: 'bad key' } }));
});
await new Promise((r) => jevMock.listen(0, '127.0.0.1', r));
process.env.TYPESAFE_API_URL = `http://127.0.0.1:${jevMock.address().port}/v1/systemone`;
process.env.TYPESAFE_API_KEY = 'test-key';
const { startServer } = await import('../server/server.js'); // after the env, so the Jev adapter uses the mock

let server;
let base;
before(async () => {
  server = await startServer({ port: 0 });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  server.closeAllConnections();
  jevMock.close();
  jevMock.closeAllConnections();
});

const post = async (path) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return { status: res.status, body: await res.json() };
};

/** Read a Server-Sent Events stream to its end; returns [{type, data}]. */
async function readEvents(url) {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  let text = '';
  for await (const chunk of res.body) text += new TextDecoder().decode(chunk);
  return text.split('\n\n').filter(Boolean).map((block) => {
    const [, type] = block.match(/^event: (.+)$/m);
    const [, data] = block.match(/^data: (.+)$/m);
    return { type, data: JSON.parse(data) };
  });
}

test('Watch Jev: a session is played by Jev and streamed to the browser until it ends', async () => {
  jevRequests = [];
  const created = await post('/api/sessions');
  assert.equal(created.status, 201);
  assert.equal(created.body.agent, 'jev');
  assert.equal(created.body.model, 'jev-latest');
  assert.ok(Number.isInteger(created.body.seed));

  const events = await readEvents(`${base}/api/sessions/${created.body.id}/events`);
  assert.equal(events[0].type, 'hello');
  assert.equal(events[0].data.seed, created.body.seed);
  const end = events.find((e) => e.type === 'end');
  assert.equal(end.data.endReason, 'agent-error', 'the rejected key ends the session');
  const moves = [...events[0].data.actions, ...events.filter((e) => e.type === 'action').map((e) => e.data)];
  assert.ok(moves.length >= 1 && moves.every((a) => a.move === 'up'));

  assert.equal(jevRequests.length, 3);
  assert.equal(jevRequests[0].headers.authorization, 'Bearer test-key');
  assert.equal(jevRequests[0].body.model, 'jev-latest');
});

test('Watch Jev without a key is refused with a readable error', async () => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const { status, body } = await post('/api/sessions');
    assert.equal(status, 400);
    assert.match(body.error, /TYPESAFE_API_KEY/);
  } finally {
    process.env.TYPESAFE_API_KEY = saved;
  }
});

test('unknown sessions and routes are 404', async () => {
  assert.equal((await fetch(`${base}/api/sessions/nope/events`)).status, 404);
  assert.equal((await fetch(`${base}/api/results`)).status, 404);
});

test('static files and the vendored three.js are served; paths cannot escape', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/core/game.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/three/three.module.js`)).status, 200);
  assert.equal((await fetch(`${base}/core/..%2F..%2Fpackage.json`)).status, 404);
});
