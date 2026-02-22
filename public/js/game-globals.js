// ==================== VARIABLES GLOBALES DU JEU ====================
let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let testModeSelection = [];
let cardCatalog = null;

// Debug runtime logs (console). Keep disabled in production for performance.
if (typeof window !== 'undefined' && typeof window.DEBUG_LOGS === 'undefined') {
    window.DEBUG_LOGS = false;
}
if (typeof window !== 'undefined' && typeof window.CLIENT_PACED_RESOLUTION === 'undefined') {
    window.CLIENT_PACED_RESOLUTION = false;
}
if (typeof window !== 'undefined' && typeof window.VIS_TRACE_LOGS === 'undefined') {
    // Enabled for visual-debug sessions. Set to false to reduce console noise.
    window.VIS_TRACE_LOGS = true;
}
if (typeof window !== 'undefined' && typeof window.__visTraceSeq === 'undefined') {
    window.__visTraceSeq = 0;
}
if (typeof window !== 'undefined' && typeof window.visTrace !== 'function') {
    window.visTrace = function visTrace(tag, payload) {
        if (!window.VIS_TRACE_LOGS) return;
        const seq = ++window.__visTraceSeq;
        const ts = Date.now();
        try {
            console.log(`[VIS-TRACE] #${seq} t=${ts} ${tag} ${JSON.stringify(payload || {})}`);
        } catch (_) {
            console.log(`[VIS-TRACE] #${seq} t=${ts} ${tag}`, payload || {});
        }
    };
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
