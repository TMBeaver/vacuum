import { useEffect, useState } from "react";
import { ArrowUpRight, X, ArrowLeft, Droplets } from "lucide-react";
import RobotScene from "./RobotScene";
import FileReview from "./FileReview";
import EmptyProgress from "./EmptyProgress";
import TrayMenu from "./TrayMenu";
import { formatSize } from "./format-size.mjs";
import "./tray-robot.css";

export default function TrayRobot({ api, initial }) {
  const [state, setState] = useState(initial);
  const [binOpen, setBinOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const active = ["departing", "cleaning", "wet"].includes(state.phase);
  const busy = state.phase !== "docked";
  useEffect(() => {
    api
      .get()
      .then(setState)
      .catch((e) => setError(e.message));
    return api.subscribe((next) =>
      setState((previous) => ({ ...previous, ...next })),
    );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);
  useEffect(() => {
    if (state.trayMenuRequest) {
      setBinOpen(false);
      setConfirm(false);
      setMenuOpen(true);
    }
  }, [state.trayMenuRequest]);
  useEffect(() => {
    api.trayView?.(binOpen || menuOpen)?.catch((e) => setError(e.message));
    if (binOpen) document.querySelector(".tray-bin button")?.focus();
    const key = (event) => {
      if (event.key === "Escape") {
        if (binOpen) {
          setBinOpen(false);
          setConfirm(false);
        } else if (menuOpen) setMenuOpen(false);
        else api.window("hide-tray");
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [binOpen, menuOpen]);
  async function run(action) {
    setWorking(true);
    setError("");
    try {
      return await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  function action(name) {
    if (working) return;
    if (name === "power") run(() => (active ? api.stop() : api.start()));
    if (name === "dock") run(() => api.stop());
    if (name === "bin" && !busy) {
      setSelected(new Set(state.bin.files.map((file) => file.id)));
      setSkipped([]);
      setReceipt(null);
      setConfirm(false);
      setMenuOpen(false);
      setBinOpen(true);
    }
  }
  return (
    <div className={`tray-robot ${binOpen || menuOpen ? "has-bin" : ""}`}>
      <header className="tray-robot-header">
        <strong>vacuum</strong>
        <div>
          <button
            className="icon-button"
            aria-label="Vacuum menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setBinOpen(false);
              setConfirm(false);
              setMenuOpen(!menuOpen);
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          <button
            className="icon-button"
            aria-label={
              state.settings.wet
                ? "Disable wet cleaning"
                : "Enable wet cleaning"
            }
            aria-pressed={state.settings.wet}
            disabled={busy || working}
            onClick={() =>
              run(() => api.settings({ wet: !state.settings.wet }))
            }
          >
            <Droplets size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Open full station"
            onClick={() => api.panel(null)}
          >
            <ArrowUpRight size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Hide robot"
            onClick={() => api.window("hide-tray")}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <section className="tray-robot-stage" aria-label="Tray vacuum controls">
        <RobotScene
          compact
          theme={state.settings.theme}
          wet={state.settings.wet}
          phase={state.phase}
          active={active}
          binCount={state.bin.count}
          binOpen={binOpen}
          auto={state.settings.auto}
          disabled={
            working || binOpen || (!active && busy) || !!state.startupError
          }
          onAction={action}
        />
      </section>
      <footer className="tray-robot-footer">
        <span>
          {state.bin.count} {state.bin.count === 1 ? "file" : "files"} ·{" "}
          {formatSize(state.bin.bytes)}
        </span>
        <span>Drag to rotate</span>
      </footer>
      {(error || state.startupError) && (
        <p className="tray-robot-error" role="alert">
          {error || state.startupError}
        </p>
      )}
      {menuOpen && (
        <TrayMenu
          state={state}
          working={working}
          onAction={(id) => run(() => api.trayAction(id))}
          onBin={() => action("bin")}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {binOpen && (
        <section
          className="tray-bin"
          role="dialog"
          aria-modal="false"
          aria-label="Dust bin"
        >
          <div className="tray-bin-heading">
            <h2>Dust bin</h2>
            <button
              className="text-button"
              disabled={busy || working || !state.bin.count}
              onClick={() => {
                setConfirm(false);
                setSelected(
                  selected.size === state.bin.count
                    ? new Set()
                    : new Set(state.bin.files.map((file) => file.id)),
                );
              }}
            >
              {selected.size === state.bin.count
                ? "Deselect all"
                : "Select all"}
            </button>
            <button
              className="icon-button"
              aria-label="Back to robot"
              onClick={() => {
                setBinOpen(false);
                setConfirm(false);
              }}
            >
              <ArrowLeft size={17} />
            </button>
          </div>
          {state.bin.count ? (
            <>
              <fieldset className="tray-bin-files" disabled={busy || working}>
                <FileReview
                  files={state.bin.files}
                  selected={selected}
                  choose={(id) => {
                    setConfirm(false);
                    setSelected((previous) => {
                      const next = new Set(previous);
                      next.has(id) ? next.delete(id) : next.add(id);
                      return next;
                    });
                  }}
                  skipped={skipped}
                  formatSize={formatSize}
                />
              </fieldset>
              <div className="tray-bin-actions">
                {state.phase === "emptying" ? (
                  <EmptyProgress progress={state.emptyProgress} />
                ) : (
                  confirm && (
                    <p className="tray-bin-confirm">
                      Send {selected.size} selected{" "}
                      {selected.size === 1 ? "file" : "files"} to Windows
                      Recycle Bin?
                    </p>
                  )
                )}
                {receipt && !confirm && state.phase !== "emptying" && (
                  <p className="tray-bin-receipt" role="status">
                    {receipt.recycled.toLocaleString()} recycled ·{" "}
                    {receipt.skipped.toLocaleString()} skipped
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={busy || working || !selected.size}
                  onClick={() => {
                    if (!confirm) {
                      setConfirm(true);
                      return;
                    }
                    run(async () => {
                      const result = await api.empty([...selected]);
                      setSkipped(result.skipped);
                      setSelected(
                        new Set(result.skipped.map((item) => item.id)),
                      );
                      setReceipt({
                        recycled: result.trashed,
                        skipped: result.skipped.length,
                      });
                      setState(await api.get());
                      setConfirm(false);
                    });
                  }}
                >
                  {working || state.phase === "emptying"
                    ? "Emptying…"
                    : confirm
                      ? "Send to Recycle Bin"
                      : `Empty selected · ${selected.size}`}
                </button>
              </div>
            </>
          ) : (
            <p className="tray-bin-empty">
              The bin is empty. Files stay in place until you empty it.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
