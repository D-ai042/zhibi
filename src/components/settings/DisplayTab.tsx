// DisplayTab.tsx — 显示设置（护眼主题选择）
// eyeCareMode=总开关；theme=6 选 1 主题预设（仅总开关开启时生效）
import { useAppStore } from "@/stores/app-store";
import type { Theme } from "@/stores/app-store/ui-slice";
import { Eye } from "lucide-react";

interface ThemeOption {
  value: Theme;
  label: string;
  desc: string;
  bg: string;
  text: string;
  accent: string;
  isDark?: boolean;
}

const THEMES: ThemeOption[] = [
  {
    value: "default",
    label: "默认",
    desc: "原版浅色 UI + 白底正文，保持软件初始观感",
    bg: "#f5f6fa",
    text: "#1a1a2e",
    accent: "#f59e0b",
  },
  {
    value: "warm-apricot",
    label: "暖杏色纸张",
    desc: "浅色暖调，旧书页质感，长时间阅读友好",
    bg: "#F5ECD7",
    text: "#3E3427",
    accent: "#D4A017",
  },
  {
    value: "forest-dark",
    label: "深森林绿暗色",
    desc: "深色 UI，墨绿护目，夜间写作首选",
    bg: "#1A2E22",
    text: "#B8CDB8",
    accent: "#2D6A4F",
    isDark: true,
  },
  {
    value: "slate-blue",
    label: "灰蓝低饱和",
    desc: "浅色冷调，低饱和灰蓝，沉稳不刺眼",
    bg: "#E8ECF0",
    text: "#2E3D48",
    accent: "#475569",
  },
  {
    value: "milk-tea",
    label: "奶茶棕暖调",
    desc: "浅色暖调，焦糖棕配色，温馨舒适",
    bg: "#E8DDD0",
    text: "#3D2E1E",
    accent: "#8B5A2B",
  },
  {
    value: "mint",
    label: "浅薄荷清凉",
    desc: "浅色冷调，薄荷绿清新，提神护目",
    bg: "#EEF5F2",
    text: "#2A3F38",
    accent: "#10B981",
  },
];

export function DisplayTab() {
  const { eyeCareMode, setEyeCareMode, theme, setTheme } = useAppStore();
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];

  return (
    <div className="space-y-5">
      {/* 总开关 */}
      <section className="rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-emerald-600" />
            <div>
              <p className="font-medium text-slate-800">护眼模式总开关</p>
              <p className="text-xs text-slate-500 mt-0.5">
                关闭时恢复软件默认浅色 UI + 白底正文。顶栏「护眼」按钮同步此开关。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEyeCareMode(!eyeCareMode)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              eyeCareMode ? "bg-emerald-500" : "bg-slate-300"
            }`}
            aria-pressed={eyeCareMode}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                eyeCareMode ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {!eyeCareMode && (
          <p className="mt-3 text-xs text-amber-600 bg-amber-50 rounded px-2 py-1.5">
            ⚠ 护眼模式已关闭，下方主题选择不会生效。请先开启总开关。
          </p>
        )}
      </section>

      {/* 主题选择 */}
      <section className={`rounded-lg border p-4 ${eyeCareMode ? "border-slate-200" : "border-slate-200 opacity-50 pointer-events-none"}`}>
        <div className="flex items-center gap-2 mb-3">
          <Eye className="h-4 w-4 text-emerald-600" />
          <div>
            <p className="font-medium text-slate-800">主题配色</p>
            <p className="text-xs text-slate-500 mt-0.5">统一应用于侧边栏、顶栏、按钮及章节正文编辑区</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const selected = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={`flex flex-col items-stretch overflow-hidden rounded-lg border transition-all ${
                  selected
                    ? "border-emerald-500 ring-2 ring-emerald-200"
                    : "border-slate-200 hover:border-slate-300"
                }`}
                title={t.desc}
              >
                {/* 预览条：背景色 + 文字色 + 主色调 */}
                <div
                  className="flex items-center justify-between px-3 py-2"
                  style={{ background: t.bg, color: t.text }}
                >
                  <span className="text-xs font-medium">章 正文</span>
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: t.accent }}
                    title="主色调"
                  />
                </div>
                {/* 标签 */}
                <div className="flex items-center justify-between bg-white px-3 py-2">
                  <span className="text-xs font-medium text-slate-700">{t.label}</span>
                  {t.isDark && (
                    <span className="text-[10px] text-slate-400">深色</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-slate-500">{current.desc}</p>

        {/* 实时预览 */}
        <div className="mt-3">
          <p className="text-xs text-slate-500 mb-1.5">正文预览：</p>
          <div
            className="chapter-editor-surface rounded border p-3 font-serif text-sm leading-relaxed"
            style={{ background: current.bg, color: current.text }}
          >
            夜色如墨，灯火阑珊处，他提笔落下一行字——那是多年以后才被人读懂的开篇。
          </div>
        </div>
      </section>

      {/* 快捷操作 */}
      <section className="rounded-lg border border-slate-200 p-4 bg-slate-50">
        <p className="font-medium text-slate-800 mb-2">快捷操作</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEyeCareMode(true);
              setTheme("forest-dark");
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-100"
          >
            夜间写作（深森林绿）
          </button>
          <button
            type="button"
            onClick={() => {
              setEyeCareMode(true);
              setTheme("warm-apricot");
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-100"
          >
            日间柔光（暖杏色纸张）
          </button>
          <button
            type="button"
            onClick={() => setEyeCareMode(false)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-100"
          >
            关闭护眼（恢复默认）
          </button>
        </div>
      </section>
    </div>
  );
}
