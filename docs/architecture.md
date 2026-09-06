# Architecture

Independent synthetic-data proof of concept for an AI-native healthcare benefits platform. It answers one
member question, "Can I use my health capital to pay for this healthcare expense?", while demonstrating
deterministic eligibility, regulated-data boundaries, role-based access, auditability, integration boundaries,
safe tool calling, and AI pipeline testing. It is not based on or connected to any private company systems,
data, APIs, or proprietary architecture. No HIPAA compliance is claimed.

## Principles

1. **The LLM never determines eligibility.**
   `authoritative data + deterministic rules -> eligibility decision -> AI explanation`
2. **Brand neutrality:** the POC is an independent, company-neutral engineering demonstration and contains no
   company-specific names, branding, proprietary identifiers, private APIs, or private data.
3. **Data protection:** encrypt in transit and at rest, authorize every access, minimize what is stored and
   shared, do not log sensitive content, and send only the minimum necessary context to AI providers.
   This is a security engineering principle used by this synthetic-data POC, not a claim of HIPAA compliance.

## Shape

A pnpm workspace with a modular monolith API and a thin web client.

| Path                 | Role                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/api`           | Fastify API. All business logic. Modules under `src/modules/*`, infrastructure under `src/platform/`.             |
| `apps/web`           | Next.js client for members, employers and support. Holds no secrets; every authorization decision is server-side. |
| `packages/contracts` | Zod request/response schemas shared by API and web.                                                               |
| `docs/`              | Architecture, security boundaries, threat model, AI architecture, demo notes, ADRs.                               |

## Modules and dependency direction

```
platform <- classification <- audit <- auth, authorization
                                  ^
        members, benefits, integrations <- eligibility <- ai (types only) <- guidance
```

Every module exposes a single `index.ts`. Other modules import only from that index; an ESLint
`no-restricted-imports` rule enforces it. `guidance` is the only module that calls both `eligibility`
and `ai`. `platform/` contains configuration, logging, error mapping and HTTP plumbing only.

| Module                   | Responsibility                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `classification`         | Field-level data classes (PII, PHI, FIN, SECRET, INTERNAL, PUBLIC) for every persisted field    |
| `audit`                  | Append-only audit events with closed metadata schemas; support-facing allowlisted DTO           |
| `auth` / `authorization` | Login and JWT; `authorize(principal, action, resource)` policy with tenancy checks              |
| `members`                | Member (portable identity), `BenefitEnrollment`, Employer, role-specific DTOs                   |
| `benefits`               | Plan configuration, health capital account, ledger, category spend                              |
| `integrations`           | Employer system, benefits administrator and card system adapters (synthetic, scenario-driven)   |
| `eligibility`            | Deterministic, versioned rules producing an immutable decision with a replayable snapshot       |
| `ai`                     | Provider abstraction, sanitizer, minimizer, prompt templates, tool registry and executor        |
| `guidance`               | Member natural-language flow: sanitize, tool loop, deterministic decision, grounded explanation |

## Approved naming

Generic healthcare-benefits terminology only.

- Product / UI: `Health Capital`, `Benefits Guidance`, `Benefits AI`, `Member Dashboard`
- Domain: `Employer`, `Member`, `BenefitEnrollment`, `BenefitPlan`, `HealthCapitalAccount`,
  `BenefitsAdministratorAdapter`, `EmployerSystemAdapter`, `CardSystemAdapter`
- Synthetic identifiers: `EMP-001`, `MBR-001`, `ENR-001`, `PLAN-PT-04`, `ACME-DEMO`, `DEMO-EMPLOYER-A`
- Seed data: fictional employers and members, emails under `example.test`
- Prose: "the platform", "the POC", "the member", "the employer", "the benefits administrator"

## Data model

`Member` is a portable person identity. It holds no employer, plan, login or contact data. Every
employer and plan relationship lives on `BenefitEnrollment`, which carries status, an effective
date range and an opaque `enrollmentExternalRef` that the employer system adapter resolves. A
person who changes employer gains a second enrollment rather than a second member record, and
tenancy checks always resolve through the enrollment.

| Model                  | Holds                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| `Employer`             | Organisation and its opaque reference                                            |
| `Plan`                 | Plan year, `coverageRules` as data, `planConfigVersion` and `planConfigAsOf`     |
| `Member`               | Person identity only: name, date of birth, address                               |
| `BenefitEnrollment`    | Member to employer and plan, with status and effective dates                     |
| `HealthCapitalAccount` | One per enrollment, with the opaque card reference                               |
| `LedgerEntry`          | Contributions, debits and adjustments, each debit tagged with a benefit category |
| `User`                 | Login identity, role and exactly one scope reference                             |
| `CareRequest`          | The structured expense: category, amount, service date                           |
| `EligibilityDecision`  | Immutable rules-engine output with a replayable `inputsSnapshot`                 |
| `AuditEvent`           | Append-only trail with closed metadata                                           |

Conventions: UUID identifiers, integer cents, positive amounts with the entry type carrying the
sign. `BenefitCategory` is one closed vocabulary shared by `CareRequest.treatmentCategory` and
`LedgerEntry.benefitCategory`, so year-to-date category spend can be compared with a request.
No provider name is persisted, because no deterministic rule consumes it.

Balance is `CONTRIBUTION - DEBIT + ADJUSTMENT`. Year-to-date category spend is
`DEBIT(category) - ADJUSTMENT(category)` within the plan year.

### Integrity in the database

Check constraints cover invariants that are always true: forward-going plan years and enrollment
windows, a terminated enrollment having an end date, positive amounts, a debit naming its category,
an undetermined decision carrying no covered amount, a constrained support case reference, and
exactly one scope reference per user role. Triggers make `EligibilityDecision` and `AuditEvent`
append-only, so immutability does not depend on application discipline.

Invariants that need business context, such as which enrollment applies to a service date or
whether an adjustment offsets a particular debit, live in the rules engine instead. Encoding them as
constraints would be brittle and would duplicate what the engine already decides.

## Eligibility

Deterministic and versioned. `assembleInputs` gathers the facts, each one either present or
explicitly absent with a reason, and `evaluate` is a pure function over them: no database, no clock,
no network, no model.

| Rule               | What it settles                                                                      |
| ------------------ | ------------------------------------------------------------------------------------ |
| `ELIG-DATA-00`     | Anything still unknown, or two systems disagreeing about money, stops the evaluation |
| `ELIG-ENROLL-01`   | A confirmed absence of enrollment, or one that is inactive or outside its period     |
| `ELIG-PLANYEAR-02` | The date of service falls inside the plan year                                       |
| `ELIG-CAT-03`      | The plan covers this category, quoting its own clause reference                      |
| `ELIG-LIMIT-04`    | What the annual category limit leaves after year-to-date spend                       |
| `ELIG-FUNDS-05`    | What the account actually holds                                                      |
| `ELIG-COVER-06`    | The payable amount: the smallest of requested, remaining limit and available funds   |
| `ELIG-DOC-07`      | Attaches a receipt condition without changing the answer                             |

Outcomes are `ELIGIBLE`, `PARTIALLY_ELIGIBLE`, `INELIGIBLE` and `UNDETERMINED`. A confirmed absence
of enrollment is ineligible; an unreachable, slow, stale or contradictory source is undetermined.
See [ADR-0003](adr/0003-eligibility-outcomes-and-versioning.md).

Each evaluation writes a care request, an immutable decision and an audit event in one transaction.
Re-evaluating creates a new decision; nothing is ever updated. The decision carries a minimized
snapshot of its inputs, sufficient to replay the same outcome later.

## Data classification

`apps/api/src/modules/classification` holds one registry mapping every persisted field to a data
class: PII, PHI, FIN, SECRET, INTERNAL or PUBLIC. It is consumed by logger redaction, audit
metadata redaction, the role-specific view mappers and the AI minimizer.

A test reads `schema.prisma` and fails when a field has no classification, when a registry entry
no longer matches a field, or when a model is missing entirely. It is a test and CI gate, not a
compile-time guarantee. Classifications are not weakened because the data is synthetic.

Logging keeps its structured allowlist as the primary control. The registry contributes pino
redaction paths as a second layer, wired in at the composition root so the platform layer stays
independent of the domain. A field name that is sensitive on one model but is also a safe
operational log field, such as `outcome`, is excluded from the derived paths.

## Implementation notes

Two details differ from the original plan text because of the tools involved.

- Prisma 7 takes the connection URL from `prisma.config.ts` and from an explicit driver adapter,
  not from `schema.prisma`. The application therefore builds its client with `@prisma/adapter-pg`
  after `platform/config.ts` has validated transport requirements.
- Prisma 7 no longer ships a runtime DMMF with the generated client, so the classification drift
  guard parses `schema.prisma` itself. That is the source of truth for what gets persisted and it
  needs no generated artifact to be current.

## Milestones

| Milestone | Delivers                                                                          | State                                |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| M0        | Workspace, platform baseline, brand guard, CI skeleton, documentation             | Complete                             |
| M1        | Data model, classification registry, synthetic seed                               | Complete                             |
| M2        | Authentication, authorization, audit                                              | Complete                             |
| M3        | Benefits, integrations, deterministic eligibility (full product value without AI) | Complete                             |
| M4        | AI provider, sanitization boundary, tool calling, guidance flow                   | Complete                             |
| M5        | Web client                                                                        | Complete                             |
| M6        | Hardening, threat model, demo narrative                                           | Complete                             |
| M7        | Lightweight public demo deployment                                                | Configuration complete, not deployed |

M7 is configuration and documentation only. Nothing has been deployed, because no hosting account
was available, and no live environment exists.

Decisions are recorded in `docs/adr/`.
