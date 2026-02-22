const fs = require('fs');
const path = require('path');

const tmpDir = path.join('C:', 'Users', 'Math', 'Documents', 'Bataille', '_tmp');
const content = fs.readFileSync(path.join(tmpDir, 'game-animations-reconstructed.js'), 'utf-8');

// Search for "Le wrapper démarre" in the reconstructed file
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Le wrapper démarre')) {
    console.log('Found "Le wrapper démarre" at line ' + (i+1) + ':');
    for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 15); j++) {
      console.log('  ' + (j+1) + ': ' + lines[j]);
    }
    console.log('---');
  }
}

// Also search for "showcaseScale" near the edit 235 area
console.log('\nSearching for spellZoom:');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('spellZoom')) {
    console.log('  Line ' + (i+1) + ': ' + lines[i].trim());
  }
}
