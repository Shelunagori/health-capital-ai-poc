'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from '@/lib/demo-accounts';
import { useSession } from '@/lib/session';

/**
 * Sign in. The token returned goes into memory and nowhere else.
 *
 * Every failure shows the same message, because the server gives the same answer whether the
 * address is unknown or the password is wrong, and the page should not undo that.
 *
 * The form declares `method="post"`. When it is hydrated the submit handler prevents the default
 * and sends JSON to the API, so the method is never used. It matters when hydration has not
 * happened: a form with no method defaults to GET, and a browser submitting this one would put the
 * password in the query string, the address bar and the history. Declaring POST means the worst
 * case is a discarded request body rather than a credential written into the URL.
 *
 * Below the form the fictional demonstration accounts are listed, one button per role. When the
 * shared password is published (`NEXT_PUBLIC_DEMO_PASSWORD`) a button signs straight in as that
 * role; when it is not, it fills in the address and leaves the password to the visitor.
 */
export function LoginForm(): JSX.Element {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  async function signInWith(address: string, secret: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(address, secret);
      signIn(result.accessToken, result.role, result.expiresInSeconds);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? 'The service could not be reached.'
          : 'That email address and password did not match.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await signInWith(email, password);
  }

  function chooseDemoAccount(account: DemoAccount): void {
    setEmail(account.email);
    if (DEMO_PASSWORD === undefined) {
      setPassword('');
      passwordInput.current?.focus();
      return;
    }
    setPassword(DEMO_PASSWORD);
    void signInWith(account.email, DEMO_PASSWORD);
  }

  return (
    <form
      className="form"
      // Never used while hydrated; the guard against a password reaching the URL if it is not.
      method="post"
      action="/"
      onSubmit={(event) => void onSubmit(event)}
      aria-labelledby="signin-heading"
    >
      <div>
        <h2 id="signin-heading">Sign in</h2>
        <p className="hint">Use a demonstration account below, or one you were given.</p>
      </div>

      <noscript>
        <p className="error">
          Signing in needs JavaScript. Without it your details cannot be sent securely, so this form
          will not work.
        </p>
      </noscript>

      <label className="field">
        <span className="field__label">Email address</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          ref={passwordInput}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="button button--full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <section className="demo" aria-labelledby="demo-heading">
        <h3 id="demo-heading" className="demo__heading">
          Demonstration accounts
        </h3>
        <p className="hint">
          Every account is fictional and holds synthetic data only.{' '}
          {DEMO_PASSWORD === undefined ? (
            'Choose one to fill in the address; ask whoever set this up for the shared password.'
          ) : (
            <>
              Choose one to sign in, or use its address with the password{' '}
              <code className="demo__secret">{DEMO_PASSWORD}</code>.
            </>
          )}
        </p>
        <ul className="demo__list">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                className="demo__account"
                disabled={busy}
                onClick={() => chooseDemoAccount(account)}
              >
                <span className="demo__role">
                  {DEMO_PASSWORD === undefined ? account.role : `Sign in as ${account.role}`}
                </span>
                <span className="demo__email">{account.email}</span>
                <span className="demo__shows">{account.shows}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </form>
  );
}
