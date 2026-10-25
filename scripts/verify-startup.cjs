const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { _electron } = require("playwright");

async function otherRunValues(excludeName) {
  const script = `$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run')
$items=@()
try{if($null -ne $key){foreach($name in $key.GetValueNames()){if($name -ne $request.excludeName){$items+=@{name=$name;value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$key.GetValueKind($name).ToString()}}}}}finally{if($key){$key.Dispose()}}
ConvertTo-Json -InputObject @($items) -Depth 6 -Compress`;
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ],
      { windowsHide: true, timeout: 10000 },
      (error, stdout) => {
        if (error)
          return reject(
            Error("Could not inspect the read-only startup baseline."),
          );
        try {
          resolve(
            JSON.parse(stdout.trim()).sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.end(JSON.stringify({ excludeName }));
  });
}
(async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "vacuum startup proof-"),
  );
  const name = `vacuum-startup-proof-${randomUUID()}`;
  await fs.mkdir(path.join(root, "profile"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "vacuum-startup-proof", main: "main.cjs" }),
  );
  const modulePath = path.resolve(__dirname, "../electron/startup.cjs");
  await fs.writeFile(
    path.join(root, "main.cjs"),
    `const {app}=require('electron');
app.setPath('userData',require('node:path').join(__dirname,'profile'));
app.setAppUserModelId(${JSON.stringify(name)});
global.startupProof=require(${JSON.stringify(modulePath)}).createStartup({app,name:${JSON.stringify(name)},migrateLegacy:false});
if(process.argv.includes('--proof-controller')){
  setInterval(()=>{},1000);
  app.on('before-quit',()=>{global.startupProof.set(false).catch(()=>{})});
}else{app.whenReady().then(()=>app.quit())}
`,
  );
  const baseline = await otherRunValues(name);
  const packaged = !!process.env.VACUUM_PACKAGED_EXE;
  for (const folder of ["temp", "downloads", "local/CrashDumps"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  const app = await _electron.launch(
    packaged
      ? {
          executablePath: process.env.VACUUM_PACKAGED_EXE,
          args: ["--test-mode", "--background"],
          env: { ...process.env, VACUUM_TEST_ROOT: root },
        }
      : { args: [root, "--proof-controller"] },
  );
  let cleanupVerified = false;
  try {
    if (packaged)
      await app.evaluate(({ app }, name) => {
        const load = process
          .getBuiltinModule("module")
          .createRequire(app.getAppPath() + "/package.json");
        global.startupProof = load("./electron/startup.cjs").createStartup({
          app,
          name,
          migrateLegacy: false,
        });
      }, name);
    const before = await app.evaluate(() => global.startupProof.read());
    assert.equal(before.registered, false);
    const enabled = await app.evaluate(() => global.startupProof.set(true));
    assert.equal(enabled.registered, true);
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.items.length, 1);
    const item = enabled.items[0];
    assert.equal(item.name, name);
    assert.equal(item.scope, "user");
    assert.deepEqual(
      enabled.launch.args,
      packaged ? ["--background"] : [root, "--background"],
      "Windows must parse the spaced app folder as one argument",
    );
    // Launch exactly the executable/arguments read back from the Windows API.
    // The disposable fixture quits immediately; no sign-out/reboot is required.
    if (!packaged)
      await new Promise((resolve, reject) => {
        const child = spawn(enabled.launch.path, enabled.launch.args, {
          windowsHide: true,
          stdio: "ignore",
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(Error("Registered background fixture did not exit"));
        }, 15000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(Error(`Registered fixture exited with ${code}`));
        });
      });
    const disabled = await app.evaluate(() => global.startupProof.set(false));
    assert.equal(disabled.registered, false);
    assert.equal(disabled.enabled, false);
    cleanupVerified = true;
  } finally {
    try {
      const state = await app.evaluate(() =>
        global.startupProof ? global.startupProof.set(false) : null,
      );
      cleanupVerified = !!state && !state.registered && !state.enabled;
    } finally {
      await app.close();
    }
  }
  const after = await otherRunValues(name);
  assert.deepEqual(
    after,
    baseline,
    "Other current-user Run entries changed during the proof",
  );
  assert.ok(cleanupVerified);
  const report = {
    packaged,
    nativeRegistrationRoundTrip: true,
    currentUserScope: true,
    completeBackgroundArgumentsVerified: true,
    spacedFolderArgumentsParsed: !packaged,
    registeredBackgroundLaunchExited: !packaged,
    testEntryRemoved: cleanupVerified,
    otherCurrentUserRunEntriesPreserved: true,
    signOutOrRebootPerformed: false,
    permanentlyDeletedFiles: 0,
  };
  await fs.mkdir(path.resolve(__dirname, "../test-results"), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(__dirname, "../test-results/startup-proof.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
