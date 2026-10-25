const { test } = require("node:test");
const assert = require("node:assert/strict");
test("taskbar loops remain within their lane including the whole vacuum body", async () => {
  const { companionPose } = await import("../src/companion-path.mjs");
  for (const [w, h] of [
    [120, 24],
    [280, 42],
    [260, 40],
  ])
    for (let d = 0; d < 1600; d += 0.75) {
      const p = companionPose(w, h, d),
        radius = Math.min(13, h * 0.3);
      assert.ok(p.x - radius >= 0 && p.x + radius <= w);
      assert.ok(p.y - radius >= 0 && p.y + radius <= h);
    }
});
test("circle turns have continuous position and heading with no abrupt reversal", async () => {
  const { companionPose } = await import("../src/companion-path.mjs");
  const w = 280,
    h = 42,
    turn = h * 0.16,
    line = w - 18 - turn - 42,
    arc = Math.PI * turn,
    total = 2 * line + 2 * arc;
  for (const boundary of [line, line + arc, 2 * line + arc, total]) {
    const a = companionPose(w, h, boundary - 0.0001),
      b = companionPose(w, h, boundary + 0.0001);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.001);
    assert.ok(
      Math.abs(Math.atan2(Math.sin(a.a - b.a), Math.cos(a.a - b.a))) < 0.001,
    );
  }
});
test("the complete lap returns to the same pose and tangent", async () => {
  const { companionPose } = await import("../src/companion-path.mjs");
  const w = 280,
    h = 42,
    turn = h * 0.16,
    total = 2 * (w - 18 - turn - 42) + 2 * Math.PI * turn;
  const a = companionPose(w, h, 0),
    b = companionPose(w, h, total);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-8);
  assert.ok(Math.abs(Math.sin(a.a - b.a)) < 1e-8);
});
