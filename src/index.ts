/**
 * yamato-printer-mcp-server エントリポイント
 *
 * Express アプリと MCP サーバーの組み立ては src/app.ts に分離。
 * このファイルは preflight チェック、HTTPサーバ起動、systemd signal 対応を担う。
 */

import "dotenv/config";
import { promises as fs } from "fs";
import { mkdirSync } from "fs";
import { join } from "path";
import pino from "pino";

import { buildApp, buildMcpServer } from "./app.js";
import { validateApiKeyOnStartup } from "./middleware/auth.js";
import {
  initializeJobDatabase,
  closeJobDatabase,
} from "./services/job-queue.js";
import { checkPrinterDeviceAccess } from "./services/printer-device.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "main" });

const PORT = parseInt(process.env.PORT || "8719", 10);
const HOST = process.env.HOST || "127.0.0.1";
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || "/tmp/yamato-printer-uploads";
const UPLOAD_TTL_MIN = parseInt(process.env.UPLOAD_TTL_MIN || "30", 10);

// -----------------------------------------------------------------
// 起動前チェック
// -----------------------------------------------------------------

async function preflightChecks(): Promise<void> {
  validateApiKeyOnStartup();

  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    logger.fatal({ err, UPLOAD_DIR }, "Failed to create upload directory");
    process.exit(1);
  }

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

  const cleanupInterval = setInterval(() => {
    void cleanOldUploads();
  }, 10 * 60 * 1000);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    clearInterval(cleanupInterval);
    httpServer.close(() => {
      closeJobDatabase();
      logger.info("Shutdown complete");
      process.exit(0);
    });
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

  void cleanOldUploads();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
