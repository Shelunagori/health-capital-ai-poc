# Threat model

What this platform is trying to prevent, what it actually does about it, and what it deliberately
does not do. Synthetic data throughout, and no compliance claim of any kind.

> Encrypt in transit and at rest, authorize every access, minimize what is stored and shared, do not
> log sensitive content, and send only the minimum necessary context to AI providers.
>
> This is a security engineering principle used by this synthetic-data proof of concept. It is not a
> claim of HIPAA compliance.

## What is worth protecting

| Asset                            | Why it matters                                                              |
| -------------------------------- | --------------------------------------------------------------------------- |
| A member's health data           | Treatment category, service date and decisions say what care someone sought |
| A member's identity data         | Name, date of birth, address, employee identifier                           |
| A member's money                 | Balance, contributions, spend, covered amounts                              |
| The decision itself              | An eligibility outcome is a statement about a person's care                 |
| Credentials and signing material | Password hashes, the token secret, the provider key, database credentials   |
| The audit trail                  | The record of who did what; worthless if it can be edited                   |

## Who might attack it

- **A curious or malicious member.** Signed in legitimately, reaching for someone else's data.
- **An employer administrator.** Legitimately signed in, with a plausible reason to want a member's
  health data. This is the adversary the design is most shaped by.
- **Someone with a stolen token.** No password, but a valid bearer token for a short window.
- **The member's own text.** A question crafted to make the model do something it should not.
- **The model itself.** Not malicious, but capable of inventing a tool call, an outcome or a figure.
- **A dependency or a log sink.** Somewhere data ends up that nobody thought of as a destination.

## What is done about it

### A member reaching for another member

Handlers load the resource, then authorize against what was loaded. An identifier in a path or body
is a claim; the loaded record is the fact. Refusals are uniform, so absent, belonging to someone
else, and under another employer all look the same and the data set cannot be mapped by probing.
Every refusal is recorded.

_Not done:_ rate limiting per resource, or alerting on a pattern of refusals. The trail records
enough to notice; nothing watches it.

### An employer administrator reaching for health data

This is the case the design is built around. It is refused three ways: the role has no guidance
endpoint, the employer view is an explicit field list with no health or financial field in it, and a
direct read of a named member's profile, care requests, decisions or ledger is refused on role, with
no reason code that unlocks it. All three are tested, and the refusal is recorded.

### A stolen token

Tokens are short-lived, carry only a user, a role and one scope reference, and are held in memory by
the client rather than in storage or a cookie. The client loads no third-party scripts and ships a
restrictive content security policy.

_Not done:_ revocation. A stolen token is valid until it expires, which is why the window is
fifteen minutes and there is no refresh token. Revocation needs a session store this proof of
concept does not build. **For production, an HttpOnly cookie behind a same-origin proxy is the
recommendation**, which removes the scripting exposure at the cost of forgery protection.

### A question crafted to change the answer

Structurally uninteresting rather than defended against by filtering. The model never decides: the
decision is made by deterministic rules before the model is asked to explain anything, and the
explanation stage is given the decision and no member text at all. There is no path from what a
member types to the explanation.

If the model returns an outcome that differs from the decision, wording that contradicts it, or a
figure that was not in the context, the wording is discarded for the platform's own and the guard
trip is recorded. The decision is untouched throughout.

### A model that invents a tool call

Tools are allowlisted and bound to the caller on the server. No tool takes a member, enrollment or
account identifier, so a model cannot choose whose data to touch. Argument schemas are strict, so an
attempt to add an identifier is a parse failure rather than something to strip and carry on with.
Every invocation is recorded, allowed or refused alike.

### Data ending up somewhere nobody intended

Logs carry operational metadata only: a typed field shape is the primary control, with
classification-derived redaction behind it. A test captures the log stream and asserts the
never-list.

Member questions are used and dropped. Not stored, not hashed, not logged. An audit event records
that a call happened, which prompt template produced it, and how many values the sanitizer removed.

A privacy suite reads the live schema and searches every text-like column of every table for a
sentinel phrase, which catches a value reaching a table nobody thought about, including one added
later.

### Data reaching an AI provider

Only branded, minimized types cross the boundary, and the schemas are strict. The provider receives
no name, email, date of birth, address, employee identifier, database identifier, opaque reference,
ledger history or care history, and no identifier for the member at all.

_The honest limitation:_ what survives sanitizing is the member's healthcare intent, and that is
itself sensitive. Someone asking about a treatment is telling you something about their health.
This proof of concept works on synthetic data. A real deployment would need a classifier built for
the job, a data-processing agreement with the provider, and the member's informed consent.

### Tampering with the record

Eligibility decisions and audit events are append-only, enforced by database triggers rather than by
application discipline. The application has no update or delete path for either, and the database
refuses one regardless.

_Not done:_ hash chaining, write-once storage, or export to a separate system. All three are the
answer to an operator with database credentials, which this proof of concept does not defend
against.

### An unsafe deployment

With `APP_ENV=demo` the process refuses to start when public origins are not HTTPS, the database URL
does not require TLS, the signing secret is short or a placeholder, provider or database credentials
look like placeholders, or the cross-origin allowlist is empty or wildcarded. Failing at startup
beats answering health checks and then failing every request.

## Deliberately not built

Each of these is a real control that a production system would want. Each is listed because leaving
it out was a decision, not an oversight.

| Not built                                                                      | What it would address                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Token revocation, refresh tokens, a session store                              | A stolen token before it expires               |
| Multi-factor authentication, single sign-on, password reset                    | Credential theft, account recovery             |
| Application-level field encryption, envelope encryption, customer-managed keys | An attacker with database access               |
| Hash-chained audit, write-once storage, export to a separate system            | An operator with database credentials          |
| Data retention and deletion workflows                                          | Holding data longer than it is needed          |
| Alerting, anomaly detection, security monitoring                               | Noticing an attack while it happens            |
| Distributed tracing and metrics                                                | Diagnosing behaviour across systems            |
| A human review workflow                                                        | Decisions a rules engine should not make alone |
| Payments, card issuing, claims adjudication, receipt capture                   | Actually spending the money                    |
| A DLP-grade classifier for free text                                           | Health information a member volunteers         |

Trace identifiers already flow through requests, logs and audit events, so distributed tracing is an
addition rather than a rebuild.

## What this is not

Not a compliance artefact. Not a claim about HIPAA or any other regime. Not a product. The controls
here demonstrate engineering judgment about handling regulated-looking data; establishing compliance
is a different exercise involving agreements, assessments and evidence this repository does not
contain.
