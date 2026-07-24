#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const inspection = spawnSync("/usr/bin/codesign", ["-dvv", appPath], {
    encoding: "utf8"
  });
  const details = `${inspection.stdout || ""}\n${inspection.stderr || ""}`;
  const teamIdentifier = /TeamIdentifier=([^\s]+)/.exec(details)?.[1] || "";

  // Preserve a real Apple-issued signature. Local/CI builds without one still
  // need a sealed bundle so macOS can associate Local Network privacy with the
  // responsible Vellium application instead of an unbound Electron executable.
  if (teamIdentifier && teamIdentifier !== "not") return;

  const signing = spawnSync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appPath
  ], {
    encoding: "utf8"
  });
  if (signing.status !== 0) {
    const output = `${signing.stdout || ""}\n${signing.stderr || ""}`.trim();
    throw new Error(`Failed to ad-hoc sign ${appPath}: ${output}`);
  }
};
