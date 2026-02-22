// ==================== UI DU JEU ====================
// Phases, timer, mulligan, mode test, héros, lobby, badges de rang

function canPlay() {
    if (!state) {
        return false;
    }
    if (state.phase !== 'planning') {
        return false;
    }
    if (state.me.ready) {
        return false;
    }
    // Bloquer pendant les animations — le serveur peut envoyer phase='planning'
    // avant que les animations de combat/pioche ne soient terminées côté client
    if (isAnimating || animationQueue.length > 0) {
        return false;
    }
    // Vérifier aussi si on a cliqué fin de tour ou si la résolution est encore en cours
    // ('resolving' est retiré uniquement dans le handler newTurn APRÈS la fin des animations)
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn && (endTurnBtn.classList.contains('waiting') || endTurnBtn.classList.contains('resolving'))) {
        return false;
    }
    return true;
}

function updateTimerDisplay(t) {
    const endTurnBtn = document.getElementById('end-turn-btn');
    const timerSpan = endTurnBtn.querySelector('.end-turn-timer');

    if (t > 0 && t <= 15 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
        // Afficher le compteur dans le bouton (sans changer les couleurs)
        if (timerSpan) timerSpan.textContent = t;
        endTurnBtn.classList.add('has-timer');
        endTurnBtn.classList.remove('has-phase');
    } else {
        // Masquer le timer
        if (endTurnBtn.classList.contains('has-timer')) {
            if (timerSpan) timerSpan.textContent = '';
            endTurnBtn.classList.remove('has-timer');
        }

        // À 0, griser immédiatement le bouton comme si on avait cliqué
        if (t <= 0 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
            endTurnBtn.classList.add('waiting');
        }
    }
}

let phaseMessageTimeout = null;
let phaseMessageFadeTimeout = null;

function showPhaseMessage(text, type) {
    const endTurnBtn = document.getElementById('end-turn-btn');
    const phaseEl = endTurnBtn.querySelector('.end-turn-phase');

    // Clear les timeouts précédents
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);

    // Afficher la phase dans le bouton
    phaseEl.textContent = text;
    endTurnBtn.classList.add('has-phase');
    endTurnBtn.classList.remove('has-timer');

    // Message éphémère sauf pendant la résolution - retour à "FIN DE TOUR" après 2s
    if (type !== 'resolution' && (!state || state.phase !== 'resolution')) {
        phaseMessageTimeout = setTimeout(() => {
            endTurnBtn.classList.remove('has-phase');
        }, 2000);
    }
}

function hidePhaseMessage() {
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);
    endTurnBtn.classList.remove('has-phase');
}

function updatePhaseDisplay() {
    if (!state) return;

    // Ne pas masquer si un message est en cours d'affichage (avec son propre timeout)
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn.classList.contains('has-phase')) return;

    // Ne pas afficher de message ici - le serveur envoie les messages de sous-phases
    if (state.phase !== 'resolution') {
        hidePhaseMessage();
    }
}

// ==================== MULLIGAN ====================
let mulliganTimer = null;

function showMulligan() {
    const overlay = document.getElementById('mulligan-overlay');
    const handContainer = document.getElementById('mulligan-hand');

    overlay.classList.remove('hidden');
    handContainer.innerHTML = '';

    // Afficher les cartes de la main (makeCard retourne un élément DOM)
    state.me.hand.forEach(card => {
        const cardEl = makeCard(card, true);
        handContainer.appendChild(cardEl);
    });

    // Démarrer le timer de 15 secondes
    startMulliganTimer();
}

function startMulliganTimer() {
    let timeLeft = 15;
    const timerEl = document.getElementById('mulligan-timer');
    timerEl.textContent = timeLeft;
    timerEl.classList.add('visible');

    mulliganTimer = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft;
        timerEl.classList.toggle('urgent', timeLeft <= 5);

        if (timeLeft <= 0) {
            clearInterval(mulliganTimer);
            // Auto-keep si le temps est écoulé
            if (!mulliganDone) {
                keepHand();
            }
        }
    }, 1000);
}

function startGame() {
    // Arrêter le timer mulligan si actif
    if (mulliganTimer) {
        clearInterval(mulliganTimer);
        mulliganTimer = null;
    }

    document.getElementById('mulligan-overlay').classList.add('hidden');
    // Nettoyer les cartes du mulligan pour libérer le DOM
    document.getElementById('mulligan-hand').innerHTML = '';
    const gc = document.getElementById('game-container');
    gc.classList.add('active');
    gc.style.display = 'block'; // Défensif : empêche le flash si la classe active est retirée
    buildBattlefield();
    setupCustomDrag();
    render();
    // Initialiser le glow PixiJS derrière les cartes jouables
    if (typeof CardGlow !== 'undefined') CardGlow.init();
    log('🎮 Tour 1 - Partie lancée !', 'phase');
    // Pas de popup "Phase de repositionnement" au tour 1 car pas de créatures
}

// Helper pour vérifier si j'ai des créatures sur le terrain
function hasCreaturesOnMyField() {
    if (!state || !state.me || !state.me.field) return false;
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            if (state.me.field[r][c]) return true;
        }
    }
    return false;
}

function keepHand() {
    if (mulliganDone) return;
    mulliganDone = true;

    document.getElementById('mulligan-buttons').classList.add('hidden');
    document.getElementById('mulligan-waiting').classList.remove('hidden');
    document.getElementById('mulligan-timer').classList.remove('visible');

    socket.emit('keepHand');
}

function doMulligan() {
    if (mulliganDone) return;
    mulliganDone = true;

    document.getElementById('mulligan-buttons').classList.add('hidden');
    document.getElementById('mulligan-waiting').classList.remove('hidden');
    document.getElementById('mulligan-timer').classList.remove('visible');

    socket.emit('mulligan');
}

// ==================== MODE TEST / MODE COMPLET ====================

let pickerMode = 'test'; // 'test' ou 'complete'

function showModeSelector() {
    document.getElementById('mode-selector-overlay').classList.remove('hidden');
}

function selectMode(mode) {
    document.getElementById('mode-selector-overlay').classList.add('hidden');
    socket.emit('selectMode', mode);
    if (mode === 'normal') {
        showMulligan();
    } else if (mode === 'test') {
        pickerMode = 'test';
        showCardPicker();
    } else if (mode === 'complete') {
        pickerMode = 'complete';
        showCardPicker();
    }
}

