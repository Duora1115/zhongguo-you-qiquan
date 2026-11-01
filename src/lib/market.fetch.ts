import type { Contract, MarketSnapshot, Right, UnderlyingQuote } from "@/lib/market-types";
import { RATE, MULTIPLIER, UNDERLYINGS, underlyingMeta } from "@/lib/underlyings";
import { daysBetween, marketSession, priceModeOf, shanghaiParts } from "@/lib/session";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://stock.finance.sina.com.cn/",
};

const TTL_MS = 6_000;

let cache: { at: number; data: MarketSnapshot } | null = null;
let inflight: Promise<MarketSnapshot> | null = null;

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return out;
}

async function sina(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`行情源返回 ${res.status}`);
  const utf8 = res.headers.get("x-qiheng-charset") === "utf-8";
  return new TextDecoder(utf8 ? "utf-8" : "gbk").decode(await res.arrayBuffer());
}

function num(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fallbackMonths(now = new Date()): string[] {
  const { date } = shanghaiParts(now);
  const [yearText, monthText] = date.split("-");
  let year = Number(yearText);
  let month = Number(monthText);
  const found = new Set<string>();
  const add = (y: number, m: number) => found.add(String(y).slice(2) + String(m).padStart(2, "0"));
  add(year, month);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  add(nextYear, nextMonth);
  let guard = 0;
  let quarters = 0;
  while (quarters < 3 && guard < 18) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (month === 3 || month === 6 || month === 9 || month === 12) {
      add(year, month);
      quarters += 1;
    }
    guard += 1;
  }
  return [...found];
}

async function fetchMonths(): Promise<string[]> {
  try {
    const res = await fetch(
      "https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName?exchange=null&cate=50ETF",
      { headers: HEADERS, signal: AbortSignal.timeout(8_000) },
    );
    const json: unknown = await res.json();
    const list = (json as { result?: { data?: { contractMonth?: unknown } } })?.result?.data?.contractMonth;
    if (Array.isArray(list)) {
      const months = [
        ...new Set(
          list
            .map((item) => {
              if (typeof item !== "string") return "";
              const [year, month] = item.split("-");
              if (!year || !month) return "";
              return year.slice(2) + month.padStart(2, "0");
            })
            .filter(Boolean),
        ),
      ];
      if (months.length) return months;
    }
  } catch {
    /* use the calendar fallback */
  }
  return fallbackMonths();
}

function parseUnderlyings(raw: string): UnderlyingQuote[] {
  const quotes: UnderlyingQuote[] = [];
  const pattern = /hq_str_(?:sh|sz)(\d+)="([^"]*)"/g;
  for (const match of raw.matchAll(pattern)) {
    const meta = underlyingMeta(match[1]);
    if (!meta) continue;
    const fields = match[2].split(",");
    const price = num(fields[3]);
    const prevClose = num(fields[2]);
    const change = price - prevClose;
    quotes.push({
      code: meta.code,
      name: meta.name,
      full: meta.full,
      house: meta.house,
      exchange: meta.exchange,
      price,
      prevClose,
      open: num(fields[1]),
      high: num(fields[4]),
      low: num(fields[5]),
      change,
      changePct: prevClose > 0 ? (change / prevClose) * 100 : 0,
      date: fields[30] ?? "",
      time: fields[31] ?? "",
    });
  }
  return UNDERLYINGS.map((meta) => quotes.find((quote) => quote.code === meta.code)).filter(
    (quote): quote is UnderlyingQuote => Boolean(quote && quote.price > 0),
  );
}

function parseContract(code: string, body: string, today: string): Contract | null {
  const fields = body.split(",");
  if (fields.length < 47) return null;
  const underlying = fields[36] ?? "";
  if (!underlyingMeta(underlying)) return null;
  const expiry = fields[46] ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const dte = daysBetween(today, expiry);
  if (dte < 0) return null;
  const rightField = fields[45];
  const name = fields[37] ?? code;
  const right: Right | null =
    rightField === "C" || rightField === "P"
      ? rightField
      : name.includes("沽")
        ? "P"
        : name.includes("购")
          ? "C"
          : null;
  if (!right) return null;
  const strike = num(fields[7]);
  if (!(strike > 0)) return null;
  return {
    code,
    underlying,
    name,
    right,
    strike,
    expiry,
    dte,
    last: num(fields[2]),
    bid: num(fields[1]),
    ask: num(fields[3]),
    oi: num(fields[5]),
    volume: num(fields[41]),
    settle: num(fields[49]),
    prev: num(fields[8]),
    change: num(fields[50]),
    changePct: num(fields[6]),
  };
}

function parseQuotes(raw: string, today: string): Contract[] {
  const contracts: Contract[] = [];
  const pattern = /hq_str_CON_OP_(\d+)="([^"]*)"/g;
  for (const match of raw.matchAll(pattern)) {
    const contract = parseContract(match[1], match[2], today);
    if (contract) contracts.push(contract);
  }
  return contracts;
}

async function fetchAll(): Promise<MarketSnapshot> {
  const today = shanghaiParts().date;
  const months = await fetchMonths();
  const listJobs: string[] = [];
  for (const underlying of UNDERLYINGS) {
    for (const month of months) {
      listJobs.push(`https://hq.sinajs.cn/list=OP_UP_${underlying.code}${month}`);
      listJobs.push(`https://hq.sinajs.cn/list=OP_DOWN_${underlying.code}${month}`);
    }
  }
  const etfUrl =
    "https://hq.sinajs.cn/list=" + UNDERLYINGS.map((item) => `${item.market}${item.code}`).join(",");
  const [etfRaw, lists] = await Promise.all([
    sina(etfUrl),
    pool(listJobs, 10, (url) => sina(url).catch(() => "")),
  ]);
  const codes = [
    ...new Set(lists.flatMap((body) => [...body.matchAll(/CON_OP_(\d+)/g)].map((match) => match[1]))),
  ];
  if (!codes.length) throw new Error("没有取到期权合约");
  const chunks: string[][] = [];
  for (let index = 0; index < codes.length; index += 40) chunks.push(codes.slice(index, index + 40));
  const quoteBodies = await pool(chunks, 8, (chunk) =>
    sina("https://hq.sinajs.cn/list=" + chunk.map((code) => `CON_OP_${code}`).join(",")).catch(() => ""),
  );
  const contracts = quoteBodies.flatMap((body) => parseQuotes(body, today));
  const underlyings = parseUnderlyings(etfRaw);
  if (!underlyings.length || !contracts.length) throw new Error("行情字段解析失败");
  let session = marketSession();
  const quoteDate = underlyings.find((item) => item.date)?.date || today;
  if (session !== "closed" && quoteDate && quoteDate < today) session = "closed";
  const quoteTime = underlyings.find((item) => item.time)?.time || "";
  return {
    asOf: new Date().toISOString(),
    session,
    priceMode: priceModeOf(session),
    quoteDate,
    quoteTime,
    rate: RATE,
    multiplier: MULTIPLIER,
    underlyings,
    contracts,
    source: "新浪财经",
  };
}

export function loadMarket(force = false): Promise<MarketSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data);
  if (!force && inflight) return inflight;
  inflight = fetchAll()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
