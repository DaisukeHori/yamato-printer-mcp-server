/**
 * middleware/auth.ts のユニットテスト
 *
 * 対象:
 *   - authMiddleware(): クエリパラメータ認証、Authorization ヘッダ認証、失敗ケース
 *   - validateApiKeyOnStartup(): 環境変数チェック (弱いキーの警告/異常終了)
 *
 * Express のリクエスト/レスポンスはモックで表現する。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  authMiddleware,
  validateApiKeyOnStartup,
} from "../../src/middleware/auth.js";

/**
 * Express リクエストのモック
 */
function mockRequest(opts: {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  ip?: string;
  path?: string;
}): Partial<Request> {
  return {
    query: opts.query || {},
    header: (name: string) => opts.headers?.[name.toLowerCase()],
    ip: opts.ip || "127.0.0.1",
    path: opts.path || "/mcp",
  } as Partial<Request>;
}

/**
 * Express レスポンスのモック
 */
function mockResponse(): Partial<Response> & {
  statusCode: number;
  jsonBody: unknown;
} {
  const res = {
    statusCode: 0,
    jsonBody: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
  };
  return res as unknown as Partial<Response> & {
    statusCode: number;
    jsonBody: unknown;
  };
}

// vitest.config.ts で MCP_API_KEY="test-key-12345678901234567890" が設定されている
const VALID_KEY = "test-key-12345678901234567890";

describe("authMiddleware()", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    // テスト毎に環境変数を元に戻す
    originalKey = process.env.MCP_API_KEY;
    process.env.MCP_API_KEY = VALID_KEY;
  });

  describe("正常系", () => {
    it("クエリパラメータ key=... で正しいキーを渡すと next() が呼ばれる", () => {
      const req = mockRequest({ query: { key: VALID_KEY } });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(0); // 変更なし
    });

    it("Authorization: Bearer <KEY> ヘッダでも認証できる", () => {
      const req = mockRequest({
        headers: { authorization: `Bearer ${VALID_KEY}` },
      });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(next).toHaveBeenCalledOnce();
    });

    it("Authorization: bearer (小文字) でも動作する", () => {
      const req = mockRequest({
        headers: { authorization: `bearer ${VALID_KEY}` },
      });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(next).toHaveBeenCalledOnce();
    });

    it("クエリパラメータが優先される (Authorization ヘッダと両方あっても)", () => {
      const req = mockRequest({
        query: { key: VALID_KEY },
        headers: { authorization: "Bearer wrong-key" },
      });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("認証失敗", () => {
    it("key を渡さないと 401", () => {
      const req = mockRequest({});
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.jsonBody).toMatchObject({ error: "unauthorized" });
    });

    it("間違った key を渡すと 401", () => {
      const req = mockRequest({ query: { key: "wrong-key" } });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(401);
    });

    it("空文字の key は拒否", () => {
      const req = mockRequest({ query: { key: "" } });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(401);
    });

    it("Bearer に間違った key を渡すと 401", () => {
      const req = mockRequest({
        headers: { authorization: "Bearer wrong-key" },
      });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(401);
    });

    it("失敗レスポンスには 'message' フィールドがある", () => {
      const req = mockRequest({});
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect((res.jsonBody as { message: string }).message).toMatch(
        /Invalid|missing/i
      );
    });
  });

  describe("サーバー設定異常", () => {
    it("MCP_API_KEY が未設定だと 500 (server_misconfigured)", () => {
      delete process.env.MCP_API_KEY;
      const req = mockRequest({ query: { key: VALID_KEY } });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(500);
      expect((res.jsonBody as { error: string }).error).toBe(
        "server_misconfigured"
      );
      expect(next).not.toHaveBeenCalled();

      // 環境変数復元
      process.env.MCP_API_KEY = originalKey;
    });
  });

  describe("タイミング安全性(注記)", () => {
    // 現実装は ===比較を使用しているため、タイミング攻撃耐性はない
    // これは低リスクだが将来的に crypto.timingSafeEqual に切替える選択肢あり
    it("正しいキーの部分一致では認証されない", () => {
      const req = mockRequest({ query: { key: VALID_KEY.slice(0, 20) } });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(401);
    });

    it("正しいキーに余計な文字を足しても認証されない", () => {
      const req = mockRequest({ query: { key: VALID_KEY + "x" } });
      const res = mockResponse();
      const next = vi.fn();
      authMiddleware(req as Request, res as unknown as Response, next as NextFunction);
      expect(res.statusCode).toBe(401);
    });
  });
});

// =================================================================
// validateApiKeyOnStartup()
// =================================================================

describe("validateApiKeyOnStartup()", () => {
  let originalKey: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.MCP_API_KEY;
    // process.exit をモック (呼ばれても実際には終了しない)
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_called__:${code}`);
    }) as never);
  });

  afterEach(() => {
    process.env.MCP_API_KEY = originalKey;
    exitSpy.mockRestore();
  });

  it("十分に長いキー (32文字以上) なら正常終了", () => {
    process.env.MCP_API_KEY = "a".repeat(64);
    expect(() => validateApiKeyOnStartup()).not.toThrow();
  });

  it("16文字以上であれば警告なし (正常パス)", () => {
    process.env.MCP_API_KEY = "a".repeat(20);
    expect(() => validateApiKeyOnStartup()).not.toThrow();
  });

  it("短いキー (16文字未満) でも起動自体はするが警告", () => {
    process.env.MCP_API_KEY = "short";
    // process.exit は呼ばれず、警告のみ
    expect(() => validateApiKeyOnStartup()).not.toThrow();
  });

  it("MCP_API_KEY が未設定だと process.exit(1)", () => {
    delete process.env.MCP_API_KEY;
    expect(() => validateApiKeyOnStartup()).toThrow(
      /__process_exit_called__/
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("プレースホルダ値 CHANGE_ME_... だと process.exit(1)", () => {
    process.env.MCP_API_KEY = "CHANGE_ME_RUN_openssl_rand_hex_32";
    expect(() => validateApiKeyOnStartup()).toThrow(
      /__process_exit_called__/
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
