import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Power,
  Droplets,
  Wind,
  Sun,
  Moon,
  Minus,
  X,
  Settings2,
  ArrowUpRight,
  ArrowLeft,
  Check,
  Clock3,
  House,
  ChevronRight,
  Trash2,
  ShieldCheck,
  FolderClock,
  RotateCcw,
  Info,
} from "lucide-react";
import RobotScene from "./RobotScene";
import TaskbarCompanion from "./TaskbarCompanion";
import FileReview from "./FileReview";
import { formatSize as bytes } from "./format-size.mjs";
import "./style.css";
import "./studio.css";

const initial = {
  phase: "docked",
  message: "Ready to clean.",
  bin: { files: [], bytes: 0, count: 0 },
  settings: {
    theme: "dark",
    wet: false,
    auto: false,
    hour: "10:00",
    companion: true,
    startup: false,
  },
  lastRun: null,
  wetResult: null,
};
// Browser previews are explicitly disconnected and cannot touch local files.
const preview = {
  get: async () => initial,
  settings: async (p) => {
    initial.settings = { ...initial.settings, ...p };
    return initial.settings;
  },
  subscribe: () => () => {},
  onDock: () => () => {},
  window: () => {},
  security: () => {},
  start: async () => {
    throw new Error("Open the Windows app to clean this computer.");
  },
  old: async () => {
    throw new Error("Open the Windows app to review your Downloads.");
  },
};
const api = window.vacuum || preview;
function Toggle({ checked, onChange, label }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Companion() {
  const [s, setS] = useState(initial),
    [docking, setDocking] = useState(false);
  useEffect(() => {
    api.get().then(setS);
    const off = api.subscribe((next) => {
        setS((previous) => ({ ...previous, ...next }));
        if (["departing", "cleaning", "wet"].includes(next.phase))
          setDocking(false);
      }),
      offDock = api.onDock(() => setDocking(true));
    return () => {
      off();
      offDock();
    };
  }, []);
  return (
    <div
      className={`companion ${s.settings.theme} ${docking ? "docking" : ""}`}
    >
      <TaskbarCompanion theme={s.settings.theme} phase={s.phase} />
    </div>
  );
}
function App() {
  const [s, setS] = useState(initial),
    [panel, setPanel] = useState(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [old, setOld] = useState(null),
    [selected, setSelected] = useState(new Set()),
    [confirm, setConfirm] = useState(false),
    [skipped, setSkipped] = useState([]);
  const active = ["departing", "cleaning", "wet", "returning"].includes(
      s.phase,
    ),
    busy = active || ["emptying", "compacting"].includes(s.phase),
    dark = s.settings.theme === "dark";
  useEffect(() => {
    api
      .get()
      .then((next) => {
        setS(next);
        if (next.startupError) setError(next.startupError);
      })
      .catch((e) => setError(e.message));
    return api.subscribe((next) =>
      setS((previous) => ({ ...previous, ...next })),
    );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = s.settings.theme;
  }, [s.settings.theme]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") {
        setPanel(null);
        setConfirm(false);
      }
      if (e.key === "Tab") {
        const items = [
          ...document.querySelectorAll(
            ".sheet button:not(:disabled), .sheet input:not(:disabled), .sheet summary",
          ),
        ].filter((el) => el.getClientRects().length);
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  async function run(fn) {
    setError("");
    setWorking(true);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  async function change(p) {
    const previous = s.settings;
    setS((v) => ({ ...v, settings: { ...v.settings, ...p } }));
    await run(async () => {
      try {
        const settings = await api.settings(p);
        setS((v) => ({ ...v, settings }));
      } catch (error) {
        setS((v) => ({ ...v, settings: previous }));
        throw error;
      }
    });
  }
  function start() {
    run(() => (active ? api.stop() : api.start()));
  }
  async function openPanel(name) {
    setPanel(name);
    setConfirm(false);
    setSkipped([]);
    setSelected(new Set());
    if (name === "bin") setSelected(new Set(s.bin.files.map((f) => f.id)));
    if (name === "old") {
      setOld(null);
      const result = await run(() => api.old());
      if (result) setOld(result);
    }
  }
  const choose = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const oldFiles = Array.isArray(old) ? old : old?.files || [];
  const files = panel === "old" ? oldFiles : s.bin.files;
  return (
    <div
      className={`app ${active ? "is-cleaning" : ""} ${s.settings.wet ? "wet-mode" : ""}`}
    >
      <header className="titlebar" inert={!!panel}>
        <div className="wordmark">
          <span className="brand-symbol" />
          <span>vacuum</span>
          <small>Computer care</small>
        </div>
        <div className="window-actions">
          <span className="connection">
            <i />
            {window.vacuum ? "Station connected" : "Browser preview"}
          </span>
          <button
            className="icon-button"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => change({ theme: dark ? "light" : "dark" })}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => openPanel("settings")}
          >
            <Settings2 size={17} />
          </button>
          <span className="window-divider" />
          <button
            className="icon-button"
            aria-label="Minimize"
            onClick={() => api.window("minimize")}
          >
            <Minus size={17} />
          </button>
          <button
            className="icon-button close-button"
            aria-label="Close to tray"
            onClick={() => api.window("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <main inert={!!panel}>
        <div className="topline">
          <span className="eyebrow">
            THE STATION <span>/</span> 01
          </span>
          <span className="hardware-name">
            VACUUM ONE <span>·</span> {dark ? "GRAPHITE" : "PORCELAIN"}
          </span>
        </div>
        <section className="robot-stage" aria-label="Vacuum controls">
          <div className="stage-readout">
            <div className={`status-pill ${active ? "running" : ""}`}>
              <i />
              {s.phase === "departing"
                ? "LEAVING THE STATION"
                : s.phase === "returning"
                  ? "COMING HOME"
                  : s.phase === "wet"
                    ? "Security scan"
                    : s.phase === "cleaning"
                      ? "Cleaning"
                      : s.phase === "compacting"
                        ? "Saving space"
                        : s.phase === "emptying"
                          ? "Emptying the bin"
                          : "Docked"}
            </div>
            <h1>
              {s.phase === "returning"
                ? "Returning to the dock"
                : active
                  ? "Cleaning"
                  : panel === "bin"
                    ? "Dust bin"
                    : "Ready to clean"}
            </h1>
            <p>
              {active
                ? s.message
                : "Press power to start.\nDrag to rotate the vacuum."}
            </p>
          </div>
          <div className="floor-rings">
            <i />
            <i />
            <i />
          </div>
          <RobotScene
            theme={s.settings.theme}
            wet={s.settings.wet}
            phase={s.phase}
            active={active}
            binOpen={panel === "bin"}
            binCount={s.bin.count}
            auto={s.settings.auto}
            disabled={
              working ||
              ["emptying", "compacting"].includes(s.phase) ||
              s.phase === "returning" ||
              !!s.startupError
            }
            onAction={(action) => {
              if (action === "power") start();
              if (action === "bin" && !busy) openPanel("bin");
              if (action === "mop" && !busy) change({ wet: !s.settings.wet });
              if (action === "auto" && !busy)
                change({ auto: !s.settings.auto });
              if (action === "dock" || action === "station") {
                if (active) run(() => api.stop());
                else if (action === "station") openPanel("settings");
              }
            }}
          />
          <span className="material-signature">
            <i />
            {dark
              ? "Graphite / anodized finish"
              : "Porcelain / soft ceramic finish"}
          </span>
          <span className="inspect-hint">
            Drag to rotate <span>·</span> Press a control
          </span>
          {active && (
            <div className="round-readout">
              <span>
                {s.progress?.visited?.toLocaleString() || "0"}
                <small>files checked</small>
              </span>
              <span>
                {s.progress?.found?.toLocaleString() || "0"}
                <small>files collected</small>
              </span>
            </div>
          )}
        </section>
        <section className="station-strip">
          <button
            className="station-detail bin-detail"
            aria-label="Review collected files"
            onClick={() => openPanel("bin")}
          >
            <span className="strip-symbol">
              <Trash2 size={20} />
            </span>
            <span className="bin-copy">
              <small>Dust bin</small>
              <strong>{s.bin.count ? bytes(s.bin.bytes) : "Empty"}</strong>
              <em>
                {s.bin.count
                  ? `${s.bin.count} ${s.bin.count === 1 ? "file" : "files"} collected · waiting to empty`
                  : "Collected files wait for you here"}
              </em>
            </span>
            <ChevronRight size={14} />
          </button>
          <button
            className="station-detail"
            onClick={() => openPanel("settings")}
            aria-label="Daily cleaning settings"
          >
            <span className="strip-symbol">
              <Clock3 size={20} />
            </span>
            <span>
              <small>Daily scan</small>
              <strong>
                {s.settings.auto ? `Every day · ${s.settings.hour}` : "Off"}
              </strong>
              <em>
                {s.settings.auto
                  ? "Returns here after each round"
                  : "Press the clock on your vacuum to enable"}
              </em>
            </span>
          </button>
          <button
            className="station-detail"
            onClick={() => openPanel("old")}
            aria-label="Forgotten files"
          >
            <span className="strip-symbol">
              <FolderClock size={20} />
            </span>
            <span>
              <small>Downloads</small>
              <strong>Review Downloads</strong>
              <em>Old Downloads, chosen by you</em>
            </span>
            <ArrowUpRight size={14} />
          </button>
        </section>
        <div className="storage-line">
          <button
            className="text-button"
            aria-label="Refresh drive free space"
            disabled={!window.vacuum}
            onClick={() => run(() => api.storage())}
          >
            {s.storage?.available
              ? `${bytes(s.storage.freeBytes)} available on ${s.storage.volume}`
              : "Drive free space unavailable"}
            <RotateCcw size={11} />
          </button>
          <span>
            Recycling keeps files recoverable; it does not empty Windows Recycle
            Bin.
          </span>
        </div>
        <footer>
          <span className="live-message" role="status">
            <i className={active ? "pulse" : ""} />
            {s.message}
          </span>
          <span className="footer-meta">
            {s.lastEmpty?.trashed
              ? `${s.lastEmpty.trashed} ${s.lastEmpty.trashed === 1 ? "FILE" : "FILES"} RECYCLED · ${bytes(s.lastEmpty.bytes)}`
              : s.lastRun
                ? `LAST ROUND ${new Date(s.lastRun).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                : "Files stay in place until you empty the bin"}
          </span>
        </footer>
        {s.wetResult && (
          <button
            className={`security-result ${s.wetResult.status === "clear" ? "clear" : ""}`}
            onClick={() => openPanel("security")}
          >
            <ShieldCheck size={15} />
            {s.wetResult.status === "clear"
              ? "Wet scan finished"
              : "Wet scan needs attention"}
            <ChevronRight size={14} />
          </button>
        )}
        {(s.coverage?.limited || s.coverage?.errors > 0) && (
          <p className="coverage-note">
            {s.coverage.limited
              ? "This round reached its scan limit. Review the bin, then run another round."
              : `Partial round: ${s.coverage.errors} locations could not be read.`}
          </p>
        )}
        {!!s.coverage?.protectedBrowsers?.length && (
          <p className="coverage-note browser-coverage" role="status">
            {s.coverage.protectedBrowsers.map((item) => item.reason).join(" ")}
          </p>
        )}
      </main>
      {error && (
        <div className="toast" role="alert">
          <Info size={17} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {panel && (
        <div
          className="sheet-backdrop"
          onClick={() => {
            setPanel(null);
            setConfirm(false);
          }}
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <button
                className="icon-button"
                aria-label="Back to station"
                autoFocus
                onClick={() => {
                  setPanel(null);
                  setConfirm(false);
                }}
              >
                <ArrowLeft size={20} />
              </button>
              <span className="eyebrow">THE STATION</span>
              <button
                className="icon-button"
                aria-label="Close panel"
                onClick={() => setPanel(null)}
              >
                <X size={19} />
              </button>
            </div>
            <h2 id="sheet-title">
              {panel === "settings"
                ? "Settings"
                : panel === "old"
                  ? "Old Downloads"
                  : panel === "security"
                    ? "Security scan"
                    : "Dust bin"}
            </h2>
            {panel === "settings" ? (
              <div className="settings-content">
                <p className="sheet-intro">
                  Choose when Vacuum runs and how it appears.
                </p>
                <div className="setting-row">
                  <div>
                    <h3>Daily autoclean</h3>
                    <p>
                      Scan once a day. Review collected files before recycling.
                    </p>
                  </div>
                  <Toggle
                    label="Enable daily autoclean"
                    checked={s.settings.auto}
                    onChange={(auto) => change({ auto })}
                  />
                </div>
                <label className="time-setting">
                  Daily scan time
                  <input
                    type="time"
                    value={s.settings.hour}
                    onChange={(e) => change({ hour: e.target.value })}
                  />
                </label>
                <div className="setting-row">
                  <div>
                    <h3>Start with Windows</h3>
                    <p>Wait quietly in the system tray after sign-in.</p>
                  </div>
                  <Toggle
                    label="Start with Windows"
                    checked={s.settings.startup}
                    onChange={(startup) => change({ startup })}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <h3>Desktop companion</h3>
                    <p>Small looping passes in the taskbar, left of Start.</p>
                  </div>
                  <Toggle
                    label="Desktop companion"
                    checked={s.settings.companion}
                    onChange={(companion) => change({ companion })}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <h3>{dark ? "Graphite" : "Porcelain"}</h3>
                    <p>Your theme changes your robot, too.</p>
                  </div>
                  <button
                    className="outline-button"
                    onClick={() => change({ theme: dark ? "light" : "dark" })}
                  >
                    {dark ? <Sun size={16} /> : <Moon size={16} />}{" "}
                    {dark ? "Go light" : "Go dark"}
                  </button>
                </div>
                <div className="quiet-info">
                  <Info size={17} />
                  <p>
                    Daily rounds run while Vacuum is open in the tray. A missed
                    round runs when the app next opens or your computer wakes.
                    Enable “Start with Windows” for a daily routine.
                  </p>
                </div>
                <div className="rules">
                  <span className="eyebrow">Scan rules</span>
                  <p>
                    Temporary .tmp, .temp and .log files older than 7 days.
                    Crash dumps older than 30 days. Chrome and Edge network and
                    code caches older than 7 days, while the browser is closed.
                    Cookies, logins, sessions, extensions and site storage stay
                    untouched. Personal folders are excluded from daily scans.
                  </p>
                </div>
              </div>
            ) : panel === "security" ? (
              <div className="security-content">
                <div className="security-orb">
                  <Droplets size={42} />
                </div>
                <h3>
                  {s.wetResult?.status === "clear"
                    ? "Scan complete"
                    : "Scan status"}
                </h3>
                <p>
                  {s.wetResult?.message ||
                    "Choose Vacuum + mop to add a Defender scan to your next round."}
                </p>
                <p className="muted">
                  Vacuum requests a scan without remediation. Windows real-time
                  protection keeps its own settings. Scan coverage is limited to
                  temporary files and Downloads; this is not a full-device
                  security assessment.
                </p>
                <button
                  className="outline-button"
                  onClick={() => api.security()}
                >
                  Open Windows Security
                  <ArrowUpRight size={16} />
                </button>
                {s.wetResult?.details && (
                  <details>
                    <summary>Defender report</summary>
                    <pre>{s.wetResult.details}</pre>
                  </details>
                )}
              </div>
            ) : (
              <>
                <p className="sheet-intro">
                  {panel === "old"
                    ? "Downloads untouched for at least 180 days. Age is a hint, never a reason to delete. Choose only what you no longer need."
                    : "Collected means set aside in this list. Your files stay where they are until you empty the bin."}
                </p>
                {panel === "bin" &&
                  (s.recovery?.pending ||
                    s.recovery?.recovered > 0 ||
                    s.recovery?.needsReview > 0) && (
                    <div
                      className="recycling-receipt recovery-receipt"
                      role="status"
                    >
                      <strong>
                        {s.recovery.pending
                          ? "Interrupted pass needs verification"
                          : "Interrupted pass checked"}
                      </strong>
                      <p>
                        {s.recovery.error ||
                          `${s.recovery.recovered} ${s.recovery.recovered === 1 ? "file" : "files"} verified. ${s.recovery.needsReview ? `${s.recovery.needsReview} ${s.recovery.needsReview === 1 ? "file is" : "files are"} protected for review.` : "File contents remain in place."}`}
                      </p>
                      {s.recovery.pending && (
                        <button
                          className="outline-button"
                          disabled={working || busy}
                          onClick={() => run(() => api.recoverCompression())}
                        >
                          Verify interrupted pass
                        </button>
                      )}
                    </div>
                  )}
                {panel === "bin" && s.lastEmpty && (
                  <div className="recycling-receipt" role="status">
                    <strong>
                      {s.lastEmpty.trashed}{" "}
                      {s.lastEmpty.trashed === 1 ? "file" : "files"} sent to
                      Windows Recycle Bin · {bytes(s.lastEmpty.bytes)}
                    </strong>
                    <p>
                      Recoverable files still use drive space.{" "}
                      {s.lastEmpty.storage?.after?.available
                        ? `${bytes(s.lastEmpty.storage.after.freeBytes)} was available after this round.`
                        : ""}
                    </p>
                    <button
                      className="outline-button"
                      onClick={() => run(() => api.recycleBin())}
                    >
                      Open Recycle Bin to restore files
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
                {panel === "bin" && s.lastCompaction && (
                  <div
                    className="recycling-receipt compaction-receipt"
                    role="status"
                  >
                    <strong>
                      {s.lastCompaction.compress
                        ? `${bytes(s.lastCompaction.bytesSaved)} of file allocation saved`
                        : s.lastCompaction.changed
                          ? "Compression undone"
                          : "No compression changed"}
                    </strong>
                    <p>
                      {s.lastCompaction.verifiedFiles}{" "}
                      {s.lastCompaction.verifiedFiles === 1 ? "file" : "files"}{" "}
                      verified. Their contents remain in place. This is measured
                      file allocation, separate from background drive-space
                      changes.
                    </p>
                  </div>
                )}
                {panel === "old" && !old ? (
                  <div className="empty-bin">
                    <FolderClock size={40} />
                    <h3>
                      {working
                        ? "Looking through Downloads…"
                        : "Downloads are unavailable."}
                    </h3>
                  </div>
                ) : !files.length ? (
                  <div className="empty-bin">
                    <div className="empty-bin-icon">
                      {panel === "old" ? (
                        <FolderClock size={42} />
                      ) : (
                        <Wind size={42} />
                      )}
                    </div>
                    <h3>
                      {panel === "old"
                        ? "No old Downloads found"
                        : "The bin is empty"}
                    </h3>
                    <p>
                      {panel === "old"
                        ? "No old Downloads found in this round."
                        : "Start a scan to collect temporary files for review."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="file-summary">
                      <span>
                        {files.length.toLocaleString()}{" "}
                        {files.length === 1 ? "file" : "files"} ·{" "}
                        {bytes(files.reduce((n, f) => n + f.size, 0))}
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setSelected(
                            selected.size === files.length
                              ? new Set()
                              : new Set(files.map((f) => f.id)),
                          )
                        }
                      >
                        {selected.size === files.length
                          ? "Deselect all"
                          : `Select all ${files.length.toLocaleString()}`}
                      </button>
                    </div>
                    <FileReview
                      key={panel}
                      files={files}
                      selected={selected}
                      choose={choose}
                      skipped={skipped}
                      formatSize={bytes}
                    />
                    {panel === "bin" && (
                      <div className="compaction-actions">
                        <p>
                          Windows can losslessly compress selected files on
                          NTFS. Up to 64 files per pass. Files stay in place;
                          results depend on their contents.
                        </p>
                        <div>
                          <button
                            className="outline-button"
                            disabled={
                              !selected.size ||
                              selected.size > 64 ||
                              working ||
                              busy
                            }
                            onClick={() =>
                              run(async () => {
                                const result = await api.compact(
                                  [...selected],
                                  true,
                                );
                                setSkipped(result.skipped || []);
                              })
                            }
                          >
                            Save space reversibly
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              !files.some(
                                (f) => selected.has(f.id) && f.compacted,
                              ) ||
                              working ||
                              busy
                            }
                            onClick={() =>
                              run(async () => {
                                const result = await api.compact(
                                  files
                                    .filter(
                                      (f) => selected.has(f.id) && f.compacted,
                                    )
                                    .map((f) => f.id),
                                  false,
                                );
                                setSkipped(result.skipped || []);
                              })
                            }
                          >
                            Undo compression
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="sheet-bottom">
                      {panel === "old" ? (
                        <button
                          className="start-button"
                          disabled={!selected.size || working || busy}
                          onClick={() =>
                            run(async () => {
                              await api.collect([...selected]);
                              setPanel("bin");
                              const next = await api.get();
                              setS(next);
                              setSelected(
                                new Set(next.bin.files.map((f) => f.id)),
                              );
                            })
                          }
                        >
                          <Check size={18} />
                          Add {selected.size} to dust bin
                        </button>
                      ) : confirm ? (
                        <div className="confirm-empty">
                          <p>
                            Send {selected.size} selected files to Windows
                            Recycle Bin?
                          </p>
                          <small>
                            Changed files are skipped. You can restore recycled
                            files through Windows.
                          </small>
                          <div>
                            <button
                              className="text-button"
                              onClick={() => setConfirm(false)}
                            >
                              Keep them here
                            </button>
                            <button
                              className="start-button"
                              disabled={working || busy}
                              onClick={() =>
                                run(async () => {
                                  const result = await api.empty([...selected]);
                                  setSkipped(result.skipped || []);
                                  setConfirm(false);
                                  setSelected(new Set());
                                })
                              }
                            >
                              <Trash2 size={17} />
                              {working ? "Emptying…" : "Send to Recycle Bin"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            className="text-button"
                            disabled={!selected.size || working || busy}
                            onClick={() =>
                              run(async () => {
                                await api.release([...selected]);
                                setSelected(new Set());
                              })
                            }
                          >
                            <RotateCcw size={15} />
                            Leave files alone
                          </button>
                          <button
                            className="start-button"
                            disabled={!selected.size || working || busy}
                            onClick={() => setConfirm(true)}
                          >
                            <Trash2 size={17} />
                            Empty selected · {selected.size}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
                {old?.coverage?.limited && (
                  <p className="muted">
                    Partial review: the scan limit was reached.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  location.hash === "#companion" ? <Companion /> : <App />,
);
