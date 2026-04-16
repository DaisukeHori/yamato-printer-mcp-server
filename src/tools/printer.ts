/**
 * MCPツール定義
 *
 * 既存の printer-mcp-server (Kyocera) と同じパターンで 7 ツールを提供:
 *   1. print_uploaded      - /upload 経由でアップロード済みのファイルを印刷
 *   2. print_url           - 任意URL (S3 presigned URL等) から取得して印刷
 *   3. list_uploads        - アップロード済みファイル一覧
 *   4. list_jobs           - ジョブ履歴
 *   5. get_job_status      - ジョブ状態問い合わせ
 *   6. validate_print_options - 印刷オプション事前検証
 *   7. list_slip_types     - 対応送り状種別一覧
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promises as fs } from "fs";
import { join } from "path";
import pino from "pino";

import type { PrintOptions } from "../types.js";
import {
  resolveSlipPreset,
  listSupportedSlipTypes,
  getSlipTypesWithDescription,
} from "../services/yamato-slips.js";
import { convertPdfToTspl } from "../services/pdf-to-tspl.js";
import {
  sendToPrinter,
  PrinterWriteError,
  checkPrinterDeviceAccess,
} from "../services/printer-device.js";
import {
  createJob,
  updateJobStatus,
  getJob,
  listJobs,
} from "../services/job-queue.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "mcp-tools" });

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || "/tmp/yamato-printer-uploads";

const BLOCKED_CIDRS = (
  process.env.BLOCKED_CIDRS ||
  "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,127.0.0.0/8"
)
  .split(",")
  .map((s) => s.trim());

// -----------------------------------------------------------
// 共通 Zod スキーマ
// -----------------------------------------------------------

const slipTypeSchema = z
  .enum([
    "230",
    "241",
    "203",
    "10230004",
    "10230015",
    "10230014",
    "custom",
  ])
  .describe(
    "ヤマト送り状種別。list_slip_types で一覧確認可能。"
  );

const printOptionsRawSchema = {
  slip_type: slipTypeSchema,
  copies: z
    .number()
    .int()
    .min(1)
    .max(999)
    .optional()
    .describe("印刷部数 (1-999, デフォルト1)"),
  custom_width_mm: z
    .number()
    .positive()
    .max(108)
    .optional()
    .describe('slip_type="custom" 時の幅 (mm, 最大108)'),
  custom_height_mm: z
    .number()
    .positive()
    .max(1778)
    .optional()
    .describe('slip_type="custom" 時の高さ (mm, 最大1778)'),
  dither_method: z
    .enum(["threshold", "floyd", "atkinson"])
    .optional()
    .describe("ディザ方式 (デフォルト: 環境変数 DITHER_METHOD)"),
  dither_threshold: z
    .number()
    .int()
    .min(0)
    .max(255)
    .optional()
    .describe("ディザしきい値 0-255 (デフォルト: 環境変数)"),
  direction: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .describe("TSPL DIRECTION (0=正方向, 1=180度回転)"),
};

// -----------------------------------------------------------
// ユーティリティ
// -----------------------------------------------------------

/**
 * MCP応答形式 (text 1件) でテキスト返却
 */
function ok(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function okJson(obj: unknown) {
  return ok(JSON.stringify(obj, null, 2));
}

function errJson(error: string, detail?: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error, detail: detail ?? null }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * SSRF ガード (簡易版)
 *
 * - http/https 以外のプロトコル拒否
 * - 内部ネットワークのホスト名/IPアドレス拒否
 */
function isBlockedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return `Protocol not allowed: ${parsed.protocol} (only http/https)`;
  }

  const hostname = parsed.hostname;

  // ローカルホスト系のブロック
  const localhostKeywords = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal", // GCP metadata
    "169.254.169.254", // AWS/Azure metadata
  ];
  if (localhostKeywords.some((k) => hostname.toLowerCase() === k)) {
    return `Hostname blocked (internal): ${hostname}`;
  }

  // CIDR判定 (簡易的にプレフィックスマッチ)
  // 本格的な CIDR マッチは ipaddr.js 等が必要だが、
  // ここでは代表的なプライベートIPのプレフィックスで判定
  const privatePrefixes = ["10.", "192.168.", "169.254.", "127."];
  if (privatePrefixes.some((p) => hostname.startsWith(p))) {
    return `Hostname blocked (private IP): ${hostname}`;
  }
  // 172.16.0.0/12 は 172.16〜172.31 の範囲
  if (hostname.startsWith("172.")) {
    const second = parseInt(hostname.split(".")[1] || "0", 10);
    if (second >= 16 && second <= 31) {
      return `Hostname blocked (private IP 172.16/12): ${hostname}`;
    }
  }

  // BLOCKED_CIDRS の参照 (環境変数)
  logger.debug({ blocked_cidrs: BLOCKED_CIDRS }, "SSRF check");

  return null;
}

