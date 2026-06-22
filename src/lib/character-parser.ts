// character-parser.ts — AI 回复解析器（T7 拆分，从 AiChatPanel 完整提取）
import type { WorldTerm } from "@/types";

/** 解析 AI 回复中的世界观词条创建指令（JSON 格式） */
export function parseWorldTermAction(content: string): { term_type: WorldTerm["term_type"]; title: string; one_liner?: string; detail?: string } | null {
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.action === "create_world_term" && parsed.term) {
            return { term_type: parsed.term.term_type || "rule", title: parsed.term.title || "新词条", one_liner: parsed.term.one_liner || "", detail: parsed.term.detail || "" };
        }
    } catch { }
    return null;
}

/** 解析 AI 回复中的词条修改指令 */
export function parseWorldTermUpdate(content: string): { title: string; title_new?: string; one_liner?: string; detail?: string } | null {
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.action === "update_world_term" && parsed.term && parsed.term.title) {
            return { title: parsed.term.title, title_new: parsed.term.title_new, one_liner: parsed.term.one_liner, detail: parsed.term.detail };
        }
    } catch { }
    return null;
}

/** 解析 AI 回复中的批量世界观词条创建指令 */
export function parseBatchWorldTerms(content: string): { term_type: WorldTerm["term_type"]; title: string; one_liner: string; detail: string }[] {
    const wtm = content.match(/---WORLD_TERMS---\s*([\s\S]*?)\s*---END_WORLD_TERMS---/);
    if (wtm) {
        try {
            const p = JSON.parse(wtm[1]);
            if (Array.isArray(p)) {
                return p.filter((a: Record<string, unknown>) => a.action === "create_world_term" && a.term).map((a: Record<string, unknown>) => {
                    const t = a.term as Record<string, string>;
                    return { term_type: (t.term_type || "rule") as WorldTerm["term_type"], title: (t.title || "新词条").slice(0, 30), one_liner: t.one_liner || "", detail: t.detail || "" };
                });
            }
        } catch { }
    }
    const jm = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (jm) {
        try {
            const p = JSON.parse(jm[1]);
            if (Array.isArray(p)) {
                return p.filter((a: Record<string, unknown>) => a.action === "create_world_term" && a.term).map((a: Record<string, unknown>) => {
                    const t = a.term as Record<string, string>;
                    return { term_type: (t.term_type || "rule") as WorldTerm["term_type"], title: (t.title || "新词条").slice(0, 30), one_liner: t.one_liner || "", detail: t.detail || "" };
                });
            }
        } catch { }
    }
    return [];
}

/** 解析 AI 回复中的自动连线指令 */
export function parseEdgeActions(content: string): { sourceTitle: string; targetTitle: string }[] {
    const wtm = content.match(/---WORLD_TERMS---\s*([\s\S]*?)\s*---END_WORLD_TERMS---/);
    const source = wtm ? wtm[1] : content;
    const markerPos = content.indexOf('---WORLD_TERMS---');
    const searchSpace = markerPos >= 0 ? content.slice(0, markerPos) : source;
    const arrMatch = searchSpace.match(/\[[\s\S]*?\]/);
    if (!arrMatch) return [];
    try {
        const parsed = JSON.parse(arrMatch[0]);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((a: { action: string }) => a.action === "create_edge").map((a: { edge: { sourceTitle: string; targetTitle: string } }) => a.edge);
    } catch { return []; }
}

