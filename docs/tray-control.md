# System tray control — 0.3.1

Click the Vacuum icon beside the Windows clock for its native menu. Windows may place the icon under the hidden-icons arrow. Right-click also opens the context menu; double-click opens/restores the station.

The menu can start cleaning and recall the robot while the station stays hidden. It shows the current status and bin count. Wet cleaning, daily autoclean, taskbar companion, Windows startup and graphite/porcelain colour use the same saved settings as the station. Bin review, old Downloads, apps/ports and Settings open directly at the correct view. Emptying is always reviewed and confirmed in the bin, and busy file operations disable conflicting actions.

Validation: 74 passing tests plus installed-app tray, interactive UI and keyboard checks. `node scripts/verify-tray.cjs` uses an isolated retained file and the real Electron Tray/MenuItem objects to exercise hidden cleaning/recall, persisted modes, view routing, busy guards and restoration of a minimized station. It captures the popup request rather than clicking Windows notification-area coordinates. No fixture is permanently removed. `docs/tray-proof.json` records its result. The update from 0.3.0 retained and hash-verified all 76 previous installed files before/after installation, with an application-data backup retained locally.
