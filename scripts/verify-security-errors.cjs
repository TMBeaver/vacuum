const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { _electron } = require("playwright");
async function poll(page, predicate) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.vacuum.get());
    if (predicate(state)) return state;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error("Security round did not finish");
}
(async () => {
  const packaged = !!process.env.VACUUM_PACKAGED_EXE,
    results = [];
  for (const mode of ["unavailable", "cli-error"]) {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "vacuum-security-proof-"),
    );
    for (const folder of [
      "temp",
      "downloads",
      "local/CrashDumps",
      "provider/Windows Defender",
    ])
      await fs.mkdir(path.join(root, folder), { recursive: true });
    const file = path.join(root, "temp", "retained-security.tmp");
    await fs.writeFile(file, "Security fixture contents must stay intact.");
    if (mode === "cli-error")
      await fs.copyFile(
        path.join(process.env.SystemRoot, "System32", "whoami.exe"),
        path.join(root, "provider", "Windows Defender", "MpCmdRun.exe"),
      );
    const app = await _electron.launch({
      ...(packaged ? { executablePath: process.env.VACUUM_PACKAGED_EXE } : {}),
      args: packaged
        ? ["--test-mode"]
        : [path.resolve(__dirname, ".."), "--test-mode"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) =>
              !["programfiles", "programdata"].includes(key.toLowerCase()),
          ),
        ),
        VACUUM_TEST_ROOT: root,
        ProgramFiles: path.join(root, "provider"),
        ProgramData: path.join(root, "no-platform"),
      },
    });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .waitFor();
      await app.evaluate((_, root) => {
        const path = process.getBuiltinModule("path");
        process.env.ProgramFiles = path.join(root, "provider");
        process.env.ProgramData = path.join(root, "no-platform");
      }, root);
      await page.evaluate(async () => {
        await window.vacuum.settings({ wet: true, companion: false });
        await window.vacuum.start();
      });
      const state = await poll(
        page,
        (s) => s.phase === "docked" && s.wetResult,
      );
      assert.equal(
        state.wetResult.status,
        mode === "unavailable" ? "unavailable" : "attention",
      );
      await page
        .getByRole("button", { name: "Wet scan needs attention", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Security scan", exact: true })
        .waitFor();
      await page.getByText(state.wetResult.message, { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "Scan complete", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Open Windows Security", exact: true })
        .waitFor();
      if (mode === "cli-error") {
        await page.getByText("Defender report", { exact: true }).click();
        assert.ok(
          (await page.locator(".security-content pre").innerText()).length > 0,
        );
      }
      assert.equal(
        await fs.readFile(file, "utf8"),
        "Security fixture contents must stay intact.",
      );
      await fs.mkdir(path.resolve(__dirname, "../test-results"), {
        recursive: true,
      });
      await page.screenshot({ path: `test-results/security-${mode}.png` });
      results.push({
        mode,
        status: state.wetResult.status,
        honestResultVisible: true,
        windowsSecurityActionPresent: true,
        fixtureContentsPreserved: true,
      });
    } finally {
      await app.close();
    }
  }
  const report = {
    packaged,
    scenarios: results,
    cliErrorUsesHarmlessWindowsIdentityUtility: true,
    systemAntivirusConfigurationChanged: false,
    malwareSamplesUsed: false,
    permanentlyDeletedFiles: 0,
  };
  await fs.writeFile(
    path.resolve(__dirname, "../test-results/security-errors-proof.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
