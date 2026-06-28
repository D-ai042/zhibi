# read-book.ps1 — 读取全书数据 · 零依赖（不需要装任何软件）
#
# 用法:
#   开发模式:  .\scripts\read-book.ps1
#   EXE 模式:  .\scripts\read-book.ps1 -exe
#
# EXE 模式零依赖原理:
#   1. 找到 %APPDATA%\com.zhibi.writer\projects\<id>\project.db
#   2. SQLite 文件中文本以 UTF-8 明文存储，用 PowerShell 直接提取
#   3. 同时输出一段 JS 代码，粘贴到 EXE 按 F12 的控制台即可结构化读取
param(
    [switch]$exe,           # EXE 生产模式
    [string]$projectId      # 指定项目ID
)

$ErrorActionPreference = "Continue"

# ============================================================
# 模式 A：浏览器开发模式
# ============================================================
if (-not $exe) {
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  浏览器开发模式 — 使用 read-book.js 读取 localStorage 数据" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "用法：" -ForegroundColor Yellow
    Write-Host "  1. 打开 http://localhost:1420 并进入你的项目"
    Write-Host "  2. 按 F12 → Console"
    Write-Host "  3. 复制 scripts\read-book.js 全部内容，粘贴到控制台，回车"
    Write-Host ""
    Write-Host "脚本路径: $PSScriptRoot\read-book.js" -ForegroundColor Green
    Write-Host ""

    # 尝试自动打开 read-book.js 内容
    if (Test-Path "$PSScriptRoot\read-book.js") {
        $choice = Read-Host "是否直接打印脚本内容？(y/n)"
        if ($choice -eq 'y') {
            Write-Host "`n" -NoNewline
            Get-Content "$PSScriptRoot\read-book.js" | ForEach-Object { Write-Host $_ }
        }
    }
    return
}

# ============================================================
# 模式 B：EXE 生产模式 — 零依赖读取 SQLite
# ============================================================
$appData = "$env:APPDATA\com.zhibi.writer"
$projectsDir = "$appData\projects"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  EXE 生产模式 — 读取 SQLite 数据 · 零依赖" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "数据目录: $appData" -ForegroundColor Gray

if (-not (Test-Path $projectsDir)) {
    Write-Host "❌ 未找到数据目录，可能还没有用 EXE 创建过项目" -ForegroundColor Red
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  备选方案：在 EXE 程序内部按 F12 粘贴 JS 代码读取" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
    PrintExeJsSnippet
    return
}

$projects = Get-ChildItem $projectsDir -Directory
if ($projects.Count -eq 0) {
    Write-Host "❌ projects 目录为空" -ForegroundColor Red
    PrintExeJsSnippet
    return
}

Write-Host "找到 $($projects.Count) 个项目:`n"

