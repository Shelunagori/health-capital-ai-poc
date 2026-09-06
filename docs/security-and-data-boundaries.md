# Security and data boundaries

> **Encrypt in transit and at rest, authorize every access, minimize what is stored and shared, do not log
> sensitive content, and send only the minimum necessary context to AI providers.**
>
> This is a security engineering principle used by this synthetic-data POC. It is not a claim of HIPAA compliance.

The platform handles synthetic data only. The controls below demonstrate engineering judgment for handling
PHI-like, PII and financial data scenarios; they do not establish regulatory compliance of any kind.

## Trust boundaries

```
Browser (untrusted) ── HTTPS, bearer JWT ──> API
API ── TLS ──> managed PostgreSQL (encrypted at rest in deployed environments)
API ── HTTPS via provider SDK ──> AI provider (only sanitized / allowlisted context)
API ── adapters ──> external systems (synthetic in this POC; TLS in a real deployment)
```

- The web client holds no secrets and makes no authorization decisions.
- IDs in URLs and bodies are claims. Handlers load the resource, then authorize against it.
- Model output is untrusted input: tool arguments are schema-validated, tools are allowlisted,
  the acting member is bound server-side, and every tool call is audited.
- External adapters are unreliable by contract; anything but a confirmed answer yields `UNDETERMINED`.

## Data protection baseline

| Control                     | Local development                       | Deployed demo                                                                 |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Browser to API transport    | HTTP on localhost permitted             | HTTPS only                                                                    |
| API to PostgreSQL           | Non-TLS local container permitted       | TLS required (`sslmode=require` or stricter); startup fails otherwise         |
| API to AI provider          | HTTPS via SDK                           | HTTPS via SDK                                                                 |
| Database encryption at rest | No claim (local Docker, synthetic data) | Provider-managed encryption at rest required; encrypted backups where enabled |
| Secrets                     | `.env` (gitignored)                     | Platform-managed secret storage                                               |

Encryption never replaces authorization. Every sensitive read or write remains subject to role, ownership
and tenancy checks and to audit.

Out of scope and distinct from the above: application-level per-field encryption, envelope encryption,
customer-managed KMS keys, custom key rotation, tokenization services.

## Authorization

Every handler follows the same order: prove identity, load the resource, authorize against what was
loaded, then map to the view for that role. An identifier in a path or body is a claim; the loaded
record is the fact. Employer scope resolves through enrollments, because a member record carries no
employer of its own.

| Action                                                     | Member   | Employer administrator        | Support                         |
| ---------------------------------------------------------- | -------- | ----------------------------- | ------------------------------- |
| Own profile, enrollment, balance, ledger, decisions        | own only | refused                       | refused                         |
| Evaluate eligibility, ask guidance                         | own only | refused                       | refused                         |
| A named member's profile, care requests, decisions, ledger | own only | **refused, with no override** | coded reason and case reference |
| A named member's non-clinical summary                      | own only | own tenancy only              | any                             |
| Employer plan, member roster                               | refused  | own employer only             | any                             |
| Audit events                                               | refused  | refused                       | allowed                         |

Refusals are uniform: the same status and message whether the resource is absent, belongs to
someone else, or sits under another employer, so a caller cannot map the data set by probing.

An employer administrator is never shown a member's treatment category, service date, amounts,
balances or decisions. There is no reason code that unlocks it. The employer view is an explicit
field list, so a column added to the database cannot widen it.

Support privileged reads need a reason code from a closed list and a case reference matching a
fixed format. Free-text justification is never accepted or stored.

## Data classification and integrity

Every persisted field carries a data class (PII, PHI, FIN, SECRET, INTERNAL, PUBLIC) in
`apps/api/src/modules/classification/registry.ts`. A test reads `schema.prisma` and fails the run
when a field is unclassified, so a new column cannot reach the database without a decision about
its sensitivity.

