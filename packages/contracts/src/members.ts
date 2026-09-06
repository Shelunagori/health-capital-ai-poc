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
