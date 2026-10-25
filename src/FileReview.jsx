import { useMemo, useState } from "react";

const PAGE_SIZE = 100;

// Keep the review panel responsive at the engine's 50,000-reference limit.
// Pagination also keeps every checkbox reachable with ordinary keyboard navigation.
export default function FileReview({
  files,
  selected,
  choose,
  skipped,
  formatSize,
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? files.filter((file) =>
          `${file.name}\n${file.path}`.toLocaleLowerCase().includes(needle),
        )
      : files;
  }, [files, query]);
  const reasons = useMemo(
    () => new Map(skipped.map((item) => [item.id, item.reason])),
    [skipped],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  return (
    <div className="file-review">
      {files.length > PAGE_SIZE && (
        <input
          className="file-search"
          type="search"
          aria-label="Find files by name or path"
          placeholder="Find a file…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      )}
      <div className="file-list">
        {visible.map((file) => (
          <label key={file.id} className="file-row">
            <input
              type="checkbox"
              aria-label={`Select ${file.name}`}
              checked={selected.has(file.id)}
              onChange={() => choose(file.id)}
            />
            <div>
              <strong title={file.name}>{file.name}</strong>
              <small title={file.path}>{file.path}</small>
              <span>
                {reasons.get(file.id) ||
                  file.recoveryProblem ||
                  (file.compacted
                    ? "Compressed by Vacuum · contents kept · reversible"
                    : file.reason) ||
                  file.category}
              </span>
            </div>
            <b>{formatSize(file.size)}</b>
          </label>
        ))}
        {!visible.length && (
          <p className="file-no-matches" role="status">
            No files match this search. Your selection is kept.
          </p>
        )}
      </div>
      {files.length > PAGE_SIZE && (
        <nav className="file-pagination" aria-label="File review pages">
          <span role="status">
            {filtered.length
              ? `${(start + 1).toLocaleString()}–${Math.min(start + PAGE_SIZE, filtered.length).toLocaleString()}`
              : "0"}{" "}
            of {filtered.length.toLocaleString()}
          </span>
          <button
            className="text-button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <button
            className="text-button"
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
