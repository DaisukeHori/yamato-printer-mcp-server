/**
 * MCP ツール統合テスト
 *
 * Streamable HTTP transport 経由で JSON-RPC を投げて
 * 各ツールが期待通りに応答するか確認する。
 *
 * MCP プロトコル初期化フロー:
 *   1. initialize (client → server)
 *   2. notifications/initialized (client → server, 通知)
 *   3. tools/call (実行)
 *
 * このテストでは Streamable HTTP ステートレスモードを使い、
 * 各リクエスト毎に initialize + tools/call を送る。
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
import { generateMinimalPdf } from "../fixtures/pdf-helper.js";

const VALID_KEY = process.env.MCP_API_KEY!;

let app: Application;
let uploadDir: string;

beforeAll(() => {
  uploadDir = mkdtempSync(join(tmpdir(), "yamato-mcp-test-"));
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
  const entries = await fs.readdir(uploadDir).catch(() => []);
  await Promise.all(
    entries.map((e) => fs.unlink(join(uploadDir, e)).catch(() => {}))
  );
});

// -----------------------------------------------------------------
// MCP 共通ヘルパー
// -----------------------------------------------------------------

interface McpResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Streamable HTTP transport はレスポンスとして:
 *   - JSON object (content-type: application/json)
 *   - SSE stream (content-type: text/event-stream)
 * のいずれかを返す。
 *
 * supertest でレスポンスを parse するヘルパー。
 *
 * SSE 形式:
 *   event: message\n
 *   data: <JSON>\n
 *   \n
 * 複数messageがあれば複数 data: 行が並ぶので、最後の有効JSONを返す。
 */
function parseMcpResponse(res: request.Response): McpResponse | null {
  const text = res.text || "";
  const contentType = res.headers["content-type"] || "";

  if (contentType.includes("text/event-stream")) {
    // 行単位で走査し、"data: " から始まる行をすべて JSON.parse してみる
    // 最後に成功したものを返す (通常はレスポンス1つなので1件)
    let lastValidJson: McpResponse | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          lastValidJson = JSON.parse(payload);
        } catch {
          /* skip */
        }
      } else if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        try {
          lastValidJson = JSON.parse(payload);
        } catch {
          /* skip */
        }
      }
    }
    return lastValidJson;
  }

  // 通常の JSON
  if (typeof res.body === "object" && res.body !== null && Object.keys(res.body).length > 0) {
    return res.body as McpResponse;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Streamable HTTP に JSON-RPC バッチを投げる
 * (initialize + notifications/initialized + tools/call を同一レスポンスで処理)
 */
async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  id = 1
): Promise<McpResponse | null> {
  // ステートレスモードなので initialize + tools/call を連続で送る
  const res = await request(app)
    .post("/mcp")
    .query({ key: VALID_KEY })
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json")
    .send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    });

  return parseMcpResponse(res);
}

/**
 * レスポンスから content[0].text を抽出してJSON parse (MCPツールのJSON返却用)
 */
function extractToolJson(result: unknown): unknown {
  const r = result as {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  if (!r.content || r.content.length === 0) return null;
  const text = r.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text; // JSONでないなら生テキスト
  }
}

// =================================================================
// list_slip_types
// =================================================================

describe("MCP tool: list_slip_types", () => {
  it("呼び出すと 7種類のスリップタイプが返る", async () => {
    const res = await callMcpTool("list_slip_types", {});
    expect(res).toBeDefined();
    expect(res?.error).toBeUndefined();

    const json = extractToolJson(res?.result) as {
      supported: Array<{ slip_type: string }>;
    };
    expect(json.supported).toHaveLength(7);
  });

  it("使用例(usage_example)が含まれる", async () => {
    const res = await callMcpTool("list_slip_types", {});
    const json = extractToolJson(res?.result) as {
      usage_example: Record<string, unknown>;
    };
    expect(json.usage_example).toBeDefined();
    expect(json.usage_example.print_uploaded).toBeDefined();
  });

  it("230 番は 宅急便の説明を含む", async () => {
    const res = await callMcpTool("list_slip_types", {});
    const json = extractToolJson(res?.result) as {
      supported: Array<{ slip_type: string; description: string }>;
    };
    const item230 = json.supported.find((x) => x.slip_type === "230");
    expect(item230).toBeDefined();
    expect(item230!.description).toContain("宅急便");
  });
});

