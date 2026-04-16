/**
 * yamato-printer-mcp-server エントリポイント
 *
 * Express で 2つのレイヤを同居させる:
 *   1. ファイルアップロード用の平素なHTTPエンドポイント (認証なし)
 *      - POST /upload  : multipart/form-data でPDFを受け取る
 *      - GET  /uploads : 一覧
 *      - GET  /health  : ヘルスチェック
 *   2. MCP over HTTP エンドポイント (認証あり)
 *      - POST /mcp     : Streamable HTTP transport
 */

import "dotenv/config";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { promises as fs } from "fs";
import { mkdirSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  authMiddleware,
  validateApiKeyOnStartup,
} from "./middleware/auth.js";
import { registerPrinterTools } from "./tools/printer.js";
import {
  initializeJobDatabase,
  closeJobDatabase,
} from "./services/job-queue.js";
import { checkPrinterDeviceAccess } from "./services/printer-device.js";

// -----------------------------------------------------------------
// ロガー
// -----------------------------------------------------------------

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "main" });

// -----------------------------------------------------------------
// 環境変数・定数
// -----------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8719", 10);
const HOST = process.env.HOST || "127.0.0.1";
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || "/tmp/yamato-printer-uploads";
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "20", 10);
const UPLOAD_TTL_MIN = parseInt(process.env.UPLOAD_TTL_MIN || "30", 10);

// -----------------------------------------------------------------
// 起動前チェック
// -----------------------------------------------------------------

async function preflightChecks(): Promise<void> {
  validateApiKeyOnStartup();

  // アップロードディレクトリ作成
  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    logger.fatal({ err, UPLOAD_DIR }, "Failed to create upload directory");
    process.exit(1);
  }

  // プリンタデバイスチェック (fatal ではなく warn のみ、起動時に未接続でも後で復帰可能)
  const deviceStatus = await checkPrinterDeviceAccess();
  if (deviceStatus.available) {
    logger.info(
      { device: deviceStatus.device },
      "Printer device is accessible"
    );
  } else {
    logger.warn(
      { device: deviceStatus.device, error: deviceStatus.error },
      "Printer device is NOT accessible (server will start anyway, but printing will fail)"
    );
  }

  // ジョブDB初期化
  initializeJobDatabase();
}

// -----------------------------------------------------------------
// アップロードファイル自動削除
// -----------------------------------------------------------------

async function cleanOldUploads(): Promise<void> {
  try {
    const entries = await fs.readdir(UPLOAD_DIR);
    const now = Date.now();
    const ttlMs = UPLOAD_TTL_MIN * 60 * 1000;

    let deleted = 0;
    for (const f of entries) {
      const filePath = join(UPLOAD_DIR, f);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) continue;

      if (now - stat.mtimeMs > ttlMs) {
        await fs.unlink(filePath).catch(() => {});
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info({ deleted, ttlMin: UPLOAD_TTL_MIN }, "Cleaned old uploads");
    }
  } catch (err) {
    logger.warn({ err }, "cleanOldUploads failed");
  }
}

// -----------------------------------------------------------------
// Express setup
// -----------------------------------------------------------------

