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
