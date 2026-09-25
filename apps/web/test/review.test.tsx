import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReviewPage from '@/app/review/page';

/** The engineering review is static content; it is checked as the server renders it. */
const markup = renderToStaticMarkup(<ReviewPage />);

describe('the engineering review page', () => {
  it('has one top-level heading and a heading for every linked section', () => {
    expect(markup.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    for (const [, id] of markup.matchAll(/href="#([a-z-]+)"/g)) {
      expect(markup, id).toContain(`id="${id}"`);
    }
  });

  it('links back to the demo and out to the source', () => {
    expect(markup).toMatch(/href="\/"/);
    expect(markup).toContain('https://github.com/');
  });

  it('opens nothing that hands the linking page to the destination', () => {
    for (const [tag] of markup.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)) {
      expect(tag).not.toMatch(/target="_blank"(?![^>]*noopener)/);
    }
  });

  it('claims no compliance and does not claim an unverified production answer', () => {
    expect(markup).toMatch(/no compliance claim/i);
    expect(markup).not.toMatch(/HIPAA[- ]compliant/i);
    // Workers AI is configured in production but has not been seen answering there.
    expect(markup).toMatch(/Workers AI answer from the deployed instance/);
  });
});
