/**
 * Pixi hand layer — FULL PIXI, self-contained.
 *
 * Receives game state directly via onStateChange(state).
 * Computes playability, layout, hover, selection internally.
 * Click handling via document-level hit-test.
 * No DOM card dependency.
 */
(function () {
    'use strict';

    // ── Layout constants (match old CSS) ──
    var CARD_W = 144, CARD_H = 192;
    var OVERLAP = 56;
    var SPACING = CARD_W - OVERLAP;         // 88px
    var HAND_LEFT = 50;                     // 35px + 15px padding
    var HAND_BOTTOM_OFFSET = 50;            // 50px below viewport
    var HOVER_LIFT = 50;
    var ANIM_SPEED = 12;

    var STATE = {
        enabled: true,
        app: null,
        root: null,
        ready: false,
        initializing: false,
        tickerBound: false,
        mouseX: 0,
        mouseY: 0,
        cards: [],              // {uid, data, view, handIndex, playable, selected, hidden, hovered, ...}
        committedSpells: []     // {commitId, data, view, ...}
    };

    // ── Shared Pixi app ──
    function setCanvasStyle(canvas) {
        if (!canvas) return;
        canvas.style.position = 'fixed';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '55';
    }

    function trackMouse() {
        if (trackMouse._bound) return;
        trackMouse._bound = true;
        window.addEventListener('mousemove', function (evt) {
            STATE.mouseX = evt.clientX;
            STATE.mouseY = evt.clientY;
        }, { passive: true });
    }

    async function ensureSharedApp() {
        var shared = window.__PixiCardOverlayShared;
        if (shared && shared.app && shared.ready) return shared;
        if (shared && shared.initPromise) return shared.initPromise;

        shared = shared || {};
        shared.initPromise = (async function () {
            var app = new PIXI.Application();
            await app.init({
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2)
            });
            app.stage.sortableChildren = true;
            setCanvasStyle(app.canvas);
            document.body.appendChild(app.canvas);
            shared.app = app;
            shared.ready = true;
            return shared;
        })();

        window.__PixiCardOverlayShared = shared;
        return shared.initPromise;
    }

    function resizeApp() {
        if (!STATE.app || !STATE.ready) return;
        STATE.app.renderer.resize(window.innerWidth, window.innerHeight);
        setCanvasStyle(STATE.app.canvas);
    }

    async function ensureInit() {
        if (STATE.ready) return true;
        if (STATE.initializing) return false;
        if (!window.PIXI || !window.PixiCardView) return false;

        STATE.initializing = true;
        try {
            var shared = await ensureSharedApp();
            var app = shared.app;
            if (!shared.handRoot) {
                shared.handRoot = new PIXI.Container();
                shared.handRoot.sortableChildren = true;
                shared.handRoot.zIndex = 20;
                app.stage.addChild(shared.handRoot);
            }
            window.PixiCardView.init({ app: app, stage: shared.handRoot });

            STATE.app = app;
            STATE.root = shared.handRoot;
            STATE.ready = true;
            trackMouse();
            window.addEventListener('resize', resizeApp, { passive: true });
            ensureTicker();
            setupClickHandler();
            return true;
        } catch (err) {
            return false;
        } finally {
            STATE.initializing = false;
        }
    }

    // ── Ticker ──
    function ensureTicker() {
        if (!STATE.app || STATE.tickerBound) return;
        STATE.tickerBound = true;
        STATE.app.ticker.add(function () {
            if (!STATE.enabled || !STATE.ready) return;
            tickAll(STATE.app.ticker.deltaMS / 1000);
        });
    }

    // ── Playability computation (ported from renderHand) ──
    function computePlayability(card, i, s) {
        var me = s.me;
        var energy = me.energy || 0;

        // Effective cost (Hyrule discount, poison reduction)
        var effectiveCost = card.cost;
        var isHyrule = me.hero && me.hero.id === 'hyrule';
        var spellsCast = me.spellsCastThisTurn || 0;
        var hasHyruleDiscount = isHyrule && spellsCast === 1 && s.phase === 'planning';
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
        }
        var totalPoison = me.totalPoisonCounters || 0;
        if (card.poisonCostReduction && totalPoison > 0) {
            effectiveCost = Math.max(0, effectiveCost - totalPoison);
        }

        // Base playability: enough mana + can play
        var canPlayNow = (typeof canPlay === 'function') ? canPlay() : (s.phase === 'planning');
        var playable = effectiveCost <= energy && canPlayNow;

        // No valid slots for creatures/traps
        if (playable && (card.type === 'creature' || card.type === 'trap')) {
            if (typeof getValidSlots === 'function' && getValidSlots(card).length === 0) {
                playable = false;
            }
        }

        // Special summon conditions
        if (playable && card.requiresGraveyardCreatures) {
            var gravCreatures = (me.graveyard || []).filter(function (c) { return c.type === 'creature'; }).length;
            if (gravCreatures < card.requiresGraveyardCreatures) playable = false;
        }
        if (playable && card.requiresGraveyardCreature) {
            var cguids = (typeof committedGraveyardUids !== 'undefined') ? committedGraveyardUids : [];
            var available = (me.graveyard || []).filter(function (c) {
                return c.type === 'creature' && cguids.indexOf(c.uid || c.id) === -1;
            });
            if (available.length === 0) playable = false;
        }
        if (playable && card.sacrifice) {
            if (typeof getValidSlots === 'function' && getValidSlots(card).length === 0) playable = false;
        }
        if (playable && card.targetSelfCreature) {
            var hasCreature = me.field.some(function (row) { return row.some(function (c) { return c !== null; }); });
            if (!hasCreature) playable = false;
        }
        if (playable && card.targetAnyCreature) {
            var hasAny = me.field.some(function (r) { return r.some(function (c) { return c !== null; }); })
                || (s.opponent && s.opponent.field.some(function (r) { return r.some(function (c) { return c !== null; }); }));
            if (!hasAny) playable = false;
        }

        return { playable: playable, effectiveCost: effectiveCost };
    }

    // ── Hidden card detection ──
    function isCardHidden(i, uid, hand) {
        // Animation system hiding
        if (typeof GameAnimations !== 'undefined') {
            if (GameAnimations.shouldHideCard && GameAnimations.shouldHideCard('me', i)) return true;
            if (GameAnimations.shouldHideCardByUid && GameAnimations.shouldHideCardByUid('me', uid)) return true;
        }
        // Pending bounce
        if (typeof pendingBounce !== 'undefined' && pendingBounce && pendingBounce.owner === 'me') {
            var pbUid = pendingBounce.targetUid || (pendingBounce.card && pendingBounce.card.uid) || null;
            if (pbUid && uid && pbUid === uid) return true;
            if (pendingBounce.expectAtEnd && i === hand.length - 1) return true;
            if (pendingBounce.targetIndex != null && Number(pendingBounce.targetIndex) === i) return true;
            if (pendingBounce.handIndex != null && Number(pendingBounce.handIndex) === i) return true;
        }
        return false;
    }

    // ── Layout computation ──
    function computeHandLayout() {
        var baseY = window.innerHeight + HAND_BOTTOM_OFFSET - CARD_H * 0.5;

        for (var i = 0; i < STATE.cards.length; i++) {
            var entry = STATE.cards[i];
            var x = HAND_LEFT + CARD_W * 0.5 + i * SPACING;
            var y = baseY;
            if (entry.selected || entry.hovered) y -= HOVER_LIFT;
            entry.targetX = x;
            entry.targetY = y;
            entry.zIndex = i + 1;
        }

        // Committed spells: after hand cards
        var offset = STATE.cards.length;
        for (var j = 0; j < STATE.committedSpells.length; j++) {
            var cs = STATE.committedSpells[j];
            cs.targetX = HAND_LEFT + CARD_W * 0.5 + (offset + j) * SPACING;
            cs.targetY = baseY;
            cs.zIndex = offset + j + 1;
        }
    }

    // ── Tick ──
    function tickAll(dt) {
        var lerpFactor = Math.min(1, ANIM_SPEED * dt);
        var halfW = CARD_W * 0.5;
        var halfH = CARD_H * 0.5;

        // Determine hovered card (rightmost = highest z wins)
        var hoveredIdx = -1;
        for (var h = STATE.cards.length - 1; h >= 0; h--) {
            var he = STATE.cards[h];
            if (he.hidden || !he.view) continue;
            var hx = he.currentX != null ? he.currentX : he.targetX;
            var hy = he.currentY != null ? he.currentY : he.targetY;
            if (STATE.mouseX >= hx - halfW && STATE.mouseX <= hx + halfW &&
                STATE.mouseY >= hy - halfH && STATE.mouseY <= hy + halfH) {
                hoveredIdx = h;
                break;
            }
        }

        var layoutDirty = false;
        for (var i = 0; i < STATE.cards.length; i++) {
            var entry = STATE.cards[i];
            if (!entry.view || !entry.view.container) continue;

            var wasHovered = entry.hovered;
            entry.hovered = (i === hoveredIdx);
            if (entry.hovered !== wasHovered) layoutDirty = true;

            // Lerp position
            if (entry.currentX == null) entry.currentX = entry.targetX;
            if (entry.currentY == null) entry.currentY = entry.targetY;
            entry.currentX += (entry.targetX - entry.currentX) * lerpFactor;
            entry.currentY += (entry.targetY - entry.currentY) * lerpFactor;

            // Visibility
            entry.view.container.visible = !entry.hidden;

            // Update sprite
            entry.view.setLayout({
                x: entry.currentX,
                y: entry.currentY,
                width: CARD_W,
                height: CARD_H,
                zIndex: entry.hovered ? 100 : (entry.selected ? 101 : entry.zIndex)
            });

            var localX = STATE.mouseX - entry.currentX;
            var localY = STATE.mouseY - entry.currentY;
            entry.view.setPointerLocal(localX, localY, entry.hovered);
            entry.view.update(dt);

            // Glow (exact card-glow.js algorithm via PixiCardGlow)
            if (window.PixiCardGlow) {
                var glowLayers = null;
                if (entry.playable) {
                    if (entry.selected) {
                        glowLayers = PixiCardGlow.ORANGE;
                    } else if (entry.hovered) {
                        glowLayers = PixiCardGlow.WHITE;
                    } else {
                        glowLayers = PixiCardGlow.BLUE;
                    }
                }

                if (glowLayers) {
                    if (!entry.glow) {
                        entry.glow = PixiCardGlow.createGlow(CARD_W, CARD_H, STATE.root);
                    }
                    if (entry.glow) {
                        entry.glow.setLayers(glowLayers);
                        entry.glow.setHovered(entry.hovered);
                        entry.glow.setPosition(entry.currentX, entry.currentY, entry.hovered ? 99 : (entry.selected ? 100 : entry.zIndex - 0.5));
                        entry.glow.setVisible(!entry.hidden);
                    }
                } else {
                    if (entry.glow) {
                        entry.glow.setVisible(false);
                    }
                }
            }
        }

        if (layoutDirty) computeHandLayout();

        // Committed spells
        for (var j = 0; j < STATE.committedSpells.length; j++) {
            var cs = STATE.committedSpells[j];
            if (!cs.view || !cs.view.container) continue;

            if (cs.currentX == null) cs.currentX = cs.targetX;
            if (cs.currentY == null) cs.currentY = cs.targetY;
            cs.currentX += (cs.targetX - cs.currentX) * lerpFactor;
            cs.currentY += (cs.targetY - cs.currentY) * lerpFactor;

            cs.view.container.visible = true;
            cs.view.setLayout({
                x: cs.currentX,
                y: cs.currentY,
                width: CARD_W,
                height: CARD_H,
                zIndex: cs.zIndex
            });
            cs.view.update(dt);

            // Committed spell glow (orange)
            if (window.PixiCardGlow) {
                if (!cs.glow) {
                    cs.glow = PixiCardGlow.createGlow(CARD_W, CARD_H, STATE.root);
                }
                if (cs.glow) {
                    cs.glow.setLayers(PixiCardGlow.ORANGE);
                    cs.glow.setPosition(cs.currentX, cs.currentY, cs.zIndex - 0.5);
                    cs.glow.setVisible(true);
                }
            }
        }
    }

    // ── Click handling ──
    function setupClickHandler() {
        if (setupClickHandler._bound) return;
        setupClickHandler._bound = true;

        document.addEventListener('click', function (e) {
            var hit = hitTest(e.clientX, e.clientY);
            if (!hit) return;
            e.stopPropagation();
            e.preventDefault();
            if (hit.type === 'card') {
                if (typeof selectCard === 'function') selectCard(hit.index);
            } else if (hit.type === 'committed') {
                if (typeof showCardZoom === 'function') showCardZoom(hit.data);
            }
        }, true);

        document.addEventListener('contextmenu', function (e) {
            var hit = hitTest(e.clientX, e.clientY);
            if (!hit) return;
            e.stopPropagation();
            e.preventDefault();
            if (typeof showCardZoom === 'function') showCardZoom(hit.data);
        }, true);
    }

    function hitTest(mx, my) {
        var halfW = CARD_W * 0.5, halfH = CARD_H * 0.5;
        for (var i = STATE.cards.length - 1; i >= 0; i--) {
            var entry = STATE.cards[i];
            if (entry.hidden) continue;
            var cx = entry.currentX != null ? entry.currentX : entry.targetX;
            var cy = entry.currentY != null ? entry.currentY : entry.targetY;
            if (mx >= cx - halfW && mx <= cx + halfW && my >= cy - halfH && my <= cy + halfH) {
                return { type: 'card', index: entry.handIndex, data: entry.data };
            }
        }
        for (var j = STATE.committedSpells.length - 1; j >= 0; j--) {
            var cs = STATE.committedSpells[j];
            var csx = cs.currentX != null ? cs.currentX : cs.targetX;
            var csy = cs.currentY != null ? cs.currentY : cs.targetY;
            if (mx >= csx - halfW && mx <= csx + halfW && my >= csy - halfH && my <= csy + halfH) {
                return { type: 'committed', data: cs.data };
            }
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════════════

    /**
     * onStateChange(s) — called directly from render() / gameStateUpdate.
     * Reads everything from game state, no DOM needed.
     */
    function onStateChange(s) {
        if (!STATE.enabled || !s || !s.me) return;

        var hand = s.me.hand || [];
        var selIdx = -1;
        if (typeof selected !== 'undefined' && selected && selected.fromHand && selected.idx != null) {
            selIdx = selected.idx;
        }
        var committed = (typeof committedSpells !== 'undefined') ? committedSpells : [];

        ensureInit().then(function (ok) {
            if (!ok || !STATE.ready || !STATE.root) return;

            // ── Reconcile hand cards ──
            var oldByUid = new Map();
            for (var k = 0; k < STATE.cards.length; k++) {
                if (STATE.cards[k].uid) oldByUid.set(STATE.cards[k].uid, STATE.cards[k]);
            }

            var newCards = [];
            for (var i = 0; i < hand.length; i++) {
                var card = hand[i];
                var uid = card.uid || card.id || '';
                var info = computePlayability(card, i, s);
                var hidden = isCardHidden(i, uid, hand);
                var existing = oldByUid.get(uid);

                if (existing) {
                    existing.data = card;
                    existing.handIndex = i;
                    existing.selected = (i === selIdx);
                    existing.hidden = hidden;
                    existing.playable = info.playable;
                    existing.effectiveCost = info.effectiveCost;
                    oldByUid.delete(uid);
                    newCards.push(existing);
                } else {
                    var view = window.createCard(card, { inHand: true });
                    STATE.root.addChild(view.container);
                    newCards.push({
                        uid: uid,
                        data: card,
                        view: view,
                        handIndex: i,
                        selected: (i === selIdx),
                        hidden: hidden,
                        playable: info.playable,
                        effectiveCost: info.effectiveCost,
                        hovered: false,
                        targetX: 0, targetY: 0,
                        currentX: null, currentY: null,
                        zIndex: 1,
                        glow: null
                    });
                }
            }

            // Destroy removed cards
            for (var entry of oldByUid.values()) {
                if (entry.glow) entry.glow.destroy();
                if (entry.view) entry.view.destroy();
            }
            STATE.cards = newCards;

            // ── Reconcile committed spells ──
            var oldCsById = new Map();
            for (var m = 0; m < STATE.committedSpells.length; m++) {
                oldCsById.set(STATE.committedSpells[m].commitId, STATE.committedSpells[m]);
            }

            var newCs = [];
            for (var j = 0; j < committed.length; j++) {
                var cs = committed[j];
                var csId = cs.commitId;
                var existingCs = oldCsById.get(csId);
                if (existingCs) {
                    existingCs.data = cs.card;
                    oldCsById.delete(csId);
                    newCs.push(existingCs);
                } else {
                    var csView = window.createCard(cs.card, { inHand: false });
                    STATE.root.addChild(csView.container);
                    newCs.push({
                        commitId: csId,
                        data: cs.card,
                        view: csView,
                        targetX: 0, targetY: 0,
                        currentX: null, currentY: null,
                        zIndex: 1
                    });
                }
            }

            for (var csEntry of oldCsById.values()) {
                if (csEntry.glow) csEntry.glow.destroy();
                if (csEntry.view) csEntry.view.destroy();
            }
            STATE.committedSpells = newCs;

            // Compute positions
            computeHandLayout();
        });
    }

    // Legacy methods — kept for backward compat
    function sync() { /* no-op */ }
    function update(handCards, energy, opts) {
        // Redirect to onStateChange if state is available
        if (typeof state !== 'undefined' && state) {
            onStateChange(state);
        }
    }

    function setEnabled(value) {
        STATE.enabled = !!value;
        if (!STATE.ready || !STATE.app) return;
        STATE.app.canvas.style.display = STATE.enabled ? '' : 'none';
        if (!STATE.enabled) {
            for (var i = 0; i < STATE.cards.length; i++) {
                if (STATE.cards[i].glow) STATE.cards[i].glow.destroy();
                if (STATE.cards[i].view) STATE.cards[i].view.destroy();
            }
            STATE.cards = [];
            for (var j = 0; j < STATE.committedSpells.length; j++) {
                if (STATE.committedSpells[j].view) STATE.committedSpells[j].view.destroy();
            }
            STATE.committedSpells = [];
        }
    }

    function isEnabled() { return STATE.enabled; }

    window.PixiHandLayer = {
        sync: sync,
        update: update,
        onStateChange: onStateChange,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        hitTest: hitTest
    };
})();
