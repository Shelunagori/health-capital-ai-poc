/**
 * The closed catalogue of things a caller can attempt. Handlers name an action; the policy decides.
 * Keeping the list closed means the policy matrix can be read in one place and tested exhaustively.
 */
export const Action = {
  /** A member reading their own profile, enrollment, balance, ledger or decisions. */
  READ_OWN_PROFILE: 'READ_OWN_PROFILE',
  READ_OWN_ENROLLMENT: 'READ_OWN_ENROLLMENT',
  READ_OWN_BALANCE: 'READ_OWN_BALANCE',
  READ_OWN_LEDGER: 'READ_OWN_LEDGER',
  READ_OWN_DECISIONS: 'READ_OWN_DECISIONS',
  EVALUATE_OWN_ELIGIBILITY: 'EVALUATE_OWN_ELIGIBILITY',
  ASK_GUIDANCE: 'ASK_GUIDANCE',

  /** Reads addressed at a named member rather than at the caller. */
  READ_MEMBER_PROFILE: 'READ_MEMBER_PROFILE',
  READ_MEMBER_SUMMARY: 'READ_MEMBER_SUMMARY',
  READ_MEMBER_CARE_REQUESTS: 'READ_MEMBER_CARE_REQUESTS',
  READ_MEMBER_DECISIONS: 'READ_MEMBER_DECISIONS',
  READ_MEMBER_LEDGER: 'READ_MEMBER_LEDGER',

  /** Employer-scoped reads. */
  READ_EMPLOYER_PLAN: 'READ_EMPLOYER_PLAN',
  LIST_EMPLOYER_MEMBERS: 'LIST_EMPLOYER_MEMBERS',

  READ_AUDIT_EVENTS: 'READ_AUDIT_EVENTS',
} as const;

export type Action = (typeof Action)[keyof typeof Action];

/** Why a request was refused. Closed so audit metadata stays structured. */
export const DenialReason = {
  /** The role may never perform this action, whatever the resource. */
  ROLE_NOT_PERMITTED: 'ROLE_NOT_PERMITTED',
  /** The caller asked for someone else's data. */
  NOT_OWNER: 'NOT_OWNER',
  /** The resource belongs to a different employer. */
  WRONG_TENANT: 'WRONG_TENANT',
  /** A privileged read was attempted without a reason code and case reference. */
  JUSTIFICATION_REQUIRED: 'JUSTIFICATION_REQUIRED',
  /** The token carries a role without the scope reference that role needs. */
  PRINCIPAL_INCOMPLETE: 'PRINCIPAL_INCOMPLETE',
  /** The action does not apply to the kind of resource supplied. */
  RESOURCE_MISMATCH: 'RESOURCE_MISMATCH',
} as const;

export type DenialReason = (typeof DenialReason)[keyof typeof DenialReason];
