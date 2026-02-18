const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.SLV_SERVER_PORT || 3001);

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function listListeningPidsUnix(targetPort) {
  const res = run("lsof", ["-nP", `-iTCP:${targetPort}`, "-sTCP:LISTEN", "-t"]);
  if (res.status !== 0 || !res.stdout) return [];
  return [...new Set(
    res.stdout
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
  )];
}

function getCommandUnix(pid) {
  const res = run("ps", ["-p", String(pid), "-o", "command="]);
  return (res.stdout || "").trim();
}

function commandLooksProjectServer(command) {
  if (!command) return true;
  const lower = command.toLowerCase();
  return (
    lower.includes("server-bundle.mjs") ||
    lower.includes("server/index.ts") ||
    (lower.includes("tsx") && lower.includes("server")) ||
    lower.includes(projectRoot.toLowerCase())
  );
}

function isAliveUnix(pid) {
  const res = run("kill", ["-0", String(pid)]);
  return res.status === 0;
}

function killUnix(pid, signal) {
  run("kill", [`-${signal}`, String(pid)]);
}

function sleepMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Busy-wait for short periods; keeps script dependency-free.
  }
}

if (process.platform === "win32") {
  // No-op for now; dev context here is macOS.
  process.exit(0);
}

const pids = listListeningPidsUnix(port);
if (pids.length === 0) {
  process.exit(0);
}

const candidates = pids
  .map((pid) => ({ pid, command: getCommandUnix(pid) }))
  .filter(({ command }) => commandLooksProjectServer(command));

if (candidates.length === 0) {
  console.error(`[port] Port ${port} is busy by a non-project process. Stop it manually and retry.`);
  for (const { pid, command } of pids.map((pid) => ({ pid, command: getCommandUnix(pid) }))) {
    console.error(`[port] pid=${pid} cmd=${command || "<unknown>"}`);
  }
  process.exit(1);
}

for (const { pid, command } of candidates) {
  console.warn(`[port] Releasing port ${port}: pid=${pid} cmd=${command}`);
  killUnix(pid, "TERM");
}

sleepMs(400);

for (const { pid } of candidates) {
  if (isAliveUnix(pid)) {
    console.warn(`[port] Force killing pid=${pid}`);
    killUnix(pid, "KILL");
  }
}
