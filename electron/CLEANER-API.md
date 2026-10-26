# Cleaning engine

`createCleaner({ userData, tempRoot, localAppData, downloadsRoot, trashItem, compactFiles, assertBrowserClosed, onProgress })`
uses Node built-ins only. `trashItem` must be Electron's `shell.trashItem` (or a fixture spy in tests).
All methods are asynchronous except `close()`.

Optional `onEmptyProgress({ processed, total, recycled, skipped, bytes })` reports the current selected batch: initially zero processed, then one update after every committed recycling success or skipped attempt. Totals include only known selected bin IDs, deduplicated. `bytes` is logical recycled-file size, not reclaimed drive space. The UI bridge throttles these small events with a trailing update; it does not resend the whole bin per file.

- `getBin()` → `{ files, count, bytes }`.
- `scan({ signal } = {})` → bin plus `{ added, coverage }`. Automatic rules: `.tmp`, `.temp`, `.log` in `tempRoot` older than seven days; `.dmp` in `localAppData/CrashDumps` older than 30 days; standard Chrome/Edge network and JS/Wasm code-cache roots older than seven days while the browser is closed. Cancellation commits no additions. Scan does not move files.
- `reviewOldFiles()` → `{ files, count, bytes, coverage }`. Downloads unchanged for 180 days. This is a suggestion, never proof a file is unnecessary. No automatic collection.
- `collectOldFiles(ids)` → bin plus `{ added, skipped }`. Only IDs from the current review are accepted, with metadata revalidation.
- `emptyBin(ids)` → `{ trashed, bytes, skipped, bin }`. Only IDs already in the bin are accepted. Invalid/changed/linked/unreadable files stay untouched. Failed recycling has no deletion fallback. Emptying requires an explicit UI action.
- `release(ids)` → bin. Forget references without touching files.
- `close()` → cancel traversal during shutdown.

Files expose `{ id, path, name, size, mtimeMs, category, reason }`. Category is `temporary`, `crash-dumps`, `browser-cache`, or `old-downloads`. The `size` field is bytes; display it through the shared MB/GB/TB formatter. `onProgress` receives `{ visited, found, bytes, category }`; counts are real, not a percentage prediction.

`coverage` is `{ visited, skipped, limited, cancelled, errors, protectedBrowsers }`; a 50,000-entry cap keeps traversal bounded. Missing roots are expected. Unreadable directories count as errors; symbolic links/junctions, hard links and the app's state directory are excluded. Report partial coverage when `limited` or `errors` is nonzero.

Bin metadata persists atomically to `userData/bin.json`. IDs and original file identities survive restart. Every recycling operation rechecks configured-root membership, all path ancestors, resolved containment, ordinary-file status, rule age/type, size, mtime, ctime, birthtime, inode and device. Like any path-based `shell.trashItem` caller, there remains a small OS check-to-use race; no atomic file-handle deletion guarantee is claimed. The engine never permanently deletes user files.

Development: `compactBin(ids, compress = true)` performs an explicit reversible pass on up to 64 selected bin IDs through an injected native adapter. Metadata, native allocation and SHA-256 checks protect the operation. Only compression applied by Vacuum can be undone through this method. The adapter exposes `inspect(entries)` for read-only allocation and hash verification. A flushed `compression-journal.json` precedes native changes; a flushed bin manifest precedes journal archival. On startup, identity and contents are inspected to reconstruct Undo without changing the file. Public files expose `compacted` and `recoveryProblem` for the review UI. Recycling and compression savings are measured and reported separately.

`getRecovery()` returns `{ recovered, needsReview, pending, error?, problems? }`. `recoverCompaction()` retries pending read-only verification and returns the bin plus `recovery`. Corrupt/unreadable journals block recycling and compression; records with unverified contents remain protected. `release(ids)` only forgets references and does not undo compression or touch contents. The native interruption harness covers an actual child-process exit after compression and recovery through the app's visible Undo control; physical power-loss guarantees are not claimed.

`assertBrowserClosed(browserKey)` is an injected native guard for cache rules. The Windows adapter uses an exact `chrome.exe` / `msedge.exe` process-name snapshot from tasklist, shared for up to 500 ms after the query completes. Missing or failed detection protects browser caches. Profile discovery is refreshed on each scan. Only exact recognized roots may be reconstructed from persisted metadata, so a missing/inaccessible profile retains references and Undo metadata without widening the allowlist. Traversal validates root ancestors before enumerating and validates each candidate before collection; all action-time identity checks still apply. Cookie, session, login, extension, service-worker and site-storage paths are excluded.

Undo after a legitimate external edit checks that the volume, file ID and birth time still identify the file Vacuum compressed. It snapshots current size/timestamps and verifies current SHA-256 around decompression, preserving the edited contents rather than restoring older contents. Recycling/new compression retain their stricter age and collection-metadata rules. A replacement at the same path is refused. Previously recorded savings are cleared when contents change; old allocation measurements are not credited to new contents. `node scripts/verify-edited-undo.cjs` exercises this through native NTFS compression, an external edit, app restart and the visible Undo control.
