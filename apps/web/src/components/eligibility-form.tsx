'use client';

import { useState, type FormEvent } from 'react';
import type { EvaluateEligibilityResponse } from '@health-capital/contracts';
import { ApiError, api } from '@/lib/api-client';
import { humaniseCategory } from '@/lib/format';

const CATEGORIES = [
  'PHYSICAL_THERAPY',
  'DENTAL',
  'VISION',
  'MENTAL_HEALTH',
  'PRESCRIPTION',
  'COSMETIC',
  'GYM_MEMBERSHIP',
  'OTHER',
] as const;

/**
 * The structured way to check an expense: a category, an amount and a date.
 *
 * There is no free-text field, on purpose. A member says what kind of care it is by choosing from
 * the list, so nothing has to be stored that would then need protecting. This form needs no AI
 * provider and keeps working when one is unavailable.
 */
export function EligibilityForm({
  token,
  onResult,
}: {
  token: string;
  onResult: (result: EvaluateEligibilityResponse) => void;
}): JSX.Element {
  const [category, setCategory] = useState<string>('PHYSICAL_THERAPY');
  const [amount, setAmount] = useState('180.00');
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      onResult(
        await api.evaluate(token, {
          treatmentCategory: category as (typeof CATEGORIES)[number],
          expenseAmountCents: cents,
          serviceDate,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The check could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="form"
      onSubmit={(event) => void onSubmit(event)}
      aria-labelledby="check-heading"
    >
      <div>
        <span className="eyebrow eyebrow--quiet">Straight from your plan rules</span>
        <h2 id="check-heading">Check an expense</h2>
        <p className="hint">
          Choose the kind of care and the amount. This route needs no assistant at all: your benefit
          rules produce the decision on their own.
        </p>
      </div>

      <label className="field">
        <span className="field__label">Kind of care</span>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          name="treatmentCategory"
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {humaniseCategory(value)}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Amount</span>
        <input
          type="number"
          name="amount"
          min="0.01"
          step="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Date of service</span>
        <input
          type="date"
          name="serviceDate"
          required
          value={serviceDate}
          onChange={(event) => setServiceDate(event.target.value)}
        />
      </label>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button button--full" disabled={busy}>
          {busy ? 'Checking…' : 'Check this expense'}
        </button>

        <p className="hint form__footnote">
          No free-text field, on purpose: nothing about your care is stored to answer this.
        </p>
      </div>
    </form>
  );
}
