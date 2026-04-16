# DESIGN.md — 設計ドキュメント

## 設計判断の記録

### なぜ TypeScript + Node.js か

既存の `printer-mcp-server` (Kyocera用) が TypeScript + Express + MCP SDK で実装されており、以下のコードがほぼそのまま流用可能:

- Express upload middleware (multer)
- MCP authentication middleware
- /upload / /uploads エンドポイント
- エラーハンドリングパターン
- systemd ユニットの構造

Python + PyMuPDF の方が PDF処理のエコシステムは豊富だが、既存資産との一貫性・メンテナンス負担軽減を優先。

### なぜ `/dev/usb/lp0` 直接書き込みか

検討した3つの方式:

1. ❌ **メーカー公式Windowsドライバ + Wine** — サーバー用途に不適
2. ❌ **CUPS + 自作フィルタ (raster-tspl)** — 実装コスト高、既存CUPS環境への汚染リスク
3. ✅ **TSPLを `/dev/usb/lp0` に直接書き込み** — カーネル標準の `usblp` ドライバがUSB Printer Class準拠のプリンタを自動認識、中間レイヤー無しで最も確実

WS-420Bは Xprinter社OEM なので、同社のプリンタで多数の動作実績がある方式 #3 を採用。

### なぜ Cloudflare Tunnel か

Raspberry Pi Zero 2 W を固定IP・静的DNSで公開する必要がない: ポート開放不要、NAT越え自動、TLS終端サーバー側、既存の `mac-remote-mcp` `ssh-mcp-server` `printer-mcp-server` と同じ `appserver.tokyo` ドメインで一元管理。

## システム全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  Client-side (Claude / 業務システム)                      │
│                                                          │
│  [1] PDFをHTTP POSTで /upload に送信 → file_id取得        │
│  [2] MCP call: print_uploaded(file_id, slip_type)       │
│      or    print_url(url, filename, slip_type)          │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Edge (yamato-printer.appserver.tokyo)        │
│  - TLS終端                                                │
│  - Tunnel → Pi                                           │
└────────────────────┬─────────────────────────────────────┘
                     │ cloudflared tunnel
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Raspberry Pi Zero 2 W (ARM64, 512MB RAM, WiFi 2.4GHz)  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  yamato-printer-mcp-server (Node.js/systemd)      │  │
│  │                                                    │  │
│  │  HTTP layer (Express)                              │  │
│  │   ├─ POST /upload  → /tmp/<file_id>.pdf           │  │
│  │   ├─ GET  /uploads → ファイル一覧                  │  │
│  │   └─ POST /mcp     → MCP over HTTP                 │  │
│  │                                                    │  │
│  │  MCP layer (@modelcontextprotocol/sdk)             │  │
│  │   └─ tools: print_uploaded, print_url, ...        │  │
│  │                                                    │  │
│  │  Services                                          │  │
│  │   ├─ pdf-to-tspl.ts                               │  │
│  │   │    PDF → pdf-to-img → PNG                     │  │
│  │   │    PNG → sharp (resize, binarize, dither)     │  │
│  │   │    Image → 1bit bitstream → TSPL BITMAP cmd   │  │
│  │   ├─ printer-device.ts                            │  │
│  │   │    /dev/usb/lp0 へのバイナリ書き込み          │  │
│  │   ├─ job-queue.ts                                 │  │
│  │   │    SQLite でジョブIDを発行・追跡              │  │
│  │   └─ yamato-slips.ts                              │  │
│  │        用紙品番(230/241等) → サイズ・向き        │  │
│  └────────────────────────────────────────────────────┘  │
│                     │                                    │
│                     ▼ write() to /dev/usb/lp0            │
│  [usblp カーネルモジュール] (USB Printer Class)          │
└────────────────────┬─────────────────────────────────────┘
                     │ USB Bulk Transfer
                     ▼
┌─────────────────────────────────────────────────────────┐
│  WS-420B (TSPL対応サーマルラベルプリンタ)                │
│  - 32bit CPUがTSPLコマンドを解釈                         │
│  - 203dpi、最大幅108mm、ダイレクトサーマル印字           │
└─────────────────────────────────────────────────────────┘
```

## PDF → TSPL 変換パイプライン

### ステップ1: PDFラスタライズ

```
Input:  PDF (任意ページ数、任意サイズ)
         ↓ pdf-to-img (内部でmupdf-wasm)
Output: PNG (RGBA、slip_type由来のDPI=203でレンダリング)
```

ページは最初の1ページのみを使用。複数ページの場合は警告ログを出力。

**解像度の計算例** (230番・17.8×10.8cm):

```
プリンタ解像度 = 203 dpi = 8 dots/mm
ラベル幅 = 108mm → 864 dots (ピクセル)
ラベル高 = 178mm → 1424 dots (ピクセル)
BITMAP widthバイト数 = ceil(864 / 8) = 108 bytes
```

### ステップ2: 画像前処理とリサイズ

```
Input:  PNG (任意サイズ)
         ↓ sharp
         ├─ resize to (target_width × target_height) with fit=inside
         ├─ greyscale
         ├─ binarize (Floyd-Steinberg dither, or threshold)
         └─ raw output (1 byte/pixel, 0-255)
