import { useState, useCallback, useEffect, useRef } from "react";
import { X, Sparkles, Wand2, Expand, Shrink, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";

interface AiWritingDialogProps {
    selectedText: string;
    fullText: string;
    selectionStart: number;
    selectionEnd: number;
    onClose: () => void;
    onReplace: (newText: string) => void;
}

type Action = "continue" | "polish" | "expand" | "shrink";

const ACTION_LABEL: Record<Action, string> = {
    continue: "续写",
    polish: "润色",
    expand: "扩写",
    shrink: "精简",
};

const ACTION_PROMPT: Record<Action, string> = {
    continue: "【续写】先理解本章全文的剧情，然后续写选中文本之后的情节。续写内容必须与本章剧情和谐一致，不能冲突。只看选中文本的位置，写出接下来自然发展的故事。\n\n选中文本末尾（续写起点）：\n\n",
    polish: `【润色】你是资深文学编辑，专门给小说去AI味。你的工作是做减法，不是做加法。

对以下文本逐条处理：
1. 破折号「——」每千字最多保留2处，超出部分：句中换逗号，句末换句号，纯情绪破折号直接删除
2. 省略号「……」或「...」每千字最多保留1处，超出换句号
3. 「不是……而是……」句式全章最多保留2处，超出改为简单陈述或删除
4. 模糊词「仿佛」「似乎」「宛如」「好像」「犹如」每千字最多保留2处，超出直接删除修饰词
5. 「淡淡/微微/轻轻/缓缓/默默/静静」修饰「说/道/笑道/叹道」时，每千字最多保留2处，超出只保留「说」或「道」
6. 同一件事用不同说法重复描述两遍以上的，只留最直接的那一遍
7. 动作已经表达了情绪时，删掉后续的情绪解释文字（人已经摔杯子了就不写"他很愤怒"）
8. 对话已经传达了信息，就删掉对话后面画蛇添足的情绪总结
9. 感官描写（视觉/听觉/嗅觉/触觉）同时堆叠3种以上的，保留最核心的1-2种
10. 连续3句以上以同一人称开头的，合并或调整句式
11. 删除所有AI提示词痕迹——任何"根据""按照""依据""参考"起头的元叙述、任何对前文/前章/设定的复盘口吻——直接整句删除

铁律：不增加任何新内容、新描写、新情节、新对话。不改变角色名、情节走向。只做减法。

选中文本：

`,
    expand: "【扩写】丰富选中的文本，增加更多细节描写（感官、动作、环境、心理等），让场景更丰满具体。\n\n选中文本：\n\n",
    shrink: "【精简】保留核心信息，去除冗余修饰，将以下文本压缩到最短但仍然通顺。\n\n选中文本：\n\n",
};

export function AiWritingDialog({
    selectedText,
    fullText,
    selectionStart,
    selectionEnd,
    onClose,
    onReplace,
}: AiWritingDialogProps) {
    const { currentProject } = useAppStore();
    const [action, setAction] = useState<Action>("polish");
    const [prompt, setPrompt] = useState("");
    const [result, setResult] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const resultRef = useRef<HTMLTextAreaElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    // 初始位置：右下角
    const [pos, setPos] = useState({ x: Math.max(0, window.innerWidth - 360), y: Math.max(0, window.innerHeight - 350) });
    const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: Math.max(0, window.innerWidth - 360), origY: Math.max(0, window.innerHeight - 350) });

    // 需求1：弹窗弹出 → 关闭右侧抽屉
    useEffect(() => {
        useAppStore.getState().setDrawerOpen(false);
    }, []);

    // 需求3：按钮点击时不抢编辑器焦点（原生选中高亮保持可见）
    // 输入框、下拉框、结果编辑区正常交互，不需要额外处理

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        dragState.current.dragging = true;
        dragState.current.startX = e.clientX;
        dragState.current.startY = e.clientY;
        dragState.current.origX = pos.x;
        dragState.current.origY = pos.y;
        document.body.style.userSelect = "none";
    }, [pos]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragState.current.dragging) return;
            const dx = e.clientX - dragState.current.startX;
            const dy = e.clientY - dragState.current.startY;
            let nx = dragState.current.origX + dx;
            let ny = dragState.current.origY + dy;
            // 限制不超出视口
            nx = Math.max(0, Math.min(nx, window.innerWidth - 360));
            ny = Math.max(0, Math.min(ny, window.innerHeight - 320));
            setPos({ x: nx, y: ny });
        };
        const onUp = () => {
            if (dragState.current.dragging) {
                dragState.current.dragging = false;
                document.body.style.userSelect = "";
            }
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    }, []);

    // 生成
    const handleGenerate = useCallback(async () => {
        if (!currentProject) return;
        setLoading(true);
        setError("");

        // 检查 API 配置
        const store = useAppStore.getState();
        const hasApiKey = !!store.apiConfig?.has_api_key;

        if (!hasApiKey) {
            setError("⚠️ 未配置 API Key。请在「API 设置」中填入 API Key 后使用 AI 功能。");
            setLoading(false);
            return;
        }

        try {
            const pid = currentProject.id;

            // 加载项目上下文（角色、关系、世界观）
            let projectContextStr = "";
            try {
                const [allChars, allEdges, allTerms] = await Promise.all([
                    api.listCharacters(pid),
                    api.listRelationshipEdges(pid).catch(() => [] as any[]),
                    api.listWorldTerms(pid),
                ]);
                if (allChars.length > 0) {
                    projectContextStr += "【项目角色】\n";
                    for (const c of allChars) {
                        projectContextStr += `· ${c.name}${c.faction ? `（${c.faction}）` : ""}${c.personality ? `：${c.personality}` : ""}\n`;
                    }
                }
                if (allEdges.length > 0) {
                    const charMap = new Map(allChars.map(c => [c.id, c.name]));
                    projectContextStr += "\n【人物关系】\n";
                    for (const e of allEdges) {
                        const src = charMap.get(e.source_id) || "未知";
                        const tgt = charMap.get(e.target_id) || "未知";
                        projectContextStr += `· ${src} → ${tgt} [${e.relation_type}] 亲密度: ${e.strength}/10${e.is_secret ? " (秘密)" : ""}\n`;
                    }
                }
                if (allTerms.length > 0) {
                    projectContextStr += "\n【世界观设定】\n";
                    for (const t of allTerms.slice(0, 10)) {
                        projectContextStr += `· [${t.term_type}] ${t.title}：${(t.one_liner || "").slice(0, 80)}\n`;
                    }
                }
            } catch { /* 项目上下文加载失败不影响主流程 */ }

            let systemHint = ACTION_PROMPT[action] +
                (prompt.trim() ? `额外要求：${prompt}\n\n` : "");
            if (projectContextStr) {
                systemHint += `\n---\n以下为本项目已知设定，请确保生成内容与之保持一致：\n${projectContextStr}\n---\n`;
            }

            const req = {
                action: "chat",
                entity_type: "beats",
                entity_id: currentProject.id,
                extra: {
                    user_message: `请对以下文本进行「${ACTION_LABEL[action]}」：\n\n${selectedText}`,
                    context: "",
                    system_hint: systemHint,
                    history: [] as { role: string; content: string }[],
                },
            };

            const res = await api.aiComplete(req);

            if (res.content) {
                setResult(res.content);
            } else {
                setError(res.error || "生成失败");
            }
        } catch (e: any) {
            setError(e.message || "请求失败");
        } finally {
            setLoading(false);
        }
    }, [currentProject, action, prompt, selectedText]);

    // 插入（续写追加末尾，其他替换框选）
    const handleInsert = useCallback(() => {
        if (!result) return;
        const before = fullText.slice(0, selectionStart);
        const after = fullText.slice(selectionEnd);
        if (action === "continue") {
            // 续写：在选中的文字末尾追加
            onReplace(before + selectedText + "\n\n" + result + after);
        } else {
            // 润色/扩写/精简：替换选中的文字
            onReplace(before + result + after);
        }
        setResult("");
    }, [result, fullText, selectionStart, selectionEnd, selectedText, action, onReplace]);

    // Escape 键关闭
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    // 自动生成（切换 action 时）
    useEffect(() => {
        setResult("");
        setError("");
    }, [action]);

    return (
        <div className="fixed z-50" style={{ left: 0, top: 0, width: 0, height: 0 }}>
            <div
                ref={dialogRef}
                className="absolute flex w-[340px] flex-col rounded-xl border bg-white shadow-xl"
                style={{ left: pos.x, top: pos.y }}
                data-ai-dialog="true"
                onClick={e => e.stopPropagation()}
            >
                {/* 标题栏（拖拽手柄） */}
                <div
                    className="flex items-center justify-between rounded-t-xl border-b bg-slate-50 px-3 py-2 cursor-grab active:cursor-grabbing"
                    onMouseDown={handleMouseDown}
                >
                    <h3 className="text-xs font-semibold text-slate-600">AI 写作工具</h3>
                    <button onMouseDown={e => e.preventDefault()} onClick={onClose} className="rounded p-0.5 hover:bg-slate-200 text-slate-400">
                        <X size={14} />
                    </button>
                </div>

                {/* 操作按钮组 */}
                <div className="flex gap-1.5 border-b px-3 py-2">
                    {(Object.entries(ACTION_LABEL) as [Action, string][]).map(([key, label]) => (
                        <button
                            key={key}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => setAction(key)}
                            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${action === key
                                ? "bg-amber-500 text-white shadow-sm"
                                : "border bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                        >
                            {key === "continue" && <ArrowRight size={11} />}
                            {key === "polish" && <Sparkles size={11} />}
                            {key === "expand" && <Expand size={11} />}
                            {key === "shrink" && <Shrink size={11} />}
                            {label}
                        </button>
                    ))}
                </div>

                {/* 提示输入 */}
                <div className="px-3 py-1.5">
                    <input
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-amber-400"
                        placeholder="补充提示（可选）"
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !loading) handleGenerate(); }}
                    />
                </div>

                {/* 结果区域 */}
                <div className="px-3 pb-1 min-h-[100px] max-h-[200px] overflow-y-auto">
                    {error && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-600">
                            {error}
                        </div>
                    )}
                    {loading ? (
                        <div className="flex h-20 items-center justify-center text-xs text-slate-400">
                            <Sparkles className="mr-1.5 h-3.5 w-3.5 animate-pulse text-amber-500" />
                            AI 正在思考…
                        </div>
                    ) : result ? (
                        <textarea
                            ref={resultRef}
                            className="h-full min-h-[80px] w-full resize-none rounded-md border border-slate-200 bg-slate-50 p-2 text-xs leading-relaxed outline-none focus:border-amber-400"
                            value={result}
                            onChange={e => setResult(e.target.value)}
                        />
                    ) : (
                        <div className="flex h-20 items-center justify-center text-[11px] text-slate-400">
                            点击「生成」获取结果
                        </div>
                    )}
                </div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-1.5 border-t px-3 py-2">
                    <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={handleGenerate}
                        disabled={loading}
                        className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                    >
                        <Wand2 size={12} />
                        生成
                    </button>
                    <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={handleInsert}
                        disabled={!result}
                        className="flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1 text-[11px] text-white hover:bg-amber-600 disabled:opacity-40"
                    >
                        插入
                    </button>
                </div>
            </div>
        </div>
    );
}
