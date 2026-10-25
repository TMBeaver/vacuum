const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-animation-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const app = await _electron.launch({
    args: [path.resolve(__dirname, ".."), "--test-mode"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() =>
      document.querySelector(".robot-scene canvas"),
    );
    const bounds = await page.locator(".canvas-mount canvas").boundingBox();
    await page.mouse.move(bounds.x + 50, bounds.y + bounds.height * 0.7);
    const interaction = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const deltas = [];
          let last = 0,
            start = 0;
          const canvas = document.querySelector(".canvas-mount canvas");
          function frame(now) {
            if (!start) start = now;
            if (last) deltas.push(now - last);
            last = now;
            const b = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
              new PointerEvent("pointermove", {
                clientX: b.left + 45 + (deltas.length % 2),
                clientY: b.top + b.height * 0.7,
                bubbles: true,
              }),
            );
            if (now - start < 2500) requestAnimationFrame(frame);
            else {
              const sorted = [...deltas].sort((a, b) => a - b);
              resolve({
                frames: deltas.length,
                averageFps:
                  1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length),
                medianMs: sorted[Math.floor(sorted.length * 0.5)],
                p95Ms: sorted[Math.floor(sorted.length * 0.95)],
              });
            }
          }
          requestAnimationFrame(frame);
        }),
    );
    await page.evaluate(() => window.vacuum.start());
    const companion =
      app.windows().find((p) => p.url().endsWith("#companion")) ||
      (await app.waitForEvent("window"));
    await companion.locator(".taskbar-canvas").waitFor();
    await page.waitForFunction(
      () => document.querySelector(".robot-scene").dataset.motion === "docked",
    );
    await page.waitForTimeout(700); // Let the real round's dock-hide timer finish.
    // Explicit animation-only harness: no scan is prolonged and no file operation runs.
    const state = await page.evaluate(() => window.vacuum.get());
    await app.evaluate(({ BrowserWindow }, state) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("#companion"),
      );
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
      window.webContents.send("vacuum:state", { ...state, phase: "cleaning" });
    }, state);
    const loops = await companion.evaluate(
      () =>
        new Promise((resolve) => {
          let start = 0,
            last = 0;
          const intervals = [],
            positions = [];
          function frame(now) {
            if (!start) start = now;
            if (last) intervals.push(now - last);
            last = now;
            positions.push(
              Number(document.querySelector(".taskbar-canvas").dataset.offset),
            );
            if (now - start < 16000) requestAnimationFrame(frame);
            else {
              const sorted = [...intervals].sort((a, b) => a - b);
              let rightSeen = false,
                returned = false;
              for (const x of positions) {
                if (x > 230) rightSeen = true;
                if (rightSeen && x < 60) returned = true;
              }
              resolve({
                animationOnly: true,
                seconds: (now - start) / 1000,
                frames: intervals.length,
                averageFps:
                  1000 /
                  (intervals.reduce((a, b) => a + b, 0) / intervals.length),
                medianMs: sorted[Math.floor(sorted.length * 0.5)],
                p95Ms: sorted[Math.floor(sorted.length * 0.95)],
                minX: Math.min(...positions),
                maxX: Math.max(...positions),
                rightSeen,
                returned,
              });
            }
          }
          requestAnimationFrame(frame);
        }),
    );
    assert.ok(
      interaction.medianMs <= 25,
      "3D interaction frame pacing is too slow",
    );
    assert.ok(
      loops.returned,
      "The visible companion did not complete a looping pass",
    );
    assert.ok(loops.medianMs <= 25, "Companion frame pacing is too slow");
    const report = {
      interaction,
      taskbar: loops,
      fileOperationsDuringAnimationHarness: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/animation-proof.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
