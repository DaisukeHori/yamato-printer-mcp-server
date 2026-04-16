/**
 * ヤマト送り状プリセット定義
 *
 * ヤマトB2クラウドで発行される送り状PDFのラベル品番に対応する
 * 用紙サイズ・印字方向・ギャップ等のプリセット。
 *
 * 参考: ヤマトビジネスメンバーズ FAQ (a_id/1076)
 *       https://b-faq.kuronekoyamato.co.jp/app/answers/detail/a_id/1076/
 *
 * 注意:
 *   - 寸法は公式の伝票サイズを mm 単位で記載
 *   - TSPL DIRECTION: 0=用紙送り方向と印字方向が同じ, 1=180度回転
 *     WS-420B で送り状を正しい向きで印字するため、基本 direction=1
 *   - GAP: ラベル間の物理的な隙間。ロール紙の仕様に合わせて調整
 */

import type { SlipPreset, SlipType, PrintOptions } from "../types.js";

/**
 * ヤマト送り状プリセット
 */
export const YAMATO_SLIPS: Record<Exclude<SlipType, "custom">, SlipPreset> = {
  "230": {
    size: { width_mm: 108, height_mm: 178 },
    direction: 1,
    gap_mm: 2,
    description: "宅急便(発払い)/クール宅急便/宅急便コンパクト (17.8×10.8cm)",
  },
  "241": {
    size: { width_mm: 108, height_mm: 228 },
    direction: 1,
    gap_mm: 2,
    description: "宅急便コレクト (クール便含む) (22.8×10.8cm)",
  },
  "203": {
    size: { width_mm: 108, height_mm: 228 },
    direction: 1,
    gap_mm: 2,
    description: "宅急便タイムサービス (22.8×10.8cm)",
  },
  "10230004": {
    size: { width_mm: 108, height_mm: 178 },
    direction: 1,
    gap_mm: 2,
    description: "ネコポス (17.8×10.8cm)",
  },
  "10230015": {
    size: { width_mm: 108, height_mm: 178 },
    direction: 1,
    gap_mm: 2,
    description: "クロネコゆうパケット (17.8×10.8cm)",
  },
  "10230014": {
    size: { width_mm: 108, height_mm: 73 },
    direction: 1,
    gap_mm: 2,
    description: "クロネコゆうメール (10.8×7.3cm)",
  },
};

/**
 * slip_type から SlipPreset を解決する。
 * "custom" の場合は PrintOptions の custom_width_mm/custom_height_mm を使う。
 *
 * @throws Error カスタム指定なのにサイズが未指定、または不正な slip_type
 */
export function resolveSlipPreset(options: PrintOptions): SlipPreset {
  if (options.slip_type === "custom") {
    if (
      options.custom_width_mm === undefined ||
      options.custom_height_mm === undefined
    ) {
      throw new Error(
        'slip_type="custom" was specified but custom_width_mm or ' +
          "custom_height_mm is missing. Example: " +
          'print_url(url=..., slip_type="custom", custom_width_mm=100, custom_height_mm=150)'
      );
    }

    if (options.custom_width_mm <= 0 || options.custom_width_mm > 108) {
      throw new Error(
        `custom_width_mm must be between 1 and 108 (WS-420B max). ` +
          `Got: ${options.custom_width_mm}`
      );
    }

    if (options.custom_height_mm <= 0 || options.custom_height_mm > 1778) {
      throw new Error(
        `custom_height_mm must be between 1 and 1778 (WS-420B max). ` +
          `Got: ${options.custom_height_mm}`
      );
    }

    return {
      size: {
        width_mm: options.custom_width_mm,
        height_mm: options.custom_height_mm,
      },
      direction: options.direction ?? 1,
      gap_mm: 2,
      description: `カスタム (${options.custom_width_mm}×${options.custom_height_mm}mm)`,
    };
  }

  const preset = YAMATO_SLIPS[options.slip_type];
  if (!preset) {
    throw new Error(
      `Unknown slip_type: ${options.slip_type}. ` +
        `Supported: ${listSupportedSlipTypes().join(", ")}`
    );
  }

  // direction が明示的に指定されていれば上書き
  if (options.direction !== undefined) {
    return { ...preset, direction: options.direction };
  }

  return preset;
}

/**
 * サポートされている slip_type の一覧を返す
 */
export function listSupportedSlipTypes(): SlipType[] {
  return [...(Object.keys(YAMATO_SLIPS) as Exclude<SlipType, "custom">[]), "custom"];
}

/**
 * slip_type の一覧を説明つきで返す (list_slip_types MCPツール用)
 */
export function getSlipTypesWithDescription(): Array<{
  slip_type: SlipType;
  description: string;
  size_mm?: { width: number; height: number };
}> {
  const result: Array<{
    slip_type: SlipType;
    description: string;
    size_mm?: { width: number; height: number };
  }> = [];

  for (const [key, preset] of Object.entries(YAMATO_SLIPS)) {
    result.push({
      slip_type: key as SlipType,
      description: preset.description,
      size_mm: {
        width: preset.size.width_mm,
        height: preset.size.height_mm,
      },
    });
  }

  result.push({
    slip_type: "custom",
    description:
      "カスタムサイズ — custom_width_mm と custom_height_mm を実行時に指定",
  });

  return result;
}
