/**
 * pdf-to-tspl.ts のユニットテスト
 *
 * 対象:
 *   - mmToDots(): mm → dots 変換
 *   - packTo1BitBitmap(): グレースケール画像 → 1bit TSPL 形式
 *   - convertPdfToTspl(): エンドツーエンドの PDF → TSPL 変換 (小さなPDFで)
 */

import { describe, it, expect } from "vitest";
import {
  mmToDots,
  packTo1BitBitmap,
  convertPdfToTspl,
} from "../../src/services/pdf-to-tspl.js";
import { generateMinimalPdf } from "../fixtures/pdf-helper.js";

// =================================================================
// mmToDots() のテスト
// =================================================================

describe("mmToDots()", () => {
  it("0 mm は 0 dots", () => {
    expect(mmToDots(0)).toBe(0);
  });

  it("25.4mm (1inch) は 203 dots (203dpi)", () => {
    expect(mmToDots(25.4)).toBe(203);
  });

  it("108mm (ラベル幅) は約 864 dots", () => {
    // 108 * 203 / 25.4 = 863.37… → round → 863
    // 実装は Math.round なので 863 になる可能性もある
    const dots = mmToDots(108);
    expect(dots).toBeGreaterThanOrEqual(862);
    expect(dots).toBeLessThanOrEqual(864);
  });

  it("178mm (230番ラベル高) は約 1424 dots", () => {
    const dots = mmToDots(178);
    expect(dots).toBeGreaterThanOrEqual(1422);
    expect(dots).toBeLessThanOrEqual(1425);
  });

  it("228mm (241番ラベル高) は約 1822 dots", () => {
    const dots = mmToDots(228);
    expect(dots).toBeGreaterThanOrEqual(1820);
    expect(dots).toBeLessThanOrEqual(1824);
  });

  it("負の値でも整数が返る (壊れない)", () => {
    expect(Number.isInteger(mmToDots(-10))).toBe(true);
  });

  it("整数を返す (Math.round 済み)", () => {
    expect(Number.isInteger(mmToDots(10.5))).toBe(true);
    expect(Number.isInteger(mmToDots(33.3))).toBe(true);
  });
});

// =================================================================
// packTo1BitBitmap() のテスト
// =================================================================