function showCardPicker() {
    testModeSelection = [];
    const overlay = document.getElementById('card-picker-overlay');
    const grid = document.getElementById('card-picker-grid');
    const isComplete = pickerMode === 'complete';

    // Configurer le titre et les sections selon le mode
    document.getElementById('card-picker-title').textContent = isComplete ? 'Construisez votre deck' : 'Choisissez vos cartes';
    document.getElementById('card-picker-selection').classList.toggle('hidden', isComplete);
    document.getElementById('deck-list-section').classList.toggle('hidden', !isComplete);

    // Afficher l'overlay immédiatement avec un état de chargement
    overlay.classList.remove('hidden');
    grid.innerHTML = '<div class="picker-loading">Chargement des cartes...</div>';

    socket.emit('requestCardCatalog', (catalog) => {
        if (!catalog || (!catalog.creatures && !catalog.spells && !catalog.traps)) {
            grid.innerHTML = '<div class="picker-loading" style="color:#e74c3c;">Erreur: catalogue vide</div>';
            return;
        }
        if (isComplete) {
            // Filtrer : faction noire + pièges neutres
            cardCatalog = {
                creatures: catalog.creatures.filter(c => c.faction === 'black'),
                spells: catalog.spells.filter(c => c.faction === 'black'),
                traps: catalog.traps || []
            };
        } else {
            cardCatalog = catalog;
        }
        renderPickerGrid('creatures');
        updatePickerUI();
    });

    // Timeout de sécurité si le callback ne revient jamais
    setTimeout(() => {
        if (!cardCatalog) {
            grid.innerHTML = '<div class="picker-loading" style="color:#e74c3c;">Le serveur ne répond pas. Rechargez la page.</div>';
        }
    }, 5000);
}

