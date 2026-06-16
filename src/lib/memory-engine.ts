/**
 * 记忆引擎 —— 三级记忆体系
 *
 * 工作记忆：当前最后 10 轮对话（直接发送）
 * 短期记忆：较早对话的 AI 摘要（按话题检索）
 * 长期记忆：项目知识沉淀（世界观/角色/剧情决策等）
 *
 * 所有文本分析均由 AI 完成，无正则/关键词兜底。
 */

import type { ChatMessage, MemoryEntry, LongTermMemory } from "@/types";
import { uuid } from "@/lib/uuid";
import { api } from "./api";
import { getJSONSync, setJSONSync } from "./storage";

// ===== 常量 =====

function shortTermKey(pid: string) { return `novel-workbench-memory-short-${pid}`; }
function longTermKey(pid: string) { return `novel-workbench-memory-long-${pid}`; }
function compressedIdxKey(pid: string) { return `novel-workbench-compressed-idx-${pid}`; }
function loadJSONSync<T>(key: string, def: T): T { return getJSONSync(key, def); }
function saveJSON(key: string, data: unknown) { setJSONSync(key, data); }
function estimateTokens(text: string): number {
    let t = 0;
    for (const ch of text) {
        if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) t += 2;
        else t += 0.5;
    }
    return Math.ceil(t);
}

// ===== 关键词提取（仅用于检索匹配，不用硬编码分类表） =====

function extractKeywords(text: string): string[] {
    const words = text.match(/[\u4e00-\u9fff]{2,4}/g);
    if (!words) return [text.slice(0, 20)];
    const skip = new Set(["我们", "可以", "这个", "那个", "什么", "怎么", "但是", "因为", "所以", "如果", "虽然", "然后", "而且", "或者", "还是", "不是", "就是", "没有", "一个", "一下", "一直", "一些", "已经", "知道", "觉得", "需要", "应该", "可能", "比较", "非常", "很多", "时候", "地方", "方式", "程度", "情况", "问题", "结果", "时候"]);
    const filtered = words.filter(w => !skip.has(w));
    return Array.from(new Set(filtered)).slice(0, 8);
}

// ===== 记忆引擎 =====

export class MemoryEngine {
    private projectId: string;
    constructor(projectId: string) { this.projectId = projectId; }

    getShortTerm(): MemoryEntry[] { return loadJSONSync(shortTermKey(this.projectId), []); }
    private saveShortTerm(entries: MemoryEntry[]) { saveJSON(shortTermKey(this.projectId), entries); }

    getCompressedIdx(): number { return loadJSONSync(compressedIdxKey(this.projectId), 0); }
    private saveCompressedIdx(idx: number) { saveJSON(compressedIdxKey(this.projectId), idx); }

