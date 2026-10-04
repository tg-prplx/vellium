#!/usr/bin/env node
/**
 * Dependency audit gate. Equivalent to `npm audit --audit-level=low`, except
 * for advisories listed below that have no patched release. An allowlisted
 * advisory still fails the gate if it reaches production dependencies, hits
 * another package, or its review date has passed.
 */
const { spawnSync } = require("child_process");

const ALLOWED_ADVISORIES = [
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    packages: ["braces"],
    reviewBy: "2027-01-04",
    reason: "braces <=3.0.3 has no patched release; it is only reachable through the tailwindcss@3 build toolchain, whose glob patterns come from our own config. Remove after migrating to Tailwind 4."
  }
];
const FAILING_SEVERITIES = new Set(["low", "moderate", "high", "critical"]);

function runAudit(extraArgs) {
  const result = spawnSync(`npm audit --json ${extraArgs.join(" ")}`.trim(), {
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(`npm audit did not return JSON (exit ${result.status}): ${String(result.stderr || result.stdout).slice(0, 2000)}`);
  }
  if (report.error) {
    throw new Error(`npm audit failed: ${JSON.stringify(report.error).slice(0, 2000)}`);
  }
  return report;
}

function collectAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (!via || typeof via !== "object") continue;
      if (!FAILING_SEVERITIES.has(String(via.severity))) continue;
      const id = String(via.url || "").split("/").pop() || String(via.source);
      const entry = advisories.get(id) || { id, title: via.title, severity: via.severity, packages: new Set() };
      entry.packages.add(String(via.name || vulnerability.name));
      advisories.set(id, entry);
    }
  }
  return advisories;
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const allowedById = new Map(ALLOWED_ADVISORIES.map((entry) => [entry.id, entry]));
  const all = collectAdvisories(runAudit([]));
  const production = collectAdvisories(runAudit(["--omit=dev"]));
  const failures = [];

  for (const advisory of all.values()) {
    const allowed = allowedById.get(advisory.id);
    const label = `${advisory.id} (${advisory.severity}) in ${[...advisory.packages].join(", ")}: ${advisory.title}`;
    if (!allowed) {
      failures.push(label);
      continue;
    }
    if (today > allowed.reviewBy) {
      failures.push(`${label} — allowlist entry expired on ${allowed.reviewBy}; re-review it`);
    } else if ([...advisory.packages].some((name) => !allowed.packages.includes(name))) {
      failures.push(`${label} — affects packages outside the allowlist entry`);
    } else if (production.has(advisory.id)) {
      failures.push(`${label} — now reachable from production dependencies`);
    } else {
      console.log(`Allowed (dev-only, review by ${allowed.reviewBy}): ${label}\n  ${allowed.reason}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Dependency audit failed:\n${failures.map((line) => `  - ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Dependency audit passed (${all.size} advisories checked).`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
