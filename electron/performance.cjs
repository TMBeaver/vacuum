const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");

async function nativePerformance(request) {
  const script = await fs.readFile(
    path.join(__dirname, "performance.ps1"),
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ],
      { windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error)
          return reject(
            Error(
              error.killed
                ? "Windows took too long to complete this request. Refresh to check the current state."
                : "Windows could not complete this performance request. Refresh and try again.",
            ),
          );
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.on("error", () => {}); // Spawn/exit failures are reported by execFile's callback.
    child.stdin.end(JSON.stringify(request));
  });
}
const array = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const endpointKey = (port) => `${port.protocol}/${port.address}/${port.port}`;
function createPerformance({
  protectPids = () => [process.pid, process.ppid],
  invoke = nativePerformance,
  now = Date.now,
} = {}) {
  let candidates = new Map(),
    identities = [],
    reviewedAt = 0,
    queue = Promise.resolve();
  const run = (fn) => {
    const pending = queue.then(fn);
    queue = pending.catch(() => {});
    return pending;
  };
  async function inspect() {
    const snapshot = await invoke({
      operation: "inspect",
      protectPids: protectPids(),
    });
    const listeners = array(snapshot.listeners);
    identities = array(snapshot.identities || snapshot.processes);
    candidates = new Map();
    const processes = array(snapshot.processes)
      .filter(
        (entry) =>
          Number.isInteger(entry.pid) &&
          entry.pid > 0 &&
          typeof entry.startedTicks === "string" &&
          typeof entry.exe === "string",
      )
      .map((entry) => {
        const id = randomUUID();
        const ports = listeners.filter((port) => port.pid === entry.pid);
        candidates.set(id, { ...entry, id, ports });
        return {
          id,
          pid: entry.pid,
          name: entry.name,
          path: entry.exe,
          commandLine: entry.commandLine || "",
          memoryBytes: entry.memoryBytes,
          cpuPercent: entry.cpuPercent,
          canClose: entry.canClose === true,
          ports,
        };
      })
      .sort((a, b) => b.memoryBytes - a.memoryBytes);
    reviewedAt = now();
    return {
      processes,
      memoryTotal: snapshot.memoryTotal,
      memoryAvailable: snapshot.memoryAvailable,
      networkAvailable: snapshot.networkAvailable === true,
      protectedCount: snapshot.protectedCount,
      sampledAt: snapshot.sampledAt,
      listeners,
    };
  }
  return {
    review: () => run(inspect),
    act: (id, mode) =>
      run(async () => {
        if (mode !== "close" && mode !== "stop")
          throw Error("Choose a supported performance action.");
        const entry = typeof id === "string" && candidates.get(id);
        if (!entry || now() - reviewedAt > 120000)
          throw Error(
            "Review expired. Refresh the app list before closing anything.",
          );
        if (mode === "stop" && entry.canClose)
          throw Error("Use normal Close for an app with a window.");
        const result = await invoke({
          operation: "act",
          mode,
          entries: [
            {
              id,
              pid: entry.pid,
              exe: entry.exe,
              startedTicks: entry.startedTicks,
            },
          ],
          protectPids: protectPids(),
        });
        const action = array(result.results).find((result) => result.id === id);
        if (!action?.ok)
          throw Error(action?.reason || "Windows did not accept this action.");
        const next = await inspect();
        const stillRunning = identities.some(
          (process) =>
            process.pid === entry.pid &&
            (!process.startedTicks ||
              process.startedTicks === entry.startedTicks),
        );
        const currentEndpoints = new Set(next.listeners.map(endpointKey));
        const releasedPorts = next.networkAvailable
          ? entry.ports.filter(
              (port) => !currentEndpoints.has(endpointKey(port)),
            )
          : [];
        return {
          review: next,
          name: entry.name,
          mode,
          stillRunning,
          releasedPorts,
          previousMemoryBytes: entry.memoryBytes,
        };
      }),
  };
}
module.exports = { createPerformance, nativePerformance };
