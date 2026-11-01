import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function stripNestedApk(outDir: string): Plugin {
  return {
    name: "strip-nested-apk",
    closeBundle() {
      for (const name of ["qiheng.apk", "中国有期权.apk"]) {
        rmSync(resolve(outDir, name), { force: true });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [react(), tailwindcss(), stripNestedApk(resolve(__dirname, "android/app/src/main/assets/www"))],
  resolve: {
    alias: [
      { find: "@/lib/market.functions", replacement: resolve(__dirname, "src/apk/market-stub.ts") },
      { find: "@", replacement: resolve(__dirname, "src") },
    ],
  },
  build: {
    outDir: "android/app/src/main/assets/www",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "apk/index.html"),
    },
  },
});
