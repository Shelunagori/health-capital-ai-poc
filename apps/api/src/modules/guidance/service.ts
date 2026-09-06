import type {
  AiStatus,
  AskGuidanceResponse,
  EligibilityDecisionDto,
  Principal,
} from '@health-capital/contracts';
import { AuditAction, AuditOutcome, type AuditRecorder } from '../audit/index.js';
import {
  AiUnavailableError,
  EXPLANATION_RESPONSE_SCHEMA,
  STAGE_A_PROMPT,
  STAGE_B_PROMPT,
  sanitizeUserQuery,
  toAiSafeExplanationContext,
  type AIProvider,
  type KnownProfileValues,
  type ToolExchange,
} from '../ai/index.js';
import { templateExplanation, type EligibilityResult } from '../eligibility/index.js';
import type { ToolExecutor } from './tools.js';
import { TOOL_DEFINITIONS, type ToolExecutionContext } from './tools.js';
import type { GuardFailure } from './verdict-guard.js';
import { checkExplanation } from './verdict-guard.js';

/**
 * The member's natural-language path to an answer.
 *
 * Two stages, deliberately separate. The first reads what the member wrote and may call tools. The
 * second writes an explanation and never sees the member's words at all, which is why nothing a
 * member types can reach the explanation, however it is phrased.
 *
 * Between the two sits the decision, made by deterministic rules. The model's part is finding out
 * what to ask and putting the answer into words.
 */
export const MAX_TOOL_ROUNDS = 3;

const CLARIFICATION =
  'Tell me which kind of care this is for and roughly how much it costs, and I can check whether your health capital covers it.';

export interface GuidanceRequest {
  principal: Principal;
  traceId: string;
  /** Raw member text. Sanitized here and never stored, in any form. */
  question: string;
  profile: KnownProfileValues;
}

export interface GuidanceDeps {
  provider: AIProvider;
  executor: ToolExecutor;
  audit: AuditRecorder;
}

interface DecisionCapture {
  decision: EligibilityDecisionDto;
  result: EligibilityResult;
  availableBalanceCents: number | null;
  remainingCategoryLimitCents: number | null;
}

export class GuidanceService {
  constructor(private readonly deps: GuidanceDeps) {}

  async ask(request: GuidanceRequest): Promise<AskGuidanceResponse> {
    const query = sanitizeUserQuery(request.question, request.profile);

    let captured: DecisionCapture | null = null;
    const toolContext: ToolExecutionContext = {
      principal: request.principal,
      traceId: request.traceId,
      onDecision: (evaluation) => {
        // Taken from the decision's own snapshot rather than recomputed, so the explanation
        // describes exactly the numbers the decision was made from.
        const { snapshot } = evaluation;
        const limit = snapshot.coverageRuleApplied?.annualLimitCents ?? null;
        const spent = snapshot.ytdCategorySpendCents;
        captured = {
          decision: evaluation.decision,
          result: evaluation.result,
          availableBalanceCents: snapshot.cardAvailableCents,
          remainingCategoryLimitCents:
            limit === null || spent === null ? null : Math.max(0, limit - spent),
        };
      },
    };

    const exchanges: ToolExchange[] = [];
    let stageAFailed = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      let turn;
      try {
        const startedAt = Date.now();
        turn = await this.deps.provider.generateWithTools({
          systemInstruction: STAGE_A_PROMPT.systemInstruction,
          promptTemplateId: STAGE_A_PROMPT.id,
          promptVersion: STAGE_A_PROMPT.version,
          query,
          tools: TOOL_DEFINITIONS,
          exchanges,
        });
        await this.recordCall('A', startedAt, query.redactions, request);
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err;
        stageAFailed = true;
        break;
      }

      if (turn.toolCalls.length === 0) break;

      for (const call of turn.toolCalls) {
        const result = await this.deps.executor.execute(call, toolContext, round + 1);
        exchanges.push({ call, result });
      }

      if (captured !== null) break;
    }

