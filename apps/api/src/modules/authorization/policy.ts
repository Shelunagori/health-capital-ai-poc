import type { Principal } from '@health-capital/contracts';
import { AppError } from '../../platform/errors.js';
import { Action, DenialReason } from './actions.js';

/**
 * Authorization: what a proven caller may do.
 *
 * Two rules shape everything here.
 *
 * First, resources are described by what was loaded from the database, never by what the request
 * asked for. A handler fetches the row, then hands the row's own identifiers to `authorize`. An
 * identifier in a path or body is a claim; the loaded record is the fact.
 *
 * Second, employer scope resolves through enrollments. A member has no employer of their own, so
 * an employer administrator's reach is defined by which members are enrolled with that employer.
 */
export type Resource =
  | {
      kind: 'MEMBER';
      memberId: string;
      /** Employers this member is or has been enrolled with, taken from their enrollments. */
      employerIds: readonly string[];
    }
  | { kind: 'EMPLOYER'; employerId: string }
  | { kind: 'AUDIT' };

/** Supplied by support callers to justify a privileged read. Validated at the edge. */
export interface AccessContext {
  reasonCode?: string | undefined;
  caseRef?: string | undefined;
}

export type AuthorizationDecision =
  | {
      allowed: true;
      /** True when a support caller reached data belonging to someone else. Always audited. */
      privileged: boolean;
    }
  | { allowed: false; reason: DenialReason };

const allow = (privileged = false): AuthorizationDecision => ({ allowed: true, privileged });
const deny = (reason: DenialReason): AuthorizationDecision => ({ allowed: false, reason });

/** Actions a member may take, and only on themselves. */
const SELF_ACTIONS = new Set<Action>([
  Action.READ_OWN_PROFILE,
  Action.READ_OWN_ENROLLMENT,
  Action.READ_OWN_BALANCE,
  Action.READ_OWN_LEDGER,
  Action.READ_OWN_DECISIONS,
  Action.EVALUATE_OWN_ELIGIBILITY,
  Action.ASK_GUIDANCE,
]);

/**
 * Reads of a named member's health or money. A member may do this for themselves. Support may do
 * it with a stated reason. An employer administrator may never do it, which is the single most
 * important line in this file.
 */
const MEMBER_SENSITIVE_ACTIONS = new Set<Action>([
  Action.READ_MEMBER_PROFILE,
  Action.READ_MEMBER_CARE_REQUESTS,
  Action.READ_MEMBER_DECISIONS,
  Action.READ_MEMBER_LEDGER,
]);

function hasJustification(context: AccessContext | undefined): boolean {
  return (
    typeof context?.reasonCode === 'string' &&
    context.reasonCode.length > 0 &&
    typeof context.caseRef === 'string' &&
    context.caseRef.length > 0
  );
}

export function authorize(
  principal: Principal,
  action: Action,
  resource: Resource,
  context?: AccessContext,
): AuthorizationDecision {
  if (SELF_ACTIONS.has(action)) {
    if (principal.role !== 'MEMBER') return deny(DenialReason.ROLE_NOT_PERMITTED);
    if (principal.memberId === null) return deny(DenialReason.PRINCIPAL_INCOMPLETE);
    if (resource.kind !== 'MEMBER') return deny(DenialReason.RESOURCE_MISMATCH);
    return resource.memberId === principal.memberId ? allow() : deny(DenialReason.NOT_OWNER);
  }

  if (MEMBER_SENSITIVE_ACTIONS.has(action)) {
    if (resource.kind !== 'MEMBER') return deny(DenialReason.RESOURCE_MISMATCH);
    switch (principal.role) {
      case 'MEMBER':
        if (principal.memberId === null) return deny(DenialReason.PRINCIPAL_INCOMPLETE);
        return resource.memberId === principal.memberId ? allow() : deny(DenialReason.NOT_OWNER);
      case 'SUPPORT':
        return hasJustification(context) ? allow(true) : deny(DenialReason.JUSTIFICATION_REQUIRED);
      case 'EMPLOYER_ADMIN':
        // An employer administrator never sees a member's health or financial data, even for
        // someone enrolled with them. There is no justification that unlocks this.
        return deny(DenialReason.ROLE_NOT_PERMITTED);
    }
  }

  if (action === Action.READ_MEMBER_SUMMARY) {
    if (resource.kind !== 'MEMBER') return deny(DenialReason.RESOURCE_MISMATCH);
    switch (principal.role) {
      case 'MEMBER':
        if (principal.memberId === null) return deny(DenialReason.PRINCIPAL_INCOMPLETE);
        return resource.memberId === principal.memberId ? allow() : deny(DenialReason.NOT_OWNER);
      case 'EMPLOYER_ADMIN': {
        if (principal.employerId === null) return deny(DenialReason.PRINCIPAL_INCOMPLETE);
        // Tenancy comes from the member's enrollments, not from anything on the member record.
        return resource.employerIds.includes(principal.employerId)
          ? allow()
          : deny(DenialReason.WRONG_TENANT);
      }
      case 'SUPPORT':
        return allow(true);
    }
  }

  if (action === Action.READ_EMPLOYER_PLAN || action === Action.LIST_EMPLOYER_MEMBERS) {
    if (resource.kind !== 'EMPLOYER') return deny(DenialReason.RESOURCE_MISMATCH);
    switch (principal.role) {
      case 'EMPLOYER_ADMIN':
        if (principal.employerId === null) return deny(DenialReason.PRINCIPAL_INCOMPLETE);
        return resource.employerId === principal.employerId
          ? allow()
          : deny(DenialReason.WRONG_TENANT);
      case 'SUPPORT':
        return allow(true);
      case 'MEMBER':
        return deny(DenialReason.ROLE_NOT_PERMITTED);
    }
  }

  if (action === Action.READ_AUDIT_EVENTS) {
    if (resource.kind !== 'AUDIT') return deny(DenialReason.RESOURCE_MISMATCH);
    return principal.role === 'SUPPORT' ? allow() : deny(DenialReason.ROLE_NOT_PERMITTED);
  }

  // Unreachable for the closed action set; a new action must be added to the matrix above.
  return deny(DenialReason.ROLE_NOT_PERMITTED);
}

/**
 * The same message for every refusal. A caller learns that they may not do this, not whether the
 * resource exists, belongs to someone else, or sits under another employer.
 */
export function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'You are not allowed to perform this action');
}
