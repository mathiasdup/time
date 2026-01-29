// =============================================
// Rendu de l'interface utilisateur
// =============================================
// Mise à jour des éléments UI (HP, énergie, deck, etc.)

/**
 * Fonction principale de rendu
 */
function render() {
    if (!state) return;
    const me = state.me, opp = state.opponent;

    // HP (sauf si animation zdejebel en cours)
    const hasZdejebelPending = animationQueue.some(a => a.type === 'zdejebel') || zdejebelAnimationInProgress;
    if (!hasZdejebelPending) {
        document.getElementById('me-hp').textContent = me.hp;
        document.getElementById('opp-hp').textContent = opp.hp;
    }

    // Énergie
    document.getElementById('me-energy').textContent = `${me.energy}/${me.maxEnergy}`;
    document.getElementById('opp-energy').textContent = `${opp.energy}/${opp.maxEnergy}`;

    // Deck tooltips
    const meDeckTooltip = document.getElementById('me-deck-tooltip');
    const oppDeckTooltip = document.getElementById('opp-deck-tooltip');
    if (meDeckTooltip) meDeckTooltip.textContent = me.deckCount + (me.deckCount > 1 ? ' cartes' : ' carte');
    if (oppDeckTooltip) oppDeckTooltip.textContent = opp.deckCount + (opp.deckCount > 1 ? ' cartes' : ' carte');

    // Graveyard tooltips
    const meGraveCount = me.graveyardCount || 0;
    const oppGraveCount = opp.graveyardCount || 0;
    const meGraveTooltip = document.getElementById('me-grave-tooltip');
    const oppGraveTooltip = document.getElementById('opp-grave-tooltip');
    if (meGraveTooltip) meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
    if (oppGraveTooltip) oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');

    // Affichage deck
    updateDeckDisplay('me', me.deckCount);
    updateDeckDisplay('opp', opp.deckCount);

    // Dernière carte cimetière
    updateGraveTopCard('me', me.graveyard);
    updateGraveTopCard('opp', opp.graveyard);

    // Pile du cimetière
    updateGraveDisplay('me', me.graveyard);
    updateGraveDisplay('opp', opp.graveyard);

    // Terrain et main
    renderField('me', me.field);
    renderField('opp', opp.field);
    renderTraps();
    renderHand(me.hand, me.energy);
    renderOppHand(opp.handCount);

    // Animations de pioche
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.startPendingDrawAnimations();
    }

    if (me.ready) {
        document.getElementById('end-turn-btn').classList.add('waiting');
    }
}

/**
 * Met à jour l'affichage du deck
 */
function updateDeckDisplay(owner, deckCount) {
    const stack = document.getElementById(`${owner}-deck-stack`);
    if (!stack) return;

    if (deckCount <= 0) {
        stack.classList.add('empty');
    } else {
        stack.classList.remove('empty');
    }

    const layers = stack.querySelectorAll('.deck-card-layer');
    const visibleLayers = Math.min(5, Math.ceil(deckCount / 8));
    const totalLayers = layers.length;

    // Les layers sont visuellement empilés : layer[0] est au-dessus (z-index élevé)
    // et layer[4] est en dessous (z-index bas).
    // On doit cacher les premières couches (du dessus) et garder les dernières (du fond).
    layers.forEach((layer, i) => {
        if (i >= totalLayers - visibleLayers) {
            layer.style.display = 'block';
        } else {
            layer.style.display = 'none';
        }
    });
}

/**
 * Met à jour l'affichage de la pile du cimetière
 */
