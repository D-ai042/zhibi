import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { recordError } from "./lib/diagnostics";

// ★ 全局 JS 崩溃捕获
window.onerror = (msg, src, line, col, err) => {
  recordError("error", "runtime", String(msg), {
    src, line, col, stack: err?.stack,
  });
};

// ★ 未捕获 Promise 拒绝
window.onunhandledrejection = (e) => {
  recordError("error", "promise", "未捕获的 Promise 拒绝", {
    reason: String(e.reason),
    stack: e.reason?.stack,
  });
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