function renderPickerGrid(tab) {
    const grid = document.getElementById('card-picker-grid');
    grid.innerHTML = '';
    const isComplete = pickerMode === 'complete';

    document.querySelectorAll('.picker-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    const cards = cardCatalog[tab] || [];

    cards.forEach(cardTemplate => {
        const wrapper = document.createElement('div');
        wrapper.className = 'picker-card-wrapper';

        const cardEl = makeCard(cardTemplate, true);
        cardEl.style.cursor = 'default';
        cardEl.style.pointerEvents = 'none';
        wrapper.appendChild(cardEl);

        if (isComplete) {
            // Mode complet : boutons +/- avec compteur
            const controls = document.createElement('div');
            controls.className = 'picker-count-controls';
            controls.dataset.cardId = cardTemplate.id;

            const minusBtn = document.createElement('button');
            minusBtn.className = 'picker-minus-btn';
            minusBtn.textContent = '\u2212';
            minusBtn.onclick = () => { removeOneFromDeck(cardTemplate.id); updatePickerGrid(); };

            const countSpan = document.createElement('span');
            countSpan.className = 'picker-card-count';
            const count = testModeSelection.filter(c => c.id === cardTemplate.id).length;
            countSpan.textContent = count;

            const plusBtn = document.createElement('button');
            plusBtn.className = 'picker-plus-btn';
            plusBtn.textContent = '+';
            plusBtn.onclick = () => { addToTestHand(cardTemplate); updatePickerGrid(); };

            controls.appendChild(minusBtn);
            controls.appendChild(countSpan);
            controls.appendChild(plusBtn);
            wrapper.appendChild(controls);
        } else {
            // Mode test : bouton "Ajouter" simple
            const addBtn = document.createElement('button');
            addBtn.className = 'picker-add-btn';
            addBtn.textContent = 'Ajouter';
            addBtn.onclick = () => addToTestHand(cardTemplate);
            wrapper.appendChild(addBtn);
        }

        grid.appendChild(wrapper);
    });
}

function switchPickerTab(tab) {
    renderPickerGrid(tab);
}

function addToTestHand(cardTemplate) {
    const maxCards = pickerMode === 'complete' ? 40 : 7;
    if (testModeSelection.length >= maxCards) return;
    // Mode complet : max 2 exemplaires par carte
    if (pickerMode === 'complete') {
        const copies = testModeSelection.filter(c => c.id === cardTemplate.id).length;
        if (copies >= 2) return;
    }
    testModeSelection.push({ ...cardTemplate });
    updatePickerUI();
}

function removeFromTestHand(index) {
    testModeSelection.splice(index, 1);
    updatePickerUI();
}

function removeOneFromDeck(cardId) {
    const idx = testModeSelection.findIndex(c => c.id === cardId);
    if (idx >= 0) {
        testModeSelection.splice(idx, 1);
        updatePickerUI();
    }
}

// Met à jour uniquement les compteurs dans la grille (sans re-render complet)
function updatePickerGrid() {
    document.querySelectorAll('.picker-count-controls').forEach(ctrl => {
        const cardId = ctrl.dataset.cardId;
        const count = testModeSelection.filter(c => c.id === cardId).length;
        const countSpan = ctrl.querySelector('.picker-card-count');
        if (countSpan) countSpan.textContent = count;
    });
    updatePickerUI();
}

function updatePickerUI() {
    const isComplete = pickerMode === 'complete';
    const maxCards = isComplete ? 40 : 7;
    const counter = document.getElementById('card-picker-counter');
    counter.textContent = `${testModeSelection.length} / ${maxCards} cartes`;

    if (isComplete) {
        // Mode complet : deck-list compacte
        updateDeckList();

        const startBtn = document.getElementById('picker-start-btn');
        startBtn.disabled = testModeSelection.length !== 40;

        // Désactiver les boutons + si on est à 40 ou si la carte a déjà 2 copies
        document.querySelectorAll('.picker-plus-btn').forEach(btn => {
            const ctrl = btn.closest('.picker-count-controls');
            const cardId = ctrl?.dataset.cardId;
            const copies = cardId ? testModeSelection.filter(c => c.id === cardId).length : 0;
            btn.disabled = testModeSelection.length >= 40 || copies >= 2;
        });
    } else {
        // Mode test : thumbs dans la selection row
        const row = document.getElementById('card-picker-selection-row');
        row.innerHTML = '';

        testModeSelection.forEach((card, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'picker-selection-thumb';

            const cardEl = makeCard(card, true);
            cardEl.style.pointerEvents = 'none';
            thumb.appendChild(cardEl);

            thumb.onclick = () => removeFromTestHand(i);

            const removeBadge = document.createElement('div');
            removeBadge.className = 'picker-remove-badge';
            removeBadge.textContent = '\u00D7';
            thumb.appendChild(removeBadge);

            row.appendChild(thumb);
        });

        const startBtn = document.getElementById('picker-start-btn');
        startBtn.disabled = testModeSelection.length < 1;

        document.querySelectorAll('.picker-add-btn').forEach(btn => {
            btn.disabled = testModeSelection.length >= 7;
        });
    }
}

function updateDeckList() {
    const listEl = document.getElementById('deck-list');
    const countEl = document.getElementById('deck-list-count');
    listEl.innerHTML = '';
    countEl.textContent = `${testModeSelection.length} / 40`;

    // Grouper par id et compter
    const counts = {};
    const cardMap = {};
    testModeSelection.forEach(c => {
        counts[c.id] = (counts[c.id] || 0) + 1;
        if (!cardMap[c.id]) cardMap[c.id] = c;
    });

    // Trier par cout puis nom
    const sortedIds = Object.keys(counts).sort((a, b) => {
        const ca = cardMap[a], cb = cardMap[b];
        return (ca.cost || 0) - (cb.cost || 0) || ca.name.localeCompare(cb.name);
    });

    sortedIds.forEach(id => {
        const card = cardMap[id];
        const count = counts[id];
        const item = document.createElement('div');
        item.className = 'deck-list-item';

        const costBadge = document.createElement('span');
        costBadge.className = 'deck-list-cost';
        costBadge.textContent = card.cost;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'deck-list-name';
        nameSpan.textContent = card.name;

        const countBadge = document.createElement('span');
        countBadge.className = 'deck-list-qty';
        countBadge.textContent = `x${count}`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'deck-list-remove';
        removeBtn.textContent = '\u2212';
        removeBtn.onclick = () => { removeOneFromDeck(id); updatePickerGrid(); };

        item.appendChild(costBadge);
        item.appendChild(nameSpan);
        item.appendChild(countBadge);
        item.appendChild(removeBtn);
        listEl.appendChild(item);
    });
}

function confirmTestHand() {
    const cardIds = testModeSelection.map(c => c.id);

    if (pickerMode === 'complete') {
        if (cardIds.length !== 40) return;
        socket.emit('setCompleteDeck', cardIds, (response) => {
            if (response.success) {
                document.getElementById('card-picker-overlay').classList.add('hidden');
                showMulligan();
            }
        });
    } else {
        if (cardIds.length < 1) return;
        socket.emit('setTestHand', cardIds, (response) => {
            if (response.success) {
                document.getElementById('card-picker-overlay').classList.add('hidden');
                showMulligan();
            }
        });
    }
}

function setupHeroes() {
    // Setup hero backgrounds et titres
    const meHero = state.me.hero;
    const oppHero = state.opponent.hero;

    const meHeroInner = document.getElementById('me-hero-inner');
    const oppHeroInner = document.getElementById('opp-hero-inner');

    if (meHero && meHero.image) {
        meHeroInner.style.backgroundImage = `url('/cards/${meHero.image}')`;
        document.getElementById('me-hero-title').textContent = meHero.name;
        document.getElementById('me-hero-title').style.background = meHero.titleColor;
    }

    if (oppHero && oppHero.image) {
        oppHeroInner.style.backgroundImage = `url('/cards/${oppHero.image}')`;
        document.getElementById('opp-hero-title').textContent = oppHero.name;
        document.getElementById('opp-hero-title').style.background = oppHero.titleColor;
    }

    // Stocker les héros pour réutilisation (AVANT les event listeners)
    window.heroData = { me: meHero, opp: oppHero };

    // Preview au survol des héros
    const heroMe = document.getElementById('hero-me');
    const heroOpp = document.getElementById('hero-opp');

    // Synchroniser l'animation de bordure rotative
    const animOffset = `${(performance.now() / 1000) % 6}s`;
    if (heroMe) heroMe.style.setProperty('--anim-offset', animOffset);
    if (heroOpp) heroOpp.style.setProperty('--anim-offset', animOffset);

    // Fonction pour gérer le clic sur un héros
    const handleHeroClick = (heroEl, owner) => {
        return (e) => {
            e.stopPropagation();

            // Si un sort est sélectionné et peut cibler ce héros, le lancer
            if (selected && selected.fromHand && selected.type === 'spell') {
                const canTarget = selected.pattern === 'hero' || selected.canTargetHero;
                if (canTarget && canPlay() && selected.cost <= state.me.energy) {
                    const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
                    commitSpell(selected, 'hero', targetPlayer, -1, -1, selected.idx);
                    handCardRemovedIndex = selected.idx;
                    socket.emit('castSpell', {
                        idx: selected.idx,
                        targetPlayer: targetPlayer,
                        row: -1,
                        col: -1
                    });
                    clearSel();
                    return;
                }
            }

            // Sinon, afficher le détail du héros
            const hero = owner === 'me' ? window.heroData.me : window.heroData.opp;
            const hp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
            showHeroDetail(hero, hp);
        };
    };

    if (heroMe) {
        // Hover preview
        heroMe.onmouseenter = () => showHeroPreview(window.heroData.me, state?.me?.hp);
        heroMe.onmouseleave = hideCardPreview;
        // Clic gauche
        heroMe.onclick = handleHeroClick(heroMe, 'me');
    }

    if (heroOpp) {
        // Hover preview
        heroOpp.onmouseenter = () => showHeroPreview(window.heroData.opp, state?.opponent?.hp);
        heroOpp.onmouseleave = hideCardPreview;
        // Clic gauche
        heroOpp.onclick = handleHeroClick(heroOpp, 'opp');
    }

    // Drag/drop sur les héros pour les sorts
    setupHeroDragDrop(heroMe, 'me');
    setupHeroDragDrop(heroOpp, 'opp');
}

function setupHeroDragDrop(heroEl, owner) {
    // Les handlers drag natifs ont été supprimés.
    // Le custom drag gère le hover et le drop via CustomDrag callbacks
    // (updateHoverFeedback + handleHandDrop dans game.js)

    // Note: onclick est géré dans setupHeroes pour permettre à la fois
    // le lancer de sort ET l'affichage du détail du héros
}

function createRoom() {
    socket.emit('createRoom', (r) => {
        if (r.success) {
            myNum = r.playerNum;
            document.getElementById('room-code-display').textContent = r.code;
            document.getElementById('lobby-menu').classList.add('hidden');
            document.getElementById('lobby-waiting').classList.remove('hidden');
        }
    });
}

function joinRoom() {
    const code = document.getElementById('room-code-input').value.trim();
    if (!code) return;
    socket.emit('joinRoom', code, (r) => {
        if (r.success) myNum = r.playerNum;
        else alert(r.error);
    });
}

// ==========================================
const SVG_NS = 'http://www.w3.org/2000/svg';

const RANK_CONFIG = {
    bronze: {
        gem: {
            body: '#C47A3A', light: '#FFD4A0', bright: '#FFF0D0',
            mid: '#D4884C', deep: '#8B4513', darkest: '#3A1808',
            glow: 'rgba(232, 138, 76, 0.6)',
            frame: '#5A4A3A', frameMid: '#8A7A6A', frameLight: '#A09080',
            hotspot: '#FFFFFF', rimLight: '#FFD090',
            fire1: '#FFE8C0', fire2: '#FFBA60', fire3: '#FF8830',
        },
    },
    silver: {
        gem: {
            body: '#A8A8A8', light: '#E0E0E0', bright: '#FFFFFF',
            mid: '#909090', deep: '#606060', darkest: '#303030',
            glow: 'rgba(180, 180, 180, 0.5)',
            frame: '#505050', frameMid: '#808080', frameLight: '#A8A8A8',
            hotspot: '#FFFFFF', rimLight: '#D0D0D0',
            fire1: '#F0F0F0', fire2: '#B8B8B8', fire3: '#888888',
        },
    },
    gold: {
        gem: {
            body: '#F0C030', light: '#FFF090', bright: '#FFFFF0',
            mid: '#E0A020', deep: '#B07010', darkest: '#4A2800',
            glow: 'rgba(255, 208, 60, 0.6)',
            frame: '#5A4830', frameMid: '#8A7850', frameLight: '#B0A070',
            hotspot: '#FFFFFF', rimLight: '#FFE870',
            fire1: '#FFFFC0', fire2: '#FFD840', fire3: '#FFB000',
        },
    },
    emerald: {
        gem: {
            body: '#40C070', light: '#80FFB0', bright: '#C0FFD8',
            mid: '#30A050', deep: '#187038', darkest: '#042810',
            glow: 'rgba(80, 208, 128, 0.5)',
            frame: '#3A5040', frameMid: '#5A7860', frameLight: '#80A080',
            hotspot: '#FFFFFF', rimLight: '#80FFAA',
            fire1: '#C0FFE0', fire2: '#50E080', fire3: '#20B050',
        },
    },
    diamond: {
        gem: {
            body: '#E0DCE8', light: '#F8F6FF', bright: '#FFFFFF',
            mid: '#D0CAD8', deep: '#A8A0B8', darkest: '#706888',
            glow: 'rgba(230, 225, 240, 0.6)',
            frame: '#686068', frameMid: '#8A8490', frameLight: '#B0AAB8',
            hotspot: '#FFFFFF', rimLight: '#F0ECFF',
            fire1: '#FEFCFF', fire2: '#E8E4F0', fire3: '#D0CCD8',
        },
    },
};

const MYTHIC_GEM = {
    body: '#E04020', light: '#FF8060', bright: '#FFDDCC',
    mid: '#C83010', deep: '#901808', darkest: '#400800',
    glow: 'rgba(255, 80, 40, 0.7)',
    frame: '#5A3A2A', frameMid: '#8A6A4A', frameLight: '#B08860',
    hotspot: '#FFFFFF', rimLight: '#FF9050',
    fire1: '#FFDDBB', fire2: '#FF7030', fire3: '#E04010',
};

const TIER_LABELS = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
const TIER_Y_SHIFT = { 1: 7, 2: 0, 3: 0, 4: 0 };

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function rankRegularPoly(sides, r) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
        const a = (i * (360 / sides) - 90) * (Math.PI / 180);
        pts.push({ x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) });
    }
    return { pts, d: 'M' + pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' L') + ' Z' };
}