/** 解析 AI 回复中的人物角色批量创建指令 */
export function parseCharacterBatch(content: string): {
    chars: { name: string; faction: string; gender?: string; age?: string; race?: string; appearance?: string; personality?: string; background?: string; ability?: string; style?: string; interests?: string }[];
    edges: { sourceName: string; targetName: string; relation_type: string; strength: number }[];
    removeEdges: { sourceName: string; targetName: string }[];
    snapshots: { name: string; changes: Record<string, string> }[];
} {
    const m = content.match(/---CHARACTERS---\s*([\s\S]*?)\s*---END_CHARACTERS---/);
    if (!m) return { chars: [], edges: [], removeEdges: [], snapshots: [] };
    try {
        const arr = JSON.parse(m[1]);
        if (!Array.isArray(arr)) return { chars: [], edges: [], removeEdges: [], snapshots: [] };
        const chars = arr.filter((a: any) => a.action === "create_character" && a.character).map((a: any) => ({ name: (a.character.name || "").slice(0, 20), faction: a.character.faction || "", gender: a.character.gender, age: a.character.age, race: a.character.race, appearance: a.character.appearance, personality: a.character.personality, background: a.character.background, ability: a.character.ability, style: a.character.style, interests: a.character.interests }));
        const edges = arr.filter((a: any) => a.action === "create_relationship" && a.edge).map((a: any) => ({ sourceName: a.edge.sourceName, targetName: a.edge.targetName, relation_type: a.edge.relation_type || "关联", strength: a.edge.strength || 5 }));
        const removeEdges = arr.filter((a: any) => (a.action === "remove_relationship" || a.action === "delete_relationship") && a.edge).map((a: any) => ({ sourceName: a.edge.sourceName, targetName: a.edge.targetName }));
        const snapshots = arr.filter((a: any) => a.action === "update_snapshot" && a.name).map((a: any) => ({ name: a.name, changes: a.changes || {} }));
        return { chars, edges, removeEdges, snapshots };
    } catch { return { chars: [], edges: [], removeEdges: [], snapshots: [] }; }
}

/** 解析 AI 回复中的人物角色更新指令 */
export function parseCharacterUpdate(content: string): { name: string; fields: Record<string, string> }[] {
    const results: { name: string; fields: Record<string, string> }[] = [];
    const regex = /---CHARACTER_UPDATE---\s*(\[[\s\S]*?\])\s*---END_CHARACTER_UPDATE---/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        try { const arr = JSON.parse(match[1]); if (!Array.isArray(arr)) continue; for (const item of arr) { if (item.name && item.fields) results.push({ name: item.name, fields: item.fields }); } } catch { }
    }
    return results;
}

/** 删除不属于当前模块的块模板 */
export function stripOtherModuleBlocks(content: string, currentModule: string, outlineSection: string): string {
    let result = content;
    if (!(currentModule === "outline" && outlineSection === "worldview")) { result = result.replace(/---WORLD_TERMS---[\s\S]*?---END_WORLD_TERMS---/g, "").replace(/```(?:json)?\s*\{[\s\S]*?"action"\s*:\s*"(?:create_world_term|update_world_term)"[\s\S]*?\}\s*```/g, ""); }
    if (!(currentModule === "outline" && outlineSection === "characters")) { result = result.replace(/---CHARACTERS---[\s\S]*?---END_CHARACTERS---/g, "").replace(/---CHARACTER_UPDATE---[\s\S]*?---END_CHARACTER_UPDATE---/g, ""); }
    if (!(currentModule === "outline" && outlineSection === "plot-direction")) { result = result.replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, ""); }
    return result;
}

/** 删除所有块模板，仅保留自然语言 */
export function stripAllBlocks(content: string): string {
    return content.replace(/---WORLD_TERMS---[\s\S]*?---END_WORLD_TERMS---/g, "").replace(/---CHARACTERS---[\s\S]*?---END_CHARACTERS---/g, "").replace(/---CHARACTER_UPDATE---[\s\S]*?---END_CHARACTER_UPDATE---/g, "").replace(/---PLOT_SEGMENTS---[\s\S]*?---END_PLOT_SEGMENTS---/g, "").replace(/---WORLD_TERM_UPDATE---[\s\S]*?---END_WORLD_TERM_UPDATE---/g, "").replace(/```(?:json)?\s*[\s\S]*?```/g, "").trim();
}

