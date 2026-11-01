import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BookPoint } from "@/lib/book";
import { pnlDomain } from "@/lib/chart-window";
import { cny, shares } from "@/lib/format";
import { clsx } from "clsx";

export type ChartLeg = {
  key: string;
  strike: number;
  label: string;
  side: "buy" | "sell";
  stack: number;
};

type Props = {
  points: BookPoint[];
  spot: number;
  scenario: number;
  breakevens: number[];
  emLow: number | null;
  emHigh: number | null;
  legs: ChartLeg[];
  showExpiry: boolean;
  showNow: boolean;
  showBreakeven: boolean;
  showEm: boolean;
  showProb: boolean;
  showDelta: boolean;
  onScrub: (price: number) => void;
  heightClass?: string;
};

type PlotPoint = BookPoint & { probShape: number };

function LegMark(props: {
  viewBox?: { x?: number; y?: number; height?: number };
  text: string;
  side: "buy" | "sell";
  stack: number;
}) {
  const x = props.viewBox?.x ?? 0;
  const top = props.viewBox?.y ?? 0;
  const y = top + 28 + props.stack * 22;
  const width = Math.max(76, props.text.length * 11);
  const fill = props.side === "buy" ? "var(--color-up)" : "var(--color-down)";
  return (
    <g transform={`translate(${x - width / 2}, ${y})`}>
      <rect width={width} height={18} rx={4} fill={fill} />
      <text
        x={width / 2}
        y={13}
        textAnchor="middle"
        fill="var(--color-bg)"
        fontSize={11}
        fontFamily="IBM Plex Sans, Noto Sans SC, sans-serif"
      >
        {props.text}
      </text>
    </g>
  );
}

export function PayoffChart(props: Props) {
  const [ready, setReady] = useState(false);
  const lastScrub = useRef<number | null>(null);
  useEffect(() => setReady(true), []);
  const [lo, hi] = pnlDomain(props.points, props.showExpiry, props.showNow);
  const data = useMemo<PlotPoint[]>(() => {
    const maxD = props.points.reduce((best, point) => Math.max(best, point.density), 0);
    const span = Math.max(hi - lo, 1);
    return props.points.map((point) => ({
      ...point,
      probShape: lo + (maxD > 0 ? point.density / maxD : 0) * span * 0.22,
    }));
  }, [props.points, lo, hi]);

  if (!ready) return <div className={props.heightClass ?? "h-56"} />;
  const scrubbed = Math.abs(props.scenario - props.spot) > 0.0005;
  const scrub = (price?: number) => {
    if (price == null || lastScrub.current === price) return;
    lastScrub.current = price;
    props.onScrub(price);
  };
  const scrubTouch = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch || props.points.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const span = Math.max(1, rect.width - 64);
    const t = Math.min(1, Math.max(0, (touch.clientX - rect.left - 56) / span));
    const lo = props.points[0].price;
    const hi = props.points[props.points.length - 1].price;
    scrub(lo + (hi - lo) * t);
  };
  return (
    <div className={clsx(props.heightClass ?? "h-56", "touch-none")} onTouchStart={scrubTouch} onTouchMove={scrubTouch}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          onMouseMove={(state) => {
            const price = state?.activePayload?.[0]?.payload?.price as number | undefined;
            scrub(price);
          }}
          onClick={(state) => {
            const price = state?.activePayload?.[0]?.payload?.price as number | undefined;
            scrub(price);
          }}
        >
          <XAxis
            dataKey="price"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => value.toFixed(2)}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            stroke="var(--color-line)"
            tickCount={6}
          />
          <YAxis
            yAxisId="pnl"
            domain={[lo, hi]}
            tickFormatter={(value: number) => cny(value)}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            stroke="var(--color-line)"
            width={56}
          />
          {props.showDelta ? (
            <YAxis
              yAxisId="delta"
              orientation="right"
              tickFormatter={(value: number) => shares(value)}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              stroke="var(--color-line)"
              width={48}
            />
          ) : null}
          <Tooltip cursor={{ stroke: "var(--color-gold)", strokeOpacity: 0.7 }} content={() => null} />
          <ReferenceLine yAxisId="pnl" y={0} stroke="var(--color-line)" />
          {props.showEm && props.emLow != null && props.emHigh != null ? (
            <ReferenceArea
              yAxisId="pnl"
              x1={props.emLow}
              x2={props.emHigh}
              fill="var(--color-gold)"
              fillOpacity={0.1}
              strokeOpacity={0}
            />
          ) : null}
          <ReferenceLine
            yAxisId="pnl"
            x={props.spot}
            stroke="var(--color-muted)"
            strokeDasharray="3 3"
          />
          {scrubbed ? <ReferenceLine yAxisId="pnl" x={props.scenario} stroke="var(--color-fg)" strokeDasharray="2 2" /> : null}
          {props.showBreakeven
            ? props.breakevens.slice(0, 3).map((price, index) => (
                <ReferenceDot
                  key={price}
                  yAxisId="pnl"
                  x={price}
                  y={0}
                  r={4}
                  fill="var(--color-info)"
                  stroke="var(--color-bg)"
                  label={{
                    value: price.toFixed(3),
                    position: index % 2 === 0 ? "top" : "bottom",
                    fill: "var(--color-info)",
                    fontSize: 10,
                  }}
                />
              ))
            : null}
          {props.legs.map((leg) => (
            <ReferenceLine
              key={leg.key}
              yAxisId="pnl"
              x={leg.strike}
              stroke="var(--color-line)"
              strokeDasharray="2 4"
              label={(mark: { viewBox?: { x?: number; y?: number } }) => (
                <LegMark viewBox={mark.viewBox} text={leg.label} side={leg.side} stack={leg.stack} />
              )}
            />
          ))}
          {props.showProb ? (
            <Area
              yAxisId="pnl"
              type="monotone"
              dataKey="probShape"
              stroke="var(--color-muted)"
              strokeWidth={1}
              fill="var(--color-muted)"
              fillOpacity={0.18}
              baseValue={lo}
              isAnimationActive={false}
            />
          ) : null}
          {props.showExpiry ? (
            <Area
              yAxisId="pnl"
              type="linear"
              dataKey="expiryNeg"
              baseValue={0}
              stroke="none"
              fill="var(--color-down)"
              fillOpacity={0.28}
              isAnimationActive={false}
            />
          ) : null}
          {props.showExpiry ? (
            <Line
              yAxisId="pnl"
              type="linear"
              dataKey="expiry"
              stroke="var(--color-down)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {props.showNow ? (
            <Line
              yAxisId="pnl"
              type="monotone"
              dataKey="now"
              stroke="var(--color-up)"
              strokeWidth={1.75}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {props.showDelta ? (
            <Line
              yAxisId="delta"
              type="monotone"
              dataKey="delta"
              stroke="var(--color-muted)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