function getGemShape(tier) {
    switch (tier) {
        case 1: return rankRegularPoly(3, 42);
        case 2: return { pts: [{x:50,y:13},{x:87,y:50},{x:50,y:87},{x:13,y:50}], d: 'M50,13 L87,50 L50,87 L13,50 Z' };
        case 3: return rankRegularPoly(5, 38);
        case 4: return rankRegularPoly(6, 37);
        default: return { pts: [], d: '' };
    }
}

function buildGemSVG(c, uid, gem, n, translate) {
    const svg = svgEl('svg', { viewBox: '0 0 100 100' });
    Object.assign(svg.style, { width: '100%', height: '100%' });

    const g = svgEl('g', { transform: 'translate(' + translate[0] + ',' + translate[1] + ')' });

    const midPts = gem.pts.map((p, i) => {
        const next = gem.pts[(i + 1) % n];
        return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
    });
    const innerPts = gem.pts.map(p => ({ x: 50 + (p.x - 50) * 0.48, y: 50 + (p.y - 50) * 0.48 }));
    const deepInnerPts = gem.pts.map(p => ({ x: 50 + (p.x - 50) * 0.22, y: 50 + (p.y - 50) * 0.22 }));

    const defs = svgEl('defs');

    // Frame gradient
    const fg = svgEl('linearGradient', { id: 'fg-' + uid, x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
    [[0, c.frameLight], [40, c.frameMid], [60, c.frameLight], [100, c.frameMid]].forEach(([o, col]) => {
        fg.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col }));
    });
    defs.appendChild(fg);

    // Radial body gradient
    const gr = svgEl('radialGradient', { id: 'gr-' + uid, cx: '32%', cy: '28%', r: '72%' });
    [[0, c.light, '0.9'], [15, c.body, null], [45, c.mid, null], [75, c.deep, null], [100, c.darkest, null]].forEach(([o, col, op]) => {
        const s = svgEl('stop', { offset: o + '%', 'stop-color': col });
        if (op) s.setAttribute('stop-opacity', op);
        gr.appendChild(s);
    });
    defs.appendChild(gr);

    // Inner glow
    const ig = svgEl('radialGradient', { id: 'ig-' + uid, cx: '44%', cy: '40%', r: '30%' });
    [[0, c.fire1, '0.5'], [50, c.fire2, '0.15'], [100, c.fire3, '0']].forEach(([o, col, op]) => {
        ig.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col, 'stop-opacity': op }));
    });
    defs.appendChild(ig);

    // Specular highlight
    const hs = svgEl('radialGradient', { id: 'hs-' + uid, cx: '50%', cy: '50%', r: '50%' });
    [[0, '#FFFFFF', '0.5'], [25, c.hotspot, '0.3'], [60, c.bright, '0.08'], [100, c.bright, '0']].forEach(([o, col, op]) => {
        hs.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col, 'stop-opacity': op }));
    });
    defs.appendChild(hs);

    // Ambient occlusion
    const ao = svgEl('radialGradient', { id: 'ao-' + uid, cx: '50%', cy: '50%', r: '50%' });
    [[50, c.darkest, '0'], [85, c.darkest, '0.2'], [100, c.darkest, '0.5']].forEach(([o, col, op]) => {
        ao.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col, 'stop-opacity': op }));
    });
    defs.appendChild(ao);

    // Caustic
    const ca = svgEl('radialGradient', { id: 'ca-' + uid, cx: '50%', cy: '50%', r: '50%' });
    [[0, c.fire1, '0.4'], [60, c.fire2, '0.1'], [100, c.fire3, '0']].forEach(([o, col, op]) => {
        ca.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col, 'stop-opacity': op }));
    });
    defs.appendChild(ca);

    // Per-facet gradients
    gem.pts.forEach((p, i) => {
        const next = gem.pts[(i + 1) % n];
        const mx = (p.x + next.x) / 2;
        const my = (p.y + next.y) / 2;
        const ratio = i / n;
        const isLight = ratio < 0.35;
        const grad = svgEl('linearGradient', {
            id: 'facg-' + uid + '-' + i,
            x1: '50%', y1: '50%',
            x2: ((mx - 50) / 50 * 50 + 50).toFixed(0) + '%',
            y2: ((my - 50) / 50 * 50 + 50).toFixed(0) + '%',
        });
        grad.appendChild(svgEl('stop', {
            offset: '0%', 'stop-color': isLight ? c.light : c.deep,
            'stop-opacity': isLight ? '0.3' : '0.4',
        }));
        grad.appendChild(svgEl('stop', {
            offset: '100%', 'stop-color': isLight ? c.body : c.darkest,
            'stop-opacity': isLight ? '0.05' : '0.2',
        }));
        defs.appendChild(grad);
    });

    // Clip path
    const cp = svgEl('clipPath', { id: 'gc-' + uid });
    cp.appendChild(svgEl('path', { d: gem.d }));
    defs.appendChild(cp);

    // Frame bevel
    const fb = svgEl('linearGradient', { id: 'fb-' + uid, x1: '30%', y1: '0%', x2: '70%', y2: '100%' });
    [[0, c.frameLight], [35, c.frameMid], [70, c.frame], [100, c.frame]].forEach(([o, col]) => {
        fb.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col }));
    });
    defs.appendChild(fb);

    // Frame highlight
    const fh = svgEl('linearGradient', { id: 'fh-' + uid, x1: '20%', y1: '0%', x2: '80%', y2: '100%' });
    [[0, 'rgba(255,255,255,0.2)'], [50, 'rgba(255,255,255,0.05)'], [100, 'rgba(0,0,0,0.2)']].forEach(([o, col]) => {
        fh.appendChild(svgEl('stop', { offset: o + '%', 'stop-color': col }));
    });
    defs.appendChild(fh);

    g.appendChild(defs);

    // Border / bezel
    g.appendChild(svgEl('path', { d: gem.d, fill: 'none', stroke: 'url(#fb-' + uid + ')', 'stroke-width': '12', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: gem.d, fill: 'none', stroke: 'url(#fg-' + uid + ')', 'stroke-width': '10', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: gem.d, fill: 'none', stroke: 'url(#fh-' + uid + ')', 'stroke-width': '10', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: gem.d, fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': '1', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: gem.d, fill: c.deep }));

    // Gem base
    g.appendChild(svgEl('path', { d: gem.d, fill: 'url(#gr-' + uid + ')' }));

    // Outer facets (gradient)
    gem.pts.forEach((p, i) => {
        const next = gem.pts[(i + 1) % n];
        g.appendChild(svgEl('path', {
            d: 'M50,50 L' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' L' + next.x.toFixed(1) + ',' + next.y.toFixed(1) + ' Z',
            fill: 'url(#facg-' + uid + '-' + i + ')',
        }));
    });

    // Outer facets (flat overlay)
    gem.pts.forEach((p, i) => {
        const next = gem.pts[(i + 1) % n];
        const ratio = i / n;
        let fill, opacity;
        if (ratio < 0.2) { fill = c.light; opacity = 0.4; }
        else if (ratio < 0.35) { fill = c.body; opacity = 0.15; }
        else if (ratio < 0.55) { fill = c.mid; opacity = 0.15; }
        else if (ratio < 0.75) { fill = c.deep; opacity = 0.35; }
        else { fill = c.darkest; opacity = 0.4; }
        g.appendChild(svgEl('path', {
            d: 'M50,50 L' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' L' + next.x.toFixed(1) + ',' + next.y.toFixed(1) + ' Z',
            fill: fill, opacity: opacity,
        }));
    });

    // Inner ring facets
    gem.pts.forEach((p, i) => {
        const next = gem.pts[(i + 1) % n];
        const ip = innerPts[i];
        const ipNext = innerPts[(i + 1) % n];
        const ratio = i / n;
        const isTop = ratio < 0.3;
        const isMid = ratio >= 0.3 && ratio < 0.6;
        g.appendChild(svgEl('path', {
            d: 'M' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' L' + next.x.toFixed(1) + ',' + next.y.toFixed(1) + ' L' + ipNext.x.toFixed(1) + ',' + ipNext.y.toFixed(1) + ' L' + ip.x.toFixed(1) + ',' + ip.y.toFixed(1) + ' Z',
            fill: isTop ? c.light : isMid ? c.mid : c.deep,
            opacity: isTop ? 0.18 : 0.12,
        }));
    });

    // Deep inner ring
    gem.pts.forEach((p, i) => {
        const ip = innerPts[i];
        const ipNext = innerPts[(i + 1) % n];
        const dp = deepInnerPts[i];
        const dpNext = deepInnerPts[(i + 1) % n];
        const ratio = i / n;
        g.appendChild(svgEl('path', {
            d: 'M' + ip.x.toFixed(1) + ',' + ip.y.toFixed(1) + ' L' + ipNext.x.toFixed(1) + ',' + ipNext.y.toFixed(1) + ' L' + dpNext.x.toFixed(1) + ',' + dpNext.y.toFixed(1) + ' L' + dp.x.toFixed(1) + ',' + dp.y.toFixed(1) + ' Z',
            fill: ratio < 0.35 ? c.fire1 : c.deep,
            opacity: ratio < 0.35 ? 0.12 : 0.1,
        }));
    });

    // Facet edge lines
    gem.pts.forEach((p) => {
        g.appendChild(svgEl('line', {
            x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: '50', y2: '50',
            stroke: c.darkest, 'stroke-width': '0.6', opacity: '0.3',
        }));
    });
    midPts.forEach((p) => {
        g.appendChild(svgEl('line', {
            x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: '50', y2: '50',
            stroke: c.darkest, 'stroke-width': '0.25', opacity: '0.12',
        }));
    });
    innerPts.forEach((p, i) => {
        const next = innerPts[(i + 1) % n];
        g.appendChild(svgEl('line', {
            x1: p.x.toFixed(1), y1: p.y.toFixed(1),
            x2: next.x.toFixed(1), y2: next.y.toFixed(1),
            stroke: c.darkest, 'stroke-width': '0.4', opacity: '0.15',
        }));
    });

    // Inner glow
    g.appendChild(svgEl('path', { d: gem.d, fill: 'url(#ig-' + uid + ')' }));

    // Ambient occlusion
    g.appendChild(svgEl('path', { d: gem.d, fill: 'url(#ao-' + uid + ')' }));

    // Inner shadow
    g.appendChild(svgEl('path', {
        d: gem.d, fill: 'none', stroke: 'rgba(0,0,0,0.3)',
        'stroke-width': '1.5', 'stroke-linejoin': 'round',
    }));

    // Clipped highlights
    const clipG = svgEl('g', { 'clip-path': 'url(#gc-' + uid + ')' });

    // Rim light top edge
    clipG.appendChild(svgEl('line', {
        x1: gem.pts[0].x, y1: gem.pts[0].y,
        x2: gem.pts[n - 1].x, y2: gem.pts[n - 1].y,
        stroke: c.rimLight, 'stroke-width': '2', opacity: '0.5',
    }));
    if (n > 3) {
        clipG.appendChild(svgEl('line', {
            x1: gem.pts[0].x, y1: gem.pts[0].y,
            x2: gem.pts[1].x, y2: gem.pts[1].y,
            stroke: c.rimLight, 'stroke-width': '1.2', opacity: '0.3',
        }));
    }

    // Caustic
    clipG.appendChild(svgEl('ellipse', {
        cx: '60', cy: '64', rx: '9', ry: '4',
        fill: 'url(#ca-' + uid + ')', transform: 'rotate(20 60 64)',
    }));

    // Refraction streaks
    clipG.appendChild(svgEl('line', { x1: '44', y1: '58', x2: '40', y2: '32', stroke: c.fire1, 'stroke-width': '1.2', opacity: '0.12' }));
    clipG.appendChild(svgEl('line', { x1: '52', y1: '62', x2: '56', y2: '36', stroke: c.fire1, 'stroke-width': '0.8', opacity: '0.08' }));
    clipG.appendChild(svgEl('line', { x1: '48', y1: '56', x2: '45', y2: '34', stroke: c.fire2, 'stroke-width': '0.6', opacity: '0.1' }));

    // Edge dispersion
    clipG.appendChild(svgEl('line', {
        x1: gem.pts[n - 1].x, y1: gem.pts[n - 1].y,
        x2: innerPts[n - 1].x, y2: innerPts[n - 1].y,
        stroke: c.fire1, 'stroke-width': '1.5', opacity: '0.15',
    }));

    // Bottom edge glow
    if (n > 3) {
        const half = Math.floor(n * 0.5);
        clipG.appendChild(svgEl('line', {
            x1: gem.pts[half].x, y1: gem.pts[half].y,
            x2: gem.pts[half + 1].x, y2: gem.pts[half + 1].y,
            stroke: c.fire3, 'stroke-width': '0.8', opacity: '0.15',
        }));
    }

    g.appendChild(clipG);
    svg.appendChild(g);
    return svg;
}

function createRankBadge(rank, tier) {
    const c = RANK_CONFIG[rank].gem;
    const uid = rank + '-' + tier + '-' + Date.now();
    const gem = getGemShape(tier);
    const n = gem.pts.length;

    const wrapper = document.createElement('div');
    wrapper.className = 'rank-badge';

    const box = document.createElement('div');
    box.className = 'rank-gem';

    box.appendChild(buildGemSVG(c, uid, gem, n, [0, TIER_Y_SHIFT[tier]]));
    wrapper.appendChild(box);

    const label = document.createElement('div');
    label.className = 'rank-tier-label';
    label.textContent = TIER_LABELS[tier];
    wrapper.appendChild(label);

    return wrapper;
}

function createMythicBadge(mythicPosition) {
    const c = MYTHIC_GEM;
    const uid = 'mythic-' + Date.now();
    const n = 8;
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i * 45 - 90) * (Math.PI / 180);
        pts.push({ x: 50 + 36 * Math.cos(a), y: 50 + 36 * Math.sin(a) });
    }
    const gem = { pts, d: 'M' + pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' L') + ' Z' };

    const wrapper = document.createElement('div');
    wrapper.className = 'rank-badge';

    const box = document.createElement('div');
    box.className = 'rank-gem';

    box.appendChild(buildGemSVG(c, uid, gem, n, [0, 0]));
    wrapper.appendChild(box);

    const label = document.createElement('div');
    label.className = 'rank-tier-label mythic-label';
    label.textContent = '#' + (mythicPosition || 1);
    wrapper.appendChild(label);

    return wrapper;
}

