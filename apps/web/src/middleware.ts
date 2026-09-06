import { NextResponse, type NextRequest } from 'next/server';
import {
  buildContentSecurityPolicy,
  createNonce,
  resolveEnvironment,
} from '@/lib/security-headers';

/**
 * Sets the content security policy per request.
 *
 * It lives here rather than in the static header configuration because a deployed policy uses a
 * fresh nonce each time, and a static header cannot carry one. Next reads the policy from the
 * request headers set below and stamps that nonce onto the script tags it emits, which is what lets
 * the policy stay free of `unsafe-inline` while the framework's own inline scripts still run.
 */
export function middleware(request: NextRequest): NextResponse {
  const environment = resolveEnvironment(process.env.NODE_ENV);
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    environment,
    apiUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
    nonce,
  });

  // Next looks for the policy on the *request* to find the nonce to apply to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Documents only. Static assets are not documents and need no policy of their own.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
