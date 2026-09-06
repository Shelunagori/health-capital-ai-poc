'use client';

import { useEffect, useState } from 'react';
import type {
  AskGuidanceResponse,
  EnrollmentDto,
  EvaluateEligibilityResponse,
  MemberSelfDto,
} from '@health-capital/contracts';
import { api } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { AskPanel } from './ask-panel';
import { DecisionCard } from './decision-card';
import { EligibilityForm } from './eligibility-form';

/** One answer, from either route, so the page renders both the same way. */
interface Answer {
  decision: EvaluateEligibilityResponse['decision'] | null;
  explanation: string;
  explanationSource: EvaluateEligibilityResponse['explanationSource'];
  aiStatus?: AskGuidanceResponse['aiStatus'];
}

/**
 * The member's page: who they are, what they are enrolled in, and the two ways to check an expense.
 *
 * Both routes end at the same card, because both produce the same kind of thing: a decision made by
 * the rules, with an explanation attached. Only the wording differs in where it came from.
 */
export function MemberView(): JSX.Element {
  const { session, signOut } = useSession();
  const token = session?.token ?? null;

  const [profile, setProfile] = useState<MemberSelfDto | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentDto[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const [loadedProfile, loadedEnrollments] = await Promise.all([
          api.profile(token),
          api.enrollments(token),
        ]);
        if (cancelled) return;
        setProfile(loadedProfile);
        setEnrollments(loadedEnrollments.enrollments);
      } catch {
        if (!cancelled) setLoadError('Your details could not be loaded.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (token === null) return <p>You are signed out.</p>;

  const addAnswer = (answer: Answer): void => setAnswers((previous) => [answer, ...previous]);
  const activeEnrollment = enrollments.find((enrollment) => enrollment.status === 'ACTIVE') ?? null;

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Health Capital</h1>
          <p className="subtitle">
            {profile === null
              ? 'Loading your details…'
              : `${profile.firstName} ${profile.lastName}`}
          </p>
        </div>
        <button type="button" className="button button--quiet" onClick={signOut}>
          Sign out
        </button>
      </header>

      {loadError !== null && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}

      <section aria-labelledby="cover-heading" className="panel">
        <h2 id="cover-heading">Your cover</h2>
        {activeEnrollment === null ? (
          <p>No active enrollment.</p>
        ) : (
          <dl className="facts">
            <div className="facts__row">
              <dt>Employer</dt>
              <dd>{activeEnrollment.employerName}</dd>
            </div>
            <div className="facts__row">
              <dt>Plan</dt>
              <dd>{activeEnrollment.planName}</dd>
            </div>
            <div className="facts__row">
              <dt>Cover began</dt>
              <dd>{formatDate(activeEnrollment.effectiveFrom)}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="two-up">
        <section className="panel">
          <AskPanel
            token={token}
            onResult={(result) =>
              addAnswer({
                decision: result.decision,
                explanation: result.explanation,
                explanationSource: result.explanationSource,
                aiStatus: result.aiStatus,
              })
            }
          />
        </section>

        <section className="panel">
          <EligibilityForm
            token={token}
            onResult={(result) =>
              addAnswer({
                decision: result.decision,
                explanation: result.explanation,
                explanationSource: result.explanationSource,
              })
            }
          />
        </section>
      </div>

      <section aria-labelledby="answers-heading" className="panel">
        <h2 id="answers-heading">Recent checks</h2>
        {answers.length === 0 ? (
          <p>Nothing checked yet in this session.</p>
        ) : (
          <div className="stack">
            {answers.map((answer, index) =>
              answer.decision === null ? (
                <p key={`clarify-${index}`} className="explanation" data-testid="clarification">
                  {answer.explanation}
                </p>
              ) : (
                <DecisionCard
                  key={answer.decision.decisionId}
                  decision={answer.decision}
                  explanation={answer.explanation}
                  explanationSource={answer.explanationSource}
                  aiStatus={answer.aiStatus}
                />
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