// ── Couleurs du cadre — palette neutre calquée sur le bouton FIN DE TOUR ──
const FRAME_COLORS = {
    // Bordure : dégradé brun/beige identique au bouton
    b1: '#8b7355', b2: '#d4c4a8', b3: '#a08060', b4: '#c4b896', b5: '#6b5344',
    // Fond intérieur sombre
    fill1: '#1a1a1a', fill2: '#0a0a0a', fill3: '#151515',
    // Texte & sous-titre
    text: '#d9d0b4', subtitle: '#9a9080',
    // Glow & lignes décoratives
    glow: 'rgba(139,115,85,0.12)', line: 'rgba(180,160,120,0.10)', orn: 'rgba(180,160,120,0.18)',
};

// ── Couleurs du cercle de gemme par rang (seul élément coloré par rang) ──
const GEM_CIRCLE_COLORS = {
    bronze:  { s1: '#D4A87C', s2: '#8B5E3C', s3: '#D4A87C', fill: '#1a1008' },
    silver:  { s1: '#D0D0D0', s2: '#808080', s3: '#D0D0D0', fill: '#161618' },
    gold:    { s1: '#f0d888', s2: '#c49030', s3: '#f0d888', fill: '#1a1408' },
    emerald: { s1: '#60d090', s2: '#2a7a4a', s3: '#60d090', fill: '#0a1610' },
    diamond: { s1: '#e0d8f0', s2: '#8880a0', s3: '#e0d8f0', fill: '#121018' },
    mythic:  { s1: '#ff9050', s2: '#c04020', s3: '#ff9050', fill: '#1a0c08' },
};

