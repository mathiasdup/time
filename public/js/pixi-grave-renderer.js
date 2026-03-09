/**
 * pixi-grave-renderer.js
 * Renders graveyard stacks (3 card layers + top card) in the board Pixi canvas.
 * Shares the PIXI.Application from pixi-board-layer.js.
 * DOM grave layers are hidden via CSS once Pixi is active.
 */
(function () {
    'use strict';

    var PAD = 5;
    var SLOT_W = 144, SLOT_H = 192;

    // Layer configs: Y offset and tint per layer (3 layers)
    // layer 0 (bottom): 3px offset, brightness 0.8
    // layer 1 (mid):    2px offset, brightness 0.9
    // layer 2 (top):    1px offset, brightness 1.0
    var LAYER_OFFSETS = [3, 2, 1];
    var LAYER_TINTS   = [0xCCCCCC, 0xE6E6E6, 0xFFFFFF];
    var TOTAL_LAYERS  = 3;

    var _initialized = false;
    var _initPending = false;
    var _graves = {}; // { 'me': { container, layers[], topView, ... }, 'opp': ... }

    function getLocalPos(el, ref) {
        var x = 0, y = 0, cur = el;
        while (cur && cur !== ref) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x: x, y: y };
    }

    function createGraveView(owner, app, boardEl) {
        var stackEl = document.getElementById(owner + '-grave-stack');
        if (!stackEl) return null;

        var container = new PIXI.Container();
        container.sortableChildren = true;
        container.visible = false;

        // 3 layer slots (will hold card views created dynamically)
        var layers = [];
        for (var i = 0; i < TOTAL_LAYERS; i++) {
            layers.push({
                container: null, // PIXI container for this layer's card
                view: null,      // card view object
                uid: '',         // cached card uid for change detection
                zIndex: i + 1,
                offset: LAYER_OFFSETS[i],
                tint: LAYER_TINTS[i]
            });
        }

        // Position from DOM
        var pos = getLocalPos(stackEl, boardEl);
        container.position.set(pos.x + PAD, pos.y + PAD);
        container.zIndex = 3; // above deck sprites

        app.stage.addChild(container);

        return {
            container: container,
            layers: layers,
            topView: null,
            topUid: '',
            stackEl: stackEl,
            lastCount: -1
        };
    }

    function setCardInLayer(grave, layerIdx, card, parentContainer) {
        var layer = grave.layers[layerIdx];
        var uid = card ? (card.uid || card.id || '') : '';

        // No change
        if (layer.uid === uid && layer.view) return;

        // Destroy old
        if (layer.view) {
            layer.view.destroy();
            layer.view = null;
            layer.container = null;
        }
        layer.uid = uid;

        if (!card || !window.createCard) return;

        var view = window.createCard(card, { inHand: false });
        view.container.zIndex = layer.zIndex;
        // Position: top-left anchor, offset Y
        view.setLayout({
            x: SLOT_W / 2,
            y: SLOT_H / 2 + layer.offset,
            width: SLOT_W,
            height: SLOT_H,
            zIndex: layer.zIndex,
            hoverScale: 1.0
        });
        // Apply brightness tint to the card sprite
        var spr = view.container.children[0];
        if (spr) spr.tint = layer.tint;

        parentContainer.addChild(view.container);
        view.update(0); // apply position/scale immediately
        layer.view = view;
        layer.container = view.container;
    }

    function updateGrave(owner, graveyard) {
        if (!_initialized) {
            if (!_initPending) {
                _initPending = true;
                init().then(function () {
                    _initPending = false;
                    // Only retry if init actually succeeded
                    if (_initialized) updateGrave(owner, graveyard);
                });
            }
            return;
        }
        var grave = _graves[owner];
        if (!grave) return;

        // Respect RenderLock
        if (window.RenderLock && window.RenderLock.isLocked('grave', owner)) return;

        // Re-sync position each update (layout may change after init)
        var boardEl = window.PixiBoardLayer && window.PixiBoardLayer.getBoardEl();
        if (boardEl && grave.stackEl) {
            var pos = getLocalPos(grave.stackEl, boardEl);
            grave.container.position.set(pos.x + PAD, pos.y + PAD);
        }

        var count = graveyard ? graveyard.length : 0;

        if (count <= 0) {
            grave.container.visible = false;
            grave.lastCount = count;
            return;
        }

        grave.container.visible = true;
        grave.lastCount = count;

        // Visible layers: 0 if count<=1, else min(3, ceil(count/6))
        var visibleLayers = count <= 1 ? 0 : Math.min(TOTAL_LAYERS, Math.ceil(count / 6));

        // Update layer cards
        for (var i = 0; i < TOTAL_LAYERS; i++) {
            var show = i >= TOTAL_LAYERS - visibleLayers;
            if (show) {
                // Layer 0 (bottom) = graveyard[count-4], layer 1 = [count-3], layer 2 = [count-2]
                var cardIndex = count - (3 - i) - 1;
                var card = (cardIndex >= 0 && graveyard) ? graveyard[cardIndex] : null;
                setCardInLayer(grave, i, card, grave.container);
                if (grave.layers[i].view) {
                    grave.layers[i].view.container.visible = true;
                }
            } else {
                // Hide this layer
                if (grave.layers[i].view) {
                    grave.layers[i].view.container.visible = false;
                }
            }
        }

        // Top card (highest zIndex)
        var topCard = graveyard[count - 1];
        var topUid = topCard ? (topCard.uid || topCard.id || '') : '';
        if (grave.topUid !== topUid) {
            // Destroy old top
            if (grave.topView) {
                grave.topView.destroy();
                grave.topView = null;
            }
            grave.topUid = topUid;

            if (topCard && window.createCard) {
                var tv = window.createCard(topCard, { inHand: false });
                tv.setLayout({
                    x: SLOT_W / 2,
                    y: SLOT_H / 2,
                    width: SLOT_W,
                    height: SLOT_H,
                    zIndex: TOTAL_LAYERS + 2,
                    hoverScale: 1.0
                });
                tv.container.zIndex = TOTAL_LAYERS + 2;
                grave.container.addChild(tv.container);
                tv.update(0); // apply position/scale immediately
                grave.topView = tv;
            }
        }
    }

    function syncPositions() {
        if (!_initialized) return;
        var boardEl = window.PixiBoardLayer && window.PixiBoardLayer.getBoardEl();
        if (!boardEl) return;

        for (var owner in _graves) {
            var grave = _graves[owner];
            if (!grave) continue;
            var pos = getLocalPos(grave.stackEl, boardEl);
            grave.container.position.set(pos.x + PAD, pos.y + PAD);
        }
    }

    async function init() {
        if (_initialized) return;
        if (!window.PIXI || !window.PixiBoardLayer) return;

        var ok = await window.PixiBoardLayer.ensureInit();
        if (!ok) return;

        var app = window.PixiBoardLayer.getApp();
        var boardEl = window.PixiBoardLayer.getBoardEl();
        if (!app || !boardEl) return;

        _graves.me = createGraveView('me', app, boardEl);
        _graves.opp = createGraveView('opp', app, boardEl);

        _initialized = true;

        // Render one frame before hiding DOM
        app.renderer.render(app.stage);

        // Hide DOM grave visuals
        var style = document.createElement('style');
        style.textContent = [
            '.pixi-grave-active .grave-card-layer,',
            '.pixi-grave-active .grave-top-card:not(.empty) .card {',
            '    visibility: hidden !important;',
            '}',
            '.pixi-grave-active .grave-top-card:not(.empty) .slot-frame,',
            '.pixi-grave-active .grave-top-card:not(.empty) .slot-center {',
            '    display: none !important;',
            '}',
            '.pixi-grave-active .grave-stack.has-cards::after {',
            '    display: none !important;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
        boardEl.classList.add('pixi-grave-active');

        window.addEventListener('resize', syncPositions, { passive: true });
    }

    window.PixiGraveRenderer = {
        init: init,
        update: updateGrave,
        syncPositions: syncPositions
    };
})();
