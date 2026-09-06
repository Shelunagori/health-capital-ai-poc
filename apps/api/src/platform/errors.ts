/**
 * Typed application errors. The HTTP error handler maps these to responses without leaking internals.
 * Messages on AppError are safe to show to clients; anything else is replaced by a generic message.
 */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    public readonly code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.statusCode = STATUS_BY_CODE[code];
  }
}

export interface ErrorResponseBody {
  error: { code: AppErrorCode; message: string };
  traceId: string;
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;
