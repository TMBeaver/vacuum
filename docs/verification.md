# Verification — 25 October 2026

- Production Vite build: passed.
- Fixture engine/helper suite: 21 tests passed, including junction substitution, corrupt manifests, changed files, cancellation, failed recycling, explicit old-file collection and Vilnius daylight-saving scheduling.
- Native Electron UI: launched and rendered the real WebGL robot. Verified both themes, persisted preferences, daily toggle, scan → review → Windows Recycle Bin, and old-file opt-in/release. No renderer errors.
- Wet mode: launched the installed Microsoft Defender CLI against isolated test Temp/Downloads directories. Both custom scans completed with exit code 0. No personal folder was scanned by this test. No malware samples were used, so detection effectiveness was not evaluated.
- Windows x64 NSIS installer: built successfully. No signing certificate was available; the installer is unsigned.
- Packaged `Vacuum.exe`: the same complete native integration passed against the actual packaged executable, including fixture-only Defender scans and recycling.
- npm dependency audit: zero reported vulnerabilities at build time.

Only a synthetic disposable test file was sent to Recycle Bin. Research packages were inspected statically and not executed. Actual Windows login registration, Windows shutdown/wake behavior, Defender detection/remediation, and long-term daily operation were not end-to-end tested; scheduler decisions are covered by unit tests.
