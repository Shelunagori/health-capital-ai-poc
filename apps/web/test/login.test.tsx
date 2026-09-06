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

/**
 * If the page never hydrates, the submit handler never attaches and the browser submits the form
 * itself. A form with no method defaults to GET, which would put the password in the query string,
 * the address bar and the browser history. These assert the markup that prevents it, because they
 * have to hold whether or not any JavaScript ran.
 */
describe('the form cannot leak a password through the URL', () => {
  it('declares POST, so a native submission uses a request body', () => {
    const { container } = renderLogin();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post');
  });

  it('puts no password field inside anything that would submit by GET', () => {
    const { container } = renderLogin();
    for (const field of container.querySelectorAll('input[type="password"]')) {
      const owner = field.closest('form');
      expect(
        owner,
        'a password field outside a form would submit with the page URL',
      ).not.toBeNull();
      expect(owner?.getAttribute('method')?.toLowerCase()).toBe('post');
    }
  });

  it('submits to this origin and nowhere else', () => {
    const { container } = renderLogin();
    const action = container.querySelector('form')?.getAttribute('action') ?? '';
    expect(action.startsWith('/')).toBe(true);
    expect(action).not.toMatch(/^https?:/);
  });

  it('keeps the submit button a real submit, so Enter still works', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
  });
});

describe('the hydrated flow sends credentials in a JSON body', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts to the sign-in endpoint with the values in the body, not the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accessToken: 'a-token-value',
          tokenType: 'Bearer',
          expiresInSeconds: 900,
          role: 'MEMBER',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    await userEvent.type(screen.getByLabelText('Email address'), 'sarah.thompson@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-password-value');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/auth\/login$/);
    expect(init.method).toBe('POST');
    // The URL carries neither value; both are in the body.
    expect(url).not.toContain('a-password-value');
    expect(url).not.toContain('sarah.thompson');
    // The body is a JSON string; reading it as one keeps the assertion honest.
    expect(typeof init.body).toBe('string');
    expect(init.body as string).toContain('a-password-value');

    vi.unstubAllGlobals();
  });

  it('leaves the address bar untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: 't',
            tokenType: 'Bearer',
            expiresInSeconds: 900,
            role: 'MEMBER',
          }),
      }),
    );

    renderLogin();
    await userEvent.type(screen.getByLabelText('Email address'), 'sarah.thompson@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'another-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('MEMBER'));
    expect(window.location.search).not.toContain('password');
    expect(window.location.href).not.toContain('another-password');

    vi.unstubAllGlobals();
  });
});