function buildFrameSVG(svgEl) {
    const fc = FRAME_COLORS;
    const uid = 'frame-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    svgEl.innerHTML = '';

    // Defs
    const defs = document.createElementNS(SVG_NS, 'defs');

    // Gradient bordure dorée
    const gBorder = document.createElementNS(SVG_NS, 'linearGradient');
    gBorder.id = uid + '-border';
    gBorder.setAttribute('x1', '0'); gBorder.setAttribute('y1', '0');
    gBorder.setAttribute('x2', '300'); gBorder.setAttribute('y2', '100');
    gBorder.setAttribute('gradientUnits', 'userSpaceOnUse');
    [[0, fc.b1], [25, fc.b2], [50, fc.b3], [75, fc.b4], [100, fc.b5]].forEach(([o, c]) => {
        const s = document.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', o + '%'); s.setAttribute('stop-color', c);
        gBorder.appendChild(s);
    });
    defs.appendChild(gBorder);

    // Gradient fond sombre
    const gFill = document.createElementNS(SVG_NS, 'linearGradient');
    gFill.id = uid + '-fill';
    gFill.setAttribute('x1', '0'); gFill.setAttribute('y1', '0');
    gFill.setAttribute('x2', '0'); gFill.setAttribute('y2', '100');
    gFill.setAttribute('gradientUnits', 'userSpaceOnUse');
    [[0, fc.fill1], [50, fc.fill2], [100, fc.fill3]].forEach(([o, c]) => {
        const s = document.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', o + '%'); s.setAttribute('stop-color', c);
        gFill.appendChild(s);
    });
    defs.appendChild(gFill);

    // Radial inner glow
    const gInner = document.createElementNS(SVG_NS, 'radialGradient');
    gInner.id = uid + '-iglow';
    gInner.setAttribute('cx', '50%'); gInner.setAttribute('cy', '50%');
    const s1 = document.createElementNS(SVG_NS, 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', fc.glow);
    const s2 = document.createElementNS(SVG_NS, 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', 'transparent');
    gInner.appendChild(s1); gInner.appendChild(s2);
    defs.appendChild(gInner);

    // Ornate pattern
    const pat = document.createElementNS(SVG_NS, 'pattern');
    pat.id = uid + '-pat';
    pat.setAttribute('x', '0'); pat.setAttribute('y', '0');
    pat.setAttribute('width', '40'); pat.setAttribute('height', '40');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    const p1 = document.createElementNS(SVG_NS, 'path');
    p1.setAttribute('d', 'M20 0 L22 8 L20 6 L18 8 Z');
    p1.setAttribute('fill', fc.line.replace('0.12', '0.05'));
    pat.appendChild(p1);
    const p2 = document.createElementNS(SVG_NS, 'path');
    p2.setAttribute('d', 'M0 20 L8 22 L6 20 L8 18 Z');
    p2.setAttribute('fill', fc.line.replace('0.12', '0.04'));
    pat.appendChild(p2);
    const circ = document.createElementNS(SVG_NS, 'circle');
    circ.setAttribute('cx', '20'); circ.setAttribute('cy', '20'); circ.setAttribute('r', '1');
    circ.setAttribute('fill', fc.line.replace('0.12', '0.06'));
    pat.appendChild(circ);
    defs.appendChild(pat);

    svgEl.appendChild(defs);

    // Outer border rect
    const r1 = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 2, y: 2, width: 296, height: 96, rx: 10, ry: 10, fill: `url(#${uid}-border)`, opacity: '0.9' }).forEach(([k, v]) => r1.setAttribute(k, v));
    svgEl.appendChild(r1);

    // Inner dark fill
    const r2 = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 6, y: 6, width: 288, height: 88, rx: 8, ry: 8, fill: `url(#${uid}-fill)` }).forEach(([k, v]) => r2.setAttribute(k, v));
    svgEl.appendChild(r2);

    // Pattern overlay
    const r3 = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 6, y: 6, width: 288, height: 88, rx: 8, ry: 8, fill: `url(#${uid}-pat)` }).forEach(([k, v]) => r3.setAttribute(k, v));
    svgEl.appendChild(r3);

    // Inner glow
    const r4 = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 6, y: 6, width: 288, height: 88, rx: 8, ry: 8, fill: `url(#${uid}-iglow)` }).forEach(([k, v]) => r4.setAttribute(k, v));
    svgEl.appendChild(r4);

    // Inner border line
    const r5 = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 10, y: 10, width: 280, height: 80, rx: 6, ry: 6, fill: 'none', stroke: `url(#${uid}-border)`, 'stroke-width': '0.8', opacity: '0.4' }).forEach(([k, v]) => r5.setAttribute(k, v));
    svgEl.appendChild(r5);

    // Decorative lines
    [[20, 24, 280, 24], [20, 76, 280, 76]].forEach(([x1, y1, x2, y2]) => {
        const l = document.createElementNS(SVG_NS, 'line');
        Object.entries({ x1, y1, x2, y2, stroke: fc.line, 'stroke-width': '0.5' }).forEach(([k, v]) => l.setAttribute(k, v));
        svgEl.appendChild(l);
    });

    // Top ornament curves
    const ornPaths = [
        ['M110 22 Q150 18 190 22', '0.8'],
        ['M120 20 L130 16 L135 20 L140 16 L150 20', '0.5'],
        ['M110 78 Q150 82 190 78', '0.8'],
        ['M120 80 L130 84 L135 80 L140 84 L150 80', '0.5'],
    ];
    ornPaths.forEach(([d, sw]) => {
        const p = document.createElementNS(SVG_NS, 'path');
        Object.entries({ d, fill: 'none', stroke: fc.orn, 'stroke-width': sw }).forEach(([k, v]) => p.setAttribute(k, v));
        svgEl.appendChild(p);
    });

    return fc;
}