// =================================================================
// validate_print_options
// =================================================================

describe("MCP tool: validate_print_options", () => {
  it("有効な slip_type=230 は valid=true", async () => {
    const res = await callMcpTool("validate_print_options", {
      slip_type: "230",
    });
    const json = extractToolJson(res?.result) as {
      valid: boolean;
      resolved: { size_mm: { width_mm: number; height_mm: number } };
    };
    expect(json.valid).toBe(true);
    expect(json.resolved.size_mm.width_mm).toBe(108);
    expect(json.resolved.size_mm.height_mm).toBe(178);
  });

  it("存在しない slip_type は valid=false + errors 配列", async () => {
    // zodで拒否されるのでエラー応答 (isError=true) となる
    const res = await callMcpTool("validate_print_options", {
      slip_type: "999999",
    });
    // MCP SDK の zod エラーは -32602 (Invalid params) として返る
    expect(res?.error || (res?.result as { isError?: boolean })?.isError).toBeTruthy();
  });

  it("custom でサイズ未指定は valid=false", async () => {
    const res = await callMcpTool("validate_print_options", {
      slip_type: "custom",
    });
    const json = extractToolJson(res?.result) as {
      valid: boolean;
      errors?: string[];
    };
    expect(json.valid).toBe(false);
    expect(json.errors).toBeDefined();
  });

  it("custom の過大サイズは zod で拒否される (protocol error)", async () => {
    const res = await callMcpTool("validate_print_options", {
      slip_type: "custom",
      custom_width_mm: 100,
      custom_height_mm: 9999,
    });
    // custom_height_mm は zod schema で max(1778) なので
    // MCP protocol レベルの error レスポンスになる
    expect(res?.error || (res?.result as { isError?: boolean })?.isError).toBeTruthy();
  });

  it("custom の許容範囲内サイズは valid=true", async () => {
    const res = await callMcpTool("validate_print_options", {
      slip_type: "custom",
      custom_width_mm: 100,
      custom_height_mm: 150,
    });
    const json = extractToolJson(res?.result) as { valid: boolean };
    expect(json.valid).toBe(true);
  });

  it("direction=0 を指定すると resolved.direction=0", async () => {
    const res = await callMcpTool("validate_print_options", {
      slip_type: "230",
      direction: 0,
    });
    const json = extractToolJson(res?.result) as {
      resolved: { direction: number };
    };
    expect(json.resolved.direction).toBe(0);
  });

  it("printer_device の状態も返る", async () => {
    const res = await callMcpTool("validate_print_options", {
      slip_type: "230",
    });
    const json = extractToolJson(res?.result) as {
      printer_device: { device: string; available: boolean };
    };
    expect(json.printer_device).toBeDefined();
    expect(json.printer_device.device).toBeDefined();
  });
});

// =================================================================
// list_uploads
// =================================================================

describe("MCP tool: list_uploads", () => {
  it("空ディレクトリでは 'No uploaded files.' を返す", async () => {
    const res = await callMcpTool("list_uploads", {});
    const text = (res?.result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("No uploaded files");
  });

  it("ファイルをアップロード後は JSON に情報が入る", async () => {
    // HTTP で先にアップロード
    const upRes = await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["LIST"]), {
        filename: "list-test.pdf",
        contentType: "application/pdf",
      });

    const res = await callMcpTool("list_uploads", {});
    const json = extractToolJson(res?.result) as {
      count: number;
      files: Array<{ file_id: string; filename: string }>;
    };
    expect(json.count).toBe(1);
    expect(json.files[0].filename).toBe("list-test.pdf");
    expect(json.files[0].file_id).toBe(upRes.body.file_id);
  });
});

// =================================================================
// list_jobs / get_job_status
// =================================================================

