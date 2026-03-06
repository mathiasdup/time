// ==================== RENDU DU JEU ====================
// Render principal, champ de bataille, main, cartes, preview, cimetière

// [DOM-VIS] Snapshot du DOM de la main tel qu'un humain le verrait
function _domVisSnapshot(panel, label) {
    if (!window.HAND_TRACE) return;
    if (!panel) return;
    const all = Array.from(panel.querySelectorAll('.card'));
    const snap = all.map((el, i) => {
        const r = el.getBoundingClientRect();
        const name = el.__cardData?.name || el.dataset?.cardId || '?';
        const uid = (el.dataset?.uid || el.__cardData?.uid || el.__cardData?.id || '').slice(-4);
        const isCommitted = el.classList.contains('committed-spell');
        const vis = el.style.visibility === 'hidden' ? 'HID' : 'vis';
        const tx = el.style.transform || 'none';
        return `${i}:${name}(${uid})${isCommitted?'[C]':''} x=${Math.round(r.left)} ${vis} ${tx !== 'none' ? tx : ''}`.trim();
    });
    console.log(`[DOM-VIS] ${label} | phase=${state?.phase||'?'} | ${all.length} cards | ${snap.join(' | ')}`);
}

// Safety cleanup : retirer les wrappers d'animation DIV orphelins (> 10s)
// Exclure les CANVAS (PixiJS CombatVFX permanent) qui ont aussi fixed+z-index élevé
setInterval(() => {
    const now = Date.now();
    for (const child of Array.from(document.body.children)) {
        if (child.tagName === 'CANVAS') continue;
        if (child.style.position === 'fixed' && parseInt(child.style.zIndex) >= 9000) {
            const born = parseInt(child.dataset.animBorn) || 0;
            if (!born) {
                child.dataset.animBorn = now;
            } else if (now - born > 10000) {
                child.remove();
            }
        }
    }
}, 5000);

// Slots dont le slow path (makeCard) a été différé pendant les animations de combat
var deferredSlots = new Set();

// Cache des éléments DOM statiques (initialisé au premier render)
let _cachedDomEls = null;
function _getDomEls() {
    if (!_cachedDomEls) {
        _cachedDomEls = {
            meHpNum: document.querySelector('#me-hp .hero-hp-number'),
            oppHpNum: document.querySelector('#opp-hp .hero-hp-number'),
            meManaPill: document.getElementById('me-energy'),
            oppManaPill: document.getElementById('opp-energy'),
            meDeckTooltip: document.getElementById('me-deck-tooltip'),
            oppDeckTooltip: document.getElementById('opp-deck-tooltip'),
            meGraveTooltip: document.getElementById('me-grave-tooltip'),
            oppGraveTooltip: document.getElementById('opp-grave-tooltip'),
            endTurnBtn: document.getElementById('end-turn-btn'),
        };
    }
    return _cachedDomEls;
}

const _invalidCardStatTraceCache = new Map();
function _toFiniteNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function _getPoisonDisplayValue(card) {
    const n = Number(card?.poisonX);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.floor(n));
}

function _getPoisonBaseValue(card) {
    const base = Number(card?.basePoisonX);
    if (Number.isFinite(base)) return Math.max(0, Math.floor(base));
    return _getPoisonDisplayValue(card);
}

function _traceInvalidCardStats(source, card, meta = {}) {
    if (!card || card.type !== 'creature') return false;

    const atk = _toFiniteNumberOrNull(card.atk);
    const hp = _toFiniteNumberOrNull(card.hp);
    const currentHp = _toFiniteNumberOrNull(card.currentHp ?? card.hp);
    if (atk !== null && hp !== null && currentHp !== null) return false;

    const uid = card.uid || card.id || `${card.name || 'unknown'}`;
    const key = `${source}|${uid}|${meta.owner ?? '?'}|${meta.row ?? '?'}|${meta.col ?? '?'}`;
    const now = Date.now();
    const prev = _invalidCardStatTraceCache.get(key) || 0;
    if (now - prev < 1000) return true;
    _invalidCardStatTraceCache.set(key, now);
    if (_invalidCardStatTraceCache.size > 600) {
        _invalidCardStatTraceCache.clear();
    }

    const payload = {
        source,
        owner: meta.owner ?? null,
        row: meta.row ?? null,
        col: meta.col ?? null,
        phase: state?.phase ?? null,
        turn: state?.turn ?? null,
        uid: card.uid || null,
        id: card.id || null,
        name: card.name || null,
        type: card.type || null,
        atk: card.atk ?? null,
        hp: card.hp ?? null,
        currentHp: card.currentHp ?? null,
        baseAtk: card.baseAtk ?? null,
        baseHp: card.baseHp ?? null,
        inHand: meta.inHand ?? null,
    };
    if (typeof window.visTrace === 'function') {
        window.visTrace('card:invalid-stats', payload);
    }
    if (window.DEBUG_LOGS) {
        console.warn('[CARD-INVALID-STATS]', payload);
    }
    return true;
}

// --- DELTA RENDER (Niveau 2) ---
// Rendu chirurgical : ne met à jour que les zones qui ont changé dans le state.
// Utilisé pendant la phase de résolution pour éviter les reconstructions DOM massives.
function renderDelta(d) {
    if (!state || !d) { render(); return; }
    if (d.full || d.phaseChanged) { render(); return; }

    const me = state.me, opp = state.opponent;
    const dom = _getDomEls();

    // Check si un heroHit/heroHeal est en queue (bloquer le delta pour laisser l'anim gérer)
    const _deltaHeroBlock = { me: false, opp: false };
    if (typeof animationQueue !== 'undefined' && Array.isArray(animationQueue)) {
        for (const item of animationQueue) {
            if (!item) continue;
            const t = item.type, dd = item.data || {};
            if (t === 'heroHit' || t === 'trampleHeroHit') {
                const defNum = dd.defender;
                if (defNum === (typeof myNum !== 'undefined' ? myNum : -1)) _deltaHeroBlock.me = true;
                else _deltaHeroBlock.opp = true;
            }
            if (t === 'onDeathDamage' && dd.targetRow === undefined) {
                const tpNum = dd.targetPlayer;
                if (tpNum === (typeof myNum !== 'undefined' ? myNum : -1)) _deltaHeroBlock.me = true;
                else _deltaHeroBlock.opp = true;
            }
            if (t === 'heroHeal' || (t === 'lifesteal' && dd.heroHeal)) {
                const plNum = dd.player;
                if (plNum === (typeof myNum !== 'undefined' ? myNum : -1)) _deltaHeroBlock.me = true;
                else _deltaHeroBlock.opp = true;
            }
            if (t === 'zdejebel') {
                const tpNum = dd.targetPlayer;
                if (tpNum === (typeof myNum !== 'undefined' ? myNum : -1)) _deltaHeroBlock.me = true;
                else _deltaHeroBlock.opp = true;
            }
        }
    }

    // Hero HP (seulement si pas locked ET pas d'anim hero en queue)
    if (d.meHp !== undefined && !RenderLock.isLocked('heroHp', 'all') && !RenderLock.isLocked('heroHp', 'me') && !_deltaHeroBlock.me) {
        const hpVal = Math.max(0, Math.floor(d.meHp));
        if (dom.meHpNum) {
            _traceHp('hero-me', dom.meHpNum.textContent, hpVal, 'renderDelta');
            dom.meHpNum.textContent = String(hpVal);
        }
    }
    if (d.oppHp !== undefined && !RenderLock.isLocked('heroHp', 'all') && !RenderLock.isLocked('heroHp', 'opp') && !_deltaHeroBlock.opp) {
        const hpVal = Math.max(0, Math.floor(d.oppHp));
        if (dom.oppHpNum) {
            _traceHp('hero-opp', dom.oppHpNum.textContent, hpVal, 'renderDelta');
            dom.oppHpNum.textContent = String(hpVal);
        }
    }

    // Mana
    if (d.meMana) {
        if (dom.meManaPill) {
            dom.meManaPill.innerHTML = `${d.meMana.energy}<span class="slash">/</span>${d.meMana.max}`;
            dom.meManaPill.classList.toggle('empty', d.meMana.energy <= 0);
        }
    }
    if (d.oppMana) {
        if (dom.oppManaPill) {
            dom.oppManaPill.innerHTML = `${d.oppMana.energy}<span class="slash">/</span>${d.oppMana.max}`;
            dom.oppManaPill.classList.toggle('empty', d.oppMana.energy <= 0);
        }
    }

    // Deck counts
    if (d.meDeckCount !== undefined) {
        if (dom.meDeckTooltip) dom.meDeckTooltip.textContent = d.meDeckCount + (d.meDeckCount > 1 ? ' cartes' : ' carte');
        updateDeckDisplay('me', d.meDeckCount);
    }
    if (d.oppDeckCount !== undefined) {
        if (dom.oppDeckTooltip) dom.oppDeckTooltip.textContent = d.oppDeckCount + (d.oppDeckCount > 1 ? ' cartes' : ' carte');
        updateDeckDisplay('opp', d.oppDeckCount);
    }

    // Graveyard (only if data changed and not locked)
    if (d.meGraveyard && !RenderLock.isLocked('grave', 'me')) {
        const meGraveCount = me.graveyardCount || 0;
        if (dom.meGraveTooltip) dom.meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
        updateGraveTopCard('me', me.graveyard);
        updateGraveDisplay('me', me.graveyard);
    }
    if (d.oppGraveyard && !RenderLock.isLocked('grave', 'opp')) {
        const oppGraveCount = opp.graveyardCount || 0;
        if (dom.oppGraveTooltip) dom.oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');
        updateGraveTopCard('opp', opp.graveyard);
        updateGraveDisplay('opp', opp.graveyard);
    }

    // Field: only re-render if any slots changed
    if (d.fieldChanges && d.fieldChanges.length > 0) {
        const activeShieldKeys = new Set();
        const activeCamoKeys = new Set();
        renderField('me', me.field, activeShieldKeys, activeCamoKeys);
        renderField('opp', opp.field, activeShieldKeys, activeCamoKeys);
        _syncPixiBoard();
        CombatVFX.syncShields(activeShieldKeys);
        CombatVFX.syncCamouflages(activeCamoKeys);
    }

    // Traps
    if (d.meTrapsChanged || d.oppTrapsChanged) {
        renderTraps();
    }

    // Hand: only if changed
    if (d.meHandChanged) {
        renderHand(me.hand, me.energy);
    }
    if (d.oppHandChanged) {
        renderOppHand(opp.handCount, opp.oppHand);
    }

    // Draw animations
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.startPendingDrawAnimations();
    }

    // CardGlow
    if (typeof CardGlow !== 'undefined') CardGlow.markDirty();
}

