import { useState, useEffect, useCallback } from "react";
import { BookMarked, Save, Shield, Palette, FileText, Sparkles, MessageCircle } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { getJSONSync, setJSONSync, setJSON } from "@/lib/storage";
import { confirmDialog, alertDialog } from "@/lib/confirm";
import { loadAllChapters } from "@/lib/chapter-store";
import type { StyleGuide, StoryBible } from "@/types";

type TabId = "style" | "rules" | "voices" | "summary";

export function StoryBibleModule() {
    const { currentProject } = useAppStore();
    const [activeTab, setActiveTab] = useState<TabId>("style");
    if (!currentProject) return <div className="flex h-full items-center justify-center text-sm text-slate-400">请先打开一个作品</div>;
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
                <BookMarked className="h-5 w-5 text-amber-600" />
                <span className="text-sm font-semibold">故事圣经</span>
                <div className="h-4 w-px bg-slate-200" />
                <span className="text-xs text-slate-400">这些规则每次 AI 写作都会加载，AI 不能违反</span>
            </div>
            <div className="flex border-b border-slate-200 bg-white">
                <TabButton active={activeTab === "style"} icon={<Palette className="h-4 w-4" />} label="风格指南" onClick={() => setActiveTab("style")} />
                <TabButton active={activeTab === "rules"} icon={<Shield className="h-4 w-4" />} label="故事铁则" onClick={() => setActiveTab("rules")} />
                <TabButton active={activeTab === "voices"} icon={<MessageCircle className="h-4 w-4" />} label="角色语言" onClick={() => setActiveTab("voices")} />
                <TabButton active={activeTab === "summary"} icon={<FileText className="h-4 w-4" />} label="上下文编辑器" onClick={() => setActiveTab("summary")} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activeTab === "style" && <StyleGuideEditor projectId={currentProject.id} />}
                {activeTab === "rules" && <BibleRulesEditor projectId={currentProject.id} />}
                {activeTab === "voices" && <CharacterVoiceEditor projectId={currentProject.id} />}
                {activeTab === "summary" && <ContextEditor projectId={currentProject.id} />}
            </div>
        </div>
    );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button"
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium transition-colors ${active ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
            onClick={onClick}>{icon}{label}
        </button>
    );
}

// ===== 从卷章树读取章节列表（供所有下拉框使用） =====
interface PlotSegment { id: string; project_id: string; type: "bright" | "dark"; title: string; characters: string; location: string; time: string; event: string; terms?: string; }
interface PlotChapter { id: string; volumeSegmentId: string; number: number; title: string; content: string; }
type ContextLayerKey = "p0" | "p1" | "p2" | "p3" | "p4";
function loadPlotChapters(pid: string): PlotChapter[] {
    return loadAllChapters(pid) as PlotChapter[];
}
function loadPlotSegments(pid: string): PlotSegment[] {
    return getJSONSync(`plot-segments-${pid}`, [] as PlotSegment[]);
}
/** 获取按卷分组、按 number 排序的章节选项列表 */
function getVolumeGroupedChapterOptions(pid: string): { value: string; label: string; volumeName: string }[] {
    const chapters = loadPlotChapters(pid);
    const segs = loadPlotSegments(pid);
    const bright = segs.filter(s => s.type === "bright");
    const volumeOrder = new Map<string, number>();
    bright.forEach((b, i) => { volumeOrder.set(b.id, i); });
    const sorted = [...chapters].sort((a, b) => {
        const oa = volumeOrder.get(a.volumeSegmentId) ?? 999;
        const ob = volumeOrder.get(b.volumeSegmentId) ?? 999;
        if (oa !== ob) return oa - ob;
        return a.number - b.number;
    });
    // 只显示卷存在的章节（过滤已删除的卷对应的残留数据）
    const validVolumeIds = new Set(bright.map(b => b.id));
    return sorted.filter(ch => validVolumeIds.has(ch.volumeSegmentId)).map(ch => {
        const vol = bright.find(b => b.id === ch.volumeSegmentId);
        return { value: ch.id, label: `第${ch.number}章「${ch.title || "未命名"}」`, volumeName: vol?.title || "" };
    });
}

