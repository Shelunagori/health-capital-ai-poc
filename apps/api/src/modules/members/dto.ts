import type {
  EmployerMemberSummaryDto,
  EnrollmentDto,
  MemberSelfDto,
  SupportMemberSummaryDto,
} from '@health-capital/contracts';

/**
 * Mappers from stored rows to role-specific views.
 *
 * Each one names every field it emits. That is the point: a column added to the database appears in
 * no response until someone writes it here, so widening a role's view is always a deliberate edit.
 */
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

export interface MemberRow {
  id: string;
  externalRef: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  addressLine: string;
  city: string;
  postalCode: string;
}

export interface EnrollmentRow {
  id: string;
  employeeId: string;
  status: 'PENDING' | 'ACTIVE' | 'TERMINATED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  employer: { name: string };
  plan: { name: string };
}

export function toMemberSelfDto(member: MemberRow): MemberSelfDto {
  return {
    memberId: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    dateOfBirth: isoDate(member.dateOfBirth),
    addressLine: member.addressLine,
    city: member.city,
    postalCode: member.postalCode,
  };
}

export function toEnrollmentDto(enrollment: EnrollmentRow): EnrollmentDto {
  return {
    enrollmentId: enrollment.id,
    employerName: enrollment.employer.name,
    planName: enrollment.plan.name,
    status: enrollment.status,
    effectiveFrom: isoDate(enrollment.effectiveFrom),
    effectiveTo: enrollment.effectiveTo === null ? null : isoDate(enrollment.effectiveTo),
  };
}

/**
 * The employer view. No treatment category, no amount, no balance, no decision: an employer learns
 * who is enrolled and on which plan, and nothing about the care they sought or the money they spent.
 */
export function toEmployerMemberSummaryDto(
  member: Pick<MemberRow, 'id' | 'firstName' | 'lastName'>,
  enrollment: EnrollmentRow,
): EmployerMemberSummaryDto {
  return {
    memberId: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    employeeId: enrollment.employeeId,
    planName: enrollment.plan.name,
    status: enrollment.status,
    effectiveFrom: isoDate(enrollment.effectiveFrom),
    effectiveTo: enrollment.effectiveTo === null ? null : isoDate(enrollment.effectiveTo),
  };
}

export function toSupportMemberSummaryDto(
  member: Pick<MemberRow, 'id' | 'firstName' | 'lastName' | 'externalRef'>,
  enrollment: EnrollmentRow,
): SupportMemberSummaryDto {
  return {
    ...toEmployerMemberSummaryDto(member, enrollment),
    memberRef: member.externalRef,
    employerName: enrollment.employer.name,
  };
}
