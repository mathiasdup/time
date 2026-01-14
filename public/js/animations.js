/**
 * Animation de pioche - Clone DOM pour design identique
 * Style Magic Arena
 */

/**
 * Crée un élément carte identique à ceux du jeu (pour le joueur)
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
    if (card.type === 'spell') {
        typeIcon = `<div class="card-type-icon spell-icon">✨</div>`;
    } else if (card.type === 'trap') {
        typeIcon = `<div class="card-type-icon trap-icon">🪤</div>`;
    }
    
    let patternInfo = '';
    if (card.pattern === 'cross') {
        patternInfo = '<div style="font-size:0.5em;color:#ff9800;">✝️ Zone</div>';
    } else if (card.pattern === 'global' || card.pattern === 'all') {
        patternInfo = '<div style="font-size:0.5em;color:#3498db;">🌍 Global</div>';
    } else if (card.pattern === 'hero') {
        patternInfo = '<div style="font-size:0.5em;color:#e74c3c;">🎯 Héros</div>';
    }
    
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
 * Calcule la position de destination dans la main
 */
function calculateHandPosition(owner) {
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const handEl = document.querySelector(handSelector);
    if (!handEl) return null;
    
    const handRect = handEl.getBoundingClientRect();
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const existingCards = handEl.querySelectorAll(cardSelector);
    const numCards = existingCards.length;
    
    // Dimensions des cartes
    const cardWidth = owner === 'me' ? 100 : 86;
    const cardHeight = owner === 'me' ? 135 : 116;
    const margin = owner === 'me' ? -20 : -55; // margin-left négatif pour le chevauchement
    
    // Calculer la position de la nouvelle carte (à la fin)
    let x, y;
    
    if (numCards === 0) {
        // Première carte - au début de la main
        x = handRect.left + 15 + cardWidth / 2; // padding-left + moitié carte
        y = handRect.top + handRect.height / 2;
    } else {
        // Position après la dernière carte
        const lastCard = existingCards[numCards - 1];
        const lastRect = lastCard.getBoundingClientRect();
        x = lastRect.right + margin + cardWidth / 2;
        y = lastRect.top + cardHeight / 2;
    }
    
    return { x, y, width: cardWidth, height: cardHeight };
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
    const endPos = calculateHandPosition(owner);
    if (!endPos) return;
    
    // Créer l'élément animé
    const animatedCard = owner === 'me' 
        ? createCardElement(card) 
        : createCardBackElement();
    
    // Style pour l'animation
    animatedCard.style.cssText = `
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        left: ${startX}px;
        top: ${startY}px;
        transform: translate(-50%, -50%) scale(0.9);
        opacity: 0;
        transition: none;
    `;
    
    document.body.appendChild(animatedCard);
    
    // Animation
    const duration = 500;
    const startTime = performance.now();
    
    // Point de contrôle pour la courbe
    const controlY = Math.min(startY, endPos.y) - 60;
    
    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        
        // Position sur courbe de Bézier
        const t = eased;
        const midX = (startX + endPos.x) / 2;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * midX + t * t * endPos.x;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endPos.y;
        
        // Appliquer
        animatedCard.style.left = x + 'px';
        animatedCard.style.top = y + 'px';
        animatedCard.style.opacity = Math.min(progress * 3, 1);
        animatedCard.style.transform = `translate(-50%, -50%) scale(${0.9 + eased * 0.1})`;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Supprimer après un court délai
            setTimeout(() => {
                animatedCard.remove();
            }, 50);
        }
    }
    
    // Démarrer l'animation au prochain frame
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