function render() {
    if (!state) return;
    const __perfRenderStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (typeof CardGlow !== 'undefined') CardGlow.markDirty();
    const me = state.me, opp = state.opponent;
    const dom = _getDomEls();
    if (typeof window.visTrace === 'function') {
        window.visTrace('render:start', {
            state: typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null,
            dom: typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null,
        });
    }

    // Ne pas mettre à jour les HP si une animation zdejebel/trample est en cours ou en attente
    const mePlayerNum = Number(myNum || state?.myPlayer || 1);
    const oppPlayerNum = mePlayerNum === 1 ? 2 : 1;
    const _clampHeroHp = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
    };
    const hpBlockedByActiveAnim = { me: false, opp: false };
    const _markHeroHpBlock = (t, d, out) => {
        if (!t || !out) return;
        const data = d || {};
        if (t === 'heroHit' || t === 'trampleHeroHit') {
            if (data.defender === mePlayerNum) out.me = true;
            if (data.defender === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'zdejebel') {
            if (data.targetPlayer === mePlayerNum) out.me = true;
            if (data.targetPlayer === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'heroHeal') {
            if (data.player === mePlayerNum) out.me = true;
            if (data.player === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'lifesteal' && data.heroHeal) {
            if (data.player === mePlayerNum) out.me = true;
            if (data.player === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'onDeathDamage' && data.targetRow === undefined) {
            if (data.targetPlayer === mePlayerNum) out.me = true;
            if (data.targetPlayer === oppPlayerNum) out.opp = true;
        }
    };

    const _markHeroHpBlockFromQueue = (out) => {
        if (!out || !Array.isArray(animationQueue)) return;
        for (const item of animationQueue) {
            if (!item) continue;
            const t = item.type;
            const d = item.data || {};
            if (t === 'heroHit' || t === 'trampleHeroHit') {
                if (d.defender === mePlayerNum) out.me = true;
                if (d.defender === oppPlayerNum) out.opp = true;
                continue;
            }
            if (t === 'zdejebel') {
                if (d.targetPlayer === mePlayerNum) out.me = true;
                if (d.targetPlayer === oppPlayerNum) out.opp = true;
                continue;
            }
            if (t === 'heroHeal') {
                if (d.player === mePlayerNum) out.me = true;
                if (d.player === oppPlayerNum) out.opp = true;
                continue;
            }
            if (t === 'lifesteal' && d.heroHeal) {
                if (d.player === mePlayerNum) out.me = true;
                if (d.player === oppPlayerNum) out.opp = true;
                continue;
            }
            if (t === 'onDeathDamage' && d.targetRow === undefined) {
                if (d.targetPlayer === mePlayerNum) out.me = true;
                if (d.targetPlayer === oppPlayerNum) out.opp = true;
            }
        }
    };
    _markHeroHpBlock(window.__activeAnimType, window.__activeAnimData, hpBlockedByActiveAnim);
    _markHeroHpBlockFromQueue(hpBlockedByActiveAnim);
    // Ne pas geler globalement les HP pour lifesteal/heroHeal:
    // on bloque seulement pendant l'animation HP active pour éviter les retards visibles.
    const hpBlockedGlobal = RenderLock.isLocked('heroHp', 'all');
    const hpBlockedMe = hpBlockedGlobal || hpBlockedByActiveAnim.me || RenderLock.isLocked('heroHp', 'me');
    const hpBlockedOpp = hpBlockedGlobal || hpBlockedByActiveAnim.opp || RenderLock.isLocked('heroHp', 'opp');
    const hasHpAnimPending = hpBlockedMe || hpBlockedOpp;
    if (!hpBlockedMe) {
        if (dom.meHpNum) {
            _traceHp('hero-me', dom.meHpNum.textContent, _clampHeroHp(me.hp), 'render()', { stateHp: me.hp });
            dom.meHpNum.textContent = String(_clampHeroHp(me.hp));
        }
    }
    if (!hpBlockedOpp) {
        if (dom.oppHpNum) {
            _traceHp('hero-opp', dom.oppHpNum.textContent, _clampHeroHp(opp.hp), 'render()', { stateHp: opp.hp });
            dom.oppHpNum.textContent = String(_clampHeroHp(opp.hp));
        }
    }
    if (dom.meManaPill) {
        dom.meManaPill.innerHTML = `${me.energy}<span class="slash">/</span>${me.maxEnergy}`;
        dom.meManaPill.classList.toggle('empty', me.energy <= 0);
    }
    if (dom.oppManaPill) {
        dom.oppManaPill.innerHTML = `${opp.energy}<span class="slash">/</span>${opp.maxEnergy}`;
        dom.oppManaPill.classList.toggle('empty', opp.energy <= 0);
    }
    // Mettre à jour les tooltips du deck
    if (dom.meDeckTooltip) dom.meDeckTooltip.textContent = me.deckCount + (me.deckCount > 1 ? ' cartes' : ' carte');
    if (dom.oppDeckTooltip) dom.oppDeckTooltip.textContent = opp.deckCount + (opp.deckCount > 1 ? ' cartes' : ' carte');
    // Mettre à jour les tooltips du cimetière
    const meGraveCount = me.graveyardCount || 0;
    const oppGraveCount = opp.graveyardCount || 0;
    if (dom.meGraveTooltip) dom.meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
    if (dom.oppGraveTooltip) dom.oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');
    
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
    const activeCamoKeys = new Set();
    renderField('me', me.field, activeShieldKeys, activeCamoKeys);
    renderField('opp', opp.field, activeShieldKeys, activeCamoKeys);
    _syncPixiBoard();
    CombatVFX.syncShields(activeShieldKeys);
    CombatVFX.syncCamouflages(activeCamoKeys);
    renderTraps();
    renderHand(me.hand, me.energy);

    renderOppHand(opp.handCount, opp.oppHand);

    // Lancer les animations de pioche après les renders
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.startPendingDrawAnimations();
    }
    
    if (me.ready && state.phase === 'planning' && dom.endTurnBtn) {
        dom.endTurnBtn.classList.add('waiting');
    }
    if (typeof window.visTrace === 'function') {
        const __renderEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        window.visTrace('render:end', {
            durationMs: Math.round((__renderEnd - __perfRenderStart) * 100) / 100,
            hpBlocked: !!hasHpAnimPending,
            hpBlockedMe: !!hpBlockedMe,
            hpBlockedOpp: !!hpBlockedOpp,
            state: typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null,
            dom: typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null,
        });
    }
    if (window.PerfMon) {
        const __perfNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        window.PerfMon.recordRender(
            __perfNow - __perfRenderStart,
            (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0
        );
    }
}

// _monitorBattlefield supprimé  boucle RAF inutile (branches vides) qui forçait getBoundingClientRect à 60fps

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

// [LEGACY] graveRenderBlocked/graveReturnAnimActive → migré vers RenderLock.lock('grave', ...)
const pendingSpellReturns = new Map(); // spellId   { handIndex, player } pour sorts qui retournent en main

function updateGraveDisplay(owner, graveyard) {
    if (RenderLock.isLocked('grave', owner)) return;
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
    if (RenderLock.isLocked('grave', owner)) return;
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
    } else {
        if (container.classList.contains('empty') && container.querySelector('.slot-frame')) return;
        delete container.dataset.topCardUid;
        container.classList.add('empty');
        const framePath = 'M4,0 L68,0 L72,-3 L76,0 L140,0 A4,4 0 0,1 144,4 L144,92 L147,96 L144,100 L144,188 A4,4 0 0,1 140,192 L76,192 L72,195 L68,192 L4,192 A4,4 0 0,1 0,188 L0,100 L-3,96 L0,92 L0,4 A4,4 0 0,1 4,0 Z';
        container.innerHTML = `<svg class="slot-frame" viewBox="-4 -4 152 200" aria-hidden="true"><path d="${framePath}" class="slot-frame-outline"/><path d="${framePath}" class="slot-frame-fill"/></svg><div class="slot-center"><img src="/battlefield_elements/graveyard.png" class="slot-icon" alt="" draggable="false"></div>`;
    }
}

function renderField(owner, field, activeShieldKeys, activeCamoKeys) {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const slot = getSlot(owner, r, c);
            if (!slot) continue;

            // Si ce slot est en cours d'animation, ne pas y toucher
            const slotKey = `${owner}-${r}-${c}`;
            if (RenderLock.isLocked('slot', slotKey)) {
                continue;
            }
            const card = field[r][c];
            if (card) {
                _traceInvalidCardStats('renderField:slot', card, { owner, row: r, col: c });
            }
            // Purge des overrides poison stale quand le contenu du slot change.
            {
                const poisonOvPre = RenderLock.getOverride('slot', slotKey);
                if (poisonOvPre && poisonOvPre.hp !== undefined) {
                    const cardUid = card?.uid || null;
                    const ovAge = typeof poisonOvPre.updatedAt === 'number' ? (Date.now() - poisonOvPre.updatedAt) : 0;
                    const staleByUid = !!(poisonOvPre.uid && cardUid && poisonOvPre.uid !== cardUid);
                    const staleByMissingCard = !card;
                    const staleByTimeout = ovAge > 6000;
                    if (staleByUid || staleByMissingCard || staleByTimeout) {
                        RenderLock.clearOverride('slot', slotKey);
                    }
                }
            }
            const existingCardEl = slot.querySelector('.card');
            // Recover missing data-uid from __cardData (cards created by animations may lack it)
            if (existingCardEl && !existingCardEl.dataset.uid && existingCardEl.__cardData?.uid) {
                existingCardEl.dataset.uid = existingCardEl.__cardData.uid;
            }
            const existingUid = existingCardEl?.dataset?.uid;
            const existingName = existingCardEl?.querySelector('.arena-name')?.textContent || existingCardEl?.querySelector('.img-name')?.textContent || '?';

            // Fast path : même carte (uid identique ou même card id), mettre à jour seulement les stats et états
            if (card && existingCardEl && (
                (existingUid && existingUid === card.uid) ||
                (!existingUid && existingCardEl.__cardData && existingCardEl.__cardData.id === card.id)
            )) {
                // Ensure data-uid is set for future fast path matches
                if (!existingCardEl.dataset.uid && card.uid) existingCardEl.dataset.uid = card.uid;
                existingCardEl.__cardData = card;
                const isRadjawak = typeof card.name === 'string' && card.name.toLowerCase().includes('radjawak');

                // Debug: log pour Luciole bicolore

                // Mettre à jour HP
                const hpEl = existingCardEl.querySelector('.arena-armor') || existingCardEl.querySelector('.arena-hp') || existingCardEl.querySelector('.img-hp');
                let hpVal = _toFiniteNumberOrNull(card.currentHp ?? card.hp);
                if (hpVal === null) {
                    _traceInvalidCardStats('renderField:fast-hp', card, { owner, row: r, col: c });
                    const domHpFallback = parseInt(hpEl?.textContent || '', 10);
                    hpVal = Number.isFinite(domHpFallback) ? domHpFallback : 0;
                }
                // Skip si poisonDamage anime ce slot (geler le HP pré-poison)
                const poisonOv = RenderLock.getOverride('slot', slotKey);
                if (poisonOv) {
                    const ovUidMismatch = !!(poisonOv.uid && card.uid && poisonOv.uid !== card.uid);
                    const ovAge = typeof poisonOv.updatedAt === 'number' ? (Date.now() - poisonOv.updatedAt) : 0;
                    const staleConsumed = poisonOv.consumed && ovAge > 2600;
                    if (ovUidMismatch || (poisonOv.consumed && hpVal <= poisonOv.hp) || staleConsumed) {
                        if (window.DEBUG_LOGS || window.HP_SEQ_TRACE) {
                            console.log('[HP-SEQ-DBG] render-poison-override-clear', {
                                slotKey,
                                owner,
                                row: r,
                                col: c,
                                cardUid: card.uid || null,
                                stateHp: hpVal,
                                ovHp: poisonOv.hp ?? null,
                                ovConsumed: poisonOv.consumed ?? null,
                                ovUid: poisonOv.uid ?? null,
                                ovAge,
                                reason: ovUidMismatch ? 'uid_mismatch' : ((poisonOv.consumed && hpVal <= poisonOv.hp) ? 'consumed_caught_up' : 'stale_consumed')
                            });
                        }
                        RenderLock.clearOverride('slot', slotKey);
                    } else {
                        if (window.DEBUG_LOGS || window.HP_SEQ_TRACE) {
                            console.log('[HP-SEQ-DBG] render-poison-override-apply', {
                                slotKey,
                                owner,
                                row: r,
                                col: c,
                                cardUid: card.uid || null,
                                domHp: parseInt(hpEl?.textContent || '', 10),
                                stateHp: hpVal,
                                appliedHp: poisonOv.hp ?? null,
                                ovConsumed: poisonOv.consumed ?? null,
                                ovUid: poisonOv.uid ?? null,
                                ovAge
                            });
                        }
                        hpVal = poisonOv.hp;
                    }
                }
                if (hpEl) {
                    // Avoid showing "0 HP" on-board just before a queued death/deathTransform animation.
                    if (state?.phase === 'resolution' && hpVal <= 0) {
                        const domHpPrev = parseInt(hpEl.textContent || '', 10);
                        hpVal = (Number.isFinite(domHpPrev) && domHpPrev > 0) ? domHpPrev : 1;
                    }
                    const hpStr = String(hpVal);
                    existingCardEl.dataset.stateHp = hpStr;
                    existingCardEl.dataset.stateHpSyncAt = String(Date.now());
                    const domHpNow = parseInt(hpEl.textContent || '', 10);
                    if (Number.isFinite(domHpNow) && domHpNow <= 0 && hpVal > 0) {
                        if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] render-dom-zero uid=${card.uid || '-'} card=${card.name || '?'} slot=${slotKey} domHp=${domHpNow} stateHp=${hpVal} visualDmgHp=${existingCardEl.dataset.visualDmgHp ?? 'none'}`);
                    }
                    // Anti-flicker : si _applyVisualDamage a posé un marqueur, ne pas écraser
                    // avec un state stale (HP plus élevé = dégâts pas encore dans le state)
                    const visualDmgHp = existingCardEl.dataset.visualDmgHp;
                    const visualDmgSetAt = parseInt(existingCardEl.dataset.visualDmgSetAt || '0', 10);
                    const visualDmgExpired = visualDmgHp !== undefined && visualDmgSetAt > 0 && (Date.now() - visualDmgSetAt > 1800);
                    if (visualDmgHp !== undefined && hpVal > parseInt(visualDmgHp) && !visualDmgExpired) {
                        // State stale  garder le visual damage
                        if (parseInt(visualDmgHp, 10) <= 0 && hpVal > 0) {
                            if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] render-stale-keep uid=${card.uid || '-'} card=${card.name || '?'} slot=${slotKey} stateHp=${hpVal} visualDmgHp=${visualDmgHp} domHp=${hpEl.textContent}`);
                        }
                        if (isRadjawak) {
                            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] render-skip-stale card=${card.name} uid=${card.uid} slot=${slotKey} stateHp=${hpVal} visualDmgHp=${visualDmgHp} domHp=${hpEl.textContent}`);
                        }
                    } else {
                        // State a rattrapé le visual damage (ou pas de marqueur)  appliquer
                        if (visualDmgHp !== undefined) delete existingCardEl.dataset.visualDmgHp;
                        if (existingCardEl.dataset.visualDmgSetAt !== undefined) delete existingCardEl.dataset.visualDmgSetAt;
                        if (isRadjawak) {
                            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] render-apply-hp card=${card.name} uid=${card.uid} slot=${slotKey} stateHp=${hpVal} visualDmgHp=${visualDmgHp ?? 'none'} domHpBefore=${hpEl.textContent} expired=${visualDmgExpired}`);
                        }
                        if (hpEl.textContent !== hpStr) {
                            _traceHp(slotKey, hpEl.textContent, hpStr, 'renderField', { card: card.name, uid: card.uid?.slice(-6) });
                            hpEl.textContent = hpStr;
                        }
                        // Classes boosted/reduced (même noms que makeCard)  pas pour les bâtiments
                        if (!card.isBuilding) {
                            const baseHp = _toFiniteNumberOrNull(card.baseHp ?? card.hp);
                            if (baseHp !== null) {
                                hpEl.classList.toggle('boosted', hpVal > baseHp);
                                hpEl.classList.toggle('reduced', hpVal < baseHp);
                            } else {
                                hpEl.classList.remove('boosted');
                                hpEl.classList.remove('reduced');
                            }
                        }
                    }
                }
                // Mettre à jour ATK (pas pour les bâtiments)
                // Skip si powerBuff anime ce slot (mise à jour graduelle en cours)
                if (!card.isBuilding && !(RenderLock.getOverride('slot', slotKey)?.atk !== undefined)) {
                    const atkEl = existingCardEl.querySelector('.arena-atk') || existingCardEl.querySelector('.img-atk');
                    if (atkEl) {
                        let atkVal = _toFiniteNumberOrNull(card.atk);
                        if (atkVal === null) {
                            _traceInvalidCardStats('renderField:fast-atk', card, { owner, row: r, col: c });
                            const domAtkFallback = parseInt(atkEl.textContent || '', 10);
                            atkVal = Number.isFinite(domAtkFallback) ? domAtkFallback : 0;
                        }
                        const atkStr = String(atkVal);
                        if (atkEl.textContent !== atkStr) atkEl.textContent = atkStr;
                        const baseAtk = _toFiniteNumberOrNull(card.baseAtk ?? card.atk);
                        if (baseAtk !== null) {
                            atkEl.classList.toggle('boosted', atkVal > baseAtk);
                            atkEl.classList.toggle('reduced', atkVal < baseAtk);
                        } else {
                            atkEl.classList.remove('boosted');
                            atkEl.classList.remove('reduced');
                        }
                        // Riposte affiche la valeur card.riposte
                        const riposteEl = existingCardEl.querySelector('.arena-riposte');
                        if (riposteEl) {
                            let riposteVal = _toFiniteNumberOrNull(card.riposte);
                            if (riposteVal === null) riposteVal = 0;
                            const riposteStr = String(riposteVal);
                            if (riposteEl.textContent !== riposteStr) riposteEl.textContent = riposteStr;
                            const baseRiposte = _toFiniteNumberOrNull(card.baseRiposte ?? card.riposte);
                            if (baseRiposte !== null) {
                                riposteEl.classList.toggle('boosted', riposteVal > baseRiposte);
                                riposteEl.classList.toggle('reduced', riposteVal < baseRiposte);
                            } else {
                                riposteEl.classList.remove('boosted');
                                riposteEl.classList.remove('reduced');
                            }
                        }
                    }
                }
                // Mettre à jour le texte Poison dynamique (poisonPerGraveyard)
                if (card.poisonPerGraveyard || card.poisonEqualsTotalPoisonInPlay) {
                    const abilitiesEl = existingCardEl.querySelector('.arena-abilities');
                    if (abilitiesEl) {
                        const effectivePoison = _getPoisonDisplayValue(card);
                        const basePoison = _getPoisonBaseValue(card);
                        const poisonClass = effectivePoison > basePoison ? ' class="boosted"' : ' class="stat-value"';
                        abilitiesEl.innerHTML = abilitiesEl.innerHTML.replace(
                            /Poison\s*(<span[^>]*>)?\d+(<\/span>)?/,
                            `Poison <span${poisonClass}>${effectivePoison}</span>`
                        );
                    }
                }
                // Rebind hover/click avec les données fraîches de la carte
                existingCardEl.onmouseenter = (e) => showCardPreview(card, e);
                existingCardEl.onclick = (e) => {
                    e.stopPropagation();
                    if (USE_CLICK_TO_SELECT) {
                        clickSlot(owner, r, c);
                    } else {
                        showCardZoom(card);
                    }
                };
                existingCardEl.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showCardZoom(card); };
                // Mettre à jour les classes d'état sur la carte
                const isJustPlayed = card.turnsOnField === 0 && !card.canAttack;
                existingCardEl.classList.toggle('just-played', isJustPlayed);
                existingCardEl.classList.toggle('can-attack', !!card.canAttack);
                existingCardEl.classList.toggle('petrified', !!card.petrified);
                existingCardEl.classList.toggle('melody-locked', !!card.melodyLocked);
                // Gaze marker (Medusa)  propriété serveur : medusaGazeMarker
                const gazeCount = card.medusaGazeMarker || 0;
                let gazeMarker = existingCardEl.querySelector('.gaze-marker');
                if (gazeCount > 0 && !gazeMarker) {
                    gazeMarker = document.createElement('div');
                    gazeMarker.className = 'gaze-marker marker-pop';
                    gazeMarker.innerHTML = `<div class="gaze-border"></div><span class="gaze-count">${gazeCount}</span>`;
                    existingCardEl.appendChild(gazeMarker);
                } else if (gazeCount > 0 && gazeMarker) {
                    const countEl = gazeMarker.querySelector('.gaze-count');
                    if (countEl && countEl.textContent !== String(gazeCount)) {
                        countEl.textContent = gazeCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (gazeCount === 0 && gazeMarker) {
                    gazeMarker.remove();
                }
                // Poison marker  propriété serveur : poisonCounters
                const poisonCount = card.poisonCounters || 0;
                let poisonMarker = existingCardEl.querySelector('.poison-marker');
                if (poisonCount > 0 && !poisonMarker) {
                    poisonMarker = document.createElement('div');
                    poisonMarker.className = 'poison-marker marker-pop';
                    poisonMarker.innerHTML = `<div class="poison-border"></div><span class="poison-count">${poisonCount}</span>`;
                    existingCardEl.appendChild(poisonMarker);
                } else if (poisonCount > 0 && poisonMarker) {
                    const countEl = poisonMarker.querySelector('.poison-count');
                    if (countEl && countEl.textContent !== String(poisonCount)) {
                        countEl.textContent = poisonCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (poisonCount === 0 && poisonMarker) {
                    poisonMarker.remove();
                }
                // Entrave marker  propriété serveur : entraveCounters
                const entraveCount = card.entraveCounters || 0;
                let entraveMarker = existingCardEl.querySelector('.entrave-marker');
                if (entraveCount > 0 && !entraveMarker) {
                    entraveMarker = document.createElement('div');
                    entraveMarker.className = 'entrave-marker marker-pop';
                    entraveMarker.innerHTML = `<div class="entrave-border"></div><span class="entrave-count">${entraveCount}</span>`;
                    existingCardEl.appendChild(entraveMarker);
                } else if (entraveCount > 0 && entraveMarker) {
                    const countEl = entraveMarker.querySelector('.entrave-count');
                    if (countEl && countEl.textContent !== String(entraveCount)) {
                        countEl.textContent = entraveCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (entraveCount === 0 && entraveMarker) {
                    entraveMarker.remove();
                }
                // Buff marker (Renforcement) propriete serveur : buffCounters
                const buffCount = card.buffCounters || 0;
                let buffMarker = existingCardEl.querySelector('.buff-marker');
                if (buffCount > 0 && !buffMarker) {
                    buffMarker = document.createElement('div');
                    buffMarker.className = 'buff-marker marker-pop';
                    buffMarker.innerHTML = `<span class="buff-count">${buffCount}</span>`;
                    existingCardEl.appendChild(buffMarker);
                } else if (buffCount > 0 && buffMarker) {
                    const countEl = buffMarker.querySelector('.buff-count');
                    if (countEl && countEl.textContent !== String(buffCount)) {
                        countEl.textContent = buffCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (buffCount === 0 && buffMarker) {
                    buffMarker.remove();
                }
                // Positionner les marqueurs verticalement (empilés sur le côté droit)
                const markerBase = 2;
                let markerIdx = 0;
                if (gazeMarker && gazeCount > 0) gazeMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                if (poisonMarker && poisonCount > 0) poisonMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                if (entraveMarker && entraveCount > 0) entraveMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                if (buffMarker && buffCount > 0) buffMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                // Flying animation (sécurité)
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    if (!existingCardEl.classList.contains('flying-creature')) {
                        existingCardEl.classList.add('flying-creature');
                        slot.classList.add('has-flying');
                        startFlyingAnimation(existingCardEl);
                    }
                }
                // Protection / Camouflage VFX
                if (card.hasProtection) {
                    CombatVFX.registerShield(slotKey, existingCardEl);
                    if (activeShieldKeys) activeShieldKeys.add(slotKey);
                }
                if (card.hasCamouflage) {
                    CombatVFX.registerCamouflage(slotKey, existingCardEl);
                    if (activeCamoKeys) activeCamoKeys.add(slotKey);
                }
                // Custom drag pour redéploiement (fast path  réattacher si conditions remplies)
                if (!USE_CLICK_TO_SELECT && owner === 'me' && !state.me.inDeployPhase && !card.isBuilding && !card.movedThisTurn && !card.melodyLocked && !card.petrified) {
                    if (!existingCardEl.dataset.draggable) {
                        existingCardEl.dataset.draggable = '1';
                        CustomDrag.makeDraggable(existingCardEl, {
                            source: 'field',
                            card: card,
                            row: r,
                            col: c,
                            owner: owner
                        });
                    }
                } else {
                    delete existingCardEl.dataset.draggable;
                }
                continue;
            }

            // Slow path : carte différente ou nouveau slot   recréer
            // Différer si la queue d'animation combat est active (makeCard DOM + PIXI GPU = lag)
            if (typeof isAnimating !== 'undefined' && isAnimating) {
                deferredSlots.add(slotKey);
                continue;
            }
            deferredSlots.delete(slotKey);
            const oldCard = slot.querySelector('.card');
            if (oldCard) oldCard.remove();

            if (!card) {
                slot.classList.remove('has-card');
                slot.classList.remove('has-flying');
            }

            if (card) {
                _traceInvalidCardStats('renderField:slow-before-makeCard', card, { owner, row: r, col: c });
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);
                // Stocker le uid pour le fast path
                cardEl.dataset.uid = card.uid || '';
                cardEl.__cardData = card;

                // Ajouter l'effet de lévitation pour les créatures volantes
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    cardEl.classList.add('flying-creature');
                    slot.classList.add('has-flying');
                    startFlyingAnimation(cardEl);
                } else {
                    slot.classList.remove('has-flying');
                }

                // Indicateur de bouclier (Protection)  PixiJS honeycomb
                if (card.hasProtection) {
                    CombatVFX.registerShield(slotKey, cardEl);
                    if (activeShieldKeys) activeShieldKeys.add(slotKey);
                }

                // Effet de camouflage (fumée PixiJS)  même z-index que Protection
                if (card.hasCamouflage) {
                    CombatVFX.registerCamouflage(slotKey, cardEl);
                    if (activeCamoKeys) activeCamoKeys.add(slotKey);
                }

                // Hover preview pour voir la carte en grand
                cardEl.onmouseenter = (e) => showCardPreview(card, e);
                cardEl.onmouseleave = hideCardPreview;
                cardEl.onmousemove = (e) => moveCardPreview(e);

                // Custom drag pour redéploiement (seulement mes cartes)
                if (!USE_CLICK_TO_SELECT && owner === 'me' && !state.me.inDeployPhase && !card.isBuilding && !card.movedThisTurn && !card.melodyLocked && !card.petrified) {
                    CustomDrag.makeDraggable(cardEl, {
                        source: 'field',
                        card: card,
                        row: r,
                        col: c,
                        owner: owner
                    });
                }

                // Clic gauche = clickSlot (click-to-select) ou zoom (drag mode)
                cardEl.onclick = (e) => {
                    e.stopPropagation();
                    if (USE_CLICK_TO_SELECT) {
                        clickSlot(owner, r, c);
                    } else {
                        showCardZoom(card);
                    }
                };
                // Clic droit = zoom
                cardEl.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showCardZoom(card);
                };
                slot.appendChild(cardEl);
            }
        }
    }
}

