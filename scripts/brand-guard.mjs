#!/usr/bin/env node
/**
 * Brand-neutrality guard.
 *
 * Fails when any forbidden term appears in (1) git-tracked text files plus untracked files that are
 * not gitignored (so local runs cover work in progress) or (2) the commit messages of the range passed
 * via --commits / BRAND_GUARD_COMMIT_RANGE (e.g. "base...head" or "HEAD -1"). Matching is case-insensitive.
 *
 * The forbidden-term list is intentionally NOT committed. Sources, in order:
 *   - env BRAND_GUARD_TERMS (comma-separated)          <- used in CI via a repository variable
 *   - file .brand-guard-terms (one term per line)       <- optional, gitignored, local use
 *
 * In CI (CI=true) a missing list is a failure so the guard cannot be skipped silently.
 * Locally a missing list prints a warning and exits 0.
 *
 * Scope: text only. Screenshots, favicon/image assets, rendered UI and hosting display names are
 * verified manually per release (see docs/demo.md once it exists).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const EXCLUDED_PREFIXES = ['node_modules/', '.git/', 'dist/', '.next/', 'coverage/'];
const EXCLUDED_SEGMENTS = ['/node_modules/', '/dist/', '/.next/', '/coverage/', '/generated/'];
const EXCLUDED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.gz',
]);

function parseArgs(argv) {
  const args = { commits: process.env.BRAND_GUARD_COMMIT_RANGE ?? null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--commits') {
      args.commits = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

function loadTerms() {
  const fromEnv = (process.env.BRAND_GUARD_TERMS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  if (existsSync('.brand-guard-terms')) {
    return readFileSync('.brand-guard-terms', 'utf8')
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith('#'));
  }
  return [];
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function isExcluded(path) {
  if (EXCLUDED_FILES.has(path)) return true;
  if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (EXCLUDED_SEGMENTS.some((s) => path.includes(s))) return true;
  const dot = path.lastIndexOf('.');
  return dot >= 0 && BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function looksBinary(buffer) {
  const probe = buffer.subarray(0, 8000);
  return probe.includes(0);
}

function findTerms(text, matchers) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    for (const { term, re } of matchers) {
      if (re.test(line)) hits.push({ line: idx + 1, term });
    }
  });
  return hits;
}

function scanTrackedFiles(matchers) {
  const tracked = git(['ls-files', '-z']).split('\0');
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard']).split('\0');
  const files = [...new Set([...tracked, ...untracked].filter(Boolean))];
  const findings = [];
  for (const path of files) {
    if (isExcluded(path) || !existsSync(path)) continue;
    const buffer = readFileSync(path);
    if (looksBinary(buffer)) continue;
    for (const hit of findTerms(buffer.toString('utf8'), matchers)) {
      findings.push(`${path}:${hit.line}: forbidden term #${hit.term}`);
    }
  }
  return { scanned: files.length, findings };
}

function scanCommitMessages(range, matchers) {
  // The range may carry extra git-log arguments (e.g. "HEAD -1"); split on whitespace.
  const rangeArgs = range.split(/\s+/).filter(Boolean);
  let raw;
  try {
    raw = git(['log', '--format=%H%x00%B%x1e', ...rangeArgs]);
  } catch (err) {
    process.stderr.write(
      `brand-guard: could not read commit range "${range}": ${err.message.split('\n')[0]}\n`,
    );
    process.exit(2);
  }
  const entries = raw
    .split('\x1e')
    .map((e) => e.trim())
    .filter(Boolean);
  const findings = [];
  for (const entry of entries) {
    const [sha, message = ''] = entry.split('\0');
    for (const hit of findTerms(message, matchers)) {
      findings.push(
        `commit ${sha.slice(0, 12)} message line ${hit.line}: forbidden term #${hit.term}`,
      );
    }
  }
  return { scanned: entries.length, findings };
}

function main() {
  const { commits } = parseArgs(process.argv.slice(2));
  const terms = loadTerms();
  const inCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

  if (terms.length === 0) {
    const msg =
      'brand-guard: no forbidden-term list found (BRAND_GUARD_TERMS or .brand-guard-terms).';
    if (inCi) {
      process.stderr.write(`${msg} Refusing to pass silently in CI.\n`);
      process.exit(2);
    }
    process.stdout.write(`${msg} Skipping (local run).\n`);
    return;
  }

  // Terms are referenced by index in output so the forbidden strings themselves never get printed.
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchers = terms.map((term, i) => ({ term: i + 1, re: new RegExp(escape(term), 'i') }));

  const files = scanTrackedFiles(matchers);
  const commitScan = commits ? scanCommitMessages(commits, matchers) : { scanned: 0, findings: [] };
  const findings = [...files.findings, ...commitScan.findings];

  process.stdout.write(
    `brand-guard: scanned ${files.scanned} tracked files and ${commitScan.scanned} commit message(s) against ${terms.length} term(s).\n`,
  );
  if (findings.length > 0) {
    process.stderr.write(
      `brand-guard: ${findings.length} finding(s):\n${findings.map((f) => `  ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write('brand-guard: OK\n');
}

main();
