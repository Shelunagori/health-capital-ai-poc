import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PrivilegedReadQuerySchema } from '@health-capital/contracts';
import { AppError } from '../../platform/errors.js';
import { requirePrincipal } from '../auth/index.js';
import {
  Action,
  authorize,
  forbidden,
  type AccessContext,
  type Resource,
} from '../authorization/index.js';
import {
  toEmployerMemberSummaryDto,
  toEnrollmentDto,
  toMemberSelfDto,
  toSupportMemberSummaryDto,
} from './dto.js';
import type { MemberRepository } from './repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every handler here follows the same order: prove identity, load the resource, authorize against
 * what was loaded, then map to the view for that role. The identifier in the path is never trusted
 * as evidence of anything.
 */
export function registerMemberRoutes(app: FastifyInstance, repository: MemberRepository): void {
  const readPathMemberId = (request: FastifyRequest): string => {
    const { memberId } = request.params as { memberId?: string };
    if (typeof memberId !== 'string' || !UUID.test(memberId)) {
      throw new AppError('VALIDATION_ERROR', 'memberId must be a UUID');
    }
    return memberId;
  };

  /**
   * A privileged read must state a coded reason and a case reference. Absent or malformed
   * justification is refused before any data is loaded.
   */
  const readJustification = (request: FastifyRequest): AccessContext => {
    const parsed = PrivilegedReadQuerySchema.safeParse(request.query);
    return parsed.success ? parsed.data : {};
  };

  app.get('/me/profile', async (request) => {
    const principal = requirePrincipal(request);
    if (principal.memberId === null) throw forbidden();

    const loaded = await repository.findWithScope(principal.memberId);
    if (loaded === null) throw new AppError('NOT_FOUND', 'Not found');

    const resource: Resource = {
      kind: 'MEMBER',
      memberId: loaded.member.id,
      employerIds: loaded.employerIds,
    };
    if (!authorize(principal, Action.READ_OWN_PROFILE, resource).allowed) throw forbidden();

    return toMemberSelfDto(loaded.member);
  });

  app.get('/me/enrollments', async (request) => {
    const principal = requirePrincipal(request);
    if (principal.memberId === null) throw forbidden();

    const loaded = await repository.findWithScope(principal.memberId);
    if (loaded === null) throw new AppError('NOT_FOUND', 'Not found');

    const resource: Resource = {
      kind: 'MEMBER',
      memberId: loaded.member.id,
      employerIds: loaded.employerIds,
    };
    if (!authorize(principal, Action.READ_OWN_ENROLLMENT, resource).allowed) throw forbidden();

    const enrollments = await repository.listEnrollments(loaded.member.id);
    return { enrollments: enrollments.map(toEnrollmentDto) };
  });

  /** A member's full profile. The member themselves, or support with a stated reason. */
  app.get('/members/:memberId/profile', async (request) => {
    const principal = requirePrincipal(request);
    const memberId = readPathMemberId(request);

    const loaded = await repository.findWithScope(memberId);
    // A caller who may not read this member learns nothing about whether they exist.
    if (loaded === null) throw forbidden();

    const resource: Resource = {
      kind: 'MEMBER',
      memberId: loaded.member.id,
      employerIds: loaded.employerIds,
    };
    const decision = authorize(
      principal,
      Action.READ_MEMBER_PROFILE,
      resource,
      readJustification(request),
    );
    if (!decision.allowed) throw forbidden();

    return toMemberSelfDto(loaded.member);
  });

  /** The non-clinical summary: who is enrolled and on which plan. */
  app.get('/members/:memberId/summary', async (request) => {
    const principal = requirePrincipal(request);
    const memberId = readPathMemberId(request);

    const loaded = await repository.findWithScope(memberId);
    if (loaded === null) throw forbidden();

    const resource: Resource = {
      kind: 'MEMBER',
      memberId: loaded.member.id,
      employerIds: loaded.employerIds,
    };
    if (!authorize(principal, Action.READ_MEMBER_SUMMARY, resource).allowed) throw forbidden();

    const enrollment = await repository.latestEnrollment(loaded.member.id);
    if (enrollment === null) throw new AppError('NOT_FOUND', 'Not found');

    return principal.role === 'SUPPORT'
      ? toSupportMemberSummaryDto(loaded.member, enrollment)
      : toEmployerMemberSummaryDto(loaded.member, enrollment);
  });

  /** Everyone enrolled with the caller's employer. Support may name any employer. */
  app.get('/employers/:employerId/members', async (request) => {
    const principal = requirePrincipal(request);
    const { employerId } = request.params as { employerId?: string };
    if (typeof employerId !== 'string' || !UUID.test(employerId)) {
      throw new AppError('VALIDATION_ERROR', 'employerId must be a UUID');
    }

    if (!(await repository.employerExists(employerId))) throw forbidden();

    const resource: Resource = { kind: 'EMPLOYER', employerId };
    if (!authorize(principal, Action.LIST_EMPLOYER_MEMBERS, resource).allowed) throw forbidden();

    const rows = await repository.listByEmployer(employerId);
    return {
      members: rows.map(({ member, enrollment }) => toEmployerMemberSummaryDto(member, enrollment)),
    };
  });
}
