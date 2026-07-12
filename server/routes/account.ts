import { Router } from "express";
import { db, newId, now, hashSecret, needsSecretRehash, verifySecret } from "../db.js";

const router = Router();

router.post("/create", (req, res) => {
  const { password, recoveryKey } = req.body as { password: string; recoveryKey?: string };
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

  const row = db.prepare("SELECT password_hash, recovery_hash FROM accounts ORDER BY created_at DESC LIMIT 1")
    .get() as { password_hash: string; recovery_hash: string | null } | undefined;

  if (!row) {
    res.json(false);
    return;
  }

  const passOk = verifySecret(password, row.password_hash);
  const recoveryOk = Boolean(recoveryKey && row.recovery_hash && verifySecret(recoveryKey, row.recovery_hash));

  if (passOk && needsSecretRehash(row.password_hash)) {
    db.prepare("UPDATE accounts SET password_hash = ? WHERE id = (SELECT id FROM accounts ORDER BY created_at DESC LIMIT 1)")
      .run(hashSecret(password));
  }
  if (recoveryOk && recoveryKey && row.recovery_hash && needsSecretRehash(row.recovery_hash)) {
    db.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = (SELECT id FROM accounts ORDER BY created_at DESC LIMIT 1)")
      .run(hashSecret(recoveryKey));
  }

  res.json(passOk || recoveryOk);
});

router.post("/rotate-recovery", (req, res) => {
  const { newRecoveryKey } = req.body as { newRecoveryKey: string };
  let hash: string;
  try {
    hash = hashSecret(newRecoveryKey);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid recovery key" });
    return;
  }

  db.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = (SELECT id FROM accounts ORDER BY created_at DESC LIMIT 1)")
    .run(hash);

  res.json({ ok: true });
});

export default router;
