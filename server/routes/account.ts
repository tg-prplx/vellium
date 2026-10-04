import { Router } from "express";
import { db, newId, now, hashSecret, needsSecretRehash, verifySecret } from "../db.js";

const router = Router();

const FREE_UNLOCK_ATTEMPTS = 5;
const UNLOCK_BASE_DELAY_MS = 30_000;
const UNLOCK_MAX_DELAY_MS = 15 * 60_000;

// One local account exists per data directory, so throttling is global rather than per client.
const unlockThrottle = { failures: 0, lockedUntil: 0 };

interface AccountRow {
  id: string;
  password_hash: string;
  recovery_hash: string | null;
}

function getLatestAccount(): AccountRow | undefined {
  return db.prepare("SELECT id, password_hash, recovery_hash FROM accounts ORDER BY created_at DESC LIMIT 1")
    .get() as AccountRow | undefined;
}

function verifyAccountSecrets(row: AccountRow, password: unknown, recoveryKey: unknown) {
  const passOk = typeof password === "string" && verifySecret(password, row.password_hash);
  const recoveryOk = typeof recoveryKey === "string"
    && Boolean(row.recovery_hash)
    && verifySecret(recoveryKey, row.recovery_hash as string);
  return { passOk, recoveryOk };
}

function registerUnlockFailure() {
  unlockThrottle.failures += 1;
  const excess = unlockThrottle.failures - FREE_UNLOCK_ATTEMPTS;
  if (excess >= 0) {
    const delay = Math.min(UNLOCK_MAX_DELAY_MS, UNLOCK_BASE_DELAY_MS * 2 ** excess);
    unlockThrottle.lockedUntil = Date.now() + delay;
  }
}

export function resetAccountUnlockThrottle() {
  unlockThrottle.failures = 0;
  unlockThrottle.lockedUntil = 0;
}

router.post("/create", (req, res) => {
  const { password, recoveryKey } = req.body as { password: string; recoveryKey?: string };
  // A second account would silently replace the active one, so creation is first-run only.
  if (getLatestAccount()) {
    res.status(409).json({ error: "Account already exists" });
    return;
  }
  let passwordHash: string;
  let recoveryHash: string | null;
  try {
    passwordHash = hashSecret(password);
    recoveryHash = recoveryKey ? hashSecret(recoveryKey) : null;
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid account secret" });
    return;
  }
  const id = newId();

  db.prepare("INSERT INTO accounts (id, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, passwordHash, recoveryHash, now());

  res.json(id);
});

router.post("/unlock", (req, res) => {
  const { password, recoveryKey } = req.body as { password: string; recoveryKey?: string };

  const retryAfterMs = unlockThrottle.lockedUntil - Date.now();
  if (retryAfterMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({ error: "Too many failed unlock attempts" });
    return;
  }

  const row = getLatestAccount();
  if (!row) {
    res.json(false);
    return;
  }

  const { passOk, recoveryOk } = verifyAccountSecrets(row, password, recoveryKey);

  if (passOk && needsSecretRehash(row.password_hash)) {
    db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(hashSecret(password), row.id);
  }
  if (recoveryOk && recoveryKey && row.recovery_hash && needsSecretRehash(row.recovery_hash)) {
    db.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = ?").run(hashSecret(recoveryKey), row.id);
  }

  if (passOk || recoveryOk) {
    resetAccountUnlockThrottle();
  } else {
    registerUnlockFailure();
  }
  res.json(passOk || recoveryOk);
});

router.post("/rotate-recovery", (req, res) => {
  const { newRecoveryKey, password, recoveryKey } = req.body as {
    newRecoveryKey: string;
    password?: string;
    recoveryKey?: string;
  };
  const row = getLatestAccount();
  if (!row) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const { passOk, recoveryOk } = verifyAccountSecrets(row, password, recoveryKey);
  if (!passOk && !recoveryOk) {
    res.status(403).json({ error: "Current password or recovery key is required" });
    return;
  }
  let hash: string;
  try {
    hash = hashSecret(newRecoveryKey);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid recovery key" });
    return;
  }

  db.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = ?").run(hash, row.id);

  res.json({ ok: true });
});

export default router;
