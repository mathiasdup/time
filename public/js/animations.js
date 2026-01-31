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

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance', cleave: 'Clivant', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost">${card.cost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">Créature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk">${card.atk}</div>
            <div class="img-hp">${hp}</div>`;
        return el;
    }

    const icons = {
        fly: '🦅', shooter: '🎯', haste: '⚡', intangible: '👻',
        trample: '🦏', power: '💪', cleave: '⛏️', immovable: '🪨', regeneration: '💚',
        protection: '🛡️'
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
 * Easings
 */
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Animation de pioche professionnelle (style Hearthstone/Magic Arena)
 *
 * Pour le joueur (me):
 *   Phase 1 - Lift (0-15%):     Carte se soulève du deck avec glow
 *   Phase 2 - Reveal (15-45%):  Carte vole vers le centre, agrandie pour la lire
 *   Phase 3 - Hold (45-65%):    Pause pour que le joueur voie la carte
 *   Phase 4 - To hand (65-100%): Carte rétrécit et glisse dans la main
 *
 * Pour l'adversaire (opp):
 *   Animation simplifiée, arc rapide du deck vers sa main
 */
function animateCardDraw(card, owner, handIndex) {
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const handEl = document.querySelector(handSelector);

    if (!handEl) return;

    const handCards = handEl.querySelectorAll(cardSelector);
    const targetCard = handCards[handIndex];

    if (!targetCard) return;

    const targetRect = targetCard.getBoundingClientRect();
    const endX = targetRect.left;
    const endY = targetRect.top;
    const cardWidth = targetRect.width;
    const cardHeight = targetRect.height;

    const deckEl = document.querySelector(`#${owner}-deck-stack`);
    if (!deckEl) {
        targetCard.style.visibility = 'visible';
        return;
    }

    const deckRect = deckEl.getBoundingClientRect();
    const startX = deckRect.left + deckRect.width / 2 - cardWidth / 2;
    const startY = deckRect.top;

    // Créer un conteneur positionné
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        left: ${startX}px;
        top: ${startY}px;
        width: ${cardWidth}px;
        height: ${cardHeight}px;
        transform-origin: center center;
        transform: scale(1);
        opacity: 0;
        perspective: 800px;
    `;

    if (owner === 'me') {
        // Flipper 3D : dos visible au départ, face cachée
        const flipper = document.createElement('div');
        flipper.style.cssText = `
            width: 100%; height: 100%;
            position: relative;
            transform-style: preserve-3d;
            transform: rotateY(0deg);
        `;

        // Face arrière (dos de carte)
        const backFace = createCardBackElement();
        backFace.style.cssText = `
            position: absolute; top: 0; left: 0;
            width: 100%; height: 100%;
            backface-visibility: hidden;
            transform: rotateY(0deg);
            border-radius: 6px;
        `;

        // Face avant — utiliser makeCard() pour avoir le vrai design (arena-style, faction, etc.)
        const frontFace = (typeof makeCard === 'function')
            ? makeCard(card, true)
            : createCardElement(card);
        const bgImage = frontFace.style.backgroundImage;
        frontFace.style.position = 'absolute';
        frontFace.style.top = '0';
        frontFace.style.left = '0';
        frontFace.style.width = '100%';
        frontFace.style.height = '100%';
        frontFace.style.margin = '0';
        frontFace.style.backfaceVisibility = 'hidden';
        frontFace.style.transform = 'rotateY(180deg)';
        if (bgImage) frontFace.style.backgroundImage = bgImage;

        flipper.appendChild(backFace);
        flipper.appendChild(frontFace);
        wrapper.appendChild(flipper);
        document.body.appendChild(wrapper);

        animateDrawForMe(wrapper, flipper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard);
    } else {
        // Adversaire : pas de flip, juste un dos de carte
        const backCard = createCardBackElement();
        backCard.style.cssText = `
            width: 100%; height: 100%;
            margin: 0; position: relative;
            border-radius: 6px;
        `;
        wrapper.appendChild(backCard);
        document.body.appendChild(wrapper);

        animateDrawForOpp(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard);
    }
}

/**
 * Animation de pioche pour le joueur — flip 3D + reveal au centre
 *
 * Phase 1 - Lift:       Dos de carte se soulève du deck
 * Phase 2 - Fly+Flip:   Vol vers le centre + flip 3D (dos → face)
 * Phase 3 - Hold:       Pause au centre, carte face visible
 * Phase 4 - To hand:    Carte glisse dans la main
 */
function animateDrawForMe(wrapper, flipper, startX, startY, endX, endY, cardW, cardH, targetCard) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Position de reveal : centre de l'écran, carte agrandie
    const revealScale = 1.4;
    const revealW = cardW * revealScale;
    const revealH = cardH * revealScale;
    const revealX = (vw - revealW) / 2;
    const revealY = (vh - revealH) / 2 - 30;

    // Durées des phases (ms)
    const liftDuration = 200;
    const flyToRevealDuration = 400;
    const holdDuration = 450;
    const flyToHandDuration = 350;
    const totalDuration = liftDuration + flyToRevealDuration + holdDuration + flyToHandDuration;

    const startTime = performance.now();

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / totalDuration, 1);

        const t1 = liftDuration / totalDuration;
        const t2 = (liftDuration + flyToRevealDuration) / totalDuration;
        const t3 = (liftDuration + flyToRevealDuration + holdDuration) / totalDuration;

        let x, y, scale, opacity, flipDeg;

        if (progress <= t1) {
            // === PHASE 1: LIFT — dos de carte se soulève ===
            const p = progress / t1;
            const ep = easeOutCubic(p);

            x = startX;
            y = startY - ep * 30;
            scale = 1 + ep * 0.05;
            opacity = 0.3 + ep * 0.7;
            flipDeg = 0; // encore face cachée

        } else if (progress <= t2) {
            // === PHASE 2: FLY + FLIP — vol vers le centre avec retournement ===
            const p = (progress - t1) / (t2 - t1);
            const ep = easeInOutCubic(p);

            const liftEndY = startY - 30;
            x = startX + (revealX - startX) * ep;
            y = liftEndY + (revealY - liftEndY) * ep;
            scale = 1.05 + (revealScale - 1.05) * ep;
            opacity = 1;
            // Flip de 0° à 180° pendant le vol
            flipDeg = easeInOutCubic(p) * 180;

        } else if (progress <= t3) {
            // === PHASE 3: HOLD — carte face visible au centre ===
            x = revealX;
            y = revealY;
            scale = revealScale;
            opacity = 1;
            flipDeg = 180;

        } else {
            // === PHASE 4: FLY TO HAND — arc vers la main ===
            const p = (progress - t3) / (1 - t3);
            const ep = easeOutCubic(p);

            x = revealX + (endX - revealX) * ep;
            y = revealY + (endY - revealY) * ep;
            scale = revealScale + (1 - revealScale) * ep;
            opacity = 1;
            flipDeg = 180;
        }

        wrapper.style.left = x + 'px';
        wrapper.style.top = y + 'px';
        wrapper.style.opacity = opacity;
        wrapper.style.transform = `scale(${scale})`;
        flipper.style.transform = `rotateY(${flipDeg}deg)`;

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            targetCard.style.visibility = 'visible';
            wrapper.remove();
        }
    }

    requestAnimationFrame(animate);
}

/**
 * Animation de pioche pour l'adversaire — arc simple et rapide
 */
function animateDrawForOpp(wrapper, startX, startY, endX, endY, cardW, cardH, targetCard) {
    const duration = 450;
    const startTime = performance.now();

    const controlX = (startX + endX) / 2;
    const controlY = Math.min(startY, endY) - 60;

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const t = easeOutCubic(progress);

        const x = (1-t)*(1-t)*startX + 2*(1-t)*t*controlX + t*t*endX;
        const y = (1-t)*(1-t)*startY + 2*(1-t)*t*controlY + t*t*endY;

        wrapper.style.left = x + 'px';
        wrapper.style.top = y + 'px';
        wrapper.style.opacity = Math.min(progress * 3, 1);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            targetCard.style.visibility = 'visible';
            wrapper.remove();
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