function updateGraveDisplay(owner, graveyard) {
    const stack = document.getElementById(`${owner}-grave-stack`);
    if (!stack) return;

    // Nombre de cartes à afficher = total - cartes en attente d'animation
    const totalCount = graveyard ? graveyard.length : 0;
    const pendingCount = (typeof pendingGraveyard !== 'undefined' && pendingGraveyard[owner])
        ? pendingGraveyard[owner].count : 0;
    const displayCount = Math.max(0, totalCount - pendingCount);

    const layers = stack.querySelectorAll('.grave-card-layer');
    const totalLayers = layers.length;

    // Nombre de couches à afficher (max 5, une par carte sous le top)
    const visibleLayers = Math.min(totalLayers, Math.max(0, displayCount - 1));

    // Les layers sont visuellement empilés : layer[0] est au-dessus (z-index élevé)
    // et layer[4] est en dessous (z-index bas).
    // On affiche les N dernières couches (du fond) et on cache les premières (du dessus).
    layers.forEach((layer, i) => {
        // Afficher seulement les N dernières couches
        if (i >= totalLayers - visibleLayers) {
            // Calculer l'index de la carte dans le graveyard
            const layerOffset = i - (totalLayers - visibleLayers);
            const graveIndex = displayCount - 2 - layerOffset;

            if (graveIndex >= 0 && graveyard[graveIndex]) {
                const card = graveyard[graveIndex];
                layer.style.display = 'block';

                // Afficher l'image de la carte si disponible
                if (card.image) {
                    layer.style.backgroundImage = `url('/cards/${card.image}')`;
                } else {
                    // Fallback: couleur selon le type
                    if (card.type === 'creature') {
                        layer.style.backgroundImage = 'none';
                        layer.style.background = 'linear-gradient(135deg, #4a3f35, #2d2520)';
                    } else if (card.type === 'spell') {
                        layer.style.backgroundImage = 'none';
                        layer.style.background = 'linear-gradient(135deg, #3f4a5c, #252d38)';
                    } else {
                        layer.style.backgroundImage = 'none';
                        layer.style.background = 'linear-gradient(135deg, rgba(50,50,70,0.95), rgba(30,30,50,0.95))';
                    }
                }
            } else {
                layer.style.display = 'none';
            }
        } else {
            layer.style.display = 'none';
        }
    });
}

/**
 * Met à jour la dernière carte du cimetière
 */
function updateGraveTopCard(owner, graveyard) {
    const container = document.getElementById(`${owner}-grave-top`);
    if (!container) return;

    // Nombre de cartes à afficher = total - cartes en attente d'animation
    const totalCount = graveyard ? graveyard.length : 0;
    const pendingCount = (typeof pendingGraveyard !== 'undefined' && pendingGraveyard[owner])
        ? pendingGraveyard[owner].count : 0;
    const displayCount = Math.max(0, totalCount - pendingCount);

    if (displayCount > 0) {
        // La carte du dessus visible est à l'index displayCount - 1
        const topCard = graveyard[displayCount - 1];
        container.classList.remove('empty');

        // Si la carte a une image, l'afficher en background
        if (topCard.image) {
            container.style.backgroundImage = `url('/cards/${topCard.image}')`;
            container.innerHTML = '';
        } else {
            // Fallback: afficher le mini-card classique
            container.style.backgroundImage = 'none';

            if (topCard.type === 'creature') {
                container.innerHTML = `
                    <div class="mini-card">
                        <div class="card-icon">${topCard.icon || '❓'}</div>
                        <div class="card-name">${topCard.name || 'Inconnu'}</div>
                        <div class="card-stats">
                            <span class="atk">⚔️${topCard.atk}</span>
                            <span class="hp">❤️${topCard.hp}</span>
                        </div>
                    </div>
                `;
            } else if (topCard.type === 'spell') {
                container.innerHTML = `
                    <div class="mini-card">
                        <div class="card-icon">${topCard.icon || '✨'}</div>
                        <div class="card-name">${topCard.name || 'Sort'}</div>
                        <div class="card-stats">
                            <span style="color:#9b59b6;">🔮 Sort</span>
                        </div>
                    </div>
                `;
            } else if (topCard.type === 'trap') {
                container.innerHTML = `
                    <div class="mini-card">
                        <div class="card-icon">${topCard.icon || '⚠️'}</div>
                        <div class="card-name">${topCard.name || 'Piège'}</div>
                        <div class="card-stats">
                            <span style="color:#e74c3c;">💥 Piège</span>
                        </div>
                    </div>
                `;
            }
        }
    } else {
        container.classList.add('empty');
        container.style.backgroundImage = 'none';
        container.innerHTML = '';
    }
}

