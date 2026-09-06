# AI-assisted development

## How this repository was built

Claude Code was used as a development assistant: writing implementation and tests, running the
suites, debugging failures, and drafting documentation. The architecture was designed and reviewed
by the developer before implementation began, revised through several rounds of review, and frozen
before any code was written. Every commit was reviewed against that frozen plan.

The plan itself lives outside this repository. What it settled, and why, is recorded here in
[the architecture decision records](adr/).

## What that means in practice

- **Decisions are the developer's.** Where the assistant proposed something that conflicted with the
  frozen architecture, the architecture won or the conflict was reported rather than resolved
  quietly. Two changes came out of review this way: the outcome vocabulary lost `NEEDS_REVIEW`
  because no review workflow exists for it to describe, and the eligibility engine gained a third
  enrollment state so a confirmed absence could not be confused with an unanswered question.
- **Generated code is reviewed and tested.** Nothing here is trusted because it was generated. The
  test suites exist to make claims checkable rather than to raise a number.
- **Defects found during the work were fixed separately.** One authorization refusal was reaching a
  caller without being recorded. It was fixed in its own commit, named as a fix, with a regression
  test, rather than folded into the feature that revealed it.

## Claude Code is not part of the running system

The assistant does not appear at runtime. It does not call the API, hold credentials, or take part
in any decision the platform makes.

The AI provider that _is_ part of the running system is Gemini, and its role is bounded on purpose:
it extracts what a member is asking about, calls allowlisted tools, and puts a decision into words.
It never decides eligibility, and the code gives it no way to. See
[the AI architecture](ai-architecture.md).

## Why this is written down

An AI-native product built with AI assistance invites a fair question about what was actually
understood versus generated. The answer this repository offers is its structure: a frozen
architecture with reasons recorded, tests that assert the properties that matter rather than
restating the implementation, and limitations stated where they exist rather than where they are
comfortable.

The clearest example is the sanitizer. It removes identifiers from a member's question, and the
documentation says plainly that what survives is the member's healthcare intent, which is itself
sensitive, and that this proof of concept relies on synthetic data because of it. That limitation
could have been left unstated. Stating it is the point.