/**
 * 共通: ジョブIDを作って 変換 → 印刷 を実行
 */
async function executeConvertAndPrint(
  pdfBuffer: Buffer,
  options: PrintOptions,
  filename: string,
  sourceInfo: { file_id?: string; source_url?: string }
): Promise<{
  job_id: string;
  status: string;
  bytes_sent?: number;
  error?: string;
}> {
  const copies = options.copies ?? 1;
  const jobId = createJob({
    file_id: sourceInfo.file_id || null,
    source_url: sourceInfo.source_url || null,
    filename,
    slip_type: options.slip_type,
    copies,
  });

  try {
    updateJobStatus(jobId, "converting");
    const conv = await convertPdfToTspl(pdfBuffer, options);

    updateJobStatus(jobId, "printing");
    const bytes = await sendToPrinter(conv.tspl_buffer);

    updateJobStatus(jobId, "completed", { bytes_sent: bytes });
    return { job_id: jobId, status: "completed", bytes_sent: bytes };
  } catch (err) {
    const errorMsg =
      err instanceof PrinterWriteError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);

    updateJobStatus(jobId, "failed", { error: errorMsg });
    logger.error({ err, job_id: jobId }, "Job failed");
    return { job_id: jobId, status: "failed", error: errorMsg };
  }
}

// -----------------------------------------------------------
// MCPツール登録
// -----------------------------------------------------------

