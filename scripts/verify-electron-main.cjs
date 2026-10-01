const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");

const bundlePath = resolve(__dirname, "../dist-electron/main.cjs");
const bundle = readFileSync(bundlePath, "utf8");

if (!bundle.includes('require("@electron-internal/extract-zip")')) {
  throw new Error("Electron main must keep @electron-internal/extract-zip external");
}

if (/createRequire\)\(import_meta\d*\.url\)/.test(bundle) || /var import_meta\d* = \{\};/.test(bundle)) {
  throw new Error("Electron main contains a broken bundled import.meta URL");
}

// Exercise ZIP installation in a CommonJS bundle. Presence-only checks above
// cannot catch a default import being wrapped into a non-callable ESM namespace.
execFileSync(process.execPath, [
  resolve(__dirname, "../node_modules/vitest/vitest.mjs"),
  "run",
  "electron/localModelInstaller.test.ts"
], { cwd: resolve(__dirname, ".."), stdio: "inherit" });

console.log("Electron main bundle verification passed.");
