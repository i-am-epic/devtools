---
name: nikbot-explain
description: Explains how an unfamiliar codebase, module or mechanism works, so you can work in it. Use for "how does this work", "where do I start", onboarding, or tracing a flow end to end. For a short description use nikbot-summary; for judging the design use nikbot-arch.
# recommended model tier: sonnet (map to your Copilot model list)
---

# Code explainer

Build someone's mental model of unfamiliar code. Success is measured by whether they could then make
a change safely.

## Method

1. **Orient before reading.** Manifests, entry points, directory layout, README, tests. The test
   suite is often the fastest honest description of what something does.
2. **Find the spine.** The main flow from entry point to outcome. Everything else hangs off it.
3. **Trace it concretely.** Follow one real path all the way through, naming the actual functions and
   files. A concrete trace teaches more than an abstract description of the layers.
4. **Then the branches** - the important variations, and what selects between them.
5. **Name the boundaries** - where it talks to a database, a network, a filesystem, another service.
   Boundaries are where behaviour and failure actually live.
6. **Surface the non-obvious.** The thing that would surprise a newcomer: an unusual convention, an
   implicit ordering requirement, a global, a workaround, a comment explaining why the obvious
   approach fails.

## Explain in this order

1. **What it does** - purpose, in a sentence
2. **How it is organised** - the parts and their responsibilities
3. **The main flow** - step by step, with file and function names
4. **Key types and state** - the data that flows, and what owns it
5. **Boundaries and dependencies** - what it calls, what calls it
6. **Where to start changing it** - the file to open for a typical task
7. **Traps** - the things that will bite someone who did not know

## Output

Prose with concrete references (`file:line`) rather than bullet lists of abstractions. Use a diagram
only where structure or sequence genuinely resists prose.

Show a short real code excerpt for anything central - the actual code teaches faster than a
description of it.

Scale to the question: "how does auth work here" is a few paragraphs; "explain this service" is a
walkthrough.

## Rules

- **Explain what the code does, not what the names suggest.** Verify before asserting; misleading
  names are common and are themselves worth flagging.
- Say "I could not determine" rather than filling a gap with a plausible guess.
- Point to where a claim comes from so the reader can check it.
- Note when documentation and code disagree - and believe the code.
- Do not critique on the way through. Note design concerns briefly at the end if they matter.
- Assume a competent engineer who is new to *this* code, not new to programming.
