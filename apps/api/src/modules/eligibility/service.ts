import type { EligibilityDecisionDto } from '@health-capital/contracts';
import type { Db } from '../../platform/db.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { BenefitCategory } from '../../generated/prisma/enums.js';
import type { AuditService } from '../audit/index.js';
import { AuditAction, AuditOutcome } from '../audit/index.js';
import type { BenefitsService } from '../benefits/index.js';
import { AdapterFailure, BALANCE_TOLERANCE_CENTS, type Adapters } from '../integrations/index.js';
import { MissingReason, missing, present, type EligibilityInputs, type Input } from './inputs.js';
import { evaluate, type EligibilityResult } from './rules.js';
import { buildSnapshot } from './snapshot.js';

/**
 * Turns a member's request into a decision: gather the facts, hand them to the pure rules engine,
 * then store what was decided and what it was decided from.
 *
 * No model is involved anywhere in this path. An AI provider can explain a decision afterwards; it
 * can never make one, and this file has no way to ask it.
 */
export interface EvaluateCommand {
  memberId: string;
  treatmentCategory: BenefitCategory;
  expenseAmountCents: number;
  serviceDate: Date;
  traceId: string;
  actorUserId: string;
}

/** Maps an adapter's reason for silence onto the engine's vocabulary for not knowing. */
function toMissingReason(failure: AdapterFailure): MissingReason {
  switch (failure) {
    case AdapterFailure.TIMEOUT:
      return MissingReason.SOURCE_TIMEOUT;
    case AdapterFailure.STALE:
      return MissingReason.SOURCE_STALE;
    case AdapterFailure.CONFLICT:
      return MissingReason.SOURCE_CONFLICT;
    default:
      return MissingReason.SOURCE_UNAVAILABLE;
  }
}

export class EligibilityService {
  constructor(
    private readonly db: Db,
    private readonly benefits: BenefitsService,
    private readonly adapters: Adapters,
    private readonly audit: AuditService,
  ) {}

