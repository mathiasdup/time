// ==================== RENDU DU JEU ====================
// Render principal, champ de bataille, main, cartes, preview, cimetière
function render() {
    if (!state) return;
    const me = state.me, opp = state.opponent;

    // Ne pas mettre Ã  jour les HP si une animation zdejebel/trample est en cours ou en attente
    // Ces animations gÃ¨rent elles-mÃªmes l'affichage des HP
    const hasHpAnimPending = animationQueue.some(a => a.type === 'zdejebel' || a.type === 'trampleHeroHit' || (a.type === 'onDeathDamage' && a.data?.targetRow === undefined)) || zdejebelAnimationInProgress;
    if (!hasHpAnimPending) {
        const meHpNum = document.querySelector('#me-hp .hero-hp-number');
        const oppHpNum = document.querySelector('#opp-hp .hero-hp-number');
        const meOld = meHpNum?.textContent, oppOld = oppHpNum?.textContent;
        if (meHpNum) meHpNum.textContent = me.hp;
        if (oppHpNum) oppHpNum.textContent = opp.hp;
        if (meOld !== String(me.hp) || oppOld !== String(opp.hp)) {
        }
    } else {
        const meHpNum = document.querySelector('#me-hp .hero-hp-number');
        const oppHpNum = document.querySelector('#opp-hp .hero-hp-number');
    }
    const meManaNum = document.querySelector('#me-energy .hero-mana-number');
    const oppManaNum = document.querySelector('#opp-energy .hero-mana-number');
    if (meManaNum) {
        meManaNum.textContent = `${me.energy}/${me.maxEnergy}`;
        meManaNum.style.fontSize = (me.energy >= 10 || me.maxEnergy >= 10) ? '1em' : '';
    }
    if (oppManaNum) {
        oppManaNum.textContent = `${opp.energy}/${opp.maxEnergy}`;
        oppManaNum.style.fontSize = (opp.energy >= 10 || opp.maxEnergy >= 10) ? '1em' : '';
    }
    // Mettre Ã  jour les tooltips du deck
    const meDeckTooltip = document.getElementById('me-deck-tooltip');
    const oppDeckTooltip = document.getElementById('opp-deck-tooltip');
    if (meDeckTooltip) meDeckTooltip.textContent = me.deckCount + (me.deckCount > 1 ? ' cartes' : ' carte');
    if (oppDeckTooltip) oppDeckTooltip.textContent = opp.deckCount + (opp.deckCount > 1 ? ' cartes' : ' carte');
    // Mettre Ã  jour les tooltips du cimetiÃ¨re
    const meGraveCount = me.graveyardCount || 0;
    const oppGraveCount = opp.graveyardCount || 0;
    const meGraveTooltip = document.getElementById('me-grave-tooltip');
    const oppGraveTooltip = document.getElementById('opp-grave-tooltip');
    if (meGraveTooltip) meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
    if (oppGraveTooltip) oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');
    
    // Afficher/cacher le contenu du deck selon le nombre de cartes
    updateDeckDisplay('me', me.deckCount);
    updateDeckDisplay('opp', opp.deckCount);
    
    // Afficher la derniÃ¨re carte du cimetiÃ¨re
    updateGraveTopCard('me', me.graveyard);
    updateGraveTopCard('opp', opp.graveyard);
    
    // Mettre Ã  jour l'affichage de la pile du cimetiÃ¨re
    updateGraveDisplay('me', me.graveyard);
    updateGraveDisplay('opp', opp.graveyard);
    
    const activeShieldKeys = new Set();
    renderField('me', me.field, activeShieldKeys);
    renderField('opp', opp.field, activeShieldKeys);
    CombatVFX.syncShields(activeShieldKeys);
    renderTraps();
    renderHand(me.hand, me.energy);

    renderOppHand(opp.handCount, opp.oppHand);

    // Lancer les animations de pioche aprÃ¨s les renders
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.startPendingDrawAnimations();
    }
    
    if (me.ready && state.phase === 'planning') {
        document.getElementById('end-turn-btn').classList.add('waiting');
    }
}

function updateDeckDisplay(owner, deckCount) {
    const stack = document.getElementById(`${owner}-deck-stack`);
    if (!stack) return;
    
    // GÃ©rer l'Ã©tat vide
    if (deckCount <= 0) {
        stack.classList.add('empty');
    } else {
        stack.classList.remove('empty');
    }
    
    // Ajuster le nombre de couches visibles selon le nombre de cartes
    // CSS inversÃ© : nth-child(1) = fond (dÃ©calÃ©), nth-child(5) = dessus (pas de dÃ©calage)
    // Quand le deck diminue, on masque les couches du DESSUS (index Ã©levÃ©s dans le DOM)
    const layers = stack.querySelectorAll('.deck-card-layer');
    const totalLayers = layers.length;
    const visibleLayers = Math.min(totalLayers, Math.ceil(deckCount / 8)); // 1 couche par 8 cartes

    // Garder les premiÃ¨res couches (fond), masquer les derniÃ¨res (dessus)
    layers.forEach((layer, i) => {
        if (i < visibleLayers) {
            layer.style.display = 'block';
        } else {
            layer.style.display = 'none';
        }
    });
}

