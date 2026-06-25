/**
 * 导出 Word 文档 —— 将项目数据生成为可读的 .docx 文件
 */
import {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    HeadingLevel, AlignmentType, BorderStyle,
} from "docx";

/** 导出接口返回的数据结构 */
export interface ExportData {
    projectName: string;
    exportTime: string;
    worldTerms?: Record<string, unknown>[];
    characters?: Record<string, unknown>[];
    relationships?: Record<string, unknown>[];
    plotEvents?: Record<string, unknown>[];
    timelineNodes?: Record<string, unknown>[];
    volumes?: Record<string, unknown>[];
    chapters?: Record<string, unknown>[];
    beatCards?: Record<string, unknown>[];
    chapterContents?: Record<string, unknown>[];
}

// ============ 辅助函数 ============

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) {
    return new Paragraph({ text, heading: level, spacing: { before: 300, after: 200 } });
}

function subheading(text: string) {
    return heading(text, HeadingLevel.HEADING_2);
}

function sub3(text: string) {
    return heading(text, HeadingLevel.HEADING_3);
}

function para(text: string, opts?: { bold?: boolean; indent?: number }) {
    return new Paragraph({
        children: [new TextRun({ text, bold: opts?.bold, size: 22 })],
        spacing: { before: 60, after: 60 },
        indent: opts?.indent ? { left: opts.indent } : undefined,
    });
}

function emptyLine() {
    return new Paragraph({ spacing: { before: 100, after: 100 }, children: [] });
}

function keyValue(key: string, value: string | number | boolean | null | undefined) {
    const v = value == null ? "（无）" : String(value);
    return new Paragraph({
        children: [
            new TextRun({ text: `${key}：`, bold: true, size: 22 }),
            new TextRun({ text: v, size: 22 }),
        ],
        spacing: { before: 40, after: 40 },
        indent: { left: 400 },
    });
}

function divider() {
    return new Paragraph({
        spacing: { before: 100, after: 100 },
        border: { bottom: { color: "CCCCCC", size: 1, style: BorderStyle.SINGLE } },
        children: [],
    });
}

function tableRow(cells: string[], isHeader = false): TableRow {
    return new TableRow({
        tableHeader: isHeader,
        children: cells.map((c) =>
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: c, bold: isHeader, size: 20 })],
                    }),
                ],
            })
        ),
    });
}

function simpleTable(headers: string[], rows: string[][]): Table {
    return new Table({
        rows: [tableRow(headers, true), ...rows.map((r) => tableRow(r))],
    });
}

// ============ 生成设定文档 ============

function buildSetupDoc(data: ExportData): Document {
    const children: Array<Paragraph | Table> = [];

    // 封面
    children.push(new Paragraph({ spacing: { before: 3000 }, children: [] }));
    children.push(new Paragraph({
        text: data.projectName,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
    }));
    children.push(new Paragraph({
        text: "设定数据导出",
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
    }));
    children.push(para(`导出时间：${data.exportTime}`, { bold: true }));
    children.push(emptyLine());
    children.push(divider());

    // ---- 世界观词条 ----
    if (data.worldTerms && data.worldTerms.length > 0) {
        children.push(heading("世界观词条"));
        for (const t of data.worldTerms) {
            children.push(sub3(String(t.title || "（未命名）")));
            children.push(keyValue("类型", String(t.term_type || "")));
            children.push(keyValue("一句话描述", String(t.one_liner || "")));
            if (t.detail) children.push(keyValue("详细描述", String(t.detail)));
            if (t.forbidden && Array.isArray(t.forbidden) && t.forbidden.length > 0)
                children.push(keyValue("禁忌", (t.forbidden as string[]).join("、")));
            children.push(emptyLine());
        }
        children.push(divider());
    }

    // ---- 角色 ----
    if (data.characters && data.characters.length > 0) {
        children.push(heading("角色档案"));
        const rows = data.characters.map((c) => [
            String(c.name || ""),
            String(c.faction || ""),
            String(c.gender || ""),
            String(c.race || ""),
            String(c.weight ?? 5),
        ]);
        children.push(simpleTable(["姓名", "派系", "性别", "种族", "重要性"], rows));
        children.push(emptyLine());

        // 角色详情
        for (const c of data.characters) {
            children.push(sub3(String(c.name || "未命名")));
            const fields: [string, unknown][] = [
                ["派系", c.faction], ["性别", c.gender], ["年龄", c.age], ["种族", c.race],
                ["外貌", c.appearance], ["性格", c.personality], ["背景", c.background],
                ["能力", c.ability], ["行事风格", c.style], ["兴趣", c.interests],
                ["渴望", c.desire], ["恐惧", c.fear], ["缺陷", c.flaw], ["人物弧光", c.arc],
            ];
            for (const [k, v] of fields) {
                if (v) children.push(keyValue(k, String(v)));
            }
            children.push(emptyLine());
        }
        children.push(divider());
    }

    // ---- 人物关系 ----
    if (data.relationships && data.relationships.length > 0) {
        children.push(heading("人物关系"));
        const rows = data.relationships.map((r) => [
            String(r.source_id || ""),
            String(r.target_id || ""),
            String(r.relation_type || ""),
            String(r.strength ?? ""),
            (r.is_secret ? "是" : "否"),
        ]);
        children.push(simpleTable(["源角色ID", "目标角色ID", "关系类型", "亲密度", "秘密关系"], rows));
        children.push(divider());
    }

    // ---- 剧情事件 ----
    if (data.plotEvents && data.plotEvents.length > 0) {
        children.push(heading("剧情明暗线"));
        for (const e of data.plotEvents) {
            children.push(sub3(String(e.title || "未命名")));
            children.push(keyValue("类型", e.line_type === "bright" ? "明线" : "暗线"));
            children.push(keyValue("章节范围", `${e.chapter_start} - ${e.chapter_end}`));
            children.push(keyValue("读者知晓度", String(e.reader_knowledge || "")));
            if (e.truth_content) children.push(keyValue("真相", String(e.truth_content)));
            if (e.plant_method) children.push(keyValue("伏笔埋法", String(e.plant_method)));
            children.push(emptyLine());
        }
        children.push(divider());
    }

    // ---- 时间轴 ----
    if (data.timelineNodes && data.timelineNodes.length > 0) {
        children.push(heading("剧情时间轴"));
        const rows = data.timelineNodes.map((n) => [
            String(n.title || ""),
            String(n.type || ""),
            String(n.summary || "").substring(0, 80),
        ]);
        children.push(simpleTable(["节点", "类型", "概要"], rows));
        children.push(emptyLine());
    }

    return new Document({
        title: `${data.projectName} - 设定数据`,
        description: `由 Novel Workbench 导出`,
        sections: [{ children }],
    });
}

