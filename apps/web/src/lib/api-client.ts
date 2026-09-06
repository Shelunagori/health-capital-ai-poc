import type {
  AskGuidanceResponse,
  EvaluateEligibilityRequest,
  EvaluateEligibilityResponse,
  LoginResponse,
  MemberSelfDto,
  EnrollmentDto,
} from '@health-capital/contracts';

/**
 * The only way this application talks to the server.
 *
 * It holds no secrets and decides nothing. Every authorization decision is made by the API, so a
 * page here can be wrong about what a member may see without that becoming a way to see it.
 */
export const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  // The token lives in memory for the life of the tab and is attached per request.
  if (options.token != null) headers['Authorization'] = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The service could not be reached.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Something went wrong.',
    );
  }

  return (await response.json()) as T;
}

export const api = {
  login: (email: string, password: string): Promise<LoginResponse> =>
    request('/auth/login', { method: 'POST', body: { email, password } }),

  profile: (token: string): Promise<MemberSelfDto> => request('/me/profile', { token }),

  enrollments: (token: string): Promise<{ enrollments: EnrollmentDto[] }> =>
    request('/me/enrollments', { token }),

  evaluate: (
    token: string,
    body: EvaluateEligibilityRequest,
  ): Promise<EvaluateEligibilityResponse> =>
    request('/me/eligibility/evaluate', { method: 'POST', token, body }),

  ask: (token: string, question: string): Promise<AskGuidanceResponse> =>
    request('/me/guidance/ask', { method: 'POST', token, body: { question } }),
};
