# ADR-0003: Eligibility outcomes, the known-negative distinction, and versioning

Date: 2026-09-06
Status: Accepted

## Context

The platform answers one question: can a member use their health capital for an expense. The answer
has to be produced by deterministic code, has to survive being explained months later, and has to
behave sensibly when the systems it depends on cannot answer.

Three things needed deciding: what the possible answers are, how an unanswered question differs from
a negative answer, and what "version" means for a decision.

These are synthetic semantics chosen for this proof of concept. They are not any organisation's real
benefit rules.

## Decision

**Four outcomes.** `ELIGIBLE`, `PARTIALLY_ELIGIBLE`, `INELIGIBLE`, `UNDETERMINED`.

**Insufficient funds or a partly used limit gives partial eligibility, not a refusal.** What is
payable is the smallest of the amount asked, what the annual category limit leaves, and what the
account holds. If that is the whole amount the answer is yes; if it is some of it the answer is yes
for that much; if it is nothing the answer is no. A member asking about a 300 expense against a 150
allowance is better served by "150 of this is covered" than by "no".

**A receipt requirement is a condition on a yes, not a separate outcome.** An earlier draft used
`NEEDS_REVIEW` for this. It was dropped: there is no human review workflow in this proof of concept,
so an outcome implying one would describe a process that does not exist. The decision stands on its
own and carries `RECEIPT_REQUIRED` alongside it.

**A confirmed absence is a decision; an unanswered question is not.** If the employer system is
asked and reports no enrollment covering the date of service, that is an answer and the outcome is
`INELIGIBLE`. If the same system is unreachable, slow, stale, or reports something that contradicts
what we hold, the outcome is `UNDETERMINED` and nothing is inferred. Adapters make this expressible
by returning `NOT_FOUND` as a successful negative answer, distinct from `UNAVAILABLE` and `TIMEOUT`.
More than one enrollment applying to one date is also `UNDETERMINED`: two answers is not an answer.

**Two systems disagreeing about money is undetermined.** When the card system's available balance
and our ledger differ by more than a fixed tolerance, we hold two numbers and no basis for choosing,
so no decision is made. This is worse than one silent system, not better.

**Versions are split.** `engineVersion` versions the rule _code_. `planConfigVersion` versions the
_parameters_ a plan supplies. Adapter answers carry their own as-of timestamps. A decision records
all of them, so it can be explained after any of them has moved on. `planConfigVersion` is nullable
on a decision, because an undetermined outcome may never have reached the plan, and recording a
version we never read would be a fiction.

**Decisions are immutable and never updated.** Re-evaluating creates a new care request and a new
decision. A database trigger enforces this, so it does not depend on application discipline.

**The decision snapshot is minimized but not innocuous.** It holds the deterministic inputs needed to
replay the decision, and no name, date of birth, address, employee identifier or email. It is still
health and financial data about one person: a category, an amount, a date. It is classified and
protected as such rather than treated as safe because it is small.

**No AI provider is reachable from this path.** The eligibility module has no dependency that could
call one. A provider can explain a decision afterwards; it cannot make one.

## Consequences

- A member sometimes gets "we could not check this right now" instead of an answer. That is the
  intended behaviour: the alternative is a confident answer built on a number nobody verified.
- Callers must handle four outcomes and a nullable covered amount. The interface says so.
- The engine is a pure function, so every rule and every boundary is unit-testable without a
  database, and a stored decision can be replayed from its own snapshot.
- Adding a rule means bumping `engineVersion`, which makes older decisions legible rather than
  silently reinterpreted.
