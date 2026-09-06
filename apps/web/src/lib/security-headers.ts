/**
 * The content security policy, built per request.
 *
 * Next.js serves its own bootstrap and streaming payload as inline `<script>` blocks. A policy of
 * `script-src 'self'` blocks every one of them, which stops React from hydrating at all: the page
 * renders, no handler ever attaches, and forms fall back to native browser submission. So the
 * policy has to permit those specific scripts, and how it does that differs by environment.
 *
 * Deployed: a fresh nonce per request. Next stamps it onto its own script tags, and
 * `strict-dynamic` extends that trust to the chunks they load. No `unsafe-inline`, no
 * `unsafe-eval`, and no third-party origin. An injected `<script>` carries no nonce and does not run.
 *
 * Development: the dev runtime compiles and evaluates modules in the browser for fast refresh,
 * which needs `unsafe-eval`, and it injects inline scripts that no nonce reaches. Those relaxations
 * exist so the dev server works and are confined to it. They must never reach a deployed policy,
 * which is why the two are built here side by side and asserted against each other in tests.
 */
export type SecurityEnvironment = 'development' | 'deployed';

export interface ContentSecurityPolicyOptions {
  environment: SecurityEnvironment;
  /** Where the browser is allowed to reach the API. The only cross-origin destination permitted. */
  apiUrl: string;
  /** Required when deployed; ignored in development, where no nonce is applied to dev scripts. */
  nonce?: string | undefined;
}

export function buildContentSecurityPolicy({
  environment,
  apiUrl,
  nonce,
}: ContentSecurityPolicyOptions): string {
  const isDevelopment = environment === 'development';

  const scriptSrc = isDevelopment
    ? // Fast refresh evaluates compiled modules, and the dev server injects inline scripts.
      ["'self'", "'unsafe-eval'", "'unsafe-inline'"]
    : // A nonce Next applies to its own tags, with trust propagated to the chunks they load.
      ["'self'", `'nonce-${nonce ?? ''}'`, "'strict-dynamic'"];

  // The dev server opens a websocket for hot reload; a deployed build never does.
  const connectSrc = isDevelopment ? ["'self'", apiUrl, 'ws:', 'wss:'] : ["'self'", apiUrl];

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', scriptSrc],
    // Framework-injected styles carry no nonce. Inline style is a far smaller risk than inline
    // script, and no amount of it can execute code.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', connectSrc],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    // Keeps a form, including the sign-in form, from posting anywhere but this origin.
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** A per-request nonce. Uses web crypto, which is what the middleware runtime provides. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function resolveEnvironment(nodeEnv: string | undefined): SecurityEnvironment {
  return nodeEnv === 'production' ? 'deployed' : 'development';
}
