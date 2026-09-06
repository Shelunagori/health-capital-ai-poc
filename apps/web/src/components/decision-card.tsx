import type {
  EligibilityDecisionDto,
  ExplanationSource,
  AiStatus,
} from '@health-capital/contracts';
import { formatCents, formatDate, humaniseCategory } from '@/lib/format';
import { VerdictBadge } from './verdict-badge';

/**
 * One decision, shown to the member.
 *
 * Every number here comes from the decision object. Nothing is parsed out of the explanation and
 * nothing is recalculated in the browser, so what is displayed is what was decided.
 */
export interface DecisionCardProps {
  decision: EligibilityDecisionDto;
  explanation: string;
  explanationSource: ExplanationSource;
  aiStatus?: AiStatus | undefined;
}

export function DecisionCard({
  decision,
  explanation,
  explanationSource,
  aiStatus,
}: DecisionCardProps): JSX.Element {
  return (
    <article className="card" aria-labelledby={`decision-${decision.decisionId}`}>
      <header className="card__header">
        <h3 id={`decision-${decision.decisionId}`} className="card__title">
          {humaniseCategory(decision.treatmentCategory)}
        </h3>
        <VerdictBadge outcome={decision.outcome} />
      </header>

      <div className="card__body">
        <dl className="facts facts--boxed">
          <div className="facts__row">
            <dt>Amount asked about</dt>
            <dd data-testid="requested-amount">{formatCents(decision.requestedAmountCents)}</dd>
          </div>
          <div className="facts__row">
            <dt>Covered</dt>
            <dd data-testid="covered-amount">{formatCents(decision.coveredAmountCents)}</dd>
          </div>
          <div className="facts__row">
            <dt>Date of service</dt>
            <dd>{formatDate(decision.serviceDate)}</dd>
          </div>
        </dl>

        {decision.conditions.length > 0 && (
          <p className="conditions" data-testid="conditions">
            {decision.conditions.includes('RECEIPT_REQUIRED')
              ? 'Keep your receipt: this category needs one.'
              : decision.conditions.join(', ')}
          </p>
        )}

        <p className="explanation" data-testid="explanation">
          {explanation}
        </p>

        <details className="reasons">
          <summary>Why this decision</summary>
          <ul>
            {decision.reasons.map((reason) => (
              <li key={`${reason.ruleRef}-${reason.code}`}>
                <span className="rule-ref">{reason.ruleRef}</span> {reason.message}
              </li>
            ))}
          </ul>
          <p className="versions">
            Decided by rules version {decision.engineVersion}
            {decision.planConfigVersion === null
              ? ''
              : `, plan configuration ${decision.planConfigVersion}`}
            .
          </p>
        </details>

        <p className="source" data-testid="explanation-source">
          {explanationSource === 'ai'
            ? 'Wording written by the assistant. The decision itself came from the benefit rules.'
            : 'Wording written by the platform. The decision came from the benefit rules.'}
          {aiStatus === 'degraded' && ' The assistant’s wording was not used.'}
          {aiStatus === 'unavailable' && ' The assistant was unavailable.'}
        </p>
      </div>
    </article>
  );
}
