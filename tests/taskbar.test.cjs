const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chooseLane, fitWindow } = require("../electron/taskbar.cjs");
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

test("stale taskbar or Start rectangles from another display use a safe fallback", () => {
  const display = {
    bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: -1920, y: 0, width: 1920, height: 1032 },
  };
  const bar = { x: 0, y: 1032, width: 1920, height: 48 },
    start = { x: 700, y: 1032, width: 48, height: 48 };
  assert.equal(chooseLane(display, bar, start).kind, "above-taskbar-fallback");
  assert.equal(
    chooseLane(display, { ...bar, x: -1920 }, start).kind,
    "above-taskbar-fallback",
  );
  const lane = chooseLane(
    display,
    { ...bar, x: -1920 },
    { ...start, x: -1200 },
  );
  assert.equal(lane.kind, "taskbar-left-of-start");
  assert.ok(lane.x >= -1920 && lane.x + lane.width <= -1212);
});
test("station is clamped into a smaller or negative-coordinate monitor without growing", () => {
  for (const work of [
    { x: -1280, y: 0, width: 1280, height: 720 },
    { x: 0, y: 0, width: 900, height: 600 },
  ]) {
    const rect = fitWindow({ x: 1600, y: 900, width: 1140, height: 820 }, work);
    assert.ok(rect.x >= work.x && rect.y >= work.y);
    assert.ok(
      rect.x + rect.width <= work.x + work.width &&
        rect.y + rect.height <= work.y + work.height,
    );
    assert.ok(rect.width <= 1140 && rect.height <= 820);
  }
  const original = { x: -1200, y: 40, width: 900, height: 680 };
  assert.deepEqual(
    fitWindow(original, { x: -1920, y: 0, width: 1920, height: 1080 }),
    original,
  );
});