// ============ 生成章节文档 ============

function buildChaptersDoc(data: ExportData): Document {
    const children: Array<Paragraph | Table> = [];

    children.push(new Paragraph({ spacing: { before: 3000 }, children: [] }));
    children.push(new Paragraph({
        text: data.projectName,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
    }));
    children.push(new Paragraph({
        text: "章节数据导出",
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
    }));
    children.push(para(`导出时间：${data.exportTime}`, { bold: true }));
    children.push(emptyLine());
    children.push(divider());

    if (!data.volumes || data.volumes.length === 0) {
        children.push(para("暂无章节数据。"));
        return new Document({ title: `${data.projectName} - 章节数据`, sections: [{ children }] });
    }

    for (const vol of data.volumes) {
        children.push(heading(String(vol.title || "未命名卷")));

        const volChapters = (data.chapters || [])
            .filter((ch) => ch.volume_id === vol.id)
            .sort((a, b) => (a.number as number) - (b.number as number));

        if (volChapters.length === 0) {
            children.push(para("该卷暂无章节。"));
            continue;
        }

        for (const ch of volChapters) {
            const chNum = ch.number as number;
            const chTitle = ch.title as string;
            children.push(sub3(`第${chNum}章 ${chTitle}`));
            children.push(keyValue("状态", String(ch.status || "")));
            children.push(keyValue("字数", ch.word_count as number ?? 0));

            // 节拍卡片
            const beats = (data.beatCards || []).filter((b) => b.chapter_id === ch.id);
            if (beats.length > 0) {
                children.push(subheading("节拍卡片"));
                for (const b of beats) {
                    children.push(keyValue(
                        String(b.column_type || ""),
                        String(b.content || ""),
                    ));
                }
            }

            // 章节内容
            const content = (data.chapterContents || []).find((cc) => cc.chapter_id === ch.id);
            if (content) {
                children.push(subheading("正文"));
                const html = content.body_html as string;
                // 简易 HTML 转纯文本
                const text = html
                    .replace(/<[^>]+>/g, "")
                    .replace(/&nbsp;/g, " ")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();
                if (text) {
                    children.push(para(text));
                }
            }

            children.push(divider());
        }
    }

    return new Document({
        title: `${data.projectName} - 章节数据`,
        description: `由 Novel Workbench 导出`,
        sections: [{ children }],
    });
}

// ============ 导出函数 ============

