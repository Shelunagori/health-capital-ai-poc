# AI architecture

> The LLM never determines eligibility.
> `authoritative data + deterministic rules -> eligibility decision -> AI explanation`

A model helps a member express what they want to ask, and helps put a decision into plain words. It
does not decide anything, and the code gives it no way to.

## The boundary

Nothing reaches a provider except through a branded, minimized type. They are branded rather than
plain objects on purpose: a database row, a member profile or a request body will not type-check
where one is expected, so widening the boundary is a deliberate edit rather than a careless
argument. Every schema is strict, so an unexpected field is rejected instead of forwarded.

```
raw member text -> normalize -> redact identifiers -> AiUserQuery -> provider   (first stage)
deterministic decision -> AiSafeExplanationContext allowlist -> provider        (second stage)
```

## What a provider never receives

Name, email address, date of birth, address, employee identifier, database identifiers of any kind,
opaque external references, ledger history, care history, or whole records.

A field is not included because the backend happens to have it. It is included because a model
cannot do its job without it. Adding one means editing the minimizer and its schema, which is a
change reviewed on its own.

Notably absent is any identifier for the member. A model writing one sentence about one decision has
no use for knowing whose decision it is, and tools are bound to the caller on the server, so the
model never needs to name anyone.

## The first stage, and its limitation

`sanitizeUserQuery` is the only door raw member text goes through. It normalizes the text, strips
control and formatting characters used to hide instructions, removes email addresses, telephone
numbers, reference-shaped tokens, long digit runs and dates, and removes the caller's own stored
values by exact match. Monetary amounts are protected first, because the amount is exactly what the
model needs. Only counts of what was removed are recorded, never the values.

**What survives is the member's healthcare intent, and that is itself sensitive.** Someone asking
about a treatment is telling you something about their health. Sanitizing removes identifiers a
model has no use for; it does not make the remainder harmless. This proof of concept works on
synthetic data. A real deployment would need a classifier built for the job, a data-processing
agreement with the provider, and the member's informed consent.

The redaction is deliberately blunt. Over-removing costs a little answer quality; under-removing
costs someone their privacy.

## The second stage

It receives the decision and nothing else. The member's words never reach it, so nothing a member
writes can influence the explanation. It returns the outcome alongside its wording, which makes a
disagreement between the two mechanically visible rather than a matter of reading the prose.

## Providers

| Provider | Used when                                                                           |
| -------- | ----------------------------------------------------------------------------------- |
| Gemini   | A key is configured. Key stays server-side; requests and responses are never logged |
| Fake     | Tests. Records what it was sent, and can be told to fail or misbehave on purpose    |
| Null     | No key configured. Declines every call                                              |

Every provider failure becomes one error type carrying only the provider name and the kind of
failure, so an upstream message cannot smuggle a payload into a log. Every call is bounded by a
timeout, so a slow model degrades the answer rather than the request.

The platform works with no key configured. The structured eligibility endpoint, the decisions and
the audit trail are unaffected, because nothing in that path can call a model.

## Prompts and audit

Prompt templates are versioned. An audit event records which template and version produced a call.
It does not record the rendered prompt, and no hash of one is stored either: a first-stage prompt
contains the member's own words, so a hash of it is derived from their free text and is not ours to
keep. Neither the question nor any hash of it is persisted anywhere.
