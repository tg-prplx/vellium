import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { applyMigrations } from "../../db/migrations.js";
it("creates novel storage on existing databases and safely upgrades partially created tables", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE novels (id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.prepare("INSERT INTO novels VALUES (?, ?, ?, ?, ?, ?)").run("synthetic", "Test", "{}", 0, "", "");
    applyMigrations(db); applyMigrations(db);
    expect(db.prepare("SELECT title, reading_cursor FROM novels WHERE id = ?").get("synthetic")).toEqual({ title: "Test", reading_cursor: null });
  } finally { db.close(); }
});
