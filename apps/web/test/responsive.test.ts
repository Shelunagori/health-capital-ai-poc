import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { viewport } from '@/app/layout';

/**
 * Layout at a narrow width.
 *
 * A test environment with no layout engine cannot measure a rendered page, so these check the
 * things that decide whether a narrow screen works: the viewport is declared, nothing is pinned
 * wider than a small phone, and anything that can overflow scrolls inside its own box rather than
 * dragging the page sideways.
 */
const NARROWEST_SUPPORTED_PX = 360;

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const css = read('../src/app/globals.css');

/** The body of one media query, read from the stylesheet rather than guessed at. */
const block = (query: string): string => {
  const start = css.indexOf(query);
  return start === -1 ? '' : css.slice(start, css.indexOf('\n}\n', start));
};

describe('the page is built for a narrow screen', () => {
  it('declares the viewport, so a phone does not render it at desktop width', () => {
    expect(viewport).toMatchObject({ width: 'device-width', initialScale: 1 });
  });

  it('pins nothing wider than the narrowest screen it supports', () => {
    const offenders: string[] = [];
    for (const [declaration, value] of css.matchAll(/(?:^|\s)(width|min-width)\s*:\s*(\d+)px/gm)) {
      // `min-width` inside a media query is a breakpoint, not a fixed size, and those use rem here.
      if (Number(value) > NARROWEST_SUPPORTED_PX) offenders.push(declaration ?? '');
    }
    expect(
      offenders,
      `fixed widths wider than ${NARROWEST_SUPPORTED_PX}px: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('starts single column and only splits when there is room', () => {
    expect(css).toMatch(/\.workspace\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.workspace__actions\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/@media \(min-width: 48rem\)/);
  });

  it('splits the two forms before it splits the page', () => {
    // Tablet: Ask and Check side by side, results still full width in normal document flow.
    const tablet = block('@media (min-width: 48rem)');
    expect(tablet).toMatch(/\.workspace__actions\s*\{[^}]*grid-template-columns:\s*minmax/);
    expect(tablet).not.toMatch(/\.workspace\s*\{/);
    expect(tablet).not.toMatch(/\.history\s*\{/);
  });

  it('puts actions beside results, rather than three columns, on a wide screen', () => {
    const wide = block('@media (min-width: 74rem)');
    // Two tracks: the actions area and the results column.
    const columns = /\.workspace\s*\{[^}]*grid-template-columns:([^;]*);/.exec(wide)?.[1] ?? '';
    expect(columns.match(/minmax/g) ?? []).toHaveLength(2);
  });

  it('matches the two forms to each other once they share a row', () => {
    const tablet = block('@media (min-width: 48rem)');
    expect(tablet).toMatch(/\.workspace__actions\s*\{[^}]*align-items:\s*stretch/);
  });

  it('never forces a form to the height of the results column', () => {
    // Stacked, each form is its own height; the pairing above is what aligns them side by side.
    expect(css).toMatch(/\.workspace__actions\s*\{[^}]*align-items:\s*start/);
    // The three ways that empty white area came back before.
    expect(css).not.toMatch(/margin-top:\s*auto/);
    expect(css).not.toMatch(/\.panel\s*\{[^}]*height:\s*100%/);
    for (const selector of [
      '\\.workspace',
      '\\.workspace__actions',
      '\\.workspace__results',
      '\\.panel',
    ]) {
      expect(css).not.toMatch(new RegExp(`${selector}\\s*\\{[^}]*(?:min-)?height:`));
    }
  });

  it('lines the columns up on one bottom edge', () => {
    const wide = block('@media (min-width: 74rem)');
    expect(wide).toMatch(/\.workspace\s*\{[^}]*align-items:\s*stretch/);
  });

  it('keeps the history out of the row height, so a long one cannot stretch the forms', () => {
    // An in-flow list reports its full height to the grid, and the forms get padded out to match.
    // Out of flow it reports nothing: the forms decide the row and the list fills what it is given.
    const wide = block('@media (min-width: 74rem)');
    expect(wide).toMatch(
      /\.workspace__results\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/,
    );
    expect(wide).toMatch(/\.history-frame\s*\{[^}]*position:\s*relative/);
    expect(wide).toMatch(/\.history\s*\{[^}]*position:\s*absolute/);
    expect(wide).toMatch(/\.history\s*\{[^}]*inset:\s*0/);
    expect(wide).toMatch(/\.history\s*\{[^}]*overflow-y:\s*auto/);
    // Never sideways: the cards inside it wrap.
    expect(css).not.toMatch(/\.history\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/);
  });

  it('leaves tablet and phone in normal document flow', () => {
    // Nothing bounds the history until the wide breakpoint, so both scroll the page as usual.
    const beforeWide = css.slice(0, css.indexOf('@media (min-width: 74rem)'));
    expect(beforeWide).not.toMatch(/\.history\s*\{/);
    expect(beforeWide).not.toMatch(/\.history-frame\s*\{/);
    expect(beforeWide).not.toMatch(/\.workspace__results\s*\{[^}]*grid-template-rows/);
  });

  it('lets wide content scroll inside its own box', () => {
    expect(css).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('keeps a visible focus ring rather than removing outlines', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
    expect(css).not.toMatch(/outline:\s*(?:none|0)\b/);
  });

  it('gives touch targets a usable height', () => {
    expect(css).toMatch(/\.button\s*\{[^}]*min-height:\s*2\.75rem/);
  });

  it('stops its loading animation for a reader who asked for less motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(block).toMatch(/animation-duration:\s*0\.001ms/);
  });

  it('lets a wide page breathe without pinning it to one width', () => {
    expect(css).toMatch(/\.shell\s*\{[^}]*max-width:\s*\d/);
    expect(css).toMatch(/\.shell\s*\{[^}]*padding:\s*clamp\(/);
  });

  it('sizes text in relative units so a reader can enlarge it', () => {
    const bodyFont = /body\s*\{[^}]*font:\s*16px/.test(css);
    expect(bodyFont, 'body sets a base size; everything else should be relative').toBe(true);
    const absoluteSizes = [...css.matchAll(/font-size:\s*(\d+)px/g)];
    expect(absoluteSizes.map((match) => match[0])).toEqual([]);
  });
});

describe('every table can scroll on a narrow screen', () => {
  it('wraps each one in a scroll container', () => {
    for (const relative of [
      '../src/components/employer-view.tsx',
      '../src/components/support-view.tsx',
    ]) {
      const source = read(relative);
      const tables = source.match(/<table/g) ?? [];
      const wrappers = source.match(/className="table-scroll"/g) ?? [];
      expect(wrappers.length, `${relative} has ${tables.length} table(s)`).toBe(tables.length);
    }
  });

  it('gives each table a caption for screen readers', () => {
    for (const relative of [
      '../src/components/employer-view.tsx',
      '../src/components/support-view.tsx',
    ]) {
      const source = read(relative);
      const tables = (source.match(/<table/g) ?? []).length;
      const captions = (source.match(/<caption/g) ?? []).length;
      expect(captions, relative).toBe(tables);
    }
  });
});
