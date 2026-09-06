import { describe, expect, it } from 'vitest';
import { AiUnavailableError, withTimeout } from '../errors.js';
import { sanitizeUserQuery } from '../sanitizer.js';
import { STAGE_A_PROMPT, STAGE_B_PROMPT } from '../prompts/index.js';
import { FakeProvider } from './fake.js';
import { NullProvider } from './null.js';
import { DEFAULT_GEMINI_MODEL, GeminiProvider } from './gemini.js';
import type { AiSafeExplanationContext } from '../types.js';

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

describe('the provider used when no key is configured', () => {
  const provider = new NullProvider();

  it('declines every call, rather than pretending', async () => {
    await expect(provider.generateWithTools()).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(provider.generateStructured()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('says it is unavailable, so callers do not have to discover it by failing', () => {
    expect(provider.available).toBe(false);
  });
});

describe('the scripted provider', () => {
  it('returns turns in order and records what it was sent', async () => {
    const provider = new FakeProvider({
      toolTurns: [
        { text: null, toolCalls: [{ name: 'get_available_balance', args: {} }] },
        { text: 'done', toolCalls: [] },
      ],
    });

    const request = {
      systemInstruction: STAGE_A_PROMPT.systemInstruction,
      promptTemplateId: STAGE_A_PROMPT.id,
      promptVersion: STAGE_A_PROMPT.version,
      query: sanitizeUserQuery('is dental covered'),
      tools: [],
      exchanges: [],
    };

    expect((await provider.generateWithTools(request)).toolCalls[0]?.name).toBe(
      'get_available_balance',
    );
    expect((await provider.generateWithTools(request)).text).toBe('done');
    expect(provider.toolRequests).toHaveLength(2);
  });

  it('can be told to fail, so fallback behaviour is testable', async () => {
    const provider = new FakeProvider({ failToolTurnWith: 'TIMEOUT' });
    await expect(
      provider.generateWithTools({
        systemInstruction: '',
        promptTemplateId: STAGE_A_PROMPT.id,
        promptVersion: STAGE_A_PROMPT.version,
        query: sanitizeUserQuery('anything'),
        tools: [],
        exchanges: [],
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('exposes everything it was sent, for scanning', async () => {
    const provider = new FakeProvider({ structured: { verdict: 'ELIGIBLE', explanation: 'ok' } });
    await provider.generateStructured({
      systemInstruction: STAGE_B_PROMPT.systemInstruction,
      promptTemplateId: STAGE_B_PROMPT.id,
      promptVersion: STAGE_B_PROMPT.version,
      context,
      responseSchema: {},
    });
    expect(provider.sentPayloads()).toContain('DENTAL');
  });
});

describe('provider failures are uniform', () => {
  it('carries only the provider name and the kind of failure', () => {
    const error = new AiUnavailableError('gemini', 'CALL_FAILED');
    expect(error.message).toBe('AI provider gemini could not answer (CALL_FAILED)');
    // No payload, no key, no upstream message that could carry either into a log.
    expect(error.message).not.toMatch(/key|token|http|\{/i);
  });

  it('bounds a slow call rather than letting it hold the request open', async () => {
    const never = new Promise<never>(() => {
      // Deliberately never settles.
    });
    await expect(withTimeout(never, 'gemini', 20)).rejects.toMatchObject({ cause_: 'TIMEOUT' });
  });

  it('lets a fast call through untouched', async () => {
    await expect(withTimeout(Promise.resolve('answer'), 'gemini', 1_000)).resolves.toBe('answer');
  });
});

describe('the real provider', () => {
  it('pins a model and keeps the key out of everything it exposes', () => {
    const provider = new GeminiProvider(
      'a-key-that-must-not-appear-anywhere',
      DEFAULT_GEMINI_MODEL,
    );
    expect(provider.name).toBe('gemini');
    expect(provider.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(provider.available).toBe(true);
    expect(JSON.stringify({ name: provider.name, model: provider.model })).not.toContain('a-key');
  });

  it('defaults to the current model id', () => {
    // Named explicitly rather than compared to the constant, so changing the constant has to be
    // deliberate: an account that could not use the previous default is how this broke.
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.6-flash');
    expect(new GeminiProvider('a-key').model).toBe('gemini-3.6-flash');
  });

  it('uses a configured model instead of the default', () => {
    expect(new GeminiProvider('a-key', 'gemini-3.6-pro').model).toBe('gemini-3.6-pro');
  });

  it('falls back to the default when configuration names none', () => {
    expect(new GeminiProvider('a-key', undefined).model).toBe(DEFAULT_GEMINI_MODEL);
  });
});

describe('prompt templates', () => {
  it('are versioned, so an audit event can name what produced a call', () => {
    expect(STAGE_A_PROMPT).toMatchObject({ id: 'guidance.stageA', version: '1' });
    expect(STAGE_B_PROMPT).toMatchObject({ id: 'guidance.stageB', version: '1' });
  });

  it('tell the first stage it decides nothing and needs no identity', () => {
    expect(STAGE_A_PROMPT.systemInstruction).toMatch(/do not decide|deterministic rules decide/i);
    expect(STAGE_A_PROMPT.systemInstruction).toMatch(/no way to identify the member/i);
  });

  it('tell the second stage the decision is final', () => {
    expect(STAGE_B_PROMPT.systemInstruction).toMatch(/final/i);
    expect(STAGE_B_PROMPT.systemInstruction).toMatch(/never soften, upgrade or contradict/i);
  });
});
