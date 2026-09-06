import { AiUnavailableError } from '../errors.js';
import type { AIProvider } from '../types.js';

/**
 * The provider used when no key is configured.
 *
 * It exists so the rest of the platform has one code path rather than two: guidance always talks to
 * a provider, and this one always declines. Everything else in the product keeps working, which is
 * the point of keeping decisions out of the model in the first place.
 */
export class NullProvider implements AIProvider {
  readonly name = 'null';
  readonly model = 'none';
  readonly available = false;

  generateWithTools(): Promise<never> {
    return Promise.reject(new AiUnavailableError(this.name, 'NOT_CONFIGURED'));
  }

  generateStructured(): Promise<never> {
    return Promise.reject(new AiUnavailableError(this.name, 'NOT_CONFIGURED'));
  }
}
