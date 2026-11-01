import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Lock, LockOpen, Minus, Plus, RefreshCw, X } from "lucide-react";
import { analyzeBook, prepareStats, sampleBook } from "@/lib/book";
import { cny, expiryLabel, ivText, pct, signedCny, strikePx } from "@/lib/format";
import { isNativeShell, requestMarket } from "@/lib/market.request";
import type { DraftLeg, MarketSnapshot, Side } from "@/lib/market-types";
import { legKey } from "@/lib/market-types";
import { SESSION_LABEL } from "@/lib/session";
import {
  STRATEGIES,
  TEMPLATES,
  buildStrategy,
  contractMark,
  listExpiries,
  seedStarter,
  templateById,
  type StrategyId,
  type TemplateId,
} from "@/lib/strategies";
import { MULTIPLIER } from "@/lib/underlyings";
import { OptionChain, type ChainFilter, type ChainRow } from "@/components/option-chain";
import { PayoffChart } from "@/components/payoff-chart";

function useFrameNumber(value: number, commit: (next: number) => void) {
  const [live, setLive] = useState(value);
  const frame = useRef(0);
  useEffect(() => {
    setLive(value);
  }, [value]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const set = useCallback(
    (next: number) => {
      setLive(next);
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => commit(next));
    },
    [commit],
  );
  return [live, set] as const;
}

const STORAGE_KEY = "qiheng-book-v1";

function InstallPack() {
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);
  if (isNativeShell()) return null;
  if (ios) {
    return (
      <a
        href="?install=1&platform=ios"
        className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-xs"
      >
        添加到主屏幕
      </a>
    );
  }
  return (
    <a
      href="/中国有期权.apk"
      download="中国有期权.apk"
      className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-xs"
    >
      安装包
    </a>
  );
}

type SavedBook = {
  underlying: string;
  expiry: string | null;
  legs: DraftLeg[];
  locked: boolean;
  entries: Record<string, number>;
  template?: TemplateId;
};

type Initial = { ok: true; market: MarketSnapshot } | { ok: false; message: string };
type Sheet = "bar" | "legs" | "chart";

function marksFor(legs: DraftLeg[], market: MarketSnapshot): Record<string, number> {
  const entries: Record<string, number> = {};
  for (const leg of legs) {
    if (leg.kind === "stock") {
      entries[legKey(leg)] = market.underlyings.find((item) => item.code === leg.underlying)?.price ?? 0;
    } else {
      const contract = market.contracts.find((item) => item.code === leg.code);
      entries[legKey(leg)] = contract ? contractMark(contract, market.priceMode) : 0;
    }
  }
  return entries;
}

function addBuy(legs: DraftLeg[], code: string): DraftLeg[] {
  const index = legs.findIndex((leg) => leg.kind === "option" && leg.code === code);
  if (index < 0) return [...legs, { kind: "option", code, side: "buy", qty: 1 }];
  return legs.map((leg, cursor) =>
    cursor === index && leg.kind === "option" ? { ...leg, qty: Math.min(99, leg.qty + 1) } : leg,
  );
}

