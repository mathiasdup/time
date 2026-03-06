// ==================== CARD FLASH WATCHDOG ====================
// Détecte les flashs visuels (carte qui disparaît puis réapparaît) sur les slots créature et piège.
// Utilise MutationObserver pour capturer TOUTE mutation DOM, même sub-frame.
// Usage console : CardFlashWatchdog.report(), CardFlashWatchdog.events(), CardFlashWatchdog.clear()
window.CardFlashWatchdog = (function () {
    'use strict';

    var _events = [];       // Tous les changements slot (ajout/suppression carte)
    var _flashes = [];      // Flashs détectés (suppression + ré-ajout rapide)
    var _pendingRemovals = {}; // slotKey → { uid, name, time, stack, locked }
    var _observers = [];
    var _t0 = performance.now();
    var MAX_EVENTS = 2000;
    var FLASH_THRESHOLD_MS = 3000; // Seuil max pour considérer un flash

    function _now() {
        return Math.round(performance.now() - _t0);
    }

    function _compactStack() {
        var lines = new Error().stack.split('\n');
        var useful = [];
        for (var i = 2; i < lines.length && useful.length < 4; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            // Extraire juste le nom de fonction et le fichier:ligne
            var match = line.match(/at\s+(\S+).*?(\w+\.js[^:]*:\d+)/);
            if (match) {
                useful.push(match[1] + ' (' + match[2] + ')');
            } else {
                var match2 = line.match(/at\s+(.+)/);
                if (match2) useful.push(match2[1].substring(0, 80));
            }
        }
        return useful.join(' \u2190 ');
    }

    function _pushEvent(evt) {
        _events.push(evt);
        if (_events.length > MAX_EVENTS) _events.shift();
    }

    // === CARD SLOT OBSERVER ===
    function _onCardSlotMutation(mutations, slotEl) {
        var owner = slotEl.dataset.owner;
        var row = slotEl.dataset.row;
        var col = slotEl.dataset.col;
        var slotKey = owner + '-' + row + '-' + col;
        var locked = typeof RenderLock !== 'undefined' && RenderLock.isLocked('slot', slotKey);
        var stack = _compactStack();
        var time = _now();

        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type !== 'childList') continue;

            // Nodes supprimés
            for (var j = 0; j < m.removedNodes.length; j++) {
                var removed = m.removedNodes[j];
                if (removed.nodeType !== 1) continue;
                if (!removed.classList || !removed.classList.contains('card')) continue;

                var uid = removed.dataset ? removed.dataset.uid : null;
                var name = removed.querySelector ? null : null;
                var nameEl = removed.querySelector && removed.querySelector('.arena-name, .card-name');
                name = nameEl ? nameEl.textContent : (removed.dataset ? removed.dataset.cardName : null);

                var evt = {
                    type: 'card-removed',
                    slot: slotKey,
                    uid: uid || '?',
                    name: name || '?',
                    time: time,
                    locked: locked,
                    stack: stack
                };
                _pushEvent(evt);

                // Stocker pour détection flash
                _pendingRemovals[slotKey] = {
                    uid: uid,
                    name: name,
                    time: time,
                    stack: stack,
                    locked: locked
                };

                if (!locked) {
                    console.log('[CARD-FLASH] \uD83D\uDFE5 card-removed @' + slotKey +
                        ' "' + (name || '?') + '" uid:' + (uid ? uid.slice(-8) : '?') +
                        ' (locked: false)\n  ' + stack);
                }
            }

            // Nodes ajoutés
            for (var k = 0; k < m.addedNodes.length; k++) {
                var added = m.addedNodes[k];
                if (added.nodeType !== 1) continue;
                if (!added.classList || !added.classList.contains('card')) continue;

                var addUid = added.dataset ? added.dataset.uid : null;
                var addNameEl = added.querySelector && added.querySelector('.arena-name, .card-name');
                var addName = addNameEl ? addNameEl.textContent : (added.dataset ? added.dataset.cardName : null);

                var addEvt = {
                    type: 'card-added',
                    slot: slotKey,
                    uid: addUid || '?',
                    name: addName || '?',
                    time: time,
                    locked: locked,
                    stack: stack
                };
                _pushEvent(addEvt);

                // Détection flash : ré-ajout rapide après suppression
                var pending = _pendingRemovals[slotKey];
                if (pending) {
                    var delta = time - pending.time;
                    if (delta <= FLASH_THRESHOLD_MS) {
                        var flash = {
                            slot: slotKey,
                            uid: pending.uid || addUid,
                            name: pending.name || addName,
                            durationMs: delta,
                            removedAt: pending.time,
                            readdedAt: time,
                            removeLocked: pending.locked,
                            addLocked: locked,
                            removeStack: pending.stack,
                            addStack: stack
                        };
                        _flashes.push(flash);
                        console.warn(
                            '[CARD-FLASH] \u26A1 FLASH @' + slotKey +
                            ': card removed then re-added in ' + delta + 'ms' +
                            ' (name: "' + (flash.name || '?') + '"' +
                            ', uid: ' + (flash.uid ? flash.uid.slice(-8) : '?') + ')' +
                            '\n  removed by: ' + pending.stack +
                            '\n  re-added by: ' + stack +
                            '\n  removeLocked: ' + pending.locked + ', addLocked: ' + locked
                        );
                    }
                    delete _pendingRemovals[slotKey];
                }
            }
        }
    }

    // === TRAP SLOT OBSERVER ===
    function _onTrapSlotMutation(mutations, slotEl) {
        var owner = slotEl.dataset.owner;
        var row = slotEl.dataset.row;
        var slotKey = 'trap-' + owner + '-' + row;
        var lockKey = owner + '-' + row;
        var locked = typeof RenderLock !== 'undefined' && RenderLock.isLocked('trap', lockKey);
        var stack = _compactStack();
        var time = _now();

        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type !== 'childList') continue;

            // Check removals for .trap-card-back
            for (var j = 0; j < m.removedNodes.length; j++) {
                var removed = m.removedNodes[j];
                if (removed.nodeType !== 1) continue;
                var isTrapCard = removed.classList && removed.classList.contains('trap-card-back');
                if (!isTrapCard) continue;

                var evt = {
                    type: 'trap-removed',
                    slot: slotKey,
                    time: time,
                    locked: locked,
                    stack: stack
                };
                _pushEvent(evt);

                _pendingRemovals[slotKey] = {
                    time: time,
                    stack: stack,
                    locked: locked
                };

                if (!locked) {
                    console.log('[CARD-FLASH] \uD83D\uDFE7 trap-removed @' + slotKey +
                        ' (locked: false)\n  ' + stack);
                }
            }

            // Check additions for .trap-card-back
            for (var k = 0; k < m.addedNodes.length; k++) {
                var added = m.addedNodes[k];
                if (added.nodeType !== 1) continue;
                var isAdded = added.classList && added.classList.contains('trap-card-back');
                if (!isAdded) continue;

                var addEvt = {
                    type: 'trap-added',
                    slot: slotKey,
                    time: time,
                    locked: locked,
                    stack: stack
                };
                _pushEvent(addEvt);

                var pendingTrap = _pendingRemovals[slotKey];
                if (pendingTrap) {
                    var trapDelta = time - pendingTrap.time;
                    if (trapDelta <= FLASH_THRESHOLD_MS) {
                        var trapFlash = {
                            slot: slotKey,
                            uid: null,
                            name: 'TRAP',
                            durationMs: trapDelta,
                            removedAt: pendingTrap.time,
                            readdedAt: time,
                            removeLocked: pendingTrap.locked,
                            addLocked: locked,
                            removeStack: pendingTrap.stack,
                            addStack: stack
                        };
                        _flashes.push(trapFlash);
                        console.warn(
                            '[CARD-FLASH] \u26A1 TRAP FLASH @' + slotKey +
                            ': trap removed then re-added in ' + trapDelta + 'ms' +
                            '\n  removed by: ' + pendingTrap.stack +
                            '\n  re-added by: ' + stack +
                            '\n  removeLocked: ' + pendingTrap.locked + ', addLocked: ' + locked
                        );
                    }
                    delete _pendingRemovals[slotKey];
                }
            }
        }
    }

    // === INITIALISATION ===
    function _init() {
        // Card slots (16)
        var cardSlots = document.querySelectorAll('.card-slot');
        var cardCount = 0;
        cardSlots.forEach(function (slot) {
            var obs = new MutationObserver(function (mutations) {
                _onCardSlotMutation(mutations, slot);
            });
            obs.observe(slot, { childList: true, subtree: false });
            _observers.push(obs);
            cardCount++;
        });

        // Trap slots (8)
        var trapSlots = document.querySelectorAll('.trap-slot');
        var trapCount = 0;
        trapSlots.forEach(function (slot) {
            var trapContent = slot.querySelector('.trap-content');
            if (!trapContent) return;
            var obs = new MutationObserver(function (mutations) {
                _onTrapSlotMutation(mutations, slot);
            });
            obs.observe(trapContent, { childList: true, subtree: false });
            _observers.push(obs);
            trapCount++;
        });

        console.log('[CARD-FLASH-WATCHDOG] Watching ' + cardCount + ' card slots, ' + trapCount + ' trap slots');
    }

    // === API PUBLIQUE ===
    function report() {
        if (_flashes.length === 0) {
            console.log('[CARD-FLASH-WATCHDOG] No flashes detected. Total events: ' + _events.length);
            return [];
        }
        console.warn('[CARD-FLASH-WATCHDOG] ' + _flashes.length + ' flash(es) detected:');
        console.table(_flashes.map(function (f) {
            return {
                slot: f.slot,
                name: f.name,
                duration: f.durationMs + 'ms',
                removeLocked: f.removeLocked,
                addLocked: f.addLocked,
                removedAt: f.removedAt + 'ms',
                removeStack: f.removeStack,
                addStack: f.addStack
            };
        }));
        return _flashes;
    }

    function events(last) {
        var n = last || 50;
        var slice = _events.slice(-n);
        console.table(slice.map(function (e) {
            return {
                type: e.type,
                slot: e.slot,
                name: e.name || '',
                uid: e.uid ? String(e.uid).slice(-8) : '',
                time: e.time + 'ms',
                locked: e.locked,
                stack: e.stack
            };
        }));
        return slice;
    }

    function clear() {
        _events.length = 0;
        _flashes.length = 0;
        _pendingRemovals = {};
        console.log('[CARD-FLASH-WATCHDOG] Cleared');
    }

    function destroy() {
        _observers.forEach(function (obs) { obs.disconnect(); });
        _observers.length = 0;
        console.log('[CARD-FLASH-WATCHDOG] Destroyed');
    }

    // Auto-init quand le DOM est prêt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_init, 500); // Attendre que les slots soient créés
        });
    } else {
        setTimeout(_init, 500);
    }

    return { report: report, events: events, clear: clear, destroy: destroy };
})();
