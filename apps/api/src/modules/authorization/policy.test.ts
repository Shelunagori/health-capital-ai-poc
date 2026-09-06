import { describe, expect, it } from 'vitest';
import type { Principal } from '@health-capital/contracts';
import { Action, DenialReason } from './actions.js';
import { authorize, type Resource } from './policy.js';

const MEMBER_A = '33333333-3333-4333-8333-00000000000a';
const MEMBER_B = '33333333-3333-4333-8333-00000000000b';
const EMPLOYER_A = '11111111-1111-4111-8111-00000000000a';
const EMPLOYER_B = '11111111-1111-4111-8111-00000000000b';

const member = (memberId = MEMBER_A): Principal => ({
  userId: '77777777-7777-4777-8777-000000000001',
  role: 'MEMBER',
  memberId,
  employerId: null,
});

const employerAdmin = (employerId = EMPLOYER_A): Principal => ({
  userId: '77777777-7777-4777-8777-000000000002',
  role: 'EMPLOYER_ADMIN',
  memberId: null,
  employerId,
});

const support: Principal = {
  userId: '77777777-7777-4777-8777-000000000003',
  role: 'SUPPORT',
  memberId: null,
  employerId: null,
};

const memberResource = (memberId: string, employerIds: string[] = [EMPLOYER_A]): Resource => ({
  kind: 'MEMBER',
  memberId,
  employerIds,
});

const justification = { reasonCode: 'MEMBER_SUPPORT_TICKET', caseRef: 'CASE-0001' };

describe('a member acts only on themselves', () => {
  const selfActions = [
    Action.READ_OWN_PROFILE,
    Action.READ_OWN_ENROLLMENT,
    Action.READ_OWN_BALANCE,
    Action.READ_OWN_LEDGER,
    Action.READ_OWN_DECISIONS,
    Action.EVALUATE_OWN_ELIGIBILITY,
    Action.ASK_GUIDANCE,
  ];

  it.each(selfActions)('allows %s on their own record', (action) => {
    expect(authorize(member(), action, memberResource(MEMBER_A))).toEqual({
      allowed: true,
      privileged: false,
    });
  });

  it.each(selfActions)('refuses %s on someone else', (action) => {
    expect(authorize(member(), action, memberResource(MEMBER_B))).toEqual({
      allowed: false,
      reason: DenialReason.NOT_OWNER,
    });
  });

  it.each(selfActions)('refuses %s to an employer administrator', (action) => {
    expect(authorize(employerAdmin(), action, memberResource(MEMBER_A))).toEqual({
      allowed: false,
      reason: DenialReason.ROLE_NOT_PERMITTED,
    });
  });

  it.each(selfActions)('refuses %s to support', (action) => {
    expect(authorize(support, action, memberResource(MEMBER_A))).toEqual({
      allowed: false,
      reason: DenialReason.ROLE_NOT_PERMITTED,
    });
  });

  it('refuses a member token that carries no member reference', () => {
    const broken: Principal = { ...member(), memberId: null };
    expect(authorize(broken, Action.READ_OWN_PROFILE, memberResource(MEMBER_A))).toEqual({
      allowed: false,
      reason: DenialReason.PRINCIPAL_INCOMPLETE,
    });
  });
});

describe("a member's health and money", () => {
  const sensitive = [
    Action.READ_MEMBER_PROFILE,
    Action.READ_MEMBER_CARE_REQUESTS,
    Action.READ_MEMBER_DECISIONS,
    Action.READ_MEMBER_LEDGER,
  ];

  it.each(sensitive)('is never visible to an employer administrator: %s', (action) => {
    // Even for someone enrolled with that employer, and even with a justification supplied.
    expect(
      authorize(employerAdmin(), action, memberResource(MEMBER_A, [EMPLOYER_A]), justification),
    ).toEqual({ allowed: false, reason: DenialReason.ROLE_NOT_PERMITTED });
  });

  it.each(sensitive)('is visible to the member themselves: %s', (action) => {
    expect(authorize(member(), action, memberResource(MEMBER_A))).toEqual({
      allowed: true,
      privileged: false,
    });
  });

  it.each(sensitive)('is refused to a different member: %s', (action) => {
    expect(authorize(member(), action, memberResource(MEMBER_B))).toEqual({
      allowed: false,
      reason: DenialReason.NOT_OWNER,
    });
  });

  it.each(sensitive)('needs a stated reason from support: %s', (action) => {
    expect(authorize(support, action, memberResource(MEMBER_A))).toEqual({
      allowed: false,
      reason: DenialReason.JUSTIFICATION_REQUIRED,
    });
    expect(authorize(support, action, memberResource(MEMBER_A), justification)).toEqual({
      allowed: true,
      privileged: true,
    });
  });

  it('treats a half-supplied justification as none at all', () => {
    for (const partial of [
      { reasonCode: 'FRAUD_REVIEW' },
      { caseRef: 'CASE-0002' },
      { reasonCode: '', caseRef: '' },
      {},
    ]) {
      expect(
        authorize(support, Action.READ_MEMBER_PROFILE, memberResource(MEMBER_A), partial),
      ).toEqual({
        allowed: false,
        reason: DenialReason.JUSTIFICATION_REQUIRED,
      });
    }
  });
});

