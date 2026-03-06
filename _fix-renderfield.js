// Fix renderField fast path: recover missing data-uid and match by card id fallback
const fs = require('fs');
const file = 'public/js/game-render.js';
let src = fs.readFileSync(file, 'utf8');

// Detect line ending
const crlf = src.includes('\r\n');
const nl = crlf ? '\r\n' : '\n';

// Change 1: Add uid recovery after existingCardEl declaration
const anchor1 = `const existingCardEl = slot.querySelector('.card');${nl}            const existingUid = existingCardEl?.dataset?.uid;`;
const replace1 = `const existingCardEl = slot.querySelector('.card');${nl}            // Recover missing data-uid from __cardData (cards created by animations may lack it)${nl}            if (existingCardEl && !existingCardEl.dataset.uid && existingCardEl.__cardData?.uid) {${nl}                existingCardEl.dataset.uid = existingCardEl.__cardData.uid;${nl}            }${nl}            const existingUid = existingCardEl?.dataset?.uid;`;

if (!src.includes(anchor1)) {
    console.error('ERROR: anchor1 not found');
    process.exit(1);
}
src = src.replace(anchor1, replace1);

// Change 2: Expand fast path condition to also match by card id when uid is missing
const anchor2 = `// Fast path : même carte (uid identique), mettre à jour seulement les stats et états${nl}            if (card && existingCardEl && existingUid && existingUid === card.uid) {${nl}                existingCardEl.__cardData = card;`;
const replace2 = `// Fast path : même carte (uid identique ou même card id), mettre à jour seulement les stats et états${nl}            if (card && existingCardEl && (${nl}                (existingUid && existingUid === card.uid) ||${nl}                (!existingUid && existingCardEl.__cardData && existingCardEl.__cardData.id === card.id)${nl}            )) {${nl}                // Ensure data-uid is set for future fast path matches${nl}                if (!existingCardEl.dataset.uid && card.uid) existingCardEl.dataset.uid = card.uid;${nl}                existingCardEl.__cardData = card;`;

if (!src.includes(anchor2)) {
    console.error('ERROR: anchor2 not found');
    process.exit(1);
}
src = src.replace(anchor2, replace2);

fs.writeFileSync(file, src, 'utf8');
console.log('OK: renderField fast path fix applied');
console.log('  - Added uid recovery from __cardData');
console.log('  - Added card.id fallback matching');
