/**
 * Pixi board card layer — FULL PIXI (no DOM card dependency).
 *
 * Canvas is placed INSIDE .game-board to inherit CSS perspective/rotateX.
 * Slot positions read from DOM .card-slot elements (which remain for click handling).
 * Card data received directly via update() — no DOM card elements needed.
 */
(function () {
    'use strict';

    var PAD = 5;

    var STATE = {
        enabled: true,
        app: null,
        root: null,
        boardEl: null,
        viewByKey: new Map(),
        glowByKey: new Map(),
        ready: false,
        initializing: false,
        tickerBound: false
    };

    function resizeApp() {
        if (!STATE.app || !STATE.boardEl) return;
        var w = STATE.boardEl.offsetWidth + PAD * 2;
        var h = STATE.boardEl.offsetHeight + PAD * 2;
        if (w > 0 && h > 0) {
            STATE.app.renderer.resize(w, h);
        }
    }

    // Determine which glow color a slot's card should have
    function resolveGlowLayers(slot) {
        var cl = slot.classList;
        var cardEl = slot.querySelector('.card');
        if (!cardEl) return null;

        // During resolution phase: no glows
        if (typeof state !== 'undefined' && state && state.phase === 'resolution') return null;

        // Spell hover target (orange)
        if (cardEl.classList.contains('spell-hover-target')) {
            return window.PixiCardGlow ? window.PixiCardGlow.ORANGE : null;
        }
        // In combat (purple)
        if (cardEl.getAttribute('data-in-combat') === 'true') {
            return window.PixiCardGlow ? window.PixiCardGlow.PURPLE : null;
        }
        // Spell targetable (blue, orange on hover)
        if (cardEl.classList.contains('spell-targetable')) {
            var isHover = cl.contains('drag-over') || slot.matches(':hover');
            return window.PixiCardGlow ? (isHover ? window.PixiCardGlow.ORANGE : window.PixiCardGlow.BLUE) : null;
        }
        // Can attack and hasn't attacked (green)
        if (cardEl.classList.contains('can-attack') && cardEl.getAttribute('data-has-attacked') !== 'true') {
            return window.PixiCardGlow ? window.PixiCardGlow.GREEN : null;
        }
        return null;
    }

    function updateBoardGlows() {
        if (!window.PixiCardGlow || !window.PixiCardGlow.createBoardGlow) return;

        var allSlots = document.querySelectorAll('.card-slot');
        var activeKeys = new Set();

        for (var i = 0; i < allSlots.length; i++) {
            var slot = allSlots[i];
            var owner = slot.dataset.owner;
            var row = Number(slot.dataset.row);
            var col = Number(slot.dataset.col);
            var slotKey = owner + '-' + row + '-' + col;

            var rec = STATE.viewByKey.get(slotKey);
            if (!rec || !rec.view || !rec.view.container.visible) {
                // No card — destroy glow if exists
                var oldGlow = STATE.glowByKey.get(slotKey);
                if (oldGlow) { oldGlow.destroy(); STATE.glowByKey.delete(slotKey); }
                continue;
            }

            var layers = resolveGlowLayers(slot);
            if (!layers) {
                // No glow needed
                var g = STATE.glowByKey.get(slotKey);
                if (g) { g.setVisible(false); }
                continue;
            }

            activeKeys.add(slotKey);

            var glow = STATE.glowByKey.get(slotKey);
            if (!glow) {
                glow = window.PixiCardGlow.createBoardGlow(
                    slot.offsetWidth, slot.offsetHeight, STATE.root
                );
                if (!glow) continue;
                STATE.glowByKey.set(slotKey, glow);
            }

            glow.setLayers(layers);

            // Position glow centered on the card
            var pos = getSlotPos(slot);
            var cx = pos.x + pos.w * 0.5 + PAD;
            var cy = pos.y + pos.h * 0.5 + PAD;
            var cardZ = Number(slot.style.zIndex || 1) || 1;
            glow.setPosition(cx, cy, cardZ - 0.5);
            glow.setVisible(true);
        }

        // Destroy glows for cards no longer present
        for (var entry of STATE.glowByKey.entries()) {
            if (!activeKeys.has(entry[0]) && !STATE.viewByKey.has(entry[0])) {
                entry[1].destroy();
                STATE.glowByKey.delete(entry[0]);
            }
        }
    }

    function ensureTicker() {
        if (!STATE.app || STATE.tickerBound) return;
        STATE.tickerBound = true;
        STATE.app.ticker.add(function () {
            if (!STATE.enabled || !STATE.ready) return;
            var dt = STATE.app.ticker.deltaMS / 1000;
            for (var rec of STATE.viewByKey.values()) {
                if (rec.view && rec.view.update) rec.view.update(dt);
            }
            // Update board card glows every frame (resolves DOM classes)
            updateBoardGlows();
        });
    }

    async function ensureInit() {
        if (STATE.ready) return true;
        if (STATE.initializing) return false;
        if (!window.PIXI || !window.PixiCardView) return false;

        var boardEl = document.querySelector('.game-board');
        if (!boardEl || boardEl.offsetWidth === 0) return false;

        STATE.initializing = true;
        try {
            STATE.boardEl = boardEl;
            var w = boardEl.offsetWidth + PAD * 2;
            var h = boardEl.offsetHeight + PAD * 2;
            var dpr = Math.min(window.devicePixelRatio || 1, 2);

            var app = new PIXI.Application();
            await app.init({
                width: w,
                height: h,
                backgroundAlpha: 0,
                antialias: true,
                resolution: dpr,
                autoDensity: true
            });

            var cv = app.canvas;
            cv.style.position = 'absolute';
            cv.style.top = -PAD + 'px';
            cv.style.left = -PAD + 'px';
            cv.style.pointerEvents = 'none';
            cv.style.zIndex = '5';
            cv.classList.add('pixi-board-cards-canvas');

            boardEl.insertBefore(cv, boardEl.firstChild);

            app.stage.sortableChildren = true;
            var root = new PIXI.Container();
            root.sortableChildren = true;
            app.stage.addChild(root);

            window.PixiCardView.init({ app: app, stage: root });

            STATE.app = app;
            STATE.root = root;
            STATE.ready = true;
            window.addEventListener('resize', resizeApp, { passive: true });
            ensureTicker();
            return true;
        } catch (err) {
            console.error('[PixiBoardLayer] init error:', err);
            return false;
        } finally {
            STATE.initializing = false;
        }
    }

    // Get slot position relative to board element
    function getSlotPos(slot) {
        var x = 0, y = 0, cur = slot;
        while (cur && cur !== STATE.boardEl) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x: x, y: y, w: slot.offsetWidth, h: slot.offsetHeight };
    }

    // Build a visual signature for change detection
    function cardSig(c) {
        if (!c) return '';
        var hp = c.currentHp != null ? c.currentHp : (c.hp || '');
        var atk = c.atk || '';
        var ab = Array.isArray(c.abilities) ? c.abilities.join(',') : '';
        var markers = [
            c.medusaGazeMarker || 0,
            c.poisonCounters || 0,
            c.entraveCounters || 0,
            c.buffCounters || 0
        ].join(',');
        return [c.uid || c.id || '', c.name || '', c.image || '', c.type || '',
                c.cost, atk, hp, ab, markers].join('|');
    }

    /**
     * update(myField, oppField)
     * Called from renderField() with field arrays.
     * Each field is a 4×2 array (4 rows, 2 cols) of card objects or null.
     */
    function update(myField, oppField) {
        if (!STATE.enabled) return;

        ensureInit().then(function (ok) {
            if (!ok || !STATE.ready || !STATE.root) return;

            var keep = new Set();

            // Process all slots
            var allSlots = document.querySelectorAll('.card-slot');
            for (var i = 0; i < allSlots.length; i++) {
                var slot = allSlots[i];
                var owner = slot.dataset.owner;
                var row = Number(slot.dataset.row);
                var col = Number(slot.dataset.col);

                // Get card data from field arrays
                var field = (owner === 'me') ? myField : oppField;
                var card = (field && field[row]) ? field[row][col] : null;

                var slotKey = owner + '-' + row + '-' + col;

                if (!card) {
                    // No card in this slot — remove if existing
                    var existing = STATE.viewByKey.get(slotKey);
                    if (existing) {
                        existing.view.destroy();
                        STATE.viewByKey.delete(slotKey);
                    }
                    // Remove glow too
                    var oldGlow = STATE.glowByKey.get(slotKey);
                    if (oldGlow) { oldGlow.destroy(); STATE.glowByKey.delete(slotKey); }
                    continue;
                }

                var sig = cardSig(card);
                keep.add(slotKey);

                var rec = STATE.viewByKey.get(slotKey);
                if (rec) {
                    if (rec.sig !== sig) {
                        // Card changed — recreate
                        rec.view.destroy();
                        var newView = window.createCard(card, { inHand: false });
                        STATE.root.addChild(newView.container);
                        rec.view = newView;
                        rec.sig = sig;
                        rec.data = card;
                    }
                } else {
                    // New card
                    var view = window.createCard(card, { inHand: false });
                    STATE.root.addChild(view.container);
                    rec = { view: view, sig: sig, data: card };
                    STATE.viewByKey.set(slotKey, rec);
                }

                // Position from slot DOM element (slot stays in DOM for click handling)
                var pos = getSlotPos(slot);
                rec.view.container.visible = true;
                rec.view.setLayout({
                    x: pos.x + pos.w * 0.5 + PAD,
                    y: pos.y + pos.h * 0.5 + PAD,
                    width: pos.w,
                    height: pos.h,
                    zIndex: Number(slot.style.zIndex || 1) || 1,
                    hoverScale: 1.0
                });
            }

            // Remove cards no longer on the field
            for (var entry of STATE.viewByKey.entries()) {
                if (keep.has(entry[0])) continue;
                entry[1].view.destroy();
                STATE.viewByKey.delete(entry[0]);
                // Remove associated glow
                var gl = STATE.glowByKey.get(entry[0]);
                if (gl) { gl.destroy(); STATE.glowByKey.delete(entry[0]); }
            }
        });
    }

    // Legacy sync — now routes through update using current state
    function sync() {
        if (typeof state === 'undefined' || !state) return;
        var myField = state.me ? state.me.field : [];
        var oppField = state.opponent ? state.opponent.field : [];
        update(myField, oppField);
    }

    function setEnabled(value) {
        STATE.enabled = !!value;
        if (!STATE.ready || !STATE.app) return;
        STATE.app.canvas.style.display = STATE.enabled ? '' : 'none';
        if (!STATE.enabled) {
            for (var rec of STATE.viewByKey.values()) {
                rec.view.destroy();
            }
            STATE.viewByKey.clear();
            for (var gl of STATE.glowByKey.values()) {
                gl.destroy();
            }
            STATE.glowByKey.clear();
        } else {
            sync();
        }
    }

    function isEnabled() {
        return STATE.enabled;
    }

    window.PixiBoardLayer = {
        sync: sync,
        update: update,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        getApp: function () { return STATE.app; },
        getRoot: function () { return STATE.root; },
        getBoardEl: function () { return STATE.boardEl; },
        isReady: function () { return STATE.ready; },
        ensureInit: ensureInit
    };
})();
