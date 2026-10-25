# Verification — 25 October 2026

- Production Vite build: passed.
- Fixture engine/helper suite: 24 tests passed, including junction substitution, corrupt manifests, changed files, cancellation, failed recycling, explicit old-file collection and Vilnius daylight-saving scheduling.
- Native Electron UI: launched and rendered the real WebGL robot. Verified both themes, persisted preferences, daily toggle, scan → review → Windows Recycle Bin, and old-file opt-in/release. No renderer errors.
- Wet mode: launched the installed Microsoft Defender CLI against isolated test Temp/Downloads directories. Both custom scans completed with exit code 0. No personal folder was scanned by this test. No malware samples were used, so detection effectiveness was not evaluated.
- Windows x64 NSIS installer: built successfully. No signing certificate was available; the installer is unsigned.
- Packaged `Vacuum.exe`: the same complete native integration passed against the actual packaged executable, including fixture-only Defender scans and recycling.
- npm dependency audit: zero reported vulnerabilities at build time.

Only a synthetic disposable test file was sent to Recycle Bin. Research packages were inspected statically and not executed. Actual Windows login registration, Windows shutdown/wake behavior, Defender detection/remediation, and long-term daily operation were not end-to-end tested; scheduler decisions are covered by unit tests.

## Version 0.2 interactive hardware and taskbar checks

Native UI verification exercised all six physical controls, a direct raycast click on the 3D power mesh, drag-to-inspect without triggering cleaning, clock preference persistence, physical hatch/cassette opening, mop attachment without replacing the WebGL canvas, actual departure/cleaning/wet/return/dock states, cancellation from the home control, and dust/water companion frames. The compact companion uses a continuous capsule path with semicircular turns, not an abrupt direction flip. Windows taskbar and Start bounds are read through UI Automation and converted from physical pixels to Electron DIP coordinates. A fallback is used when no safe left-of-Start space exists.

A read-only audit of the actual user's temporary-file roots visited 6,392 entries and found 7 eligible temporary files (1,034,610 bytes) in 0.87 seconds. It reported one unreadable location and six skipped entries. It recycled zero files. Only synthetic fixtures were recycled by integration tests.

The packaged companion window had native bounds that matched the intended taskbar lane after accounting for fractional Windows DPI.
