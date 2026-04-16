/**
 * yamato-slips.ts のユニットテスト
 *
 * 対象:
 *   - resolveSlipPreset(): プリセット解決、custom処理、エラーケース
 *   - listSupportedSlipTypes(): 一覧取得
 *   - getSlipTypesWithDescription(): 説明付き一覧
 */

import { describe, it, expect } from "vitest";
import {
  YAMATO_SLIPS,
  resolveSlipPreset,
  listSupportedSlipTypes,
  getSlipTypesWithDescription,
} from "../../src/services/yamato-slips.js";
import type { PrintOptions } from "../../src/types.js";

describe("YAMATO_SLIPS 定数", () => {
  it("6種類のプリセット品番を持つ", () => {
    expect(Object.keys(YAMATO_SLIPS)).toHaveLength(6);
  });

  it("230 番は宅急便 17.8×10.8cm で direction=1", () => {
    expect(YAMATO_SLIPS["230"].size).toEqual({
      width_mm: 108,
      height_mm: 178,
    });
    expect(YAMATO_SLIPS["230"].direction).toBe(1);
    expect(YAMATO_SLIPS["230"].description).toContain("宅急便");
  });

  it("241 番は宅急便コレクト 22.8×10.8cm", () => {
    expect(YAMATO_SLIPS["241"].size).toEqual({
      width_mm: 108,
      height_mm: 228,
    });
    expect(YAMATO_SLIPS["241"].description).toContain("コレクト");
  });

  it("203 番は宅急便タイムサービス 22.8×10.8cm", () => {
    expect(YAMATO_SLIPS["203"].size).toEqual({
      width_mm: 108,
      height_mm: 228,
    });
    expect(YAMATO_SLIPS["203"].description).toContain("タイムサービス");
  });

  it("10230004 はネコポス 17.8×10.8cm", () => {
    expect(YAMATO_SLIPS["10230004"].size).toEqual({
      width_mm: 108,
      height_mm: 178,
    });
    expect(YAMATO_SLIPS["10230004"].description).toContain("ネコポス");
  });

  it("10230015 はクロネコゆうパケット 17.8×10.8cm", () => {
    expect(YAMATO_SLIPS["10230015"].size).toEqual({
      width_mm: 108,
      height_mm: 178,
    });
    expect(YAMATO_SLIPS["10230015"].description).toContain("ゆうパケット");
  });

  it("10230014 はクロネコゆうメール 10.8×7.3cm (小型)", () => {
    expect(YAMATO_SLIPS["10230014"].size).toEqual({
      width_mm: 108,
      height_mm: 73,
    });
    expect(YAMATO_SLIPS["10230014"].description).toContain("ゆうメール");
  });

  it("全プリセットで gap_mm は 2", () => {
    for (const preset of Object.values(YAMATO_SLIPS)) {
      expect(preset.gap_mm).toBe(2);
    }
  });

  it("全プリセットで幅は108mm(WS-420Bの最大幅)を超えない", () => {
    for (const [key, preset] of Object.entries(YAMATO_SLIPS)) {
      expect(preset.size.width_mm, `slip ${key}`).toBeLessThanOrEqual(108);
    }
  });
});

