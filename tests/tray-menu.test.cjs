const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTrayTemplate } = require("../electron/tray-menu.cjs");
function fixture(phase = "docked", extra = {}) {
  const calls = [];
  const template = createTrayTemplate({
    state: { phase, bin: { count: 3 }, message: "Ready", ...extra },
    settings: {
      wet: false,
      auto: false,
      companion: true,
      startup: false,
      hour: "10:00",
      theme: "dark",
    },
    running: ["departing", "cleaning", "wet", "returning"].includes(phase),
    start: () => calls.push("start"),
    stop: () => calls.push("stop"),
    open: (panel) => calls.push({ panel }),
    change: (patch) => calls.push(patch),
    quit: () => calls.push("quit"),
  });
  return {
    calls,
    items: template,
    get: (id) => template.find((item) => item.id === id),
  };
}
test("tray starts or recalls a round, and disables cleaning during file actions or return", () => {
  for (const phase of ["docked", "departing", "cleaning", "wet"]) {
    const f = fixture(phase);
    assert.equal(f.get("clean").enabled, true);
    f.get("clean").click();
    assert.deepEqual(f.calls, [phase === "docked" ? "start" : "stop"]);
  }
  for (const phase of ["returning", "emptying", "compacting", "optimizing"]) {
    const f = fixture(phase);
    assert.equal(f.get("clean").enabled, false);
    assert.equal(f.get("bin").enabled, false);
    assert.equal(f.get("wet").enabled, false);
  }
  assert.equal(
    fixture("docked", { startupError: "Unreadable bin" }).get("clean").enabled,
    false,
  );
});
test("tray bin action opens review rather than deleting files and routes each view correctly", () => {
  const f = fixture();
  for (const id of ["bin", "old", "performance", "settings"]) f.get(id).click();
  assert.deepEqual(f.calls, [
    { panel: "bin" },
    { panel: "old" },
    { panel: "performance" },
    { panel: "settings" },
  ]);
});
test("tray modes use settings patches and Windows startup failure disables that action", () => {
  const f = fixture();
  for (const id of ["wet", "auto", "companion", "startup"])
    f.get(id).click({ checked: true });
  assert.deepEqual(f.calls, [
    { wet: true },
    { auto: true },
    { companion: true },
    { startup: true },
  ]);
  assert.equal(
    fixture("docked", { startupRegistration: { available: false } }).get(
      "startup",
    ).enabled,
    false,
  );
  const colours = f.items.find((item) => item.submenu).submenu;
  colours[1].click();
  assert.deepEqual(f.calls.at(-1), { theme: "light" });
});
