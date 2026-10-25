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
import "./style.css";

const initial = {
  phase: "docked",
  message: "Ready for a fresh start.",
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
export const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;
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
        setS(next);
        if (["cleaning", "wet"].includes(next.phase)) setDocking(false);
      }),
      offDock = api.onDock(() => setDocking(true));
    return () => {
      off();
      offDock();
    };
  }, []);
  return (
    <button
      onClick={() => api.window("show")}
      title="Open Vacuum station"
      aria-label="Open Vacuum station"
      className={`companion ${s.settings.theme} ${s.phase === "wet" ? "wet" : ""} ${docking ? "docking" : ""}`}
    >
      <div className="mini-station" />
      <div className="rover">
        <i className="dust-trail" />
        <div className="mini-robot">
          <i />
          <span />
        </div>
      </div>
      <span className="companion-caption">
        {docking
          ? "Heading home"
          : s.phase === "wet"
            ? "Wet cleaning"
            : "Tidying up"}
      </span>
    </button>
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
  const active = ["cleaning", "wet"].includes(s.phase),
    busy = active || s.phase === "emptying",
    dark = s.settings.theme === "dark";
  useEffect(() => {
    api
      .get()
      .then((next) => {
        setS(next);
        if (next.startupError) setError(next.startupError);
      })
      .catch((e) => setError(e.message));
    return api.subscribe(setS);
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
    await run(async () => {
      const settings = await api.settings(p);
      setS((v) => ({ ...v, settings }));
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
          <small>YOUR COMPUTER, A LITTLE CLEANER.</small>
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
        <section className="living-room">
          <div className="scene-copy">
            <div className={`status-pill ${active ? "running" : ""}`}>
              <i />
              {active
                ? s.phase === "wet"
                  ? "WET CLEANING"
                  : "OUT CLEANING"
                : "AT THE DOCK"}
            </div>
            <h1>
              {active ? (
                <>
                  A little work.
                  <br />A lighter computer.
                </>
              ) : (
                <>
                  Less clutter.
                  <br />
                  More breathing room.
                </>
              )}
            </h1>
            <p>
              {active
                ? "Your little helper is on its rounds. You can carry on with your day."
                : "Meet your computer’s quiet little helper.\nReady for a fresh start whenever you are."}
            </p>
          </div>
          <div className={`scene-wrap ${active ? "moving" : ""}`}>
            <div className="floor-rings">
              <i />
              <i />
              <i />
            </div>
            <RobotScene
              theme={s.settings.theme}
              wet={s.settings.wet}
              active={active}
              onStart={start}
            />
            <span className="dock-label">
              <House size={12} />
              {active ? "STATION ON STANDBY" : "HOME, SWEET HOME"}
            </span>
            <div className="finish-label">
              <i />
              {dark ? "Anodized graphite" : "Soft porcelain"}
              <span>01 / {dark ? "DARK" : "LIGHT"}</span>
            </div>
          </div>
          <aside className="controls">
            <div className="control-heading">
              <span className="eyebrow">YOUR NEXT CLEAN</span>
              <span className="tiny-led" />
            </div>
            <h2>{active ? "Making the rounds." : "Good to go."}</h2>
            <p className="control-caption">
              {active
                ? "Looking after the little things."
                : "A fresh sweep, at your command."}
            </p>
            <div className="mode-picker" aria-label="Cleaning mode">
              <button
                disabled={busy}
                className={!s.settings.wet ? "selected" : ""}
                onClick={() => change({ wet: false })}
              >
                <Wind size={19} />
                <span>
                  Vacuum<small>Everyday clutter</small>
                </span>
                {!s.settings.wet && <Check size={14} />}
              </button>
              <button
                disabled={busy}
                className={s.settings.wet ? "selected" : ""}
                onClick={() => change({ wet: true })}
              >
                <Droplets size={19} />
                <span>
                  Vacuum + mop<small>Clutter & threat scan</small>
                </span>
                {s.settings.wet && <Check size={14} />}
              </button>
            </div>
            <button
              className={`start-button ${active ? "active" : ""}`}
              disabled={working || s.phase === "emptying" || !!s.startupError}
              onClick={start}
            >
              {active ? <House size={20} /> : <Power size={20} />}
              <span>{active ? "Return to dock" : "Start cleaning"}</span>
              <span className="key-hint" aria-hidden="true">
                ↗
              </span>
            </button>
            <p className="start-note">
              {s.settings.wet
                ? "Wet mode checks Temp & Downloads with Defender."
                : "Only known leftovers. Your personal files stay put."}
            </p>
            <div className="schedule">
              <div className="schedule-top">
                <Clock3 size={17} />
                <span>Daily autoclean</span>
                <Toggle
                  label="Daily autoclean"
                  checked={s.settings.auto}
                  onChange={(auto) => change({ auto })}
                />
              </div>
              <div className="schedule-bottom">
                <span>
                  {s.settings.auto
                    ? "A little tidy, every day at"
                    : "Ready when you need it"}
                </span>
                <button onClick={() => openPanel("settings")}>
                  {s.settings.hour}
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </aside>
        </section>
        <section className="bin-rail">
          <button
            className="bin-visual"
            aria-label="Open dust bin"
            onClick={() => openPanel("bin")}
          >
            <div className="bin-lid" />
            <div className="bin-container">
              <i className={s.bin.count ? "has-dust" : ""} />
              <span />
              <span />
              <span />
            </div>
          </button>
          <div className="bin-copy">
            <span className="eyebrow">THE DUST BIN</span>
            <h3>
              {s.bin.count
                ? `${bytes(s.bin.bytes)} tucked away.`
                : "A clean slate."}
            </h3>
            <p>
              {s.bin.count
                ? `${s.bin.count.toLocaleString()} ${s.bin.count === 1 ? "file" : "files"} collected. Nothing deleted yet.`
                : "Nothing collected yet. Let’s keep it that way."}
            </p>
          </div>
          <div className="bin-buttons">
            <button
              className="text-button old-button"
              onClick={() => openPanel("old")}
            >
              <FolderClock size={16} />
              Forgotten files
              <ArrowUpRight size={14} />
            </button>
            <button className="outline-button" onClick={() => openPanel("bin")}>
              Open dust bin
              <ChevronRight size={15} />
            </button>
          </div>
        </section>
        <footer>
          <span className="live-message" role="status">
            <i className={active ? "pulse" : ""} />
            {s.message}
          </span>
          <span className="footer-meta">
            {s.lastRun
              ? `LAST ROUND ${new Date(s.lastRun).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : "DESIGNED TO DO LESS. BETTER."}
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
                ? "Make yourself at home."
                : panel === "old"
                  ? "A little forgotten?"
                  : panel === "security"
                    ? "The wet clean."
                    : "A place for the leftovers."}
            </h2>
            {panel === "settings" ? (
              <div className="settings-content">
                <p className="sheet-intro">
                  Small routines. A quieter computer.
                </p>
                <div className="setting-row">
                  <div>
                    <h3>Daily autoclean</h3>
                    <p>Collect leftovers once a day. The bin waits for you.</p>
                  </div>
                  <Toggle
                    label="Enable daily autoclean"
                    checked={s.settings.auto}
                    onChange={(auto) => change({ auto })}
                  />
                </div>
                <label className="time-setting">
                  Time to tidy
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
                    <p>
                      A little robot travels above your taskbar while it cleans.
                    </p>
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
                  <span className="eyebrow">A CAREFUL LITTLE HELPER</span>
                  <p>
                    Temporary .tmp, .temp and .log files older than 7 days.
                    Crash dumps older than 30 days. No registry tweaks or
                    personal folders in automatic cleaning.
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
                    ? "A fresh pass."
                    : "Worth a closer look."}
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
                        ? "Nothing forgotten here."
                        : "Nothing to empty. Nice."}
                    </h3>
                    <p>
                      {panel === "old"
                        ? "No old Downloads found in this round."
                        : "Start a cleaning round and your leftovers will land here."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="file-summary">
                      <span>
                        {files.length.toLocaleString()} files ·{" "}
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
                          : "Select all"}
                      </button>
                    </div>
                    <div className="file-list">
                      {files.map((f) => (
                        <label key={f.id} className="file-row">
                          <input
                            type="checkbox"
                            checked={selected.has(f.id)}
                            onChange={() => choose(f.id)}
                          />
                          <div>
                            <strong>{f.name}</strong>
                            <small title={f.path}>{f.path}</small>
                            <span>
                              {skipped.find((item) => item.id === f.id)
                                ?.reason ||
                                f.reason ||
                                f.category}
                            </span>
                          </div>
                          <b>{bytes(f.size)}</b>
                        </label>
                      ))}
                    </div>
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
