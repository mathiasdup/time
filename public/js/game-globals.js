// ==================== VARIABLES GLOBALES DU JEU ====================
let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let testModeSelection = [];
let cardCatalog = null;
let USE_CLICK_TO_SELECT = true; // true = click-to-select, false = drag (legacy)
let savedTrapSourceRect = null;

// Debug bridge for automation/bench tools (Playwright, local visual probes).
// Keeps access explicit without relying on lexical globals from outside scripts.
if (typeof window !== 'undefined') {
    window.__benchApi = window.__benchApi || {};
    window.__benchApi.getState = () => state;
    window.__benchApi.getMyNum = () => myNum;
    window.__benchApi.emit = (eventName, payload) => {
        if (!socket || !eventName) return false;
        socket.emit(eventName, payload);
        return true;
    };
}

// Debug runtime logs (console). Keep disabled in production for performance.
if (typeof window !== 'undefined' && typeof window.DEBUG_LOGS === 'undefined') {
    window.DEBUG_LOGS = false;
}
if (typeof window !== 'undefined' && typeof window.CLIENT_PACED_RESOLUTION === 'undefined') {
    window.CLIENT_PACED_RESOLUTION = false;
}
// Pixi card migration flags (opt-in). Keep disabled by default to preserve current DOM design.
if (typeof window !== 'undefined' && typeof window.ENABLE_PIXI_HAND_OVERLAY === 'undefined') {
    window.ENABLE_PIXI_HAND_OVERLAY = false;
}
if (typeof window !== 'undefined' && typeof window.ENABLE_PIXI_BOARD_OVERLAY === 'undefined') {
    window.ENABLE_PIXI_BOARD_OVERLAY = false;
}
if (typeof window !== 'undefined' && typeof window.ENABLE_PIXI_ANIM_GHOSTS === 'undefined') {
    window.ENABLE_PIXI_ANIM_GHOSTS = false;
}
if (typeof window !== 'undefined' && typeof window.ENABLE_PIXI_DOM_SNAPSHOT_SKIN === 'undefined') {
    window.ENABLE_PIXI_DOM_SNAPSHOT_SKIN = true;
}
if (typeof window !== 'undefined' && typeof window.getPixiOverlayMode !== 'function') {
    window.getPixiOverlayMode = () => ({
        hand: !!window.ENABLE_PIXI_HAND_OVERLAY,
        board: !!window.ENABLE_PIXI_BOARD_OVERLAY,
        ghosts: !!window.ENABLE_PIXI_ANIM_GHOSTS,
        domSnapshotSkin: window.ENABLE_PIXI_DOM_SNAPSHOT_SKIN !== false
    });
}
if (typeof window !== 'undefined' && typeof window.setPixiOverlayMode !== 'function') {
    window.setPixiOverlayMode = (next = {}) => {
        if (Object.prototype.hasOwnProperty.call(next, 'hand')) {
            window.ENABLE_PIXI_HAND_OVERLAY = !!next.hand;
            if (window.PixiHandLayer && typeof window.PixiHandLayer.setEnabled === 'function') {
                window.PixiHandLayer.setEnabled(window.ENABLE_PIXI_HAND_OVERLAY);
            }
        }
        if (Object.prototype.hasOwnProperty.call(next, 'board')) {
            window.ENABLE_PIXI_BOARD_OVERLAY = !!next.board;
            if (window.PixiBoardLayer && typeof window.PixiBoardLayer.setEnabled === 'function') {
                window.PixiBoardLayer.setEnabled(window.ENABLE_PIXI_BOARD_OVERLAY);
            }
        }
        if (Object.prototype.hasOwnProperty.call(next, 'ghosts')) {
            window.ENABLE_PIXI_ANIM_GHOSTS = !!next.ghosts;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'domSnapshotSkin')) {
            window.ENABLE_PIXI_DOM_SNAPSHOT_SKIN = !!next.domSnapshotSkin;
        }
        return window.getPixiOverlayMode();
    };
}
if (typeof window !== 'undefined') {
    // Apply runtime flags even though Pixi layers are loaded before this file.
    if (window.PixiHandLayer && typeof window.PixiHandLayer.setEnabled === 'function') {
        window.PixiHandLayer.setEnabled(!!window.ENABLE_PIXI_HAND_OVERLAY);
    }
    if (window.PixiBoardLayer && typeof window.PixiBoardLayer.setEnabled === 'function') {
        window.PixiBoardLayer.setEnabled(!!window.ENABLE_PIXI_BOARD_OVERLAY);
    }
}
if (typeof window !== 'undefined' && typeof window.VIS_TRACE_LOGS === 'undefined') {
    // Enabled for visual-debug sessions. Set to false to reduce console noise.
    window.VIS_TRACE_LOGS = true;
}
if (typeof window !== 'undefined' && typeof window.__visTraceSeq === 'undefined') {
    window.__visTraceSeq = 0;
}
if (typeof window !== 'undefined' && typeof window.__visTraceBuffer === 'undefined') {
    window.__visTraceBuffer = [];
}
if (typeof window !== 'undefined' && typeof window.__visTraceBufferMax === 'undefined') {
    window.__visTraceBufferMax = 15000;
}
if (typeof window !== 'undefined' && typeof window.__visTraceSessionId === 'undefined') {
    window.__visTraceSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
if (typeof window !== 'undefined' && typeof window.__visTraceContext === 'undefined') {
    window.__visTraceContext = {
        roomCode: null,
        playerNum: null
    };
}
if (typeof window !== 'undefined' && typeof window.flushVisTraceLogs !== 'function') {
    window.flushVisTraceLogs = async function flushVisTraceLogs(reason = 'manual', opts = {}) {
        try {
            if (window.__visTraceFlushInFlight) return { ok: false, skipped: 'in_flight' };
            const lines = Array.isArray(window.__visTraceBuffer) ? window.__visTraceBuffer.slice() : [];
            if (!lines.length) return { ok: false, skipped: 'empty' };

            const context = window.__visTraceContext || {};
            const body = {
                reason,
                sessionId: window.__visTraceSessionId || null,
                roomCode: context.roomCode || null,
                playerNum: Number(context.playerNum || 0),
                turn: Number(state?.turn || 0),
                phase: state?.phase || null,
                lines
            };
            const bodyJson = JSON.stringify(body);
            const payloadBytes = (typeof TextEncoder !== 'undefined')
                ? new TextEncoder().encode(bodyJson).length
                : bodyJson.length;
            const BEACON_MAX_BYTES = 60 * 1024;
            const KEEPALIVE_MAX_BYTES = 60 * 1024;

            if (opts.useBeacon && navigator?.sendBeacon) {
                if (payloadBytes > BEACON_MAX_BYTES) {
                    if (typeof window.visTrace === 'function') {
                        window.visTrace('visTrace:auto-save:beacon-too-large', {
                            reason,
                            payloadBytes,
                            limit: BEACON_MAX_BYTES,
                            lines: lines.length
                        });
                    }
                } else {
                    const ok = navigator.sendBeacon(
                        '/api/vis-trace/upload',
                        new Blob([bodyJson], { type: 'application/json' })
                    );
                    if (ok && opts.reset !== false) window.__visTraceBuffer.length = 0;
                    return { ok, beacon: true, lines: lines.length, payloadBytes };
                }
            }

            const keepaliveRequested = opts.keepalive !== false;
            const keepalive = keepaliveRequested && payloadBytes <= KEEPALIVE_MAX_BYTES;
            if (keepaliveRequested && !keepalive && typeof window.visTrace === 'function') {
                window.visTrace('visTrace:auto-save:keepalive-disabled', {
                    reason,
                    payloadBytes,
                    limit: KEEPALIVE_MAX_BYTES,
                    lines: lines.length
                });
            }

            window.__visTraceFlushInFlight = true;
            const r = await fetch('/api/vis-trace/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: bodyJson,
                keepalive
            });
            const raw = await r.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (_) {
                data = raw ? { raw: String(raw).slice(0, 400) } : {};
            }
            if (r.ok && opts.reset !== false) {
                window.__visTraceBuffer.length = 0;
                if (data?.file) window.__lastVisTraceFile = data.file;
            }
            return { ok: !!r.ok, status: r.status, keepalive, payloadBytes, ...data };
        } catch (e) {
            const message = String(e && e.message ? e.message : e);
            if (typeof window.visTrace === 'function') {
                window.visTrace('visTrace:auto-save:error', {
                    reason,
                    error: message,
                    name: e?.name || null
                });
            }
            return { ok: false, error: message, name: e?.name || null };
        } finally {
            window.__visTraceFlushInFlight = false;
        }
    };
}
if (typeof window !== 'undefined' && typeof window.visTrace !== 'function') {
    window.visTrace = function visTrace(tag, payload) {
        if (!window.VIS_TRACE_LOGS) return;
        const seq = ++window.__visTraceSeq;
        const ts = Date.now();
        let payloadStr = '{}';
        try {
            payloadStr = JSON.stringify(payload || {});
            const line = `[VIS-TRACE] #${seq} t=${ts} ${tag} ${payloadStr}`;
            console.log(line);
            if (Array.isArray(window.__visTraceBuffer)) {
                window.__visTraceBuffer.push(line);
                const overflow = window.__visTraceBuffer.length - Number(window.__visTraceBufferMax || 0);
                if (overflow > 0) window.__visTraceBuffer.splice(0, overflow);
            }
        } catch (_) {
            const line = `[VIS-TRACE] #${seq} t=${ts} ${tag} {"_unserializable":true}`;
            console.log(`[VIS-TRACE] #${seq} t=${ts} ${tag}`, payload || {});
            if (Array.isArray(window.__visTraceBuffer)) {
                window.__visTraceBuffer.push(line);
                const overflow = window.__visTraceBuffer.length - Number(window.__visTraceBufferMax || 0);
                if (overflow > 0) window.__visTraceBuffer.splice(0, overflow);
            }
        }
    };
}
if (typeof window !== 'undefined' && !window.__visTraceBeforeUnloadHook) {
    window.__visTraceBeforeUnloadHook = true;
    window.addEventListener('beforeunload', () => {
        try {
            if (Array.isArray(window.__visTraceBuffer) && window.__visTraceBuffer.length > 0) {
                window.flushVisTraceLogs('beforeunload', { useBeacon: true, reset: true });
            }
        } catch (_) {}
    });
}
if (typeof window !== 'undefined' && typeof window.visBuildStateSig !== 'function') {
    const _visCardSig = (card) => {
        if (!card) return '-';
        const uidRaw = String(card.uid || card.id || card.name || '?');
        const uid = uidRaw.length > 12 ? uidRaw.slice(-12) : uidRaw;
        const atk = Number.isFinite(Number(card.atk)) ? Number(card.atk) : '?';
        const hpSrc = Number.isFinite(Number(card.currentHp)) ? Number(card.currentHp) : Number(card.hp);
        const hp = Number.isFinite(hpSrc) ? hpSrc : '?';
        return `${uid}:${atk}/${hp}`;
    };
    const _visFieldSig = (field) => {
        if (!Array.isArray(field)) return '';
        const out = [];
        for (let r = 0; r < field.length; r++) {
            const row = Array.isArray(field[r]) ? field[r] : [];
            const left = _visCardSig(row[0]);
            const right = _visCardSig(row[1]);
            out.push(`${r}:${left},${right}`);
        }
        return out.join('|');
    };
    window.visBuildStateSig = function visBuildStateSig(s) {
        if (!s) return { phase: 'none', turn: 0 };
        return {
            phase: s.phase || '?',
            turn: Number(s.turn || 0),
            meHp: Number(s.me?.hp),
            oppHp: Number(s.opponent?.hp),
            meHand: Array.isArray(s.me?.hand) ? s.me.hand.length : Number(s.me?.handCount || 0),
            oppHand: Number(s.opponent?.handCount || 0),
            meGrave: Number(s.me?.graveyardCount || (Array.isArray(s.me?.graveyard) ? s.me.graveyard.length : 0)),
            oppGrave: Number(s.opponent?.graveyardCount || (Array.isArray(s.opponent?.graveyard) ? s.opponent.graveyard.length : 0)),
            meField: _visFieldSig(s.me?.field),
            oppField: _visFieldSig(s.opponent?.field),
        };
    };
}
if (typeof window !== 'undefined' && typeof window.visBuildDomSig !== 'function') {
    window.visBuildDomSig = function visBuildDomSig() {
        const meHpDom = document.querySelector('#me-hp .hero-hp-number')?.textContent || null;
        const oppHpDom = document.querySelector('#opp-hp .hero-hp-number')?.textContent || null;
        const meHandDom = document.querySelectorAll('#my-hand .card:not(.committed-spell)').length;
        const oppCards = Array.from(document.querySelectorAll('#opp-hand .opp-card-back'));
        const oppHandDom = oppCards.length;
        const oppHidden = oppCards.filter((el) => el.style.visibility === 'hidden').length;
        const oppRevealed = document.querySelectorAll('#opp-hand .opp-revealed').length;
        const qLen = (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0;
        const animSlots = (typeof animatingSlots !== 'undefined' && animatingSlots) ? animatingSlots.size : 0;
        const isAnim = (typeof isAnimating !== 'undefined') ? !!isAnimating : false;
        return {
            meHpDom,
            oppHpDom,
            meHandDom,
            oppHandDom,
            oppHidden,
            oppRevealed,
            qLen,
            isAnim,
            animSlots,
        };
    };
}

// Client-side perf monitor for diagnostics (no visual impact).
if (typeof window !== 'undefined' && typeof window.PerfMon === 'undefined') {
    if (typeof window.ENABLE_PERF_MON === 'undefined') {
        // Enabled by default for perf diagnostics; can be disabled explicitly.
        window.ENABLE_PERF_MON = true;
    }
    window.PerfMon = (() => {
        const enabled = !!window.ENABLE_PERF_MON;
        const turns = new Map();
        let socketRef = null;
        let currentTurn = 1;
        let myPlayer = 0;
        let flushTimer = null;
        let rafId = null;
        let frameCount = 0;
        let fpsWindowStart = 0;
        let lastFrameTs = 0;
        let longTaskObserver = null;
        let lifecycleHooksInstalled = false;

        function nowMs() {
            return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        }

        function ensureTurn(turn) {
            const t = Number(turn || 1);
            if (!turns.has(t)) {
                turns.set(t, {
                    turn: t,
                    startedAt: Date.now(),
                    gsuCount: 0,
                    gsuTotalMs: 0,
                    gsuMaxMs: 0,
                    gsuOver16Count: 0,
                    gsuOver33Count: 0,
                    gsuOver50Count: 0,
                    renderCount: 0,
                    renderTotalMs: 0,
                    renderMaxMs: 0,
                    renderOver16Count: 0,
                    renderOver33Count: 0,
                    renderOver50Count: 0,
                    animQueueMax: 0,
                    animQueueSamples: 0,
                    animQueueTotal: 0,
                    animQueueOver10Count: 0,
                    animQueueOver20Count: 0,
                    animQueueOver40Count: 0,
                    resolutionLogCount: 0,
                    fpsMin: 0,
                    fpsTotal: 0,
                    fpsSamples: 0,
                    frameDeltaMaxMs: 0,
                    frameJank20Count: 0,
                    frameJank33Count: 0,
                    frameJank50Count: 0,
                    frameJank100Count: 0,
                    longTaskCount: 0,
                    longTaskMaxMs: 0,
                    animQueueWaitCount: 0,
                    animQueueWaitTotalMs: 0,
                    animQueueWaitMaxMs: 0,
                    animStepCount: 0,
                    animStepTotalMs: 0,
                    animStepMaxMs: 0,
                    animStepOver16Count: 0,
                    animStepOver33Count: 0,
                    animStepOver50Count: 0,
                    animItemsProcessed: 0,
                    animBatchMax: 0
                });
            }
            return turns.get(t);
        }

        function activeTurn() {
            return ensureTurn(currentTurn || 1);
        }

        function recordFpsSample(fps) {
            const t = activeTurn();
            if (t.fpsMin === 0 || fps < t.fpsMin) t.fpsMin = fps;
            t.fpsTotal += fps;
            t.fpsSamples++;
        }

        function frameLoop(ts) {
            if (!enabled) return;
            if (lastFrameTs) {
                const frameDt = ts - lastFrameTs;
                if (frameDt < 1000) {
                    const t = activeTurn();
                    if (frameDt > t.frameDeltaMaxMs) t.frameDeltaMaxMs = frameDt;
                    if (frameDt > 20) t.frameJank20Count++;
                    if (frameDt > 33.3) t.frameJank33Count++;
                    if (frameDt > 50) t.frameJank50Count++;
                    if (frameDt > 100) t.frameJank100Count++;
                }
            }
            lastFrameTs = ts;
            if (!fpsWindowStart) fpsWindowStart = ts;
            frameCount++;
            const dt = ts - fpsWindowStart;
            if (dt >= 1000) {
                const fps = (frameCount * 1000) / dt;
                recordFpsSample(fps);
                frameCount = 0;
                fpsWindowStart = ts;
            }
            rafId = requestAnimationFrame(frameLoop);
        }

        function startLongTaskObserver() {
            if (!enabled || longTaskObserver || typeof PerformanceObserver === 'undefined') return;
            try {
                longTaskObserver = new PerformanceObserver((list) => {
                    const t = activeTurn();
                    for (const e of list.getEntries()) {
                        const d = Number(e.duration || 0);
                        t.longTaskCount++;
                        if (d > t.longTaskMaxMs) t.longTaskMaxMs = d;
                    }
                });
                longTaskObserver.observe({ entryTypes: ['longtask'] });
            } catch (_) {}
        }

        function installLifecycleHooks() {
            if (!enabled || lifecycleHooksInstalled || typeof window === 'undefined') return;
            lifecycleHooksInstalled = true;
            window.addEventListener('beforeunload', () => {
                try { flush(); } catch (_) {}
            });
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') {
                        try { flush(); } catch (_) {}
                    }
                });
            }
        }

        function flush() {
            if (!enabled || !socketRef) return;
            const t = activeTurn();
            const perfObj = (typeof performance !== 'undefined') ? performance : null;
            const memUsedMB = (perfObj && perfObj.memory && perfObj.memory.usedJSHeapSize)
                ? (perfObj.memory.usedJSHeapSize / (1024 * 1024))
                : 0;
            socketRef.emit('perfClientMetrics', {
                turn: t.turn,
                player: myPlayer,
                gsuCount: t.gsuCount,
                gsuAvgMs: t.gsuCount > 0 ? (t.gsuTotalMs / t.gsuCount) : 0,
                gsuMaxMs: t.gsuMaxMs,
                gsuOver16Count: t.gsuOver16Count,
                gsuOver33Count: t.gsuOver33Count,
                gsuOver50Count: t.gsuOver50Count,
                renderCount: t.renderCount,
                renderAvgMs: t.renderCount > 0 ? (t.renderTotalMs / t.renderCount) : 0,
                renderMaxMs: t.renderMaxMs,
                renderOver16Count: t.renderOver16Count,
                renderOver33Count: t.renderOver33Count,
                renderOver50Count: t.renderOver50Count,
                animQueueMax: t.animQueueMax,
                animQueueAvg: t.animQueueSamples > 0 ? (t.animQueueTotal / t.animQueueSamples) : 0,
                animQueueOver10Count: t.animQueueOver10Count,
                animQueueOver20Count: t.animQueueOver20Count,
                animQueueOver40Count: t.animQueueOver40Count,
                resolutionLogCount: t.resolutionLogCount,
                fpsMin: t.fpsMin,
                fpsAvg: t.fpsSamples > 0 ? (t.fpsTotal / t.fpsSamples) : 0,
                frameDeltaMaxMs: t.frameDeltaMaxMs,
                frameJank20Count: t.frameJank20Count,
                frameJank33Count: t.frameJank33Count,
                frameJank50Count: t.frameJank50Count,
                frameJank100Count: t.frameJank100Count,
                longTaskCount: t.longTaskCount,
                longTaskMaxMs: t.longTaskMaxMs,
                animQueueWaitCount: t.animQueueWaitCount,
                animQueueWaitAvgMs: t.animQueueWaitCount > 0 ? (t.animQueueWaitTotalMs / t.animQueueWaitCount) : 0,
                animQueueWaitMaxMs: t.animQueueWaitMaxMs,
                animStepCount: t.animStepCount,
                animStepAvgMs: t.animStepCount > 0 ? (t.animStepTotalMs / t.animStepCount) : 0,
                animStepMaxMs: t.animStepMaxMs,
                animStepOver16Count: t.animStepOver16Count,
                animStepOver33Count: t.animStepOver33Count,
                animStepOver50Count: t.animStepOver50Count,
                animItemsProcessed: t.animItemsProcessed,
                animBatchMax: t.animBatchMax,
                memUsedMB
            });
        }

        function attachSocket(sock) {
            if (!enabled) return;
            socketRef = sock;
            if (!rafId) rafId = requestAnimationFrame(frameLoop);
            startLongTaskObserver();
            installLifecycleHooks();
            if (!flushTimer) {
                flushTimer = setInterval(flush, 2000);
            }
        }

        function setPlayer(playerNum) {
            myPlayer = Number(playerNum || 0);
        }

        function onNewTurn(turn) {
            const nextTurn = Number(turn || currentTurn || 1);
            if (nextTurn !== Number(currentTurn || 1)) {
                flush();
            }
            currentTurn = nextTurn;
            ensureTurn(currentTurn);
            if (turns.size > 25) {
                const keys = Array.from(turns.keys()).sort((a, b) => a - b);
                while (keys.length > 25) {
                    turns.delete(keys.shift());
                }
            }
        }

        function recordGameStateUpdate(durationMs, turn, queueLen) {
            if (!enabled) return;
            if (Number.isFinite(turn) && turn > 0) currentTurn = turn;
            const t = activeTurn();
            const d = Number(durationMs || 0);
            t.gsuCount++;
            t.gsuTotalMs += d;
            if (d > t.gsuMaxMs) t.gsuMaxMs = d;
            if (d > 16) t.gsuOver16Count++;
            if (d > 33) t.gsuOver33Count++;
            if (d > 50) t.gsuOver50Count++;
            recordAnimationQueue(queueLen);
        }

        function recordRender(durationMs, queueLen) {
            if (!enabled) return;
            const t = activeTurn();
            const d = Number(durationMs || 0);
            t.renderCount++;
            t.renderTotalMs += d;
            if (d > t.renderMaxMs) t.renderMaxMs = d;
            if (d > 16) t.renderOver16Count++;
            if (d > 33) t.renderOver33Count++;
            if (d > 50) t.renderOver50Count++;
            recordAnimationQueue(queueLen);
        }

        function recordAnimationQueue(len) {
            if (!enabled) return;
            const t = activeTurn();
            const n = Number(len || 0);
            if (n > t.animQueueMax) t.animQueueMax = n;
            t.animQueueSamples++;
            t.animQueueTotal += n;
            if (n > 10) t.animQueueOver10Count++;
            if (n > 20) t.animQueueOver20Count++;
            if (n > 40) t.animQueueOver40Count++;
        }

        function recordAnimationQueueWait(waitMs, queueLen) {
            if (!enabled) return;
            const t = activeTurn();
            const w = Math.max(0, Number(waitMs || 0));
            t.animQueueWaitCount++;
            t.animQueueWaitTotalMs += w;
            if (w > t.animQueueWaitMaxMs) t.animQueueWaitMaxMs = w;
            if (queueLen !== undefined) recordAnimationQueue(queueLen);
        }

        function recordAnimationStep(durationMs, itemsProcessed) {
            if (!enabled) return;
            const t = activeTurn();
            const d = Math.max(0, Number(durationMs || 0));
            const items = Math.max(1, Number(itemsProcessed || 1));
            t.animStepCount++;
            t.animStepTotalMs += d;
            t.animItemsProcessed += items;
            if (items > t.animBatchMax) t.animBatchMax = items;
            if (d > t.animStepMaxMs) t.animStepMaxMs = d;
            if (d > 16) t.animStepOver16Count++;
            if (d > 33) t.animStepOver33Count++;
            if (d > 50) t.animStepOver50Count++;
        }

        function recordResolutionLog() {
            if (!enabled) return;
            const t = activeTurn();
            t.resolutionLogCount++;
        }

        return {
            enabled,
            attachSocket,
            setPlayer,
            onNewTurn,
            recordGameStateUpdate,
            recordRender,
            recordAnimationQueue,
            recordAnimationQueueWait,
            recordAnimationStep,
            recordResolutionLog,
            flush
        };
    })();
}

