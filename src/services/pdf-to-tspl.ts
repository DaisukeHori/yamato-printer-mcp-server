/**
 * PDF → TSPL 変換サービス
 *
 * パイプライン:
 *   1. PDF を pdf-to-img でPNGラスタライズ
 *   2. sharp で指定サイズにリサイズ + 1bit 二値化
 *   3. 1bitビットマップを MSBファースト のバイト列にパッキング
 *   4. TSPL コマンド文字列 + バイナリBITMAP を結合
 *
 * TSPL BITMAP 仕様 (TSC AUTO ID Technology 公式マニュアルより):
 *   BITMAP X, Y, width_bytes, height_pixels, mode, bitmap_data
 *     - X, Y          : 左上座標 (dots)
 *     - width_bytes   : ビットマップの横幅をバイト数で (=ceil(pixel_width / 8))
 *     - height_pixels : ビットマップの縦の高さ(ピクセル数)
 *     - mode          : 0=OVERWRITE, 1=OR, 2=XOR
 *     - bitmap_data   : 1bit/pixel, MSBファースト, row-major, 黒=1 / 白=0
 */

import { pdf } from "pdf-to-img";
import sharp from "sharp";
import type { PrintOptions, SlipPreset, TsplConversionResult } from "../types.js";
import { resolveSlipPreset } from "./yamato-slips.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "pdf-to-tspl" });

const DPI = parseInt(process.env.PRINTER_DPI || "203", 10);
const DEFAULT_DITHER_THRESHOLD = parseInt(
  process.env.DITHER_THRESHOLD || "128",
  10
);
const DEFAULT_DITHER_METHOD = (process.env.DITHER_METHOD || "threshold") as
  | "threshold"
  | "floyd"
  | "atkinson";

/**
 * mm を dots (pixels) に変換する (DPI基準)
 *
 * 203 dpi = 203 dots / 25.4mm = 約 8 dots/mm
 * 用紙幅 108mm = 864 dots
 */
function mmToDots(mm: number): number {
  return Math.round((mm * DPI) / 25.4);
}

/**
 * PDFバッファを PNG (RGBA) にラスタライズする
 *
 * pdf-to-img は内部で mupdf-wasm を使っており、
 * Raspberry Pi (ARM64) でも動作する。
 *
 * @param pdfBuffer   PDFファイルのバッファ
 * @param targetWidth レンダリング時のターゲット幅(pixel)。
 *                    実際のリサイズは後段のsharpで行うため、ここでは
 *                    targetWidth を下回らないよう scale の下限計算に使う。
 * @returns 最初のページのPNGバッファ
 */
async function rasterizePdfFirstPage(
  pdfBuffer: Buffer,
  targetWidth: number
): Promise<{ pngBuffer: Buffer; pageCount: number }> {
  // pdf-to-img は内部で 72dpi 基準で pixel 化する。
  // 典型的なヤマトB2クラウドのPDFページ幅 ≈ 306pt (108mm相当) のため、
  // targetWidth (dots) / 306 を下限として scale を設定すると、
  // リサイズ時にアップスケールが発生せず画質が保たれる。
  // 環境変数 PDF_RENDER_SCALE で明示的上書きも可能。
  const envScale = parseFloat(process.env.PDF_RENDER_SCALE || "1.0");
  const derivedScale = Math.max(1.0, Math.ceil(targetWidth / 306));
  const scale = Math.max(envScale, derivedScale);

  logger.debug(
    { targetWidth, envScale, derivedScale, finalScale: scale },
    "Rasterization scale computed"
  );

  const doc = await pdf(pdfBuffer, {
    scale,
  });

  const pageCount = doc.length;

  if (pageCount === 0) {
    throw new Error("PDF has no pages");
  }

  if (pageCount > 1) {
    logger.warn(
      { pageCount },
      "PDF has multiple pages. Only the first page will be printed."
    );
  }

  // 最初のページのみ取得
  let firstPagePng: Buffer | undefined;
  let currentIdx = 0;
  for await (const pageImage of doc) {
    if (currentIdx === 0) {
      firstPagePng = pageImage;
      break;
    }
    currentIdx++;
  }

  if (!firstPagePng) {
    throw new Error("Failed to rasterize PDF first page");
  }

  return { pngBuffer: firstPagePng, pageCount };
}

/**
 * 画像を1bitビットマップにバイナリパッキングする
 *
 * sharp で二値化済みのグレースケール1byte/pixel データを受け取り、
 * MSBファースト、row-major のビット列に変換する。
 *
 * 黒 (ピクセル値 < threshold) を 1 にする。
 */
function packTo1BitBitmap(
  rawPixels: Buffer,
  width: number,
  height: number,
  threshold: number
): { bitmap: Buffer; widthBytes: number } {
  const widthBytes = Math.ceil(width / 8);
  const bitmap = Buffer.alloc(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let byteX = 0; byteX < widthBytes; byteX++) {
      let byteValue = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = byteX * 8 + bit;
        if (pixelX >= width) break; // 行末の余り bit は 0 (白) のまま

        const pixelIndex = y * width + pixelX;
        const pixelValue = rawPixels[pixelIndex];

        // 黒(暗い) = 1 (TSPLの1=印字あり)
        if (pixelValue !== undefined && pixelValue < threshold) {
          byteValue |= 1 << (7 - bit); // MSBファースト
        }
      }
      bitmap[y * widthBytes + byteX] = byteValue;
    }
  }

  return { bitmap, widthBytes };
}

