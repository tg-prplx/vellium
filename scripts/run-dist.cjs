#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

const builderArgs = [...process.argv.slice(2)];
if (!builderArgs.includes("--publish")) {
  builderArgs.push("--publish", "never");
}

let exitCode = 0;

try {
  exitCode = run(npmBin, ["run", "build:desktop"]);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }

  exitCode = run(npxBin, ["electron-builder", ...builderArgs]);
  process.exitCode = exitCode;
} finally {
  const rebuildExitCode = run(npmBin, ["run", "rebuild:native"]);
  if (exitCode === 0 && rebuildExitCode !== 0) {
    process.exitCode = rebuildExitCode;
  }
}
