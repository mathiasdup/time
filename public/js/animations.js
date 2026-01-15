/**
 * Animation de pioche - Cartes cachées dès le render
 */

// Cartes à cacher lors du prochain render
const pendingDrawAnimations = {
    me: new Map(),   // handIndex -> card
    opp: new Map()   // handIndex -> card
};

/**
 * Appelé quand l'animation 'draw' est reçue (AVANT l'état)
 * Stocke les cartes à cacher et prépare l'animation
 */
function prepareDrawAnimation(data) {
    if (!data.cards || data.cards.length === 0) return;
    
    // Déterminer myNum depuis la variable globale
    const myPlayerNum = typeof myNum !== 'undefined' ? myNum : 1;
    
    for (const drawData of data.cards) {
        if (drawData.burned) continue;
        
        const owner = drawData.player === myPlayerNum ? 'me' : 'opp';
        const handIndex = drawData.handIndex;
        const card = drawData.card;
        
        // Stocker pour que le render crée la carte cachée
        pendingDrawAnimations[owner].set(handIndex, card);
    }
}

/**
 * Vérifie si une carte doit être cachée au render
 */
function shouldHideCard(owner, handIndex) {
    return pendingDrawAnimations[owner].has(handIndex);
}

/**
 * Lance les animations après le render
 */
function startPendingDrawAnimations() {
    // Attendre le prochain frame pour s'assurer que le DOM est rendu
    requestAnimationFrame(() => {
        // Animer les cartes du joueur
        for (const [handIndex, card] of pendingDrawAnimations.me) {
            animateCardDraw(card, 'me', handIndex);
        }
        
        // Animer les cartes de l'adversaire
        for (const [handIndex, card] of pendingDrawAnimations.opp) {
            animateCardDraw(card, 'opp', handIndex);
        }
        
        // Vider les pending
        pendingDrawAnimations.me.clear();
        pendingDrawAnimations.opp.clear();
    });
}

/**
 * Crée un élément carte identique (pour le joueur)
 */
function createCardElement(card) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    const hp = card.currentHp ?? card.hp;

    // Si la carte a une image, utiliser le nouveau système
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;
        el.innerHTML = `
            <div class="card-cost">${card.cost}</div>
            <div class="card-stat-atk">${card.atk}</div>
            <div class="card-stat-hp">${hp}</div>`;
        return el;
    }

    const icons = {
        fly: '🦅', shooter: '🎯', haste: '⚡', intangible: '👻',
        trample: '🦏', initiative: '🗡️', power: '💪', cleave: '⛏️'
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
                ${card.type === 'creature' ? `<span class="stat stat-hp">${hp}</span>` : ''}
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
    // Trouver la carte dans le DOM
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const handEl = document.querySelector(handSelector);
    
    if (!handEl) return;
    
    const handCards = handEl.querySelectorAll(cardSelector);
    const targetCard = handCards[handIndex];
    
    if (!targetCard) return;
    
    // Position EXACTE de la carte cible (elle est déjà cachée par le render)
    const targetRect = targetCard.getBoundingClientRect();
    const endX = targetRect.left;
    const endY = targetRect.top;
    const cardWidth = targetRect.width;
    const cardHeight = targetRect.height;
    
    // Position du deck
    const deckEl = document.querySelector(`#${owner}-deck-stack`);
    if (!deckEl) {
        targetCard.style.visibility = 'visible';
        return;
    }
    
    const deckRect = deckEl.getBoundingClientRect();
    const startX = deckRect.left + deckRect.width / 2 - cardWidth / 2;
    const startY = deckRect.top + deckRect.height / 2 - cardHeight / 2;
    
    // Créer la carte animée
    const animatedCard = owner === 'me' 
        ? createCardElement(card) 
        : createCardBackElement();
    
    // Style initial - EXACTEMENT les mêmes dimensions
    animatedCard.style.cssText = `
        position: fixed !important;
        z-index: 10000 !important;
        pointer-events: none !important;
        width: ${cardWidth}px !important;
        height: ${cardHeight}px !important;
        left: ${startX}px !important;
        top: ${startY}px !important;
        margin: 0 !important;
        transform: none !important;
        opacity: 0;
    `;
    
    document.body.appendChild(animatedCard);
    
    // Animation
    const duration = 400;
    const startTime = performance.now();
    
    // Point de contrôle pour la courbe
    const controlX = (startX + endX) / 2;
    const controlY = Math.min(startY, endY) - 50;
    
    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        
        // Position sur courbe de Bézier quadratique
        const t = eased;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY;
        
        animatedCard.style.left = x + 'px';
        animatedCard.style.top = y + 'px';
        animatedCard.style.opacity = Math.min(progress * 2.5, 1);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // FIN - révéler la vraie carte et supprimer l'animation
            targetCard.style.visibility = 'visible';
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
    
    // Appelé par handleAnimation AVANT l'état
    prepareDrawAnimation: prepareDrawAnimation,
    
    // Vérifie si une carte doit être cachée
    shouldHideCard: shouldHideCard,
    
    // Lance les animations après le render
    startPendingDrawAnimations: startPendingDrawAnimations,
    
    // Pour compatibilité (ne fait plus rien directement)
    animateDraw: (card, owner, handIndex = 0) => Promise.resolve(),
    
    clear: () => {
        pendingDrawAnimations.me.clear();
        pendingDrawAnimations.opp.clear();
    },
    
    get isReady() { return true; }
};