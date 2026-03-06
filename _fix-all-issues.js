// Fix all issues: death flash, buffApply DOM update, server baseAtk/baseHp
const fs = require('fs');

function readFile(path) {
    const src = fs.readFileSync(path, 'utf8');
    const crlf = src.includes('\r\n');
    const nl = crlf ? '\r\n' : '\n';
    return { src, nl, crlf };
}

function writeFile(path, src) {
    fs.writeFileSync(path, src, 'utf8');
}

let errors = 0;

// =============================================================
// FIX 1: game-render.js — Skip pending death slots in renderField
// =============================================================
{
    const path = 'public/js/game-render.js';
    let { src, nl } = readFile(path);

    const anchor = `const card = field[r][c];${nl}            if (card) {${nl}                _traceInvalidCardStats('renderField:slot', card, { owner, row: r, col: c });`;
    const replace = `const card = field[r][c];${nl}            // Skip re-creating cards on slots with pending death (prevents stale render flash)${nl}            if (card && !slot.querySelector('.card') && window._pendingDeathSlots && window._pendingDeathSlots.has(slotKey)) {${nl}                continue;${nl}            }${nl}            if (card) {${nl}                _traceInvalidCardStats('renderField:slot', card, { owner, row: r, col: c });`;

    if (!src.includes(anchor)) {
        console.error('ERROR: game-render.js anchor not found (pendingDeath)');
        errors++;
    } else {
        src = src.replace(anchor, replace);
        writeFile(path, src);
        console.log('OK: game-render.js — pendingDeathSlots check added');
    }
}

// =============================================================
// FIX 2: game-animations.js — pendingDeathSlots + buffApply DOM update
// =============================================================
{
    const path = 'public/js/game-animations.js';
    let { src, nl } = readFile(path);

    // Change 2a: Add pendingDeathSlots in queueAnimation for death/sacrifice
    const anchor2a = `animatingSlots.add(slotKey);${nl}        console.log("[SPECTRE-DBG] queue death: slot locked", slotKey);`;
    const replace2a = `animatingSlots.add(slotKey);${nl}        if (!window._pendingDeathSlots) window._pendingDeathSlots = new Set();${nl}        window._pendingDeathSlots.add(slotKey);${nl}        console.log("[SPECTRE-DBG] queue death: slot locked", slotKey);`;

    if (!src.includes(anchor2a)) {
        console.error('ERROR: game-animations.js anchor not found (pendingDeath queueAnimation)');
        errors++;
    } else {
        src = src.replace(anchor2a, replace2a);
        console.log('OK: game-animations.js — pendingDeathSlots added in queueAnimation');
    }

    // Change 2b: Enhance buffApply handler with DOM update + anti-flicker clear
    const anchor2b = [
        `case 'buffApply': {`,
        `// VFX buff (+ATK/+HP) on card`,
        `const baOwner = data.player === myNum ? 'me' : 'opp';`,
        `const baSlot = getSlot(baOwner, data.row, data.col);`,
        `if (baSlot) {`,
        `const rect = baSlot.getBoundingClientRect();`,
        `CombatVFX.createBuffEffect(rect.left + rect.width / 2, rect.top + rect.height / 2, data.atkBuff ?? 1, data.hpBuff ?? 1, rect.width, rect.height);`,
        `}`,
        `await new Promise(r => setTimeout(r, 600));`,
        `break;`,
        `}`
    ].join('');
    // Build the actual anchor by reading the file content around "case 'buffApply'"
    const buffIdx = src.indexOf("case 'buffApply': {");
    if (buffIdx === -1) {
        console.error('ERROR: game-animations.js — buffApply case not found');
        errors++;
    } else {
        // Find the closing break; } for this case
        const breakSearch = 'await new Promise(r => setTimeout(r, 600));';
        const breakIdx = src.indexOf(breakSearch, buffIdx);
        if (breakIdx === -1) {
            console.error('ERROR: game-animations.js — buffApply await not found');
            errors++;
        } else {
            // Find the 'break;' after the await
            const afterAwait = src.indexOf('break;', breakIdx);
            // Find the closing '}' of the case block
            const closingBrace = src.indexOf('}', afterAwait + 6);
            // Extract the full case block
            const fullBlock = src.substring(buffIdx, closingBrace + 1);

            const newBlock = [
                "case 'buffApply': {",
                "            // VFX buff (+ATK/+HP) on card — queued so it plays after burn",
                "            const baOwner = data.player === myNum ? 'me' : 'opp';",
                "            const baSlot = getSlot(baOwner, data.row, data.col);",
                "            if (baSlot) {",
                "                const rect = baSlot.getBoundingClientRect();",
                "                CombatVFX.createBuffEffect(rect.left + rect.width / 2, rect.top + rect.height / 2, data.atkBuff ?? 1, data.hpBuff ?? 1, rect.width, rect.height);",
                "                // Clear anti-flicker markers + update DOM directly for buff",
                "                const buffCardEl = baSlot.querySelector('.card');",
                "                if (buffCardEl) {",
                "                    delete buffCardEl.dataset.visualDmgHp;",
                "                    delete buffCardEl.dataset.visualDmgSetAt;",
                "                    const buffHpEl = buffCardEl.querySelector('.arena-armor') || buffCardEl.querySelector('.arena-hp') || buffCardEl.querySelector('.img-hp');",
                "                    const buffAtkEl = buffCardEl.querySelector('.arena-atk') || buffCardEl.querySelector('.img-atk');",
                "                    if (buffHpEl && data.hpBuff) {",
                "                        const oldHp = parseInt(buffHpEl.textContent || '0', 10);",
                "                        if (Number.isFinite(oldHp)) buffHpEl.textContent = String(oldHp + data.hpBuff);",
                "                    }",
                "                    if (buffAtkEl && data.atkBuff) {",
                "                        const oldAtk = parseInt(buffAtkEl.textContent || '0', 10);",
                "                        if (Number.isFinite(oldAtk)) buffAtkEl.textContent = String(oldAtk + data.atkBuff);",
                "                    }",
                "                    const buffRipEl = buffCardEl.querySelector('.arena-riposte');",
                "                    if (buffRipEl && data.hpBuff) {",
                "                        const oldRip = parseInt(buffRipEl.textContent || '0', 10);",
                "                        if (Number.isFinite(oldRip)) buffRipEl.textContent = String(oldRip + data.hpBuff);",
                "                    }",
                "                }",
                "            }",
                "            await new Promise(r => setTimeout(r, 600));",
                "            break;",
                "        }"
            ].join(nl);

            src = src.replace(fullBlock, newBlock);
            console.log('OK: game-animations.js — buffApply handler enhanced with DOM update');
        }
    }

    writeFile(path, src);
}