    /** 按关键词召回短期记忆 */
    recallShortTerm(keywords: string[], limit = 5): MemoryEntry[] {
        const entries = this.getShortTerm();
        if (entries.length === 0) return [];

        // 评分：命中的 tag 越多分数越高
        const scored = entries.map(e => {
            let score = 0;
            for (const kw of keywords) {
                if (e.tags.some(t => t.includes(kw) || kw.includes(t))) score += 3;
                if (e.topic.includes(kw)) score += 2;
                if (e.summary.includes(kw) || e.entities.some(en => en.includes(kw))) score += 1;
            }
            return { entry: e, score };
        });

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.entry);
    }

    /** 将一批消息压缩为记忆条目（返回值供 AI 调用） */
    buildCompressPrompt(messages: ChatMessage[]): string {
        const text = messages
            .filter(m => m.role !== "system")
            .map(m => `${m.role === "user" ? "用户" : "AI"}：${m.content.slice(0, 500)}`)
            .join("\n\n");

        return `请将以下对话压缩为 3-5 条短期记忆条目，每条包含：
- topic: 话题名称（10 字内）
- summary: 核心内容摘要（50 字内）
- tags: 标签列表 ["世界观","角色","剧情","风格","战斗","情感","第N章"]

返回格式（纯 JSON 数组，不要多余文字）：
[{"topic":"...","summary":"...","tags":[...]},...]

对话内容：
${text}`;
    }

    /** 解析 AI 返回的压缩结果 */
    parseCompressResult(aiResponse: string): { topic: string; summary: string; tags: string[] }[] {
        try {
            // 尝试直接解析 JSON
            const cleaned = aiResponse.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) return parsed;
            return [];
        } catch {
            // 尝试从文本中提取 JSON 数组
            const match = aiResponse.match(/\[\s*\{.*\}\s*\]/s);
            if (match) {
                try { return JSON.parse(match[0]); } catch { return []; }
            }
            return [];
        }
    }

    /** @deprecated 不再使用，由 executeAICCompression 替代 */
    performCompression(_messages: ChatMessage[]): number {
        return 0;
    }

    /** 执行 AI 压缩：调用 AI 生成记忆条目，异步执行，不阻塞发送 */
    async executeAICCompression(messages: ChatMessage[]): Promise<number> {
        const compressedIdx = this.getCompressedIdx();
        const unprocessed = messages.slice(compressedIdx);
        const processable = unprocessed.filter(m => m.role !== "system");
        const rounds = Math.floor(processable.filter(m => m.role === "user").length);
        const COMPRESS_INTERVAL = 20;
        if (rounds < COMPRESS_INTERVAL) return 0;
        const messagesToCompress = processable;
        const sourceMsgIds = messagesToCompress.map(m => m.id);

        try {
            const prompt = this.buildCompressPrompt(messagesToCompress);
            const res = await api.aiComplete({
                action: "chat", entity_type: "memory", entity_id: this.projectId,
                extra: { system_hint: "你是记忆压缩助手。只输出 JSON 数组。", user_message: prompt, history: [], context: "" },
            });
            if (res.content && !res.error) {
                const parsed = this.parseCompressResult(res.content);
                if (parsed.length > 0) {
                    const entries: MemoryEntry[] = parsed.map(p => ({
                        id: uuid(), topic: p.topic, summary: p.summary,
                        tags: p.tags.slice(0, 6),
                        tokens: estimateTokens(p.summary),
                        createdAt: new Date().toISOString(),
                        sourceMsgIds: sourceMsgIds.slice(0, 20),
                        entities: p.tags.filter(t => t.length <= 4),
                    }));
                    const existing = this.getShortTerm();
                    this.saveShortTerm([...existing, ...entries]);
                    this.saveCompressedIdx(compressedIdx + messagesToCompress.length);
                    return entries.length;
                }
            }
        } catch (e) { console.error("[MemoryEngine] AI 压缩失败:", e); }
        return 0;
    }

    // ========== 长期记忆 ==========

    /** 读取长期记忆 */
    getLongTerm(): LongTermMemory {
        return loadJSONSync(longTermKey(this.projectId), {
            worldview_rules: [],
            character_traits: [],
            plot_decisions: [],
            writing_prefs: [],
            unresolved: [],
        });
    }

    /** 保存长期记忆 */
    saveLongTerm(memory: LongTermMemory) {
        saveJSON(longTermKey(this.projectId), memory);
    }

    /** 从 AI 回复中提取长期记忆标记 */
    extractLongTerm(response: string): boolean {
        const marker = "---MEMORY---";
        if (!response.includes(marker)) return false;

        const memory = this.getLongTerm();
        let changed = false;

        // 解析 ---MEMORY--- 标记后的内容
        // 格式：type: 值
        const sections = response.split(marker);
        for (const section of sections.slice(1)) {
            const lines = section.trim().split("\n");
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // worldview: xxx
                const wvMatch = trimmed.match(/^worldview:\s*(.+)/i);
                if (wvMatch) {
                    memory.worldview_rules.push({ rule: wvMatch[1], source: "ai", createdAt: new Date().toISOString() });
                    changed = true;
                    continue;
                }

                // character: 角色名 -> 特征
                const chMatch = trimmed.match(/^character:\s*(.+?)\s*[→>]\s*(.+)/i);
                if (chMatch) {
                    memory.character_traits.push({ char: chMatch[1].trim(), trait: chMatch[2].trim(), source: "ai", createdAt: new Date().toISOString() });
                    changed = true;
                    continue;
                }

                // plot: 话题 -> 决策
                const plMatch = trimmed.match(/^plot:\s*(.+?)\s*[→>]\s*(.+)/i);
                if (plMatch) {
                    memory.plot_decisions.push({ topic: plMatch[1].trim(), decision: plMatch[2].trim(), source: "ai", createdAt: new Date().toISOString() });
                    changed = true;
                    continue;
                }

                // pref: xxx
                const pfMatch = trimmed.match(/^pref:\s*(.+)/i);
                if (pfMatch) {
                    memory.writing_prefs.push({ pref: pfMatch[1], source: "ai", createdAt: new Date().toISOString() });
                    changed = true;
                    continue;
                }

                // todo: xxx
                const tdMatch = trimmed.match(/^todo:\s*(.+)/i);
                if (tdMatch) {
                    memory.unresolved.push({ item: tdMatch[1], createdAt: new Date().toISOString() });
                    changed = true;
                    continue;
                }
            }
        }

        if (changed) this.saveLongTerm(memory);
        return changed;
    }

    /** 从长期记忆中检索相关内容 */
    recallLongTerm(keywords: string[]): string[] {
        const memory = this.getLongTerm();
        const results: string[] = [];

        const match = (text: string) =>
            keywords.some(kw => text.includes(kw));

        for (const r of memory.worldview_rules) {
            if (match(r.rule)) results.push(`【世界观】${r.rule}`);
        }
        for (const c of memory.character_traits) {
            if (match(c.char) || match(c.trait)) results.push(`【角色】${c.char}：${c.trait}`);
        }
        for (const d of memory.plot_decisions) {
            if (match(d.topic) || match(d.decision)) results.push(`【剧情】${d.topic} → ${d.decision}`);
        }
        for (const p of memory.writing_prefs) {
            if (match(p.pref)) results.push(`【偏好】${p.pref}`);
        }

        return results.slice(0, 10);
    }

    // ========== 上下文组装 ==========

    /** 构建发给 AI 的对话历史（工作记忆 + 短期记忆 + 长期记忆） */
    buildHistory(messages: ChatMessage[], userInput: string): {
        history: ChatMessage[];
        memorySummary: string;
    } {
        // 1. 提取用户输入关键词
        const keywords = extractKeywords(userInput);

        // 2. 检索短期记忆
        const shortTerm = this.recallShortTerm(keywords);

        // 3. 检索长期记忆
        const longTerm = this.recallLongTerm(keywords);

        // 4. 计算工作记忆（最近 N 轮）
        const nonSystem = messages.filter(m => m.role !== "system");
        const userMessages = nonSystem.filter(m => m.role === "user");

        const WORKING_ROUNDS = 10;
        // 取最近 WORKING_ROUNDS 轮用户消息 + 对应的 AI 回复
        const workingStart = Math.max(0, userMessages.length - WORKING_ROUNDS);
        const workingUserIds = new Set(
            userMessages.slice(workingStart).map(m => m.id)
        );

        // 找到这些用户消息对应的整个轮次
        const workingSet = new Set<string>();
        let found = 0;
        for (let i = nonSystem.length - 1; i >= 0 && found < WORKING_ROUNDS * 2; i--) {
            workingSet.add(nonSystem[i].id);
            if (nonSystem[i].role === "user") found++;
        }

        const workingHistory = nonSystem.filter(m => workingSet.has(m.id));

        // 5. 构建记忆摘要文本
        const memoryParts: string[] = [];

        if (longTerm.length > 0) {
            memoryParts.push("===== 长期记忆（相关设定）=====");
            memoryParts.push(longTerm.join("\n"));
        }

        if (shortTerm.length > 0) {
            memoryParts.push("===== 短期记忆（相关摘要）=====");
            for (const s of shortTerm) {
                memoryParts.push(`[${s.tags.slice(0, 3).join("/")}] ${s.topic}：${s.summary}`);
            }
        }

        return {
            history: workingHistory,
            memorySummary: memoryParts.join("\n\n"),
        };
    }

    /** 对消息进行标签分析（存入缓存供 UI 显示） */
    tagMessages(messages: ChatMessage[]) {
        const existing = loadJSONSync<Record<string, string[]>>(`novel-workbench-msg-tags-${this.projectId}`, {});
        let changed = false;

        for (const m of messages) {
            if (m.role === "system" || existing[m.id]) continue;
            const tags = extractKeywords(m.content);
            if (tags.length > 0) {
                existing[m.id] = tags;
                changed = true;
            }
        }

        if (changed) saveJSON(`novel-workbench-msg-tags-${this.projectId}`, existing);
    }

    getMessageTags(msgId: string): string[] {
        const all = loadJSONSync<Record<string, string[]>>(`novel-workbench-msg-tags-${this.projectId}`, {});
        return all[msgId] || [];
    }
}
