# ADR-0005: Hosting the demonstration

Date: 2026-09-06
Status: Accepted, not yet exercised

## Context

The proof of concept is more convincing when someone can click on it than when they have to run it.
That is the only reason to deploy it: there is no user, no traffic and no availability requirement.

The deployment must not undermine what the rest of the work is about. A demonstration of careful
data handling that runs over plain HTTP against an unencrypted database would say more about the
work than the code does.

## Decision

**Four requirements, stated rather than a provider chosen.** HTTPS on the public endpoints, TLS to
the managed database, provider-managed encryption at rest for that database and its backups, and a
platform secret store the container reads at runtime. `render.yaml` and `apps/web/vercel.json`
configure one combination that supplies all four. Another would do.

**The process enforces them itself.** With `APP_ENV=demo` it refuses to start against a non-HTTPS
public origin, a database URL that does not require TLS, a signing secret that is short or copied
from the example file, or a cross-origin allowlist that is empty or a wildcard. This is not a
deployment checklist someone might skip; it is a startup condition, and it is unit-tested.

**No infrastructure code.** No Terraform, no Kubernetes, no customer-managed keys. Two
configuration files and a container. Writing infrastructure to demonstrate that infrastructure can
be written would be ceremony, and it would be the largest thing in the repository.

**Encryption at rest is provider-managed only.** Application-level field encryption, envelope
encryption, customer-managed keys and tokenization are separate controls, deliberately not built,
and are not conflated with what the provider supplies.

**Database work is manual and approved.** A workflow behind an environment approval applies
migrations and optionally reloads the data. It refuses a connection string that does not require
TLS before touching anything. The hosting platforms deploy on push themselves; this is only the
database work, which is not something to run automatically against a live environment.

**Nothing about the deployment is claimed until it is checked.** `docs/demo.md` separates what was
verified during development from what needs the running environment, and the second list is
unticked.

## Consequences

- The demonstration costs money while it is up, and holds a database nobody is watching. Suspend it
  when it is not being shown; the data is synthetic and reloadable.
- Moving provider means rewriting two configuration files. That is the trade for having no
  infrastructure code, and it is the right way round at this size.
- A misconfigured deployment fails loudly at startup rather than serving. For a demonstration that
  is correct: a broken demonstration is better than a misleading one.
- **The configuration has not been exercised against a real account.** The container was built and
  run against a real database, and every check that does not need hosting was performed. Whether the
  provider behaves as configured is unverified until someone deploys it.
