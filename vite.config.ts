import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";

const host = process.env.TAURI_DEV_HOST;

// Versión y fecha salen de las mismas fuentes que usa el release (package.json y CHANGELOG.md).
const fromRoot = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");
const appVersion = z.object({ version: z.string() }).parse(JSON.parse(fromRoot("package.json"))).version;
const releaseDate = fromRoot("CHANGELOG.md")
  .match(new RegExp(`^## \\[${appVersion.replaceAll(".", "\\.")}\\] - (\\d{4}-\\d{2}-\\d{2})`, "m"))?.[1]
  ?? "en desarrollo";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_RELEASE_DATE__: JSON.stringify(releaseDate),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
}));