  /**
   * Collects every fact the rules need. Each one is either present or explicitly absent with a
   * reason; nothing is defaulted, and nothing is inferred from a failure to look it up.
   */
  async assembleInputs(command: EvaluateCommand): Promise<EligibilityInputs> {
    const candidates = await this.db.benefitEnrollment.findMany({
      where: {
        memberId: command.memberId,
        effectiveFrom: { lte: command.serviceDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: command.serviceDate } }],
      },
      select: { id: true, planId: true, enrollmentExternalRef: true },
    });

    const base = {
      request: {
        treatmentCategory: command.treatmentCategory,
        expenseAmountCents: command.expenseAmountCents,
        serviceDate: command.serviceDate,
      },
      balanceToleranceCents: BALANCE_TOLERANCE_CENTS,
    };

    // More than one applicable enrollment is a contradiction in the data, not a choice to make.
    if (candidates.length > 1) {
      return {
        ...base,
        enrollment: { state: 'UNKNOWN', reason: MissingReason.MULTIPLE_APPLICABLE },
        plan: missing(MissingReason.MULTIPLE_APPLICABLE),
        balances: missing(MissingReason.MULTIPLE_APPLICABLE),
        ytdCategorySpendCents: missing(MissingReason.MULTIPLE_APPLICABLE),
      };
    }

    const candidate = candidates[0];
    if (candidate === undefined) {
      // Nothing on record covers the date. Confirmed by us; the employer system is asked below only
      // when there is a reference to ask about.
      return {
        ...base,
        enrollment: { state: 'CONFIRMED_ABSENT' },
        plan: missing(MissingReason.NOT_CONFIGURED),
        balances: missing(MissingReason.NOT_CONFIGURED),
        ytdCategorySpendCents: missing(MissingReason.NOT_CONFIGURED),
      };
    }

    const confirmation = await this.adapters.employerSystem.getEnrollment(
      candidate.enrollmentExternalRef,
    );
    if (!confirmation.ok) {
      // The employer says there is no such enrollment: an answer, and a negative one.
      if (confirmation.reason === AdapterFailure.NOT_FOUND) {
        return {
          ...base,
          enrollment: { state: 'CONFIRMED_ABSENT' },
          plan: missing(MissingReason.NOT_CONFIGURED),
          balances: missing(MissingReason.NOT_CONFIGURED),
          ytdCategorySpendCents: missing(MissingReason.NOT_CONFIGURED),
        };
      }
      const reason = toMissingReason(confirmation.reason);
      return {
        ...base,
        enrollment: { state: 'UNKNOWN', reason },
        plan: missing(reason),
        balances: missing(reason),
        ytdCategorySpendCents: missing(reason),
      };
    }

    const plan = await this.benefits.findPlan(candidate.planId);
    const account = await this.benefits.findAccountByEnrollment(candidate.id);

    const planInput: EligibilityInputs['plan'] =
      plan === null || plan.coverageRules === null
        ? missing(MissingReason.NOT_CONFIGURED)
        : present({
            planId: plan.planId,
            planConfigVersion: plan.planConfigVersion,
            planConfigAsOf: plan.planConfigAsOf,
            planYearStart: plan.planYear.start,
            planYearEnd: plan.planYear.end,
            coverageRules: plan.coverageRules,
          });

    let balances: EligibilityInputs['balances'] = missing(MissingReason.NOT_CONFIGURED);
    let ytd: Input<number> = missing(MissingReason.NOT_CONFIGURED);

    if (account !== null) {
      const cardBalance = await this.adapters.cardSystem.getAvailableBalance(
        account.cardExternalRef,
      );
      balances = cardBalance.ok
        ? present({
            ledgerBalanceCents: account.ledgerBalanceCents,
            cardAvailableCents: cardBalance.data.availableCents,
            balanceAsOf: cardBalance.asOf,
            balanceSource: cardBalance.source,
          })
        : missing(toMissingReason(cardBalance.reason));

      if (plan !== null) {
        ytd = present(
          await this.benefits.getYtdCategorySpend(
            account.accountId,
            command.treatmentCategory,
            plan.planYear,
          ),
        );
      }
    }

    return {
      ...base,
      enrollment: {
        state: 'FOUND',
        value: {
          enrollmentId: candidate.id,
          planId: candidate.planId,
          status: confirmation.data.status,
          effectiveFrom: confirmation.data.effectiveFrom,
          effectiveTo: confirmation.data.effectiveTo,
          sourceAsOf: confirmation.asOf,
          source: confirmation.source,
        },
      },
      plan: planInput,
      balances,
      ytdCategorySpendCents: ytd,
    };
  }

  /**
   * Evaluates and stores. The care request, the decision and the audit event are written together,
   * so a decision never exists without the record of how it came about.
   *
   * Re-evaluating creates a new care request and a new decision. Nothing is ever updated: the
   * database refuses it, and so does this code.
   */
  async evaluateAndStore(
    command: EvaluateCommand,
  ): Promise<{ decision: EligibilityDecisionDto; result: EligibilityResult }> {
    const inputs = await this.assembleInputs(command);
    const result = evaluate(inputs);
    const snapshot = buildSnapshot(inputs, result);
    const enrollmentId =
      inputs.enrollment.state === 'FOUND' ? inputs.enrollment.value.enrollmentId : null;

    if (enrollmentId === null) {
      // With no enrollment to attach to, there is nothing to persist against. The decision is still
      // returned, so the member gets an answer, but no care request is invented to hold it.
      return {
        decision: {
          decisionId: '00000000-0000-4000-8000-000000000000',
          careRequestId: '00000000-0000-4000-8000-000000000000',
          outcome: result.outcome,
          coveredAmountCents: result.coveredAmountCents,
          requestedAmountCents: command.expenseAmountCents,
          treatmentCategory: command.treatmentCategory,
          serviceDate: command.serviceDate.toISOString().slice(0, 10),
          reasons: result.reasons,
          conditions: result.conditions,
          engineVersion: result.engineVersion,
          planConfigVersion: result.planConfigVersion,
          evaluatedAt: new Date().toISOString(),
        },
        result,
      };
    }

    const stored = await this.db.$transaction(async (tx) => {
      const careRequest = await tx.careRequest.create({
        data: {
          memberId: command.memberId,
          enrollmentId,
          treatmentCategory: command.treatmentCategory,
          expenseAmountCents: command.expenseAmountCents,
          serviceDate: command.serviceDate,
        },
      });

      const decision = await tx.eligibilityDecision.create({
        data: {
          careRequestId: careRequest.id,
          memberId: command.memberId,
          enrollmentId,
          outcome: result.outcome,
          coveredAmountCents: result.coveredAmountCents,
          reasons: result.reasons as unknown as Prisma.InputJsonValue,
          conditions: result.conditions,
          engineVersion: result.engineVersion,
          planConfigVersion: result.planConfigVersion,
          inputsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });

      await this.audit.withClient(tx).record({
        action: AuditAction.ELIGIBILITY_EVALUATED,
        outcome: AuditOutcome.SUCCESS,
        traceId: command.traceId,
        actorUserId: command.actorUserId,
        actorRole: 'MEMBER',
        resourceType: 'CARE_REQUEST',
        resourceId: careRequest.id,
        engineVersion: result.engineVersion,
        planConfigVersion: result.planConfigVersion,
        metadata: {
          ruleRefs: result.reasons.map((r) => r.ruleRef),
          inputsMissing: result.missingInputs.length,
        },
      });

      return { careRequest, decision };
    });

    return {
      decision: {
        decisionId: stored.decision.id,
        careRequestId: stored.careRequest.id,
        outcome: result.outcome,
        coveredAmountCents: result.coveredAmountCents,
        requestedAmountCents: command.expenseAmountCents,
        treatmentCategory: command.treatmentCategory,
        serviceDate: command.serviceDate.toISOString().slice(0, 10),
        reasons: result.reasons,
        conditions: result.conditions,
        engineVersion: result.engineVersion,
        planConfigVersion: result.planConfigVersion,
        evaluatedAt: stored.decision.evaluatedAt.toISOString(),
      },
      result,
    };
  }
}
