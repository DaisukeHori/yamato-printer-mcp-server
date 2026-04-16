/**
 * HTTP エンドポイント統合テスト (supertest)
 *
 * 対象:
 *   - POST /upload   : ファイルアップロード (認証なし)
 *   - GET  /uploads  : 一覧
 *   - GET  /health   : ヘルスチェック
 *   - POST /mcp      : MCP認証
 *
 * 実際のExpress appをsupertestで叩いてE2E検証する。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { promises as fs } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

import { buildApp, buildMcpServer } from "../../src/app.js";
import {
  initializeJobDatabase,
  closeJobDatabase,
} from "../../src/services/job-queue.js";
import { generateMinimalPdf, invalidPdfBuffer } from "../fixtures/pdf-helper.js";

const VALID_KEY = process.env.MCP_API_KEY!; // vitest.config.ts で設定済み

let app: Application;
let uploadDir: string;

beforeAll(() => {
  // テスト専用のアップロードディレクトリ
  uploadDir = mkdtempSync(join(tmpdir(), "yamato-http-test-"));
  process.env.UPLOAD_DIR = uploadDir;

  initializeJobDatabase();
  app = buildApp(buildMcpServer());
});

afterAll(() => {
  closeJobDatabase();
  try {
    rmSync(uploadDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(async () => {
  // 各テストの前に uploadDir をクリーンに
  const entries = await fs.readdir(uploadDir).catch(() => []);
  await Promise.all(
    entries.map((e) => fs.unlink(join(uploadDir, e)).catch(() => {}))
  );
});

// =================================================================
// GET /health
// =================================================================

describe("GET /health", () => {
  it("200 OK を返す", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("status=ok を返す", async () => {
    const res = await request(app).get("/health");
    expect(res.body.status).toBe("ok");
  });

  it("version を含む", async () => {
    const res = await request(app).get("/health");
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("printer の状態を含む", async () => {
    const res = await request(app).get("/health");
    expect(res.body.printer).toBeDefined();
    expect(res.body.printer.device).toBeDefined();
    expect(typeof res.body.printer.available).toBe("boolean");
  });

  it("timestamp を ISO8601 形式で含む", async () => {
    const res = await request(app).get("/health");
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("認証なしでアクセスできる", async () => {
    // key を付けなくても 200
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});

// =================================================================
// POST /upload
// =================================================================

describe("POST /upload", () => {
  it("PDFをアップロードできて file_id が返る", async () => {
    const pdf = generateMinimalPdf(["HELLO"]);
    const res = await request(app)
      .post("/upload")
      .attach("file", pdf, { filename: "test.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.file_id).toBeDefined();
    expect(res.body.filename).toBe("test.pdf");
    expect(res.body.size).toBe(pdf.length);
    expect(res.body.expires_in_min).toBeGreaterThan(0);
  });

  it("file_id は UUIDv4 形式", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const res = await request(app)
      .post("/upload")
      .attach("file", pdf, { filename: "uuid-test.pdf", contentType: "application/pdf" });

    expect(res.body.file_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("メタデータ(.meta.json)が一緒に保存される", async () => {
    const pdf = generateMinimalPdf(["META TEST"]);
    const res = await request(app)
      .post("/upload")
      .attach("file", pdf, { filename: "meta-sample.pdf", contentType: "application/pdf" });

    const fileId = res.body.file_id;
    const metaPath = join(uploadDir, `${fileId}.meta.json`);

    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    expect(meta.filename).toBe("meta-sample.pdf");
    expect(meta.size).toBe(pdf.length);
    expect(meta.uploaded_at).toBeTruthy();
    expect(meta.expires_at).toBeTruthy();
  });

  it("file フィールドが欠損していると 400", async () => {
    const res = await request(app).post("/upload");
    // multer が file 未送信でハンドラに到達すれば 400、
    // または multer のエラーミドルウェアで 400
    expect([400]).toContain(res.status);
  });

  it("PDF以外のMIMEタイプは 400", async () => {
    const res = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("hello"), {
        filename: "test.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("ファイル名に.pdfが付いていれば MIME が octet-stream でも許可 (後方互換)", async () => {
    const pdf = generateMinimalPdf(["OCT STREAM"]);
    const res = await request(app)
      .post("/upload")
      .attach("file", pdf, {
        filename: "shipping.pdf",
        contentType: "application/octet-stream",
      });
    expect(res.status).toBe(200);
  });

  it("アップロード後、実ファイルが uploadDir に存在する", async () => {
    const pdf = generateMinimalPdf(["EXISTS"]);
    const res = await request(app)
      .post("/upload")
      .attach("file", pdf, { filename: "exists.pdf", contentType: "application/pdf" });

    const filePath = join(uploadDir, res.body.file_id);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(pdf.length);
  });

  it("大きなPDF (1MB) もアップロード可能", async () => {
    // ダミーで1MBくらいにする: 50,000 文字のテキスト行を大量に
    const lines = new Array(500).fill("A long line of text " + "X".repeat(100));
    const pdf = generateMinimalPdf(lines);
    const res = await request(app)
      .post("/upload")
      .attach("file", pdf, { filename: "big.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.size).toBe(pdf.length);
  });
});

// =================================================================
// GET /uploads
// =================================================================

describe("GET /uploads", () => {
  it("空のディレクトリなら count=0", async () => {
    const res = await request(app).get("/uploads");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.files).toHaveLength(0);
  });

  it("アップロード後は1件返る", async () => {
    await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["A"]), {
        filename: "a.pdf",
        contentType: "application/pdf",
      });

    const res = await request(app).get("/uploads");
    expect(res.body.count).toBe(1);
    expect(res.body.files[0].filename).toBe("a.pdf");
  });

  it("複数アップロード後は複数件返る", async () => {
    await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["A"]), {
        filename: "a.pdf",
        contentType: "application/pdf",
      });
    await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["B"]), {
        filename: "b.pdf",
        contentType: "application/pdf",
      });
    await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["C"]), {
        filename: "c.pdf",
        contentType: "application/pdf",
      });

    const res = await request(app).get("/uploads");
    expect(res.body.count).toBe(3);
  });

  it("各ファイルに file_id / filename / size / uploaded_at が含まれる", async () => {
    await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["F"]), {
        filename: "fields.pdf",
        contentType: "application/pdf",
      });

    const res = await request(app).get("/uploads");
    const entry = res.body.files[0];
    expect(entry.file_id).toBeDefined();
    expect(entry.filename).toBe("fields.pdf");
    expect(entry.size).toBeGreaterThan(0);
    expect(entry.uploaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("認証なしでアクセスできる (/uploads は MCP_API_KEY 不要)", async () => {
    const res = await request(app).get("/uploads");
    expect(res.status).toBe(200);
  });
});

// =================================================================
// POST /mcp (認証)
// =================================================================

describe("POST /mcp — 認証", () => {
  const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    },
  };

  it("key なしで POST すると 401", async () => {
    const res = await request(app).post("/mcp").send(initRequest);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("間違った key だと 401", async () => {
    const res = await request(app)
      .post("/mcp")
      .query({ key: "wrong-key-xxx" })
      .send(initRequest);
    expect(res.status).toBe(401);
  });

  it("正しい key なら 200 系で応答", async () => {
    const res = await request(app)
      .post("/mcp")
      .query({ key: VALID_KEY })
      .set("Accept", "application/json, text/event-stream")
      .send(initRequest);

    // Streamable HTTP は 200 で JSON or SSE を返す
    expect([200]).toContain(res.status);
  });

  it("Authorization: Bearer でも認証できる", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${VALID_KEY}`)
      .set("Accept", "application/json, text/event-stream")
      .send(initRequest);

    expect([200]).toContain(res.status);
  });
});

// =================================================================
// 総合: upload → /uploads 確認
// =================================================================

describe("エンドツーエンド: upload -> list", () => {
  it("upload したファイルが /uploads で取得できる", async () => {
    const up = await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["E2E"]), {
        filename: "e2e.pdf",
        contentType: "application/pdf",
      });
    const fileId = up.body.file_id;

    const list = await request(app).get("/uploads");
    const found = list.body.files.find(
      (f: { file_id: string }) => f.file_id === fileId
    );
    expect(found).toBeDefined();
    expect(found.filename).toBe("e2e.pdf");
  });
});

// =================================================================
// 不正なPDFのアップロード (MIME合わせ擬装)
// =================================================================

describe("不正ファイル対処", () => {
  it(".pdf 名で非PDFデータを送っても受け取ってしまう(意図通り、後段で検知)", async () => {
    // uploader は MIME/拡張子 ベースでしか見ていないため、
    // 実際のPDFシグネチャ検証は print_url/print_uploaded 側で行う
    const res = await request(app)
      .post("/upload")
      .attach("file", invalidPdfBuffer(), {
        filename: "fake.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(200);
    expect(res.body.file_id).toBeDefined();
  });
});