export function Desk({ initial }: { initial: Initial }) {
  const [market, setMarket] = useState<MarketSnapshot | null>(initial.ok ? initial.market : null);
  const [error, setError] = useState<string | null>(initial.ok ? null : initial.message);
  const [refreshing, setRefreshing] = useState(false);
  const [underlying, setUnderlying] = useState("510050");
  const [expiryPick, setExpiryPick] = useState<string | null>(null);
  const [legs, setLegs] = useState<DraftLeg[]>(() => (initial.ok ? seedStarter(initial.market, "510050") : []));
  const [locked, setLocked] = useState(false);
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [advance, setAdvance] = useState(0);
  const [ivShock, setIvShock] = useState(0);
  const [scenario, setScenario] = useState<number | null>(null);
  const [activeStrategy, setActiveStrategy] = useState<StrategyId | null>("long-call");
  const [templateId, setTemplateId] = useState<TemplateId>("single");
  const [sheet, setSheet] = useState<Sheet>("bar");
  const [dragging, setDragging] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const [filter, setFilter] = useState<ChainFilter>("all");
  const [layers, setLayers] = useState({ expiry: true, now: true, be: true });
  const [notice, setNotice] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [advanceLive, setAdvanceLive] = useFrameNumber(advance, setAdvance);
  const [ivLive, setIvLive] = useFrameNumber(ivShock, setIvShock);
  const pickRef = useRef<(code: string) => void>(() => {});
  const structureRef = useRef<(strike: number) => void>(() => {});
  const heldRef = useRef<(code: string) => { side: "buy" | "sell"; qty: number } | null>(() => null);
  const drawerRef = useRef<HTMLElement>(null);
  const handleObserver = useRef<ResizeObserver | null>(null);
  const dragRef = useRef<{ y: number; shown: number; moved: boolean; vy: number; lastY: number; lastT: number } | null>(null);
  const shownRef = useRef(0);
  const dragEpoch = useRef(0);
  const [peek, setPeek] = useState<number | null>(null);
  const onPick = useCallback((code: string) => pickRef.current(code), []);
  const onStructure = useCallback((strike: number) => structureRef.current(strike), []);
  const onHeld = useCallback((code: string) => heldRef.current(code), []);
  const bindHandle = useCallback((node: HTMLDivElement | null) => {
    handleObserver.current?.disconnect();
    handleObserver.current = null;
    if (!node) return;
    const measure = () => setPeek(Math.ceil(node.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    handleObserver.current = observer;
  }, []);

  useEffect(() => () => handleObserver.current?.disconnect(), []);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as SavedBook;
        if (saved.underlying) setUnderlying(saved.underlying);
        setExpiryPick(saved.expiry ?? null);
        if (Array.isArray(saved.legs)) setLegs(saved.legs);
        setLocked(Boolean(saved.locked));
        setEntries(saved.entries ?? {});
        setTemplateId(saved.template ?? "custom");
        setActiveStrategy(null);
        setSheet("bar");
      } catch {
        /* keep the seeded book */
      }
    }
    setStoreReady(true);
  }, []);

  useEffect(() => {
    if (!storeReady) return;
    const payload: SavedBook = { underlying, expiry: expiryPick, legs, locked, entries, template: templateId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [storeReady, underlying, expiryPick, legs, locked, entries, templateId]);

  useEffect(() => {
    let stop = false;
    const pull = async (force: boolean) => {
      try {
        const next = await requestMarket(force);
        if (stop) return;
        setMarket(next);
        setError(null);
      } catch (reason) {
        if (!stop) setError(reason instanceof Error ? reason.message : "行情刷新失败");
      }
    };
    if (!initial.ok) void pull(true);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void pull(false);
    }, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [initial.ok]);

  const quote = market?.underlyings.find((item) => item.code === underlying) ?? market?.underlyings[0];
  const focus = quote?.code ?? underlying;
  const expiries = useMemo(
    () => (market ? listExpiries(market.contracts, focus) : []),
    [market, focus],
  );
  const expiry = expiries.includes(expiryPick ?? "") ? (expiryPick as string) : (expiries[0] ?? "");

  const neededKey = useMemo(() => {
    const codes = new Set<string>([focus]);
    if (!market) return focus;
    for (const leg of legs) {
      if (leg.kind === "stock") codes.add(leg.underlying);
      else {
        const contract = market.contracts.find((item) => item.code === leg.code);
        if (contract) codes.add(contract.underlying);
      }
    }
    return [...codes].sort().join(",");
  }, [market, legs, focus]);

  const prep = useMemo(() => {
    if (!market) return null;
    const codes = new Set(neededKey.split(",").filter(Boolean));
    const spots = new Map(market.underlyings.map((item) => [item.code, item.price]));
    return prepareStats(
      market.contracts.filter((contract) => codes.has(contract.underlying)),
      spots,
      market.rate,
      market.priceMode,
    );
  }, [market, neededKey]);

  const analysis = useMemo(() => {
    if (!market || !prep) return null;
    return analyzeBook({
      market,
      focus,
      legs,
      entries: locked ? entries : null,
      advance,
      ivShock: ivShock / 100,
      scenario: null,
      prep,
    });
  }, [market, prep, focus, legs, entries, locked, advance, ivShock]);

  function commit(next: DraftLeg[], strategy: StrategyId | null) {
    setLegs(next);
    setActiveStrategy(strategy);
    setAdvance(0);
    if (locked && market) {
      setEntries((prev) => {
        const marks = marksFor(next, market);
        const kept: Record<string, number> = {};
        for (const leg of next) {
          const key = legKey(leg);
          kept[key] = prev[key] ?? marks[key];
        }
        return kept;
      });
    }
  }

  function applyTemplate(id: TemplateId, strike?: number) {
    if (!market) return;
    const tpl = templateById(id);
    setPicker(false);
    setFilter("all");
    if (!tpl.strategy) {
      setTemplateId(id);
      if (id === "single") commit([], null);
      setNotice(null);
      setSheet(id === "custom" && legs.length ? "legs" : "bar");
      return;
    }
    if (!expiry) return;
    const anchor = strike ?? market.underlyings.find((item) => item.code === focus)?.price ?? 0;
    const built = buildStrategy(tpl.strategy, market.contracts, focus, expiry, anchor);
    if ("error" in built) {
      setNotice(built.error);
      setSheet("legs");
      return;
    }
    setTemplateId(id);
    setNotice(null);
    setScenario(null);
    commit(built.legs, tpl.strategy);
    setSheet("chart");
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const next = await requestMarket(true);
      setMarket(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "行情刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  function toggleLock() {
    if (!market) return;
    if (locked) {
      setLocked(false);
      setEntries({});
      return;
    }
    setEntries(marksFor(legs, market));
    setLocked(true);
  }

  function patch(next: DraftLeg[], keepStrategy: boolean) {
    commit(next, keepStrategy ? activeStrategy : null);
    if (!keepStrategy) setTemplateId("custom");
  }

  const rows: ChainRow[] = useMemo(() => {
    if (!market || !expiry || !prep) return [];
    const group = market.contracts.filter((contract) => contract.underlying === focus && contract.expiry === expiry);
    const strikes = [...new Set(group.map((contract) => contract.strike))].sort((a, b) => a - b);
    const spot = quote?.price ?? 0;
    let atm = strikes[0] ?? 0;
    for (const strike of strikes) if (Math.abs(strike - spot) < Math.abs(atm - spot)) atm = strike;
    return strikes.map((strike) => {
      const call = group.find((contract) => contract.right === "C" && contract.strike === strike);
      const put = group.find((contract) => contract.right === "P" && contract.strike === strike);
      return {
        strike,
        call,
        put,
        callStat: call ? prep.stats.get(call.code) : undefined,
        putStat: put ? prep.stats.get(put.code) : undefined,
        atm: strike === atm,
      };
    });
  }, [market, expiry, focus, prep, quote?.price]);

  const template = templateById(templateId);
  pickRef.current = (code) => {
    const contract = market?.contracts.find((item) => item.code === code);
    if (template.strategy && template.mode === "t" && contract) {
      applyTemplate(templateId, contract.strike);
      return;
    }
    setNotice(null);
    const staySingle = templateId === "single" && legs.length === 0;
    if (!staySingle) setTemplateId("custom");
    commit(addBuy(legs, code), null);
    setSheet((prev) => (prev === "bar" ? "legs" : prev));
  };
  structureRef.current = (strike) => applyTemplate(templateId, strike);
  heldRef.current = (code) => {
    const leg = legs.find((item) => item.kind === "option" && item.code === code);
    return leg && leg.kind === "option" ? { side: leg.side, qty: leg.qty } : null;
  };

  function onDrawerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (window.matchMedia("(min-width: 64rem)").matches) return;
    dragEpoch.current += 1;
    event.currentTarget.setPointerCapture(event.pointerId);
    const height = drawerRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.78;
    const peek = event.currentTarget.getBoundingClientRect().height;
    const shown = sheet === "bar" ? peek : height;
    shownRef.current = shown;
    dragRef.current = { y: event.clientY, shown, moved: false, vy: 0, lastY: event.clientY, lastT: performance.now() };
    setDragging(true);
    setDragY(shown);
  }

  function onDrawerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = drag.y - event.clientY;
    if (Math.abs(dy) > 6) drag.moved = true;
    const now = performance.now();
    drag.vy = (drag.lastY - event.clientY) / Math.max(8, now - drag.lastT);
    drag.lastY = event.clientY;
    drag.lastT = now;
    const height = drawerRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.78;
    let shown = drag.shown + dy;
    const min = 88;
    if (shown < min) shown = min + (shown - min) * 0.28;
    if (shown > height) shown = height + (shown - height) * 0.28;
    shownRef.current = shown;
    setDragY(shown);
  }

  function onDrawerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const height = drawerRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.78;
    const shown = shownRef.current;
    let next: Sheet = "bar";
    if (!drag.moved) next = sheet === "bar" ? "chart" : "bar";
    else if (drag.vy > 0.35) next = "chart";
    else if (drag.vy < -0.35) next = "bar";
    else next = shown > height * 0.42 ? "chart" : "bar";
    setSheet(next);
    setDragging(false);
    const epoch = dragEpoch.current;
    requestAnimationFrame(() => {
      if (dragEpoch.current !== epoch) return;
      setDragY(null);
    });
  }

  if (!market || !analysis || !quote) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
        <p className="text-2xl font-semibold">中国有期权</p>
        <p className="text-sm text-muted">{error ?? "正在同步上交所、深交所 ETF 期权行情。"}</p>
        <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-md bg-gold px-4 text-bg">
          重新获取
        </button>
        <InstallPack />
      </main>
    );
  }

  const cursor = scenario ?? analysis.spot;
  const at = sampleBook(analysis.points, cursor);
  const baseIvPct = (analysis.atmIv ?? 0.2) * 100;
  const ivPct = baseIvPct + ivLive;
  const when = shiftQuote(market.quoteDate, Math.min(advanceLive, analysis.primaryDte));
  const combo = comboQuote(legs, market);
  const emPct =
    analysis.emHigh != null && analysis.emLow != null && analysis.spot > 0
      ? ((analysis.emHigh - analysis.emLow) / 2 / analysis.spot) * 100
      : null;
  const title = template.id === "custom" ? `自定义策略(${legs.length})` : template.name;
  const blurb = STRATEGIES.find((item) => item.id === activeStrategy)?.blurb;
  const profit = limitText(analysis.maxProfit, "profit");
  const loss = limitText(analysis.maxLoss, "loss");

  return (
    <main
      className="flex h-dvh flex-col overflow-hidden bg-bg text-fg"
      style={peek == null ? undefined : ({ "--drawer-peek": `${peek}px` } as React.CSSProperties)}
    >
      <header className="z-20 shrink-0 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 md:px-6">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">中国有期权</h1>
            <p className="truncate text-xs text-muted">
              {SESSION_LABEL[market.session]} · {market.quoteDate.slice(5)} {market.quoteTime.slice(0, 5)}
            </p>
          </div>
          <InstallPack />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-surface"
            aria-label="刷新行情"
          >
            <RefreshCw className={clsx("size-4", refreshing && "animate-spin")} />
          </button>
        </div>
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-3 pb-2 md:px-6">
          {market.underlyings.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => {
                setUnderlying(item.code);
                setScenario(null);
              }}
              className={clsx(
                "min-h-11 shrink-0 rounded-lg border px-3 py-1.5 text-left transition-[scale,border-color,background-color,color] duration-150 ease-out active:scale-[0.96]",
                item.code === focus ? "border-fg bg-surface" : "border-transparent text-muted",
              )}
            >
              <span className="block text-xs">
                {item.name}
                <span className="ml-1 text-muted">{item.code}</span>
              </span>
              <span className="num text-sm font-semibold">{item.price.toFixed(3)}</span>
              <span className={clsx("num ml-2 text-xs", item.change > 0 ? "text-up" : item.change < 0 ? "text-down" : "text-muted")}>
                {item.change > 0 ? "↑" : item.change < 0 ? "↓" : ""}
                {pct(item.changePct)}
              </span>
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col lg:grid lg:grid-cols-12 lg:gap-4 lg:px-6">
        <div className="min-h-0 flex-1 lg:col-span-7">
          {error ? <p className="mx-3 mt-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-gold">{error}</p> : null}
          <OptionChain
            rows={rows}
            expiries={expiries.map((id) => {
              const sample = market.contracts.find((contract) => contract.underlying === focus && contract.expiry === id);
              return { id, label: sample ? expiryLabel(id, sample.dte) : id };
            })}
            expiry={expiry}
            onExpiry={setExpiryPick}
            held={onHeld}
            onPick={onPick}
            onStructure={onStructure}
            spot={quote.price}
            filter={filter}
            onFilter={setFilter}
            mode={template.mode}
            scrollKey={`${focus}:${expiry}:${template.mode}`}
            ivLabel={analysis.atmIv == null ? "—" : `${ivText(analysis.atmIv)}${emPct != null ? ` (±${emPct.toFixed(2)}%)` : ""}`}
          />
        </div>

        <div className="max-lg:contents lg:col-span-5 lg:flex lg:min-h-0 lg:flex-col lg:py-3">
          <section
            ref={drawerRef}
            className={clsx(
              "pay-drawer flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line lg:rounded-lg lg:border",
              sheet !== "bar" && "open",
              dragging && "dragging",
            )}
            style={
              dragY == null
                ? undefined
                : { transform: `translate3d(0, calc(100% - ${dragY}px), 0)` }
            }
          >
            <div className="fold open drawer-body min-h-0">
              <div className="fold-inner flex max-h-[64dvh] flex-col lg:max-h-[calc(100dvh-6rem)]">
                <div className="drawer-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">{title}</h2>
                  <button
                    type="button"
                    className="min-h-11 text-sm text-muted"
                    onClick={() => {
                      const index = legs.findIndex((leg) => leg.kind === "stock" && leg.underlying === focus);
                      if (index >= 0) {
                        patch(
                          legs.map((leg, cursor) => (cursor === index ? { ...leg, qty: leg.qty + 1 } : leg)),
                          true,
                        );
                        return;
                      }
                      patch([...legs, { kind: "stock", underlying: focus, side: "buy", qty: 1 }], true);
                    }}
                  >
                    + 添加正股
                  </button>
                </div>
                {notice ? <p className="pb-2 text-xs text-gold">{notice}</p> : null}
                {legs.length === 0 ? (
                  <p className="pb-3 text-sm text-muted">在期权链上点一个价格，就会加进策略。左边是认购，右边是认沽。</p>
                ) : (
                  <ul className="space-y-2 pb-2">
                    {legs.map((leg) => (
                      <li key={legKey(leg)} className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="删除这条腿"
                          className="inline-flex size-9 shrink-0 items-center justify-center text-muted"
                          onClick={() => patch(legs.filter((item) => legKey(item) !== legKey(leg)), false)}
                        >
                          <X className="size-4" />
                        </button>
                        <p className="min-w-0 flex-1 truncate text-sm">{legSymbol(leg, market)}</p>
                        <button
                          type="button"
                          onClick={() =>
                            patch(
                              legs.map((item) =>
                                legKey(item) === legKey(leg)
                                  ? { ...item, side: (item.side === "buy" ? "sell" : "buy") as Side }
                                  : item,
                              ),
                              true,
                            )
                          }
                          className={clsx(
                            "min-h-9 shrink-0 rounded-md border px-2 text-xs font-medium",
                            leg.side === "buy" ? "border-up/50 text-up" : "border-down/50 text-down",
                          )}
                        >
                          {leg.side === "buy" ? "买入" : "卖出"}
                        </button>
                        <div className="flex shrink-0 items-center rounded-md border border-line">
                          <button
                            type="button"
                            aria-label="减少一张"
                            className="inline-flex size-9 items-center justify-center"
                            onClick={() =>
                              patch(
                                legs.flatMap((item) => {
                                  if (legKey(item) !== legKey(leg)) return [item];
                                  if (item.qty <= 1) return [];
                                  return [{ ...item, qty: item.qty - 1 }];
                                }),
                                true,
                              )
                            }
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="num w-5 text-center text-sm">{leg.qty}</span>
                          <button
                            type="button"
                            aria-label="增加一张"
                            className="inline-flex size-9 items-center justify-center"
                            onClick={() =>
                              patch(
                                legs.map((item) =>
                                  legKey(item) === legKey(leg) ? { ...item, qty: Math.min(99, item.qty + 1) } : item,
                                ),
                                true,
                              )
                            }
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {combo ? (
                  <div className="pb-3">
                    <p className="text-xs text-muted">
                      组合中间价{" "}
                      <span className="num text-base font-semibold text-fg">{quotePx(combo.mid)}</span>{" "}
                      <span className={clsx("num", combo.change > 0 ? "text-up" : combo.change < 0 ? "text-down" : "text-muted")}>
                        {signed(combo.change)} {pct(combo.changePct)}
                      </span>
                    </p>
                    <div className="mt-2 flex h-8 overflow-hidden rounded text-xs">
                      <div className="flex flex-1 items-center bg-up/20 px-2 text-up">
                        <span className="mr-1 rounded bg-up px-1 text-[10px] font-semibold text-bg">B</span>
                        <span className="num">{quotePx(combo.bid)}</span>
                      </div>
                      <div className="flex flex-1 items-center justify-end bg-down/20 px-2 text-down">
                        <span className="num">{quotePx(combo.ask)}</span>
                        <span className="ml-1 rounded bg-down px-1 text-[10px] font-semibold text-bg">S</span>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="curve fold open max-lg:order-first shrink-0">
                  <div className="fold-inner">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">损益分析 · {market.priceMode === "settle" ? "结算价" : "中间价"}</h3>
                    <button type="button" onClick={toggleLock} className="inline-flex min-h-11 items-center gap-1 text-xs text-muted">
                      {locked ? <Lock className="size-3.5 text-gold" /> : <LockOpen className="size-3.5" />}
                      {locked ? "权利金已锁定" : "锁定权利金"}
                    </button>
                  </div>
                  {legs.length === 0 ? (
                    <p className="pb-4 text-sm text-muted">还没有腿。点上方策略，或直接在链上点认购、认沽。</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2 pb-3">
                        <Stat label="最大盈利" value={profit.text} tone={profit.tone} />
                        <Stat
                          label="盈亏平衡点"
                          value={analysis.breakevens.length ? analysis.breakevens.slice(0, 3).map((item) => item.toFixed(3)).join("/") : "—"}
                        />
                        <Stat label="最大亏损" value={loss.text} tone={loss.tone} />
                        <Stat label="盈利概率" value={analysis.pop == null ? "—" : `${(analysis.pop * 100).toFixed(2)}%`} />
                        <Stat label="Delta" value={(analysis.greeks.delta / MULTIPLIER).toFixed(4)} />
                        <Stat label="Theta" value={signedCny(analysis.greeks.theta)} tone={analysis.greeks.theta} />
                      </div>
                      <div className="pb-1 text-center">
                        <p className="text-[11px] text-muted">标的</p>
                        <p className="num text-sm font-semibold">{strikePx(analysis.spot)}</p>
                      </div>
                      <PayoffChart
                        points={analysis.points}
                        spot={analysis.spot}
                        scenario={cursor}
                        breakevens={analysis.breakevens}
                        emLow={analysis.emLow}
                        emHigh={analysis.emHigh}
                        legs={[]}
                        showExpiry={layers.expiry}
                        showNow={layers.now}
                        showBreakeven={layers.be}
                        showEm={false}
                        showProb={false}
                        showDelta={false}
                        heightClass="h-52 touch-none"
                        onScrub={setScenario}
                      />
                      <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                        <Stat label="标的价格" value={strikePx(cursor)} />
                        <Stat label="到期盈亏" value={signedCny(at.expiry)} tone={at.expiry} />
                        <Stat label="当前盈亏" value={signedCny(at.now)} tone={at.now} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[11px]">
                        <LegendChip on={layers.expiry} kind="expiry" label="到期日损益" onClick={() => setLayers((prev) => ({ ...prev, expiry: !prev.expiry }))} />
                        <LegendChip on={layers.now} kind="now" label="当前损益" onClick={() => setLayers((prev) => ({ ...prev, now: !prev.now }))} />
                        <LegendChip on={layers.be} kind="be" label="盈亏平衡点" onClick={() => setLayers((prev) => ({ ...prev, be: !prev.be }))} />
                      </div>
                      <div className="mt-3">
                        <span className="flex items-center justify-between text-xs text-muted">
                          <span>日期 {advanceLive <= 0 ? "今天" : when}</span>
                          <span className="flex gap-3">
                            <button type="button" className="min-h-11 text-gold" onClick={() => setAdvance(0)}>今天</button>
                            <button type="button" className="min-h-11 text-gold" onClick={() => setAdvance(analysis.primaryDte)}>到期日</button>
                          </span>
                        </span>
                        <input
                          aria-label="日期"
                          className="w-full"
                          type="range"
                          min={0}
                          max={Math.max(analysis.primaryDte, 0)}
                          step={1}
                          value={Math.min(advanceLive, analysis.primaryDte)}
                          onChange={(event) => setAdvanceLive(Number(event.target.value))}
                        />
                      </div>
                      <div>
                        <span className="flex items-center justify-between text-xs text-muted">
                          <span>隐波 {ivPct.toFixed(0)}%</span>
                          <button type="button" className="min-h-11 text-gold" onClick={() => setIvShock(0)}>
                            重置 {baseIvPct.toFixed(0)}%
                          </button>
                        </span>
                        <input
                          aria-label="隐波"
                          className="w-full"
                          type="range"
                          min={Math.max(1, Math.round(baseIvPct - 15))}
                          max={Math.max(Math.round(baseIvPct + 25), Math.round(baseIvPct - 15) + 2)}
                          step={1}
                          value={Math.min(Math.max(ivPct, 1), Math.round(baseIvPct + 25))}
                          onChange={(event) => setIvLive(Number(event.target.value) - baseIvPct)}
                        />
                      </div>
                      <p className="pb-3 text-[11px] leading-relaxed text-muted">
                        {blurb ?? "点图看某个价格上的盈亏。实线是到期，虚线是现在平仓。"}
                        {analysis.margin > 0 ? ` 保证金约 ${cny(analysis.margin)}。` : ""}
                        曲线按欧式 Black-Scholes 估算，未计手续费和滑点，不构成投资建议。
                      </p>
                    </>
                  )}
                  </div>
                </div>
              </div>
              </div>
            </div>
            <div
              ref={bindHandle}
              className="drawer-handle order-first shrink-0 border-b border-line bg-bg lg:order-last lg:border-b-0 lg:border-t"
              onPointerDown={onDrawerDown}
              onPointerMove={onDrawerMove}
              onPointerUp={onDrawerUp}
              onPointerCancel={onDrawerUp}
            >
              <div className="flex h-7 items-center justify-center lg:hidden" aria-hidden>
                <span className="h-1 w-10 rounded-full bg-white/30" />
              </div>
              <div className="flex gap-2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setSheet(sheet === "bar" ? "chart" : "bar")}
                className="min-h-11 rounded-full bg-gold px-5 text-sm font-semibold text-bg"
              >
                损益
              </button>
              {sheet === "bar" && combo ? (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setSheet("chart")}
                  className="min-h-11 min-w-0 flex-1 truncate rounded-md bg-surface-2 px-3 text-left text-sm"
                >
                  <span className="num font-semibold">{quotePx(combo.mid)}</span>
                  <span className="ml-2 text-xs text-muted">{legs.length} 腿</span>
                </button>
              ) : (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setPicker(true)}
                  className="min-h-11 flex-1 rounded-md bg-surface-2 text-sm"
                >
                  {template.name} ▾
                </button>
              )}
              {sheet === "bar" && combo ? (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setPicker(true)}
                  className="min-h-11 shrink-0 rounded-md bg-surface-2 px-3 text-sm"
                >
                  策略
                </button>
              ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>

      <div
        className={clsx(
          "fixed inset-0 z-40 flex items-end bg-black/60 transition-opacity duration-200 ease-out lg:items-center lg:justify-center",
          picker ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setPicker(false)}
        aria-hidden={!picker}
      >
        <div
          className={clsx(
            "max-h-[86vh] w-full overflow-y-auto rounded-t-2xl bg-surface px-4 pt-4 pb-6 transition-transform duration-200 ease-out lg:max-w-lg lg:rounded-2xl",
            picker ? "translate-y-0" : "translate-y-full",
          )}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-label="策略"
        >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line lg:hidden" />
            <h2 className="mb-3 text-base font-semibold">策略</h2>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.filter((item) => item.id !== "custom").map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyTemplate(item.id)}
                  className={clsx(
                    "min-h-16 rounded-lg border px-3 py-3 text-left transition-[scale,border-color,background-color] duration-150 ease-out active:scale-[0.98]",
                    templateId === item.id ? "border-fg bg-surface-2" : "border-line bg-bg",
                  )}
                >
                  <span className="block text-sm">{item.name}</span>
                  <span className="block text-[11px] text-muted">{item.en}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyTemplate("custom")}
                className={clsx(
                  "col-span-2 min-h-14 rounded-lg border px-3 py-3 text-left",
                  templateId === "custom" ? "border-fg bg-surface-2" : "border-line bg-bg",
                )}
              >
                <span className="block text-sm">自定义策略</span>
                <span className="block text-[11px] text-muted">Custom · 在期权链上逐腿点选</span>
              </button>
            </div>
          </div>
        </div>
    </main>
  );
}

function comboQuote(legs: DraftLeg[], market: MarketSnapshot): { mid: number; bid: number; ask: number; change: number; changePct: number } | null {
  if (!legs.length) return null;
  let mid = 0;
  let bid = 0;
  let ask = 0;
  let prev = 0;
  for (const leg of legs) {
    const sign = leg.side === "buy" ? 1 : -1;
    if (leg.kind === "stock") {
      const quote = market.underlyings.find((item) => item.code === leg.underlying);
      const price = quote?.price ?? 0;
      const before = quote?.prevClose ?? price;
      mid += sign * price * leg.qty;
      prev += sign * before * leg.qty;
      bid += sign * price * leg.qty;
      ask += sign * price * leg.qty;
      continue;
    }
    const contract = market.contracts.find((item) => item.code === leg.code);
    if (!contract) continue;
    const mark = contract.bid > 0 && contract.ask > 0 ? (contract.bid + contract.ask) / 2 : contractMark(contract, market.priceMode);
    const b = contract.bid > 0 ? contract.bid : mark;
    const a = contract.ask > 0 ? contract.ask : mark;
    mid += sign * mark * leg.qty;
    prev += sign * (contract.prev > 0 ? contract.prev : mark) * leg.qty;
    if (sign > 0) {
      bid += b * leg.qty;
      ask += a * leg.qty;
    } else {
      bid -= a * leg.qty;
      ask -= b * leg.qty;
    }
  }
  const change = mid - prev;
  return { mid, bid, ask, change, changePct: prev !== 0 ? (change / Math.abs(prev)) * 100 : 0 };
}

function legSymbol(leg: DraftLeg, market: MarketSnapshot): string {
  if (leg.kind === "stock") {
    const meta = market.underlyings.find((item) => item.code === leg.underlying);
    return `${meta?.name ?? leg.underlying} 正股`;
  }
  const contract = market.contracts.find((item) => item.code === leg.code);
  if (!contract) return leg.code;
  const meta = market.underlyings.find((item) => item.code === contract.underlying);
  const [year, month, day] = contract.expiry.split("-");
  return `${meta?.name ?? contract.underlying} ${year?.slice(2) ?? ""}${month ?? ""}${day ?? ""} ${contract.strike.toFixed(3)}${contract.right}`;
}

function limitText(value: number | "unlimited", kind: "profit" | "loss"): { text: string; tone: number } {
  if (value === "unlimited") return { text: "无限大", tone: kind === "profit" ? 1 : -1 };
  return { text: value > 0 ? `+${cny(value)}` : cny(value), tone: value };
}

function quotePx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toFixed(4);
}

function signed(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const body = Math.abs(n).toFixed(4);
  return n > 0 ? `+${body}` : `-${body}`;
}

function Stat(props: { label: string; value: string; tone?: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted">{props.label}</p>
      <p className={clsx("num truncate text-sm font-semibold", toneClass(props.tone))}>{props.value}</p>
    </div>
  );
}

function LegendChip(props: { on: boolean; kind: "expiry" | "now" | "be"; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} className={clsx("inline-flex min-h-11 items-center gap-1.5", props.on ? "text-fg" : "text-muted line-through")}>
      {props.kind === "be" ? (
        <i className={clsx("inline-block size-2 rounded-full", props.on ? "bg-info" : "bg-line")} />
      ) : (
        <i className={clsx("inline-block h-0.5 w-4", props.kind === "now" && "border-t border-dashed border-up bg-transparent", props.kind === "expiry" && (props.on ? "bg-down" : "bg-line"))} />
      )}
      {props.label}
    </button>
  );
}

function toneClass(tone?: number) {
  if (tone == null || tone === 0) return "text-fg";
  return tone > 0 ? "text-up" : "text-down";
}

function shiftQuote(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}
