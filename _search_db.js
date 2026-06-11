const fs = require('fs');
const path = require('path');

function searchFiles(dir, pattern) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
            searchFiles(full, pattern);
        } else if (item.isFile() && item.name.endsWith('.db')) {
            const buf = fs.readFileSync(full);
            const content = buf.toString('utf-8');
            if (content.includes(pattern)) {
                console.log('FOUND in:', full);
                const idx = content.indexOf(pattern);
                console.log('Context:', content.substring(Math.max(0, idx - 50), idx + 100));
            } else {
                console.log('NOT in:', full, '(size:', buf.length, ')');
            }
        }
    }
}

const root = 'F:\\Projects\\ai-novel-writer\\src-tauri\\target';
searchFiles(root, '九霄之外');
console.log('---DONE---');
