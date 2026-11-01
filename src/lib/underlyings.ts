export const RATE = 0.016;
export const MULTIPLIER = 10000;

export type UnderlyingMeta = {
  code: string;
  market: "sh" | "sz";
  name: string;
  full: string;
  house: string;
  exchange: string;
};

export const UNDERLYINGS: readonly UnderlyingMeta[] = [
  { code: "510050", market: "sh", name: "50ETF", full: "上证50ETF", house: "华夏", exchange: "上交所" },
  { code: "510300", market: "sh", name: "300ETF", full: "沪深300ETF", house: "华泰柏瑞", exchange: "上交所" },
  { code: "510500", market: "sh", name: "500ETF", full: "中证500ETF", house: "南方", exchange: "上交所" },
  { code: "588000", market: "sh", name: "科创50", full: "科创50ETF", house: "华夏", exchange: "上交所" },
  { code: "588080", market: "sh", name: "科创板50", full: "科创50ETF", house: "易方达", exchange: "上交所" },
  { code: "159915", market: "sz", name: "创业板", full: "创业板ETF", house: "易方达", exchange: "深交所" },
  { code: "159919", market: "sz", name: "深300", full: "沪深300ETF", house: "嘉实", exchange: "深交所" },
  { code: "159922", market: "sz", name: "深500", full: "中证500ETF", house: "嘉实", exchange: "深交所" },
  { code: "159901", market: "sz", name: "深100", full: "深证100ETF", house: "易方达", exchange: "深交所" },
];

export function underlyingMeta(code: string): UnderlyingMeta | undefined {
  return UNDERLYINGS.find((item) => item.code === code);
}
