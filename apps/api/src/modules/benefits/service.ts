import type { Db } from '../../platform/db.js';
import type { BenefitCategory } from '../../generated/prisma/enums.js';
import {
  computeLedgerBalance,
  computeYtdCategorySpend,
  type LedgerLine,
  type PlanYear,
} from './balance.js';
import { parseCoverageRules, type CoverageRule } from './coverage.js';

/**
 * Reads of health capital: what a plan covers, what an account holds, and what has been spent.
 * Nothing here decides eligibility; it supplies the numbers that the rules engine works from.
 */
export interface AccountSummary {
  accountId: string;
  enrollmentId: string;
  currency: string;
  cardExternalRef: string;
  ledgerBalanceCents: number;
}

export interface PlanSummary {
  planId: string;
  planExternalRef: string;
  name: string;
  planYear: PlanYear;
  planConfigVersion: number;
  planConfigAsOf: Date;
  /** Null when the stored configuration does not parse, which callers must treat as missing data. */
  coverageRules: CoverageRule[] | null;
}

export class BenefitsService {
  constructor(private readonly db: Db) {}

  async findAccountByEnrollment(enrollmentId: string): Promise<AccountSummary | null> {
    const account = await this.db.healthCapitalAccount.findUnique({
      where: { enrollmentId },
      select: {
        id: true,
        enrollmentId: true,
        currency: true,
        cardExternalRef: true,
        entries: {
          select: { type: true, amountCents: true, occurredAt: true, benefitCategory: true },
        },
      },
    });
    if (account === null) return null;

    return {
      accountId: account.id,
      enrollmentId: account.enrollmentId,
      currency: account.currency,
      cardExternalRef: account.cardExternalRef,
      ledgerBalanceCents: computeLedgerBalance(account.entries),
    };
  }

  async findAccountByCardRef(cardExternalRef: string): Promise<AccountSummary | null> {
    const account = await this.db.healthCapitalAccount.findUnique({
      where: { cardExternalRef },
      select: { enrollmentId: true },
    });
    return account === null ? null : this.findAccountByEnrollment(account.enrollmentId);
  }

  async listLedgerLines(accountId: string): Promise<LedgerLine[]> {
    return this.db.ledgerEntry.findMany({
      where: { accountId },
      select: { type: true, amountCents: true, occurredAt: true, benefitCategory: true },
      orderBy: { occurredAt: 'asc' },
    });
  }

  /** Spend in one category within the plan year, from debits net of adjustments. */
  async getYtdCategorySpend(
    accountId: string,
    category: BenefitCategory,
    planYear: PlanYear,
  ): Promise<number> {
    const lines = await this.listLedgerLines(accountId);
    return computeYtdCategorySpend(lines, category, planYear);
  }

  async findPlan(planId: string): Promise<PlanSummary | null> {
    const plan = await this.db.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        planExternalRef: true,
        name: true,
        planYearStart: true,
        planYearEnd: true,
        planConfigVersion: true,
        planConfigAsOf: true,
        coverageRules: true,
      },
    });
    if (plan === null) return null;

    return {
      planId: plan.id,
      planExternalRef: plan.planExternalRef,
      name: plan.name,
      planYear: { start: plan.planYearStart, end: plan.planYearEnd },
      planConfigVersion: plan.planConfigVersion,
      planConfigAsOf: plan.planConfigAsOf,
      coverageRules: parseCoverageRules(plan.coverageRules),
    };
  }

  async findPlanByExternalRef(planExternalRef: string): Promise<PlanSummary | null> {
    const plan = await this.db.plan.findUnique({
      where: { planExternalRef },
      select: { id: true },
    });
    return plan === null ? null : this.findPlan(plan.id);
  }
}
