import { Agent as CloudflareAgent } from 'agents';
import { Agent as PiAgent } from '@earendil-works/pi-agent-core';
import { Type, createModels } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import {
  applyOpenRouterPrivacy,
  resolveAgentPolicy
} from './agent-policy.js';

export { FALLBACK_MODEL, PRIMARY_MODEL } from './agent-policy.js';
const MAX_PROMPT = 2400;
const HISTORY_ROWS = 12;
const MODEL_TIMEOUT_MS = 45_000;
const MODEL_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 5_000;
const MAX_OUTPUT_TOKENS = 1600;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

const textResult = (text, details = {}) => ({ content: [{ type: 'text', text }], details });
const proposalResult = proposal => textResult(
  'Prepared a draft for the person to review. Nothing has been written yet.',
  { proposal }
);

const today = () => new Date().toISOString().slice(0, 10);

function trainingTools(snapshot) {
  return [
    {
      name: 'get_training_snapshot',
      label: 'Review training history',
      description: 'Read the signed-in person’s private workout, food, supplement, habit, and bodyweight records from the last 60 days.',
      parameters: Type.Object({}),
      execute: async () => textResult(JSON.stringify(snapshot), { recordCounts: Object.fromEntries(
        ['sets', 'meals', 'supplements', 'bodyweight', 'habits'].map(key => [key, snapshot[key]?.length || 0])
      ) })
    },
    {
      name: 'propose_set_log',
      label: 'Draft set log',
      description: 'Create a reviewable workout-set draft. This does not save anything until the person taps Apply.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        exerciseId: Type.String({ description: 'Stable exercise id from the training snapshot or programme, such as bench-press' }),
        exerciseName: Type.String(),
        setNumber: Type.Integer({ minimum: 1, maximum: 20 }),
        load: Type.Union([Type.Number({ minimum: 0 }), Type.String({ maxLength: 30 })]),
        reps: Type.Integer({ minimum: 0, maximum: 200 }),
        drops: Type.Optional(Type.Array(Type.Object({
          load: Type.Union([Type.Number({ minimum: 0 }), Type.String({ maxLength: 30 })]),
          reps: Type.Integer({ minimum: 1, maximum: 100 })
        }), { maxItems: 6 }))
      }),
      execute: async (_id, args) => proposalResult({ kind: 'set', ...args })
    },
    {
      name: 'propose_meal_log',
      label: 'Draft meal log',
      description: 'Create a reviewable meal draft. Nutrition numbers must be described as estimates unless they came from a label.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        name: Type.String({ maxLength: 120 }),
        protein: Type.Number({ minimum: 0, maximum: 500 }),
        kcal: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
        estimate: Type.Boolean({ description: 'True unless values came from an exact label or saved food result' })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'meal', ...args })
    },
    {
      name: 'propose_supplement_log',
      label: 'Draft supplement log',
      description: 'Create a reviewable record of a supplement the person says they already took. Never use it to prescribe a supplement.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        name: Type.String({ maxLength: 100 }),
        dose: Type.Number({ exclusiveMinimum: 0, maximum: 10000 }),
        unit: Type.String({ maxLength: 20 })
      }),
      execute: async (_id, args) => proposalResult({ kind: 'supplement', ...args })
    },
    {
      name: 'propose_bodyweight_log',
      label: 'Draft bodyweight log',
      description: 'Create a reviewable bodyweight draft. This does not save until the person taps Apply.',
      parameters: Type.Object({
        date: Type.String({ description: 'YYYY-MM-DD' }),
        value: Type.Number({ minimum: 40, maximum: 1500 }),
        unit: Type.Union([Type.Literal('lb'), Type.Literal('kg')])
      }),
      execute: async (_id, args) => proposalResult({ kind: 'bodyweight', ...args })
    }
  ];
}

