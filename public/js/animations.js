/**
 * Animation de pioche - Cartes cachées dès le render
 */

// Cartes à cacher lors du prochain render
const pendingDrawAnimations = {
    me: new Map(),   // handIndex -> card
    opp: new Map()   // handIndex -> card
};
// Animations déjà lancées (éviter les doublons)
const startedDrawAnimations = {
    me: new Set(),
    opp: new Set()
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

        // Le vrai event draw remplace l'auto-hide
        autoHiddenCards[owner].delete(handIndex);
        // Stocker pour que le render crée la carte cachée
        pendingDrawAnimations[owner].set(handIndex, card);
    }
}

// Cartes qui reviennent du cimetière (pour utiliser grave-stack au lieu de deck-stack)
const pendingGraveyardReturns = {
    me: new Set(),
    opp: new Set()
};

// Cartes auto-cachées (sécurité si l'état arrive avant l'event draw)
const autoHiddenCards = {
    me: new Set(),
    opp: new Set()
};

/**
 * Vérifie si une carte doit être cachée au render
 */
function shouldHideCard(owner, handIndex) {
    return pendingDrawAnimations[owner].has(handIndex) || autoHiddenCards[owner].has(handIndex);
}

/**
 * Vérifie si des animations de pioche sont actives (pending ou started) pour un owner
 */
function hasActiveDrawAnimation(owner) {
    return pendingDrawAnimations[owner].size > 0 || startedDrawAnimations[owner].size > 0;
}

/**
 * Auto-cache les nouvelles cartes quand le handCount augmente sans draw event préalable.
 * Sécurité contre les cas où l'état arrive avant l'événement d'animation.
 */
function autoHideNewDraws(owner, oldCount, newCount) {
    for (let i = oldCount; i < newCount; i++) {
        if (!pendingDrawAnimations[owner].has(i)) {
            autoHiddenCards[owner].add(i);
            const capturedIndex = i;
            setTimeout(() => {
                autoHiddenCards[owner].delete(capturedIndex);
            }, 2000);
        }
    }
}

/**
 * Remappe les indices de pioche adverse pour cibler les nouvelles cartes en fin de main.
 * Le serveur renvoie un handIndex basé sur le tableau interne, mais côté DOM
 * toutes les cartes adverses sont des dos identiques — on anime toujours la fin.
 */
function remapOppDrawIndices(newStartIdx) {
    if (pendingDrawAnimations.opp.size === 0) return;
    const oldIndices = [...pendingDrawAnimations.opp.keys()];
    const cards = [...pendingDrawAnimations.opp.values()];
    pendingDrawAnimations.opp.clear();
    // Remapper aussi pendingGraveyardReturns pour garder la correspondance
    const oldGraveReturns = [...pendingGraveyardReturns.opp];
    pendingGraveyardReturns.opp.clear();
    for (let i = 0; i < cards.length; i++) {
        const newIdx = newStartIdx + i;
        pendingDrawAnimations.opp.set(newIdx, cards[i]);
        if (oldGraveReturns.includes(oldIndices[i])) {
            pendingGraveyardReturns.opp.add(newIdx);
        }
    }
}

/**
 * Lance les animations après le render
 */
