const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chooseLane } = require("../electron/taskbar.cjs");
const display = { workArea: { x: 0, y: 0, width: 1536, height: 816 } };
test("small companion fits inside the taskbar before the actual Start button", () => {
  const bar = { x: 0, y: 816, width: 1536, height: 48 },
    start = { x: 436, y: 816, width: 45, height: 48 },
    lane = chooseLane(display, bar, start);
  assert.equal(lane.kind, "taskbar-left-of-start");
  assert.ok(lane.x >= 100);
  assert.ok(lane.x + lane.width <= start.x - 12);
  assert.ok(lane.y >= bar.y);
  assert.ok(lane.y + lane.height <= bar.y + bar.height);
  assert.ok(lane.height <= 42);
});
test("a left-aligned Start button never gets covered", () => {
  const lane = chooseLane(
    display,
    { x: 0, y: 816, width: 1536, height: 48 },
    { x: 4, y: 816, width: 45, height: 48 },
  );
  assert.equal(lane.kind, "above-taskbar-fallback");
  assert.ok(lane.y + lane.height <= display.workArea.height);
});
test("missing or vertical taskbar uses a visible unobtrusive fallback", () => {
  for (const bar of [null, { x: 0, y: 0, width: 48, height: 900 }])
    assert.equal(chooseLane(display, bar, null).kind, "above-taskbar-fallback");
});
