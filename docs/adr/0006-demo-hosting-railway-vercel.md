# ADR-0006: The exercised demonstration hosting

Date: 2026-09-07
Status: Accepted and exercised. Supersedes [ADR-0005](0005-demo-hosting.md).

## Context

[ADR-0005](0005-demo-hosting.md) stated four requirements for hosting the demonstration and
configured one combination that met them, in `render.yaml` and `apps/web/vercel.json`. It was
written before any account existed, and it said so: accepted, not yet exercised.

The demonstration has since been deployed, and not on that combination. The client went to Vercel as
planned; the API and its database went to Railway. The reason was practical rather than
architectural — Railway builds the existing container and provisions the database next to it — and
the four requirements were the thing being preserved, so meeting them elsewhere is what ADR-0005
said would be acceptable.

That leaves the earlier record describing a deployment that never happened, which is why this is a
new decision rather than an edit to that one.

## Decision

**Vercel hosts the Next.js client.** As originally configured, from `apps/web`.

**Railway hosts the Fastify API.** Built from `apps/api/Dockerfile`, the same image that was built
and run locally, running unprivileged and carrying no secret.

**Railway hosts the PostgreSQL database.** Managed, adjacent to the API, reached over TLS.

**Gemini remains optional and external.** Nothing about the deployment changes the AI boundary. When
no provider is configured, or the configured one does not answer, the assistant says so and the
deterministic path still produces a full decision.

**The security invariants are unchanged**, and are the reason this is a substitution rather than a
new position: HTTPS on both public endpoints, a database connection that requires TLS, secrets held
in the platform's environment or secret store and never in the image or the repository, synthetic
data only, and eligibility decided by versioned rules that do not depend on an AI provider. The
process still refuses to start in `APP_ENV=demo` if any of the first three is wrong.

## Consequences

- Railway's operational setup replaces Render's for the live demonstration: its build of the
  container, its environment variables, its pre-deploy step for migrations, and its database.
- `render.yaml` stays in the repository as an unexercised alternative and as the record of what
  ADR-0005 configured. It is not what runs. Removing it is a later decision, not this one.
- The four requirements in ADR-0005 remain the standard any host has to meet. This decision changes
  which host meets them, not what is required.
- A live model answer from the deployed instance is still unverified: the provider key there is on a
  free tier whose quota is exhausted, so production currently exercises the fallback path.
  `docs/demo.md` keeps that separate from what has been checked.
