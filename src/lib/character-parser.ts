// character-parser.ts — AI 角色批量解析（T7：从 AiChatPanel.tsx 提取）
// 纯函数，无 React 依赖

export interface ParsedCharacter {
    name: string;
    age?: string;
    gender?: string;
    role?: string;
    description?: string;
    [key: string]: unknown;
}

export interface ParsedEdge {
    source: string;
    target: string;
    type: string;
}

export interface ParseResult {
    chars: ParsedCharacter[];
    edges: ParsedEdge[];
    snapshots: unknown[];
    errors: string[];
}

export function parseCharacterBatch(content: string): ParseResult {
    const result: ParseResult = { chars: [], edges: [], snapshots: [], errors: [] };

    // 从 ---CHARACTERS--- 块提取 JSON
    try {
        const charMatch = content.match(/---CHARACTERS---\n([\s\S]*?)(?:\n---|$)/);
        if (charMatch) {
            result.chars = JSON.parse(charMatch[1].trim());
        }
    } catch (e) {
        result.errors.push(`角色解析失败: ${e}`);
    }

    // 从 ---RELATIONSHIPS--- 块提取 JSON
    try {
        const edgeMatch = content.match(/---RELATIONSHIPS---\n([\s\S]*?)(?:\n---|$)/);
        if (edgeMatch) {
            result.edges = JSON.parse(edgeMatch[1].trim());
        }
    } catch (e) {
        result.errors.push(`关系解析失败: ${e}`);
    }

    // 从 ---SNAPSHOTS--- 块提取 JSON
    try {
        const snapMatch = content.match(/---SNAPSHOTS---\n([\s\S]*?)(?:\n---|$)/);
        if (snapMatch) {
            result.snapshots = JSON.parse(snapMatch[1].trim());
        }
    } catch (e) {
        result.errors.push(`快照解析失败: ${e}`);
    }

    return result;
}
