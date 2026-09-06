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
      <header className="page-header">
        <div>
          <h1>Health Capital</h1>
          <p className="subtitle">Employer administration</p>
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
        <h2 id="plan-heading">Plan cover</h2>
        {plans.length === 0 ? (
          <p>No plans found.</p>
        ) : (
          plans.map((plan) => (
            <div key={plan.planId} className="stack">
              <h3>{plan.name}</h3>
              <p className="hint">
                Plan year {formatDate(plan.planYearStart)} to {formatDate(plan.planYearEnd)}.
                Configuration version {plan.planConfigVersion}.
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
                        <td>{rule.covered ? 'Yes' : 'No'}</td>
                        <td>
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
        <h2 id="roster-heading">Enrolled members</h2>
        <p className="hint">
          Who is enrolled and on which plan. What anyone claimed for, and what they spent, is not
          available to this role.
        </p>
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
                  <td>{member.employeeId}</td>
                  <td>{member.planName}</td>
                  <td>{member.status.toLowerCase()}</td>
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
