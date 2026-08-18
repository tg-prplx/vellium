const { execFileSync } = require("node:child_process");

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024
}).split("\0").filter(Boolean);

const forbidden = trackedFiles.filter((file) => {
  const segments = file.split("/");
  const basename = segments.at(-1) || "";

  return segments.includes(".agentcli")
    || segments[0] === "data"
    || ["output", "release", "dist", "dist-electron"].includes(segments[0])
    || /\.(?:db|db-shm|db-wal|sqlite|sqlite3)$/i.test(basename)
    || /^\.env(?:\.|$)/i.test(basename) && !/^\.env\.example$/i.test(basename)
    || /\.(?:pem|p12|pfx)$/i.test(basename);
});

if (forbidden.length > 0) {
  console.error("Sensitive or generated artifacts are tracked by git:");
  for (const file of forbidden) console.error(`- ${file}`);
  console.error("Remove them from git history/state before building a release.");
  process.exit(1);
}

console.log(`Sensitive artifact check passed (${trackedFiles.length} tracked files).`);
