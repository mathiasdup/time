// Fix v3: when state says card is gone but card still in DOM,
// keep the pendingDeath marker and skip — let death animation handle removal.
const fs = require('fs');

const path = 'public/js/game-render.js';
let src = fs.readFileSync(path, 'utf8');

const oldCode = '            // Pending death: skip stale re-creation OR clear when state confirms removal\n' +
    '            if (window._pendingDeathSlots && window._pendingDeathSlots.has(slotKey)) {\n' +
    '                if (!card) {\n' +
    '                    // State confirmed card is gone — clear marker\n' +
    '                    window._pendingDeathSlots.delete(slotKey);\n' +
    '                } else if (!slot.querySelector(\'.card\')) {\n' +
    '                    // Card still in stale state but DOM is empty (death anim removed it) — skip\n' +
    '                    continue;\n' +
    '                }\n' +
    '            }';

const newCode = '            // Pending death: let death animation handle card removal, skip renderField interference\n' +
    '            if (window._pendingDeathSlots && window._pendingDeathSlots.has(slotKey)) {\n' +
    '                if (!card && !slot.querySelector(\'.card\')) {\n' +
    '                    // State and DOM both confirm card is gone — clear marker\n' +
    '                    window._pendingDeathSlots.delete(slotKey);\n' +
    '                } else {\n' +
    '                    // Either stale state (card in state, not in DOM) or\n' +
    '                    // pending removal (card in DOM, not in state) — skip entirely\n' +
    '                    // Death animation will handle the visual removal\n' +
    '                    continue;\n' +
    '                }\n' +
    '            }';

if (!src.includes(oldCode)) {
    console.error('ERROR: old pendingDeathSlots code not found in game-render.js');
    process.exit(1);
}

src = src.replace(oldCode, newCode);
fs.writeFileSync(path, src, 'utf8');
console.log('OK: game-render.js — pendingDeathSlots v3: skip slot entirely until both state AND DOM confirm removal');
