/**
 * Tests for everything that does not need a registry: version classification,
 * the API comparison itself (against hand-written declaration files standing in
 * for two installed versions), the symbol usage index, and the blast-radius
 * verdict. The registry path is exercised against real releases by audit.mjs
 * and validated against real builds; see the README.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { declaredBump, compare, stripHiddenMembers } from "../lib/apidiff.mjs";
import { satisfies, resolveRange, lockedVersion } from "../lib/resolve.mjs";
import { indexRepo, packageOf } from "../lib/usage.mjs";
import { blast, liveness } from "../lib/blast.mjs";
import { reachability, siteIsLive } from "../lib/reach.mjs";

test("declared bump follows semver, including the 0.x rule", () => {
  assert.equal(declaredBump("1.2.3", "2.0.0"), "major");
  assert.equal(declaredBump("1.2.3", "1.3.0"), "minor");
  assert.equal(declaredBump("1.2.3", "1.2.4"), "patch");
  // Under 1.0.0 the minor position is the breaking one.
  assert.equal(declaredBump("0.390.0", "0.391.0"), "major");
  assert.equal(declaredBump("0.390.0", "0.390.1"), "minor");
});

test("package names are taken from specifiers, scoped or not", () => {
  assert.equal(packageOf("framer-motion"), "framer-motion");
  assert.equal(packageOf("lucide-react/icons/x"), "lucide-react");
  assert.equal(packageOf("@google/genai"), "@google/genai");
  assert.equal(packageOf("@google/genai/node"), "@google/genai");
  assert.equal(packageOf("./local"), null);
});

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test("the usage index records named, renamed, default and namespace imports", () => {
  const dir = repo({
    "src/a.jsx": `import { motion, AnimatePresence as AP } from "framer-motion";\n` +
                 `import Flow, { Handle } from "reactflow";\nimport "reactflow/dist/style.css";\n`,
    "src/b.tsx": `import * as Icons from "lucide-react";\nexport const x = <Icons.Heart/>;\n` +
                 `const y = Icons.X;\n`,
    "src/c.js": `const { z } = require("zod");\n`,
    "node_modules/ignored/index.js": `import { nope } from "framer-motion";\n`,
  });
  const u = indexRepo(dir);
  assert.deepEqual(Object.keys(u["framer-motion"]).sort(), ["AnimatePresence", "motion"]);
  assert.ok(u.reactflow.default && u.reactflow.Handle);
  assert.ok(u.reactflow["/dist/style.css#default"] === undefined, "side-effect import is not a default import");
  assert.deepEqual(Object.keys(u["lucide-react"]).sort(), ["Heart", "X"]);
  assert.deepEqual(Object.keys(u.zod), ["z"]);
  assert.equal(u["framer-motion"].motion[0], "src/a.jsx:1");
});

test("vendored copies are not counted as usage", () => {
  const dir = repo({ "node_modules/pkg/a.js": `import { a } from "framer-motion";\n` });
  assert.deepEqual(indexRepo(dir), {});
});

const release = {
  removed: [{ name: "Facebook", kind: "value" }],
  broken: [{ name: "AnimatePresence", kind: "value", why: "return type changed" }],
};

test("a removed export that the consumer imports breaks it", () => {
  const b = blast(release, { Facebook: ["src/a.jsx:47"], Heart: ["src/a.jsx:40"] });
  assert.equal(b.verdict, "breaks");
  assert.deepEqual(b.breaks.map(x => x.name), ["Facebook"]);
  assert.equal(b.untouched, 1);
});

test("a type-only change cannot fail a JavaScript consumer's build", () => {
  const b = blast(release, { AnimatePresence: ["src/a.jsx:3"] });
  assert.equal(b.verdict, "safe");
});

test("the same change in a TypeScript file is sent to a real type-check", () => {
  const b = blast(release, { AnimatePresence: ["src/a.tsx:3", "src/b.jsx:9"] });
  assert.equal(b.verdict, "type-check");
  assert.deepEqual(b.typeRisk[0].sites, ["src/a.tsx:3"]);
});

test("a wildcard re-export is reached by any removal", () => {
  const b = blast(release, { "*": ["src/index.ts:1"] });
  assert.equal(b.verdict, "breaks");
});

test("a release that touches nothing the consumer uses is safe, whatever its version says", () => {
  const b = blast({ removed: [{ name: "Chrome" }], broken: [] }, { Heart: ["a.jsx:1"] });
  assert.equal(b.verdict, "safe");
});

test("an unstable tag excuses the owner, not the consumer who used the symbol", () => {
  const b = blast({ removed: [], broken: [], unstable: [{ name: "Interactions", change: "removed" }] },
                  { Interactions: ["src/chat.ts:4"] });
  assert.equal(b.verdict, "breaks");
});

// Two "installed versions" of a package, written by hand.
function versions(oldDts, newDts) {
  const files = {};
  for (const [alias, text] of [["old-api", oldDts], ["new-api", newDts]]) {
    files[`node_modules/${alias}/package.json`] = JSON.stringify({ name: alias, version: "0.0.0", types: "index.d.ts" });
    files[`node_modules/${alias}/index.d.ts`] = text;
  }
  const dir = repo(files);
  stripHiddenMembers(dir);
  return compare(dir);
}

test("the checker finds removals, additions and incompatible changes", () => {
  const r = versions(
    `export declare function a(x: string): string;\nexport declare function gone(): void;\n` +
    `export interface Opts { url: string; retries?: number }\n`,
    `export declare function a(x: string, y: number): string;\nexport declare function added(): void;\n` +
    `export interface Opts { url: string; retries?: number }\n`);
  assert.deepEqual(r.removed.map(x => x.name), ["gone"]);
  assert.deepEqual(r.added.map(x => x.name), ["added"]);
  assert.deepEqual(r.broken.map(x => x.name), ["a"], "a new required parameter breaks callers");
  assert.equal(r.unchanged, 1);
  assert.equal(r.computed, "major");
});

test("a new optional parameter is compatible", () => {
  const r = versions(`export declare function a(x: string): string;\n`,
                     `export declare function a(x: string, y?: number): string;\n`);
  assert.equal(r.broken.length, 0);
  assert.notEqual(r.computed, "major");
});

test("a removal announced with @deprecated is not a surprise; one tagged @beta is exempt", () => {
  const r = versions(
    `/** @deprecated use B */\nexport declare const A: number;\n/** @beta */\nexport declare const Exp: number;\n` +
    `export declare const B: number;\n`,
    `export declare const B: number;\n`);
  assert.deepEqual(r.removed.map(x => [x.name, x.announced]), [["A", true]]);
  assert.deepEqual(r.unstable.map(x => x.name), ["Exp"]);
  assert.equal(r.computed, "minor", "nothing was removed without warning");
});

test("a tag outside the TSDoc release tags does not mark a symbol unstable", () => {
  // lucide-react puts "@preview ![img](data:...)" on every icon.
  const r = versions(`/** @preview ![img](data:image/svg+xml;base64,AA==) */\nexport declare const Facebook: number;\n` +
                     `export declare const Heart: number;\n`,
                     `export declare const Heart: number;\n`);
  assert.deepEqual(r.removed.map(x => x.name), ["Facebook"]);
  assert.equal(r.computed, "major");
});

test("identical classes with private members are not reported as broken", () => {
  const cls = `export declare class Client {\n  private secret;\n  #private;\n  get(id: string): Promise<string>;\n` +
    `  protected prepare(request: object, { url }: {\n    url: string;\n  }): void;\n}\n` +
    `export interface Options { client?: Client }\n`;
  const r = versions(cls, cls);
  assert.equal(r.broken.length, 0);
  assert.equal(r.computed, "patch");
});

