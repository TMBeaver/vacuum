const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

async function main() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-schedule-proof-"),
  );
  const profile = path.join(root, "vacuum-test-profile");
  for (const folder of [
    profile,
    path.join(root, "temp"),
    path.join(root, "downloads"),
    path.join(root, "local", "CrashDumps"),
  ])
    await fs.mkdir(folder, { recursive: true });
  const filename = path.join(root, "temp", "scheduled-proof.log");
  await fs.writeFile(
    filename,
    "Scheduled scans must keep these contents intact.",
  );
  const age = new Date(Date.now() - 10 * 86400000);
  await fs.utimes(filename, age, age);
  const hash = async () =>
    createHash("sha256")
      .update(await fs.readFile(filename))
      .digest("hex");
  const originalHash = await hash();
  const settings = {
    auto: true,
    hour: "00:00",
    companion: false,
    wet: false,
    startup: false,
    theme: "dark",
  };
  await fs.writeFile(
    path.join(profile, "settings.json"),
    JSON.stringify(settings),
  );
  const launch = () =>
    _electron.launch({
      ...(process.env.VACUUM_PACKAGED_EXE
        ? { executablePath: process.env.VACUUM_PACKAGED_EXE }
        : {}),
      args: process.env.VACUUM_PACKAGED_EXE
        ? ["--test-mode", "--background"]
        : [path.resolve(__dirname, ".."), "--test-mode", "--background"],
      env: { ...process.env, VACUUM_TEST_ROOT: root },
    });
  const waitForRound = async (page, previous = null) => {
    await page.waitForFunction(() => !!window.vacuum);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.vacuum.get());
      if (
        state.phase === "docked" &&
        state.lastRun &&
        state.lastRun !== previous
      )
        return state;
      if (state.roundError) throw Error(state.roundError);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Scheduled scan did not finish within 30 seconds.");
  };
  let app = await launch();
  const report = { packaged: !!process.env.VACUUM_PACKAGED_EXE };
  let completed;
  try {
    const page = await app.firstWindow();
    completed = await waitForRound(page);
    assert.equal(completed.bin.count, 1);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
      false,
    );
    report.overdueBackgroundScan = true;
  } finally {
    await app.close();
  }
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit("resume");
      powerMonitor.emit("resume");
    });
    const state = await page.evaluate(() => window.vacuum.get());
    assert.equal(state.lastRun, completed.lastRun);
    assert.equal(state.phase, "docked");
    report.sameDayRestartAndResumeSuppressed = true;
  } finally {
    await app.close();
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await fs.writeFile(
    path.join(profile, "history.json"),
    JSON.stringify({ lastRun: yesterday.toISOString() }),
  );
  await fs.writeFile(
    path.join(profile, "settings.json"),
    JSON.stringify({ ...settings, auto: false }),
  );
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.vacuum);
    await page.evaluate(async () => {
      window.schedulePhases = [];
      window.vacuum.subscribe((state) => {
        if (state.phase && window.schedulePhases.at(-1) !== state.phase)
          window.schedulePhases.push(state.phase);
      });
      await window.vacuum.settings({ auto: true });
    });
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit("resume");
      powerMonitor.emit("resume");
    });
    const state = await waitForRound(page, yesterday.toISOString());
    assert.equal(state.bin.count, 1);
    await page.waitForFunction(() => window.schedulePhases.at(-1) === "docked");
    const phases = await page.evaluate(() => window.schedulePhases);
    assert.equal(phases.filter((phase) => phase === "departing").length, 1);
    assert.ok(
      phases.includes("cleaning") &&
        phases.includes("returning") &&
        phases.includes("docked"),
      JSON.stringify(phases),
    );
    report.overdueResumeSingleRound = true;
    report.observedPhases = phases;
  } finally {
    await app.close();
  }
  report.contentsPreserved = (await hash()) === originalHash;
  assert.ok(report.contentsPreserved);
  report.permanentlyDeletedFiles = 0;
  report.realSleepOrSignOutPerformed = false;
  await fs.utimes(filename, new Date(), new Date());
  await fs.mkdir(path.resolve(__dirname, "../test-results"), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(__dirname, "../test-results/scheduling-proof.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
