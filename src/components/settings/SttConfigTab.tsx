// SttConfigTab.tsx — 语音识别(STT)配置标签页（T9：重构为使用 app-store + api 模块）
import { useState, useEffect, useCallback } from "react";
import { Mic } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import type { SttConfig } from "@/types";

const STT_PRESETS = [
  { name: "openai", label: "OpenAI Whisper", base: "https://api.openai.com/v1", model: "whisper-1" },
  { name: "siliconflow", label: "硅基流动", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2-Audio-7B-Instruct" },
  { name: "baidu", label: "百度语音", base: "https://aip.baidubce.com", model: "" },
];

export function SttConfigTab() {
  const { apiConfig, setApiConfig } = useAppStore();
  const [providers, setProviders] = useState<Record<string, { api_key: string; secret_key: string; base_url: string; model: string }>>({});
  const [activeProvider, setActiveProvider] = useState("openai");
  const [enabled, setEnabled] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [customProviders, setCustomProviders] = useState<{ name: string }[]>([]);
  const [newCustomName, setNewCustomName] = useState("");

  useEffect(() => {
    if (!apiConfig?.stt) return;
    const stt = apiConfig.stt;
    setActiveProvider(stt.activeProvider || "openai");
    setEnabled(stt.enabled || false);
    const loaded: Record<string, { api_key: string; secret_key: string; base_url: string; model: string }> = {};
    if (stt.providers) {
      for (const [name, cfg] of Object.entries(stt.providers)) {
        loaded[name] = { api_key: (cfg as any).api_key || "", secret_key: (cfg as any).secret_key || "", base_url: (cfg as any).base_url || "", model: (cfg as any).model || "" };
      }
    }
    for (const p of STT_PRESETS) {
      if (!loaded[p.name]) loaded[p.name] = { api_key: "", secret_key: "", base_url: p.base, model: p.model };
    }
    setProviders(loaded);
    const custom: { name: string }[] = [];
    for (const name of Object.keys(loaded)) {
      if (!STT_PRESETS.some(p => p.name === name)) custom.push({ name });
    }
    setCustomProviders(custom);
  }, [apiConfig]);

  const save = useCallback(async () => {
    setSaveMsg("");
    try {
      const sttCfg: SttConfig = {
        activeProvider, enabled,
        providers: Object.fromEntries(
          Object.entries(providers).map(([name, cfg]) => [name, { api_key: cfg.api_key, secret_key: cfg.secret_key, base_url: cfg.base_url, model: cfg.model }])
        ),
      };
      await api.setSttConfig(sttCfg);
      const newCfg = await api.getApiConfig();
      if (newCfg) setApiConfig(newCfg);
      setSaveMsg("✅ 已保存"); setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: any) { setSaveMsg(`❌ ${e?.message || e}`); }
  }, [activeProvider, enabled, providers, setApiConfig]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div><h3 className="text-sm font-semibold text-slate-700">语音识别 (STT)</h3><p className="text-xs text-slate-400">配置语音转文字服务</p></div>
        <button onClick={save} className="rounded-md bg-violet-600 px-4 py-1.5 text-xs text-white hover:bg-violet-700">保存</button>
      </div>
      {saveMsg && <p className={`text-xs ${saveMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>{saveMsg}</p>}

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-violet-600" />
        启用语音输入
      </label>

      <div>
        <label className="text-xs font-medium text-slate-600">激活厂商</label>
        <select value={activeProvider} onChange={e => setActiveProvider(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:border-violet-400">
          {[...STT_PRESETS, ...customProviders].map(p => <option key={p.name} value={p.name}>{p.label || p.name}</option>)}
        </select>
      </div>

      {[...STT_PRESETS, ...customProviders].map(p => {
        const cfg = providers[p.name] || { api_key: "", secret_key: "", base_url: "", model: "" };
        return (
          <div key={p.name} className="rounded-lg border p-3 space-y-2">
            <span className="text-sm font-medium">{(p as any).label || p.name}</span>
            <input type="password" value={cfg.api_key}
              onChange={e => setProviders(prev => ({ ...prev, [p.name]: { ...prev[p.name], api_key: e.target.value } }))}
              placeholder="API Key" className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
            <input type="password" value={cfg.secret_key}
              onChange={e => setProviders(prev => ({ ...prev, [p.name]: { ...prev[p.name], secret_key: e.target.value } }))}
              placeholder="Secret Key (百度)" className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
            <input type="text" value={cfg.base_url || (STT_PRESETS.find(x => x.name === p.name)?.base || "")}
              onChange={e => setProviders(prev => ({ ...prev, [p.name]: { ...prev[p.name], base_url: e.target.value } }))}
              className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
          </div>
        );
      })}

      <div className="flex gap-1">
        <input type="text" value={newCustomName} onChange={e => setNewCustomName(e.target.value)}
          placeholder="自定义 STT 厂商名称" className="flex-1 rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
        <button onClick={() => { const n = newCustomName.trim(); if (n && !providers[n]) { setProviders(prev => ({ ...prev, [n]: { api_key: "", secret_key: "", base_url: "", model: "" } })); setCustomProviders(prev => [...prev, { name: n }]); setNewCustomName(""); } }}
          className="rounded border px-3 py-1 text-xs hover:bg-slate-50">添加</button>
      </div>
    </div>
  );
}