/**
 * Met à jour l'affichage du timer
 */
function updateTimerDisplay(t) {
    const endTurnBtn = document.getElementById('end-turn-btn');
    const btnText = endTurnBtn.querySelector('.btn-text');

    if (t > 0 && t <= 15 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
        // Afficher le compteur dans le bouton
        btnText.textContent = t;
        endTurnBtn.classList.add('has-timer');
    } else if (t > 15 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
        // Remettre "Fin du tour"
        btnText.textContent = 'Fin du tour';
        endTurnBtn.classList.remove('has-timer');
    }

    // À 0, griser le bouton avec sablier (temps écoulé)
    if (t <= 0 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
        endTurnBtn.classList.add('waiting');
        btnText.textContent = 'Fin du tour';
        endTurnBtn.classList.remove('has-timer');
    }
}

// Messages de phase
let phaseMessageTimeout = null;
let phaseMessageFadeTimeout = null;

/**
 * Affiche un message de phase
 */
function showPhaseMessage(text, type) {
    const el = document.getElementById('phase-indicator');

    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);

    el.textContent = text;
    el.className = 'phase-indicator ' + type + ' visible';
    el.dataset.showing = 'true';

    if (type !== 'resolution') {
        phaseMessageTimeout = setTimeout(() => {
            el.classList.add('fade-out');
            phaseMessageFadeTimeout = setTimeout(() => {
                el.classList.remove('visible');
                el.dataset.showing = 'false';
            }, 500);
        }, 2000);
    }
}

/**
 * Cache le message de phase
 */
function hidePhaseMessage() {
    const el = document.getElementById('phase-indicator');
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);
    el.classList.add('fade-out');
    phaseMessageFadeTimeout = setTimeout(() => {
        el.classList.remove('visible');
        el.dataset.showing = 'false';
    }, 500);
}

/**
 * Met à jour l'affichage de la phase
 */
function updatePhaseDisplay() {
    if (!state) return;

    const el = document.getElementById('phase-indicator');
    if (el.dataset.showing === 'true') return;

    if (state.phase !== 'resolution') {
        hidePhaseMessage();
    }
}

/**
 * Log dans l'historique
 */
function log(msg, type = 'action') {
    const el = document.createElement('div');
    el.className = `log-entry log-${type}`;
    el.textContent = msg;
    const c = document.getElementById('log-content');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
}

/**
 * Affiche une carte à l'écran avec animation cinématique style Magic Arena
 * La carte apparaît au centre, brille, puis se réduit et file vers le cimetière
 * @param {Object} card - Données de la carte
 * @param {string} [owner] - 'me' ou 'opp' pour diriger vers le bon cimetière
 */