function systemPrompt(profile, history) {
  const recent = history.length
    ? history.map(row => `${row.role === 'user' ? 'Person' : 'Coach'}: ${row.text}`).join('\n')
    : '(No earlier conversation.)';
  return `You are Training OS Coach, a concise workout and logging assistant for profile ${profile}.

Use tools when private history is relevant. You may analyze records and prepare structured drafts, but you cannot mutate data. The person must approve every draft in the UI. Never claim that a draft was saved.

This is a weight-first three-day programme. Do not turn it into a calisthenics-only plan. Respect per-set loads, missed reps, assisted reps, and drop segments. If the person reports 6 intended reps plus 4 lighter reps, represent that honestly instead of calling it 10 reps at the first load.

Health boundary: provide general fitness education, not diagnosis or treatment. Do not prescribe medication or supplements. For severe or sudden symptoms, chest pain, trouble breathing, fainting, signs of rhabdomyolysis, or immediate danger, tell them to stop and seek urgent care. For injury, pregnancy, kidney disease, eating-disorder concerns, under-18 users, or medication interactions, recommend a qualified clinician. Do not infer conditions from logs.

Privacy and capability boundary: you can only see the 60-day Training OS snapshot returned by the tool. No Apple Health, wearable, medical record, browser, or MCP health server is connected. Say so if asked.

Today is ${today()}. Keep answers short, specific, plain-text, and easy to use during a workout. Do not use Markdown symbols. Ask one focused question when essential details are missing.

Recent conversation:
${recent}`;
}

