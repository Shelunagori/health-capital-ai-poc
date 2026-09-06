import { GoogleGenAI, ThinkingLevel, type FunctionDeclaration } from '@google/genai';
import { AiUnavailableError, withTimeout } from '../errors.js';
import type {
  AIProvider,
  ModelToolCall,
  StructuredRequest,
  ToolTurnRequest,
  ToolTurnResult,
} from '../types.js';

/**
 * The real provider.
 *
 * The key is read from the server environment and never leaves it. Requests and responses are never
 * logged: a Stage A request carries the member's own words, and a log line is exactly the kind of
 * place that text should not end up. Failures become `AiUnavailableError`, which carries only the
 * provider name and the kind of failure, so a provider message cannot smuggle a payload into a log.
 */
/**
 * The model used when configuration names none. Kept beside the provider so there is one literal
 * to change: `platform/config.ts` validates an override but does not restate this value, which
 * would also invert the dependency direction between platform and the modules above it.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

/**
 * How much the model is asked to deliberate before answering.
 *
 * Both stages are bounded work: pick a category and an amount from a sentence, or restate a
 * decision in plain words. Neither is open-ended reasoning, because the reasoning that matters
 * already happened in the rules engine before the model is asked anything.
 *
 * Left unset, a reasoning model can spend most of a request thinking and overrun the ten-second
 * budget, which turns a working answer into a timeout and a fallback. LOW keeps these calls inside
 * it. MEDIUM or HIGH would buy deliberation that neither task has any use for.
 */
const THINKING = { thinkingLevel: ThinkingLevel.LOW } as const;

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly available = true;
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_GEMINI_MODEL,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResult> {
    const functionDeclarations: FunctionDeclaration[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters,
    }));

    // The conversation: the member's sanitized words, then each tool call and its result.
    const contents: Record<string, unknown>[] = [
      { role: 'user', parts: [{ text: request.query.text }] },
    ];
    for (const exchange of request.exchanges) {
      contents.push({
        role: 'model',
        parts: [{ functionCall: { name: exchange.call.name, args: exchange.call.args } }],
      });
      contents.push({
        role: 'user',
        parts: [
          { functionResponse: { name: exchange.call.name, response: { result: exchange.result } } },
        ],
      });
    }

    const response = await withTimeout(
      this.client.models.generateContent({
        model: this.model,
        contents: contents,
        config: {
          systemInstruction: request.systemInstruction,
          tools: [{ functionDeclarations }],
          temperature: 0,
          thinkingConfig: THINKING,
        },
      }),
      this.name,
    ).catch((err: unknown) => {
      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError(this.name, 'CALL_FAILED');
    });

    const toolCalls: ModelToolCall[] = (response.functionCalls ?? []).map((call) => ({
      name: call.name ?? '',
      args: call.args,
    }));

    // Reading the text of a response that carries function calls makes the SDK warn, and the text
    // is not used in that case: the tool results drive the next turn. Only read it when the model
    // answered with words instead of a call.
    return { text: toolCalls.length > 0 ? null : (response.text ?? null), toolCalls };
  }

  async generateStructured(request: StructuredRequest): Promise<unknown> {
    const response = await withTimeout(
      this.client.models.generateContent({
        model: this.model,
        // The decision only. The member's words never reach this stage.
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(request.context) }] }] as never,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseSchema,
          temperature: 0,
          thinkingConfig: THINKING,
        },
      }),
      this.name,
    ).catch((err: unknown) => {
      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError(this.name, 'CALL_FAILED');
    });

    const text = response.text;
    if (text === undefined || text === null || text.trim() === '') {
      throw new AiUnavailableError(this.name, 'BAD_RESPONSE');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      // The unparseable text is deliberately not included anywhere.
      throw new AiUnavailableError(this.name, 'BAD_RESPONSE');
    }
  }
}
