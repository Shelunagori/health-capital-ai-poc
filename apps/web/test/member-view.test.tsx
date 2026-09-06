import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EligibilityDecisionDto } from '@health-capital/contracts';
import { DecisionCard } from '@/components/decision-card';
import { VerdictBadge } from '@/components/verdict-badge';
import { AskPanel } from '@/components/ask-panel';
import { EligibilityForm } from '@/components/eligibility-form';
import { MemberView } from '@/components/member-view';
import { SessionProvider, useSession } from '@/lib/session';
import { api } from '@/lib/api-client';

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
      message:
        'Part of this expense is covered: the annual limit leaves less than the amount requested.',
    },
  ],
  conditions: ['RECEIPT_REQUIRED'],
  engineVersion: '1.0.0',
  planConfigVersion: 1,
  evaluatedAt: '2026-05-04T10:00:00.000Z',
};

describe('the verdict comes from the decision, not the wording', () => {
  it('shows the decision outcome even when the explanation says something else', () => {
    // The guard should stop this reaching a member, but the page must not depend on that.
    render(
      <DecisionCard
        decision={decision}
        explanation="Great news, this is fully covered!"
        explanationSource="ai"
      />,
    );

    const badge = screen.getByTestId('verdict-badge');
    expect(badge).toHaveAttribute('data-outcome', 'PARTIALLY_ELIGIBLE');
    expect(badge).toHaveTextContent('Partly covered');
  });

  it('renders amounts from the decision object, never parsed from the text', () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="You can claim 999.00 of this expense."
        explanationSource="ai"
      />,
    );

    expect(screen.getByTestId('covered-amount')).toHaveTextContent('150.00');
    expect(screen.getByTestId('requested-amount')).toHaveTextContent('300.00');
    expect(screen.getByTestId('covered-amount')).not.toHaveTextContent('999');
  });

  it.each([
    ['ELIGIBLE', 'Covered'],
    ['PARTIALLY_ELIGIBLE', 'Partly covered'],
    ['INELIGIBLE', 'Not covered'],
    ['UNDETERMINED', 'Could not check'],
  ] as const)('labels %s as %s', (outcome, label) => {
    render(<VerdictBadge outcome={outcome} />);
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent(label);
  });

  it('keeps the evidence collapsed until it is asked for', () => {
    const { container } = render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    // Collapsed, but present in the markup rather than conditionally rendered: the evidence is
    // one keystroke away and is never removed from the page.
    expect(details).toHaveTextContent('ELIG-LIMIT-04');
    expect(details).toHaveTextContent(/rules version 1.0.0/);
  });

  it('leaves the evidence reachable from the keyboard', async () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );

    // Native disclosure semantics, not a div pretending: the summary is the first tab stop in the
    // card, and the browser's own Enter and Space handling comes with it.
    await userEvent.tab();
    const summary = screen.getByText('Why this decision');
    expect(summary).toHaveFocus();
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.parentElement?.tagName).toBe('DETAILS');
  });

  it('shows the rule references behind the decision', async () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );
    await userEvent.click(screen.getByText('Why this decision'));
    expect(screen.getByText('ELIG-LIMIT-04')).toBeInTheDocument();
    expect(screen.getByText(/rules version 1.0.0/)).toBeInTheDocument();
  });

  it('shows a receipt condition when the decision carries one', () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );
    expect(screen.getByTestId('conditions')).toHaveTextContent('Keep your receipt');
  });
});

describe('where the wording came from is visible', () => {
  it('says when the assistant wrote it', () => {
    render(
      <DecisionCard decision={decision} explanation="Partly covered." explanationSource="ai" />,
    );
    expect(screen.getByTestId('explanation-source')).toHaveTextContent(/written by the assistant/i);
  });

  it('says when the assistant was overruled', () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
        aiStatus="degraded"
      />,
    );
    expect(screen.getByTestId('explanation-source')).toHaveTextContent(/wording was not used/i);
  });

  it('says when the assistant was unavailable', () => {
    render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
        aiStatus="unavailable"
      />,
    );
    expect(screen.getByTestId('explanation-source')).toHaveTextContent(/unavailable/i);
  });
});

