import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../errors.js';
import { sanitizeUserQuery } from '../sanitizer.js';
import { EXPLANATION_RESPONSE_SCHEMA, STAGE_A_PROMPT, STAGE_B_PROMPT } from '../prompts/index.js';
import type { AiSafeExplanationContext, AiSafeToolResult, ToolTurnRequest } from '../types.js';
import { CloudflareWorkersAiProvider, DEFAULT_CLOUDFLARE_MODEL } from './cloudflare.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'a-token-that-must-not-appear-anywhere';

interface Captured {
  url: string;
  init: RequestInit;
  /** The request body as sent; the provider always sends a JSON string. */
  body: string;
}

/** A fetch that records what it was sent and answers as told. The real service is never called. */
function fakeFetch(answer: () => Response | Promise<Response>): {
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: typeof init.body === 'string' ? init.body : '' });
      return answer();
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sentBody = (call: Captured | undefined): Record<string, unknown> =>
  JSON.parse(call?.body ?? '') as Record<string, unknown>;

const toolRequest = (overrides: Partial<ToolTurnRequest> = {}): ToolTurnRequest => ({
  systemInstruction: STAGE_A_PROMPT.systemInstruction,
  promptTemplateId: STAGE_A_PROMPT.id,
  promptVersion: STAGE_A_PROMPT.version,
  query: sanitizeUserQuery('is dental covered'),
  tools: [
    {
      name: 'get_available_balance',
      description: 'balance',
      parameters: { type: 'object', properties: {} },
    },
  ],
  exchanges: [],
  ...overrides,
});

const context = {
  treatmentCategory: 'DENTAL',
  expenseAmountCents: 30_000,
  serviceDate: '2026-05-04',
  outcome: 'ELIGIBLE',
  coveredAmountCents: 30_000,
  availableBalanceCents: 200_000,
  remainingCategoryLimitCents: 50_000,
  conditions: [],
  reasons: [],
  engineVersion: '1.0.0',
} as unknown as AiSafeExplanationContext;

const structuredRequest = {
  systemInstruction: STAGE_B_PROMPT.systemInstruction,
  promptTemplateId: STAGE_B_PROMPT.id,
  promptVersion: STAGE_B_PROMPT.version,
  context,
  responseSchema: EXPLANATION_RESPONSE_SCHEMA,
};

