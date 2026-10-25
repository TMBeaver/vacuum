const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { _electron } = require("playwright");
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum-keyboard-proof-"),
  );
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const oldFile = path.join(root, "downloads", "retained-keyboard.txt");
  await fs.writeFile(oldFile, "Retained keyboard fixture");
  const old = new Date(Date.now() - 200 * 86400000);
  await fs.utimes(oldFile, old, old);
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
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const selector of [
      'button[aria-label="Settings"]',
      ".hotspot-bin",
      ".hotspot-station",
    ]) {
      const opener = page.locator(selector);
      await opener.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page.evaluate(() => !!document.activeElement.closest(".sheet")),
        true,
        "Opening a panel must move focus into it",
      );
      const count = await page
        .locator(
          ".sheet button:not(:disabled), .sheet input:not(:disabled), .sheet summary",
        )
        .count();
      for (let i = 0; i < count + 2; i++) {
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => !!document.activeElement.closest(".sheet")),
          true,
          "Tab escaped the panel",
        );
      }
      await page
        .getByRole("button", { name: "Back to station", exact: true })
        .focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(() => !!document.activeElement.closest(".sheet")),
        true,
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert.equal(
        await opener.evaluate((el) => el === document.activeElement),
        true,
        "Closing a panel must restore focus to its opener",
      );
    }
    const oldOpener = page.getByRole("button", {
      name: "Forgotten files",
      exact: true,
    });
    await oldOpener.focus();
    await page.keyboard.press("Enter");
    await page.getByText("retained-keyboard.txt", { exact: true }).waitFor();
    await page.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page
      .getByRole("button", { name: "Add 1 to dust bin", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .getByRole("heading", { name: "Dust bin", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => !!document.activeElement.closest(".sheet")),
      true,
      "Switching panel contents must retain focus in the dialog",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(
      await oldOpener.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await fs.readFile(oldFile, "utf8"),
      "Retained keyboard fixture",
    );
    assert.deepEqual(errors, []);
    const report = {
      packaged,
      keyboardPanelActivation: true,
      focusContained: true,
      escapeRestoresOpener: true,
      physicalControlKeyboardAccess: true,
      collectionPanelTransitionRetainsFocus: true,
      rendererErrors: errors.length,
      permanentlyDeletedFiles: 0,
    };
    await fs.mkdir(path.resolve(__dirname, "../test-results"), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, "../test-results/keyboard-proof.json"),
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
