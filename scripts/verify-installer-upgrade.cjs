const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const asar = require("@electron/asar");
const { UUID } = require("builder-util-runtime");
const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
async function run(exe, args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: "ignore" }),
      timer = setTimeout(() => {
        child.kill();
        reject(Error("Owned installer timed out"));
      }, timeout);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(code) : reject(Error("Installer exited " + code));
    });
  });
}
async function regSnapshot(guid) {
  const script = `$ErrorActionPreference='Stop';$names=@('HKCU:\\Software\\${guid}','HKLM:\\Software\\${guid}','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}');$items=@();foreach($name in $names){if(Test-Path -LiteralPath $name){$p=Get-ItemProperty -LiteralPath $name;$items+=@{key=$name;InstallLocation=$p.InstallLocation;DisplayName=$p.DisplayName;DisplayVersion=$p.DisplayVersion}}};ConvertTo-Json -InputObject @($items) -Compress`;
  return new Promise((resolve, reject) =>
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (e) {
          reject(e);
        }
      },
    ),
  );
}
async function files(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const stat = await fs.lstat(file);
      assert.ok(!stat.isSymbolicLink(), "Installer snapshot contains a link");
      if (stat.isDirectory()) await walk(file);
      else
        out.push({
          relative: path.relative(root, file),
          sha256: await digest(file),
        });
    }
  }
  await walk(root);
  return out;
}
(async () => {
  const workspace = path.resolve(__dirname, ".."),
    target = path.resolve(process.env.LOCALAPPDATA, "Programs", "Vacuum");
  assert.equal(
    target,
    path.join(process.env.LOCALAPPDATA, "Programs", "Vacuum"),
  );
  const expectedVersion = JSON.parse(
    await fs.readFile(path.join(workspace, "package.json"), "utf8"),
  ).version;
  const guid = UUID.v5(
    "computer.vacuum.desktop",
    UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"),
  );
  const before = await regSnapshot(guid);
  assert.deepEqual(
    before,
    [],
    "Existing product registration must be preserved; fresh-install proof refused",
  );
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  const profile = path.join(process.env.APPDATA, "vacuum-desktop"),
    cache = path.join(process.env.LOCALAPPDATA, "vacuum-desktop-updater");
  await assert.rejects(fs.stat(profile), { code: "ENOENT" });
  await assert.rejects(fs.stat(cache), { code: "ENOENT" });
  const desktop = path.join(os.homedir(), "Desktop", "Vacuum.lnk"),
    menu = path.join(
      process.env.APPDATA,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Vacuum.lnk",
    );
  for (const file of [desktop, menu])
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
  const root = await fs.mkdtemp(
    path.join(workspace, "test-results", "installer-proof-"),
  );
  await fs.mkdir(profile);
  const marker = path.join(profile, "vacuum-installer-proof.txt"),
    contents = "Retained installer-upgrade fixture. No personal data.\n";
  await fs.writeFile(marker, contents, { flag: "wx" });
  const baseline = path.join(
      workspace,
      "release",
      "Vacuum Setup 0.3.0-alpha.2.exe",
    ),
    next = path.join(
      workspace,
      "release",
      `Vacuum Setup ${expectedVersion}.exe`,
    );
  await run(baseline, ["/S", "/currentuser", "/D=" + target]);
  const version = () => {
    asar.uncache(path.join(target, "resources", "app.asar"));
    return JSON.parse(
      asar.extractFile(
        path.join(target, "resources", "app.asar"),
        "package.json",
      ),
    ).version;
  };
  assert.equal(version(), "0.3.0-alpha.2");
  let registry = await regSnapshot(guid);
  assert.ok(registry.some((item) => item.InstallLocation === target));
  const oldFiles = await files(target);
  const backup = path.join(root, "alpha2-retained");
  await fs.cp(target, backup, {
    recursive: true,
    preserveTimestamps: true,
    force: false,
    errorOnExist: true,
  });
  assert.deepEqual(await files(backup), oldFiles);
  await fs.writeFile(
    path.join(root, "registry-alpha2.json"),
    JSON.stringify(registry, null, 2),
  );
  if (await fs.stat(cache).catch(() => null))
    await fs.cp(cache, path.join(root, "installer-cache-alpha2"), {
      recursive: true,
      preserveTimestamps: true,
      force: false,
      errorOnExist: true,
    });
  for (const [name, file] of [
    ["desktop", desktop],
    ["start-menu", menu],
  ])
    if (await fs.stat(file).catch(() => null))
      await fs.copyFile(
        file,
        path.join(root, name + ".lnk"),
        fs.constants.COPYFILE_EXCL,
      );
  await fs.writeFile(
    path.join(root, "retained-alpha2-manifest.json"),
    JSON.stringify(oldFiles, null, 2),
  );
  await run(next, ["/S", "/currentuser", "/D=" + target]);
  assert.equal(version(), expectedVersion);
  registry = await regSnapshot(guid);
  assert.ok(
    registry.some((item) => item.DisplayVersion === expectedVersion) &&
      registry.some((item) => item.InstallLocation === target),
  );
  assert.equal(await fs.readFile(marker, "utf8"), contents);
  assert.deepEqual(await files(backup), oldFiles);
  assert.equal(
    await digest(path.join(target, "resources", "app.asar")),
    await digest(
      path.join(workspace, "release", "win-unpacked", "resources", "app.asar"),
    ),
  );
  await fs.rename(marker, path.join(root, "retained-user-data-fixture.txt"));
  const report = {
    nativeSilentCurrentUserInstall: true,
    baselineVersion: "0.3.0-alpha.2",
    upgradedVersion: expectedVersion,
    upgradeRegistrationCorrect: true,
    oldInstallFullyRetainedAndHashVerified: true,
    oldInstallRetainedFileCount: oldFiles.length,
    userDataFixturePreservedThroughUpgrade: true,
    fixtureRetainedAfterTest: true,
    installedPayloadMatchesVerifiedBuild: true,
    installedExecutable: path.join(target, "Vacuum.exe"),
    preExistingVacuumInstallationChanged: false,
    personalFilesPermanentlyDeleted: 0,
  };
  await fs.writeFile(
    path.join(workspace, "test-results", "installer-upgrade-proof.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