const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

// ==================== SVG CARD TEMPLATE CONSTANTS ====================
let _cardSvgIdCounter = 0;

const CARD_THEMES = {
    black: { border: "#5a5a6a", borderLight: "#7a7a8a", borderDark: "#3a3a4a", accent: "#a78bfa", titleColor: "#e0dce8", textColor: "#c0bcc8", accentDim: "rgba(167,139,250,0.2)", darkBase: "rgba(8,6,12,", keywordBg: "rgba(167,139,250,0.14)", keywordColor: "#b8a0f0", typeSep: "rgba(167,139,250,0.25)" },
    green: { border: "#4a7a4a", borderLight: "#6a9a60", borderDark: "#2e5430", accent: "#4ade80", titleColor: "#c8f0cc", textColor: "#b4d8b8", accentDim: "rgba(74,222,128,0.25)", darkBase: "rgba(4,14,6,", keywordBg: "rgba(74,222,128,0.14)", keywordColor: "#7ce8a0", typeSep: "rgba(74,222,128,0.25)" },
    white: { border: "#a89878", borderLight: "#ccbea0", borderDark: "#706248", accent: "#ede0c8", titleColor: "#f8f2e4", textColor: "#ddd4c0", accentDim: "rgba(237,224,200,0.2)", darkBase: "rgba(12,10,6,", keywordBg: "rgba(255,255,255,0.12)", keywordColor: "#ede0c8", typeSep: "rgba(237,224,200,0.25)" },
    red: { border: "#c83030", borderLight: "#e04444", borderDark: "#8a1e1e", accent: "#fb923c", titleColor: "#ffdcc8", textColor: "#e0c0a4", accentDim: "rgba(251,146,60,0.25)", darkBase: "rgba(18,6,0,", keywordBg: "rgba(251,146,60,0.14)", keywordColor: "#f0a870", typeSep: "rgba(251,146,60,0.25)" },
    blue: { border: "#4a9ac8", borderLight: "#6cb8e0", borderDark: "#2e6a8e", accent: "#38bdf8", titleColor: "#c8e8f8", textColor: "#a8c8dc", accentDim: "rgba(56,189,248,0.25)", darkBase: "rgba(0,6,14,", keywordBg: "rgba(56,189,248,0.14)", keywordColor: "#70c8f0", typeSep: "rgba(56,189,248,0.25)" },
    neutral: { border: "#8a6040", borderLight: "#b08060", borderDark: "#5a3820", accent: "#d4a574", titleColor: "#f0dcc8", textColor: "#d0b89a", accentDim: "rgba(212,165,116,0.25)", darkBase: "rgba(16,8,2,", keywordBg: "rgba(212,165,116,0.14)", keywordColor: "#d4b088", typeSep: "rgba(212,165,116,0.25)" },
};

