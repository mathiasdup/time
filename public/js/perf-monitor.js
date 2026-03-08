// ==================== PERFORMANCE MONITOR ====================
// Logs ONLY real frame drops (>50ms). Identifies which function caused it.
// Console API:
//   PerfMonitor.report()   — summary grouped by phase + top slow functions
//   PerfMonitor.fps()      — current FPS
//   PerfMonitor.reset()    — clear history
//   PerfMonitor.live(true) — FPS overlay on screen

(function () {
    'use strict';

    const HISTORY_MAX = 200;
    const SLOW_FRAME_MS = 50;      // only log 50ms+ frame gaps
    const SLOW_FUNC_MS = 10;       // report function if >10ms (internal only, not logged individually)
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

    function _getFps() {
        const now = performance.now();
        _frameTimes = _frameTimes.filter(t => now - t < FPS_WINDOW_MS);
        return _frameTimes.length;
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
            // Collect slow functions from this frame
            const slow = {};
            for (const [key, val] of Object.entries(_timings)) {
                if (typeof val === 'number' && val > SLOW_FUNC_MS) {
                    slow[key] = +val.toFixed(1);
                }
            }

            const entry = {
                t: Math.round(ts),
                dt: +dt.toFixed(1),
                fps: _getFps(),
                phase: _phase,
                animQueue: _animQueueLen,
                slow: Object.keys(slow).length ? slow : undefined,
            };

            _lagHistory.push(entry);
            if (_lagHistory.length > HISTORY_MAX) _lagHistory.shift();

            const slowStr = entry.slow
                ? ' | ' + Object.entries(entry.slow)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `${k}:${v}ms`).join(' ')
                : ' | (no instrumented fn >10ms — likely GC, GPU, or layout thrash)';

            console.warn(`[PERF] ${entry.dt}ms frame | ${entry.fps}fps | phase:${entry.phase} | Q:${entry.animQueue}${slowStr}`);
        }

        // Clear timings for next frame
        for (const k of Object.keys(_timings)) delete _timings[k];

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

        // CombatVFX.update (Pixi ticker)
        if (window.CombatVFX) {
            if (typeof window.CombatVFX.update === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'update');
            if (typeof window.CombatVFX.updateShields === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'updateShields');
            if (typeof window.CombatVFX.updateCamouflages === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'updateCamouflages');
            if (typeof window.CombatVFX.updateDeflexions === 'function') _wrapMethod(window.CombatVFX, 'CombatVFX', 'updateDeflexions');
        }

        // CardGlow RAF
        if (window.CardGlow && typeof window.CardGlow._drawAll === 'function') {
            _wrapMethod(window.CardGlow, 'CardGlow', '_drawAll');
        }

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
    window.PerfMonitor = {
        fps: _getFps,
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
            for (const e of _lagHistory) {
                const p = e.phase || '?';
                if (!byPhase[p]) byPhase[p] = { count: 0, maxDt: 0, totalDt: 0, slowFns: {} };
                byPhase[p].count++;
                byPhase[p].totalDt += e.dt;
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
            console.log(`[PERF] ${_lagHistory.length} spikes total:`);
            for (const [phase, d] of Object.entries(byPhase)) {
                console.group(`${phase} — ${d.count} spikes, max ${d.maxDt.toFixed(0)}ms, avg ${(d.totalDt / d.count).toFixed(0)}ms`);
                const sorted = Object.entries(d.slowFns).sort((a, b) => b[1].totalMs - a[1].totalMs);
                if (sorted.length) {
                    for (const [fn, s] of sorted) {
                        console.log(`  ${fn}: ${s.count}x, total ${s.totalMs.toFixed(0)}ms, max ${s.maxMs.toFixed(0)}ms`);
                    }
                } else {
                    console.log('  (no instrumented functions detected — GC/GPU/layout)');
                }
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
