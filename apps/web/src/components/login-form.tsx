'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { useSession } from '@/lib/session';

/**
 * Sign in. The token returned goes into memory and nowhere else.
 *
 * Every failure shows the same message, because the server gives the same answer whether the
 * address is unknown or the password is wrong, and the page should not undo that.
 */
export function LoginForm(): JSX.Element {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(email, password);
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

  return (
    <form
      className="form"
      onSubmit={(event) => void onSubmit(event)}
      aria-labelledby="signin-heading"
    >
      <h2 id="signin-heading">Sign in</h2>

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
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="hint">
        Every account in this demonstration is fictional. Ask whoever set it up for the shared
        password.
      </p>
    </form>
  );
}