Output: Uint8Array (target_width × target_height バイト)
```

### ステップ3: 1bitビットマップへのパッキング

```python
# 擬似コード
# width = 864 ピクセル (108 byte × 8 bit)
# height = 1424 ピクセル

bitmap = new Uint8Array(width_bytes × height)  // = 108 × 1424 = 153,792 bytes
for y in 0..height-1:
  for byte_x in 0..width_bytes-1:
    byte_value = 0
    for bit in 0..7:
      pixel_x = byte_x * 8 + bit
      pixel_value = raw_image[y * width + pixel_x]
      if pixel_value < threshold:  // 黒
        byte_value |= (1 << (7 - bit))  // MSBファースト
    bitmap[y * width_bytes + byte_x] = byte_value
```

**重要**: TSPL BITMAP では `1 = 黒`、`0 = 白`。多くのプリンタで「OR モード (mode=0)」だとこの解釈になる。機種によって反転する場合は `mode=1` (XOR) で対応可能。

### ステップ4: TSPLコマンド生成

```
SIZE <width>mm, <height>mm\r\n
GAP 2 mm, 0\r\n
DIRECTION 1\r\n              <- 印字方向 (0 or 1)
REFERENCE 0,0\r\n
CLS\r\n
BITMAP 0,0,<width_bytes>,<height_pixels>,0,<binary_bitmap_data>\r\n
PRINT 1,<copies>\r\n
```

`<binary_bitmap_data>` は生バイナリで挿入される。文字列のエスケープは不要 (TSPLはバイト列を期待)。

### ステップ5: USB書き込み

```typescript
import { promises as fs } from 'fs';
await fs.writeFile('/dev/usb/lp0', tsplBuffer, { flag: 'a' });
```

エラーハンドリング:
- `EACCES` → ユーザーが `lp` グループに属していない
- `ENOENT` → プリンタ未接続、または `usblp` モジュール未ロード
- `EBUSY` → 他のプロセスがデバイスを開いている (CUPSなど)

## ヤマト送り状プリセット

`src/services/yamato-slips.ts` で定義:

```typescript
interface SlipPreset {
  size: { width_mm: number; height_mm: number };
  direction: 0 | 1;        // TSPL DIRECTION (0=正方向, 1=180度回転)
  gap_mm: number;           // GAP (ラベル間距離)
  description: string;
}

