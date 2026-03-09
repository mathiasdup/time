/**
 * Card Glow System — Canvas 2D par carte, enfant avec z-index:-1
 * Chaque glow est un <canvas> enfant de sa .card, positionné derrière elle.
 * Le stacking context de la carte fait que le glow se comporte comme une bordure :
 * naturellement couvert par les cartes au-dessus, visible sur les cartes en dessous.
 */

const CardGlow = (() => {
    let animId = null;
    let elapsed = 0;
    let lastTime = 0;

    const TWO_PI = Math.PI * 2;
    const PADDING = 12; // px d'extension du glow au-delà de la carte


    const LAYER_CONFIGS_BLUE = [
        { spread: 3,   alpha: 0.45, lineW: 8, color: '#00aaff' },
        { spread: 2,   alpha: 0.6,  lineW: 5, color: '#00ccff' },
        { spread: 1.5, alpha: 0.8,  lineW: 3, color: '#00e5ff' },
        { spread: 1,   alpha: 1.0,  lineW: 1.5, color: '#00ffff' },
    ];

    const LAYER_CONFIGS_ORANGE = [
        { spread: 3,   alpha: 0.45, lineW: 8, color: '#cc6600' },
        { spread: 2,   alpha: 0.6,  lineW: 5, color: '#e67300' },
        { spread: 1.5, alpha: 0.8,  lineW: 3, color: '#ff8c1a' },
        { spread: 1,   alpha: 1.0,  lineW: 1.5, color: '#ffa500' },
    ];

    const LAYER_CONFIGS_GREEN = [
        { spread: 3,   alpha: 0.5,  lineW: 9, color: '#35bb28' },
        { spread: 2,   alpha: 0.65, lineW: 5, color: '#50e838' },
        { spread: 1.5, alpha: 0.85, lineW: 3, color: '#70ff55' },
        { spread: 1,   alpha: 1.0,  lineW: 1.5, color: '#90ff70' },
    ];

    const LAYER_CONFIGS_PURPLE = [
        { spread: 3,   alpha: 0.5,  lineW: 9, color: '#7b2fbf' },
        { spread: 2,   alpha: 0.65, lineW: 5, color: '#9b40e0' },
        { spread: 1.5, alpha: 0.85, lineW: 3, color: '#b860ff' },
        { spread: 1,   alpha: 1.0,  lineW: 1.5, color: '#d080ff' },
    ];

    const LAYER_CONFIGS_WHITE = [
        { spread: 3,   alpha: 0.5,  lineW: 9, color: '#aabbcc' },
        { spread: 2,   alpha: 0.65, lineW: 5, color: '#ccddef' },
        { spread: 1.5, alpha: 0.85, lineW: 3, color: '#ddeeff' },
        { spread: 1,   alpha: 1.0,  lineW: 1.5, color: '#ffffff' },
    ];

    const NUM_CTRL = 18; // Points de contrôle (réduit de 36 — le blur masque la différence)
    const GLOW_MARGIN = 1;

    // ── Outer border path (SVG coords, first sub-path of CARD_SVG_BORDER_PATH) ──
    // Used to clip glow to the exact SVG frame shape for arena-style cards
    const OUTER_BORDER = [
        ['M',15,10],['L',68,10],['L',84,16],['L',100,10],
        ['L',425,10],['L',441,16],['L',457,10],['L',510,10],
        ['Q',515,10,515,14],
        ['L',515,65],['L',509,80],['L',515,95],
        ['L',515,605],['L',509,620],['L',515,635],['L',515,686],
        ['Q',515,690,510,690],
        ['L',457,690],['L',441,684],['L',425,690],
        ['L',100,690],['L',84,684],['L',68,690],['L',15,690],
        ['Q',10,690,10,686],
        ['L',10,635],['L',16,620],['L',10,605],
        ['L',10,95],['L',16,80],['L',10,65],['L',10,14],
        ['Q',10,10,15,10]
    ];

    // viewBox="10 10 505 680" → SVG (x,y) maps to canvas (pad + (x-10)/505*cw, pad + (y-10)/680*ch)
    function traceOuterBorder(ctx, pad, cw, ch) {
        const sx = cw / 505, sy = ch / 680;
        for (const c of OUTER_BORDER) {
            switch (c[0]) {
                case 'M': ctx.moveTo(pad + (c[1]-10)*sx, pad + (c[2]-10)*sy); break;
                case 'L': ctx.lineTo(pad + (c[1]-10)*sx, pad + (c[2]-10)*sy); break;
                case 'Q': ctx.quadraticCurveTo(
                    pad + (c[1]-10)*sx, pad + (c[2]-10)*sy,
                    pad + (c[3]-10)*sx, pad + (c[4]-10)*sy
                ); break;
            }
        }
        ctx.closePath();
    }

    // ── Cache DOM : recalculé uniquement quand dirty ──
    let _dirty = true;
    let _glowHidden = false; // true when canvases are hidden during resolution
    let _cachedTargets = []; // { el, layers, borderW, borderR }

    // ── Périmètre helpers ──

    function perimPoint(tRaw, cx, cy, hw, hh, cw, ch) {
        const perimeter = 2 * (cw + ch);
        const startOffset = (cw / 2) / perimeter;
        const t = ((tRaw + startOffset) % 1 + 1) % 1;
        const dist = t * perimeter;
        if (dist < cw) return { x: cx - hw + dist, y: cy - hh };
        if (dist < cw + ch) return { x: cx + hw, y: cy - hh + (dist - cw) };
        if (dist < 2 * cw + ch) return { x: cx + hw - (dist - cw - ch), y: cy + hh };
        return { x: cx - hw, y: cy + hh - (dist - 2 * cw - ch) };
    }

    function edgeNormal(tRaw, cw, ch) {
        const perimeter = 2 * (cw + ch);
        const startOffset = (cw / 2) / perimeter;
        const t = ((tRaw + startOffset) % 1 + 1) % 1;
        const dist = t * perimeter;
        if (dist < cw) return { nx: 0, ny: -1 };
        if (dist < cw + ch) return { nx: 1, ny: 0 };
        if (dist < 2 * cw + ch) return { nx: 0, ny: 1 };
        return { nx: -1, ny: 0 };
    }

    // Catmull-Rom → cubic bezier, closed loop via Canvas 2D
    function drawSmooth(ctx, pts) {
        const n = pts.length;
        if (n < 3) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < n; i++) {
            const prev = pts[(i - 1 + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];
            const next2 = pts[(i + 2) % n];
            const cp1x = curr.x + (next.x - prev.x) / 6;
            const cp1y = curr.y + (next.y - prev.y) / 6;
            const cp2x = next.x - (next2.x - curr.x) / 6;
            const cp2y = next.y - (next2.y - curr.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
        }
    }

    function drawGlowLayer(ctx, time, layerIndex, cx, cy, cw, ch, layers) {
        const cfg = layers[layerIndex];
        const speed = 1.0 + layerIndex * 0.3;
        const off = layerIndex * 1.7;
        const hw = cw / 2 + GLOW_MARGIN;
        const hh = ch / 2 + GLOW_MARGIN;
        const glowW = cw + GLOW_MARGIN * 2;
        const glowH = ch + GLOW_MARGIN * 2;

        const ctrl = [];
        for (let i = 0; i < NUM_CTRL; i++) {
            const t = i / NUM_CTRL;
            const p = perimPoint(t, cx, cy, hw, hh, glowW, glowH);
            const { nx, ny } = edgeNormal(t, glowW, glowH);

            const n = Math.sin(t * TWO_PI * 3 + time * speed + off) * 0.5
                    + Math.sin(t * TWO_PI * 7 + time * speed * 1.3 + off * 2) * 0.3
                    + Math.cos(t * TWO_PI * 11 + time * speed * 0.7) * 0.2;

            ctrl.push({ x: p.x + nx * n * cfg.spread, y: p.y + ny * n * cfg.spread });
        }

        ctx.beginPath();
        drawSmooth(ctx, ctrl);
        ctx.closePath();
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = cfg.lineW;
        ctx.globalAlpha = cfg.alpha;
        ctx.stroke();
    }

    // ── Recalcul des cibles (appelé uniquement quand dirty) ──

    function rebuildTargets() {
        _dirty = false;
        const newTargets = [];
        const activeEls = new Set();
        // Only hero glows remain in CardGlow — hand/board glows handled by Pixi

        // Build a map of previous targets by element for fast lookup & canvas reuse
        const prevByEl = new Map();
        for (const prev of _cachedTargets) {
            prevByEl.set(prev.el, prev);
        }

        // Reuse canvas/ctx/_sized/_positioned from a previous target or from an existing DOM canvas
        function reuseCanvasState(target) {
            const prev = prevByEl.get(target.el);
            if (prev && prev._canvas && prev._canvas.isConnected) {
                target._canvas = prev._canvas;
                target._ctx = prev._ctx;
                target._sized = prev._sized;
                target._positioned = prev._positioned;
                target._cw = prev._cw;
                target._ch = prev._ch;
                target._dpr = prev._dpr;
                target._canvasW = prev._canvasW;
                target._canvasH = prev._canvasH;
            } else {
                // Check if the card element already has a glow canvas child (survived across phases)
                const existing = target.el.querySelector('.card-glow-canvas');
                if (existing) {
                    target._canvas = existing;
                    target._ctx = existing.getContext('2d');
                    // Keep _sized true if dimensions haven't changed
                    target._sized = true;
                    target._positioned = true;
                }
            }
            return target;
        }

        // Cartes en main (playable, pas committed, pas cachée par custom-dragging)
        // Cache borderW/borderR par élément pour éviter getComputedStyle à chaque frame
        function getCachedBorder(el) {
            if (el._glowBorderW !== undefined) return { borderW: el._glowBorderW, borderR: el._glowBorderR };
            const style = getComputedStyle(el);
            el._glowBorderW = parseFloat(style.borderLeftWidth) || 0;
            el._glowBorderR = parseFloat(style.borderRadius) || 0;
            return { borderW: el._glowBorderW, borderR: el._glowBorderR };
        }

        // Hand cards & committed spells: handled by pixi-hand-layer + pixi-card-glow (skip)
        // Board cards (can-attack, spell-targetable, in-combat): handled by pixi-board-layer (skip)

        // Héros ciblables / ciblés par un sort (stays in DOM glow)
        const heroCards = document.querySelectorAll('.hero-card.hero-targetable, .hero-card.hero-hover-target');
        for (const heroEl of heroCards) {
            if (activeEls.has(heroEl)) continue;
            const { borderW, borderR } = getCachedBorder(heroEl);
            const isHoverTarget = heroEl.classList.contains('hero-hover-target');
            const isHover = heroEl.matches(':hover');
            const layers = isHoverTarget ? LAYER_CONFIGS_ORANGE : (isHover ? LAYER_CONFIGS_ORANGE : LAYER_CONFIGS_BLUE);
            newTargets.push(reuseCanvasState({ el: heroEl, layers, borderW, borderR, isArena: true }));
            activeEls.add(heroEl);
        }

        // Hide canvases on cards that lost glow status but remain in the DOM.
        // Don't remove — they'll be reused if the card becomes a target again.
        // Cards removed from DOM take their canvas children with them automatically.
        for (const prev of _cachedTargets) {
            if (!activeEls.has(prev.el) && prev._canvas && prev._canvas.isConnected) {
                prev._canvas.style.display = 'none';
            }
        }

        _cachedTargets = newTargets;
    }

    // ── Boucle d'animation (10fps cap) ──

    const FRAME_INTERVAL = 1000 / 10; // 10fps
    let _lastFrameTime = 0;

    function update(timestamp) {
        // Cap à 10fps : skip si le delta est trop court
        if (timestamp - _lastFrameTime < FRAME_INTERVAL) {
            animId = requestAnimationFrame(update);
            return;
        }
        _lastFrameTime = timestamp;

        // Pendant la résolution, retirer les canvas glow du render tree (display:none).
        // visibility:hidden ne suffit pas — Chrome compositor garde les layers.
        if (typeof state !== 'undefined' && state && state.phase === 'resolution') {
            if (!_glowHidden) {
                _glowHidden = true;
                document.querySelectorAll('.card-glow-canvas').forEach(c => {
                    c.style.display = 'none';
                });
            }
            animId = requestAnimationFrame(update);
            return;
        }
        // Sortie de résolution : remettre les canvas et forcer redraw
        if (_glowHidden) {
            _glowHidden = false;
            _dirty = true;
            document.querySelectorAll('.card-glow-canvas').forEach(c => {
                c.style.display = '';
            });
        }

        const dt = lastTime ? (timestamp - lastTime) / 1000 : (FRAME_INTERVAL / 1000);
        lastTime = timestamp;
        elapsed += dt;

        // Recalculer les cibles DOM uniquement si l'état a changé
        if (_dirty) {
            rebuildTargets();
        }

        // Si aucune cible, arrêter la boucle — elle redémarrera via markDirty()
        if (_cachedTargets.length === 0) {
            animId = null;
            return;
        }

        animId = requestAnimationFrame(update);

        // Mettre à jour le glow hover à chaque frame (héros uniquement)
        for (const target of _cachedTargets) {
            // Héros ciblables : hover orange / sinon bleu
            if (target.el.classList.contains('hero-targetable') && !target.el.classList.contains('hero-hover-target')) {
                target.layers = target.el.matches(':hover') ? LAYER_CONFIGS_ORANGE : LAYER_CONFIGS_BLUE;
            }
        }

        for (const target of _cachedTargets) {
            const { el: cardEl, layers, borderW, borderR } = target;
            // Vérifier que l'élément est toujours dans le DOM
            if (!cardEl.isConnected) continue;

            if (target._canvas && target._canvas.style.display === 'none') {
                target._canvas.style.display = '';
            }

            // Créer ou récupérer le canvas glow
            let glowCanvas = target._canvas;
            if (!glowCanvas || !glowCanvas.isConnected) {
                glowCanvas = cardEl.querySelector('.card-glow-canvas');
                if (glowCanvas) {
                    // Reuse existing canvas — preserve dimensions if already sized
                    target._canvas = glowCanvas;
                    target._ctx = glowCanvas.getContext('2d');
                    // _sized stays as-is (true if carried over, undefined/false if new target)
                    if (!target._sized) target._sized = false;
                    if (!target._positioned) target._positioned = false;
                } else {
                    glowCanvas = document.createElement('canvas');
                    glowCanvas.className = 'card-glow-canvas';
                    glowCanvas.style.cssText = `
                        position: absolute;
                        z-index: -1;
                        pointer-events: none;
                    `;
                    cardEl.appendChild(glowCanvas);
                    target._canvas = glowCanvas;
                    target._ctx = glowCanvas.getContext('2d');
                    target._sized = false;
                }
            }

            // Mettre à jour le positionnement (une seule fois quand dirty ou pas encore fait)
            if (!target._positioned) {
                const totalOff = PADDING + borderW;
                glowCanvas.style.left = `-${totalOff}px`;
                glowCanvas.style.top = `-${totalOff}px`;
                glowCanvas.style.width = `calc(100% + ${totalOff * 2}px)`;
                glowCanvas.style.height = `calc(100% + ${totalOff * 2}px)`;
                target._positioned = true;
            }

            // Dimensions du canvas — cachées, recalculées uniquement quand dirty
            if (!target._sized) {
                const cw = cardEl.offsetWidth;
                const ch = cardEl.offsetHeight;
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                target._cw = cw;
                target._ch = ch;
                target._dpr = dpr;
                target._canvasW = cw + PADDING * 2;
                target._canvasH = ch + PADDING * 2;
                const pxW = Math.round(target._canvasW * dpr);
                const pxH = Math.round(target._canvasH * dpr);
                if (glowCanvas.width !== pxW || glowCanvas.height !== pxH) {
                    glowCanvas.width = pxW;
                    glowCanvas.height = pxH;
                }
                target._sized = true;
            }

            const { _ctx: ctx, _cw: cw, _ch: ch, _dpr: dpr, _canvasW: canvasW, _canvasH: canvasH } = target;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, canvasW, canvasH);

            // Clip : ne dessiner que en dehors de la zone visible de la carte
            // Pour arena : le clip est rétréci de quelques px pour que le glow
            // chevauche la bordure SVG (effet AAA, pas de gap visible)
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, canvasW, canvasH);
            if (target.isArena) {
                const inset = 3;
                traceOuterBorder(ctx, PADDING + inset, cw - inset * 2, ch - inset * 2);
            } else {
                ctx.roundRect(PADDING, PADDING, cw, ch, borderR);
            }
            ctx.clip('evenodd');

            // Dessiner les 4 layers centrées dans le canvas
            const cx = canvasW / 2;
            const cy = canvasH / 2;

            // Additive blending simulation : lighter composite
            ctx.globalCompositeOperation = 'lighter';

            for (let i = 0; i < layers.length; i++) {
                drawGlowLayer(ctx, elapsed, i, cx, cy, cw, ch, layers);
            }

            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.restore();
        }

    }

    // ── API publique ──

    function init() {
        if (animId) return;
        lastTime = 0;
        _dirty = true;
        animId = requestAnimationFrame(update);
    }

    function destroy() {
        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }
        document.querySelectorAll('.card-glow-canvas').forEach(c => c.remove());
        _cachedTargets = [];
        _dirty = true;
        _glowHidden = false;
        elapsed = 0;
        lastTime = 0;
    }

    function markDirty(force) {
        // Pendant la résolution, ignorer les markDirty sauf force=true
        // (les targets glow ne changent pas entre les steps d'animation)
        if (!force && typeof state !== 'undefined' && state && state.phase === 'resolution') {
            return;
        }
        _dirty = true;
        // Relancer la boucle si elle était arrêtée (0 targets précédemment)
        if (!animId) {
            animId = requestAnimationFrame(update);
        }
    }

    function _perfStats() {
        return { targets: _cachedTargets.length, running: !!animId };
    }

    function hideForResolution() {
        if (_glowHidden) return;
        _glowHidden = true;
        document.querySelectorAll('.card-glow-canvas').forEach(c => {
            c.style.display = 'none';
        });
    }

    function showAfterResolution() {
        if (!_glowHidden) return;
        _glowHidden = false;
        _dirty = true;
        document.querySelectorAll('.card-glow-canvas').forEach(c => {
            c.style.display = '';
        });
        if (!animId) {
            animId = requestAnimationFrame(update);
        }
    }

    return { init, destroy, markDirty, hideForResolution, showAfterResolution, _perfStats };
})();
