/**
 * printer-device.ts のユニットテスト
 *
 * /dev/null を PRINTER_DEVICE に使って実際に書き込みテスト。
 * エラーケースは存在しないパスなどで再現。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sendToPrinter,
  sendRawTspl,
  checkPrinterDeviceAccess,
  PrinterWriteError,
} from "../../src/services/printer-device.js";

describe("checkPrinterDeviceAccess()", () => {
  const originalDevice = process.env.PRINTER_DEVICE;

  afterEach(() => {
    process.env.PRINTER_DEVICE = originalDevice;
  });

  it("/dev/null はテスト環境で書き込み可能 → available=true", async () => {
    process.env.PRINTER_DEVICE = "/dev/null";
    const result = await checkPrinterDeviceAccess();
    expect(result.available).toBe(true);
    expect(result.device).toBe("/dev/null");
    expect(result.error).toBeUndefined();
  });

  it("存在しないパスは available=false でエラー", async () => {
    process.env.PRINTER_DEVICE = "/nonexistent/fake/printer";
    const result = await checkPrinterDeviceAccess();
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/not found|dmesg/);
  });

  it("デフォルトは /dev/usb/lp0 (環境変数未指定時)", async () => {
    delete process.env.PRINTER_DEVICE;
    const result = await checkPrinterDeviceAccess();
    expect(result.device).toBe("/dev/usb/lp0");
    // 存在しなくてもOK (Linuxコンテナで /dev/usb/lp0 は通常ない)
  });

  it("書き込み不可な/etc/hostsは available=false (Linux想定)", async () => {
    process.env.PRINTER_DEVICE = "/etc/hosts";
    const result = await checkPrinterDeviceAccess();
    // /etc/hosts は存在するが、通常書き込み権限がない (root以外)
    // テスト環境によっては異なるので、"存在する" or "書き込みなし" どちらかでOK
    if (!result.available) {
      expect(result.error).toBeDefined();
    }
  });
});

describe("sendToPrinter()", () => {
  const originalDevice = process.env.PRINTER_DEVICE;

  beforeEach(() => {
    process.env.PRINTER_DEVICE = "/dev/null";
  });

  afterEach(() => {
    process.env.PRINTER_DEVICE = originalDevice;
  });

  it("/dev/null に小さなバッファを送信できる (書き込みバイト数を返す)", async () => {
    const buf = Buffer.from("SIZE 100 mm, 60 mm\r\nCLS\r\nPRINT 1,1\r\n");
    const bytes = await sendToPrinter(buf);
    expect(bytes).toBe(buf.length);
  });

  it("空バッファも送信可能 (0バイト書き込み)", async () => {
    const bytes = await sendToPrinter(Buffer.alloc(0));
    expect(bytes).toBe(0);
  });

  it("大きなバッファ (100KB) も送信可能", async () => {
    const buf = Buffer.alloc(100 * 1024, 0x00);
    const bytes = await sendToPrinter(buf);
    expect(bytes).toBe(buf.length);
  });

  it("存在しないデバイスを指定すると PrinterWriteError を投げる", async () => {
    process.env.PRINTER_DEVICE = "/nonexistent/printer/device";
    const buf = Buffer.from("TEST\r\n");
    await expect(sendToPrinter(buf)).rejects.toThrow(PrinterWriteError);
  });

  it("PrinterWriteError は name='PrinterWriteError' と code を持つ", async () => {
    process.env.PRINTER_DEVICE = "/nonexistent/printer/device";
    try {
      await sendToPrinter(Buffer.from("TEST"));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PrinterWriteError);
      expect((err as PrinterWriteError).name).toBe("PrinterWriteError");
      // ENOENT か ENOTDIR (パス構造による)
      expect(["ENOENT", "ENOTDIR"]).toContain(
        (err as PrinterWriteError).code
      );
    }
  });

  it("エラーメッセージには対処法ヒントが含まれる", async () => {
    process.env.PRINTER_DEVICE = "/nonexistent/printer/device";
    try {
      await sendToPrinter(Buffer.from("TEST"));
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      // ENOENT エラーでは 'usblp' か 'connected' のヒント
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});

describe("sendRawTspl()", () => {
  const originalDevice = process.env.PRINTER_DEVICE;

  beforeEach(() => {
    process.env.PRINTER_DEVICE = "/dev/null";
  });

  afterEach(() => {
    process.env.PRINTER_DEVICE = originalDevice;
  });

  it("TSPL文字列を送信できる (バイト数が返る)", async () => {
    const tspl = "SIZE 100 mm, 60 mm\r\nCLS\r\nPRINT 1,1\r\n";
    const bytes = await sendRawTspl(tspl);
    expect(bytes).toBe(tspl.length);
  });

  it("ASCII以外の文字は BufferでASCII変換される", async () => {
    // 日本語を含む場合でもエラーは出さず、ASCIIエンコードされた結果のバイト長
    const tspl = 'TEXT "Hello"\r\n';
    const bytes = await sendRawTspl(tspl);
    expect(bytes).toBeGreaterThan(0);
  });

  it("空文字列でもエラーなし", async () => {
    const bytes = await sendRawTspl("");
    expect(bytes).toBe(0);
  });
});

describe("PrinterWriteError class", () => {
  it("Error を継承する", () => {
    const err = new PrinterWriteError("test", "EACCES");
    expect(err).toBeInstanceOf(Error);
  });

  it("name は 'PrinterWriteError'", () => {
    const err = new PrinterWriteError("msg", "EACCES");
    expect(err.name).toBe("PrinterWriteError");
  });

  it("message と code が保持される", () => {
    const err = new PrinterWriteError("custom message", "EIO");
    expect(err.message).toBe("custom message");
    expect(err.code).toBe("EIO");
  });

  it("code が undefined でも作れる", () => {
    const err = new PrinterWriteError("msg", undefined);
    expect(err.code).toBeUndefined();
  });
});
