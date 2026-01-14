/**
 * Animation de pioche - Position exacte depuis le DOM
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
 * Easing
 */
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/**
 * Animation de pioche d'une carte
 */
function animateCardDraw(card, owner, handIndex) {
    // Trouver la vraie carte dans le DOM (la dernière de la main)
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const handEl = document.querySelector(handSelector);
    if (!handEl) return;
    
    const handCards = handEl.querySelectorAll(cardSelector);
    if (handCards.length === 0) return;
    
    const targetCard = handCards[handCards.length - 1];
    
    // Cacher la vraie carte IMMÉDIATEMENT (sans transition)
    targetCard.style.transition = 'none';
    targetCard.style.visibility = 'hidden';
    
    // Position exacte de la carte cible
    const targetRect = targetCard.getBoundingClientRect();
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    
    // Position de départ (deck)
    const deckEl = document.querySelector(`#${owner}-deck-stack`);
    if (!deckEl) {
        targetCard.style.visibility = 'visible';
        return;
    }
    
    const deckRect = deckEl.getBoundingClientRect();
    const startX = deckRect.left + deckRect.width / 2;
    const startY = deckRect.top + deckRect.height / 2;
    
    // Créer l'élément animé (copie de la vraie carte)
    const animatedCard = owner === 'me' 
        ? createCardElement(card) 
        : createCardBackElement();
    
    // Style initial
    animatedCard.style.cssText = `
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        width: ${targetRect.width}px;
        height: ${targetRect.height}px;
        left: ${startX}px;
        top: ${startY}px;
        transform: translate(-50%, -50%);
        opacity: 0;
        transition: none;
    `;
    
    document.body.appendChild(animatedCard);
    
    // Animation
    const duration = 450;
    const startTime = performance.now();
    const controlY = Math.min(startY, endY) - 60;
    
    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        
        // Position sur courbe de Bézier
        const t = eased;
        const midX = (startX + endX) / 2;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * midX + t * t * endX;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY;
        
        animatedCard.style.left = x + 'px';
        animatedCard.style.top = y + 'px';
        animatedCard.style.opacity = Math.min(progress * 3, 1);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Révéler la vraie carte
            targetCard.style.visibility = 'visible';
            
            // Supprimer l'animation
            animatedCard.remove();
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