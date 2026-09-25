import type { AIProvider } from '../types.js';
import { CloudflareWorkersAiProvider } from './cloudflare.js';
import { FallbackProvider, type ProviderFailure } from './fallback.js';
import { GeminiProvider } from './gemini.js';
import { NullProvider } from './null.js';

export interface ProviderSettings {
  cloudflare?: { accountId: string; apiToken: string; model?: string | undefined } | undefined;
  gemini?: { apiKey: string; model?: string | undefined } | undefined;
  /** Told about every failed provider attempt, for operational logging. */
  onAttemptFailed?: ((failure: ProviderFailure) => void) | undefined;
}

/**
 * The provider the platform talks to, from whatever is configured.
 *
 * Cloudflare Workers AI is preferred and Gemini is the fallback. With only one configured, that one
 * is used directly, exactly as before there was a choice. With neither, the null provider declines
 * every call and everything that does not need a model keeps working.
 */
export function selectProvider(settings: ProviderSettings): AIProvider {
  const chain: AIProvider[] = [];
  if (settings.cloudflare !== undefined) {
    chain.push(
      new CloudflareWorkersAiProvider(settings.cloudflare.accountId, settings.cloudflare.apiToken, {
        model: settings.cloudflare.model,
      }),
    );
  }
  if (settings.gemini !== undefined) {
    chain.push(new GeminiProvider(settings.gemini.apiKey, settings.gemini.model));
  }
  if (chain.length === 0) return new NullProvider();
  // A single provider is wrapped only when someone is listening for its failures; the chain of one
  // behaves exactly like the provider itself.
  if (chain.length === 1 && settings.onAttemptFailed === undefined) return chain[0] as AIProvider;
  return new FallbackProvider(chain, { onAttemptFailed: settings.onAttemptFailed });
}