const CARD_RARITIES = {
    common:   { color: "#c8c8c8", bright: "#ffffff", glow: "rgba(200,200,200,", duration: "4s" },
    uncommon: { color: "#00ff66", bright: "#ccffdd", glow: "rgba(0,255,102,",   duration: "3s" },
    rare:     { color: "#9933ff", bright: "#dd99ff", glow: "rgba(153,51,255,",  duration: "2.5s" },
    mythic:   { color: "#ff5500", bright: "#ffcc00", glow: "rgba(255,85,0,",    duration: "2s" },
    platinum: { color: "#ffffff", bright: "#ffffff", glow: "rgba(255,255,255,",  duration: "3s" },
};

const CARD_SVG_INNER_PATH = 'M 27,22 Q 23,22 23,26 L 23,65 L 29,80 L 23,95 L 23,605 L 29,620 L 23,635 L 23,674 Q 23,678 27,678 L 68,678 L 84,672 L 100,678 L 425,678 L 441,672 L 457,678 L 498,678 Q 502,678 502,674 L 502,635 L 496,620 L 502,605 L 502,95 L 496,80 L 502,65 L 502,26 Q 502,22 498,22 L 457,22 L 441,28 L 425,22 L 100,22 L 84,28 L 68,22 Z';

const CARD_SVG_BORDER_PATH = 'M 15,10 L 68,10 L 84,16 L 100,10 L 425,10 L 441,16 L 457,10 L 510,10 Q 515,10 515,14 L 515,65 L 509,80 L 515,95 L 515,605 L 509,620 L 515,635 L 515,686 Q 515,690 510,690 L 457,690 L 441,684 L 425,690 L 100,690 L 84,684 L 68,690 L 15,690 Q 10,690 10,686 L 10,635 L 16,620 L 10,605 L 10,95 L 16,80 L 10,65 L 10,14 Q 10,10 15,10 Z M 27,22 Q 23,22 23,26 L 23,65 L 29,80 L 23,95 L 23,605 L 29,620 L 23,635 L 23,674 Q 23,678 27,678 L 68,678 L 84,672 L 100,678 L 425,678 L 441,672 L 457,678 L 498,678 Q 502,678 502,674 L 502,635 L 496,620 L 502,605 L 502,95 L 496,80 L 502,65 L 502,26 Q 502,22 498,22 L 457,22 L 441,28 L 425,22 L 100,22 L 84,28 L 68,22 Z';

