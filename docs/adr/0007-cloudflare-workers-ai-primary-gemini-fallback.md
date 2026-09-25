# ADR-0007: Cloudflare Workers AI as the primary provider, Gemini as the fallback

Date: 2026-09-25
Status: Proposed

## Context

Gemini has been the only runtime AI provider. The deployed demonstration relies on a free-tier key
whose quota is exhausted, so what production currently shows is the assistant-unavailable fallback
(see ADR-0006). A second provider lets the assistant answer when one of the two cannot, without
changing anything about how decisions are made.

The rules this must not disturb: the model never decides eligibility, only branded minimized types
cross the AI boundary, the platform works with no provider configured, provider failures carry no
payload, and every AI call is audited by provider and model name.

## Decision

**Cloudflare Workers AI is preferred and Gemini is the fallback, whichever are configured.** With
both, a `FallbackProvider` tries Cloudflare first and moves to Gemini when Cloudflare reports
`AiUnavailableError` (not configured, timeout, call failed, bad response). With one, that provider is
used directly, exactly as before. With neither, the `NullProvider` declines every call.

**The boundary is identical for both providers.** Each receives the same branded `ToolTurnRequest` or
`StructuredRequest`: the sanitized `AiUserQuery` and `AiSafe*` tool results for Stage A, the
`AiSafeExplanationContext` for Stage B. Falling back sends the second provider no more than the first
would have seen. Adding a provider adds a processor of that minimized context; it does not widen it.

**Only outages fall back.** An error that is not `AiUnavailableError` is a defect and is rethrown, so
a bug is never hidden behind a second model. A verdict-guard rejection is not an outage either: the
decision stands and the wording is replaced by the template, as before.

**A failing provider rests for 30 seconds.** Without that, a primary that is down would cost its full
ten-second timeout on every tool round of every request before the fallback got a turn. The only
state kept is a timestamp per provider position; no request data.

**The audit trail names the provider that answered.** Results carry an optional `servedBy`
(`provider`, `model`), which the guidance service records as `aiProvider` / `aiModel` instead of the
composite's name. No new stored field: the existing columns hold the more accurate value.

**Cloudflare is called with plain `fetch`** on the OpenAI-compatible chat completions endpoint
(`/client/v4/accounts/{account}/ai/v1/chat/completions`): one bounded POST, no SDK. The token is a
bearer header, never logged; the account id is validated as 32 hex characters before it is placed
in the URL; an error response body is released unread; every failure becomes `AiUnavailableError`.
The default model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, which supports function calling and
JSON mode; `CLOUDFLARE_AI_MODEL` overrides it.

**Configuration.** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are optional and must be set
together; half a configuration is refused at startup. The token is treated as a secret exactly like
`GEMINI_API_KEY`: scrubbed from configuration errors, rejected as a placeholder in demo mode, never
sent to `apps/web` (checked in CI against the built client bundle).

## Consequences

- The worst-case latency of an AI call doubles when the primary times out and the fallback answers;
  the cooldown bounds that to the first request of an outage.
- Stage A and Stage B of one request may be answered by different providers. Each is attributed
  separately in the audit trail. Both stages are stateless per call, so this is safe.
- Model behaviour differs between providers. The verdict guard, strict tool argument schemas and the
  deterministic decision are what hold regardless of which model answers; nothing relies on one
  model's particular wording.
- Failed attempts are not audited individually, as before: an `AI_CALL` event records the call that
  succeeded.
- A successful live Cloudflare response in any deployed environment is not verified by this change
  and must not be claimed until it is.
