const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPerformance } = require("../electron/performance.cjs");
const processEntry = {
  pid: 1234,
  startedTicks: "stable-start",
  exe: "C:\\Apps\\fixture.exe",
  name: "fixture",
  memoryBytes: 64 * 1024 ** 2,
  cpuPercent: 2.5,
  canClose: false,
};
const port = { pid: 1234, protocol: "TCP", address: "127.0.0.1", port: 12345 };
const snapshot = (processes = [processEntry], listeners = [port]) => ({
  processes,
  identities: processes,
  listeners,
  networkAvailable: true,
  memoryTotal: 16 * 1024 ** 3,
  memoryAvailable: 5 * 1024 ** 3,
});

test("performance actions accept reviewed IDs only and pass original identity to Windows", async () => {
  let action,
    stopped = false;
  const engine = createPerformance({
    protectPids: () => [99],
    invoke: async (request) => {
      if (request.operation === "inspect")
        return stopped ? snapshot([], []) : snapshot();
      action = request;
      stopped = true;
      return { results: [{ id: request.entries[0].id, ok: true }] };
    },
  });
  const review = await engine.review();
  await assert.rejects(engine.act(1234, "stop"), /Review expired/);
  await assert.rejects(engine.act(processEntry.exe, "stop"), /Review expired/);
  const result = await engine.act(review.processes[0].id, "stop");
  assert.deepEqual(action.protectPids, [99]);
  assert.equal(action.entries[0].startedTicks, "stable-start");
  assert.equal(action.entries[0].exe, processEntry.exe);
  assert.equal(result.stillRunning, false);
  assert.equal(result.releasedPorts.length, 1);
});

test("normal close requests do not claim exit or port release while an app waits to save", async () => {
  const engine = createPerformance({
    invoke: async (request) =>
      request.operation === "inspect"
        ? snapshot([{ ...processEntry, canClose: true }])
        : { results: [{ id: request.entries[0].id, ok: true }] },
  });
  const review = await engine.review();
  await assert.rejects(
    engine.act(review.processes[0].id, "stop"),
    /normal Close/,
  );
  const result = await engine.act(review.processes[0].id, "close");
  assert.equal(result.stillRunning, true);
  assert.equal(result.releasedPorts.length, 0);
});

test("expired and superseded performance reviews cannot act on stale processes", async () => {
  let clock = 0,
    actions = 0;
  const engine = createPerformance({
    now: () => clock,
    invoke: async (request) => {
      if (request.operation === "inspect") return snapshot();
      actions++;
    },
  });
  const first = await engine.review();
  clock = 120001;
  await assert.rejects(engine.act(first.processes[0].id, "stop"), /expired/);
  const second = await engine.review();
  await assert.rejects(engine.act(first.processes[0].id, "stop"), /expired/);
  await assert.rejects(
    engine.act(second.processes[0].id, "firewall"),
    /supported/,
  );
  assert.equal(actions, 0);
});

test("an endpoint rebound by another process is never counted as a closed port", async () => {
  let acted = false;
  const engine = createPerformance({
    invoke: async (request) => {
      if (request.operation === "inspect")
        return acted ? snapshot([], [{ ...port, pid: 4321 }]) : snapshot();
      acted = true;
      return { results: [{ id: request.entries[0].id, ok: true }] };
    },
  });
  const review = await engine.review();
  assert.equal(
    (await engine.act(review.processes[0].id, "stop")).releasedPorts.length,
    0,
  );
});

test("unavailable listener data or filtered process metadata cannot fabricate success", async () => {
  let acted = false;
  const engine = createPerformance({
    invoke: async (request) => {
      if (request.operation === "inspect")
        return acted
          ? {
              ...snapshot([], []),
              identities: [{ pid: 1234, startedTicks: null }],
              networkAvailable: false,
            }
          : snapshot();
      acted = true;
      return { results: [{ id: request.entries[0].id, ok: true }] };
    },
  });
  const review = await engine.review();
  const result = await engine.act(review.processes[0].id, "stop");
  assert.equal(result.stillRunning, true);
  assert.equal(result.releasedPorts.length, 0);
});

test("Windows refusal is surfaced and never retried as a forced close", async () => {
  const actions = [];
  const engine = createPerformance({
    invoke: async (request) => {
      if (request.operation === "inspect") return snapshot();
      actions.push(request.mode);
      return {
        results: [
          {
            id: request.entries[0].id,
            ok: false,
            reason: "Process identity changed",
          },
        ],
      };
    },
  });
  const review = await engine.review();
  await assert.rejects(
    engine.act(review.processes[0].id, "close"),
    /identity changed/,
  );
  assert.deepEqual(actions, ["close"]);
});
