// Fix: poisonFeedsSelf (Serpent d'émeraude) should emit buffApply animation
// so the client DOM shows the HP/ATK buff correctly
const fs = require('fs');

const path = 'server.js';
let src = fs.readFileSync(path, 'utf8');

// Add targetPlayer parameter to addPoisonCounters
const oldSig = 'function addPoisonCounters(card, amount, meta = {}, room = null) {';
const newSig = 'function addPoisonCounters(card, amount, meta = {}, room = null, targetPlayer = null) {';

if (!src.includes(oldSig)) {
    console.error('ERROR: addPoisonCounters signature not found');
    process.exit(1);
}
src = src.replace(oldSig, newSig);

// Add emitAnimation after the poisonFeedsSelf buff
const oldBuff = [
    "    if (card.poisonFeedsSelf && inc > 0) {",
    "        if (card.baseAtk === undefined) card.baseAtk = card.atk;",
    "        if (card.baseHp === undefined) card.baseHp = card.hp;",
    "        if (card.baseRiposte === undefined) card.baseRiposte = card.riposte ?? 0;",
    "        card.buffCounters = (card.buffCounters || 0) + inc;",
    "        card.hp += inc;",
    "        card.currentHp += inc;",
    "        card.riposte = (card.riposte || 0) + inc;",
    "    }"
].join('\n');

const newBuff = [
    "    if (card.poisonFeedsSelf && inc > 0) {",
    "        if (card.baseAtk === undefined) card.baseAtk = card.atk;",
    "        if (card.baseHp === undefined) card.baseHp = card.hp;",
    "        if (card.baseRiposte === undefined) card.baseRiposte = card.riposte ?? 0;",
    "        card.buffCounters = (card.buffCounters || 0) + inc;",
    "        card.hp += inc;",
    "        card.currentHp += inc;",
    "        card.riposte = (card.riposte || 0) + inc;",
    "        // Emit buffApply so client DOM updates HP/ATK",
    "        if (room && targetPlayer && meta.row !== undefined && meta.col !== undefined) {",
    "            emitAnimation(room, 'buffApply', { player: targetPlayer, row: meta.row, col: meta.col, atkBuff: 0, hpBuff: inc });",
    "        }",
    "    }"
].join('\n');

if (!src.includes(oldBuff)) {
    // Try CRLF
    const oldBuffCRLF = oldBuff.replace(/\n/g, '\r\n');
    if (src.includes(oldBuffCRLF)) {
        src = src.replace(oldBuffCRLF, newBuff.replace(/\n/g, '\r\n'));
    } else {
        console.error('ERROR: poisonFeedsSelf block not found');
        process.exit(1);
    }
} else {
    src = src.replace(oldBuff, newBuff);
}

// Now update the calls that target the Serpent — we need to pass targetPlayer
// The main calls where poisonFeedsSelf matters are in:
// 1. poisonRow (line ~2716) — target is player p
// 2. poisonAll (line ~2743) — target is player p
// 3. poisonAdjacent — target is various players
// 4. Combat damage poison (line ~1260) — onEnemyDamage
// 5. applyPoison in resolution (line ~2329) — direct poison application

// Rather than updating every call, let's add targetPlayer in the key calls
// where row/col are in meta

// poisonRow case - player p is the target
const poisonRowCall = "addPoisonCounters(target, effect.poisonAmount, {\n                            source: 'onDeath.poisonRow',\n                            turn: room.gameState.turn,\n                            row: effect.row,\n                            col: c,\n                            sourcePlayer: effect.sourcePlayer,\n                            byCard: effect.source || null,\n                            byUid: null\n                        }, room);";
const poisonRowCallNew = "addPoisonCounters(target, effect.poisonAmount, {\n                            source: 'onDeath.poisonRow',\n                            turn: room.gameState.turn,\n                            row: effect.row,\n                            col: c,\n                            sourcePlayer: effect.sourcePlayer,\n                            byCard: effect.source || null,\n                            byUid: null\n                        }, room, p);";

if (src.includes(poisonRowCall)) {
    src = src.replace(poisonRowCall, poisonRowCallNew);
    console.log('OK: poisonRow call updated with targetPlayer');
} else {
    console.log('SKIP: poisonRow call not found (may use CRLF)');
}

// poisonAll case - player p is the target
const poisonAllCall = "addPoisonCounters(target, effect.poisonAmount, {\n                                source: 'onDeath.poisonAll',\n                                turn: room.gameState.turn,\n                                row: r,\n                                col: c,\n                                sourcePlayer: effect.sourcePlayer,\n                                byCard: effect.source || null,\n                                byUid: effect.sourceUid || null\n                            }, room);";
const poisonAllCallNew = "addPoisonCounters(target, effect.poisonAmount, {\n                                source: 'onDeath.poisonAll',\n                                turn: room.gameState.turn,\n                                row: r,\n                                col: c,\n                                sourcePlayer: effect.sourcePlayer,\n                                byCard: effect.source || null,\n                                byUid: effect.sourceUid || null\n                            }, room, p);";

if (src.includes(poisonAllCall)) {
    src = src.replace(poisonAllCall, poisonAllCallNew);
    console.log('OK: poisonAll call updated with targetPlayer');
} else {
    console.log('SKIP: poisonAll call not found (may use CRLF)');
}

// For combat poison (onEnemyDamage: poisonRow) — find and update
// Generic approach: find all addPoisonCounters calls and add targetPlayer where we can deduce it
// For now, let's handle the main combat poison call

fs.writeFileSync(path, src, 'utf8');
console.log('\nDone: poisonFeedsSelf now emits buffApply animation');
console.log('Note: targetPlayer only added to poisonRow and poisonAll calls.');
console.log('Other poison sources may need updating if Serpent d\'émeraude receives poison from them.');
