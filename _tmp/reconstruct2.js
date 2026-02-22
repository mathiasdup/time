const fs = require('fs');
const path = require('path');

const tmpDir = path.join('C:', 'Users', 'Math', 'Documents', 'Bataille', '_tmp');
const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');

const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Extract ALL edits and their tool results
const edits = [];
for (let i = 0; i < 376; i++) {
  if (!lines[i].trim()) continue;
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_use' && block.name === 'Edit' && block.input && String(block.input.file_path || '').includes('game-animations')) {
          edits.push({
            line: i + 1,
            id: block.id,
            old_string: block.input.old_string,
            new_string: block.input.new_string,
          });
        }
      }
    }
  } catch (e) { }
}

// Check which edits succeeded by looking at tool results
for (const edit of edits) {
  for (let i = edit.line; i < Math.min(lines.length, edit.line + 10); i++) {
    if (!lines[i].trim()) continue;
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id === edit.id) {
            edit.success = !block.is_error;
            edit.result = typeof block.content === 'string' ? block.content.substring(0, 200) : JSON.stringify(block.content).substring(0, 200);
          }
        }
      }
    } catch (e) { }
  }
}

// Show edit details
for (const edit of edits) {
  console.log('Line ' + edit.line + ': success=' + edit.success);
  if (!edit.success) {
    console.log('  Result: ' + edit.result);
  }
}

// Now, the issue: edits that succeeded on the server changed the file state
// Each successive edit's old_string should match AFTER previous edits were applied
// Let me try applying them as a chain

let content = fs.readFileSync(path.join(tmpDir, 'game-animations-git.js'), 'utf-8');
console.log('\nBase: ' + content.split('\n').length + ' lines');

let applied = 0;
for (const edit of edits) {
  if (!edit.success) {
    console.log('Skipping failed edit at line ' + edit.line);
    continue;
  }

  const idx = content.indexOf(edit.old_string);
  if (idx === -1) {
    console.log('CANNOT APPLY edit at line ' + edit.line);
    // Let's see what's around the expected area
    const firstLine = edit.old_string.split('\n')[0];
    const searchIdx = content.indexOf(firstLine);
    if (searchIdx !== -1) {
      const lineNum = content.substring(0, searchIdx).split('\n').length;
      console.log('  First line found at line ' + lineNum);
      // Show context
      const contentLines = content.split('\n');
      console.log('  Context:');
      for (let j = Math.max(0, lineNum - 3); j < Math.min(contentLines.length, lineNum + 5); j++) {
        console.log('    ' + (j+1) + ': ' + contentLines[j].substring(0, 80));
      }
    } else {
      console.log('  First line not found: ' + JSON.stringify(firstLine.substring(0, 80)));
    }
    continue;
  }

  content = content.substring(0, idx) + edit.new_string + content.substring(idx + edit.old_string.length);
  applied++;
  console.log('Applied edit at line ' + edit.line + ' OK');
}

console.log('\nApplied ' + applied + '/' + edits.length + ' edits');
console.log('Result: ' + content.split('\n').length + ' lines');
console.log('Contains riposteDamage: ' + content.includes('riposteDamage'));

fs.writeFileSync(path.join(tmpDir, 'game-animations-reconstructed.js'), content);