/**
 * 画像前処理 (sharp)
 *
 * リサイズ → グレースケール → ディザ処理 → raw pixels
 */
async function preprocessImage(
  pngBuffer: Buffer,
  targetWidth: number,
  targetHeight: number,
  ditherMethod: "threshold" | "floyd" | "atkinson",
  threshold: number
): Promise<Buffer> {
  let pipeline = sharp(pngBuffer)
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    // 背景を白で塗る (透過PDFの場合に黒くならないように)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale();

  // ディザ方式による分岐
  if (ditherMethod === "threshold") {
    // 単純しきい値: threshold() を使う
    pipeline = pipeline.threshold(threshold);
  } else if (ditherMethod === "floyd" || ditherMethod === "atkinson") {
    // sharp には誤差拡散ディザが直接ないため、
    // まずコントラストを強めて、その後 threshold() で二値化する簡易実装
    // (将来的に拡張: より本格的な誤差拡散を自前実装)
    pipeline = pipeline
      .linear(1.2, -20) // コントラスト強調
      .threshold(threshold);

    logger.debug(
      { ditherMethod },
      "Using approximated dithering (sharp has no native error-diffusion; using contrast+threshold instead)"
    );
  }

  // ピクセル幅に厳密に合わせるため、一度raw bufferで取り出して再パディング
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  // resize fit=inside で小さくなっている可能性があるので、
  // 目標サイズに満たない部分を白で埋める (センタリングはしない。左上から配置)
  if (info.width === targetWidth && info.height === targetHeight) {
    return data;
  }

  logger.debug(
    {
      rendered: { w: info.width, h: info.height },
      target: { w: targetWidth, h: targetHeight },
    },
    "Padding image to target dimensions"
  );

  const padded = Buffer.alloc(targetWidth * targetHeight, 255); // 白=255で初期化
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const srcIdx = y * info.width + x;
      const dstIdx = y * targetWidth + x;
      padded[dstIdx] = data[srcIdx] ?? 255;
    }
  }

  return padded;
}

/**
 * PDFバッファを TSPL コマンド列 (Buffer) に変換する
 *
 * @param pdfBuffer   PDF のバイナリ
 * @param options     印刷オプション
 * @returns           TSPL コマンド列と変換メタ情報
 */
export async function convertPdfToTspl(
  pdfBuffer: Buffer,
  options: PrintOptions
): Promise<TsplConversionResult> {
  const start = Date.now();

  // プリセット解決
  const preset: SlipPreset = resolveSlipPreset(options);
  const widthDots = mmToDots(preset.size.width_mm);
  const heightDots = mmToDots(preset.size.height_mm);

  logger.info(
    {
      slip_type: options.slip_type,
      size_mm: preset.size,
      target_dots: { w: widthDots, h: heightDots },
    },
    "Starting PDF to TSPL conversion"
  );

  // 1. PDFラスタライズ
  const { pngBuffer, pageCount } = await rasterizePdfFirstPage(
    pdfBuffer,
    widthDots
  );

  // 2. sharp で二値化 (raw 1byte/pixel)
  const ditherMethod = options.dither_method || DEFAULT_DITHER_METHOD;
  const threshold = options.dither_threshold ?? DEFAULT_DITHER_THRESHOLD;

  const rawPixels = await preprocessImage(
    pngBuffer,
    widthDots,
    heightDots,
    ditherMethod,
    threshold
  );

  // 3. 1bitビットマップへのパッキング
  // packTo1BitBitmap では 0 or 255 の二値化済みデータを扱うので
  // threshold は 128 固定で OK (sharp側で既に二値化済み)
  const { bitmap, widthBytes } = packTo1BitBitmap(
    rawPixels,
    widthDots,
    heightDots,
    128
  );

  // 4. TSPL コマンドヘッダ生成
  const copies = Math.max(1, Math.min(999, options.copies ?? 1));
  const direction = options.direction ?? preset.direction;

  const headerText =
    `SIZE ${preset.size.width_mm} mm, ${preset.size.height_mm} mm\r\n` +
    `GAP ${preset.gap_mm} mm, 0\r\n` +
    `DIRECTION ${direction}\r\n` +
    `REFERENCE 0,0\r\n` +
    `CLS\r\n` +
    `BITMAP 0,0,${widthBytes},${heightDots},0,`;

  const footerText = `\r\nPRINT 1,${copies}\r\n`;

  // 5. ヘッダ + バイナリBITMAPデータ + フッタ を結合
  const headerBuf = Buffer.from(headerText, "ascii");
  const footerBuf = Buffer.from(footerText, "ascii");
  const tsplBuffer = Buffer.concat([headerBuf, bitmap, footerBuf]);

  const elapsed = Date.now() - start;

  logger.info(
    {
      elapsed_ms: elapsed,
      bitmap_size_bytes: bitmap.length,
      total_tspl_bytes: tsplBuffer.length,
      pdf_pages: pageCount,
    },
    "PDF to TSPL conversion completed"
  );

  return {
    tspl_buffer: tsplBuffer,
    pdf_page_count: pageCount,
    rendered_pixels: { width: widthDots, height: heightDots },
    bitmap_width_bytes: widthBytes,
    bitmap_height_pixels: heightDots,
    elapsed_ms: elapsed,
  };
}
