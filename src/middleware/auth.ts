/**
 * MCP API Key 認証ミドルウェア
 *
 * 既存の printer-mcp-server (Kyocera) と同じパターン:
 * クエリパラメータ ?key=<MCP_API_KEY> で認証する。
 *
 * /upload と /uploads は認証なし (curl 利用時のトークン消費削減のため)。
 * /mcp のみ認証を適用する。
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "auth" });

/**
 * MCP_API_KEY を検証するExpressミドルウェア
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expectedKey = process.env.MCP_API_KEY;

  // 環境変数未設定 = 起動時バリデーションが効いていれば到達しないが、念のため
  if (!expectedKey) {
    logger.error("MCP_API_KEY is not set on the server");
    res.status(500).json({
      error: "server_misconfigured",
      message: "MCP_API_KEY is not configured on the server",
    });
    return;
  }

  // クエリパラメータまたは Authorization ヘッダ (Bearer) から取得
  const providedKey =
    (req.query.key as string | undefined) ||
    req.header("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (providedKey !== expectedKey) {
    logger.warn(
      { ip: req.ip, path: req.path },
      "auth failed (invalid MCP_API_KEY)"
    );
    res.status(401).json({
      error: "unauthorized",
      message: "Invalid or missing MCP_API_KEY",
    });
    return;
  }

  next();
}

/**
 * 起動時に MCP_API_KEY の存在と強度をチェック
 * 弱いキー (デフォルト値 or 短すぎる) は警告ログを出す
 */
export function validateApiKeyOnStartup(): void {
  const key = process.env.MCP_API_KEY;

  if (!key) {
    logger.fatal("MCP_API_KEY must be set in .env");
    process.exit(1);
  }

  if (key === "CHANGE_ME_RUN_openssl_rand_hex_32") {
    logger.fatal(
      "MCP_API_KEY still has the placeholder value. " +
        "Run: openssl rand -hex 32  and update .env"
    );
    process.exit(1);
  }

  if (key.length < 16) {
    logger.warn(
      { key_length: key.length },
      "MCP_API_KEY is shorter than 16 chars. Consider using a longer random key."
    );
  } else {
    logger.info(
      { key_length: key.length },
      "MCP_API_KEY loaded successfully"
    );
  }
}
