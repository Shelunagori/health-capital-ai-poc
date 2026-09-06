import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  EmployerMemberSummaryDto,
  EmployerPlanDto,
  Role,
  SupportAuditEventDto,
} from '@health-capital/contracts';
import { EmployerView } from '@/components/employer-view';
import { SupportView } from '@/components/support-view';
import { SessionProvider, useSession } from '@/lib/session';
import { ApiError, api } from '@/lib/api-client';

const EMPLOYER_ID = '11111111-1111-4111-8111-000000000001';
const MEMBER_ID = '33333333-3333-4333-8333-000000000001';

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
    {
      category: 'COSMETIC',
      covered: false,
      annualLimitCents: null,
      receiptRequired: false,
      ruleRef: 'PLAN-COS-09',
    },
  ],
};

const roster: EmployerMemberSummaryDto[] = [
  {
    memberId: MEMBER_ID,
    firstName: 'Sarah',
    lastName: 'Thompson',
    employeeId: 'NS-1001',
    planName: 'Northstar Standard Health Capital',
    status: 'ACTIVE',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
  },
];

/**
 * Renders inside a signed-in session. The provider holds the token in memory with no way to seed
 * it, which is the behaviour under test elsewhere, so a test signs in the same way the page does.
 */
function SignedIn({ role, children }: { role: Role; children: JSX.Element }): JSX.Element {
  const { session, signIn } = useSession();
  useEffect(() => {
    if (session === null) signIn('a-test-token', role, 900);
  }, [session, signIn, role]);
  return session === null ? <p>signing in</p> : children;
}

function withSession(ui: JSX.Element, role: Role = 'SUPPORT'): JSX.Element {
  return (
    <SessionProvider>
      <SignedIn role={role}>{ui}</SignedIn>
    </SessionProvider>
  );
}