// Bloquer le render du cimetiÃ¨re pendant les animations de burn
const graveRenderBlocked = new Set(); // 'me' ou 'opp'
const pendingSpellReturns = new Set(); // UIDs de sorts qui retournent en main (pas au cimetiÃ¨re)

function updateGraveDisplay(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) return;
    const stack = document.getElementById(`${owner}-grave-stack`);
    if (!stack) return;

    const count = graveyard ? graveyard.length : 0;

    // RÃ©initialiser les classes
    stack.classList.remove('has-cards', 'cards-1', 'cards-2', 'cards-3');

    if (count > 0) {
        stack.classList.add('has-cards');
        if (count === 1) stack.classList.add('cards-1');
        else if (count === 2) stack.classList.add('cards-2');
        else if (count === 3) stack.classList.add('cards-3');
    }

    // Remplir les layers avec de vraies cartes
    const layers = stack.querySelectorAll('.grave-card-layer');
    layers.forEach((layer, i) => {
        // Layer 0 (nth-child(1), bottom, most offset): graveyard[count-4]
        // Layer 1 (nth-child(2), middle):              graveyard[count-3]
        // Layer 2 (nth-child(3), top layer):           graveyard[count-2]
        const cardIndex = count - (3 - i) - 1;
        const card = (cardIndex >= 0 && graveyard) ? graveyard[cardIndex] : null;
        const cardId = card ? (card.uid || card.id) : '';

        // Cache: ne re-render que si la carte a changÃ©
        if (layer.dataset.cardUid === cardId) return;
        layer.dataset.cardUid = cardId;
        layer.innerHTML = '';

        if (card) {
            const cardEl = makeCard(card, false);
            cardEl.classList.add('grave-card', 'in-graveyard');
            layer.appendChild(cardEl);
        }
    });
}

function updateGraveTopCard(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) {
        // Rester bloquÃ© â€” l'animation (burn, death, spell, trap) dÃ©bloquera elle-mÃªme
        // quand elle sera terminÃ©e et appellera updateGraveTopCard Ã  ce moment-lÃ 
        return;
    }
    const container = document.getElementById(`${owner}-grave-top`);
    if (!container) return;

    if (graveyard && graveyard.length > 0) {
        const topCard = graveyard[graveyard.length - 1];
        const topId = topCard.uid || topCard.id;
        if (container.dataset.topCardUid === topId) return;
        container.dataset.topCardUid = topId;
        container.classList.remove('empty');
        container.innerHTML = '';
        const cardEl = makeCard(topCard, false);
        cardEl.classList.add('grave-card', 'in-graveyard');
        container.appendChild(cardEl);
    } else {
        if (container.classList.contains('empty') && container.children.length === 0) return;
        delete container.dataset.topCardUid;
        container.classList.add('empty');
        container.innerHTML = '';
    }
}

function renderField(owner, field, activeShieldKeys) {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${r}"][data-col="${c}"]`);
            if (!slot) continue;

            // Si ce slot est en cours d'animation, ne pas y toucher
            const slotKey = `${owner}-${r}-${c}`;
            if (animatingSlots.has(slotKey)) {
                continue;
            }

            const hadCard = slot.classList.contains('has-card');
            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));

            slot.classList.remove('has-card');
            slot.classList.remove('has-flying');
            const card = field[r][c];

            // Log quand une carte disparait du slot (aide au debug des animations de mort)
            if (hadCard && !card) {
            }

            if (card) {
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);

                // Ajouter l'effet de lÃ©vitation pour les crÃ©atures volantes
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    cardEl.classList.add('flying-creature');
                    slot.classList.add('has-flying');
                    // DÃ©marrer l'animation de lÃ©vitation continue
                    startFlyingAnimation(cardEl);
                } else {
                    slot.classList.remove('has-flying');
                }

                // Indicateur de bouclier (Protection) â€” PixiJS honeycomb
                if (card.hasProtection) {
                    CombatVFX.registerShield(slotKey, cardEl);
                    if (activeShieldKeys) activeShieldKeys.add(slotKey);
                }

                // Hover preview pour voir la carte en grand
                cardEl.onmouseenter = (e) => showCardPreview(card, e);
                cardEl.onmouseleave = hideCardPreview;
                cardEl.onmousemove = (e) => moveCardPreview(e);

                // Custom drag pour redÃ©ploiement (seulement mes cartes)
                if (owner === 'me' && !state.me.inDeployPhase && !card.movedThisTurn) {
                    CustomDrag.makeDraggable(cardEl, {
                        source: 'field',
                        card: card,
                        row: r,
                        col: c,
                        owner: owner
                    });
                }

                // Clic gauche = zoom sur la carte (pour toutes les cartes)
                cardEl.onclick = (e) => {
                    e.stopPropagation();
                    showCardZoom(card);
                };
                slot.appendChild(cardEl);
            }
        }
    }
}

