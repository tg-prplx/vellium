const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

function hasAbiMismatchOutput(output) {
  const text = String(output || "");
  return (
    text.includes("ERR_DLOPEN_FAILED") ||
    text.includes("NODE_MODULE_VERSION")
  );
}

function probeBetterSqlite3() {
  const testCode = [
    "const Database = require('better-sqlite3');",
    "const db = new Database(':memory:');",
    "db.prepare('select 1 as ok').get();",
    "db.close();"
  ].join(" ");

  const probe = spawnSync(process.execPath, ["-e", testCode], {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  });

  return {
    ok: probe.status === 0,
    status: probe.status,
    signal: probe.signal,
    stdout: probe.stdout || "",
    stderr: probe.stderr || ""
  };
}

const initialProbe = probeBetterSqlite3();
if (initialProbe.ok) {
  process.exit(0);
}

const initialOutput = `${initialProbe.stdout}\n${initialProbe.stderr}`;
const shouldRebuild =
  Boolean(initialProbe.signal) || hasAbiMismatchOutput(initialOutput);

if (!shouldRebuild) {
  if (initialOutput.trim()) {
    console.error(initialOutput.trim());
  }
  process.exit(initialProbe.status ?? 1);
}

console.warn(
  "[native] better-sqlite3 ABI mismatch detected. Running `npm rebuild better-sqlite3`..."
);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const rebuild = spawnSync(npmCommand, ["rebuild", "better-sqlite3"], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env
});

if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}

const postRebuildProbe = probeBetterSqlite3();
if (!postRebuildProbe.ok) {
  const postOutput = `${postRebuildProbe.stdout}\n${postRebuildProbe.stderr}`.trim();
  if (postOutput) {
    console.error(postOutput);
  }
  console.error("[native] better-sqlite3 still failed to load after rebuild.");
  process.exit(1);
}

console.log("[native] better-sqlite3 rebuilt successfully for current Node ABI.");
