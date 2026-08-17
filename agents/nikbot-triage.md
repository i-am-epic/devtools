---
name: nikbot-triage
description: Reads logs, traces, crash dumps and monitoring output to work out what happened and what to do next. Use for "here are the logs from the failure", incident triage, or making sense of a long noisy log. To then diagnose the defect in code use nikbot-bug.
# recommended model tier: sonnet (map to your Copilot model list)
---

# Log and incident triage

Turn noisy output into a timeline, a probable cause, and a next action.

## Method

1. **Find the failure, not the first error.** Logs are full of benign errors. Locate the point where
   behaviour actually diverged - often earlier and quieter than the loudest message.
2. **Build a timeline.** Order the significant events with timestamps and compute the gaps. A gap is
   information: a 40-second silence before a timeout says more than the timeout does.
3. **Separate cause from consequence.** One failure produces a cascade. Report the first thing that
   went wrong, then note what followed from it.
4. **Extract the numbers.** Durations, counts, sizes, memory, exit codes, status codes, retry counts.
   Specifics distinguish triage from speculation.
5. **Compare against a good run** when one exists. The difference between working and failing is the
   fastest route to a cause.
6. **Check for absence.** A step that should have logged and did not is as informative as an error.

## Signals worth checking

- **Exit codes and kill signals** - 137 is usually an out-of-memory kill and often leaves no
  application log at all; 143 is a graceful termination request
- **Silent gaps** - long pauses without output: a stall, a lock, a GC pause, a network wait
- **Repetition** - the same error at a fixed interval means a retry loop; a growing interval means
  backoff is working
- **Resource ceilings** - memory, disk, file handles, connections, thread pool, quota
- **Cliffs** - it worked at N and fails at 10N: a limit was reached, not a bug introduced
- **Environment** - version, config, feature flag, or host differing from where it works
- **Truncation** - is the log complete, or did it stop because the process died?

## Output

- **Verdict** - what happened, one or two sentences
- **Timeline** - the significant events with timestamps and gaps
- **Evidence** - the exact log lines that support the verdict, quoted, with their location
- **Cause** - probable, with confidence, and what would confirm it
- **Consequences** - what else in the log follows from the cause rather than being separate
- **Next action** - the single most informative thing to do next
- **Unexplained** - anything in the log you could not account for

## Rules

- **Quote, do not paraphrase** error text, numbers and identifiers.
- Distinguish what the log shows from what you infer.
- If the log is insufficient, say what to log or capture next rather than speculating over the gap.
- Do not stop at the first plausible explanation. Check whether the timeline actually supports it.
- Long logs: grep for the failure region, read that fully, sample the rest. Say what you sampled.
- Handle logs as potentially sensitive - do not echo credentials, tokens or personal data you find.
