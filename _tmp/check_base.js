const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Get the tool_result for the first read of game-animations.js (line 84, tool id toolu_01Pgs5tq1ZD16dtkdjnCosR1)
// The read was offset=1410, limit=120 -- let's see what it returned
const targetId = 'toolu_01Pgs5tq1ZD16dtkdjnCosR1';

for (let i = 84; i < Math.min(tlines.length, 100); i++) {
  if (!tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id === targetId) {
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          console.log('First read result (offset=1410, limit=120):');
          console.log('Length: ' + content.length);
          console.log('First 300 chars:\n' + content.substring(0, 300));
          console.log('\n...\nLast 300 chars:\n' + content.substring(Math.max(0, content.length - 300)));
        }
      }
    }
  } catch (e) { }
}

// Also check what the git version has at line 1410
const tmpDir = path.join('C:', 'Users', 'Math', 'Documents', 'Bataille', '_tmp');
const gitContent = fs.readFileSync(path.join(tmpDir, 'game-animations-git.js'), 'utf-8');
const gitLines = gitContent.split('\n');
console.log('\n\nGit version at line 1410:');
for (let i = 1408; i < Math.min(gitLines.length, 1420); i++) {
  console.log('  ' + (i+1) + ': ' + gitLines[i]);
}
