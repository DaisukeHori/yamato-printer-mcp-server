/**
 * ジョブキューサービス (SQLite)
 *
 * 印刷ジョブを SQLite で管理し、状態遷移を記録する。
 *
 * 状態遷移:
 *   pending → converting → printing → completed
 *                                    → failed
 */

import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "fs";
import { dirname } from "path";
import pino from "pino";
import type { Job, JobStatus, CreateJobInput } from "../types.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "job-queue" });

let db: Database.Database | null = null;

/**
 * DB初期化。main startup から1度だけ呼ぶ。
 */
export function initializeJobDatabase(): void {
  const dbPath =
    process.env.JOB_DB_PATH || "/var/lib/yamato-printer-mcp/jobs.db";

  // 親ディレクトリが存在しない場合は作成
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch (err) {
    logger.warn({ err, path: dirname(dbPath) }, "Failed to mkdir for job DB");
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id       TEXT PRIMARY KEY,
      file_id      TEXT,
      source_url   TEXT,
      filename     TEXT NOT NULL,
      slip_type    TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      error        TEXT,
      bytes_sent   INTEGER DEFAULT 0,
      copies       INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      started_at   TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  `);

  logger.info({ dbPath }, "Job queue initialized");

  // 古いジョブを自動削除 (起動時)
  cleanOldJobs();
}

/**
 * DB インスタンスを取得 (初期化済み前提)
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error(
      "Job database is not initialized. Call initializeJobDatabase() first."
    );
  }
  return db;
}

/**
 * 新規ジョブを作成
 *
 * @returns 生成された job_id
 */
export function createJob(input: CreateJobInput): string {
  const jobId = `job_${uuidv4()}`;
  const stmt = getDb().prepare(`
    INSERT INTO jobs (job_id, file_id, source_url, filename, slip_type, copies, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  stmt.run(
    jobId,
    input.file_id || null,
    input.source_url || null,
    input.filename,
    input.slip_type,
    input.copies
  );

  logger.info(
    { job_id: jobId, filename: input.filename, slip_type: input.slip_type },
    "Job created"
  );
  return jobId;
}

/**
 * ジョブ状態を更新
 */
export function updateJobStatus(
  jobId: string,
  status: JobStatus,
  extra?: {
    error?: string | null;
    bytes_sent?: number;
  }
): void {
  const now = new Date().toISOString();

  const sets: string[] = ["status = ?"];
  const values: Array<string | number | null> = [status];

  // 状態別の自動タイムスタンプ
  if (status === "converting" || status === "printing") {
    sets.push("started_at = COALESCE(started_at, ?)");
    values.push(now);
  }

  if (status === "completed" || status === "failed") {
    sets.push("completed_at = ?");
    values.push(now);
  }

  if (extra?.error !== undefined) {
    sets.push("error = ?");
    values.push(extra.error);
  }

  if (extra?.bytes_sent !== undefined) {
    sets.push("bytes_sent = ?");
    values.push(extra.bytes_sent);
  }

  values.push(jobId);

  const stmt = getDb().prepare(`
    UPDATE jobs SET ${sets.join(", ")} WHERE job_id = ?
  `);
  stmt.run(...values);

  logger.debug({ job_id: jobId, status, extra }, "Job status updated");
}

/**
 * ジョブを取得
 */
export function getJob(jobId: string): Job | null {
  const stmt = getDb().prepare(`SELECT * FROM jobs WHERE job_id = ?`);
  const row = stmt.get(jobId) as Job | undefined;
  return row || null;
}

/**
 * ジョブ一覧を取得 (新しい順)
 */
export function listJobs(limit = 50): Job[] {
  const limitClamped = Math.min(Math.max(limit, 1), 500);
  const stmt = getDb().prepare(`
    SELECT * FROM jobs
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limitClamped) as Job[];
}

/**
 * 古いジョブを削除 (retention 設定より古い completed/failed のみ)
 */
export function cleanOldJobs(): number {
  const retentionDays = parseInt(
    process.env.JOB_RETENTION_DAYS || "30",
    10
  );
  const stmt = getDb().prepare(`
    DELETE FROM jobs
    WHERE status IN ('completed', 'failed')
      AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || ? || ' days')
  `);
  const result = stmt.run(retentionDays);
  const deleted = result.changes;
  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, "Cleaned old jobs");
  }
  return deleted;
}

/**
 * シャットダウン時のクリーンアップ
 */
export function closeJobDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info("Job database closed");
  }
}