function startPendingDrawAnimations() {
    // Attendre le prochain frame pour s'assurer que le DOM est rendu
    requestAnimationFrame(() => {
        // Animer les cartes du joueur (seulement si pas déjà lancé)
        for (const [handIndex, card] of pendingDrawAnimations.me) {
            if (startedDrawAnimations.me.has(handIndex)) continue;
            startedDrawAnimations.me.add(handIndex);
            animateCardDraw(card, 'me', handIndex, () => {
                pendingDrawAnimations.me.delete(handIndex);
                startedDrawAnimations.me.delete(handIndex);
                // Re-query le DOM (peut avoir été reconstruit pendant l'animation)
                const panel = document.querySelector('#my-hand');
                if (panel) {
                    const cards = panel.querySelectorAll('.card');
                    if (cards[handIndex]) cards[handIndex].style.visibility = 'visible';
                }
            });
        }

        // Animer les cartes de l'adversaire (seulement si pas déjà lancé)
        for (const [handIndex, card] of pendingDrawAnimations.opp) {
            if (startedDrawAnimations.opp.has(handIndex)) continue;
            startedDrawAnimations.opp.add(handIndex);
            animateCardDraw(card, 'opp', handIndex, () => {
                pendingDrawAnimations.opp.delete(handIndex);
                startedDrawAnimations.opp.delete(handIndex);
                autoHiddenCards.opp.delete(handIndex);
                // Re-query le DOM (peut avoir été reconstruit pendant l'animation)
                const panel = document.querySelector('#opp-hand');
                if (panel) {
                    const cards = panel.querySelectorAll('.opp-card-back');
                    if (cards[handIndex]) cards[handIndex].style.visibility = 'visible';
                }
            });
        }
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
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité', superhaste: 'Supercélérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance', cleave: 'Clivant', immovable: 'Immobile', wall: 'Mur', regeneration: 'Régénération',
            protection: 'Protection', spellBoost: 'Sort renforcé', enhance: 'Amélioration', bloodthirst: 'Soif de sang', melody: 'Mélodie', untargetable: 'Inciblable'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
            if (a === 'spellBoost') return `Sort renforcé ${card.spellBoostAmount || ''}`.trim();
            if (a === 'enhance') return `Amélioration ${card.enhanceAmount || ''}`.trim();
            if (a === 'bloodthirst') return `Soif de sang ${card.bloodthirstAmount || ''}`.trim();
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
function easeInQuad(t) {
    return t * t;
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
function animateCardDraw(card, owner, handIndex, onComplete) {
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const handEl = document.querySelector(handSelector);

    if (!handEl) { if (onComplete) onComplete(); return; }

    const handCards = handEl.querySelectorAll(cardSelector);
    const targetCard = handCards[handIndex];

    if (!targetCard) {
        startedDrawAnimations[owner].delete(handIndex);
        return;
    }

    const targetRect = targetCard.getBoundingClientRect();
    const endX = targetRect.left;
    const endY = targetRect.top;
    const cardWidth = targetRect.width;
    const cardHeight = targetRect.height;

    // Vérifier si la carte revient du cimetière
    const fromGraveyard = pendingGraveyardReturns[owner].has(handIndex);
    if (fromGraveyard) pendingGraveyardReturns[owner].delete(handIndex);

    const startElId = fromGraveyard ? `${owner}-grave-stack` : `${owner}-deck-stack`;
    const startEl = document.querySelector(`#${startElId}`);
    if (!startEl) {
        targetCard.style.visibility = 'visible';
        if (onComplete) onComplete();
        return;
    }

    const startElRect = startEl.getBoundingClientRect();
    const startX = startElRect.left + startElRect.width / 2 - cardWidth / 2;
    const startY = startElRect.top;

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
        if (fromGraveyard) {
            // Retour du cimetière : carte déjà face visible, pas de flip
            const frontFace = (typeof makeCard === 'function')
                ? makeCard(card, true)
                : createCardElement(card);
            const bgImage = frontFace.style.backgroundImage;
            frontFace.style.cssText = `
                width: 100%; height: 100%;
                margin: 0; position: relative;
                border-radius: 6px;
            `;
            if (bgImage) frontFace.style.backgroundImage = bgImage;
            wrapper.appendChild(frontFace);
            document.body.appendChild(wrapper);

            // Auto-fit du nom (les noms longs débordent pendant l'animation)
            const nameElGrave = frontFace.querySelector('.arena-name');
            if (nameElGrave && typeof fitArenaName === 'function') fitArenaName(nameElGrave);

            animateGraveyardReturn(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, onComplete);
        } else {
            // Pioche normale : flipper 3D, dos visible au départ, face cachée
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

            // Auto-fit du nom (les noms longs débordent pendant l'animation)
            const nameElDraw = frontFace.querySelector('.arena-name');
            if (nameElDraw && typeof fitArenaName === 'function') fitArenaName(nameElDraw);

            animateDrawForMe(wrapper, flipper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, onComplete);
        }
    } else {
        if (fromGraveyard) {
            // Adversaire retour du cimetière : carte face visible (déjà révélée)
            const frontFace = (typeof makeCard === 'function')
                ? makeCard(card, true)
                : createCardElement(card);
            // Appliquer les classes opp-revealed pour que les sous-éléments (mana, stats)
            // aient la même taille que dans la main adverse (pas de shrink à l'arrivée)
            frontFace.classList.add('opp-card-back', 'opp-revealed');
            const bgImage = frontFace.style.backgroundImage;
            frontFace.style.cssText = `
                width: 100%; height: 100%;
                margin: 0; position: relative;
                border-radius: 6px;
            `;
            if (bgImage) frontFace.style.backgroundImage = bgImage;
            wrapper.appendChild(frontFace);
            document.body.appendChild(wrapper);

            // Auto-fit du nom (les noms longs débordent pendant l'animation)
            const nameElOppGrave = frontFace.querySelector('.arena-name');
            if (nameElOppGrave && typeof fitArenaName === 'function') fitArenaName(nameElOppGrave);

            animateGraveyardReturn(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, onComplete);
        } else {
            // Adversaire pioche normale : dos de carte
            const backCard = createCardBackElement();
            backCard.style.cssText = `
                width: 100%; height: 100%;
                margin: 0; position: relative;
                border-radius: 6px;
            `;
            wrapper.appendChild(backCard);
            document.body.appendChild(wrapper);

            animateDrawForOpp(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, onComplete);
        }
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
function animateDrawForMe(wrapper, flipper, startX, startY, endX, endY, cardW, cardH, targetCard, onComplete) {
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
            if (onComplete) onComplete();
        }
    }

    requestAnimationFrame(animate);
}

/**
 * Animation de pioche pour l'adversaire — arc simple et rapide
 */
function animateDrawForOpp(wrapper, startX, startY, endX, endY, cardW, cardH, targetCard, onComplete) {
    const duration = 450;
    const startTime = performance.now();
    const controlX = (startX + endX) / 2;
    const controlY = Math.min(startY, endY) - 60;

    wrapper.style.opacity = '0';

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const t = easeOutCubic(progress);

        const x = (1-t)*(1-t)*startX + 2*(1-t)*t*controlX + t*t*endX;
        const y = (1-t)*(1-t)*startY + 2*(1-t)*t*controlY + t*t*endY;

        wrapper.style.left = x + 'px';
        wrapper.style.top = y + 'px';
        wrapper.style.opacity = Math.min(1, progress * 3);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            targetCard.style.visibility = 'visible';
            wrapper.remove();
            if (onComplete) onComplete();
        }
    }

    requestAnimationFrame(animate);
}

/**
 * Animation de retour du cimetière pour le joueur — arc simple, carte face visible
 */
function animateGraveyardReturn(wrapper, startX, startY, endX, endY, cardW, cardH, targetCard, onComplete) {
    const duration = 550;
    const startTime = performance.now();
    const controlX = (startX + endX) / 2;
    const controlY = Math.min(startY, endY) - 80;

    wrapper.style.opacity = '0';

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const t = easeOutCubic(progress);

        const x = (1-t)*(1-t)*startX + 2*(1-t)*t*controlX + t*t*endX;
        const y = (1-t)*(1-t)*startY + 2*(1-t)*t*controlY + t*t*endY;

        // Rétrécir légèrement au fur et à mesure (de 1.2 à 1.0)
        const scale = 1.2 - 0.2 * t;

        wrapper.style.left = x + 'px';
        wrapper.style.top = y + 'px';
        wrapper.style.opacity = Math.min(1, progress * 3);
        wrapper.style.transform = `scale(${scale})`;

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            targetCard.style.visibility = 'visible';
            wrapper.remove();
            if (onComplete) onComplete();
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

    // Vérifie si des animations de pioche sont actives
    hasActiveDrawAnimation: hasActiveDrawAnimation,

    // Auto-cache les nouvelles cartes (sécurité état avant draw event)
    autoHideNewDraws: autoHideNewDraws,

    // Remappe les indices de pioche opp vers la fin de la main DOM
    remapOppDrawIndices: remapOppDrawIndices,

    // Lance les animations après le render
    startPendingDrawAnimations: startPendingDrawAnimations,

    // Marque un retour de sort depuis le cimetière
    pendingGraveyardReturns: pendingGraveyardReturns,
    
    // Pour compatibilité (ne fait plus rien directement)
    animateDraw: (card, owner, handIndex = 0) => Promise.resolve(),
    
    clear: () => {
        pendingDrawAnimations.me.clear();
        pendingDrawAnimations.opp.clear();
        autoHiddenCards.me.clear();
        autoHiddenCards.opp.clear();
    },
    
    get isReady() { return true; }
};