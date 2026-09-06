# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Health Capital AI POC: a production-minded proof of concept for an AI-native healthcare benefits platform answering
"Can I use my health capital to pay for this healthcare expense?". Independent synthetic-data proof of concept. It is not
based on or connected to any private company systems, data, APIs, or proprietary architecture. Synthetic data only.
All eligibility rules are synthetic POC semantics. Never claim HIPAA compliance.

## Core principles

1. The LLM never determines eligibility: authoritative data + deterministic rules -> decision -> AI explanation.
2. "Brand neutrality: the POC is an independent, company-neutral engineering demonstration and contains no
   company-specific names, branding, proprietary identifiers, private APIs, or private data."
3. "Encrypt in transit and at rest, authorize every access, minimize what is stored and shared, do not log sensitive
   content, and send only the minimum necessary context to AI providers."
   This is a security engineering principle used by this synthetic-data POC. It is not a claim of HIPAA compliance.

## Non-negotiable rules

- Company-neutral. Do not use company names, logos, trademarks, domains, product names, private API names, private schemas,
  or proprietary identifiers anywhere: source, UI copy, docs, tests, seed data, config, screenshots, demo credentials, comments,
  commits you generate, or deployment metadata. Use generic healthcare-benefits terminology only (approved names in
  docs/architecture.md). Never name a company even in a disclaimer. Do not reintroduce company-specific names from earlier
  conversation or research context; the POC must stand on its own. `pnpm brand-guard` enforces this for text (tracked files
  and event commit messages) in CI; screenshots, favicon/images, rendered UI and deployment display names are checked manually per release.
- Seed data is fictional: generic employer names, fictional member names, `example.test` emails, `EMP-/MBR-/ENR-/PLAN-` refs.
- Gemini may extract parameters, call allowlisted tools, and explain. It never invents, upgrades, or overrides a decision.
- Missing or conflicting authoritative data -> UNDETERMINED. Never guess.
- Data protection (demonstrates engineering judgment; does not establish HIPAA compliance):
  - Encryption in transit: HTTPS browser->API, TLS API->PostgreSQL (`sslmode=require`+), HTTPS API->Gemini via SDK.
  - Encryption at rest for deployed persistent storage via the managed provider. Local Docker Postgres makes no such claim.
    Per-field encryption, envelope encryption, customer KMS, tokenization are out of scope and must not be conflated with this.
  - Authorize every sensitive access: load resource, then `authorize(principal, action, resource)`. Encryption never replaces this.
  - Minimize persistence and sharing: store structured CareRequest, deterministic decision, minimized snapshot, structured audit only.
  - No sensitive content in logs: never bodies, query strings, Authorization/Cookie, passwords, JWTs, API keys, DB credentials,
    questions, prompts, tool bodies, model payloads, or Prisma entities with sensitive fields. Operational metadata only;
    log through the typed `SafeLogFields` shape in `apps/api/src/platform/logger.ts`.
  - Minimum-necessary AI context: Stage A gets only sanitized `AiUserQuery`; Stage B/tools only `AiSafe*` allowlists.
    Never name, email, DOB, address, employeeId, DB ids, memberRef, external refs, ledger or care history, or whole records.
  - Secrets never committed: `.env*` gitignored, `.env.example` placeholders only, gitleaks in CI. Server-only secrets
    (`GEMINI_API_KEY`, `DATABASE_URL`, `JWT_SECRET`) never reach `apps/web`.
  - Passwords are Argon2id hashes only; never reversibly encrypted, never logged, never returned.
  - `APP_ENV=demo` fails closed on non-HTTPS origins, non-TLS `DATABASE_URL`, short/placeholder secrets, wildcard CORS.
- Nothing from a user's free text is persisted: no question text, no question hash, no rendered-prompt hash.
  Audit records prompt template id/version only.
- Every `schema.prisma` field is classified in `modules/classification/registry.ts`; a CI test fails otherwise.
- Never trust IDs from URL/body. Employer scoping goes through `BenefitEnrollment`.
- Architecture is frozen for the initial POC (plan rev 5). Any change to the rules above needs an ADR in docs/adr/.
- Every AUTHZ deny, privileged read, evaluation, adapter call, AI call, tool call, and guard trip writes an audit event
  with refs, enums, cents, versions, latencies, redaction counts only.
