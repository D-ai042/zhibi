/**
 * 记忆引擎 —— 三级记忆体系
 *
 * 工作记忆：当前最后 10 轮对话（直接发送）
 * 短期记忆：较早对话的 AI 摘要（按话题检索）
 * 长期记忆：项目知识沉淀（世界观/角色/剧情决策等）
 */

import type { ChatMessage, MemoryEntry, LongTermMemory } from "@/types";
import { uuid } from "@/lib/uuid";

// ===== 常量 =====

/** 短期记忆存储 key */
function shortTermKey(pid: string) { return `novel-workbench-memory-short-${pid}`; }
/** 长期记忆存储 key */
function longTermKey(pid: string) { return `novel-workbench-memory-long-${pid}`; }
/** 消息的 tag 缓存 key */
function msgTagsKey(pid: string) { return `novel-workbench-msg-tags-${pid}`; }
/** 已压缩到的消息索引 */
function compressedIdxKey(pid: string) { return `novel-workbench-compressed-idx-${pid}`; }

/** 工作记忆轮数（直接发送给 AI） */
const WORKING_ROUNDS = 10;
/** 积累多少轮后触发压缩 */
const COMPRESS_INTERVAL = 20;
/** 召回的最大记忆条目数 */
const MAX_RECALL = 5;

// ===== 存储工具 =====

function loadJSON<T>(key: string, def: T): T {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : def; } catch { return def; }
}
function saveJSON(key: string, data: unknown) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota */ }
}

// ===== Token 估算 =====

function estimateTokens(text: string): number {
    let t = 0;
    for (const ch of text) {
        if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) t += 2;
        else t += 0.5;
    }
    return Math.ceil(t);
}

// ===== 主题词提取（简易版） =====

const TOPIC_KEYWORDS: Record<string, string[]> = {
    worldview: ["世界观", "世界", "规则", "势力", "地点", "设定", "背景", "世界设定"],
    character: ["角色", "人物", "性格", "关系", "身世", "外貌", "人设"],
    plot: ["剧情", "情节", "走向", "明线", "暗线", "主线", "支线", "伏笔"],
    style: ["风格", "文笔", "基调", "叙述", "文风", "语言"],
    chapter: ["章节", "章", "节", "内容", "写作", "写"],
    battle: ["战斗", "打斗", "功法", "修炼", "境界", "实力"],
    emotion: ["情感", "感情", "爱情", "友情", "亲情", "内心"],
};

function extractTags(text: string): string[] {
    const tags = new Set<string>();
    for (const [tag, keywords] of Object.entries(TOPIC_KEYWORDS)) {
        if (keywords.some(kw => text.includes(kw))) tags.add(tag);
    }
    // 找连续 2-4 个中文字符
    const names = text.match(/[\u4e00-\u9fff]{2,4}/g);
    if (names) {
        // 过滤常见非名字词汇
        const skip = new Set(["世界观", "角色", "人物", "剧情", "章节", "风格", "大纲", "故事", "我们", "可以", "这个", "那个", "什么", "怎么", "但是", "因为", "所以", "如果", "虽然", "然后", "而且", "或者", "还是", "不是", "就是", "没有", "一个", "一下", "一直", "一些", "已经", "知道", "觉得", "需要", "应该", "可能", "比较", "非常", "很多", "时候", "地方", "方式", "程度", "情况", "问题", "结果", "时候"]);
        for (const n of names) {
            if (!skip.has(n) && n.length >= 2) tags.add(n);
        }
    }
    return Array.from(tags).slice(0, 8);
}

// ===== 记忆引擎 =====

export class MemoryEngine {
    private projectId: string;

    constructor(projectId: string) {
        this.projectId = projectId;
    }

    // ========== 短期记忆 ==========

    /** 读取短期记忆库 */
    getShortTerm(): MemoryEntry[] {
        return loadJSON(shortTermKey(this.projectId), []);
    }

    /** 写入短期记忆库 */
    private saveShortTerm(entries: MemoryEntry[]) {
        saveJSON(shortTermKey(this.projectId), entries);
    }

    /** 获取已压缩到的消息索引 */
    getCompressedIdx(): number {
        return loadJSON(compressedIdxKey(this.projectId), 0);
    }

    private saveCompressedIdx(idx: number) {
        saveJSON(compressedIdxKey(this.projectId), idx);
    }

