// Fix v2: After removing from _pendingPoisonSlots, force-create the poison marker
// so it appears with the VFX cloud (don't wait for next render cycle)
const fs = require('fs');

const path = 'public/js/game-animations.js';
let src = fs.readFileSync(path, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';

// Find the poisonApply handler — replace the full case block
const oldHandler = [
    "        case 'poisonApply': {",
    "            const paOwner = data.player === myNum ? 'me' : 'opp';",
    "            const paSlotKey = paOwner + '-' + data.row + '-' + data.col;",
    "            if (window._pendingPoisonSlots) window._pendingPoisonSlots.delete(paSlotKey);",
    "            const paSlot = getSlot(paOwner, data.row, data.col);",
    "            if (paSlot) {",
    "                const rect = paSlot.getBoundingClientRect();",
    "                CombatVFX.createPoisonCloudEffect(",
    "                    rect.left + rect.width / 2,",
    "                    rect.top + rect.height / 2,",
    "                    rect.width, rect.height",
    "                );",
    "            }",
    "            await new Promise(r => setTimeout(r, 600));",
    "            break;",
    "        }"
].join(nl);

const newHandler = [
    "        case 'poisonApply': {",
    "            const paOwner = data.player === myNum ? 'me' : 'opp';",
    "            const paSlotKey = paOwner + '-' + data.row + '-' + data.col;",
    "            if (window._pendingPoisonSlots) window._pendingPoisonSlots.delete(paSlotKey);",
    "            const paSlot = getSlot(paOwner, data.row, data.col);",
    "            if (paSlot) {",
    "                const rect = paSlot.getBoundingClientRect();",
    "                CombatVFX.createPoisonCloudEffect(",
    "                    rect.left + rect.width / 2,",
    "                    rect.top + rect.height / 2,",
    "                    rect.width, rect.height",
    "                );",
    "                // Force-show poison marker now (was hidden by _pendingPoisonSlots)",
    "                const paCardEl = paSlot.querySelector('.card');",
    "                if (paCardEl) {",
    "                    const stField = paOwner === 'me' ? state?.me?.field : state?.opponent?.field;",
    "                    const stCard = stField?.[data.row]?.[data.col];",
    "                    const pc = stCard?.poisonCounters || 0;",
    "                    if (pc > 0) {",
    "                        let pm = paCardEl.querySelector('.poison-marker');",
    "                        if (!pm) {",
    "                            pm = document.createElement('div');",
    "                            pm.className = 'poison-marker marker-pop';",
    "                            pm.innerHTML = '<div class=\"poison-border\"></div><span class=\"poison-count\">' + pc + '</span>';",
    "                            paCardEl.appendChild(pm);",
    "                            paCardEl._cPoison = pm;",
    "                        } else {",
    "                            const cnt = pm.querySelector('.poison-count');",
    "                            if (cnt) cnt.textContent = String(pc);",
    "                        }",
    "                    }",
    "                }",
    "            }",
    "            await new Promise(r => setTimeout(r, 600));",
    "            break;",
    "        }"
].join(nl);

if (!src.includes(oldHandler)) {
    console.error('ERROR: poisonApply handler not found (exact match)');
    process.exit(1);
}

src = src.replace(oldHandler, newHandler);
fs.writeFileSync(path, src, 'utf8');
console.log('OK: poisonApply handler now force-creates poison marker after clearing _pendingPoisonSlots');
