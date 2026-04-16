/**
 * テスト用 最小PDF生成ヘルパー
 *
 * 外部ライブラリを使わずに、PDF 1.4 仕様の最小ドキュメントを手組みで生成する。
 * テキスト1ページのみをレンダリング可能で、pdf-to-img でラスタライズできる。
 *
 * scripts/print-sample.ts の generateSamplePdf() と同じロジック。
 */

/**
 * 簡易PDF生成
 *
 * @param lines 表示するテキスト行
 * @param pageWidthPt   ページ幅 (pt、デフォルト306pt = 108mm相当)
 * @param pageHeightPt  ページ高 (pt、デフォルト504pt = 178mm相当)
 * @returns PDF (Buffer)
 */
export function generateMinimalPdf(
  lines: string[],
  pageWidthPt = 306,
  pageHeightPt = 504
): Buffer {
  const contentStream = lines
    .map((line, idx) => {
      const y = pageHeightPt - 80 - idx * 40;
      // PDF文字列エスケープ (簡易版: ()\ のみ)
      const escaped = line
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
      return `BT /F1 28 Tf 40 ${y} Td (${escaped}) Tj ET`;
    })
    .join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
  );
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
  );
  const streamContent = `BT\n${contentStream}\nET\n`;
  objects.push(
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`
  );
  objects.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  );

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

/**
 * 2ページPDF を生成 (複数ページのテスト用)
 */
export function generateTwoPagePdf(): Buffer {
  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n"
  );
  // ページ1
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 306 504] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n"
  );
  const stream1 = "BT\nBT /F1 28 Tf 40 400 Td (PAGE 1) Tj ET\nET\n";
  objects.push(
    `4 0 obj\n<< /Length ${stream1.length} >>\nstream\n${stream1}endstream\nendobj\n`
  );
  objects.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  );
  // ページ2
  objects.push(
    "6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 306 504] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj\n"
  );
  const stream2 = "BT\nBT /F1 28 Tf 40 400 Td (PAGE 2) Tj ET\nET\n";
  objects.push(
    `7 0 obj\n<< /Length ${stream2.length} >>\nstream\n${stream2}endstream\nendobj\n`
  );

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

/**
 * 空の (無効な) バッファ
 */
export function invalidPdfBuffer(): Buffer {
  return Buffer.from("this is not a PDF at all");
}
