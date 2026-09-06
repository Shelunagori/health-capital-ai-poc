import { z } from 'zod';
import type { Principal } from '@health-capital/contracts';
import { AuditAction, AuditOutcome, type AuditRecorder } from '../audit/index.js';
import {
  toAiSafeBalanceResult,
  toAiSafeCategoriesResult,
  toAiSafeDecisionResult,
  toAiSafeToolError,
  type AiSafeToolResult,
  type ModelToolCall,
  type ToolDefinition,
} from '../ai/index.js';
import type { BenefitsService } from '../benefits/index.js';
import type { EligibilityService } from '../eligibility/index.js';
import type { Db } from '../../platform/db.js';

/**
 * What a model is allowed to do.
 *
 * Three rules hold here. Arguments are untrusted, because they are whatever a model produced, so
 * every one is parsed against a strict schema before anything acts on it. No tool takes a member,
 * enrollment or account identifier: the acting member comes from the verified token, so a model
 * cannot choose whose data to touch even if it tries. And every invocation is recorded, allowed or
 * refused alike.
 */
const CATEGORY = z.enum([
  'PHYSICAL_THERAPY',
  'DENTAL',
  'VISION',
  'MENTAL_HEALTH',
  'PRESCRIPTION',
  'COSMETIC',
  'GYM_MEMBERSHIP',
  'OTHER',
]);

const evaluateArgs = z
  .object({
    treatmentCategory: CATEGORY,
    expenseAmountCents: z.number().int().positive().max(100_000_000),
    serviceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

const noArgs = z.object({}).strict();

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'evaluate_expense_eligibility',
    description:
      'Ask the deterministic rules whether health capital can pay for one expense. Returns the decision. This is the only source of an eligibility outcome.',
    parameters: {
      type: 'object',
      properties: {
        treatmentCategory: { type: 'string', enum: CATEGORY.options },
        expenseAmountCents: { type: 'integer', description: 'The amount in whole cents.' },
        serviceDate: {
          type: 'string',
          description: 'Date of service as YYYY-MM-DD. Defaults to today.',
        },
      },
      required: ['treatmentCategory', 'expenseAmountCents'],
    },
  },
  {
    name: 'get_available_balance',
    description: 'Return how much health capital is currently available. Takes no arguments.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_covered_categories',
    description:
      'List the expense categories this plan covers, with any annual limits. Takes no arguments.',
    parameters: { type: 'object', properties: {} },
  },
];

/** Which roles may invoke each tool. Guidance is member-only, and the registry says so too. */
const TOOL_ROLES: Record<string, Principal['role'][]> = {
  evaluate_expense_eligibility: ['MEMBER'],
  get_available_balance: ['MEMBER'],
  list_covered_categories: ['MEMBER'],
};

export interface ToolExecutionContext {
  principal: Principal;
  traceId: string;
  /** Set when the eligibility tool ran, so the caller uses the decision rather than the model's word. */
  onDecision: (decision: Awaited<ReturnType<EligibilityService['evaluateAndStore']>>) => void;
}

export interface ToolExecutorDeps {
  db: Db;
  benefits: BenefitsService;
  eligibility: EligibilityService;
  audit: AuditRecorder;
}

export class ToolExecutor {
  constructor(private readonly deps: ToolExecutorDeps) {}

  /** Runs one model-requested tool call, or returns a refusal the model can read. */
  async execute(
    call: ModelToolCall,
    context: ToolExecutionContext,
    round: number,
  ): Promise<AiSafeToolResult> {
    const allowedRoles = TOOL_ROLES[call.name];

    if (allowedRoles === undefined) {
      // A tool the model invented. Nothing runs, and the attempt is on the record.
      await this.record(call.name, false, round, context, AuditOutcome.DENY);
      return toAiSafeToolError('No such tool.');
    }

    if (!allowedRoles.includes(context.principal.role)) {
      await this.record(call.name, false, round, context, AuditOutcome.DENY);
      return toAiSafeToolError('Not permitted.');
    }

    switch (call.name) {
      case 'get_available_balance':
        return this.runBalance(call, context, round);
      case 'list_covered_categories':
        return this.runCategories(call, context, round);
      case 'evaluate_expense_eligibility':
        return this.runEligibility(call, context, round);
      default:
        await this.record(call.name, false, round, context, AuditOutcome.DENY);
        return toAiSafeToolError('No such tool.');
    }
  }