export function registerPrinterTools(server: McpServer): void {
  // ---------------------------------------------------------
  // 1. print_uploaded
  // ---------------------------------------------------------
  server.registerTool(
    "print_uploaded",
    {
      title: "Print Uploaded File",
      description: `アップロード済みファイル(POST /upload でアップロードされたPDF)をヤマト送り状として印刷する。

WORKFLOW:
  1. ユーザーがClaude.aiにファイルをアップロード
  2. Claude が bash_tool で curl:
     curl -sF "file=@/mnt/user-data/uploads/FILE.pdf" https://yamato-printer.appserver.tokyo/upload
     → {"file_id":"abc123","filename":"shipping.pdf","size":45000}
  3. Claude が print_uploaded(file_id="abc123", slip_type="230") を呼ぶ

Returns: {"job_id": "job_xxx", "status": "completed", "bytes_sent": N}`,
      inputSchema: {
        file_id: z
          .string()
          .min(1)
          .describe("/upload エンドポイントが返した file_id"),
        ...printOptionsRawSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const filePath = join(UPLOAD_DIR, args.file_id);

        // ファイル存在確認
        let pdfBuffer: Buffer;
        try {
          pdfBuffer = await fs.readFile(filePath);
        } catch {
          return errJson(
            "file_not_found",
            `file_id=${args.file_id} not found in ${UPLOAD_DIR}. ` +
              `It may have expired (TTL: ${process.env.UPLOAD_TTL_MIN || 30} min) ` +
              `or was never uploaded.`
          );
        }

        // ファイル名をメタ情報から取得(なければ file_id を使用)
        const metaPath = `${filePath}.meta.json`;
        let originalFilename = args.file_id;
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
          originalFilename = meta.filename || args.file_id;
        } catch {
          // メタなしでも処理続行
        }

        const options: PrintOptions = {
          slip_type: args.slip_type,
          copies: args.copies,
          custom_width_mm: args.custom_width_mm,
          custom_height_mm: args.custom_height_mm,
          dither_method: args.dither_method,
          dither_threshold: args.dither_threshold,
          direction: args.direction,
        };

        const result = await executeConvertAndPrint(
          pdfBuffer,
          options,
          originalFilename,
          { file_id: args.file_id }
        );

        return okJson(result);
      } catch (err) {
        return errJson(
          "unexpected_error",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ---------------------------------------------------------
  // 2. print_url
  // ---------------------------------------------------------
  server.registerTool(
    "print_url",
    {
      title: "Print from URL",
      description: `任意のURL (S3 presigned URL、公開URL等) からPDFを取得してヤマト送り状として印刷する。

USE CASES:
  - S3 / R2 / Cloudflare Workers に置いたPDF
  - 業務システムがホストする送り状PDF (認証不要の内部URL)
  - MCPクライアント側で事前にアップロードした Presigned URL

SECURITY:
  - 内部ネットワーク(10.*, 192.168.*, 127.*, 169.254.*)への接続はブロック
  - http/https 以外のプロトコルは拒否

Returns: {"job_id": "job_xxx", "status": "completed", "bytes_sent": N}`,
      inputSchema: {
        url: z
          .string()
          .url()
          .describe("PDFを取得する URL (http / https、public または presigned)"),
        filename: z
          .string()
          .min(1)
          .max(255)
          .describe("ジョブ履歴に記録する任意のファイル名 (例: shipping.pdf)"),
        ...printOptionsRawSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        // SSRFガード
        const blockReason = isBlockedUrl(args.url);
        if (blockReason) {
          return errJson("blocked_url", blockReason);
        }

        // GET request
        let pdfBuffer: Buffer;
        try {
          const res = await fetch(args.url, {
            redirect: "follow",
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) {
            return errJson(
              "fetch_failed",
              `HTTP ${res.status} ${res.statusText} from ${args.url}`
            );
          }
          const arrBuf = await res.arrayBuffer();
          pdfBuffer = Buffer.from(arrBuf);
        } catch (err) {
          return errJson(
            "fetch_error",
            err instanceof Error ? err.message : String(err)
          );
        }

        if (pdfBuffer.length === 0) {
          return errJson("empty_response", "Downloaded file is empty");
        }

        // ざっくりPDFシグネチャチェック (%PDF)
        if (pdfBuffer.slice(0, 4).toString("ascii") !== "%PDF") {
          return errJson(
            "not_a_pdf",
            "Downloaded file does not start with %PDF signature"
          );
        }

        const options: PrintOptions = {
          slip_type: args.slip_type,
          copies: args.copies,
          custom_width_mm: args.custom_width_mm,
          custom_height_mm: args.custom_height_mm,
          dither_method: args.dither_method,
          dither_threshold: args.dither_threshold,
          direction: args.direction,
        };

        const result = await executeConvertAndPrint(
          pdfBuffer,
          options,
          args.filename,
          { source_url: args.url }
        );

        return okJson(result);
      } catch (err) {
        return errJson(
          "unexpected_error",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ---------------------------------------------------------
  // 3. list_uploads
  // ---------------------------------------------------------
  server.registerTool(
    "list_uploads",
    {
      title: "List Uploaded Files",
      description: `アップロード済みファイルの一覧を取得する。

Returns: [{"file_id":"abc","filename":"a.pdf","size":N,"uploaded_at":"...","expires_at":"..."}]`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const entries = await fs.readdir(UPLOAD_DIR).catch(() => []);
        const files = entries.filter((f) => !f.endsWith(".meta.json"));

        const results: Array<{
          file_id: string;
          filename: string;
          size: number;
          uploaded_at: string;
        }> = [];

        for (const f of files) {
          const filePath = join(UPLOAD_DIR, f);
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat) continue;

          let filename = f;
          try {
            const meta = JSON.parse(
              await fs.readFile(`${filePath}.meta.json`, "utf-8")
            );
            filename = meta.filename || f;
          } catch {
            // メタなしでも続行
          }

          results.push({
            file_id: f,
            filename,
            size: stat.size,
            uploaded_at: stat.mtime.toISOString(),
          });
        }

        // 新しい順
        results.sort((a, b) =>
          a.uploaded_at < b.uploaded_at ? 1 : -1
        );

        if (results.length === 0) {
          return ok("No uploaded files.");
        }

        return okJson({ count: results.length, files: results });
      } catch (err) {
        return errJson(
          "list_uploads_error",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ---------------------------------------------------------
  // 4. list_jobs
  // ---------------------------------------------------------
  server.registerTool(
    "list_jobs",
    {
      title: "List Print Jobs",
      description: `印刷ジョブの履歴を新しい順で取得する。

Returns: [{"job_id":"job_xxx","filename":"a.pdf","slip_type":"230","status":"completed",...}]`,
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("取得件数 (1-500、デフォルト50)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const jobs = listJobs(args.limit);
        if (jobs.length === 0) {
          return ok("No jobs found.");
        }
        return okJson({ count: jobs.length, jobs });
      } catch (err) {
        return errJson(
          "list_jobs_error",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ---------------------------------------------------------
  // 5. get_job_status
  // ---------------------------------------------------------
  server.registerTool(
    "get_job_status",
    {
      title: "Get Job Status",
      description: `特定のジョブの状態を取得する。

Returns: {"job_id":"job_xxx","status":"completed|failed|printing|...","error":null,...}`,
      inputSchema: {
        job_id: z.string().min(1).describe("ジョブID (print_xxx が返したjob_id)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const job = getJob(args.job_id);
        if (!job) {
          return errJson("job_not_found", `job_id=${args.job_id}`);
        }
        return okJson(job);
      } catch (err) {
        return errJson(
          "get_job_error",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ---------------------------------------------------------
  // 6. validate_print_options
  // ---------------------------------------------------------
  server.registerTool(
    "validate_print_options",
    {
      title: "Validate Print Options",
      description: `印刷オプションを事前に検証する。slip_type や custom サイズが妥当か、
ヤマト送り状プリセットの範囲内かをチェックする。実印刷はしない。

Returns:
  valid=true のとき: {"valid": true, "resolved": {"size_mm":{...},"direction":N,...}}
  valid=false のとき: {"valid": false, "errors": [...]}`,
      inputSchema: printOptionsRawSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const options: PrintOptions = {
          slip_type: args.slip_type,
          copies: args.copies,
          custom_width_mm: args.custom_width_mm,
          custom_height_mm: args.custom_height_mm,
          dither_method: args.dither_method,
          dither_threshold: args.dither_threshold,
          direction: args.direction,
        };

        const preset = resolveSlipPreset(options);

        // プリンタデバイスもチェック
        const deviceStatus = await checkPrinterDeviceAccess();

        return okJson({
          valid: true,
          resolved: {
            slip_type: options.slip_type,
            size_mm: preset.size,
            direction: preset.direction,
            gap_mm: preset.gap_mm,
            description: preset.description,
            copies: options.copies ?? 1,
            dither_method:
              options.dither_method || process.env.DITHER_METHOD || "threshold",
            dither_threshold:
              options.dither_threshold ??
              parseInt(process.env.DITHER_THRESHOLD || "128", 10),
          },
          printer_device: deviceStatus,
        });
      } catch (err) {
        return okJson({
          valid: false,
          errors: [err instanceof Error ? err.message : String(err)],
        });
      }
    }
  );

  // ---------------------------------------------------------
  // 7. list_slip_types
  // ---------------------------------------------------------
  server.registerTool(
    "list_slip_types",
    {
      title: "List Yamato Slip Types",
      description: `サポートされているヤマト送り状種別(slip_type)と用紙サイズの一覧を返す。
print_uploaded / print_url / validate_print_options で使える値の参照用。`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      return okJson({
        supported: getSlipTypesWithDescription(),
        usage_example: {
          print_uploaded: {
            file_id: "abc123",
            slip_type: "230",
            copies: 1,
          },
          print_url_custom: {
            url: "https://example.com/shipping.pdf",
            filename: "shipping.pdf",
            slip_type: "custom",
            custom_width_mm: 100,
            custom_height_mm: 150,
          },
        },
      });
    }
  );

  logger.info(
    { count: 7, tools: listSupportedSlipTypes().length },
    "MCP tools registered"
  );
}
