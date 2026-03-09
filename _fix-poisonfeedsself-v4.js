// Fix v4: Add targetPlayer to the 5 remaining addPoisonCounters calls
const fs = require('fs');

const path = 'server.js';
let src = fs.readFileSync(path, 'utf8');
let fixes = 0;

// Each remaining call identified by source + unique context
const fixList = [
    // Line ~3529: poisonExplosion — target player is enemyNum
    { source: 'onDeath.poisonExplosion', varName: 'enemyNum', occurrence: 1 },
    // Line ~5511: poisonExplosion duplicate — target player is eNum
    { source: 'onDeath.poisonExplosion', varName: 'eNum', occurrence: 2 },
    // Line ~5620: spell.poisonAllEnemies — target player is opponentNum
    { source: 'spell.poisonAllEnemies', varName: 'opponentNum', occurrence: 1 },
    // Line ~5654: spell.poisonAllCreatures — target player is p
    { source: 'spell.poisonAllCreatures', varName: 'p', occurrence: 1 },
    // Line ~6484: spell.poisonTarget — target player is action.targetPlayer
    { source: 'spell.poisonTarget', varName: 'action.targetPlayer', occurrence: 1 },
];

for (const fix of fixList) {
    const anchor = "source: '" + fix.source + "',";
    let searchFrom = 0;
    let occ = 0;
    while (true) {
        const idx = src.indexOf(anchor, searchFrom);
        if (idx === -1) break;
        occ++;
        if (occ === fix.occurrence) {
            const closeSearch = '}, room);';
            const closeIdx = src.indexOf(closeSearch, idx);
            if (closeIdx !== -1 && (closeIdx - idx) < 500) {
                src = src.substring(0, closeIdx) + '}, room, ' + fix.varName + ');' + src.substring(closeIdx + closeSearch.length);
                fixes++;
                console.log('OK: ' + fix.source + ' #' + fix.occurrence + ' — added ' + fix.varName);
            }
            break;
        }
        searchFrom = idx + 1;
    }
}

// Also handle trap.poison calls
const trapPoisonAnchor = "source: 'trap.poison',";
let tpSearchFrom = 0;
while (true) {
    const idx = src.indexOf(trapPoisonAnchor, tpSearchFrom);
    if (idx === -1) break;
    const closeSearch = '}, room);';
    const closeIdx = src.indexOf(closeSearch, idx);
    if (closeIdx !== -1 && (closeIdx - idx) < 500) {
        const snippet = src.substring(idx, closeIdx + closeSearch.length);
        if (!snippet.includes(', room,')) {
            // Need to find the target player variable
            // Look at context before the addPoisonCounters call
            const callStart = src.lastIndexOf('addPoisonCounters(', closeIdx);
            const contextBefore = src.substring(Math.max(0, callStart - 300), callStart);
            // Try to find a player variable
            let targetVar = 'attackerPlayer';
            if (contextBefore.includes('targetPlayer')) targetVar = 'targetPlayer';
            else if (contextBefore.includes('action.targetPlayer')) targetVar = 'action.targetPlayer';
            src = src.substring(0, closeIdx) + '}, room, ' + targetVar + ');' + src.substring(closeIdx + closeSearch.length);
            fixes++;
            console.log('OK: trap.poison — added ' + targetVar);
        }
    }
    tpSearchFrom = idx + 1;
}

fs.writeFileSync(path, src, 'utf8');
console.log('\nFixed ' + fixes + ' remaining calls');
