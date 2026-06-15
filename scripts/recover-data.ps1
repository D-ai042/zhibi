# ============================================================
#  数据恢复脚本 v2.0 — 重点恢复章节正文
# ============================================================

$ErrorActionPreference = "Stop"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  数据恢复工具 v2.0" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$dataDir = "$env:APPDATA\com.zhibi.writer\projects"
if (-not (Test-Path $dataDir)) {
    Write-Host "[X] 未找到数据目录: $dataDir" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

$outDir = "$env:USERPROFILE\Desktop\DataRecovery"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = "$outDir\$ts"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Write-Host "[输出] $outDir" -ForegroundColor Green

$dbFiles = Get-ChildItem -Path $dataDir -Recurse -Filter "project.db" -ErrorAction SilentlyContinue
if ($dbFiles.Count -eq 0) {
    Write-Host "[X] 未找到 project.db" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

Write-Host "找到 $($dbFiles.Count) 个项目`n" -ForegroundColor Yellow

foreach ($dbFile in $dbFiles) {
    $prjId = $dbFile.Directory.Name
    $projDir = Join-Path $outDir $prjId
    New-Item -ItemType Directory -Path $projDir -Force | Out-Null

    Write-Host "===== $prjId =====" -ForegroundColor Cyan
    Write-Host "大小: $([math]::Round($dbFile.Length/1KB,1)) KB | 修改: $($dbFile.LastWriteTime)" -ForegroundColor Gray

    # 备份
    Copy-Item $dbFile.FullName (Join-Path $projDir "project.db.backup") -Force

    # 复制后读取（避免文件锁）
    $tmp = Join-Path $env:TEMP "recover_temp.db"
    Copy-Item $dbFile.FullName $tmp -Force
    $raw = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($tmp))
    Remove-Item $tmp -Force

    # ---- 第1步：提取项目名和章节结构 ----
    $projName = "未知"
    if ($raw -match '([^\x00-\x1f]{2,50})\x00{2,20}(ideation|drafting|completed)') {
        $projName = ($Matches[1] -replace '[^[\u4e00-\u9fff]\w]','').Trim()
    }
    Write-Host "  项目: $projName" -ForegroundColor White

    # ---- 第2步：专门抓 body_json（章节正文） ----
    # body_json 格式: {"type":"paragraph","content":"正文内容..."}
    $bodyPattern = '"content"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"'
    $bodyMatches = [regex]::Matches($raw, $bodyPattern)
    $paragraphs = @()
    foreach ($m in $bodyMatches) {
        $content = $m.Groups[1].Value
        $content = $content -replace '\\n',''
        $content = $content -replace '\\t',' '
        $content = $content -replace '\\"','"'
        $content = $content -replace '\\\\','\'
        if ($content.Length -gt 5 -and $content -match '[\u4e00-\u9fff]') {
            $paragraphs += $content
        }
    }
    Write-Host "  正文段落(JSON): $($paragraphs.Count) 段" -ForegroundColor White

    # ---- 第3步：清理/n，然后扫所有中文文本块 ----
    $cleanRaw = $raw -replace '\x00+', " "
    # 用 \n 做自然分段，找中文集中的连续区域
    $lines = $cleanRaw -split "`n"
    $textBlocks = @()
    $currentBlock = ""
    foreach ($line in $lines) {
        $chineseCount = ($line.ToCharArray() | Where-Object { $_ -match '[\u4e00-\u9fff]' }).Count
        if ($chineseCount -gt 5) {
            $currentBlock += $line + "`n"
        } else {
            if ($currentBlock.Length -gt 30) {
                $textBlocks += $currentBlock.Trim()
            }
            $currentBlock = ""
        }
    }
    if ($currentBlock.Length -gt 30) { $textBlocks += $currentBlock.Trim() }
    Write-Host "  文本块(raw): $($textBlocks.Count) 块" -ForegroundColor White

    # ---- 第4步：分类保存 ----
    
    # 4a. 正文（JSON paragraphs）- 最重要
    $bodyPath = Join-Path $projDir "正文恢复.txt"
    if ($paragraphs.Count -gt 0) {
        $hdr = @"
========================================
章节正文恢复 (从 body_json 提取)
========================================
项目: $projName
提取时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
共恢复 $($paragraphs.Count) 个段落
========================================

"@
        $hdr | Out-File $bodyPath -Encoding UTF8
        $idx = 0
        foreach ($p in $paragraphs) {
            $idx++
            "`n--- 段落 $idx ---" | Out-File $bodyPath -Encoding UTF8 -Append
            $p | Out-File $bodyPath -Encoding UTF8 -Append
        }
        Write-Host "  [正文] 正文恢复.txt ($($paragraphs.Count)段)" -ForegroundColor Green
    } else {
        "[!] 未从 body_json 提取到段落——章节正文可能已被覆盖或未写入" | Out-File $bodyPath -Encoding UTF8
        Write-Host "  [正文] 未找到" -ForegroundColor DarkYellow
    }

    # 4b. 设定文本（角色+世界观+规则等）
    $settingPath = Join-Path $projDir "设定恢复.txt"
    $hdr2 = @"
========================================
设定数据恢复 (角色/世界观/地点/规则)
========================================
项目: $projName
提取时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
共 $($textBlocks.Count) 个文本块
========================================

"@
    $hdr2 | Out-File $settingPath -Encoding UTF8
    $idx = 0
    foreach ($b in $textBlocks) {
        $idx++
        "`n--- 文本块 $idx ---" | Out-File $settingPath -Encoding UTF8 -Append
        $b | Out-File $settingPath -Encoding UTF8 -Append
    }
    Write-Host "  [设定] 设定恢复.txt ($($textBlocks.Count)块)" -ForegroundColor Green

    # 4c. 原始二进制文本
    $raw | Out-File (Join-Path $projDir "原始数据.txt") -Encoding UTF8
    Write-Host "  [原始] 原始数据.txt" -ForegroundColor Green
    Write-Host ""
}

# ---- settings.db ----
$sdb = "$env:APPDATA\com.zhibi.writer\settings.db"
if (Test-Path $sdb) {
    Write-Host "===== settings.db =====" -ForegroundColor Cyan
    $sDir = Join-Path $outDir "Settings数据"
    New-Item -ItemType Directory -Path $sDir -Force | Out-Null
    Copy-Item $sdb (Join-Path $sDir "settings.db.backup") -Force
    $sRaw = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($sdb))
    $sRaw | Out-File (Join-Path $sDir "原始数据.txt") -Encoding UTF8

    $prefixes = @(
        @{N="章节快照"; P="novel-snapshots-"},
        @{N="AI对话历史"; P="novel-workbench-chat-"},
        @{N="短期记忆"; P="novel-workbench-memory-short-"},
        @{N="长期记忆"; P="novel-workbench-memory-long-"},
        @{N="灵感卡片"; P="inspiration-cards-"},
        @{N="风格指南"; P="novel-workbench-style-"},
        @{N="故事铁则"; P="novel-workbench-bible-"}
    )
    foreach ($p in $prefixes) {
        $found = [regex]::Matches($sRaw, "$($p.P)[^$([char]0)]+") | % { $_.Value }
        if ($found.Count -gt 0) {
            $found -join "`n" | Out-File (Join-Path $sDir "$($p.N).txt") -Encoding UTF8
            Write-Host "  $($p.N): $($found.Count)条" -ForegroundColor White
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  恢复完成！输出目录：" -ForegroundColor Green
Write-Host "  $outDir" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "重点看这两个文件：" -ForegroundColor White
Write-Host "  1. 正文恢复.txt  — 章节段落（如果有）" -ForegroundColor White
Write-Host "  2. 设定恢复.txt  — 角色/世界观/大纲" -ForegroundColor White
Write-Host "  3. 原始数据.txt  — 搜索关键词用" -ForegroundColor White
Write-Host ""

Start-Process explorer.exe $outDir


