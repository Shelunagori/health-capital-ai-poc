'use client';

import { useState, type FormEvent } from 'react';
import type { AskGuidanceResponse } from '@health-capital/contracts';
import { ApiError, api } from '@/lib/api-client';

/**
 * Ask in your own words.
 *
 * What is typed here is sent once, used, and dropped. It is not stored by the platform, and this
 * page keeps no history of it either.
 */
export function AskPanel({
  token,
  onResult,
}: {
  token: string;
  onResult: (result: AskGuidanceResponse) => void;
}): JSX.Element {
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (question.trim() === '') {
      setError('Type a question first.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.ask(token, question);
      onResult(result);
      // Cleared as soon as it has been sent: there is no reason for this page to keep it either.
      setQuestion('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The assistant could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(event) => void onSubmit(event)} aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask about an expense</h2>

      <label className="field">
        <span className="field__label">Your question</span>
        <textarea
          name="question"
          rows={3}
          maxLength={2000}
          placeholder="Can I use my health capital for physiotherapy?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Asking…' : 'Ask'}
      </button>

      <p className="hint">
        Your question is used to work out what to check and is not stored. The decision always comes
        from your plan rules, never from the assistant.
      </p>
    </form>
  );
}
