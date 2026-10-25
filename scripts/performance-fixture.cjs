const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = process.argv[2];
const mode = process.argv[3];
global.fixtureMemory = Buffer.alloc(64 * 1024 * 1024, 1);
fs.mkdirSync(root, { recursive: true });
const server = http.createServer((_request, response) =>
  response.end("Vacuum synthetic performance fixture"),
);
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(
    path.join(root, "ready.json"),
    JSON.stringify({ pid: process.pid, port: server.address().port }),
  );
});
if (mode === "window") {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", path.join(root, "profile"));
  app.whenReady().then(() => {
    const window = new BrowserWindow({
      width: 360,
      height: 180,
      title: "Vacuum performance test",
      webPreferences: { sandbox: true },
    });
    global.fixtureWindow = window;
    window.once("ready-to-show", () => {
      window.show();
      fs.writeFileSync(path.join(root, "window-ready"), "ready");
    });
    window.loadURL(
      "data:text/html,<body style='font:16px Segoe UI;padding:24px'>Synthetic performance test.<p>No user work is open.</p></body>",
    );
    window.on("close", (event) => {
      if (!fs.existsSync(path.join(root, "allow-close")))
        event.preventDefault();
    });
  });
  app.on("window-all-closed", () => server.close(() => app.quit()));
}
