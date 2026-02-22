const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Get result for tool at line 487
let toolId487 = null;
const obj487 = JSON.parse(tlines[486]);
for (const block of obj487.message.content) {
  if (block.type === 'tool_use') toolId487 = block.id;
}
console.log('Tool ID at line 487:', toolId487);

// Find result
for (let i = 487; i < 495; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id === toolId487) {
          console.log('Result:', block.content);
        }
      }
    }
  } catch (e) { }
}

// Also get the wc -l result at line 491
let toolId491 = null;
const obj491 = JSON.parse(tlines[490]);
for (const block of obj491.message.content) {
  if (block.type === 'tool_use') toolId491 = block.id;
}

for (let i = 491; i < 497; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id === toolId491) {
          console.log('\nDiff wc -l:', block.content);
        }
      }
    }
  } catch (e) { }
}
