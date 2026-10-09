import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  AppError,
  assertCanApprove,
  assertCanRequestChanges,
  assertCanSubmitVersion,
  civilDateAt,
  TIME_ZONE,
  type Clock,
  type CurrentVersion,
  type ScriptView,
  type VersionStatus,
} from "../domain/script.js";
import type { ScriptStore } from "./script-store.js";

interface ScriptRow {
  id: string;
  created_at: string;
}

interface VersionRow {
  id: number;
  version: number;
  content: string;
  status: VersionStatus;
  submitted_at: string;
  approved_at: string | null;
  reason: string | null;
  due_date: string | null;
  requested_at: string | null;
}

interface CurrentRow extends CurrentVersion {
  id: number;
}

export class SqliteScriptStore implements ScriptStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY,
        script_id TEXT NOT NULL REFERENCES scripts(id),
        version INTEGER NOT NULL CHECK (version > 0),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED')),
        submitted_at TEXT NOT NULL,
        approved_at TEXT,
        UNIQUE (script_id, version),
        UNIQUE (id, script_id)
      );
      CREATE TABLE IF NOT EXISTS change_requests (
        version_id INTEGER PRIMARY KEY,
        script_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        due_date TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        FOREIGN KEY (version_id, script_id) REFERENCES versions(id, script_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  create(content: string, clock: Clock): ScriptView {
    return this.write(() => {
      const now = clock.now();
      const nowIso = now.toISOString();
      const id = randomUUID();
      this.db.prepare("INSERT INTO scripts (id, created_at) VALUES (?, ?)").run(id, nowIso);
      this.db
        .prepare(
          `INSERT INTO versions (script_id, version, content, status, submitted_at)
           VALUES (?, 1, ?, 'SUBMITTED', ?)`,
        )
        .run(id, content, nowIso);
      return this.getAt(id, now);
    });
  }

  get(id: string, clock: Clock): ScriptView {
    return this.getAt(id, clock.now());
  }

  requestChanges(
    id: string,
    input: { version: number; reason: string; dueDate: string },
    clock: Clock,
  ): ScriptView {
    return this.write(() => {
      const now = clock.now();
      const current = this.getCurrent(id);
      assertCanRequestChanges(current, input.version, input.dueDate, now);
      this.db
        .prepare("UPDATE versions SET status = 'CHANGES_REQUESTED' WHERE id = ?")
        .run(current.id);
      this.db
        .prepare(
          `INSERT INTO change_requests (version_id, script_id, reason, due_date, requested_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(current.id, id, input.reason, input.dueDate, now.toISOString());
      return this.getAt(id, now);
    });
  }

  submitVersion(id: string, content: string, clock: Clock): ScriptView {
    return this.write(() => {
      const now = clock.now();
      const current = this.getCurrent(id);
      assertCanSubmitVersion(current, now);
      this.db
        .prepare(
          `INSERT INTO versions (script_id, version, content, status, submitted_at)
           VALUES (?, ?, ?, 'SUBMITTED', ?)`,
        )
        .run(id, current.version + 1, content, now.toISOString());
      return this.getAt(id, now);
    });
  }

  approve(id: string, version: number, clock: Clock): ScriptView {
    return this.write(() => {
      const now = clock.now();
      const current = this.getCurrent(id);
      assertCanApprove(current, version);
      this.db
        .prepare("UPDATE versions SET status = 'APPROVED', approved_at = ? WHERE id = ?")
        .run(now.toISOString(), current.id);
      return this.getAt(id, now);
    });
  }

  private getCurrent(id: string): CurrentRow {
    const row = this.db
      .prepare(
        `SELECT v.id, v.version, v.status, cr.due_date AS dueDate
         FROM versions v
         LEFT JOIN change_requests cr ON cr.version_id = v.id
         WHERE v.script_id = ?
         ORDER BY v.version DESC
         LIMIT 1`,
      )
      .get(id) as CurrentRow | undefined;
    if (row) return row;

    const exists = this.db.prepare("SELECT 1 AS found FROM scripts WHERE id = ?").get(id);
    if (!exists) throw new AppError("SCRIPT_NOT_FOUND", 404, "Roteiro não encontrado.");
    throw new AppError("INTERNAL_ERROR", 500, "Roteiro sem versão inicial.");
  }

  private getAt(id: string, now: Date): ScriptView {
    const script = this.db.prepare("SELECT id, created_at FROM scripts WHERE id = ?").get(id) as
      | ScriptRow
      | undefined;
    if (!script) throw new AppError("SCRIPT_NOT_FOUND", 404, "Roteiro não encontrado.");

    const rows = this.db
      .prepare(
        `SELECT v.id, v.version, v.content, v.status, v.submitted_at, v.approved_at,
                cr.reason, cr.due_date, cr.requested_at
         FROM versions v
         LEFT JOIN change_requests cr ON cr.version_id = v.id
         WHERE v.script_id = ?
         ORDER BY v.version ASC`,
      )
      .all(id) as unknown as VersionRow[];

    const current = rows.at(-1);
    if (!current) throw new AppError("INTERNAL_ERROR", 500, "Roteiro sem versão inicial.");

    const versions = rows.map((row) => ({
      version: row.version,
      content: row.content,
      status: row.status,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      review:
        row.reason === null || row.due_date === null || row.requested_at === null
          ? null
          : { reason: row.reason, dueDate: row.due_date, requestedAt: row.requested_at },
    }));
    const pendingRequestExpired =
      current.status === "CHANGES_REQUESTED" &&
      current.due_date !== null &&
      civilDateAt(now) > current.due_date;

    return {
      id: script.id,
      createdAt: script.created_at,
      status: current.status,
      currentVersion: current.version,
      timezone: TIME_ZONE,
      pendingRequestExpired,
      versions,
    };
  }

  private write<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
