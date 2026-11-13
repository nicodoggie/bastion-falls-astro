---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT VERIFIED EVIDENCE FOR THE EXACT ARTIFACT AND CLAIMED SCOPE
```

Run the relevant verification before claiming success and bind its output to the exact candidate and execution conditions. Before reusing saved evidence, check that the covered bytes, metadata and relevant environment assumptions still match; otherwise rerun the affected checks. A new message, delayed result notification or identical-byte commit does not alone require replaying an unchanged expensive build. State whether evidence is freshly executed or reused, and never describe a scoped pass as whole-product acceptance.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. ESTABLISH: Execute the full relevant command, or verify the identity and applicability of complete saved execution evidence
3. READ: Inspect actual output and recorded exit status; count distinct tests, failures, errors and skips
4. VERIFY: Does the evidence cover the exact artifact and stated claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Verification Accounting

1. **Separate test identities from exercised scenarios.** Deduplicate runner-reported test IDs across retries and overlapping suites/checkpoints; report failures and skips separately. Do not add successive focused-scope totals as though they were distinct coverage unless their identity sets were actually reconciled. Do not emit `PASS` from shell exit zero alone: unittest's `Ran` count includes skipped methods, and `OK (skipped=N)` does not prove those gates executed. Before rerunning a skipped tool-backed test, read its discovery guard as well as its launch code; an explicit executable environment variable does not satisfy a separate `shutil.which()` check. When appropriate, put the declared tool directory on the invocation-local `PATH` and rerun only the affected gate. For looped or parameterized process fixtures, count executed scenarios from the recorded run and inspect the fixture's case construction before quoting a total. Report methods and scenarios separately, because one method can cover many subprocess cases and repeated runs do not add distinct coverage.
2. **Parse identities and suite outcome separately.** For saved unittest evidence, extract test identities from the observed verbose-header format, then reconcile them with the recorded command, exit status, suite count, failures/skips and standalone `OK` result. Allow fixture stdout after a header's `...` with its `ok` on a later line; requiring every header to end in `ok` silently drops executed tests. Allow ordinary application output after the suite result too. If a collector assertion fails, inspect the raw runner footer and identify the exact failed predicate—outcome, skips, identity count or format—before changing its parser; a generic assertion message is not a diagnosis. Correct collector-only errors against retained logs rather than replaying successful tests. For CLI JSON output, inspect the actual top-level document before choosing a parser: a verified `pulumi preview --json` shape is one JSON object with `steps`, `diagnostics` and `changeSummary`, not JSONL `summaryEvent` records. Parse the complete object, reconcile the native exit with `changeSummary`, and retain only sanitized evidence when full provider output can contain sensitive configuration. A trailing diagnostic print must not turn success into failure, and an isolated success marker must not override a nonzero exit. Chain required shell gates with `&&` or run them under `set -e`, and check each tool result before any dependent publication. A sequence such as `lint; git diff --check` reports the last command's exit and can conceal failed lint. If that happens, rerun the failed gate with failure propagation before continuing; a successful later API write does not validate the earlier check.
3. **Verify lint scope before calling it clean.** Check how many supplied files were actually included; configuration may exclude an imported document. Report excluded-file checks separately. When comparing baseline diagnostics, match rule and offending source rather than shifted line numbers. To lint an immutable PR head without disturbing a dirty checkout, extract changed files with `git show <head>:<path>` into owned scratch, preserving repository-relative paths; materialize their direct local-link targets from that same head, then run the repository linter against the explicit changed-file list with an explicit repository configuration path. Do not rely on the working directory to select configuration for external files; discovery can follow the input file's ancestors instead. For rumdl, use `pnpm exec rumdl check --config "$REPO/.rumdl.toml" "$FILE"`. Check GitHub PR/comment bodies separately from repository documents: when GitHub supplies the enclosing title, a body-only `--extend-disable MD041` is appropriate; retain the normal heading rule for standalone documents. A partial snapshot manufactures missing-link errors: repair the verification context and rerun instead of changing correct source or suppressing the link rule. Cover untracked authored files separately because ordinary `git diff --check` omits them. For a new file, `git diff --no-index --check /dev/null "$FILE"` also implies diff exit semantics: exit 1 with no whitespace diagnostics can mean the expected file addition, not a failed whitespace check. Inspect diagnostics and distinguish fatal tool errors from the expected diff result.
4. **Classify stderr instead of requiring it to be empty.** Check the actual command exit, parse the required result and verify its artifact assertions, then inspect retained stderr for contradictory errors or separate advisories. SSH transport warnings can accompany a successful remote readback; neither nonempty stderr alone nor exit zero alone establishes the target outcome. If only an empty-stderr collector assertion was wrong, reconcile the existing complete result without replaying the target, suppressing diagnostics or changing transport configuration. For live acceptance probes, retain an allowlisted response status and stage before asserting so a later failure is diagnosable without exposing bodies or credentials; a successful retry does not reconstruct an unrecorded original status.
5. **Verify scenario preconditions before naming coverage.** Inspect recorded case values, not only test names. For selector-precedence probes, record the configured selector, PATH candidate, resolved runtime image and platform; assert genuinely different contenders before claiming precedence over a conflicting tool. Matching contenders prove identity resolution in that configuration, not the conflict case. Attribute simulated or cross-platform regression coverage separately from target-native execution. Correct an overstated report directly; execute a missing scenario when it is a required acceptance criterion, rather than replaying successful proof merely to preserve its original label.

6. **Bind attempt logs and delayed notifications to execution identity.** Assign each retry its own log path and retain its command, working directory, process/task handle, exit status and covered source identity; reusing one `build.log` can make an old notification point at newer output and erase the failure evidence. Reconcile delayed completions by those handles and source identities, not arrival order. Attribute exit codes to the process that actually returned them: an SSH command, missing-path readback or collector failure does not establish the remote build's exit. Require the target's terminal receipt or native log before naming its result; otherwise report the build outcome as unverified and correct any earlier unsupported attribution rather than propagating it into issues or plans. If a notification matches an attempt whose artifact/result was already verified and communicated, consume it without another user-facing acknowledgment, rerun, or repetition of an unanswered question. Report a new unsuperseded failure as a material state change. Supersede an earlier failure only with successful proof covering the corrected boundary. When consolidating receipts, verify that each copied log belongs to the claimed attempt; label summaries reconstructed from observed tool output as summary receipts, not raw stdout. Reuse valid execution evidence rather than rerunning a successful build solely to repair a mislabeled report.

7. **Check write-helper results before consuming their outputs.** Inspect the tool's documented success/error fields before a dependent read, hash, upload or completion summary; some helpers return an error object without raising an exception. Stop that dependent branch on a failed write and preserve the original error instead of masking it with a later missing-file exception. Reconcile earlier successful writes separately: one failed receipt does not undo previous effects or prove that subsequent publication started.

8. **Establish regression status before labelling broad failures.** Preserve the exact failed command and diagnostic while completing unaffected owning gates. Call a failure pre-existing only when baseline execution or independently bound unchanged inputs establishes that attribution; an old-looking assertion, unmodified test file or missing fixture export alone does not. If no comparison was performed, report the broader gate as failing with regression status unestablished, not green, introduced or proven unrelated.

9. **Match health probes to the frontend/backend contract.** Inspect required proxy headers and redirect behavior before treating a direct backend error as an application failure. Probe the actual frontend separately; for a backend login check, use its final route and the verified forwarded-URL header rather than accidentally following an HTTPS redirect with a different client's default trust context. Report a collector certificate failure at that stage as a probe failure, not evidence that the frontend TLS certificate or service is broken. Correct and rerun only the read-only probe; do not repeat installation or restart a healthy service to repair the collector.

10. **Reduce custody evidence before rendering it.** Inspect saved receipt fields by type and bounded size first, including string lengths: an index-flag inventory can be one enormous string rather than a list. Select only the scalar outcomes, mismatch counts and explicitly relevant rows needed for the decision; do not print every scalar value or truncate a serialized whole record after constructing it. Compare full permitted inventories programmatically and keep them in private artifacts, because context flooding can hide the very result being checked. For independent remote readback, reuse the existing output manifest and consumer bindings, rehash those exact live targets and compare protected state with the terminal snapshot; return counts and mismatches rather than another inventory dump. Correct projection-only failures against retained evidence without rerunning a successful build.

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Actual successful test output and exit, bound to the candidate; skips stated separately | Unbound previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| No new lint findings | Same-tool current-versus-base diagnostics, matched by file, rule and offending source; existing findings disclosed | Calling a nonzero lint run clean or silently ignoring its diagnostics |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Using narrow verification to imply broader acceptance
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "This narrow pass completes the whole feature" | A focused check proves its stated boundary only; reconcile every remaining acceptance criterion |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write regression → Run against the unfixed boundary (MUST FAIL for the intended cause) → Apply fix → Run the same regression (PASS)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Why This Matters

From 24 failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Establish applicable execution evidence. Read the output and actual exit. Confirm artifact identity and acceptance scope. THEN claim only the result that evidence supports.

This is non-negotiable.
