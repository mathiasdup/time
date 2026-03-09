// ==================== PERFORMANCE MONITOR v3 ====================
// Deep diagnostics: JS time vs browser time, DOM mutations, long tasks.
// Console API:
//   PerfMonitor.report()   — summary grouped by phase + top slow functions
//   PerfMonitor.fps()      — current FPS
//   PerfMonitor.reset()    — clear history
//   PerfMonitor.live(true) — FPS overlay on screen

(function () {
    'use strict';

    const HISTORY_MAX = 200;
    const SLOW_FRAME_MS = 50;
    const SLOW_FUNC_MS = 5;       // lowered to 5ms to catch "death by 1000 cuts"
    const FPS_WINDOW_MS = 1000;

    const _lagHistory = [];
    let _frameTimes = [];
    let _lastFrameTs = 0;
    let _overlayEl = null;
    let _liveMode = false;
    let _phase = '?';
    let _animQueueLen = 0;

    // Per-frame accumulated timings: { funcName: totalMs }
    const _timings = {};

    // --- Event trail: ring buffer of recent game events ---
    const EVENT_TRAIL_MAX = 30;
    const _eventTrail = [];
    function _trailPush(tag, detail) {
        _eventTrail.push({ t: performance.now(), tag, detail });
        if (_eventTrail.length > EVENT_TRAIL_MAX) _eventTrail.shift();
    }
    // Flush trail on slow frame: return all buffered events and clear
    function _flushTrail() {
        if (_eventTrail.length === 0) return [];
        const copy = _eventTrail.slice();
        _eventTrail.length = 0;
        return copy;
    }

    // DOM mutation counter (reset each frame)
    let _domMutations = 0;
    let _domMutationObserver = null;

    // Long task detector
    let _longTasks = [];       // [{start, duration}] accumulated between frames
    let _longTaskObserver = null;

    function _getFps() {
        const now = performance.now();
        _frameTimes = _frameTimes.filter(t => now - t < FPS_WINDOW_MS);
        return _frameTimes.length;
    }

    // --- DOM Mutation Observer (lightweight — just counts) ---
    function _initMutationCounter() {
        if (_domMutationObserver) return;
        _domMutationObserver = new MutationObserver(mutations => {
            _domMutations += mutations.length;
        });
        _domMutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
        });
    }

    // --- Long Task Observer (browser reports tasks >50ms) ---
    function _initLongTaskObserver() {
        if (_longTaskObserver || typeof PerformanceObserver === 'undefined') return;
        try {
            _longTaskObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    _longTasks.push({
                        start: +entry.startTime.toFixed(0),
                        dur: +entry.duration.toFixed(0),
                        name: entry.name,
                    });
                }
            });
            _longTaskObserver.observe({ type: 'longtask', buffered: false });
        } catch (e) {
            // longtask not supported in this browser
        }
    }

    // --- Snapshot rendering layers ---
    function _getLayerStats() {
        const layers = {};
        if (typeof CombatVFX !== 'undefined' && CombatVFX.initialized) {
            const vfx = CombatVFX;
            layers.pixiVFX = vfx.activeEffects ? vfx.activeEffects.length : 0;
            layers.pixiShields = vfx.activeShields ? vfx.activeShields.size : 0;
            layers.pixiCamo = vfx.activeCamouflages ? vfx.activeCamouflages.size : 0;
            layers.pixiDeflex = vfx.activeDeflexions ? vfx.activeDeflexions.size : 0;
            layers.pixiShake = !!vfx._shakeActive;
            if (vfx.app && vfx.app.stage) layers.pixiMainObjs = vfx.app.stage.children.length;
            
        }
        if (typeof CardGlow !== 'undefined' && CardGlow._perfStats) {
            const cg = CardGlow._perfStats();
            layers.glowTargets = cg.targets;
            layers.glowRunning = cg.running;
        }
        // Count actual visible glow canvases + all canvases in DOM
        const allCanvases = document.querySelectorAll('canvas');
        let visibleCanvases = 0;
        let glowVisible = 0;
        for (const c of allCanvases) {
            const hidden = c.style.display === 'none' || c.style.visibility === 'hidden';
            if (!hidden) visibleCanvases++;
            if (c.classList.contains('card-glow-canvas') && !hidden) glowVisible++;
        }
        layers.canvasTotal = allCanvases.length;
        layers.canvasVisible = visibleCanvases;
        layers.glowVisible = glowVisible;
        // PixiJS ticker state
        if (typeof CombatVFX !== 'undefined' && CombatVFX.app) {
            layers.pixiTicker = CombatVFX.app.ticker.started ? 'on' : 'off';
            const cv = CombatVFX.app.canvas;
            layers.pixiCanvasVis = cv ? (cv.style.display === 'none' ? 'hidden' : 'visible') : '?';
        }
        return layers;
    }

    function _formatLayers(layers) {
        const parts = [];
        if ((layers.pixiVFX || 0) > 0) parts.push(`vfx:${layers.pixiVFX}`);
        const overlay = (layers.pixiShields || 0) + (layers.pixiCamo || 0) + (layers.pixiDeflex || 0);
        if (overlay > 0) parts.push(`shields:${layers.pixiShields||0} camo:${layers.pixiCamo||0} deflx:${layers.pixiDeflex||0}`);
        if (layers.pixiShake) parts.push('SHAKE');
        if (layers.pixiMainObjs > 0) parts.push(`mainStage:${layers.pixiMainObjs}`);
        if (layers.pixiShieldObjs > 1) parts.push(`shieldStage:${layers.pixiShieldObjs}`);
        if (layers.glowTargets > 0) parts.push(`glow:${layers.glowTargets}(vis:${layers.glowVisible||0})`);
        else if (layers.glowRunning) parts.push('glow:idle');
        if (layers.canvasTotal > 0) parts.push(`cv:${layers.canvasVisible}/${layers.canvasTotal}`);
        if (layers.pixiTicker) parts.push(`pixi:${layers.pixiTicker}/${layers.pixiCanvasVis}`);
        return parts.length > 0 ? parts.join(' ') : 'idle';
    }

    // --- RAF loop: detect slow frames ---
    function _onFrame(ts) {
        requestAnimationFrame(_onFrame);
        _frameTimes.push(ts);

        if (!_lastFrameTs) { _lastFrameTs = ts; return; }
        const dt = ts - _lastFrameTs;
        _lastFrameTs = ts;

        // Grab game state
        if (typeof state !== 'undefined' && state && state.phase) _phase = state.phase;
        if (typeof animQueue !== 'undefined' && Array.isArray(animQueue)) _animQueueLen = animQueue.length;

        if (dt > SLOW_FRAME_MS) {
            // Compute total JS time from all instrumented functions
            let totalJsMs = 0;
            const slow = {};
            for (const [key, val] of Object.entries(_timings)) {
                if (typeof val === 'number') {
                    totalJsMs += val;
                    if (val > SLOW_FUNC_MS) {
                        slow[key] = +val.toFixed(1);
                    }
                }
            }
            totalJsMs = +totalJsMs.toFixed(1);
            const browserMs = +(dt - totalJsMs).toFixed(1);

            // Snapshot rendering layers
            const layers = _getLayerStats();

            // Grab DOM mutations since last frame
            const domMuts = _domMutations;

            // Grab long tasks since last frame
            const lt = _longTasks.length > 0 ? _longTasks.slice() : undefined;

            const entry = {
                t: Math.round(ts),
                dt: +dt.toFixed(1),
                fps: _getFps(),
                phase: _phase,
                animQueue: _animQueueLen,
                jsMs: totalJsMs,
                browserMs: browserMs,
                domMuts: domMuts,
                slow: Object.keys(slow).length ? slow : undefined,
                layers: layers,
                longTasks: lt,
            };

            _lagHistory.push(entry);
            if (_lagHistory.length > HISTORY_MAX) _lagHistory.shift();

            // Format log line
            const slowStr = entry.slow
                ? ' | ' + Object.entries(entry.slow)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `${k}:${v}ms`).join(' ')
                : '';

            // Flush all buffered events (including from prior fast frames)
            const trail = _flushTrail();
            entry.trail = trail.length > 0 ? trail : undefined;

            const layerStr = _formatLayers(layers);
            const splitStr = `JS:${totalJsMs}ms+Browser:${browserMs}ms`;
            const domStr = domMuts > 0 ? ` DOM:${domMuts}` : '';
            const ltStr = lt ? ` LT:${lt.map(t => t.dur + 'ms').join(',')}` : '';
            const trailStr = trail.length > 0
                ? ' EVT:[' + trail.map(e => e.detail ? `${e.tag}(${e.detail})` : e.tag).join(', ') + ']'
                : '';

            console.warn(`[PERF] ${entry.dt}ms frame (${splitStr}) | ${entry.fps}fps | phase:${entry.phase} | Q:${entry.animQueue}${domStr}${ltStr} | L:[${layerStr}]${slowStr}${trailStr}`);
        }

        // Clear per-frame counters
        for (const k of Object.keys(_timings)) delete _timings[k];
        _domMutations = 0;
        _longTasks.length = 0;
        // On fast frames: ring buffer auto-trims via EVENT_TRAIL_MAX (no drain needed)
        // Events accumulate until the next slow frame flushes them all

        // Live overlay
        if (_liveMode && _overlayEl) {
            const fps = _getFps();
            _overlayEl.textContent = `${fps} FPS | ${_phase} | Q:${_animQueueLen}`;
            _overlayEl.style.color = fps >= 55 ? '#0f0' : fps >= 30 ? '#ff0' : '#f00';
        }
    }

    // --- Wrap sync function ---
    function _wrapGlobal(name) {
        const original = window[name];
        if (typeof original !== 'function' || original._perfWrapped) return;
        window[name] = function () {
            const t0 = performance.now();
            const result = original.apply(this, arguments);
            _timings[name] = (_timings[name] || 0) + (performance.now() - t0);
            return result;
        };
        window[name]._perfWrapped = true;
        window[name]._original = original;
    }

    // --- Wrap method on object ---
    function _wrapMethod(obj, objName, methodName) {
        const original = obj[methodName];
        if (typeof original !== 'function' || original._perfWrapped) return;
        const label = objName + '.' + methodName;
        const bound = original.bind(obj);
        obj[methodName] = function () {
            const t0 = performance.now();
            const result = bound.apply(null, arguments);
            _timings[label] = (_timings[label] || 0) + (performance.now() - t0);
            return result;
        };
        obj[methodName]._perfWrapped = true;
    }

    // --- Init: wrap all game functions ---
    function _init() {
        // Render pipeline
        [
            'render', 'renderDelta', 'renderField', 'renderHand', 'renderOppHand',
            'renderTraps', 'updateDeckDisplay', 'updateGraveDisplay', 'updateGraveTopCard',
            'makeCard', 'fitArenaName', 'autoFitCardName', 'resizeGame',
            // Animation handlers
            'animateDeath', 'animateSummon', 'animateBuff', 'animateHeal',
            'animateSpellMiss', 'animateSpellReturnToHand', 'animateGraveyardReturnToHand',
            'animateTrapPlace', 'animateTrapSummon', 'animateReanimate', 'animateMove',
            'animateAtkBoost', 'showRoundBanner', 'showPhaseMessage',
            'checkPendingBounce', 'smoothCloseOppHandGap',
        ].forEach(_wrapGlobal);

        // CombatVFX methods
        if (window.CombatVFX) {
            if (typeof window.CombatVFX.update === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'update');
            if (typeof window.CombatVFX.updateShields === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'updateShields');
            if (typeof window.CombatVFX.updateCamouflages === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'updateCamouflages');
            if (typeof window.CombatVFX.updateDeflexions === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'updateDeflexions');
        }

        // CardGlow
        if (window.CardGlow && typeof window.CardGlow._drawAll === 'function') {
            _wrapMethod(window.CardGlow, 'CardGlow', '_drawAll');
        }

        // Start observers
        _initMutationCounter();
        _initLongTaskObserver();

        requestAnimationFrame(_onFrame);
    }

    // --- Overlay ---
    function _createOverlay() {
        if (_overlayEl) return;
        _overlayEl = document.createElement('div');
        Object.assign(_overlayEl.style, {
            position: 'fixed', top: '4px', right: '4px', zIndex: '99999',
            background: 'rgba(0,0,0,0.75)', color: '#0f0',
            padding: '4px 10px', fontFamily: 'monospace', fontSize: '13px',
            borderRadius: '4px', pointerEvents: 'none', userSelect: 'none',
        });
        document.body.appendChild(_overlayEl);
    }

    // --- Public API ---
    // Expose evt early so callers never hit "not a function"
    window.PerfMon = window.PerfMon || {};
    window.PerfMon.evt = _trailPush;

    window.PerfMonitor = {
        fps: _getFps,
        evt: _trailPush,
        reset() { _lagHistory.length = 0; _frameTimes.length = 0; console.log('[PERF] Cleared.'); },
        history() { return _lagHistory.slice(); },

        live(on = true) {
            _liveMode = on;
            if (on) { _createOverlay(); _overlayEl.style.display = 'block'; }
            else if (_overlayEl) _overlayEl.style.display = 'none';
        },

        report() {
            if (!_lagHistory.length) { console.log('[PERF] No spikes.'); return; }
            const byPhase = {};
            let totalJs = 0, totalBrowser = 0, totalDom = 0, spikeCount = 0;
            for (const e of _lagHistory) {
                spikeCount++;
                totalJs += e.jsMs || 0;
                totalBrowser += e.browserMs || 0;
                totalDom += e.domMuts || 0;
                const p = e.phase || '?';
                if (!byPhase[p]) byPhase[p] = { count: 0, maxDt: 0, totalDt: 0, totalJs: 0, totalBrowser: 0, totalDom: 0, slowFns: {} };
                byPhase[p].count++;
                byPhase[p].totalDt += e.dt;
                byPhase[p].totalJs += (e.jsMs || 0);
                byPhase[p].totalBrowser += (e.browserMs || 0);
                byPhase[p].totalDom += (e.domMuts || 0);
                if (e.dt > byPhase[p].maxDt) byPhase[p].maxDt = e.dt;
                if (e.slow) {
                    for (const [fn, ms] of Object.entries(e.slow)) {
                        if (!byPhase[p].slowFns[fn]) byPhase[p].slowFns[fn] = { count: 0, totalMs: 0, maxMs: 0 };
                        byPhase[p].slowFns[fn].count++;
                        byPhase[p].slowFns[fn].totalMs += ms;
                        if (ms > byPhase[p].slowFns[fn].maxMs) byPhase[p].slowFns[fn].maxMs = ms;
                    }
                }
            }
            console.log(`[PERF] ${spikeCount} spikes — avg JS:${(totalJs/spikeCount).toFixed(0)}ms + Browser:${(totalBrowser/spikeCount).toFixed(0)}ms | avg DOM mutations:${(totalDom/spikeCount).toFixed(0)}`);
            for (const [phase, d] of Object.entries(byPhase)) {
                const avgJs = (d.totalJs / d.count).toFixed(0);
                const avgBr = (d.totalBrowser / d.count).toFixed(0);
                const avgDom = (d.totalDom / d.count).toFixed(0);
                console.group(`${phase} — ${d.count} spikes, max ${d.maxDt.toFixed(0)}ms | avg JS:${avgJs}ms + Browser:${avgBr}ms | DOM:${avgDom}/frame`);
                const sorted = Object.entries(d.slowFns).sort((a, b) => b[1].totalMs - a[1].totalMs);
                for (const [fn, s] of sorted) {
                    console.log(`  ${fn}: ${s.count}x, total ${s.totalMs.toFixed(0)}ms, max ${s.maxMs.toFixed(0)}ms`);
                }
                if (!sorted.length) console.log('  (no slow functions)');
                console.groupEnd();
            }
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(_init, 200));
    } else {
        setTimeout(_init, 200);
    }
})();