  private async record(
    toolName: string,
    argumentsValid: boolean,
    rounds: number,
    context: ToolExecutionContext,
    outcome: AuditOutcome,
  ): Promise<void> {
    await this.deps.audit.record({
      action: AuditAction.TOOL_CALL,
      outcome,
      traceId: context.traceId,
      actorUserId: context.principal.userId,
      actorRole: context.principal.role,
      // The arguments themselves are never recorded: they can carry whatever the model produced.
      metadata: { toolName, argumentsValid, rounds },
    });
  }

  /** The member's own enrollment, resolved from the token. Never from a tool argument. */
  private async currentEnrollment(
    principal: Principal,
  ): Promise<{ id: string; planId: string } | null> {
    if (principal.memberId === null) return null;
    return this.deps.db.benefitEnrollment.findFirst({
      where: { memberId: principal.memberId, status: 'ACTIVE' },
      select: { id: true, planId: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private async runBalance(
    call: ModelToolCall,
    context: ToolExecutionContext,
    round: number,
  ): Promise<AiSafeToolResult> {
    if (!noArgs.safeParse(call.args ?? {}).success) {
      await this.record(call.name, false, round, context, AuditOutcome.DENY);
      return toAiSafeToolError('This tool takes no arguments.');
    }

    const enrollment = await this.currentEnrollment(context.principal);
    if (enrollment === null) {
      await this.record(call.name, true, round, context, AuditOutcome.FAILURE);
      return toAiSafeToolError('No active enrollment.');
    }

    const account = await this.deps.benefits.findAccountByEnrollment(enrollment.id);
    if (account === null) {
      await this.record(call.name, true, round, context, AuditOutcome.FAILURE);
      return toAiSafeToolError('No health capital account.');
    }

    await this.record(call.name, true, round, context, AuditOutcome.SUCCESS);
    return toAiSafeBalanceResult(account.ledgerBalanceCents, account.currency);
  }

  private async runCategories(
    call: ModelToolCall,
    context: ToolExecutionContext,
    round: number,
  ): Promise<AiSafeToolResult> {
    if (!noArgs.safeParse(call.args ?? {}).success) {
      await this.record(call.name, false, round, context, AuditOutcome.DENY);
      return toAiSafeToolError('This tool takes no arguments.');
    }

    const enrollment = await this.currentEnrollment(context.principal);
    const plan = enrollment === null ? null : await this.deps.benefits.findPlan(enrollment.planId);
    if (plan?.coverageRules == null) {
      await this.record(call.name, true, round, context, AuditOutcome.FAILURE);
      return toAiSafeToolError('Plan details are not available.');
    }

    await this.record(call.name, true, round, context, AuditOutcome.SUCCESS);
    return toAiSafeCategoriesResult(plan.coverageRules);
  }

  private async runEligibility(
    call: ModelToolCall,
    context: ToolExecutionContext,
    round: number,
  ): Promise<AiSafeToolResult> {
    const parsed = evaluateArgs.safeParse(call.args);
    if (!parsed.success) {
      // Includes the case where a model tried to supply a member identifier: the schema is strict,
      // so an extra key is a parse failure rather than something to strip and carry on with.
      await this.record(call.name, false, round, context, AuditOutcome.DENY);
      return toAiSafeToolError('Provide a known category and an amount in whole cents.');
    }

    if (context.principal.memberId === null) {
      await this.record(call.name, true, round, context, AuditOutcome.DENY);
      return toAiSafeToolError('Not permitted.');
    }

    const evaluation = await this.deps.eligibility.evaluateAndStore({
      // Bound from the verified token, never from the model's arguments.
      memberId: context.principal.memberId,
      treatmentCategory: parsed.data.treatmentCategory,
      expenseAmountCents: parsed.data.expenseAmountCents,
      serviceDate:
        parsed.data.serviceDate === undefined ? new Date() : new Date(parsed.data.serviceDate),
      traceId: context.traceId,
      actorUserId: context.principal.userId,
    });

    context.onDecision(evaluation);
    await this.record(call.name, true, round, context, AuditOutcome.SUCCESS);

    return toAiSafeDecisionResult(
      evaluation.result,
      parsed.data.treatmentCategory,
      parsed.data.expenseAmountCents,
    );
  }
}