describe('asking a question', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends the question once and then clears it, keeping no copy on the page', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue({
      decision: null,
      explanation: 'Tell me which kind of care this is for.',
      explanationSource: 'template',
      aiStatus: 'ok',
    });

    render(<AskPanel token="a-token" onResult={() => undefined} />);
    const box = screen.getByLabelText('Your question');
    await userEvent.type(box, 'can I claim physio');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(ask).toHaveBeenCalledWith('a-token', 'can I claim physio'));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('will not send an empty question', async () => {
    const ask = vi.spyOn(api, 'ask');
    render(<AskPanel token="a-token" onResult={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(ask).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Type a question first');
  });

  it('tells the member when the assistant cannot be reached', async () => {
    vi.spyOn(api, 'ask').mockRejectedValue(new Error('down'));
    render(<AskPanel token="a-token" onResult={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Your question'), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/i);
  });

  it('says the question is not stored', () => {
    render(<AskPanel token="a-token" onResult={() => undefined} />);
    expect(screen.getByText(/is not stored/i)).toBeInTheDocument();
  });
});

const UNAVAILABLE =
  'The assistant is unavailable right now. You can still check an expense using the form, which does not need it.';

/**
 * Renders inside a signed-in member session. The provider holds the token in memory with no way to
 * seed it, so a test signs in the same way the page does.
 */
function SignedInMember({ children }: { children: JSX.Element }): JSX.Element {
  const { session, signIn } = useSession();
  useEffect(() => {
    if (session === null) signIn('a-test-token', 'MEMBER', 900);
  }, [session, signIn]);
  return session === null ? <p>signing in</p> : children;
}

function renderMemberPage(): void {
  render(
    <SessionProvider>
      <SignedInMember>
        <MemberView />
      </SignedInMember>
    </SessionProvider>,
  );
}

async function ask(question: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Your question'), question);
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('recent checks keep one entry per thing that happened', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('shows the assistant-unavailable notice once when the assistant is unavailable', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue({
      decision: null,
      explanation: UNAVAILABLE,
      explanationSource: 'template',
      aiStatus: 'unavailable',
    });

    renderMemberPage();
    await ask('can I claim physio');

    const shown = await screen.findAllByTestId('clarification');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent(UNAVAILABLE);
  });

  it('does not add a second copy when the same notice comes back again', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue({
      decision: null,
      explanation: UNAVAILABLE,
      explanationSource: 'template',
      aiStatus: 'unavailable',
    });

    renderMemberPage();
    await ask('can I claim physio');
    await screen.findByTestId('clarification');
    await ask('and what about dental');

    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId('clarification')).toHaveLength(1);
  });

  it('keeps a different answer that follows the notice', async () => {
    const asked = vi
      .spyOn(api, 'ask')
      .mockResolvedValueOnce({
        decision: null,
        explanation: UNAVAILABLE,
        explanationSource: 'template',
        aiStatus: 'unavailable',
      })
      .mockResolvedValueOnce({
        decision: null,
        explanation: 'Tell me which kind of care this is for.',
        explanationSource: 'template',
        aiStatus: 'ok',
      });

    renderMemberPage();
    await ask('can I claim physio');
    await screen.findByTestId('clarification');
    await ask('something else');

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(2));
    const shown = await screen.findAllByTestId('clarification');
    expect(shown).toHaveLength(2);
    expect(shown[0]).toHaveTextContent('Tell me which kind of care this is for.');
    expect(shown[1]).toHaveTextContent(UNAVAILABLE);
  });

  it('keeps both when the assistant asks the same thing back twice', async () => {
    // Not the unavailable notice: the assistant answered, and asked about a different expense each
    // time. Identical wording does not make the second one a repeat of the first.
    vi.spyOn(api, 'ask').mockResolvedValue({
      decision: null,
      explanation: 'Tell me which kind of care this is for.',
      explanationSource: 'template',
      aiStatus: 'ok',
    });

    renderMemberPage();
    await ask('what about that appointment');
    await screen.findByTestId('clarification');
    await ask('and the other one');

    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId('clarification')).toHaveLength(2));
  });

  it('keeps every deterministic check, including two checks of the same expense', async () => {
    let issued = 0;
    vi.spyOn(api, 'evaluate').mockImplementation(() => {
      issued += 1;
      return Promise.resolve({
        decision: {
          ...decision,
          decisionId: `99999999-9999-4999-8999-00000000010${issued}`,
        },
        explanation: 'Part of this expense is covered.',
        explanationSource: 'template',
      });
    });

    renderMemberPage();
    const check = screen.getByRole('button', { name: 'Check this expense' });
    await userEvent.click(check);
    await screen.findByTestId('verdict-badge');
    await userEvent.click(check);

    await waitFor(() => expect(screen.getAllByTestId('verdict-badge')).toHaveLength(2));
  });
});

describe('dates on the member screen read like dates, not database values', () => {
  const ISO_LOOKING = /\d{4}-\d{2}-\d{2}/;

  it('shows the date of service in words', () => {
    const { container } = render(
      <DecisionCard
        decision={decision}
        explanation="Partly covered."
        explanationSource="template"
      />,
    );
    expect(screen.getByText('4 May 2026')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(ISO_LOOKING);
  });

  it('keeps the date input itself in the format the browser and the API need', () => {
    render(<EligibilityForm token="a-token" onResult={() => undefined} />);
    const field = screen.getByLabelText('Date of service');
    expect(field).toHaveAttribute('type', 'date');
    // The control only accepts this shape, and it is what the API is sent. Presentation is
    // everywhere else; this one value stays technical on purpose.
    expect((field as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
