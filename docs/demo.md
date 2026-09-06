# Running the demonstration

How to put this on the internet, and what to check once it is there.

**Current status: not deployed.** Everything below is configured and everything checkable without a
hosting account has been checked. No account was available during this work, so nothing has been
deployed and no live URL exists. What has and has not been verified is set out below, and the
distinction is not glossed over.

## What the hosting has to provide

Four things. Any provider supplying them would do; the configuration in `render.yaml` and
`apps/web/vercel.json` names one combination.

| Requirement                                                           | Why it is not optional                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| HTTPS on the public endpoints                                         | A bearer token and a member's question travel over this          |
| TLS to the managed database                                           | The process refuses to start without it in demo mode             |
| Provider-managed encryption at rest for that database and its backups | The data at rest is health-related, synthetic or not             |
| A platform secret store read at runtime                               | No secret is in the image, the repository, or any committed file |

Encryption does not replace authorization. Every read stays subject to role, ownership and tenancy
checks, and to the audit trail, however well encrypted the storage is.

## Deploying

1. **Create the services.** Point the platform at `render.yaml` for the API and the managed
   database, and at `apps/web` for the client.
2. **Set the values the platform cannot generate.** `PUBLIC_API_URL`, `PUBLIC_WEB_ORIGIN` and
   `CORS_ALLOWED_ORIGINS` on the API, all `https://`; `NEXT_PUBLIC_API_URL` on the client. The
   database URL and the signing secret are supplied by the platform. `GEMINI_API_KEY` is optional:
   without it the assistant declines and everything else works.
3. **Load the data.** Run the demo database workflow with reseed enabled. It applies migrations and
   loads the synthetic dataset. It refuses to run against a connection string that does not require
   TLS.
4. **Check it came up.** `GET /ready` returns ready with a migration count.

The API refuses to start if any of this is wrong: not HTTPS, not TLS to the database, a signing
secret that is short or copied from the example file, or a cross-origin allowlist that is empty or a
wildcard. That is the intended behaviour. A demonstration that quietly runs unencrypted would
undermine everything it is meant to show.

## Demonstration credentials

Every seeded account shares one password, taken from `SEED_USER_PASSWORD` when the data is loaded.
Only its Argon2id hash is written; no plaintext password exists in the database, the repository, or
the output of the seed.

| Role                   | Address                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Member                 | `sarah.thompson@example.test`                                                         |
| Member                 | `miguel.alvarez@example.test`, `priya.raman@example.test`, `jonas.weber@example.test` |
| Employer administrator | `admin.northstar@example.test`, `admin.harbor@example.test`                           |
| Support                | `support.desk@example.test`                                                           |

All fictional, all `example.test`. Rotate the password by rerunning the workflow with reseed
enabled. Share it out of band; do not put it on the sign-in page.

## Verification checklist

### Verified during development

Each of these was run against the local stack or the built container.

| Check                                   | How                                                | Result                                                                                                    |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Container builds and serves             | `docker build`, then run against a real database   | Serves `/health`, reports `/ready` with 3 migrations applied, refuses an unauthenticated request with 401 |
| Image carries no secret                 | Built from `.dockerignore`, which excludes `.env*` | No secret in the image; every value arrives at runtime                                                    |
| Demo configuration fails closed         | Unit tests over `loadConfig`                       | Refuses non-HTTPS origins, non-TLS database URLs, short or placeholder secrets, wildcard or empty CORS    |
| Migrations apply to an empty database   | `prisma migrate deploy` on a fresh database        | 2 migrations applied, then a third added later                                                            |
| Seed is deterministic                   | Ran twice                                          | Identical row counts both times                                                                           |
| Browser bundle carries no server secret | `grep` over the built output, and a CI step        | No server-only variable name present                                                                      |
| No branding in text                     | Brand guard over tracked files and commit messages | Clean                                                                                                     |
| No committed secret                     | Secret scanner over committed paths                | Clean                                                                                                     |

### To verify once deployed

These need the running environment and have **not** been done.

- [ ] The public API and client answer over HTTPS, and plain HTTP does not serve.
- [ ] The database connection string requires TLS, and the API started, which means it passed its
      own check.
- [ ] The provider's console shows encryption at rest enabled for the database and its backups.
      Record what it says, not what the plan intended.
- [ ] Secrets are set in the platform store and appear in no build log.
- [ ] `GET /ready` returns ready; `GET /health` returns ok.
- [ ] Signing in as each seeded role produces the right view.
- [ ] The walkthrough in the README behaves as written against the deployed instance.
- [ ] Rate limits refuse a burst of sign-in attempts.

### Visual brand-neutrality check

The brand guard reads text: source, documentation, configuration, tests, seed data and the commit
messages of a push. It cannot read pixels, and it is never treated as proof that images are clean.
Check these by eye before announcing anything.

- [ ] Every screenshot in the repository or anywhere it is presented.
- [ ] The favicon and any image asset.
- [ ] The rendered pages, including the browser tab title.
- [ ] The service and project names shown in the hosting platform's own interface.
- [ ] The deployed URL itself.
- [ ] Anything generated for a presentation: slides, recordings, diagrams.

Approved names are in [the architecture document](architecture.md). If something needs a name that
is not there, add it there first.

## Cost and lifetime

A demonstration that stays up costs money and holds a database nobody is watching. Suspend the
services when it is not being shown. The data is synthetic and reloadable, so nothing is lost by
tearing it down and rebuilding it later.