    /** 按关键词召回短期记忆 */
    recallShortTerm(keywords: string[], limit = MAX_RECALL): MemoryEntry[] {
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

    /** 执行压缩：将指定范围的消息保存为记忆条目 */
    async performCompression(messages: ChatMessage[]): Promise<number> {
        const compressedIdx = this.getCompressedIdx();
        const unprocessed = messages.slice(compressedIdx);
        // 只处理 user/assistant 消息
        const processable = unprocessed.filter(m => m.role !== "system");

        // 不足 COMPRESS_INTERVAL 轮就不压缩（一轮=1 user+1 assistant=2 条）
        const rounds = Math.floor(processable.filter(m => m.role === "user").length);
        if (rounds < COMPRESS_INTERVAL) return 0;

        // 取最早的 COMPRESS_INTERVAL 轮消息
        const userCount = processable.filter(m => m.role === "user").length;
        const compressRound = Math.floor(userCount / COMPRESS_INTERVAL) * COMPRESS_INTERVAL;

        const messagesToCompress = processable.slice(0, compressRound * 2);
        const sourceMsgIds = messagesToCompress.map(m => m.id);

        // 提取标签
        const allText = messagesToCompress.map(m => m.content).join(" ");
        const tags = extractTags(allText);
        const entities = tags.filter(t => !Object.keys(TOPIC_KEYWORDS).includes(t));

        // 构建简易条目（不依赖 AI 调用，本地自己分析）
        const entries = this.buildLocalEntries(messagesToCompress, tags, entities);

        // 追加到短期记忆库
        const existing = this.getShortTerm();
        this.saveShortTerm([...existing, ...entries]);

        // 更新压缩索引
        this.saveCompressedIdx(compressedIdx + messagesToCompress.length);

        return entries.length;
    }

    /** 本地简易压缩（不依赖 AI） */
    private buildLocalEntries(
        messages: ChatMessage[],
        tags: string[],
        entities: string[]
    ): MemoryEntry[] {
        // 按用户消息分组，每条用户消息 + 对应 AI 回复算一个话题块
        const blocks: string[] = [];
        let current = "";
        let userMsgCount = 0;

        for (const m of messages) {
            if (m.role === "user") {
                if (current) blocks.push(current);
                current = `${m.content.slice(0, 200)}`;
                userMsgCount++;
            } else if (m.role === "assistant" && current) {
                current += ` → ${m.content.slice(0, 200)}`;
            }
        }
        if (current) blocks.push(current);

        // 取前 3 个块生成摘要
        const topBlocks = blocks.slice(0, 3);
        const summary = topBlocks.map(b => b.slice(0, 80)).join("；").slice(0, 150);

        const entry: MemoryEntry = {
            id: uuid(),
            topic: tags.find(t => Object.keys(TOPIC_KEYWORDS).includes(t)) || "综合",
            summary: summary || "（对话摘要）",
            tags: tags.slice(0, 6),
            tokens: estimateTokens(summary),
            createdAt: new Date().toISOString(),
            sourceMsgIds: messages.map(m => m.id).slice(0, 20),
            entities: entities.slice(0, 5),
        };

        return [entry];
    }

    // ========== 长期记忆 ==========

    /** 读取长期记忆 */
    getLongTerm(): LongTermMemory {
        return loadJSON(longTermKey(this.projectId), {
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
        const keywords = extractTags(userInput);

        // 2. 检索短期记忆
        const shortTerm = this.recallShortTerm(keywords);

        // 3. 检索长期记忆
        const longTerm = this.recallLongTerm(keywords);

        // 4. 计算工作记忆（最近 N 轮）
        const nonSystem = messages.filter(m => m.role !== "system");
        const userMessages = nonSystem.filter(m => m.role === "user");

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
        const existing = loadJSON<Record<string, string[]>>(msgTagsKey(this.projectId), {});
        let changed = false;

        for (const m of messages) {
            if (m.role === "system" || existing[m.id]) continue;
            const tags = extractTags(m.content);
            if (tags.length > 0) {
                existing[m.id] = tags;
                changed = true;
            }
        }

        if (changed) saveJSON(msgTagsKey(this.projectId), existing);
    }

    /** 获取消息的标签 */
    getMessageTags(msgId: string): string[] {
        const all = loadJSON<Record<string, string[]>>(msgTagsKey(this.projectId), {});
        return all[msgId] || [];
    }
}