    // The provider could not be reached at all. The structured form still works, and saying so is
    // more use than an apology.
    if (stageAFailed && captured === null) {
      return {
        decision: null,
        explanation:
          'The assistant is unavailable right now. You can still check an expense using the form, which does not need it.',
        explanationSource: 'template',
        aiStatus: 'unavailable',
      };
    }

    // Nothing was evaluated: the question was not about a specific expense, or lacked what a check
    // needs. Nothing is persisted, because nothing was decided.
    if (captured === null) {
      return {
        decision: null,
        explanation: CLARIFICATION,
        explanationSource: 'template',
        aiStatus: stageAFailed ? 'unavailable' : 'ok',
      };
    }

    const capture: DecisionCapture = captured;
    const fallback = (aiStatus: AiStatus): AskGuidanceResponse => ({
      decision: capture.decision,
      explanation: templateExplanation(capture.result),
      explanationSource: 'template',
      aiStatus,
    });

    if (!this.deps.provider.available) return fallback('unavailable');

    const context = toAiSafeExplanationContext({
      result: capture.result,
      treatmentCategory: capture.decision.treatmentCategory,
      expenseAmountCents: capture.decision.requestedAmountCents,
      serviceDate: capture.decision.serviceDate,
      availableBalanceCents: capture.availableBalanceCents,
      remainingCategoryLimitCents: capture.remainingCategoryLimitCents,
    });

    let candidate: unknown;
    try {
      const startedAt = Date.now();
      candidate = await this.deps.provider.generateStructured({
        systemInstruction: STAGE_B_PROMPT.systemInstruction,
        promptTemplateId: STAGE_B_PROMPT.id,
        promptVersion: STAGE_B_PROMPT.version,
        context,
        responseSchema: EXPLANATION_RESPONSE_SCHEMA,
      });
      // No redaction count here: this stage receives no member text to redact.
      await this.recordCall('B', startedAt, [], request);
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      return fallback('unavailable');
    }

    const verdict = checkExplanation(candidate, capture.result.outcome, context);
    if (!verdict.ok) {
      await this.recordGuard(verdict.failure, request);
      // The decision stands. Only the wording is replaced.
      return fallback('degraded');
    }

    const explanation = (candidate as { explanation: string }).explanation.trim();
    return {
      decision: capture.decision,
      explanation,
      explanationSource: 'ai',
      aiStatus: 'ok',
    };
  }

  private async recordCall(
    stage: 'A' | 'B',
    startedAt: number,
    redactions: { kind: string; count: number }[],
    request: GuidanceRequest,
  ): Promise<void> {
    await this.deps.audit.record({
      action: AuditAction.AI_CALL,
      outcome: AuditOutcome.SUCCESS,
      traceId: request.traceId,
      actorUserId: request.principal.userId,
      actorRole: request.principal.role,
      aiProvider: this.deps.provider.name,
      aiModel: this.deps.provider.model,
      // The template that produced the call, never the rendered prompt and never a hash of one:
      // a first-stage prompt contains the member's own words.
      promptTemplateId: stage === 'A' ? STAGE_A_PROMPT.id : STAGE_B_PROMPT.id,
      promptVersion: stage === 'A' ? STAGE_A_PROMPT.version : STAGE_B_PROMPT.version,
      metadata: { stage, latencyMs: Date.now() - startedAt, redactions },
    });
  }

  private async recordGuard(failure: GuardFailure, request: GuidanceRequest): Promise<void> {
    await this.deps.audit.record({
      action: AuditAction.AI_GUARD_TRIGGERED,
      outcome: AuditOutcome.DENY,
      traceId: request.traceId,
      actorUserId: request.principal.userId,
      actorRole: request.principal.role,
      aiProvider: this.deps.provider.name,
      aiModel: this.deps.provider.model,
      metadata: { guard: failure },
    });
  }
}
