// Fix v2: Add targetPlayer to remaining addPoisonCounters calls
const fs = require('fs');

const path = 'server.js';
let src = fs.readFileSync(path, 'utf8');
let fixes = 0;

// 1. Combat onHit poison (line ~1264) — targetPlayer = ownerPlayer
const combatCall = "}, room);";
// This is too generic. Let's find the specific one by context
const combatAnchor = "source: 'combat.onHit.poison',";
const combatIdx = src.indexOf(combatAnchor);
if (combatIdx !== -1) {
    // Find the closing "}, room);" after this anchor
    const closeSearch = '}, room);';
    const closeIdx = src.indexOf(closeSearch, combatIdx);
    if (closeIdx !== -1) {
        // Check if it already has targetPlayer
        const snippet = src.substring(combatIdx, closeIdx + closeSearch.length);
        if (!snippet.includes('targetPlayer')) {
            src = src.substring(0, closeIdx) + '}, room, ownerPlayer);' + src.substring(closeIdx + closeSearch.length);
            fixes++;
            console.log('OK: combat.onHit.poison — added ownerPlayer');
        }
    }
}

// 2. combat.onEnemyDamage.poisonRow (line ~1323) — targetPlayer = p
const poisonRowCombatAnchor = "source: 'combat.onEnemyDamage.poisonRow',";
const poisonRowCombatIdx = src.indexOf(poisonRowCombatAnchor);
if (poisonRowCombatIdx !== -1) {
    const closeSearch = '}, room);';
    const closeIdx = src.indexOf(closeSearch, poisonRowCombatIdx);
    if (closeIdx !== -1) {
        const snippet = src.substring(poisonRowCombatIdx, closeIdx + closeSearch.length);
        if (!snippet.includes('targetPlayer')) {
            src = src.substring(0, closeIdx) + '}, room, p);' + src.substring(closeIdx + closeSearch.length);
            fixes++;
            console.log('OK: combat.onEnemyDamage.poisonRow — added p');
        }
    }
}

// 3. summon.selfPoison (line ~2333) — targetPlayer = playerNum
const selfPoisonAnchor = "source: 'summon.selfPoison',";
const selfPoisonIdx = src.indexOf(selfPoisonAnchor);
if (selfPoisonIdx !== -1) {
    const closeSearch = '}, room);';
    const closeIdx = src.indexOf(closeSearch, selfPoisonIdx);
    if (closeIdx !== -1) {
        const snippet = src.substring(selfPoisonIdx, closeIdx + closeSearch.length);
        if (!snippet.includes('targetPlayer')) {
            src = src.substring(0, closeIdx) + '}, room, playerNum);' + src.substring(closeIdx + closeSearch.length);
            fixes++;
            console.log('OK: summon.selfPoison — added playerNum');
        }
    }
}

// 4. poisonAdjacent (line ~2848) — targetPlayer varies, look at context
const poisonAdjAnchor = "source: 'onDeath.poisonAdjacent',";
const poisonAdjIdx = src.indexOf(poisonAdjAnchor);
if (poisonAdjIdx !== -1) {
    const closeSearch = '}, room);';
    const closeIdx = src.indexOf(closeSearch, poisonAdjIdx);
    if (closeIdx !== -1) {
        const snippet = src.substring(poisonAdjIdx, closeIdx + closeSearch.length);
        if (!snippet.includes('targetPlayer')) {
            // Look back to find the player variable — it's t.p in this context
            src = src.substring(0, closeIdx) + '}, room, t.p);' + src.substring(closeIdx + closeSearch.length);
            fixes++;
            console.log('OK: onDeath.poisonAdjacent — added t.p');
        }
    }
}

// 5. processOnDeathAbility poison (line ~3364) — targetPlayer = look at context
const onDeathPoisonAnchor = "source: 'onDeath.addPoison',";
let searchFrom = 0;
while (true) {
    const idx = src.indexOf(onDeathPoisonAnchor, searchFrom);
    if (idx === -1) break;
    const closeSearch = '}, room);';
    const closeIdx = src.indexOf(closeSearch, idx);
    if (closeIdx !== -1) {
        const snippet = src.substring(idx, closeIdx + closeSearch.length);
        if (!snippet.includes('targetPlayer')) {
            // In processOnDeathAbility, the card is owned by ownerPlayer
            src = src.substring(0, closeIdx) + '}, room, ownerPlayer);' + src.substring(closeIdx + closeSearch.length);
            fixes++;
            console.log('OK: onDeath.addPoison — added ownerPlayer');
        }
    }
    searchFrom = idx + 1;
}

// 6. Find remaining calls without targetPlayer
const remaining = [];
const regex = /addPoisonCounters\([^)]+\)/g;
let match;
while ((match = regex.exec(src)) !== null) {
    if (!match[0].includes('targetPlayer') && match[0].includes('room') && !match[0].includes('room,')) {
        // Has room but no 5th param
        const lineNum = src.substring(0, match.index).split('\n').length;
        remaining.push('Line ' + lineNum + ': ' + match[0].substring(0, 60) + '...');
    }
}

fs.writeFileSync(path, src, 'utf8');
console.log('\nFixed ' + fixes + ' calls');
if (remaining.length > 0) {
    console.log('\nRemaining calls without targetPlayer:');
    remaining.forEach(r => console.log('  ' + r));
}
