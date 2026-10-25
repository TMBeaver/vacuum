Vacuum is a personal robot vacuum for Windows, with a real 3D robot and dock, graphite/porcelain themes, a tray station, and an animated taskbar companion.

- Collect aged temporary files and crash dumps into a reviewable virtual dust bin.
- Send selected bin contents to Windows Recycle Bin only when you explicitly empty it.
- Review forgotten Downloads separately; age never causes automatic personal-file deletion.
- Use Vacuum + mop for Microsoft Defender custom scans, with actual completion/error results and a blue companion trail.
- Enable daily autoclean and optional Windows startup in Settings.

REA investigation of shipped FluentCleaner and BleachBit artifacts is included in `research/`. Original cleaning rules and implementation; no third-party cleaner database is bundled.

21 fixture/helper tests and native UI integration passed, including real recycling of a synthetic fixture and real Defender scans of isolated test folders. This initial Windows x64 installer is unsigned. Automatic cleaning and startup are off until enabled. Daily cleaning runs while Vacuum is open in the tray; the bin never empties automatically.
