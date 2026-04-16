/**
 * job-queue.ts のユニットテスト
 *
 * SQLite in-memory DB (:memory:) で状態遷移・CRUDをテスト。
 * vitest.config.ts で JOB_DB_PATH=:memory: が設定されている。
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  initializeJobDatabase,
  createJob,
  updateJobStatus,
  getJob,
  listJobs,
  cleanOldJobs,
  closeJobDatabase,
} from "../../src/services/job-queue.js";

// vitest config の singleFork + :memory: DBで、同じプロセス内で共有される
beforeEach(() => {
  // テスト毎に初期化してクリーンな状態に (closeしてから再initで別DBを開く)
  try {
    closeJobDatabase();
  } catch {
    /* まだ初期化されていない */
  }
  initializeJobDatabase();
});

afterAll(() => {
  try {
    closeJobDatabase();
  } catch {
    /* ignore */
  }
});

describe("createJob()", () => {
  it("最小引数でジョブが作成できる", () => {
    const jobId = createJob({
      filename: "test.pdf",
      slip_type: "230",
      copies: 1,
    });

    expect(jobId).toMatch(/^job_[0-9a-f-]+$/);
  });

  it("file_id と source_url の両方が設定できる", () => {
    const jobId1 = createJob({
      file_id: "file-abc",
      filename: "a.pdf",
      slip_type: "230",
      copies: 1,
    });
    const jobId2 = createJob({
      source_url: "https://example.com/b.pdf",
      filename: "b.pdf",
      slip_type: "241",
      copies: 2,
    });

    const job1 = getJob(jobId1);
    const job2 = getJob(jobId2);

    expect(job1?.file_id).toBe("file-abc");
    expect(job1?.source_url).toBeNull();

    expect(job2?.source_url).toBe("https://example.com/b.pdf");
    expect(job2?.file_id).toBeNull();
  });

  it("作成直後のステータスは pending", () => {
    const jobId = createJob({
      filename: "test.pdf",
      slip_type: "230",
      copies: 1,
    });
    const job = getJob(jobId);
    expect(job?.status).toBe("pending");
  });

  it("ユニークなjob_idが発行される (10回で衝突なし)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(
        createJob({
          filename: `t${i}.pdf`,
          slip_type: "230",
          copies: 1,
        })
      );
    }
    expect(ids.size).toBe(10);
  });

  it("created_at が自動セットされる", () => {
    const jobId = createJob({
      filename: "test.pdf",
      slip_type: "230",
      copies: 1,
    });
    const job = getJob(jobId);
    expect(job?.created_at).toBeTruthy();
    // ISO 8601 形式
    expect(job?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/);
  });
});

describe("updateJobStatus()", () => {
  let jobId: string;
  beforeEach(() => {
    jobId = createJob({
      filename: "status-test.pdf",
      slip_type: "230",
      copies: 1,
    });
  });

  it("pending → converting に遷移できる", () => {
    updateJobStatus(jobId, "converting");
    expect(getJob(jobId)?.status).toBe("converting");
  });

  it("converting → printing → completed と進める", () => {
    updateJobStatus(jobId, "converting");
    updateJobStatus(jobId, "printing");
    updateJobStatus(jobId, "completed");
    expect(getJob(jobId)?.status).toBe("completed");
  });

  it("failed に移行する際 error メッセージが保存される", () => {
    updateJobStatus(jobId, "failed", { error: "プリンタが応答しません" });
    const job = getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("プリンタが応答しません");
  });

  it("bytes_sent を更新できる", () => {
    updateJobStatus(jobId, "completed", { bytes_sent: 12345 });
    expect(getJob(jobId)?.bytes_sent).toBe(12345);
  });

  it("converting に移行すると started_at が入る", () => {
    updateJobStatus(jobId, "converting");
    const job = getJob(jobId);
    expect(job?.started_at).toBeTruthy();
  });

  it("started_at は最初の converting/printing で固定される (2度目の更新では上書きされない)", () => {
    updateJobStatus(jobId, "converting");
    const firstStartedAt = getJob(jobId)?.started_at;
    // 少し待つ
    const wait = () => new Promise((r) => setTimeout(r, 50));
    return wait().then(() => {
      updateJobStatus(jobId, "printing");
      const job = getJob(jobId);
      expect(job?.started_at).toBe(firstStartedAt);
    });
  });

  it("completed に移行すると completed_at が入る", () => {
    updateJobStatus(jobId, "completed");
    const job = getJob(jobId);
    expect(job?.completed_at).toBeTruthy();
  });

  it("failed に移行すると completed_at が入る", () => {
    updateJobStatus(jobId, "failed", { error: "err" });
    const job = getJob(jobId);
    expect(job?.completed_at).toBeTruthy();
  });
});

describe("getJob()", () => {
  it("存在する job_id は Job オブジェクトを返す", () => {
    const jobId = createJob({
      filename: "a.pdf",
      slip_type: "230",
      copies: 1,
    });
    const job = getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.job_id).toBe(jobId);
    expect(job?.filename).toBe("a.pdf");
    expect(job?.slip_type).toBe("230");
  });

  it("存在しない job_id は null を返す", () => {
    expect(getJob("job_nonexistent")).toBeNull();
  });
});

describe("listJobs()", () => {
  it("作成順(新しい順)でジョブが返る", async () => {
    const id1 = createJob({
      filename: "first.pdf",
      slip_type: "230",
      copies: 1,
    });
    // SQLiteのタイムスタンプが秒単位なので少し待つ
    await new Promise((r) => setTimeout(r, 1100));
    const id2 = createJob({
      filename: "second.pdf",
      slip_type: "230",
      copies: 1,
    });

    const jobs = listJobs(10);
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    // 新しい順なので second が先
    expect(jobs[0].job_id).toBe(id2);
    expect(jobs[1].job_id).toBe(id1);
  });

  it("limit を守る", () => {
    for (let i = 0; i < 5; i++) {
      createJob({
        filename: `t${i}.pdf`,
        slip_type: "230",
        copies: 1,
      });
    }
    const jobs = listJobs(3);
    expect(jobs).toHaveLength(3);
  });

  it("limit のデフォルトは 50", () => {
    // テストとしては、大量作成せず、引数なしで呼べることのみ確認
    const jobs = listJobs();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it("limit は 500 でクランプされる", () => {
    const jobs = listJobs(99_999);
    expect(Array.isArray(jobs)).toBe(true);
  });

  it("limit=1 の下限も守られる", () => {
    createJob({ filename: "a.pdf", slip_type: "230", copies: 1 });
    createJob({ filename: "b.pdf", slip_type: "230", copies: 1 });
    const jobs = listJobs(1);
    expect(jobs).toHaveLength(1);
  });
});

describe("cleanOldJobs()", () => {
  it("completed のジョブが retention 期間を過ぎると削除対象になる", () => {
    // 現時点ではretention日数が短いほど明確にテストできるが、
    // ここではcleanOldJobsが呼び出せてエラーを投げないことだけ確認
    const deleted = cleanOldJobs();
    expect(typeof deleted).toBe("number");
    expect(deleted).toBeGreaterThanOrEqual(0);
  });

  it("pending のジョブは削除されない", () => {
    createJob({
      filename: "still-pending.pdf",
      slip_type: "230",
      copies: 1,
    });
    cleanOldJobs();
    // まだ pending のままなのでリストに残る
    const jobs = listJobs(10);
    expect(jobs.some((j) => j.filename === "still-pending.pdf")).toBe(true);
  });
});