describe('the Cloudflare Workers AI provider', () => {
  it('names itself and a model, and keeps the token out of both', () => {
    const provider = new CloudflareWorkersAiProvider(ACCOUNT, TOKEN);
    expect(provider.name).toBe('cloudflare-workers-ai');
    expect(provider.model).toBe(DEFAULT_CLOUDFLARE_MODEL);
    expect(provider.available).toBe(true);
    expect(JSON.stringify({ name: provider.name, model: provider.model })).not.toContain('a-token');
  });

  it('uses a configured model instead of the default', () => {
    expect(new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, { model: '@cf/x/y' }).model).toBe(
      '@cf/x/y',
    );
  });

  it('refuses an account id that is not one, without repeating it', () => {
    expect(() => new CloudflareWorkersAiProvider('../../elsewhere', TOKEN)).toThrow(
      /32 hexadecimal/,
    );
    expect(() => new CloudflareWorkersAiProvider('../../elsewhere', TOKEN)).not.toThrow(
      /elsewhere/,
    );
  });

  it('posts to the account endpoint with the token as a bearer credential', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ choices: [{ message: { content: 'hello' } }] }),
    );
    await new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, { fetchImpl }).generateWithTools(
      toolRequest(),
    );

    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`,
    );
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${TOKEN}`,
    );
    // The token travels in the header only, never in what the model reads.
    expect(calls[0]?.body).not.toContain(TOKEN);
  });

  it('sends only the instruction, the sanitized words and the tool list', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ choices: [{ message: { content: 'hello' } }] }),
    );
    await new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, { fetchImpl }).generateWithTools(
      toolRequest(),
    );

    const body = sentBody(calls[0]);
    expect(Object.keys(body).sort()).toEqual(
      ['max_tokens', 'messages', 'model', 'temperature', 'tools'].sort(),
    );
    expect(body['temperature']).toBe(0);
    expect(body['messages']).toEqual([
      { role: 'system', content: STAGE_A_PROMPT.systemInstruction },
      { role: 'user', content: 'is dental covered' },
    ]);
    expect(body['tools']).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_available_balance',
          description: 'balance',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it('replays earlier tool calls with results paired by id', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ choices: [{ message: { content: 'done' } }] }),
    );
    const result = { availableCents: 1_000, currency: 'USD' } as unknown as AiSafeToolResult;
    await new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, { fetchImpl }).generateWithTools(
      toolRequest({ exchanges: [{ call: { name: 'get_available_balance', args: {} }, result }] }),
    );

    const messages = sentBody(calls[0])['messages'] as Record<string, unknown>[];
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_available_balance', arguments: '{}' },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ result }),
    });
  });

  it('returns the tool calls the model asked for, arguments parsed', async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({
        choices: [
          {
            message: {
              content: 'ignored when calling a tool',
              tool_calls: [
                {
                  function: {
                    name: 'evaluate_expense',
                    arguments: '{"treatmentCategory":"DENTAL","amountCents":30000}',
                  },
                },
                { function: { name: 'list_covered_categories', arguments: { already: 'object' } } },
                { function: { name: 'broken', arguments: 'not json' } },
              ],
            },
          },
        ],
      }),
    );
    const turn = await new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, {
      fetchImpl,
    }).generateWithTools(toolRequest());

    expect(turn.text).toBeNull();
    expect(turn.toolCalls).toEqual([
      { name: 'evaluate_expense', args: { treatmentCategory: 'DENTAL', amountCents: 30_000 } },
      { name: 'list_covered_categories', args: { already: 'object' } },
      // Unparseable arguments reach the executor as nothing, which it rejects as invalid.
      { name: 'broken', args: null },
    ]);
  });

  it('returns the text when the model answers in words', async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ choices: [{ message: { content: 'How much does it cost?' } }] }),
    );
    const turn = await new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, {
      fetchImpl,
    }).generateWithTools(toolRequest());
    expect(turn).toEqual({ text: 'How much does it cost?', toolCalls: [] });
  });

  describe('a tool call the model wrote as text', () => {
    const turnFor = async (content: string) => {
      const { fetchImpl } = fakeFetch(() => json({ choices: [{ message: { content } }] }));
      return new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, { fetchImpl }).generateWithTools(
        toolRequest(),
      );
    };

    it('is read as a call when it names a tool that was offered', async () => {
      await expect(turnFor('{"name": "get_available_balance", "parameters": {}}')).resolves.toEqual(
        { text: null, toolCalls: [{ name: 'get_available_balance', args: {} }] },
      );
    });

    it('is read inside a code fence, or as a list', async () => {
      const fenced = await turnFor(
        '```json\n[{"name": "get_available_balance", "arguments": "{}"}]\n```',
      );
      expect(fenced.toolCalls).toEqual([{ name: 'get_available_balance', args: {} }]);
    });

    it('stays text when it names a tool that was not offered, or is not only JSON', async () => {
      for (const content of [
        '{"name": "delete_everything", "parameters": {}}',
        'Sure: {"name": "get_available_balance", "parameters": {}}',
        '{"verdict": "ELIGIBLE"}',
      ]) {
        await expect(turnFor(content), content).resolves.toEqual({ text: content, toolCalls: [] });
      }
    });
  });

  it('asks the explanation stage for the schema, and sends the decision only', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ choices: [{ message: { content: '{"verdict":"ELIGIBLE","explanation":"ok"}' } }] }),
    );
    const result = await new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, {
      fetchImpl,
    }).generateStructured(structuredRequest);

    expect(result).toEqual({ value: { verdict: 'ELIGIBLE', explanation: 'ok' } });
    const body = sentBody(calls[0]);
    expect(body['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'explanation', schema: EXPLANATION_RESPONSE_SCHEMA },
    });
    expect(body['messages']).toEqual([
      { role: 'system', content: STAGE_B_PROMPT.systemInstruction },
      { role: 'user', content: JSON.stringify(context) },
    ]);
  });

  it('accepts JSON mode handing back an object rather than a string', async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ choices: [{ message: { content: { verdict: 'ELIGIBLE', explanation: 'ok' } } }] }),
    );
    await expect(
      new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, { fetchImpl }).generateStructured(
        structuredRequest,
      ),
    ).resolves.toEqual({ value: { verdict: 'ELIGIBLE', explanation: 'ok' } });
  });

  describe('fails uniformly, carrying nothing from upstream', () => {
    const failureOf = async (
      answer: () => Response | Promise<Response>,
      call: 'tools' | 'structured' = 'tools',
    ): Promise<AiUnavailableError> => {
      const provider = new CloudflareWorkersAiProvider(ACCOUNT, TOKEN, {
        fetchImpl: fakeFetch(answer).fetchImpl,
        timeoutMs: 20,
      });
      const promise =
        call === 'tools'
          ? provider.generateWithTools(toolRequest())
          : provider.generateStructured(structuredRequest);
      const error = await promise.then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(AiUnavailableError);
      const failure = error as AiUnavailableError;
      expect(failure.message).not.toContain(TOKEN);
      expect(failure.message).not.toContain(ACCOUNT);
      expect(failure.message).not.toMatch(/echoed/);
      return failure;
    };

    it('on an error status, without reading what the service said', async () => {
      const failure = await failureOf(() =>
        json({ errors: [{ message: 'echoed request text' }] }, 429),
      );
      expect(failure.cause_).toBe('CALL_FAILED');
      // The status is kept for diagnosis; it is a number, never the body.
      expect(failure.upstreamStatus).toBe(429);
    });

    it('on a network failure', async () => {
      const failure = await failureOf(() => Promise.reject(new Error('echoed socket detail')));
      expect(failure.cause_).toBe('CALL_FAILED');
    });

    it('on a slow answer', async () => {
      const failure = await failureOf(
        () =>
          new Promise<Response>(() => {
            // Deliberately never settles.
          }),
      );
      expect(failure.cause_).toBe('TIMEOUT');
    });

    it('on a body that is not JSON', async () => {
      const failure = await failureOf(() => new Response('echoed <html>', { status: 200 }));
      expect(failure.cause_).toBe('BAD_RESPONSE');
    });

    it('on a completion with no choices', async () => {
      const failure = await failureOf(() => json({ choices: [] }));
      expect(failure.cause_).toBe('BAD_RESPONSE');
    });

    it('on an explanation that is empty or not JSON', async () => {
      for (const content of ['', 'echoed prose, not json']) {
        const failure = await failureOf(
          () => json({ choices: [{ message: { content } }] }),
          'structured',
        );
        expect(failure.cause_).toBe('BAD_RESPONSE');
      }
    });
  });
});
