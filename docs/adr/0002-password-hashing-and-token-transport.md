# ADR-0002: Argon2id password hashing and bearer-token session transport

Date: 2026-09-06
Status: Accepted

## Context

The platform needs authenticated sessions for three roles across two origins in development: the
API on one port and the web client on another. Accounts are seeded; there is no registration,
password reset or multi-factor flow in this proof of concept.

Two decisions were needed: how passwords are stored, and how a session is carried.

## Decision

**Passwords are Argon2id hashes.** Cost parameters are stated explicitly in code rather than taken
from library defaults, so a change shows up in review: 19 MiB of memory, two iterations, one lane,
a 32-byte tag. Passwords are never reversibly encrypted, never logged and never returned by any
response. A failed lookup still performs a verification against a fixed dummy hash, so response
time does not disclose whether an address has an account. Every authentication failure returns the
same status and message, whatever the underlying cause.

**Sessions are stateless bearer tokens.** HS256 over a secret of at least 32 bytes, a fifteen-minute
expiry, an issuer and audience that are both checked, and no refresh token or session table.
Claims carry only the user identifier, the role and the single scope reference that role uses. No
name, address or contact data goes into a token, because a token is readable by whoever holds it.

**The client holds the token in memory.** Not local storage, not a cookie.

**Authentication is default-deny.** A single request hook requires a valid token for every route
unless the route explicitly declares itself public. A route added without thinking about
authentication is therefore protected, rather than exposed until someone remembers a guard.
Unmatched paths still answer with the not-found shape, so the failure a client sees matches what
actually happened.

**Login is rate limited** per client address and submitted address together, so repeated attempts
against one account are throttled independently of general traffic. A wider ceiling applies to
every route.

## Consequences

- No server-side revocation. A stolen token stays valid until it expires, which is why the expiry
  is short and there is no refresh token. Revocation would need a session store, which this proof
  of concept does not build.
- A bearer token in memory is exposed to cross-site scripting in a way an HttpOnly cookie is not.
  The mitigations here are that the client loads no third-party scripts, ships a restrictive
  content security policy, and never persists the token. **For production the recommendation is an
  HttpOnly, Secure, SameSite cookie behind a same-origin proxy**, which removes this exposure at
  the cost of cross-site request forgery handling.
- Choosing a cookie now would have meant credentialed cross-origin requests and forgery protection
  for a two-origin development setup, which is machinery this proof of concept does not need to
  demonstrate its point.
- Argon2id verification is deliberately expensive, which bounds how fast an attacker can test
  passwords but also means login is measurably slower than a token check. That is the intended
  trade-off.
- The API now refuses to start without a database URL and a signing secret. Failing at startup is
  preferable to a server that answers health checks and then fails every login.
