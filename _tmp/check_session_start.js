const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Look at the first few lines for session start info, gitStatus
for (let i = 0; i < 10; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'summary' || obj.type === 'system' || obj.type === 'init') {
      console.log('Line ' + (i+1) + ' type=' + obj.type);
      if (obj.gitStatus) console.log('  gitStatus:', obj.gitStatus.substring(0, 500));
      if (obj.cwd) console.log('  cwd:', obj.cwd);
      // Check for any relevant info
      const str = JSON.stringify(obj);
      if (str.includes('game-animations')) {
        console.log('  Contains game-animations reference');
        // Extract the context
        const idx = str.indexOf('game-animations');
        console.log('  Context: ...' + str.substring(Math.max(0, idx-100), idx+200) + '...');
      }
    }
    // Also check for the initial user message that might contain gitStatus
    if (obj.type === 'user' || obj.type === 'system') {
      const str = JSON.stringify(obj).substring(0, 2000);
      if (str.includes('game-animations') || str.includes('gitStatus')) {
        console.log('Line ' + (i+1) + ' type=' + obj.type + ' has relevant info');
        const sidx = str.indexOf('game-animations');
        if (sidx >= 0) console.log('  Context: ' + str.substring(Math.max(0, sidx-50), sidx+100));
      }
    }
  } catch (e) { }
}

// Also look for any git status / git diff commands early in the session
for (let i = 0; i < 30; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_use' && block.name === 'Bash') {
          const cmd = block.input.command || '';
          if (cmd.includes('status') || cmd.includes('diff')) {
            console.log('Line ' + (i+1) + ': ' + cmd.substring(0, 150));
          }
        }
      }
    }
  } catch(e) {}
}
