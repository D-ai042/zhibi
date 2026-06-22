// ApiConfigTab.tsx — API 配置标签页（T9：重构为使用 app-store + api 模块）
import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";

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

interface CustomProviderEntry { name: string; key: string; baseUrl: string; models: string[]; }

export function ApiConfigTab() {
  const { apiConfig, setApiConfig } = useAppStore();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [testMsg, setTestMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [customProviders, setCustomProviders] = useState<CustomProviderEntry[]>([]);
  const [newCustomName, setNewCustomName] = useState("");

  useEffect(() => {
    if (apiConfig) {
      setKeys(apiConfig.provider_keys || {});
      setBaseUrls(apiConfig.provider_base_urls || {});
      const definedNames = new Set(PROVIDERS.map(p => p.name));
      const custom: CustomProviderEntry[] = [];
      for (const name of Object.keys(apiConfig.provider_keys || {})) {
        if (!definedNames.has(name) && name !== "custom") {
          const key = apiConfig.provider_keys[name] || "";
          const models = apiConfig.provider_models?.[name] || [];
          if (!key && models.length === 0) continue;
          custom.push({ name, key, baseUrl: apiConfig.provider_base_urls[name] || "", models });
        }
      }
      for (const name of Object.keys(apiConfig.provider_models || {})) {
        if (!definedNames.has(name) && !custom.some(c => c.name === name)) {
          const models = apiConfig.provider_models![name] || [];
          if (models.length === 0) continue;
          custom.push({ name, key: apiConfig.provider_keys?.[name] || "", baseUrl: apiConfig.provider_base_urls?.[name] || "", models });
        }
      }
      setCustomProviders(custom);
    }
  }, [apiConfig]);

  const save = useCallback(async () => {
    setSaving(true); setSaveMsg("");
    try {
      for (const p of PROVIDERS) {
        const k = keys[p.name] || "";
        const url = baseUrls[p.name] || p.base;
        await api.setApiConfig(url, apiConfig?.api_model || "deepseek-chat", k, p.name);
      }
      const currentNames = new Set(customProviders.map(cp => cp.name.trim()).filter(Boolean));
      const previousNames = new Set(
        Object.keys(apiConfig?.provider_keys || {}).filter(n => !PROVIDERS.map(p => p.name).includes(n) && n !== "custom")
      );
      for (const n of Object.keys(apiConfig?.provider_models || {})) {
        if (!PROVIDERS.map(p => p.name).includes(n)) previousNames.add(n);
      }
      for (const cp of customProviders) {
        if (cp.name.trim()) {
          await api.setApiConfig(cp.baseUrl || "https://api.openai.com/v1", apiConfig?.api_model || "deepseek-chat", cp.key || "", cp.name.trim());
        }
        if (cp.name.trim() && cp.models.length > 0) await api.setProviderModels(cp.name.trim(), cp.models);
      }
      for (const name of previousNames) {
        if (!currentNames.has(name)) {
          await api.setApiConfig("https://api.openai.com/v1", apiConfig?.api_model || "deepseek-chat", "", name);
          await api.setProviderModels(name, []);
        }
      }
      const newCfg = await api.getApiConfig();
      if (newCfg) setApiConfig(newCfg);
      setSaveMsg("✅ 已保存"); setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: any) { setSaveMsg(`❌ ${e?.message || e}`); }
    setSaving(false);
  }, [keys, baseUrls, customProviders, apiConfig, setApiConfig]);

  const testConn = useCallback(async () => {
    setTestMsg("测试中...");
    try { const r = await api.testApiConnection(); setTestMsg(r?.message || (r?.ok ? "✅ 连接成功" : "❌ 连接失败")); }
    catch { setTestMsg("❌ 连接失败"); }
  }, []);

  const addCustom = () => {
    const name = newCustomName.trim();
    if (!name || PROVIDERS.some(p => p.name === name) || customProviders.some(c => c.name === name)) return;
    setCustomProviders(prev => [...prev, { name, key: "", baseUrl: "https://api.openai.com/v1", models: [] }]);
    setNewCustomName("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div><h3 className="text-sm font-semibold text-slate-700">API 配置</h3><p className="text-xs text-slate-400">选择 AI 服务商并填入 API Key</p></div>
        <div className="flex gap-2">
          <button onClick={testConn} className="rounded-md border px-3 py-1 text-xs hover:bg-slate-50">测试连接</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-violet-600 px-4 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
      {saveMsg && <p className={`text-xs ${saveMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>{saveMsg}</p>}
      {testMsg && <p className={`text-xs ${testMsg.includes("成功") ? "text-green-600" : testMsg.includes("测试") ? "text-slate-400" : "text-red-500"}`}>{testMsg}</p>}

      {PROVIDERS.map(p => (
        <div key={p.name} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{p.label}</span>
          </div>
          <div className="flex gap-1">
            <input type={showKeys.has(p.name) ? "text" : "password"} value={keys[p.name] || ""}
              onChange={e => setKeys(prev => ({ ...prev, [p.name]: e.target.value }))}
              placeholder="sk-..." className="flex-1 rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
            <button onClick={() => setShowKeys(prev => { const s = new Set(prev); s.has(p.name) ? s.delete(p.name) : s.add(p.name); return s; })}
              className="rounded border px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">{showKeys.has(p.name) ? "隐藏" : "显示"}</button>
          </div>
          <input type="text" value={baseUrls[p.name] || p.base}
            onChange={e => setBaseUrls(prev => ({ ...prev, [p.name]: e.target.value }))}
            className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" placeholder="API 地址" />
        </div>
      ))}

      {customProviders.length > 0 && <div className="border-t pt-2"><p className="text-xs font-medium text-slate-600 mb-2">自定义厂商</p>
        {customProviders.map(cp => (
          <div key={cp.name} className="rounded-lg border p-3 space-y-2 mb-2">
            <span className="text-sm font-medium">{cp.name}</span>
            <input type={showKeys.has(cp.name) ? "text" : "password"} value={cp.key}
              onChange={e => setCustomProviders(prev => prev.map(c => c.name === cp.name ? { ...c, key: e.target.value } : c))}
              placeholder="API Key" className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
            <input type="text" value={cp.baseUrl}
              onChange={e => setCustomProviders(prev => prev.map(c => c.name === cp.name ? { ...c, baseUrl: e.target.value } : c))}
              className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
          </div>
        ))}
      </div>}

      <div className="flex gap-1">
        <input type="text" value={newCustomName} onChange={e => setNewCustomName(e.target.value)}
          placeholder="自定义厂商名称" className="flex-1 rounded border px-2 py-1 text-xs outline-none focus:border-violet-400" />
        <button onClick={addCustom} className="rounded border px-3 py-1 text-xs hover:bg-slate-50">添加</button>
      </div>
    </div>
  );
}