// Auto-fit : réduit le font-size d'un .arena-name jusqu'à ce que le texte tienne
function fitArenaName(el, _retries) {
    const parent = el.parentElement; // .arena-title
    if (!parent) return;
    const maxW = parent.clientWidth - 4; // marge pour -webkit-text-stroke 2px
    if (maxW <= 0) {
        // Parent pas encore layouté (ex: display:none)   réessayer (max 5 tentatives)
        const retryCount = (_retries || 0) + 1;
        if (retryCount > 5 || !el.isConnected) return;
        requestAnimationFrame(() => fitArenaName(el, retryCount));
        return;
    }
    // Si le nom a déjà un inline fontSize (pré-calculé), ne pas toucher
    if (el.style.fontSize) return;
    // Mesurer la largeur naturelle
    el.style.overflow = 'visible';
    el.style.width = 'max-content';
    const textW = el.offsetWidth;
    el.style.overflow = '';
    el.style.width = '';
    if (textW <= maxW) return;
    // Calculer le ratio puis ajuster en une passe + vérification
    const originalSize = parseFloat(getComputedStyle(el).fontSize);
    const ratio = maxW / textW;
    let size = Math.floor(originalSize * ratio * 10) / 10;
    const minSize = originalSize * 0.35;
    if (size < minSize) size = minSize;
    el.style.fontSize = size + 'px';
    el.style.overflow = 'visible';
    el.style.width = 'max-content';
    while (el.offsetWidth > maxW && size > minSize) {
        size -= 0.3;
        el.style.fontSize = size + 'px';
    }
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

//  Pré-calcul des tailles de nom de carte (Canvas 2D) 
// Mesure le texte via Canvas, indépendant du DOM/layout. Cache le résultat.
const _nameFitCache = new Map();
let _measureCtx = null;

function getNameFitSize(name, hasFaction) {
    const key = hasFaction ? `F|${name}` : `N|${name}`;
    if (_nameFitCache.has(key)) return _nameFitCache.get(key);

    // Vérifier que Bree Serif est chargée (sinon la mesure serait fausse)
    if (!document.fonts.check('9.6px "Bree Serif"')) return null;

    if (!_measureCtx) {
        _measureCtx = document.createElement('canvas').getContext('2d');
    }

    // Taille de base : 0.6em  16px (hérité body) = 9.6px
    const baseSize = 9.6;
    // Largeur dispo dans arena-title pour le texte :
    // Card: var(--card-w) = 144px, arena-title: left:2+right:2   140px
    // Faction : border 2px   136px inner, padding 6px2   124px texte
    // Sans faction : 140px, pas de padding
    // Marge pour -webkit-text-stroke 2px (déborde ~1px de chaque côté)
    const maxW = (hasFaction ? 124 : 140) - 4;

    _measureCtx.font = `${baseSize}px "Bree Serif", serif`;
    // letter-spacing: 0.2px n'est pas capturé par Canvas   l'ajouter manuellement
    const textW = _measureCtx.measureText(name).width + (name.length - 1) * 0.2;

    if (textW <= maxW) {
        _nameFitCache.set(key, null);
        return null;
    }

    // Réduire proportionnellement
    const ratio = maxW / textW;
    let size = Math.floor(baseSize * ratio * 10) / 10;
    const minSize = baseSize * 0.35;
    if (size < minSize) size = minSize;

    // Vérifier avec la taille réduite (le ratio n'est pas parfaitement linéaire)
    _measureCtx.font = `${size}px "Bree Serif", serif`;
    while (_measureCtx.measureText(name).width + (name.length - 1) * 0.2 > maxW && size > minSize) {
        size -= 0.3;
        _measureCtx.font = `${size}px "Bree Serif", serif`;
    }

    const result = size + 'px';
    _nameFitCache.set(key, result);
    return result;
}

// Preview flottante d'une carte
let previewEl = null;
// Descriptions des capacités
const ABILITY_DESCRIPTIONS = {
    fly: { name: 'Vol', desc: 'Cette créature peut attaquer n\'importe quel emplacement adverse, pas seulement celui en face.' },
    shooter: { name: 'Tireur', desc: 'Cette créature peut attaquer à distance sans recevoir de riposte.' },
    haste: { name: 'Célérité', desc: 'Cette créature peut attaquer dès le tour où elle est invoquée.' },
    superhaste: { name: 'Supercélérité', desc: 'Cette créature peut attaquer dès le tour où elle est invoquée et peut se déplacer et attaquer dans le même tour.' },
    intangible: { name: 'Intangible', desc: 'Cette créature ne peut pas être ciblée par les sorts ou les pièges.' },
    trample: { name: 'Piétinement', desc: 'Les dégâts excédentaires sont infligés au héros adverse.' },

    power: { name: 'Puissance', desc: 'Quand cette créature subit des dégâts sans mourir, elle gagne +X ATK (X = valeur de Puissance).' },
    cleave: { name: 'Clivant', desc: 'Quand cette créature attaque, elle inflige X dégâts aux créatures sur les lignes adjacentes. Ces créatures ne ripostent pas.' },
    immovable: { name: 'Immobile', desc: 'Cette créature ne peut pas se déplacer.' },
    provocation: { name: 'Provocation', desc: 'Tant qu\'une créature adverse avec Provocation est en jeu, vos créatures mêlée et tireur doivent être posées en priorité en face d\'elle.' },
    wall: { name: 'Mur', desc: 'Cette créature ne peut pas attaquer.' },
    regeneration: { name: 'Régénération', desc: 'En fin de tour, cette créature récupère X PV (sans dépasser ses PV max).' },
    protection: { name: 'Protection', desc: 'Cette créature est protégée contre la prochaine source de dégâts qu\'elle subirait. Le bouclier est consommé après avoir bloqué une source.' },
    spellBoost: { name: 'Sort renforcé', desc: 'Tant que cette créature est en jeu, vos sorts infligent +X dégâts supplémentaires.' },
    enhance: { name: 'Amélioration', desc: 'Les créatures adjacentes (haut, bas, côté) gagnent +X en attaque tant que cette créature est en jeu.' },
    bloodthirst: { name: 'Soif de sang', desc: 'Chaque fois qu\'une créature ennemie meurt, cette créature gagne +X ATK de façon permanente.' },
    melody: { name: 'Mélodie', desc: 'La première créature ennemie en face ne peut ni attaquer ni se déplacer. Après 2 tours, elle se transforme en pierre.' },
    sacrifice: { name: 'Sacrifice', desc: 'À l\'invocation, sacrifie une créature adjacente pouvant attaquer.' },
    camouflage: { name: 'Camouflage', desc: 'Cette créature ne peut pas être ciblée par les attaques ni les sorts. Les attaquants l\'ignorent et frappent derrière. Se dissipe au début du prochain tour.' },
    lethal: { name: 'Toucher mortel', desc: 'Si cette créature inflige des dégâts à une créature, elle la tue instantanément.' },
    entrave: { name: 'Entrave', desc: 'Quand cette créature inflige des blessures de combat, elle met X marqueur(s) Entrave sur la cible. -1 ATK par marqueur (plancher 0).' },
    lifelink: { name: 'Lien vital', desc: 'Quand cette créature inflige des blessures de combat, votre héros se soigne de X PV (plafonné à 20 PV).' },
    lifedrain: { name: 'Drain de vie', desc: 'Quand cette créature inflige des blessures de combat, elle se soigne de X PV (plafonné aux PV max).' },
    antitoxin: { name: 'Antitoxine', desc: 'Cette créature ne subit pas de dégâts de poison.' },
    soinToxique: { name: 'Soin toxique', desc: 'Le poison soigne cette créature au lieu de lui infliger des dégâts.' },
    deflexion: { name: 'Déflexion', desc: 'Annule le premier sort adverse qui cible spécifiquement cette créature.' },
    unsacrificable: { name: 'Non sacrifiable', desc: 'Cette créature ne peut pas être sacrifiée.' }
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
    const theme = CARD_THEMES[faction] || CARD_THEMES.black;
    const uid = `cs${_cardSvgIdCounter++}`;

    const el = document.createElement('div');
    el.className = `card hero arena-style faction-${faction}`;

    // Rareté star
    const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
    const rarityClass = rarityMap[hero.edition] || 'common';
    const rarity = CARD_RARITIES[rarityClass];

    // Taille de nom pré-calculée
    const fitSize = getNameFitSize(hero.name, true);
    const nameStyle = fitSize ? ` style="font-size:${fitSize}"` : '';

    // Art SVG (background layer)
    const artSvg = `<svg class="card-art-svg" xmlns="http://www.w3.org/2000/svg" viewBox="10 10 505 680" preserveAspectRatio="none">
        <defs><clipPath id="${uid}_clip"><rect x="21" y="20" width="483" height="660" rx="4"/></clipPath></defs>
        <image href="/cards/${hero.image}" x="0" y="0" width="525" height="700" preserveAspectRatio="xMidYMin slice" clip-path="url(#${uid}_clip)"/>
    </svg>`;

    // Frame SVG (overlay layer — border + HP)
    const frameSvg = `<svg class="card-svg" xmlns="http://www.w3.org/2000/svg" viewBox="10 10 505 680" preserveAspectRatio="none">
        <defs>
            <linearGradient id="${uid}_grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="${theme.borderDark}"/>
                <stop offset="50%" stop-color="${theme.borderLight}"/>
                <stop offset="100%" stop-color="${theme.borderDark}"/>
            </linearGradient>
            <linearGradient id="${uid}_redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#f472b6"/>
                <stop offset="50%" stop-color="#e11d48"/>
                <stop offset="100%" stop-color="#be123c"/>
            </linearGradient>
            <filter id="${uid}_statShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="7.5" flood-color="black" flood-opacity="0.1"/>
                <feDropShadow dx="0" dy="1" stdDeviation="0.5" flood-color="black" flood-opacity="0.9"/>
            </filter>
        </defs>
        <path d="${CARD_SVG_BORDER_PATH}" fill="url(#${uid}_grad)" fill-rule="evenodd" stroke="${theme.borderDark}" stroke-width="0.5"/>
        <g class="arena-stat-hp" transform="translate(440, 615) scale(0.4)">
            <circle cx="0" cy="0" r="116" fill="#dddddd75"/>
            <circle cx="0" cy="0" r="100" fill="url(#${uid}_redGrad)"/>
            <text class="arena-hp" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="'Glacial Indifference', sans-serif" font-size="150" font-weight="bold" fill="#efefef" filter="url(#${uid}_statShadow)">${hp}</text>
        </g>
    </svg>`;

    el.innerHTML = `${artSvg}${frameSvg}
        <div class="arena-title"><div class="arena-name"${nameStyle}>${hero.name}</div></div>
        <div class="arena-text-zone">
            <div class="arena-type">Héros</div>
            <div class="arena-separator"></div>
            <div class="arena-special">${hero.ability}</div>
        </div>
        <div class="arena-edition"><span class="rarity-star" style="--rarity-color:${rarity.color};--rarity-bright:${rarity.bright};--rarity-glow:${rarity.glow}0.6);--rarity-duration:${rarity.duration}">&#10022;</span></div>`;

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

    // Bouton oeil pour toggle art-only (comme les créatures)
    if (hero.image) {
        const eyeBtn = document.createElement('div');
        eyeBtn.className = 'zoom-art-toggle';
        eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cardEl.classList.toggle('art-only');
            eyeBtn.classList.toggle('active');
        });
        container.appendChild(eyeBtn);
    }

    zoomCardData = hero;
    overlay.classList.remove('hidden');

    // Auto-fit du nom
    const zoomNameEl = cardEl.querySelector('.arena-name');
    if (zoomNameEl) fitArenaName(zoomNameEl);
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
        const slot = getTrapSlot('me', i);
        if (slot) {
            const trapKey = `me-${i}`;
            const isProtected = RenderLock.isLocked('trap', trapKey);
            if (isProtected) return;
            // Fast path : si l'état du trap n'a pas changé, ne rien faire
            const hadTrap = slot.dataset.trapState === '1';
            const hasTrap = !!trap;
            if (hadTrap === hasTrap) return;

            slot.classList.remove('has-trap', 'mine', 'triggered');
            const content = slot.querySelector('.trap-content');
            if (trap) {
                slot.dataset.trapState = '1';
                slot.classList.add('has-trap', 'mine');
                if (content) {
                    content.innerHTML = '<div class="trap-card-back mine"></div>';
                }
                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
                delete slot.dataset.trapState;
                if (content) content.innerHTML = '';
                slot.onmouseenter = null;
                slot.onmouseleave = null;
                slot.onmousemove = null;
            }
        }
    });

    state.opponent.traps.forEach((trap, i) => {
        const slot = getTrapSlot('opp', i);
        if (slot) {
            const trapKey = `opp-${i}`;
            const isProtected = RenderLock.isLocked('trap', trapKey);
            if (isProtected) return;
            // Fast path : si l'état du trap n'a pas changé, ne rien faire
            const hadTrap = slot.dataset.trapState === '1';
            const hasTrap = !!trap;
            if (hadTrap === hasTrap) return;

            slot.classList.remove('has-trap', 'mine', 'triggered');
            const content = slot.querySelector('.trap-content');
            if (trap) {
                slot.dataset.trapState = '1';
                slot.classList.add('has-trap');
                if (content) {
                    content.innerHTML = '<div class="trap-card-back enemy"></div>';
                }
            } else {
                delete slot.dataset.trapState;
                if (content) content.innerHTML = '';
            }
        }
    });
}

