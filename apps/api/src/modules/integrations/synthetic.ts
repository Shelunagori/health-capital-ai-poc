import type { Db } from '../../platform/db.js';
import type { BenefitsService } from '../benefits/index.js';
import { Scenario, type ScenarioController } from './scenarios.js';
import {
  AdapterFailure,
  adapterFailed,
  adapterOk,
  type AdapterResult,
  type AvailableBalance,
  type BenefitsAdministratorAdapter,
  type CardSystemAdapter,
  type EmployerSystemAdapter,
  type EnrollmentRecord,
  type PlanConfiguration,
} from './types.js';

/**
 * Synthetic stand-ins for the three external systems.
 *
 * They read the seeded data, so a normal run behaves like a healthy integration. Under a scenario
 * they behave like an unhealthy one. A timeout is reported immediately rather than by waiting:
 * the interesting part is what the caller does with the answer, not the delay.
 */
const STALE_THRESHOLD_DAYS = 30;

function staleAsOf(): Date {
  return new Date(Date.now() - (STALE_THRESHOLD_DAYS + 15) * 86_400_000);
}

/** Failure scenarios map one-to-one onto adapter results; the normal path is handled by the caller. */
function failureFor(scenario: Scenario, source: string): AdapterResult<never> | null {
  switch (scenario) {
    case Scenario.UNAVAILABLE:
      return adapterFailed(AdapterFailure.UNAVAILABLE, source);
    case Scenario.TIMEOUT:
      return adapterFailed(AdapterFailure.TIMEOUT, source);
    case Scenario.STALE:
      return adapterFailed(AdapterFailure.STALE, source);
    case Scenario.NOT_FOUND:
      return adapterFailed(AdapterFailure.NOT_FOUND, source);
    default:
      return null;
  }
}

export class SyntheticEmployerSystemAdapter implements EmployerSystemAdapter {
  readonly name = 'EmployerSystemAdapter';

  constructor(
    private readonly db: Db,
    private readonly scenarios: ScenarioController,
  ) {}

  async getEnrollment(enrollmentExternalRef: string): Promise<AdapterResult<EnrollmentRecord>> {
    const scenario = this.scenarios.get('employerSystem');
    const failure = failureFor(scenario, this.name);
    if (failure !== null) return failure;

    const enrollment = await this.db.benefitEnrollment.findUnique({
      where: { enrollmentExternalRef },
      select: { status: true, effectiveFrom: true, effectiveTo: true, sourceAsOf: true },
    });

    // A reference the employer does not recognise is an answer, not a failure to answer.
    if (enrollment === null) return adapterFailed(AdapterFailure.NOT_FOUND, this.name);

    if (scenario === Scenario.CONFLICTING) {
      // The employer reports a status that contradicts what we hold.
      return adapterOk(
        {
          status: enrollment.status === 'ACTIVE' ? 'TERMINATED' : 'ACTIVE',
          effectiveFrom: enrollment.effectiveFrom,
          effectiveTo: enrollment.effectiveTo,
        },
        enrollment.sourceAsOf,
        this.name,
      );
    }

    return adapterOk(
      {
        status: enrollment.status,
        effectiveFrom: enrollment.effectiveFrom,
        effectiveTo: enrollment.effectiveTo,
      },
      enrollment.sourceAsOf,
      this.name,
    );
  }
}

export class SyntheticBenefitsAdministratorAdapter implements BenefitsAdministratorAdapter {
  readonly name = 'BenefitsAdministratorAdapter';

  constructor(
    private readonly benefits: BenefitsService,
    private readonly scenarios: ScenarioController,
  ) {}

  async getPlanConfiguration(planExternalRef: string): Promise<AdapterResult<PlanConfiguration>> {
    const scenario = this.scenarios.get('benefitsAdministrator');
    const failure = failureFor(scenario, this.name);
    if (failure !== null) return failure;

    const plan = await this.benefits.findPlanByExternalRef(planExternalRef);
    if (plan === null) return adapterFailed(AdapterFailure.NOT_FOUND, this.name);

    const asOf = scenario === Scenario.CONFLICTING ? staleAsOf() : plan.planConfigAsOf;
    return adapterOk(
      { planConfigVersion: plan.planConfigVersion, coverageRules: plan.coverageRules },
      asOf,
      this.name,
    );
  }
}

/** How far the card system's balance may differ from our ledger before we stop trusting either. */
export const BALANCE_TOLERANCE_CENTS = 100;

export class SyntheticCardSystemAdapter implements CardSystemAdapter {
  readonly name = 'CardSystemAdapter';

  constructor(
    private readonly benefits: BenefitsService,
    private readonly scenarios: ScenarioController,
  ) {}

  async getAvailableBalance(cardExternalRef: string): Promise<AdapterResult<AvailableBalance>> {
    const scenario = this.scenarios.get('cardSystem');
    const failure = failureFor(scenario, this.name);
    if (failure !== null) return failure;

    const account = await this.benefits.findAccountByCardRef(cardExternalRef);
    if (account === null) return adapterFailed(AdapterFailure.NOT_FOUND, this.name);

    const available =
      scenario === Scenario.CONFLICTING
        ? // Beyond tolerance on purpose: the two systems disagree about the money.
          account.ledgerBalanceCents + BALANCE_TOLERANCE_CENTS * 10
        : account.ledgerBalanceCents;

    return adapterOk({ availableCents: available }, new Date(), this.name);
  }
}