describe("resolveSlipPreset()", () => {
  describe("既定プリセットの解決", () => {
    it("230 を解決すると 108×178mm が返る", () => {
      const result = resolveSlipPreset({ slip_type: "230" });
      expect(result.size).toEqual({ width_mm: 108, height_mm: 178 });
    });

    it("241 を解決すると 108×228mm が返る", () => {
      const result = resolveSlipPreset({ slip_type: "241" });
      expect(result.size).toEqual({ width_mm: 108, height_mm: 228 });
    });

    it("10230014 を解決すると小型 108×73mm が返る", () => {
      const result = resolveSlipPreset({ slip_type: "10230014" });
      expect(result.size).toEqual({ width_mm: 108, height_mm: 73 });
    });
  });

  describe("direction のオーバーライド", () => {
    it("明示的に direction=0 を渡すとそれが採用される", () => {
      const result = resolveSlipPreset({ slip_type: "230", direction: 0 });
      expect(result.direction).toBe(0);
    });

    it("direction 未指定ならプリセットのデフォルト(1)が使われる", () => {
      const result = resolveSlipPreset({ slip_type: "230" });
      expect(result.direction).toBe(1);
    });

    it("custom でも direction を継承できる", () => {
      const result = resolveSlipPreset({
        slip_type: "custom",
        custom_width_mm: 100,
        custom_height_mm: 150,
        direction: 0,
      });
      expect(result.direction).toBe(0);
    });
  });

  describe("custom サイズ", () => {
    it("custom サイズが指定されれば解決される", () => {
      const result = resolveSlipPreset({
        slip_type: "custom",
        custom_width_mm: 100,
        custom_height_mm: 150,
      });
      expect(result.size).toEqual({ width_mm: 100, height_mm: 150 });
      expect(result.description).toContain("100×150mm");
    });

    it("custom で width を省略するとエラー", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_height_mm: 150,
        })
      ).toThrow(/custom_width_mm or custom_height_mm is missing/);
    });

    it("custom で height を省略するとエラー", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_width_mm: 100,
        })
      ).toThrow(/custom_width_mm or custom_height_mm is missing/);
    });

    it("custom の width が 0 以下だとエラー", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_width_mm: 0,
          custom_height_mm: 150,
        })
      ).toThrow(/custom_width_mm must be between 1 and 108/);
    });

    it("custom の width が 108mm を超えるとエラー (WS-420B 最大幅)", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_width_mm: 110,
          custom_height_mm: 150,
        })
      ).toThrow(/custom_width_mm must be between 1 and 108/);
    });

    it("custom の height が 1778mm を超えるとエラー (WS-420B 最大長)", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_width_mm: 108,
          custom_height_mm: 2000,
        })
      ).toThrow(/custom_height_mm must be between 1 and 1778/);
    });

    it("custom の height が負でもエラー", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_width_mm: 100,
          custom_height_mm: -5,
        })
      ).toThrow(/custom_height_mm must be between 1 and 1778/);
    });

    it("custom の境界値 108mm と 1778mm はOK", () => {
      expect(() =>
        resolveSlipPreset({
          slip_type: "custom",
          custom_width_mm: 108,
          custom_height_mm: 1778,
        })
      ).not.toThrow();
    });
  });

  describe("不正なslip_type", () => {
    it("存在しない slip_type はエラー", () => {
      expect(() =>
        resolveSlipPreset({
          // @ts-expect-error 不正な値を意図的に渡す
          slip_type: "999999",
        })
      ).toThrow(/Unknown slip_type/);
    });

    it("エラーメッセージにサポート一覧が含まれる", () => {
      expect(() =>
        resolveSlipPreset({
          // @ts-expect-error
          slip_type: "INVALID",
        })
      ).toThrow(/Supported:/);
    });
  });
});

describe("listSupportedSlipTypes()", () => {
  it("7種(6プリセット + custom)を返す", () => {
    const types = listSupportedSlipTypes();
    expect(types).toHaveLength(7);
  });

  it("custom が含まれる", () => {
    const types = listSupportedSlipTypes();
    expect(types).toContain("custom");
  });

  it("ヤマト品番全てが含まれる", () => {
    const types = listSupportedSlipTypes();
    expect(types).toContain("230");
    expect(types).toContain("241");
    expect(types).toContain("203");
    expect(types).toContain("10230004");
    expect(types).toContain("10230015");
    expect(types).toContain("10230014");
  });
});

describe("getSlipTypesWithDescription()", () => {
  it("説明付きで 7件を返す", () => {
    const list = getSlipTypesWithDescription();
    expect(list).toHaveLength(7);
  });

  it("各エントリに slip_type と description がある", () => {
    const list = getSlipTypesWithDescription();
    for (const item of list) {
      expect(item).toHaveProperty("slip_type");
      expect(item).toHaveProperty("description");
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it("プリセット6種には size_mm がある", () => {
    const list = getSlipTypesWithDescription();
    const presetItems = list.filter((x) => x.slip_type !== "custom");
    for (const item of presetItems) {
      expect(item.size_mm).toBeDefined();
      expect(item.size_mm!.width).toBeGreaterThan(0);
      expect(item.size_mm!.height).toBeGreaterThan(0);
    }
  });

  it("custom エントリには size_mm がない", () => {
    const list = getSlipTypesWithDescription();
    const custom = list.find((x) => x.slip_type === "custom");
    expect(custom).toBeDefined();
    expect(custom!.size_mm).toBeUndefined();
  });

  it("description は具体的な情報を含む (ネコポス等のキーワード)", () => {
    const list = getSlipTypesWithDescription();
    const nekoposu = list.find((x) => x.slip_type === "10230004");
    expect(nekoposu!.description).toContain("ネコポス");
  });
});
