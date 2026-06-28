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
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "zustand"],
          "tiptap-vendor": ["@tiptap/react", "@tiptap/starter-kit", "@tiptap/extension-placeholder"],
          "xyflow-vendor": ["@xyflow/react"],
          // docx/mammoth 移除：均经 dynamic import 加载，rollup 会自动各分独立 chunk
          //   （export-doc.ts 动态导入，MaterialModule 内 await import("mammoth")）
          // lucide-react 移除：原 `import * as` 全量打包 803KB，改用 icon-registry 显式注册后
          //   具名导入可 tree-shake，rollup 自动把共享图标提到 vendor chunk
        },
      },
    },
  },
});