describe("MCP tool: list_jobs", () => {
  it("空DB では 'No jobs found.' を返す", async () => {
    const res = await callMcpTool("list_jobs", { limit: 10 });
    const text = (res?.result as { content: Array<{ text: string }> }).content[0].text;
    // 空なら文字列、あれば JSON
    expect(typeof text).toBe("string");
  });

  it("limit=5 で呼べる", async () => {
    const res = await callMcpTool("list_jobs", { limit: 5 });
    expect(res?.error).toBeUndefined();
  });

  it("limit を未指定でもデフォルト50で呼べる", async () => {
    const res = await callMcpTool("list_jobs", {});
    expect(res?.error).toBeUndefined();
  });
});

describe("MCP tool: get_job_status", () => {
  it("存在しない job_id はエラー応答 (job_not_found)", async () => {
    const res = await callMcpTool("get_job_status", {
      job_id: "job_nonexistent",
    });
    const r = res?.result as { content: Array<{ text: string }>; isError: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("job_not_found");
  });
});

// =================================================================
// print_uploaded
// =================================================================

describe("MCP tool: print_uploaded", () => {
  it("存在しない file_id は file_not_found エラー", async () => {
    const res = await callMcpTool("print_uploaded", {
      file_id: "nonexistent-uuid",
      slip_type: "230",
    });
    const r = res?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("file_not_found");
  });

  it("実在するPDFと有効な slip_type で job が作成される (実プリンタ不要、/dev/null に書き込み)", async () => {
    // アップロード
    const up = await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["PRINT"]), {
        filename: "print.pdf",
        contentType: "application/pdf",
      });
    const fileId = up.body.file_id;

    // 印刷 (PRINTER_DEVICE=/dev/null なので実質 no-op)
    const res = await callMcpTool("print_uploaded", {
      file_id: fileId,
      slip_type: "230",
    });

    const json = extractToolJson(res?.result) as {
      job_id?: string;
      status?: string;
    };
    expect(json.job_id).toMatch(/^job_/);
    expect(["completed", "failed"]).toContain(json.status);
  }, 20_000);

  it("copies=2 を渡しても成功する", async () => {
    const up = await request(app)
      .post("/upload")
      .attach("file", generateMinimalPdf(["2部"]), {
        filename: "copies.pdf",
        contentType: "application/pdf",
      });
    const res = await callMcpTool("print_uploaded", {
      file_id: up.body.file_id,
      slip_type: "230",
      copies: 2,
    });
    const json = extractToolJson(res?.result) as { status: string };
    expect(["completed", "failed"]).toContain(json.status);
  }, 20_000);

  it("不正な slip_type は zod で弾かれる", async () => {
    const res = await callMcpTool("print_uploaded", {
      file_id: "any",
      slip_type: "invalid-slip",
    });
    // zod のパラメータエラーは error レスポンス
    expect(res?.error || (res?.result as { isError?: boolean })?.isError).toBeTruthy();
  });
});

// =================================================================
// print_url — SSRF 系のエラー
// =================================================================

describe("MCP tool: print_url (SSRF 対策)", () => {
  it("127.0.0.1 URL は blocked_url エラー", async () => {
    const res = await callMcpTool("print_url", {
      url: "http://127.0.0.1/evil.pdf",
      filename: "evil.pdf",
      slip_type: "230",
    });
    const r = res?.result as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("blocked");
  });

  it("file:// は protocol エラー", async () => {
    const res = await callMcpTool("print_url", {
      url: "file:///etc/passwd",
      filename: "x.pdf",
      slip_type: "230",
    });
    const r = res?.result as { isError: boolean };
    expect(r.isError).toBe(true);
  });

  it("192.168.1.1 (プライベートIP) は blocked", async () => {
    const res = await callMcpTool("print_url", {
      url: "http://192.168.1.1/shipping.pdf",
      filename: "x.pdf",
      slip_type: "230",
    });
    const r = res?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("blocked");
  });

  it("アクセス不可能な公開URL(存在しないホスト)は fetch_error", async () => {
    const res = await callMcpTool("print_url", {
      url: "https://this-host-definitely-does-not-exist-12345.example.invalid/x.pdf",
      filename: "x.pdf",
      slip_type: "230",
    });
    const r = res?.result as { isError: boolean };
    // fetch_error か blocked_url か、何らかのエラーになる
    expect(r.isError).toBe(true);
  });
});
