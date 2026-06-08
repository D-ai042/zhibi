import { useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import { renderMarkdown } from "@/lib/markdown";
import * as LucideIcons from "lucide-react";

/** 动态页面 — AI 通过对话直接写入中间栏的内容 */
export function DynamicPageRenderer({ pageId }: { pageId: string }) {
    const { dynamicPages, removeDynamicPage, navigateTo, navItems } = useAppStore();
    const content = dynamicPages[pageId] ?? "";
    const navItem = navItems.find((n) => n.id === pageId);
    const IconComponent = navItem
        ? (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[navItem.icon]
        : null;

    const htmlContent = useMemo(() => {
        if (!content) return "<p style='color:#94a3b8;'>（空内容）</p>";
        return renderMarkdown(content);
    }, [content]);

    return (
        <div className="flex h-full flex-col">
            {/* 头 */}
            {navItem && (
                <div className="flex items-center justify-between border-b bg-white px-4 py-3">
                    <div className="flex items-center gap-2">
                        {IconComponent && <IconComponent className="h-5 w-5 text-violet-600" />}
                        <h1 className="text-lg font-bold">{navItem.label}</h1>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">
                            AI 动态页
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            removeDynamicPage(pageId);
                            removeNavItem(pageId);
                            navigateTo("overview");
                        }}
                        className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                        <LucideIcons.Trash2 className="h-3.5 w-3.5" />
                        移除
                    </button>
                </div>
            )}

            {/* 内容 */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-6">
                    {content ? (
                        <div
                            className="prose prose-slate max-w-none"
                            dangerouslySetInnerHTML={{ __html: htmlContent }}
                        />
                    ) : (
                        <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                            页面内容为空，请在 AI 对话中让 AI 写入内容
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** 从 store 中移除 navItem（需在这里 import，避免循环） */
function removeNavItem(id: string) {
    useAppStore.getState().removeNavItem(id);
}
