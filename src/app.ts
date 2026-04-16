/**
 * Express アプリケーション + MCP サーバーの組み立てを担当する。
 *
 * index.ts (エントリポイント) と tests/integration から共通で使えるよう
 * 純粋なファクトリ関数として分離。
 */

import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { promises as fs } from "fs";
import { mkdirSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { authMiddleware } from "./middleware/auth.js";
import { registerPrinterTools } from "./tools/printer.js";
import { checkPrinterDeviceAccess } from "./services/printer-device.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "app" });

/**
 * MCP サーバーを組み立てて全てのツールを登録する
 */
export function buildMcpServer(): McpServer {
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

/**
 * Express アプリを組み立てる
 *
 * - POST /upload    : 認証なし、multer でファイル受信
 * - GET  /uploads   : 認証なし、アップロードファイル一覧
 * - GET  /health    : 認証なし、ヘルスチェック
 * - POST /mcp       : MCP_API_KEY 認証、MCP over HTTP
 */
export function buildApp(mcpServer: McpServer): express.Application {
  const UPLOAD_DIR =
    process.env.UPLOAD_DIR || "/tmp/yamato-printer-uploads";
  const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "20", 10);
  const UPLOAD_TTL_MIN = parseInt(process.env.UPLOAD_TTL_MIN || "30", 10);

  // upload ディレクトリを作成 (冪等)
  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch {
    /* 既に存在する等は無視 */
  }

  const app = express();

  // multer (upload用)
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, _file, cb) => {
      cb(null, uuidv4());
    },
  });

  const uploader = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
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

  app.use("/mcp", express.json({ limit: "10mb" }));
  app.disable("x-powered-by");

  // ---- /health ----
  app.get("/health", async (_req, res) => {
    const deviceStatus = await checkPrinterDeviceAccess();
    res.json({
      status: "ok",
      version: "0.1.0",
      printer: deviceStatus,
      timestamp: new Date().toISOString(),
    });
  });

  // ---- POST /upload ----
  app.post(
    "/upload",
    uploader.single("file"),
    async (req: Request, res: Response) => {
      if (!req.file) {
        res.status(400).json({
          error: "no_file",
          message: "file field missing",
        });
        return;
      }

      const fileId = req.file.filename;
      const originalName = req.file.originalname;
      const size = req.file.size;

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

      res.json({
        file_id: fileId,
        filename: originalName,
        size,
        expires_in_min: UPLOAD_TTL_MIN,
      });
    }
  );

  // ---- GET /uploads ----
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

  // ---- POST /mcp ----
  app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
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

  // Express エラーハンドラ (multer 等)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(
    (
      err: Error,
      _req: Request,
      res: Response,
      _next: NextFunction
    ): void => {
      logger.error({ err }, "Express error handler");
      if (res.headersSent) return;
      res.status(400).json({
        error: "request_error",
        message: err.message,
      });
    }
  );

  return app;
}
