import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  createNonce,
  resolveEnvironment,
} from '@/lib/security-headers';

const API_URL = 'https://api.demo.example.test';
const NONCE = 'dGVzdC1ub25jZS12YWx1ZQ==';

const development = buildContentSecurityPolicy({ environment: 'development', apiUrl: API_URL });
const deployed = buildContentSecurityPolicy({
  environment: 'deployed',
  apiUrl: API_URL,
  nonce: NONCE,
});

/** Reads one directive out of a policy string. */
const directive = (policy: string, name: string): string =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1) ?? '';

describe('the deployed policy keeps scripts first-party and nonced', () => {
  it('carries the nonce and extends trust to what those scripts load', () => {
    const scriptSrc = directive(deployed, 'script-src');
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).toContain("'self'");
  });

  it('never permits eval', () => {
    // The single most important line here: a deployed policy that allows eval would give an
    // injected string the ability to become code.
    expect(deployed).not.toContain('unsafe-eval');
  });

  it('never permits inline script', () => {
    expect(directive(deployed, 'script-src')).not.toContain('unsafe-inline');
  });

  it('reaches no origin except the API', () => {
    expect(directive(deployed, 'connect-src')).toBe(`'self' ${API_URL}`);
    // No content delivery network, no analytics, no font host, nowhere else at all.
    const origins = deployed.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(origins).toEqual([API_URL]);
  });

  it('opens no websocket, which only the dev server needs', () => {
    expect(directive(deployed, 'connect-src')).not.toContain('ws:');
    expect(directive(deployed, 'connect-src')).not.toContain('wss:');
  });
});

describe('the development policy permits exactly what the dev runtime needs', () => {
  it('allows eval, because fast refresh evaluates compiled modules in the browser', () => {
    expect(directive(development, 'script-src')).toContain("'unsafe-eval'");
  });

  it('allows the inline scripts the dev server injects', () => {
    // Without this the framework's own bootstrap and streaming payload are blocked, React never
    // hydrates, and every form falls back to native browser submission.
    expect(directive(development, 'script-src')).toContain("'unsafe-inline'");
  });

  it('allows the hot-reload websocket', () => {
    expect(directive(development, 'connect-src')).toContain('ws:');
  });

  it('still reaches no third-party origin', () => {
    const origins = development.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(origins).toEqual([API_URL]);
  });

  it('needs no nonce, and does not invent one', () => {
    expect(development).not.toContain('nonce-');
  });
});

describe('what both policies always say', () => {
  it.each([
    ['development', development],
    ['deployed', deployed],
  ])('%s refuses framing, plugins and base-tag rewriting', (_name, policy) => {
    expect(directive(policy, 'frame-ancestors')).toBe("'none'");
    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'base-uri')).toBe("'self'");
  });

  it.each([
    ['development', development],
    ['deployed', deployed],
  ])('%s allows a form to submit only to this origin', (_name, policy) => {
    // Which is what stops a hydration failure sending the sign-in form somewhere else.
    expect(directive(policy, 'form-action')).toBe("'self'");
  });

  it.each([
    ['development', development],
    ['deployed', deployed],
  ])('%s falls back to self for anything not named', (_name, policy) => {
    expect(directive(policy, 'default-src')).toBe("'self'");
  });
});

describe('the two policies differ only where they must', () => {
  it('relaxes script rules in development and nowhere else', () => {
    const relaxed = ['unsafe-eval', 'unsafe-inline'];
    for (const token of relaxed) {
      expect(directive(development, 'script-src')).toContain(token);
      expect(directive(deployed, 'script-src')).not.toContain(token);
    }
  });

  it('keeps inline styles in both, which cannot execute code', () => {
    expect(directive(development, 'style-src')).toContain("'unsafe-inline'");
    expect(directive(deployed, 'style-src')).toContain("'unsafe-inline'");
  });
});

describe('environment resolution and nonce generation', () => {
  it('treats only a production build as deployed', () => {
    expect(resolveEnvironment('production')).toBe('deployed');
    expect(resolveEnvironment('development')).toBe('development');
    expect(resolveEnvironment('test')).toBe('development');
    expect(resolveEnvironment(undefined)).toBe('development');
  });

  it('produces a fresh, non-trivial nonce each time', () => {
    const first = createNonce();
    const second = createNonce();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(16);
  });
});
