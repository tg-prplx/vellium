import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceCommandEnv,
  isAutoApprovedWorkspaceCommand,
  isInlineInterpreterCommand,
  isProtectedWorkspaceMetadataPath
} from "./workspaceCommandPolicy.js";
import { classifyWorkspaceCommandRisk, describeBlockedWorkspaceCommand } from "./workspaceTools.js";

const rootDir = resolve("/tmp/vellium-workspace");
const lockedPolicy = {
  allowDangerousFileOps: false,
  allowNetworkCommands: false,
  allowShellCommands: false,
  allowGitWriteCommands: false
};

describe("isInlineInterpreterCommand", () => {
  it("detects clustered and alternate inline-eval flags", () => {
    expect(isInlineInterpreterCommand("node", ["-p", "1"])).toBe(true);
    expect(isInlineInterpreterCommand("node", ["--print=1"])).toBe(true);
    expect(isInlineInterpreterCommand("python3", ["-cimport os"])).toBe(true);
    expect(isInlineInterpreterCommand("python3", ["-bc", "x"])).toBe(true);
    expect(isInlineInterpreterCommand("perl", ["-ne", "print"])).toBe(true);
    expect(isInlineInterpreterCommand("node", ["script.js"])).toBe(false);
    expect(isInlineInterpreterCommand("python3", ["-m", "pytest"])).toBe(false);
  });
});

describe("workspace command auto-approval", () => {
  it("auto-approves read-only commands confined to the workspace", () => {
    expect(isAutoApprovedWorkspaceCommand({ command: "grep", args: ["name", "package.json"], rootDir })).toBe(true);
    expect(isAutoApprovedWorkspaceCommand({ command: "git", args: ["status", "--short"], rootDir })).toBe(true);
    expect(isAutoApprovedWorkspaceCommand({ command: "find", args: [".", "-name", "*.ts"], rootDir })).toBe(true);
    expect(isAutoApprovedWorkspaceCommand({ command: "cat", args: ["src/../README.md"], rootDir })).toBe(true);
  });

  it("requires confirmation for anything that can execute code or leave the workspace", () => {
    const cases: Array<[string, string[]]> = [
      ["node", ["-p", "require('child_process').execSync('id')"]],
      ["python3", ["-cimport os"]],
      ["env", ["bash", "-c", "id"]],
      ["find", [".", "-exec", "sh", "-c", "id", ";"]],
      ["awk", ["BEGIN{system(\"id\")}"]],
      ["npm", ["exec", "--yes", "cowsay"]],
      ["rg", ["--pre", "./x", "foo"]],
      ["git", ["-c", "core.pager=sh", "log"]],
      ["git", ["log", "--output=../x"]],
      ["git", ["branch", "evil"]],
      ["cat", ["/etc/passwd"]],
      ["cat", ["~/.ssh/id_ed25519"]],
      ["head", ["../../outside.txt"]],
      ["./script.sh", []]
    ];
    for (const [command, args] of cases) {
      expect(isAutoApprovedWorkspaceCommand({ command, args, rootDir }), `${command} ${args.join(" ")}`).toBe(false);
      expect(classifyWorkspaceCommandRisk({ command, args, rootDir }), `${command} ${args.join(" ")}`).not.toBeNull();
    }
  });

  it("rejects auto-approval when cwd escapes the workspace", () => {
    expect(isAutoApprovedWorkspaceCommand({ command: "ls", args: [], rootDir, cwd: "../.." })).toBe(false);
  });

  it("blocks inline interpreter bypasses when shell commands are disabled", () => {
    expect(describeBlockedWorkspaceCommand({ command: "node", args: ["-p", "1"], policy: lockedPolicy })).toContain("Inline script execution");
    expect(describeBlockedWorkspaceCommand({ command: "python3", args: ["-cimport os"], policy: lockedPolicy })).toContain("Inline script execution");
    expect(classifyWorkspaceCommandRisk({ command: "node", args: ["-p", "1"] })).toBe("shell_escape");
  });
});

describe("workspace metadata and environment", () => {
  it("protects .git metadata from workspace edit tools", () => {
    expect(isProtectedWorkspaceMetadataPath(rootDir, resolve(rootDir, ".git/config"))).toBe(true);
    expect(isProtectedWorkspaceMetadataPath(rootDir, resolve(rootDir, "pkg/.GIT/hooks/pre-commit"))).toBe(true);
    expect(isProtectedWorkspaceMetadataPath(rootDir, resolve(rootDir, ".gitignore"))).toBe(false);
  });

  it("strips server credentials from command environments", () => {
    const env = buildWorkspaceCommandEnv({ SLV_BASIC_AUTH: "admin:secret", PATH: "/usr/bin" });
    expect(env.SLV_BASIC_AUTH).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});
