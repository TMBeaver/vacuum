const { _electron } = require("playwright"),
  fs = require("fs/promises"),
  path = require("path"),
  os = require("os"),
  assert = require("assert/strict");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vacuum-resize-"));
  for (const d of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, d), { recursive: true });
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  const app = await _electron.launch({
    ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
    args: packaged
      ? ["--test-mode"]
      : [path.resolve(__dirname, ".."), "--test-mode"],
    env: { ...process.env, VACUUM_TEST_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.locator(".hotspot-power").waitFor({ state: "visible" });
    const samples = [];
    for (const panel of ["bin", "settings", "performance"]) {
      await page.evaluate((p) => window.vacuum.panel(p), panel);
      await page.getByRole("dialog").waitFor();
      for (let i = 0; i < 8; i++) {
        const rect = await page.locator(".robot-scene").evaluate((el) => {
          const b = el.getBoundingClientRect();
          return {
            x: Math.round(b.x + b.width * 0.2),
            y: Math.round(b.y + b.height * 0.15),
            width: Math.round(b.width * 0.6),
            height: Math.round(b.height * 0.7),
          };
        });
        const fraction = await app.evaluate(async ({ BrowserWindow }, rect) => {
          const w = BrowserWindow.getAllWindows().find(
            (w) => !w.webContents.getURL().includes("#"),
          );
          const pixels = (await w.webContents.capturePage(rect)).toBitmap();
          let solid = 0;
          for (let p = 0; p < pixels.length; p += 4)
            if (pixels[p] > 40 && pixels[p + 1] > 46 && pixels[p + 2] > 43)
              solid++;
          return solid / (pixels.length / 4);
        }, rect);
        samples.push(fraction);
        assert.ok(
          fraction > 0.05,
          `Robot disappeared during ${panel} resize: ${fraction}`,
        );
      }
      await page
        .getByRole("button", { name: "Close panel", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
    }
    const report = {
      packaged,
      panels: ["bin", "settings", "performance"],
      capturedFrames: samples.length,
      minimumModelPixelFraction: Math.min(...samples),
      robotVisibleDuringResize: true,
    };
    await fs.writeFile(
      "test-results/robot-resize-proof.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
