import { useEffect, useState, useCallback, useRef } from "react";
import { X, Eye, EyeOff, Check, Settings2, Mic, History, RotateCcw, AlertTriangle, Download, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { listSnapshots, restoreSnapshot, createSnapshot } from "@/lib/memory-updater";
import type { SttConfig } from "@/types";

/** 厂商配置 */
const PROVIDERS = [
  { name: "DeepSeek", label: "DeepSeek", base: "https://api.deepseek.com" },
  { name: "OpenAI", label: "OpenAI", base: "https://api.openai.com" },
  { name: "Anthropic", label: "Anthropic", base: "https://api.anthropic.com" },
  { name: "阿里云", label: "阿里云（通义千问）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { name: "智谱", label: "智谱（GLM）", base: "https://open.bigmodel.cn/api/paas/v4" },
  { name: "月之暗面", label: "月之暗面（Moonshot）", base: "https://api.moonshot.cn/v1" },
  { name: "百川智能", label: "百川智能", base: "https://api.baichuan-ai.com/v1" },
  { name: "零一万物", label: "零一万物（Yi）", base: "https://api.lingyiwanwu.com/v1" },
  { name: "硅基流动", label: "硅基流动（SiliconFlow）", base: "https://api.siliconflow.cn/v1" },
  { name: "小米", label: "小米（Xiaomi MiMo）", base: "https://api.xiaomimimo.com" },
];

/** 语音转文字预设 — 不再使用，保留为空 */

/** 自定义厂商状态 */
interface CustomProviderEntry {
  name: string;
  key: string;
  baseUrl: string;
  models: string[];
}

type TabName = "api" | "stt" | "snapshots" | "migrate";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, setApiConfig, apiConfig } = useAppStore();
  const [tab, setTab] = useState<TabName>("api");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [testMsg, setTestMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [customProviders, setCustomProviders] = useState<CustomProviderEntry[]>([]);
  const [newCustomName, setNewCustomName] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  // STT 状态（多 provider 架构）
  const [sttProviders, setSttProviders] = useState<Record<string, { api_key: string; secret_key: string; base_url: string; model: string }>>({});
  const [sttActiveProvider, setSttActiveProvider] = useState("openai");
  const [sttEnabled, setSttEnabled] = useState(false);
  const [sttCustomProviders, setSttCustomProviders] = useState<{ name: string }[]>([]);
  const [newSttCustomName, setNewSttCustomName] = useState("");

  /** STT 预设厂商 */
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

  useEffect(() => {
    if (settingsOpen && apiConfig) {
      setKeys(apiConfig.provider_keys || {});
      setBaseUrls(apiConfig.provider_base_urls || {});
      // 从 provider_keys 中提取非预定义厂商作为自定义厂商
      const definedNames = new Set(PROVIDERS.map(p => p.name));
      const custom: CustomProviderEntry[] = [];
      for (const name of Object.keys(apiConfig.provider_keys || {})) {
        if (!definedNames.has(name) && name !== "custom") {
          custom.push({
            name,
            key: apiConfig.provider_keys[name] || "",
            baseUrl: apiConfig.provider_base_urls[name] || "",
            models: apiConfig.provider_models?.[name] || [],
          });
        }
      }
      setCustomProviders(custom);
      const stt = apiConfig.stt;
      if (stt) {
        setSttActiveProvider(stt.activeProvider || "openai");
        setSttEnabled(stt.enabled || false);
        // 加载所有 provider 配置
        const loaded: Record<string, { api_key: string; secret_key: string; base_url: string; model: string }> = {};
        if (stt.providers) {
          for (const [name, cfg] of Object.entries(stt.providers)) {
            loaded[name] = { api_key: cfg.api_key || "", secret_key: cfg.secret_key || "", base_url: cfg.base_url || sttDefaultBase(name), model: cfg.model || sttDefaultModel(name) };
          }
        }
        // 确保预设都存在
        for (const name of STT_PRESET_NAMES) {
          if (!loaded[name]) loaded[name] = { api_key: "", secret_key: "", base_url: sttDefaultBase(name), model: sttDefaultModel(name) };
        }
        setSttProviders(loaded);
        // 提取自定义 STT 厂商
        const allSttNames = new Set([...STT_PRESET_NAMES, ...Object.keys(loaded)]);
        const custom: { name: string }[] = [];
        for (const name of Object.keys(loaded)) {
          if (!STT_PRESET_NAMES.includes(name)) custom.push({ name });
        }
        setSttCustomProviders(custom);
      }
    }
  }, [settingsOpen, apiConfig]);

  if (!settingsOpen) return null;

  const save = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      for (const p of PROVIDERS) {
        const k = keys[p.name];
        const url = baseUrls[p.name] || p.base;
        if (k?.trim()) {
          await api.setApiConfig(url, apiConfig?.api_model || "deepseek-chat", k, p.name);
        }
      }
      // 保存自定义厂商
      for (const cp of customProviders) {
        if (cp.name.trim() && cp.key.trim()) {
          await api.setApiConfig(cp.baseUrl || "https://api.openai.com/v1", apiConfig?.api_model || "deepseek-chat", cp.key, cp.name.trim());
        }
        // 保存该厂商的模型列表
        if (cp.name.trim() && cp.models.length > 0) {
          await api.setProviderModels(cp.name.trim(), cp.models);
        }
      }
      // 保存 STT 配置（多 provider）
      const hasAnyKey = Object.values(sttProviders).some(p => p.api_key.trim() || p.secret_key.trim());
      const sttConfig: SttConfig = {
        activeProvider: sttActiveProvider,
        providers: sttProviders,
        enabled: hasAnyKey || sttEnabled,
      };
      await api.setSttConfig(sttConfig);
      const c = await api.getApiConfig();
      setApiConfig(c);
      setSaveMsg("✅ 保存成功");
    } catch (e) {
      setSaveMsg(`❌ 保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const testConn = async (provider: string) => {
    const k = keys[provider];
    if (!k?.trim()) { setTestMsg(`请先填入 ${provider} API Key`); return; }
    const url = baseUrls[provider] || PROVIDERS.find(p => p.name === provider)?.base || "";
    try {
      await api.setApiConfig(url, apiConfig?.api_model || "deepseek-chat", k, provider);
      const r = await api.testApiConnection();
      setTestMsg(`[${provider}] ${r.message}`);
    } catch {
      setTestMsg(`[${provider}] 连接失败`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[520px] max-h-[85vh] rounded-lg bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <h2 className="font-semibold">设置</h2>
          <button type="button" onClick={() => setSettingsOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 二级导航 */}
        <div className="flex border-b border-slate-200 text-sm shrink-0">
          <button type="button" onClick={() => setTab("api")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "api" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <Settings2 size={15} /> API 配置
          </button>
          <button type="button" onClick={() => setTab("stt")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "stt" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <Mic size={15} /> 语音配置
          </button>
          <button type="button" onClick={() => setTab("snapshots")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "snapshots" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <History size={15} /> 快照管理
          </button>
          <button type="button" onClick={() => setTab("migrate")}
            className={`flex items-center gap-1.5 px-4 py-2.5 font-medium ${tab === "migrate" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}>
            <Download size={15} /> 数据迁移
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm space-y-3">
          {tab === "api" && (
            <>
              <p className="text-xs text-slate-500">每个厂商填入一次 API Key 即可使用该厂商下的所有模型。右上角切换模型。</p>
              {PROVIDERS.map(p => {
                const hasKey = !!keys[p.name];
                const showPwd = showKeys.has(p.name);
                return (
                  <div key={p.name} className={`rounded-lg border p-3 ${hasKey ? "border-green-200 bg-green-50/30" : "border-slate-100"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">{p.label}</span>
                      {hasKey && <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> 已配置</span>}
                    </div>
                    <div className="space-y-2">
                      <div className="relative">
                        <input type={showPwd ? "text" : "password"}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-xs outline-none focus:border-amber-400"
                          value={keys[p.name] || ""}
                          onChange={e => setKeys(prev => ({ ...prev, [p.name]: e.target.value }))}
                          placeholder={`输入 ${p.name} API Key…`} />
                        <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          onClick={() => setShowKeys(prev => { const n = new Set(prev); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n; })}>
                          {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] outline-none text-slate-500 focus:border-amber-400"
                          value={baseUrls[p.name] || p.base}
                          onChange={e => setBaseUrls(prev => ({ ...prev, [p.name]: e.target.value }))} />
                        <button type="button" onClick={() => testConn(p.name)}
                          className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] hover:bg-slate-200 shrink-0">测试</button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 自定义厂商区域 */}
              <div className="rounded-lg border border-dashed border-slate-300 p-3 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">自定义厂商</span>
                  <span className="text-[10px] text-slate-400">可添加任意 API 服务商（填入 Base URL 和 Key）</span>
                </div>

                {/* 已添加的自定义厂商列表 */}
                {customProviders.map((cp, idx) => (
                  <div key={idx} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-600">{cp.name}</span>
                      <button type="button"
                        className="text-[10px] text-red-500 hover:text-red-700"
                        onClick={() => {
                          setCustomProviders(prev => prev.filter((_, i) => i !== idx));
                          const newKeys = { ...keys };
                          delete newKeys[cp.name];
                          setKeys(newKeys);
                          const newUrls = { ...baseUrls };
                          delete newUrls[cp.name];
                          setBaseUrls(newUrls);
                        }}>移除</button>
                    </div>
                    <div className="space-y-1.5">
                      <input type="password"
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-amber-400"
                        value={cp.key}
                        onChange={e => {
                          const updated = [...customProviders];
                          updated[idx] = { ...updated[idx], key: e.target.value };
                          setCustomProviders(updated);
                        }}
                        placeholder="API Key…" />
                      <input className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] outline-none text-slate-500 focus:border-amber-400"
                        value={cp.baseUrl}
                        onChange={e => {
                          const updated = [...customProviders];
                          updated[idx] = { ...updated[idx], baseUrl: e.target.value };
                          setCustomProviders(updated);
                        }}
                        placeholder="API Base URL（例如 https://api.example.com）" />
                      {/* 模型列表 */}
                      <div>
                        <p className="mb-1 text-[10px] font-medium text-slate-500">可用模型</p>
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {cp.models.map((m, mi) => (
                            <span key={mi}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                              {m}
                              <button type="button"
                                className="text-slate-400 hover:text-red-500"
                                onClick={() => {
                                  const updated = [...customProviders];
                                  updated[idx] = { ...updated[idx], models: cp.models.filter((_, i) => i !== mi) };
                                  setCustomProviders(updated);
                                }}>×</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <input className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] outline-none focus:border-amber-400"
                            placeholder="输入模型名（如 qwen-max）"
                            id={`model-input-${idx}`}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const val = (e.target as HTMLInputElement).value.trim();
                                if (val && !cp.models.includes(val)) {
                                  const updated = [...customProviders];
                                  updated[idx] = { ...updated[idx], models: [...cp.models, val] };
                                  setCustomProviders(updated);
                                }
                                (e.target as HTMLInputElement).value = "";
                              }
                            }} />
                          <button type="button"
                            className="rounded-md bg-amber-100 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-200"
                            onClick={() => {
                              const input = document.getElementById(`model-input-${idx}`) as HTMLInputElement;
                              const val = input?.value?.trim();
                              if (val && !cp.models.includes(val)) {
                                const updated = [...customProviders];
                                updated[idx] = { ...updated[idx], models: [...cp.models, val] };
                                setCustomProviders(updated);
                              }
                              if (input) input.value = "";
                            }}>+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* 添加新自定义厂商 */}
                <div className="flex items-center gap-2">
                  <input className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-amber-400"
                    value={newCustomName}
                    onChange={e => setNewCustomName(e.target.value)}
                    placeholder="输入厂商名称…"
                    onKeyDown={e => {
                      if (e.key === "Enter" && newCustomName.trim()) {
                        setCustomProviders(prev => [...prev, { name: newCustomName.trim(), key: "", baseUrl: "", models: [] }]);
                        setNewCustomName("");
                      }
                    }} />
                  <button type="button"
                    className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-200 disabled:opacity-40"
                    disabled={!newCustomName.trim()}
                    onClick={() => {
                      setCustomProviders(prev => [...prev, { name: newCustomName.trim(), key: "", baseUrl: "", models: [] }]);
                      setNewCustomName("");
                    }}>+ 添加</button>
                </div>
              </div>
            </>
          )}

          {tab === "stt" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">每个厂商独立配置 API Key。切换到该厂商时自动使用对应的 Key。</p>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <input type="checkbox" checked={sttEnabled} onChange={e => setSttEnabled(e.target.checked)} className="rounded" />
                  启用语音输入
                </label>
              </div>

              {/* 预设厂商列表 */}
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
                          onChange={() => setSttActiveProvider(name)}
                          className="text-amber-500" />
                        <span className="text-sm font-medium text-slate-700">{sttPresetLabel(name)}</span>
                        {isCustom && (
                          <button type="button" className="text-[10px] text-red-500 hover:text-red-700"
                            onClick={() => {
                              const next = { ...sttProviders };
                              delete next[name];
                              setSttProviders(next);
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

              {/* 添加自定义 STT 厂商 */}
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
          )}

          {tab === "snapshots" && (
            <SnapshotManager />
          )}
          {tab === "migrate" && (
            <DataMigration />
          )}

          {testMsg && (
            <div className={`rounded-lg px-3 py-2 text-xs ${testMsg.includes("成功") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {testMsg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3 shrink-0">
          {saveMsg && (
            <span className={`mr-auto text-xs ${saveMsg.startsWith("✅") ? "text-green-600" : "text-red-600"}`}>
              {saveMsg}
            </span>
          )}
          <button type="button" className="rounded-lg px-3 py-1.5 text-xs hover:bg-slate-100" onClick={() => setSettingsOpen(false)}>
            取消
          </button>
          <button type="button" disabled={saving}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-40"
            onClick={save}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 快照管理面板 */
function SnapshotManager() {
  const { currentProject } = useAppStore();
  const [snaps, setSnaps] = useState<{ id: string; label: string; timestamp: string }[]>([]);
  const [restoreMsg, setRestoreMsg] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (currentProject) {
      setSnaps(listSnapshots(currentProject.id));
    }
  }, [currentProject]);

  const handleCreate = useCallback(() => {
    if (!currentProject) return;
    const label = `手动快照 ${new Date().toLocaleString("zh-CN")}`;
    createSnapshot(currentProject.id, label);
    setSnaps(listSnapshots(currentProject.id));
    setRestoreMsg("✅ 快照已创建");
    setTimeout(() => setRestoreMsg(""), 2000);
  }, [currentProject]);

  const handleRestore = useCallback((snapId: string) => {
    if (!currentProject) return;
    setConfirmId(snapId);
  }, [currentProject]);

  const confirmRestore = useCallback(() => {
    if (!currentProject || !confirmId) return;
    const ok = restoreSnapshot(currentProject.id, confirmId);
    if (ok) {
      setRestoreMsg("✅ 已回退到该快照");
      setConfirmId(null);
    } else {
      setRestoreMsg("❌ 回退失败");
    }
    setTimeout(() => setRestoreMsg(""), 3000);
  }, [currentProject, confirmId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">快照记录了某个时间点所有章节摘要、角色状态和故事线进度。回退后可撤销。</p>
        <button type="button" onClick={handleCreate}
          className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700">
          <RotateCcw size={13} />
          创建快照
        </button>
      </div>

      {snaps.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-400">暂无快照。定稿章节时会自动创建快照，也可手动创建。</p>
      ) : (
        <div className="space-y-1">
          {[...snaps].reverse().map(snap => (
            <div key={snap.id} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-700">{snap.label}</p>
                <p className="text-xs text-slate-400">{new Date(snap.timestamp).toLocaleString("zh-CN")}</p>
              </div>
              <div className="flex items-center gap-2">
                {confirmId === snap.id ? (
                  <>
                    <button type="button" onClick={confirmRestore}
                      className="rounded-md bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600">确认回退</button>
                    <button type="button" onClick={() => setConfirmId(null)}
                      className="rounded-md border px-3 py-1 text-xs hover:bg-slate-50">取消</button>
                  </>
                ) : (
                  <button type="button" onClick={() => handleRestore(snap.id)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1 text-xs text-slate-600 hover:bg-amber-50 hover:border-amber-200">
                    <History size={12} />
                    回退
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {restoreMsg && (
        <div className={`rounded-lg px-3 py-2 text-xs ${restoreMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          <div className="flex items-center gap-1.5">
            {restoreMsg.startsWith("❌") && <AlertTriangle size={13} />}
            {restoreMsg}
          </div>
        </div>
      )}
    </div>
  );
}

/** 数据迁移：导出/导入全部 localStorage 数据 */
function DataMigration() {
  const [msg, setMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 收集所有项目相关 localStorage key */
  const collectKeys = useCallback((): { key: string; value: string }[] => {
    const keys: { key: string; value: string }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // 只导出应用相关数据
      if (
        key === "novel-workbench-mock" ||
        key.startsWith("novel-workbench-") ||
        key.startsWith("plot-") ||
        key.startsWith("char-groups-") ||
        key.startsWith("inspiration-cards-") ||
        key.startsWith("material-") ||
        key.startsWith("writing-sidebar-width-") ||
        key.startsWith("ai-pending-chars-") ||
        key.startsWith("ai-pending-world-terms-")
      ) {
        const value = localStorage.getItem(key);
        if (value) keys.push({ key, value });
      }
    }
    return keys;
  }, []);

  /** 导出全部数据为 JSON 文件 */
  const handleExport = useCallback(() => {
    const data = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      keys: collectKeys(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `执笔数据备份_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("✅ 数据已导出");
    setTimeout(() => setMsg(""), 2000);
  }, [collectKeys]);

  /** 导入数据文件 */
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMsg("");
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.keys || !Array.isArray(data.keys)) {
        setMsg("❌ 无效的备份文件");
        setImporting(false);
        return;
      }
      // 逐个写入 localStorage
      for (const { key, value } of data.keys) {
        if (key && value) localStorage.setItem(key, value);
      }
      setMsg(`✅ 成功导入 ${data.keys.length} 项数据，请刷新页面生效`);
    } catch (e) {
      setMsg(`❌ 导入失败：${e instanceof Error ? e.message : "文件格式错误"}`);
    }
    setImporting(false);
    // 清空 input 以便再次选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">导出数据</h3>
        <p className="text-xs text-slate-500 mb-3">
          将所有作品数据（项目、大纲、角色、正文、素材、灵感等）导出为 JSON 文件，
          换电脑后可通过「导入」恢复。
        </p>
        <button type="button" onClick={handleExport}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600">
          <Download size={15} />
          导出全部数据
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">导入数据</h3>
        <p className="text-xs text-slate-500 mb-3">
          选择之前导出的备份 JSON 文件，恢复全部数据。
          <span className="text-amber-600 font-medium"> 注意：会覆盖当前所有数据，建议先导出备份。</span>
        </p>
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport}
          className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-50 file:px-4 file:py-2 file:text-sm file:text-amber-700 hover:file:bg-amber-100" />
      </div>

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-xs ${msg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          <div className="flex items-center gap-1.5">
            {msg.startsWith("❌") && <AlertTriangle size={13} />}
            {msg}
          </div>
        </div>
      )}
    </div>
  );
}
