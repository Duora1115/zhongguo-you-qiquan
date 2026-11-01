import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { publicAppHost } from "@/lib/og/public-host";
import appCss from "../styles.css?url";

const APP_NAME = "中国有期权";

async function xBannerUrl(): Promise<string> {
  const fromEnv = publicAppHost(import.meta.env.VITE_PUBLIC_HOSTNAME);
  if (fromEnv) return `https://${fromEnv}/x-banner.jpg`;
  let raw = "";
  if (typeof window !== "undefined") raw = window.location.host;
  else if (import.meta.env.SSR) {
    const { requestHost } = await import("@/lib/og/share-meta.server");
    raw = requestHost();
  }
  const host = publicAppHost(raw);
  return host ? `https://${host}/x-banner.jpg` : "";
}

export const Route = createRootRoute({
  head: async () => {
    const xBanner = await xBannerUrl();
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: `${APP_NAME} · A股ETF期权策略` },
        { name: "description", content: "点选 ETF 期权腿，看实时行情、到期损益和当前理论收益曲线。" },
        { name: "theme-color", content: "#12110e" },
        ...(xBanner ? [{ property: "x:game:image", content: xBanner }] : []),
      ],
      links: [
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/__grok/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
    };
  },
  component: () => (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
