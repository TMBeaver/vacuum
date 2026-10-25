import { useEffect, useState } from "react";
import { formatSize } from "./format-size.mjs";

export default function PerformanceReview({ api, disabled }) {
  const [review, setReview] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [confirm, setConfirm] = useState(null),
    [receipt, setReceipt] = useState(null),
    [limit, setLimit] = useState(20);
  async function refresh() {
    setLoading(true);
    setError("");
    setConfirm(null);
    try {
      setReview(await api.performance());
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  async function act(process, mode) {
    setLoading(true);
    setError("");
    setConfirm(null);
    try {
      const result = await api.performanceAction(process.id, mode);
      setReview(result.review);
      setReceipt(result);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }
  const needle = query.trim().toLowerCase();
  const matches =
    review?.processes.filter((process) =>
      `${process.name} ${process.pid} ${process.ports.map((port) => port.port).join(" ")}`
        .toLowerCase()
        .includes(needle),
    ) || [];
  return (
    <div className="performance-review">
      <p className="sheet-intro">
        Close apps you no longer need. Windows, services and Vacuum are
        protected.
      </p>
      <p className="performance-note">
        Ports belong to apps. Close the owning app to release its listeners. An
        open port alone is not a measure of performance.
      </p>
      {error && (
        <p className="performance-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="performance-loading" role="status">
          {review
            ? "Checking the selected action…"
            : "Reading apps, memory and network listeners…"}
        </p>
      )}
      {review && (
        <>
          <div className="performance-memory">
            <span>
              RAM available<strong>{formatSize(review.memoryAvailable)}</strong>
            </span>
            <span>
              Usable RAM<strong>{formatSize(review.memoryTotal)}</strong>
            </span>
            <button
              className="outline-button"
              disabled={loading || disabled}
              onClick={refresh}
            >
              Refresh
            </button>
          </div>
          {!review.networkAvailable && (
            <p className="performance-note" role="status">
              Port information is unavailable. No port closure will be claimed.
            </p>
          )}
          {receipt && (
            <div
              className="recycling-receipt performance-receipt"
              role="status"
            >
              <strong>
                {receipt.name}:{" "}
                {receipt.stillRunning ? "still running" : "process exited"}
              </strong>
              <p>
                {receipt.stillRunning
                  ? "A close request was sent. Check the app for a save prompt; some apps stay in the tray."
                  : `It used ${formatSize(receipt.previousMemoryBytes)} before closing.`}
              </p>
              {receipt.review.networkAvailable && (
                <p>
                  {receipt.releasedPorts.length}{" "}
                  {receipt.releasedPorts.length === 1
                    ? "listener is"
                    : "listeners are"}{" "}
                  no longer bound.
                </p>
              )}
            </div>
          )}
          <input
            className="file-search"
            type="search"
            aria-label="Find an app or port"
            placeholder="Find an app, process ID or port…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(20);
            }}
          />
          <div className="performance-processes">
            {matches.slice(0, limit).map((process) => (
              <div className="performance-process" key={process.id}>
                <div className="performance-process-heading">
                  <strong>{process.name}</strong>
                  <span>{formatSize(process.memoryBytes)}</span>
                </div>
                <p>
                  {process.cpuPercent.toFixed(2).replace(/\.?0+$/, "") || "0"}%
                  CPU · PID {process.pid} ·{" "}
                  {process.canClose ? "App window" : "Background process"}
                </p>
                {!!process.ports.length && (
                  <div className="performance-ports">
                    {process.ports.map((port) => (
                      <span
                        key={`${port.protocol}/${port.address}/${port.port}`}
                      >
                        {port.protocol}{" "}
                        {port.address.includes(":")
                          ? `[${port.address}]`
                          : port.address}
                        :{port.port}
                      </span>
                    ))}
                  </div>
                )}
                <details className="performance-details">
                  <summary>Launch command</summary>
                  <code>{process.commandLine || process.path}</code>
                </details>
                <div className="performance-process-actions">
                  <small title={process.path}>{process.path}</small>
                  {process.canClose ? (
                    <button
                      className="text-button"
                      disabled={loading || disabled}
                      onClick={() => act(process, "close")}
                    >
                      Close normally
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      disabled={loading || disabled}
                      onClick={() => setConfirm(process.id)}
                    >
                      Stop…
                    </button>
                  )}
                </div>
                {confirm === process.id && (
                  <div className="performance-confirm">
                    <p>
                      Stop {process.name} (PID {process.pid})? This ends the
                      process immediately. Unsaved work may be lost.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setConfirm(null)}
                    >
                      Keep running
                    </button>
                    <button
                      className="outline-button"
                      disabled={loading || disabled}
                      onClick={() => act(process, "stop")}
                    >
                      Stop this process
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!matches.length && (
              <p className="file-no-matches">
                No apps or processes match this review.
              </p>
            )}
          </div>
          {matches.length > limit && (
            <button
              className="text-button"
              onClick={() => setLimit(limit + 20)}
            >
              Show more ({matches.length - limit})
            </button>
          )}
          <p className="performance-note">
            {review.protectedCount} system, service or host processes excluded.
            Usage is a snapshot; refresh before deciding what to close.
          </p>
        </>
      )}
      {!loading && !review && (
        <button className="outline-button" onClick={refresh}>
          Try again
        </button>
      )}
    </div>
  );
}
