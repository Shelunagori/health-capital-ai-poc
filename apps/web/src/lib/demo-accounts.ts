/**
 * The fictional accounts a visitor can use to try the demonstration.
 *
 * The addresses are synthetic seed data and are already documented. The shared password is not
 * written here, or anywhere in the repository: it is read from `NEXT_PUBLIC_DEMO_PASSWORD`, set on
 * the hosting platform for a public demonstration. Being `NEXT_PUBLIC_`, it is compiled into the
 * browser bundle, which is the intent: anyone may sign in to these accounts. When it is unset the
 * page lists the accounts and leaves the password to be shared out of band, as before.
 */
export interface DemoAccount {
  role: string;
  email: string;
  /** What signing in as this role lets a visitor see. */
  shows: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: 'Member',
    email: 'sarah.thompson@example.test',
    shows: 'Check an expense, ask the assistant, see balances.',
  },
  {
    role: 'Employer admin',
    email: 'admin.northstar@example.test',
    shows: 'Plan and roster only. No care requests or balances.',
  },
  {
    role: 'Support',
    email: 'support.desk@example.test',
    shows: 'Reasoned member lookup and the audit trail.',
  },
];

const configured = process.env['NEXT_PUBLIC_DEMO_PASSWORD']?.trim();

/** The shared demonstration password, or undefined when it is not published. */
export const DEMO_PASSWORD: string | undefined =
  configured === undefined || configured === '' ? undefined : configured;
