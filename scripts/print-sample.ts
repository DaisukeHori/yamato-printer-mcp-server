/**
 * 実機テスト用サンプル印刷スクリプト
 *
 * 使い方:
 *   npx tsx scripts/print-sample.ts [--mode <test|pdf|dither>] [--slip-type <230|10230004|...>]
 *
 * モード:
 *   test   : 素のTSPLで "Hello WS-420B" を印刷 (PDFラスタライズなし、動作確認用)
 *   pdf    : サンプルPDFを生成して印刷 (PDF→TSPL変換パイプライン全体の確認)
 *   dither : 同じPDFを3つのディザ方式で印刷 (品質比較用)
 *
 * 環境変数 .env が必要 (PRINTER_DEVICE等)
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  sendRawTspl,
  sendToPrinter,
  checkPrinterDeviceAccess,
} from "../src/services/printer-device.js";
import { convertPdfToTspl } from "../src/services/pdf-to-tspl.js";
import type { PrintOptions, SlipType } from "../src/types.js";

// -----------------------------------------------------------------
// 引数解析
// -----------------------------------------------------------------

type Mode = "test" | "pdf" | "dither";

const args = process.argv.slice(2);
let mode: Mode = "test";
let slipType: SlipType = "230";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--mode") {
    const v = args[++i];
    if (v === "test" || v === "pdf" || v === "dither") {
      mode = v;
    } else {
      console.error(`Invalid mode: ${v}. Use: test | pdf | dither`);
      process.exit(1);
    }
  } else if (a === "--slip-type") {
    slipType = args[++i] as SlipType;
  } else if (a === "--help" || a === "-h") {
    console.log(`
Usage: npx tsx scripts/print-sample.ts [options]

Options:
  --mode <test|pdf|dither>  モード (default: test)
  --slip-type <TYPE>        送り状種別 (default: 230)
  --help, -h                ヘルプ

Modes:
  test   : 素のTSPLで "HELLO" 文字列を印刷 (最も単純な動作確認)
  pdf    : サンプルPDF (テキスト+バーコード) を生成して変換・印刷
  dither : threshold/floyd/atkinson の3方式で同一PDFを印刷 (比較用)
`);
    process.exit(0);
  }
}

// -----------------------------------------------------------------
// ヘルパー: ANSI カラーログ
// -----------------------------------------------------------------

const c = {
  green: (s: string) => `\x1b[1;32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[1;33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[1;31m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[1;34m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function logStep(step: string) {
  console.log(`${c.blue("[STEP]")} ${step}`);
}
function logOk(msg: string) {
  console.log(`${c.green("[OK]")} ${msg}`);
}
function logWarn(msg: string) {
  console.log(`${c.yellow("[WARN]")} ${msg}`);
}
function logErr(msg: string) {
  console.log(`${c.red("[ERROR]")} ${msg}`);
}

// -----------------------------------------------------------------
// プリンタ疎通確認
// -----------------------------------------------------------------

async function checkPrinter(): Promise<void> {
  logStep("プリンタデバイスチェック");
  const status = await checkPrinterDeviceAccess();
  if (!status.available) {
    logErr(`プリンタが使えません: ${status.error}`);
    process.exit(1);
  }
  logOk(`デバイス OK: ${status.device}`);
}

// -----------------------------------------------------------------
// Mode: test (素のTSPL)
// -----------------------------------------------------------------

async function runTestMode(): Promise<void> {
  const tsplCommand =
    "SIZE 100 mm, 60 mm\r\n" +
    "GAP 2 mm, 0\r\n" +
    "DIRECTION 1\r\n" +
    "REFERENCE 0,0\r\n" +
    "CLS\r\n" +
    'TEXT 50,50,"4",0,1,1,"HELLO WS-420B"\r\n' +
    'TEXT 50,130,"3",0,1,1,"yamato-printer-mcp-server"\r\n' +
    'TEXT 50,190,"2",0,1,1,"Test print OK"\r\n' +
    'BARCODE 50,250,"128",80,1,0,2,2,"YAMATO-MCP-TEST"\r\n' +
    "PRINT 1,1\r\n";

  logStep("素のTSPLコマンドを送信");
  console.log(c.dim(tsplCommand.replace(/\r\n/g, "↵\n")));

  const bytes = await sendRawTspl(tsplCommand);
  logOk(`${bytes} バイト送信完了`);
  console.log();
  console.log(
    "👉 プリンタから " +
      c.green("『HELLO WS-420B / yamato-printer-mcp-server / Test print OK』") +
      " とバーコードが印刷されたか確認してください。"
  );
}

// -----------------------------------------------------------------
// サンプルPDF生成 (最小のPDF 1.4)
//
// 外部ライブラリなしで、TSPL変換パイプラインのテストに十分なPDFを生成する。
// Helvetica 24ptで複数行のテキストを描画。
// -----------------------------------------------------------------

function generateSamplePdf(text: string[]): Buffer {
  // 最小限のPDF 1.4 を手組みで生成
  // (pdfkit などを入れると依存が増えるのでここでは自前)

  const pageWidth = 306; // pt = 108mm
  const pageHeight = 504; // pt = 178mm (230番相当)

  const contentStream = text
    .map((line, idx) => {
      const y = pageHeight - 80 - idx * 40;
      return `BT /F1 28 Tf 40 ${y} Td (${line}) Tj ET`;
    })
    .join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
  );
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
  );
  const streamContent = `BT\n${contentStream}\nET\n`;
  objects.push(
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`
  );
  objects.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  );

  // PDF 組み立て
  const header = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  let body = header;
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }

  const xrefOffset = body.length;
  body += "xref\n";
  body += `0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  body += "trailer\n";
  body += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += "startxref\n";
  body += `${xrefOffset}\n`;
  body += "%%EOF\n";

  return Buffer.from(body, "binary");
}

// -----------------------------------------------------------------
// Mode: pdf (PDFラスタライズ→TSPL)
// -----------------------------------------------------------------

async function runPdfMode(): Promise<void> {
  logStep("サンプルPDFを生成");
  const pdfBuffer = generateSamplePdf([
    "Yamato Test Label",
    `slip_type: ${slipType}`,
    new Date().toLocaleString("ja-JP"),
    "Generated by",
    "yamato-printer-mcp-server",
  ]);

  const pdfPath = join(tmpdir(), `yamato-sample-${Date.now()}.pdf`);
  writeFileSync(pdfPath, pdfBuffer);
  logOk(`サンプルPDF保存: ${pdfPath} (${pdfBuffer.length} bytes)`);

  const options: PrintOptions = {
    slip_type: slipType,
    copies: 1,
  };

  logStep("PDF → TSPL 変換");
  const result = await convertPdfToTspl(pdfBuffer, options);
  logOk(
    `変換完了: ${result.elapsed_ms}ms, ` +
      `bitmap ${result.bitmap_width_bytes}×${result.bitmap_height_pixels}, ` +
      `TSPL ${result.tspl_buffer.length} bytes`
  );

  logStep("プリンタへ送信");
  const bytes = await sendToPrinter(result.tspl_buffer);
  logOk(`${bytes} バイト送信完了`);
  console.log();
  console.log(
    "👉 プリンタからサンプルラベルが印刷されたか確認してください。"
  );
}

// -----------------------------------------------------------------
// Mode: dither (3方式比較)
// -----------------------------------------------------------------

async function runDitherMode(): Promise<void> {
  logStep("サンプルPDFを生成 (ディザ比較用)");
  const pdfBuffer = generateSamplePdf([
    "Dither Comparison",
    `Method: (see below)`,
    new Date().toLocaleString("ja-JP"),
    "yamato-printer-mcp-server",
  ]);

  const methods: Array<"threshold" | "floyd" | "atkinson"> = [
    "threshold",
    "floyd",
    "atkinson",
  ];

  for (const method of methods) {
    logStep(`ディザ方式: ${method} で印刷`);
    const options: PrintOptions = {
      slip_type: slipType,
      copies: 1,
      dither_method: method,
    };

    const result = await convertPdfToTspl(pdfBuffer, options);
    const bytes = await sendToPrinter(result.tspl_buffer);
    logOk(
      `${method}: ${result.elapsed_ms}ms, ${bytes}バイト送信。次のラベルが印刷されるまで約5秒待機...`
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log();
  console.log(
    "👉 3枚のラベルを比較して、どのディザ方式が見やすいか確認してください。"
  );
}

// -----------------------------------------------------------------
// メイン
// -----------------------------------------------------------------

async function main() {
  console.log(c.dim("=".repeat(60)));
  console.log(c.blue("yamato-printer-mcp-server — Sample Print"));
  console.log(c.dim(`Mode: ${mode}  Slip type: ${slipType}`));
  console.log(c.dim("=".repeat(60)));
  console.log();

  await checkPrinter();
  console.log();

  switch (mode) {
    case "test":
      await runTestMode();
      break;
    case "pdf":
      await runPdfMode();
      break;
    case "dither":
      await runDitherMode();
      break;
  }

  console.log();
  console.log(c.dim("=".repeat(60)));
  console.log(c.green("完了"));
}

main().catch((err) => {
  logErr(`失敗: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.log(c.dim(err.stack));
  }
  process.exit(1);
});
