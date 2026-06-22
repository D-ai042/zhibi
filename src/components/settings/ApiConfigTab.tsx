// ApiConfigTab.tsx — API 配置标签页（T9 拆分，从 SettingsModal 完整迁移）
// fix: ① Key 保存不丢失 ② 测试按钮真实反馈 ③ 固定厂商可改模型 ④ 自定义厂商 URL 不自动拼接
import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Check, AlertTriangle } from "lucide-react";
import { api, isTauri } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { CustomProviderSection, type CustomProviderEntry } from "./CustomProviderSection";

/** 每个预设厂商独立维护模型列表（可手动增删） */
interface ProviderDef {
  name: string; label: string;
  base: string;
  defaultModels: string[];
}

const PROVIDERS: ProviderDef[] = [
  { name: "DeepSeek", label: "DeepSeek", base: "https://api.deepseek.com", defaultModels: ["deepseek-chat"] },
  { name: "OpenAI", label: "OpenAI", base: "https://api.openai.com", defaultModels: ["gpt-4o", "gpt-4o-mini"] },
  { name: "Anthropic", label: "Anthropic", base: "https://api.anthropic.com", defaultModels: ["claude-sonnet-4-20250514"] },
  { name: "阿里云", label: "阿里云（通义千问）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModels: ["qwen-plus", "qwen-max"] },
  { name: "智谱", label: "智谱（GLM）", base: "https://open.bigmodel.cn/api/paas/v4", defaultModels: ["glm-4-plus"] },
  { name: "月之暗面", label: "月之暗面（Moonshot）", base: "https://api.moonshot.cn/v1", defaultModels: ["moonshot-v1-8k"] },
  { name: "百川智能", label: "百川智能", base: "https://api.baichuan-ai.com/v1", defaultModels: ["Baichuan4"] },
  { name: "零一万物", label: "零一万物（Yi）", base: "https://api.lingyiwanwu.com/v1", defaultModels: ["yi-large"] },
  { name: "硅基流动", label: "硅基流动（SiliconFlow）", base: "https://api.siliconflow.cn/v1", defaultModels: ["Qwen/Qwen2.5-7B-Instruct"] },
  { name: "小米", label: "小米（Xiaomi MiMo）", base: "https://api.xiaomimimo.com", defaultModels: ["mimo-v2.5-pro"] },
];


/** 管理单个预设厂商的模型列表 */
function useProviderModels(apiConfig: any, providers: ProviderDef[]) {
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!apiConfig) return;
    const pm: Record<string, string[]> = {};
    for (const p of providers) {
      const saved = apiConfig.provider_models?.[p.name];
      pm[p.name] = (saved !== undefined) ? saved : [...p.defaultModels];
    }
    setProviderModels(pm);
  }, [apiConfig, providers]);

  return { providerModels, setProviderModels };
}

