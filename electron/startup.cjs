const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const STARTUP_NAME = "computer.vacuum.desktop";
const windowsPath = (value) =>
  path.win32.normalize(String(value)).toLowerCase();
const argument = (value) =>
  /^(?:[a-z]:[\\/]|\\\\)/i.test(String(value))
    ? windowsPath(value)
    : String(value);
const sameArgs = (left, right) =>
  Array.isArray(left) &&
  left.length === right.length &&
  left.every((arg, index) => argument(arg) === argument(right[index]));
async function readStartupCommands(names) {
  const script = await fs.readFile(
    path.join(__dirname, "startup-commands.ps1"),
    "utf8",
  );
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
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error)
          return reject(
            Error("Windows startup commands could not be verified."),
          );
        try {
          const data = JSON.parse(stdout.trim());
          resolve(
            Array.isArray(data.commands)
              ? data.commands
              : data.commands
                ? [data.commands]
                : [],
          );
        } catch {
          reject(Error("Windows startup command data was unavailable."));
        }
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ names }));
  });
}
function createStartup({
  app,
  executable = process.execPath,
  name = STARTUP_NAME,
  migrateLegacy = true,
  readCommands = readStartupCommands,
}) {
  const appPath = app.getAppPath();
  const args = app.isPackaged ? ["--background"] : [appPath, "--background"];
  const options = { path: executable, args, name };
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const ownName = (item) =>
    String(item.name).toLowerCase() === name.toLowerCase();
  async function read() {
    const native = app.getLoginItemSettings({ path: executable, args });
    if (!Array.isArray(native.launchItems))
      throw Error("Windows startup details are unavailable.");
    const candidates = native.launchItems.filter(
      (item) =>
        item.scope === "user" &&
        windowsPath(item.path) === windowsPath(executable) &&
        (sameArgs(item.args, args) || sameArgs(item.args, positional)) &&
        (migrateLegacy || ownName(item)),
    );
    const commands = candidates.length
      ? await readCommands(candidates.map((item) => item.name))
      : [];
    const items = candidates.filter((item) =>
      commands.some(
        (command) =>
          String(command.name).toLowerCase() ===
            String(item.name).toLowerCase() && exactCommand(command),
      ),
    );
    const own = items.find(ownName);
    return {
      available: true,
      registered: items.length > 0,
      enabled: items.some((item) => item.enabled === true),
      ownEnabled: own?.enabled === true,
      legacy: items.some((item) => !ownName(item)),
      items,
    };
  }
  const exactCommand = (command) =>
    windowsPath(command.path) === windowsPath(executable) &&
    sameArgs(command.args, args);
  async function set(enabled) {
    if (typeof enabled !== "boolean")
      throw TypeError("Choose whether to start with Windows.");
    const before = await read();
    const legacy = before.items.filter((item) => !ownName(item));
    const legacyCommands = legacy.length
      ? await readCommands(legacy.map((item) => item.name))
      : [];
    app.setLoginItemSettings({
      ...options,
      openAtLogin: enabled,
      enabled: true,
    });
    let launch;
    if (enabled) {
      const ownCommands = await readCommands([name]);
      launch = ownCommands.find(
        (command) => ownName(command) && exactCommand(command),
      );
      if (!launch || !(await read()).ownEnabled)
        throw Error(
          "Windows did not enable Vacuum at sign-in. Check Windows startup settings.",
        );
    }
    for (const item of legacy.filter((item) =>
      legacyCommands.some(
        (command) =>
          String(command.name).toLowerCase() ===
            String(item.name).toLowerCase() && exactCommand(command),
      ),
    )) {
      // Re-read ownership before removing a legacy alias; shared Electron
      // executables with other app arguments are never treated as Vacuum.
      if ((await read()).items.some((current) => current.name === item.name))
        app.setLoginItemSettings({
          ...options,
          name: item.name,
          openAtLogin: false,
        });
    }
    const actual = await read();
    if (actual.enabled !== enabled)
      throw Error(
        "Windows startup did not match the requested setting. Refresh and check its status.",
      );
    return { ...actual, launch };
  }
  return { read, set, options };
}
module.exports = { createStartup, STARTUP_NAME };
