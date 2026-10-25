# Full quality goal — active audit

The goal remains the complete Windows robot-cleaner experience: professional physical UI, useful and correct cleaning decisions, smooth 3D and taskbar movement, working daily operation and wet scanning, real testing on this computer, measured space behavior, and no permanent removal of personal files. This audit does not treat a smaller passing feature set as completion.

The preceding goal work is **progress**: source changed, native behavior was exercised, actual storage and file integrity were measured, and remaining work is identified below. The full goal is not yet marked complete.

| Requirement                                                  | Current evidence                                                                                         | Audit result / next action                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Clickable physical vacuum, hatch, mop, clock and dock        | Native UI test exercises the mesh and accessible controls                                                | Verified normal flow; continue compact-window and keyboard checks                                                                        |
| Graphite/porcelain without disrupting movement or inspection | Same WebGL canvas and camera survive theme and mop changes                                               | Verified native assertions                                                                                                               |
| Smooth taskbar loops left of Start; dust/water trails        | Native window bounds checked, continuous-path tests, full 16-second animation harness                    | Verified normal display; continue layout-change and multi-display edge cases                                                             |
| Honest, useful space behavior                                | Recycle/restore proof plus actual NTFS allocation test                                                   | Recycling is explicitly not credited as free space; optional compression saved 7 MiB in an 8 MiB fixture and was fully undone            |
| Preserve contents and recovery                               | SHA-256 before, while recycled/compressed, and after restore/undo                                        | Verified fixtures; no personal file was permanently deleted                                                                              |
| Safe automatic and old-file rules                            | Engine tests cover roots, links, timestamps, changed files and review IDs                                | Verified existing Temp/crash-dump/Downloads rules; common browser-cache coverage and running-app protections still need evaluation       |
| Compression remains safe under failure and restart           | Normal undo, restart, re-scan, corrupt-journal and changed-content tests; actual interrupted native pass | Durable journal and actual child-process interruption verified; restart restored Undo and UI receipt, with hashes and allocation checked |
| Wet scanning reflects actual Defender output                 | Native fixture scans and result-classification tests                                                     | Verified successful normal scan and cancellation; continue failure/disabled-provider UI checks                                           |
| Daily routine, startup and resume                            | Calendar/DST tests, UI persistence and Electron hooks                                                    | Native login registration and resume-trigger integration still need verification without disturbing the user's settings                  |
| Professional empty, loading, error and large-bin states      | Native normal-flow screenshots; honest recycling receipt; viewport-fitting shell                         | Continue corrupt-manifest recovery, large-bin rendering, keyboard/focus and compact-window review                                        |
| Robust lifecycle and tray station                            | Normal open/close/return tested, operations prevent conflicting starts                                   | Continue quit-during-operation, failure and restart checks                                                                               |
| Current packaged artifact and private repository             | Stable 0.2 release exists; development source is being advanced                                          | Build and verify the next stable package after remaining audit gates pass                                                                |

## Native measurements from 25 October 2026

- Recycling: an 8,388,608-byte synthetic file retained the same file identity, size and SHA-256 in Windows Recycle Bin. Windows restored it with an identical SHA-256. Background drive changes were observed but not falsely attributed to recycling.
- Reversible compression: the same-size synthetic text fixture used 1,048,576 bytes after NTFS compression, saving **7,340,032 bytes** of file allocation. Undo restored 8,388,608-byte allocation. All three SHA-256 values matched.
- Incompressible synthetic data: no saving was claimed and the original uncompressed state was kept. A Lithuanian filename containing spaces, an apostrophe and brackets also passed content verification and undo.
- Frame pacing: the native foreground benchmark averaged about 165 requestAnimationFrame callbacks per second, with median 6.1 ms and p95 6.2 ms. The animation-only harness completed a full looping pass. These are measurements from this computer, not a guarantee for every GPU or display.
- The native round-trip, compaction and animation reports remain under ignored `test-results/`; only portable, synthetic-data summaries are committed.

## Next safe actions

1. Compression interruption recovery is verified in source and the unpacked Windows app. Include its evidence in the final release audit.
2. Exercise native startup/resume, large-bin/error recovery and compact layouts.
3. Evaluate useful closed-browser cache rules against the REA findings, with strict running-process guards and preserved cookies/sessions.
4. Repeat the complete requirement-by-requirement audit against the resulting packaged app. Keep the goal active until its evidence is sufficient.

## Interrupted compression proof — 25 October 2026

`node scripts/verify-compression-recovery.cjs` terminates a child process immediately after the native compression call and before the engine commits its result. The native app then starts against the retained journal, verifies the file, displays the recovery receipt, and undoes compression through the visible button. The 8 MiB fixture used 1 MiB after compression and 8 MiB after Undo; all three SHA-256 values matched. No file was permanently removed. This proves process interruption recovery on this computer; it does not simulate physical power loss or storage hardware failure.

The source suite now has 41 passing tests, including interruption before/after mutation, changed contents, pre-existing compression ownership, and corrupt metadata protection. Recovery only inspects files; it neither overwrites contents nor applies compression. The journal is flushed to disk before the native change, and the bin manifest is flushed before the journal is archived. Unverified records stay protected.

The unpacked Windows build (`release/win-unpacked/Vacuum.exe`, 0.3.0-alpha.1) also passed the actual interruption, recovery-receipt and visible Undo proof. Its sanitized result is in `docs/compression-recovery-proof.json`. A stable 0.3 release is still pending the remaining audit gates.
