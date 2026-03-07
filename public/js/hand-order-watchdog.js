// hand-order-watchdog.js — Detects unexpected card order changes in hand
// Hooks into render() via the same post-render RAF pattern as hp-watchdog.
// Console: HandOrderWatchdog.report() / HandOrderWatchdog.stop()
var HandOrderWatchdog = (function() {
    var _active = true;
    var _prevUids = [];
    var _prevPhase = '';
    var _prevTurn = 0;
    var _swaps = [];
    var _checkCount = 0;

    function _getHandUids() {
        if (typeof state === 'undefined' || !state || !state.me || !state.me.hand) return [];
        return state.me.hand.map(function(c) {
            return c ? (c.uid || c.id || '?') : null;
        }).filter(function(u) { return u !== null; });
    }

    function _getHandNames() {
        if (typeof state === 'undefined' || !state || !state.me || !state.me.hand) return [];
        return state.me.hand.map(function(c) {
            return c ? (c.name || c.id || '?') : null;
        }).filter(function(n) { return n !== null; });
    }

    function _sameSet(a, b) {
        if (a.length !== b.length) return false;
        var sa = a.slice().sort();
        var sb = b.slice().sort();
        for (var i = 0; i < sa.length; i++) {
            if (sa[i] !== sb[i]) return false;
        }
        return true;
    }

    function _findSwaps(before, after) {
        // Returns array of { uid, fromIndex, toIndex }
        var swaps = [];
        for (var i = 0; i < before.length; i++) {
            if (before[i] !== after[i]) {
                var newIdx = after.indexOf(before[i]);
                if (newIdx !== -1 && newIdx !== i) {
                    // Check if we already logged the reverse
                    var isDupe = swaps.some(function(s) { return s.toIndex === i && s.fromIndex === newIdx; });
                    if (!isDupe) {
                        swaps.push({ uid: before[i], fromIndex: i, toIndex: newIdx });
                    }
                }
            }
        }
        return swaps;
    }

    function _postRenderCheck() {
        if (!_active) return;
        _checkCount++;

        var currentUids = _getHandUids();
        var currentNames = _getHandNames();
        var phase = (typeof state !== 'undefined' && state) ? state.phase || '' : '';
        var turn = (typeof state !== 'undefined' && state) ? state.turn || 0 : 0;

        if (_prevUids.length === 0) {
            _prevUids = currentUids;
            _prevPhase = phase;
            _prevTurn = turn;
            return;
        }

        // Only flag if same set of cards but different order (= swap, not draw/play/discard)
        if (_sameSet(_prevUids, currentUids) && currentUids.length > 1) {
            var swaps = _findSwaps(_prevUids, currentUids);
            if (swaps.length > 0) {
                var entry = {
                    at: Date.now(),
                    phase: phase,
                    turn: turn,
                    prevPhase: _prevPhase,
                    swaps: swaps,
                    before: _prevUids.slice(),
                    after: currentUids.slice(),
                    names: currentNames.slice()
                };
                _swaps.push(entry);

                // Build readable swap description
                var desc = swaps.map(function(s) {
                    var name = currentNames[s.toIndex] || s.uid;
                    return '"' + name + '" ' + s.fromIndex + ' -> ' + s.toIndex;
                }).join(', ');

                console.warn('[HAND-ORDER] SWAP detected! phase=' + phase + ' turn=' + turn +
                    ' | ' + desc);
                console.warn('[HAND-ORDER]   before: [' + _prevUids.map(function(u, i) {
                    return i + ':' + (currentNames[_prevUids.indexOf(u)] || u);
                }).join(', ') + ']');
                console.warn('[HAND-ORDER]   after:  [' + currentUids.map(function(u, i) {
                    return i + ':' + (currentNames[i] || u);
                }).join(', ') + ']');

                // Capture stack trace
                try { throw new Error('HAND-ORDER swap trace'); } catch(e) {
                    console.warn('[HAND-ORDER]   trace:', e.stack.split('\n').slice(1, 5).join(' <- '));
                }
            }
        }

        _prevUids = currentUids;
        _prevPhase = phase;
        _prevTurn = turn;
    }

    // Hook into render() — same pattern as hp-watchdog
    function _hookRender() {
        if (typeof render !== 'function') {
            setTimeout(_hookRender, 500);
            return;
        }
        var _origRender = render;
        window.render = function() {
            var result = _origRender.apply(this, arguments);
            if (_active) {
                requestAnimationFrame(_postRenderCheck);
            }
            return result;
        };

        // Also hook renderDelta for delta renders during resolution
        if (typeof renderDelta === 'function') {
            var _origRenderDelta = renderDelta;
            window.renderDelta = function() {
                var result = _origRenderDelta.apply(this, arguments);
                if (_active) {
                    requestAnimationFrame(_postRenderCheck);
                }
                return result;
            };
        }

        console.log('[HAND-ORDER-WATCHDOG] Loaded — hooks render(). Use HandOrderWatchdog.report()');
    }

    _hookRender();

    return {
        report: function() {
            if (_swaps.length === 0) {
                console.log('[HAND-ORDER-WATCHDOG] No swaps detected. Checks: ' + _checkCount);
            } else {
                console.warn('[HAND-ORDER-WATCHDOG] ' + _swaps.length + ' swap(s) detected:');
                _swaps.forEach(function(s, i) {
                    console.warn('  #' + (i + 1) + ' phase=' + s.phase + ' turn=' + s.turn, s);
                });
            }
            return _swaps;
        },
        swaps: function() { return _swaps; },
        stop: function() { _active = false; console.log('[HAND-ORDER-WATCHDOG] Stopped'); },
        start: function() { _active = true; console.log('[HAND-ORDER-WATCHDOG] Started'); },
        clear: function() { _swaps = []; _checkCount = 0; console.log('[HAND-ORDER-WATCHDOG] Cleared'); }
    };
})();
