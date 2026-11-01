export type Session =
  | "auction"
  | "morning"
  | "lunch"
  | "afternoon"
  | "close-auction"
  | "closed";

export type Right = "C" | "P";
export type Side = "buy" | "sell";

export type Contract = {
  code: string;
  underlying: string;
  name: string;
  right: Right;
  strike: number;
  expiry: string;
  dte: number;
  last: number;
  bid: number;
  ask: number;
  oi: number;
  volume: number;
  settle: number;
  prev: number;
  change: number;
  changePct: number;
};

export type UnderlyingQuote = {
  code: string;
  name: string;
  full: string;
  house: string;
  exchange: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  time: string;
  date: string;
};

export type MarketSnapshot = {
  asOf: string;
  session: Session;
  priceMode: "last" | "settle";
  quoteDate: string;
  quoteTime: string;
  rate: number;
  multiplier: number;
  underlyings: UnderlyingQuote[];
  contracts: Contract[];
  source: string;
};

export type OptionLeg = {
  kind: "option";
  code: string;
  side: Side;
  qty: number;
};

export type StockLeg = {
  kind: "stock";
  underlying: string;
  side: Side;
  qty: number;
};

export type DraftLeg = OptionLeg | StockLeg;

export function legKey(leg: DraftLeg): string {
  return leg.kind === "option" ? `o:${leg.code}` : `s:${leg.underlying}`;
}
