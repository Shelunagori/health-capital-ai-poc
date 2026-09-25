import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as DemoAccounts from '@/lib/demo-accounts';

/**
 * The demonstration accounts under the sign-in form. The shared password comes only from
 * configuration, so each case loads the form with that configuration set or unset.
 */
const PUBLISHED = `demo-${crypto.randomUUID()}`;

let loginSpy: ReturnType<typeof vi.fn>;

async function renderLoginWith(password: string | undefined): Promise<void> {
  vi.resetModules();
  vi.doMock('@/lib/demo-accounts', async (importOriginal) => ({
    ...(await importOriginal<typeof DemoAccounts>()),
    DEMO_PASSWORD: password,
  }));
  const { LoginForm } = await import('@/components/login-form');
  const session = await import('@/lib/session');
  const client = await import('@/lib/api-client');
  vi.spyOn(client.api, 'login').mockResolvedValue({
    accessToken: 'a-token-value',
    tokenType: 'Bearer',
    expiresInSeconds: 900,
    role: 'EMPLOYER_ADMIN',
  });
  loginSpy = client.api.login as unknown as ReturnType<typeof vi.fn>;
  const Probe = (): JSX.Element => {
    const { session: current } = session.useSession();
    return <output data-testid="probe">{current === null ? 'signed-out' : current.role}</output>;
  };
  render(
    <session.SessionProvider>
      <LoginForm />
      <Probe />
    </session.SessionProvider>,
  );
}

describe('demonstration accounts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/demo-accounts');
  });

  it('lists one fictional account per role, all on the reserved test domain', async () => {
    const { DEMO_ACCOUNTS } = await import('@/lib/demo-accounts');
    expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual(['Member', 'Employer admin', 'Support']);
    for (const account of DEMO_ACCOUNTS) expect(account.email).toMatch(/@example\.test$/);
  });

  describe('with the shared password published', () => {
    it('shows it, and signs straight in as the chosen role', async () => {
      await renderLoginWith(PUBLISHED);
      expect(screen.getByText(PUBLISHED)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Sign in as Employer admin/ }));

      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('EMPLOYER_ADMIN'));
      expect(loginSpy).toHaveBeenCalledWith('admin.northstar@example.test', PUBLISHED);
    });
  });

  describe('with no password published', () => {
    it('fills in the address, leaves the password to the visitor, and signs nobody in', async () => {
      await renderLoginWith(undefined);
      expect(screen.getByText(/ask whoever set this up/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /^Member/ }));

      expect(screen.getByLabelText('Email address')).toHaveValue('sarah.thompson@example.test');
      expect(screen.getByLabelText('Password')).toHaveValue('');
      expect(screen.getByLabelText('Password')).toHaveFocus();
      expect(loginSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('probe')).toHaveTextContent('signed-out');
    });
  });

  it('does not submit the form when an account is chosen', async () => {
    await renderLoginWith(undefined);
    for (const button of screen.getAllByRole('button', { name: /example\.test/ })) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });
});
