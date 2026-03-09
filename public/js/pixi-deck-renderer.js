/**
 * pixi-deck-renderer.js
 * Renders deck stacks (5 card-back layers + top card) in the board Pixi canvas.
 * Shares the PIXI.Application from pixi-board-layer.js.
 * DOM deck layers are hidden via CSS once Pixi is active.
 */
(function () {
    'use strict';

    var PAD = 5; // same as pixi-board-layer
    var SLOT_W = 144, SLOT_H = 192;

    // Layer configs: Y offset and brightness (tint) per layer index
    // nth-child(1)=bottom(most offset), nth-child(5)=top(no offset)
    var LAYER_OFFSETS = [12, 9, 6, 3, 0];
    var LAYER_TINTS   = [0xA6A6A6, 0xB8B8B8, 0xCCCCCC, 0xE6E6E6, 0xFFFFFF];
    var TOTAL_LAYERS  = 5;

    var _initialized = false;
    var _initPending = false;
    var _cardBackTex = null;
    var _decks = {}; // { 'me': { container, layers[], topSprite }, 'opp': ... }

    function loadImg(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = reject;
            img.src = src;
        });
    }

    function makeCardBackTexture(img) {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = Math.ceil(SLOT_W * dpr);
        var h = Math.ceil(SLOT_H * dpr);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        return PIXI.Texture.from(canvas);
    }

    function getLocalPos(el, ref) {
        var x = 0, y = 0, cur = el;
        while (cur && cur !== ref) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x: x, y: y };
    }

    function createDeckView(owner, app, boardEl) {
        var stackEl = document.getElementById(owner + '-deck-stack');
        if (!stackEl) return null;

        var container = new PIXI.Container();
        container.sortableChildren = true;
        container.visible = false;

        // 5 layer sprites + 1 top sprite
        var layers = [];
        for (var i = 0; i < TOTAL_LAYERS; i++) {
            var spr = new PIXI.Sprite(_cardBackTex);
            spr.anchor.set(0, 0);
            spr.width = SLOT_W;
            spr.height = SLOT_H;
            spr.tint = LAYER_TINTS[i];
            spr.position.set(0, LAYER_OFFSETS[i]);
            spr.zIndex = i + 1;
            spr.visible = false;
            container.addChild(spr);
            layers.push(spr);
        }

        // Top card sprite (same as highest layer but with shadow effect)
        var topSpr = new PIXI.Sprite(_cardBackTex);
        topSpr.anchor.set(0, 0);
        topSpr.width = SLOT_W;
        topSpr.height = SLOT_H;
        topSpr.zIndex = TOTAL_LAYERS + 1;
        topSpr.visible = false;
        container.addChild(topSpr);

        // Position from DOM
        var pos = getLocalPos(stackEl, boardEl);
        container.position.set(pos.x + PAD, pos.y + PAD);
        // zIndex above slot frames (pixi-board-slots z=0 canvas), below card sprites
        container.zIndex = 2;

        app.stage.addChild(container);

        return {
            container: container,
            layers: layers,
            topSprite: topSpr,
            stackEl: stackEl,
            lastCount: -1
        };
    }

    function updateDeck(owner, deckCount) {
        if (!_initialized) {
            if (!_initPending) {
                _initPending = true;
                init().then(function () {
                    _initPending = false;
                    // Only retry if init actually succeeded
                    if (_initialized) updateDeck(owner, deckCount);
                });
            }
            return;
        }
        var deck = _decks[owner];
        if (!deck) return;
        if (deck.lastCount === deckCount) return;
        deck.lastCount = deckCount;

        if (deckCount <= 0) {
            deck.container.visible = false;
            return;
        }

        deck.container.visible = true;
        var visibleLayers = Math.min(TOTAL_LAYERS, Math.ceil(deckCount / 8));

        for (var i = 0; i < TOTAL_LAYERS; i++) {
            deck.layers[i].visible = (i < visibleLayers);
        }
        deck.topSprite.visible = true;
    }

    function syncPositions() {
        if (!_initialized) return;
        var boardEl = window.PixiBoardLayer && window.PixiBoardLayer.getBoardEl();
        if (!boardEl) return;

        for (var owner in _decks) {
            var deck = _decks[owner];
            if (!deck) continue;
            var pos = getLocalPos(deck.stackEl, boardEl);
            deck.container.position.set(pos.x + PAD, pos.y + PAD);
        }
    }

    async function init() {
        if (_initialized) return;
        if (!window.PIXI || !window.PixiBoardLayer) return;

        // Wait for board layer to be ready
        var ok = await window.PixiBoardLayer.ensureInit();
        if (!ok) return;

        var app = window.PixiBoardLayer.getApp();
        var boardEl = window.PixiBoardLayer.getBoardEl();
        if (!app || !boardEl) return;

        // Load card back texture
        try {
            var img = await loadImg('/cardback/back_1.png');
            _cardBackTex = makeCardBackTexture(img);
        } catch (e) {
            console.error('[PixiDeckRenderer] Failed to load card back:', e);
            return;
        }

        _decks.me = createDeckView('me', app, boardEl);
        _decks.opp = createDeckView('opp', app, boardEl);

        _initialized = true;

        // Render one frame before hiding DOM
        app.renderer.render(app.stage);

        // Hide DOM deck visuals
        var style = document.createElement('style');
        style.textContent = [
            '.pixi-deck-active .deck-card-layer,',
            '.pixi-deck-active .deck-card-top {',
            '    visibility: hidden !important;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
        boardEl.classList.add('pixi-deck-active');

        // Listen for resize
        window.addEventListener('resize', syncPositions, { passive: true });
    }

    window.PixiDeckRenderer = {
        init: init,
        update: updateDeck,
        syncPositions: syncPositions
    };
})();
