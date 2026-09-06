import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIOS, Scenario, ScenarioController } from './scenarios.js';

describe('scenario control', () => {
  it('starts every adapter healthy', () => {
    expect(new ScenarioController().snapshot()).toEqual(DEFAULT_SCENARIOS);
  });

  it('accepts an initial setting per adapter', () => {
    const controller = new ScenarioController({ cardSystem: Scenario.UNAVAILABLE });
    expect(controller.get('cardSystem')).toBe('unavailable');
    expect(controller.get('employerSystem')).toBe('normal');
  });

  it('changes one adapter without disturbing the others', () => {
    const controller = new ScenarioController();
    controller.set('employerSystem', Scenario.TIMEOUT);
    expect(controller.snapshot()).toEqual({
      employerSystem: 'timeout',
      benefitsAdministrator: 'normal',
      cardSystem: 'normal',
    });
  });

  it('returns to healthy on reset', () => {
    const controller = new ScenarioController({ employerSystem: Scenario.STALE });
    controller.reset();
    expect(controller.snapshot()).toEqual(DEFAULT_SCENARIOS);
  });

  it('hands out a copy, so a caller cannot mutate the settings in place', () => {
    const controller = new ScenarioController();
    const snapshot = controller.snapshot();
    snapshot.cardSystem = Scenario.CONFLICTING;
    expect(controller.get('cardSystem')).toBe('normal');
  });
});