const assistantText = messages => {
  const message = [...messages].toReversed().find(item => item?.role === 'assistant');
  return (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('').trim();
};

/** One private Cloudflare Agent instance is selected by the Access-verified email. */
export class TrainingAgent extends CloudflareAgent {
  async onStart() {
    void this.sql`CREATE TABLE IF NOT EXISTS training_credentials (
      provider TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      updated TEXT NOT NULL
    )`;
    void this.sql`CREATE TABLE IF NOT EXISTS training_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created TEXT NOT NULL
    )`;
  }

  #storedKey() {
    return this.sql`SELECT secret FROM training_credentials WHERE provider = 'openrouter' LIMIT 1`[0]?.secret || null;
  }

  #history() {
    return [...this.sql`SELECT role, text FROM training_messages ORDER BY id DESC LIMIT ${HISTORY_ROWS}`].toReversed();
  }

  #remember(role, text) {
    const clipped = String(text).slice(0, 8000);
    void this.sql`INSERT INTO training_messages (role, text, created) VALUES (${role}, ${clipped}, ${new Date().toISOString()})`;
    void this.sql`DELETE FROM training_messages WHERE id NOT IN (SELECT id FROM training_messages ORDER BY id DESC LIMIT 40)`;
  }

  async #connect(body) {
    const code = String(body?.code || '');
    const verifier = String(body?.verifier || '');
    if (!code || code.length > 1000 || verifier.length < 43 || verifier.length > 128) {
      return json({ error: 'invalid_oauth_response' }, 400);
    }
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.key) {
      console.warn('openrouter oauth exchange failed', response.status);
      return json({ error: 'openrouter_connect_failed' }, 502);
    }
    void this.sql`INSERT INTO training_credentials (provider, secret, updated)
      VALUES ('openrouter', ${result.key}, ${new Date().toISOString()})
      ON CONFLICT(provider) DO UPDATE SET secret = excluded.secret, updated = excluded.updated`;
    const policy = resolveAgentPolicy(this.env);
    return json({
      connected: true,
      source: 'personal',
      model: policy.primaryModel,
      fallback: policy.fallbackModel,
      privacy: { dataCollection: 'deny', zeroDataRetention: policy.requireZdr }
    });
  }

  async #runModel({ modelId, key, prompt, profile, snapshot, send, requireZdr }) {
    const models = createModels();
    models.setProvider(openrouterProvider());
    const model = models.getModel('openrouter', modelId);
    if (!model) throw new Error(`OpenRouter model is unavailable: ${modelId}`);

    const pi = new PiAgent({
      initialState: {
        systemPrompt: systemPrompt(profile, this.#history()),
        model,
        thinkingLevel: 'low',
        tools: trainingTools(snapshot),
        messages: []
      },
      streamFn: (activeModel, context, options = {}) => models.streamSimple(activeModel, context, {
        ...options,
        apiKey: key,
        timeoutMs: MODEL_TIMEOUT_MS,
        maxRetries: MODEL_RETRIES,
        maxRetryDelayMs: MAX_RETRY_DELAY_MS,
        maxTokens: MAX_OUTPUT_TOKENS,
        onPayload: payload => applyOpenRouterPrivacy(payload, requireZdr),
        headers: {
          ...options.headers,
          'HTTP-Referer': 'https://jt-lupe-workout.jt-lupe-workout-cloud.workers.dev/',
          'X-Title': 'JT + Lupe Training OS'
        }
      }),
      toolExecution: 'sequential',
      sessionId: this.name
    });

    pi.subscribe(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        send('delta', { text: event.assistantMessageEvent.delta });
      } else if (event.type === 'tool_execution_start') {
        send('tool', { name: event.toolName });
      } else if (event.type === 'tool_execution_end' && !event.isError && event.result?.details?.proposal) {
        send('proposal', event.result.details.proposal);
      }
    });

    await pi.prompt(prompt);
    const answer = assistantText(pi.state.messages);
    if (pi.state.errorMessage || !answer) throw new Error(pi.state.errorMessage || 'The model returned no answer.');
    return { answer, model: modelId };
  }

  #chat(body) {
    const prompt = String(body?.prompt || '').trim();
    const profile = body?.profile === 'jt' ? 'jt' : body?.profile === 'lupe' ? 'lupe' : null;
    const snapshot = body?.snapshot;
    const key = this.env.OPENROUTER_API_KEY || this.#storedKey();
    const policy = resolveAgentPolicy(this.env);
    if (!key) return json({ error: 'openrouter_not_connected' }, 409);
    if (!prompt || prompt.length > MAX_PROMPT || !profile || snapshot?.profile !== profile) {
      return json({ error: 'invalid_agent_request' }, 400);
    }

    const encoder = new TextEncoder();
    let controller;
    const stream = new ReadableStream({ start(value) { controller = value; } });
    const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    (async () => {
      try {
        send('meta', {
          model: policy.primaryModel,
          provider: 'OpenRouter',
          framework: 'Pi',
          privacy: { dataCollection: 'deny', zeroDataRetention: policy.requireZdr }
        });
        let result;
        let primaryEmitted = false;
        const primarySend = (event, data) => {
          primaryEmitted = true;
          send(event, data);
        };
        try {
          result = await this.#runModel({
            modelId: policy.primaryModel,
            key,
            prompt,
            profile,
            snapshot,
            send: primarySend,
            requireZdr: policy.requireZdr
          });
        } catch (primaryError) {
          if (!policy.fallbackModel || primaryEmitted) throw primaryError;
          console.warn('OpenRouter primary failed before output; using configured fallback', String(primaryError));
          send('status', { text: 'Primary model unavailable. Switching to the fallback.' });
          result = await this.#runModel({
            modelId: policy.fallbackModel,
            key,
            prompt,
            profile,
            snapshot,
            send,
            requireZdr: policy.requireZdr
          });
        }
        this.#remember('user', prompt);
        this.#remember('assistant', result.answer);
        send('done', result);
      } catch (error) {
        console.error('training agent chat failed', error);
        send('error', { error: 'agent_failed', message: 'The coach could not answer right now. Your logs were not changed.' });
      } finally {
        controller.close();
      }
    })();

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      }
    });
  }

  async onRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === '/status' && request.method === 'GET') {
      const policy = resolveAgentPolicy(this.env);
      const source = this.env.OPENROUTER_API_KEY ? 'workspace' : this.#storedKey() ? 'personal' : null;
      return json({
        connected: Boolean(source),
        source,
        model: policy.primaryModel,
        fallback: policy.fallbackModel,
        privacy: { dataCollection: 'deny', zeroDataRetention: policy.requireZdr }
      });
    }
    if (url.pathname === '/connect' && request.method === 'POST') {
      return this.#connect(await request.json().catch(() => null));
    }
    if (url.pathname === '/disconnect' && request.method === 'POST') {
      void this.sql`DELETE FROM training_credentials WHERE provider = 'openrouter'`;
      return json({ connected: Boolean(this.env.OPENROUTER_API_KEY), source: this.env.OPENROUTER_API_KEY ? 'workspace' : null });
    }
    if (url.pathname === '/reset' && request.method === 'POST') {
      void this.sql`DELETE FROM training_messages`;
      return json({ reset: true });
    }
    if (url.pathname === '/chat' && request.method === 'POST') {
      return this.#chat(await request.json().catch(() => null));
    }
    return json({ error: 'not_found' }, 404);
  }
}