test("identical declarations that use a unique symbol are not reported as broken", () => {
  const dts = `declare const brand: unique symbol;\ntype Default = typeof brand;\n` +
    `export declare function get<R = Default>(url: string): Promise<R extends Default ? string : R>;\n`;
  const r = versions(dts, dts);
  assert.equal(r.broken.length, 0);
  assert.equal(r.computed, "patch");
});

test("many broken exports are traced back to the one change behind them", () => {
  const before = `export declare enum Status { Ok = 200, NotFound = 404 }\n` +
    `export interface Config { onRedirect?: (details: { status: Status }) => void; list?: string[] }\n` +
    `export declare function merge(a: Config, b: Config): Config;\nexport declare function create(c?: Config): Promise<Config>;\n`;
  const after = before.replace("NotFound = 404 }", "NotFound = 404, Gone = 410 }");
  const r = versions(before, after);
  assert.ok(r.broken.length >= 3, "the enum, and everything that hands one to a callback");
  assert.equal(r.causes.length, 1);
  assert.equal(r.causes[0].what, "enum Status gained Gone");
});

test("a new required option is reported as required, not as a removal", () => {
  const r = versions(`export interface Opts { url: string }\nexport declare function get(o: Opts): void;\n`,
                     `export interface Opts { url: string; region: string }\nexport declare function get(o: Opts): void;\n`);
  assert.deepEqual(r.causes.map(c => c.what), ["Opts.region now required"]);
});

