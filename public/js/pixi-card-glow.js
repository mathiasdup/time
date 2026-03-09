/**
 * Pixi Card Glow — exact same Canvas 2D glow algorithm as card-glow.js,
 * but rendered into PIXI.Sprite textures in the Pixi scene graph.
 *
 * Each card with a glow gets a small offscreen Canvas2D redrawn at 30fps
 * and uploaded as a PIXI.Texture.
 *
 * Glow sprites are added to a PARENT container passed by the caller
 * (e.g. handRoot) so they interleave correctly with card sprites via zIndex.
 */
(function () {
    'use strict';

    var TWO_PI = Math.PI * 2;
    var PADDING = 12;
    var NUM_CTRL = 18;
    var GLOW_MARGIN = 0.5;
    var FRAME_INTERVAL = 1000 / 30; // 30fps
    var CW = 144, CH = 192;

    // ── Layer configs (identical to card-glow.js) ──
    var BLUE = [
        { spread: 3,   alpha: 0.45, lineW: 10, color: '#00aaff' },
        { spread: 2,   alpha: 0.6,  lineW: 7,  color: '#00ccff' },
        { spread: 1.5, alpha: 0.8,  lineW: 4,  color: '#00e5ff' },
        { spread: 1,   alpha: 1.0,  lineW: 2,  color: '#00ffff' }
    ];
    var ORANGE = [
        { spread: 3,   alpha: 0.45, lineW: 10, color: '#cc6600' },
        { spread: 2,   alpha: 0.6,  lineW: 7,  color: '#e67300' },
        { spread: 1.5, alpha: 0.8,  lineW: 4,  color: '#ff8c1a' },
        { spread: 1,   alpha: 1.0,  lineW: 2,  color: '#ffa500' }
    ];
    var GREEN = [
        { spread: 3,   alpha: 0.5,  lineW: 12, color: '#35bb28' },
        { spread: 2,   alpha: 0.65, lineW: 7,  color: '#50e838' },
        { spread: 1.5, alpha: 0.85, lineW: 4,  color: '#70ff55' },
        { spread: 1,   alpha: 1.0,  lineW: 2,  color: '#90ff70' }
    ];
    var PURPLE = [
        { spread: 3,   alpha: 0.5,  lineW: 12, color: '#7b2fbf' },
        { spread: 2,   alpha: 0.65, lineW: 7,  color: '#9b40e0' },
        { spread: 1.5, alpha: 0.85, lineW: 4,  color: '#b860ff' },
        { spread: 1,   alpha: 1.0,  lineW: 2,  color: '#d080ff' }
    ];
    var WHITE = [
        { spread: 3,   alpha: 0.5,  lineW: 12, color: '#aabbcc' },
        { spread: 2,   alpha: 0.65, lineW: 7,  color: '#ccddef' },
        { spread: 1.5, alpha: 0.85, lineW: 4,  color: '#ddeeff' },
        { spread: 1,   alpha: 1.0,  lineW: 2,  color: '#ffffff' }
    ];

    // ── Drawing helpers (exact copy from card-glow.js) ──

    function perimPoint(tRaw, cx, cy, hw, hh, cw, ch) {
        var perimeter = 2 * (cw + ch);
        var startOffset = (cw / 2) / perimeter;
        var t = ((tRaw + startOffset) % 1 + 1) % 1;
        var dist = t * perimeter;
        if (dist < cw) return { x: cx - hw + dist, y: cy - hh };
        if (dist < cw + ch) return { x: cx + hw, y: cy - hh + (dist - cw) };
        if (dist < 2 * cw + ch) return { x: cx + hw - (dist - cw - ch), y: cy + hh };
        return { x: cx - hw, y: cy + hh - (dist - 2 * cw - ch) };
    }

    function edgeNormal(tRaw, cw, ch) {
        var perimeter = 2 * (cw + ch);
        var startOffset = (cw / 2) / perimeter;
        var t = ((tRaw + startOffset) % 1 + 1) % 1;
        var dist = t * perimeter;
        if (dist < cw) return { nx: 0, ny: -1 };
        if (dist < cw + ch) return { nx: 1, ny: 0 };
        if (dist < 2 * cw + ch) return { nx: 0, ny: 1 };
        return { nx: -1, ny: 0 };
    }

    function drawSmooth(ctx, pts) {
        var n = pts.length;
        if (n < 3) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 0; i < n; i++) {
            var prev = pts[(i - 1 + n) % n];
            var curr = pts[i];
            var next = pts[(i + 1) % n];
            var next2 = pts[(i + 2) % n];
            var cp1x = curr.x + (next.x - prev.x) / 6;
            var cp1y = curr.y + (next.y - prev.y) / 6;
            var cp2x = next.x - (next2.x - curr.x) / 6;
            var cp2y = next.y - (next2.y - curr.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
        }
    }

    function drawGlowLayer(ctx, time, layerIndex, cx, cy, cw, ch, layers) {
        var cfg = layers[layerIndex];
        var speed = 1.0 + layerIndex * 0.3;
        var off = layerIndex * 1.7;
        var hw = cw / 2 + GLOW_MARGIN;
        var hh = ch / 2 + GLOW_MARGIN;
        var glowW = cw + GLOW_MARGIN * 2;
        var glowH = ch + GLOW_MARGIN * 2;

        var ctrl = [];
        for (var i = 0; i < NUM_CTRL; i++) {
            var t = i / NUM_CTRL;
            var p = perimPoint(t, cx, cy, hw, hh, glowW, glowH);
            var en = edgeNormal(t, glowW, glowH);

            var n = Math.sin(t * TWO_PI * 3 + time * speed + off) * 0.5
                  + Math.sin(t * TWO_PI * 7 + time * speed * 1.3 + off * 2) * 0.3
                  + Math.cos(t * TWO_PI * 11 + time * speed * 0.7) * 0.2;

            ctrl.push({ x: p.x + en.nx * n * cfg.spread, y: p.y + en.ny * n * cfg.spread });
        }

        ctx.beginPath();
        drawSmooth(ctx, ctrl);
        ctx.closePath();
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = cfg.lineW;
        ctx.globalAlpha = cfg.alpha;
        ctx.stroke();
    }

    /**
     * Draw a full glow frame into a Canvas2D context.
     * cw/ch = card pixel dimensions, layers = layer config array.
     */
    function drawGlow(ctx, time, cw, ch, layers, borderR) {
        var canvasW = cw + PADDING * 2;
        var canvasH = ch + PADDING * 2;
        ctx.clearRect(0, 0, canvasW, canvasH);

        // No clip needed — the card sprite (higher zIndex) covers the center.
        // Glow draws everywhere; only the perimeter extending beyond the card is visible.
        var cx = canvasW / 2;
        var cy = canvasH / 2;
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < layers.length; i++) {
            drawGlowLayer(ctx, time, i, cx, cy, cw, ch, layers);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // ── Glow animation state ──
    var _entries = [];          // hand glow entries (overlay canvas)
    var _boardEntries = [];     // board glow entries (board canvas)
    var _elapsed = 0;
    var _lastTickTime = 0;      // performance.now() based
    var _tickerBound = false;
    var _boardTickerBound = false;

    function ensureTicker() {
        if (_tickerBound) return;
        var shared = window.__PixiCardOverlayShared;
        if (!shared || !shared.app) return;
        _tickerBound = true;
        shared.app.ticker.add(function () {
            tickAll();
        });
    }

    function ensureBoardTicker() {
        if (_boardTickerBound) return;
        if (!window.PixiBoardLayer || !window.PixiBoardLayer.isReady()) return;
        var app = window.PixiBoardLayer.getApp();
        if (!app) return;
        _boardTickerBound = true;
        app.ticker.add(function () {
            tickBoard();
        });
    }

    function _tickEntries(entries) {
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!e.sprite.visible) continue;

            drawGlow(e.ctx, _elapsed, e.cw, e.ch, e.layers, 6);

            // Upload updated canvas to GPU
            if (e.texture && e.texture.source) {
                e.texture.source.update();
            }
        }
    }

    function tickAll() {
        if (_entries.length === 0 && _boardEntries.length === 0) return;

        var now = performance.now();
        if (now - _lastTickTime < FRAME_INTERVAL) return;
        _lastTickTime = now;

        _elapsed += FRAME_INTERVAL / 1000;

        _tickEntries(_entries);
    }

    function tickBoard() {
        if (_boardEntries.length === 0) return;

        // Shared elapsed time (already updated by tickAll if overlay is running)
        // If overlay ticker isn't bound, update elapsed here
        if (!_tickerBound) {
            var now = performance.now();
            if (now - _lastTickTime < FRAME_INTERVAL) return;
            _lastTickTime = now;
            _elapsed += FRAME_INTERVAL / 1000;
        }

        _tickEntries(_boardEntries);
    }

    /**
     * Create a glow entry for a card.
     * @param {number} cardW  card width in px
     * @param {number} cardH  card height in px
     * @param {PIXI.Container} parent  container to add the glow sprite to
     *        (should be the SAME container as the card sprites, so zIndex interleaves)
     * @returns {object} { sprite, setLayers, setPosition, setVisible, destroy }
     */
    function createGlow(cardW, cardH, parent) {
        if (!window.PIXI) return null;

        var cw = cardW || CW;
        var ch = cardH || CH;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var canvasW = cw + PADDING * 2;
        var canvasH = ch + PADDING * 2;

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(canvasW * dpr);
        canvas.height = Math.round(canvasH * dpr);
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var texture = PIXI.Texture.from(canvas);
        var sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = canvasW;
        sprite.height = canvasH;
        sprite.visible = false;

        // Add to provided parent container (same as cards → zIndex interleaving works)
        if (parent) {
            parent.addChild(sprite);
        }

        var entry = {
            sprite: sprite,
            canvas: canvas,
            ctx: ctx,
            texture: texture,
            layers: BLUE,
            hovered: false,
            cw: cw,
            ch: ch
        };
        _entries.push(entry);

        ensureTicker();

        var destroyed = false;

        return {
            sprite: sprite,

            setLayers: function (layers) {
                if (layers) entry.layers = layers;
            },

            setHovered: function (v) {
                entry.hovered = !!v;
            },

            setPosition: function (x, y, zIndex) {
                sprite.position.set(x, y);
                if (zIndex != null) sprite.zIndex = zIndex;
            },

            setVisible: function (v) {
                sprite.visible = !!v;
            },

            destroy: function () {
                if (destroyed) return;
                destroyed = true;
                sprite.destroy();
                var idx = _entries.indexOf(entry);
                if (idx >= 0) _entries.splice(idx, 1);
                if (texture) {
                    try { texture.destroy(true); } catch (e) { /* ok */ }
                }
            }
        };
    }

    /**
     * Create a board glow entry (uses board canvas, separate entry list).
     * Same API as createGlow but for board cards.
     */
    function createBoardGlow(cardW, cardH, parent) {
        if (!window.PIXI) return null;

        var cw = cardW || CW;
        var ch = cardH || CH;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var canvasW = cw + PADDING * 2;
        var canvasH = ch + PADDING * 2;

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(canvasW * dpr);
        canvas.height = Math.round(canvasH * dpr);
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var texture = PIXI.Texture.from(canvas);
        var sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = canvasW;
        sprite.height = canvasH;
        sprite.visible = false;

        if (parent) {
            parent.addChild(sprite);
        }

        var entry = {
            sprite: sprite,
            canvas: canvas,
            ctx: ctx,
            texture: texture,
            layers: GREEN,
            hovered: false,
            cw: cw,
            ch: ch
        };
        _boardEntries.push(entry);

        ensureBoardTicker();

        var destroyed = false;

        return {
            sprite: sprite,

            setLayers: function (layers) {
                if (layers) entry.layers = layers;
            },

            setPosition: function (x, y, zIndex) {
                sprite.position.set(x, y);
                if (zIndex != null) sprite.zIndex = zIndex;
            },

            setVisible: function (v) {
                sprite.visible = !!v;
            },

            destroy: function () {
                if (destroyed) return;
                destroyed = true;
                sprite.destroy();
                var idx = _boardEntries.indexOf(entry);
                if (idx >= 0) _boardEntries.splice(idx, 1);
                if (texture) {
                    try { texture.destroy(true); } catch (e) { /* ok */ }
                }
            }
        };
    }

    // ── Named layer sets for external use ──
    window.PixiCardGlow = {
        createGlow: createGlow,
        createBoardGlow: createBoardGlow,
        BLUE: BLUE,
        ORANGE: ORANGE,
        GREEN: GREEN,
        PURPLE: PURPLE,
        WHITE: WHITE
    };
})();