// ===== 风格指南（3 个大框） =====

function StyleGuideEditor({ projectId }: { projectId: string }) {
    const [guide, setGuide] = useState<StyleGuide>({
        project_id: projectId, narrative_style: "", writing_tone: "", writing_rules: "", character_voices: "",
        updated_at: new Date().toISOString(), updated_by_chapter: 0,
    });
    const [saved, setSaved] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [selectedChapterForExtract, setSelectedChapterForExtract] = useState("");

    const extractableChapters = getVolumeGroupedChapterOptions(projectId);

    useEffect(() => {
        try {
            const p = getJSONSync(`novel-workbench-style-${projectId}`, null as StyleGuide | null);
            if (p) {
                setGuide({ project_id: projectId, narrative_style: p.narrative_style || "", writing_tone: p.writing_tone || "", writing_rules: p.writing_rules || "", character_voices: p.character_voices || "", updated_at: p.updated_at || new Date().toISOString(), updated_by_chapter: p.updated_by_chapter || 0 });
            }
        } catch { /* ignore */ }
    }, [projectId]);

    const handleSave = useCallback(() => {
        const updated = { ...guide, updated_at: new Date().toISOString() };
        setJSONSync(`novel-workbench-style-${projectId}`, updated);
        setJSON(`novel-workbench-style-${projectId}`, updated);
        setGuide(updated); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }, [guide, projectId]);

    const handleExtractFromChapters = useCallback(async () => {
        setExtracting(true);
        try {
            // 尝试从 localStorage 读取（浏览器模式）；回退到 API（Tauri 模式）
            let allChapters = loadAllChapters(projectId);
            let fullText = "";
            if (selectedChapterForExtract) {
                const target = allChapters.find((ch: any) => ch.id === selectedChapterForExtract);
                if (target?.content) fullText = target.content;
                if (!fullText) {
                    // 从 mock 或 API 读取章节内容
                    const mock = getJSONSync("novel-workbench-mock", {} as any);
                    if (mock && Object.keys(mock).length > 0) {
                        const cc = mock.chapterContents?.find((c: any) => c.chapter_id === selectedChapterForExtract);
                        if (cc) { try { fullText = JSON.parse(cc.body_json); } catch { fullText = (cc.body_html || "").replace(/<br>/g, "\n"); } }
                    }
                    if (!fullText) {
                        // Tauri 模式：通过 API 获取章节内容
                        const cc = await api.getChapterContent(selectedChapterForExtract);
                        if (cc) {
                            try { fullText = JSON.parse(cc.body_json); } catch { fullText = (cc.body_html || "").replace(/<br>/g, "\n"); }
                        }
                    }
                }
            } else {
                for (const ch of allChapters) { if (ch.content) fullText += "\n\n" + ch.content; }
                const mock = getJSONSync("novel-workbench-mock", {} as any);
                if (mock && Object.keys(mock).length > 0) {
                    for (const cc of mock.chapterContents || []) {
                        try { fullText += "\n\n" + JSON.parse(cc.body_json); } catch { fullText += "\n\n" + (cc.body_html || "").replace(/<br>/g, "\n"); }
                    }
                }
                // 如果 localStorage 没有数据，尝试从 API 获取所有章节内容
                if (!fullText.trim()) {
                    try {
                        const chapters = await api.listChapters(projectId);
                        for (const ch of chapters) {
                            const cc = await api.getChapterContent(ch.id);
                            if (cc) {
                                try { fullText += "\n\n" + JSON.parse(cc.body_json); } catch { fullText += "\n\n" + (cc.body_html || "").replace(/<br>/g, "\n"); }
                            }
                        }
                    } catch { /* ignore */ }
                }
            }
            if (!fullText.trim()) { setExtracting(false); return; }
            const res = await api.aiComplete({
                action: "chat", entity_type: "beats", entity_id: projectId,
                extra: {
                    user_message: fullText.trim().slice(0, 8000),
                    system_hint: `你是一位专业的小说文风分析编辑。分析以下章节内容，严格按 JSON 格式输出，不要有其他文字：\n{\n  "narrative_style": "叙述风格分析",\n  "writing_tone": "文笔基调分析",\n  "writing_rules": "写作红线建议"\n}`,
                    history: [], context: "请分析文风特点",
                },
            });
            if (res.content) {
                const match = res.content.match(/\{[\s\S]*\}/);
                if (match) { const a = JSON.parse(match[0]); setGuide(prev => ({ ...prev, narrative_style: a.narrative_style || "", writing_tone: a.writing_tone || "", writing_rules: a.writing_rules || "" })); }
            }
        } catch { /* ignore */ }
        setExtracting(false);
    }, [projectId, selectedChapterForExtract]);

    const fields = [
        { key: "narrative_style" as const, label: "【叙述风格】", ph: "第三人称，跟随主角视角，偶尔切换到配角。句式长短结合，战斗场景多用短句。" },
        { key: "writing_tone" as const, label: "【文笔基调】", ph: "古风但不晦涩，偏冷峻写实。对话干净利落，心理描写点到为止。场景以白描为主。" },
        { key: "writing_rules" as const, label: "【写作红线】", ph: "禁用现代网络语。角色说话不脱离人设。每章结尾留悬念。避免「突然」等突兀词。" },
    ];

    return (
        <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
                <div><h3 className="text-sm font-semibold text-slate-700">风格指南</h3><p className="text-xs text-slate-400">3 个大框自由填写。角色语言在独立模块编辑。</p></div>
                <div className="flex items-center gap-2">
                    <select className="rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" value={selectedChapterForExtract} onChange={e => setSelectedChapterForExtract(e.target.value)}>
                        <option value="">全部章节</option>
                        {extractableChapters.map(ch => <option key={ch.value} value={ch.value}>{ch.volumeName ? "【" + ch.volumeName + "】" : ""}{ch.label}</option>)}
                    </select>
                    <button type="button" className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-white disabled:opacity-50 ${extracting ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700"}`} onClick={handleExtractFromChapters} disabled={extracting}>
                        <Sparkles className="h-3.5 w-3.5" />{extracting ? "分析中..." : "从章节分析"}
                    </button>
                </div>
            </div>
            {fields.map(f => (
                <div key={f.key}>
                    <label className="mb-1 block text-xs font-semibold text-violet-600">{f.label}</label>
                    <textarea className="w-full rounded-lg border border-slate-200 p-3 text-sm leading-relaxed outline-none focus:border-violet-400 resize-y" rows={4}
                        value={guide[f.key]} onChange={e => setGuide(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.ph} />
                </div>
            ))}
            <button type="button" className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700" onClick={handleSave}><Save className="h-3.5 w-3.5" />{saved ? "✅ 已保存" : "保存风格指南"}</button>
        </div>
    );
}

// ===== 故事铁则编辑器（自动从大纲读取） =====

function BibleRulesEditor({ projectId }: { projectId: string }) {
    const [bible, setBible] = useState<StoryBible>({ project_id: projectId, main_stages: [], locked_events: [], inviolable_rules: [], worldview_rules: [], version: "v1.0", updated_at: new Date().toISOString() });
    const [saved, setSaved] = useState(false);
    // 自动读取的额外数据
    const [autoWorldTerms, setAutoWorldTerms] = useState<{ type: string; title: string; desc: string }[]>([]);
    const [autoPlotSegs, setAutoPlotSegs] = useState<{ type: string; title: string; event: string }[]>([]);

    useEffect(() => {
        try {
            const p = getJSONSync(`novel-workbench-bible-${projectId}`, null);
            if (p) setBible(p);
        } catch { /* ignore */ }
        // 从大纲自动读取世界观词条（从 novel-workbench-mock 读取）
        try {
            const mock = getJSONSync('novel-workbench-mock', {} as any);
            const terms = (mock.worldTerms || []).filter((t: any) => t.project_id === projectId);
            const typeLabel: Record<string, string> = { rule: "规则", faction: "势力", place: "地点", item: "道具", system: "制度", other: "其他" };
            setAutoWorldTerms(terms.map((t: any) => ({ type: typeLabel[t.term_type] || t.term_type, title: t.title, desc: t.one_liner || "" })));
        } catch { setAutoWorldTerms([]); }
        // 从大纲自动读取剧情走向
        try {
            const segs = getJSONSync(`plot-segments-${projectId}`, [] as any[]);
            setAutoPlotSegs(segs.map((s: any) => ({ type: s.type === "bright" ? "明线" : "暗线", title: s.title, event: s.event || "" })));
        } catch { setAutoPlotSegs([]); }
    }, [projectId]);

    const handleSave = useCallback(() => {
        const updated = { ...bible, updated_at: new Date().toISOString() };
        setJSONSync(`novel-workbench-bible-${projectId}`, updated);
        setJSON(`novel-workbench-bible-${projectId}`, updated);
        setBible(updated); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }, [bible, projectId]);

    return (
        <div className="max-w-3xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">故事铁则</h3>
            <p className="text-xs text-slate-400">AI 绝对不能违反的规则。世界观和剧情走向自动从大纲读取。</p>

            {/* 自动读取：世界观词条 */}
            {autoWorldTerms.length > 0 && (
                <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">世界观词条（自动读取）</label>
                    <div className="rounded border border-slate-100 bg-white p-2">
                        {autoWorldTerms.map((t, i) => (
                            <div key={i} className="mb-0.5 text-sm text-slate-700">
                                <span className="inline-block w-10 text-[10px] text-violet-500">[{t.type}]</span>
                                <span className="font-medium">{t.title}</span>
                                {t.desc && <span className="text-slate-500">：{t.desc}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 自动读取：剧情走向 */}
            {autoPlotSegs.length > 0 && (
                <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">剧情走向（自动读取）</label>
                    <div className="rounded border border-slate-100 bg-white p-2">
                        <div className="mb-1">
                            <span className="text-xs font-semibold text-amber-600">明线</span>
                            {autoPlotSegs.filter(s => s.type === "明线").map((s, i) => (
                                <div key={i} className="mb-0.5 text-sm text-slate-700">☀ 「{s.title}」{s.event ? `：${s.event}` : ""}</div>
                            ))}
                        </div>
                        <div>
                            <span className="text-xs font-semibold text-violet-600">暗线</span>
                            {autoPlotSegs.filter(s => s.type === "暗线").map((s, i) => (
                                <div key={i} className="mb-0.5 text-sm text-slate-700">🌑 「{s.title}」{s.event ? `：${s.event}` : ""}</div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {autoWorldTerms.length === 0 && autoPlotSegs.length === 0 && (
                <p className="text-sm text-slate-400">大纲中尚无世界观词条或剧情走向，请先在「大纲」模块中创建。</p>
            )}

            {/* 已锁定事件（保持手动） */}
            <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">已锁定事件（手动添加，AI 不可提前或跳过）</label>
                {bible.locked_events.map((ev, i) => (
                    <div key={i} className="mb-1 flex items-center justify-between rounded border border-slate-100 bg-white px-2 py-1">
                        <span className="text-sm text-slate-700">第{ev.chapter}章「{ev.title}」：{ev.description}</span>
                        <button type="button" className="text-xs text-red-400 hover:text-red-600" onClick={() => {
                            confirmDialog(`确定删除第${ev.chapter}章事件「${ev.title}」？`).then(ok => { if (ok) {
                                setBible(prev => ({ ...prev, locked_events: prev.locked_events.filter((_, j) => j !== i) }));
                            } });
                        }}>删除</button>
                    </div>
                ))}
                <div className="flex flex-wrap gap-2">
                    <input className="w-14 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-event-chap" placeholder="章号"
                        onKeyDown={e => { if (e.key === "Enter") document.getElementById("bible-event-title")?.focus(); }} />
                    <input className="w-24 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-event-title" placeholder="事件名"
                        onKeyDown={e => { if (e.key === "Enter") document.getElementById("bible-event-desc")?.focus(); }} />
                    <input className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-event-desc" placeholder="描述"
                        onKeyDown={e => { if (e.key === "Enter") { document.getElementById("bible-add-event-btn")?.click(); } }} />
                    <button type="button" id="bible-add-event-btn" className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                        onClick={() => {
                            const chap = (document.getElementById("bible-event-chap") as HTMLInputElement);
                            const title = (document.getElementById("bible-event-title") as HTMLInputElement);
                            const desc = (document.getElementById("bible-event-desc") as HTMLInputElement);
                            if (chap.value && title.value) {
                                setBible(prev => ({
                                    ...prev, locked_events: [
                                        ...prev.locked_events,
                                        { chapter: Number(chap.value), title: title.value.trim(), description: desc.value.trim() }
                                    ]
                                }));
                                chap.value = ""; title.value = ""; desc.value = "";
                            }
                        }}>添加</button>
                </div>
            </div>

            {/* 故事主要阶段（保持手动） */}
            <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">故事主要阶段（手动添加）</label>
                {bible.main_stages.map((s, i) => (
                    <div key={i} className="mb-1 flex items-center justify-between rounded border border-slate-100 bg-white px-2 py-1">
                        <span className="text-sm text-slate-700">第{s.chapter_range[0]}-{s.chapter_range[1]}章「{s.name}」：{s.description}</span>
                        <button type="button" className="text-xs text-red-400 hover:text-red-600" onClick={() => {
                            confirmDialog(`确定删除阶段「${s.name}」？`).then(ok => { if (ok) {
                                setBible(prev => ({ ...prev, main_stages: prev.main_stages.filter((_, j) => j !== i) }));
                            } });
                        }}>删除</button>
                    </div>
                ))}
                <div className="flex flex-wrap gap-2">
                    <input className="w-14 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-stage-start" placeholder="起始" />
                    <input className="w-14 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-stage-end" placeholder="结束" />
                    <input className="w-24 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-stage-name" placeholder="阶段名" />
                    <input className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" id="bible-stage-desc" placeholder="描述" />
                    <button type="button" className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                        onClick={() => {
                            const start = (document.getElementById("bible-stage-start") as HTMLInputElement);
                            const end = (document.getElementById("bible-stage-end") as HTMLInputElement);
                            const name = (document.getElementById("bible-stage-name") as HTMLInputElement);
                            const desc = (document.getElementById("bible-stage-desc") as HTMLInputElement);
                            if (start.value && end.value && name.value) {
                                setBible(prev => ({
                                    ...prev, main_stages: [
                                        ...prev.main_stages,
                                        { chapter_range: [Number(start.value), Number(end.value)], name: name.value.trim(), description: desc.value.trim(), status: "" }
                                    ]
                                }));
                                start.value = ""; end.value = ""; name.value = ""; desc.value = "";
                            }
                        }}>添加</button>
                </div>
            </div>

            <button type="button" className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700" onClick={handleSave}>
                <Save className="h-3.5 w-3.5" />{saved ? "✅ 已保存" : "保存故事铁则"}
            </button>
        </div>
    );
}

// ===== 角色语言特色（条目式） =====

function CharacterVoiceEditor({ projectId }: { projectId: string }) {
    const [entries, setEntries] = useState<{ char: string; voice: string }[]>([]);
    const [saved, setSaved] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [newChar, setNewChar] = useState("");
    const [newVoice, setNewVoice] = useState("");
    const [selectedChapter, setSelectedChapter] = useState("");

    const extractableChapters = getVolumeGroupedChapterOptions(projectId);

    useEffect(() => {
        try { const p = getJSONSync(`novel-workbench-voices-${projectId}`, null); if (p) setEntries(Array.isArray(p) ? p : [{ char: "默认", voice: p }]); } catch { setEntries([]); }
    }, [projectId]);

    const handleSave = useCallback(() => {
        const filtered = entries.filter(e => e.char.trim());
        setJSONSync(`novel-workbench-voices-${projectId}`, filtered);
        setJSON(`novel-workbench-voices-${projectId}`, filtered);
        setEntries(filtered); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }, [entries, projectId]);

    const addEntry = useCallback(() => {
        if (!newChar.trim()) return;
        setEntries(prev => [...prev.filter(e => e.char !== newChar.trim()), { char: newChar.trim(), voice: newVoice.trim() }]);
        setNewChar(""); setNewVoice("");
    }, [newChar, newVoice]);

    const removeEntry = useCallback((char: string) => {
        confirmDialog(`确定删除角色「${char}」的语言特色？`).then(ok => { if (ok) {
            setEntries(prev => prev.filter(e => e.char !== char));
        } });
    }, []);
    const updateVoice = useCallback((char: string, voice: string) => setEntries(prev => prev.map(e => e.char === char ? { ...e, voice } : e)), []);

    const handleAnalyze = useCallback(async () => {
        setExtracting(true);
        try {
            // 尝试从 localStorage 读取（浏览器模式）；回退到 API（Tauri 模式）
            let allChapters = loadAllChapters(projectId);
            let fullText = "";
            if (selectedChapter) {
                const target = allChapters.find((ch: any) => ch.id === selectedChapter);
                if (target?.content) fullText = target.content;
                if (!fullText) {
                    const mock = getJSONSync("novel-workbench-mock", {} as any);
                    if (mock && Object.keys(mock).length > 0) { const cc = mock.chapterContents?.find((c: any) => c.chapter_id === selectedChapter); if (cc) { try { fullText = JSON.parse(cc.body_json); } catch { fullText = (cc.body_html || "").replace(/<br>/g, "\n"); } } }
                    if (!fullText) {
                        const cc = await api.getChapterContent(selectedChapter);
                        if (cc) {
                            try { fullText = JSON.parse(cc.body_json); } catch { fullText = (cc.body_html || "").replace(/<br>/g, "\n"); }
                        }
                    }
                }
            } else {
                for (const ch of allChapters) { if (ch.content) fullText += "\n\n" + ch.content; }
                const mock2 = getJSONSync("novel-workbench-mock", {} as any);
                if (mock2 && Object.keys(mock2).length > 0) { for (const cc of mock2.chapterContents || []) { try { fullText += "\n\n" + JSON.parse(cc.body_json); } catch { fullText += "\n\n" + (cc.body_html || "").replace(/<br>/g, "\n"); } } }
                if (!fullText.trim()) {
                    try {
                        const chapters = await api.listChapters(projectId);
                        for (const ch of chapters) {
                            const cc = await api.getChapterContent(ch.id);
                            if (cc) {
                                try { fullText += "\n\n" + JSON.parse(cc.body_json); } catch { fullText += "\n\n" + (cc.body_html || "").replace(/<br>/g, "\n"); }
                            }
                        }
                    } catch { /* ignore */ }
                }
            }
            if (!fullText.trim()) { setExtracting(false); return; }
            const res = await api.aiComplete({
                action: "chat", entity_type: "beats", entity_id: projectId,
                extra: {
                    user_message: fullText.trim().slice(0, 8000),
                    system_hint: `你正在分析一部小说中各角色的说话风格。根据以下章节内容，请列出所有出现角色的说话风格特点，按 JSON 数组格式输出，每个角色只出现一次：\n[\n  { "char": "角色名", "voice": "风格描述" }\n]`,
                    history: [], context: "请分析角色语言特色",
                },
            });
            if (res.content) {
                try {
                    const match = res.content.match(/\[[\s\S]*\]/);
                    if (match) {
                        const list = JSON.parse(match[0]);
                        const ne = list.filter((item: any) => item.char && item.voice).map((item: any) => ({ char: item.char, voice: item.voice }));
                        if (ne.length > 0) {
                            setEntries(prev => {
                                const merged = [...prev];
                                for (const n of ne) {
                                    const idx = merged.findIndex(e => e.char === n.char);
                                    if (idx >= 0) merged[idx] = n;
                                    else merged.push(n);
                                }
                                return merged;
                            });
                        }
                    }
                } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
        setExtracting(false);
    }, [projectId, selectedChapter]);

    return (
        <div className="max-w-3xl space-y-3">
            <div className="flex items-center justify-between">
                <div><h3 className="text-sm font-semibold text-slate-700">角色语言特色</h3><p className="text-xs text-slate-400">每个角色的说话风格，AI 写作时会参考。</p></div>
                <div className="flex items-center gap-2">
                    <select className="rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" value={selectedChapter} onChange={e => setSelectedChapter(e.target.value)}>
                        <option value="">全部章节</option>
                        {extractableChapters.map(ch => <option key={ch.value} value={ch.value}>{ch.volumeName ? "【" + ch.volumeName + "】" : ""}{ch.label}</option>)}
                    </select>
                    <button type="button" className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-white disabled:opacity-50 ${extracting ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
                        onClick={handleAnalyze} disabled={extracting}><Sparkles className="h-3.5 w-3.5" />{extracting ? "分析中..." : "从章节分析"}</button>
                </div>
            </div>
            {entries.map(e => (
                <div key={e.char} className="flex items-start gap-2">
                    <span className="mt-1.5 w-20 shrink-0 text-xs font-semibold text-slate-700">{e.char}</span>
                    <input className="min-h-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" value={e.voice} onChange={ev => updateVoice(e.char, ev.target.value)} />
                    <button type="button" className="mt-1 text-xs text-red-400 hover:text-red-600 shrink-0" onClick={() => removeEntry(e.char)}>删除</button>
                </div>
            ))}
            <div className="flex items-start gap-2 border-t border-slate-100 pt-2">
                <input className="w-20 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" value={newChar} onChange={e => setNewChar(e.target.value)} placeholder="角色名" />
                <input className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" value={newVoice} onChange={e => setNewVoice(e.target.value)} placeholder="例：沉稳平淡，话不多" onKeyDown={e => e.key === "Enter" && addEntry()} />
                <button type="button" className="rounded bg-slate-100 px-2 py-1.5 text-xs hover:bg-slate-200" onClick={addEntry}>添加</button>
            </div>
            <button type="button" className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700" onClick={handleSave}><Save className="h-3.5 w-3.5" />{saved ? "✅ 已保存" : "保存角色语言"}</button>
        </div>
    );
}

// ===== 上下文编辑器 =====

function ContextEditor({ projectId }: { projectId: string }) {
    const [ctx, setCtx] = useState<{
        chapterLabel: string;
        totalTokens: number;
        omitted: string[];
        layers: Record<ContextLayerKey, string>;
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [chapters] = useState(() => getVolumeGroupedChapterOptions(projectId));
    const [selectedId, setSelectedId] = useState("");
    // 编辑模式：每层独立可编辑
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [editingLayer, setEditingLayer] = useState<string | null>(null);
    const [savedOverride, setSavedOverride] = useState(false);

    const handleGenerate = useCallback(async () => {
        if (!selectedId) return;
        setLoading(true);
        try {
            const { buildProjectContext } = await import("@/lib/context-engine");
            const ctx = await buildProjectContext({ projectId, chapterId: selectedId });
            const ch = chapters.find(c => c.value === selectedId);
            // 加载用户自定义覆盖（如果有）
            const overrides = getJSONSync(`novel-workbench-bible-${projectId}`, null) as any;
            const customCtx = overrides?.customContextOverrides?.[selectedId];
            setCtx({
                chapterLabel: ch ? (ch.volumeName ? "【" + ch.volumeName + "】" : "") + ch.label : "未知章节",
                totalTokens: ctx.totalTokens,
                omitted: ctx.omitted,
                layers: ctx.layers,
            });
            setEdits(customCtx?.layers || {});
        } catch (e: any) { setCtx(null); alertDialog(`获取失败：${e.message || e}`); }
        finally { setLoading(false); }
    }, [projectId, selectedId, chapters]);

    const handleSave = useCallback(() => {
        if (!selectedId || !ctx) return;
        const bible = getJSONSync(`novel-workbench-bible-${projectId}`, null) as any || {};
        bible.customContextOverrides = bible.customContextOverrides || {};
        bible.customContextOverrides[selectedId] = {
            layers: edits,
            savedAt: new Date().toISOString(),
        };
        setJSONSync(`novel-workbench-bible-${projectId}`, bible);
        setJSON(`novel-workbench-bible-${projectId}`, bible);
        setSavedOverride(true);
        setTimeout(() => setSavedOverride(false), 2000);
    }, [projectId, selectedId, ctx, edits]);

    const BADGE_COLORS: Record<string, string> = {
        slate: "bg-slate-100 text-slate-700",
        blue: "bg-blue-100 text-blue-700",
        purple: "bg-purple-100 text-purple-700",
        emerald: "bg-emerald-100 text-emerald-700",
        amber: "bg-amber-100 text-amber-700",
    };

    const layers: { key: ContextLayerKey; color: string; label: string; icon: string }[] = [
        { key: "p4", color: "slate", label: "前一章正文", icon: "📄" },
        { key: "p0", color: "blue", label: "世界观背景（不可违反）", icon: "🌍" },
        { key: "p3", color: "purple", label: "角色池", icon: "👥" },
        { key: "p2", color: "emerald", label: "风格指南", icon: "✍️" },
        { key: "p1", color: "amber", label: "剧情走向与前情摘要", icon: "📜" },
    ];

    return (
        <div className="max-w-5xl">
            <div className="mb-4 flex items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-700">上下文编辑器</h3>
                <select className="rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-400" value={selectedId} onChange={e => { setSelectedId(e.target.value); setCtx(null); setEdits({}); }}>
                    <option value="">— 选择章节 —</option>
                    {chapters.map(ch => <option key={ch.value} value={ch.value}>{ch.volumeName ? "【" + ch.volumeName + "】" : ""}{ch.label}</option>)}
                </select>
                <button type="button" className="rounded-md bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50" onClick={handleGenerate} disabled={loading || !selectedId}>
                    {loading ? "正在生成..." : "加载上下文"}
                </button>
                {ctx && Object.keys(edits).length > 0 && (
                    <button type="button" className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700" onClick={handleSave}>
                        {savedOverride ? "✅ 已保存" : "保存修改"}
                    </button>
                )}
                <span className="text-xs text-slate-400">AI 写文时优先使用你编辑后的版本</span>
            </div>

            {ctx ? (
                <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center gap-4 text-xs">
                            <span className="font-medium text-slate-700">📖 {ctx.chapterLabel}</span>
                            <span className="text-slate-400">|</span>
                            <span>Token 约 <strong className="text-violet-600">{ctx.totalTokens}</strong></span>
                            {ctx.omitted.length > 0 && (
                                <span className="text-amber-600">⚠ 已裁剪 {ctx.omitted.length} 项</span>
                            )}
                        </div>
                    </div>

                    {layers.filter(l => !!(edits[l.key] ?? ctx.layers[l.key])).map(({ key, color, label, icon }) => (
                        <div key={key} className="rounded-lg border border-slate-200 bg-white">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE_COLORS[color] || "bg-slate-100 text-slate-700"}`}>P{key.slice(1).toUpperCase()}</span>
                                <span className="text-xs font-medium text-slate-700">{icon} {label}</span>
                                <div className="ml-auto flex items-center gap-1">
                                    <button type="button"
                                        className={`rounded px-2 py-0.5 text-[10px] ${editingLayer === key ? "bg-violet-100 text-violet-700" : "text-slate-400 hover:bg-slate-100"}`}
                                        onClick={() => setEditingLayer(editingLayer === key ? null : key)}>
                                        {editingLayer === key ? "完成编辑" : "编辑"}
                                    </button>
                                </div>
                            </div>
                            {editingLayer === key ? (
                                <textarea
                                    className="w-full p-3 text-xs leading-relaxed text-slate-700 font-mono outline-none resize-y min-h-[120px]"
                                    rows={8}
                                    value={edits[key] ?? ctx.layers[key]}
                                    onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                                />
                            ) : (
                                <pre className="max-h-64 overflow-y-auto p-3 text-xs leading-relaxed text-slate-600 font-mono whitespace-pre-wrap">
                                    {edits[key] ?? ctx.layers[key]}
                                </pre>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
                    选择章节后点击「加载上下文」，可预览并编辑发给 AI 的内容
                </div>
            )}
        </div>
    );
}