// Signature de la dernière main rendue (pour le fast path)
let _lastHandSig = '';
let _lastCommittedSig = '';
let _lastHandPhase = '';

function _computeHandSig(hand) {
    return hand.map(c => c.uid || c.id).join(',');
}
function _computeCommittedSig() {
    return committedSpells.map(cs => cs.commitId).join(',');
}

function _syncPixiHand(panel) {
    if (!window.PixiHandLayer || !window.PixiHandLayer.isEnabled || !window.PixiHandLayer.isEnabled()) return;
    try {
        window.PixiHandLayer.sync(panel);
    } catch (err) {
        // Keep DOM path functional if Pixi overlay fails.
    }
}

function _syncPixiBoard() {
    if (!window.PixiBoardLayer || !window.PixiBoardLayer.isEnabled || !window.PixiBoardLayer.isEnabled()) return;
    try {
        window.PixiBoardLayer.sync();
    } catch (err) {
        // Keep DOM path functional if Pixi overlay fails.
    }
}

// Fast path : met à jour les classes playable/coût sur les cartes existantes sans recréer le DOM
function _updateHandInPlace(panel, hand, energy) {
    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1 && state.phase === 'planning';
    const totalPoisonCounters = state.me.totalPoisonCounters || 0;
    const canPlayNow = canPlay();
    const existingCards = panel.querySelectorAll('.card:not(.committed-spell)');

    for (let i = 0; i < hand.length && i < existingCards.length; i++) {
        const card = hand[i];
        const el = existingCards[i];
        el.__cardData = card;
        el.style.zIndex = i + 1;
        // Nettoyer les restes de FLIP si un render interrompt une transition.
        if (el.style.transform && el.style.transform.includes('translateX(')) {
            el.style.transform = '';
        }
        if (el.style.transition && el.style.transition.includes('transform')) {
            el.style.transition = '';
        }

        // Recalculer le coût effectif
        let effectiveCost = card.cost;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
        }
        if (card.poisonCostReduction && totalPoisonCounters > 0) {
            effectiveCost = Math.max(0, effectiveCost - totalPoisonCounters);
        }

        // Mettre à jour le coût affiché et la classe discounted
        const isDiscounted = effectiveCost < card.cost;
        const costEl = el.querySelector('.arena-mana') || el.querySelector('.img-cost');
        if (costEl) {
            if (parseInt(el.dataset.cost) !== effectiveCost) costEl.textContent = effectiveCost;
            costEl.classList.toggle('discounted', isDiscounted);
        }
        el.dataset.cost = effectiveCost;

        // Déterminer playable
        let playable = effectiveCost <= energy && canPlayNow;
        if (playable && (card.type === 'creature' || card.type === 'trap') && getValidSlots(card).length === 0) {
            playable = false;
        }
        if (playable && card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) playable = false;
        }
        if (playable && card.requiresGraveyardCreature) {
            const availableCreatures = (state.me.graveyard || []).filter(c =>
                c.type === 'creature' && !committedGraveyardUids.includes(c.uid || c.id)
            );
            if (availableCreatures.length === 0) playable = false;
        }
        if (playable && card.sacrifice && getValidSlots(card).length === 0) playable = false;
        if (playable && card.targetSelfCreature) {
            const hasCreature = state.me.field.some(row => row.some(c => c !== null));
            if (!hasCreature) playable = false;
        }
        if (playable && card.targetAnyCreature) {
            const hasAnyCreature = state.me.field.some(row => row.some(c => c !== null)) || state.opponent.field.some(row => row.some(c => c !== null));
            if (!hasAnyCreature) playable = false;
        }

        el.classList.toggle('playable', playable);

        // Mettre à jour les données de drag (tooExpensive / effectiveCost)
        if (!USE_CLICK_TO_SELECT && el._dragData) {
            el._dragData.tooExpensive = !playable;
            el._dragData.effectiveCost = effectiveCost;
        }

        if (!card.isBuilding) {
            const atkEl = el.querySelector('.arena-atk') || el.querySelector('.img-atk');
            if (atkEl) {
                let atkVal = _toFiniteNumberOrNull(card.atk);
                if (atkVal === null) {
                    const domAtkFallback = parseInt(atkEl.textContent || '', 10);
                    atkVal = Number.isFinite(domAtkFallback) ? domAtkFallback : 0;
                }
                const atkStr = String(atkVal);
                if (atkEl.textContent !== atkStr) atkEl.textContent = atkStr;

                const baseAtk = _toFiniteNumberOrNull(card.baseAtk ?? card.atk);
                if (baseAtk !== null) {
                    atkEl.classList.toggle('boosted', atkVal > baseAtk);
                    atkEl.classList.toggle('reduced', atkVal < baseAtk);
                } else {
                    atkEl.classList.remove('boosted');
                    atkEl.classList.remove('reduced');
                }
            }

            const riposteEl = el.querySelector('.arena-riposte') || el.querySelector('.img-riposte');
            if (riposteEl) {
                let riposteVal = _toFiniteNumberOrNull(card.riposte);
                if (riposteVal === null) {
                    const domRipFallback = parseInt(riposteEl.textContent || '', 10);
                    riposteVal = Number.isFinite(domRipFallback) ? domRipFallback : 0;
                }
                const riposteStr = String(riposteVal);
                if (riposteEl.textContent !== riposteStr) riposteEl.textContent = riposteStr;

                const baseRiposte = _toFiniteNumberOrNull(card.baseRiposte ?? card.riposte);
                if (baseRiposte !== null) {
                    riposteEl.classList.toggle('boosted', riposteVal > baseRiposte);
                    riposteEl.classList.toggle('reduced', riposteVal < baseRiposte);
                } else {
                    riposteEl.classList.remove('boosted');
                    riposteEl.classList.remove('reduced');
                }
            }
        }

        // Mettre à jour le texte Poison dynamique (poisonPerGraveyard)
        if (card.poisonPerGraveyard || card.poisonEqualsTotalPoisonInPlay) {
            const abilitiesEl = el.querySelector('.arena-abilities');
            if (abilitiesEl) {
                const effectivePoison = _getPoisonDisplayValue(card);
                const basePoison = _getPoisonBaseValue(card);
                const poisonClass = effectivePoison > basePoison ? ' class="boosted"' : ' class="stat-value"';
                abilitiesEl.innerHTML = abilitiesEl.innerHTML.replace(
                    /Poison\s*(<span[^>]*>)?\d+(<\/span>)?/,
                    `Poison <span${poisonClass}>${effectivePoison}</span>`
                );
            }
        }

        // Visibility pour animations de pioche (fallback UID si index décalé)
        const shouldHideByIndex = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i);
        const shouldHideByUid = typeof GameAnimations !== 'undefined'
            && typeof GameAnimations.shouldHideCardByUid === 'function'
            && GameAnimations.shouldHideCardByUid('me', card.uid || card.id);
        if (shouldHideByIndex || shouldHideByUid) {
            el.style.visibility = 'hidden';
        } else {
            el.style.visibility = '';
        }

        // Rebind hover/click avec les données fraîches
        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onclick = (e) => {
            e.stopPropagation();
            if (USE_CLICK_TO_SELECT) {
                selectCard(i);
            } else {
                showCardZoom(card);
            }
        };
        if (!el.oncontextmenu) {
            el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showCardZoom(card); };
        }
    }

    // Fast-path: conserver le même empilement visuel que le slow-path
    // en réindexant toutes les cartes (committed incluses) dans l'ordre DOM.
    const allHandCards = panel.querySelectorAll('.card');
    allHandCards.forEach((cardEl, idx) => {
        cardEl.style.zIndex = idx + 1;
        cardEl.style.setProperty('--hand-z', String(idx + 1));

        // Nettoyer d'éventuels résidus FLIP sur les cartes committed.
        if (cardEl.classList.contains('committed-spell')) {
            if (cardEl.style.transform && cardEl.style.transform.includes('translateX(')) {
                cardEl.style.transform = '';
            }
            if (cardEl.style.transition && cardEl.style.transition.includes('transform')) {
                cardEl.style.transition = '';
            }
        }
    });
}

