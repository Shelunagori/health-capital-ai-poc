import { z } from 'zod';

/**
 * Which behaviour each synthetic external system should exhibit.
 *
 * Outages are a first-class demonstration, not an afterthought: the point of the deterministic
 * rules engine is what it does when it cannot get an answer, and that has to be reachable on demand.
 */
export const Scenario = {
  NORMAL: 'normal',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout',
  STALE: 'stale',
  CONFLICTING: 'conflicting',
  NOT_FOUND: 'not_found',
} as const;
export type Scenario = (typeof Scenario)[keyof typeof Scenario];

export const ScenarioSchema = z.enum([
  Scenario.NORMAL,
  Scenario.UNAVAILABLE,
  Scenario.TIMEOUT,
  Scenario.STALE,
  Scenario.CONFLICTING,
  Scenario.NOT_FOUND,
]);

export interface ScenarioSettings {
  employerSystem: Scenario;
  benefitsAdministrator: Scenario;
  cardSystem: Scenario;
}

export const DEFAULT_SCENARIOS: ScenarioSettings = {
  employerSystem: Scenario.NORMAL,
  benefitsAdministrator: Scenario.NORMAL,
  cardSystem: Scenario.NORMAL,
};

/**
 * Holds the current scenario per adapter. Set from configuration for a demonstration, or changed
 * directly in a test. Deliberately mutable so a scenario can be switched without rebuilding the app.
 */
export class ScenarioController {
  private settings: ScenarioSettings;

  constructor(initial: Partial<ScenarioSettings> = {}) {
    this.settings = { ...DEFAULT_SCENARIOS, ...initial };
  }

  get(adapter: keyof ScenarioSettings): Scenario {
    return this.settings[adapter];
  }

  set(adapter: keyof ScenarioSettings, scenario: Scenario): void {
    this.settings = { ...this.settings, [adapter]: scenario };
  }

  reset(): void {
    this.settings = { ...DEFAULT_SCENARIOS };
  }

  snapshot(): ScenarioSettings {
    return { ...this.settings };
  }
}
