const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const iconScript = path.join(rootDir, "scripts", "generate-app-icons.py");

const configuredPython = String(process.env.PYTHON || "").trim();
const candidates = [];
if (configuredPython) {
  candidates.push({
    label: `PYTHON=${configuredPython}`,
    cmd: configuredPython,
    runArgs: [iconScript],
    pipArgs: ["-m", "pip", "install", "--upgrade", "pillow"]
  });
}
candidates.push(
  {
    label: "python",
    cmd: "python",
    runArgs: [iconScript],
    pipArgs: ["-m", "pip", "install", "--upgrade", "pillow"]
  },
  {
    label: "python3",
    cmd: "python3",
    runArgs: [iconScript],
    pipArgs: ["-m", "pip", "install", "--upgrade", "pillow"]
  },
  {
    label: "py -3",
    cmd: "py",
    runArgs: ["-3", iconScript],
    pipArgs: ["-3", "-m", "pip", "install", "--upgrade", "pillow"]
  }
);

function run(command, args) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env
  });
}

function printOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function isPillowMissing(result) {
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /No module named ['"]?PIL['"]?/i.test(text);
}

for (const candidate of candidates) {
  const firstRun = run(candidate.cmd, candidate.runArgs);
  printOutput(firstRun);
  if (firstRun.status === 0) process.exit(0);

  if (isPillowMissing(firstRun)) {
    console.error(`[icons] Pillow missing for ${candidate.label}. Installing...`);
    const pipRun = run(candidate.cmd, candidate.pipArgs);
    printOutput(pipRun);
    if (pipRun.status === 0) {
      const retryRun = run(candidate.cmd, candidate.runArgs);
      printOutput(retryRun);
      if (retryRun.status === 0) process.exit(0);
    }
  }
}

console.error("[icons] Failed to run Python icon generator.");
console.error("[icons] Install Python 3 + Pillow, then retry:");
console.error("[icons]   pip install pillow");
process.exit(1);