test("a changed generic type goes to review rather than being called a break", () => {
  const r = versions(`export interface Op<T> { result?: T }\n`,
                     `export interface Op<T> { result?: T; error?: string }\n`);
  assert.equal(r.broken.length, 0);
  assert.deepEqual(r.changed.map(x => x.name), ["Op"]);
});

test("ranges resolve the way npm would, including the 0.x caret", () => {
  const vs = ["0.446.0", "0.447.0", "0.447.1", "0.448.0", "1.0.0", "1.2.0", "2.0.0-beta.1"];
  assert.equal(resolveRange(vs, "^0.447.0"), "0.447.1");
  assert.equal(resolveRange(vs, "^1.0.0"), "1.2.0");
  assert.equal(resolveRange(vs, "~0.446.0"), "0.446.0");
  assert.equal(resolveRange(vs, "1.0.0"), "1.0.0");
  assert.ok(!satisfies("2.0.0", "^1.0.0"));
});

test("a lockfile out of sync with package.json loses to one that is in sync", () => {
  const dir = repo({
    "package.json": JSON.stringify({ dependencies: { "lucide-react": "latest", "@google/genai": "^1.52.0" } }),
    // npm ci would refuse this one: its root entry predates the genai dependency.
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
      "": { dependencies: { "lucide-react": "latest" } },
      "node_modules/lucide-react": { version: "0.484.0" } } }),
    "pnpm-lock.yaml": "importers:\n  .:\n    dependencies:\n      lucide-react:\n        specifier: latest\n        version: 0.577.0(react@19.2.0)\n",
  });
  const l = lockedVersion(dir, "lucide-react");
  assert.equal(l.version, "0.577.0");
  assert.equal(l.source, "pnpm-lock.yaml");
  assert.match(l.note, /package-lock\.json \(out of sync\) says 0\.484\.0/);
});

test("reachability follows imports from framework entry points, through path aliases", () => {
  const dir = repo({
    "tsconfig.json": `{ // comments are allowed here\n "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
    "app/page.tsx": `import Header from "@/components/header";\nexport default () => <Header/>;\n`,
    "components/header.tsx": `import { Menu } from "lucide-react";\nimport { cn } from "../lib/cn";\n`,
    "lib/cn.ts": `export const cn = () => "";\n`,
    "components/footer.tsx": `import { Github } from "lucide-react";\n`,
  });
  const r = reachability(dir);
  assert.ok(r.known);
  assert.deepEqual([...r.reachable].sort(), ["app/page.tsx", "components/header.tsx", "lib/cn.ts"]);
  assert.ok(!siteIsLive(r, "components/footer.tsx:1"));
});

test("a Vite app is entered through index.html", () => {
  const dir = repo({
    "index.html": `<script type="module" src="/src/main.jsx"></script>`,
    "src/main.jsx": `import App from "./App";\n`,
    "src/App.jsx": `export default () => null;\n`,
    "src/Unused.jsx": `export default () => null;\n`,
  });
  const r = reachability(dir);
  assert.ok(r.reachable.has("src/App.jsx"));
  assert.ok(!r.reachable.has("src/Unused.jsx"));
});

test("a break only in dead code is reported as such; one live site makes it a real break", () => {
  const b = blast({ removed: [{ name: "Github" }], broken: [] }, { Github: ["components/footer.tsx:2"] });
  const live = new Set(["app/page.tsx"]);
  assert.equal(liveness(b, s => live.has(s.replace(/:\d+$/, ""))).verdict, "breaks dead code");
  live.add("components/footer.tsx");
  assert.equal(liveness(b, s => live.has(s.replace(/:\d+$/, ""))).verdict, "breaks");
});
