import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  EligibilityDecisionDto,
  EmployerMemberSummaryDto,
  EmployerPlanDto,
  Role,
} from '@health-capital/contracts';
import { DecisionCard } from '@/components/decision-card';
import { EligibilityForm } from '@/components/eligibility-form';
import { EmployerView } from '@/components/employer-view';
import { LoginForm } from '@/components/login-form';
import { MemberView } from '@/components/member-view';
import { SupportView } from '@/components/support-view';
import { SessionProvider, useSession } from '@/lib/session';
import { api } from '@/lib/api-client';
import { describeViolations, findAccessibilityViolations } from './helpers/axe';

const EMPLOYER_ID = '11111111-1111-4111-8111-000000000001';

const decision: EligibilityDecisionDto = {
  decisionId: '99999999-9999-4999-8999-000000000001',
  careRequestId: '99999999-9999-4999-8999-000000000002',
  outcome: 'PARTIALLY_ELIGIBLE',
  coveredAmountCents: 15_000,
  requestedAmountCents: 30_000,
  treatmentCategory: 'DENTAL',
  serviceDate: '2026-05-04',
  reasons: [
    {
      ruleRef: 'ELIG-LIMIT-04',
      code: 'PARTIALLY_COVERED',
      message: 'The annual limit leaves less.',
    },
  ],
  conditions: ['RECEIPT_REQUIRED'],
  engineVersion: '1.0.0',
  planConfigVersion: 1,
  evaluatedAt: '2026-05-04T10:00:00.000Z',
};

const plan: EmployerPlanDto = {
  planId: '22222222-2222-4222-8222-000000000001',
  name: 'Northstar Standard Health Capital',
  planYearStart: '2026-01-01',
  planYearEnd: '2026-12-31',
  planConfigVersion: 1,
  planConfigAsOf: '2026-01-05T09:00:00.000Z',
  coverage: [
    {
      category: 'DENTAL',
      covered: true,
      annualLimitCents: 80_000,
      receiptRequired: true,
      ruleRef: 'PLAN-DEN-05',
    },
  ],
};

const roster: EmployerMemberSummaryDto[] = [
  {
    memberId: '33333333-3333-4333-8333-000000000001',
    firstName: 'Sarah',
    lastName: 'Thompson',
    employeeId: 'NS-1001',
    planName: 'Northstar Standard Health Capital',
    status: 'ACTIVE',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
  },
];

function SignedIn({ role, children }: { role: Role; children: JSX.Element }): JSX.Element {
  const { session, signIn } = useSession();
  useEffect(() => {
    if (session === null) signIn('a-test-token', role, 900);
  }, [session, signIn, role]);
  return session === null ? <p>signing in</p> : children;
}

const withSession = (ui: JSX.Element, role: Role = 'SUPPORT'): JSX.Element => (
  <SessionProvider>
    <SignedIn role={role}>{ui}</SignedIn>
  </SessionProvider>
);

async function expectAccessible(container: HTMLElement): Promise<void> {
  const violations = await findAccessibilityViolations(container);
  expect(violations.length, describeViolations(violations)).toBe(0);
}

describe('the pages pass the mechanical accessibility rules', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'employerPlans').mockResolvedValue({ plans: [plan] });
    vi.spyOn(api, 'employerMembers').mockResolvedValue({ members: roster });
    vi.spyOn(api, 'employers').mockResolvedValue({
      employers: [
        { employerId: EMPLOYER_ID, name: 'Northstar Industries', employerRef: 'EMP-001' },
      ],
    });
    vi.spyOn(api, 'auditEvents').mockResolvedValue({ events: [], count: 0 });
    vi.spyOn(api, 'profile').mockResolvedValue({
      memberId: '33333333-3333-4333-8333-000000000001',
      firstName: 'Sarah',
      lastName: 'Thompson',
      dateOfBirth: '1987-03-14',
      addressLine: '14 Alder Street',
      city: 'Riverton',
      postalCode: '40218',
    });
    vi.spyOn(api, 'enrollments').mockResolvedValue({
      enrollments: [
        {
          enrollmentId: '44444444-4444-4444-8444-000000000001',
          employerName: 'Northstar Industries',
          planName: 'Northstar Standard Health Capital',
          status: 'ACTIVE',
          effectiveFrom: '2024-01-01',
          effectiveTo: null,
        },
      ],
    });
  });

  it('sign in', async () => {
    const { container } = render(
      <SessionProvider>
        <LoginForm />
      </SessionProvider>,
    );
    await expectAccessible(container);
  });

  it('a decision', async () => {
    const { container } = render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );
    await expectAccessible(container);
  });

  it('the expense form', async () => {
    const { container } = render(<EligibilityForm token="t" onResult={() => undefined} />);
    await expectAccessible(container);
  });

  it('the employer view, including its tables', async () => {
    const { container } = render(
      withSession(<EmployerView employerId={EMPLOYER_ID} />, 'EMPLOYER_ADMIN'),
    );
    await screen.findByTestId('roster');
    await expectAccessible(container);
  });

  it('the member page while its details are still loading', async () => {
    const { container } = render(withSession(<MemberView />, 'MEMBER'));
    await expectAccessible(container);
  });

  it('the member page once its details have arrived', async () => {
    const { container } = render(withSession(<MemberView />, 'MEMBER'));
    await screen.findByText('Sarah Thompson');
    await expectAccessible(container);
  });

  it('the support desk', async () => {
    const { container } = render(withSession(<SupportView />));
    await screen.findByLabelText('Employer');
    await expectAccessible(container);
  });
});

describe('every control can be reached and named without a mouse', () => {
  it('reaches each field of the sign-in form in order by keyboard', async () => {
    render(
      <SessionProvider>
        <LoginForm />
      </SessionProvider>,
    );
    await userEvent.tab();
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus();
  });

  it('submits the expense form from the keyboard alone', async () => {
    const evaluate = vi.spyOn(api, 'evaluate').mockResolvedValue({
      decision,
      explanation: 'Partly covered.',
      explanationSource: 'template',
    });

    render(<EligibilityForm token="a-token" onResult={() => undefined} />);
    screen.getByLabelText('Kind of care').focus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(evaluate).toHaveBeenCalled());
  });

  it('gives every control an accessible name', () => {
    render(<EligibilityForm token="t" onResult={() => undefined} />);
    for (const control of [
      ...screen.getAllByRole('combobox'),
      ...screen.getAllByRole('spinbutton'),
      ...screen.getAllByRole('button'),
    ]) {
      expect(control).toHaveAccessibleName();
    }
  });

  it('announces errors rather than only showing them', async () => {
    vi.spyOn(api, 'evaluate').mockRejectedValue(new Error('nope'));
    render(<EligibilityForm token="a-token" onResult={() => undefined} />);
    // A well-formed amount, so the browser submits and the failure comes from the server.
    await userEvent.click(screen.getByRole('button', { name: 'Check this expense' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('announces that the member page is loading without reading out empty placeholders', async () => {
    render(withSession(<MemberView />, 'MEMBER'));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/loading your cover/i);
    // The shapes themselves are decoration and are hidden from the accessibility tree.
    for (const placeholder of document.querySelectorAll('.skeleton')) {
      expect(placeholder.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('keeps the verdict readable without relying on colour alone', () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );
    // The badge carries words, not just a tint.
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Partly covered');
  });
});
