import { useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import type { CustomModule } from "@/types";
import { renderMarkdown } from "@/lib/markdown";
import * as LucideIcons from "lucide-react";
import { uuid } from "@/lib/uuid";

/** 解析 AI 回复中的 JSON 代码块，提取模块定义 */
export function parseModuleFromResponse(content: string): {
    name?: string;
    icon?: string;
    body?: string;
} {
    // 尝试提取 ```json ... ``` 块
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            return {
                name: parsed.name,
                icon: parsed.icon,
                body: parsed.body || parsed.content,
            };
        } catch {
            // JSON 解析失败，回退
        }
    }

    // 尝试提取模块名: 标题行或 "模块名：xxx"
    const nameMatch = content.match(/模块名[：:]\s*(.+)/);
    const iconMatch = content.match(/图标[：:]\s*(.+)/);
    return {
        name: nameMatch?.[1]?.trim(),
        icon: iconMatch?.[1]?.trim(),
        body: content,
    };
}

interface Props {
    mod: CustomModule;
}

export function CustomModuleRenderer({ mod }: Props) {
    const { removeCustomModule, setActiveModule, customModules } = useAppStore();
    const IconComponent = useMemo(
        () => (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[mod.icon],
        [mod.icon]
    );

    const htmlContent = useMemo(() => renderMarkdown(mod.content), [mod.content]);

    const handleRefresh = async () => {
        // 在 AI 对话中追加一条请求刷新的消息，让 AI 重新生成模块内容
        const { addChatMessage } =
            useAppStore.getState();
        const refreshMsg: string =
            `请刷新模块「${mod.name}」，基于当前项目最新数据重新生成内容。`;
        addChatMessage({
            id: uuid(),
            role: "user",
            content: refreshMsg,
            created_at: new Date().toISOString(),
        });
        // 切换到 AI 对话让用户看到
    };

    return (
        <div className="flex h-full flex-col">
            {/* 模块头 */}
            <div className="flex items-center justify-between border-b bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                    {IconComponent && <IconComponent className="h-5 w-5 text-violet-600" />}
                    <h1 className="text-lg font-bold">{mod.name}</h1>
                    <span className="rounded bg-violet-50 px-2 py-0.5 text-[10px] text-violet-600">
                        AI 生成
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50"
                        title="让 AI 刷新此模块"
                    >
                        <LucideIcons.RefreshCw className="h-3.5 w-3.5" />
                        刷新
                    </button>
                    <button
                        type="button"
                        onClick={() => { if (window.confirm(`确定删除模块「${mod.label || mod.id}」？`)) removeCustomModule(mod.id); }}
                        className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        title="删除此模块"
                    >
                        <LucideIcons.Trash2 className="h-3.5 w-3.5" />
                        移除
                    </button>
                </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto">
                {/* 结构化数据渲染 */}
                {mod.data && Object.keys(mod.data).length > 0 && (
                    <div className="border-b bg-slate-50 p-4">
                        <div className="mb-2 flex flex-wrap gap-2">
                            {Object.entries(mod.data).map(([key, value]) => (
                                <span
                                    key={key}
                                    className="rounded-full bg-white px-3 py-1 text-xs shadow-sm"
                                >
                                    <span className="font-medium text-slate-500">{key}: </span>
                                    <span className="text-slate-800">{String(value)}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Markdown 内容 */}
                <div className="p-6">
                    <div
                        className="prose prose-slate max-w-none"
                        dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                </div>

                {/* 底部占位 — 显示其他自定义模块推荐 */}
                {customModules.length > 1 && (
                    <div className="border-t bg-slate-50 px-6 py-4">
                        <p className="mb-2 text-xs font-medium text-slate-500">其他自定义模块</p>
                        <div className="flex flex-wrap gap-2">
                            {customModules
                                .filter((m) => m.id !== mod.id)
                                .map((m) => {
                                    const OtherIcon = (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[
                                        m.icon
                                    ];
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => setActiveModule("custom", m.id)}
                                            className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs hover:bg-violet-50 hover:border-violet-200"
                                        >
                                            {OtherIcon && <OtherIcon className="h-3.5 w-3.5 text-violet-500" />}
                                            {m.name}
                                        </button>
                                    );
                                })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
