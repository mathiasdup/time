// Fix v2: pendingDeathSlots — don't clear on every state update,
// clear per-slot when state confirms card is gone, and clear all on phase change.
const fs = require('fs');

let errors = 0;

// =============================================================
// FIX A: game-core.js — Only clear on phase change, not every state update
// =============================================================
{
    const path = 'public/js/game-core.js';
    let src = fs.readFileSync(path, 'utf8');

    const oldCode = '    // Clear pending death markers — new state is authoritative\n    if (window._pendingDeathSlots) window._pendingDeathSlots.clear();';
    const newCode = '    // Clear pending death markers only on phase change (resolution end = deaths fully processed)\n    if (window._pendingDeathSlots && phase !== \'resolution\') window._pendingDeathSlots.clear();';

    if (!src.includes(oldCode)) {
        // Try CRLF
        const oldCRLF = oldCode.replace(/\n/g, '\r\n');
        if (src.includes(oldCRLF)) {
            src = src.replace(oldCRLF, newCode.replace(/\n/g, '\r\n'));
        } else {
            console.error('ERROR: game-core.js — old pendingDeathSlots code not found');
            errors++;
        }
    } else {
        src = src.replace(oldCode, newCode);
    }

    fs.writeFileSync(path, src, 'utf8');
    console.log('OK: game-core.js — pendingDeathSlots only cleared on phase change');
}

// =============================================================
// FIX B: game-render.js — Also clear entry when state confirms card is gone
// =============================================================
{
    const path = 'public/js/game-render.js';
    let src = fs.readFileSync(path, 'utf8');

    const oldCode = '            // Skip re-creating cards on slots with pending death (prevents stale render flash)\n            if (card && !slot.querySelector(\'.card\') && window._pendingDeathSlots && window._pendingDeathSlots.has(slotKey)) {\n                continue;\n            }';
    const newCode = '            // Pending death: skip stale re-creation OR clear when state confirms removal\n            if (window._pendingDeathSlots && window._pendingDeathSlots.has(slotKey)) {\n                if (!card) {\n                    // State confirmed card is gone — clear marker\n                    window._pendingDeathSlots.delete(slotKey);\n                } else if (!slot.querySelector(\'.card\')) {\n                    // Card still in stale state but DOM is empty (death anim removed it) — skip\n                    continue;\n                }\n            }';

    if (!src.includes(oldCode)) {
        // Try CRLF
        const oldCRLF = oldCode.replace(/\n/g, '\r\n');
        if (src.includes(oldCRLF)) {
            src = src.replace(oldCRLF, newCode.replace(/\n/g, '\r\n'));
        } else {
            console.error('ERROR: game-render.js — old pendingDeathSlots code not found');
            errors++;
        }
    } else {
        src = src.replace(oldCode, newCode);
    }

    fs.writeFileSync(path, src, 'utf8');
    console.log('OK: game-render.js — pendingDeathSlots v2 logic');
}

if (errors > 0) {
    console.error('\n' + errors + ' ERROR(S)');
    process.exit(1);
} else {
    console.log('\nAll v2 fixes applied:');
    console.log('  - game-core.js: only clear pendingDeathSlots on phase change');
    console.log('  - game-render.js: clear per-slot when state confirms card is gone');
}
