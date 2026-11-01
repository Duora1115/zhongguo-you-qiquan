import { memo, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { ChainStat } from "@/lib/book";
import { pct, strikePx } from "@/lib/format";
import type { Contract } from "@/lib/market-types";
import type { ChainMode } from "@/lib/strategies";

export type ChainRow = {
  strike: number;
  call?: Contract;
  put?: Contract;
  callStat?: ChainStat;
  putStat?: ChainStat;
  atm: boolean;
};

type Held = { side: "buy" | "sell"; qty: number } | null;

export type ChainFilter = "all" | "call" | "put";

type Props = {
  rows: ChainRow[];
  expiries: { id: string; label: string }[];
  expiry: string;
  onExpiry: (expiry: string) => void;
  held: (code: string) => Held;
  onPick: (code: string) => void;
  onStructure: (strike: number) => void;
  spot: number;
  filter: ChainFilter;
  onFilter: (filter: ChainFilter) => void;
  mode: ChainMode;
  ivLabel: string;
  scrollKey: string;
};

export const OptionChain = memo(function OptionChain(props: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef("");
  useEffect(() => {
    if (!props.rows.length) return;
    const root = scroller.current;
    const row = root?.querySelector<HTMLElement>("[data-atm='true']");
    if (!root || !row) return;
    const first = scrolled.current === "";
    if (!first && scrolled.current === props.scrollKey) return;
    scrolled.current = props.scrollKey;
    const top = Math.max(0, row.offsetTop - root.clientHeight / 2 + row.clientHeight / 2);
    root.scrollTo({ top, behavior: first ? "auto" : "smooth" });
  }, [props.scrollKey, props.rows.length]);

  const cross = props.rows.find((row) => row.strike >= props.spot)?.strike ?? props.rows.at(-1)?.strike;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2">
        {props.expiries.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onExpiry(item.id)}
            className={clsx(
              "shrink-0 rounded-full border px-3 py-2 text-sm transition-[scale,background-color,border-color,color] duration-150 ease-out active:scale-[0.96]",
              item.id === props.expiry ? "border-fg bg-surface text-fg" : "border-line bg-surface text-muted",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-2">
        <div className="flex gap-4 text-sm">
          {(
            [
              ["all", "全部"],
              ["call", "看涨"],
              ["put", "看跌"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => props.onFilter(id)}
              className={clsx(
                "min-h-11 transition-colors duration-150",
                props.filter === id ? "font-semibold text-fg" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="num text-xs text-muted">{props.ivLabel}</p>
      </div>
      <div ref={scroller} className="chain-scroll min-h-0 flex-1 select-none overflow-y-auto px-1 pb-[var(--drawer-peek,calc(5.75rem+env(safe-area-inset-bottom)))] lg:pb-2">
        {props.mode === "t" ? (
          <TQuote {...props} cross={cross} />
        ) : (
          <StructureQuote {...props} />
        )}
      </div>
    </section>
  );
});

function TQuote(props: Props & { cross?: number }) {
  const showCall = props.filter !== "put";
  const showPut = props.filter !== "call";
  return (
    <div>
      <div className="sticky top-0 z-10 grid grid-cols-[1fr_1fr_1fr_4.2rem_1fr_1fr_1fr] bg-bg px-1 py-1 text-[11px] text-muted">
        <span>{showCall ? "最新价" : ""}</span>
        <span className="text-center">{showCall ? "卖盘" : ""}</span>
        <span className="text-right">{showCall ? "买盘" : ""}</span>
        <span className="text-center">行权价</span>
        <span>{showPut ? "买盘" : ""}</span>
        <span className="text-center">{showPut ? "卖盘" : ""}</span>
        <span className="text-right">{showPut ? "最新价" : ""}</span>
      </div>
      {props.rows.map((row) => {
        const callHeld = row.call ? props.held(row.call.code) : null;
        const putHeld = row.put ? props.held(row.put.code) : null;
        return (
          <div key={row.strike} data-atm={row.atm ? "true" : "false"} className="relative">
            {row.strike === props.cross ? (
              <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg px-2 py-0.5 text-[11px] font-semibold text-bg">
                <span className="num">{props.spot.toFixed(3)}</span>
              </div>
            ) : null}
            <div
              className={clsx(
                "grid grid-cols-[1fr_1fr_1fr_4.2rem_1fr_1fr_1fr] items-stretch border-b border-line/70",
                row.atm && "bg-surface-2/80",
              )}
            >
              <SideCells contract={showCall ? row.call : undefined} held={callHeld} align="call" onPick={props.onPick} />
              <div className="flex items-center justify-center text-sm font-semibold">
                <span className="num">{strikePx(row.strike)}</span>
              </div>
              <SideCells contract={showPut ? row.put : undefined} held={putHeld} align="put" onPick={props.onPick} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SideCells(props: {
  contract?: Contract;
  held: Held;
  align: "call" | "put";
  onPick: (code: string) => void;
}) {
  if (!props.contract) {
    return (
      <div className="col-span-3 grid grid-cols-3">
        <span />
        <span />
        <span />
      </div>
    );
  }
  const contract = props.contract;
  const tone = contract.last > 0 && contract.change > 0 ? "text-up" : contract.last > 0 && contract.change < 0 ? "text-down" : "text-fg";
  const heldClass = props.held?.side === "buy" ? "bg-up/10" : props.held?.side === "sell" ? "bg-down/10" : "";
  const ring = props.held ? "rounded-md ring-1 ring-inset ring-fg" : "";
  const last = contract.last > 0 ? contract.last.toFixed(4) : "—";
  const bid = contract.bid > 0 ? contract.bid.toFixed(4) : "—";
  const ask = contract.ask > 0 ? contract.ask.toFixed(4) : "—";
  const cells =
    props.align === "call"
      ? [
          { name: "最新价", value: last, className: `text-left ${tone}` },
          { name: "卖盘", value: ask, className: "text-center text-fg" },
          { name: "买盘", value: bid, className: "text-right text-muted" },
        ]
      : [
          { name: "买盘", value: bid, className: "text-left text-muted" },
          { name: "卖盘", value: ask, className: "text-center text-fg" },
          { name: "最新价", value: last, className: `text-right ${tone}` },
        ];
  return (
    <button
      type="button"
      onClick={() => props.onPick(contract.code)}
      className={clsx(
        "col-span-3 grid min-h-12 grid-cols-3 rounded-md transition-[scale,background-color] duration-150 ease-out active:scale-[0.98]",
        heldClass,
        ring,
      )}
      aria-label={`${strikePx(contract.strike)} ${contract.right === "C" ? "认购" : "认沽"} ${props.held ? (props.held.side === "buy" ? "已买" : "已卖") : "加入"}`}
    >
      {cells.map((cell, index) => (
        <span key={cell.name} className={clsx("num block px-0.5 py-2 text-[11px] leading-tight", cell.className)}>
          {cell.value}
          {props.held && index === (props.align === "call" ? 0 : 2) ? (
            <span className={clsx("mt-0.5 block text-[10px]", props.held.side === "buy" ? "text-up" : "text-down")}>
              {props.held.side === "buy" ? "买" : "卖"}
              {props.held.qty}
            </span>
          ) : null}
        </span>
      ))}
    </button>
  );
}

type Pack = {
  key: string;
  strike: number;
  label: string;
  bid: number;
  ask: number;
  last: number;
  prev: number;
  atm: boolean;
  held: boolean;
};

function StructureQuote(props: Props) {
  const packs = structurePacks(props);
  return (
    <div>
      <div className="sticky top-0 z-10 grid grid-cols-[5.5rem_1fr_1fr_1fr_1fr_1fr] bg-bg px-2 py-1 text-[11px] text-muted">
        <span>行权价</span>
        <span>买盘</span>
        <span>卖盘</span>
        <span>最新价</span>
        <span className="text-right">涨跌额</span>
        <span className="text-right">涨跌幅</span>
      </div>
      {packs.map((pack) => {
        const change = pack.last - pack.prev;
        const changePct = pack.prev !== 0 ? (change / Math.abs(pack.prev)) * 100 : 0;
        const tone = change > 0 ? "text-up" : change < 0 ? "text-down" : "text-fg";
        return (
          <button
            key={pack.key}
            type="button"
            data-atm={pack.atm ? "true" : "false"}
            onClick={() => props.onStructure(pack.strike)}
            className={clsx(
              "grid min-h-12 w-full grid-cols-[5.5rem_1fr_1fr_1fr_1fr_1fr] items-center border-b border-line/70 px-2 py-2 text-left text-xs transition-[scale,background-color] duration-150 ease-out active:scale-[0.99]",
              pack.held && "ring-1 ring-inset ring-fg",
              pack.atm && "bg-surface-2/80",
            )}
          >
            <span className="num font-semibold">{pack.label}</span>
            <span className="num text-muted">{fmt(pack.bid)}</span>
            <span className="num">{fmt(pack.ask)}</span>
            <span className={clsx("num", tone)}>{fmt(pack.last)}</span>
            <span className={clsx("num text-right", tone)}>{signed(change)}</span>
            <span className={clsx("num text-right", tone)}>{pct(changePct)}</span>
          </button>
        );
      })}
      {packs.length === 0 ? <p className="px-3 py-8 text-sm text-muted">这个到期月档位不够搭这个策略。</p> : null}
    </div>
  );
}

function structurePacks(props: Props): Pack[] {
  if (props.mode === "straddle") {
    return props.rows.flatMap((row) => {
      if (!row.call || !row.put) return [];
      return [packOf(`${row.strike}`, row.strike, `${strikePx(row.strike)}/${strikePx(row.strike)}`, [row.call, row.put], [1, 1], row.atm, Boolean(props.held(row.call.code) && props.held(row.put.code)))];
    });
  }
  if (props.mode === "strangle") {
    return props.rows.flatMap((row, index) => {
      const put = props.rows[index - 1]?.put;
      const call = props.rows[index + 1]?.call;
      if (!put || !call) return [];
      return [packOf(`${put.strike}/${call.strike}`, row.strike, `${strikePx(put.strike)}/${strikePx(call.strike)}`, [put, call], [1, 1], row.atm, Boolean(props.held(put.code) && props.held(call.code)))];
    });
  }
  return props.rows.flatMap((row, index) => {
    const low = row.call;
    const high = props.rows[index + 2]?.call ?? props.rows[index + 1]?.call;
    if (!low || !high || high.strike === low.strike) return [];
    return [packOf(`${low.code}/${high.code}`, low.strike, `${strikePx(low.strike)}/${strikePx(high.strike)}`, [low, high], [1, -1], row.atm, Boolean(props.held(low.code) && props.held(high.code)))];
  });
}

function packOf(key: string, strike: number, label: string, contracts: Contract[], signs: number[], atm: boolean, held: boolean): Pack {
  let bid = 0;
  let ask = 0;
  let last = 0;
  let prev = 0;
  contracts.forEach((contract, index) => {
    const sign = signs[index] ?? 1;
    const mid = contract.bid > 0 && contract.ask > 0 ? (contract.bid + contract.ask) / 2 : contract.last || contract.prev;
    const b = contract.bid > 0 ? contract.bid : mid;
    const a = contract.ask > 0 ? contract.ask : mid;
    if (sign > 0) {
      bid += b;
      ask += a;
    } else {
      bid -= a;
      ask -= b;
    }
    last += sign * (contract.last || mid);
    prev += sign * (contract.prev || mid);
  });
  return { key, strike, label, bid, ask, last, prev, atm, held };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toFixed(4);
}

function signed(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const body = Math.abs(n).toFixed(4);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}
