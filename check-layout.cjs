const fs = require("fs");
const path = require("path");
const h = path.join(process.env.APPDATA, "Code", "User", "history");

// Load EXE version
const ep = path.join(h, "141ae0", "entries.json");
const entries = JSON.parse(fs.readFileSync(ep, "utf-8"));
const sorted = entries.entries.sort((a, b) => a.timestamp - b.timestamp);
let best = null;
for (const e of sorted)
    if (e.timestamp < new Date(2026, 5, 8, 13, 17).getTime()) best = e;

const exe = fs.readFileSync(path.join(h, "141ae0", best.id), "utf-8");
const cur = fs.readFileSync("src/modules/characters/CharactersModule.tsx", "utf-8").replace('import { uuid } from "@/lib/uuid";\r\n', "");

// Find all differences
const diffs = [];
for (let i = 0; i < Math.min(exe.length, cur.length); i++) {
    if (exe[i] !== cur[i]) {
        diffs.push(i);
        if (diffs.length >= 5) break;
    }
}

if (diffs.length === 0) {
    console.log("✅ 完全一致");
} else {
    console.log("差异位置:", diffs);
    for (const pos of diffs) {
        const ctx = 40;
        console.log("\n位置", pos);
        console.log("EXE: " + exe.substring(Math.max(0, pos - ctx), pos + ctx));
        console.log("当前: " + cur.substring(Math.max(0, pos - ctx), pos + ctx));
    }

    // Try to find if there's a layout positioning difference
    // Look for Math.random, layout, position related code
    const exeLayout = exe.indexOf("Math.round(Math.random()");
    const curLayout = cur.indexOf("Math.round(Math.random()");
    if (exeLayout >= 0) {
        console.log("\nEXE布局代码:", exe.substring(exeLayout, exeLayout + 200));
    }
    if (curLayout >= 0) {
        console.log("当前布局代码:", cur.substring(curLayout, curLayout + 200));
    }
}
