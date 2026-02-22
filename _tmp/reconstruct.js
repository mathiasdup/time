const fs = require('fs');
const path = require('path');

const tmpDir = path.join('C:', 'Users', 'Math', 'Documents', 'Bataille', '_tmp');
const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');

console.log('Reading transcript from:', transcriptPath);

// Re-extract edits
const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
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

console.log('Found ' + edits.length + ' edits in transcript');

// Read git base version
let content = fs.readFileSync(path.join(tmpDir, 'game-animations-git.js'), 'utf-8');
console.log('Base version: ' + content.split('\n').length + ' lines');

// Apply edits in order, skip the failed one (line 199)
let applied = 0;
let skipped = 0;
for (const edit of edits) {
  if (edit.line === 199) {
    console.log('Skipping failed edit at line ' + edit.line);
    skipped++;
    continue;
  }

  const idx = content.indexOf(edit.old_string);
  if (idx === -1) {
    console.log('WARNING: Could not find old_string for edit at line ' + edit.line);
    console.log('  First 100 chars: ' + JSON.stringify(edit.old_string.substring(0, 100)));
    skipped++;
    continue;
  }

  content = content.substring(0, idx) + edit.new_string + content.substring(idx + edit.old_string.length);
  applied++;
  const delta = edit.new_string.split('\n').length - edit.old_string.split('\n').length;
  console.log('Applied edit at transcript line ' + edit.line + ' (delta: ' + (delta >= 0 ? '+' : '') + delta + ' lines)');
}

console.log('\nApplied ' + applied + ' edits, skipped ' + skipped);
console.log('Result: ' + content.split('\n').length + ' lines');

// Check for riposteDamage
const hasRiposte = content.includes('riposteDamage');
console.log('Contains riposteDamage: ' + hasRiposte);

fs.writeFileSync(path.join(tmpDir, 'game-animations-reconstructed.js'), content);
console.log('Saved to _tmp/game-animations-reconstructed.js');
