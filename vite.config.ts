import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "0.3.2"),
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
    host: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/baidu-api": {
        target: "https://aip.baidubce.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/baidu-api/, ""),
      },
      "/baidu-vop": {
        target: "https://vop.baidu.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/baidu-vop/, ""),
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
