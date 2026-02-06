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
    // Vérifier aussi si on a cliqué fin de tour (avant que le serveur confirme)
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn && endTurnBtn.classList.contains('waiting')) {
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
    document.getElementById('game-container').classList.add('active');
    buildBattlefield();
    setupCustomDrag();
    render();
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

// ==================== MODE TEST ====================

function showModeSelector() {
    document.getElementById('mode-selector-overlay').classList.remove('hidden');
}

function selectMode(mode) {
    document.getElementById('mode-selector-overlay').classList.add('hidden');
    if (mode === 'normal') {
        showMulligan();
    } else if (mode === 'test') {
        showCardPicker();
    }
}

function showCardPicker() {
    testModeSelection = [];
    const overlay = document.getElementById('card-picker-overlay');
    const grid = document.getElementById('card-picker-grid');

    // Afficher l'overlay immédiatement avec un état de chargement
    overlay.classList.remove('hidden');
    grid.innerHTML = '<div class="picker-loading">Chargement des cartes...</div>';

    socket.emit('requestCardCatalog', (catalog) => {
        if (!catalog || (!catalog.creatures && !catalog.spells && !catalog.traps)) {
            grid.innerHTML = '<div class="picker-loading" style="color:#e74c3c;">Erreur: catalogue vide</div>';
            return;
        }
        cardCatalog = catalog;
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

        const addBtn = document.createElement('button');
        addBtn.className = 'picker-add-btn';
        addBtn.textContent = 'Ajouter';
        addBtn.onclick = () => addToTestHand(cardTemplate);
        wrapper.appendChild(addBtn);

        grid.appendChild(wrapper);
    });
}

function switchPickerTab(tab) {
    renderPickerGrid(tab);
}

function addToTestHand(cardTemplate) {
    if (testModeSelection.length >= 7) return;
    testModeSelection.push({ ...cardTemplate });
    updatePickerUI();
}

function removeFromTestHand(index) {
    testModeSelection.splice(index, 1);
    updatePickerUI();
}

function updatePickerUI() {
    const counter = document.getElementById('card-picker-counter');
    counter.textContent = `${testModeSelection.length} / 7 cartes`;

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

function confirmTestHand() {
    if (testModeSelection.length < 1) return;
    const cardIds = testModeSelection.map(c => c.id);

    socket.emit('setTestHand', cardIds, (response) => {
        if (response.success) {
            document.getElementById('card-picker-overlay').classList.add('hidden');
            showMulligan();
        } else {
        }
    });
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
                    commitSpell(selected, 'hero', targetPlayer, -1, -1);
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
const TIER_Y_SHIFT = { 1: 16, 2: 0, 3: 6, 4: 0 };

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

    // Outer glow
    const glow = document.createElement('div');
    Object.assign(glow.style, {
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '55px', height: '55px',
        background: 'radial-gradient(circle, ' + c.glow + ' 0%, transparent 70%)',
        filter: 'blur(12px)', opacity: '0.9',
    });
    box.appendChild(glow);
    box.appendChild(buildGemSVG(c, uid, gem, n, [0, TIER_Y_SHIFT[tier]]));
    wrapper.appendChild(box);

    const label = document.createElement('div');
    label.className = 'rank-tier-label';
    label.style.color = c.body;
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

    const glow = document.createElement('div');
    Object.assign(glow.style, {
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '55px', height: '55px',
        background: 'radial-gradient(circle, ' + c.glow + ' 0%, transparent 70%)',
        filter: 'blur(12px)', opacity: '0.9',
    });
    box.appendChild(glow);
    box.appendChild(buildGemSVG(c, uid, gem, n, [0, 0]));
    wrapper.appendChild(box);

    const label = document.createElement('div');
    label.className = 'rank-tier-label mythic-label';
    label.textContent = '#' + (mythicPosition || 1);
    wrapper.appendChild(label);

    return wrapper;
}

function setRandomRanks() {
    const ranks = ['bronze', 'silver', 'gold', 'emerald', 'diamond'];
    const tiers = [1, 2, 3, 4];

    const useMythic = Math.random() < 0.1;

    const meContainer = document.getElementById('me-rank-badge');
    const oppContainer = document.getElementById('opp-rank-badge');

    if (meContainer) {
        meContainer.innerHTML = '';
        let meBadge, meTier;
        if (useMythic) {
            meBadge = createMythicBadge(Math.floor(Math.random() * 200) + 1);
            meTier = 0;
        } else {
            const r = ranks[Math.floor(Math.random() * ranks.length)];
            meTier = tiers[Math.floor(Math.random() * tiers.length)];
            meBadge = createRankBadge(r, meTier);
        }
        meContainer.style.marginTop = meTier === 1 ? '13px' : '';
        meContainer.appendChild(meBadge);
    }
    if (oppContainer) {
        oppContainer.innerHTML = '';
        const r = ranks[Math.floor(Math.random() * ranks.length)];
        const t = tiers[Math.floor(Math.random() * tiers.length)];
        const oppBadge = createRankBadge(r, t);
        oppContainer.style.marginTop = t === 1 ? '13px' : '';
        oppContainer.appendChild(oppBadge);
    }
}
