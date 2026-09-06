import type { Db } from '../../platform/db.js';
import type { EnrollmentRow, MemberRow } from './dto.js';

/**
 * Reads for members, employers and enrollments.
 *
 * Selections are explicit: a query returns the columns a caller needs, so a new column does not
 * silently start flowing into memory or into a response.
 */
const MEMBER_SELECT = {
  id: true,
  externalRef: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  addressLine: true,
  city: true,
  postalCode: true,
} as const;

const ENROLLMENT_SELECT = {
  id: true,
  employeeId: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  employer: { select: { name: true } },
  plan: { select: { name: true } },
} as const;

export interface MemberWithScope {
  member: MemberRow;
  /** Every employer this member is or has been enrolled with. The basis for tenancy checks. */
  employerIds: string[];
}

export class MemberRepository {
  constructor(private readonly db: Db) {}

  /** Loads the member and the employers their enrollments reach, or null when there is no such member. */
  async findWithScope(memberId: string): Promise<MemberWithScope | null> {
    const member = await this.db.member.findUnique({
      where: { id: memberId },
      select: MEMBER_SELECT,
    });
    if (member === null) return null;

    const enrollments = await this.db.benefitEnrollment.findMany({
      where: { memberId },
      select: { employerId: true },
    });
    return { member, employerIds: enrollments.map((e) => e.employerId) };
  }

  async listEnrollments(memberId: string): Promise<EnrollmentRow[]> {
    return this.db.benefitEnrollment.findMany({
      where: { memberId },
      select: ENROLLMENT_SELECT,
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** The most recent enrollment for a member, used for summary views. */
  async latestEnrollment(memberId: string): Promise<EnrollmentRow | null> {
    return this.db.benefitEnrollment.findFirst({
      where: { memberId },
      select: ENROLLMENT_SELECT,
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Members enrolled with one employer. The employer is the filter, so the result cannot include
   * anyone outside that tenancy even if a caller supplies an unexpected identifier elsewhere.
   */
  async listByEmployer(
    employerId: string,
  ): Promise<
    { member: Pick<MemberRow, 'id' | 'firstName' | 'lastName'>; enrollment: EnrollmentRow }[]
  > {
    const enrollments = await this.db.benefitEnrollment.findMany({
      where: { employerId },
      select: {
        ...ENROLLMENT_SELECT,
        member: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ status: 'asc' }, { effectiveFrom: 'desc' }],
    });

    return enrollments.map(({ member, ...enrollment }) => ({ member, enrollment }));
  }

  async listEmployers(): Promise<{ id: string; name: string; externalRef: string }[]> {
    return this.db.employer.findMany({
      select: { id: true, name: true, externalRef: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Plans belonging to one employer. Plan rules, not anyone's data. */
  async listPlansByEmployer(employerId: string): Promise<
    {
      id: string;
      name: string;
      planYearStart: Date;
      planYearEnd: Date;
      planConfigVersion: number;
      planConfigAsOf: Date;
      coverageRules: unknown;
    }[]
  > {
    return this.db.plan.findMany({
      where: { employerId },
      select: {
        id: true,
        name: true,
        planYearStart: true,
        planYearEnd: true,
        planConfigVersion: true,
        planConfigAsOf: true,
        coverageRules: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async employerExists(employerId: string): Promise<boolean> {
    const employer = await this.db.employer.findUnique({
      where: { id: employerId },
      select: { id: true },
    });
    return employer !== null;
  }
}
