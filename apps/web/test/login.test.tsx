import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '@/components/login-form';
import { SessionProvider, useSession } from '@/lib/session';
import { api } from '@/lib/api-client';

function SessionProbe(): JSX.Element {
  const { session } = useSession();
  return <output data-testid="probe">{session === null ? 'signed-out' : session.role}</output>;
}

const renderLogin = () =>
  render(
    <SessionProvider>
      <LoginForm />
      <SessionProbe />
    </SessionProvider>,
  );

describe('signing in', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps the token in memory and never writes it down', async () => {
    vi.spyOn(api, 'login').mockResolvedValue({
      accessToken: 'a-token-value',
      tokenType: 'Bearer',
      expiresInSeconds: 900,
      role: 'MEMBER',
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText('Email address'), 'sarah.thompson@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('MEMBER'));

    // Nothing persisted anywhere a later page load could read it.
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain('a-token-value');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('a-token-value');
    expect(document.cookie).not.toContain('a-token-value');
  });

  it('gives the same message whatever the reason for failure', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('nope'));

    renderLogin();
    await userEvent.type(screen.getByLabelText('Email address'), 'nobody@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That email address and password did not match.');
    // Says nothing about whether the address exists, matching what the server does.
    expect(alert).not.toHaveTextContent(/unknown|not found|no account/i);
    expect(screen.getByTestId('probe')).toHaveTextContent('signed-out');
  });

  it('labels its fields and uses the right input types', () => {
    renderLogin();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('does not print a password anywhere on the page', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText('Password'), 'a-secret-value');
    expect(document.body.textContent).not.toContain('a-secret-value');
  });
});
