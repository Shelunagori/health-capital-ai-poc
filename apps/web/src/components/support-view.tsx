'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  EmployerMemberSummaryDto,
  EmployerSummaryDto,
  MemberSelfDto,
  SupportAuditEventDto,
} from '@health-capital/contracts';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatDateTime, humaniseCode } from '@/lib/format';
import { useSession } from '@/lib/session';

const REASON_CODES = [
  'MEMBER_SUPPORT_TICKET',
  'BENEFITS_DISPUTE',
  'DATA_QUALITY_INVESTIGATION',
  'FRAUD_REVIEW',
  'REGULATORY_REQUEST',
] as const;

/**
 * The support desk.
 *
 * Reading someone's profile requires a reason from a fixed list and a case reference in a fixed
 * format. Neither is a free-text note, and the read is refused without both. The form makes that
 * visible rather than hiding it behind a button that just works.
 */
export function SupportView(): JSX.Element {
  const { session, signOut } = useSession();
  const token = session?.token ?? null;

  const [employers, setEmployers] = useState<EmployerSummaryDto[]>([]);
  const [employerId, setEmployerId] = useState('');
  const [members, setMembers] = useState<EmployerMemberSummaryDto[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [reasonCode, setReasonCode] = useState<string>(REASON_CODES[0]);
  const [caseRef, setCaseRef] = useState('');
  const [profile, setProfile] = useState<MemberSelfDto | null>(null);
  const [events, setEvents] = useState<SupportAuditEventDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) return;
    void api
      .employers(token)
      .then((result) => setEmployers(result.employers))
      .catch(() => setError('Employers could not be loaded.'));
  }, [token]);

  useEffect(() => {
    if (token === null || employerId === '') return;
    setMembers([]);
    setProfile(null);
    void api
      .employerMembers(token, employerId)
      .then((result) => setMembers(result.members))
      .catch(() => setError('Members could not be loaded.'));
  }, [token, employerId]);

  const loadAudit = async (): Promise<void> => {
    if (token === null) return;
    try {
      const result = await api.auditEvents(token);
      setEvents(result.events);
    } catch {
      setError('Audit events could not be loaded.');
    }
  };

  async function onLookup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (token === null || selectedMemberId === '') return;
    setError(null);
    setProfile(null);
    try {
      setProfile(await api.memberProfile(token, selectedMemberId, reasonCode, caseRef));
      await loadAudit();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'That read was refused. A reason code and a case reference such as CASE-0042 are both required.'
          : 'The lookup could not be completed.',
      );
    }
  }

  return (
    <div className="stack">
      <header className="appbar">
        <div className="appbar__identity">
          <span className="appbar__mark" aria-hidden="true">
            HC
          </span>
          <div className="appbar__text">
            <h1>Health Capital</h1>
            <p className="subtitle">Support desk</p>
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

      <section className="panel" aria-labelledby="lookup-heading">
        <form
          className="form"
          onSubmit={(event) => void onLookup(event)}
          aria-labelledby="lookup-heading"
        >
          <div>
            <span className="eyebrow">Recorded privileged read</span>
            <h2 id="lookup-heading">Look up a member</h2>
            <p className="hint">
              Reading someone&rsquo;s profile is recorded against your account, with the reason and
              case reference you give here. Both are required, and the read is refused without them.
            </p>
          </div>

          <div className="field-pair">
            <label className="field">
              <span className="field__label">Employer</span>
              <select
                value={employerId}
                onChange={(event) => setEmployerId(event.target.value)}
                name="employerId"
              >
                <option value="">Choose an employer</option>
                {employers.map((employer) => (
                  <option key={employer.employerId} value={employer.employerId}>
                    {employer.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Member</span>
              <select
                value={selectedMemberId}
                onChange={(event) => setSelectedMemberId(event.target.value)}
                name="memberId"
                disabled={members.length === 0}
              >
                <option value="">Choose a member</option>
                {members.map((member) => (
                  <option key={member.memberId} value={member.memberId}>
                    {member.firstName} {member.lastName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-pair">
            <label className="field">
              <span className="field__label">Reason</span>
              <select
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                name="reasonCode"
              >
                {REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {humaniseCode(code)}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <label className="field">
                <span className="field__label">Case reference</span>
                <input
                  type="text"
                  name="caseRef"
                  required
                  placeholder="CASE-0042"
                  pattern="[A-Z]{2,6}-[0-9]{1,8}"
                  value={caseRef}
                  onChange={(event) => setCaseRef(event.target.value)}
                />
              </label>
              {/* Outside the label on purpose: inside it, this sentence becomes part of the field's name. */}
              <span className="field__note">Two to six letters, a dash, then digits.</span>
            </div>
          </div>

          <button type="submit" className="button" disabled={selectedMemberId === ''}>
            Look up
          </button>
        </form>

        {profile !== null && (
          <div className="result">
            <h3 className="result__title">Member profile</h3>
            <dl className="facts" data-testid="support-profile">
              <div className="facts__row">
                <dt>Name</dt>
                <dd>
                  {profile.firstName} {profile.lastName}
                </dd>
              </div>
              <div className="facts__row">
                <dt>Date of birth</dt>
                <dd>{formatDate(profile.dateOfBirth)}</dd>
              </div>
              <div className="facts__row">
                <dt>Address</dt>
                <dd>
                  {profile.addressLine}, {profile.city} {profile.postalCode}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="audit-heading">
        <div className="section-head">
          <div>
            <h2 id="audit-heading">Audit trail</h2>
            <p className="hint">
              Who did what, when, and whether it was allowed. Amounts, treatment categories and the
              records themselves are deliberately not shown here: reading those is a separate,
              recorded action.
            </p>
          </div>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => void loadAudit()}
          >
            Refresh
          </button>
        </div>
        <div className="table-scroll">
          <table className="table" data-testid="audit-table">
            <caption className="visually-hidden">Recent audit events</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Outcome</th>
                <th scope="col">Role</th>
                <th scope="col">Reason</th>
                <th scope="col">Case reference</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.occurredAt)}</td>
                  <th scope="row">{event.action}</th>
                  <td>
                    <span
                      className={`pill ${event.outcome === 'ALLOW' ? 'pill--yes' : 'pill--no'}`}
                    >
                      {event.outcome}
                    </span>
                  </td>
                  <td>{event.actorRole ?? '—'}</td>
                  <td>{humaniseCode(event.reasonCode)}</td>
                  <td>{event.caseRef ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
