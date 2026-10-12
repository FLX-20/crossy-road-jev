import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Game } from '../core/game.js';
import { observe } from '../core/observe.js';
import { ACTIONS } from '../core/config.js';
import { createJevAgent } from '../agents/jev.js';
import { runAgent } from '../agents/runner.js';
import { Session } from '../server/session.js';

/** A one-route JSON server that records requests and answers with `reply(body)`. */
async function mockServer(reply) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, headers: req.headers, body });
    const [status, payload] = reply(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

function sampleObservation() {
  const g = new Game({ seed: 5 });
  for (let i = 0; i < 20; i++) g.step();
  return observe(g);
}

test('Jev adapter sends the jev-use request shape and reads the choice', async () => {
  const mock = await mockServer(() => [200, { answers: { move: { type: 'choice', choice: 'up', confidence: 0.91, probabilities: { up: 0.91, wait: 0.09 } } } }]);
  try {
    const agent = createJevAgent({ apiKey: 'test-key', url: `${mock.url}/v1/systemone` });
    const decision = await agent.decide(sampleObservation());
    assert.deepEqual(decision, { move: 'up', meta: { confidence: 0.91, probabilities: { up: 0.91, wait: 0.09 } } });
    const { headers, body } = mock.requests[0];
    assert.equal(headers.authorization, 'Bearer test-key');
    assert.equal(body.model, 'jev-latest');
    assert.equal(body.questions.move.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.move.criteria).sort(), [...ACTIONS].sort());
    assert.equal(body.state.moves, undefined, 'move descriptions are criteria, not state');
    assert.ok(Array.isArray(body.state.lanes) && Array.isArray(body.state.map));
  } finally {
    mock.close();
  }
});

test('Jev adapter marks auth errors fatal and redacts the key', async () => {
  assert.throws(() => createJevAgent({ apiKey: '' }), /TYPESAFE_API_KEY/);
  const mock = await mockServer(() => [401, { error: { message: 'bad key test-key' } }]);
  try {
    const agent = createJevAgent({ apiKey: 'test-key', url: mock.url });
    await assert.rejects(agent.decide(sampleObservation()), (err) => err.fatal === true && !err.message.includes('test-key'));
  } finally {
    mock.close();
  }
});

test('runner plays a realtime session to the end, and the result replays', async () => {
  const script = ['up', 'up', 'left', 'up', 'right', 'up', 'up'];
  let i = 0;
  const agent = {
    name: 'scripted',
    async decide() {
      await new Promise((r) => setTimeout(r, 40));
      return { move: script[i++ % script.length], meta: {} };
    },
  };
  const session = new Session({ seed: 9, agent: 'scripted', maxSeconds: 4 }).start();
  const result = await runAgent(session, agent);
  assert.ok(result.decisions > 10);
  assert.equal(result.verified, true);
  assert.ok(result.latencyMs.p50 >= 40);
  assert.ok(result.decisionLog.every((d) => d.appliedTick >= d.observedTick));
});

test('a fatal agent error ends the session instead of retrying forever', async () => {
  const agent = { name: 'broken', async decide() { const e = new Error('401'); e.fatal = true; throw e; } };
  const session = new Session({ seed: 1, maxSeconds: 5 }).start();
  const result = await runAgent(session, agent);
  assert.equal(result.endReason, 'agent-error');
  assert.equal(result.errors, 1);
});
