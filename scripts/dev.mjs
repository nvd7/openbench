import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await new Promise((resolve, reject) => {
  const b = spawn(process.execPath, [path.join(root, "scripts/build.mjs")], { stdio: "inherit", cwd: root });
  b.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
});

const electron = spawn(
  process.platform === "win32" ? path.join(root, "node_modules/.bin/electron.cmd") : path.join(root, "node_modules/.bin/electron"),
  [root],
  { stdio: "inherit", cwd: root, shell: process.platform === "win32" },
);
electron.once("exit", (code) => process.exit(code ?? 0));
