const fs = require('fs');
const path = require('path');

const transcriptPath = path.join('C:', 'Users', 'Math', '.claude', 'projects', 'c--Users-Math-Documents-Bataille', 'e7fdd3a8-2cd1-4327-9ffa-029ab904193b.jsonl');
const tlines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

// Show first 10 lines' types and key fields
for (let i = 0; i < 15; i++) {
  if (!tlines[i] || !tlines[i].trim()) continue;
  try {
    const obj = JSON.parse(tlines[i]);
    const keys = Object.keys(obj);
    console.log('Line ' + (i+1) + ': type=' + obj.type + ', keys=' + keys.join(','));
    // Look for anything about game-animations in the full object
    const full = JSON.stringify(obj);
    if (full.includes('game-animations')) {
      console.log('  -> CONTAINS game-animations');
    }
  } catch (e) {
    console.log('Line ' + (i+1) + ': PARSE ERROR');
  }
}
