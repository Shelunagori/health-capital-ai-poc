import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isAppError, type ErrorResponseBody } from '../errors.js';

const hasStatusCode = (err: unknown): err is FastifyError =>
  typeof err === 'object' &&
  err !== null &&
  'statusCode' in err &&
  typeof err.statusCode === 'number';

/**
 * Maps errors to a stable JSON shape. Internal error messages, stack traces and validation
 * details from unknown sources never reach the client; the traceId lets support correlate with logs.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const traceId = request.id;

    let appError: AppError;
    if (isAppError(err)) {
      appError = err;
    } else if (hasStatusCode(err) && err.statusCode === 413) {
      appError = new AppError('PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size');
    } else if (hasStatusCode(err) && err.statusCode === 400) {
      appError = new AppError('VALIDATION_ERROR', 'Request is malformed');
    } else if (hasStatusCode(err) && err.statusCode === 429) {
      appError = new AppError('RATE_LIMITED', 'Too many requests');
    } else if (hasStatusCode(err) && err.statusCode === 404) {
      appError = new AppError('NOT_FOUND', 'Not found');
    } else {
      appError = new AppError('INTERNAL_ERROR', 'An unexpected error occurred');
    }

    const level = appError.statusCode >= 500 ? 'error' : 'warn';
    request.log[level](
      {
        traceId,
        route: request.routeOptions.url ?? 'unmatched',
        method: request.method,
        statusCode: appError.statusCode,
        code: appError.code,
        errorType: err instanceof Error ? err.name : typeof err,
        // Original error for operators; the serializer keeps type/message/stack only.
        err: appError.statusCode >= 500 ? err : undefined,
      },
      'request failed',
    );

    const body: ErrorResponseBody = {
      error: { code: appError.code, message: appError.message },
      traceId,
    };
    void reply.status(appError.statusCode).send(body);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const body: ErrorResponseBody = {
      error: { code: 'NOT_FOUND', message: 'Not found' },
      traceId: request.id,
    };
    void reply.status(404).send(body);
  });
}
