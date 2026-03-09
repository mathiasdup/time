// Fix v3: Add targetPlayer to remaining addPoisonCounters calls
const fs = require('fs');

const path = 'server.js';
let src = fs.readFileSync(path, 'utf8');
let fixes = 0;

function addTargetPlayer(anchorSource, targetVar) {
    const anchor = "source: '" + anchorSource + "',";
    let searchFrom = 0;
    while (true) {
        const idx = src.indexOf(anchor, searchFrom);
        if (idx === -1) break;
        const closeSearch = '}, room);';
        const closeIdx = src.indexOf(closeSearch, idx);
        if (closeIdx !== -1 && (closeIdx - idx) < 500) {
            const between = src.substring(idx, closeIdx + closeSearch.length);
            if (!between.includes(', room,')) {
                src = src.substring(0, closeIdx) + '}, room, ' + targetVar + ');' + src.substring(closeIdx + closeSearch.length);
                fixes++;
                console.log('OK: ' + anchorSource + ' — added ' + targetVar);
            }
        }
        searchFrom = idx + 1;
    }
}

addTargetPlayer('building.selfPoison', 'playerNum');
addTargetPlayer('building.poisonAll', 'p');
addTargetPlayer('processOnPoisonDeath.spill', 'targetPlayer');
addTargetPlayer('trap.poison', 'targetPlayer');
addTargetPlayer('spell.poison', 'targetPlayer');

// Generic: find any remaining using broader patterns
// Look for lines with source patterns we might have missed
const patterns = [
    { search: "addPoisonCounters(t, totalPoison,", context: 500 },
    { search: "addPoisonCounters(target, amount,", context: 500 },
    { search: "addPoisonCounters(target, totalPoison,", context: 500 }
];

for (const pat of patterns) {
    let pos = 0;
    while (true) {
        const idx = src.indexOf(pat.search, pos);
        if (idx === -1) break;
        const endSearch = '}, room);';
        const endIdx = src.indexOf(endSearch, idx);
        if (endIdx !== -1 && (endIdx - idx) < pat.context) {
            const snippet = src.substring(idx, endIdx + endSearch.length);
            if (!snippet.includes(', room,')) {
                const lineNum = src.substring(0, idx).split('\n').length;
                console.log('REMAINING line ' + lineNum + ': needs manual targetPlayer');
            }
        }
        pos = idx + 1;
    }
}

fs.writeFileSync(path, src, 'utf8');
console.log('\nFixed ' + fixes + ' additional calls');