function buildApp(mcpServer: McpServer): express.Application {
  const app = express();

  // ---- multer (upload用) ----
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, _file, cb) => {
      // file_id = uuid (拡張子なし、ユーザー入力に依存しない)
      cb(null, uuidv4());
    },
  });

  const uploader = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // MIMEタイプとファイル拡張子で簡易判定
      const ok =
        file.mimetype === "application/pdf" ||
        file.originalname.toLowerCase().endsWith(".pdf");
      if (!ok) {
        cb(new Error("Only PDF files are allowed"));
        return;
      }
      cb(null, true);
    },
  });

  // ---- JSON body parser (MCP endpoint用) ----
  app.use("/mcp", express.json({ limit: "10mb" }));

  // ---- 共通 ----
  app.disable("x-powered-by");

  // ---- /health (認証なし) ----
  app.get("/health", async (_req, res) => {
    const deviceStatus = await checkPrinterDeviceAccess();
    res.json({
      status: "ok",
      version: "0.1.0",
      printer: deviceStatus,
      timestamp: new Date().toISOString(),
    });
  });

  // ---- POST /upload (認証なし) ----
  // 既存の printer-mcp-server と同じパターン:
  //   curl -sF "file=@/path/to/shipping.pdf" https://yamato-printer.appserver.tokyo/upload
  app.post("/upload", uploader.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "no_file", message: "file field missing" });
      return;
    }

    const fileId = req.file.filename;
    const originalName = req.file.originalname;
    const size = req.file.size;

    // メタ情報をサイドカーファイルに保存
    const metaPath = `${join(UPLOAD_DIR, fileId)}.meta.json`;
    try {
      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            filename: originalName,
            size,
            uploaded_at: new Date().toISOString(),
            expires_at: new Date(
              Date.now() + UPLOAD_TTL_MIN * 60 * 1000
            ).toISOString(),
          },
          null,
          2
        )
      );
    } catch (err) {
      logger.warn({ err, fileId }, "Failed to write meta.json");
    }

    logger.info(
      { fileId, originalName, size },
      "File uploaded"
    );

    res.json({
      file_id: fileId,
      filename: originalName,
      size,
      expires_in_min: UPLOAD_TTL_MIN,
    });
  });

  // ---- GET /uploads (認証なし) ----
  app.get("/uploads", async (_req: Request, res: Response) => {
    try {
      const entries = await fs.readdir(UPLOAD_DIR).catch(() => []);
      const files = entries.filter((f) => !f.endsWith(".meta.json"));

      const results = await Promise.all(
        files.map(async (f) => {
          const filePath = join(UPLOAD_DIR, f);
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat) return null;

          let filename = f;
          try {
            const meta = JSON.parse(
              await fs.readFile(`${filePath}.meta.json`, "utf-8")
            );
            filename = meta.filename || f;
          } catch {
            /* ignore */
          }

          return {
            file_id: f,
            filename,
            size: stat.size,
            uploaded_at: stat.mtime.toISOString(),
          };
        })
      );

      const list = results.filter(Boolean);
      res.json({ count: list.length, files: list });
    } catch (err) {
      res.status(500).json({
        error: "list_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ---- POST /mcp (認証あり) ----
  // MCP Streamable HTTP transport
  app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // ステートレス
      });
      res.on("close", () => {
        transport.close().catch(() => {});
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, "MCP request error");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              err instanceof Error ? err.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  // ---- エラーハンドラ (multer等) ----
  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    logger.error({ err }, "Express error handler");
    if (res.headersSent) return;
    res.status(400).json({
      error: "request_error",
      message: err.message,
    });
  });

  return app;
}

// -----------------------------------------------------------------
// MCPサーバ構築
// -----------------------------------------------------------------

function buildMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "yamato-printer-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "ヤマト送り状PDFを WS-420B サーマルラベルプリンタで印刷するMCPサーバー。" +
        "対応送り状種別 (slip_type): 230(宅急便), 241(コレクト), 203(タイムサービス), " +
        "10230004(ネコポス), 10230015(クロネコゆうパケット), 10230014(クロネコゆうメール), custom。" +
        "ファイルは POST /upload でアップロード後 print_uploaded、または print_url で任意URL印刷。",
    }
  );

  registerPrinterTools(server);
  return server;
}

// -----------------------------------------------------------------
// メイン
// -----------------------------------------------------------------

async function main(): Promise<void> {
  logger.info(
    {
      node_version: process.version,
      pid: process.pid,
      upload_dir: UPLOAD_DIR,
      port: PORT,
      host: HOST,
    },
    "Starting yamato-printer-mcp-server"
  );

  await preflightChecks();

  const mcpServer = buildMcpServer();
  const app = buildApp(mcpServer);

  const httpServer = app.listen(PORT, HOST, () => {
    logger.info(
      { host: HOST, port: PORT },
      `HTTP server listening — /mcp, /upload, /uploads, /health`
    );
  });

  // 定期クリーンアップ (10分ごと)
  const cleanupInterval = setInterval(() => {
    void cleanOldUploads();
  }, 10 * 60 * 1000);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    clearInterval(cleanupInterval);
    httpServer.close(() => {
      closeJobDatabase();
      logger.info("Shutdown complete");
      process.exit(0);
    });
    // 10秒で強制終了
    setTimeout(() => {
      logger.warn("Forced shutdown (timeout)");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection");
  });

  // 起動直後に一度、古いアップロードを掃除
  void cleanOldUploads();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
