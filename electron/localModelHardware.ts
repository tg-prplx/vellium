import { execFile } from "child_process";
import { readFile, readdir } from "fs/promises";
import os from "os";
import path from "path";
import type { LocalModelGpuDevice, LocalModelHardwareProfile } from "../src/shared/types/localModels";

const MIB = 1024 ** 2;
const SOFTWARE_GPU = /microsoft basic|remote display|swiftshader|llvmpipe|software|virtualbox|vmware/i;
type CommandProbe = (command: string, args: string[]) => Promise<string>;

/** Read-only, bounded probes; never invoke a shell or require administrator access. */
export const probeHardwareCommand: CommandProbe = (command, args) => new Promise((resolve) => {
  execFile(command, args, { timeout: 4_000, maxBuffer: 1024 ** 2, windowsHide: true, encoding: "utf8" },
    (error, stdout) => resolve(error ? "" : stdout));
});

export function parseNvidiaMemory(output: string): LocalModelGpuDevice[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/,\s*/);
    const free = Number(fields.pop());
    const total = Number(fields.pop());
    const name = fields.join(", ");
    if (!name || !Number.isFinite(total) || total <= 0) return [];
    return [{ name, memoryBytes: total * MIB, freeMemoryBytes: Number.isFinite(free) && free >= 0 && free <= total ? free * MIB : null }];
  });
}

export function parseWindowsGpuMemory(output: string): LocalModelGpuDevice[] {
  try {
    const parsed: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
    return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const bytes = Number(row.memoryBytes);
      if (!name || SOFTWARE_GPU.test(name)) return [];
      return [{ name, memoryBytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null, freeMemoryBytes: null }];
    });
  } catch { return []; }
}

export function parseMacGpuMemory(output: string): LocalModelGpuDevice[] {
  try {
    const payload = JSON.parse(output) as { SPDisplaysDataType?: Array<Record<string, unknown>> };
    return (payload.SPDisplaysDataType || []).flatMap((row) => {
      const name = String(row.sppci_model || "").trim();
      if (!name || SOFTWARE_GPU.test(name)) return [];
      const match = String(row.spdisplays_vram || "").match(/([\d.]+)\s*(MB|GB)/i);
      return [{ name, memoryBytes: match ? Number(match[1]) * (match[2].toUpperCase() === "GB" ? 1024 ** 3 : MIB) : null, freeMemoryBytes: null }];
    });
  } catch { return []; }
}

// AdapterRAM is a uint32 and truncates modern cards. Read the driver's QWORD
// value instead; an absent value is unknown VRAM, never "4 GB" by assumption.
const WINDOWS_GPU_PROBE = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$devices = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue)
$adapters = @(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue })
@($devices | ForEach-Object {
  $device = $_
  $adapter = $adapters | Where-Object { $_.MatchingDeviceId -and $device.PNPDeviceID -like ($_.MatchingDeviceId + '*') } | Select-Object -First 1
  $memory = $adapter.'HardwareInformation.qwMemorySize'
  if ($memory -is [byte[]] -and $memory.Length -eq 8) { $memory = [BitConverter]::ToUInt64($memory, 0) }
  [PSCustomObject]@{ name = $device.Name; memoryBytes = $memory }
}) | ConvertTo-Json -Compress
`;

async function linuxGpuMemory(): Promise<LocalModelGpuDevice[]> {
  try {
    const cards = (await readdir("/sys/class/drm")).filter((name) => /^card\d+$/.test(name));
    return (await Promise.all(cards.map(async (card) => {
      const root = `/sys/class/drm/${card}/device`;
      const [vendor, bytes, free] = await Promise.all([
        readFile(`${root}/vendor`, "utf8"),
        readFile(`${root}/mem_info_vram_total`, "utf8").catch(() => ""),
        readFile(`${root}/mem_info_vram_used`, "utf8").catch(() => "")
      ]);
      const total = Number(bytes);
      return { name: `${vendor.trim() === "0x1002" ? "AMD" : vendor.trim() === "0x8086" ? "Intel" : vendor.trim() === "0x10de" ? "NVIDIA" : "Unknown"} (${card})`,
        memoryBytes: total > 0 ? total : null, freeMemoryBytes: total > 0 && free.trim() && Number(free) <= total ? total - Number(free) : null };
    }))).filter((device) => !device.name.startsWith("Unknown"));
  } catch { return []; }
}

export interface HardwareDetectionOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  memoryBytes?: number;
  gpuInfo: () => Promise<unknown>;
  commandProbe?: CommandProbe;
  linuxProbe?: () => Promise<LocalModelGpuDevice[]>;
}

export async function detectLocalModelHardware(options: HardwareDetectionOptions): Promise<LocalModelHardwareProfile> {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const memoryBytes = options.memoryBytes ?? os.totalmem();
  const run = options.commandProbe || probeHardwareCommand;
  const [native, nvidia, electron] = await Promise.all([
    platform === "win32" ? run(path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_GPU_PROBE]).then(parseWindowsGpuMemory)
      : platform === "darwin" ? run("/usr/sbin/system_profiler", ["SPDisplaysDataType", "-json"]).then(parseMacGpuMemory)
      : (options.linuxProbe || linuxGpuMemory)(),
    platform === "darwin" ? Promise.resolve([]) : run("nvidia-smi", ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"]).then(parseNvidiaMemory),
    boundedGpuInfo(options.gpuInfo)
  ]);
  const fallback = (electron.gpuDevice || []).flatMap((device) => {
    const vendor = Number(device.vendorId);
    const name = String(device.deviceString || device.vendorString || ({ 0x10de: "NVIDIA GPU", 0x1002: "AMD GPU", 0x8086: "Intel GPU", 0x106b: "Apple GPU" } as Record<number, string>)[vendor] || "");
    return name && !SOFTWARE_GPU.test(name) ? [{ name, memoryBytes: null, freeMemoryBytes: null }] : [];
  });
  // NVIDIA's driver reports current free VRAM. Do not count its CIM row twice.
  const devices = [...nvidia, ...native.filter((gpu) => !nvidia.length || !/nvidia/i.test(gpu.name))];
  if (!devices.length) devices.push(...fallback);
  const unifiedMemory = platform === "darwin" && arch === "arm64";
  if (unifiedMemory && !devices.length) devices.push({ name: "Apple GPU", memoryBytes: null, freeMemoryBytes: null });
  const best = [...devices].sort((a, b) => (b.memoryBytes || 0) - (a.memoryBytes || 0))[0];
  return { platform, arch, memoryBytes, gpuDevices: devices, unifiedMemory,
    gpuLabel: devices.map((device) => device.name).join(", ") || "CPU",
    gpuMemoryBytes: unifiedMemory ? null : best?.memoryBytes ?? null,
    gpuMemoryFreeBytes: unifiedMemory ? null : best?.freeMemoryBytes ?? null,
    accelerator: devices.length ? platform === "darwin" ? "metal" : "vulkan" : "cpu" };
}

async function boundedGpuInfo(probe: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    const result = await Promise.race([probe(), new Promise((resolve) => { timer = setTimeout(() => resolve({}), 4_000); })]);
    return (result && typeof result === "object" ? result : {}) as {
      gpuDevice?: Array<{ vendorId?: number; deviceString?: string; vendorString?: string }>;
    };
  } catch { return {}; }
  finally { clearTimeout(timer!); }
}
