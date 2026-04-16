/**
 * プリンタデバイス書き込みサービス
 *
 * Linux カーネルの usblp ドライバ経由で /dev/usb/lp0 (または指定デバイス) に
 * TSPL コマンド列をバイナリ書き込みする。
 *
 * 前提条件:
 *   - usblp カーネルモジュールがロードされていること
 *     (modprobe usblp、または /etc/modules に追記)
 *   - Node.js プロセスを実行するユーザーが lp グループに属していること
 *     (sudo usermod -a -G lp $USER)
 *   - CUPS等が先にデバイスを掴んでいないこと (sudo systemctl stop cups)
 */

import { promises as fs, constants as fsConstants } from "fs";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.LOG_PRETTY === "true"
      ? { target: "pino-pretty" }
      : undefined,
}).child({ component: "printer-device" });

/**
 * プリンタデバイスが使用可能かチェックする
 *
 * @returns デバイス存在・書き込み権限の状態
 */
export async function checkPrinterDeviceAccess(): Promise<{
  available: boolean;
  device: string;
  error?: string;
}> {
  const device = process.env.PRINTER_DEVICE || "/dev/usb/lp0";

  try {
    await fs.access(device, fsConstants.F_OK);
  } catch {
    return {
      available: false,
      device,
      error:
        `Printer device not found at ${device}. ` +
        "Check USB cable and run: dmesg | grep usblp",
    };
  }

  try {
    await fs.access(device, fsConstants.W_OK);
  } catch {
    return {
      available: false,
      device,
      error:
        `No write permission to ${device}. ` +
        `Run: sudo usermod -a -G lp $USER (then logout/login)`,
    };
  }

  return { available: true, device };
}

/**
 * TSPL コマンドバッファをプリンタに送信する
 *
 * @param tsplBuffer TSPL コマンド列(バイナリ)
 * @returns 書き込んだバイト数
 * @throws 書き込み失敗時のエラー (型付き)
 */
export async function sendToPrinter(tsplBuffer: Buffer): Promise<number> {
  const device = process.env.PRINTER_DEVICE || "/dev/usb/lp0";

  logger.info(
    { device, bytes: tsplBuffer.length },
    "Sending TSPL to printer"
  );

  try {
    // append モードで開いてそのまま書き込む
    // (プリンタデバイスは通常の書き込みでOK、flag='a' は念のため排他的に扱う意図)
    await fs.writeFile(device, tsplBuffer);
    logger.info({ device, bytes: tsplBuffer.length }, "TSPL sent successfully");
    return tsplBuffer.length;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    const message = describeWriteError(device, nodeErr);
    logger.error(
      { device, code: nodeErr.code, syscall: nodeErr.syscall, message },
      "Failed to write TSPL to printer"
    );
    throw new PrinterWriteError(message, nodeErr.code);
  }
}

/**
 * 書き込みエラーをユーザ向けメッセージに変換
 */
function describeWriteError(
  device: string,
  err: NodeJS.ErrnoException
): string {
  switch (err.code) {
    case "EACCES":
      return (
        `Permission denied to write to ${device}. ` +
        `Run: sudo usermod -a -G lp $USER (then logout and login again)`
      );
    case "ENOENT":
      return (
        `${device} does not exist. ` +
        `Check that the printer is connected via USB and usblp module is loaded ` +
        `(sudo modprobe usblp). Also check: dmesg | tail | grep usblp`
      );
    case "EBUSY":
      return (
        `${device} is busy. Another process is using the printer. ` +
        `Check: sudo lsof ${device}. You may need to stop CUPS: ` +
        `sudo systemctl stop cups`
      );
    case "EIO":
      return (
        `I/O error writing to ${device}. ` +
        `Check printer power, paper, and USB cable. ` +
        `Try: sudo modprobe -r usblp && sudo modprobe usblp`
      );
    case "ENOSPC":
      return `Printer is out of paper or media (${device})`;
    default:
      return (
        `Failed to write to ${device}: ${err.message} ` +
        `(code: ${err.code || "UNKNOWN"})`
      );
  }
}

/**
 * プリンタ書き込みエラー (型付き)
 */
export class PrinterWriteError extends Error {
  public readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "PrinterWriteError";
    this.code = code;
  }
}

/**
 * 素のTSPLコマンドを送信 (デバッグ・テスト用)
 *
 * 例: "SIZE 100 mm, 150 mm\r\nCLS\r\nTEXT 50,50,..."
 */
export async function sendRawTspl(tsplText: string): Promise<number> {
  const buf = Buffer.from(tsplText, "ascii");
  return sendToPrinter(buf);
}