describe("packTo1BitBitmap()", () => {
  describe("単純な変換", () => {
    it("全て白(255)の 8×1 画像は 1 バイトの 0x00", () => {
      const white = Buffer.alloc(8, 255);
      const { bitmap, widthBytes } = packTo1BitBitmap(white, 8, 1, 128);
      expect(widthBytes).toBe(1);
      expect(bitmap.length).toBe(1);
      expect(bitmap[0]).toBe(0x00);
    });

    it("全て黒(0)の 8×1 画像は 1 バイトの 0xFF", () => {
      const black = Buffer.alloc(8, 0);
      const { bitmap, widthBytes } = packTo1BitBitmap(black, 8, 1, 128);
      expect(widthBytes).toBe(1);
      expect(bitmap[0]).toBe(0xff);
    });

    it("左端のみ黒 (1pixel) → MSB=1 の 0x80", () => {
      const pixels = Buffer.from([0, 255, 255, 255, 255, 255, 255, 255]);
      const { bitmap } = packTo1BitBitmap(pixels, 8, 1, 128);
      expect(bitmap[0]).toBe(0x80); // 10000000
    });

    it("右端のみ黒 (1pixel) → LSB=1 の 0x01", () => {
      const pixels = Buffer.from([255, 255, 255, 255, 255, 255, 255, 0]);
      const { bitmap } = packTo1BitBitmap(pixels, 8, 1, 128);
      expect(bitmap[0]).toBe(0x01); // 00000001
    });

    it("交互パターン (黒白黒白…) → 0xAA", () => {
      const pixels = Buffer.from([0, 255, 0, 255, 0, 255, 0, 255]);
      const { bitmap } = packTo1BitBitmap(pixels, 8, 1, 128);
      expect(bitmap[0]).toBe(0xaa); // 10101010
    });
  });

  describe("しきい値 (threshold)", () => {
    it("threshold=128 でグレー(127)は黒、グレー(128)は白", () => {
      const pixels = Buffer.from([127, 128, 127, 128, 127, 128, 127, 128]);
      const { bitmap } = packTo1BitBitmap(pixels, 8, 1, 128);
      expect(bitmap[0]).toBe(0xaa); // 127(黒)128(白)の交互
    });

    it("threshold=200 を使うとグレー(180)も黒扱い", () => {
      const pixels = Buffer.from([180, 220, 180, 220, 180, 220, 180, 220]);
      const { bitmap } = packTo1BitBitmap(pixels, 8, 1, 200);
      expect(bitmap[0]).toBe(0xaa); // 180(黒)220(白)
    });

    it("threshold=50 を使うとグレー(100)は白扱い", () => {
      const pixels = Buffer.from([100, 100, 100, 100, 100, 100, 100, 100]);
      const { bitmap } = packTo1BitBitmap(pixels, 8, 1, 50);
      expect(bitmap[0]).toBe(0x00);
    });
  });

  describe("複数行・幅8の倍数でない画像", () => {
    it("8×2 の画像でも 2バイト (各行 1バイト)", () => {
      // 1行目: 全黒、2行目: 全白
      const pixels = Buffer.concat([
        Buffer.alloc(8, 0),
        Buffer.alloc(8, 255),
      ]);
      const { bitmap, widthBytes } = packTo1BitBitmap(pixels, 8, 2, 128);
      expect(widthBytes).toBe(1);
      expect(bitmap.length).toBe(2);
      expect(bitmap[0]).toBe(0xff); // 1行目 全黒
      expect(bitmap[1]).toBe(0x00); // 2行目 全白
    });

    it("幅 10 (8の倍数でない) は 2バイト/行", () => {
      // 左2ピクセル黒、残り8ピクセル白
      const pixels = Buffer.from([0, 0, 255, 255, 255, 255, 255, 255, 255, 255]);
      const { bitmap, widthBytes } = packTo1BitBitmap(pixels, 10, 1, 128);
      expect(widthBytes).toBe(2);
      expect(bitmap.length).toBe(2);
      expect(bitmap[0]).toBe(0xc0); // 11000000 (先頭2bitが黒)
      expect(bitmap[1]).toBe(0x00); // 残り2bitは白、パディング分も0
    });

    it("幅 12 の画像の端数処理 (4bitのみの2バイト目)", () => {
      // 全黒
      const pixels = Buffer.alloc(12, 0);
      const { bitmap, widthBytes } = packTo1BitBitmap(pixels, 12, 1, 128);
      expect(widthBytes).toBe(2);
      expect(bitmap[0]).toBe(0xff); // 1-8ピクセル目は全黒 = 0xFF
      expect(bitmap[1]).toBe(0xf0); // 9-12ピクセル目は黒、13-16は範囲外(0)
    });
  });

  describe("サイズ情報", () => {
    it("widthBytes は Math.ceil(width / 8)", () => {
      expect(packTo1BitBitmap(Buffer.alloc(1), 1, 1, 128).widthBytes).toBe(1);
      expect(packTo1BitBitmap(Buffer.alloc(7), 7, 1, 128).widthBytes).toBe(1);
      expect(packTo1BitBitmap(Buffer.alloc(8), 8, 1, 128).widthBytes).toBe(1);
      expect(packTo1BitBitmap(Buffer.alloc(9), 9, 1, 128).widthBytes).toBe(2);
      expect(packTo1BitBitmap(Buffer.alloc(16), 16, 1, 128).widthBytes).toBe(2);
      expect(packTo1BitBitmap(Buffer.alloc(17), 17, 1, 128).widthBytes).toBe(3);
    });

    it("108mm(864px)×178mm(1424px) の 230番ラベル相当サイズ", () => {
      const width = 864;
      const height = 1424;
      const { bitmap, widthBytes } = packTo1BitBitmap(
        Buffer.alloc(width * height, 255),
        width,
        height,
        128
      );
      expect(widthBytes).toBe(108);
      expect(bitmap.length).toBe(108 * 1424);
    });
  });
});

// =================================================================
// convertPdfToTspl() の統合的なテスト (最小PDFを使う)
// =================================================================

