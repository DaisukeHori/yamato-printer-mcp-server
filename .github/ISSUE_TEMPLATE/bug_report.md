---
name: バグレポート / Bug Report
about: 印刷や動作に関する問題を報告する
title: "[BUG] "
labels: bug
assignees: ''
---

## 症状

<!-- 何が起きたか、何を期待したかを簡潔に -->

## 環境

- **ハードウェア**: (例: Raspberry Pi Zero 2 W)
- **OS**: (例: Raspberry Pi OS Lite 64-bit, Bookworm)
- **Node.js バージョン**: (node -v の出力)
- **プリンタ**: (例: WS-420B、他の機種なら型番)
- **yamato-printer-mcp-server バージョン**: (git rev-parse HEAD の短縮ハッシュ)
- **送り状種別**: (230 / 241 / ネコポス / custom 等)

## 再現手順

1. …
2. …
3. …

## 実行したMCPツール呼び出し

```json
{
  "tool": "print_uploaded",
  "args": { ... }
}
```

## 期待した動作

<!-- こうなってほしかった -->

## 実際の動作

<!-- こうなった (エラーメッセージがあればそのまま貼る) -->

## ログ

```
# journalctl -u yamato-printer-mcp -n 50 の出力を貼る
```

## dmesg (USBプリンタ関連の場合)

```
# sudo dmesg | grep -i -E "usblp|printer" の出力
```

## その他の情報

<!-- スクリーンショット、特殊な環境、関連IssueやPRへのリンクなど -->
