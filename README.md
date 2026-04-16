# yamato-printer-mcp-server

ヤマト運輸 送り状PDF用 ラベルプリンタ MCP サーバー  
Raspberry Pi Zero 2 W + WS-420B (サーマルラベルプリンタ) 向け

> **⚠️ Unofficial / Not affiliated with Yamato Transport**  
> 本プロジェクトは個人・社内業務自動化のために作成されたサードパーティ製ツールであり、ヤマト運輸株式会社およびヤマトホールディングス株式会社とは一切関係がありません。"YAMATO"、"ヤマト"、"クロネコ"、"宅急便"、"B2クラウド"はヤマトホールディングス株式会社またはその関連会社の商標または登録商標です。本プロジェクトはこれらのサービスへの公式な統合を提供するものではなく、B2クラウド等で出力されたPDFをローカルのラベルプリンタで印刷するための汎用ユーティリティとして機能します。

## 概要

ヤマトB2クラウド等で発行された送り状PDFを、USB接続のサーマルラベルプリンタ **WS-420B** (和信テック製、Xprinter社OEM) で印刷するための MCP (Model Context Protocol) サーバーです。

Raspberry Pi Zero 2 W 上で systemd 常駐し、Cloudflare Tunnel 経由で Claude.ai などの MCP クライアントから操作できます。WiFi のみで動作し、設置場所を選びません。

## 主な機能

- **PDF → TSPL変換**: PyMuPDF/pdf-to-img で PDFをラスタライズ → sharp で 1bit化 → TSPL BITMAPコマンド生成
- **USB直接書き込み**: Linuxカーネル標準の `usblp` ドライバ経由 (`/dev/usb/lp0`) — メーカー公式Linuxドライバ不要
- **ヤマト送り状プリセット**: B2クラウドの用紙品番 (230番 / 241番 / 10230004番 / 10230014番 / 10230015番 など) を選ぶだけで用紙サイズが自動設定
- **ジョブ管理**: SQLite で自前ジョブID発行、状態問い合わせ可能
- **2つのファイル受け渡し方法**:
  - `POST /upload` エンドポイント (FormData、認証なし、`file_id`返却)
  - MCPツール引数での任意URL受け取り (S3 presigned URL等)

## システム要件

| 項目 | 要件 |
|---|---|
| ハードウェア | Raspberry Pi Zero 2 W (または互換のARM64 SBC) |
| OS | Raspberry Pi OS Lite (64-bit, Bookworm以降) |
| Node.js | v20 LTS以降 |
| プリンタ | 和信テック WS-420B (または互換のTSPL/EPL/ZPL対応プリンタ) |
| ネットワーク | WiFi (2.4GHz) または有線LAN |
| 外部サービス | Cloudflare Tunnel (推奨) |

## クイックスタート

### 1. Raspberry Pi のセットアップ

```bash
# Raspberry Pi OS Lite (64-bit) をmicroSDに書き込み後、SSH接続して:
git clone https://github.com/DaisukeHori/yamato-printer-mcp-server.git
cd yamato-printer-mcp-server
sudo ./scripts/setup-pi.sh
```

`setup-pi.sh` は以下を自動で行います:

- Node.js v20 LTS インストール
- npm 依存関係インストール (`npm ci` → TypeScriptビルド)
- `lp` グループに pi ユーザーを追加 (`/dev/usb/lp0` への書き込み権限付与)
- `usblp` カーネルモジュール自動ロード設定
- systemd ユニットのインストールと自動起動設定
- microSD 延命設定 (オプション: `--longevity` 付きで実行)

### 2. プリンタ接続確認

```bash
# USB接続後:
dmesg | tail -5 | grep usblp
# 期待される出力: "usblp0: USB Bidirectional printer dev 5 if 0 alt 0 proto 2 vid 0x... pid 0x..."

ls -la /dev/usb/lp0
# 期待される出力: "crw-rw---- 1 root lp 180, 0 Apr 16 09:00 /dev/usb/lp0"

# 素のTSPLコマンドでテスト印刷:
echo -e 'SIZE 100 mm, 150 mm\r\nGAP 2 mm, 0\r\nCLS\r\nTEXT 50,50,"3",0,1,1,"HELLO WS-420B"\r\nPRINT 1,1\r\n' | sudo tee /dev/usb/lp0
```

### 3. 環境変数設定

```bash
cp .env.example .env
# .env を編集:
#   MCP_API_KEY=<ランダムな英数字>
#   PRINTER_DEVICE=/dev/usb/lp0
#   TUNNEL_HOSTNAME=yamato-printer.appserver.tokyo
```

### 4. Cloudflare Tunnel の設定

```bash
# cloudflared インストール (setup-pi.sh 実行時に自動インストール済み)
cloudflared tunnel login
cloudflared tunnel create yamato-printer
cp cloudflared/config.yml.example ~/.cloudflared/config.yml
# ~/.cloudflared/config.yml を編集 (credentials-file パスとhostnameを設定)
cloudflared tunnel route dns yamato-printer yamato-printer.appserver.tokyo
sudo systemctl enable --now cloudflared
```

### 5. サービス起動

```bash
sudo systemctl enable --now yamato-printer-mcp
sudo systemctl status yamato-printer-mcp
# journalctl -u yamato-printer-mcp -f  # ログ監視
```

### 6. Claude.ai に MCP コネクタとして追加

Claude.ai の Settings → Connectors → カスタムコネクタ追加:

- **URL**: `https://yamato-printer.appserver.tokyo/mcp?key=<MCP_API_KEY>`
- **名前**: `YamatoPrinter` (任意)

## 使用例

### Claude からの対話例

```
ユーザー: この送り状PDFを印刷して (ファイル添付)
Claude: [bash_tool] curl -sF "file=@/mnt/user-data/uploads/shipping_20260416.pdf" \
          "https://yamato-printer.appserver.tokyo/upload"
        → {"file_id": "abc123", "filename": "shipping_20260416.pdf", "size": 45000}
        [MCP call] print_uploaded(file_id="abc123", slip_type="230")
        → {"job_id": "job_1", "status": "printing", "spooler_id": null}
        ヤマト送り状を印刷しました (ジョブID: job_1、用紙: 230番 17.8×10.8cm)
```

### S3 presigned URL 経由の印刷

```
[MCP call] print_url(
  url="https://paintlog-uploads-ap.s3.amazonaws.com/tmp/shipping.pdf?AWSAccessKeyId=...&Signature=...",
  filename="shipping.pdf",
  slip_type="10230004"  // ネコポス
)
```

## 対応送り状種別

| slip_type | 対応送り状 | 用紙サイズ |
|---|---|---|
| `230` | 宅急便 (発払い) / クール宅急便 / 宅急便コンパクト | 17.8 × 10.8 cm |
| `241` | 宅急便コレクト (クール便含む) | 22.8 × 10.8 cm |
| `203` | 宅急便タイムサービス | 22.8 × 10.8 cm |
| `10230004` | ネコポス | 17.8 × 10.8 cm |
| `10230015` | クロネコゆうパケット | 17.8 × 10.8 cm |
| `10230014` | クロネコゆうメール | 10.8 × 7.3 cm |
| `custom` | カスタムサイズ (mm指定) | 任意 |

出典: [ヤマトビジネスメンバーズ公式FAQ](https://b-faq.kuronekoyamato.co.jp/app/answers/detail/a_id/1076/)

## MCP ツール一覧

| ツール名 | 説明 |
|---|---|
| `print_uploaded` | `/upload`エンドポイントに送信済みのファイルを file_id 指定で印刷 |
| `print_url` | 任意のURL (S3等) から PDF を取得して印刷 |
| `list_uploads` | アップロード済みファイル一覧 |
| `list_jobs` | 印刷ジョブ履歴 |
| `get_job_status` | ジョブ状態の問い合わせ |
| `validate_print_options` | 印刷オプションの事前検証 |
| `list_slip_types` | 対応送り状種別一覧 |

詳細は [DESIGN.md](./DESIGN.md) を参照。

## アーキテクチャ

```
[Claude/業務システム]
      ↓ MCP over HTTP
[Cloudflare Tunnel]
      ↓ yamato-printer.appserver.tokyo
[Raspberry Pi Zero 2 W + WiFi 2.4GHz]
  ├─ yamato-printer-mcp-server (Node.js)
  │    ├─ Express (HTTP endpoints: /upload, /mcp, /uploads)
  │    ├─ MCP Server (tools)
  │    ├─ PDF → TSPL 変換パイプライン
  │    └─ SQLite (ジョブキュー)
  └─ /dev/usb/lp0 (usblp kernel driver)
          ↓ USB
[WS-420B サーマルラベルプリンタ]
```

詳細は [DESIGN.md](./DESIGN.md) を参照。

## トラブルシューティング

### プリンタが認識されない

```bash
lsusb | grep -i "xprinter\|printer"
sudo modprobe usblp
ls -la /dev/usb/lp0
```

もし `lsusb` で見えるが `/dev/usb/lp0` が存在しない場合、プリンタが USB Printer Class 非準拠の可能性があります。この場合は `libusb` 経由の実装に切り替えが必要です ([Issues](https://github.com/DaisukeHori/yamato-printer-mcp-server/issues) でお知らせください)。

### 印刷が荒い・文字が潰れる

1bit ディザ処理のしきい値を調整してください:

```bash
# .env:
DITHER_THRESHOLD=128  # 0-255 (デフォルト: 128)
DITHER_METHOD=floyd   # floyd | atkinson | threshold
```

### microSD が頻繁に壊れる

`scripts/microsd-longevity.sh` を実行して、ログのtmpfs化、swap無効化等の延命設定を適用してください:

```bash
sudo ./scripts/microsd-longevity.sh
```

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE)

## 関連プロジェクト

- [printer-mcp-server](https://github.com/DaisukeHori/printer-mcp-server) — Kyocera TASKalfa 6054ci (A4/A3業務文書) 用MCPサーバー (本プロジェクトの姉妹版)
- [mac-remote-mcp](https://github.com/DaisukeHori/mac-remote-mcp) — macOS リモートコントロールMCP
- [ssh-mcp-server](https://github.com/DaisukeHori/ssh-mcp-server) — SSH実行MCP

## 謝辞

本プロジェクトは以下のオープンソースプロジェクトに影響を受けています:

- [abrasive/pdf2tspl](https://github.com/abrasive/pdf2tspl) — Python実装のTSPL印刷ツール
- [thorrak/rpi-tspl-cups-driver](https://github.com/thorrak/rpi-tspl-cups-driver) — Raspberry Pi用CUPSドライバ

TSPL仕様は[TSC AUTO ID Technology](https://www.tscprinters.com/)の公式プログラミングマニュアルに基づきます。
