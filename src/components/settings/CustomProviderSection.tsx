// CustomProviderSection.tsx — T9 拆分：自定义厂商管理区域（从 ApiConfigTab 提取）
import { useState } from "react";

export interface CustomProviderEntry { name: string; key: string; baseUrl: string; models: string[]; }

interface Props {
  customProviders: CustomProviderEntry[];
  setCustomProviders: React.Dispatch<React.SetStateAction<CustomProviderEntry[]>>;
  keys: Record<string, string>;
  setKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  baseUrls: Record<string, string>;
  setBaseUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function CustomProviderSection({ customProviders, setCustomProviders, keys, setKeys, baseUrls, setBaseUrls }: Props) {
  const [newCustomName, setNewCustomName] = useState("");

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3 mt-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">自定义厂商</span>
        <span className="text-[10px] text-slate-400">可添加任意 API 服务商（须自行填写完整 Base URL）</span>
      </div>

      {customProviders.map((cp, idx) => (
        <div key={idx} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-600">{cp.name}</span>
            <button type="button"
              className="text-[10px] text-red-500 hover:text-red-700"
              onClick={() => {
                setCustomProviders(prev => prev.filter((_, i) => i !== idx));
                const newKeys = { ...keys }; delete newKeys[cp.name]; setKeys(newKeys);
                const newUrls = { ...baseUrls }; delete newUrls[cp.name]; setBaseUrls(newUrls);
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
              placeholder="完整 Base URL（例：https://api.example.com/v1）" />
            <div>
              <p className="mb-1 text-[10px] font-medium text-slate-500">可用模型</p>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {cp.models.map((m, mi) => (
                  <span key={mi} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                    {m}
                    <button type="button" className="text-slate-400 hover:text-red-500"
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
                  placeholder="输入模型名"
                  id={`custom-model-input-${idx}`}
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
                <button type="button" className="rounded-md bg-amber-100 px-2 py-1 text-[10px] text-amber-700 hover:bg-amber-200"
                  onClick={() => {
                    const input = document.getElementById(`custom-model-input-${idx}`) as HTMLInputElement;
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
  );
}
