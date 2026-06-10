import { lazy, Suspense } from "react";

const AiChatPanel = lazy(() => import("./AiChatPanel").then(m => ({ default: m.AiChatPanel })));

/** 右侧栏：仅 AI 对话，属性编辑放在主画布各模块内 */
export function RightDrawer() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center p-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    }>
      <AiChatPanel />
    </Suspense>
  );
}
