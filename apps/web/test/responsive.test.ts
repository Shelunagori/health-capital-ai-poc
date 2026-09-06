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
    expect(css).toMatch(/@media \(min-width: 48rem\)/);
  });

  it('adds the third workspace column only on a wide screen', () => {
    // Two columns from 48rem, three from 74rem: the results column joins the row last.
    expect(css).toMatch(/@media \(min-width: 74rem\)/);
    const wide = /@media \(min-width: 74rem\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(wide).toMatch(/\.workspace\s*\{[^}]*grid-template-columns:[^;]*minmax/);
  });

  it('finishes the columns of a shared row on one baseline', () => {
    const shared = /@media \(min-width: 48rem\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(shared).toMatch(/\.workspace\s*\{[^}]*align-items:\s*stretch/);
  });

  it('stretches the panels without stretching what is inside them', () => {
    // The surfaces fill the row; a form's action is never pushed to the foot of a tall card, which
    // is what left a block of empty space in the shorter column.
    expect(css).not.toMatch(/margin-top:\s*auto/);
    expect(css).not.toMatch(/\.workspace\s*\{[^}]*(?:min-)?height:/);
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