foreach ($proj in $projects) {
    $dbPath = Join-Path $proj.FullName "project.db"
    if (-not (Test-Path $dbPath)) {
        Write-Host "⚠️ $($proj.Name) 无 project.db" -ForegroundColor Yellow
        continue
    }

    $dbSize = [math]::Round((Get-Item $dbPath).Length / 1KB, 1)
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "  项目 ID: $($proj.Name)" -ForegroundColor White
    Write-Host "  数据库:  project.db ($dbSize KB)" -ForegroundColor White
    Write-Host "  路径:    $dbPath" -ForegroundColor Gray
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""

    # ─── 方法1: 从 SQLite 文件中提取可读文本 ───
    # SQLite 把字符串以长度前缀 + UTF-8 字节存储，直接读字节即可捞到中文
    Write-Host "───── 方法1：直接提取 SQLite 文件中的文本 ─────" -ForegroundColor Yellow
    Write-Host ""

    try {
        $bytes = [System.IO.File]::ReadAllBytes($dbPath)
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        
        # 提取所有有意义的中文/英文片段（长度≥3的中文连续片段）
        $lines = $text -split '\0|[\x00-\x08\x0B\x0C\x0E-\x1F]' | Where-Object { $_.Length -gt 2 } | Select-Object -Unique

        # 分类提取
        Write-Host "【项目名称 & 阶段】" -ForegroundColor Magenta
        $lines | Where-Object { $_ -match '构思中|写作中|已完成|大纲' -and $_.Length -le 20 } | Select-Object -First 3

        Write-Host "`n【章节标题】" -ForegroundColor Magenta
        $lines | Where-Object { $_ -match '^第\d+章' } | Select-Object -First 20

        Write-Host "`n【段落正文（前 80 字）】" -ForegroundColor Magenta
        $lines | Where-Object { $_.Length -gt 15 -and $_ -match '[\u4e00-\u9fff]' -and $_ -notmatch '^CREATE|^INSERT|^SELECT|^PRAGMA|^DROP|^ALTER|^table|^index|^sqlite' } | ForEach-Object {
            $preview = if ($_.Length -gt 80) { $_.Substring(0, 80) + "..." } else { $_ }
            Write-Host "  $preview" -ForegroundColor White
        } | Select-Object -First 30

        Write-Host "`n【角色名】" -ForegroundColor Magenta
        # 中文2-4字名字模式
        $namePattern = [regex]'[\u4e00-\u9fff]{2,4}'
        $names = @{}
        foreach ($line in $lines) {
            $matches = $namePattern.Matches($line)
            foreach ($m in $matches) {
                $n = $m.Value
                if ($n -match '^(第|章节|创建|更新|删除|插入|选择|从|在|是|的|了|我|你|他|她|它|们|这|那|不|就|也|都|还|要|会|能|可|以|为|被|把|让|和|与|或|但|而|因|所|上|下|中|前|后|左|右|大|小|多|少|来|去|到|得|地|着|过|了|之|其|然|如|果|虽|若|便|则|却|只|又|再|更|最|很|太|极|非|无|未|已|曾|将|正|在|已|经|常|总|每|各|某|几|何|怎|么|什|哪|谁|哪|呢|吗|吧|呀|啊|呵|哦|呜|呼|喂|嘿|哎|唉|嗯|呃)') { continue }
                $names[$n] = ($names[$n] || 0) + 1
            }
        }
        $names.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object {
            Write-Host "  $($_.Key) (出现 $($_.Value) 次)" -ForegroundColor White
        }

        Write-Host ""
    } catch {
        Write-Host "  读取失败: $_" -ForegroundColor Red
    }

    # ─── 方法2: 提供 JS 代码在 EXE 内部运行 ───
    Write-Host "───── 方法2：EXE 内按 F12 粘贴 JS 精确读取 ─────" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  上面的方法1只能提取碎片文本。要获得完整结构化数据，请：" -ForegroundColor White
    Write-Host "  1. 打开 EXE 程序，进入你的项目" -ForegroundColor White
    Write-Host "  2. 按 F12 打开开发者工具 → Console" -ForegroundColor White
    Write-Host "  3. 复制 scripts\read-book.js 内容粘贴到控制台" -ForegroundColor White
    Write-Host ""
    Write-Host "  如果 EXE 模式下 read-book.js 无效（因为数据走 Tauri API 而非 localStorage），" -ForegroundColor Yellow
    Write-Host "  则用以下代码：`n" -ForegroundColor Yellow
    PrintExeJsSnippet
}

Write-Host "`n完成。" -ForegroundColor Cyan
return
}

