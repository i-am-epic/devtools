# Contributing

Thanks for helping out. This is a small, dependency-free project, and it is worth
keeping it that way.

For the mechanics of adding a tool — spec shape, option types, CSS classes, the
`run` contract — see **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)**. This document
covers the standards those tools are held to.

## Getting set up

```bash
git clone https://github.com/i-am-epic/devtools.git
cd devtools
python server.py 8000
```

That is the whole setup. There is no build, no package manager, no transpiler.

## The one rule that matters

**If a tool is listed, it must work.**

Version 3 of this project rewrote it because the previous version listed 133 tools
of which 10 existed, the Parquet viewer returned hardcoded fake rows, and the
Service Bus tools printed "Message simulated successfully!" without contacting
Azure. A tool that pretends is worse than a tool that is absent: it wastes the
time of someone who trusted it.

Concretely:

- No "coming soon" entries. The tool list is generated from implementations, so
  there is nowhere to put one anyway.
- No mock or sample data standing in for a real result.
- If something genuinely cannot be done in a browser, say so in the interface and
  explain why. The Service Bus tools do this when the relay is not running; they
  do not quietly pretend to send.

## Standards for a new tool

**Be honest about limits.** `html-validator` is called "HTML Checker" and its
footnote says it is not a W3C conformance validator, because it isn't. If your
tool approximates something, name it accurately.

**Handle bad input properly.** Throw an `Error` with a message that says what is
wrong and ideally what to do: `'Hex needs an even number of digits (got 7)'`
beats `'Invalid input'`.

**Explain the security-relevant footguns.** If a tool touches crypto, escaping or
credentials, use `footnote` to say the thing a careful colleague would say — that
SQL escaping is not a substitute for parameterised queries, that MD5 is broken for
signatures, that decoding a JWT does not authenticate it. Users reach for these
tools precisely when they are unsure.

**Keep secrets local.** Nothing should transmit user input anywhere. The two
exceptions are documented in the README and both are explicit and opt-in.

**Use the design tokens.** `var(--ink)`, `var(--surface)`, `var(--line)`,
`var(--accent)` — never literal colours, or the tool will break in one of the two
themes.

**Give it a `sample`.** The smoke test runs every tool against its own sample
input, so a sample is what makes your tool testable. It also makes the tool
self-explanatory.

## Before you open a PR

Run the tests. With the server running, open:

- `/scripts/smoke-test.html` — must be `0 failed`
- `/scripts/tools-test.html`
- `/scripts/verify-hashes.html` — if you touched `js/lib/hashes.js`
- `/scripts/parquet-test.html` — if you touched the Parquet viewer
  (needs `python scripts/make_parquet_fixtures.py` first)

and from a terminal, if you touched the relay:

```bash
python scripts/test_servicebus.py
```

Then check by hand:

- the tool works in **both** light and dark themes
- the layout survives a narrow window (no horizontal scrolling)
- the page has no console errors
- your tool is findable — search for a word a user would actually type

## Adding a dependency

Prefer not to. Most things here are implemented directly: the hashes, the diff,
the CSV parser, the cron parser, the colour maths, the base32/58 codecs.

If a library is genuinely warranted (Parquet decoding, bcrypt, QR), add it to
`js/lib/loader.js` pinned to an exact version, and load it lazily inside `run()`
so people who never open your tool never download it. Do not add `<script>` tags
to `index.html`.

## Code style

Match the surrounding code. In short: 4-space indent, single quotes, semicolons,
ES modules, `const` by default. Comments should explain *why* — the what is
usually already legible.

## Reporting a bug

Include what you did, what you expected, what happened, and the browser. If a
tool produced a wrong result, the input that produced it is the most useful thing
you can send.

## Licence

This project carries no licence — all rights reserved by Nikhil
([@i-am-epic](https://github.com/i-am-epic)). By opening a pull request you are
offering the change for inclusion on the same terms.
