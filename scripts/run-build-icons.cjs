const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const iconScript = path.join(rootDir, "scripts", "generate-app-icons.py");

const candidates = [
  { cmd: "python3", args: [iconScript] },
  { cmd: "python", args: [iconScript] },
  { cmd: "py", args: ["-3", iconScript] }
];

for (const c of candidates) {
  const result = spawnSync(c.cmd, c.args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });
  if (result.status === 0) {
    process.exit(0);
  }
}

console.error("[icons] Failed to run Python icon generator.");
console.error("[icons] Install Python 3 + Pillow, then retry:");
console.error("[icons]   pip install pillow");
process.exit(1);