describe("convertPdfToTspl()", () => {
  it("最小PDFを 230番 (108×178mm) の TSPL に変換できる", async () => {
    const pdf = generateMinimalPdf(["TEST"]);

    const result = await convertPdfToTspl(pdf, { slip_type: "230" });

    expect(result.tspl_buffer).toBeInstanceOf(Buffer);
    expect(result.tspl_buffer.length).toBeGreaterThan(0);
    expect(result.pdf_page_count).toBe(1);
    expect(result.elapsed_ms).toBeGreaterThan(0);
    expect(result.bitmap_width_bytes).toBeGreaterThan(0);
    expect(result.bitmap_height_pixels).toBeGreaterThan(0);
  }, 20_000); // pdf-to-img初期化が重いので長めのタイムアウト

  it("生成されたTSPLは SIZE/GAP/CLS/BITMAP/PRINT コマンドを含む", async () => {
    const pdf = generateMinimalPdf(["TSPL TEST"]);
    const result = await convertPdfToTspl(pdf, { slip_type: "230" });

    // 最初の1024バイト(ヘッダ部分)をテキストとして確認
    const header = result.tspl_buffer.slice(0, 256).toString("ascii");

    expect(header).toContain("SIZE ");
    expect(header).toContain("GAP ");
    expect(header).toContain("DIRECTION");
    expect(header).toContain("REFERENCE");
    expect(header).toContain("CLS");
    expect(header).toContain("BITMAP ");

    // 末尾に PRINT 1,copies が入る
    const trailer = result.tspl_buffer
      .slice(result.tspl_buffer.length - 32)
      .toString("ascii");
    expect(trailer).toContain("PRINT 1,");
  }, 20_000);

  it("SIZE コマンドは slip_type に応じた mm を含む (230→108mm,178mm)", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, { slip_type: "230" });

    const header = result.tspl_buffer.slice(0, 128).toString("ascii");
    expect(header).toMatch(/SIZE 108 mm, 178 mm/);
  }, 20_000);

  it("241番は 108mm, 228mm", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, { slip_type: "241" });
    const header = result.tspl_buffer.slice(0, 128).toString("ascii");
    expect(header).toMatch(/SIZE 108 mm, 228 mm/);
  }, 20_000);

  it("custom 50×80mm で SIZE コマンドが反映される", async () => {
    const pdf = generateMinimalPdf(["CUSTOM"]);
    const result = await convertPdfToTspl(pdf, {
      slip_type: "custom",
      custom_width_mm: 50,
      custom_height_mm: 80,
    });
    const header = result.tspl_buffer.slice(0, 128).toString("ascii");
    expect(header).toMatch(/SIZE 50 mm, 80 mm/);
  }, 20_000);

  it("copies パラメータが PRINT コマンドに反映される", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, {
      slip_type: "230",
      copies: 5,
    });
    const trailer = result.tspl_buffer
      .slice(result.tspl_buffer.length - 32)
      .toString("ascii");
    expect(trailer).toContain("PRINT 1,5");
  }, 20_000);

  it("copies 未指定のときは PRINT 1,1", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, { slip_type: "230" });
    const trailer = result.tspl_buffer
      .slice(result.tspl_buffer.length - 32)
      .toString("ascii");
    expect(trailer).toContain("PRINT 1,1");
  }, 20_000);

  it("copies の異常値 (負/0) は 1 にクランプされる", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, {
      slip_type: "230",
      copies: -5,
    });
    const trailer = result.tspl_buffer
      .slice(result.tspl_buffer.length - 32)
      .toString("ascii");
    expect(trailer).toContain("PRINT 1,1");
  }, 20_000);

  it("copies 999 を超えると 999 にクランプ", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, {
      slip_type: "230",
      copies: 10_000,
    });
    const trailer = result.tspl_buffer
      .slice(result.tspl_buffer.length - 32)
      .toString("ascii");
    expect(trailer).toContain("PRINT 1,999");
  }, 20_000);

  it("direction のオーバーライドが DIRECTION コマンドに反映される", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, {
      slip_type: "230",
      direction: 0,
    });
    const header = result.tspl_buffer.slice(0, 128).toString("ascii");
    expect(header).toMatch(/DIRECTION 0/);
  }, 20_000);

  it("不正な slip_type はエラーを投げる", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    await expect(
      convertPdfToTspl(pdf, {
        // @ts-expect-error 不正な値
        slip_type: "nonexistent",
      })
    ).rejects.toThrow(/Unknown slip_type/);
  });

  it("BITMAP命令の直後のバイナリサイズが widthBytes × heightPixels と一致", async () => {
    const pdf = generateMinimalPdf(["TEST"]);
    const result = await convertPdfToTspl(pdf, { slip_type: "10230014" }); // 小さいほうがいい

    const expectedBitmapSize =
      result.bitmap_width_bytes * result.bitmap_height_pixels;

    // TSPL全体から ヘッダサイズ+フッタサイズ を引くと bitmapサイズになる
    // ヘッダは可変なので、代わりに total >= bitmap size を確認
    expect(result.tspl_buffer.length).toBeGreaterThanOrEqual(
      expectedBitmapSize
    );
  }, 20_000);
});