// Preview flottante d'une carte
let previewEl = null;
// Descriptions des capacitÃ©s
const ABILITY_DESCRIPTIONS = {
    fly: { name: 'Vol', desc: 'Cette crÃ©ature peut attaquer n\'importe quel emplacement adverse, pas seulement celui en face.' },
    shooter: { name: 'Tireur', desc: 'Cette crÃ©ature peut attaquer Ã  distance sans recevoir de riposte.' },
    haste: { name: 'CÃ©lÃ©ritÃ©', desc: 'Cette crÃ©ature peut attaquer dÃ¨s le tour oÃ¹ elle est invoquÃ©e.' },
    intangible: { name: 'Intangible', desc: 'Cette crÃ©ature ne peut pas Ãªtre ciblÃ©e par les sorts ou les piÃ¨ges.' },
    trample: { name: 'PiÃ©tinement', desc: 'Les dÃ©gÃ¢ts excÃ©dentaires sont infligÃ©s au hÃ©ros adverse.' },

    power: { name: 'Puissance', desc: 'Quand cette crÃ©ature subit des dÃ©gÃ¢ts sans mourir, elle gagne +X ATK (X = valeur de Puissance).' },
    cleave: { name: 'Clivant', desc: 'Quand cette crÃ©ature attaque, elle inflige X dÃ©gÃ¢ts aux crÃ©atures sur les lignes adjacentes. Ces crÃ©atures ne ripostent pas.' },
    immovable: { name: 'Immobile', desc: 'Cette crÃ©ature ne peut pas se dÃ©placer.' },
    regeneration: { name: 'RÃ©gÃ©nÃ©ration', desc: 'En fin de tour, cette crÃ©ature rÃ©cupÃ¨re X PV (sans dÃ©passer ses PV max).' },
    protection: { name: 'Protection', desc: 'Cette crÃ©ature est protÃ©gÃ©e contre la prochaine source de dÃ©gÃ¢ts qu\'elle subirait. Le bouclier est consommÃ© aprÃ¨s avoir bloquÃ© une source.' }
};

