const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Extract edits 235, 238, 244
const targetLines = [235, 238, 244];
for (let i = 0; i < 376; i++) {
  if (!lines[i].trim()) continue;
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_use' && block.name === 'Edit' && block.input && String(block.input.file_path || '').includes('game-animations')) {
          if (targetLines.includes(i + 1)) {
            console.log('=== EDIT at transcript line ' + (i+1) + ' ===');
            console.log('OLD STRING (' + block.input.old_string.split('\n').length + ' lines):');
            console.log(block.input.old_string.substring(0, 500));
            console.log('...');
            console.log('\nNEW STRING (' + block.input.new_string.split('\n').length + ' lines):');
            console.log(block.input.new_string.substring(0, 500));
            console.log('...\n\n');
          }
        }
      }
    }
  } catch (e) { }
}
