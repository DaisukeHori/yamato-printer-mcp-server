# Contributing

プロジェクトへのコントリビューションに興味を持っていただきありがとうございます。

## はじめに

このプロジェクトは個人/社内の業務自動化用途で開発されており、大規模な機能追加は慎重に検討します。バグ報告や小さな改善は歓迎します。

## Issue を立てる前に

- 既存の Issue / PR を検索してください
- 再現可能な環境・手順を含めてください (テンプレートを活用)
- ハードウェア依存の問題はプリンタ型番・ファームウェアバージョンも明記

## 開発環境セットアップ

```bash
git clone https://github.com/DaisukeHori/yamato-printer-mcp-server.git
cd yamato-printer-mcp-server
npm ci
npm run typecheck
npm run build
```

### 実機を持たない場合のテスト

`PRINTER_DEVICE=/dev/null` に設定すれば変換パイプラインのみテストできます:

```bash
PRINTER_DEVICE=/dev/null npx tsx scripts/print-sample.ts --mode pdf
```

## コーディング規約

- TypeScript strict モード
- ESM (package.json の `"type": "module"`)
- 関数コメントは日本語または英語のどちらでもOK、プロジェクト内で一貫していれば可
- `pino` ロガーを使い、`console.log` は最小限に
- エラーは適切な型 (例: `PrinterWriteError`) で投げる

## PR を作る前に

1. `npm run typecheck` が通ること
2. `npm run build` が通ること
3. 既存機能を壊していないこと (手元で `print-sample.ts --mode test` を実行)
4. 変更内容を CHANGELOG.md に追記 (Unreleased セクション)

## 新しい送り状種別を追加するとき

1. `src/services/yamato-slips.ts` の `YAMATO_SLIPS` に追加
2. `src/types.ts` の `SlipType` に追加
3. `README.md` の対応送り状種別表に追記
4. `DESIGN.md` のプリセット表に追記

出典 (ヤマトB2クラウドの品番ページ等) を PR 説明に明記してください。

## 新しいプリンタ機種のサポート

WS-420B 以外の TSPL プリンタも基本的に動作する可能性がありますが、動作確認が必要です。PRではなく Issue で「動作確認済み機種リスト」への追加相談から始めてください。

- TSPLエミュレーション対応機種リスト (推定互換)
- Xprinter XP-420B / XP-460B
- Hotlabel S8
- その他、USB Printer Class + TSPL 対応機

## ライセンス

貢献された変更は MIT ライセンスで公開されることに同意したものとみなします。

## 質問・相談

Issue に `question` ラベルで投稿するか、セキュリティ関連の場合は直接リポジトリオーナーに連絡してください。