function showCardPreview(card, e) {
    hideCardPreview();
    
    // CrÃ©er le container
    previewEl = document.createElement('div');
    previewEl.className = 'preview-container card-preview';
    
    // Ajouter la carte (version complÃ¨te avec tous les dÃ©tails)
    const cardEl = makeCard(card, true);
    cardEl.classList.add('preview-card');
    previewEl.appendChild(cardEl);
    
    // Container pour capacitÃ©s + effets
    const infoContainer = document.createElement('div');
    infoContainer.className = 'preview-info-container';
    
    // Ajouter les capacitÃ©s si c'est une crÃ©ature avec des abilities
    if (card.type === 'creature' && card.abilities && card.abilities.length > 0) {
        const abilitiesContainer = document.createElement('div');
        abilitiesContainer.className = 'preview-abilities';

        card.abilities.forEach(ability => {
            const abilityInfo = ABILITY_DESCRIPTIONS[ability];
            if (abilityInfo) {
                const abilityEl = document.createElement('div');
                abilityEl.className = 'preview-ability';
                // Type de combat (shooter/fly) en blanc, capacitÃ©s communes en jaune
                const isTypeAbility = ability === 'shooter' || ability === 'fly';
                abilityEl.innerHTML = `
                    <div class="ability-name ${isTypeAbility ? 'type-ability' : ''}">${abilityInfo.name}</div>
                    <div class="ability-desc">${abilityInfo.desc}</div>
                `;
                abilitiesContainer.appendChild(abilityEl);
            }
        });

        infoContainer.appendChild(abilitiesContainer);
    }
    
    // Ajouter les effets appliquÃ©s (sorts) si prÃ©sents
    if (card.appliedEffects && card.appliedEffects.length > 0) {
        const effectsContainer = document.createElement('div');
        effectsContainer.className = 'preview-effects';
        
        card.appliedEffects.forEach(effect => {
            const effectEl = document.createElement('div');
            effectEl.className = 'preview-effect';
            effectEl.innerHTML = `
                <div class="effect-name">${effect.name}</div>
                <div class="effect-desc">${effect.description}</div>
            `;
            effectsContainer.appendChild(effectEl);
        });
        
        infoContainer.appendChild(effectsContainer);
    }
    
    if (infoContainer.children.length > 0) {
        previewEl.appendChild(infoContainer);
    }

    document.body.appendChild(previewEl);
    const el = previewEl; // Garder une rÃ©fÃ©rence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function showCardBackPreview() {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'card-back-preview card-preview';
    document.body.appendChild(previewEl);
    const el = previewEl; // Garder une rÃ©fÃ©rence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function makeHeroCard(hero, hp) {
    const faction = hero.faction || 'neutral';
    const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
    const rarityClass = rarityMap[hero.edition] || 'common';
    const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;
    const el = document.createElement('div');
    el.className = `card creature arena-style faction-${faction}`;
    el.style.backgroundImage = `url('/cards/${hero.image}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';

    el.innerHTML = `
        <div class="arena-title"><div class="arena-name">${hero.name}</div></div>
        <div class="arena-hero-hp">
            <div class="arena-hero-hp-border">
                <div class="arena-hero-hp-inner">
                    <span class="arena-hero-hp-number">${hp}</span>
                </div>
            </div>
        </div>
        <div class="arena-text-zone">
            <div class="arena-type">HÃ©ros</div>
            <div class="arena-special">${hero.ability}</div>
        </div>
        ${rarityDiamond}`;

    return el;
}

function showHeroPreview(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'hero-preview';

    if (hero && hero.image) {
        const cardEl = makeHeroCard(hero, hp);
        previewEl.appendChild(cardEl);
    } else {
        previewEl.innerHTML = `<div class="hero-preview-name">${hero ? hero.name : 'HÃ©ros'}</div>`;
    }
    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) {
            el.classList.add('visible');
        }
    });
}

function showHeroDetail(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
        if (!hero) return;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    const overlay = document.getElementById('card-zoom-overlay');
    const container = document.getElementById('card-zoom-container');

    container.innerHTML = '';
    const cardEl = makeHeroCard(hero, hp);
    container.appendChild(cardEl);

    zoomCardData = hero;
    overlay.classList.remove('hidden');
}

function moveCardPreview(e) {
    // Plus besoin de suivre la souris - position fixe
}
function hideCardPreview() {
    if (previewEl) {
        previewEl.remove();
        previewEl = null;
    }
}

function renderTraps() {
    state.me.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="me"][data-row="${i}"]`);
        if (slot) {
            const hadTrap = slot.classList.contains('has-trap');
            slot.classList.remove('has-trap', 'mine');
            if (trap) {
                slot.classList.add('has-trap', 'mine');
                slot.innerHTML = '<img class="trap-icon-img mine" src="/battlefield_elements/beartraparmed.png" alt="trap">';

                // Hover preview pour voir le piÃ¨ge posÃ©
                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
                if (hadTrap) {
                }
                slot.innerHTML = '';
                slot.onmouseenter = null;
                slot.onmouseleave = null;
                slot.onmousemove = null;
            }
        }
    });

    state.opponent.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="opp"][data-row="${i}"]`);
        if (slot) {
            const hadTrap = slot.classList.contains('has-trap');
            slot.classList.remove('has-trap', 'mine');
            if (trap) {
                slot.classList.add('has-trap');
                slot.innerHTML = '<img class="trap-icon-img enemy" src="/battlefield_elements/beartraparmed.png" alt="trap">';
            } else {
                if (hadTrap) {
                }
                slot.innerHTML = '';
            }
        }
    });
}

function renderHand(hand, energy) {
    const panel = document.getElementById('my-hand');

    // FLIP step 1 : snapshot des positions avant de vider le DOM
    let oldPositions = null;
    let oldCommittedPositions = null;
    const removedIdx = handCardRemovedIndex;
    if (removedIdx >= 0) {
        oldPositions = {};
        oldCommittedPositions = {};
        // Cartes normales
        const oldCards = panel.querySelectorAll('.card:not(.committed-spell)');
        oldCards.forEach(card => {
            const idx = parseInt(card.dataset.idx);
            if (idx !== removedIdx) {
                const newIdx = idx > removedIdx ? idx - 1 : idx;
                oldPositions[newIdx] = card.getBoundingClientRect().left;
            }
        });
        // Sorts engagÃ©s (par commitId)
        const oldCommitted = panel.querySelectorAll('.committed-spell');
        oldCommitted.forEach(card => {
            const commitId = card.dataset.commitId;
            oldCommittedPositions[commitId] = card.getBoundingClientRect().left;
        });
        handCardRemovedIndex = -1;
    }

    panel.innerHTML = '';

    // VÃ©rifier si Hyrule peut rÃ©duire le coÃ»t du 2Ã¨me sort
    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1;

    hand.forEach((card, i) => {
        // Calculer le coÃ»t effectif pour les sorts avec Hyrule
        let effectiveCost = card.cost;
        let hasDiscount = false;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
            hasDiscount = true;
        }

        const el = makeCard(card, true, hasDiscount ? effectiveCost : null);
        el.dataset.idx = i;
        el.dataset.cost = effectiveCost;

        // Marquer comme jouable si : assez de mana + phase planning + pas encore validÃ© le tour
        if (effectiveCost <= energy && canPlay()) {
            el.classList.add('playable');
        }

        // Retirer playable si aucun slot libre sur le board (crÃ©atures et piÃ¨ges)
        if ((card.type === 'creature' || card.type === 'trap') && getValidSlots(card).length === 0) {
            el.classList.remove('playable');
        }

        // Z-index incrÃ©mental pour Ã©viter les saccades au hover
        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente
        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i)) {
            el.style.visibility = 'hidden';
        }

        // VÃ©rifier les conditions d'invocation spÃ©ciales (ex: Kraken Colossal)
        let cantSummon = false;
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }

        // Custom drag
        const tooExpensive = effectiveCost > energy || cantSummon;
        CustomDrag.makeDraggable(el, {
            source: 'hand',
            card: card,
            idx: i,
            effectiveCost: effectiveCost,
            tooExpensive: tooExpensive
        });

        // Preview au survol
        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onmouseleave = hideCardPreview;

        // Clic gauche = zoom sur la carte
        el.onclick = (e) => {
            e.stopPropagation();
            showCardZoom(card);
        };

        panel.appendChild(el);
    });

    // Sorts engagÃ©s : afficher les sorts jouÃ©s (grisÃ©s avec numÃ©ro d'ordre)
    committedSpells.forEach((cs, csIdx) => {
        const el = makeCard(cs.card, false);
        el.classList.add('committed-spell');
        el.dataset.commitId = cs.commitId;
        el.dataset.order = cs.order;
        el.style.zIndex = hand.length + csIdx + 1;

        el.onmouseenter = (e) => {
            showCardPreview(cs.card, e);
            highlightCommittedSpellTargets(cs);
        };
        el.onmouseleave = () => {
            hideCardPreview();
            clearCommittedSpellHighlights();
        };
        el.onclick = (e) => {
            e.stopPropagation();
            showCardZoom(cs.card);
        };

        panel.appendChild(el);
    });

    // Bounce : cacher la derniÃ¨re carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'me') {
        const allCards = panel.querySelectorAll('.card');
        checkPendingBounce('me', allCards);
    }

    // FLIP step 2 : animer les cartes restantes de l'ancienne position vers la nouvelle
    if (oldPositions && Object.keys(oldPositions).length > 0) {
        const newCards = panel.querySelectorAll('.card:not(.committed-spell)');
        const newCommitted = panel.querySelectorAll('.committed-spell');
        const toAnimate = [];

        // Batch : poser tous les transforms d'un coup (sans transition)
        // Cartes normales
        newCards.forEach(card => {
            const idx = parseInt(card.dataset.idx);
            if (oldPositions[idx] !== undefined) {
                const dx = oldPositions[idx] - card.getBoundingClientRect().left;
                if (Math.abs(dx) > 1) {
                    card.style.transition = 'none';
                    card.style.transform = `translateX(${dx}px)`;
                    toAnimate.push(card);
                }
            }
        });
        // Sorts engagÃ©s (par commitId)
        if (oldCommittedPositions) {
            newCommitted.forEach(card => {
                const commitId = card.dataset.commitId;
                if (oldCommittedPositions[commitId] !== undefined) {
                    const dx = oldCommittedPositions[commitId] - card.getBoundingClientRect().left;
                    if (Math.abs(dx) > 1) {
                        card.style.transition = 'none';
                        card.style.transform = `translateX(${dx}px)`;
                        toAnimate.push(card);
                    }
                }
            });
        }

        if (toAnimate.length > 0) {
            // Un seul reflow pour tout le batch
            panel.getBoundingClientRect();
            // Double rAF : garantit que le navigateur peint l'ancienne position
            // avant de lancer la transition vers la nouvelle
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    toAnimate.forEach(card => {
                        card.style.transition = 'transform 0.25s ease-out';
                        card.style.transform = '';
                    });
                    setTimeout(() => {
                        toAnimate.forEach(card => { card.style.transition = ''; });
                    }, 270);
                });
            });
        }
    }
}

function highlightCommittedSpellTargets(cs) {
    clearCommittedSpellHighlights();
    if (cs.targetType === 'hero') {
        const heroOwner = cs.targetPlayer === myNum ? 'me' : 'opp';
        const heroEl = document.getElementById(`hero-${heroOwner}`);
        if (heroEl) heroEl.classList.add('committed-target-highlight');
    } else if (cs.targetType === 'global') {
        const targetSide = cs.card.pattern === 'all' ? null : 'opp';
        document.querySelectorAll('.card-slot').forEach(slot => {
            if (!targetSide || slot.dataset.owner === targetSide) {
                slot.classList.add('cross-target');
                const card = slot.querySelector('.card');
                if (card) card.classList.add('spell-hover-target');
            }
        });
    } else if (cs.targetType === 'field') {
        const owner = cs.targetPlayer === myNum ? 'me' : 'opp';
        if (cs.card.pattern === 'cross') {
            previewCrossTargets(owner, cs.row, cs.col);
        } else {
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${cs.row}"][data-col="${cs.col}"]`);
            if (slot) {
                slot.classList.add('cross-target');
                const card = slot.querySelector('.card');
                if (card) card.classList.add('spell-hover-target');
            }
        }
    }
}

