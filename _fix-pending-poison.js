// Fix: Hide poison markers visually until poisonApply animation plays
// Prevents markers from appearing before the death animation of the source creature
const fs = require('fs');

let errors = 0;

// =============================================================
// FIX A: game-animations.js — Add pendingPoisonSlots logic
// =============================================================
{
    const path = 'public/js/game-animations.js';
    let src = fs.readFileSync(path, 'utf8');
    const nl = src.includes('\r\n') ? '\r\n' : '\n';

    // 1. In queueAnimation: when poisonApply is queued, add slot to _pendingPoisonSlots
    // Find the death/sacrifice pendingDeathSlots block to insert AFTER
    const deathSlotAnchor = "if ((type === 'death' || type === 'sacrifice') && data.row !== undefined && data.col !== undefined) {";
    const deathSlotIdx = src.indexOf(deathSlotAnchor);
    if (deathSlotIdx === -1) {
        console.error('ERROR: death/sacrifice anchor not found in game-animations.js');
        errors++;
    } else {
        // Find the closing of this if block (look for the next line starting with "    // Pour" or "    animationQueue")
        // Actually, let's find the block after the pendingDeathSlots add
        const pendingDeathAdd = "window._pendingDeathSlots.add(slotKey);";
        const pendingDeathIdx = src.indexOf(pendingDeathAdd, deathSlotIdx);
        if (pendingDeathIdx === -1) {
            console.error('ERROR: pendingDeathSlots.add not found after death/sacrifice block');
            errors++;
        } else {
            // Find the closing brace of this if block
            let braceCount = 0;
            let searchPos = deathSlotIdx;
            let closingBracePos = -1;
            for (let i = searchPos; i < src.length; i++) {
                if (src[i] === '{') braceCount++;
                if (src[i] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        closingBracePos = i;
                        break;
                    }
                }
            }
            if (closingBracePos === -1) {
                console.error('ERROR: closing brace for death/sacrifice block not found');
                errors++;
            } else {
                // Insert after the closing brace
                const insertPoint = closingBracePos + 1;
                const poisonQueueCode = nl +
                    '    // Pour poisonApply, masquer les marqueurs poison jusqu\'aux animations' + nl +
                    '    if (type === \'poisonApply\' && data.row !== undefined && data.col !== undefined) {' + nl +
                    '        const paOwner = data.player === myNum ? \'me\' : \'opp\';' + nl +
                    '        const paSlotKey = paOwner + \'-\' + data.row + \'-\' + data.col;' + nl +
                    '        if (!window._pendingPoisonSlots) window._pendingPoisonSlots = new Set();' + nl +
                    '        window._pendingPoisonSlots.add(paSlotKey);' + nl +
                    '    }';
                src = src.substring(0, insertPoint) + poisonQueueCode + src.substring(insertPoint);
                console.log('OK: game-animations.js — Added _pendingPoisonSlots in queueAnimation');
            }
        }
    }

    // 2. In poisonApply handler: remove from _pendingPoisonSlots when animation plays
    const poisonHandlerAnchor = "case 'poisonApply': {";
    const poisonHandlerIdx = src.indexOf(poisonHandlerAnchor);
    if (poisonHandlerIdx === -1) {
        console.error('ERROR: poisonApply handler not found');
        errors++;
    } else {
        // Find "const paOwner" line after the case
        const paOwnerLine = "const paOwner = data.player === myNum ? 'me' : 'opp';";
        const paOwnerIdx = src.indexOf(paOwnerLine, poisonHandlerIdx);
        if (paOwnerIdx === -1) {
            console.error('ERROR: paOwner line not found in poisonApply handler');
            errors++;
        } else {
            // Insert after paOwner line
            const lineEnd = src.indexOf(nl, paOwnerIdx);
            const insertAfter = lineEnd + nl.length;
            const clearCode =
                '            const paSlotKey = paOwner + \'-\' + data.row + \'-\' + data.col;' + nl +
                '            if (window._pendingPoisonSlots) window._pendingPoisonSlots.delete(paSlotKey);' + nl;
            src = src.substring(0, insertAfter) + clearCode + src.substring(insertAfter);
            console.log('OK: game-animations.js — Clear _pendingPoisonSlots in poisonApply handler');
        }
    }

    fs.writeFileSync(path, src, 'utf8');
}

// =============================================================
// FIX B: game-render.js — Skip poison marker if slot is pending
// =============================================================
{
    const path = 'public/js/game-render.js';
    let src = fs.readFileSync(path, 'utf8');

    // Find the poison marker rendering section
    const poisonAnchor = "// Poison marker  propriété serveur : poisonCounters";
    // Try both encodings
    let poisonIdx = src.indexOf(poisonAnchor);
    if (poisonIdx === -1) {
        // Try with double-encoded UTF-8
        const poisonAnchorAlt = "// Poison marker";
        poisonIdx = src.indexOf(poisonAnchorAlt);
    }
    if (poisonIdx === -1) {
        console.error('ERROR: Poison marker comment not found in game-render.js');
        errors++;
    } else {
        // Find "const poisonCount = card.poisonCounters || 0;" after the anchor
        const poisonCountLine = "const poisonCount = card.poisonCounters || 0;";
        const poisonCountIdx = src.indexOf(poisonCountLine, poisonIdx);
        if (poisonCountIdx === -1) {
            console.error('ERROR: poisonCount line not found');
            errors++;
        } else {
            // Replace the poisonCount line with a version that checks _pendingPoisonSlots
            const nl = src.substring(poisonCountIdx - 2, poisonCountIdx).includes('\r') ? '\r\n' : '\n';
            const newPoisonCount =
                'const _poisonPending = window._pendingPoisonSlots && window._pendingPoisonSlots.has(slotKey);' + nl +
                '                const poisonCount = _poisonPending ? 0 : (card.poisonCounters || 0);';
            src = src.replace(poisonCountLine, newPoisonCount);
            console.log('OK: game-render.js — Poison markers hidden when slot is in _pendingPoisonSlots');
        }
    }

    fs.writeFileSync(path, src, 'utf8');
}

if (errors > 0) {
    console.error('\n' + errors + ' ERROR(S)');
    process.exit(1);
} else {
    console.log('\nAll fixes applied:');
    console.log('  - game-animations.js: _pendingPoisonSlots set/clear in queue/handler');
    console.log('  - game-render.js: skip poison marker rendering for pending slots');
}