function PrintExeJsSnippet {
    Write-Host @'

// === 粘贴到 EXE 的 F12 控制台 ===
(async () => {
  const { invoke } = window.__TAURI_INTERNALS__ 
    ? await import('@tauri-apps/api/core') 
    : { invoke: null };
  if (!invoke) return console.error('请在 EXE 程序中运行');

  // 获取项目列表
  const config = JSON.parse(localStorage['novel-workbench-mock'] || '{}');
  const pid = config.projects?.[0]?.id;
  if (!pid) return console.error('未找到项目');

  // 并行读取所有数据
  const [chapters, characters, worldTerms, styleGuide, storyBible, summaries, edges] = 
    await Promise.all([
      invoke('list_chapters', { projectId: pid }),
      invoke('list_characters', { projectId: pid }),
      invoke('list_world_terms', { projectId: pid }),
      invoke('get_style_guide', { projectId: pid }).catch(() => null),
      invoke('get_story_bible', { projectId: pid }).catch(() => null),
      invoke('get_chapter_summaries', { projectId: pid }).catch(() => []),
      invoke('list_relationship_edges', { projectId: pid }).catch(() => []),
    ]);

  // 逐章读取正文
  const fullChapters = [];
  for (const ch of chapters) {
    const content = await invoke('get_chapter_content', { chapterId: ch.id }).catch(() => null);
    fullChapters.push({
      编号: ch.number, 标题: ch.title, 状态: ch.status, 字数: ch.word_count,
      正文前200字: (content?.body_html || '').replace(/<[^>]+>/g, '').substring(0, 200)
    });
  }

  const report = {
    '章节 (共' + chapters.length + '章)': fullChapters,
    '角色 (共' + characters.length + '人)': characters.map(c => ({ 名字: c.name, 势力: c.faction, 性别: c.gender, 性格: c.personality })),
    '世界观词条 (共' + worldTerms.length + '条)': worldTerms.map(t => ({ 标题: t.title, 类型: t.term_type, 描述: t.one_liner })),
    '故事圣经': storyBible ? { 铁则: storyBible.inviolable_rules, 世界铁律: storyBible.worldview_rules } : null,
    '风格指南': styleGuide ? { 叙述风格: styleGuide.narrative_style, 文笔基调: styleGuide.writing_tone, 红线: styleGuide.writing_rules } : null,
    '前情摘要': (Array.isArray(summaries) ? summaries : (summaries?.summaries || [])).map(s => ({ 章: s.chapter_number, 标题: s.chapter_title, 摘要: s.summary })),
    '人物关系': edges.map(e => ({ 关系: e.relation_type, 强度: e.strength })),
  };

  console.log(JSON.stringify(report, null, 2));
  console.log('%c✅ 全书数据已输出！','color:green;font-size:16px');
})();
'@
}
                        volumeSegmentId: ch.volumeSegmentId, status: ch.status,
                        wordCount: ch.wordCount,
                        contentLen: (ch.content || '').length,
                        content: ch.content || ''
                    });
                }
            } catch(e) {}
        }
    } catch(e) { all.chapterIndexError = e.message; }

    // ── 5. 剧情走向 (plot-segments) ──
    try {
        all.plotSegments = JSON.parse(localStorage.getItem('plot-segments-' + pid) || '[]');
    } catch(e) { all.plotSegments = []; }

    // ── 6. 快照列表 ──
    try {
        all.snapshots = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('snapshot-' + pid)) {
                try { all.snapshots.push(JSON.parse(localStorage.getItem(k))); } catch(e) {}
            }
        }
    } catch(e) {}

    // ── 7. 备份列表 ──
    try {
        all.backups = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('novel-backup-' + pid)) {
                try { all.backups.push({ key: k, size: localStorage.getItem(k)?.length || 0 }); } catch(e) {}
            }
        }
    } catch(e) {}

    // ── 8. mock-store 内的核心数据 ──
    if (all.mockStore) {
        all.volumes = all.mockStore.volumes;
        all.characters = all.mockStore.characters;
        all.worldTerms = all.mockStore.worldTerms;
        all.timelineNodes = all.mockStore.timelineNodes;
        all.plotEvents = all.mockStore.plotEvents;
        all.relationshipEdges = all.mockStore.edges;
        all.beatCards = all.mockStore.beatCards;
        all.chapterContents = all.mockStore.chapterContents;
        all.lockedFields = all.mockStore.lockedFields;
        all.storyBibles = all.mockStore.storyBibles;
        all.styleGuides = all.mockStore.styleGuides;
    }

    return all;
})()
'@

    Write-Host "正在读取..." -ForegroundColor Yellow
    # 先确保页面打开
    $pageOutput = & npx playwright evaluate --browser=chromium --url=http://localhost:1420 --script=$js 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Playwright 不可用，改用嵌入脚本..." -ForegroundColor Yellow
        # fallback: 输出手动操作指引
        Write-Host @"

