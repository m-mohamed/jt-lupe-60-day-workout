import { Agent as CloudflareAgent } from 'agents';
import { Agent as PiAgent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { initializeAgentSchema } from './agent-schema.js';
import {
  applyOpenRouterPrivacy,
  classifyAgentFailure,
  resolveAgentPolicy
} from './agent-policy.js';
import { searchFoodCatalog } from './food-catalog.js';
import { PROPOSAL_TYPES, UI_ACTION_TYPES, trainingTools } from './training-tools.js';
import { normalizeUiContext, uiContextInstruction } from './agent-context.js';

export { PRIMARY_MODEL } from './agent-policy.js';
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

const today = () => new Date().toISOString().slice(0, 10);

function systemPrompt(profile, history, uiContext) {
  const recent = history.length
    ? history.map(row => `${row.role === 'user' ? 'Person' : 'Coach'}: ${row.text}`).join('\n')
    : '(No earlier conversation.)';
  return `You are Training OS Coach, a concise workout and logging assistant for profile ${profile}.

Use tools when private history is relevant. You may analyze records and prepare structured drafts, but you cannot mutate data. The person must approve every draft in the UI. Never claim that a draft was saved. You can draft sets, meals, supplements already taken, bodyweight, daily checks, and removals of an existing set, meal, or supplement. For removal, use the exact record identifiers from the snapshot and name the record clearly. Search the shared food catalog before inventing nutrition values; Whole Foods Hot Bar results are estimates and must remain labelled that way. When the person asks to open, show, or take them to a Training OS view, use the navigation tool. Use the interface-control tool for the timer, food search, session import, exports, backup, restore, theme, or installation. These tools drive the visible interface but do not bypass approval or browser confirmation boundaries.

This is a weight-first three-day programme. The official 60-day block runs from Monday 2026-08-31 through Thursday 2026-10-29, with lifting on Monday, Wednesday, and Friday. Before the start, treat future sessions as planning unless the person explicitly says the work was performed. Do not turn it into a calisthenics-only plan. Respect per-set loads, missed reps, assisted reps, and drop segments. If the person reports 6 intended reps plus 4 lighter reps, represent that honestly instead of calling it 10 reps at the first load.

Health boundary: provide general fitness education, not diagnosis or treatment. Do not prescribe medication or supplements. For severe or sudden symptoms, chest pain, trouble breathing, fainting, signs of rhabdomyolysis, or immediate danger, tell them to stop and seek urgent care. For injury, pregnancy, kidney disease, eating-disorder concerns, under-18 users, or medication interactions, recommend a qualified clinician. Do not infer conditions from logs.

Privacy and capability boundary: you can only see the 60-day Training OS snapshot returned by the tool. No Apple Health, wearable, medical record, browser, or MCP health server is connected. Say so if asked.

${uiContextInstruction(uiContext)} Treat words such as “this,” “here,” and “this day” as referring to that interface context. The context identifies where the person was working; it does not prove that any record exists.

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
    initializeAgentSchema(this);
  }

  #history() {
    return [...this.sql`SELECT role, text FROM training_messages ORDER BY id DESC LIMIT ${HISTORY_ROWS}`].toReversed();
  }

  #remember(role, text) {
    const clipped = String(text).slice(0, 8000);
    void this.sql`INSERT INTO training_messages (role, text, created) VALUES (${role}, ${clipped}, ${new Date().toISOString()})`;
    void this.sql`DELETE FROM training_messages WHERE id NOT IN (SELECT id FROM training_messages ORDER BY id DESC LIMIT 40)`;
  }

  async #runModel({ modelId, key, prompt, profile, snapshot, uiContext, send, requireZdr }) {
    const models = createModels();
    models.setProvider(openrouterProvider());
    const model = models.getModel('openrouter', modelId);
    if (!model) throw new Error(`OpenRouter model is unavailable: ${modelId}`);

    const pi = new PiAgent({
      initialState: {
        systemPrompt: systemPrompt(profile, this.#history(), uiContext),
        model,
        thinkingLevel: 'low',
        tools: trainingTools(snapshot, {
          searchFood: async query => (await searchFoodCatalog(query, this.env, this.ctx)).body
        }),
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
      } else if (event.type === 'tool_execution_end' && !event.isError && event.result?.details?.uiAction) {
        send('ui_action', event.result.details.uiAction);
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
    const uiContext = normalizeUiContext(body?.uiContext, snapshot?.through || today());
    const key = this.env.OPENROUTER_API_KEY;
    const policy = resolveAgentPolicy(this.env);
    if (!key) return json({ error: 'coach_unavailable' }, 503);
    if (!prompt || prompt.length > MAX_PROMPT || !profile || snapshot?.profile !== profile) {
      return json({ error: 'invalid_agent_request' }, 400);
    }

    const encoder = new TextEncoder();
    let controller;
    const stream = new ReadableStream({ start(value) { controller = value; } });
    const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    const completion = (async () => {
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
            uiContext,
            send: primarySend,
            requireZdr: policy.requireZdr
          });
        } catch (primaryError) {
          if (!policy.fallbackModel || primaryEmitted) throw primaryError;
          console.warn({ event: 'openrouter_primary_failed', fallback: policy.fallbackModel,
            error: primaryError instanceof Error ? { name: primaryError.name, message: primaryError.message } : String(primaryError) });
          send('status', { text: 'Primary model unavailable. Switching to the fallback.' });
          result = await this.#runModel({
            modelId: policy.fallbackModel,
            key,
            prompt,
            profile,
            snapshot,
            uiContext,
            send,
            requireZdr: policy.requireZdr
          });
        }
        this.#remember('user', prompt);
        this.#remember('assistant', result.answer);
        send('done', result);
      } catch (error) {
        console.error({ event: 'training_agent_chat_failed',
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error) });
        send('error', classifyAgentFailure(error));
      } finally {
        controller.close();
      }
    })();
    this.ctx.waitUntil(completion);

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
      const source = this.env.OPENROUTER_API_KEY ? 'workspace' : null;
      return json({
        connected: Boolean(source),
        source,
        requiresUserConnection: false,
        model: policy.primaryModel,
        fallback: policy.fallbackModel,
        capabilities: {
          proposalTypes: PROPOSAL_TYPES,
          uiActionTypes: UI_ACTION_TYPES,
          readTools: ['training_snapshot', 'food_catalog']
        },
        privacy: { dataCollection: 'deny', zeroDataRetention: policy.requireZdr }
      });
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