function clearCommittedSpellHighlights() {
    document.querySelectorAll('.committed-target-highlight').forEach(el => {
        el.classList.remove('committed-target-highlight');
    });
    document.querySelectorAll('.card-slot.cross-target').forEach(s => {
        s.classList.remove('cross-target');
        const card = s.querySelector('.card');
        if (card) card.classList.remove('spell-hover-target');
    });
}

function createOppHandCard(revealedCard) {
    if (revealedCard) {
        // Carte rÃ©vÃ©lÃ©e : utiliser makeCard pour le design complet
        const el = makeCard(revealedCard, true);
        el.classList.add('opp-card-back', 'opp-revealed');
        el.onmouseenter = (e) => showCardPreview(revealedCard, e);
        el.onmouseleave = hideCardPreview;
        el.onclick = (e) => { e.stopPropagation(); showCardZoom(revealedCard); };
        return el;
    } else {
        // Carte cachÃ©e : dos de carte standard
        const el = document.createElement('div');
        el.className = 'opp-card-back';
        el.onmouseenter = () => showCardBackPreview();
        el.onmouseleave = hideCardPreview;
        return el;
    }
}

function renderOppHand(count, oppHand) {
    const panel = document.getElementById('opp-hand');
    const oldCards = panel.querySelectorAll('.opp-card-back');
    const oldCount = oldCards.length;
    const drawActive = typeof GameAnimations !== 'undefined' && GameAnimations.hasActiveDrawAnimation('opp');

    // --- Mode incrÃ©mental : ne PAS dÃ©truire le DOM pendant une animation de pioche ---
    if (drawActive && count >= oldCount) {
        // Remappe les indices de pioche opp vers les nouvelles cartes en fin de main
        // Le serveur renvoie un handIndex interne, mais cÃ´tÃ© DOM toutes les cartes adverses
        // sont des dos identiques â€” on anime toujours la nouvelle carte Ã  la fin
        if (count > oldCount) {
            GameAnimations.remapOppDrawIndices(oldCount);
        }
        // Cartes existantes :
        // - Si la main grandit (count > oldCount) : garder visibles (la nouvelle carte Ã  la fin sera cachÃ©e)
        // - Si mÃªme taille (count == oldCount) : cacher la carte ciblÃ©e par l'animation pending
        for (let i = 0; i < oldCount; i++) {
            if (count === oldCount) {
                const shouldHide = GameAnimations.shouldHideCard('opp', i);
                oldCards[i].style.visibility = shouldHide ? 'hidden' : '';
            } else {
                oldCards[i].style.visibility = '';
            }
        }
        // Ajouter les nouvelles cartes (si le count a augmentÃ©)
        for (let i = oldCount; i < Math.min(count, 12); i++) {
            const revealedCard = oppHand && oppHand[i];
            const el = createOppHandCard(revealedCard);
            el.style.zIndex = i + 1;
            const shouldHide = GameAnimations.shouldHideCard('opp', i);
            if (shouldHide) {
                el.style.visibility = 'hidden';
            }
            panel.appendChild(el);
        }
        // Bounce check
        if (pendingBounce && pendingBounce.owner === 'opp') {
            const allCards = panel.querySelectorAll('.opp-card-back');
            checkPendingBounce('opp', allCards);
        }
        return;
    }

    // --- Mode normal : rebuild complet ---
    // FLIP : sauvegarder les positions avant de reconstruire
    const oldRects = Array.from(oldCards).map(c => c.getBoundingClientRect());

    panel.innerHTML = '';

    for (let i = 0; i < Math.min(count, 12); i++) {
        const revealedCard = oppHand && oppHand[i];
        const el = createOppHandCard(revealedCard);
        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente
        const shouldHide = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i);
        if (shouldHide) {
            el.style.visibility = 'hidden';
        }

        panel.appendChild(el);
    }

    // Animation glissante si la main a rÃ©trÃ©ci
    if (count < oldCount && oldCount > 0) {
        const newCards = panel.querySelectorAll('.opp-card-back');
        newCards.forEach((card, i) => {
            if (i < oldRects.length) {
                const newRect = card.getBoundingClientRect();
                const dx = oldRects[i].left - newRect.left;
                if (Math.abs(dx) > 1) {
                    card.style.transition = 'none';
                    card.style.transform = `translateX(${dx}px)`;
                    requestAnimationFrame(() => {
                        card.style.transition = 'transform 0.3s ease-out';
                        card.style.transform = '';
                        setTimeout(() => { card.style.transition = ''; }, 350);
                    });
                }
            }
        });
    }

    // Bounce : cacher la derniÃ¨re carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'opp') {
        const allCards = panel.querySelectorAll('.opp-card-back');
        checkPendingBounce('opp', allCards);
    }
}