Notable classifications: credentials are SECRET; member name, date of birth, address, login email
and the employer-scoped employee identifier are PII; treatment category, service date, ledger
benefit category and every eligibility decision field that describes an outcome or its inputs are
PHI; amounts are FIN. Opaque external references are INTERNAL and never reach an AI provider.

Passwords are stored only as Argon2id hashes with explicit cost parameters. The seed reads a
synthetic development password from `SEED_USER_PASSWORD` and writes only the hash; no plaintext
password exists in the database, in source, or in the seed output.

Eligibility decisions and audit events are append-only, enforced by database triggers rather than
by application convention. Check constraints cover the invariants that are always true, including
one health capital account per enrollment and exactly one scope reference per user role.

## Storage philosophy

Store only what deterministic behaviour, auditability and the demonstration require.

Persisted: structured care request fields, deterministic eligibility decisions, the minimized decision
snapshot, structured audit metadata.

Never persisted: raw natural-language questions, AI responses as conversation history, rendered prompts,
hashes derived from member free text, profile data copied into other tables, provider names or other free-text
details no rule consumes, secrets. The schema carries no `providerName` column and a test asserts its
absence in both the schema and the live database.

Persisted PHI-like, PII and financial fields remain sensitive even though the data is synthetic.

## Logging

Logs contain operational metadata only: trace id, route pattern, method, status, duration, actor reference,
role, action, outcome, versions, latency, safe counts and enums.

Never logged: raw PHI or PII, member questions, request bodies, query strings, Authorization or Cookie
values, passwords, JWTs, API keys, database credentials, prompts, tool results, model payloads, or
persistence entities containing sensitive fields. A typed log-field allowlist is the primary control; pino
redaction is defense in depth. Tests capture the log stream and assert the never-list.

## Secrets and credentials

No API keys, JWT secrets, database passwords or provider credentials are committed. `.env*` files are
gitignored; `.env.example` holds names and placeholders only. Secrets come from environment variables
locally and from the hosting platform's secret store when deployed. Server-only secrets never reach the web
client. Passwords are stored only as Argon2id hashes, never reversibly encrypted, logged or returned.
CI runs a secret scanner on every push and pull request.

## Configuration fails closed

With `APP_ENV=demo`, startup is refused when public origins are not HTTPS, the database URL does not require
TLS, the JWT secret is short or a placeholder, provider or database credentials look like placeholders, or the
CORS allowlist is empty or wildcarded. `local` and `test` modes relax transport requirements for synthetic
local data only.

## Baseline HTTP controls (present from M0)

Server-generated trace id on every response, strict CORS allowlist, security headers, JSON body size limit,
`Cache-Control: no-store` on every response, error responses that never include internal messages or stack
traces, request logging limited to allowlisted fields.

## Brand neutrality verification

Automated (text): git-tracked source, docs, config, tests and seed files; textual UI metadata; commit
messages introduced by the current CI event. The forbidden-term list lives outside the repository.

Manual (per demo release): screenshots, favicon and image assets, rendered UI, deployment and display
names on the hosting platform, any other visual artifact. The text guard does not inspect image pixels and
is never treated as proof that image assets contain no branding.

## The AI boundary

Only branded, minimized types cross it. The provider receives no name, email, date of birth,
address, employee identifier, database identifier, opaque reference, ledger history or care history,
and no identifier for the member at all.

Raw member text passes through a sanitizer first, and only the first stage ever sees it. The
explanation stage is given the decision and nothing else, so there is no path from what a member
types to what they are told.

What survives sanitizing is the member's healthcare intent, which is itself sensitive. That
limitation is stated in full in [the AI architecture](ai-architecture.md), and it is why this proof
of concept relies on synthetic data.

## Threat model

[The threat model](threat-model.md) sets out what is defended, what each control actually does, and
what is deliberately not built: token revocation, multi-factor authentication, application-level
field encryption, hash-chained audit, write-once storage, retention workflows, alerting, and a human
review workflow, among others. Each is listed with what it would address, because leaving it out was
a decision rather than an oversight.
