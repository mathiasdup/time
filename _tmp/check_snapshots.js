const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Find all file-history-snapshot entries
for (let i = 0; i < tlines.length; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    if (obj.type === 'file-history-snapshot') {
      const snapshot = obj.snapshot || {};
      const files = Object.keys(snapshot);
      const hasGA = files.some(f => f.includes('game-animations'));
      console.log('Line ' + (i+1) + ': snapshot has ' + files.length + ' files, has game-animations: ' + hasGA);
      if (hasGA) {
        for (const f of files) {
          if (f.includes('game-animations')) {
            const content = snapshot[f];
            console.log('  File: ' + f);
            console.log('  Content type: ' + typeof content);
            if (typeof content === 'string') {
              console.log('  Length: ' + content.length + ' chars, ' + content.split('\n').length + ' lines');
              console.log('  First 200 chars: ' + content.substring(0, 200));
              console.log('  Contains riposteDamage: ' + content.includes('riposteDamage'));
            } else if (typeof content === 'object') {
              console.log('  Keys: ' + Object.keys(content).join(', '));
              console.log('  JSON: ' + JSON.stringify(content).substring(0, 300));
            }
          }
        }
      }
    }
  } catch (e) { }
}
