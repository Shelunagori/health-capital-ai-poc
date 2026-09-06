/*
 * A fixed timezone for the whole web suite.
 *
 * Dates are half the thing under test here, and a suite that passes in one zone and fails in
 * another is worse than no suite. This one is deliberately behind UTC, so a calendar date that is
 * mistakenly put through `new Date` shows the day before and the test catches it.
 */
process.env.TZ = 'America/New_York';

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
