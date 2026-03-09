/**
 * pixi-hero-renderer.js
 * Renders hero portraits + frames + HP orbs in the board Pixi canvas.
 * Shares the PIXI.Application from pixi-board-layer.js.
 * DOM hero visuals hidden via CSS once Pixi is active.
 */
(function () {
    'use strict';

    var PAD = 5;
    var HERO_W = 168, HERO_H = 224;
    var HP_SIZE = 40;
    var HP_BOTTOM = 10, HP_RIGHT = 10;

    // SVG frame paths (from CARD_SVG_BORDER_PATH in game-globals.js)
    var FRAME_PATH = 'M 15,10 L 68,10 L 84,16 L 100,10 L 425,10 L 441,16 L 457,10 L 510,10 Q 515,10 515,14 L 515,65 L 509,80 L 515,95 L 515,605 L 509,620 L 515,635 L 515,686 Q 515,690 510,690 L 457,690 L 441,684 L 425,690 L 100,690 L 84,684 L 68,690 L 15,690 Q 10,690 10,686 L 10,635 L 16,620 L 10,605 L 10,95 L 16,80 L 10,65 L 10,14 Q 10,10 15,10 Z M 27,22 Q 23,22 23,26 L 23,65 L 29,80 L 23,95 L 23,605 L 29,620 L 23,635 L 23,674 Q 23,678 27,678 L 68,678 L 84,672 L 100,678 L 425,678 L 441,672 L 457,678 L 498,678 Q 502,678 502,674 L 502,635 L 496,620 L 502,605 L 502,95 L 496,80 L 502,65 L 502,26 Q 502,22 498,22 L 457,22 L 441,28 L 425,22 L 100,22 L 84,28 L 68,22 Z';
    var OUTER_PATH = 'M 15,10 L 68,10 L 84,16 L 100,10 L 425,10 L 441,16 L 457,10 L 510,10 Q 515,10 515,14 L 515,65 L 509,80 L 515,95 L 515,605 L 509,620 L 515,635 L 515,686 Q 515,690 510,690 L 457,690 L 441,684 L 425,690 L 100,690 L 84,684 L 68,690 L 15,690 Q 10,690 10,686 L 10,635 L 16,620 L 10,605 L 10,95 L 16,80 L 10,65 L 10,14 Q 10,10 15,10 Z';
    var FRAME_VBX = 10, FRAME_VBY = 10, FRAME_VBW = 505, FRAME_VBH = 680;

    var _initialized = false;
    var _initPending = false;
    var _heroes = {};
    var _dpr = 1;

    function getLocalPos(el, ref) {
        var x = 0, y = 0, cur = el;
        while (cur && cur !== ref) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x: x, y: y };
    }

    function getTheme(faction) {
        return (typeof CARD_THEMES !== 'undefined' && CARD_THEMES[faction])
            || (typeof CARD_THEMES !== 'undefined' && CARD_THEMES.neutral)
            || { borderDark: '#3a3a4a', borderLight: '#7a7a8a' };
    }

    function drawCover(ctx, img, x, y, w, h) {
        var iw = img.naturalWidth || img.width;
        var ih = img.naturalHeight || img.height;
        if (!iw || !ih) return;
        var scale = Math.max(w / iw, h / ih);
        var sw = iw * scale;
        var sh = ih * scale;
        ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
    }

    function loadImg(src) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = src;
        });
    }

    // ── Hero portrait + frame texture ──────────────────────────────
    function composeHeroCanvas(heroImg, faction) {
        var dpr = _dpr;
        var w = Math.ceil(HERO_W * dpr);
        var h = Math.ceil(HERO_H * dpr);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');

        // Build transform: SVG viewBox → canvas coords
        var mat = new DOMMatrix();
        mat.scaleSelf(w / FRAME_VBW, h / FRAME_VBH);
        mat.translateSelf(-FRAME_VBX, -FRAME_VBY);

        var fullPath = new Path2D();
        fullPath.addPath(new Path2D(FRAME_PATH), mat);

        var outerP = new Path2D();
        outerP.addPath(new Path2D(OUTER_PATH), mat);

        // 1. Draw portrait clipped to outer path
        ctx.save();
        ctx.clip(outerP);
        if (heroImg) {
            drawCover(ctx, heroImg, 0, 0, w, h);
        } else {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();

        // 2. Frame border (evenodd fills only between outer and inner paths)
        var theme = getTheme(faction);
        var grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, theme.borderDark);
        grad.addColorStop(0.5, theme.borderLight);
        grad.addColorStop(1, theme.borderDark);
        ctx.fillStyle = grad;
        ctx.fill(fullPath, 'evenodd');

        // 3. Stroke outer edge
        ctx.strokeStyle = theme.borderDark;
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke(outerP);

        return canvas;
    }

    // ── HP orb texture ─────────────────────────────────────────────
    function composeHpCanvas(hp) {
        var dpr = _dpr;
        var size = Math.ceil(HP_SIZE * dpr);
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var cx = size / 2;
        var cy = size / 2;
        var outerR = size / 2 - 1;
        var innerR = outerR * (100 / 116);

        // Outer ring
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(221, 221, 221, 0.46)';
        ctx.fill();

        // Inner circle (pink→red gradient)
        var grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, '#f472b6');
        grad.addColorStop(0.5, '#e11d48');
        grad.addColorStop(1, '#be123c');
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // HP number
        var fontSize = Math.round(size * 0.55);
        ctx.font = 'bold ' + fontSize + 'px "Glacial Indifference", sans-serif';
        ctx.fillStyle = '#efefef';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1 * dpr;
        ctx.shadowBlur = 0.5 * dpr;
        ctx.fillText(String(Math.max(0, Math.floor(hp))), cx, cy);

        return canvas;
    }

    // ── Create a hero view ─────────────────────────────────────────
    function createHeroView(owner, heroData, heroImg, app, boardEl) {
        var heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (!heroEl) return null;

        var container = new PIXI.Container();
        container.sortableChildren = true;

        // Portrait + frame sprite
        var heroCanvas = composeHeroCanvas(heroImg, heroData.faction);
        var heroTex = PIXI.Texture.from(heroCanvas);
        var heroSprite = new PIXI.Sprite(heroTex);
        heroSprite.anchor.set(0, 0);
        heroSprite.width = HERO_W;
        heroSprite.height = HERO_H;
        heroSprite.zIndex = 1;
        container.addChild(heroSprite);

        // HP orb sprite
        var initHp = 20;
        if (owner === 'me' && window.state && window.state.me) initHp = window.state.me.hp;
        if (owner === 'opp' && window.state && window.state.opponent) initHp = window.state.opponent.hp;
        var hpCanvas = composeHpCanvas(initHp);
        var hpTex = PIXI.Texture.from(hpCanvas);
        var hpSprite = new PIXI.Sprite(hpTex);
        hpSprite.anchor.set(0.5, 0.5);
        hpSprite.width = HP_SIZE;
        hpSprite.height = HP_SIZE;
        hpSprite.x = HERO_W - HP_RIGHT - HP_SIZE / 2;
        hpSprite.y = HERO_H - HP_BOTTOM - HP_SIZE / 2;
        hpSprite.zIndex = 5;
        container.addChild(hpSprite);

        // Position from DOM
        var pos = getLocalPos(heroEl, boardEl);
        container.position.set(pos.x + PAD, pos.y + PAD);
        container.zIndex = 12;

        app.stage.addChild(container);

        return {
            container: container,
            heroSprite: heroSprite,
            hpSprite: hpSprite,
            heroEl: heroEl,
            lastHp: initHp,
            glow: null
        };
    }

    // ── Update HP orb ──────────────────────────────────────────────
    function updateHp(owner, hp) {
        if (!_initialized) return;
        var hero = _heroes[owner];
        if (!hero) return;

        if (window.RenderLock && (
            window.RenderLock.isLocked('heroHp', 'all') ||
            window.RenderLock.isLocked('heroHp', owner)
        )) return;

        hp = Math.max(0, Math.floor(hp));
        if (hero.lastHp === hp) return;
        hero.lastHp = hp;

        var hpCanvas = composeHpCanvas(hp);
        if (hero.hpSprite.texture && hero.hpSprite.texture !== PIXI.Texture.EMPTY) {
            hero.hpSprite.texture.destroy(true);
        }
        hero.hpSprite.texture = PIXI.Texture.from(hpCanvas);
    }

    // ── Position sync ──────────────────────────────────────────────
    function syncPositions() {
        if (!_initialized) return;
        var boardEl = window.PixiBoardLayer && window.PixiBoardLayer.getBoardEl();
        if (!boardEl) return;

        for (var owner in _heroes) {
            var hero = _heroes[owner];
            if (!hero) continue;
            var pos = getLocalPos(hero.heroEl, boardEl);
            hero.container.position.set(pos.x + PAD, pos.y + PAD);
        }
    }

    // ── Hero glows (targetable / hover) ────────────────────────────
    function updateGlows() {
        if (!_initialized || !window.PixiCardGlow || !window.PixiCardGlow.createBoardGlow) return;

        var root = window.PixiBoardLayer && window.PixiBoardLayer.getRoot();
        if (!root) return;

        for (var owner in _heroes) {
            var hero = _heroes[owner];
            if (!hero) continue;

            var el = hero.heroEl;
            var glowColor = null;

            if (el.classList.contains('hero-hover-target')) {
                glowColor = window.PixiCardGlow.ORANGE;
            } else if (el.classList.contains('hero-targetable')) {
                var isHover = el.matches(':hover');
                glowColor = isHover ? window.PixiCardGlow.ORANGE : window.PixiCardGlow.BLUE;
            }

            if (glowColor) {
                if (!hero.glow) {
                    hero.glow = window.PixiCardGlow.createBoardGlow(HERO_W, HERO_H, root);
                    if (!hero.glow) continue;
                }
                hero.glow.setLayers(glowColor);
                var boardEl = window.PixiBoardLayer.getBoardEl();
                var pos = getLocalPos(hero.heroEl, boardEl);
                hero.glow.setPosition(
                    pos.x + HERO_W / 2 + PAD,
                    pos.y + HERO_H / 2 + PAD,
                    11
                );
                hero.glow.setVisible(true);
            } else {
                if (hero.glow) hero.glow.setVisible(false);
            }
        }
    }

    // ── Init ───────────────────────────────────────────────────────
    async function init(meHeroData, oppHeroData) {
        if (_initialized) return;
        if (!window.PIXI || !window.PixiBoardLayer) return;
        if (_initPending) return;
        _initPending = true;

        try {
            var ok = await window.PixiBoardLayer.ensureInit();
            if (!ok) return;

            var app = window.PixiBoardLayer.getApp();
            var boardEl = window.PixiBoardLayer.getBoardEl();
            if (!app || !boardEl) return;

            _dpr = Math.min(window.devicePixelRatio || 1, 2);

            // Load hero images in parallel
            var meUrl = meHeroData && meHeroData.image ? '/cards/' + meHeroData.image : null;
            var oppUrl = oppHeroData && oppHeroData.image ? '/cards/' + oppHeroData.image : null;

            var imgs = await Promise.all([
                meUrl ? loadImg(meUrl) : Promise.resolve(null),
                oppUrl ? loadImg(oppUrl) : Promise.resolve(null)
            ]);

            _heroes.me = createHeroView('me', meHeroData || {}, imgs[0], app, boardEl);
            _heroes.opp = createHeroView('opp', oppHeroData || {}, imgs[1], app, boardEl);

            _initialized = true;

            // Render one frame before hiding DOM
            app.renderer.render(app.stage);

            // Hide DOM hero visuals (keep element for click/hover interaction)
            var style = document.createElement('style');
            style.textContent = [
                '.pixi-hero-active .hero-card-inner {',
                '    visibility: hidden !important;',
                '}',
                '.pixi-hero-active .hero-frame-svg {',
                '    display: none !important;',
                '}',
                '.pixi-hero-active .hero-hp {',
                '    visibility: hidden !important;',
                '}',
                '.pixi-hero-active .hero-card > canvas {',
                '    display: none !important;',
                '}'
            ].join('\n');
            document.head.appendChild(style);
            boardEl.classList.add('pixi-hero-active');

            // Ticker for glow polling
            app.ticker.add(function () {
                updateGlows();
            });

            window.addEventListener('resize', syncPositions, { passive: true });
        } finally {
            _initPending = false;
        }
    }

    window.PixiHeroRenderer = {
        init: init,
        updateHp: updateHp,
        syncPositions: syncPositions
    };
})();
