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
import { Skeleton } from './skeleton';

/** One answer, from either route, so the page renders both the same way. */
interface Answer {
  decision: EvaluateEligibilityResponse['decision'] | null;
  explanation: string;
  explanationSource: EvaluateEligibilityResponse['explanationSource'];
  aiStatus?: AskGuidanceResponse['aiStatus'];
}

/**
 * Whether this answer is the assistant-unavailable notice repeating itself.
 *
 * Asking twice while the assistant is unavailable produces that one fixed sentence both times, and
 * a second copy of it tells the member nothing the first did not. Nothing else is treated as a
 * repeat: a decision is a real check with its own decision, and a question the assistant asked back
 * stands on its own even when it is worded identically, because it was asked about something else.
 */
function repeatsUnavailableNotice(answer: Answer, answers: readonly Answer[]): boolean {
  const mostRecent = answers[0];
  return (
    mostRecent !== undefined &&
    answer.decision === null &&
    mostRecent.decision === null &&
    answer.aiStatus === 'unavailable' &&
    mostRecent.aiStatus === 'unavailable' &&
    mostRecent.explanation === answer.explanation
  );
}

/** The initials shown in the corner mark. Two letters, or one, or nothing at all while loading. */
function initials(profile: MemberSelfDto | null): string {
  if (profile === null) return '••';
  return `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase();
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
  const [loading, setLoading] = useState(true);
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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (token === null) return <p>You are signed out.</p>;

  const addAnswer = (answer: Answer): void =>
    setAnswers((previous) =>
      repeatsUnavailableNotice(answer, previous) ? previous : [answer, ...previous],
    );
  const activeEnrollment = enrollments.find((enrollment) => enrollment.status === 'ACTIVE') ?? null;

  return (
    <div className="stack">
      <header className="appbar">
        <div className="appbar__identity">
          <span className="appbar__mark" aria-hidden="true">
            {initials(profile)}
          </span>
          <div className="appbar__text">
            <h1>Health Capital</h1>
            <p className="subtitle">
              {profile === null
                ? 'Loading your details…'
                : `${profile.firstName} ${profile.lastName}`}
            </p>
          </div>
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

      <section aria-labelledby="cover-heading" className="cover">
        <h2 id="cover-heading" className="cover__heading">
          Your cover
        </h2>

        {loading ? (
          <div className="cover__facts" aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading your cover.
            </p>
            <div className="cover__fact" aria-hidden="true">
              <Skeleton className="skeleton--short" />
              <Skeleton className="skeleton--half" />
            </div>
            <div className="cover__fact" aria-hidden="true">
              <Skeleton className="skeleton--short" />
              <Skeleton className="skeleton--half" />
            </div>
            <div className="cover__fact" aria-hidden="true">
              <Skeleton className="skeleton--short" />
              <Skeleton className="skeleton--half" />
            </div>
          </div>
        ) : activeEnrollment === null ? (
          <p className="hint">No active enrollment.</p>
        ) : (
          <dl className="cover__facts">
            <div className="cover__fact">
              <dt>Employer</dt>
              <dd>{activeEnrollment.employerName}</dd>
            </div>
            <div className="cover__fact">
              <dt>Plan</dt>
              <dd>{activeEnrollment.planName}</dd>
            </div>
            <div className="cover__fact">
              <dt>Cover began</dt>
              <dd>{formatDate(activeEnrollment.effectiveFrom)}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="workspace">
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
        <section aria-labelledby="answers-heading" className="panel workspace__results">
          <div className="section-head">
            <div>
              <h2 id="answers-heading">Recent checks</h2>
              <p className="hint">
                This session only. Nothing here is kept once you close the page.
              </p>
            </div>
          </div>
          {answers.length === 0 ? (
            <p className="empty">Nothing checked yet in this session.</p>
          ) : (
            <div className="stack">
              {answers.map((answer, index) =>
                answer.decision === null ? (
                  <p key={`clarify-${index}`} className="notice" data-testid="clarification">
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
    </div>
  );
}
