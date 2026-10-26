import "./empty-progress.css";
export default function EmptyProgress({ progress }) {
  const total = progress?.total || 0;
  const processed = Math.min(progress?.processed || 0, total);
  const fraction = total ? processed / total : 0;
  return (
    <div
      className="empty-progress"
      role="progressbar"
      aria-label="Recycling selected files"
      aria-valuemin={0}
      aria-valuemax={Math.max(1, total)}
      aria-valuenow={processed}
      aria-valuetext={`${processed} of ${total} processed`}
    >
      <div className="empty-progress-ring">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle className="progress-track" cx="24" cy="24" r="20" />
          <circle
            className="progress-fill"
            cx="24"
            cy="24"
            r="20"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - fraction * 100}
          />
        </svg>
        <span>
          {Math.floor(fraction * 100)}
          <small>%</small>
        </span>
      </div>
      <div className="empty-progress-copy">
        <strong>
          {total && processed === total
            ? "Finishing up…"
            : "Moving to Recycle Bin"}
        </strong>
        <span>
          {processed.toLocaleString()} of {total.toLocaleString()} processed
        </span>
        <small>
          {(progress?.recycled || 0).toLocaleString()} recycled ·{" "}
          {(progress?.skipped || 0).toLocaleString()} skipped
        </small>
      </div>
    </div>
  );
}
