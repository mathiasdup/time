/**
 * pixi-board-slots.js
 * Renders board slot frames and center icons in PixiJS.
 * Canvas is placed inside .game-board to inherit CSS perspective.
 * DOM slots remain for interaction (click/drag/drop) but SVG visuals are hidden.
 */
(function () {
    'use strict';

    const SLOT_W = 144;
    const SLOT_H = 192;
    // Notches extend 3px beyond slot edges + 1px stroke = 4px padding needed
    const PAD = 5;

    // Match SVG viewBox="-4 -4 152 200" displayed in 144×192 CSS element
    // Without this, Pixi draws ~5% larger than the SVG → visible "grow" on switch
    const VB_X = -4, VB_Y = -4, VB_W = 152, VB_H = 200;
    const GFX_SX = SLOT_W / VB_W;   // 144/152 ≈ 0.947
    const GFX_SY = SLOT_H / VB_H;   // 192/200 = 0.96
    const GFX_OX = -VB_X * GFX_SX;  // 4 * 0.947 ≈ 3.79
    const GFX_OY = -VB_Y * GFX_SY;  // 4 * 0.96 = 3.84

    // Visual state presets — matches CSS exactly
    const STYLES = {
        default:          { fill: 0xffffff, fillA: 0.04, stroke: 0xffffff, strokeA: 0.10, iconA: 0.4 },
        hover:            { fill: 0xffffff, fillA: 0.09, stroke: 0xffffff, strokeA: 1.00, iconA: 0.9 },
        validTarget:      { fill: 0x62d7ff, fillA: 0.25, stroke: 0x62d7ff, strokeA: 1.00, iconA: 0.4 },
        validTargetHover: { fill: 0xf1c40f, fillA: 0.35, stroke: 0xf1c40f, strokeA: 1.00, iconA: 0.9 },
        dragOver:         { fill: 0xf1c40f, fillA: 0.35, stroke: 0xf1c40f, strokeA: 1.00, iconA: 0.9 },
        crossTarget:      { fill: 0xf39c12, fillA: 0.30, stroke: 0xf39c12, strokeA: 1.00, iconA: 0.4 },
        committedHover:   { fill: 0xf39c12, fillA: 0.22, stroke: 0xf39c12, strokeA: 1.00, iconA: 0.4 },
        moveable:         { fill: 0x62d7ff, fillA: 0.25, stroke: 0x62d7ff, strokeA: 1.00, iconA: 0.4 },
    };

    let app = null;
    let boardEl = null;
    let initialized = false;
    const slotViews = new Map();
    let texEpeeWhite = null;
    let texTrapWhite = null;
    let texGraveWhite = null;
    let texDeckWhite = null;

    // Load image as HTMLImageElement (not via Pixi which closes ImageBitmaps after GPU upload)
    function loadImg(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    // Icon display size in CSS pixels
    const ICON_CSS_SIZE = 50;

    // ===== Pre-render a white silhouette texture at exact device pixel size =====
    function makeWhiteTexture(img) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const size = Math.ceil(ICON_CSS_SIZE * dpr); // 75px at DPR 1.5
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Canvas2D uses high-quality bicubic downscale (same as CSS)
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        return PIXI.Texture.from(canvas);
    }

    // ===== SVG-accurate slot frame path =====
    function drawFramePath(gfx) {
        gfx.moveTo(4, 0);
        gfx.lineTo(68, 0);
        gfx.lineTo(72, -3);   // top notch
        gfx.lineTo(76, 0);
        gfx.lineTo(140, 0);
        gfx.arcTo(144, 0, 144, 4, 4);
        gfx.lineTo(144, 92);
        gfx.lineTo(147, 96);  // right notch
        gfx.lineTo(144, 100);
        gfx.lineTo(144, 188);
        gfx.arcTo(144, 192, 140, 192, 4);
        gfx.lineTo(76, 192);
        gfx.lineTo(72, 195);  // bottom notch
        gfx.lineTo(68, 192);
        gfx.lineTo(4, 192);
        gfx.arcTo(0, 192, 0, 188, 4);
        gfx.lineTo(0, 100);
        gfx.lineTo(-3, 96);   // left notch
        gfx.lineTo(0, 92);
        gfx.lineTo(0, 4);
        gfx.arcTo(0, 0, 4, 0, 4);
        gfx.closePath();
    }

    function drawSlot(gfx, style) {
        gfx.clear();
        drawFramePath(gfx);
        gfx.fill({ color: style.fill, alpha: style.fillA });
        drawFramePath(gfx);
        gfx.stroke({ color: style.stroke, width: 2, alpha: style.strokeA, join: 'round' });
    }

    // ===== Deck empty slot: dashed rounded rect (matches CSS .deck-stack.empty .deck-card-top) =====
    function drawDeckSlot(gfx) {
        gfx.clear();
        // background: rgba(255,255,255,0.05)
        gfx.roundRect(0, 0, SLOT_W, SLOT_H, 4);
        gfx.fill({ color: 0xffffff, alpha: 0.05 });
        // border: 2px dashed rgba(255,255,255,0.2)
        gfx.roundRect(0, 0, SLOT_W, SLOT_H, 4);
        gfx.stroke({ color: 0xffffff, width: 2, alpha: 0.2, join: 'round' });
    }

    // ===== Determine visual state from DOM classes =====
    function resolveState(el) {
        const cl = el.classList;
        if (cl.contains('drag-over')) return 'dragOver';
        if (cl.contains('cross-target')) return 'crossTarget';
        if (cl.contains('committed-hover-target')) return 'committedHover';
        if (cl.contains('moveable')) {
            if (el.matches(':hover')) return 'validTargetHover';
            return 'moveable';
        }
        if (cl.contains('valid-target')) {
            if (el.matches(':hover')) return 'validTargetHover';
            return 'validTarget';
        }
        if (!cl.contains('has-card') && el.matches(':hover')) return 'hover';
        return 'default';
    }

    // ===== Position helpers =====
    function getLocalPos(el, ref) {
        let x = 0, y = 0, cur = el;
        while (cur && cur !== ref) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x, y };
    }

    // ===== Build one slot view =====
    function createSlotView(key, slotEl, type) {
        const container = new PIXI.Container();

        const gfx = new PIXI.Graphics();

        if (type === 'deck') {
            drawDeckSlot(gfx);
            // No viewBox transform for deck (it's a simple CSS rect, not SVG path)
        } else {
            drawSlot(gfx, STYLES.default);
            // Apply SVG viewBox transform so Pixi frame matches DOM SVG exactly
            gfx.scale.set(GFX_SX, GFX_SY);
            gfx.position.set(GFX_OX, GFX_OY);
        }
        container.addChild(gfx);

        // Center icon — texture is at exact device pixel size, scale to CSS pixels
        const texMap = { card: texEpeeWhite, trap: texTrapWhite, grave: texGraveWhite, deck: texDeckWhite };
        const tex = texMap[type];
        let icon = null;
        if (tex) {
            icon = new PIXI.Sprite(tex);
            icon.anchor.set(0.5);
            if (tex.width > 0 && tex.height > 0) {
                icon.scale.set(ICON_CSS_SIZE / tex.width, ICON_CSS_SIZE / tex.height);
            }
            icon.position.set(SLOT_W / 2, SLOT_H / 2);
            icon.alpha = 0.4;
            container.addChild(icon);

            // Mirror opp trap icons
            if (type === 'trap' && key.startsWith('opp')) {
                icon.scale.x *= -1;
            }
        }

        app.stage.addChild(container);

        slotViews.set(key, {
            container, gfx, icon, slotEl, type,
            lastState: 'default'
        });
    }

    // ===== Sync positions from DOM layout =====
    function syncPositions() {
        if (!boardEl || !initialized) return;
        for (const view of slotViews.values()) {
            const pos = getLocalPos(view.slotEl, boardEl);
            view.container.position.set(pos.x + PAD, pos.y + PAD);
        }
    }

    // ===== Per-frame update: check state changes =====
    function tick() {
        if (_positionDirty) {
            _positionDirty = false;
            syncPositions();
            resize();
        }
        for (const view of slotViews.values()) {
            // Grave/deck: only visible when empty
            if (view.type === 'grave') {
                const vis = view.slotEl.classList.contains('empty');
                view.container.visible = vis;
                if (!vis) continue;
            }
            if (view.type === 'deck') {
                const vis = view.slotEl.classList.contains('empty');
                view.container.visible = vis;
                if (!vis) continue;
            }

            const newState = resolveState(view.slotEl);
            if (newState !== view.lastState) {
                view.lastState = newState;
                const style = STYLES[newState];
                if (view.type === 'deck') {
                    drawDeckSlot(view.gfx);
                } else {
                    drawSlot(view.gfx, style);
                }
                if (view.icon) view.icon.alpha = style.iconA;
            }
        }
    }

    // ===== Resize handler =====
    function resize() {
        if (!app || !boardEl) return;
        const w = boardEl.offsetWidth + PAD * 2;
        const h = boardEl.offsetHeight + PAD * 2;
        if (w > 0 && h > 0) {
            app.renderer.resize(w, h);
            // autoDensity sets CSS to w×h px — that's exactly what we want
        }
    }

    let _positionDirty = false;

    // ===== Init =====
    async function init() {
        if (initialized) return;
        boardEl = document.querySelector('.game-board');
        if (!boardEl) return;

        // Wait for board to have real dimensions
        if (boardEl.offsetWidth === 0) {
            requestAnimationFrame(() => init());
            return;
        }

        const w = boardEl.offsetWidth + PAD * 2;
        const h = boardEl.offsetHeight + PAD * 2;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        app = new PIXI.Application();
        await app.init({
            width: w,
            height: h,
            backgroundAlpha: 0,
            antialias: true,
            resolution: dpr,
            autoDensity: true, // 1 stage unit = 1 CSS pixel
        });

        const cv = app.canvas;
        cv.style.position = 'absolute';
        cv.style.top = -PAD + 'px';
        cv.style.left = -PAD + 'px';
        cv.style.pointerEvents = 'none';
        cv.style.zIndex = '0';
        cv.classList.add('pixi-board-slots-canvas');

        boardEl.insertBefore(cv, boardEl.firstChild);

        initialized = true;

        // Load icons as HTMLImageElement (Pixi closes ImageBitmaps after GPU upload)
        const [imgEpee, imgTrap, imgGrave, imgDeck] = await Promise.all([
            loadImg('/battlefield_elements/epee.png'),
            loadImg('/battlefield_elements/trap.png'),
            loadImg('/battlefield_elements/graveyard.png'),
            loadImg('/battlefield_elements/deck.png'),
        ]);
        texEpeeWhite = makeWhiteTexture(imgEpee);
        texTrapWhite = makeWhiteTexture(imgTrap);
        texGraveWhite = makeWhiteTexture(imgGrave);
        texDeckWhite = imgDeck ? makeWhiteTexture(imgDeck) : null;

        // Build slot views from the DOM caches
        if (typeof _slotCache !== 'undefined') {
            for (const key of Object.keys(_slotCache)) {
                createSlotView(key, _slotCache[key], 'card');
            }
        }
        if (typeof _trapSlotCache !== 'undefined') {
            for (const key of Object.keys(_trapSlotCache)) {
                createSlotView(key, _trapSlotCache[key], 'trap');
            }
        }

        // Graveyard empty slots (grave-top-card uses same SVG frame)
        const meGraveTop = document.getElementById('me-grave-top');
        const oppGraveTop = document.getElementById('opp-grave-top');
        if (meGraveTop) createSlotView('me-grave', meGraveTop, 'grave');
        if (oppGraveTop) createSlotView('opp-grave', oppGraveTop, 'grave');

        // Deck empty slots (dashed border style)
        const meDeckTop = document.querySelector('#me-deck-stack .deck-card-top');
        const oppDeckTop = document.querySelector('#opp-deck-stack .deck-card-top');
        if (meDeckTop) createSlotView('me-deck', meDeckTop.parentElement, 'deck');
        if (oppDeckTop) createSlotView('opp-deck', oppDeckTop.parentElement, 'deck');

        syncPositions();
        resize();

        // Force one Pixi render BEFORE hiding DOM — prevents 1-frame empty flash
        app.renderer.render(app.stage);

        // Hide DOM visuals (SVG frames + icons) — keep slot divs for interaction
        const style = document.createElement('style');
        style.textContent = `
            .pixi-board-slots-active .card-slot > .slot-frame,
            .pixi-board-slots-active .card-slot > .slot-center,
            .pixi-board-slots-active .trap-slot > .slot-frame,
            .pixi-board-slots-active .trap-slot > .slot-center,
            .pixi-board-slots-active .grave-top-card.empty > .slot-frame,
            .pixi-board-slots-active .grave-top-card.empty > .slot-center,
            .pixi-board-slots-active .deck-stack.empty .deck-card-top {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
        boardEl.classList.add('pixi-board-slots-active');

        // Ticker
        app.ticker.add(tick);

        // Resize
        window.addEventListener('resize', resize, { passive: true });
    }

    function markDirty() {
        _positionDirty = true;
    }

    function rebuild() {
        if (!initialized) { init(); return; }
        for (const view of slotViews.values()) {
            view.container.destroy({ children: true });
        }
        slotViews.clear();

        if (typeof _slotCache !== 'undefined') {
            for (const key of Object.keys(_slotCache)) {
                createSlotView(key, _slotCache[key], 'card');
            }
        }
        if (typeof _trapSlotCache !== 'undefined') {
            for (const key of Object.keys(_trapSlotCache)) {
                createSlotView(key, _trapSlotCache[key], 'trap');
            }
        }

        // Grave/deck slots
        const meGraveTop = document.getElementById('me-grave-top');
        const oppGraveTop = document.getElementById('opp-grave-top');
        if (meGraveTop) createSlotView('me-grave', meGraveTop, 'grave');
        if (oppGraveTop) createSlotView('opp-grave', oppGraveTop, 'grave');
        const meDeckTop = document.querySelector('#me-deck-stack .deck-card-top');
        const oppDeckTop = document.querySelector('#opp-deck-stack .deck-card-top');
        if (meDeckTop) createSlotView('me-deck', meDeckTop.parentElement, 'deck');
        if (oppDeckTop) createSlotView('opp-deck', oppDeckTop.parentElement, 'deck');

        syncPositions();
    }

    window.PixiBoardSlots = {
        init,
        rebuild,
        markDirty,
        syncPositions,
        resize
    };
})();
