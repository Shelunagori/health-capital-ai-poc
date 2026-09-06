import { z } from 'zod';

/**
 * Role-specific views of a member. Each is an explicit field list rather than a filtered entity,
 * so adding a column to the database cannot widen what a role sees.
 */
export const EnrollmentStatusSchema = z.enum(['PENDING', 'ACTIVE', 'TERMINATED']);

/** What a member sees about themselves. */
export const MemberSelfDtoSchema = z
  .object({
    memberId: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    dateOfBirth: z.string(),
    addressLine: z.string(),
    city: z.string(),
    postalCode: z.string(),
  })
  .strict();
export type MemberSelfDto = z.infer<typeof MemberSelfDtoSchema>;

export const EnrollmentDtoSchema = z
  .object({
    enrollmentId: z.string().uuid(),
    employerName: z.string(),
    planName: z.string(),
    status: EnrollmentStatusSchema,
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .strict();
export type EnrollmentDto = z.infer<typeof EnrollmentDtoSchema>;

/**
 * What an employer administrator sees about someone enrolled with them.
 *
 * Deliberately contains no treatment category, no amount, no balance and no decision: an employer
 * learns who is enrolled and on which plan, never what care they sought or what they spent.
 */
export const EmployerMemberSummaryDtoSchema = z
  .object({
    memberId: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    employeeId: z.string(),
    planName: z.string(),
    status: EnrollmentStatusSchema,
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .strict();
export type EmployerMemberSummaryDto = z.infer<typeof EmployerMemberSummaryDtoSchema>;

/** What support sees when looking a member up. Same shape as the employer view, plus the reference. */
export const SupportMemberSummaryDtoSchema = EmployerMemberSummaryDtoSchema.extend({
  memberRef: z.string(),
  employerName: z.string(),
}).strict();
export type SupportMemberSummaryDto = z.infer<typeof SupportMemberSummaryDtoSchema>;

/** Closed reason vocabulary for a support privileged read. Free text is never accepted. */
export const SupportReasonCodeSchema = z.enum([
  'MEMBER_SUPPORT_TICKET',
  'BENEFITS_DISPUTE',
  'DATA_QUALITY_INVESTIGATION',
  'FRAUD_REVIEW',
  'REGULATORY_REQUEST',
]);
export type SupportReasonCode = z.infer<typeof SupportReasonCodeSchema>;

/** A constrained ticket reference, not a note. */
export const CaseRefSchema = z
  .string()
  .regex(/^[A-Z]{2,6}-[0-9]{1,8}$/, 'caseRef must look like ABC-1234');

export const PrivilegedReadQuerySchema = z
  .object({
    reasonCode: SupportReasonCodeSchema,
    caseRef: CaseRefSchema,
  })
  .strict();
export type PrivilegedReadQuery = z.infer<typeof PrivilegedReadQuerySchema>;

/** The caller's own scope, read back from their token. Never anyone else's. */
export const PrincipalContextDtoSchema = z
  .object({
    role: z.enum(['MEMBER', 'EMPLOYER_ADMIN', 'SUPPORT']),
    memberId: z.string().uuid().nullable(),
    employerId: z.string().uuid().nullable(),
  })
  .strict();
export type PrincipalContextDto = z.infer<typeof PrincipalContextDtoSchema>;

export const EmployerSummaryDtoSchema = z
  .object({ employerId: z.string().uuid(), name: z.string(), employerRef: z.string() })
  .strict();
export type EmployerSummaryDto = z.infer<typeof EmployerSummaryDtoSchema>;

/**
 * A plan as an employer administrator sees it: the rules of the plan itself.
 * Nothing here is about any individual, so there is no member data to leave out.
 */
export const PlanCoverageDtoSchema = z
  .object({
    category: z.string(),
    covered: z.boolean(),
    annualLimitCents: z.number().int().nullable(),
    receiptRequired: z.boolean(),
    ruleRef: z.string(),
  })
  .strict();

export const EmployerPlanDtoSchema = z
  .object({
    planId: z.string().uuid(),
    name: z.string(),
    planYearStart: z.string(),
    planYearEnd: z.string(),
    planConfigVersion: z.number().int(),
    planConfigAsOf: z.string(),
    coverage: z.array(PlanCoverageDtoSchema),
  })
  .strict();
export type EmployerPlanDto = z.infer<typeof EmployerPlanDtoSchema>;
