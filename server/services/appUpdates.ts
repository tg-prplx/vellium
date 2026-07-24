import packageMetadata from "../../package.json";
import type { AppUpdateInfo } from "../../src/shared/types/contracts.js";

const DEFAULT_RELEASE_REPOSITORY = "tg-prplx/vellium";
const UPDATE_CHECK_TIMEOUT_MS = 5_000;
const UPDATE_CACHE_TTL_MS = 60 * 60 * 1_000;
const UPDATE_FAILURE_BACKOFF_MS = 5 * 60 * 1_000;
const MAX_RELEASE_RESPONSE_BYTES = 1_000_000;

type GithubLatestRelease = {
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let cachedUpdate: { expiresAt: number; value: AppUpdateInfo } | null = null;
let pendingUpdate: Promise<AppUpdateInfo> | null = null;
let failedUntil = 0;

function normalizeVersion(value: unknown): string {
  return String(value || "").trim().replace(/^v(?=\d)/i, "");
}

function releaseRepository(): string {
  const configured = String(process.env.SLV_UPDATE_REPOSITORY || "").trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configured)
    ? configured
    : DEFAULT_RELEASE_REPOSITORY;
}

export function buildAppUpdateInfo(
  currentVersionRaw: unknown,
  release: GithubLatestRelease,
  repository = DEFAULT_RELEASE_REPOSITORY
): AppUpdateInfo {
  const currentVersion = normalizeVersion(currentVersionRaw);
  if (typeof release.tag_name !== "string" || release.tag_name.length > 120) {
    throw new Error("GitHub release response is missing a valid version");
  }
  const latestVersion = normalizeVersion(release.tag_name);
  if (!currentVersion || !latestVersion) {
    throw new Error("GitHub release response is missing a valid version");
  }

  const releaseName = String(release.name || "").trim().slice(0, 200) || `v${latestVersion}`;
  const publishedAtRaw = String(release.published_at || "").trim();
  const publishedAt = publishedAtRaw && Number.isFinite(Date.parse(publishedAtRaw))
    ? new Date(publishedAtRaw).toISOString()
    : null;

  return {
    currentVersion,
    latestVersion,
    updateAvailable: currentVersion !== latestVersion,
    releaseName,
    releaseUrl: `https://github.com/${repository}/releases/tag/${encodeURIComponent(String(release.tag_name).trim())}`,
    publishedAt
  };
}

export async function fetchLatestAppUpdate(
  options: {
    fetchImpl?: FetchLike;
    currentVersion?: string;
    repository?: string;
    timeoutMs?: number;
  } = {}
): Promise<AppUpdateInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const repository = options.repository ?? releaseRepository();
  const currentVersion = options.currentVersion ?? packageMetadata.version;
  const controller = new AbortController();
  const timeoutMs = Math.max(500, Math.min(15_000, Math.floor(options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS)));
  const timeout = setTimeout(() => controller.abort(new Error("GitHub release check timed out")), timeoutMs);

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Vellium/${normalizeVersion(currentVersion) || "unknown"}`
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`GitHub release check failed with HTTP ${response.status}`);
    }

    const text = await response.text();
    if (text.length > MAX_RELEASE_RESPONSE_BYTES) {
      throw new Error("GitHub release response is too large");
    }
    const release = JSON.parse(text) as GithubLatestRelease;
    return buildAppUpdateInfo(currentVersion, release, repository);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLatestAppUpdate(): Promise<AppUpdateInfo> {
  const now = Date.now();
  if (cachedUpdate && cachedUpdate.expiresAt > now) return cachedUpdate.value;
  if (failedUntil > now) throw new Error("GitHub release check is temporarily unavailable");
  if (pendingUpdate) return pendingUpdate;

  pendingUpdate = fetchLatestAppUpdate()
    .then((value) => {
      failedUntil = 0;
      cachedUpdate = { expiresAt: Date.now() + UPDATE_CACHE_TTL_MS, value };
      return value;
    })
    .catch((error) => {
      failedUntil = Date.now() + UPDATE_FAILURE_BACKOFF_MS;
      throw error;
    })
    .finally(() => {
      pendingUpdate = null;
    });
  return pendingUpdate;
}
