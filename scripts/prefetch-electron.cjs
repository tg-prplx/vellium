#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const RETRY_DELAYS_MS = [0, 15_000, 30_000];
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "vellium-desktop-build",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (process.env.GITHUB_TOKEN) {
  API_HEADERS.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

function electronVersion() {
  const lock = JSON.parse(fs.readFileSync(path.resolve("package-lock.json"), "utf8"));
  const version = lock.packages?.["node_modules/electron"]?.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error("Could not resolve the installed Electron version from package-lock.json");
  }
  return version;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, init, label) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      console.log(`${label}: retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(60_000),
      });
      if (response.ok) {
        return response;
      }

      const error = new Error(`${label}: HTTP ${response.status}`);
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`${label}: request failed`);
}

async function resolveAsset(version, assetName) {
  const releaseResponse = await fetchWithRetry(
    `https://api.github.com/repos/electron/electron/releases/tags/v${version}`,
    { headers: API_HEADERS },
    "Electron release lookup",
  );
  const release = await releaseResponse.json();
  if (!Number.isInteger(release.id)) {
    throw new Error(`Electron release v${version} did not include a numeric release ID`);
  }

  for (let page = 1; page <= 5; page += 1) {
    const assetsResponse = await fetchWithRetry(
      `https://api.github.com/repos/electron/electron/releases/${release.id}/assets?per_page=100&page=${page}`,
      { headers: API_HEADERS },
      `Electron asset lookup (page ${page})`,
    );
    const assets = await assetsResponse.json();
    if (!Array.isArray(assets)) {
      throw new Error("Electron asset lookup returned an invalid response");
    }

    const asset = assets.find((candidate) => candidate?.name === assetName);
    if (asset && typeof asset.url === "string") {
      return asset;
    }
    if (assets.length < 100) {
      break;
    }
  }

  throw new Error(`Electron release v${version} does not contain ${assetName}`);
}

function cacheDestination(version, assetName) {
  const cacheRoot =
    process.env.electron_config_cache ||
    process.env.ELECTRON_CONFIG_CACHE ||
    path.resolve(".electron-cache");
  const releaseUrl = `https://github.com/electron/electron/releases/download/v${version}`;
  const cacheDirectory = crypto.createHash("sha256").update(releaseUrl).digest("hex");
  return path.resolve(cacheRoot, cacheDirectory, assetName);
}

async function isUsableZip(filePath) {
  try {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      const stats = await handle.stat();
      return (
        bytesRead === 4 &&
        signature[0] === 0x50 &&
        signature[1] === 0x4b &&
        stats.size > 1_000_000
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function downloadAsset(asset, targetPath) {
  const partialPath = `${targetPath}.partial`;
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  let lastError;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      console.log(
        `Electron asset download (${asset.name}): retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s`,
      );
      await sleep(RETRY_DELAYS_MS[attempt]);
    }

    await fs.promises.rm(partialPath, { force: true });
    try {
      console.log(`Downloading ${asset.name} through the official GitHub API`);
      const response = await fetch(asset.url, {
        headers: {
          ...API_HEADERS,
          Accept: "application/octet-stream",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!response.ok) {
        throw new Error(`Electron asset download (${asset.name}): HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error(`Electron asset download (${asset.name}) returned an empty body`);
      }

      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partialPath));
      if (!(await isUsableZip(partialPath))) {
        throw new Error(`Electron asset download (${asset.name}) did not produce a valid ZIP`);
      }
      await fs.promises.rename(partialPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      await fs.promises.rm(partialPath, { force: true });
    }
  }

  throw lastError ?? new Error(`Electron asset download (${asset.name}) failed`);
}

async function main() {
  const version = electronVersion();
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const assetName = `electron-v${version}-${platform}-${arch}.zip`;
  const targetPath = cacheDestination(version, assetName);

  if (await isUsableZip(targetPath)) {
    console.log(`Electron cache is ready: ${assetName}`);
    return;
  }

  const asset = await resolveAsset(version, assetName);
  await downloadAsset(asset, targetPath);
  console.log(`Electron cached through the GitHub API: ${assetName}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
