/**
 * 自动 Git 提交守护脚本
 *
 * 监听 src/ 目录的文件变化，自动 git commit。
 * 使用方式：node scripts/auto-git.cjs
 * 建议通过 npm run dev 自动启动（已在 package.json scripts 中配置）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WATCH_DIRS = [
    path.join(ROOT, "src"),
    ROOT, // 也监控根目录下的 .gitignore、package.json 等配置文件
];

// 防抖：文件停止变化后等待 5 秒再提交
const DEBOUNCE_MS = 5000;
let timer = null;
let pendingFiles = new Set();

// 避免重复提交相同的内容
let lastCommitHash = "";

function git(...args) {
    try {
        const result = execSync(`git ${args.join(" ")}`, {
            cwd: ROOT,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return result.trim();
    } catch (e) {
        return null;
    }
}

function doCommit() {
    if (pendingFiles.size === 0) return;

    const files = [...pendingFiles];
    pendingFiles = new Set();

    // 检查是否有文件真正被修改
    const status = git("status", "--porcelain");
    if (!status || status.trim() === "") return;

    // git add 所有变更
    git("add", "-A");

    // 检查是否有东西可以提交
    const commitCheck = git("status", "--porcelain");
    if (!commitCheck || commitCheck.trim() === "") return;

    // 生成提交信息
    const changed = commitCheck.split("\n").filter(Boolean).slice(0, 10);
    const msg = `auto: ${changed.map(l => l.substring(3)).join(", ")}${changed.length > 10 ? " ..." : ""}`;

    const result = git("commit", "-m", `"${msg.replace(/"/g, "'")}"`);
    if (result !== null) {
        const hash = git("rev-parse", "--short", "HEAD");
        console.log(`[auto-git] ✅ 已提交 ${hash || ""}: ${msg.substring(0, 80)}`);
    }
}

function onFileChange(watchDir) {
    return function (eventType, filename) {
        if (!filename) return;
        // 排除 node_modules、.git 和临时文件
        if (
            filename.includes("node_modules") ||
            filename.includes(".git") ||
            filename.startsWith("temp_") ||
            filename.startsWith("_exe_") ||
            filename.startsWith("diff-") ||
            filename.startsWith("check-") ||
            filename.endsWith(".cjs")
        )
            return;

        // filename 是相对于 watchDir 的路径
        const fullPath = path.join(watchDir, filename);
        // 只监控 src/ 和根目录的配置文件
        if (
            !fullPath.startsWith(path.join(ROOT, "src")) &&
            fullPath !== path.join(ROOT, ".gitignore") &&
            fullPath !== path.join(ROOT, "package.json")
        )
            return;

        // 使用相对路径记录
        const relPath = path.relative(ROOT, fullPath);
        pendingFiles.add(relPath);

        // 重置防抖定时器
        if (timer) clearTimeout(timer);
        timer = setTimeout(doCommit, DEBOUNCE_MS);
    };
}

// 启动监听
console.log("[auto-git] 🔍 正在监听 src/ 文件变化...");
for (const dir of WATCH_DIRS) {
    if (fs.existsSync(dir)) {
        fs.watch(dir, { recursive: true }, onFileChange(dir));
    }
}

// 进程退出时提交一次
process.on("SIGINT", () => {
    if (timer) clearTimeout(timer);
    doCommit();
    process.exit(0);
});

process.on("SIGTERM", () => {
    if (timer) clearTimeout(timer);
    doCommit();
    process.exit(0);
});