// Cercle de fond derrière la gemme de rang — bordure de la couleur du rang
function createGemCircle(rank) {
    const gc = GEM_CIRCLE_COLORS[rank] || GEM_CIRCLE_COLORS.gold;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 56 56');
    svg.setAttribute('xmlns', SVG_NS);
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const uid = 'gc-' + rank + '-' + Date.now();
    const defs = document.createElementNS(SVG_NS, 'defs');
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    grad.id = uid;
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '56'); grad.setAttribute('y2', '56');
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    [[0, gc.s1], [50, gc.s2], [100, gc.s3]].forEach(([o, c]) => {
        const s = document.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', o + '%'); s.setAttribute('stop-color', c);
        grad.appendChild(s);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Cercle : fond sombre + bordure colorée par rang
    const c1 = document.createElementNS(SVG_NS, 'circle');
    Object.entries({ cx: 28, cy: 28, r: 26, fill: gc.fill, stroke: `url(#${uid})`, 'stroke-width': '2' }).forEach(([k, v]) => c1.setAttribute(k, v));
    svg.appendChild(c1);

    return svg;
}

function setRandomRanks() {
    const ranks = ['bronze', 'silver', 'gold', 'emerald', 'diamond'];
    const tiers = [1, 2, 3, 4];

    const useMythic = Math.random() < 0.1;

    const meContainer = document.getElementById('me-rank-badge');
    const oppContainer = document.getElementById('opp-rank-badge');
    const meFrameSvg = document.getElementById('me-frame-svg');
    const oppFrameSvg = document.getElementById('opp-frame-svg');
    const meFrame = document.getElementById('me-player-frame');
    const oppFrame = document.getElementById('opp-player-frame');

    // ── Joueur local ──
    let meRank, meTier;
    if (useMythic) {
        meRank = 'mythic';
        meTier = 0;
    } else {
        meRank = ranks[Math.floor(Math.random() * ranks.length)];
        meTier = tiers[Math.floor(Math.random() * tiers.length)];
    }

    // Build frame SVG (palette neutre identique pour tous les rangs)
    if (meFrameSvg) {
        buildFrameSVG(meFrameSvg);
        if (meFrame) {
            meFrame.style.setProperty('--frame-text', FRAME_COLORS.text);
            meFrame.style.setProperty('--frame-subtitle', FRAME_COLORS.subtitle);
            meFrame.style.setProperty('--frame-glow', FRAME_COLORS.glow);
        }
    }
    if (meContainer) {
        meContainer.innerHTML = '';
        meContainer.appendChild(createGemCircle(meRank));
        const meBadge = meRank === 'mythic'
            ? createMythicBadge(Math.floor(Math.random() * 200) + 1)
            : createRankBadge(meRank, meTier);
        meContainer.appendChild(meBadge);
    }

    // ── Adversaire ──
    const oppRank = ranks[Math.floor(Math.random() * ranks.length)];
    const oppTier = tiers[Math.floor(Math.random() * tiers.length)];

    if (oppFrameSvg) {
        buildFrameSVG(oppFrameSvg);
        if (oppFrame) {
            oppFrame.style.setProperty('--frame-text', FRAME_COLORS.text);
            oppFrame.style.setProperty('--frame-subtitle', FRAME_COLORS.subtitle);
            oppFrame.style.setProperty('--frame-glow', FRAME_COLORS.glow);
        }
    }
    if (oppContainer) {
        oppContainer.innerHTML = '';
        oppContainer.appendChild(createGemCircle(oppRank));
        const oppBadge = createRankBadge(oppRank, oppTier);
        oppContainer.appendChild(oppBadge);
    }
}

// ==================== ROUND BANNER ====================
let roundBannerTimeout = null;

function showRoundBanner(turnNumber) {
    const overlay = document.getElementById('round-banner-overlay');
    if (!overlay) return;

    // Clear previous animation
    if (roundBannerTimeout) {
        clearTimeout(roundBannerTimeout);
        roundBannerTimeout = null;
    }
    overlay.classList.remove('active');

    // Update round number
    const numberEl = document.getElementById('round-banner-number');
    if (numberEl) numberEl.textContent = turnNumber;

    // Remove old particles
    overlay.querySelectorAll('.round-banner-particle').forEach(p => p.remove());

    // Create floating golden particles
    const ribbonEl = overlay.querySelector('.round-banner-ribbon');
    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'round-banner-particle';
        const x = (Math.random() - 0.5) * 500;
        const y = (Math.random() - 0.5) * 160;
        const size = 2 + Math.random() * 4;
        const delay = Math.random() * 0.8;
        const duration = 1.5 + Math.random() * 1.5;
        particle.style.cssText = `
            left: calc(50% + ${x}px);
            top: calc(50% + ${y}px);
            width: ${size}px;
            height: ${size}px;
            animation: particleFloat ${duration}s ${delay}s ease-out forwards;
            opacity: 0;
        `;
        overlay.appendChild(particle);
    }

    // Inject particle animation if not already present
    if (!document.getElementById('round-banner-particle-style')) {
        const style = document.createElement('style');
        style.id = 'round-banner-particle-style';
        style.textContent = `
            @keyframes particleFloat {
                0%   { opacity: 0; transform: translateY(0) scale(0.5); }
                20%  { opacity: 0.8; transform: translateY(-10px) scale(1); }
                80%  { opacity: 0.6; transform: translateY(-40px) scale(0.8); }
                100% { opacity: 0; transform: translateY(-60px) scale(0.3); }
            }
        `;
        document.head.appendChild(style);
    }

    // Force reflow then activate
    void overlay.offsetWidth;
    overlay.classList.add('active');

    // Clean up after animation completes
    roundBannerTimeout = setTimeout(() => {
        overlay.classList.remove('active');
        overlay.querySelectorAll('.round-banner-particle').forEach(p => p.remove());
    }, 3200);
}
