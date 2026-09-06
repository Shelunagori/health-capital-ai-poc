# Health Capital AI POC

Independent synthetic-data proof of concept for an AI-native healthcare benefits platform. It answers one
member question, **"Can I use my health capital to pay for this healthcare expense?"**, and demonstrates:

- deterministic, versioned eligibility rules (the LLM never decides eligibility)
- regulated-data classification and minimization boundaries
- role-based access with ownership and tenancy checks
- append-only auditability
- unreliable-by-contract external integrations
- safe, allowlisted tool calling with a sanitized model boundary
- AI pipeline tests and CI / build validation

It is not based on or connected to any private company systems, data, APIs, or proprietary architecture.
Synthetic data only. All business rules are synthetic POC semantics. **No HIPAA compliance is claimed.**

## Principles

1. `authoritative data + deterministic rules -> eligibility decision -> AI explanation`
2. Brand neutrality: company-neutral engineering demonstration with no company-specific names, branding,
   proprietary identifiers, private APIs, or private data.
3. Encrypt in transit and at rest, authorize every access, minimize what is stored and shared, do not log
   sensitive content, and send only the minimum necessary context to AI providers.
   (A security engineering principle of this synthetic-data POC, not a compliance claim.)

## Status

Milestones 0 and 1 are in place.

**Foundation.** pnpm workspace, TypeScript strict, ESLint with a module-boundary rule, Vitest, and a
Fastify platform baseline: fail-closed configuration, safe structured logging, trace ids, security
headers, CORS allowlist, body limits, `no-store`, a non-leaking error handler and `/health`. Plus a
brand-neutrality guard, secret scanning and CI.

**Data model.** PostgreSQL through Prisma: portable member identity with enrollment-scoped employer
and plan relationships, category-aware ledger, immutable eligibility decisions and an append-only
audit trail enforced by database triggers. A field-level data-classification registry covers every
persisted column, guarded by a test that reads the schema. A deterministic synthetic seed provides
two employers, two plans, four members, an enrollment history and category spend.

Authentication, authorization, eligibility rules and the AI layer arrive in later milestones; see
[docs/architecture.md](docs/architecture.md).

## Getting started

```bash
corepack enable                 # provides pnpm at the version pinned in package.json
pnpm install                    # also generates the Prisma client
cp .env.example .env            # placeholders only; APP_ENV=local boots without secrets
docker compose up -d            # local PostgreSQL
pnpm db:migrate                 # apply migrations
SEED_USER_PASSWORD='choose-a-local-synthetic-password' pnpm db:seed
pnpm dev                        # API on http://localhost:3001  ->  GET /health
```

The seed stores only an Argon2id hash of `SEED_USER_PASSWORD`. No plaintext password is written to
the database, to source, or to the seed output. Seeded sign-in identities are listed when the seed
runs, all under `example.test`.

Quality gates:

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration           # needs a migrated and seeded PostgreSQL
pnpm brand-guard                # reads BRAND_GUARD_TERMS or a gitignored .brand-guard-terms file
```

## Documentation

- [Architecture](docs/architecture.md)
- [Security and data boundaries](docs/security-and-data-boundaries.md)
- [Architecture decision records](docs/adr/)
