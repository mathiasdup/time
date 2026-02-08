// ==================== RENDU DU JEU ====================
// Render principal, champ de bataille, main, cartes, preview, cimetière
function render() {
    if (!state) return;
    const me = state.me, opp = state.opponent;

    // Ne pas mettre à jour les HP si une animation zdejebel/trample est en cours ou en attente
    // Ces animations gèrent elles-mêmes l'affichage des HP
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
    // Mettre à jour les tooltips du deck
    const meDeckTooltip = document.getElementById('me-deck-tooltip');
    const oppDeckTooltip = document.getElementById('opp-deck-tooltip');
    if (meDeckTooltip) meDeckTooltip.textContent = me.deckCount + (me.deckCount > 1 ? ' cartes' : ' carte');
    if (oppDeckTooltip) oppDeckTooltip.textContent = opp.deckCount + (opp.deckCount > 1 ? ' cartes' : ' carte');
    // Mettre à jour les tooltips du cimetière
    const meGraveCount = me.graveyardCount || 0;
    const oppGraveCount = opp.graveyardCount || 0;
    const meGraveTooltip = document.getElementById('me-grave-tooltip');
    const oppGraveTooltip = document.getElementById('opp-grave-tooltip');
    if (meGraveTooltip) meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
    if (oppGraveTooltip) oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');
    
    // Afficher/cacher le contenu du deck selon le nombre de cartes
    updateDeckDisplay('me', me.deckCount);
    updateDeckDisplay('opp', opp.deckCount);
    
    // Afficher la dernière carte du cimetière
    updateGraveTopCard('me', me.graveyard);
    updateGraveTopCard('opp', opp.graveyard);
    
    // Mettre à jour l'affichage de la pile du cimetière
    updateGraveDisplay('me', me.graveyard);
    updateGraveDisplay('opp', opp.graveyard);
    
    const activeShieldKeys = new Set();
    renderField('me', me.field, activeShieldKeys);
    renderField('opp', opp.field, activeShieldKeys);
    CombatVFX.syncShields(activeShieldKeys);
    renderTraps();
    renderHand(me.hand, me.energy);

    renderOppHand(opp.handCount, opp.oppHand);

    // Lancer les animations de pioche après les renders
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
    
    // Gérer l'état vide
    if (deckCount <= 0) {
        stack.classList.add('empty');
    } else {
        stack.classList.remove('empty');
    }
    
    // Ajuster le nombre de couches visibles selon le nombre de cartes
    // CSS inversé : nth-child(1) = fond (décalé), nth-child(5) = dessus (pas de décalage)
    // Quand le deck diminue, on masque les couches du DESSUS (index élevés dans le DOM)
    const layers = stack.querySelectorAll('.deck-card-layer');
    const totalLayers = layers.length;
    const visibleLayers = Math.min(totalLayers, Math.ceil(deckCount / 8)); // 1 couche par 8 cartes

    // Variable CSS pour l'ombre proportionnelle au nombre de couches
    stack.style.setProperty('--stack-layers', visibleLayers);

    // Garder les premières couches (fond), masquer les dernières (dessus)
    layers.forEach((layer, i) => {
        if (i < visibleLayers) {
            layer.style.display = 'block';
        } else {
            layer.style.display = 'none';
        }
    });
}

// Bloquer le render du cimetière pendant les animations (compteur pour supporter plusieurs animations simultanées)
const _graveBlockCount = { me: 0, opp: 0 };
const graveRenderBlocked = {
    add(owner) { _graveBlockCount[owner] = (_graveBlockCount[owner] || 0) + 1; },
    delete(owner) { _graveBlockCount[owner] = Math.max(0, (_graveBlockCount[owner] || 0) - 1); },
    has(owner) { return (_graveBlockCount[owner] || 0) > 0; },
    clear() { _graveBlockCount.me = 0; _graveBlockCount.opp = 0; }
};
const pendingSpellReturns = new Set(); // UIDs de sorts qui retournent en main (pas au cimetière)

