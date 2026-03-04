// render-lock.js — Centralized render lock system
// Replaces: animatingSlots, activeDeathTransformSlots, animatingTrapSlots,
//           graveRenderBlocked, graveReturnAnimActive,
//           zdejebelAnimationInProgress, lifestealHeroHealInProgress,
//           poisonHpOverrides, powerBuffAtkOverrides
//
// Zones: slot, grave, heroHp, trap, hand
//
// Two APIs:
//   Counter API: lock/unlock (maps 1:1 to old .add/.delete patterns)
//   Override API: setOverride/getOverride/clearOverride (for frozen values)

const RenderLock = (() => {
    // Counter-based locks: "zone:key" -> count
    const _counts = new Map();
    // Override values: "zone:key" -> { value, acquiredAt }
    const _overrides = new Map();
    // Debug history: "zone:key" -> [{ reason, at }]  (last N)
    const _debugInfo = new Map();

    function _ik(zone, key) { return zone + ':' + key; }

    // --- Counter API (replaces Set.add / Set.delete / counter.add / counter.delete) ---

    function lock(zone, key, reason) {
        const ik = _ik(zone, key);
        _counts.set(ik, (_counts.get(ik) || 0) + 1);
        if (reason) {
            let arr = _debugInfo.get(ik);
            if (!arr) { arr = []; _debugInfo.set(ik, arr); }
            arr.push({ reason, at: Date.now(), action: 'lock' });
            if (arr.length > 20) arr.shift();
        }
    }

    function unlock(zone, key, reason) {
        const ik = _ik(zone, key);
        const c = _counts.get(ik) || 0;
        if (c <= 1) {
            _counts.delete(ik);
            // Auto-clear override when fully unlocked
            _overrides.delete(ik);
        } else {
            _counts.set(ik, c - 1);
        }
        if (reason) {
            let arr = _debugInfo.get(ik);
            if (!arr) { arr = []; _debugInfo.set(ik, arr); }
            arr.push({ reason, at: Date.now(), action: 'unlock' });
            if (arr.length > 20) arr.shift();
        }
    }

    function unlockAll(zone, key) {
        const ik = _ik(zone, key);
        _counts.delete(ik);
        _overrides.delete(ik);
    }

    function isLocked(zone, key) {
        return (_counts.get(_ik(zone, key)) || 0) > 0;
    }

    function lockCount(zone, key) {
        return _counts.get(_ik(zone, key)) || 0;
    }

    // --- Override API (replaces poisonHpOverrides / powerBuffAtkOverrides) ---

    function setOverride(zone, key, value) {
        _overrides.set(_ik(zone, key), { value, acquiredAt: Date.now() });
    }

    function getOverride(zone, key) {
        const ov = _overrides.get(_ik(zone, key));
        return ov ? ov.value : null;
    }

    function clearOverride(zone, key) {
        _overrides.delete(_ik(zone, key));
    }

    // --- Cleanup ---

    function clearStale(maxAgeMs) {
        // Clear overrides older than maxAgeMs
        const max = maxAgeMs || 15000;
        const now = Date.now();
        for (const [ik, ov] of _overrides) {
            if (now - ov.acquiredAt > max) {
                _overrides.delete(ik);
            }
        }
    }

    function resetZone(zone) {
        // Remove all locks and overrides for a specific zone
        for (const [ik] of _counts) {
            if (ik.startsWith(zone + ':')) _counts.delete(ik);
        }
        for (const [ik] of _overrides) {
            if (ik.startsWith(zone + ':')) _overrides.delete(ik);
        }
    }

    function resetAll(preserveFilter) {
        if (!preserveFilter) {
            _counts.clear();
            _overrides.clear();
            return;
        }
        for (const [ik, c] of _counts) {
            const [zone, ...rest] = ik.split(':');
            const key = rest.join(':');
            if (!preserveFilter(zone, key)) {
                _counts.delete(ik);
                _overrides.delete(ik);
            }
        }
    }

    // --- Debug ---

    function debug() {
        const result = [];
        for (const [ik, c] of _counts) {
            const [zone, ...rest] = ik.split(':');
            const key = rest.join(':');
            const ov = _overrides.get(ik);
            const history = _debugInfo.get(ik) || [];
            result.push({ zone, key, count: c, override: ov ? ov.value : null, history });
        }
        return result;
    }

    function count() {
        let total = 0;
        for (const c of _counts.values()) total += c;
        return total;
    }

    function activeKeys(zone) {
        const keys = [];
        const prefix = zone + ':';
        for (const [ik, c] of _counts) {
            if (c > 0 && ik.startsWith(prefix)) {
                keys.push(ik.slice(prefix.length));
            }
        }
        return keys;
    }

    return {
        lock, unlock, unlockAll, isLocked, lockCount,
        setOverride, getOverride, clearOverride,
        clearStale, resetZone, resetAll,
        debug, count, activeKeys
    };
})();

// === Compatibility shims ===
// game-animations.js uses old APIs (Set.add/delete, Map.get/set, booleans).
// These shims proxy to RenderLock so both systems stay in sync.

