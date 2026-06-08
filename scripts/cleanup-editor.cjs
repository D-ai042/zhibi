const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'modules', 'writing', 'WritingModule.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Remove the previewMode state declaration
content = content.replace(
    "    // 预览模式\n    const [previewMode, setPreviewMode] = useState(false);\n",
    ""
);

// 2. Remove the preview toggle button block (from the button line to its closing tag)
const btnStart = '                                <button type="button" onClick={() => { setPreviewMode(!previewMode); }}';
const btnEnd = '                                </button>';
const btnIdx = content.indexOf(btnStart);
if (btnIdx >= 0) {
    const btnEndIdx = content.indexOf(btnEnd, btnIdx);
    if (btnEndIdx >= 0) {
        // Remove from button start to end of its closing tag (plus next newline)
        const removeEnd = btnEndIdx + btnEnd.length + 1;
        content = content.substring(0, btnIdx) + content.substring(removeEnd);
    }
}

// 3. Clean up unused Eye, Edit3 imports
content = content.replace(', Eye, Edit3', '');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('DONE');
