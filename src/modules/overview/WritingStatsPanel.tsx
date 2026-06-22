import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { getJSONSync } from "@/lib/storage";
import { loadAllChapters } from "@/lib/chapter-store";
import { BookOpen, BarChart3, Users, Globe2, ListTree, Eye } from "lucide-react";

/** 从 chapter-store 中读取含正文内容的章节列表 */
function loadPlotChapters(pid: string): { id: string; content: string }[] {
    return loadAllChapters(pid);
}

/** 从剧情走向读取段落和细纲 */
function loadSegments(pid: string): { type: string; beats?: any[] }[] {
    return getJSONSync("plot-segments-" + pid, [] as { type: string; beats?: any[] }[]);
}

export function WritingStatsPanel() {
    const { currentProject } = useAppStore();
    const [stats, setStats] = useState({
        brightVolumes: 0,
        darkSegments: 0,
        beats: 0,
        chapters: 0,
        finalChapters: 0,
        totalWords: 0,
        characters: 0,
        worldTerms: 0,
    });

    useEffect(() => {
        if (!currentProject) return;
        const pid = currentProject.id;
        (async () => {
            const [chars, terms] = await Promise.all([
                api.listCharacters(pid),
                api.listWorldTerms(pid),
            ]);
            // 从写作台 localStorage 加载章节
            const plotChapters = loadPlotChapters(pid);
            // 从剧情走向 localStorage 加载段落/细纲
            const segs = loadSegments(pid);
            const bright = segs.filter(s => s.type === "bright").length;
            const dark = segs.filter(s => s.type === "dark").length;
            let totalBeats = 0;
            for (const s of segs) {
                if (s.beats) totalBeats += s.beats.length;
            }
            let realWords = 0;
            for (const pc of plotChapters) {
                if (pc.content) {
                    realWords += pc.content.replace(/\s/g, "").length;
                }
            }
            setStats({
                brightVolumes: bright,
                darkSegments: dark,
                beats: totalBeats,
                chapters: plotChapters.length,
                finalChapters: 0, // 暂时不依赖 API chapters
                totalWords: realWords,
                characters: chars.length,
                worldTerms: terms.length,
            });
        })();
    }, [currentProject]);

    if (!currentProject) return null;

    const cards = [
        { icon: BookOpen, label: "卷", value: stats.brightVolumes, color: "text-blue-600", bg: "bg-blue-50" },
        { icon: Eye, label: "暗线", value: stats.darkSegments, color: "text-purple-600", bg: "bg-purple-50" },
        { icon: BarChart3, label: "总字数", value: stats.totalWords.toLocaleString(), sub: "字", color: "text-emerald-600", bg: "bg-emerald-50" },
        { icon: ListTree, label: "细纲", value: stats.beats, color: "text-amber-600", bg: "bg-amber-50" },
        { icon: Users, label: "角色", value: stats.characters, color: "text-violet-600", bg: "bg-violet-50" },
        { icon: Globe2, label: "世界观词条", value: stats.worldTerms, color: "text-rose-600", bg: "bg-rose-50" },
    ];

    const avgWordsPerChapter = stats.chapters > 0
        ? Math.round(stats.totalWords / stats.chapters)
        : 0;

    return (
        <div className="h-full overflow-y-auto p-6">
            <h1 className="mb-1 text-xl font-bold">写作统计</h1>
            <p className="mb-6 text-sm text-slate-500">作品数据一览</p>

            {/* 统计卡片网格 */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {cards.map(({ icon: Icon, label, value, sub, color, bg }) => (
                    <div key={label} className={`${bg} rounded-xl border p-4`}>
                        <Icon className={`mb-2 h-5 w-5 ${color}`} />
                        <div className="text-2xl font-bold text-slate-800">{value}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                            {label}
                            {sub && <span className="ml-1 text-slate-400">{sub}</span>}
                        </div>
                    </div>
                ))}
            </div>

            {/* 完成度 - 按卷/细纲进度 */}
            <div className="mt-6 rounded-xl border bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">写作进度</h3>
                <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-amber-600">{stats.totalWords.toLocaleString()}</span>
                    <span className="text-sm text-slate-500">总字数</span>
                </div>
                <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{stats.brightVolumes} 卷 · {stats.chapters} 章</span>
                        <span>{stats.beats} 个细纲</span>
                    </div>
                    {stats.chapters > 0 && (
                        <p className="text-xs text-slate-400">平均每章 {avgWordsPerChapter.toLocaleString()} 字</p>
                    )}
                </div>
            </div>

            {/* 提示 */}
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-slate-600">
                💡 在「大纲」中完善世界观、角色和剧情走向，在「写作台」中按卷章写作
            </div>
        </div>
    );
}
