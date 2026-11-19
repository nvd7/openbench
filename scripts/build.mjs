import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external: ["electron"],
  logLevel: "info",
};

await Promise.all([
  build({ ...common, entryPoints: [path.join(root, "src/main/index.cjs")], outfile: path.join(dist, "main.cjs") }),
  build({ ...common, entryPoints: [path.join(root, "src/preload/index.cjs")], outfile: path.join(dist, "preload.cjs") }),
]);

cpSync(path.join(root, "src/renderer"), path.join(dist, "renderer"), { recursive: true });
console.log("build complete -> dist/");