- SUPPORT privileged reads need a closed `reasonCode` and constrained `caseRef`. No free-text justification.
- `GET /audit/events` returns `SupportAuditEventDto` (allowlist) only: never raw audit rows, amounts, categories, or member-linked IDs.
- Known negative != unknown: a confirmed absence of enrollment is INELIGIBLE; an unanswered/stale/conflicting source is UNDETERMINED.
- Persist only what a deterministic rule or audit needs. `CareRequest` has no `providerName`. Adding a stored field needs a rule that uses it and an ADR.
- `EmployerSystemAdapter` is enrollment-scoped (`enrollmentExternalRef`); that ref, like all external refs, never reaches Gemini.
- AI guidance is MEMBER-only. EMPLOYER_ADMIN never sees care requests, decisions, balances, ledgers, or PHI.
- Money is integer cents. Rule logic is versioned code (`ENGINE_VERSION`); plan parameters are data (`planConfigVersion`).
- Everything works with `GEMINI_API_KEY` unset.
- Security baseline (CORS allowlist, helmet, body limits, no-store, rate limits, config validation) ships with the endpoint.

## Domain invariants

The shape of the data model as implemented. Each is an architectural decision: changing one needs an ADR.
`docs/architecture.md` holds the full model; do not restate the schema here.

- `Member` is a portable person identity. Employer and plan relationships, with status and effective dates,
  belong to `BenefitEnrollment`. Never move employer-specific state back onto `Member`.
- `enrollmentExternalRef` belongs to `BenefitEnrollment`. It is classified INTERNAL and is enrollment-scoped,
  never member-scoped, and it never crosses the AI boundary (see the adapter rule above).
- One closed `BenefitCategory` vocabulary is shared by `CareRequest.treatmentCategory` and
  `LedgerEntry.benefitCategory`. Do not add a parallel category model or free-text categories without an ADR.
- Ledger amounts are positive magnitudes and the entry type decides the effect on balance
  (`CONTRIBUTION - DEBIT + ADJUSTMENT`). Do not introduce signed debit or credit storage semantics.
- `EligibilityDecision` is immutable. A later evaluation creates a new decision; no application path updates
  or deletes persisted decision history. A database trigger enforces this.
- `AuditEvent` is append-only. No application path updates or deletes an audit event. A database trigger
  enforces this.
- `CareRequest` stays minimized: no `providerName` and no arbitrary healthcare free text. A new stored field
  needs a deterministic product or audit requirement, and an ADR where it changes a rule above.

## Stack

pnpm workspace: `apps/api` (Fastify 5, Prisma, PostgreSQL, @google/genai), `apps/web` (Next.js App Router, pure API client, M5),
`packages/contracts` (zod DTOs). TypeScript strict, ESM. Vitest. ESLint flat config. GitHub Actions (CI / build validation
incl. brand guard and gitleaks; manual demo deploy in M7). Docker Compose for local Postgres. Modules under
`apps/api/src/modules/*` expose one `index.ts`; import only from it (ESLint `no-restricted-imports`).

## Commands

Every command below exists.
pnpm install · docker compose up -d · pnpm db:migrate · pnpm db:deploy · pnpm db:seed · pnpm db:reset · pnpm db:generate ·
pnpm dev (api :3001, web :3000) · pnpm dev:api · pnpm dev:web ·
pnpm test (unit and component) · pnpm test:integration · pnpm test:security · pnpm test:privacy · pnpm test:ai-pipeline
(the four above need a migrated and seeded PostgreSQL) ·
pnpm test:ai-live (runs against a real model; skips every case unless GEMINI_API_KEY is set, and has never been run with one) ·
pnpm lint · pnpm format · pnpm typecheck · pnpm build · pnpm brand-guard [--commits <range>] · pnpm docker:build
pnpm --filter @health-capital/api test src/platform/config.test.ts (single file)
Deployment preparation only, nothing is deployed: render.yaml, apps/web/vercel.json,
.github/workflows/demo-deploy.yml and pnpm demo:reseed configure a demonstration that has never been hosted.

Local setup: copy `.env.example` to `.env`; `APP_ENV=local` needs no secrets to boot. `pnpm db:seed` requires
`SEED_USER_PASSWORD` (at least 12 characters) and stores only its Argon2id hash. The generated Prisma client lives in
`apps/api/src/generated/` and is gitignored; run `pnpm db:generate` after editing the schema. The brand guard reads terms
from `BRAND_GUARD_TERMS` or a gitignored `.brand-guard-terms` file and skips with a warning locally when neither exists.

## Module map

classification -> audit -> auth/authorization ; members, benefits, integrations -> eligibility -> ai -> guidance.
`platform/` is infra only (config, logger, errors, http/). `guidance` is the only module that calls both `eligibility` and `ai`.
Docs in docs/ and docs/adr/; `docs/security-and-data-boundaries.md` carries the data-protection baseline. Add an ADR when changing a rule above.

## Development-assistant transparency

Claude Code is a development assistant (implementation, tests, docs). Decisions are reviewed and owned by the developer.
Gemini is the runtime AI provider. Claude Code is not part of the runtime architecture.
