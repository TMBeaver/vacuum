const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createStartup, STARTUP_NAME } = require("../electron/startup.cjs");
const executable = "C:\\Apps\\Vacuum.exe";
function fixture({
  packaged = true,
  appPath = "C:\\Projects\\Vacuum",
  name,
  migrateLegacy,
} = {}) {
  const values = new Map(),
    calls = [];
  const app = {
    isPackaged: packaged,
    getAppPath: () => appPath,
    getLoginItemSettings: () => ({
      openAtLogin: true,
      launchItems: [...values.values()].map((item) => ({
        ...item,
        args: item.args.filter((arg) => !arg.startsWith("--")),
      })),
    }),
    setLoginItemSettings: (options) => {
      calls.push(options);
      if (app.ignoreWrites) return;
      if (!options.openAtLogin) values.delete(options.name);
      else
        values.set(options.name, {
          name: options.name,
          path: options.path,
          args: options.args,
          scope: "user",
          enabled: options.enabled !== false,
        });
    },
  };
  return {
    app,
    values,
    calls,
    service: createStartup({
      app,
      executable,
      name,
      migrateLegacy,
      readCommands: async (names) =>
        names.map((name) => values.get(name)).filter(Boolean),
    }),
  };
}
const entry = (name, extra = {}) => ({
  name,
  path: executable,
  args: ["--background"],
  scope: "user",
  enabled: true,
  ...extra,
});

test("startup owns a stable product name and verifies Windows state after enable/disable", async () => {
  const f = fixture();
  assert.equal((await f.service.read()).enabled, false);
  assert.equal((await f.service.set(true)).enabled, true);
  assert.equal(f.calls[0].name, STARTUP_NAME);
  assert.deepEqual(f.calls[0].args, ["--background"]);
  assert.equal(f.calls[0].path, executable);
  assert.equal((await f.service.set(false)).enabled, false);
  assert.equal(f.values.has(STARTUP_NAME), false);
});

test("development startup lets Electron quote a folder containing spaces", async () => {
  const f = fixture({ packaged: false, appPath: "C:\\Project folder\\Vacuum" });
  assert.deepEqual(f.service.options.args, [
    "C:\\Project folder\\Vacuum",
    "--background",
  ]);
  f.values.set(
    "old-entry",
    entry("old-entry", {
      args: ["c:\\project folder\\vacuum", "--background"],
    }),
  );
  assert.equal((await f.service.read()).legacy, true);
});

test("legacy migration never removes another Electron app or machine-wide entry", async () => {
  const f = fixture();
  f.values.set("legacy-vacuum", entry("legacy-vacuum"));
  f.values.set(
    "another-app",
    entry("another-app", { args: ["C:\\Other app", "--background"] }),
  );
  f.values.set(
    "machine-managed",
    entry("machine-managed", { scope: "machine" }),
  );
  f.values.set(
    "other-executable",
    entry("other-executable", { path: "C:\\Apps\\Other.exe" }),
  );
  await f.service.set(true);
  assert.equal(f.values.has("legacy-vacuum"), false);
  assert.ok(
    f.values.has("another-app") &&
      f.values.has("machine-managed") &&
      f.values.has("other-executable"),
  );
  assert.deepEqual(
    f.calls.filter((call) => !call.openAtLogin).map((call) => call.name),
    ["legacy-vacuum"],
  );
});

test("Windows startup approval is authoritative and an explicit enable restores it", async () => {
  const f = fixture();
  f.values.set(STARTUP_NAME, entry(STARTUP_NAME, { enabled: false }));
  assert.equal((await f.service.read()).registered, true);
  assert.equal((await f.service.read()).enabled, false);
  assert.equal((await f.service.set(true)).enabled, true);
});

test("silent Windows refusal is surfaced before legacy aliases are changed", async () => {
  const f = fixture();
  f.values.set("legacy", entry("legacy"));
  f.app.ignoreWrites = true;
  await assert.rejects(() => f.service.set(true), /did not enable/);
  assert.ok(f.values.has("legacy"));
  assert.equal(f.calls.length, 1);
});

test("scoped native proofs cannot migrate or remove real startup entries", async () => {
  const f = fixture({ name: "vacuum-proof-unique", migrateLegacy: false });
  f.values.set(STARTUP_NAME, entry(STARTUP_NAME));
  const original = JSON.stringify(f.values.get(STARTUP_NAME));
  await f.service.set(true);
  await f.service.set(false);
  assert.equal(JSON.stringify(f.values.get(STARTUP_NAME)), original);
  assert.ok(f.calls.every((call) => call.name === "vacuum-proof-unique"));
});

test("missing Windows detail data blocks registration instead of claiming success", async () => {
  const f = fixture();
  f.app.getLoginItemSettings = () => ({ openAtLogin: true });
  await assert.rejects(() => f.service.set(true), /unavailable/);
  assert.equal(f.calls.length, 0);
});

test("complete Windows commands distinguish aliases with different switches", async () => {
  const f = fixture();
  f.values.set("other-mode", entry("other-mode", { args: ["--other-mode"] }));
  assert.equal((await f.service.read()).registered, false);
  await f.service.set(true);
  await f.service.set(false);
  assert.ok(f.values.has("other-mode"));
  assert.ok(f.calls.every((call) => call.name !== "other-mode"));
});

test("named registration uses verified command and entry approval when Electron's default-name flag is false", async () => {
  const f = fixture();
  const inspect = f.app.getLoginItemSettings;
  f.app.getLoginItemSettings = () => ({ ...inspect(), openAtLogin: false });
  assert.equal((await f.service.set(true)).enabled, true);
  f.values.get(STARTUP_NAME).enabled = false;
  assert.equal((await f.service.read()).registered, true);
  assert.equal((await f.service.read()).enabled, false);
  await f.service.set(false);
});