/** 解析 AI 回复中的批量世界观词条修改指令 */
export function parseWorldTermUpdateBatch(content: string): { title: string; fields: Record<string, string> }[] {
    const results: { title: string; fields: Record<string, string> }[] = [];
    const regex = /---WORLD_TERM_UPDATE---\s*(\[[\s\S]*?\])\s*---END_WORLD_TERM_UPDATE---/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        try { const arr = JSON.parse(match[1]); if (!Array.isArray(arr)) continue; for (const item of arr) { if (item.title && item.fields) results.push({ title: item.title, fields: item.fields }); } } catch { }
    }
    return results;
}

/** 解析 AI 回复中的剧情走向段落创建指令 */
export function parsePlotSegments(content: string): {
    segments: { type: "bright" | "dark"; title: string; characters: string; location: string; time: string; chapters: string; event: string }[];
    edges: { sourceTitle: string; targetTitle: string }[];
    beats: { segmentTitle: string; beat: { id?: string; title: string; characters: string; location: string; time: string; event: string; chapters: string } }[];
    updateBeats: { segmentTitle: string; beatNumber: number; fields: Partial<{ title: string; characters: string; location: string; time: string; event: string; chapters: string }> }[];
    deleteBeats: { segmentTitle: string; beatNumber: number }[];
} {
    const m = content.match(/---PLOT_SEGMENTS---\s*([\s\S]*?)\s*---END_PLOT_SEGMENTS---/);
    if (!m) return { segments: [], edges: [], beats: [], updateBeats: [], deleteBeats: [] };
    try {
        const arr = JSON.parse(m[1]);
        if (!Array.isArray(arr)) return { segments: [], edges: [], beats: [], updateBeats: [], deleteBeats: [] };
        const segments = arr.filter((a: any) => a.action === "create_segment" && a.segment).map((a: any) => ({ type: a.segment.type === "dark" ? "dark" as const : "bright" as const, title: (a.segment.title || "").slice(0, 30), characters: a.segment.characters || "", location: a.segment.location || "", time: a.segment.time || "", chapters: a.segment.chapters || "", event: a.segment.event || "" }));
        const edges = arr.filter((a: any) => a.action === "create_edge" && a.edge).map((a: any) => ({ sourceTitle: a.edge.sourceTitle, targetTitle: a.edge.targetTitle }));
        const beats = arr.filter((a: any) => a.action === "create_beat" && a.beat && a.segmentTitle).map((a: any) => ({ segmentTitle: a.segmentTitle, beat: { title: (a.beat.title || "").slice(0, 40), characters: a.beat.characters || "", location: a.beat.location || "", time: a.beat.time || "", event: a.beat.event || "", chapters: a.beat.chapters || "" } }));
        const updateBeats = arr.filter((a: any) => a.action === "update_beat" && a.segmentTitle && a.beatNumber).map((a: any) => ({ segmentTitle: a.segmentTitle, beatNumber: a.beatNumber, fields: a.fields || {} }));
        const deleteBeats = arr.filter((a: any) => a.action === "delete_beat" && a.segmentTitle && a.beatNumber).map((a: any) => ({ segmentTitle: a.segmentTitle, beatNumber: a.beatNumber }));
        return { segments, edges, beats, updateBeats, deleteBeats };
    } catch { return { segments: [], edges: [], beats: [], updateBeats: [], deleteBeats: [] }; }
}

/** 解析 AI 回复中的卷章创建指令 */
export function parseChapters(content: string): { volumeTitle: string; number: number; title: string }[] {
    const m = content.match(/---CHAPTERS---\s*([\s\S]*?)\s*---END_CHAPTERS---/);
    if (!m) return [];
    try {
        const arr = JSON.parse(m[1]);
        if (!Array.isArray(arr)) return [];
        return arr.filter((a: any) => a.action === "create_chapter" && a.chapter).map((a: any) => ({ volumeTitle: a.chapter.volumeTitle || "", number: a.chapter.number || 1, title: (a.chapter.title || "").slice(0, 50) }));
    } catch { return []; }
}
