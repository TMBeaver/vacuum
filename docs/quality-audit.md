# Full quality goal — active audit

The goal remains the complete Windows robot-cleaner experience: professional physical UI, useful and correct cleaning decisions, smooth 3D and taskbar movement, working daily operation and wet scanning, real testing on this computer, measured space behavior, and no permanent removal of personal files. This audit does not treat a smaller passing feature set as completion.

The preceding goal work is **progress**: source changed, native behavior was exercised, actual storage and file integrity were measured, and remaining work is identified below. The full goal is not yet marked complete.

| Requirement                                                  | Current evidence                                                                                         | Audit result / next action                                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clickable physical vacuum, hatch, mop, clock and dock        | Native UI test exercises the mesh and accessible controls                                                | Verified normal flow; continue compact-window and keyboard checks                                                                                    |
| Graphite/porcelain without disrupting movement or inspection | Same WebGL canvas and camera survive theme and mop changes                                               | Verified native assertions                                                                                                                           |
| Smooth taskbar loops left of Start; dust/water trails        | Native window bounds checked, continuous-path tests, full 16-second animation harness                    | Verified normal display; continue layout-change and multi-display edge cases                                                                         |
| Honest, useful space behavior                                | Recycle/restore proof plus actual NTFS allocation test                                                   | Recycling is explicitly not credited as free space; optional compression saved 7 MiB in an 8 MiB fixture and was fully undone                        |
| Preserve contents and recovery                               | SHA-256 before, while recycled/compressed, and after restore/undo                                        | Verified fixtures; no personal file was permanently deleted                                                                                          |
| Safe automatic and old-file rules                            | Engine tests cover roots, links, timestamps, changed files and review IDs                                | Temp/crash-dump/Downloads rules and closed Chrome/Edge cache rules verified; native running-process, reopen-before-recycle and restore proofs passed |
| Compression remains safe under failure and restart           | Normal undo, restart, re-scan, corrupt-journal and changed-content tests; actual interrupted native pass | Durable journal and actual child-process interruption verified; restart restored Undo and UI receipt, with hashes and allocation checked             |
| Wet scanning reflects actual Defender output                 | Native fixture scans and result-classification tests                                                     | Verified successful normal scan and cancellation; continue failure/disabled-provider UI checks                                                       |
| Daily routine, startup and resume                            | Calendar/DST tests, UI persistence and Electron hooks                                                    | Background overdue scan, same-day restart suppression and native resume-handler integration verified; OS login registration still needs verification |
| Professional empty, loading, error and large-bin states      | Native normal-flow screenshots; honest recycling receipt; viewport-fitting shell                         | 50,000-reference native review, search/selection, corrupt-manifest refusal and 900 × 600 panel verified; continue full keyboard/focus review         |
| Robust lifecycle and tray station                            | Normal open/close/return tested, operations prevent conflicting starts                                   | Continue quit-during-operation, failure and restart checks                                                                                           |
| Current packaged artifact and private repository             | Stable 0.2 release exists; development source is being advanced                                          | Build and verify the next stable package after remaining audit gates pass                                                                            |

## Native measurements from 25 October 2026

- Recycling: an 8,388,608-byte synthetic file retained the same file identity, size and SHA-256 in Windows Recycle Bin. Windows restored it with an identical SHA-256. Background drive changes were observed but not falsely attributed to recycling.
- Reversible compression: the same-size synthetic text fixture used 1,048,576 bytes after NTFS compression, saving **7,340,032 bytes** of file allocation. Undo restored 8,388,608-byte allocation. All three SHA-256 values matched.
- Incompressible synthetic data: no saving was claimed and the original uncompressed state was kept. A Lithuanian filename containing spaces, an apostrophe and brackets also passed content verification and undo.
- Frame pacing: the native foreground benchmark averaged about 165 requestAnimationFrame callbacks per second, with median 6.1 ms and p95 6.2 ms. The animation-only harness completed a full looping pass. These are measurements from this computer, not a guarantee for every GPU or display.
- The native round-trip, compaction and animation reports remain under ignored `test-results/`; only portable, synthetic-data summaries are committed.

## Next safe actions

1. Compression interruption recovery is verified in source and the unpacked Windows app. Include its evidence in the final release audit.
2. Exercise native startup/resume, large-bin/error recovery and compact layouts.
3. Browser-cache coverage and guards are now implemented and verified. Include them in the final packaged release audit.
4. Repeat the complete requirement-by-requirement audit against the resulting packaged app. Keep the goal active until its evidence is sufficient.

## Interrupted compression proof — 25 October 2026

`node scripts/verify-compression-recovery.cjs` terminates a child process immediately after the native compression call and before the engine commits its result. The native app then starts against the retained journal, verifies the file, displays the recovery receipt, and undoes compression through the visible button. The 8 MiB fixture used 1 MiB after compression and 8 MiB after Undo; all three SHA-256 values matched. No file was permanently removed. This proves process interruption recovery on this computer; it does not simulate physical power loss or storage hardware failure.

