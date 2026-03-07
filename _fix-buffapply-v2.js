// Fix buffApply: use absolute state values instead of relative increment (prevents double-counting)
const fs = require('fs');

const path = 'public/js/game-animations.js';
let src = fs.readFileSync(path, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';

// Find the buffApply case
const buffIdx = src.indexOf("case 'buffApply': {");
if (buffIdx === -1) {
    console.error('ERROR: buffApply case not found');
    process.exit(1);
}

// Find the closing break/} for this case
const breakSearch = 'await new Promise(r => setTimeout(r, 600));';
const breakIdx = src.indexOf(breakSearch, buffIdx);
if (breakIdx === -1) {
    console.error('ERROR: buffApply await not found');
    process.exit(1);
}
const afterBreak = src.indexOf('break;', breakIdx);
const closingBrace = src.indexOf('}', afterBreak + 6);
const fullBlock = src.substring(buffIdx, closingBrace + 1);

const newBlock = [
    "case 'buffApply': {",
    "            // VFX buff (+ATK/+HP) on card — queued so it plays after burn",
    "            const baOwner = data.player === myNum ? 'me' : 'opp';",
    "            const baSlot = getSlot(baOwner, data.row, data.col);",
    "            if (baSlot) {",
    "                const rect = baSlot.getBoundingClientRect();",
    "                CombatVFX.createBuffEffect(rect.left + rect.width / 2, rect.top + rect.height / 2, data.atkBuff ?? 1, data.hpBuff ?? 1, rect.width, rect.height);",
    "                // Clear anti-flicker markers + sync DOM to current state (absolute, no double-count)",
    "                const buffCardEl = baSlot.querySelector('.card');",
    "                if (buffCardEl) {",
    "                    delete buffCardEl.dataset.visualDmgHp;",
    "                    delete buffCardEl.dataset.visualDmgSetAt;",
    "                    // Read authoritative values from state (already includes buff)",
    "                    const stateField = baOwner === 'me' ? state?.me?.field : state?.opponent?.field;",
    "                    const stateCard = stateField?.[data.row]?.[data.col];",
    "                    if (stateCard) {",
    "                        const buffHpEl = buffCardEl.querySelector('.arena-armor') || buffCardEl.querySelector('.arena-hp') || buffCardEl.querySelector('.img-hp');",
    "                        if (buffHpEl) {",
    "                            const newHp = stateCard.currentHp ?? stateCard.hp;",
    "                            if (newHp !== undefined) buffHpEl.textContent = String(newHp);",
    "                        }",
    "                        const buffAtkEl = buffCardEl.querySelector('.arena-atk') || buffCardEl.querySelector('.img-atk');",
    "                        if (buffAtkEl) {",
    "                            const newAtk = stateCard.atk;",
    "                            if (newAtk !== undefined) buffAtkEl.textContent = String(newAtk);",
    "                        }",
    "                        const buffRipEl = buffCardEl.querySelector('.arena-riposte');",
    "                        if (buffRipEl) {",
    "                            const newRip = stateCard.riposte;",
    "                            if (newRip !== undefined) buffRipEl.textContent = String(newRip);",
    "                        }",
    "                    }",
    "                }",
    "            }",
    "            await new Promise(r => setTimeout(r, 600));",
    "            break;",
    "        }"
].join(nl);

src = src.replace(fullBlock, newBlock);
fs.writeFileSync(path, src, 'utf8');
console.log('OK: game-animations.js — buffApply now uses absolute state values (no double-count)');
