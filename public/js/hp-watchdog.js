// hp-watchdog.js — Détecte les désynchronisations HP entre DOM et state serveur
// Se déclenche automatiquement après chaque render (pas de timer).
// Active au chargement. Console: HpWatchdog.report() / HpWatchdog.stop()

const HpWatchdog = (() => {
    let _active = true;
    let _mismatches = [];
    let _checkCount = 0;
    let _pendingRaf = 0;

    function _getSlotEl(owner, r, c) {
        if (typeof getSlot === 'function') return getSlot(owner, r, c);
        return document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${r}"][data-col="${c}"]`);
    }

    function _checkField() {
        if (typeof state === 'undefined' || !state) return [];
        const issues = [];
        const now = Date.now();

        const sides = [
            { owner: 'me', stateKey: 'me' },
            { owner: 'opp', stateKey: 'opponent' }
        ];

        for (const { owner, stateKey } of sides) {
            const field = state[stateKey]?.field;
            if (!field) continue;

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const card = field[r]?.[c];
                    if (!card) continue;

                    const slotKey = `${owner}-${r}-${c}`;

                    // Skip si animation en cours sur ce slot
                    if (typeof RenderLock !== 'undefined' && RenderLock.isLocked('slot', slotKey)) continue;

                    // Skip si override HP actif (gelé volontairement par une anim)
                    if (typeof RenderLock !== 'undefined') {
                        const ov = RenderLock.getOverride('slot', slotKey);
                        if (ov && ov.hp !== undefined) continue;
                    }

                    const slotEl = _getSlotEl(owner, r, c);
                    if (!slotEl) continue;

                    const cardEl = slotEl.querySelector('.card');
                    if (!cardEl) continue;

                    // Vérifier uid match
                    const domUid = cardEl.dataset?.uid;
                    if (domUid && card.uid && domUid !== card.uid) {
                        issues.push({
                            type: 'uid_mismatch',
                            slot: slotKey,
                            card: card.name,
                            domUid,
                            stateUid: card.uid
                        });
                        continue;
                    }

                    // Comparer HP
                    const hpEl = cardEl._cHp || (cardEl._cHp = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp'));
                    if (!hpEl) continue;

                    const domHp = parseInt(hpEl.textContent, 10);
                    const stateHp = card.currentHp ?? card.hp;

                    if (!Number.isFinite(domHp)) {
                        issues.push({
                            type: 'dom_hp_nan',
                            slot: slotKey,
                            card: card.name,
                            domText: hpEl.textContent,
                            stateHp
                        });
                        continue;
                    }

                    // Ignorer pendant resolution si HP = 0 (mort en attente d'anim)
                    if (state.phase === 'resolution' && stateHp <= 0) continue;

                    // Ignorer si visual damage marker récent (anim combat en cours)
                    const visualDmgSetAt = parseInt(cardEl.dataset.visualDmgSetAt || '0', 10);
                    if (visualDmgSetAt > 0 && (now - visualDmgSetAt) < 3000) continue;

                    if (domHp !== stateHp) {
                        issues.push({
                            type: 'hp_mismatch',
                            slot: slotKey,
                            card: card.name,
                            uid: card.uid?.slice(-6),
                            domHp,
                            stateHp,
                            diff: domHp - stateHp,
                            phase: state.phase,
                            turn: state.turn
                        });
                    }

                    // Comparer ATK
                    const atkEl = cardEl._cAtk || (cardEl._cAtk = cardEl.querySelector('.arena-atk') || cardEl.querySelector('.img-atk'));
                    if (atkEl && !card.isBuilding) {
                        // Skip si ATK override actif
                        if (typeof RenderLock !== 'undefined') {
                            const ov = RenderLock.getOverride('slot', slotKey);
                            if (ov && ov.atk !== undefined) continue;
                        }
                        const domAtk = parseInt(atkEl.textContent, 10);
                        const stateAtk = card.atk;
                        if (Number.isFinite(domAtk) && domAtk !== stateAtk) {
                            issues.push({
                                type: 'atk_mismatch',
                                slot: slotKey,
                                card: card.name,
                                domAtk,
                                stateAtk
                            });
                        }
                    }
                }
            }
        }

        // Hero HP
        for (const { owner, stateKey } of sides) {
            const heroHp = state[stateKey]?.hp;
            if (heroHp === undefined) continue;

            // Skip si locked (animation héros en cours)
            if (typeof RenderLock !== 'undefined' &&
                (RenderLock.isLocked('heroHp', 'all') || RenderLock.isLocked('heroHp', owner))) continue;

            const hpNum = document.getElementById(`${owner}-hp-num`);
            if (!hpNum) continue;
            const domHp = parseInt(hpNum.textContent, 10);
            const expected = Math.max(0, Math.floor(heroHp));
            if (Number.isFinite(domHp) && domHp !== expected) {
                issues.push({
                    type: 'hero_hp_mismatch',
                    side: owner,
                    domHp,
                    stateHp: expected,
                    diff: domHp - expected
                });
            }
        }

        return issues;
    }

    function _postRenderCheck() {
        if (!_active) return;
        _checkCount++;
        const issues = _checkField();
        if (issues.length === 0) return;

        const ts = new Date().toISOString().slice(11, 23);
        for (const issue of issues) {
            _mismatches.push({ ...issue, at: ts, check: _checkCount });
            if (issue.type === 'hp_mismatch') {
                console.warn(`[HP-WATCHDOG] %c${issue.card}%c @${issue.slot}: DOM=%c${issue.domHp}%c STATE=%c${issue.stateHp}%c (diff ${issue.diff > 0 ? '+' : ''}${issue.diff}) phase=${issue.phase} turn=${issue.turn}`,
                    'font-weight:bold', '', 'color:red;font-weight:bold', '', 'color:green;font-weight:bold', '');
            } else if (issue.type === 'hero_hp_mismatch') {
                console.warn(`[HP-WATCHDOG] %cHERO ${issue.side}%c: DOM=%c${issue.domHp}%c STATE=%c${issue.stateHp}%c (diff ${issue.diff > 0 ? '+' : ''}${issue.diff})`,
                    'font-weight:bold', '', 'color:red;font-weight:bold', '', 'color:green;font-weight:bold', '');
            } else if (issue.type === 'atk_mismatch') {
                console.warn(`[HP-WATCHDOG] ATK %c${issue.card}%c @${issue.slot}: DOM=%c${issue.domAtk}%c STATE=%c${issue.stateAtk}`,
                    'font-weight:bold', '', 'color:red;font-weight:bold', '', 'color:green;font-weight:bold');
            } else if (issue.type === 'dom_hp_nan') {
                console.error(`[HP-WATCHDOG] %c${issue.card}%c @${issue.slot}: DOM HP is "%c${issue.domText}%c" (NaN!) STATE=${issue.stateHp}`,
                    'font-weight:bold', '', 'color:red;font-weight:bold', '');
            } else if (issue.type === 'uid_mismatch') {
                console.error(`[HP-WATCHDOG] @${issue.slot}: DOM uid=${issue.domUid} STATE uid=${issue.stateUid} (${issue.card})`);
            }
        }
    }

    // Demande un check après le prochain frame (debounced)
    function scheduleCheck() {
        if (!_active || _pendingRaf) return;
        _pendingRaf = requestAnimationFrame(() => {
            _pendingRaf = 0;
            // Attend 1 frame de plus pour que le render soit vraiment fini
            requestAnimationFrame(() => _postRenderCheck());
        });
    }

    function stop() {
        _active = false;
        if (_pendingRaf) { cancelAnimationFrame(_pendingRaf); _pendingRaf = 0; }
        console.log(`[HP-WATCHDOG] Stopped. ${_mismatches.length} mismatches in ${_checkCount} checks.`);
    }

    function start() {
        _active = true;
        _mismatches = [];
        _checkCount = 0;
        _hookRender();
        console.log('[HP-WATCHDOG] Started — checks after every render.');
    }

    function report() {
        if (_mismatches.length === 0) {
            console.log('[HP-WATCHDOG] Aucune désync détectée.');
            return [];
        }
        console.table(_mismatches);
        return _mismatches;
    }

    function check() {
        const issues = _checkField();
        if (issues.length === 0) {
            console.log('[HP-WATCHDOG] All HP in sync.');
        } else {
            console.table(issues);
        }
        return issues;
    }

    // ─── Hook les fonctions render/renderDelta pour déclencher un check ───
    let _hooked = false;
    function _hookRender() {
        if (_hooked) return;
        _hooked = true;

        // Monkey-patch render()
        if (typeof render === 'function') {
            const _origRender = render;
            window.render = function() {
                const result = _origRender.apply(this, arguments);
                scheduleCheck();
                return result;
            };
        }

        // Monkey-patch renderDelta()
        if (typeof renderDelta === 'function') {
            const _origRenderDelta = renderDelta;
            window.renderDelta = function() {
                const result = _origRenderDelta.apply(this, arguments);
                scheduleCheck();
                return result;
            };
        }

        // Aussi checker à la fin de chaque animation (quand les locks se libèrent)
        if (typeof RenderLock !== 'undefined') {
            const _origUnlock = RenderLock.unlock;
            RenderLock.unlock = function(zone, key, reason) {
                const result = _origUnlock.call(this, zone, key, reason);
                // Si le slot vient de se débloquer, checker
                if (!RenderLock.isLocked(zone, key)) {
                    scheduleCheck();
                }
                return result;
            };
            const _origUnlockAll = RenderLock.unlockAll;
            RenderLock.unlockAll = function(zone, key) {
                const result = _origUnlockAll.call(this, zone, key);
                scheduleCheck();
                return result;
            };
        }
    }

    // Auto-start quand le script charge
    if (typeof requestAnimationFrame === 'function') {
        // Attendre que le DOM soit prêt
        if (document.readyState === 'complete') {
            _hookRender();
        } else {
            window.addEventListener('load', () => _hookRender());
        }
        console.log('[HP-WATCHDOG] Loaded — auto-hooks render(). Use HpWatchdog.report() to see issues.');
    }

    return { start, stop, report, check, scheduleCheck };
})();
