/**
 * 共通型定義
 * yamato-printer-mcp-server
 */

/**
 * ヤマト送り状種別プリセットのキー
 * - "230"       : 宅急便(発払い)/クール/コンパクト (17.8×10.8cm)
 * - "241"       : 宅急便コレクト (22.8×10.8cm)
 * - "203"       : 宅急便タイムサービス (22.8×10.8cm)
 * - "10230004"  : ネコポス (17.8×10.8cm)
 * - "10230015"  : クロネコゆうパケット (17.8×10.8cm)
 * - "10230014"  : クロネコゆうメール (10.8×7.3cm)
 * - "custom"    : カスタムサイズ (width_mm/height_mm を実行時指定)
 */
export type SlipType =
  | "230"
  | "241"
  | "203"
  | "10230004"
  | "10230015"
  | "10230014"
  | "custom";

/**
 * 送り状プリセット定義
 */
export interface SlipPreset {
  size: {
    width_mm: number;
    height_mm: number;
  };
  /** TSPL DIRECTION (0=正方向, 1=180度回転) */
  direction: 0 | 1;
  /** ラベル間ギャップ(mm) */
  gap_mm: number;
  /** 日本語説明 */
  description: string;
}

/**
 * 印刷オプション (MCPツールの引数)
 */
export interface PrintOptions {
  /** ヤマト送り状種別 (必須) */
  slip_type: SlipType;

  /** 印刷部数 (デフォルト: 1) */
  copies?: number;

  /** カスタムサイズ用 (slip_type="custom" の時のみ必須) */
  custom_width_mm?: number;
  custom_height_mm?: number;

  /** ディザ方式上書き (未指定なら環境変数) */
  dither_method?: "threshold" | "floyd" | "atkinson";

  /** ディザしきい値上書き (未指定なら環境変数) */
  dither_threshold?: number;

  /** 180度回転上書き (未指定ならプリセットのdirection) */
  direction?: 0 | 1;
}

/**
 * アップロードされたファイルのメタデータ
 */
export interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  uploaded_at: string;       // ISO 8601
  path: string;               // サーバー内の絶対パス
  mime_type: string;
  expires_at: string;         // ISO 8601
}

/**
 * ジョブステータス
 */
export type JobStatus =
  | "pending"
  | "converting"
  | "printing"
  | "completed"
  | "failed";

/**
 * 印刷ジョブ (DB行)
 */
export interface Job {
  job_id: string;
  file_id: string | null;
  source_url: string | null;
  filename: string;
  slip_type: string;
  status: JobStatus;
  error: string | null;
  bytes_sent: number;
  copies: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * ジョブ作成時の入力
 */
export interface CreateJobInput {
  file_id?: string | null;
  source_url?: string | null;
  filename: string;
  slip_type: string;
  copies: number;
}

/**
 * TSPL 変換結果
 */
export interface TsplConversionResult {
  /** 生成された TSPL コマンド(バイナリ) */
  tspl_buffer: Buffer;

  /** 元PDFのページ数 */
  pdf_page_count: number;

  /** 実際にレンダリングしたピクセル寸法 */
  rendered_pixels: {
    width: number;
    height: number;
  };

  /** BITMAP command 内のバイト幅 */
  bitmap_width_bytes: number;

  /** BITMAP command 内の高さ(px) */
  bitmap_height_pixels: number;

  /** 処理にかかった時間(ms) */
  elapsed_ms: number;
}
