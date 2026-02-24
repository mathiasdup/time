/**
 * Pixi Card View Architecture
 *
 * Goals:
 * - Compose card once into RenderTexture (art + frame + text + badges)
 * - Apply tilt/perspective on the baked texture (PerspectiveMesh when available)
 * - Keep glare/foil as GPU overlay (never re-render full card RT for it)
 * - Reuse one shared shadow texture for all cards
 * - Avoid per-card ticker (global ticker should drive all live cards)
 */
(function () {
    'use strict';

    const DEFAULTS = {
        cardWidth: 144,
        cardHeight: 192,
        rtScaleSmall: 2,
        rtScaleLarge: 3,
        useDomSnapshotSkin: true,
        usePerspectiveMesh: false,
        hiResCacheMax: 4,
        destroyHiResOnPointerOut: true,
        hoverScale: 1.12,
        maxTiltDeg: 9,
        tiltEase: 14,
        scaleEase: 12
    };

    const RUNTIME = {
        app: null,
        stage: null,
        options: { ...DEFAULTS },
        sharedShadowTexture: null,
        sharedGlareTexture: null,
        sharedIconCache: new Map(),
        artTextureCache: new Map(),
        hiResLru: [],
        tickerAttached: false,
        domSnapshotBlocked: false
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function damp(current, target, rate, dt) {
        const k = 1 - Math.exp(-rate * dt);
        return current + (target - current) * k;
    }

    function getBlendAdd() {
        return (window.PIXI && PIXI.BLEND_MODES && PIXI.BLEND_MODES.ADD) || 'add';
    }

    function resolveRenderer() {
        if (RUNTIME.app && RUNTIME.app.renderer) return RUNTIME.app.renderer;
        return null;
    }

    function tryAutoInitFromGlobals() {
        if (RUNTIME.app && RUNTIME.app.renderer) return true;
        if (window.CombatVFX && window.CombatVFX.app && window.CombatVFX.app.renderer) {
            RUNTIME.app = window.CombatVFX.app;
            RUNTIME.stage = window.CombatVFX.app.stage;
            return true;
        }
        return false;
    }

    function ensureInitialized() {
        if (!resolveRenderer()) {
            tryAutoInitFromGlobals();
        }
        const renderer = resolveRenderer();
        if (!renderer) {
            throw new Error('PixiCardView is not initialized. Call PixiCardView.init({ app, stage }).');
        }
        if (!RUNTIME.sharedShadowTexture) {
            RUNTIME.sharedShadowTexture = createSharedShadowTexture();
        }
        if (!RUNTIME.sharedGlareTexture) {
            RUNTIME.sharedGlareTexture = createSharedGlareTexture();
        }
    }

    function destroyTextureSafe(tex) {
        if (!tex) return;
        try {
            tex.destroy(true);
        } catch (err) {
            // no-op
        }
    }

    function createCanvasTextureFromGenerator(width, height, drawFn) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        drawFn(ctx, width, height);
        return PIXI.Texture.from(canvas);
    }

    function createSharedShadowTexture() {
        return createCanvasTextureFromGenerator(320, 120, (ctx, w, h) => {
            const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.45);
            grad.addColorStop(0, 'rgba(0,0,0,0.48)');
            grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        });
    }

    function createSharedGlareTexture() {
        return createCanvasTextureFromGenerator(256, 256, (ctx, w, h) => {
            const lg = ctx.createLinearGradient(0, 0, w, h);
            lg.addColorStop(0, 'rgba(255,255,255,0.00)');
            lg.addColorStop(0.35, 'rgba(255,255,255,0.36)');
            lg.addColorStop(0.5, 'rgba(255,255,255,0.68)');
            lg.addColorStop(0.65, 'rgba(255,255,255,0.36)');
            lg.addColorStop(1, 'rgba(255,255,255,0.00)');
            ctx.fillStyle = lg;
            ctx.fillRect(0, 0, w, h);
        });
    }

    function readCardArtPath(data) {
        if (!data || !data.image) return null;
        if (String(data.image).startsWith('/')) return data.image;
        return `/cards/${data.image}`;
    }

    function normalizeCardData(input) {
        const data = input || {};
        return {
            id: data.uid || data.id || `card-${Math.random().toString(36).slice(2)}`,
            name: String(data.name || 'Card'),
            image: data.image || null,
            type: String(data.type || 'creature'),
            abilities: Array.isArray(data.abilities) ? data.abilities : [],
            cost: Number.isFinite(Number(data.cost)) ? Math.max(0, Math.floor(Number(data.cost))) : 0,
            atk: Number.isFinite(Number(data.atk)) ? Math.max(0, Math.floor(Number(data.atk))) : 0,
            hp: Number.isFinite(Number(data.currentHp ?? data.hp)) ? Math.max(0, Math.floor(Number(data.currentHp ?? data.hp))) : 0
        };
    }

    function canUseDomSnapshotSkin() {
        if (!RUNTIME.options.useDomSnapshotSkin) return false;
        if (RUNTIME.domSnapshotBlocked) return false;
        if (typeof window === 'undefined' || typeof document === 'undefined') return false;
        if (window.ENABLE_PIXI_DOM_SNAPSHOT_SKIN === false) return false;
        if (typeof window.getComputedStyle !== 'function') return false;
        return typeof XMLSerializer !== 'undefined';
    }

    function cloneWithInlineStyles(sourceRoot) {
        if (!sourceRoot || sourceRoot.nodeType !== 1) return null;
        const cloneRoot = sourceRoot.cloneNode(true);
        const srcStack = [sourceRoot];
        const dstStack = [cloneRoot];

        while (srcStack.length) {
            const src = srcStack.pop();
            const dst = dstStack.pop();
            if (!src || !dst || src.nodeType !== 1 || dst.nodeType !== 1) continue;

            const cs = window.getComputedStyle(src);
            let styleText = '';
            for (let i = 0; i < cs.length; i++) {
                const prop = cs[i];
                styleText += `${prop}:${cs.getPropertyValue(prop)};`;
            }
            dst.setAttribute('style', styleText);
            dst.style.animation = 'none';
            dst.style.transition = 'none';
            dst.style.transform = 'none';
            dst.style.cursor = 'default';

            const srcChildren = src.children || [];
            const dstChildren = dst.children || [];
            const count = Math.min(srcChildren.length, dstChildren.length);
            for (let i = 0; i < count; i++) {
                srcStack.push(srcChildren[i]);
                dstStack.push(dstChildren[i]);
            }
        }

        return cloneRoot;
    }

    function buildDomSnapshotMarkup(sourceEl, width, height) {
        if (!canUseDomSnapshotSkin() || !sourceEl || sourceEl.nodeType !== 1) return null;
        const clone = cloneWithInlineStyles(sourceEl);
        if (!clone) return null;

        clone.classList.remove('pixi-hand-host', 'pixi-board-host', 'custom-dragging');
        clone.querySelectorAll('.card-glow-canvas').forEach((el) => el.remove());

        clone.style.width = `${Math.max(1, Math.round(width))}px`;
        clone.style.height = `${Math.max(1, Math.round(height))}px`;
        clone.style.margin = '0';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.position = 'relative';
        clone.style.opacity = '1';
        clone.style.visibility = 'visible';
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

        const serializer = new XMLSerializer();
        return serializer.serializeToString(clone);
    }

    function composeDomSnapshotTextureAsync(markup, width, height, scale) {
        return new Promise((resolve, reject) => {
            try {
                if (!markup) {
                    reject(new Error('missing-markup'));
                    return;
                }

                const W = Math.max(1, Math.round(width));
                const H = Math.max(1, Math.round(height));
                const r = Math.max(1, Number(scale) || 1);
                const pxW = Math.max(1, Math.round(W * r));
                const pxH = Math.max(1, Math.round(H * r));

                const svg = [
                    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${W} ${H}">`,
                    `<foreignObject x="0" y="0" width="${W}" height="${H}">`,
                    markup,
                    '</foreignObject>',
                    '</svg>'
                ].join('');

                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.decoding = 'async';

                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = pxW;
                        canvas.height = pxH;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            URL.revokeObjectURL(url);
                            reject(new Error('canvas-context'));
                            return;
                        }
                        ctx.clearRect(0, 0, pxW, pxH);
                        ctx.drawImage(img, 0, 0, pxW, pxH);

                        // Some browsers can silently produce a blank foreignObject render.
                        // Detect an all-transparent output and keep the fallback RT instead.
                        let hasVisiblePixel = false;
                        try {
                            const sampleCols = 8;
                            const sampleRows = 8;
                            const stepX = Math.max(1, Math.floor(pxW / sampleCols));
                            const stepY = Math.max(1, Math.floor(pxH / sampleRows));
                            for (let sy = 0; sy < pxH && !hasVisiblePixel; sy += stepY) {
                                for (let sx = 0; sx < pxW; sx += stepX) {
                                    const a = ctx.getImageData(sx, sy, 1, 1).data[3];
                                    if (a > 0) {
                                        hasVisiblePixel = true;
                                        break;
                                    }
                                }
                            }
                        } catch (sampleErr) {
                            const sn = String(sampleErr?.name || '');
                            const sm = String(sampleErr?.message || '');
                            if (/securityerror/i.test(sn) || /tainted/i.test(sm)) {
                                URL.revokeObjectURL(url);
                                reject(new Error('tainted-dom-snapshot'));
                                return;
                            }
                            hasVisiblePixel = true;
                        }
                        if (!hasVisiblePixel) {
                            URL.revokeObjectURL(url);
                            reject(new Error('blank-dom-snapshot'));
                            return;
                        }

                        URL.revokeObjectURL(url);
                        resolve(PIXI.Texture.from(canvas));
                    } catch (err) {
                        URL.revokeObjectURL(url);
                        reject(err);
                    }
                };

                img.onerror = (err) => {
                    URL.revokeObjectURL(url);
                    reject(err || new Error('snapshot-image-error'));
                };

                img.src = url;
            } catch (err) {
                reject(err);
            }
        });
    }

    function requestTexture(url, onLoaded) {
        if (!url) return null;
        let entry = RUNTIME.artTextureCache.get(url);
        if (!entry) {
            entry = { texture: null, listeners: new Set(), loading: false };
            RUNTIME.artTextureCache.set(url, entry);
        }
        if (entry.texture) return entry.texture;
        if (onLoaded) entry.listeners.add(onLoaded);
        if (!entry.loading) {
            entry.loading = true;
            PIXI.Assets.load(url).then((tex) => {
                entry.texture = tex;
                entry.loading = false;
                for (const fn of entry.listeners) {
                    try {
                        fn(tex);
                    } catch (err) {
                        // no-op
                    }
                }
                entry.listeners.clear();
            }).catch(() => {
                entry.loading = false;
            });
        }
        return null;
    }

    function unlistenTexture(url, fn) {
        if (!url || !fn) return;
        const entry = RUNTIME.artTextureCache.get(url);
        if (!entry || !entry.listeners) return;
        entry.listeners.delete(fn);
    }

    function getTypeLine(data) {
        if (data.type === 'spell') return 'Spell';
        if (data.type === 'trap') return 'Trap';
        if (data.abilities.includes('shooter')) return 'Creature - Shooter';
        if (data.abilities.includes('fly')) return 'Creature - Flying';
        return 'Creature - Melee';
    }

    function getAbilitiesLine(data) {
        if (!data.abilities.length) return '';
        const maxItems = 4;
        return data.abilities.slice(0, maxItems).join(', ');
    }

    function drawRoundRectPath2D(ctx, x, y, w, h, r) {
        const rr = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }

    function extractArtSourceFromTexture(artTexture) {
        if (!artTexture) return null;
        const tex = artTexture;
        const src = tex.source || tex.baseTexture || null;
        if (src) {
            if (src.resource && src.resource.source) return src.resource.source;
            if (src.source) return src.source;
        }
        if (tex.baseTexture && tex.baseTexture.resource && tex.baseTexture.resource.source) {
            return tex.baseTexture.resource.source;
        }
        return null;
    }

    function buildCardCompositionContainer(cardData, artTexture, opts) {
        const W = opts.cardWidth;
        const H = opts.cardHeight;

        const root = new PIXI.Container();

        const bg = new PIXI.Graphics();
        bg.roundRect(0, 0, W, H, 11);
        bg.fill({ color: 0x1d1d23 });
        root.addChild(bg);

        if (artTexture) {
            const art = new PIXI.Sprite(artTexture);
            const artAreaH = Math.floor(H * 0.62);
            const sx = W / artTexture.width;
            const sy = artAreaH / artTexture.height;
            const scale = Math.max(sx, sy);
            art.scale.set(scale);
            art.x = (W - artTexture.width * scale) * 0.5;
            art.y = (artAreaH - artTexture.height * scale) * 0.5;

            const artMask = new PIXI.Graphics();
            artMask.roundRect(4, 4, W - 8, artAreaH - 2, 8);
            artMask.fill({ color: 0xffffff });
            root.addChild(artMask);
            art.mask = artMask;
            root.addChild(art);
        }

        const frame = new PIXI.Graphics();
        frame.roundRect(0, 0, W, H, 11);
        frame.stroke({ color: 0x3f3c38, width: 3 });
        root.addChild(frame);

        const nameBand = new PIXI.Graphics();
        nameBand.roundRect(8, Math.floor(H * 0.56), W - 16, 20, 6);
        nameBand.fill({ color: 0x000000, alpha: 0.68 });
        root.addChild(nameBand);

        const nameText = new PIXI.Text({
            text: cardData.name,
            style: {
                fontFamily: 'Bree Serif, serif',
                fontSize: 11,
                fontWeight: '700',
                fill: 0xffffff
            }
        });
        nameText.anchor.set(0.5);
        nameText.position.set(W * 0.5, Math.floor(H * 0.56) + 10);
        root.addChild(nameText);

        const textZone = new PIXI.Graphics();
        textZone.roundRect(8, Math.floor(H * 0.67), W - 16, Math.floor(H * 0.23), 6);
        textZone.fill({ color: 0x020202, alpha: 0.62 });
        root.addChild(textZone);

        const typeText = new PIXI.Text({
            text: getTypeLine(cardData),
            style: {
                fontFamily: 'Quicksand, sans-serif',
                fontSize: 9,
                fill: 0xd9d9d9
            }
        });
        typeText.anchor.set(0.5, 0);
        typeText.position.set(W * 0.5, Math.floor(H * 0.67) + 3);
        root.addChild(typeText);

        const abilitiesLine = getAbilitiesLine(cardData);
        if (abilitiesLine) {
            const abilitiesText = new PIXI.Text({
                text: abilitiesLine,
                style: {
                    fontFamily: 'Quicksand, sans-serif',
                    fontSize: 9,
                    fill: 0xffd774,
                    fontWeight: '700',
                    wordWrap: true,
                    wordWrapWidth: W - 24
                }
            });
            abilitiesText.anchor.set(0.5, 0);
            abilitiesText.position.set(W * 0.5, Math.floor(H * 0.67) + 16);
            root.addChild(abilitiesText);
        }

        const manaBadge = new PIXI.Graphics();
        manaBadge.circle(16, 16, 13);
        manaBadge.fill({ color: 0x2f9bff });
        manaBadge.stroke({ color: 0x102744, width: 2 });
        root.addChild(manaBadge);

        const manaText = new PIXI.Text({
            text: String(cardData.cost),
            style: {
                fontFamily: 'Merriweather Sans, sans-serif',
                fontSize: 13,
                fontWeight: '800',
                fill: 0xffffff
            }
        });
        manaText.anchor.set(0.5);
        manaText.position.set(16, 16);
        root.addChild(manaText);

        if (cardData.type === 'creature') {
            const atkBadge = new PIXI.Graphics();
            atkBadge.circle(15, H - 15, 13);
            atkBadge.fill({ color: 0x2fbd5f });
            atkBadge.stroke({ color: 0x173823, width: 2 });
            root.addChild(atkBadge);

            const atkText = new PIXI.Text({
                text: String(cardData.atk),
                style: {
                    fontFamily: 'Merriweather Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: '800',
                    fill: 0xffffff
                }
            });
            atkText.anchor.set(0.5);
            atkText.position.set(15, H - 15);
            root.addChild(atkText);

            const hpBadge = new PIXI.Graphics();
            hpBadge.circle(W - 15, H - 15, 13);
            hpBadge.fill({ color: 0xd24b47 });
            hpBadge.stroke({ color: 0x4a1715, width: 2 });
            root.addChild(hpBadge);

            const hpText = new PIXI.Text({
                text: String(cardData.hp),
                style: {
                    fontFamily: 'Merriweather Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: '800',
                    fill: 0xffffff
                }
            });
            hpText.anchor.set(0.5);
            hpText.position.set(W - 15, H - 15);
            root.addChild(hpText);
        }

        return root;
    }

    function composeCardFallbackTexture(cardData, scale, artTexture) {
        const renderer = resolveRenderer();
        const W = RUNTIME.options.cardWidth;
        const H = RUNTIME.options.cardHeight;
        if (renderer && typeof renderer.generateTexture === 'function') {
            let composeContainer = null;
            try {
                composeContainer = buildCardCompositionContainer(cardData, artTexture, RUNTIME.options);
                const tex = renderer.generateTexture({
                    target: composeContainer,
                    frame: new PIXI.Rectangle(0, 0, W, H),
                    resolution: Math.max(1, Number(scale) || 1)
                });
                composeContainer.destroy({ children: true });
                return tex;
            } catch (_) {
                if (composeContainer) {
                    try { composeContainer.destroy({ children: true }); } catch (_) { /* no-op */ }
                }
            }
        }

        const r = Math.max(1, Number(scale) || 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(W * r));
        canvas.height = Math.max(1, Math.round(H * r));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return PIXI.Texture.WHITE;
        }

        ctx.setTransform(r, 0, 0, r, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#2a2a33');
        bgGrad.addColorStop(1, '#1a1a20');
        drawRoundRectPath2D(ctx, 0, 0, W, H, 11);
        ctx.fillStyle = bgGrad;
        ctx.fill();

        const artAreaH = Math.floor(H * 0.62);
        ctx.save();
        drawRoundRectPath2D(ctx, 4, 4, W - 8, artAreaH - 2, 8);
        ctx.clip();
        // Security-safe fallback (no drawImage) to avoid tainted-canvas tex upload failures.
        const artGrad = ctx.createLinearGradient(0, 0, 0, artAreaH);
        artGrad.addColorStop(0, '#44424f');
        artGrad.addColorStop(1, '#2d2b33');
        ctx.fillStyle = artGrad;
        ctx.fillRect(0, 0, W, artAreaH);
        ctx.restore();

        ctx.lineWidth = 3;
        ctx.strokeStyle = '#3f3c38';
        drawRoundRectPath2D(ctx, 0, 0, W, H, 11);
        ctx.stroke();

        drawRoundRectPath2D(ctx, 8, Math.floor(H * 0.56), W - 16, 20, 6);
        ctx.fillStyle = 'rgba(0,0,0,0.68)';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px "Bree Serif", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cardData.name || 'Card', W * 0.5, Math.floor(H * 0.56) + 10, W - 24);

        drawRoundRectPath2D(ctx, 8, Math.floor(H * 0.67), W - 16, Math.floor(H * 0.23), 6);
        ctx.fillStyle = 'rgba(2,2,2,0.62)';
        ctx.fill();

        ctx.fillStyle = '#d9d9d9';
        ctx.font = '9px "Quicksand", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(getTypeLine(cardData), W * 0.5, Math.floor(H * 0.67) + 3, W - 24);

        const abilitiesLine = getAbilitiesLine(cardData);
        if (abilitiesLine) {
            ctx.fillStyle = '#ffd774';
            ctx.font = '700 9px "Quicksand", sans-serif';
            ctx.fillText(abilitiesLine, W * 0.5, Math.floor(H * 0.67) + 16, W - 24);
        }

        ctx.fillStyle = '#2f9bff';
        ctx.beginPath();
        ctx.arc(16, 16, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#102744';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 13px "Merriweather Sans", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(cardData.cost ?? 0), 16, 16);

        if (cardData.type === 'creature') {
            ctx.fillStyle = '#2fbd5f';
            ctx.beginPath();
            ctx.arc(15, H - 15, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#173823';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = '800 13px "Merriweather Sans", sans-serif';
            ctx.fillText(String(cardData.atk ?? 0), 15, H - 15);

            ctx.fillStyle = '#d24b47';
            ctx.beginPath();
            ctx.arc(W - 15, H - 15, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#4a1715';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(cardData.hp ?? 0), W - 15, H - 15);
        }

        return PIXI.Texture.from(canvas);
    }

    function supportsPerspectiveMesh() {
        if (!RUNTIME.options.usePerspectiveMesh) return false;
        return typeof PIXI.PerspectiveMesh === 'function';
    }

    function createPerspectiveDisplay(texture) {
        if (supportsPerspectiveMesh()) {
            return new PIXI.PerspectiveMesh({
                texture
            });
        }
        return new PIXI.Sprite(texture);
    }

    function setPerspectiveCornersCompat(mesh, corners) {
        if (!mesh) return false;

        if (typeof mesh.setCorners === 'function') {
            mesh.setCorners(
                corners.tl.x, corners.tl.y,
                corners.tr.x, corners.tr.y,
                corners.br.x, corners.br.y,
                corners.bl.x, corners.bl.y
            );
            return true;
        }

        if (typeof mesh.setCorner === 'function') {
            const byName = [
                ['topLeft', corners.tl],
                ['topRight', corners.tr],
                ['bottomRight', corners.br],
                ['bottomLeft', corners.bl]
            ];
            try {
                for (const [name, p] of byName) {
                    mesh.setCorner(name, p.x, p.y);
                }
                return true;
            } catch (err) {
                // Try numeric fallback.
            }
            const byIndex = [corners.tl, corners.tr, corners.br, corners.bl];
            try {
                for (let i = 0; i < byIndex.length; i++) {
                    mesh.setCorner(i, byIndex[i].x, byIndex[i].y);
                }
                return true;
            } catch (err) {
                return false;
            }
        }

        return false;
    }

    function touchHiResLru(view) {
        const list = RUNTIME.hiResLru;
        const idx = list.indexOf(view);
        if (idx >= 0) list.splice(idx, 1);
        list.push(view);
    }

    function destroyHiResTexture(view) {
        if (!view || !view.__largeRT) return;
        const old = view.__largeRT;
        view.__largeRT = null;
        destroyTextureSafe(old);
        const list = RUNTIME.hiResLru;
        const idx = list.indexOf(view);
        if (idx >= 0) list.splice(idx, 1);
        if (view.__usingLarge) {
            view.__usingLarge = false;
            if (view.__display && view.__smallRT) {
                view.__display.texture = view.__smallRT;
            }
        }
    }

    function evictHiResIfNeeded() {
        const max = Math.max(1, RUNTIME.options.hiResCacheMax | 0);
        const list = RUNTIME.hiResLru;
        while (list.length > max) {
            const victim = list.shift();
            if (!victim) continue;
            if (victim.__isHovered) {
                // Keep hovered card alive, move it to tail and continue.
                list.push(victim);
                if (list.length <= max) break;
                continue;
            }
            destroyHiResTexture(victim);
        }
    }

    function buildCardApi(initialData, creationOpts) {
        ensureInitialized();

        const data = normalizeCardData(initialData);
        const createOpts = creationOpts || {};
        const opts = RUNTIME.options;
        const cardWidth = opts.cardWidth;
        const cardHeight = opts.cardHeight;
        let domSnapshotMarkup = null;
        if (canUseDomSnapshotSkin() && createOpts.domSourceEl && createOpts.domSourceEl.nodeType === 1) {
            domSnapshotMarkup = buildDomSnapshotMarkup(createOpts.domSourceEl, cardWidth, cardHeight);
        }

        const container = new PIXI.Container();
        container.eventMode = 'static';
        container.sortableChildren = true;
        container.hitArea = new PIXI.Rectangle(-cardWidth * 0.5, -cardHeight * 0.5, cardWidth, cardHeight);

        const shadow = new PIXI.Sprite(RUNTIME.sharedShadowTexture);
        shadow.anchor.set(0.5);
        shadow.alpha = 0.56;
        shadow.zIndex = 0;
        container.addChild(shadow);

        const smallArtPath = readCardArtPath(data);
        const artTexture = requestTexture(smallArtPath, onArtTextureReady);
        const smallRT = composeCardFallbackTexture(data, opts.rtScaleSmall, artTexture);
        const display = createPerspectiveDisplay(smallRT);
        display.zIndex = 10;
        display.eventMode = 'none';
        container.addChild(display);

        const glare = new PIXI.Sprite(RUNTIME.sharedGlareTexture);
        glare.anchor.set(0.5);
        glare.blendMode = getBlendAdd();
        glare.alpha = 0;
        glare.tint = 0xffffff;
        glare.eventMode = 'none';
        glare.zIndex = 20;
        container.addChild(glare);

        // Subtle foil tint layer, still overlay-only and fully GPU-side.
        const foil = new PIXI.Sprite(PIXI.Texture.WHITE);
        foil.anchor.set(0.5);
        foil.alpha = 0.0;
        foil.tint = 0x88c8ff;
        foil.blendMode = getBlendAdd();
        foil.eventMode = 'none';
        foil.zIndex = 21;
        container.addChild(foil);

        const state = {
            x: 0,
            y: 0,
            width: cardWidth,
            height: cardHeight,
            baseScale: 1,
            zIndex: 0,
            hoverScale: opts.hoverScale,
            isHovered: false,
            px: 0,
            py: 0,
            nx: 0,
            ny: 0,
            targetTiltXDeg: 0,
            targetTiltYDeg: 0,
            curTiltXDeg: 0,
            curTiltYDeg: 0,
            curScale: 1
        };

        let destroyed = false;
        let largeRT = null;
        let usingLarge = false;
        let pendingArtRecompose = false;
        let domSmallToken = 0;
        let domLargeToken = 0;

        function scheduleDomSnapshot(kind, scale) {
            if (!domSnapshotMarkup || destroyed) return;
            const token = (kind === 'large') ? (++domLargeToken) : (++domSmallToken);
            composeDomSnapshotTextureAsync(domSnapshotMarkup, cardWidth, cardHeight, scale).then((tex) => {
                if (destroyed) {
                    destroyTextureSafe(tex);
                    return;
                }
                if (kind === 'large') {
                    if (token !== domLargeToken) {
                        destroyTextureSafe(tex);
                        return;
                    }
                    const oldLarge = largeRT;
                    largeRT = tex;
                    api.__largeRT = tex;
                    if (usingLarge) {
                        display.texture = tex;
                    }
                    destroyTextureSafe(oldLarge);
                    return;
                }
                if (token !== domSmallToken) {
                    destroyTextureSafe(tex);
                    return;
                }
                const oldSmall = api.__smallRT;
                api.__smallRT = tex;
                if (!usingLarge) {
                    display.texture = tex;
                }
                destroyTextureSafe(oldSmall);
            }).catch((err) => {
                const msg = String(err?.message || err || '');
                if (/tainted-dom-snapshot/i.test(msg)) {
                    RUNTIME.domSnapshotBlocked = true;
                    if (typeof window !== 'undefined') {
                        window.ENABLE_PIXI_DOM_SNAPSHOT_SKIN = false;
                    }
                    // This card instance must exit snapshot mode and continue
                    // with normal art-based composition.
                    domSnapshotMarkup = null;
                    domSmallToken += 1;
                    domLargeToken += 1;
                    pendingArtRecompose = true;
                }
                // Keep fallback texture if snapshot generation fails.
            });
        }

        function refreshDomSnapshotFromElement(sourceEl) {
            if (!canUseDomSnapshotSkin() || !sourceEl || sourceEl.nodeType !== 1) return false;
            const markup = buildDomSnapshotMarkup(sourceEl, cardWidth, cardHeight);
            if (!markup) return false;
            domSnapshotMarkup = markup;
            scheduleDomSnapshot('small', opts.rtScaleSmall);
            if (largeRT || usingLarge) {
                scheduleDomSnapshot('large', opts.rtScaleLarge);
            }
            return true;
        }

        function onArtTextureReady() {
            if (destroyed) return;
            if (domSnapshotMarkup) return;
            // Recompose once when art is loaded (still not per-frame).
            pendingArtRecompose = true;
        }

        function recomposeTexturesIfNeeded() {
            if (!pendingArtRecompose || destroyed) return;
            if (domSnapshotMarkup) return;
            pendingArtRecompose = false;
            const loadedArt = requestTexture(smallArtPath, onArtTextureReady);
            if (!loadedArt) return;

            const newSmall = composeCardFallbackTexture(data, opts.rtScaleSmall, loadedArt);
            const oldSmall = api.__smallRT;
            api.__smallRT = newSmall;
            if (!usingLarge) {
                display.texture = newSmall;
            }
            destroyTextureSafe(oldSmall);

            if (largeRT) {
                const newLarge = composeCardFallbackTexture(data, opts.rtScaleLarge, loadedArt);
                const oldLarge = largeRT;
                largeRT = newLarge;
                api.__largeRT = newLarge;
                if (usingLarge) {
                    display.texture = newLarge;
                }
                destroyTextureSafe(oldLarge);
            }
        }

        function ensureLargeTexture() {
            if (destroyed) return;
            if (!largeRT) {
                const loadedArt = requestTexture(smallArtPath, onArtTextureReady);
                largeRT = composeCardFallbackTexture(data, opts.rtScaleLarge, loadedArt);
                api.__largeRT = largeRT;
                if (domSnapshotMarkup) {
                    scheduleDomSnapshot('large', opts.rtScaleLarge);
                }
            }
            usingLarge = true;
            api.__usingLarge = true;
            display.texture = largeRT;
            touchHiResLru(api);
            evictHiResIfNeeded();
        }

        function releaseLargeTexture() {
            if (!largeRT) return;
            if (opts.destroyHiResOnPointerOut) {
                destroyTextureSafe(largeRT);
                largeRT = null;
                api.__largeRT = null;
                domLargeToken += 1;
            }
            usingLarge = false;
            api.__usingLarge = false;
            display.texture = api.__smallRT;

            const list = RUNTIME.hiResLru;
            const idx = list.indexOf(api);
            if (idx >= 0) list.splice(idx, 1);
        }

        function applyLayoutAndPerspective() {
            const w = state.width * state.baseScale * state.curScale;
            const h = state.height * state.baseScale * state.curScale;

            container.position.set(state.x, state.y);
            container.zIndex = state.zIndex;
            container.hitArea = new PIXI.Rectangle(-w * 0.5, -h * 0.5, w, h);

            shadow.position.set(0, h * 0.44 + 6);
            shadow.width = w * 0.92;
            shadow.height = h * 0.34;

            glare.position.set(0, 0);
            glare.width = w * 1.05;
            glare.height = h * 1.05;
            foil.position.set(0, 0);
            foil.width = w;
            foil.height = h;

            const tx = clamp(state.curTiltXDeg / opts.maxTiltDeg, -1, 1);
            const ty = clamp(state.curTiltYDeg / opts.maxTiltDeg, -1, 1);
            const dx = ty * w * 0.07;
            const dy = tx * h * 0.07;

            const topLeft = { x: -dx, y: +dy };
            const topRight = { x: w - dx, y: -dy };
            const bottomRight = { x: w + dx, y: h - dy };
            const bottomLeft = { x: +dx, y: h + dy };

            const usedPerspective = setPerspectiveCornersCompat(display, {
                tl: topLeft,
                tr: topRight,
                br: bottomRight,
                bl: bottomLeft
            });

            if (usedPerspective) {
                display.position.set(-w * 0.5, -h * 0.5);
                display.skew.set(0, 0);
                display.rotation = 0;
                display.width = w;
                display.height = h;
            } else {
                // Fallback if PerspectiveMesh is not available.
                display.position.set(0, 0);
                display.anchor && display.anchor.set(0.5);
                display.width = w;
                display.height = h;
                display.skew.set(ty * 0.07, -tx * 0.07);
                display.rotation = ty * 0.04;
            }

            // Overlay shading reacts to pointer and tilt, but card RT is untouched.
            const hover = state.isHovered ? 1 : 0;
            glare.alpha = hover * (0.16 + Math.abs(state.nx) * 0.18 + Math.abs(state.ny) * 0.08);
            glare.rotation = state.nx * 0.18 + state.ny * 0.05;
            glare.x = state.nx * w * 0.06;
            glare.y = state.ny * h * 0.04;

            foil.alpha = hover * (0.03 + Math.abs(state.ny) * 0.04);
            foil.tint = state.nx >= 0 ? 0x9fd8ff : 0xffe4a3;
        }

        function onPointerMove(evt) {
            if (destroyed) return;
            const p = evt.getLocalPosition(container);
            state.px = p.x;
            state.py = p.y;
            const halfW = state.width * 0.5;
            const halfH = state.height * 0.5;
            state.nx = clamp(p.x / halfW, -1, 1);
            state.ny = clamp(p.y / halfH, -1, 1);
            state.targetTiltXDeg = -state.ny * opts.maxTiltDeg;
            state.targetTiltYDeg = state.nx * opts.maxTiltDeg;
        }

        function onPointerOver() {
            if (destroyed) return;
            state.isHovered = true;
            api.__isHovered = true;
            ensureLargeTexture();
        }

        function onPointerOut() {
            if (destroyed) return;
            state.isHovered = false;
            api.__isHovered = false;
            state.targetTiltXDeg = 0;
            state.targetTiltYDeg = 0;
            state.nx = 0;
            state.ny = 0;
            releaseLargeTexture();
        }

        container.on('pointermove', onPointerMove);
        container.on('pointerover', onPointerOver);
        container.on('pointerout', onPointerOut);

        const api = {
            container,
            __smallRT: smallRT,
            __largeRT: null,
            __display: display,
            __usingLarge: false,
            __isHovered: false,

            /**
             * Called by one global ticker, not by per-card ticker.
             * dt should be in seconds.
             */
            update(dt) {
                if (destroyed) return;

                recomposeTexturesIfNeeded();

                const stepDt = Math.max(0.001, dt);
                state.curTiltXDeg = damp(state.curTiltXDeg, state.targetTiltXDeg, opts.tiltEase, stepDt);
                state.curTiltYDeg = damp(state.curTiltYDeg, state.targetTiltYDeg, opts.tiltEase, stepDt);
                const targetScale = state.isHovered ? state.hoverScale : 1;
                state.curScale = damp(state.curScale, targetScale, opts.scaleEase, stepDt);

                applyLayoutAndPerspective();
            },

            /**
             * Layout setter for board/hand systems.
             * This is cheap and does not trigger texture recomposition.
             */
            setLayout(next) {
                if (!next || destroyed) return;
                if (next.x !== undefined) state.x = Number(next.x) || 0;
                if (next.y !== undefined) state.y = Number(next.y) || 0;
                if (next.width !== undefined) state.width = Math.max(8, Number(next.width) || opts.cardWidth);
                if (next.height !== undefined) state.height = Math.max(8, Number(next.height) || opts.cardHeight);
                if (next.scale !== undefined) state.baseScale = Math.max(0.05, Number(next.scale) || 1);
                if (next.zIndex !== undefined) state.zIndex = Number(next.zIndex) || 0;
                if (next.hoverScale !== undefined) state.hoverScale = Math.max(1, Number(next.hoverScale) || opts.hoverScale);
                applyLayoutAndPerspective();
            },

            /**
             * External interaction bridge (for DOM-hosted cards with Pixi overlay).
             * localX/localY are coordinates in card-local space centered at (0,0).
             */
            setPointerLocal(localX, localY, hovered) {
                if (destroyed) return;
                const lx = Number(localX) || 0;
                const ly = Number(localY) || 0;
                state.px = lx;
                state.py = ly;
                const halfW = state.width * 0.5;
                const halfH = state.height * 0.5;
                state.nx = clamp(lx / halfW, -1, 1);
                state.ny = clamp(ly / halfH, -1, 1);
                state.targetTiltXDeg = -state.ny * opts.maxTiltDeg;
                state.targetTiltYDeg = state.nx * opts.maxTiltDeg;
                const shouldHover = !!hovered;
                if (shouldHover !== state.isHovered) {
                    state.isHovered = shouldHover;
                    api.__isHovered = shouldHover;
                    if (shouldHover) ensureLargeTexture();
                    else releaseLargeTexture();
                }
            },

            setHovered(hovered) {
                if (destroyed) return;
                const shouldHover = !!hovered;
                if (shouldHover === state.isHovered) return;
                state.isHovered = shouldHover;
                api.__isHovered = shouldHover;
                if (shouldHover) ensureLargeTexture();
                else releaseLargeTexture();
            },

            refreshDomSnapshotFromElement(sourceEl) {
                if (destroyed) return false;
                return refreshDomSnapshotFromElement(sourceEl);
            },

            destroy() {
                if (destroyed) return;
                destroyed = true;
                domSmallToken += 1;
                domLargeToken += 1;

                unlistenTexture(smallArtPath, onArtTextureReady);

                container.off('pointermove', onPointerMove);
                container.off('pointerover', onPointerOver);
                container.off('pointerout', onPointerOut);

                destroyHiResTexture(api);
                destroyTextureSafe(api.__smallRT);
                api.__smallRT = null;

                if (container.parent) {
                    container.parent.removeChild(container);
                }
                container.destroy({ children: true });
            }
        };

        applyLayoutAndPerspective();
        if (domSnapshotMarkup) {
            scheduleDomSnapshot('small', opts.rtScaleSmall);
        }
        return api;
    }

    function createLiveCardTableController(options) {
        const cfg = options || {};
        const app = cfg.app;
        const stage = cfg.stage || (app ? app.stage : null);
        if (!app || !stage) {
            throw new Error('createLiveCardTableController requires { app, stage }.');
        }

        init({ app, stage, options: cfg.options || {} });

        const liveCards = new Map();
        let tickerBound = false;
        let tickerFn = null;

        function bindGlobalTicker() {
            if (tickerBound) return;
            tickerBound = true;
            tickerFn = () => {
                const dtSec = app.ticker.deltaMS / 1000;
                for (const cardView of liveCards.values()) {
                    cardView.update(dtSec);
                }
            };
            app.ticker.add(tickerFn);
        }

        function unbindGlobalTicker() {
            if (!tickerBound || !tickerFn) return;
            app.ticker.remove(tickerFn);
            tickerFn = null;
            tickerBound = false;
        }

        return {
            liveCards,

            /**
             * Example sync API:
             * - cardModels: [{ uid, ...cardData }]
             * - layoutFn(model, index): { x, y, width, height, zIndex, scale }
             */
            sync(cardModels, layoutFn) {
                const models = Array.isArray(cardModels) ? cardModels : [];
                const keep = new Set();

                for (let i = 0; i < models.length; i++) {
                    const model = models[i];
                    const uid = model.uid || model.id || `idx-${i}`;
                    keep.add(uid);

                    let cardView = liveCards.get(uid);
                    if (!cardView) {
                        cardView = buildCardApi(model);
                        liveCards.set(uid, cardView);
                        stage.addChild(cardView.container);
                    }

                    const layout = typeof layoutFn === 'function'
                        ? (layoutFn(model, i) || null)
                        : null;
                    if (layout) {
                        cardView.setLayout(layout);
                    }
                }

                for (const [uid, cardView] of liveCards.entries()) {
                    if (keep.has(uid)) continue;
                    cardView.destroy();
                    liveCards.delete(uid);
                }

                bindGlobalTicker();
            },

            destroy() {
                for (const cardView of liveCards.values()) {
                    cardView.destroy();
                }
                liveCards.clear();
                unbindGlobalTicker();
            }
        };
    }

    function init(cfg) {
        const conf = cfg || {};
        if (!conf.app || !conf.app.renderer) {
            throw new Error('PixiCardView.init expects an initialized PIXI.Application.');
        }
        RUNTIME.app = conf.app;
        RUNTIME.stage = conf.stage || conf.app.stage;
        RUNTIME.options = {
            ...DEFAULTS,
            ...(conf.options || {})
        };
        ensureInitialized();
        return api;
    }

    const api = {
        init,
        createCard: buildCardApi,
        createLiveCardTableController
    };

    // Deliverable API name requested by user.
    window.createCard = function createCard(data, options) {
        return api.createCard(data, options);
    };

    window.PixiCardView = api;
})();
