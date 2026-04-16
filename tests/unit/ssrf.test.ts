/**
 * src/tools/printer.ts の isBlockedUrl() のテスト
 *
 * SSRF対策としての URL検証が意図通り動作することを確認する。
 */

import { describe, it, expect } from "vitest";
import { isBlockedUrl } from "../../src/tools/printer.js";

describe("isBlockedUrl() — 正常系(許可されるURL)", () => {
  it("公開の https URLは null (ブロックしない)", () => {
    expect(isBlockedUrl("https://example.com/file.pdf")).toBeNull();
  });

  it("公開の http URLも許可", () => {
    expect(isBlockedUrl("http://example.com/file.pdf")).toBeNull();
  });

  it("クエリパラメータ付きの URL", () => {
    expect(
      isBlockedUrl(
        "https://paintlog-uploads-ap.s3.amazonaws.com/tmp/shipping.pdf?Signature=abc&Expires=123"
      )
    ).toBeNull();
  });

  it("ポート番号付きの公開 URL (8080等) は許可", () => {
    expect(isBlockedUrl("https://public-api.example.com:8443/file")).toBeNull();
  });

  it("Cloudflare R2 エンドポイント", () => {
    expect(
      isBlockedUrl(
        "https://abc123.r2.cloudflarestorage.com/bucket/key?x=y"
      )
    ).toBeNull();
  });

  it("AWS S3 presigned URL", () => {
    expect(
      isBlockedUrl(
        "https://my-bucket.s3.us-east-1.amazonaws.com/shipping.pdf?X-Amz-Signature=xxx"
      )
    ).toBeNull();
  });
});

describe("isBlockedUrl() — ブロックされるURL", () => {
  describe("プロトコル", () => {
    it("file:// はブロック", () => {
      expect(isBlockedUrl("file:///etc/passwd")).toMatch(
        /Protocol not allowed/
      );
    });

    it("ftp:// はブロック", () => {
      expect(isBlockedUrl("ftp://example.com/file.pdf")).toMatch(
        /Protocol not allowed/
      );
    });

    it("gopher:// はブロック", () => {
      expect(isBlockedUrl("gopher://example.com/")).toMatch(
        /Protocol not allowed/
      );
    });

    it("javascript: はブロック", () => {
      expect(isBlockedUrl("javascript:alert(1)")).toMatch(
        /Protocol not allowed/
      );
    });

    it("data: はブロック", () => {
      expect(isBlockedUrl("data:application/pdf;base64,JVBER...")).toMatch(
        /Protocol not allowed/
      );
    });
  });

  describe("ローカルホスト系", () => {
    it("localhost はブロック", () => {
      expect(isBlockedUrl("http://localhost/admin")).toMatch(
        /blocked \(internal\)/
      );
    });

    it("LOCALHOST (大文字) もブロック", () => {
      expect(isBlockedUrl("http://LOCALHOST/")).toMatch(
        /blocked/
      );
    });

    it("127.0.0.1 はブロック", () => {
      expect(isBlockedUrl("http://127.0.0.1/")).toMatch(/blocked/);
    });

    it("::1 (IPv6 loopback) はブロック", () => {
      // URLクラスで [::1] 形式で書く必要がある
      expect(isBlockedUrl("http://[::1]/")).toMatch(/blocked/);
    });

    it(":: (IPv6 全ゼロアドレス) はブロック", () => {
      expect(isBlockedUrl("http://[::]/")).toMatch(/blocked/);
    });

    it("fe80:: (IPv6 リンクローカル) はブロック", () => {
      expect(isBlockedUrl("http://[fe80::1]/")).toMatch(/blocked/);
    });

    it("fc00:: (IPv6 ユニークローカル) はブロック", () => {
      expect(isBlockedUrl("http://[fc00::1]/")).toMatch(/blocked/);
    });

    it("fd12:: (IPv6 ユニークローカル fd系) はブロック", () => {
      expect(isBlockedUrl("http://[fd12:3456::1]/")).toMatch(/blocked/);
    });

    it("::ffff:127.0.0.1 (IPv4-mapped ループバック) はブロック", () => {
      expect(isBlockedUrl("http://[::ffff:127.0.0.1]/")).toMatch(/blocked/);
    });

    it("パブリックなIPv6 (2606:...) は許可", () => {
      expect(isBlockedUrl("http://[2606:4700:4700::1111]/")).toBeNull();
    });

    it("0.0.0.0 はブロック", () => {
      expect(isBlockedUrl("http://0.0.0.0/")).toMatch(/blocked/);
    });
  });

  describe("AWS/GCP メタデータサービス", () => {
    it("169.254.169.254 (AWS/Azure メタデータ) はブロック", () => {
      expect(isBlockedUrl("http://169.254.169.254/latest/meta-data/")).toMatch(
        /blocked/
      );
    });

    it("metadata.google.internal (GCP メタデータ) はブロック", () => {
      expect(isBlockedUrl("http://metadata.google.internal/")).toMatch(
        /blocked/
      );
    });
  });

  describe("プライベートIPレンジ", () => {
    it("10.x.x.x はブロック", () => {
      expect(isBlockedUrl("http://10.0.0.1/")).toMatch(/blocked/);
      expect(isBlockedUrl("http://10.255.255.255/")).toMatch(/blocked/);
    });

    it("192.168.x.x はブロック", () => {
      expect(isBlockedUrl("http://192.168.1.1/")).toMatch(/blocked/);
      expect(isBlockedUrl("http://192.168.70.226/")).toMatch(/blocked/);
    });

    it("127.x.x.x (loopback範囲) はブロック", () => {
      expect(isBlockedUrl("http://127.0.0.1/")).toMatch(/blocked/);
      expect(isBlockedUrl("http://127.1.2.3/")).toMatch(/blocked/);
    });

    it("169.254.x.x (link-local) はブロック", () => {
      expect(isBlockedUrl("http://169.254.1.1/")).toMatch(/blocked/);
    });

    it("172.16.x.x ~ 172.31.x.x (private /12) はブロック", () => {
      expect(isBlockedUrl("http://172.16.0.1/")).toMatch(/blocked/);
      expect(isBlockedUrl("http://172.20.1.1/")).toMatch(/blocked/);
      expect(isBlockedUrl("http://172.31.255.255/")).toMatch(/blocked/);
    });

    it("172.15.x.x や 172.32.x.x は パブリック扱いで許可 (172.16-31 の範囲外)", () => {
      expect(isBlockedUrl("http://172.15.1.1/")).toBeNull();
      expect(isBlockedUrl("http://172.32.1.1/")).toBeNull();
    });
  });
});

describe("isBlockedUrl() — 不正な入力", () => {
  it("URL文字列として不正な入力はエラー文字列を返す", () => {
    expect(isBlockedUrl("not a url at all")).toMatch(/Invalid URL/);
  });

  it("空文字列は Invalid URL", () => {
    expect(isBlockedUrl("")).toMatch(/Invalid URL/);
  });

  it("httpsプレフィックスだけだとInvalid URL", () => {
    expect(isBlockedUrl("https://")).toMatch(/Invalid URL/);
  });
});
