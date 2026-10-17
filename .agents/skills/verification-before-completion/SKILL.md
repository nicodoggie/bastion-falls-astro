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

1. **Separate test identities from exercised scenarios.** Deduplicate runner-reported test IDs across retries; report failures and skips separately. For looped or parameterized process fixtures, count executed scenarios from the recorded run and inspect the fixture's case construction before quoting a total. Report methods and scenarios as separate quantities, because one method can cover many subprocess cases and repeated runs do not add distinct coverage.
2. **Parse runner results, not the log's last line.** For saved unittest evidence, require the recorded command, exit status, test count and standalone `OK` result to agree; allow ordinary application output after that result. A trailing diagnostic print must not turn a successful run into a false failure, and an isolated success marker must not override a nonzero exit.
3. **Verify lint scope before calling it clean.** Check how many supplied files were actually included; configuration may exclude an imported document. Report excluded-file checks separately. When comparing baseline diagnostics, match rule and offending source rather than shifted line numbers, and preserve relative-path context for link checks; relocating a baseline document can manufacture broken-link warnings.

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