function updateGraveDisplay(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) return;
    const stack = document.getElementById(`${owner}-grave-stack`);
    if (!stack) return;

    const count = graveyard ? graveyard.length : 0;

    stack.classList.toggle('has-cards', count > 0);

    // Nombre de couches visibles proportionnel au nombre de cartes (comme le deck)
    // 1 carte = 0 couches (juste la top card), puis 1 couche par ~6 cartes, max 3
    const layers = stack.querySelectorAll('.grave-card-layer');
    const visibleLayers = count <= 1 ? 0 : Math.min(layers.length, Math.ceil(count / 6));

    // Variable CSS pour l'ombre proportionnelle au nombre de couches
    stack.style.setProperty('--stack-layers', visibleLayers);

    // Remplir les layers avec de vraies cartes, afficher/masquer selon le count
    // Les dernières couches (proches du dessus) sont affichées en premier
    layers.forEach((layer, i) => {
        const show = i >= layers.length - visibleLayers;
        layer.style.display = show ? 'block' : 'none';

        // Layer 0 (nth-child(1), bottom, most offset): graveyard[count-4]
        // Layer 1 (nth-child(2), middle):              graveyard[count-3]
        // Layer 2 (nth-child(3), top layer):           graveyard[count-2]
        const cardIndex = count - (3 - i) - 1;
        const card = (cardIndex >= 0 && graveyard) ? graveyard[cardIndex] : null;
        const cardId = card ? (card.uid || card.id) : '';

        // Cache: ne re-render que si la carte a changé
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
        cardEl.classList.remove('just-played', 'can-attack');
        cardEl.classList.add('grave-card', 'in-graveyard');
        container.appendChild(cardEl);
        const nameEl = cardEl.querySelector('.arena-name');
        if (nameEl) fitArenaName(nameEl);
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
                // DEBUG: log si ce slot bloqué contient une carte pétrifiée dans le state
                const blockedCard = (owner === 'me' ? state?.me?.field : state?.opponent?.field)?.[r]?.[c];
                if (blockedCard && (blockedCard.petrified || blockedCard.melodyLocked)) {
                    console.log(`[RENDER BLOQUÉ] Slot ${slotKey} bloqué par animatingSlots ! Card: ${blockedCard.name}, petrified=${blockedCard.petrified}, melodyLocked=${blockedCard.melodyLocked}`);
                }
                continue;
            }

            const hadCard = slot.classList.contains('has-card');
            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));

            slot.classList.remove('has-card');
            slot.classList.remove('has-flying');
            const card = field[r][c];

            // DEBUG sacrifice : log quand une carte apparaît/disparaît d'un slot
            if (!hadCard && card) {
                console.log(`[RENDER] Carte APPARAÎT dans slot ${slotKey}: ${card.name} (animatingSlots: [${[...animatingSlots]}])`);
            }
            if (hadCard && !card) {
                console.log(`[RENDER] Carte DISPARAÎT du slot ${slotKey} (animatingSlots: [${[...animatingSlots]}])`);
            }

            if (card) {
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);

                // Ajouter l'effet de lévitation pour les créatures volantes
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    cardEl.classList.add('flying-creature');
                    slot.classList.add('has-flying');
                    // Démarrer l'animation de lévitation continue
                    startFlyingAnimation(cardEl);
                } else {
                    slot.classList.remove('has-flying');
                }

                // Indicateur de bouclier (Protection) — PixiJS honeycomb
                if (card.hasProtection) {
                    CombatVFX.registerShield(slotKey, cardEl);
                    if (activeShieldKeys) activeShieldKeys.add(slotKey);
                }

                // Hover preview pour voir la carte en grand
                cardEl.onmouseenter = (e) => showCardPreview(card, e);
                cardEl.onmouseleave = hideCardPreview;
                cardEl.onmousemove = (e) => moveCardPreview(e);

                // Custom drag pour redéploiement (seulement mes cartes)
                if (owner === 'me' && !state.me.inDeployPhase && !card.movedThisTurn && !card.melodyLocked && !card.petrified) {
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

                // Auto-fit du nom : réduire le font-size si le texte déborde
                const nameEl = cardEl.querySelector('.arena-name');
                if (nameEl) fitArenaName(nameEl);
            }
        }
    }
}