function showCardShowcase(card, owner) {
    // Nettoyer tout showcase précédent (évite les superpositions si plusieurs sorts s'enchaînent)
    document.querySelectorAll('.card-showcase, .showcase-overlay, .showcase-particles').forEach(el => el.remove());

    const cardEl = makeCard(card, false);
    cardEl.classList.add('card-showcase');
    document.body.appendChild(cardEl);

    // Overlay sombre derrière la carte pour le focus
    const overlay = document.createElement('div');
    overlay.className = 'showcase-overlay';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // Particules lumineuses autour de la carte
    const particleContainer = document.createElement('div');
    particleContainer.className = 'showcase-particles';
    document.body.appendChild(particleContainer);
    for (let i = 0; i < 14; i++) {
        const p = document.createElement('div');
        p.className = 'showcase-particle';
        const angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const radius = 80 + Math.random() * 50;
        p.style.setProperty('--tx', (Math.cos(angle) * radius) + 'px');
        p.style.setProperty('--ty', (Math.sin(angle) * radius) + 'px');
        p.style.setProperty('--delay', (Math.random() * 0.3) + 's');
        p.style.setProperty('--size', (3 + Math.random() * 5) + 'px');
        particleContainer.appendChild(p);
    }

    // Phase 1 : Entrée (0-300ms) - déjà gérée par CSS animation
    // Phase 2 : Hold au centre (300ms-1200ms)
    // Phase 3 : Fly vers le cimetière (1200ms-1800ms)

    const totalDuration = 2100;
    const holdEnd = 1200;

    setTimeout(() => {
        // Phase 3 : voler vers le cimetière (animation cinématique)
        console.log('%c[SHOWCASE] Phase 3 - NEW graveyard animation starting', 'background: red; color: white; font-size: 14px');
        overlay.classList.remove('visible');
        particleContainer.remove();

        // Annuler l'animation CSS d'entrée pour que les styles inline JS prennent le relais
        cardEl.style.animation = 'none';

        const graveId = owner === 'opp' ? 'opp-grave-box' : 'me-grave-box';
        const graveEl = document.getElementById(graveId);

        if (graveEl) {
            const graveRect = graveEl.getBoundingClientRect();
            const targetX = graveRect.left + graveRect.width / 2;
            const targetY = graveRect.top + graveRect.height / 2;

            // Fixer l'état actuel avant de démarrer les transitions
            cardEl.style.opacity = '1';
            cardEl.style.transform = 'translate(-50%, -50%) scale(2)';

            // Forcer un reflow pour que le navigateur prenne en compte l'état initial
            cardEl.offsetHeight;

            // Étape 1 : Flip 3D préparatoire (0-200ms)
            cardEl.style.transition = 'all 0.2s ease-in';
            cardEl.style.transform = 'translate(-50%, -50%) scale(1.2) perspective(600px) rotateX(15deg)';
            cardEl.style.filter = 'brightness(1.3)';

            setTimeout(() => {
                // Étape 2 : Vol vers le cimetière avec rotation et réduction (200-700ms)
                cardEl.style.transition = 'all 0.5s cubic-bezier(0.5, 0, 0.75, 0)';
                cardEl.style.left = targetX + 'px';
                cardEl.style.top = targetY + 'px';
                cardEl.style.transform = 'translate(-50%, -50%) scale(0.15) perspective(600px) rotateX(60deg) rotateZ(5deg)';
                cardEl.style.opacity = '0.6';
                cardEl.style.filter = 'brightness(2) saturate(0.5)';
                cardEl.style.boxShadow = '0 0 30px rgba(255, 215, 0, 0.8), 0 0 60px rgba(255, 170, 0, 0.4)';

                // Traînée de particules pendant le vol
                createGraveyardTrail(cardEl);
            }, 200);

            setTimeout(() => {
                // Étape 3 : Impact au cimetière (700ms)
                cardEl.style.transition = 'all 0.15s ease-out';
                cardEl.style.transform = 'translate(-50%, -50%) scale(0) rotateX(90deg)';
                cardEl.style.opacity = '0';

                // Flash lumineux sur le cimetière
                graveEl.classList.add('graveyard-impact');
                setTimeout(() => graveEl.classList.remove('graveyard-impact'), 500);
            }, 700);
        } else {
            cardEl.style.transition = 'all 0.5s ease-in';
            cardEl.style.transform = 'translate(-50%, -50%) scale(0.2)';
            cardEl.style.opacity = '0';
        }
    }, holdEnd);

    setTimeout(() => {
        cardEl.remove();
        overlay.remove();
        if (particleContainer.parentNode) particleContainer.remove();
    }, totalDuration);
}

/**
 * Crée une traînée de particules lumineuses derrière la carte en vol vers le cimetière
 */
function createGraveyardTrail(sourceEl) {
    const count = 8;
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            if (!sourceEl.isConnected) return;
            const rect = sourceEl.getBoundingClientRect();
            const p = document.createElement('div');
            p.className = 'graveyard-trail-particle';
            p.style.left = (rect.left + rect.width / 2) + 'px';
            p.style.top = (rect.top + rect.height / 2) + 'px';
            document.body.appendChild(p);
            requestAnimationFrame(() => {
                p.style.transform = 'translate(-50%, -50%) scale(0)';
                p.style.opacity = '0';
            });
            setTimeout(() => p.remove(), 400);
        }, i * 50);
    }
}
