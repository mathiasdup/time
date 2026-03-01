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
        if (window.DEBUG_LOGS) console.log(`[BLAST-RET] prepareDraw owner=${owner} handIndex=${handIndex} card=${card?.name || card?.id || '-'} isToken=${!!drawData.isToken}`);

        // Le vrai event draw remplace l'auto-hide
        autoHiddenCards[owner].delete(handIndex);
        // Stocker pour que le render crée la carte cachée
        pendingDrawAnimations[owner].set(handIndex, card);
        // Marquer les tokens pour animation d'apparition directe
        if (drawData.isToken) {
            pendingTokenSpawns[owner].add(handIndex);
        }
    }
}

// Cartes qui reviennent du cimetière (pour utiliser grave-stack au lieu de deck-stack)
const pendingGraveyardReturns = {
    me: new Set(),
    opp: new Set()
};

// Cartes tokens qui apparaissent directement en main (pas depuis le deck)
const pendingTokenSpawns = {
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

function shouldHideCardByUid(owner, uid) {
    const key = String(uid || '');
    if (!key) return false;
    for (const [, pendingCard] of pendingDrawAnimations[owner]) {
        const pendingUid = String(pendingCard?.uid || pendingCard?.id || '');
        if (pendingUid && pendingUid === key) return true;
    }
    return false;
}

function releaseHiddenCard(owner, handIndex = null, uid = null) {
    const dropIndex = (idx) => {
        pendingDrawAnimations[owner].delete(idx);
        startedDrawAnimations[owner].delete(idx);
        autoHiddenCards[owner].delete(idx);
        pendingGraveyardReturns[owner].delete(idx);
        pendingTokenSpawns[owner].delete(idx);
    };

    if (Number.isFinite(Number(handIndex))) {
        dropIndex(Number(handIndex));
    }

    const uidKey = String(uid || '');
    if (uidKey) {
        for (const [idx, pendingCard] of Array.from(pendingDrawAnimations[owner].entries())) {
            const pendingUid = String(pendingCard?.uid || pendingCard?.id || '');
            if (pendingUid && pendingUid === uidKey) {
                dropIndex(idx);
            }
        }
    }
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
 * Résout la carte cible dans la main.
 * Fallback par uid/id si l'index serveur ne correspond pas exactement au DOM.
 */
function resolveHandTarget(owner, handIndex, card, handCards) {
    let resolvedIndex = handIndex;
    let targetCard = handCards[resolvedIndex];

    if (!targetCard && card) {
        const uid = String(card.uid || card.id || '');
        if (uid) {
            for (let i = 0; i < handCards.length; i++) {
                const el = handCards[i];
                const elUid = String(el?.dataset?.uid || el?.dataset?.cardId || '');
                if (elUid && elUid === uid) {
                    targetCard = el;
                    resolvedIndex = i;
                    break;
                }
            }
        }
    }

    return { targetCard, resolvedIndex };
}

/**
 * Remappe les indices de pioche adverse pour cibler les nouvelles cartes en fin de main.
 * Le serveur renvoie un handIndex basé sur le tableau interne, mais côté DOM
 * toutes les cartes adverses sont des dos identiques - on anime toujours la fin.
 */
function remapOppDrawIndices(newStartIdx) {
    if (pendingDrawAnimations.opp.size === 0) return;
    const oldIndices = [...pendingDrawAnimations.opp.keys()];
    const cards = [...pendingDrawAnimations.opp.values()];
    pendingDrawAnimations.opp.clear();
    // Remapper aussi pendingGraveyardReturns et pendingTokenSpawns pour garder la correspondance
    const oldGraveReturns = [...pendingGraveyardReturns.opp];
    pendingGraveyardReturns.opp.clear();
    const oldTokenSpawns = [...pendingTokenSpawns.opp];
    pendingTokenSpawns.opp.clear();
    for (let i = 0; i < cards.length; i++) {
        const newIdx = newStartIdx + i;
        pendingDrawAnimations.opp.set(newIdx, cards[i]);
        if (oldGraveReturns.includes(oldIndices[i])) {
            pendingGraveyardReturns.opp.add(newIdx);
        }
        if (oldTokenSpawns.includes(oldIndices[i])) {
            pendingTokenSpawns.opp.add(newIdx);
        }
    }
}

/**
 * Lance les animations après le render
 */
function startPendingDrawAnimations() {
    // Ne pas lancer les animations de pioche tant que la queue d'animations est active
    // (ex: combats en cours). La queue appellera cette fonction quand elle sera vide.
    if (typeof isAnimating !== 'undefined' && (isAnimating || (typeof animationQueue !== 'undefined' && animationQueue.length > 0))) {
        const qLen = (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0;
        if (window.DEBUG_LOGS) console.log(`[BLAST-RET] startPendingDraw blocked isAnimating=${!!isAnimating} queueLen=${qLen}`);
        return;
    }
    // Attendre le prochain frame pour s'assurer que le DOM est rendu
    requestAnimationFrame(() => {
        const mePanel = document.querySelector('#my-hand');
        const meCards = mePanel ? mePanel.querySelectorAll('.card:not(.committed-spell)') : [];
        let allMeTargetsReady = true;
        for (const [handIndex, card] of pendingDrawAnimations.me) {
            if (startedDrawAnimations.me.has(handIndex)) continue;
            const { targetCard } = resolveHandTarget('me', handIndex, card, meCards);
            if (!targetCard) {
                allMeTargetsReady = false;
                if (window.DEBUG_LOGS) console.log(`[BLAST-RET] me target not ready handIndex=${handIndex} card=${card?.name || card?.id || '-'} domCount=${meCards.length}`);
                break;
            }
        }

        // Animer les cartes du joueur (seulement si pas déjà lancé)
        if (allMeTargetsReady) {
            for (const [handIndex, card] of pendingDrawAnimations.me) {
                if (startedDrawAnimations.me.has(handIndex)) continue;
                startedDrawAnimations.me.add(handIndex);
                animateCardDraw(card, 'me', handIndex, (finalIndex) => {
                    const resolvedIndex = Number.isInteger(finalIndex) ? finalIndex : handIndex;
                    pendingDrawAnimations.me.delete(handIndex);
                    pendingDrawAnimations.me.delete(resolvedIndex);
                    startedDrawAnimations.me.delete(handIndex);
                    startedDrawAnimations.me.delete(resolvedIndex);
                    // Re-query le DOM (peut avoir été reconstruit pendant l'animation)
                    const panel = document.querySelector('#my-hand');
                    if (panel) {
                        const cards = panel.querySelectorAll('.card:not(.committed-spell)');
                        if (cards[resolvedIndex]) cards[resolvedIndex].style.visibility = 'visible';
                    }
                });
            }
        }

        // Animer les cartes de l'adversaire (seulement si pas déjà lancé)
        // Vérifier d'abord que toutes les cibles DOM existent pour synchroniser le batch
        const oppPanel = document.querySelector('#opp-hand');
        const oppCards = oppPanel ? oppPanel.querySelectorAll('.opp-card-back') : [];
        let allOppTargetsReady = true;
        for (const [handIndex, card] of pendingDrawAnimations.opp) {
            if (startedDrawAnimations.opp.has(handIndex)) continue;
            const { targetCard } = resolveHandTarget('opp', handIndex, card, oppCards);
            if (!targetCard) {
                allOppTargetsReady = false;
                if (window.DEBUG_LOGS) console.log(`[BLAST-RET] opp target not ready handIndex=${handIndex} card=${card?.name || card?.id || '-'} domCount=${oppCards.length}`);
                break;
            }
        }
        if (allOppTargetsReady) {
            for (const [handIndex, card] of pendingDrawAnimations.opp) {
                if (startedDrawAnimations.opp.has(handIndex)) continue;
                startedDrawAnimations.opp.add(handIndex);
                animateCardDraw(card, 'opp', handIndex, (finalIndex) => {
                    const resolvedIndex = Number.isInteger(finalIndex) ? finalIndex : handIndex;
                    pendingDrawAnimations.opp.delete(handIndex);
                    pendingDrawAnimations.opp.delete(resolvedIndex);
                    startedDrawAnimations.opp.delete(handIndex);
                    startedDrawAnimations.opp.delete(resolvedIndex);
                    autoHiddenCards.opp.delete(handIndex);
                    autoHiddenCards.opp.delete(resolvedIndex);
                    // Re-query le DOM (peut avoir été reconstruit pendant l'animation)
                    const panel = document.querySelector('#opp-hand');
                    if (panel) {
                        const cards = panel.querySelectorAll('.opp-card-back');
                        if (cards[resolvedIndex]) cards[resolvedIndex].style.visibility = 'visible';
                    }
                });
            }
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
            protection: 'Protection', spellBoost: 'Sort renforcé', enhance: 'Amélioration', bloodthirst: 'Soif de sang', melody: 'Mélodie', untargetable: 'Inciblable', provocation: 'Provocation'
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
    const cardSelector = owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back';
    const handEl = document.querySelector(handSelector);

    if (!handEl) { if (onComplete) onComplete(handIndex); return; }

    const handCards = handEl.querySelectorAll(cardSelector);
    const resolved = resolveHandTarget(owner, handIndex, card, handCards);
    const targetCard = resolved.targetCard;
    const resolvedIndex = resolved.resolvedIndex;
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] animateCardDraw start owner=${owner} reqIdx=${handIndex} resolvedIdx=${resolvedIndex} card=${card?.name || card?.id || '-'} domCount=${handCards.length} target=${targetCard ? 'found' : 'missing'}`);

    if (!targetCard) {
        startedDrawAnimations[owner].delete(handIndex);
        if (window.DEBUG_LOGS) console.log(`[BLAST-RET] animateCardDraw abort no-target owner=${owner} reqIdx=${handIndex} card=${card?.name || card?.id || '-'}`);
        return;
    }
    // Sécurité: si l'index serveur est stale, recaler les sets sur l'index réel.
    if (resolvedIndex !== handIndex) {
        if (window.DEBUG_LOGS) console.log(`[BLAST-RET] resolve fallback owner=${owner} reqIdx=${handIndex} resolvedIdx=${resolvedIndex} card=${card?.name || card?.id || '-'}`);
        if (pendingDrawAnimations[owner].has(handIndex)) {
            pendingDrawAnimations[owner].delete(handIndex);
            pendingDrawAnimations[owner].set(resolvedIndex, card);
        }
        if (pendingGraveyardReturns[owner].has(handIndex)) {
            pendingGraveyardReturns[owner].delete(handIndex);
            pendingGraveyardReturns[owner].add(resolvedIndex);
        }
        if (pendingTokenSpawns[owner].has(handIndex)) {
            pendingTokenSpawns[owner].delete(handIndex);
            pendingTokenSpawns[owner].add(resolvedIndex);
        }
    }
    targetCard.style.visibility = 'hidden';

    const targetRect = targetCard.getBoundingClientRect();
    const endX = targetRect.left;
    const endY = targetRect.top;
    const cardWidth = targetRect.width;
    const cardHeight = targetRect.height;

    // Vérifier si la carte revient du cimetière
    const fromGraveyard = pendingGraveyardReturns[owner].has(resolvedIndex) || pendingGraveyardReturns[owner].has(handIndex);
    if (fromGraveyard) {
        pendingGraveyardReturns[owner].delete(handIndex);
        pendingGraveyardReturns[owner].delete(resolvedIndex);
    }

    // Vérifier si c'est un token (apparition directe en main)
    const isToken = pendingTokenSpawns[owner].has(resolvedIndex) || pendingTokenSpawns[owner].has(handIndex);
    if (isToken) {
        pendingTokenSpawns[owner].delete(handIndex);
        pendingTokenSpawns[owner].delete(resolvedIndex);
    }

    // Token : animation d'apparition directe sur place
    if (isToken) {
        animateTokenSpawn(card, owner, endX, endY, cardWidth, cardHeight, targetCard, () => {
            if (onComplete) onComplete(resolvedIndex);
        });
        return;
    }

    const startElId = fromGraveyard ? `${owner}-grave-stack` : `${owner}-deck-stack`;
    const startEl = document.querySelector(`#${startElId}`);
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] animateCardDraw route owner=${owner} idx=${resolvedIndex} fromGraveyard=${fromGraveyard} isToken=${isToken} startEl=${startElId} exists=${!!startEl}`);
    if (!startEl) {
        targetCard.style.visibility = 'visible';
        if (window.DEBUG_LOGS) console.log(`[BLAST-RET] animateCardDraw fallback-show owner=${owner} idx=${resolvedIndex} reason=no-startEl`);
        if (onComplete) onComplete(resolvedIndex);
        return;
    }

    const startElRect = startEl.getBoundingClientRect();
    const startX = startElRect.left + startElRect.width / 2 - cardWidth / 2;
    const startY = startElRect.top;
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] animateCardDraw path owner=${owner} idx=${resolvedIndex} start=(${startX.toFixed(1)},${startY.toFixed(1)}) end=(${endX.toFixed(1)},${endY.toFixed(1)}) size=${cardWidth.toFixed(1)}x${cardHeight.toFixed(1)}`);

    // Ratio écran/design : les cartes sont designées à 144-192px (dans game-scaler)
    // mais à l'écran elles sont plus petites à cause du transform: scale() du game-scaler.
    // On garde la taille design dans les faces et on scale pour matcher l'écran.
    const _rs = getComputedStyle(document.documentElement);
    const designW = parseFloat(_rs.getPropertyValue('--card-w'));
    const designH = parseFloat(_rs.getPropertyValue('--card-h'));
    const faceScale = cardWidth / designW;

    // Créer un conteneur positionné
    // Pour le joueur (pioche normale), le wrapper sera redimensionné à la taille reveal
    // dans animateDrawForMe pour un rendu net. Ici on crée à la taille main par défaut.
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
                margin: 0; position: relative;
                border-radius: 6px;
                transform: scale(${faceScale});
                transform-origin: top left;
            `;
            if (bgImage) frontFace.style.backgroundImage = bgImage;
            wrapper.appendChild(frontFace);
            document.body.appendChild(wrapper);

            // Vider le cimetière dans le même frame que la création du wrapper
            // (le wrapper couvre la position du cimetière, pas de flash visible)
            const cardUid = card.uid || card.id;
            const meGraveTop = document.getElementById('me-grave-top');
            if (meGraveTop && meGraveTop.dataset.topCardUid === cardUid) {
                const meGrave = state?.me?.graveyard;
                meGraveTop.innerHTML = '';
                // Restaurer la vraie carte du dessus depuis le state (le sort retourné n'y est plus)
                if (meGrave && meGrave.length > 0) {
                    const actualTop = meGrave[meGrave.length - 1];
                    meGraveTop.dataset.topCardUid = actualTop.uid || actualTop.id;
                    meGraveTop.classList.remove('empty');
                    const graveCardEl = makeCard(actualTop, false);
                    graveCardEl.classList.remove('just-played', 'can-attack');
                    graveCardEl.classList.add('grave-card', 'in-graveyard');
                    meGraveTop.appendChild(graveCardEl);
                    const nameEl = graveCardEl.querySelector('.arena-name');
                    if (nameEl && typeof fitArenaName === 'function') fitArenaName(nameEl);
                } else {
                    meGraveTop.classList.add('empty');
                    delete meGraveTop.dataset.topCardUid;
                }
                // Débloquer et mettre à jour les layers du cimetière
                graveRenderBlocked.delete('me');
                updateGraveDisplay('me', meGrave || []);
            }

            animateGraveyardReturnArc(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, () => {
                if (onComplete) onComplete(resolvedIndex);
            });
        } else {
            // Pioche normale : flipper 3D, dos visible au départ, face cachée
            // Le wrapper sera redimensionné à revealW dans animateDrawForMe
            const revealScale = 1.4;
            const revealFaceScale = faceScale * revealScale;

            const flipper = document.createElement('div');
            flipper.style.cssText = `
                width: 100%; height: 100%;
                position: relative;
                transform-style: preserve-3d;
                transform: rotateY(0deg);
            `;

            // Scaler : taille design + scale pour matcher le wrapper.
            // Sépare le scale (top-left) du rotateY (center) pour éviter
            // les conflits de transform-origin en 3D.
            const scalerCss = `
                position: absolute; top: 0; left: 0;
                width: ${designW}px; height: ${designH}px;
                transform: scale(${revealFaceScale});
                transform-origin: top left;
                transform-style: preserve-3d;
            `;

            // Face arrière (dos de carte)
            const backScaler = document.createElement('div');
            backScaler.style.cssText = scalerCss;
            const backFace = createCardBackElement();
            backFace.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%;
                backface-visibility: hidden;
                transform: rotateY(0deg);
                border-radius: 6px;
            `;
            backScaler.appendChild(backFace);

            // Face avant (carte) - 100% du scaler = taille design, proportions correctes
            const frontScaler = document.createElement('div');
            frontScaler.style.cssText = scalerCss;
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
            frontScaler.appendChild(frontFace);

            flipper.appendChild(backScaler);
            flipper.appendChild(frontScaler);
            wrapper.appendChild(flipper);
            document.body.appendChild(wrapper);

            animateDrawForMe(wrapper, flipper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, () => {
                if (onComplete) onComplete(resolvedIndex);
            });
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
                margin: 0; position: relative;
                border-radius: 6px;
                transform: scale(${faceScale});
                transform-origin: top left;
            `;
            if (bgImage) frontFace.style.backgroundImage = bgImage;
            wrapper.appendChild(frontFace);
            document.body.appendChild(wrapper);

            // Vider le cimetière dans le même frame que la création du wrapper
            const oppCardUid = card.uid || card.id;
            const oppGraveTop = document.getElementById('opp-grave-top');
            if (oppGraveTop && oppGraveTop.dataset.topCardUid === oppCardUid) {
                const oppGrave = state?.opponent?.graveyard;
                oppGraveTop.innerHTML = '';
                // Restaurer la vraie carte du dessus depuis le state
                if (oppGrave && oppGrave.length > 0) {
                    const actualTop = oppGrave[oppGrave.length - 1];
                    oppGraveTop.dataset.topCardUid = actualTop.uid || actualTop.id;
                    oppGraveTop.classList.remove('empty');
                    const graveCardEl = makeCard(actualTop, false);
                    graveCardEl.classList.remove('just-played', 'can-attack');
                    graveCardEl.classList.add('grave-card', 'in-graveyard');
                    oppGraveTop.appendChild(graveCardEl);
                    const nameEl = graveCardEl.querySelector('.arena-name');
                    if (nameEl && typeof fitArenaName === 'function') fitArenaName(nameEl);
                } else {
                    oppGraveTop.classList.add('empty');
                    delete oppGraveTop.dataset.topCardUid;
                }
                // Débloquer et mettre à jour les layers du cimetière
                graveRenderBlocked.delete('opp');
                updateGraveDisplay('opp', oppGrave || []);
            }

            animateGraveyardReturnArc(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, () => {
                if (onComplete) onComplete(resolvedIndex);
            });
        } else {
            // Adversaire pioche normale : dos de carte
            const backCard = createCardBackElement();
            backCard.style.cssText = `
                margin: 0; position: relative;
                border-radius: 6px;
                transform: scale(${faceScale});
                transform-origin: top left;
            `;
            wrapper.appendChild(backCard);
            document.body.appendChild(wrapper);

            animateDrawForOpp(wrapper, startX, startY, endX, endY, cardWidth, cardHeight, targetCard, () => {
                if (onComplete) onComplete(resolvedIndex);
            });
        }
    }
}

/**
 * Animation de pioche pour le joueur - flip 3D + reveal au centre
 *
 * Phase 1 - Lift:       Dos de carte se soulève du deck
 * Phase 2 - Fly+Flip:   Vol vers le centre + flip 3D (dos -  face)
 * Phase 3 - Hold:       Pause au centre, carte face visible
 * Phase 4 - To hand:    Carte glisse dans la main
 */
function animateDrawForMe(wrapper, flipper, startX, startY, endX, endY, cardW, cardH, targetCard, onComplete) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Rendu à la taille reveal (grande) pour un affichage net au centre.
    // On scale DOWN vers la main au lieu de scale UP depuis la main.
    const revealScale = 1.4;
    const handScale = 1 / revealScale; // ~0.714
    const revealW = cardW * revealScale;
    const revealH = cardH * revealScale;

    // Agrandir le wrapper à la taille reveal (le contenu est rendu à cette résolution)
    const offsetX = (revealW - cardW) / 2;
    const offsetY = (revealH - cardH) / 2;
    wrapper.style.width = revealW + 'px';
    wrapper.style.height = revealH + 'px';
    wrapper.style.left = (startX - offsetX) + 'px';
    wrapper.style.top = (startY - offsetY) + 'px';
    wrapper.style.transform = `scale(${handScale})`;

    // Positions ajustées pour le wrapper agrandi (compense l'offset du scale depuis le centre)
    const adjStartX = startX - offsetX;
    const adjStartY = startY - offsetY;
    const adjEndX = endX - offsetX;
    const adjEndY = endY - offsetY;

    // Position de reveal : centre de l'écran (wrapper à taille native = pas de scale)
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
            // === PHASE 1: LIFT - dos de carte se soulève (taille main) ===
            const p = progress / t1;
            const ep = easeOutCubic(p);

            x = adjStartX;
            y = adjStartY - ep * 30;
            scale = handScale * (1 + ep * 0.05);
            opacity = 0.3 + ep * 0.7;
            flipDeg = 0;

        } else if (progress <= t2) {
            // === PHASE 2: FLY + FLIP - vol vers le centre, grandit jusqu'à taille native ===
            const p = (progress - t1) / (t2 - t1);
            const ep = easeInOutCubic(p);

            const liftEndY = adjStartY - 30;
            x = adjStartX + (revealX - adjStartX) * ep;
            y = liftEndY + (revealY - liftEndY) * ep;
            scale = handScale * 1.05 + (1.0 - handScale * 1.05) * ep;
            opacity = 1;
            flipDeg = easeInOutCubic(p) * 180;

        } else if (progress <= t3) {
            // === PHASE 3: HOLD - carte face visible, taille native (rendu net) ===
            x = revealX;
            y = revealY;
            scale = 1.0;
            opacity = 1;
            flipDeg = 180;

        } else {
            // === PHASE 4: FLY TO HAND - rétrécit vers la main ===
            const p = (progress - t3) / (1 - t3);
            const ep = easeOutCubic(p);

            x = revealX + (adjEndX - revealX) * ep;
            y = revealY + (adjEndY - revealY) * ep;
            scale = 1.0 + (handScale - 1.0) * ep;
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
 * Animation de pioche pour l'adversaire - arc simple et rapide
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
 * Animation de retour du cimetière pour le joueur - arc simple, carte face visible
 */
function animateGraveyardReturnArc(wrapper, startX, startY, endX, endY, cardW, cardH, targetCard, onComplete) {
    const duration = 550;
    const startTime = performance.now();
    const controlX = (startX + endX) / 2;
    const controlY = Math.min(startY, endY) - 80;

    wrapper.style.opacity = '1';

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
        wrapper.style.opacity = '1';
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
 * Animation d'apparition de token directement en main (pas depuis le deck)
 * Scale-up avec glow + léger bounce
 */
function animateTokenSpawn(card, owner, endX, endY, cardW, cardH, targetCard, onComplete) {
    // Ratio écran/design (même calcul que animateCardDraw)
    const _rs = getComputedStyle(document.documentElement);
    const designW = parseFloat(_rs.getPropertyValue('--card-w'));
    const tokenFaceScale = cardW / designW;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        left: ${endX}px;
        top: ${endY}px;
        width: ${cardW}px;
        height: ${cardH}px;
        transform-origin: center center;
        transform: scale(0);
        opacity: 0;
        perspective: 800px;
    `;

    if (owner === 'me') {
        const frontFace = (typeof makeCard === 'function')
            ? makeCard(card, true)
            : createCardElement(card);
        const bgImage = frontFace.style.backgroundImage;
        frontFace.style.cssText = `
            margin: 0; position: relative;
            border-radius: 6px;
            transform: scale(${tokenFaceScale});
            transform-origin: top left;
        `;
        if (bgImage) frontFace.style.backgroundImage = bgImage;
        wrapper.appendChild(frontFace);
    } else {
        const frontFace = (typeof makeCard === 'function')
            ? makeCard(card, true)
            : createCardElement(card);
        frontFace.classList.add('opp-card-back', 'opp-revealed');
        const bgImage = frontFace.style.backgroundImage;
        frontFace.style.cssText = `
            margin: 0; position: relative;
            border-radius: 6px;
            transform: scale(${tokenFaceScale});
            transform-origin: top left;
        `;
        if (bgImage) frontFace.style.backgroundImage = bgImage;
        wrapper.appendChild(frontFace);
    }

    document.body.appendChild(wrapper);

    const duration = 500;
    const startTime = performance.now();

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        let scale, opacity;
        if (progress < 0.4) {
            // Scale up avec overshoot : 0 -  1.15
            const p = progress / 0.4;
            const eased = 1 - Math.pow(1 - p, 3);
            scale = eased * 1.15;
            opacity = Math.min(1, p * 2.5);
        } else if (progress < 0.65) {
            // Bounce back : 1.15 -  0.95
            const p = (progress - 0.4) / 0.25;
            scale = 1.15 - p * 0.2;
            opacity = 1;
        } else {
            // Settle : 0.95 -  1.0
            const p = (progress - 0.65) / 0.35;
            scale = 0.95 + p * 0.05;
            opacity = 1;
        }

        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.opacity = opacity;

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
    shouldHideCardByUid: shouldHideCardByUid,
    releaseHiddenCard: releaseHiddenCard,

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
        pendingTokenSpawns.me.clear();
        pendingTokenSpawns.opp.clear();
    },
    
    get isReady() { return true; }
};
