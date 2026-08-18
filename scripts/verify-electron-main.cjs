const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const bundlePath = resolve(__dirname, "../dist-electron/main.cjs");
const bundle = readFileSync(bundlePath, "utf8");

if (!bundle.includes('require("@electron-internal/extract-zip")')) {
  throw new Error("Electron main must keep @electron-internal/extract-zip external");
}

if (/createRequire\)\(import_meta\d*\.url\)/.test(bundle) || /var import_meta\d* = \{\};/.test(bundle)) {
  throw new Error("Electron main contains a broken bundled import.meta URL");
}

console.log("Electron main bundle verification passed.");
