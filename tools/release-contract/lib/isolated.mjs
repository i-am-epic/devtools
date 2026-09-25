/**
 * Run one comparison in its own process. A large package pair can hold
 * gigabytes of type graph, and a loop over many pairs must not accumulate it.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";

const CHECK = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "semver-check.mjs");

export function diffIsolated(pkg, from, to, root) {
  const out = execFileSync(process.execPath, ["--max-old-space-size=4096", CHECK, pkg, from, to, "--json"], {
    encoding: "utf8", timeout: 900_000, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, RELEASE_CONTRACT_WORK: root },
  });
  return JSON.parse(out);
}
