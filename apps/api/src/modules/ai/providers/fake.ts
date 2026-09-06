import { AiUnavailableError } from '../errors.js';
import type { AIProvider, StructuredRequest, ToolTurnRequest, ToolTurnResult } from '../types.js';

/**
 * A scripted provider for tests.
 *
 * It records exactly what it was asked, which is what makes it possible to assert that nothing
 * personal crossed the boundary, and it can be told to behave badly on purpose: invent a tool,
 * claim an outcome the rules did not reach, or fail outright.
 */
export interface FakeScript {
  /** Returned in order, one per call to generateWithTools. */
  toolTurns?: ToolTurnResult[];
  /** Returned for generateStructured. */
  structured?: unknown;
  failToolTurnWith?: 'TIMEOUT' | 'CALL_FAILED' | 'BAD_RESPONSE';
  failStructuredWith?: 'TIMEOUT' | 'CALL_FAILED' | 'BAD_RESPONSE';
}

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly available = true;

  /** Everything sent to this provider, for assertions about what crossed the boundary. */
  readonly toolRequests: ToolTurnRequest[] = [];
  readonly structuredRequests: StructuredRequest[] = [];

  private turnIndex = 0;

  constructor(private script: FakeScript = {}) {}

  setScript(script: FakeScript): void {
    this.script = script;
    this.turnIndex = 0;
  }

  generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResult> {
    this.toolRequests.push(request);
    if (this.script.failToolTurnWith !== undefined) {
      return Promise.reject(new AiUnavailableError(this.name, this.script.failToolTurnWith));
    }
    const turn = this.script.toolTurns?.[this.turnIndex];
    this.turnIndex += 1;
    return Promise.resolve(turn ?? { text: null, toolCalls: [] });
  }

  generateStructured(request: StructuredRequest): Promise<unknown> {
    this.structuredRequests.push(request);
    if (this.script.failStructuredWith !== undefined) {
      return Promise.reject(new AiUnavailableError(this.name, this.script.failStructuredWith));
    }
    return Promise.resolve(this.script.structured ?? null);
  }

  /** Everything this provider was sent, serialised, for scanning in privacy tests. */
  sentPayloads(): string {
    return JSON.stringify({ tool: this.toolRequests, structured: this.structuredRequests });
  }
}
