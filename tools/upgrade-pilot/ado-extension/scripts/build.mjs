import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  outfile: resolve(root, "dist/main.js"),
  nodePaths: [resolve(root, "node_modules")],
  alias: {
    "azure-devops-extension-sdk": resolve(root, "node_modules/azure-devops-extension-sdk/esm/SDK.min.js"),
    "jszip": resolve(root, "node_modules/jszip/dist/jszip.min.js"),
  },
  format: "iife",
  target: "es2020",
  minify: true,
  sourcemap: true,
});

await Promise.all([
  cp(resolve(root, "src/index.html"), resolve(root, "dist/index.html")),
  cp(resolve(root, "src/styles.css"), resolve(root, "dist/styles.css")),
]);