// Auto-fit : réduit le font-size d'un .arena-name jusqu'à ce que le texte tienne
function fitArenaName(el) {
    const parent = el.parentElement; // .arena-title
    if (!parent) return;
    const maxW = parent.clientWidth;
    if (maxW === 0) {
        // Parent pas encore layouté (ex: display:none) → réessayer au prochain frame
        requestAnimationFrame(() => fitArenaName(el));
        return;
    }
    // Reset
    el.style.fontSize = '';
    // Forcer overflow visible + largeur naturelle pour mesurer le vrai texte
    el.style.overflow = 'visible';
    el.style.width = 'max-content';
    const textW = el.offsetWidth;
    if (textW <= maxW) {
        el.style.overflow = '';
        el.style.width = '';
        return;
    }
    // Calculer le ratio puis ajuster en une passe + vérification
    const originalSize = parseFloat(getComputedStyle(el).fontSize);
    const ratio = maxW / textW;
    let size = Math.floor(originalSize * ratio * 10) / 10; // Arrondi vers le bas au 0.1px
    const minSize = originalSize * 0.35;
    if (size < minSize) size = minSize;
    el.style.fontSize = size + 'px';
    // Vérification : si ça déborde encore, réduire pas à pas
    while (el.offsetWidth > maxW && size > minSize) {
        size -= 0.3;
        el.style.fontSize = size + 'px';
    }
    // Restaurer le CSS normal
    el.style.overflow = '';
    el.style.width = '';
}

// Auto-fit : planifie un fitArenaName sur le nom d'un élément carte
// Utilise requestAnimationFrame pour que ça marche même si l'élément n'est pas encore dans le DOM
function autoFitCardName(el) {
    requestAnimationFrame(() => {
        const nameEl = el.querySelector('.arena-name') || el.querySelector('.fa-name') || el.querySelector('.img-name') || el.querySelector('.card-name');
        if (nameEl) fitArenaName(nameEl);
    });
}

// Preview flottante d'une carte
let previewEl = null;
// Descriptions des capacités
const ABILITY_DESCRIPTIONS = {
    fly: { name: 'Vol', desc: 'Cette créature peut attaquer n\'importe quel emplacement adverse, pas seulement celui en face.' },
    shooter: { name: 'Tireur', desc: 'Cette créature peut attaquer à distance sans recevoir de riposte.' },
    haste: { name: 'Célérité', desc: 'Cette créature peut attaquer dès le tour où elle est invoquée.' },
    intangible: { name: 'Intangible', desc: 'Cette créature ne peut pas être ciblée par les sorts ou les pièges.' },
    trample: { name: 'Piétinement', desc: 'Les dégâts excédentaires sont infligés au héros adverse.' },

    power: { name: 'Puissance', desc: 'Quand cette créature subit des dégâts sans mourir, elle gagne +X ATK (X = valeur de Puissance).' },
    cleave: { name: 'Clivant', desc: 'Quand cette créature attaque, elle inflige X dégâts aux créatures sur les lignes adjacentes. Ces créatures ne ripostent pas.' },
    immovable: { name: 'Immobile', desc: 'Cette créature ne peut pas se déplacer.' },
    regeneration: { name: 'Régénération', desc: 'En fin de tour, cette créature récupère X PV (sans dépasser ses PV max).' },
    protection: { name: 'Protection', desc: 'Cette créature est protégée contre la prochaine source de dégâts qu\'elle subirait. Le bouclier est consommé après avoir bloqué une source.' },
    spellBoost: { name: 'Sort renforcé', desc: 'Tant que cette créature est en jeu, vos sorts infligent +X dégâts supplémentaires.' },
    enhance: { name: 'Amélioration', desc: 'Les créatures adjacentes (haut, bas, côté) gagnent +X en attaque tant que cette créature est en jeu.' },
    bloodthirst: { name: 'Soif de sang', desc: 'Chaque fois qu\'une créature ennemie meurt, cette créature gagne +X ATK de façon permanente.' },
    melody: { name: 'Mélodie', desc: 'La première créature ennemie en face ne peut ni attaquer ni se déplacer. Après 2 tours, elle se transforme en pierre.' },
    sacrifice: { name: 'Sacrifice', desc: 'À l\'invocation, sacrifie une créature adjacente pouvant attaquer.' },
    camouflage: { name: 'Camouflage', desc: 'Cette créature ne peut pas être ciblée par les attaques ni les sorts. Les attaquants l\'ignorent et frappent derrière. Se dissipe au début du prochain tour.' }
};