const CARD_SVG_SPIKED_CIRCLE = 'M 25,-108 A 110,110 0 0 1 108,-25 L 130,0 L 108,25 A 110,110 0 0 1 25,108 L 0,130 L -25,108 A 110,110 0 0 1 -108,25 L -130,0 L -108,-25 A 110,110 0 0 1 -25,-108 L 0,-130 L 25,-108 Z';

const CARD_SVG_SPIKED_DIAMOND = 'M 0,-130 L 51,-77 L 83,-83 L 77,-51 L 130,0 L 77,51 L 83,83 L 51,77 L 0,130 L -51,77 L -83,83 L -77,51 L -130,0 L -77,-51 L -83,-83 L -51,-77 Z';

const CARD_SVG_SPIKED_DIAMOND_INNER = 'M 0,-108 L 49,-56 L 56,-49 L 108,0 L 56,49 L 49,56 L 0,108 L -49,56 L -56,49 L -108,0 L -56,-49 L -49,-56 Z';

// Tracking pour l'animation FLIP de la main (reflow fluide quand une carte est jouÃ©e)
let handCardRemovedIndex = -1;

// Sorts engagÃ©s : sorts jouÃ©s pendant la planification, visibles dans la main en grisÃ©
let committedSpells = [];
let commitIdCounter = 0;
// Cache des positions des committed spells au dÃ©but de la rÃ©solution
// (pour que animateSpell puisse les utiliser aprÃ¨s que renderHand les ait retirÃ©s du DOM)
let cachedCommittedRects = {};
// Positions sauvegardÃ©es de la main adverse avant un rebuild (pour animer flyFromOppHand depuis la bonne position)
let savedOppHandRects = null;

