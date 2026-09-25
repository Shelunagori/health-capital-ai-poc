import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../errors.js';
import { sanitizeUserQuery } from '../sanitizer.js';
import { STAGE_A_PROMPT, STAGE_B_PROMPT } from '../prompts/index.js';
import type {
  AIProvider,
  AiSafeExplanationContext,
  StructuredRequest,
  StructuredResult,
  ToolTurnRequest,
  ToolTurnResult,
} from '../types.js';
import { CloudflareWorkersAiProvider } from './cloudflare.js';
import { FakeProvider, type FakeScript } from './fake.js';
import { FallbackProvider } from './fallback.js';
import { GeminiProvider } from './gemini.js';
import { NullProvider } from './null.js';
import { selectProvider } from './select.js';

const toolRequest: ToolTurnRequest = {
  systemInstruction: STAGE_A_PROMPT.systemInstruction,
  promptTemplateId: STAGE_A_PROMPT.id,
  promptVersion: STAGE_A_PROMPT.version,
  query: sanitizeUserQuery('is dental covered'),
  tools: [],
  exchanges: [],
};

const structuredRequest = {
  systemInstruction: STAGE_B_PROMPT.systemInstruction,
  promptTemplateId: STAGE_B_PROMPT.id,
  promptVersion: STAGE_B_PROMPT.version,
  context: { treatmentCategory: 'DENTAL' } as unknown as AiSafeExplanationContext,
  responseSchema: {},
};

/** A scripted provider under another name, so a chain of two can tell them apart. */
class Named implements AIProvider {
  readonly model: string;
  readonly available = true;
  private readonly fake: FakeProvider;

  constructor(
    readonly name: string,
    script: FakeScript = {},
  ) {
    this.model = `${name}-model`;
    this.fake = new FakeProvider(script);
  }

  get toolRequests(): ToolTurnRequest[] {
    return this.fake.toolRequests;
  }
  get structuredRequests(): StructuredRequest[] {
    return this.fake.structuredRequests;
  }
  setScript(script: FakeScript): void {
    this.fake.setScript(script);
  }
  generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResult> {
    // The fake names itself in failures; this provider's own name is what a chain must report.
    return this.fake.generateWithTools(request).catch((err: unknown) => {
      throw err instanceof AiUnavailableError ? new AiUnavailableError(this.name, err.cause_) : err;
    });
  }
  generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    return this.fake.generateStructured(request).catch((err: unknown) => {
      throw err instanceof AiUnavailableError ? new AiUnavailableError(this.name, err.cause_) : err;
    });
  }
}

const answering = (name: string): Named =>
  new Named(name, {
    toolTurns: Array.from({ length: 10 }, () => ({ text: `from ${name}`, toolCalls: [] })),
    structured: { verdict: 'ELIGIBLE', explanation: `from ${name}` },
  });

const failing = (name: string): Named =>
  new Named(name, { failToolTurnWith: 'CALL_FAILED', failStructuredWith: 'TIMEOUT' });

