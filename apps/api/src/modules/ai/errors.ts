/**
 * A provider that could not answer. Every provider failure becomes this, so callers have one thing
 * to handle and no provider-specific error can leak a payload or a key into a log or a response.
 */
export class AiUnavailableError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly cause_: 'NOT_CONFIGURED' | 'TIMEOUT' | 'CALL_FAILED' | 'BAD_RESPONSE',
  ) {
    // No provider message, no request body, no key: only which provider and what kind of failure.
    super(`AI provider ${providerName} could not answer (${cause_})`);
    this.name = 'AiUnavailableError';
  }
}

export const AI_CALL_TIMEOUT_MS = 10_000;

/** Bounds every provider call, so a slow model degrades the answer rather than the request. */
export async function withTimeout<T>(
  promise: Promise<T>,
  providerName: string,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AiUnavailableError(providerName, 'TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