export function ApiConfigTab() {
  const { apiConfig, setApiConfig } = useAppStore();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [testMsg, setTestMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [customProviders, setCustomProviders] = useState<CustomProviderEntry[]>([]);
  const { providerModels, setProviderModels } = useProviderModels(apiConfig, PROVIDERS);

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
      // ★ 修复 ①：保存固定厂商的 Key + BaseURL + 模型列表（一次写入，不逐厂商循环覆盖）
      for (const p of PROVIDERS) {
        const k = keys[p.name] || "";
        const url = baseUrls[p.name] || p.base;
        // ★ 只传 providerName + apiKey + baseUrl，不传 model（避免覆写全局 api_model）
        await api.setApiConfig(url, undefined as any, k, p.name);
      }
      // ★ 修复 ③：保存固定厂商的自定义模型列表（始终写入，空数组=清空）
      for (const p of PROVIDERS) {
        const models = providerModels[p.name] || [];
        await api.setProviderModels(p.name, models);
      }
      // 保存自定义厂商
      const currentNames = new Set(customProviders.map(cp => cp.name.trim()).filter(Boolean));
      const previousNames = new Set(
        Object.keys(apiConfig?.provider_keys || {}).filter(n => !PROVIDERS.map(p => p.name).includes(n) && n !== "custom")
      );
      for (const n of Object.keys(apiConfig?.provider_models || {})) {
        if (!PROVIDERS.map(p => p.name).includes(n)) previousNames.add(n);
      }
      for (const cp of customProviders) {
        if (cp.name.trim()) {
          // ★ 修复 ④：自定义厂商不自动填充默认 URL，必须用户手动填写
          await api.setApiConfig(cp.baseUrl || "", undefined as any, cp.key || "", cp.name.trim());
        }
        await api.setProviderModels(cp.name.trim(), cp.models);
      }
      // 清理已删除的自定义厂商
      for (const name of previousNames) {
        if (!currentNames.has(name)) {
          await api.setApiConfig("", undefined as any, "", name);
          await api.setProviderModels(name, []);
        }
      }
      const newCfg = await api.getApiConfig();
      if (newCfg) setApiConfig(newCfg);
      setSaveMsg("✅ 已保存"); setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: any) { setSaveMsg(`❌ ${e?.message || e}`); }
    setSaving(false);
  }, [keys, baseUrls, customProviders, providerModels, apiConfig, setApiConfig]);

  // ★ 修复 ②：测试按钮在浏览器模式显示真实提示
  const testConn = useCallback(async (provider: string) => {
    const k = keys[provider];
    if (!k?.trim()) { setTestMsg(`⚠️ 请先填入 ${provider} API Key`); setTimeout(() => setTestMsg(""), 3000); return; }
    if (!isTauri()) {
      setTestMsg("💡 浏览器模式无法真实测试，请打包为 EXE 后测试");
      setTimeout(() => setTestMsg(""), 4000);
      return;
    }
    const url = baseUrls[provider] || PROVIDERS.find(p => p.name === provider)?.base || "";
    try {
      await api.setApiConfig(url, undefined as any, k, provider);
      const r = await api.testApiConnection();
      setTestMsg(`[${provider}] ${r.ok ? "✅ 连接成功" : "❌ " + r.message}`);
    } catch { setTestMsg(`[${provider}] ❌ 连接失败`); }
    setTimeout(() => setTestMsg(""), 5000);
  }, [keys, baseUrls]);

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">API 配置</h3>
          <p className="text-xs text-slate-400">选择 AI 服务商并填入 API Key</p>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
      {saveMsg && <p className={`text-xs mb-2 ${saveMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>{saveMsg}</p>}
      {testMsg && <p className={`text-xs mb-2 flex items-center gap-1 ${testMsg.startsWith("⚠️") || testMsg.startsWith("❌") ? "text-amber-600" : "text-slate-500"}`}><AlertTriangle size={12} />{testMsg}</p>}
      <p className="text-xs text-slate-500">每个厂商填入一次 API Key 即可使用该厂商下的所有模型。右上角切换模型。</p>
      {PROVIDERS.map(p => {
        const hasKey = !!keys[p.name];
        const showPwd = showKeys.has(p.name);
        const models = providerModels[p.name] || [];
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
              {/* ★ 修复 ③：固定厂商的模型名可编辑 */}
              <div>
                <p className="mb-1 text-[10px] font-medium text-slate-500">可用模型 <span className="font-normal text-slate-400">（模型名须与 API 文档一致）</span></p>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {models.map((m, mi) => (
                    <span key={mi} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                      {m}
                      <button type="button" className="text-slate-400 hover:text-red-500"
                        onClick={() => setProviderModels(prev => ({ ...prev, [p.name]: models.filter((_, i) => i !== mi) }))}>×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] outline-none focus:border-amber-400"
                    placeholder="输入模型名"
                    id={`model-input-${p.name}`}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val && !models.includes(val)) {
                          setProviderModels(prev => ({ ...prev, [p.name]: [...models, val] }));
                        }
                        (e.target as HTMLInputElement).value = "";
                      }
                    }} />
                  <button type="button" className="rounded-md bg-amber-100 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-200"
                    onClick={() => {
                      const input = document.getElementById(`model-input-${p.name}`) as HTMLInputElement;
                      const val = input?.value?.trim();
                      if (val && !models.includes(val)) {
                        setProviderModels(prev => ({ ...prev, [p.name]: [...models, val] }));
                      }
                      if (input) input.value = "";
                    }}>+</button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <CustomProviderSection
        customProviders={customProviders} setCustomProviders={setCustomProviders}
        keys={keys} setKeys={setKeys}
        baseUrls={baseUrls} setBaseUrls={setBaseUrls}
      />
    </>
  );
}