export const YAMATO_SLIPS: Record<string, SlipPreset> = {
  "230":       { size: { width_mm: 108, height_mm: 178 }, direction: 1, gap_mm: 2, description: "宅急便(発払い)/クール宅急便/宅急便コンパクト" },
  "241":       { size: { width_mm: 108, height_mm: 228 }, direction: 1, gap_mm: 2, description: "宅急便コレクト (クール便含む)" },
  "203":       { size: { width_mm: 108, height_mm: 228 }, direction: 1, gap_mm: 2, description: "宅急便タイムサービス" },
  "10230004":  { size: { width_mm: 108, height_mm: 178 }, direction: 1, gap_mm: 2, description: "ネコポス" },
  "10230015":  { size: { width_mm: 108, height_mm: 178 }, direction: 1, gap_mm: 2, description: "クロネコゆうパケット" },
  "10230014":  { size: { width_mm: 108, height_mm: 73  }, direction: 1, gap_mm: 2, description: "クロネコゆうメール" },
};
```

`custom` は実行時に `size_width_mm` / `size_height_mm` を引数で受け取る。

## ジョブ管理の設計

### テーブルスキーマ (SQLite)

```sql
CREATE TABLE IF NOT EXISTS jobs (
  job_id       TEXT PRIMARY KEY,          -- "job_<uuid>"
  file_id      TEXT,                       -- アップロードファイルID (nullable)
  source_url   TEXT,                       -- 任意URL印刷の場合 (nullable)
  filename     TEXT NOT NULL,
  slip_type    TEXT NOT NULL,              -- "230" | "custom" etc
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending|converting|printing|completed|failed
  error        TEXT,                       -- エラー時のメッセージ
  bytes_sent   INTEGER DEFAULT 0,
  copies       INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at   TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
```

### 状態遷移

```
pending → converting → printing → completed
                                → failed
```

WS-420B はステータスをリアルタイム返却しない(TSPLにはクエリコマンドがあるが信頼性が低い)ため、**書き込み成功時点で `completed`** とする楽観的設計。紙切れ等のエラーはプリンタ本体のLEDで検知する前提。

将来的には TSPL `<STX>E` コマンド (Printer Status Query) で状態取得を試みる拡張を計画。

## 認証とセキュリティ

### 認証の階層

| エンドポイント | 認証 | 理由 |
|---|---|---|
| `POST /upload` | なし | curlでのトークン消費削減 (既存printer-mcp-serverと同パターン) |
| `GET /uploads` | なし | 同上 |
| `POST /mcp` | MCP_API_KEY (クエリパラメータ `?key=...`) | 実際の印刷はここを通るので必須 |
| MCPツール経由のファイルGET | 引数URLは任意のpresigned URL | 呼び出し側の責任 |

### リスク評価

| 脅威 | 対応 |
|---|---|
| `/upload` に無関係のファイルをPUTされる | `/tmp` に30分で自動削除、MCP認証なしには印刷不可 |
| ジョブID総当たりでジョブ履歴流出 | job_id は UUIDv4、履歴取得時もMCP認証必須 |
| `print_url` で悪意あるURLを指定 | SSRF対策: 内部ネットワークアドレス (10.*, 192.168.*, 169.254.*, 127.*) へのGETを拒否 |
| Cloudflare Tunnel のSSL中間者攻撃 | Cloudflare側で完結 (既存運用と同じ) |

## パフォーマンス目標

| 処理 | 目標 | 根拠 |
|---|---|---|
| PDF アップロード (1MB) | < 1秒 | WiFi 2.4GHz、十分なヘッドルーム |
| PDF → TSPL 変換 | < 3秒 | Pi Zero 2 W ARM64で pdf-to-img + sharp |
| /dev/usb/lp0 への書き込み | < 2秒 | BITMAP data = 最大約150KB、USB 2.0で十分 |
| プリンタでの印字完了 | 5〜10秒 | WS-420B 152mm/s の印刷速度 |
| **トータル (PDF受信→印刷完了)** | **< 15秒** | |

## ファイル構造

```
yamato-printer-mcp-server/
├── README.md                   # このファイル
├── DESIGN.md                   # 設計書 (このファイル)
├── LICENSE                     # MIT
├── package.json                # Node.js 依存関係
├── tsconfig.json               # TypeScript設定
├── .env.example                # 環境変数テンプレート
├── .gitignore
├── src/
│   ├── index.ts                # エントリポイント (Express + MCP)
│   ├── types.ts                # 共通型定義
│   ├── middleware/
│   │   └── auth.ts             # MCP_API_KEY認証
│   ├── services/
│   │   ├── pdf-to-tspl.ts      # PDF→TSPL 変換コア
│   │   ├── printer-device.ts   # /dev/usb/lp0 書き込み
│   │   ├── job-queue.ts        # SQLiteジョブ管理
│   │   └── yamato-slips.ts     # 送り状プリセット
│   └── tools/
│       └── printer.ts          # MCPツール定義 (7個)
├── systemd/
│   └── yamato-printer-mcp.service
├── cloudflared/
│   └── config.yml.example
├── scripts/
│   ├── setup-pi.sh             # Pi初期セットアップ
│   └── microsd-longevity.sh    # microSD延命設定
└── docs/
    └── (将来的な追加ドキュメント)
```

## テスト戦略

### ローカルテスト (プリンタなし)

```bash
# プリンタ書き込み先を /dev/null に変更して変換パイプラインのみテスト
PRINTER_DEVICE=/dev/null npm test
```

生成されたTSPLを目視確認する場合:

```bash
# TSPL出力を16進ダンプ
PRINTER_DEVICE=/tmp/output.tspl npm run print-sample
xxd /tmp/output.tspl | head -30
```

### 実機テスト手順

1. プリンタUSB接続 → `dmesg | grep usblp` で認識確認
2. 素のTSPLでHello World印刷 (README参照)
3. `POST /upload` にサンプルPDFをアップロード
4. MCPツール `print_uploaded` を呼び出し
5. 印刷物を目視確認

### ディザ品質のテスト

`DITHER_METHOD=threshold` と `floyd` と `atkinson` で同じPDFを印刷し、ヤマト送り状のバーコード読み取りテストを実施。

## 既知の制約

- PDFの**1ページ目のみ**印刷 (複数ページPDFは警告)
- ラベル幅108mmを超えるPDFは**自動縮小** (アスペクト比保持)
- **プリンタ状態のリアルタイム取得は未実装** (将来拡張)
- Pi Zero 2 W の RAM が 512MB のため、非常に大きな PDF (10MB以上) はメモリ不足の可能性
- WiFi 2.4GHz のみ (Pi Zero 2 W ハードウェア制約)

## 今後の拡張アイデア

- [ ] TSPLプリンタ状態クエリ (`<STX>E` コマンド) でリアルタイムステータス
- [ ] 複数ページPDFの印刷 (1ページずつループ)
- [ ] 非ヤマト用の汎用ラベル印刷 (`slip_type=custom` 以外のカスタムプリセット)
- [ ] 印刷プレビュー機能 (TSPLをレンダリングしてPNG返却)
- [ ] WebUI ダッシュボード (ジョブ監視)
- [ ] 複数プリンタのサポート (USB2台以上)
- [ ] ZPL / EPL への切り替え (WS-420Bはマルチエミュレーション対応)
