const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trayPopupBounds } = require("../electron/tray-popup.cjs");
test("tray robot fits work areas at bottom/top taskbars and negative monitor coordinates", () => {
  for (const work of [
    { x: 0, y: 0, width: 1536, height: 816 },
    { x: -1920, y: 48, width: 1920, height: 1032 },
    { x: 0, y: 0, width: 640, height: 480 },
  ]) {
    for (const anchor of [
      {
        x: work.x + work.width - 24,
        y: work.y + work.height,
        width: 24,
        height: 32,
      },
      { x: work.x, y: work.y - 32, width: 24, height: 32 },
    ]) {
      const popup = trayPopupBounds(anchor, work);
      assert.ok(popup.width <= 440 && popup.height <= 500);
      assert.ok(popup.x >= work.x && popup.y >= work.y);
      assert.ok(
        popup.x + popup.width <= work.x + work.width &&
          popup.y + popup.height <= work.y + work.height,
      );
    }
  }
});

test("expanded bin stays inside the monitor while giving the robot a separate pane", () => {
  const work = { x: -1920, y: 0, width: 1920, height: 1032 };
  const bounds = trayPopupBounds(
    { x: -30, y: 1032, width: 24, height: 40 },
    work,
    true,
  );
  assert.equal(bounds.width, 820);
  assert.ok(bounds.x >= work.x && bounds.x + bounds.width <= 0);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1032);
  const small = trayPopupBounds(
    { x: 620, y: 480, width: 20, height: 32 },
    { x: 0, y: 0, width: 640, height: 480 },
    true,
  );
  assert.equal(small.width, 624);
  assert.ok(small.x + small.width <= 640 && small.y + small.height <= 480);
});
