/**
 * 简易 Markdown 行内渲染 — 将 AI 生成的 Markdown 文本渲染为基本 HTML。
 * 支持: 标题, 粗体, 列表, 表格, 代码块, 分割线。
 * MVP 阶段内联渲染，后续可替换为完整 markdown 库。
 */
export function renderMarkdown(text: string): string {
    if (!text) return '';
    let html = text
        // 转义 HTML
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // 代码块 ``` ... ```
        .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const langClass = lang ? ` class="language-${lang}"` : "";
            return `<pre${langClass} style="background:#1e293b;color:#e2e8f0;border-radius:8px;padding:12px;overflow-x:auto;font-size:13px;line-height:1.5;margin:8px 0;"><code>${code.trim()}</code></pre>`;
        })
        // 行内代码 `...`
        .replace(
            /`([^`]+)`/g,
            '<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>',
        )
        // 表格行
        .replace(/\|(.+)\|/g, (line) => {
            const cells = line
                .split("|")
                .filter((c) => c.trim())
                .map(
                    (c) =>
                        `<td style="border:1px solid #e2e8f0;padding:6px 12px;text-align:left;font-size:13px;">${c.trim()}</td>`,
                )
                .join("");
            return `<tr>${cells}</tr>`;
        })
        // 分割线
        .replace(
            /^---$/gm,
            '<hr style="border:none;border-top:2px solid #e2e8f0;margin:16px 0;">',
        )
        // 标题 ###
        .replace(
            /^### (.+)$/gm,
            '<h3 style="font-size:16px;font-weight:600;margin:16px 0 8px;color:#1e293b;">$1</h3>',
        )
        // 标题 ##
        .replace(
            /^## (.+)$/gm,
            '<h2 style="font-size:18px;font-weight:700;margin:20px 0 8px;color:#1e293b;">$1</h2>',
        )
        // 标题 #
        .replace(
            /^# (.+)$/gm,
            '<h1 style="font-size:22px;font-weight:700;margin:24px 0 12px;color:#0f172a;">$1</h1>',
        )
        // 粗体
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // 无序列表
        .replace(/^- (.+)$/gm, '<li style="margin:4px 0;font-size:14px;">$1</li>')
        // 有序列表
        .replace(
            /^\d+\. (.+)$/gm,
            '<li style="margin:4px 0;font-size:14px;">$1</li>',
        )
        // 段落 (连续两换行)
        .replace(
            /\n\n/g,
            '</p><p style="margin:8px 0;line-height:1.7;font-size:14px;">',
        )
        // 换行
        .replace(/\n/g, "<br>");

    // 包裹列表
    html = html.replace(/(<li[\s\S]*?<\/li>)\n*(<li)/g, "$1$2");
    html = html.replace(
        /(<li[\s\S]*?<\/li>)/g,
        (match) =>
            match.includes("<ul")
                ? match
                : `<ul style="padding-left:24px;margin:8px 0;">${match}</ul>`,
    );

    return `<p style="margin:8px 0;line-height:1.7;font-size:14px;">${html}</p>`;
}
