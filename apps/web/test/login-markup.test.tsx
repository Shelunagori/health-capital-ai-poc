import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginForm } from '@/components/login-form';
import { SessionProvider } from '@/lib/session';

/**
 * What the browser receives before any JavaScript runs.
 *
 * This is the state that caused the problem: the page arrives, the framework's scripts are blocked
 * or fail, no handler ever attaches, and the browser submits the form on its own. Everything here
 * has to hold in exactly that state, so it is asserted against server-rendered markup rather than
 * against a hydrated DOM.
 */
const markup = renderToStaticMarkup(
  <SessionProvider>
    <LoginForm />
  </SessionProvider>,
);

describe('the markup a browser gets before hydration', () => {
  it('declares POST on the sign-in form', () => {
    expect(markup).toMatch(/<form[^>]*method="post"/i);
  });

  it('never declares GET, which would put the password in the query string', () => {
    expect(markup).not.toMatch(/<form[^>]*method="get"/i);
  });

  it('submits to this origin only', () => {
    const action = /<form[^>]*action="([^"]*)"/i.exec(markup)?.[1] ?? '';
    expect(action).toBe('/');
  });

  it('keeps the password field inside that form', () => {
    // A field outside the form, or in a different one, would submit with the page URL instead.
    const form = /<form[\s\S]*?<\/form>/i.exec(markup)?.[0] ?? '';
    expect(form).toMatch(/type="password"/);
    expect(markup.match(/type="password"/g) ?? []).toHaveLength(1);
  });

  it('never puts a value in a password field', () => {
    expect(markup).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  it('tells a reader without JavaScript that the form will not work', () => {
    expect(markup).toMatch(/<noscript>[\s\S]*needs JavaScript[\s\S]*<\/noscript>/i);
  });

  it('keeps the submit button a real submit, so Enter still works', () => {
    expect(markup).toMatch(/<button[^>]*type="submit"/i);
  });

  it('keeps both fields labelled, so the form is usable unhydrated', () => {
    expect(markup).toMatch(/<label[^>]*>[\s\S]*Email address[\s\S]*<input[^>]*type="email"/i);
    expect(markup).toMatch(/Password[\s\S]*<input[^>]*type="password"/i);
  });
});