function showCardPreview(card, e) {
    hideCardPreview();
    
    // Créer le container
    previewEl = document.createElement('div');
    previewEl.className = 'preview-container card-preview';
    
    // Ajouter la carte (version complète avec tous les détails)
    const cardEl = makeCard(card, true);
    cardEl.classList.add('preview-card');
    previewEl.appendChild(cardEl);

    // Container pour capacités + effets
    const infoContainer = document.createElement('div');
    infoContainer.className = 'preview-info-container';
    
    // Ajouter les capacités si c'est une créature avec des abilities ou sacrifice
    const hasAbilities = card.type === 'creature' && ((card.abilities && card.abilities.length > 0) || card.sacrifice);
    if (hasAbilities) {
        const abilitiesContainer = document.createElement('div');
        abilitiesContainer.className = 'preview-abilities';

        (card.abilities || []).forEach(ability => {
            const abilityInfo = ABILITY_DESCRIPTIONS[ability];
            if (abilityInfo) {
                const abilityEl = document.createElement('div');
                abilityEl.className = 'preview-ability';
                // Type de combat (shooter/fly) en blanc, capacités communes en jaune
                const isTypeAbility = ability === 'shooter' || ability === 'fly';
                abilityEl.innerHTML = `
                    <div class="ability-name ${isTypeAbility ? 'type-ability' : ''}">${abilityInfo.name}</div>
                    <div class="ability-desc">${abilityInfo.desc}</div>
                `;
                abilitiesContainer.appendChild(abilityEl);
            }
        });

        if (card.sacrifice) {
            const abilityInfo = ABILITY_DESCRIPTIONS.sacrifice;
            const abilityEl = document.createElement('div');
            abilityEl.className = 'preview-ability';
            abilityEl.innerHTML = `
                <div class="ability-name">${abilityInfo.name} ${card.sacrifice}</div>
                <div class="ability-desc">${abilityInfo.desc}</div>
            `;
            abilitiesContainer.appendChild(abilityEl);
        }

        infoContainer.appendChild(abilitiesContainer);
    }
    
    // Ajouter les effets appliqués (sorts) si présents
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

    // Auto-fit du nom (après insertion dans le DOM pour mesurer)
    const previewNameEl = cardEl.querySelector('.arena-name');
    if (previewNameEl) fitArenaName(previewNameEl);

    const el = previewEl; // Garder une référence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function showCardBackPreview() {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'card-back-preview card-preview';
    document.body.appendChild(previewEl);
    const el = previewEl; // Garder une référence locale
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
            <div class="arena-type">Héros</div>
            <div class="arena-special">${hero.ability}</div>
        </div>
        ${rarityDiamond}`;

    autoFitCardName(el);
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
        previewEl.innerHTML = `<div class="hero-preview-name">${hero ? hero.name : 'Héros'}</div>`;
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
    const t = performance.now();
    state.me.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="me"][data-row="${i}"]`);
        if (slot) {
            const trapKey = `me-${i}`;
            const isProtected = animatingTrapSlots.has(trapKey);
            const hasTrapClass = slot.classList.contains('has-trap');
            const hasTriggered = slot.classList.contains('triggered');
            if (isProtected || trap || hasTrapClass) {
                console.log(`[RENDER TRAPS ${t.toFixed(0)}] ${trapKey}: protected=${isProtected}, stateTrap=${!!trap}, hasTrapClass=${hasTrapClass}, triggered=${hasTriggered}, innerHTML=${slot.innerHTML.substring(0,50)}`);
            }
            if (isProtected) {
                if (!trap) {
                    console.log(`[RENDER TRAPS ${t.toFixed(0)}] ${trapKey} LIBÉRÉ (state trap=null)`);
                    animatingTrapSlots.delete(trapKey);
                    // fall through pour nettoyer le slot
                } else {
                    return; // piège encore actif côté serveur, on ne touche pas
                }
            }
            slot.classList.remove('has-trap', 'mine', 'triggered');
            if (trap) {
                slot.classList.add('has-trap', 'mine');
                slot.innerHTML = '<img class="trap-icon-img mine" src="/battlefield_elements/beartraparmed.png" alt="trap">';
                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
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
            const trapKey = `opp-${i}`;
            const isProtected = animatingTrapSlots.has(trapKey);
            const hasTrapClass = slot.classList.contains('has-trap');
            const hasTriggered = slot.classList.contains('triggered');
            if (isProtected || trap || hasTrapClass) {
                console.log(`[RENDER TRAPS ${t.toFixed(0)}] ${trapKey}: protected=${isProtected}, stateTrap=${!!trap}, hasTrapClass=${hasTrapClass}, triggered=${hasTriggered}, innerHTML=${slot.innerHTML.substring(0,50)}`);
            }
            if (isProtected) {
                if (!trap) {
                    console.log(`[RENDER TRAPS ${t.toFixed(0)}] ${trapKey} LIBÉRÉ (state trap=null)`);
                    animatingTrapSlots.delete(trapKey);
                    // fall through pour nettoyer le slot
                } else {
                    return;
                }
            }
            slot.classList.remove('has-trap', 'mine', 'triggered');
            if (trap) {
                slot.classList.add('has-trap');
                slot.innerHTML = '<img class="trap-icon-img enemy" src="/battlefield_elements/beartraparmed.png" alt="trap">';
            } else {
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
        // Sorts engagés (par commitId)
        const oldCommitted = panel.querySelectorAll('.committed-spell');
        oldCommitted.forEach(card => {
            const commitId = card.dataset.commitId;
            oldCommittedPositions[commitId] = card.getBoundingClientRect().left;
        });
        handCardRemovedIndex = -1;
    }

    panel.innerHTML = '';

    // Vérifier si Hyrule peut réduire le coût du 2ème sort
    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1;

    hand.forEach((card, i) => {
        // Calculer le coût effectif pour les sorts avec Hyrule
        let effectiveCost = card.cost;
        let hasDiscount = false;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
            hasDiscount = true;
        }

        const el = makeCard(card, true, hasDiscount ? effectiveCost : null);
        el.dataset.idx = i;
        el.dataset.cost = effectiveCost;

        // Marquer comme jouable si : assez de mana + phase planning + pas encore validé le tour
        if (effectiveCost <= energy && canPlay()) {
            el.classList.add('playable');
        }

        // Retirer playable si aucun slot libre sur le board (créatures et pièges)
        if ((card.type === 'creature' || card.type === 'trap') && getValidSlots(card).length === 0) {
            el.classList.remove('playable');
        }

        // Z-index incrémental pour éviter les saccades au hover
        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente
        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i)) {
            el.style.visibility = 'hidden';
        }

        // Vérifier les conditions d'invocation spéciales (ex: Kraken Colossal)
        let cantSummon = false;
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }
        // Réanimation : nécessite au moins 1 créature non-engagée au cimetière
        if (card.requiresGraveyardCreature) {
            const availableCreatures = (state.me.graveyard || []).filter(c =>
                c.type === 'creature' && !committedGraveyardUids.includes(c.uid || c.id)
            );
            if (availableCreatures.length === 0) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }
        // Sacrifice : nécessite au moins 1 slot vide adjacent à une créature sacrifiable
        if (card.sacrifice) {
            const validSlots = getValidSlots(card);
            if (validSlots.length === 0) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }
        // Sort ciblant une créature alliée : nécessite au moins 1 créature sur le terrain
        if (card.targetSelfCreature) {
            const hasCreature = state.me.field.some(row => row.some(c => c !== null));
            if (!hasCreature) {
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

        // Auto-fit du nom après insertion DOM
        const nameEl = el.querySelector('.arena-name');
        if (nameEl) fitArenaName(nameEl);
    });

    // Sorts engagés : afficher les sorts joués (grisés avec numéro d'ordre)
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

    // Bounce : cacher la dernière carte si un bounce est en attente
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
        // Sorts engagés (par commitId)
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
        // Carte révélée : utiliser makeCard pour le design complet
        const el = makeCard(revealedCard, true);
        el.classList.add('opp-card-back', 'opp-revealed');
        if (revealedCard.uid) el.dataset.uid = revealedCard.uid;
        el.onmouseenter = (e) => showCardPreview(revealedCard, e);
        el.onmouseleave = hideCardPreview;
        el.onclick = (e) => { e.stopPropagation(); showCardZoom(revealedCard); };
        return el;
    } else {
        // Carte cachée : dos de carte standard
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

    const cacheSize = typeof savedRevealedCardRects !== 'undefined' ? savedRevealedCardRects.size : 0;
    console.log(`[RENDER OPP HAND] count=${count} oldCount=${oldCount} drawActive=${drawActive} cacheSize=${cacheSize} pending=[${[...pendingDrawAnimations.opp.keys()]}] started=[${[...startedDrawAnimations.opp]}]`);

    // --- Mode freeze : ne PAS toucher au DOM pendant la transition de révélation ---
    // Tant que des cartes revealed sont en attente d'animation et que le count n'a pas changé,
    // on garde la main telle quelle (la carte revealed reste à sa place visuelle)
    if (cacheSize > 0 && count === oldCount) {
        console.log('[RENDER OPP HAND] FREEZE mode - keeping DOM as-is (revealed card waiting for animation)');
        return;
    }

    // --- Mode incrémental : ne PAS détruire le DOM pendant une animation de pioche ---
    if (drawActive && count >= oldCount) {
        if (count > oldCount) {
            GameAnimations.remapOppDrawIndices(oldCount);
        }
        for (let i = 0; i < oldCount; i++) {
            if (count === oldCount) {
                const shouldHide = GameAnimations.shouldHideCard('opp', i);
                oldCards[i].style.visibility = shouldHide ? 'hidden' : '';
            } else {
                oldCards[i].style.visibility = '';
            }
        }
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

        const shouldHide = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i);
        if (shouldHide) {
            el.style.visibility = 'hidden';
        }

        panel.appendChild(el);
    }

    // Animation glissante si la main a rétréci
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

    // Bounce : cacher la dernière carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'opp') {
        const allCards = panel.querySelectorAll('.opp-card-back');
        checkPendingBounce('opp', allCards);
    }
}