The source suite now has 41 passing tests, including interruption before/after mutation, changed contents, pre-existing compression ownership, and corrupt metadata protection. Recovery only inspects files; it neither overwrites contents nor applies compression. The journal is flushed to disk before the native change, and the bin manifest is flushed before the journal is archived. Unverified records stay protected.

The unpacked Windows build (`release/win-unpacked/Vacuum.exe`, 0.3.0-alpha.1) also passed the actual interruption, recovery-receipt and visible Undo proof. Its sanitized result is in `docs/compression-recovery-proof.json`. A stable 0.3 release is still pending the remaining audit gates.

## Large bins, typography and body depth — 25 October 2026

The bin review now renders at most 100 files per page, with name/path search and selections preserved across navigation and filtering. `node scripts/verify-large-bin.cjs` loaded 50,000 synthetic references without creating, compressing or recycling those files. In the unpacked Windows app the panel opened in 113 ms, paging took 55 ms, and search took 81 ms on this computer. The same harness verified a 900 × 600 layout and refused cleaning through corrupt metadata without rewriting it. These are fixture measurements, not a guarantee for every computer.

The robot's chassis and deck are 0.18 model units deeper (roughly 30% more body depth); controls, lidar, lid, cassette and their animation heights move with the deck. The native 3D raycast, rotation, hatch, mop, theme and taskbar flow passed after this change. Typography uses installed Windows Bahnschrift headings and Segoe UI Variable body text; Geist is no longer loaded by the UI. Copy now uses direct labels, with fewer slogans and spaced capitals. The common size formatter displays only MB, GB and TB, including small values such as `<0.01 MB`; 499,999 KB becomes 488.28 MB. Boundary/unit tests are included, bringing the source suite to 42 passing tests.

`node scripts/verify-scheduling.cjs` runs an overdue scan at hidden/background startup, suppresses repeats after restart or resume on the same day, and checks that two resume events during an overdue round cause one round. The native app's existing resume listener is exercised by emitting its Electron event; the harness does not suspend Windows or sign the user out. Synthetic file contents remained intact. Login registration and actual OS sign-in/suspend behavior remain distinct verification limits.

The latest unpacked Windows app also passed the background-start/resume scheduling harness and the full interactive UI flow after the body, typography and unit changes. Sanitized native scheduling and large-bin reports are committed beside this audit.

## Closed-browser caches and actual local audit — 25 October 2026

The original cache rules cover only standard Chrome and Edge `Default` / `Profile N` directories in the current user's Local AppData: `Cache/Cache_Data`, `Code Cache/js`, and `Code Cache/wasm`. Files must be unchanged for more than seven days. Profile data, credentials, cookies, sessions, extensions, service-worker storage and other site storage are outside the allowlist. No third-party rule database was copied. The REA findings above informed the discovery/action split and active-browser protection.

The guard uses exact Windows process image names, protects each browser independently, and leaves its caches untouched if detection fails. Before recycle or compression, the guard is checked again; snapshots expire 500 ms after the native query completes. This does not claim an atomic guarantee against a browser starting between the check and OS operation. Cache junctions and root ancestors are protected; unavailable profiles retain their references and compression metadata on restart.

`node scripts/verify-browser-cache.cjs` passed in source and the unpacked app. It runs a signed Windows loopback-ping fixture under a browser image name to exercise actual tasklist detection without starting or closing any user browser. The app skipped collection while that process ran, collected one aged synthetic cache file after it stopped, blocked recycling after it restarted, then recycled and restored the file with an unchanged SHA-256. A synthetic Cookies file remained intact. No file was permanently removed.

`node scripts/audit-local-caches.cjs` read the real local cache locations using the same cache rules and native process guard. It found 41,939 eligible cache references totalling 3.94 GB (Chrome 3.77 GB; Edge 170.09 MB), with no scan errors or limit reached. The scan took about 123 seconds on this computer. It wrote only a new temporary reference manifest and never recycled, compressed or moved a user file. This is logical candidate size, not measured reclaimed drive space. The committed report contains aggregate counts/sizes, not user paths or filenames.

The scheduling harness had an asynchronous wait that could complete before the scan returned to the dock. That wait was replaced with explicit IPC state polling and a deadline, and source plus packaged background-start/resume checks passed again. This supersedes the earlier harness evidence for those checks. Real OS sign-out or suspend was not performed.

The suite now has 51 passing tests. New cases cover isolated cache boundaries, active/reopened browsers, unavailable detection, cache junctions, new profiles, unavailable-profile persistence and hostile persisted root locations. Remaining release gates still include OS login registration, full keyboard/focus review, display changes, Defender failure UI, lifecycle failures and the final installer audit.
