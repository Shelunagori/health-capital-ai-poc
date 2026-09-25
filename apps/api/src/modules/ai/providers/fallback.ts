import { AiUnavailableError } from '../errors.js';
import type {
  AIProvider,
  ProviderIdentity,
  StructuredRequest,
  StructuredResult,
  ToolTurnRequest,
  ToolTurnResult,
} from '../types.js';

/**
 * Several providers in order of preference, presented as one.
 *
 * Each call goes to the first provider that is available and not cooling down. If it cannot answer,
 * which every provider reports as `AiUnavailableError`, the call moves to the next. Any other error
 * is a defect rather than an outage and is rethrown as it is, so a bug is never hidden behind a
 * second model.
 *
 * Every provider in the chain receives exactly the same branded request, so the minimum-necessary
 * boundary is unchanged by falling back: the second model sees no more than the first would have.
 * The result names the provider that answered, so the audit trail records who really did.
 *
 * A provider that fails is skipped for a short cooldown. Without it, a primary that is down would
 * cost its full timeout on every tool round of every request before the fallback got a turn.
 */
export const DEFAULT_FALLBACK_COOLDOWN_MS = 30_000;

/** One provider that could not answer. Names, a kind and a status code only: never a payload. */
export interface ProviderFailure {
  provider: string;
  model: string;
  cause: AiUnavailableError['cause_'];
  upstreamStatus: number | undefined;
}

export interface FallbackOptions {
  cooldownMs?: number;
  /**
   * Told about every attempt that failed, including one a later provider recovered from, so an
   * outage of the primary is visible even while the fallback hides it from members.
   */
  onAttemptFailed?: ((failure: ProviderFailure) => void) | undefined;
  /** Injected by tests. */
  now?: () => number;
}

export class FallbackProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  private readonly providers: readonly AIProvider[];
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onAttemptFailed: ((failure: ProviderFailure) => void) | undefined;
  /** When each provider may be tried again, by position. Operational state only: no request data. */
  private readonly retryAt: number[];

  constructor(providers: readonly AIProvider[], options: FallbackOptions = {}) {
    if (providers.length === 0) throw new Error('FallbackProvider needs at least one provider');
    this.providers = providers;
    this.name = providers.map((p) => p.name).join('+');
    this.model = providers.map((p) => p.model).join('+');
    this.cooldownMs = options.cooldownMs ?? DEFAULT_FALLBACK_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
    this.onAttemptFailed = options.onAttemptFailed;
    this.retryAt = providers.map(() => 0);
  }

  get available(): boolean {
    return this.providers.some((p) => p.available);
  }

  async generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResult> {
    return this.firstAnswer(async (provider) => {
      const result = await provider.generateWithTools(request);
      return { ...result, servedBy: result.servedBy ?? identity(provider) };
    });
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    return this.firstAnswer(async (provider) => {
      const result = await provider.generateStructured(request);
      return { ...result, servedBy: result.servedBy ?? identity(provider) };
    });
  }

  private async firstAnswer<T>(attempt: (provider: AIProvider) => Promise<T>): Promise<T> {
    const candidates = this.providers
      .map((provider, index) => ({ provider, index }))
      .filter(({ provider }) => provider.available);
    const now = this.now();
    const ready = candidates.filter(({ index }) => (this.retryAt[index] ?? 0) <= now);
    // When everything is cooling down, trying them all beats refusing outright.
    const order = ready.length > 0 ? ready : candidates;

    let lastError: AiUnavailableError = new AiUnavailableError(this.name, 'NOT_CONFIGURED');
    for (const { provider, index } of order) {
      try {
        const result = await attempt(provider);
        this.retryAt[index] = 0;
        return result;
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err;
        this.retryAt[index] = this.now() + this.cooldownMs;
        lastError = err;
        this.onAttemptFailed?.({
          provider: provider.name,
          model: provider.model,
          cause: err.cause_,
          upstreamStatus: err.upstreamStatus,
        });
      }
    }
    throw lastError;
  }
}

function identity(provider: AIProvider): ProviderIdentity {
  return { provider: provider.name, model: provider.model };
}