// Set-like shims: use internal Set to preserve idempotent add/delete semantics
// (old code does .add() in queueAnimation AND in handler — must not double-count)
const animatingSlots = (() => {
    const _s = new Set();
    return {
        add(key) { if (!_s.has(key)) { _s.add(key); RenderLock.lock('slot', key, 'anim'); } },
        delete(key) { if (_s.has(key)) { _s.delete(key); RenderLock.unlock('slot', key, 'anim'); } },
        has(key) { return _s.has(key); },
        get size() { return _s.size; },
        [Symbol.iterator]() { return _s[Symbol.iterator](); }
    };
})();

const activeDeathTransformSlots = (() => {
    const _s = new Set();
    return {
        add(key) { if (!_s.has(key)) { _s.add(key); RenderLock.lock('slot', key, 'deathTransform'); } },
        delete(key) { if (_s.has(key)) { _s.delete(key); RenderLock.unlock('slot', key, 'deathTransform'); } },
        has(key) { return _s.has(key); },
        get size() { return _s.size; },
        [Symbol.iterator]() { return _s[Symbol.iterator](); }
    };
})();

const animatingTrapSlots = (() => {
    const _s = new Set();
    return {
        add(key) { if (!_s.has(key)) { _s.add(key); RenderLock.lock('trap', key, 'anim'); } },
        delete(key) { if (_s.has(key)) { _s.delete(key); RenderLock.unlock('trap', key, 'anim'); } },
        has(key) { return _s.has(key); },
        get size() { return _s.size; },
        [Symbol.iterator]() { return _s[Symbol.iterator](); }
    };
})();

const graveRenderBlocked = {
    add(key) { RenderLock.lock('grave', key, 'anim'); },
    delete(key) { RenderLock.unlock('grave', key, 'anim'); },
    has(key) { return RenderLock.isLocked('grave', key); },
    get size() { return RenderLock.activeKeys('grave').length; }
};

const graveReturnAnimActive = {
    add(key) { RenderLock.lock('grave', key, 'graveReturn'); },
    delete(key) { RenderLock.unlock('grave', key, 'graveReturn'); },
    has(key) { return RenderLock.isLocked('grave', key); }
};

const poisonHpOverrides = {
    _map: new Map(),
    get(key) { return this._map.get(key); },
    set(key, val) {
        this._map.set(key, val);
        var existing = RenderLock.getOverride('slot', key) || {};
        RenderLock.setOverride('slot', key, Object.assign({}, existing, val));
    },
    delete(key) {
        this._map.delete(key);
        var ov = RenderLock.getOverride('slot', key);
        if (ov && ov.atk !== undefined) {
            var kept = { atk: ov.atk };
            RenderLock.setOverride('slot', key, kept);
        } else {
            RenderLock.clearOverride('slot', key);
        }
    },
    has(key) { return this._map.has(key); },
    clear() {
        this._map.clear();
        // Keep ATK overrides intact
        for (var k of RenderLock.activeKeys('slot')) {
            var ov = RenderLock.getOverride('slot', k);
            if (ov && ov.hp !== undefined) {
                if (ov.atk !== undefined) {
                    RenderLock.setOverride('slot', k, { atk: ov.atk });
                } else {
                    RenderLock.clearOverride('slot', k);
                }
            }
        }
    }
};

const powerBuffAtkOverrides = {
    _map: new Map(),
    get(key) { return this._map.get(key); },
    set(key, val) {
        this._map.set(key, val);
        var existing = RenderLock.getOverride('slot', key) || {};
        RenderLock.setOverride('slot', key, Object.assign({}, existing, { atk: val }));
    },
    delete(key) {
        this._map.delete(key);
        var ov = RenderLock.getOverride('slot', key);
        if (ov && ov.hp !== undefined) {
            var kept = {}; for (var p in ov) { if (p !== 'atk') kept[p] = ov[p]; }
            RenderLock.setOverride('slot', key, kept);
        } else {
            RenderLock.clearOverride('slot', key);
        }
    },
    has(key) { return this._map.has(key); },
    clear() {
        this._map.clear();
        for (var k of RenderLock.activeKeys('slot')) {
            var ov = RenderLock.getOverride('slot', k);
            if (ov && ov.atk !== undefined) {
                if (ov.hp !== undefined) {
                    var kept = {}; for (var p in ov) { if (p !== 'atk') kept[p] = ov[p]; }
                    RenderLock.setOverride('slot', k, kept);
                } else {
                    RenderLock.clearOverride('slot', k);
                }
            }
        }
    }
};

// Boolean flags: use defineProperty so assignments proxy to RenderLock
Object.defineProperty(window, 'zdejebelAnimationInProgress', {
    get: function() { return RenderLock.isLocked('heroHp', 'all'); },
    set: function(v) {
        if (v) RenderLock.lock('heroHp', 'all', 'heroAnim');
        else RenderLock.unlock('heroHp', 'all', 'heroAnim');
    },
    configurable: true
});

Object.defineProperty(window, 'lifestealHeroHealInProgress', {
    get: function() { return RenderLock.isLocked('heroHp', 'all'); },
    set: function(v) {
        if (v) RenderLock.lock('heroHp', 'all', 'lifestealHeal');
        else RenderLock.unlock('heroHp', 'all', 'lifestealHeal');
    },
    configurable: true
});