function renderHand(hand, energy) {
    const panel = document.getElementById('my-hand');
    let skipFlipThisPass = false;
    const _handIdxTrackBounce = !!(window.HAND_INDEX_DEBUG && pendingBounce && pendingBounce.owner === 'me');
    if (_handIdxTrackBounce) {
        _bounceRenderDbg('render:me:start', {
            pendingBounce: pendingBounce ? {
                owner: pendingBounce.owner,
                handIndex: pendingBounce.handIndex ?? null,
                targetUid: pendingBounce.targetUid || null,
                targetIndex: pendingBounce.targetIndex ?? null,
                expectAtEnd: !!pendingBounce.expectAtEnd,
                resolved: !!pendingBounce.resolved,
                completed: !!pendingBounce.completed,
                cardUid: pendingBounce.card?.uid || pendingBounce.card?.id || null,
                cardName: pendingBounce.card?.name || null
            } : null,
            stateHand: hand.map((c, i) => ({ i, uid: c?.uid || c?.id || null, name: c?.name || null })),
            domBefore: _handIdxSnapshot(panel, '.card:not(.committed-spell)')
        });
    }

    //  Fast path : même main, mêmes committed spells, même phase   mise à jour in-place 
    const handSig = _computeHandSig(hand);
    const committedSig = _computeCommittedSig();
    const currentPhase = state?.phase || '';
    if (
        handSig === _lastHandSig &&
        committedSig === _lastCommittedSig &&
        currentPhase === _lastHandPhase &&
        handCardRemovedIndex < 0 &&
        !(pendingBounce && pendingBounce.owner === 'me')
    ) {
        _updateHandInPlace(panel, hand, energy);
        _domVisSnapshot(panel, 'renderHand:FAST-PATH');
        if (_handIdxTrackBounce) {
            const _snap = _handIdxSnapshot(panel, '.card:not(.committed-spell)');
            _bounceRenderDbg('render:me:fast-end', {
                stateHand: hand.map((c, i) => ({ i, uid: c?.uid || c?.id || null, name: c?.name || null })),
                domAfter: _snap
            });
            _handIdxEmitAnomalies('render:me:fast-end', _snap);
        }
        _syncPixiHand(panel);
        return;
    }
    _lastHandSig = handSig;
    _lastCommittedSig = committedSig;
    _lastHandPhase = currentPhase;

    //  Slow path : réconciliation (réutilise les éléments existants pour préserver les glow)
    _domVisSnapshot(panel, 'renderHand:BEFORE-slow-path');

    // (FLIP step 1 moved to pre-purge capture above)

    // Supprimer les éléments en trop
    while (panel.children.length > target) {
        panel.lastElementChild.remove();
    }

    // Mettre à jour ou ajouter les éléments manquants
    for (let i = 0; i < target; i++) {
        const revealedCard = oppHand && oppHand[i];
        let el = panel.children[i];

        if (!el) {
            // Ajouter un nouvel élément
            el = createOppHandCard(revealedCard);
            el.style.zIndex = i + 1;
            panel.appendChild(el);
        } else {
            const isRevealedEl = el.classList.contains('opp-revealed');
            const elUid = el.dataset?.uid || '';
            const shouldBeRevealed = !!revealedCard;
            const wrongRevealedUid = shouldBeRevealed && isRevealedEl && revealedCard.uid && elUid !== revealedCard.uid;
            const shouldReplace =
                (shouldBeRevealed && !isRevealedEl) ||
                (!shouldBeRevealed && isRevealedEl) ||
                wrongRevealedUid;

            if (!shouldReplace) {
                // rien à faire
            } else {
                // Remplacer carte cachée/revealed selon l'état attendu
                const newEl = createOppHandCard(revealedCard);
                newEl.style.zIndex = i + 1;
                el.replaceWith(newEl);
            }
        }

        const shouldHide = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i);
        if (panel.children[i]) {
            const isCollapsed = panel.children[i].style.width === '0px';
            panel.children[i].style.visibility = (shouldHide || isCollapsed) ? 'hidden' : '';
        }
    }

    const completedOppBounce = pendingBounce && pendingBounce.owner === 'opp' && pendingBounce.completed;

    // FLIP step 2 : smooth reposition using pre-purge positions
    if (!completedOppBounce) {
        _flipOppHandCards(panel, _prePurgeLefts, 0.35);
    }

    // Bounce : cacher la dernière carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'opp') {
        if (pendingBounce.completed) {
            // Animation terminée  révéler la dernière carte et cleanup
            const allCards = panel.querySelectorAll('.opp-card-back');
            if (!pendingBounce.resolved) checkPendingBounce('opp', allCards);
            const wrapper = pendingBounce.wrapper;
            const targetUid = pendingBounce.expectAtEnd ? null : (pendingBounce.targetUid || pendingBounce.card?.uid || null);
            const targetIndex = pendingBounce.expectAtEnd
                ? (allCards.length > 0 ? allCards.length - 1 : null)
                : (_isValidHandIndexValue(pendingBounce.targetIndex)
                    ? Number(pendingBounce.targetIndex)
                    : (_isValidHandIndexValue(pendingBounce.handIndex) ? Number(pendingBounce.handIndex) : null));
            if (typeof GameAnimations !== 'undefined' && typeof GameAnimations.releaseHiddenCard === 'function') {
                GameAnimations.releaseHiddenCard('opp', targetIndex, targetUid);
            }
            _bounceRenderDbg('render:opp-completed', {
                targetUid,
                targetIndex,
                pendingHandIndex: pendingBounce.handIndex ?? null,
                pendingTargetUid: pendingBounce.targetUid || null,
                pendingTargetIndex: pendingBounce.targetIndex ?? null,
                cards: _handIdxSnapshot(panel, '.opp-card-back')
            });
            pendingBounce = null;
            const hasPreciseTarget = !!targetUid || Number.isFinite(Number(targetIndex));
            if (hasPreciseTarget) {
                revealBounceTargetWithBridge(panel, '.opp-card-back', wrapper, targetUid, targetIndex);
            } else if (wrapper && wrapper.isConnected) {
                wrapper.remove();
            }
        } else {
            const allCards = panel.querySelectorAll('.opp-card-back');
            checkPendingBounce('opp', allCards);
        }
    }
    if (typeof window.visTrace === 'function') {
        window.visTrace('oppHand:render:end', {
            count,
            oldCount,
            domCount: panel.querySelectorAll('.opp-card-back').length,
            hidden: Array.from(panel.querySelectorAll('.opp-card-back')).filter((el) => el.style.visibility === 'hidden').length,
            revealed: panel.querySelectorAll('.opp-revealed').length,
        });
    }
    if (window.HAND_INDEX_DEBUG) {
        const _snap = _handIdxSnapshot(panel, '.opp-card-back');
        _bounceRenderDbg('render:opp:end', {
            count,
            oldCount,
            domAfter: _snap
        });
        _handIdxEmitAnomalies('render:opp:end', _snap);
    }
}

