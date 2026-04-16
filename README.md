# yamato-printer-mcp-server

ヤマト運輸 送り状PDF用 ラベルプリンタ MCP サーバー  
Raspberry Pi Zero 2 W + WS-420B (サーマルラベルプリンタ) 向け

🌐 **プロジェクトLP**: https://daisukehori.github.io/yamato-printer-mcp-server/  
🎒 **超詳細セットアップガイド**: [本ページ下部](#-超詳細セットアップガイドはじめての人向け) または [docs/SETUP_GUIDE.md](./docs/SETUP_GUIDE.md)

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

> **⚡ はじめての人へ**  
> 下の「[🎒 超詳細セットアップガイド](#-超詳細セットアップガイドはじめての人向け)」をご覧ください。プログラミング経験ゼロでも、書いてある通りに順番にやれば完成します。**経験者の方はこの節だけで十分です。**

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

## テスト

203件の自動テストが用意されています (単体147件 + 結合49件 + 他7件)。

| 指標 | カバレッジ | 目標 |
|---|---|---|
| Statements | 88.09% | 75% |
| Branches | 71.17% | 70% |
| Functions | **100%** | 80% |
| Lines | 88.09% | 75% |

```bash
npm test                # 全テスト実行
npm run test:unit       # 単体テストのみ
npm run test:integration # 結合テストのみ
npm run test:coverage   # カバレッジ付き
npm run test:watch      # 監視モード
```

テスト構成:

- **tests/unit/** (182件)
  - `yamato-slips.test.ts` — 送り状プリセット・サイズ検証 (33件)
  - `pdf-to-tspl.test.ts` — PDF→TSPL 変換・TSPLコマンド生成 (32件、実PDF変換含む)
  - `auth.test.ts` — MCP API Key 認証 (17件)
  - `job-queue.test.ts` — SQLite ジョブキュー (22件)
  - `printer-device.test.ts` — /dev/usb/lp0 書き込み (17件)
  - `ssrf.test.ts` — SSRF ガード IPv4/IPv6/メタデータ (33件)

- **tests/integration/** (49件)
  - `http-endpoints.test.ts` — /upload, /uploads, /health, /mcp 認証 (25件)
  - `mcp-tools.test.ts` — MCP JSON-RPC 経由の全ツール呼び出し (24件)

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

## 🎒 超詳細セットアップガイド (はじめての人向け)

このセクションは **「プログラミングもLinuxもやったことない人」** を対象に書かれています。書いてある通りに順番にコピペしていけば、誰でもAIから送り状が印刷できる環境が完成します。

**所要時間**: 最初のセットアップで約2〜3時間。慣れれば30分。  
**完全版ガイド (用語集・さらに詳しい画面キャプチャ付き)**: [docs/SETUP_GUIDE.md](./docs/SETUP_GUIDE.md) もあります。

### 📖 このガイドの目次

1. [最初に知っておくこと](#最初に知っておくこと)
2. [用意するもの(買い物リスト)](#用意するもの買い物リスト)
3. [STEP 1: microSDカードに OS を書き込む](#step-1-microsdカードに-os-を書き込む)
4. [STEP 2: 電源を入れて接続確認する](#step-2-電源を入れて接続確認する)
5. [STEP 3: Raspberry Pi に SSH で接続する](#step-3-raspberry-pi-に-ssh-で接続する)
6. [STEP 4: このプロジェクトをインストールする](#step-4-このプロジェクトをインストールする)
7. [STEP 5: プリンタを接続してテスト印刷する](#step-5-プリンタを接続してテスト印刷する)
8. [STEP 6: インターネット越しに使えるように設定する](#step-6-インターネット越しに使えるように設定する)
9. [STEP 7: Claude.ai と繋げる](#step-7-claudeai-と繋げる)
10. [STEP 8: 実際に送り状を印刷してみる](#step-8-実際に送り状を印刷してみる)
11. [よくあるトラブルと対処](#よくあるトラブルと対処)
12. [用語集](#用語集)

---

### 最初に知っておくこと

#### これは何を作るの?

このプロジェクトを完成させると、**Claude(AI)に「この送り状PDFを印刷して」と頼むだけで、手元の小さなプリンタから送り状ラベルが出てくる**ようになります。

#### なぜ普通にPCで印刷しないの?

普通のPCは電気を食うし、うるさいし、大きいからです。このプロジェクトで使う「Raspberry Pi Zero 2 W」は **500円玉くらいのサイズでわずか10グラム、電気代は1ヶ月で数十円** しかかかりません。机の上に置きっぱなしで、電源を入れたままにしておけます。

#### どんな流れで印刷されるの?

```
① 君が Claude に「この送り状を印刷して」と頼む
        ↓
② Claude は PDF をインターネット経由で Raspberry Pi に送る
        ↓
③ Raspberry Pi が PDF を "プリンタが読める形" に変換する
        ↓
④ プリンタが紙に印字する
```

#### 大事な注意

このプロジェクトは **ヤマト運輸とは無関係の個人プロジェクト** です。"ヤマト"や"宅急便"はヤマトホールディングスの商標なので、**業務で使うときは契約内容を自分で確認してください**。

---

### 用意するもの(買い物リスト)

#### 絶対に必要なもの

| 名前 | 値段 | どこで買える | 何に使う |
|---|---|---|---|
| **Raspberry Pi Zero 2 W** | 2,500〜3,500円 | [スイッチサイエンス](https://www.switch-science.com/)、[秋月電子](https://akizukidenshi.com/) | コンピュータ本体 |
| **microSDカード (32GB、防犯カメラ用が推奨)** | 1,500〜2,000円 | Amazon、家電量販店 | OS(パソコンの中身)を入れる |
| **Micro USB 電源アダプタ (5V/2.5A)** | 500〜1,000円 | 100円ショップ、Amazon | 電気をあげる |
| **Micro USB ⇔ USB-A の OTG ケーブル** | 300〜800円 | 100円ショップ、Amazon | プリンタと繋げる |
| **WS-420B サーマルラベルプリンタ** | 8,000〜12,000円 | Amazon、楽天 | 紙に印字する装置 |
| **送り状ロール紙** | 無料 | ヤマトビジネスメンバーズ | 印刷する紙 |

#### あると便利なもの

| 名前 | 値段 | 何に使う |
|---|---|---|
| **microSDカードリーダー** | 500円 | PCにSDカードを挿すため (PCに直挿しできないとき) |
| **USBハブ (電源付き)** | 1,000円 | 他のUSBデバイスも繋げたいとき |

#### パソコンも必要

macOS、Windows、または Linux のパソコン。**WiFiに繋がっていればOK**。

---

### STEP 1: microSDカードに OS を書き込む

microSDカードを、**Raspberry Pi が動く状態** にします。"OSを書き込む"と言います。OSは "オペレーティングシステム" の略で、**コンピュータを動かす土台のソフト** のことです。

#### 1-1. Raspberry Pi Imager をダウンロード

**Raspberry Pi Imager** という、OS書き込み専用アプリを使います。公式サイトからダウンロードします。

🌐 https://www.raspberrypi.com/software/

ページを開いたら、あなたのPCに合わせて選びます:

- **Mac** の人 → "Download for macOS"
- **Windows** の人 → "Download for Windows"
- **Linux** の人 → apt か dnf でインストール

ダウンロードしたファイルをダブルクリックして **インストール** します。これは普通のアプリと同じ。

#### 1-2. microSDカードをPCに挿す

microSDカードをカードリーダー経由でPCに挿します。中身に大事なものがある場合は **先にバックアップ** を取ってください。書き込むとカードの中身は **全部消えます**。

#### 1-3. Raspberry Pi Imager を起動

インストールしたアプリを起動します。

#### 1-4. デバイスを選ぶ

1. 「**CHOOSE DEVICE**」(デバイスを選ぶ)をクリック
2. 「**Raspberry Pi Zero 2 W**」をクリック

#### 1-5. OS を選ぶ

1. 「**CHOOSE OS**」(OSを選ぶ)をクリック
2. 「**Raspberry Pi OS (other)**」をクリック
3. 「**Raspberry Pi OS Lite (64-bit)**」を選ぶ ← **"Lite" の方を選ぶ!**

> 💡 **なぜ "Lite"?**  
> "Lite"は画面(デスクトップ)がない、軽量版のOSです。Raspberry Pi Zero 2 W はメモリが少ない(512MB)ので、Liteでないと重くて動きません。

#### 1-6. 書き込み先 (SDカード) を選ぶ

1. 「**CHOOSE STORAGE**」(ストレージを選ぶ)をクリック
2. 挿した microSDカード を選ぶ

> ⚠️ **必ず microSDカードを選ぶこと**  
> PCの内蔵ディスク (Macintosh HD など) を選んでしまうと、PC自体のデータが消えます。**サイズが32GBなど小さいやつがSDカード** です。

#### 1-7. 「NEXT」をクリック → カスタマイズする

「NEXT」を押すと「**Would you like to apply OS customisation settings?**」と聞かれます。これは「**設定を事前にやっておく?**」という意味です。

必ず「**EDIT SETTINGS**」をクリック します。

#### 1-8. 設定画面で以下を入力

「**GENERAL**」タブで:

| 項目 | 入力するもの | 例 |
|---|---|---|
| **Set hostname** | チェックを入れる | `yamato-printer` |
| **Set username and password** | チェックを入れる | |
| &nbsp;&nbsp;&nbsp;Username | `pi` | `pi` |
| &nbsp;&nbsp;&nbsp;Password | 覚えやすいパスワード(8文字以上) | `myPassword123` |
| **Configure wireless LAN** | チェックを入れる | |
| &nbsp;&nbsp;&nbsp;SSID | **家のWiFiの名前** | `MyHomeWiFi` |
| &nbsp;&nbsp;&nbsp;Password | **家のWiFiのパスワード** | `yourwifipassword` |
| &nbsp;&nbsp;&nbsp;Wireless LAN country | **JP** | JP |
| **Set locale settings** | チェックを入れる | |
| &nbsp;&nbsp;&nbsp;Time zone | `Asia/Tokyo` | |
| &nbsp;&nbsp;&nbsp;Keyboard layout | `jp` (または `us`) | |

次に「**SERVICES**」タブで:

| 項目 | 設定 |
|---|---|
| **Enable SSH** | チェックを入れる |
| &nbsp;&nbsp;&nbsp;SSH認証方法 | 「**Use password authentication**」を選ぶ |

全部入力したら「**SAVE**」をクリック。

> 💡 **"SSH"って何?**  
> SSH (エスエスエイチ) は「離れた場所にあるコンピュータに遠隔ログインする仕組み」です。Raspberry Pi には画面もキーボードも繋げないので、自分のPCから SSH で操作します。

#### 1-9. いよいよ書き込み

「**Would you like to apply OS customisation settings?**」の画面で「**YES**」を押します。

次に「**Warning: All existing data on 'SDカード' will be erased**」と警告が出ますが、「**YES**」。

書き込みが終わるのを待ちます。**約5〜10分**。途中でSDカードを抜かないでください。

終わると「**Write Successful**」と出るので、PCからSDカードを取り出します。

---

### STEP 2: 電源を入れて接続確認する

#### 2-1. Raspberry Pi に microSDカードを挿す

Raspberry Pi Zero 2 W の **裏側** に microSDカードのスロットがあります。**金属の端子が見える側を上** にして、カチッと音がするまで押し込みます。

#### 2-2. 電源を繋ぐ

Raspberry Pi Zero 2 W には **Micro USB ポートが2つ** あります:

```
  [HDMI] [USB DATA] [USB POWER]
    ↑        ↑          ↑
  使わない ← 左    右 → 電源
```

**右側の「USB POWER」と書かれた方** に Micro USB ケーブルを挿して電源アダプタをコンセントに挿します。

#### 2-3. 起動を待つ

電源が入ると、本体の **緑色のLEDが点滅** します。これが「起動中」のサイン。

**初回起動は3〜5分** かかります。気長に待ちましょう。

---

### STEP 3: Raspberry Pi に SSH で接続する

#### 3-1. Raspberry Pi の IPアドレスを調べる

**Mac / Linuxの場合**、ターミナルを開いて:

```bash
ping yamato-printer.local
```

**Windowsの場合**、コマンドプロンプトを開いて:

```cmd
ping yamato-printer.local
```

こんな感じに返事が来ればOK:

```
PING yamato-printer.local (192.168.1.123): 56 data bytes
64 bytes from 192.168.1.123: icmp_seq=0 ttl=64 time=45.123 ms
```

`192.168.1.123` (IPアドレス) をメモ。**Ctrl + C** で停止します。

#### 3-2. SSH で接続する

```bash
ssh pi@yamato-printer.local
```

初回は「The authenticity of host ... can't be established.」と聞かれるので `yes` と入力。

パスワードを聞かれるので、**STEP 1-8 で決めたパスワード** を入力。**打っている文字は画面に表示されない** けど打てています。

成功すると:

```
pi@yamato-printer:~ $
```

**これが Linux のコマンド画面** です。ここから全部この画面で作業。

---

### STEP 4: このプロジェクトをインストールする

#### 4-1. 必要な道具を入れる

```bash
sudo apt update
sudo apt install -y git
```

> 💡 **`sudo` って?**  
> 「管理者権限でこのコマンドを実行する」。はじめて `sudo` を使うときパスワードを聞かれます(さっきのパスワード)。

#### 4-2. プロジェクトをダウンロード

```bash
cd ~
git clone https://github.com/DaisukeHori/yamato-printer-mcp-server.git
cd yamato-printer-mcp-server
```

#### 4-3. セットアップスクリプトを実行

```bash
sudo ./scripts/setup-pi.sh --longevity
```

**20〜30分** かかります。

**最後に以下が出たらOK**:

```
[SETUP] セットアップ完了
[SETUP]   MCP_API_KEY を自動生成しました: abc123... ← メモして!
```

#### 4-4. MCP_API_KEY をメモする

この `abc123...` の部分を **メモしてください**。あとでClaude.aiで使います。

見逃したら:

```bash
grep MCP_API_KEY ~/yamato-printer-mcp-server/.env
```

#### 4-5. 再起動

```bash
sudo reboot
```

1〜2分後、再度SSH接続:

```bash
ssh pi@yamato-printer.local
```

---

### STEP 5: プリンタを接続してテスト印刷する

#### 5-1. プリンタを準備

WS-420B の電源ケーブルをコンセントに挿して電源ボタンON。ロール紙をセット(プリンタ付属の説明書に従ってください)。

#### 5-2. プリンタと Raspberry Pi を繋ぐ

**OTGケーブル** を使います:

- プリンタのUSBケーブル(USB-A) → OTGケーブルのメス端子
- OTGケーブルのMicro USB端子 → Raspberry Pi の **左側 "USB DATA"** ポート

> ⚠️ **間違えないで!**  
> Raspberry Pi の **右側は電源専用**。**左の「USB DATA」** に繋ぐ。

#### 5-3. プリンタが認識されたか確認

```bash
dmesg | tail -10
```

以下のような行が出ていればOK:

```
[XXX.XXX] usblp0: USB Bidirectional printer dev X if 0 alt 0 proto 2 vid 0x... pid 0x...
```

「**usblp0**」という文字が見えたら成功。

```bash
ls -la /dev/usb/lp0
```

```
crw-rw---- 1 root lp 180, 0 Apr 16 09:00 /dev/usb/lp0
```

こんな感じに見えればOK。

#### 5-4. テスト印刷

```bash
cd ~/yamato-printer-mcp-server
npm run print-sample:test
```

**プリンタからラベルが1枚出てきたら大成功!** 「HELLO WS-420B」と印字されているはず。

#### 5-5. PDF印刷もテスト

```bash
npm run print-sample:pdf
```

---

### STEP 6: インターネット越しに使えるように設定する

ここまでは **家のWiFi内からしか使えない** 状態です。**Cloudflare Tunnel** で外からアクセスできるようにします。

#### 6-1. Cloudflare アカウントを作る

🌐 https://dash.cloudflare.com/sign-up

メールアドレスとパスワードを入力して登録。確認メールのリンクをクリック。

#### 6-2. 独自ドメインを取得する

Cloudflare Tunnelには **独自ドメイン** が必要です:

- [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (年間1,500円)
- [お名前.com](https://www.onamae.com/) (年間1,000〜2,000円)
- [Google Domains](https://domains.google/) (年間2,000円)

取得したドメインを Cloudflare に登録します (Cloudflare公式ガイドに従う)。

#### 6-3. Zero Trust ダッシュボードでトンネルを作る

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) にログイン
2. 左メニュー「**Networks**」→「**Tunnels**」→「**Create a tunnel**」
3. Tunnel type: 「**Cloudflared**」
4. Tunnel name: `yamato-printer`
5. 「**Save tunnel**」

#### 6-4. cloudflared のトークン認証 (Pi側)

Cloudflare画面に表示されるコマンドをコピーしてSSH画面で実行:

```bash
sudo cloudflared service install eyJhIjoiXXX...
```

`eyJh...` の部分は **Cloudflare画面に表示された実際のトークン** に置き換え。

#### 6-5. ドメインとトンネルを紐付ける

Cloudflare画面で「**Next**」→ Public Hostname設定:

| 項目 | 入力 |
|---|---|
| Subdomain | `yamato-printer` |
| Domain | (取得した自分のドメイン) |
| Type | `HTTP` |
| URL | `localhost:8719` |

「**Save hostname**」。

#### 6-6. 動作確認

ブラウザで:

```
https://yamato-printer.あなたのドメイン/health
```

JSONが表示されればOK:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "printer": { "available": true, "device": "/dev/usb/lp0" }
}
```

---

### STEP 7: Claude.ai と繋げる

#### 7-1. Claude.ai にログイン

🌐 https://claude.ai/

#### 7-2. 設定画面を開く

右下の自分のアイコン → 「**Settings**」→「**Connectors**」→「**Add custom connector**」

#### 7-3. コネクタ情報を入力

| 項目 | 入力 |
|---|---|
| Name | `YamatoPrinter` |
| URL | `https://yamato-printer.あなたのドメイン/mcp?key=XXXXX` |

**`XXXXX` の部分** は STEP 4-4 でメモした **MCP_API_KEY** に置き換え。

「**Add**」または「**Save**」。

#### 7-4. 動作確認

Claude.aiの新しいチャットで「**利用可能なMCPツールを教えて**」と聞いてみる。`print_uploaded`、`print_url` などが出てきたら成功。

---

### STEP 8: 実際に送り状を印刷してみる

#### 8-1. ヤマトB2クラウドで送り状PDFを作る

🌐 https://bmypage.kuronekoyamato.co.jp/

送り状を作成してPDFをダウンロード。

#### 8-2. Claude.ai にPDFをアップロード

Claude.aiでチャット画面を開き、**クリップボタン** からPDFをアップロード。

#### 8-3. 印刷指示

```
この送り状PDFを印刷してください。宅急便の用紙を使います。
```

と送信。Claudeが自動的に `print_uploaded` を呼び出し、数秒後にプリンタからラベルが出てきます。

🎉 **お疲れ様でした!**

---

### よくあるトラブルと対処

#### ❌ ping yamato-printer.local が通らない

**症状**: `ping: cannot resolve yamato-printer.local`

**解決策**:
1. Raspberry Pi の電源LEDが点滅しているか確認
2. 家のWiFiパスワードが正しいか確認 (STEP 1-8)
3. 5GHz帯WiFiに繋ごうとしていないか確認 (Pi Zero 2 W は **2.4GHzのみ**)
4. ルーターの「同一ネットワーク内で機器が見える設定」を確認

#### ❌ SSH接続でパスワードを何度入れても弾かれる

**症状**: `Permission denied, please try again.`

**解決策**:
1. パスワードの打ち間違い。慎重にゆっくり
2. 日本語入力がONになっている。英語入力に
3. どうしてもダメなら microSDカードに書き込み直す

#### ❌ setup-pi.sh がエラーで止まった

赤色の `[ERROR]` メッセージをよく読む:

- `E: Unable to locate package` → インターネット接続を確認、`sudo apt update` を再実行
- `No space left on device` → microSDカードが小さすぎ、32GB以上を使う

#### ❌ dmesg にusblp が出ない

**解決策**:
1. プリンタの **電源が入っているか** 確認
2. OTGケーブルが **Raspberry Pi の左側(USB DATA)** に繋がっているか確認
3. モジュールを手動ロード:
   ```bash
   sudo modprobe usblp
   ls /dev/usb/lp0
   ```
4. USBケーブルを変える(粗悪品があるため)

#### ❌ 印刷は始まるがテキストが真っ黒 / 真っ白

**解決策**:
1. ディザしきい値を調整:
   ```bash
   nano ~/yamato-printer-mcp-server/.env
   ```
   `DITHER_THRESHOLD=128` を `100` や `180` に変えて試す
2. サーマル紙の裏表が逆になっている可能性

#### ❌ Cloudflare Tunnel が繋がらない

```bash
sudo systemctl status cloudflared
sudo systemctl status yamato-printer-mcp
journalctl -u yamato-printer-mcp -n 50
journalctl -u cloudflared -n 50
```

#### ❌ Claude.ai で「コネクタが見つかりません」

1. ブラウザで `/health` を開いて接続確認
2. URLの `?key=XXXX` が `.env` の `MCP_API_KEY` と完全一致しているか確認

#### ❌ Raspberry Pi が勝手に再起動する

1. 電源アダプタが **5V/2.5A以上** か確認 (古いスマホ充電器はNG)
2. microSDカードを新品に交換

---

### 用語集

| 用語 | 意味 |
|---|---|
| **SSH** | エスエスエイチ。離れたコンピュータをネットワーク越しに操作する仕組み |
| **OS** | Operating System。コンピュータを動かす土台のソフト |
| **ターミナル** | コマンドを入力して操作する、文字だけの画面 |
| **sudo** | スードゥー。管理者権限でコマンドを実行する |
| **apt** | Debian/Ubuntu でソフトをインストールするコマンド |
| **git clone** | GitHub からプロジェクトをダウンロード |
| **systemd** | サービスを自動起動させる Linux の仕組み |
| **TSPL** | ティーエスピーエル。サーマルラベルプリンタ用の命令言語 |
| **Cloudflare Tunnel** | 家のPCを外から見えるようにするサービス(無料) |
| **MCP** | Model Context Protocol。AI が外部ツールを使う規格 |
| **microSD** | Raspberry Pi の記憶装置 |
| **IPアドレス** | ネットワーク上の住所。例: `192.168.1.123` |
| **ホスト名** | 覚えやすい名前。`.local` を付けるとLAN内で機器を見つけられる |

---

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

## 🌐 プロジェクトサイト (GitHub Pages)

`docs/index.html` にランディングページが用意されています。以下の手順で GitHub Pages を有効化すると、`https://daisukehori.github.io/yamato-printer-mcp-server/` で公開されます。

### 有効化手順

1. このリポジトリの **Settings** → **Pages** に移動
2. **Build and deployment** セクションで:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / フォルダ: `/docs`
3. **Save** をクリック
4. 約10分待つと、`https://daisukehori.github.io/yamato-printer-mcp-server/` で公開されます

### 構成

| ファイル | 用途 |
|---|---|
| `docs/index.html` | ランディングページ (日本的工業デザイン、単一HTML、約2000行) |
| `docs/SETUP_GUIDE.md` | 超詳細セットアップガイド (完全版) |

LPには以下のセクションが含まれます:
- Hero (プロジェクト説明)
- ラベル風モックアップ + スタンプ装飾
- 統計情報 (203 tests, 88% coverage, 7 tools, 10g)
- 7つのMCPツール + 変換パイプライン紹介
- 4ステップで印刷される仕組み
- 3ステップのクイックスタート (コード付き)
- ハードウェア一覧 (総額1万円前後)
- **🎒 超詳細ガイド (8ステップ、アコーディオン展開式、はじめての人向け)**
- よくあるトラブルシューティング
- CTA + フッター

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