function makeCard(card, inHand, discountedCost = null) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    // Synchroniser l'animation de bordure rotative (évite le redémarrage au re-render)
    el.style.setProperty('--anim-offset', `${(performance.now() / 1000) % 6}s`);

    if (!inHand && card.type === 'creature') {
        if (card.turnsOnField === 0 && !card.abilities?.includes('haste')) el.classList.add('just-played');
        if (card.canAttack) el.classList.add('can-attack');
        if (card.melodyLocked) {
            console.log(`[RENDER makeCard] ${card.name} → melody-locked`);
            el.classList.add('melody-locked');
        }
        if (card.petrified) {
            console.log(`[RENDER makeCard] ${card.name} → petrified`);
            el.classList.add('petrified');
        }
    }

    const hp = card.currentHp ?? card.hp;

    // Coût affiché (réduit si Hyrule actif)
    const displayCost = discountedCost !== null ? discountedCost : card.cost;
    const costClass = discountedCost !== null ? 'discounted' : '';

    // Classes pour les stats (comparaison avec les stats de BASE)
    // boosted = supérieur à la base (vert), reduced = inférieur à la base (rouge)
    let hpClass = '';
    let atkClass = '';
    if (card.type === 'creature') {
        const baseHp = card.baseHp ?? card.hp; // Si pas de baseHp, utiliser hp comme référence
        const baseAtk = card.baseAtk ?? card.atk; // Si pas de baseAtk, utiliser atk comme référence

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

    // Carte style Arena (Magic Arena) : pilule stats en bas à droite, mana en rond bleu
    if (card.arenaStyle && card.image) {
        el.classList.add('arena-style');
        if (card.faction) {
            el.classList.add(`faction-${card.faction}`);
        }
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // Capacités communes (sans shooter/fly car déjà dans le type)
        const commonAbilityNames = {
            haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection', spellBoost: 'Sort renforcé', enhance: 'Amélioration', bloodthirst: 'Soif de sang', melody: 'Mélodie', camouflage: 'Camouflage'
        };
        // Filtrer shooter et fly des capacités affichées
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
                if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
                if (a === 'spellBoost') return `Sort renforcé ${card.spellBoostAmount || ''}`.trim();
                if (a === 'enhance') return `Amélioration ${card.enhanceAmount || ''}`.trim();
                if (a === 'bloodthirst') return `Soif de sang ${card.bloodthirstAmount || ''}`.trim();
                return commonAbilityNames[a] || a;
            });
        if (card.sacrifice) {
            commonAbilities.push(`Sacrifice ${card.sacrifice}`);
        }
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        // Type de créature (mort-vivant, humain, dragon...)
        const creatureTypeNames = {
            undead: 'Mort-vivant',
            human: 'Humain',
            goblin: 'Gobelin',
            demon: 'Démon',
            elemental: 'Élémentaire',
            beast: 'Bête',
            spirit: 'Esprit',
            dragon: 'Dragon',
            serpent: 'Serpent',
            monstrosity: 'Monstruosité',
            ogre: 'Ogre'
        };
        const creatureTypeName = card.creatureType ? creatureTypeNames[card.creatureType] : null;

        // Capacité spéciale/unique si présente
        let specialAbility = '';
        if (card.description) {
            specialAbility = card.description;
        } else {
            if (card.onHeroHit === 'draw') {
                specialAbility = 'Quand cette créature attaque le héros adverse, piochez une carte.';
            }
            if (card.onDeath?.damageHero) {
                specialAbility = `À la mort de cette créature, le héros adverse subit ${card.onDeath.damageHero} blessures.`;
            }
        }

        // Diamant de rareté basé sur l'édition
        const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
        const rarityClass = rarityMap[card.edition] || 'common';
        const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;

        // Ligne de type complète
        let typeLineText = `Créature - ${combatTypeText}`;
        if (creatureTypeName) {
            typeLineText += ` - ${creatureTypeName}`;
        }

        // Style du titre (couleur personnalisée si définie)
        const titleStyle = card.titleColor ? `style="background: ${card.titleColor}"` : '';

        // Les sorts et pièges n'ont pas de stats
        const isSpell = card.type === 'spell';
        const isTrap = card.type === 'trap';
        const noStats = isSpell || isTrap;

        // Version allégée sur le terrain
        if (!inHand) {
            el.classList.add('on-field');
            // Jeton compteur de gaze (Medusa)
            const gazeMarker = card.medusaGazeMarker >= 1 ? `<div class="gaze-marker">${card.medusaGazeMarker}</div>` : '';
            const melodyIcon = '';
            if (noStats) {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>
                    ${gazeMarker}${melodyIcon}`;
            } else {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>
                    <div class="arena-stats"><span class="arena-atk ${atkClass}">${card.atk}</span>/<span class="arena-hp ${hpClass}">${hp}</span></div>
                    ${gazeMarker}${melodyIcon}`;
            }
            autoFitCardName(el);
            return el;
        }

        // Version complète (main, hover, cimetière)
        if (noStats) {
            const typeName = isTrap ? 'Piège' : 'Sort';
            // Boost des dégâts de sorts si spellBoost actif
            let spellDescription = card.description || '';
            const spellBoost = (isSpell && card.offensive && card.damage && state?.me?.spellBoost) ? state.me.spellBoost : 0;
            if (spellBoost > 0 && card.damage) {
                const boostedDmg = card.damage + spellBoost;
                spellDescription = spellDescription.replace(
                    new RegExp(`${card.damage}(\\s*(?:blessures?|dégâts?))`, 'g'),
                    `<span class="boosted">${boostedDmg}</span>$1`
                );
            }
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeName}</div>
                    ${spellDescription ? `<div class="arena-special">${spellDescription}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>`;
        } else {
            // Si pétrifié, remplacer capacités et description
            const displayAbilities = card.petrified ? '' : abilitiesText;
            const displaySpecial = card.petrified ? (card.petrifiedDescription || 'Pétrifié — ne peut ni attaquer ni bloquer.') : specialAbility;
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeLineText}</div>
                    ${displayAbilities ? `<div class="arena-abilities">${displayAbilities}</div>` : ''}
                    ${displaySpecial ? `<div class="arena-special">${displaySpecial}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>
                <div class="arena-stats ${atkClass || hpClass ? 'modified' : ''}"><span class="arena-atk ${atkClass}">${card.atk}</span>/<span class="arena-hp ${hpClass}">${hp}</span></div>`;
        }
        autoFitCardName(el);
        return el;
    }

    // Carte fullArt : image plein fond + ronds colorés style héros
    if (card.fullArt && card.image) {
        el.classList.add('full-art');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // Version allégée sur le terrain (sans zone de texte type/capacités, sans mana)
        if (!inHand) {
            el.classList.add('on-field');
            el.innerHTML = `
                <div class="fa-title"><div class="fa-name">${card.name}</div></div>
                <div class="fa-atk ${atkClass}">${card.atk}</div>
                <div class="fa-hp ${hpClass}">${hp}</div>`;
            autoFitCardName(el);
            return el;
        }

        // Version complète (main, hover, cimetière)
        // Capacités communes (sans shooter/fly car déjà dans le type)
        const commonAbilityNames = {
            haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection', spellBoost: 'Sort renforcé', enhance: 'Amélioration', bloodthirst: 'Soif de sang', melody: 'Mélodie', camouflage: 'Camouflage'
        };
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
                if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
                if (a === 'spellBoost') return `Sort renforcé ${card.spellBoostAmount || ''}`.trim();
                if (a === 'enhance') return `Amélioration ${card.enhanceAmount || ''}`.trim();
                if (a === 'bloodthirst') return `Soif de sang ${card.bloodthirstAmount || ''}`.trim();
                return commonAbilityNames[a] || a;
            });
        if (card.sacrifice) {
            commonAbilities.push(`Sacrifice ${card.sacrifice}`);
        }
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="fa-mana">${card.cost}</div>
            <div class="fa-title"><div class="fa-name">${card.name}</div></div>
            <div class="fa-text-zone">
                <div class="fa-type">Créature - ${combatTypeText}</div>
                ${abilitiesText ? `<div class="fa-abilities">${abilitiesText}</div>` : ''}
            </div>
            <div class="fa-atk ${atkClass}">${card.atk}</div>
            <div class="fa-hp ${hpClass}">${hp}</div>`;
        autoFitCardName(el);
        return el;
    }

    // Si la carte a une image (système template avec texte positionné)
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection', spellBoost: 'Sort renforcé', enhance: 'Amélioration', bloodthirst: 'Soif de sang', melody: 'Mélodie', camouflage: 'Camouflage'
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
            <div class="img-cost ${costClass}">${displayCost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">Créature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk ${atkClass}">${card.atk}</div>
            <div class="img-hp ${hpClass}">${hp}</div>`;
        autoFitCardName(el);
        return el;
    }

    // Système classique avec emojis
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
        patternInfo = '<div style="font-size:0.5em;color:#e74c3c;">ðŸŽ¯ Héros</div>';
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
                ${card.damage ? (() => { const sb = (card.type === 'spell' && card.offensive && state?.me?.spellBoost) ? state.me.spellBoost : 0; return `<span class="stat stat-atk ${sb > 0 ? 'boosted' : ''}">${card.damage + sb}</span>`; })() : ''}
                ${card.heal ? `<span class="stat stat-hp">${card.heal}</span>` : ''}
                ${card.type === 'creature' ? `<span class="stat stat-hp ${hpClass}">${hp}</span>` : ''}
            </div>
        </div>`;
    autoFitCardName(el);
    return el;
}