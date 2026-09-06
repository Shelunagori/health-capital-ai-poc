import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EligibilityDecisionDto } from '@health-capital/contracts';
import { DecisionCard } from '@/components/decision-card';
import { VerdictBadge } from '@/components/verdict-badge';
import { AskPanel } from '@/components/ask-panel';
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
