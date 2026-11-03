// Opens a VS Code test window with the Maham Code extension loaded, without
// attaching a debugger to it. Attaching one crashes the window on some setups,
// so F5 runs this script instead of a normal extension debug session.
const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

spawn(
  "code",
  ["--new-window", "--disable-extensions", `--extensionDevelopmentPath=${path.join(root, "vscode-extension")}`, root],
  { shell: true, detached: true, stdio: "ignore" }
).unref();

console.log("Opened a test window with Maham Code loaded.");
