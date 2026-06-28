/**
 * read-book.js — 在浏览器控制台中运行，读取全书数据并输出到控制台
 * 
 * 使用方法:
 *   1. 打开 http://localhost:1420 并打开你的项目
 *   2. 按 F12 → Console
 *   3. 粘贴此文件全部内容，回车
 *   4. 查看控制台输出，数据同时复制到剪贴板
 */

(function () {
    const NOVEL_KEY = 'novel-workbench-mock';
    const raw = localStorage.getItem(NOVEL_KEY);
    if (!raw) return console.error('❌ 未找到数据，请先确保浏览器中有项目数据');

    const store = JSON.parse(raw);
    const pid = store.projects?.[0]?.id;
    if (!pid) return console.error('❌ 未找到项目');

    const project = store.projects[0];

    // ─── 章节 ───
    const chapters = (JSON.parse(localStorage.getItem('chapter-index-' + pid) || '[]'))
        .map(id => {
            try {
                const c = JSON.parse(localStorage.getItem('chapter-' + pid + '-' + id) || 'null');
                if (!c) return null;
                return {
                    id: c.id, 编号: c.number, 标题: c.title, 状态: c.status,
                    字数: (c.content || '').length,
                    正文前100字: (c.content || '').replace(/<[^>]+>/g, '').substring(0, 100)
                };
            } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => a.编号 - b.编号);

    // ─── 卷 ───
    const volumes = (store.volumes || []).map(v => ({
        id: v.id, 标题: v.title, 排序: v.sort_order
    }));

    // ─── 剧情走向 ───
    const plotSegments = (() => {
        try { return JSON.parse(localStorage.getItem('plot-segments-' + pid) || '[]'); }
        catch { return []; }
    })();

    const plotSummary = plotSegments.map(s => ({
        类型: s.type === 'bright' ? '明线' : '暗线',
        标题: s.title,
        章节: s.chapters || '',
        细纲数: (s.beats || []).length,
        事件: (s.event || '').substring(0, 80)
    }));

    // ─── 角色 ───
    const characters = (store.characters || []).map(c => ({
        名字: c.name, 势力: c.faction, 性别: c.gender, 年龄: c.age,
        性格: c.personality, 渴望: c.desire, 恐惧: c.fear,
        缺陷: c.flaw, 权重: c.weight
    }));

    // ─── 世界观词条 ───
    const worldTerms = (store.worldTerms || []).map(t => ({
        标题: t.title, 类型: t.term_type, 一句话: t.one_liner,
        详细: (t.detail || '').substring(0, 80)
    }));

    // ─── 关系 ───
    const edges = (store.edges || []).map(e => {
        const charMap = new Map(characters.map(c => [c.id || c.名字, c.名字]));
        return {
            来源: charMap.get(e.source_id) || '未知',
            目标: charMap.get(e.target_id) || '未知',
            关系: e.relation_type,
            强度: e.strength,
            秘密: e.is_secret ? '是' : '否'
        };
    });

    // ─── 故事圣经 ───
    const storyBibles = store.storyBibles || [];
    const bibleText = storyBibles.map(b => ({
        不可违反铁则: b.inviolable_rules || [],
        世界观铁律: b.worldview_rules || [],
        主要阶段: b.main_stages || []
    }));

    // ─── 风格指南 ───
    const styleGuides = (store.styleGuides || []).map(g => ({
        叙述风格: g.narrative_style,
        文笔基调: g.writing_tone,
        写作红线: g.writing_rules
    }));

    // ─── 写作日志（摘要、角色状态、伏笔、质检） ───
    let logStore = {};
    try { logStore = JSON.parse(localStorage.getItem('novel-workbench-log-' + pid) || '{}'); }
    catch { }

    const summaries = (logStore.summaries || []).map(s => ({
        章号: s.chapter_number, 标题: s.chapter_title,
        摘要: (s.summary || '').substring(0, 120)
    }));

    const foreshadows = (logStore.foreshadows || []).map(f => ({
        描述: f.description, 埋笔章: f.planted_chapter,
        预期回收章: f.expected_resolve_chapter, 状态: f.status
    }));

    const qualityChecks = logStore.qualityChecks || {};
    const qualityCheckSummary = Object.entries(qualityChecks).map(([chNum, result]) => ({
        章节: chNum,
        通过: result.passed ? '✅' : '❌',
        错误: result.checks?.filter(c => c.severity === 'error').length || 0,
        警告: result.checks?.filter(c => c.severity === 'warning').length || 0,
        项目数: result.checks?.length || 0
    }));

    // ─── 快照 ───
    const snapshots = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('snapshot-' + pid)) {
            try {
                const s = JSON.parse(localStorage.getItem(k));
                snapshots.push({ 时间: s.created_at, 标签: s.label, 章节: s.chapterCount });
            } catch { }
        }
    }

    // ─── 组装输出 ───
    const report = {
        '📋 项目': { 名称: project.name, 阶段: project.stage, ID: pid },
        '📚 卷': volumes,
        '📖 章节': chapters,
        '📊 剧情走向': plotSummary,
        '👤 角色 (共' + characters.length + '人)': characters,
        '🔗 人物关系 (共' + edges.length + '条)': edges,
        '🌍 世界观词条 (共' + worldTerms.length + '条)': worldTerms,
        '📜 故事圣经': bibleText,
        '✒️ 风格指南': styleGuides,
        '📝 前情摘要 (共' + summaries.length + '条)': summaries,
        '🎯 伏笔表 (共' + foreshadows.length + '条)': foreshadows,
        '🔍 质检结果 (共' + Object.keys(qualityChecks).length + '次)': qualityCheckSummary,
        '💾 快照 (共' + snapshots.length + '个)': snapshots,
    };

    console.group('📖 全书数据报告');
    for (const [section, data] of Object.entries(report)) {
        console.group(section);
        console.table(Array.isArray(data) ? data : [data]);
        console.groupEnd();
    }
    console.groupEnd();

    // 同时输出紧凑 JSON 方便复制
    const compact = {
        项目: project.name,
        卷: volumes.length,
        章节: chapters.length,
        总字数: chapters.reduce((s, c) => s + c.字数, 0),
        角色: characters.length,
        词条: worldTerms.length,
        伏笔: foreshadows.length,
        质检: qualityCheckSummary,
    };
    console.log('\n📦 紧凑摘要:', JSON.stringify(compact, null, 2));

    // 复制到剪贴板
    try {
        copy(JSON.stringify(report, null, 2));
        console.log('%c✅ 完整报告已复制到剪贴板！', 'color:green;font-size:14px');
    } catch {
        console.log('⚠️ 自动复制失败，请手动选中上方 JSON 复制');
    }

    console.log('\n%c💡 提示：在控制台输入 report.章节 等查看具体数据', 'color:gray');

    // 暴露到全局
    window._bookReport = report;
    window._bookChapters = chapters;
    window._bookCharacters = characters;
})();
