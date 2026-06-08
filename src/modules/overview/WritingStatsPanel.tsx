import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { FileText, BookOpen, BarChart3, Clock, Target } from "lucide-react";

export function WritingStatsPanel() {
    const { currentProject } = useAppStore();
    const [stats, setStats] = useState({
        chapters: 0,
        finalChapters: 0,
        totalWords: 0,
        volumes: 0,
        characters: 0,
        worldTerms: 0,
        plotEvents: 0,
    });

    useEffect(() => {
        if (!currentProject) return;
        const pid = currentProject.id;
        api.listChapters(pid).then(chaps => {
            api.listVolumes(pid).then(vols => {
                api.listCharacters(pid).then(chars => {
                    api.listWorldTerms(pid).then(terms => {
                        api.listTimelineNodes(pid).then(nodes => {
                            setStats({
                                chapters: chaps.length,
                                finalChapters: chaps.filter(c => c.status === "final").length,
                                totalWords: chaps.reduce((s, c) => s + c.word_count, 0),
                                volumes: vols.length,
                                characters: chars.length,
                                worldTerms: terms.length,
                                plotEvents: nodes.length,
                            });
                        });
                    });
                });
            });
        });
    }, [currentProject]);

    if (!currentProject) return null;

    const cards = [
        { icon: BookOpen, label: "卷", value: stats.volumes, color: "text-blue-600", bg: "bg-blue-50" },
        { icon: FileText, label: "章节", value: `${stats.finalChapters}/${stats.chapters}`, sub: "定稿/总数", color: "text-amber-600", bg: "bg-amber-50" },
        { icon: BarChart3, label: "总字数", value: stats.totalWords.toLocaleString(), sub: "字", color: "text-emerald-600", bg: "bg-emerald-50" },
        { icon: Target, label: "角色", value: stats.characters, color: "text-violet-600", bg: "bg-violet-50" },
        { icon: Clock, label: "世界观词条", value: stats.worldTerms, color: "text-rose-600", bg: "bg-rose-50" },
        { icon: BarChart3, label: "剧情节点", value: stats.plotEvents, color: "text-cyan-600", bg: "bg-cyan-50" },
    ];

    // 估算完成度
    const completion = stats.chapters > 0
        ? Math.round((stats.finalChapters / stats.chapters) * 100)
        : 0;
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

            {/* 完成度 */}
            <div className="mt-6 rounded-xl border bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">章节完成度</h3>
                <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-amber-600">{completion}%</span>
                    <span className="text-sm text-slate-500">
                        {stats.finalChapters} / {stats.chapters} 章已定稿
                    </span>
                </div>
                <div className="mt-3 h-3 rounded-full bg-slate-100">
                    <div className="h-3 rounded-full bg-amber-500 transition-all" style={{ width: `${completion}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                    平均每章 {avgWordsPerChapter.toLocaleString()} 字
                    {stats.totalWords > 0 && ` · 全书进度 ${completion}%`}
                </p>
            </div>

            {/* @侧边提示 */}
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-slate-600">
                💡 在「大纲」中完善世界观、角色和剧情走向，在「写作台」中按卷章写作，在「灵感」中记录写作灵感
            </div>
        </div>
    );
}