function makeCard(card, inHand, discountedCost = null) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    // Synchroniser l'animation de bordure rotative (évite le redémarrage au re-render)
    el.style.setProperty('--anim-offset', `${(performance.now() / 1000) % 6}s`);
    _traceInvalidCardStats('makeCard', card, { inHand: !!inHand });

    if (!inHand && card.type === 'creature') {
        if (card.turnsOnField === 0 && !card.canAttack) el.classList.add('just-played');
        if (card.canAttack) el.classList.add('can-attack');
        if (card.melodyLocked) {
            el.classList.add('melody-locked');
        }
        if (card.petrified) {
            el.classList.add('petrified');
        }
    }

    const hpNum = _toFiniteNumberOrNull(card.currentHp ?? card.hp);
    const atkNum = _toFiniteNumberOrNull(card.atk);
    const riposteNum = _toFiniteNumberOrNull(card.riposte);
    const hp = card.type === 'creature'
        ? (hpNum !== null ? hpNum : 0)
        : (card.currentHp ?? card.hp ?? '');
    const atkDisplay = card.type === 'creature'
        ? (atkNum !== null ? atkNum : 0)
        : (card.atk ?? '');
    const riposteDisplay = card.type === 'creature'
        ? (riposteNum !== null ? riposteNum : 0)
        : (card.riposte ?? '');

    // Coût affiché (réduit si Hyrule actif)
    const displayCost = discountedCost !== null ? discountedCost : card.cost;
    const costClass = discountedCost !== null ? 'discounted' : '';

    // Classes pour les stats (comparaison avec les stats de BASE)
    // boosted = supérieur à la base (vert), reduced = inférieur à la base (rouge)
    let hpClass = '';
    let atkClass = '';
    let riposteClass = '';
    if (card.type === 'creature') {
        const baseHp = _toFiniteNumberOrNull(card.baseHp ?? card.hp);
        if (baseHp !== null && hpNum !== null && hpNum > baseHp) {
            hpClass = 'boosted';
        } else if (baseHp !== null && hpNum !== null && hpNum < baseHp) {
            hpClass = 'reduced';
        }

        // ATK: comparer atk avec baseAtk (pas pour les bâtiments)
        if (!card.isBuilding) {
            const baseAtk = _toFiniteNumberOrNull(card.baseAtk ?? card.atk);
            if (baseAtk !== null && atkNum !== null && atkNum > baseAtk) {
                atkClass = 'boosted';
            } else if (baseAtk !== null && atkNum !== null && atkNum < baseAtk) {
                atkClass = 'reduced';
            }

            const baseRiposte = _toFiniteNumberOrNull(card.baseRiposte ?? card.riposte);
            if (baseRiposte !== null && riposteNum !== null && riposteNum > baseRiposte) {
                riposteClass = 'boosted';
            } else if (baseRiposte !== null && riposteNum !== null && riposteNum < baseRiposte) {
                riposteClass = 'reduced';
            }
        }
    }

    // Carte style Arena — SVG frame + art clippé + stats SVG
    if (card.arenaStyle && card.image) {
        el.classList.add('arena-style');
        if (card.faction) {
            el.classList.add(`faction-${card.faction}`);
        }
        // Art is now inside SVG — no backgroundImage needed

        const theme = CARD_THEMES[card.faction] || CARD_THEMES.black;
        const uid = `cs${_cardSvgIdCounter++}`;

        // Taille de nom pré-calculée (évite le recalcul runtime)
        const fitSize = getNameFitSize(card.name, !!card.faction);
        const nameStyle = fitSize ? ` style="font-size:${fitSize}"` : '';

        // Capacités communes (sans shooter/fly car déjà dans le type)
        const commonAbilityNames = {
            haste: 'Célérité', superhaste: 'Supercélérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', wall: 'Mur', regeneration: 'Régénération',
            protection: 'Protection', spellBoost: 'Sort renforcé', enhance: 'Amélioration', bloodthirst: 'Soif de sang', melody: 'Mélodie', camouflage: 'Camouflage', lethal: 'Toucher mortel', spectral: 'Spectral', poison: 'Poison', untargetable: 'Inciblable', entrave: 'Entrave', lifelink: 'Lien vital', lifedrain: 'Drain de vie', dissipation: 'Dissipation', antitoxin: 'Antitoxine', soinToxique: 'Soin toxique', unsacrificable: 'Non sacrifiable', provocation: 'Provocation', deflexion: 'Déflexion'
        };
        // Filtrer shooter et fly des capacités affichées
        const addedAbils = card.addedAbilities || [];
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                const isAdded = addedAbils.includes(a);
                if (a === 'cleave') { const v = card.cleaveX || ''; return isAdded ? `<span class="boosted">Clivant ${v}</span>` : `Clivant <span class="stat-value">${v}</span>`; }
                if (a === 'power') { const v = card.powerX || ''; return isAdded ? `<span class="boosted">Puissance ${v}</span>` : `Puissance <span class="stat-value">${v}</span>`; }
                if (a === 'regeneration') { const v = card.regenerationX || ''; return isAdded ? `<span class="boosted">Régénération ${v}</span>` : `Régénération <span class="stat-value">${v}</span>`; }
                if (a === 'spellBoost') { const v = card.spellBoostAmount || ''; return isAdded ? `<span class="boosted">Sort renforcé ${v}</span>` : `Sort renforcé <span class="stat-value">${v}</span>`; }
                if (a === 'enhance') { const v = card.enhanceAmount || ''; return isAdded ? `<span class="boosted">Amélioration ${v}</span>` : `Amélioration <span class="stat-value">${v}</span>`; }
                if (a === 'bloodthirst') { const v = card.bloodthirstAmount || ''; return isAdded ? `<span class="boosted">Soif de sang ${v}</span>` : `Soif de sang <span class="stat-value">${v}</span>`; }
                if (a === 'poison') {
                    const basePoison = _getPoisonBaseValue(card);
                    const effectivePoison = _getPoisonDisplayValue(card);
                    const poisonBoosted = isAdded || effectivePoison > basePoison;
                    const poisonClass = poisonBoosted ? ' class="boosted"' : ' class="stat-value"';
                    return isAdded ? `<span class="boosted">Poison</span> <span${poisonClass}>${effectivePoison}</span>` : `Poison <span${poisonClass}>${effectivePoison}</span>`;
                }
                if (a === 'entrave') { const v = card.entraveX || ''; return isAdded ? `<span class="boosted">Entrave ${v}</span>` : `Entrave <span class="stat-value">${v}</span>`; }
                if (a === 'lifedrain') { const v = card.lifedrainX || ''; return isAdded ? `<span class="boosted">Drain de vie ${v}</span>` : `Drain de vie <span class="stat-value">${v}</span>`; }
                if (a === 'lifelink') { const v = card.lifelinkX || ''; return isAdded ? `<span class="boosted">Lien vital ${v}</span>` : `Lien vital <span class="stat-value">${v}</span>`; }
                const name = commonAbilityNames[a] || a;
                if (isAdded) return `<span class="boosted">${name}</span>`;
                return name;
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
            ogre: 'Ogre',
            spider: 'Araignée',
            parasite: 'Parasite',
            golem: 'Golem',
            plant: 'Plante',
            vampire: 'Vampire',
            insect: 'Insecte'
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

        // Ligne de type complète
        let typeLineText;
        if (card.isBuilding) {
            typeLineText = 'Bâtiment';
            if (creatureTypeName) typeLineText += ` - ${creatureTypeName}`;
        } else {
            typeLineText = `Créature - ${combatTypeText}`;
            if (creatureTypeName) typeLineText += ` - ${creatureTypeName}`;
        }

        // Style du titre (couleur personnalisée si définie)
        const titleStyle = card.titleColor ? `style="background: ${card.titleColor}"` : '';

        // Les sorts et pièges n'ont pas de stats
        const isSpell = card.type === 'spell';
        const isTrap = card.type === 'trap';
        const noStats = isSpell || isTrap;
        if (noStats) el.classList.add('card-spell');
        if (card.isBuilding) el.classList.add('card-building');

        // Rareté — étoile ✦ avec glow pulsé
        const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
        const rarityClass = rarityMap[card.edition] || 'common';
        const rarity = CARD_RARITIES[rarityClass];

        // ============ Art SVG (background layer, z-index 0) ============
        const artSvg = `<svg class="card-art-svg" xmlns="http://www.w3.org/2000/svg" viewBox="10 10 505 680" preserveAspectRatio="none">
            <defs><clipPath id="${uid}_clip"><rect x="21" y="20" width="483" height="660" rx="4"/></clipPath></defs>
            <image href="/cards/${card.image}" x="0" y="0" width="525" height="700" preserveAspectRatio="xMidYMin slice" clip-path="url(#${uid}_clip)"/>
        </svg>`;

        // ============ Frame SVG defs (overlay layer, z-index 8) ============
        const showCreatureStats = !noStats && !card.isBuilding;
        const showBuildingHp = card.isBuilding;

        let frameDefs = `<defs>
            <linearGradient id="${uid}_grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="${theme.borderDark}"/>
                <stop offset="50%" stop-color="${theme.borderLight}"/>
                <stop offset="100%" stop-color="${theme.borderDark}"/>
            </linearGradient>
            <filter id="${uid}_statShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="7.5" flood-color="black" flood-opacity="0.1"/>
                <feDropShadow dx="0" dy="1" stdDeviation="0.5" flood-color="black" flood-opacity="0.9"/>
            </filter>`;
        if (showCreatureStats) {
            frameDefs += `
            <linearGradient id="${uid}_starGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#3a3a3a"/>
                <stop offset="100%" stop-color="#1a1a1a"/>
            </linearGradient>
            <linearGradient id="${uid}_redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#f472b6"/>
                <stop offset="50%" stop-color="#e11d48"/>
                <stop offset="100%" stop-color="#be123c"/>
            </linearGradient>`;
        } else if (showBuildingHp) {
            frameDefs += `
            <linearGradient id="${uid}_armorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#5a5e62"/>
                <stop offset="50%" stop-color="#44484c"/>
                <stop offset="100%" stop-color="#2e3236"/>
            </linearGradient>`;
        }
        frameDefs += '</defs>';

        // ============ SVG stats ============
        let statsSvg = '';
        if (showCreatureStats) {
            statsSvg = `
            <g class="arena-stat-atk" transform="translate(450, 435) scale(0.34)">
                <path d="${CARD_SVG_SPIKED_CIRCLE}" fill="#dddddd75"/>
                <circle cx="0" cy="0" r="95" fill="url(#${uid}_starGrad)"/>
                <text class="arena-atk ${atkClass}" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="'Glacial Indifference', sans-serif" font-size="170" font-weight="bold" fill="#e5e5e5" filter="url(#${uid}_statShadow)">${atkDisplay}</text>
            </g>
            <g class="arena-stat-riposte" transform="translate(450, 534) scale(0.36)">
                <path d="${CARD_SVG_SPIKED_DIAMOND}" fill="#dddddd75"/>
                <path d="${CARD_SVG_SPIKED_DIAMOND_INNER}" fill="url(#${uid}_starGrad)"/>
                <text class="arena-riposte ${riposteClass}" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="'Glacial Indifference', sans-serif" font-size="160" font-weight="bold" fill="#e5e5e5" filter="url(#${uid}_statShadow)">${riposteDisplay}</text>
            </g>
            <g class="arena-stat-hp" transform="translate(450, 629) scale(0.34)">
                <circle cx="0" cy="0" r="116" fill="#dddddd75"/>
                <circle cx="0" cy="0" r="100" fill="url(#${uid}_redGrad)"/>
                <text class="arena-hp ${hpClass}" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="'Glacial Indifference', sans-serif" font-size="170" font-weight="bold" fill="#efefef" filter="url(#${uid}_statShadow)">${hp}</text>
            </g>`;
        } else if (showBuildingHp) {
            statsSvg = `
            <g class="arena-stat-hp" transform="translate(450, 629) scale(0.34)">
                <circle cx="0" cy="0" r="116" fill="#dddddd75"/>
                <circle cx="0" cy="0" r="100" fill="url(#${uid}_armorGrad)"/>
                <text class="arena-armor" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="'Glacial Indifference', sans-serif" font-size="180" font-weight="bold" fill="#efefef" filter="url(#${uid}_statShadow)">${hp}</text>
            </g>`;
        }

        // ============ Frame SVG (border on top, then stats, then mana) ============
        const frameSvg = `<svg class="card-svg" xmlns="http://www.w3.org/2000/svg" viewBox="10 10 505 680" preserveAspectRatio="none">
            ${frameDefs}
            <path d="${CARD_SVG_BORDER_PATH}" fill="url(#${uid}_grad)" fill-rule="evenodd" stroke="${theme.borderDark}" stroke-width="0.5"/>
            ${statsSvg}
            <g class="arena-mana-group" transform="translate(68, 126)">
                <circle cx="0" cy="0" r="32" fill="#d1d1d1" stroke="#d1d1d1" stroke-width="8" stroke-opacity="0.52"/>
                <text class="arena-mana ${costClass}" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="'Glacial Indifference', sans-serif" font-size="58" font-weight="900" fill="#292929">${displayCost}</text>
            </g>
        </svg>`;

        // ============ On-field rendering ============
        if (!inHand) {
            el.classList.add('on-field');
            // Jetons compteurs — empilés verticalement sur le côté droit
            let mkIdx = 0;
            const mkBase = 2;
            const gazeMarker = card.medusaGazeMarker >= 1 ? `<div class="gaze-marker" style="top:${mkBase + mkIdx++ * 28}px">${card.medusaGazeMarker}</div>` : '';
            const poisonMarker = (card.poisonCounters || 0) >= 1 ? `<div class="poison-marker" style="top:${mkBase + mkIdx++ * 28}px"><span class="poison-count">${card.poisonCounters}</span></div>` : '';
            const entraveMarker = (card.entraveCounters || 0) >= 1 ? `<div class="entrave-marker" style="top:${mkBase + mkIdx++ * 28}px"><span class="entrave-count">${card.entraveCounters}</span></div>` : '';
            const buffMarker = (card.buffCounters || 0) >= 1 ? `<div class="buff-marker" style="top:${mkBase + mkIdx++ * 28}px"><span class="buff-count">${card.buffCounters}</span></div>` : '';
            el.innerHTML = `${artSvg}${frameSvg}
                <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                ${gazeMarker}${poisonMarker}${entraveMarker}${buffMarker}`;
            autoFitCardName(el);
            return el;
        }

        // ============ In-hand rendering (full template) ============
        const rarityHtml = rarity ? `<div class="arena-edition"><span class="rarity-star" style="--rarity-color:${rarity.color};--rarity-bright:${rarity.bright};--rarity-glow:${rarity.glow}0.6);--rarity-duration:${rarity.duration}">&#10022;</span></div>` : '';

        if (noStats) {
            let typeName = 'Sort';
            if (isTrap) {
                typeName = 'Piège';
            } else if (card.spellSpeed !== undefined) {
                typeName = `Sort - Vitesse ${card.spellSpeed}`;
            } else if (card.spellType) {
                const spellTypeMap = { offensif: 'Offensif', 'défensif': 'Défensif', hybride: 'Hybride' };
                typeName = `Sort - ${spellTypeMap[card.spellType] || card.spellType}`;
            }
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
            el.innerHTML = `${artSvg}${frameSvg}
                <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeName}</div>
                    <div class="arena-separator"></div>
                    ${spellDescription ? `<div class="arena-special">${spellDescription}</div>` : ''}
                </div>
                ${rarityHtml}`;
        } else {
            // Créature/bâtiment en main — Si pétrifié, remplacer capacités et description
            const displayAbilities = card.petrified ? '' : abilitiesText;
            const displaySpecial = card.petrified ? (card.petrifiedDescription || 'Pétrifié - ne peut ni attaquer ni bloquer.') : specialAbility;
            el.innerHTML = `${artSvg}${frameSvg}
                <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeLineText}</div>
                    <div class="arena-separator"></div>
                    ${displayAbilities ? `<div class="arena-abilities">${displayAbilities}</div>` : ''}
                    ${displaySpecial ? `<div class="arena-special">${displaySpecial}</div>` : ''}
                </div>
                ${rarityHtml}`;
        }
        autoFitCardName(el);
        return el;
    }

    autoFitCardName(el);
    return el;
}


