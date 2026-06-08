const fs = require("fs");
const exe = fs.readFileSync("_exe_CharactersModule.tsx", "utf-8");
const cur = fs.readFileSync("src/modules/characters/CharactersModule.tsx", "utf-8");

// Remove uuid import line (with Windows CRLF)
const curClean = cur.replace('import { uuid } from "@/lib/uuid";\r\n', "");

if (exe === curClean) {
    console.log("✅ CharactersModule 核心逻辑完全一致，唯一差异是 uuid import");
} else {
    console.log("❌ 还有差异");
    console.log("大小: EXE=" + exe.length + " 当前(去uuid)=" + curClean.length);
    for (let i = 0; i < Math.min(exe.length, curClean.length); i++) {
        if (exe[i] !== curClean[i]) {
            console.log("位置 " + i + ": EXE=" + exe.substring(i, i + 60) + " 当前=" + curClean.substring(i, i + 60));
            break;
        }
    }
}
