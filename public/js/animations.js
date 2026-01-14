/**
 * Animation de pioche - Position calculée (carte pas encore dans le DOM)
 */

/**
 * Crée un élément carte identique (pour le joueur)
 */
function createCardElement(card) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    
    const icons = { 
        fly: '🦅', shooter: '🎯', haste: '⚡', intangible: '👻',
        trample: '🦏', initiative: '🗡️', power: '💪'
    };
    const abilities = (card.abilities || []).map(a => icons[a] || '').join(' ');
    
    let typeIcon = '';
    if (card.type === 'spell') typeIcon = `<div class="card-type-icon spell-icon">✨</div>`;
    else if (card.type === 'trap') typeIcon = `<div class="card-type-icon trap-icon">🪤</div>`;
    
    let patternInfo = '';
    if (card.pattern === 'cross') patternInfo = '<div style="font-size:0.5em;color:#ff9800;">✝️ Zone</div>';
    else if (card.pattern === 'global' || card.pattern === 'all') patternInfo = '<div style="font-size:0.5em;color:#3498db;">🌍 Global</div>';
    else if (card.pattern === 'hero') patternInfo = '<div style="font-size:0.5em;color:#e74c3c;">🎯 Héros</div>';
    
    el.innerHTML = `
        <div class="card-cost">${card.cost}</div>
        ${typeIcon}
        <div class="card-art">${card.icon || '❓'}</div>
        <div class="card-body">
            <div class="card-name">${card.name}</div>
            <div class="card-abilities">${abilities || (card.type === 'spell' ? (card.offensive ? '⚔️' : '💚') : '')}${patternInfo}</div>
            <div class="card-stats">
                ${card.atk !== undefined ? `<span class="stat stat-atk">${card.atk}</span>` : ''}
                ${card.damage ? `<span class="stat stat-atk">${card.damage}</span>` : ''}
                ${card.heal ? `<span class="stat stat-hp">${card.heal}</span>` : ''}
                ${card.type === 'creature' ? `<span class="stat stat-hp">${card.hp}</span>` : ''}
            </div>
        </div>`;
    
    return el;
}

/**
 * Crée un dos de carte (pour l'adversaire)
 */
function createCardBackElement() {
    const el = document.createElement('div');
    el.className = 'opp-card-back';
    el.textContent = '🎴';
    return el;
}

/**
 * Calcule la position où la nouvelle carte va atterrir
 * Basé sur les cartes EXISTANTES dans la main (la nouvelle n'est pas encore là)
 */
function calculateNewCardPosition(owner) {
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const handEl = document.querySelector(handSelector);
    
    if (!handEl) return null;
    
    const existingCards = handEl.querySelectorAll(cardSelector);
    const numCards = existingCards.length;
    
    // Dimensions selon le type
    const cardWidth = owner === 'me' ? 100 : 86;
    const cardHeight = owner === 'me' ? 135 : 116;
    const overlap = owner === 'me' ? 40 : 55; // margin-left négatif
    const visibleWidth = cardWidth - overlap; // Partie visible de chaque carte
    
    let endX, endY;
    
    if (numCards > 0) {
        // Prendre la position de la dernière carte existante
        const lastCard = existingCards[numCards - 1];
        const lastRect = lastCard.getBoundingClientRect();
        
        // La nouvelle carte sera à droite de la dernière (avec overlap)
        endX = lastRect.left + visibleWidth + cardWidth / 2;
        endY = lastRect.top + cardHeight / 2;
    } else {
        // Première carte - position au début de la main
        const handRect = handEl.getBoundingClientRect();
        const paddingLeft = 15;
        
        endX = handRect.left + paddingLeft + cardWidth / 2;
        endY = handRect.top + cardHeight / 2;
    }
    
    return { x: endX, y: endY, width: cardWidth, height: cardHeight };
}

/**
 * Easing
 */
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/**
 * Animation de pioche d'une carte
 */
function animateCardDraw(card, owner, handIndex) {
    // Position de départ (deck)
    const deckEl = document.querySelector(`#${owner}-deck-stack`);
    if (!deckEl) return;
    
    const deckRect = deckEl.getBoundingClientRect();
    const startX = deckRect.left + deckRect.width / 2;
    const startY = deckRect.top + deckRect.height / 2;
    
    // Position d'arrivée (calculée)
    const endPos = calculateNewCardPosition(owner);
    if (!endPos) return;
    
    // Créer l'élément animé
    const animatedCard = owner === 'me' 
        ? createCardElement(card) 
        : createCardBackElement();
    
    // Style initial - positionné au deck
    animatedCard.style.cssText = `
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        width: ${endPos.width}px;
        height: ${endPos.height}px;
        left: ${startX}px;
        top: ${startY}px;
        transform: translate(-50%, -50%);
        opacity: 0;
    `;
    
    document.body.appendChild(animatedCard);
    
    // Animation
    const duration = 400;
    const startTime = performance.now();
    const controlY = Math.min(startY, endPos.y) - 50;
    
    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        
        // Courbe de Bézier
        const t = eased;
        const midX = (startX + endPos.x) / 2;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * midX + t * t * endPos.x;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endPos.y;
        
        animatedCard.style.left = x + 'px';
        animatedCard.style.top = y + 'px';
        animatedCard.style.opacity = Math.min(progress * 2.5, 1);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Garder visible un instant puis supprimer
            setTimeout(() => animatedCard.remove(), 50);
        }
    }
    
    requestAnimationFrame(animate);
}

/**
 * API publique
 */
const GameAnimations = {
    init: () => Promise.resolve(),
    
    animateDraw: (card, owner, handIndex = 0) => {
        animateCardDraw(card, owner, handIndex);
        return Promise.resolve();
    },
    
    clear: () => {},
    
    get isReady() { return true; }
};