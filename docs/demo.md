# Running the demonstration

How to put this on the internet, and what to check once it is there.

**Current status: deployed.**

| Piece      | Where                                                 |
| ---------- | ----------------------------------------------------- |
| Web client | <https://health-capital-ai-poc.vercel.app> (Vercel)   |
| API        | <https://health-capital-api.up.railway.app> (Railway) |
| Readiness  | <https://health-capital-api.up.railway.app/ready>     |
| Database   | Railway managed PostgreSQL                            |

Gemini is optional there, as everywhere else, and its key is on a free tier whose quota is currently
exhausted. So the deployed instance demonstrates the assistant-unavailable fallback rather than a
live model answer, and that distinction is kept in the checklist below rather than glossed over.

## What the hosting has to provide

Four things. Any provider supplying them would do. The deployment described here uses Railway for
the API and its database and Vercel for the client; `render.yaml` stays in the repository as a
second, unexercised combination that supplies the same four.

| Requirement                                                           | Why it is not optional                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| HTTPS on the public endpoints                                         | A bearer token and a member's question travel over this          |
| TLS to the managed database                                           | The process refuses to start without it in demo mode             |
| Provider-managed encryption at rest for that database and its backups | The data at rest is health-related, synthetic or not             |
| A platform secret store read at runtime                               | No secret is in the image, the repository, or any committed file |

Encryption does not replace authorization. Every read stays subject to role, ownership and tenancy
checks, and to the audit trail, however well encrypted the storage is.

## Deploying

1. **Create the services.** The API is built from `apps/api/Dockerfile` and deployed alongside a
   managed PostgreSQL database; the client is deployed from `apps/web`. `render.yaml` configures the
   same shape on another provider if one is preferred.
2. **Set the values the platform cannot generate.** `PUBLIC_API_URL`, `PUBLIC_WEB_ORIGIN` and
   `CORS_ALLOWED_ORIGINS` on the API, all `https://`; `NEXT_PUBLIC_API_URL` on the client. The
   database URL and the signing secret are supplied by the platform. `GEMINI_API_KEY` is optional:
   without it the assistant declines and everything else works.
3. **Load the data.** Apply migrations and load the synthetic dataset, either as a pre-deploy step
   on the platform or through the demo database workflow with reseed enabled. Either refuses to run
   against a connection string that does not require TLS.
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

All fictional, all `example.test`. The password itself is not in this repository and is not on the
sign-in page of the deployed client; share it out of band. Rotate it by rerunning the seed with a new
`SEED_USER_PASSWORD`.

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

### Verified against the deployed environment

Each of these was checked by hand on the running deployment.

- [x] The API starts in `APP_ENV=demo`, which means it passed its own HTTPS, TLS, secret and CORS
      checks before serving a single request.
- [x] Migrations are applied on the managed database.
- [x] `GET /ready` returns HTTP 200 with the ready response.
- [x] The synthetic seed loaded: 2 employers, 2 plans, 4 members, 5 benefit enrollments, 5 accounts,
      17 ledger entries, 7 users.
- [x] A member signs in and gets their own view.
- [x] Deterministic eligibility works end to end. Dental for 300.00 as the seeded member returns
      partially eligible, 150.00 covered, with the receipt condition attached.
- [x] The employer administrator view works and shows no treatment, amount or decision.
- [x] A support privileged lookup works, and the audit trail records it with its reason code and
      case reference.
- [x] The client on one origin reaches the API on another, so the cross-origin allowlist is right.
- [x] The assistant-unavailable path degrades gracefully: the member is told the assistant cannot
      help right now, and "Check an expense" still returns a full decision from the plan rules.

### Still to verify

These need something the deployment does not currently have.

- [ ] A successful live model answer from the deployed instance. **Not verified.** The provider key
      there is on a free tier whose quota is exhausted, so every request currently takes the
      fallback path. Live model behaviour was exercised during development against a real key; that
      is not the same as having seen it answer in production, and it is not claimed as such.
- [ ] The provider's console shows encryption at rest enabled for the database and its backups.
      Record what it says, not what the plan intended.
- [ ] Secrets are set in the platform store and appear in no build log.
- [ ] Plain HTTP does not serve on either public endpoint.
- [ ] Rate limits refuse a burst of sign-in attempts.
- [ ] The rest of the README walkthrough against the deployed instance. Several of its steps drive
      an integration outage or the database directly, so they are local exercises; what they show
      has not been re-checked in the deployed environment.

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
