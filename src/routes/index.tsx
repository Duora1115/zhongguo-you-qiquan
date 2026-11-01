import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk";
import { getMarket } from "@/lib/market.functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const market = await getMarket({ data: { force: false } });
      return { ok: true as const, market };
    } catch (reason) {
      return { ok: false as const, message: reason instanceof Error ? reason.message : "行情获取失败" };
    }
  },
  pendingComponent: Pending,
  pendingMs: 150,
  component: Home,
});

function Pending() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-6">
      <p className="text-2xl font-semibold">中国有期权</p>
      <p className="text-sm text-muted">正在拉取 ETF 期权链和标的行情。</p>
    </main>
  );
}

function Home() {
  const initial = Route.useLoaderData();
  return <Desk initial={initial} />;
}
