# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/spec/v2.0.0.html) に従います。

## [Unreleased]

### 今後の予定

- TSPLプリンタ状態クエリ (`<STX>E` コマンド) によるリアルタイム状態取得
- 複数ページPDFの連続印刷サポート
- 印刷プレビュー機能 (TSPL をレンダリングしてPNG返却)
- WebUI ダッシュボード (ジョブ監視)
- 複数プリンタのサポート (USB 2台以上)

---

## [0.1.0] - 2026-04-16

### 追加

- 初回リリース
- Raspberry Pi Zero 2 W + WS-420B 向け MCP サーバー実装
- MCP ツール 7個:
  - `print_uploaded` — `/upload` エンドポイント経由のファイル印刷
  - `print_url` — 任意URL (S3 presigned URL等) からの印刷
  - `list_uploads` — アップロード済みファイル一覧
  - `list_jobs` — ジョブ履歴
  - `get_job_status` — ジョブ状態問い合わせ
  - `validate_print_options` — 印刷オプション事前検証
  - `list_slip_types` — 対応送り状種別一覧
- ヤマト送り状プリセット 6種 + custom:
  - `230` 宅急便(発払い)/クール/コンパクト (17.8×10.8cm)
  - `241` 宅急便コレクト (22.8×10.8cm)
  - `203` 宅急便タイムサービス (22.8×10.8cm)
  - `10230004` ネコポス (17.8×10.8cm)
  - `10230015` クロネコゆうパケット (17.8×10.8cm)
  - `10230014` クロネコゆうメール (10.8×7.3cm)
  - `custom` カスタムサイズ(mm指定)
- PDF → TSPL 変換パイプライン:
  - `pdf-to-img` (内部 mupdf-wasm) でラスタライズ
  - `sharp` でリサイズ + 二値化
  - 自前の 1bit パッキング → TSPL `BITMAP` コマンド生成
- ディザ方式: `threshold` / `floyd` / `atkinson` (環境変数・引数で切替可)
- USB 直接書き込み (`/dev/usb/lp0` via `usblp` カーネルドライバ)
- SQLite ジョブキュー (自前ジョブID発行、状態遷移管理)
- Cloudflare Tunnel 運用前提 (`yamato-printer.appserver.tokyo`)
- systemd ユニット (ハードニング済、MemoryMax=400M)
- Raspberry Pi セットアップスクリプト `setup-pi.sh`
- microSD 延命スクリプト `microsd-longevity.sh`
- SSRF ガード (print_url で内部ネットワークアドレス拒否)
- MCP_API_KEY 認証 (クエリパラメータ or Bearer ヘッダ)

### セキュリティ

- `/upload` エンドポイントは認証なし (既存 printer-mcp-server と同パターン、`/tmp` 内で30分で自動削除)
- `/mcp` は MCP_API_KEY 必須
- systemd レベルの sandboxing (ProtectSystem=strict、ReadWritePaths最小化)

### ドキュメント

- README: Unofficial 商標注記、クイックスタート、使用例、トラブルシューティング
- DESIGN: アーキテクチャ図、TSPL 変換仕様、ジョブ状態遷移、パフォーマンス目標
- LICENSE: MIT + ヤマト商標の使用に関する注記
- .env.example: 詳細コメント付き環境変数テンプレート

[Unreleased]: https://github.com/DaisukeHori/yamato-printer-mcp-server/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DaisukeHori/yamato-printer-mcp-server/releases/tag/v0.1.0
