# Isolate an owned draft without blocking primary integration

Use this when a task began in a shared checkout with ignored evidence, but its draft must move away from another owner's integration work. Branch creation, editor binding, file transfer and publication are separate states.

## 1. Prepare the owned closure

1. Inspect both checkout ownership and the intended branch/base using the main skill. Keep the primary owner's index, branch and unrelated dirty paths outside the transfer's write scope.
2. Enumerate the exact authored draft and approved ignored session/run directories. Distinguish these required task inputs from optional build-cache seeding. Measure regular-file bytes and available disk space; inspect symlinks rather than silently following them outside the closure.
3. Save a private immutable manifest with relative paths, sizes and SHA256 hashes, plus the source root, explicit base and intended branch. Stream large-media hashes with `createReadStream` rather than loading recordings into memory.
4. Keep mutable transfer logs/control files outside the inventoried closure, or explicitly exclude one control directory and verify its stable files separately. This prevents the manifest or a growing log from invalidating its own input inventory.
5. Preserve a hashed before-copy of the authored draft and a durable continuation recipe. The recipe must identify the remaining copy, verification, source-release and acknowledgement steps; it must not stop at creating the branch.

## 2. Perform the approved native handoff

Use the host-managed route when required, with the inspected base and only the setup needed for this task. Make the handoff the terminal action of that turn when its contract ends the live session. On the next turn, re-read actual host/Git binding, branch, HEAD and destination files before continuing; queued continuation is intent, not completion evidence.

## 3. Copy and verify before releasing primary

1. Require the actual destination checkout to match the intended branch/base and common repository. Copy only manifest-listed paths into it; do not transplant unrelated dirty state.
2. Use a resumable, non-overwriting copy. In Node, `copyFile(source, target, COPYFILE_FICLONE | COPYFILE_EXCL)` attempts a copy-on-write clone and otherwise copies normally. For an existing destination, verify its expected hash before reusing it; differing content is a stop condition, not permission to overwrite.
3. Verify source hashes against the prepared inventory and destination hashes against the same expectations. Preserve private file permissions and retain an owned durable logfile for a long transfer.
4. Independently inspect the copied draft, representative evidence and final receipt. Verify actual Git status so only the owned draft is Git-visible; ignored processing evidence must not become publication content.
5. When removal from primary is authorized, recheck that the public source draft is still untracked and byte-identical to the verified copy. Relocate it into an ignored holding file rather than destroying the sole original. Keep canonical private evidence in primary when preservation is required. If the source became tracked or changed, stop before removing it.
6. Verify primary public-note absence, retained private originals, destination note/hash and receipt readback. Only then send the primary owner the exact destination, branch, base and readiness acknowledgement. Report local/uncommitted state separately from commit or publication; isolation does not authorize either.

## 4. Continue with explicit provenance

Keep original ASR, reconciliation, summaries and pipeline receipts byte-identical. Record source-to-destination path translation in transfer metadata rather than rewriting historical evidence. Inspect executable helpers before reuse and bind their active output/root explicitly to the destination so later checks cannot mutate the primary draft.

Treat the transfer receipt's draft hash as a historical copy checkpoint. Subsequent editorial revisions get their own before/after hashes and scoped validation. Declare the editable draft/handoff paths separately from immutable processing inputs; another owner's evolving shared files are not a reason to weaken custody baselines or claim that a historical whole-tree check still passes.
