// SttConfigTab.tsx — 语音识别配置（T9 拆分，从 SettingsModal 完整迁移）
import { useState, useEffect, useCallback } from "react";
import { Mic, Eye, EyeOff, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import type { SttConfig } from "@/types";

const STT_PRESET_NAMES = ["openai", "siliconflow", "baidu"];
function sttPresetLabel(name: string): string {
  const m: Record<string, string> = { openai: "OpenAI Whisper", siliconflow: "硅基流动", baidu: "百度语音" };
  return m[name] || name;
}
function sttDefaultBase(name: string): string {
  const m: Record<string, string> = { openai: "https://api.openai.com/v1", siliconflow: "https://api.siliconflow.cn/v1", baidu: "https://aip.baidubce.com" };
  return m[name] || "";
}
function sttDefaultModel(name: string): string {
  const m: Record<string, string> = { openai: "whisper-1", siliconflow: "Qwen/Qwen2-Audio-7B-Instruct", baidu: "" };
  return m[name] || "";
}

export function SttConfigTab() {
  const { apiConfig, setApiConfig } = useAppStore();
  const [sttProviders, setSttProviders] = useState<Record<string, { api_key: string; secret_key: string; base_url: string; model: string }>>({});
  const [sttActiveProvider, setSttActiveProvider] = useState("openai");
  const [sttEnabled, setSttEnabled] = useState(false);
  const [sttCustomProviders, setSttCustomProviders] = useState<{ name: string }[]>([]);
  const [newSttCustomName, setNewSttCustomName] = useState("");
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    if (!apiConfig?.stt) return;
    const stt = apiConfig.stt;
    setSttActiveProvider(stt.activeProvider || "openai");
    setSttEnabled(stt.enabled || false);
    const loaded: Record<string, { api_key: string; secret_key: string; base_url: string; model: string }> = {};
    if (stt.providers) {
      for (const [name, cfg] of Object.entries(stt.providers)) {
        loaded[name] = { api_key: cfg.api_key || "", secret_key: (cfg as any).secret_key || "", base_url: cfg.base_url || sttDefaultBase(name), model: cfg.model || sttDefaultModel(name) };
      }
    }
    for (const name of STT_PRESET_NAMES) {
      if (!loaded[name]) loaded[name] = { api_key: "", secret_key: "", base_url: sttDefaultBase(name), model: sttDefaultModel(name) };
    }
    setSttProviders(loaded);
    const custom: { name: string }[] = [];
    for (const name of Object.keys(loaded)) {
      if (!STT_PRESET_NAMES.includes(name)) custom.push({ name });
    }
    setSttCustomProviders(custom);
  }, [apiConfig]);

  const save = useCallback(async () => {
    setSaveMsg("");
    try {
      const sttCfg: SttConfig = {
        activeProvider: sttActiveProvider, enabled: sttEnabled,
        providers: Object.fromEntries(
          Object.entries(sttProviders).map(([name, cfg]) => [name, { api_key: cfg.api_key, secret_key: cfg.secret_key, base_url: cfg.base_url, model: cfg.model }])
        ),
      };
      await api.setSttConfig(sttCfg);
      const newCfg = await api.getApiConfig();
      if (newCfg) setApiConfig(newCfg);
      setSaveMsg("✅ 已保存"); setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: any) { setSaveMsg(`❌ ${e?.message || e}`); }
  }, [sttActiveProvider, sttEnabled, sttProviders, setApiConfig]);

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">语音识别 (STT)</h3>
          <p className="text-xs text-slate-400">配置语音转文字服务</p>
        </div>
        <button onClick={save} className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs text-white hover:bg-violet-700">保存</button>
      </div>
      {saveMsg && <p className={`text-xs mb-2 ${saveMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>{saveMsg}</p>}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">每个厂商独立配置 API Key。切换到该厂商时自动使用对应的 Key。</p>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={sttEnabled} onChange={e => setSttEnabled(e.target.checked)} className="rounded" />
          启用语音输入
        </label>
      </div>

      {[...STT_PRESET_NAMES, ...sttCustomProviders.map(c => c.name)].map(name => {
        const cfg = sttProviders[name] || { api_key: "", secret_key: "", base_url: sttDefaultBase(name), model: sttDefaultModel(name) };
        const isActive = sttActiveProvider === name;
        const isBaidu = name === "baidu";
        const isCustom = !STT_PRESET_NAMES.includes(name);
        return (
          <div key={name} className={`rounded-lg border p-3 ${isActive ? "border-amber-300 bg-amber-50/30" : "border-slate-100"}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <input type="radio" name="sttActive" checked={isActive}
                  onChange={() => setSttActiveProvider(name)} className="text-amber-500" />
                <span className="text-sm font-medium text-slate-700">{sttPresetLabel(name)}</span>
                {isCustom && (
                  <button type="button" className="text-[10px] text-red-500 hover:text-red-700"
                    onClick={() => {
                      const next = { ...sttProviders }; delete next[name]; setSttProviders(next);
                      setSttCustomProviders(prev => prev.filter(c => c.name !== name));
                      if (sttActiveProvider === name) setSttActiveProvider("openai");
                    }}>移除</button>
                )}
              </div>
              {cfg.api_key && <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> 已配置</span>}
            </div>
            {isActive && (
              <div className="space-y-2">
                {isBaidu ? (
                  <>
                    <div className="relative">
                      <input type={showKeys.has("baidu_key_" + name) ? "text" : "password"}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-xs outline-none focus:border-blue-400"
                        value={cfg.api_key} onChange={e => setSttProviders(prev => ({ ...prev, [name]: { ...prev[name], api_key: e.target.value } }))}
                        placeholder="API Key" />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        onClick={() => setShowKeys(prev => { const n = new Set(prev); if (n.has("baidu_key_" + name)) n.delete("baidu_key_" + name); else n.add("baidu_key_" + name); return n; })}>
                        {showKeys.has("baidu_key_" + name) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="relative">
                      <input type={showKeys.has("baidu_secret_" + name) ? "text" : "password"}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-xs outline-none focus:border-blue-400"
                        value={cfg.secret_key} onChange={e => setSttProviders(prev => ({ ...prev, [name]: { ...prev[name], secret_key: e.target.value } }))}
                        placeholder="Secret Key" />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        onClick={() => setShowKeys(prev => { const n = new Set(prev); if (n.has("baidu_secret_" + name)) n.delete("baidu_secret_" + name); else n.add("baidu_secret_" + name); return n; })}>
                        {showKeys.has("baidu_secret_" + name) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500">百度使用 API Key + Secret Key 获取 access_token（有效期 30 天），应用内自动管理。</p>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <input type={showKeys.has("stt_key_" + name) ? "text" : "password"}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-xs outline-none focus:border-amber-400"
                        value={cfg.api_key} onChange={e => setSttProviders(prev => ({ ...prev, [name]: { ...prev[name], api_key: e.target.value } }))}
                        placeholder="API Key（留空则使用对应厂商的 Key）" />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        onClick={() => setShowKeys(prev => { const n = new Set(prev); if (n.has("stt_key_" + name)) n.delete("stt_key_" + name); else n.add("stt_key_" + name); return n; })}>
                        {showKeys.has("stt_key_" + name) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] outline-none text-slate-500 focus:border-amber-400"
                        value={cfg.base_url} onChange={e => setSttProviders(prev => ({ ...prev, [name]: { ...prev[name], base_url: e.target.value } }))}
                        placeholder="API 地址" />
                      <input className="w-36 rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] outline-none text-slate-500 focus:border-amber-400"
                        value={cfg.model} onChange={e => setSttProviders(prev => ({ ...prev, [name]: { ...prev[name], model: e.target.value } }))}
                        placeholder="模型名" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2 mt-2">
        <input className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-amber-400"
          value={newSttCustomName}
          onChange={e => setNewSttCustomName(e.target.value)}
          placeholder="输入自定义语音厂商名称…"
          onKeyDown={e => {
            if (e.key === "Enter" && newSttCustomName.trim()) {
              const name = newSttCustomName.trim();
              if (!sttProviders[name]) {
                setSttProviders(prev => ({ ...prev, [name]: { api_key: "", secret_key: "", base_url: "", model: "" } }));
                setSttCustomProviders(prev => [...prev, { name }]);
              }
              setNewSttCustomName("");
            }
          }} />
        <button type="button"
          className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-200 disabled:opacity-40"
          disabled={!newSttCustomName.trim()}
          onClick={() => {
            const name = newSttCustomName.trim();
            if (name && !sttProviders[name]) {
              setSttProviders(prev => ({ ...prev, [name]: { api_key: "", secret_key: "", base_url: "", model: "" } }));
              setSttCustomProviders(prev => [...prev, { name }]);
            }
            setNewSttCustomName("");
          }}>+ 添加</button>
      </div>
    </>
  );
}
