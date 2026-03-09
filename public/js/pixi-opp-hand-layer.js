/**
 * Pixi opponent hand layer.
 *
 * Renders card backs (and revealed cards) as GPU sprites.
 * Reads positions from DOM .opp-card-back elements (which remain invisible for logic).
 * Uses the shared overlay canvas (position: fixed, full viewport).
 */
(function () {
    'use strict';

    var CARD_W = 144, CARD_H = 192;

    var STATE = {
        enabled: true,
        app: null,
        root: null,
        ready: false,
        initializing: false,
        tickerBound: false,
        cardbackTexture: null,
        views: []       // {el, sprite/view, isRevealed, uid}
    };

    async function ensureInit() {
        if (STATE.ready) return true;
        if (STATE.initializing) return false;
        if (!window.PIXI) return false;

        STATE.initializing = true;
        try {
            // Reuse the shared overlay app (same as pixi-hand-layer)
            var shared = window.__PixiCardOverlayShared;
            if (!shared || !shared.app || !shared.ready) {
                // Wait for hand layer to init the shared app
                STATE.initializing = false;
                return false;
            }

            var app = shared.app;
            if (!shared.oppHandRoot) {
                shared.oppHandRoot = new PIXI.Container();
                shared.oppHandRoot.sortableChildren = true;
                shared.oppHandRoot.zIndex = 15; // below hand cards (20)
                app.stage.addChild(shared.oppHandRoot);
            }

            STATE.app = app;
            STATE.root = shared.oppHandRoot;

            // Load cardback texture
            STATE.cardbackTexture = await PIXI.Assets.load('/cardback/back_1.png');

            STATE.ready = true;
            ensureTicker();
            return true;
        } catch (err) {
            return false;
        } finally {
            STATE.initializing = false;
        }
    }

    function ensureTicker() {
        if (!STATE.app || STATE.tickerBound) return;
        STATE.tickerBound = true;
        STATE.app.ticker.add(function () {
            if (!STATE.enabled || !STATE.ready) return;
            tickAll();
        });
    }

    function tickAll() {
        // Read DOM positions and update sprites
        for (var i = 0; i < STATE.views.length; i++) {
            var v = STATE.views[i];
            if (!v.el || !v.el.isConnected) {
                // Element removed from DOM
                if (v.sprite) { v.sprite.destroy(); v.sprite = null; }
                if (v.cardView) { v.cardView.destroy(); v.cardView = null; }
                continue;
            }

            var rect = v.el.getBoundingClientRect();
            if (rect.width <= 1 || rect.height <= 1) {
                if (v.sprite) v.sprite.visible = false;
                if (v.cardView) v.cardView.container.visible = false;
                continue;
            }

            var cx = rect.left + rect.width * 0.5;
            var cy = rect.top + rect.height * 0.5;

            if (v.isRevealed && v.cardView) {
                v.cardView.container.visible = true;
                v.cardView.setLayout({
                    x: cx, y: cy,
                    width: rect.width, height: rect.height,
                    zIndex: Number(v.el.style.zIndex || 1) || 1,
                    hoverScale: 1.0
                });
                v.cardView.update(STATE.app.ticker.deltaMS / 1000);
            } else if (v.sprite) {
                v.sprite.visible = true;
                v.sprite.anchor.set(0.5);
                v.sprite.position.set(cx, cy);
                v.sprite.width = rect.width;
                v.sprite.height = rect.height;
                v.sprite.zIndex = Number(v.el.style.zIndex || 1) || 1;
            }
        }
    }

    function sync() {
        if (!STATE.enabled) return;

        ensureInit().then(function (ok) {
            if (!ok || !STATE.ready || !STATE.root) return;

            var panel = document.getElementById('opp-hand');
            if (!panel) return;

            var domCards = panel.querySelectorAll('.opp-card-back');
            var oldByEl = new Map();
            for (var k = 0; k < STATE.views.length; k++) {
                if (STATE.views[k].el) oldByEl.set(STATE.views[k].el, STATE.views[k]);
            }

            var newViews = [];
            for (var i = 0; i < domCards.length; i++) {
                var el = domCards[i];
                var isRevealed = el.classList.contains('opp-revealed');
                var uid = el.dataset.uid || '';

                var existing = oldByEl.get(el);
                if (existing) {
                    // Check if revealed state changed
                    if (existing.isRevealed !== isRevealed || (isRevealed && existing.uid !== uid)) {
                        // Destroy old and recreate
                        if (existing.sprite) { existing.sprite.destroy(); existing.sprite = null; }
                        if (existing.cardView) { existing.cardView.destroy(); existing.cardView = null; }
                        existing = null;
                    } else {
                        oldByEl.delete(el);
                        newViews.push(existing);
                        continue;
                    }
                }

                var view = { el: el, sprite: null, cardView: null, isRevealed: isRevealed, uid: uid };

                if (isRevealed && el.__cardData && window.createCard) {
                    // Revealed card: use Pixi card renderer
                    view.cardView = window.createCard(el.__cardData, { inHand: true });
                    STATE.root.addChild(view.cardView.container);
                } else {
                    // Card back: simple sprite
                    var sprite = new PIXI.Sprite(STATE.cardbackTexture);
                    sprite.anchor.set(0.5);
                    sprite.width = CARD_W;
                    sprite.height = CARD_H;
                    STATE.root.addChild(sprite);
                    view.sprite = sprite;
                }

                newViews.push(view);
            }

            // Destroy removed views
            for (var entry of oldByEl.values()) {
                if (entry.sprite) entry.sprite.destroy();
                if (entry.cardView) entry.cardView.destroy();
            }

            STATE.views = newViews;
        });
    }

    function setEnabled(value) {
        STATE.enabled = !!value;
    }

    function isEnabled() { return STATE.enabled; }

    window.PixiOppHandLayer = {
        sync: sync,
        setEnabled: setEnabled,
        isEnabled: isEnabled
    };
})();
