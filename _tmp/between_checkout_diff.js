const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Show ALL tool_use calls between lines 376-493
for (let i = 375; i < 500; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_use') {
          const inp = block.input || {};
          const info = inp.file_path || inp.command || '';
          console.log('Line ' + (i+1) + ': ' + block.name + ' -> ' + String(info).substring(0, 150));
        }
      }
    }
  } catch (e) { }
}