// =============================================================
// FIX 3: game-core.js — Clear pendingDeathSlots in _renderFromStateUpdate
// =============================================================
{
    const path = 'public/js/game-core.js';
    let { src, nl } = readFile(path);

    const anchor = `function _renderFromStateUpdate(phase) {`;
    const replace = `function _renderFromStateUpdate(phase) {${nl}    // Clear pending death markers — new state is authoritative${nl}    if (window._pendingDeathSlots) window._pendingDeathSlots.clear();`;

    if (!src.includes(anchor)) {
        console.error('ERROR: game-core.js anchor not found (_renderFromStateUpdate)');
        errors++;
    } else {
        src = src.replace(anchor, replace);
        writeFile(path, src);
        console.log('OK: game-core.js — pendingDeathSlots.clear() added');
    }
}

// =============================================================
// FIX 4: server.js — Initialize baseAtk/baseHp/baseRiposte in buffOnAnyPoisonDeath
// =============================================================
{
    const path = 'server.js';
    let { src, nl } = readFile(path);

    // There are TWO copies of this code — fix both
    const anchor = `if (card && card.currentHp > 0 && card.buffOnAnyPoisonDeath) {${nl}                            card.buffCounters = (card.buffCounters || 0) + totalPoisonDeaths;${nl}                            card.atk += totalPoisonDeaths;`;
    const replace = `if (card && card.currentHp > 0 && card.buffOnAnyPoisonDeath) {${nl}                            if (card.baseAtk === undefined) card.baseAtk = card.atk;${nl}                            if (card.baseHp === undefined) card.baseHp = card.hp;${nl}                            if (card.baseRiposte === undefined) card.baseRiposte = card.riposte ?? 0;${nl}                            card.buffCounters = (card.buffCounters || 0) + totalPoisonDeaths;${nl}                            card.atk += totalPoisonDeaths;`;

    const count = (src.match(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count === 0) {
        console.error('ERROR: server.js anchor not found (buffOnAnyPoisonDeath)');
        errors++;
    } else {
        // Replace all occurrences
        while (src.includes(anchor)) {
            src = src.replace(anchor, replace);
        }
        writeFile(path, src);
        console.log(`OK: server.js — baseAtk/baseHp/baseRiposte initialized (${count} locations)`);
    }
}

// =============================================================
// Summary
// =============================================================
if (errors > 0) {
    console.error(`\n${errors} ERROR(S) — some fixes were not applied!`);
    process.exit(1);
} else {
    console.log('\nAll fixes applied successfully:');
    console.log('  1. game-render.js: pendingDeathSlots check in renderField');
    console.log('  2. game-animations.js: pendingDeathSlots in queueAnimation + buffApply DOM update');
    console.log('  3. game-core.js: pendingDeathSlots.clear() in _renderFromStateUpdate');
    console.log('  4. server.js: baseAtk/baseHp/baseRiposte in buffOnAnyPoisonDeath (x2)');
}