无法通过命令行读取。请手动操作：
1. 打开浏览器 http://localhost:1420
2. 按 F12 打开开发者工具
3. 在 Console 粘贴以下代码并回车：

// 保存到剪贴板的紧凑版
const pid = JSON.parse(localStorage['novel-workbench-mock']).projects[0].id;
const data = {
  pid,
  project: JSON.parse(localStorage['novel-workbench-mock']).projects[0],
  chapters: JSON.parse(localStorage['chapter-index-'+pid]||'[]').map(id => {
    const c = JSON.parse(localStorage['chapter-'+pid+'-'+id]||'null');
    return c ? { number:c.number, title:c.title, words: (c.content||'').length, status:c.status } : null;
  }).filter(Boolean),
  characters: (JSON.parse(localStorage['novel-workbench-mock']).characters||[]).map(c => ({name:c.name,faction:c.faction,personality:c.personality})),
  worldTerms: (JSON.parse(localStorage['novel-workbench-mock']).worldTerms||[]).map(t => ({title:t.title,type:t.term_type,oneLiner:t.one_liner})),
  qualityChecks: (JSON.parse(localStorage['novel-workbench-log-'+pid]||'{}').qualityChecks||{}),
  logSummaries: (JSON.parse(localStorage['novel-workbench-log-'+pid]||'{}').summaries||[]).map(s => ({ch:s.chapter_number,title:s.chapter_title,summary:s.summary})),
};
console.log(JSON.stringify(data, null, 2));
copy(JSON.stringify(data, null, 2));
console.log('%c✅ 已复制到剪贴板！','color:green;font-size:16px');
"@
        return
    }

    Write-Host $pageOutput

    return
}

# ============================================================
# 模式 B：EXE 生产模式 — 读取 SQLite
# ============================================================
if ($exe) {
    $appData = "$env:APPDATA\com.zhibi.writer"
    $projectsDir = "$appData\projects"
    
    Write-Host "=== EXE 生产模式 — 读取 SQLite ===" -ForegroundColor Cyan
    Write-Host "数据目录: $appData`n"

    if (-not (Test-Path $projectsDir)) {
        Write-Host "❌ 未找到数据目录: $projectsDir" -ForegroundColor Red
        Write-Host "   可能还没有创建过项目" -ForegroundColor Yellow
        return
    }

    $projects = Get-ChildItem $projectsDir -Directory
    Write-Host "找到 $($projects.Count) 个项目:`n"

    foreach ($proj in $projects) {
        $dbPath = Join-Path $proj.FullName "project.db"
        $projName = "未知"
        if (Test-Path $dbPath) {
            Write-Host "━━━ $($proj.Name) ━━━" -ForegroundColor Green
            
            # 使用 sqlite3 CLI（需要安装）或提供手动指引
            $sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
            if ($sqlite3) {
                Write-Host "项目名称:"
                & sqlite3 $dbPath "SELECT name, stage FROM projects;"

                Write-Host "`n卷:"
                & sqlite3 $dbPath ".headers on" "SELECT id, title, sort_order FROM volumes;"

                Write-Host "`n章节 (前10章):"
                & sqlite3 $dbPath ".headers on" "SELECT number, title, status, word_count FROM chapters ORDER BY number LIMIT 10;"

                Write-Host "`n角色:"
                & sqlite3 $dbPath ".headers on" "SELECT name, faction, gender FROM characters;"

                Write-Host "`n统计:"
                & sqlite3 $dbPath "SELECT '卷数', COUNT(*) FROM volumes UNION ALL SELECT '章节数', COUNT(*) FROM chapters UNION ALL SELECT '角色数', COUNT(*) FROM characters;"
            } else {
                Write-Host "⚠️ sqlite3 CLI 未安装。请手动用 DB Browser 打开："
                Write-Host "   $dbPath" -ForegroundColor Yellow
            }
        } else {
            Write-Host "⚠️ $($proj.Name) 无 project.db" -ForegroundColor Yellow
        }
        Write-Host ""
    }
}

Write-Host "`n完成。" -ForegroundColor Cyan
