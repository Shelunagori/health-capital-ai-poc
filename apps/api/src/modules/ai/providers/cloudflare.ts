import { AI_CALL_TIMEOUT_MS, AiUnavailableError, withTimeout } from '../errors.js';
import type {
  AIProvider,
  ModelToolCall,
  StructuredRequest,
  StructuredResult,
  ToolTurnRequest,
  ToolTurnResult,
} from '../types.js';

/**
 * Cloudflare Workers AI, through its OpenAI-compatible chat completions endpoint.
 *
 * Plain `fetch` rather than an SDK: the endpoint is one POST, and a dependency would add surface
 * without adding safety. The same rules as every provider apply. The token is read from the server
 * environment and never leaves it, requests and responses are never logged, and every failure
 * becomes `AiUnavailableError`, which carries only the provider name and the kind of failure. The
 * upstream response body is never read on an error, so an echoed payload cannot travel further.
 */
/** The model used when configuration names none. Supports both function calling and JSON mode. */
export const DEFAULT_CLOUDFLARE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** A Cloudflare account id. Checked so nothing but an id can be placed into the request URL. */
export const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * Enough for a short explanation or a tool call. The endpoint's own default is lower, which can cut
 * a JSON answer off mid-object and turn a working reply into a parse failure.
 */
const MAX_TOKENS = 512;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

interface ChatCompletion {
  choices?: {
    message?: {
      content?: unknown;
      tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[];
    };
  }[];
}

export interface CloudflareProviderOptions {
  model?: string | undefined;
  /** Injected by tests, so no test ever calls the real service. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class CloudflareWorkersAiProvider implements AIProvider {
  readonly name = 'cloudflare-workers-ai';
  readonly available = true;
  readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    accountId: string,
    private readonly apiToken: string,
    options: CloudflareProviderOptions = {},
  ) {
    if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
      // The value itself is deliberately not included.
      throw new Error('Cloudflare account id must be 32 hexadecimal characters');
    }
    this.model = options.model ?? DEFAULT_CLOUDFLARE_MODEL;
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  }

  async generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResult> {
    // The conversation: the member's sanitized words, then each tool call and its result. The
    // exchanges carry no call ids, so each request numbers its own; they only pair a call with
    // its result inside this one stateless request.
    const messages: ChatMessage[] = [
      { role: 'system', content: request.systemInstruction },
      { role: 'user', content: request.query.text },
    ];
    request.exchanges.forEach((exchange, index) => {
      const id = `call_${index + 1}`;
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id,
            type: 'function',
            function: {
              name: exchange.call.name,
              arguments: JSON.stringify(exchange.call.args ?? {}),
            },
          },
        ],
      });
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify({ result: exchange.result }),
      });
    });

    const completion = await this.complete({
      messages,
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    });

    const message = completion.choices?.[0]?.message;
    if (message === undefined) throw new AiUnavailableError(this.name, 'BAD_RESPONSE');

    let toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map((call) => ({
      name: typeof call.function?.name === 'string' ? call.function.name : '',
      args: parseArguments(call.function?.arguments),
    }));
    const text =
      typeof message.content === 'string' && message.content !== '' ? message.content : null;
    if (toolCalls.length === 0 && text !== null) {
      toolCalls = toolCallsWrittenAsText(text, new Set(request.tools.map((tool) => tool.name)));
    }

    return { text: toolCalls.length > 0 ? null : text, toolCalls };
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    const completion = await this.complete({
      messages: [
        { role: 'system', content: request.systemInstruction },
        // The decision only. The member's words never reach this stage.
        { role: 'user', content: JSON.stringify(request.context) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'explanation', schema: request.responseSchema },
      },
    });

    const content = completion.choices?.[0]?.message?.content;
    // JSON mode may hand back an already-parsed object rather than a string.
    if (content !== null && typeof content === 'object') return { value: content };
    if (typeof content !== 'string' || content.trim() === '') {
      throw new AiUnavailableError(this.name, 'BAD_RESPONSE');
    }
    try {
      return { value: JSON.parse(content) as unknown };
    } catch {
      // The unparseable text is deliberately not included anywhere.
      throw new AiUnavailableError(this.name, 'BAD_RESPONSE');
    }
  }

  /** One bounded POST. Any failure is reduced to a kind, and nothing from upstream is kept. */
  private async complete(body: Record<string, unknown>): Promise<ChatCompletion> {
    const controller = new AbortController();
    const call = async (): Promise<ChatCompletion> => {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: MAX_TOKENS,
            ...body,
          }),
          signal: controller.signal,
        });
      } catch {
        throw new AiUnavailableError(this.name, 'CALL_FAILED');
      }
      if (!response.ok) {
        // Released unread: an error body can echo the request. Only the status is kept.
        await response.body?.cancel().catch(() => undefined);
        throw new AiUnavailableError(this.name, 'CALL_FAILED', response.status);
      }
      try {
        return (await response.json()) as ChatCompletion;
      } catch {
        throw new AiUnavailableError(this.name, 'BAD_RESPONSE');
      }
    };

    try {
      return await withTimeout(call(), this.name, this.timeoutMs);
    } catch (err) {
      if (err instanceof AiUnavailableError && err.cause_ === 'TIMEOUT') controller.abort();
      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError(this.name, 'CALL_FAILED');
    }
  }
}

/** Tool arguments arrive as a JSON string, or sometimes an object. Anything else is not arguments. */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Untrusted and unparseable: handed on as nothing, so the executor rejects it as invalid.
    return null;
  }
}

/**
 * Some Workers AI models answer a tool request by writing the call as JSON in the message text
 * instead of in `tool_calls`: `{"name": "...", "parameters": {...}}`, or a list of those. Read as a
 * call only when the whole text is that shape and names a tool that was offered; anything else is
 * the model talking. The arguments stay untrusted and are validated exactly as any other call's.
 */
function toolCallsWrittenAsText(text: string, offered: ReadonlySet<string>): ModelToolCall[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text)) as unknown;
  } catch {
    return [];
  }
  const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const calls: ModelToolCall[] = [];
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') return [];
    const { name, parameters, arguments: args } = candidate as Record<string, unknown>;
    if (typeof name !== 'string' || !offered.has(name)) return [];
    calls.push({ name, args: parseArguments(parameters ?? args) });
  }
  return calls;
}

function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}
