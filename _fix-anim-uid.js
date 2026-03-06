// Fix animation handlers: set data-uid and __cardData on cards placed on slots
const fs = require('fs');
const file = 'public/js/game-animations.js';
let src = fs.readFileSync(file, 'utf8');
let fixes = 0;

// 1. animateTrapSummon: after slot.appendChild(cardEl) at ~line 7318
{
    const anchor = `slot.appendChild(cardEl);
        slot.classList.add('has-card');

        const summonNameFit = cardEl.querySelector('.arena-name');`;
    const replace = `cardEl.dataset.uid = data.card.uid || '';
        cardEl.__cardData = data.card;
        slot.appendChild(cardEl);
        slot.classList.add('has-card');

        const summonNameFit = cardEl.querySelector('.arena-name');`;
    if (src.includes(anchor)) {
        src = src.replace(anchor, replace);
        fixes++;
        console.log('  [1] animateTrapSummon: added uid+__cardData');
    } else {
        console.error('  [1] animateTrapSummon: anchor not found!');
    }
}

// 2. Summon fallback: after targetSlot.appendChild(cardEl) at ~line 6833
{
    const anchor = `const cardEl = makeCard(renderCard, false);
        targetSlot.appendChild(cardEl);`;
    const replace = `const cardEl = makeCard(renderCard, false);
        cardEl.dataset.uid = renderCard.uid || '';
        cardEl.__cardData = renderCard;
        targetSlot.appendChild(cardEl);`;
    if (src.includes(anchor)) {
        src = src.replace(anchor, replace);
        fixes++;
        console.log('  [2] summon fallback: added uid+__cardData');
    } else {
        console.error('  [2] summon fallback: anchor not found!');
    }
}

// 3. Death transform: after slot.appendChild(placedCard) at ~line 2397
{
    const anchor = `const placedCard = makeCard(data.toCard, false);
    slot.appendChild(placedCard);
    slot.classList.add('has-card');`;
    const replace = `const placedCard = makeCard(data.toCard, false);
    placedCard.dataset.uid = data.toCard.uid || '';
    placedCard.__cardData = data.toCard;
    slot.appendChild(placedCard);
    slot.classList.add('has-card');`;
    if (src.includes(anchor)) {
        src = src.replace(anchor, replace);
        fixes++;
        console.log('  [3] death transform: added uid+__cardData');
    } else {
        console.error('  [3] death transform: anchor not found!');
    }
}

// 4. Reanimate handler: tempCard already gets uid synced at ~7450, but add __cardData early
{
    const anchor = `const tempCard = makeCard(data.card, false);
            const isFlying = data.card.type === 'creature' && data.card.abilities?.includes('fly');`;
    const replace = `const tempCard = makeCard(data.card, false);
            tempCard.dataset.uid = data.card.uid || '';
            tempCard.__cardData = data.card;
            const isFlying = data.card.type === 'creature' && data.card.abilities?.includes('fly');`;
    if (src.includes(anchor)) {
        src = src.replace(anchor, replace);
        fixes++;
        console.log('  [4] reanimate handler: added early uid+__cardData');
    } else {
        console.error('  [4] reanimate handler: anchor not found!');
    }
}

fs.writeFileSync(file, src, 'utf8');
console.log(`\nDone: ${fixes}/4 fixes applied`);
