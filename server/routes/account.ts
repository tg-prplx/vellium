import { Router } from "express";
import { db, newId, now, hashSecret } from "../db.js";

const router = Router();

router.post("/create", (req, res) => {
  const { password, recoveryKey } = req.body as { password: string; recoveryKey?: string };
  const id = newId();
  const passwordHash = hashSecret(password);
  const recoveryHash = recoveryKey ? hashSecret(recoveryKey) : null;

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

  const passOk = hashSecret(password) === row.password_hash;
  const recoveryOk = recoveryKey && row.recovery_hash ? hashSecret(recoveryKey) === row.recovery_hash : false;

  res.json(passOk || recoveryOk);
});

router.post("/rotate-recovery", (req, res) => {
  const { newRecoveryKey } = req.body as { newRecoveryKey: string };
  const hash = hashSecret(newRecoveryKey);

  db.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = (SELECT id FROM accounts ORDER BY created_at DESC LIMIT 1)")
    .run(hash);

  res.json({ ok: true });
});

export default router;
