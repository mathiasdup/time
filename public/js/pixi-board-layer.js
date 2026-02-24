/**
 * Pixi board overlay layer.
 *
 * Gameplay/input stays DOM on slots/cards.
 * Card visuals are rendered by Pixi on top for a progressive migration.
 */
(function () {
    'use strict';

    const DEFAULT_ENABLED = (typeof window !== 'undefined' && window.ENABLE_PIXI_BOARD_OVERLAY === true);

    const STATE = {
        enabled: DEFAULT_ENABLED,
        app: null,
        root: null,
        viewByKey: new Map(),
        ready: false,
        initializing: false,
        tickerBound: false,
        mouseX: 0,
        mouseY: 0
    };

    function cardVisualSig(data, host) {
        const c = data || {};
        const hp = c.currentHp ?? c.hp ?? '';
        const atk = c.atk ?? '';
        const ab = Array.isArray(c.abilities) ? c.abilities.join(',') : '';
        const atkText = host?.querySelector?.('.arena-atk, .img-atk')?.textContent?.trim?.() || '';
        const hpText = host?.querySelector?.('.arena-hp, .arena-armor, .img-hp')?.textContent?.trim?.() || '';
        const manaText = host?.querySelector?.('.arena-mana, .img-cost')?.textContent?.trim?.() || '';
        const markers = [
            c.medusaGazeMarker || 0,
            c.poisonCounters || 0,
            c.entraveCounters || 0,
            c.buffCounters || 0
        ].join(',');
        return [
            c.uid || c.id || '',
            c.name || '',
            c.image || '',
            c.type || '',
            c.cost ?? '',
            atk,
            hp,
            ab,
            markers,
            atkText,
            hpText,
            manaText
        ].join('|');
    }

    function isHostVisible(host) {
        if (!host || !host.isConnected) return false;
        if (host.style.visibility === 'hidden') return false;
        return true;
    }

    function setCanvasStyle(canvas) {
        if (!canvas) return;
        canvas.style.position = 'fixed';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '55';
    }

    function trackMouse() {
        if (trackMouse._bound) return;
        trackMouse._bound = true;
        window.addEventListener('mousemove', (evt) => {
            STATE.mouseX = evt.clientX;
            STATE.mouseY = evt.clientY;
        }, { passive: true });
    }

    async function ensureSharedApp() {
        let shared = window.__PixiCardOverlayShared;
        if (shared && shared.app && shared.ready) return shared;
        if (shared && shared.initPromise) return shared.initPromise;

        shared = shared || {};
        shared.initPromise = (async () => {
            const app = new PIXI.Application();
            await app.init({
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2)
            });

            app.stage.sortableChildren = true;
            setCanvasStyle(app.canvas);
            document.body.appendChild(app.canvas);

            shared.app = app;
            shared.ready = true;
            return shared;
        })();

        window.__PixiCardOverlayShared = shared;
        return shared.initPromise;
    }

    function resizeApp() {
        if (!STATE.app || !STATE.ready) return;
        STATE.app.renderer.resize(window.innerWidth, window.innerHeight);
        setCanvasStyle(STATE.app.canvas);
    }

    function ensureTicker() {
        if (!STATE.app || STATE.tickerBound) return;
        STATE.tickerBound = true;
        STATE.app.ticker.add(() => {
            if (!STATE.enabled || !STATE.ready) return;
            const dt = STATE.app.ticker.deltaMS / 1000;
            for (const rec of STATE.viewByKey.values()) {
                updateOne(rec, dt);
            }
        });
    }

    function updateOne(rec, dt) {
        const host = rec.host;
        const view = rec.view;
        if (!host || !view || !view.container) return;

        if (!isHostVisible(host)) {
            view.container.visible = false;
            view.setHovered(false);
            view.update(dt);
            host.classList.remove('pixi-board-ready');
            return;
        }

        const rect = host.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) {
            view.container.visible = false;
            view.setHovered(false);
            view.update(dt);
            host.classList.remove('pixi-board-ready');
            return;
        }

        view.container.visible = true;
        view.setLayout({
            x: rect.left + rect.width * 0.5,
            y: rect.top + rect.height * 0.5,
            width: rect.width,
            height: rect.height,
            zIndex: Number(host.style.zIndex || 1) || 1,
            hoverScale: 1.02
        });

        const hovered = host.matches(':hover');
        const localX = STATE.mouseX - (rect.left + rect.width * 0.5);
        const localY = STATE.mouseY - (rect.top + rect.height * 0.5);
        view.setPointerLocal(localX, localY, hovered);
        view.update(dt);
        const tex = (view.__display && view.__display.texture) || view.__smallRT || null;
        const ready = !!tex && tex.valid !== false;
        host.classList.toggle('pixi-board-ready', ready);
    }

    function cleanupRemovedHosts() {
        for (const [key, rec] of STATE.viewByKey.entries()) {
            if (rec.host && rec.host.isConnected) continue;
            if (rec.host) rec.host.classList.remove('pixi-board-host', 'pixi-board-ready');
            rec.view.destroy();
            STATE.viewByKey.delete(key);
        }
    }

    async function ensureInit() {
        if (STATE.ready) return true;
        if (STATE.initializing) return false;
        if (!window.PIXI || !window.PixiCardView) return false;

        STATE.initializing = true;
        try {
            const shared = await ensureSharedApp();
            const app = shared.app;
            if (!shared.boardRoot) {
                shared.boardRoot = new PIXI.Container();
                shared.boardRoot.sortableChildren = true;
                shared.boardRoot.zIndex = 10;
                app.stage.addChild(shared.boardRoot);
            }
            const root = shared.boardRoot;

            window.PixiCardView.init({
                app,
                stage: root
            });

            STATE.app = app;
            STATE.root = root;
            STATE.ready = true;
            trackMouse();
            window.addEventListener('resize', resizeApp, { passive: true });
            ensureTicker();
            return true;
        } catch (err) {
            return false;
        } finally {
            STATE.initializing = false;
        }
    }

    function getHostRecords() {
        const records = [];
        const hosts = Array.from(document.querySelectorAll('.card-slot .card'));
        const keyCount = new Map();

        for (let i = 0; i < hosts.length; i++) {
            const host = hosts[i];
            const slot = host.closest('.card-slot');
            if (!slot) continue;
            const data = host.__cardData || null;
            if (!data) continue;

            const slotKey = `${slot.dataset.owner || '?'}-${slot.dataset.row || '?'}-${slot.dataset.col || '?'}-${data.uid || data.id || i}`;
            const n = keyCount.get(slotKey) || 0;
            keyCount.set(slotKey, n + 1);
            const key = `${slotKey}#${n}`;
            records.push({ key, host, data, sig: cardVisualSig(data, host) });
        }

        return records;
    }

    function sync() {
        if (!STATE.enabled) return;

        ensureInit().then((ok) => {
            if (!ok || !STATE.ready || !STATE.root) return;

            const hostRecords = getHostRecords();
            const keep = new Set();

            for (const rec of hostRecords) {
                keep.add(rec.key);
                const existing = STATE.viewByKey.get(rec.key);
                if (existing) {
                    existing.host = rec.host;
                    if (existing.sig !== rec.sig) {
                        existing.view.destroy();
                        const newView = window.createCard(rec.data, { domSourceEl: rec.host, inHand: false });
                        STATE.root.addChild(newView.container);
                        STATE.viewByKey.set(rec.key, {
                            key: rec.key,
                            host: rec.host,
                            sig: rec.sig,
                            view: newView
                        });
                    } else {
                        existing.sig = rec.sig;
                    }
                    rec.host.classList.add('pixi-board-host');
                    continue;
                }

                const view = window.createCard(rec.data, { domSourceEl: rec.host, inHand: false });
                STATE.root.addChild(view.container);
                STATE.viewByKey.set(rec.key, {
                    key: rec.key,
                    host: rec.host,
                    sig: rec.sig,
                    view
                });
                rec.host.classList.add('pixi-board-host');
            }

            for (const [key, rec] of STATE.viewByKey.entries()) {
                if (keep.has(key)) continue;
                if (rec.host) rec.host.classList.remove('pixi-board-host', 'pixi-board-ready');
                rec.view.destroy();
                STATE.viewByKey.delete(key);
            }

            cleanupRemovedHosts();
        });
    }

    function setEnabled(value) {
        STATE.enabled = !!value;
        if (!STATE.ready || !STATE.app) return;

        STATE.app.canvas.style.display = STATE.enabled ? '' : 'none';
        if (!STATE.enabled) {
            for (const rec of STATE.viewByKey.values()) {
                if (rec.host) rec.host.classList.remove('pixi-board-host', 'pixi-board-ready');
                rec.view.destroy();
            }
            STATE.viewByKey.clear();
        } else {
            sync();
        }
    }

    function isEnabled() {
        return STATE.enabled;
    }

    window.PixiBoardLayer = {
        sync,
        setEnabled,
        isEnabled
    };
})();
