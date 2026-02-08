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

    const NUM_CTRL = 36; // Points de contrôle (léger pour Canvas 2D)
    const GLOW_MARGIN = 1;

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

    // ── Boucle d'animation ──

    function update(timestamp) {
        const dt = lastTime ? (timestamp - lastTime) / 1000 : 1 / 60;
        lastTime = timestamp;
        elapsed += dt;

        // Collecter toutes les cartes à illuminer (main + ghost drag)
        const glowTargets = [];

        // Cartes en main (playable, pas committed, pas cachée par custom-dragging)
        const playableCards = document.querySelectorAll('.my-hand .card.playable');
        for (const cardEl of playableCards) {
            if (cardEl.classList.contains('committed') || cardEl.classList.contains('custom-dragging')) {
                const existing = cardEl.querySelector('.card-glow-canvas');
                if (existing) existing.remove();
                continue;
            }
            const isDragging = cardEl.classList.contains('arrow-dragging');
            glowTargets.push({ el: cardEl, layers: isDragging ? LAYER_CONFIGS_ORANGE : LAYER_CONFIGS_BLUE });
        }

        // Ghost de drag (élément flottant hors de la main)
        const ghostCard = document.querySelector('.drag-ghost-card');
        if (ghostCard) {
            glowTargets.push({ el: ghostCard, layers: LAYER_CONFIGS_ORANGE });
        }

        // Cartes sur le terrain qui peuvent attaquer (glow vert)
        const attackCards = document.querySelectorAll('.card-slot .card.can-attack');
        for (const cardEl of attackCards) {
            glowTargets.push({ el: cardEl, layers: LAYER_CONFIGS_GREEN });
        }

        for (const { el: cardEl, layers } of glowTargets) {
            // Lire dynamiquement la bordure CSS (varie selon état hover, has-image, etc.)
            const style = getComputedStyle(cardEl);
            const borderW = parseFloat(style.borderLeftWidth) || 0;
            const borderR = parseFloat(style.borderRadius) || 0;

            // Créer ou récupérer le canvas glow
            let glowCanvas = cardEl.querySelector('.card-glow-canvas');
            if (!glowCanvas) {
                glowCanvas = document.createElement('canvas');
                glowCanvas.className = 'card-glow-canvas';
                glowCanvas.style.cssText = `
                    position: absolute;
                    z-index: -1;
                    pointer-events: none;
                `;
                cardEl.appendChild(glowCanvas);
            }

            // Mettre à jour le positionnement du canvas (compense le padding-edge offset)
            // position:absolute left/top sont relatifs au padding-edge, pas au border-box
            const totalOff = PADDING + borderW;
            glowCanvas.style.left = `-${totalOff}px`;
            glowCanvas.style.top = `-${totalOff}px`;
            glowCanvas.style.width = `calc(100% + ${totalOff * 2}px)`;
            glowCanvas.style.height = `calc(100% + ${totalOff * 2}px)`;

            // Dimensions du canvas (haute résolution)
            // offsetWidth/Height incluent la bordure CSS
            const cw = cardEl.offsetWidth;
            const ch = cardEl.offsetHeight;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const canvasW = cw + PADDING * 2;
            const canvasH = ch + PADDING * 2;
            const pxW = Math.round(canvasW * dpr);
            const pxH = Math.round(canvasH * dpr);

            if (glowCanvas.width !== pxW || glowCanvas.height !== pxH) {
                glowCanvas.width = pxW;
                glowCanvas.height = pxH;
            }

            const ctx = glowCanvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, canvasW, canvasH);

            // Clip : ne dessiner que en dehors de la zone visible de la carte (border-box)
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, canvasW, canvasH);
            ctx.roundRect(PADDING, PADDING, cw, ch, borderR);
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

        // Nettoyer les canvas orphelins
        const allGlows = document.querySelectorAll('.card-glow-canvas');
        for (const c of allGlows) {
            const parent = c.parentElement;
            if (!parent) { c.remove(); continue; }
            // Ghost cards : garder
            if (parent.classList.contains('drag-ghost-card')) continue;
            // Cartes en main : garder si playable et pas committed/cachée
            if (parent.classList.contains('playable') &&
                !parent.classList.contains('committed') &&
                !parent.classList.contains('custom-dragging') &&
                parent.closest('.my-hand')) continue;
            // Cartes sur le terrain : garder si can-attack
            if (parent.classList.contains('can-attack') &&
                parent.closest('.card-slot')) continue;
            c.remove();
        }

        animId = requestAnimationFrame(update);
    }

    // ── API publique ──

    function init() {
        if (animId) return;
        lastTime = 0;
        animId = requestAnimationFrame(update);
    }

    function destroy() {
        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }
        document.querySelectorAll('.card-glow-canvas').forEach(c => c.remove());
        elapsed = 0;
        lastTime = 0;
    }

    return { init, destroy };
})();
