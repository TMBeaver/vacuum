# Vacuum: cleaner investigation

Investigated on 2026-10-25 with the installed REA 6.4.0 CLI. Downloaded artifacts were inspected statically and were **never executed**. Vacuum uses original implementation and rules; no third-party cleaning database or implementation is incorporated.

## Targets and provenance

| Target | Official shipped artifact | SHA-256 |
| --- | --- | --- |
| FluentCleaner Classic, release tag 26.09.01 | [FluentCleaner-Classic-net48.zip](https://github.com/builtbybel/FluentCleaner/releases/tag/26.09.01) | `42703e673cff81eb9d2ec7f8eacaaf93fa009915ffca40e54b63ba789d80fe85` |
| FluentCleaner Core assembly from that package | `FluentCleaner.Core.dll` (25,600 bytes) | `835825a77408e19a118164172cb04f0e73dd9745d7de1e4f286bc8679c9ad4cb` |
| FluentCleaner Classic executable from that package | `FluentCleaner.Classic.exe` | `b23ad493012a37998f600f4adedd8dfed1858b1030bb46d32394b37c01a2a150` |
| BleachBit 6.0.6 | [BleachBit-6.0.6-portable.zip](https://github.com/bleachbit/bleachbit/releases/tag/v6.0.6) | `285a53c01f95cf859250c1b612f27c2ff1247c5af53eb8e8c6744b374f1ed19e` |

Complete raw REA envelopes and original packages are retained locally in this directory and excluded from Git. They contain local artifact paths. `evidence-summary.json` is a deliberately selected, portable excerpt, not a replacement canonical Evidence bundle.

## REA evidence ledger

1. `ev_5d9157193cff5f12b81f994bc4f8ab34d7dedc44ff1a3b2933f48ace49dcb2eb` — `inspect_managed_artifact`, Core.dll. Observed managed CIL assembly targeting .NET Standard 2.0; artifact and metadata coverage complete. This does not load a CLR or execute the assembly.
2. `ev_d2eb167ded30720a99f0fc65381ec5dfda7246f2b7dbd6eae5584ba458d2ac29` — `inspect_managed_members`, Core.dll. Observed metadata and file-backed CIL anchors. Reported coverage partial. Tokens below are build-local and require the matching SHA-256/MVID.
3. `ev_85f30a11515d244fb70a1e5d3b82e420fbda8c661252e791b2feba22272ab097` — `inspect_managed_members`, Classic.exe. Observed methods and static call edges, not runtime traces or recovered C# source.
4. `ev_d80c871f036b3cecbcd0735acbb0c2738de56d43a4ed4d425e94a96da21ccc96` — `inspect_artifact`, BleachBit portable ZIP. Root manifest graph: 536 nodes/occurrences, 535 edges. Nested inventory Evidence `ev_ec27463e395baf2868b97c378ec7562e84bf2d61fe54553ed2727df4922a4958`. ZIP central-directory inventory establishes packaged members; it does not establish cleaner execution semantics.

## Observed behavior and engineering implications

### Separate discovery from deletion — answered

Classic.exe `CleaningService.Analyze` (`0x0600007b`) statically calls `BuildFileExclusions`, `FindFiles`, `TryGetDeletableSize`, and accesses the result's file list, sizes, and total bytes. `CleaningService.Clean` (`0x0600007f`) is a separate method that consumes the scan result and has a `Delete(string)` call. Packaged English localization describes the review stage as not having deleted files yet, and describes final cleaning as permanent deletion.

**Vacuum design choice:** starting the robot discovers eligible files and fills a manifest bin. Emptying the bin is a separate explicit action, using the Windows Recycle Bin instead of permanent deletion. Discovery must never move personal or temporary files out from under their applications.

### Exclusions, protected paths, and active applications — answered statically

Classic.exe iterator `FindFiles.MoveNext` (`0x06000253`) calls `IsExcluded` and `IsProtected`; `CleaningService` has a `ProtectedSegments` string-array field (`0x0400003a`). `CleanGuardService.ConfirmCleanGuards` (`0x060001a9`) calls `ConfirmRunningBrowsers` and `ConfirmWarnings`. The recursive enumerator (`0x06000248`) checks cancellation and recursively calls `EnumerateFilesSafe`.

Packaged localization says exclusions override database rules, and protected browser extension paths should be preserved. The shipped Winapp2 database uses app-detection conditions, paths, patterns, and distinct categories; it is not a general classifier of file usefulness.

**Vacuum design choice:** allowlist exact disposable roots, skip links/reparse points and unavailable files, apply a minimum file age, deduplicate, and revalidate identity/size/mtime before recycling. Preserve cookies, saved credentials, browser sessions, extension data, registry, documents, and system/update stores. A failed file stays visible; successful items alone leave the bin.

### Browser caches are not browser profiles — answered from packaged resources

Ordinary XML inspection of BleachBit's packaged `share/cleaners/google_chrome.xml` observes separate cache, cookies, AI-model, and other options. It declares browser-running checks and profile-specific Windows roots. Cache rules include `Cache`, `Code Cache`, and `Media Cache`; cookies are described as containing login and preference data. These resource observations are **not** claims that REA interpreted XML semantics.

**Vacuum design choice:** narrow cache roots only, and avoid touching a running browser. Never treat an entire `User Data`/profile directory, service-worker storage, or all `AppData` as expendable.

### Age, deep scan, and personal files — partial; usefulness remains unknown

BleachBit's packaged `deepscan.xml`, read with ordinary XML/text tools, marks backup-file deep scans for preview review, and warns that `node_modules` may be bundled with applications. The packaged protected-path resource explicitly distinguishes warnings from automatic keep-list protection.

**Inference:** filename, extension, and age alone are insufficient evidence that a personal file is no longer needed. Neither this static investigation nor any copied cleaning rule can establish the user's intent.

**Vacuum design choice:** old Downloads are suggestions requiring explicit selection. Daily cleaning never sweeps Documents/Desktop, project dependencies, backups, photos, or arbitrary old files.

### Scheduled operation — answered statically, runtime not tested

Classic.exe includes `TaskSchedulerService.CreateOrUpdate` (`0x06000207`), `Delete`, `Exists`, and `Run`, and `SilentRunner.RunAsync`. Shipped localization specifies daily/weekly/logon modes, Task Scheduler, and logged-on-user operation. Static call edges alone do not prove successful task registration or wake behavior.

**Vacuum design choice:** daily auto-clean scans into the bin; it never empties it. Catch up missed runs when the app resumes. Make enabled/running/last-run states visible. Platform startup registration and actual scheduling must be tested in Vacuum separately.

### Malicious files / wet mode — unresolved by cleaner artifacts

This investigation establishes no malware-detection engine in either studied artifact. No malware sample was downloaded or executed. Cleaner file rules do not establish malware verdicts.

**Vacuum design choice:** delegate wet scanning to installed Windows Security / Microsoft Defender and report its actual completion/unavailable/error status. Do not invent threat scores or claim universal protection. Malware remediation belongs to Defender, not the dust bin.

## Limits

This was a bounded static investigation of two specific official releases. REA did not decompile native code, reconstruct all methods, execute either cleaner, observe deletion, test scheduler behavior, or prove any specific real-user file safe to delete. Packaged-resource observations are labelled separately from REA evidence. No proprietary cleaner implementation was copied. Winapp2 declares CC-BY-SA-4.0; BleachBit cleaner XML declares GPL-3.0-or-later. Those databases are excluded from the Vacuum source distribution.