function makeCard(card, inHand, discountedCost = null) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    // Synchroniser l'animation de bordure rotative (Ã©vite le redÃ©marrage au re-render)
    el.style.setProperty('--anim-offset', `${(performance.now() / 1000) % 6}s`);

    if (!inHand && card.type === 'creature') {
        if (card.turnsOnField === 0 && !card.abilities?.includes('haste')) el.classList.add('just-played');
        if (card.canAttack) el.classList.add('can-attack');
    }

    const hp = card.currentHp ?? card.hp;

    // CoÃ»t affichÃ© (rÃ©duit si Hyrule actif)
    const displayCost = discountedCost !== null ? discountedCost : card.cost;
    const costClass = discountedCost !== null ? 'discounted' : '';

    // Classes pour les stats (comparaison avec les stats de BASE)
    // boosted = supÃ©rieur Ã  la base (vert), reduced = infÃ©rieur Ã  la base (rouge)
    let hpClass = '';
    let atkClass = '';
    if (card.type === 'creature') {
        const baseHp = card.baseHp ?? card.hp; // Si pas de baseHp, utiliser hp comme rÃ©fÃ©rence
        const baseAtk = card.baseAtk ?? card.atk; // Si pas de baseAtk, utiliser atk comme rÃ©fÃ©rence

        // HP: comparer currentHp avec baseHp
        if (hp > baseHp) {
            hpClass = 'boosted';
        } else if (hp < baseHp) {
            hpClass = 'reduced';
        }

        // ATK: comparer atk avec baseAtk
        if (card.atk > baseAtk) {
            atkClass = 'boosted';
        } else if (card.atk < baseAtk) {
            atkClass = 'reduced';
        }
    }

    // Carte style Arena (Magic Arena) : pilule stats en bas Ã  droite, mana en rond bleu
    if (card.arenaStyle && card.image) {
        el.classList.add('arena-style');
        if (card.faction) {
            el.classList.add(`faction-${card.faction}`);
        }
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // CapacitÃ©s communes (sans shooter/fly car dÃ©jÃ  dans le type)
        const commonAbilityNames = {
            haste: 'CÃ©lÃ©ritÃ©', intangible: 'Intangible',
            trample: 'PiÃ©tinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'RÃ©gÃ©nÃ©ration',
            protection: 'Protection'
        };
        // Filtrer shooter et fly des capacitÃ©s affichÃ©es
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
                if (a === 'regeneration') return `RÃ©gÃ©nÃ©ration ${card.regenerationX || ''}`.trim();
                return commonAbilityNames[a] || a;
            });
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'MÃªlÃ©e';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        // Type de crÃ©ature (mort-vivant, humain, dragon...)
        const creatureTypeNames = {
            undead: 'Mort-vivant',
            human: 'Humain',
            goblin: 'Gobelin',
            demon: 'DÃ©mon',
            elemental: 'Ã‰lÃ©mentaire',
            beast: 'BÃªte',
            spirit: 'Esprit',
            dragon: 'Dragon',
            serpent: 'Serpent',
            monstrosity: 'MonstruositÃ©',
            ogre: 'Ogre'
        };
        const creatureTypeName = card.creatureType ? creatureTypeNames[card.creatureType] : null;

        // CapacitÃ© spÃ©ciale/unique si prÃ©sente
        let specialAbility = '';
        if (card.description) {
            specialAbility = card.description;
        } else {
            if (card.onHeroHit === 'draw') {
                specialAbility = 'Quand cette crÃ©ature attaque le hÃ©ros adverse, piochez une carte.';
            }
            if (card.onDeath?.damageHero) {
                specialAbility = `Ã€ la mort de cette crÃ©ature, le hÃ©ros adverse subit ${card.onDeath.damageHero} blessures.`;
            }
        }

        // Diamant de raretÃ© basÃ© sur l'Ã©dition
        const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
        const rarityClass = rarityMap[card.edition] || 'common';
        const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;

        // Ligne de type complÃ¨te
        let typeLineText = `CrÃ©ature - ${combatTypeText}`;
        if (creatureTypeName) {
            typeLineText += ` - ${creatureTypeName}`;
        }

        // Style du titre (couleur personnalisÃ©e si dÃ©finie)
        const titleStyle = card.titleColor ? `style="background: ${card.titleColor}"` : '';

        // Les sorts et piÃ¨ges n'ont pas de stats
        const isSpell = card.type === 'spell';
        const isTrap = card.type === 'trap';
        const noStats = isSpell || isTrap;

        // Version allÃ©gÃ©e sur le terrain
        if (!inHand) {
            el.classList.add('on-field');
            if (noStats) {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>`;
            } else {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>
                    <div class="arena-stats"><span class="arena-atk ${atkClass}">${card.atk}</span>/<span class="arena-hp ${hpClass}">${hp}</span></div>`;
            }
            return el;
        }

        // Version complÃ¨te (main, hover, cimetiÃ¨re)
        if (noStats) {
            const typeName = isTrap ? 'PiÃ¨ge' : 'Sort';
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeName}</div>
                    ${card.description ? `<div class="arena-special">${card.description}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>`;
        } else {
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeLineText}</div>
                    ${abilitiesText ? `<div class="arena-abilities">${abilitiesText}</div>` : ''}
                    ${specialAbility ? `<div class="arena-special">${specialAbility}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>
                <div class="arena-stats ${atkClass || hpClass ? 'modified' : ''}"><span class="arena-atk ${atkClass}">${card.atk}</span>/<span class="arena-hp ${hpClass}">${hp}</span></div>`;
        }
        return el;
    }

    // Carte fullArt : image plein fond + ronds colorÃ©s style hÃ©ros
    if (card.fullArt && card.image) {
        el.classList.add('full-art');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // Version allÃ©gÃ©e sur le terrain (sans zone de texte type/capacitÃ©s, sans mana)
        if (!inHand) {
            el.classList.add('on-field');
            el.innerHTML = `
                <div class="fa-title"><div class="fa-name">${card.name}</div></div>
                <div class="fa-atk ${atkClass}">${card.atk}</div>
                <div class="fa-hp ${hpClass}">${hp}</div>`;
            return el;
        }

        // Version complÃ¨te (main, hover, cimetiÃ¨re)
        // CapacitÃ©s communes (sans shooter/fly car dÃ©jÃ  dans le type)
        const commonAbilityNames = {
            haste: 'CÃ©lÃ©ritÃ©', intangible: 'Intangible',
            trample: 'PiÃ©tinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'RÃ©gÃ©nÃ©ration',
            protection: 'Protection'
        };
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
                if (a === 'regeneration') return `RÃ©gÃ©nÃ©ration ${card.regenerationX || ''}`.trim();
                return commonAbilityNames[a] || a;
            });
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'MÃªlÃ©e';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="fa-mana">${card.cost}</div>
            <div class="fa-title"><div class="fa-name">${card.name}</div></div>
            <div class="fa-text-zone">
                <div class="fa-type">CrÃ©ature - ${combatTypeText}</div>
                ${abilitiesText ? `<div class="fa-abilities">${abilitiesText}</div>` : ''}
            </div>
            <div class="fa-atk ${atkClass}">${card.atk}</div>
            <div class="fa-hp ${hpClass}">${hp}</div>`;
        return el;
    }

    // Si la carte a une image (systÃ¨me template avec texte positionnÃ©)
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'CÃ©lÃ©ritÃ©', intangible: 'Intangible',
            trample: 'PiÃ©tinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'RÃ©gÃ©nÃ©ration',
            protection: 'Protection'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `RÃ©gÃ©nÃ©ration ${card.regenerationX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'MÃªlÃ©e';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost ${costClass}">${displayCost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">CrÃ©ature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk ${atkClass}">${card.atk}</div>
            <div class="img-hp ${hpClass}">${hp}</div>`;
        return el;
    }

    // SystÃ¨me classique avec emojis
    const icons = {
        fly: 'ðŸ¦…',
        shooter: 'ðŸŽ¯',
        haste: 'âš¡',
        intangible: 'ðŸ‘»',
        trample: 'ðŸ¦',
        power: 'ðŸ’ª',
        cleave: 'â›ï¸',
        immovable: 'ðŸª¨',
        regeneration: 'ðŸ’š',
        protection: 'ðŸ›¡ï¸'
    };
    const abilities = (card.abilities || []).map(a => icons[a] || '').join(' ');

    // Type icon for spells and traps
    let typeIcon = '';
    if (card.type === 'spell') {
        typeIcon = `<div class="card-type-icon spell-icon">âœ¨</div>`;
    } else if (card.type === 'trap') {
        typeIcon = `<div class="card-type-icon trap-icon">ðŸª¤</div>`;
    }

    // Pattern info for spells
    let patternInfo = '';
    if (card.pattern === 'cross') {
        patternInfo = '<div style="font-size:0.5em;color:#ff9800;">âœï¸ Zone</div>';
    } else if (card.pattern === 'global' || card.pattern === 'all') {
        patternInfo = '<div style="font-size:0.5em;color:#3498db;">ðŸŒ Global</div>';
    } else if (card.pattern === 'hero') {
        patternInfo = '<div style="font-size:0.5em;color:#e74c3c;">ðŸŽ¯ HÃ©ros</div>';
    }

    el.innerHTML = `
        <div class="card-cost ${costClass}">${displayCost}</div>
        ${typeIcon}
        <div class="card-art">${card.icon || 'â“'}</div>
        <div class="card-body">
            <div class="card-name">${card.name}</div>
            <div class="card-abilities">${abilities || (card.type === 'spell' ? (card.offensive ? 'âš”ï¸' : 'ðŸ’š') : '')}${patternInfo}</div>
            <div class="card-stats">
                ${card.atk !== undefined ? `<span class="stat stat-atk ${atkClass}">${card.atk}</span>` : ''}
                ${card.damage ? `<span class="stat stat-atk">${card.damage}</span>` : ''}
                ${card.heal ? `<span class="stat stat-hp">${card.heal}</span>` : ''}
                ${card.type === 'creature' ? `<span class="stat stat-hp ${hpClass}">${hp}</span>` : ''}
            </div>
        </div>`;
    return el;
}