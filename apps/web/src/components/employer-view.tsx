'use client';

import { useEffect, useState } from 'react';
import type { EmployerMemberSummaryDto, EmployerPlanDto } from '@health-capital/contracts';
import { api } from '@/lib/api-client';
import { formatCents, formatDate, humaniseCategory } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * What an employer administrator sees: the plan they offer, and who is enrolled in it.
 *
 * There is no treatment, no amount spent, no balance and no decision anywhere on this page, and no
 * control that could fetch one. The server refuses those reads for this role regardless; the page
 * simply does not ask.
 */
export function EmployerView({ employerId }: { employerId: string }): JSX.Element {
  const { session, signOut } = useSession();
  const token = session?.token ?? null;

  const [plans, setPlans] = useState<EmployerPlanDto[]>([]);
  const [members, setMembers] = useState<EmployerMemberSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const [planResult, memberResult] = await Promise.all([
          api.employerPlans(token, employerId),
          api.employerMembers(token, employerId),
        ]);
        if (cancelled) return;
        setPlans(planResult.plans);
        setMembers(memberResult.members);
      } catch {
        if (!cancelled) setError('Plan and enrollment details could not be loaded.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, employerId]);

  return (
    <div className="stack">
      <header className="appbar">
        <div className="appbar__identity">
          <span className="appbar__mark" aria-hidden="true">
            HC
          </span>
          <div className="appbar__text">
            <h1>Health Capital</h1>
            <p className="subtitle">Employer administration</p>
          </div>
        </div>
        <button type="button" className="button button--quiet" onClick={signOut}>
          Sign out
        </button>
      </header>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel" aria-labelledby="plan-heading">
        <div className="section-head">
          <div>
            <h2 id="plan-heading">Plan cover</h2>
            <p className="hint">What the plan covers, and up to how much.</p>
          </div>
        </div>
        {plans.length === 0 ? (
          <p className="empty">No plans found.</p>
        ) : (
          plans.map((plan) => (
            <div key={plan.planId} className="stack stack--tight">
              <h3>{plan.name}</h3>
              <p className="meta">
                <span>
                  Plan year {formatDate(plan.planYearStart)} &ndash; {formatDate(plan.planYearEnd)}
                </span>
                <span className="meta__dot" aria-hidden="true" />
                <span>Configuration version {plan.planConfigVersion}</span>
                <span className="meta__dot" aria-hidden="true" />
                <span>As of {formatDate(plan.planConfigAsOf)}</span>
              </p>
              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">Categories covered by {plan.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Covered</th>
                      <th scope="col">Annual limit</th>
                      <th scope="col">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.coverage.map((rule) => (
                      <tr key={rule.ruleRef}>
                        <th scope="row">{humaniseCategory(rule.category)}</th>
                        <td>
                          <span className={`pill ${rule.covered ? 'pill--yes' : 'pill--no'}`}>
                            {rule.covered ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="numeric">
                          {rule.annualLimitCents === null
                            ? 'No limit'
                            : formatCents(rule.annualLimitCents)}
                        </td>
                        <td>{rule.receiptRequired ? 'Required' : 'Not required'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel" aria-labelledby="roster-heading">
        <div className="section-head">
          <div>
            <h2 id="roster-heading">Enrolled members</h2>
            <p className="hint">
              Who is enrolled and on which plan. What anyone claimed for, and what they spent, is
              not available to this role.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table" data-testid="roster">
            <caption className="visually-hidden">Members enrolled with this employer</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Employee ID</th>
                <th scope="col">Plan</th>
                <th scope="col">Status</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.memberId}>
                  <th scope="row">
                    {member.firstName} {member.lastName}
                  </th>
                  <td className="numeric">{member.employeeId}</td>
                  <td>{member.planName}</td>
                  <td>
                    <span
                      className={`pill ${member.status === 'ACTIVE' ? 'pill--yes' : 'pill--no'}`}
                    >
                      {member.status.toLowerCase()}
                    </span>
                  </td>
                  <td>{formatDate(member.effectiveFrom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
