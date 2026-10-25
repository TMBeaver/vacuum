# Cleaning engine

`createCleaner({ userData, tempRoot, localAppData, downloadsRoot, trashItem, onProgress })`
uses Node built-ins only. `trashItem` must be Electron's `shell.trashItem` (or a fixture spy in tests).
All methods are asynchronous except `close()`.

- `getBin()` → `{ files, count, bytes }`.
- `scan({ signal } = {})` → bin plus `{ added, coverage }`. Automatic rules: `.tmp`, `.temp`, `.log` in `tempRoot` older than seven days; `.dmp` in `localAppData/CrashDumps` older than 30 days. Cancellation commits no additions. Scan does not move files.
- `reviewOldFiles()` → `{ files, count, bytes, coverage }`. Downloads unchanged for 180 days. This is a suggestion, never proof a file is unnecessary. No automatic collection.
- `collectOldFiles(ids)` → bin plus `{ added, skipped }`. Only IDs from the current review are accepted, with metadata revalidation.
- `emptyBin(ids)` → `{ trashed, bytes, skipped, bin }`. Only IDs already in the bin are accepted. Invalid/changed/linked/unreadable files stay untouched. Failed recycling has no deletion fallback. Emptying requires an explicit UI action.
- `release(ids)` → bin. Forget references without touching files.
- `close()` → cancel traversal during shutdown.

Files expose `{ id, path, name, size, mtimeMs, category, reason }`. Category is `temporary`, `crash-dumps`, or `old-downloads`. Display `size` in bytes. `onProgress` receives `{ visited, found, bytes, category }`; counts are real, not a percentage prediction.

`coverage` is `{ visited, skipped, limited, cancelled, errors }`; a 50,000-entry cap keeps traversal bounded. Missing roots are expected. Unreadable directories count as errors; symbolic links/junctions, hard links and the app's state directory are excluded. Report partial coverage when `limited` or `errors` is nonzero.

Bin metadata persists atomically to `userData/bin.json`. IDs and original file identities survive restart. Every recycling operation rechecks configured-root membership, all path ancestors, resolved containment, ordinary-file status, rule age/type, size, mtime, ctime, birthtime, inode and device. Like any path-based `shell.trashItem` caller, there remains a small OS check-to-use race; no atomic file-handle deletion guarantee is claimed. The engine never permanently deletes user files.