describe('the employer view shows plan rules and who is enrolled, and nothing else', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'employerPlans').mockResolvedValue({ plans: [plan] });
    vi.spyOn(api, 'employerMembers').mockResolvedValue({ members: roster });
  });

  it('shows the plan rules', async () => {
    render(withSession(<EmployerView employerId={EMPLOYER_ID} />, 'EMPLOYER_ADMIN'));
    expect(
      await screen.findByRole('heading', { name: 'Northstar Standard Health Capital' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Dental' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Cosmetic' })).toBeInTheDocument();
  });

  it('shows who is enrolled, with no treatment or money against anyone', async () => {
    render(withSession(<EmployerView employerId={EMPLOYER_ID} />, 'EMPLOYER_ADMIN'));
    const roster = await screen.findByTestId('roster');
    expect(roster).toHaveTextContent('Sarah Thompson');
    expect(roster).toHaveTextContent('NS-1001');

    // Nothing about this person's care or money: no category, no amount, no currency.
    const rosterText = roster.textContent ?? '';
    expect(rosterText).not.toMatch(/dental|vision|therapy|prescription|cosmetic/i);
    expect(rosterText).not.toMatch(/[\u20ac$\u00a3]/);

    // And none of the elements a decision would render into exist on this page at all.
    expect(screen.queryByTestId('verdict-badge')).toBeNull();
    expect(screen.queryByTestId('covered-amount')).toBeNull();
    expect(screen.queryByTestId('explanation')).toBeNull();
  });

  it('offers no control that could fetch member health or financial data', async () => {
    render(withSession(<EmployerView employerId={EMPLOYER_ID} />, 'EMPLOYER_ADMIN'));
    await screen.findByTestId('roster');
    for (const label of [/look up/i, /view decisions/i, /ledger/i, /care request/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('never calls a member-scoped endpoint', async () => {
    const profile = vi.spyOn(api, 'memberProfile');
    const summary = vi.spyOn(api, 'memberSummary');
    render(withSession(<EmployerView employerId={EMPLOYER_ID} />, 'EMPLOYER_ADMIN'));
    await screen.findByTestId('roster');
    expect(profile).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });
});

describe('the support view requires a reason and a case reference', () => {
  const auditEvent: SupportAuditEventDto = {
    id: '88888888-8888-4888-8888-000000000001',
    occurredAt: '2026-05-04T10:00:00.000Z',
    traceId: 'trace-1',
    actorUserId: '77777777-7777-4777-8777-000000000003',
    actorRole: 'SUPPORT',
    action: 'PRIVILEGED_READ',
    outcome: 'ALLOW',
    resourceType: 'MEMBER',
    engineVersion: null,
    planConfigVersion: null,
    aiProvider: null,
    aiModel: null,
    promptTemplateId: null,
    promptVersion: null,
    reasonCode: 'BENEFITS_DISPUTE',
    caseRef: 'CASE-0042',
    details: {},
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'employers').mockResolvedValue({
      employers: [
        { employerId: EMPLOYER_ID, name: 'Northstar Industries', employerRef: 'EMP-001' },
      ],
    });
    vi.spyOn(api, 'employerMembers').mockResolvedValue({ members: roster });
    vi.spyOn(api, 'auditEvents').mockResolvedValue({ events: [auditEvent], count: 1 });
  });

  const chooseMember = async (): Promise<void> => {
    await userEvent.selectOptions(await screen.findByLabelText('Employer'), EMPLOYER_ID);
    await waitFor(() => expect(screen.getByLabelText('Member')).not.toBeDisabled());
    await userEvent.selectOptions(screen.getByLabelText('Member'), MEMBER_ID);
  };

  it('passes the reason code and case reference to the server', async () => {
    const profile = vi.spyOn(api, 'memberProfile').mockResolvedValue({
      memberId: MEMBER_ID,
      firstName: 'Sarah',
      lastName: 'Thompson',
      dateOfBirth: '1987-03-14',
      addressLine: '14 Alder Street',
      city: 'Riverton',
      postalCode: '40218',
    });

    render(withSession(<SupportView />));
    await chooseMember();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'BENEFITS_DISPUTE');
    await userEvent.type(screen.getByLabelText('Case reference'), 'CASE-0042');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() =>
      expect(profile).toHaveBeenCalledWith(
        expect.anything(),
        MEMBER_ID,
        'BENEFITS_DISPUTE',
        'CASE-0042',
      ),
    );
    expect(await screen.findByTestId('support-profile')).toHaveTextContent('Sarah Thompson');
  });

  it('explains a refusal in terms of what was missing', async () => {
    vi.spyOn(api, 'memberProfile').mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'not allowed'));

    render(withSession(<SupportView />));
    await chooseMember();
    // Well-formed here, so the browser submits and the server's refusal is what gets shown.
    await userEvent.type(screen.getByLabelText('Case reference'), 'CASE-9999');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/reason code and a case reference/i);
  });

  it('constrains the case reference in the form as well as on the server', async () => {
    render(withSession(<SupportView />));
    const field = await screen.findByLabelText('Case reference');
    expect(field).toHaveAttribute('pattern', '[A-Z]{2,6}-[0-9]{1,8}');
    expect(field).toBeRequired();
  });

  it('offers only reason codes from the fixed list, with no free-text alternative', async () => {
    render(withSession(<SupportView />));
    const reason = await screen.findByLabelText('Reason');
    expect(reason.tagName).toBe('SELECT');
    expect(reason.querySelectorAll('option')).toHaveLength(5);
  });

  it('shows the audit trail without amounts, categories or member identifiers', async () => {
    render(withSession(<SupportView />));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    const table = await screen.findByTestId('audit-table');
    expect(table).toHaveTextContent('PRIVILEGED_READ');
    expect(table).toHaveTextContent('CASE-0042');
    // The view model has no field for these, so there is nothing to render.
    expect(table).not.toHaveTextContent(MEMBER_ID);
    expect(table).not.toHaveTextContent(/DENTAL|cents|€/);
  });

  describe('the audit columns say what they actually contain', () => {
    /** Renders the desk, loads the trail, and reads the headers and the first row in column order. */
    const auditTable = async (): Promise<{ headers: string[]; firstRow: string[] }> => {
      render(withSession(<SupportView />));
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      const table = await screen.findByTestId('audit-table');
      const row = table.querySelectorAll('tbody tr')[0];
      return {
        headers: [...table.querySelectorAll('thead th')].map((th) => th.textContent ?? ''),
        firstRow: [...(row?.children ?? [])].map((cell) => cell.textContent ?? ''),
      };
    };

    it('keeps the reason and the case reference in separate columns', async () => {
      const { headers } = await auditTable();
      expect(headers).toEqual(['When', 'Action', 'Outcome', 'Role', 'Reason', 'Case reference']);
    });

    it('renders the reason code under Reason, not the case reference', async () => {
      // The bug this replaces: the Reason header sat above the case reference.
      const { firstRow } = await auditTable();
      expect(firstRow[4]).toBe('benefits dispute');
      expect(firstRow[4]).not.toBe('CASE-0042');
    });

    it('renders the case reference under Case reference', async () => {
      const { firstRow } = await auditTable();
      expect(firstRow[5]).toBe('CASE-0042');
    });

    it('humanises the reason code the same way the picker does', async () => {
      render(withSession(<SupportView />));
      const options = [...(await screen.findByLabelText('Reason')).querySelectorAll('option')];
      expect(options.map((option) => option.textContent)).toContain('benefits dispute');
    });

    it('shows a dash when either is absent', async () => {
      vi.spyOn(api, 'auditEvents').mockResolvedValue({
        events: [{ ...auditEvent, reasonCode: null, caseRef: null }],
        count: 1,
      });
      const { firstRow } = await auditTable();
      expect(firstRow[4]).toBe('—');
      expect(firstRow[5]).toBe('—');
    });

    it('adds no other column, so nothing else about the event is shown', async () => {
      const { firstRow } = await auditTable();
      expect(firstRow).toHaveLength(6);
      expect(firstRow.join(' ')).not.toMatch(/DENTAL|cents|€|[0-9a-f]{8}-[0-9a-f]{4}/);
    });
  });
});