describe('a chain of providers', () => {
  it('uses the first one when it answers, and says so', async () => {
    const primary = answering('primary');
    const secondary = answering('secondary');
    const chain = new FallbackProvider([primary, secondary]);

    await expect(chain.generateWithTools(toolRequest)).resolves.toEqual({
      text: 'from primary',
      toolCalls: [],
      servedBy: { provider: 'primary', model: 'primary-model' },
    });
    await expect(chain.generateStructured(structuredRequest)).resolves.toEqual({
      value: { verdict: 'ELIGIBLE', explanation: 'from primary' },
      servedBy: { provider: 'primary', model: 'primary-model' },
    });
    expect(secondary.toolRequests).toHaveLength(0);
    expect(secondary.structuredRequests).toHaveLength(0);
  });

  it('falls back when the first cannot answer, and names the one that did', async () => {
    const secondary = answering('secondary');
    const chain = new FallbackProvider([failing('primary'), secondary]);

    await expect(chain.generateWithTools(toolRequest)).resolves.toMatchObject({
      text: 'from secondary',
      servedBy: { provider: 'secondary', model: 'secondary-model' },
    });
    await expect(chain.generateStructured(structuredRequest)).resolves.toMatchObject({
      servedBy: { provider: 'secondary' },
    });
  });

  it('gives the fallback exactly the request the first was given, and nothing more', async () => {
    const primary = failing('primary');
    const secondary = answering('secondary');
    await new FallbackProvider([primary, secondary]).generateWithTools(toolRequest);

    expect(secondary.toolRequests).toEqual(primary.toolRequests);
    expect(secondary.toolRequests[0]).toBe(toolRequest);
  });

  it('reports unavailable when every provider fails', async () => {
    const chain = new FallbackProvider([failing('primary'), failing('secondary')]);
    await expect(chain.generateWithTools(toolRequest)).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(chain.generateStructured(structuredRequest)).rejects.toMatchObject({
      providerName: 'secondary',
      cause_: 'TIMEOUT',
    });
  });

  it('rethrows a defect rather than hiding it behind the next model', async () => {
    const broken: AIProvider = {
      name: 'broken',
      model: 'broken-model',
      available: true,
      generateWithTools: () => Promise.reject(new TypeError('a bug')),
      generateStructured: () => Promise.reject(new TypeError('a bug')),
    };
    const secondary = answering('secondary');
    const chain = new FallbackProvider([broken, secondary]);

    await expect(chain.generateWithTools(toolRequest)).rejects.toBeInstanceOf(TypeError);
    expect(secondary.toolRequests).toHaveLength(0);
  });

  it('skips a provider that is not available', async () => {
    const chain = new FallbackProvider([new NullProvider(), answering('secondary')]);
    expect(chain.available).toBe(true);
    await expect(chain.generateWithTools(toolRequest)).resolves.toMatchObject({
      servedBy: { provider: 'secondary' },
    });
  });

  it('is unavailable only when none of its providers is', () => {
    expect(new FallbackProvider([new NullProvider(), new NullProvider()]).available).toBe(false);
  });

  it('rests a failing provider for a while, then tries it again', async () => {
    let clock = 1_000;
    const primary = new Named('primary', { failToolTurnWith: 'CALL_FAILED' });
    const secondary = answering('secondary');
    const chain = new FallbackProvider([primary, secondary], {
      cooldownMs: 30_000,
      now: () => clock,
    });

    await chain.generateWithTools(toolRequest);
    expect(primary.toolRequests).toHaveLength(1);

    // Inside the cooldown the primary is not asked, so an outage costs one timeout, not one per turn.
    clock += 10_000;
    await chain.generateWithTools(toolRequest);
    expect(primary.toolRequests).toHaveLength(1);

    // Once it has passed, the primary gets another chance, and recovering puts it back first.
    clock += 30_000;
    primary.setScript({ toolTurns: [{ text: 'back', toolCalls: [] }] });
    await expect(chain.generateWithTools(toolRequest)).resolves.toMatchObject({
      servedBy: { provider: 'primary' },
    });
  });

  it('tries every provider rather than refusing when all are resting', async () => {
    let clock = 0;
    const primary = failing('primary');
    const secondary = new Named('secondary', { failToolTurnWith: 'CALL_FAILED' });
    const chain = new FallbackProvider([primary, secondary], { now: () => clock });

    await expect(chain.generateWithTools(toolRequest)).rejects.toBeInstanceOf(AiUnavailableError);
    clock += 1;
    secondary.setScript({ toolTurns: [{ text: 'recovered', toolCalls: [] }] });
    await expect(chain.generateWithTools(toolRequest)).resolves.toMatchObject({
      text: 'recovered',
    });
  });

  it('reports every failed attempt, even one the next provider recovered from', async () => {
    const failures: unknown[] = [];
    const chain = new FallbackProvider([failing('primary'), answering('secondary')], {
      onAttemptFailed: (failure) => failures.push(failure),
    });

    await chain.generateWithTools(toolRequest);
    expect(failures).toEqual([
      {
        provider: 'primary',
        model: 'primary-model',
        cause: 'CALL_FAILED',
        upstreamStatus: undefined,
      },
    ]);
    // Names, a kind and a status: nothing from the request reaches the report.
    expect(JSON.stringify(failures)).not.toContain('dental');
  });

  it('keeps the attribution a nested chain already set', async () => {
    const inner = new FallbackProvider([failing('a'), answering('b')]);
    const outer = new FallbackProvider([inner]);
    await expect(outer.generateWithTools(toolRequest)).resolves.toMatchObject({
      servedBy: { provider: 'b' },
    });
  });
});

describe('choosing a provider from configuration', () => {
  const cloudflare = { accountId: '0123456789abcdef0123456789abcdef', apiToken: 'token' };
  const gemini = { apiKey: 'key' };

  it('declines everything when nothing is configured', () => {
    expect(selectProvider({})).toBeInstanceOf(NullProvider);
  });

  it('uses Gemini alone, exactly as before, when it is the only one configured', () => {
    const provider = selectProvider({ gemini: { ...gemini, model: 'gemini-3.6-pro' } });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.model).toBe('gemini-3.6-pro');
  });

  it('uses Cloudflare alone when it is the only one configured', () => {
    const provider = selectProvider({ cloudflare: { ...cloudflare, model: '@cf/x/y' } });
    expect(provider).toBeInstanceOf(CloudflareWorkersAiProvider);
    expect(provider.model).toBe('@cf/x/y');
  });

  it('wraps a single provider only when something is listening for its failures', () => {
    const provider = selectProvider({ gemini, onAttemptFailed: () => undefined });
    expect(provider).toBeInstanceOf(FallbackProvider);
    // A chain of one looks exactly like the provider it wraps.
    expect(provider.name).toBe('gemini');
  });

  it('puts Cloudflare first and Gemini behind it when both are configured', () => {
    const provider = selectProvider({ cloudflare, gemini });
    expect(provider).toBeInstanceOf(FallbackProvider);
    expect(provider.name).toBe('cloudflare-workers-ai+gemini');
    expect(provider.available).toBe(true);
  });
});
