/**
 * 统一确认/提示对话框工具。
 * EXE 模式走 Tauri dialog 插件，浏览器模式走原生 window.confirm/alert。
 * 解决 Tauri 2.x WebView2 拦截 window.confirm 导致 ACL 拒绝的问题。
 */
import { isTauri } from "./api";

export async function confirmDialog(message: string): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return await ask(message, { title: "确认", kind: "warning" });
  }
  return window.confirm(message);
}

export async function alertDialog(message: string): Promise<void> {
  if (isTauri()) {
    const { message: showMessage } = await import("@tauri-apps/plugin-dialog");
    await showMessage(message, { title: "提示", kind: "error" });
    return;
  }
  window.alert(message);
}
