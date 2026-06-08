const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'modules', 'writing', 'WritingModule.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// Find the previewMode block and replace with contentEditable div
const oldStart = '                            {previewMode ? (';
const oldEnd = '                            </>)}';
const startIdx = content.indexOf(oldStart);
const endIdx = content.indexOf(oldEnd, startIdx) + oldEnd.length;

if (startIdx >= 0 && endIdx > startIdx) {
    const newContent = `                            <>
                                <div
                                    ref={editorRef as any}
                                    className="absolute inset-0 overflow-y-auto bg-white p-6 font-serif text-base leading-relaxed outline-none cursor-text"
                                    contentEditable
                                    suppressContentEditableWarning
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(editingContent || "") }}
                                    onInput={e => {
                                        const text = (e.currentTarget as HTMLElement).innerText || "";
                                        setEditingContent(text);
                                    }}
                                    onMouseUp={e => {
                                        if (insertLockRef.current) return;
                                        const sel = window.getSelection();
                                        if (!sel || !sel.rangeCount) return;
                                        const selectedText = sel.toString();
                                        if (selectedText) {
                                            setAiDialog({
                                                start: 0, end: 0,
                                                text: selectedText,
                                                mouseX: e.clientX, mouseY: e.clientY,
                                            });
                                        } else {
                                            setAiDialog(null);
                                        }
                                    }}
                                    onKeyDown={e => {
                                        if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                                            e.preventDefault();
                                            const prev = undoContentStackRef.current.pop();
                                            if (prev !== undefined) {
                                                setEditingContent(prev);
                                            }
                                        }
                                    }}
                                />
                            </>`;
    
    content = content.substring(0, startIdx) + newContent + content.substring(endIdx);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('REPLACED successfully');
} else {
    console.log('Could not find the text. startIdx=' + startIdx + ' endIdx=' + endIdx);
    process.exit(1);
}