describe('employer tenancy comes from enrollments', () => {
  it('lets an administrator read a summary for someone enrolled with them', () => {
    expect(
      authorize(
        employerAdmin(EMPLOYER_A),
        Action.READ_MEMBER_SUMMARY,
        memberResource(MEMBER_A, [EMPLOYER_A]),
      ),
    ).toEqual({ allowed: true, privileged: false });
  });

  it('refuses a summary for someone enrolled elsewhere', () => {
    expect(
      authorize(
        employerAdmin(EMPLOYER_A),
        Action.READ_MEMBER_SUMMARY,
        memberResource(MEMBER_A, [EMPLOYER_B]),
      ),
    ).toEqual({ allowed: false, reason: DenialReason.WRONG_TENANT });
  });

  it('follows a member who moved employers', () => {
    // The person is portable; each employer sees them only for their own enrollment period.
    const moved = memberResource(MEMBER_A, [EMPLOYER_B, EMPLOYER_A]);
    expect(authorize(employerAdmin(EMPLOYER_A), Action.READ_MEMBER_SUMMARY, moved).allowed).toBe(
      true,
    );
    expect(authorize(employerAdmin(EMPLOYER_B), Action.READ_MEMBER_SUMMARY, moved).allowed).toBe(
      true,
    );
  });

  it('scopes employer plan and member listing to the caller employer', () => {
    const own: Resource = { kind: 'EMPLOYER', employerId: EMPLOYER_A };
    const other: Resource = { kind: 'EMPLOYER', employerId: EMPLOYER_B };

    for (const action of [Action.READ_EMPLOYER_PLAN, Action.LIST_EMPLOYER_MEMBERS]) {
      expect(authorize(employerAdmin(EMPLOYER_A), action, own).allowed).toBe(true);
      expect(authorize(employerAdmin(EMPLOYER_A), action, other)).toEqual({
        allowed: false,
        reason: DenialReason.WRONG_TENANT,
      });
      expect(authorize(support, action, other)).toEqual({ allowed: true, privileged: true });
      expect(authorize(member(), action, own)).toEqual({
        allowed: false,
        reason: DenialReason.ROLE_NOT_PERMITTED,
      });
    }
  });

  it('refuses an employer token that carries no employer reference', () => {
    const broken: Principal = { ...employerAdmin(), employerId: null };
    expect(
      authorize(broken, Action.LIST_EMPLOYER_MEMBERS, { kind: 'EMPLOYER', employerId: EMPLOYER_A }),
    ).toEqual({ allowed: false, reason: DenialReason.PRINCIPAL_INCOMPLETE });
  });
});

describe('audit reading', () => {
  it('is available to support and to nobody else', () => {
    expect(authorize(support, Action.READ_AUDIT_EVENTS, { kind: 'AUDIT' })).toEqual({
      allowed: true,
      privileged: false,
    });
    expect(authorize(member(), Action.READ_AUDIT_EVENTS, { kind: 'AUDIT' }).allowed).toBe(false);
    expect(authorize(employerAdmin(), Action.READ_AUDIT_EVENTS, { kind: 'AUDIT' }).allowed).toBe(
      false,
    );
  });
});

describe('resource kinds are checked', () => {
  it('refuses an action pointed at the wrong kind of resource', () => {
    expect(authorize(member(), Action.READ_OWN_PROFILE, { kind: 'AUDIT' })).toEqual({
      allowed: false,
      reason: DenialReason.RESOURCE_MISMATCH,
    });
    expect(
      authorize(employerAdmin(), Action.LIST_EMPLOYER_MEMBERS, memberResource(MEMBER_A)),
    ).toEqual({ allowed: false, reason: DenialReason.RESOURCE_MISMATCH });
  });
});

describe('the matrix is exhaustive', () => {
  it('returns a decision for every action and role combination', () => {
    const principals = [member(), employerAdmin(), support];
    const resources: Resource[] = [
      memberResource(MEMBER_A),
      { kind: 'EMPLOYER', employerId: EMPLOYER_A },
      { kind: 'AUDIT' },
    ];

    for (const action of Object.values(Action)) {
      for (const principal of principals) {
        for (const resource of resources) {
          const decision = authorize(principal, action, resource, justification);
          expect(typeof decision.allowed, `${action}/${principal.role}/${resource.kind}`).toBe(
            'boolean',
          );
        }
      }
    }
  });
});
