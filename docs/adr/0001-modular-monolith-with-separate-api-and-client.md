# ADR-0001: Modular monolith with a separate Fastify API and Next.js client

Date: 2026-09-06
Status: Accepted

## Context

The POC must make trust boundaries and module boundaries legible to a reviewer while staying small enough
for one developer to ship in a few milestones. Options considered: a single Next.js app with API routes;
a set of microservices; a modular monolith API plus a thin client.

## Decision

- One Fastify process (`apps/api`) holds all business logic as internal modules with a single public
  `index.ts` each, enforced by an ESLint import rule. Dependency direction is fixed:
  `platform <- classification <- audit <- auth/authorization`, and
  `members, benefits, integrations <- eligibility <- ai <- guidance`.
- One Next.js application (`apps/web`) is a strict client of the API. It holds no secrets and makes no
  authorization decisions.
- Shared request/response contracts live in `packages/contracts` as Zod schemas.
- PostgreSQL is the only infrastructure dependency. No message queues, gateways, service mesh or
  orchestration platform.

## Consequences

- The client/server boundary is a real network boundary, so the "web app is untrusted" rule is enforced by
  structure rather than convention.
- Modules can later be extracted if ever needed, but nothing in the POC requires it.
- Two processes in development (`api :3001`, `web :3000`) and a CORS allowlist instead of same-origin
  simplicity. Accepted for the clarity gained.
- Next.js API routes would have been smaller but would blur where authorization and data access happen.