// RÃ©animation : sort en attente de sÃ©lection d'une crÃ©ature au cimetiÃ¨re
let pendingReanimation = null;
// { card, handIndex, effectiveCost, targetPlayer, row, col }
let committedGraveyardUids = []; // UIDs des crÃ©atures du cimetiÃ¨re dÃ©jÃ  engagÃ©es par RÃ©animation
let committedReanimationSlots = []; // Slots rÃ©servÃ©s par RÃ©animation {row, col}

// ==================== SYSTÃˆME DE FILE D'ATTENTE D'ANIMATIONS ====================
const animationQueue = [];
let isAnimating = false;
let currentProcessorId = 0; // Pour traquer le processeur actif

// SystÃ¨me de HP diffÃ©rÃ©s pour zdejebel (pour que les HP changent APRÃˆS l'animation)
let pendingHpUpdate = null; // { target: 'me'|'opp', oldHp: number, newHp: number }
let zdejebelAnimationInProgress = false; // Bloque render() pour les HP pendant zdejebel
let lifestealHeroHealInProgress = false; // Bloque render() pour les HP hÃ©ros pendant lifelink
const ANIMATION_DELAYS = {
    attack: 600,       // DÃ©lai aprÃ¨s une attaque
    damage: 500,       // DÃ©lai aprÃ¨s affichage des dÃ©gÃ¢ts
    death: 200,        // DÃ©lai aprÃ¨s une mort (le gros est dans animateDeathToGraveyard)
    heroHit: 200,      // DÃ©lai aprÃ¨s dÃ©gÃ¢ts au hÃ©ros (rÃ©duit)
    move: 650,         // Delai de glissement de carte
    summon: 1050,      // Summon (fly+flip / apparition)
    trapPlace: 900,    // Pose de piege
    discard: 800,      // DÃ©lai aprÃ¨s dÃ©fausse
    burn: 400,         // DÃ©lai aprÃ¨s burn (pioche vers cimetiÃ¨re)
    spell: 200,        // DÃ©lai aprÃ¨s animation de sort (le gros est dans animateSpellReveal)
    trapTrigger: 500,  // DÃ©lai aprÃ¨s animation de piÃ¨ge (sÃ©paration entre piÃ¨ges consÃ©cutifs)
    lifesteal: 200,    // DÃ©lai aprÃ¨s animation lifesteal (le gros de l'anim est dans handleLifestealAnim)
    buildingActivate: 100, // DÃ©lai aprÃ¨s activation de bÃ¢timent (le gros est dans handleBuildingActivate)
    default: 300       // DÃ©lai par dÃ©faut
};