/** 下载为 .docx 文件 */
async function downloadDoc(doc: Document, filename: string, projectId?: string) {
    const blob = await Packer.toBlob(doc);

    // 优先尝试 Tauri 原生保存对话框
    try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { invoke } = await import("@tauri-apps/api/core");

        const filePath = await save({
            defaultPath: filename,
            filters: [{ name: "Word 文档", extensions: ["docx"] }],
        });
        if (!filePath) return; // 用户取消

        // blob → base64
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        // 直接调用 Rust 后端写入文件（不走 mock）
        await invoke("save_export_file", {
            projectId: projectId || "",
            filename,
            dataBase64: base64,
            filePath,
        });
        alert(`文档已导出：${filePath}`);
        return;
    } catch {
        // Tauri 不可用时（浏览器环境），降级到浏览器下载
    }

    // 浏览器模式：标准下载
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** 导出设定文档（词条+角色+关系+剧情+时间轴） */
export async function exportSetupDoc(data: ExportData, projectId?: string) {
    const doc = buildSetupDoc(data);
    await downloadDoc(doc, `${data.projectName}-设定数据.docx`, projectId);
}

/** 导出章节文档 */
export async function exportChaptersDoc(data: ExportData, projectId?: string) {
    const doc = buildChaptersDoc(data);
    await downloadDoc(doc, `${data.projectName}-章节数据.docx`, projectId);
}

/** 导出全书文档 */
export async function exportFullDoc(data: ExportData, projectId?: string) {
    // 合并两个文档的内容
    const children: Array<Paragraph | Table> = [];

    // 封面
    children.push(new Paragraph({ spacing: { before: 3000 }, children: [] }));
    children.push(new Paragraph({
        text: data.projectName,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
    }));
    children.push(new Paragraph({
        text: "全书数据导出",
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
    }));
    children.push(para(`导出时间：${data.exportTime}`, { bold: true }));
    children.push(emptyLine());

    // 设定部分
    children.push(heading("第一部：设定"));
    if (data.worldTerms && data.worldTerms.length > 0) {
        children.push(heading("世界观词条"));
        for (const t of data.worldTerms) {
            children.push(sub3(String(t.title || "（未命名）")));
            children.push(keyValue("类型", String(t.term_type || "")));
            children.push(keyValue("一句话描述", String(t.one_liner || "")));
            if (t.detail) children.push(keyValue("详细描述", String(t.detail)));
            children.push(emptyLine());
        }
    }

    if (data.characters && data.characters.length > 0) {
        children.push(heading("角色档案"));
        for (const c of data.characters) {
            children.push(sub3(String(c.name || "未命名")));
            const fields: [string, unknown][] = [
                ["派系", c.faction], ["性别", c.gender], ["年龄", c.age], ["种族", c.race],
                ["外貌", c.appearance], ["性格", c.personality], ["背景", c.background],
                ["能力", c.ability], ["行事风格", c.style], ["兴趣", c.interests],
                ["渴望", c.desire], ["恐惧", c.fear], ["缺陷", c.flaw], ["人物弧光", c.arc],
            ];
            for (const [k, v] of fields) {
                if (v) children.push(keyValue(k, String(v)));
            }
            children.push(emptyLine());
        }
    }

    if (data.plotEvents && data.plotEvents.length > 0) {
        children.push(heading("剧情明暗线"));
        for (const e of data.plotEvents) {
            children.push(sub3(String(e.title || "未命名")));
            children.push(keyValue("类型", e.line_type === "bright" ? "明线" : "暗线"));
            children.push(keyValue("章节范围", `${e.chapter_start} - ${e.chapter_end}`));
            children.push(keyValue("读者知晓度", String(e.reader_knowledge || "")));
            if (e.truth_content) children.push(keyValue("真相", String(e.truth_content)));
            children.push(emptyLine());
        }
    }

    // 章节部分
    children.push(heading("第二部：正文"));
    if (data.volumes) {
        for (const vol of data.volumes) {
            children.push(heading(String(vol.title || "未命名卷")));
            const volChapters = (data.chapters || [])
                .filter((ch) => ch.volume_id === vol.id)
                .sort((a, b) => (a.number as number) - (b.number as number));
            for (const ch of volChapters) {
                children.push(sub3(`第${ch.number}章 ${ch.title}`));
                const content = (data.chapterContents || []).find((cc) => cc.chapter_id === ch.id);
                if (content) {
                    const text = (content.body_html as string)
                        .replace(/<[^>]+>/g, "")
                        .replace(/&nbsp;/g, " ")
                        .replace(/\n{3,}/g, "\n\n")
                        .trim();
                    if (text) children.push(para(text));
                }
                children.push(divider());
            }
        }
    }

    const doc = new Document({
        title: `${data.projectName} - 全书数据`,
        description: `由 Novel Workbench 导出`,
        sections: [{ children }],
    });
    await downloadDoc(doc, `${data.projectName}-全书数据.docx`, projectId);
}
