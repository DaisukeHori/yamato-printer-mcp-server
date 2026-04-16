import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",

    // テストファイルの探索
    include: [
      "tests/**/*.{test,spec}.ts",
      "tests/**/*.{test,spec}.tsx",
    ],
    exclude: ["node_modules", "dist", "tests/fixtures/**"],

    // テストタイムアウト
    testTimeout: 15_000,      // 15秒 (PDF変換が重い場合を考慮)
    hookTimeout: 10_000,

    // カバレッジ設定
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/types.ts",              // 型定義のみ
        "src/index.ts",              // エントリポイント (統合テストでカバー)
        "**/node_modules/**",
      ],
      // カバレッジ目標
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 70,
        statements: 75,
      },
    },

    // シリアル実行 (SQLite/ファイルI/Oの競合を避ける)
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // 環境変数 (テスト用)
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      MCP_API_KEY: "test-key-12345678901234567890",
      PRINTER_DEVICE: "/dev/null",
      UPLOAD_DIR: "/tmp/yamato-test-uploads",
      JOB_DB_PATH: ":memory:",
      DITHER_METHOD: "threshold",
      DITHER_THRESHOLD: "128",
      PRINTER_DPI: "203",
      MAX_UPLOAD_MB: "20",
      UPLOAD_TTL_MIN: "30",
      BLOCKED_CIDRS:
        "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,127.0.0.0/8",
    },
  },

  resolve: {
    // TypeScript の .js 拡張子 import を解決
    alias: [
      {
        find: /^(\.{1,2}\/.*)\.js$/,
        replacement: "$1",
      },
    ],
  },
});
