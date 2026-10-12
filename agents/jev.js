// Jev (TypeSafe `jev-latest`) as a Crossy Road player. Same request shape as jev-use: a JSON `state` plus one
// `choice` question whose options are the five actions, each described by what it would do right now.

import { RULES, DECISION, RAW_CRITERIA } from './rules.js';
import { ACTIONS } from '../core/config.js';

const ENDPOINT = process.env.TYPESAFE_API_URL ?? 'https://api.typesafe.ai/v1/systemone';

export function createJevAgent({ model = 'jev-latest', apiKey = process.env.TYPESAFE_API_KEY, url = ENDPOINT, timeoutMs = 10000 } = {}) {
  if (!apiKey) throw new Error('Set TYPESAFE_API_KEY to use the Jev agent.');
  return {
    name: 'jev',
    model,
    async decide(obs) {
      const { moves, ...state } = obs;
      const body = {
        model,
        state: { goal: 'Advance the chicken as far forward as possible without dying.', ...state },
        questions: {
          move: { type: 'choice', instructions: `${RULES}\n${DECISION}`, criteria: moves ?? RAW_CRITERIA },
        },
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 400).replaceAll(apiKey, '[redacted]');
        const err = new Error(`TypeSafe HTTP ${res.status}: ${text}`);
        err.fatal = [400, 401, 402, 403, 404].includes(res.status);
        throw err;
      }
      const data = await res.json();
      const answer = data.answers?.move;
      if (answer?.type !== 'choice' || !ACTIONS.includes(answer.choice)) {
        throw new Error(`Unexpected Jev answer: ${JSON.stringify(data).slice(0, 300)}`);
      }
      return { move: answer.choice, meta: { confidence: answer.confidence, probabilities: answer.probabilities } };
    },
  };
}
