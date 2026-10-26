import { useEffect, useRef } from "react";
import { formatSize } from "./format-size.mjs";
import "./tray-menu.css";

function Symbol({ name }) {
  const paths = {
    clean: (
      <>
        <path d="M12 3v8" />
        <path d="M7 5.5a8 8 0 1 0 10 0" />
      </>
    ),
    bin: (
      <>
        <path d="M5 7h14l-1 13H6L5 7Zm-1 0h16M9 7V4h6v3M10 11v5m4-5v5" />
      </>
    ),
    old: (
      <>
        <path d="M3 7V5h7l2 3h9v11H3V7Z" />
        <path d="M12 11v3l2 1" />
      </>
    ),
    performance: (
      <>
        <path d="M4 18a9 9 0 1 1 16 0M12 13l4-5M6 13H4m16 0h-2M8 6 7 4" />
        <circle cx="12" cy="14" r="2" />
      </>
    ),
    wet: (
      <path d="M12 3S5 10 5 15a7 7 0 0 0 14 0c0-5-7-12-7-12Zm-3 12a3 3 0 0 0 3 3" />
    ),
    auto: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="3" />
        <path d="M8 3v4m8-4v4M4 10h16m-12 5h3v3" />
      </>
    ),
    companion: (
      <>
        <rect x="3" y="4" width="18" height="15" rx="2" />
        <path d="M3 15h18m-12 7h6m-3-3v3" />
      </>
    ),
    startup: (
      <>
        <path d="M4 5h7v7H4Zm9 0h7v7h-7ZM4 14h7v7H4Zm9 0h7v7h-7Z" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    station: (
      <>
        <path d="m5 12 7-7 7 7M7 10v10h10V10M10 20v-6h4v6" />
      </>
    ),
    quit: (
      <>
        <path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h13" />
      </>
    ),
    back: <path d="m14 6-6 6 6 6" />,
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export default function TrayMenu({ state, working, onAction, onBin, onClose }) {
  const root = useRef(null);
  useEffect(() => {
    root.current?.querySelector("button:not(:disabled)")?.focus();
    return () => document.querySelector('[aria-label="Vacuum menu"]')?.focus();
  }, []);
  const get = (id) => state.trayActions?.find((item) => item.id === id);
  const disabled = (id) => working || !get(id) || get(id).enabled === false;
  const running = ["departing", "cleaning", "wet"].includes(state.phase);
  const toggle = (id, label, detail) => (
    <button
      className="tray-menu-row tray-menu-option"
      role="switch"
      aria-checked={!!get(id)?.checked}
      aria-label={label}
      disabled={disabled(id)}
      onClick={() => onAction(id)}
    >
      <Symbol name={id} />
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <span className="tray-menu-switch" aria-hidden="true">
        <i />
      </span>
    </button>
  );
  return (
    <section className="tray-menu" aria-label="Vacuum controls" ref={root}>
      <div className="tray-menu-heading">
        <h2>Controls</h2>
        <button
          className="tray-menu-back"
          aria-label="Back to robot"
          onClick={onClose}
        >
          <Symbol name="back" />
        </button>
      </div>
      <div className="tray-menu-body">
        <button
          className={`tray-menu-power ${running ? "is-running" : ""}`}
          disabled={disabled("clean")}
          onClick={() => onAction("clean")}
        >
          <span className="tray-menu-power-disc">
            <Symbol name="clean" />
          </span>
          <span>
            <strong>{get("clean")?.label || "Start cleaning"}</strong>
            <small>
              {state.phase === "docked"
                ? state.settings.wet
                  ? "Dust + Defender scan"
                  : "Dust collection"
                : state.message}
            </small>
          </span>
        </button>
        <nav className="tray-menu-links" aria-label="Review">
          <button
            className="tray-menu-row"
            disabled={disabled("bin")}
            onClick={onBin}
          >
            <Symbol name="bin" />
            <span>Dust bin</span>
            <small>{formatSize(state.bin.bytes)}</small>
            <span className="tray-menu-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
          <button
            className="tray-menu-row"
            disabled={disabled("old")}
            onClick={() => onAction("old")}
          >
            <Symbol name="old" />
            <span>Old Downloads</span>
            <span className="tray-menu-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
          <button
            className="tray-menu-row"
            disabled={disabled("performance")}
            onClick={() => onAction("performance")}
          >
            <Symbol name="performance" />
            <span>Apps & ports</span>
            <span className="tray-menu-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </nav>
        <div className="tray-menu-modes">
          {toggle("wet", "Wet cleaning")}
          {toggle("auto", "Daily autoclean", state.settings.hour)}
          {toggle("companion", "Taskbar robot")}
          {toggle("startup", "Start with Windows")}
        </div>
        <div
          className="tray-menu-colours"
          role="group"
          aria-label="Robot colour"
        >
          <span>Finish</span>
          {[
            ["dark", "Graphite"],
            ["light", "Porcelain"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-label={label}
              aria-pressed={state.settings.theme === id}
              disabled={disabled(id)}
              onClick={() => onAction(id)}
            >
              <i className={`tray-menu-swatch ${id}`} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <footer className="tray-menu-footer">
        <button
          aria-label="Settings"
          disabled={disabled("settings")}
          onClick={() => onAction("settings")}
        >
          <Symbol name="settings" />
          Settings
        </button>
        <button
          aria-label="Open station"
          disabled={disabled("station")}
          onClick={() => onAction("station")}
        >
          <Symbol name="station" />
        </button>
        <button
          className="tray-menu-quit"
          disabled={disabled("quit")}
          onClick={() => onAction("quit")}
        >
          <Symbol name="quit" />
          Quit Vacuum
        </button>
      </footer>
    </section>
  );
}
