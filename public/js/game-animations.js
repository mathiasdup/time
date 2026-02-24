// ==================== SYSTÃƒË†ME D'ANIMATIONS DU JEU ====================
// File d'attente, handlers combat/mort/sort/piÃƒÂ¨ge, effets visuels

// === Smooth close du trou dans la main adverse aprÃƒÂ¨s hide d'une carte ===
// Collapse la carte cachÃƒÂ©e (widthÃ¢â€ â€™0, marginÃ¢â€ â€™0) pour que le flexbox ferme le trou naturellement
function smoothCloseOppHandGap(hiddenCard) {
    if (!hiddenCard) return;
    hiddenCard.style.transition = 'width 0.3s ease-out, margin-left 0.3s ease-out';
    hiddenCard.style.width = '0px';
    hiddenCard.style.marginLeft = '0px';
    hiddenCard.style.overflow = 'hidden';
}

// === Mise ÃƒÂ  jour dynamique de la popup cimetiÃƒÂ¨re ===
function addCardToGraveyardPopup(owner, card) {
    const popup = document.getElementById('graveyard-popup');
    if (!popup || !popup.classList.contains('active')) return;
    if (popup.dataset.owner !== owner) return;
    // Ne pas ajouter pendant la sÃƒÂ©lection de rÃƒÂ©animation
    if (popup.classList.contains('selection-mode')) return;

    const container = document.getElementById('graveyard-cards');
    if (!container) return;

    // Retirer le message "vide" si prÃƒÂ©sent
    const emptyMsg = container.querySelector('.graveyard-empty');
    if (emptyMsg) emptyMsg.remove();

    const cardEl = makeCard(card, true);
    cardEl.dataset.uid = card.uid || card.id || '';
    cardEl.classList.add('in-graveyard');
    cardEl.onmouseenter = (e) => showCardPreview(card, e);
    cardEl.onmouseleave = hideCardPreview;
    cardEl.onclick = (e) => {
        e.stopPropagation();
        showCardZoom(card);
    };

    // Animation d'entrÃƒÂ©e
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'translateY(12px) scale(0.92)';
    cardEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    container.appendChild(cardEl);

    const nameEl = cardEl.querySelector('.arena-name');
    if (nameEl) fitArenaName(nameEl);

    // DÃƒÂ©clencher l'animation au frame suivant
    requestAnimationFrame(() => {
        cardEl.style.opacity = '1';
        cardEl.style.transform = 'translateY(0) scale(1)';
    });

    // Auto-scroll vers la nouvelle carte
    setTimeout(() => {
        container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
    }, 50);
}

function removeCardFromGraveyardPopup(owner, card) {
    const popup = document.getElementById('graveyard-popup');
    if (!popup || !popup.classList.contains('active')) return;
    if (popup.dataset.owner !== owner) return;

    const container = document.getElementById('graveyard-cards');
    if (!container) return;

    const cardUid = card.uid || card.id;
    const cards = container.querySelectorAll('.card');
    for (const el of cards) {
        if (el.dataset.uid === cardUid) {
            el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-12px) scale(0.92)';
            setTimeout(() => el.remove(), 300);
            return;
        }
    }
}

// Cache des positions des cartes revealed dans la main adverse (sauvegardÃƒÂ© avant re-render de rÃƒÂ©vÃƒÂ©lation)
const savedRevealedCardRects = new Map();

function saveRevealedCardPositions() {
    savedRevealedCardRects.clear();
    const handPanel = document.getElementById('opp-hand');
    if (!handPanel) return;
    const allCards = handPanel.querySelectorAll('.opp-card-back');
    const revealedCards = handPanel.querySelectorAll('.opp-revealed[data-uid]');
    revealedCards.forEach(el => {
        const uid = el.dataset.uid;
        const rect = el.getBoundingClientRect();
        savedRevealedCardRects.set(uid, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    });
    if (revealedCards.length === 0) {
    }
}

function _queuePreview(limit = 8) {
    if (typeof animationQueue === 'undefined' || !animationQueue) return [];
    return animationQueue.slice(0, limit).map((item) => item?.type || '?');
}

function _perfNowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _queuedWaitMs(data) {
    const queuedAt = Number(data?._queuedAt || 0);
    if (!Number.isFinite(queuedAt) || queuedAt <= 0) return 0;
    return Math.max(0, Date.now() - queuedAt);
}

function _perfRecordBatchQueueWait(list) {
    if (!window.PerfMon || !Array.isArray(list)) return;
    for (const data of list) {
        window.PerfMon.recordAnimationQueueWait(_queuedWaitMs(data), animationQueue.length);
    }
}

function _perfRecordAnimationStep(startMs, itemsProcessed) {
    if (!window.PerfMon) return;
    const dt = _perfNowMs() - Number(startMs || 0);
    window.PerfMon.recordAnimationStep(dt, itemsProcessed);
}

function _clampHeroHpValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
}

function _setHeroHpText(hpElement, value) {
    if (!hpElement) return;
    hpElement.textContent = String(_clampHeroHpValue(value));
}

function _getPixiAnimRoot() {
    const shared = window.__PixiCardOverlayShared;
    if (!shared || !shared.app || !shared.ready || !window.PIXI) return null;
    if (!shared.animRoot) {
        const root = new PIXI.Container();
        root.sortableChildren = true;
        root.zIndex = 80;
        shared.app.stage.addChild(root);
        shared.animRoot = root;
    }
    return shared.animRoot;
}

function _createPixiAnimGhost(card, zIndex = 11000) {
    if (typeof window !== 'undefined' && window.ENABLE_PIXI_ANIM_GHOSTS !== true) return null;
    if (!card || typeof window.createCard !== 'function') return null;
    const root = _getPixiAnimRoot();
    if (!root) return null;

    let view = null;
    try {
        view = window.createCard(card);
    } catch (err) {
        return null;
    }
    if (!view || !view.container) return null;

    view.container.zIndex = zIndex;
    root.addChild(view.container);
    if (typeof view.setHovered === 'function') {
        view.setHovered(false);
    }

    return {
        syncFromElement(el, opts = {}) {
            if (!view || !el || !el.isConnected) return;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 1 || rect.height <= 1) {
                view.container.visible = false;
                return;
            }
            view.container.visible = true;
            view.setLayout({
                x: rect.left + rect.width * 0.5,
                y: rect.top + rect.height * 0.5,
                width: rect.width,
                height: rect.height,
                zIndex: opts.zIndex !== undefined ? Number(opts.zIndex) : zIndex
            });

            if (opts.alpha !== undefined) {
                view.container.alpha = Math.max(0, Math.min(1, Number(opts.alpha) || 0));
            } else {
                view.container.alpha = 1;
            }

            if (view.__display) {
                if (opts.tint !== undefined) {
                    const tint = Number(opts.tint);
                    view.__display.tint = Number.isFinite(tint) ? (tint & 0xffffff) : 0xffffff;
                } else {
                    const g = Math.max(0, Math.min(1, Number(opts.gray) || 0));
                    const v = Math.max(0, Math.min(255, Math.round(255 - g * 95)));
                    const tint = (v << 16) | (v << 8) | v;
                    view.__display.tint = tint;
                }
            }

            view.update(1 / 60);
        },
        destroy() {
            if (!view) return;
            try {
                view.destroy();
            } catch (err) {
                // no-op
            }
            view = null;
        }
    };
}

// Trap warning state: keep orange target glow until trap damage animation ends.
const trapWarningState = {
    active: false,
    waitingDamage: false,
    targetKeys: new Set(),
    clearTimer: null,
};

function _trapWarningKey(playerNum, row, col) {
    const owner = Number(playerNum) === Number(myNum) ? 'me' : 'opp';
    return `${owner}-${Number(row)}-${Number(col)}`;
}

function _clearTrapWarningTimer() {
    if (trapWarningState.clearTimer) {
        clearTimeout(trapWarningState.clearTimer);
        trapWarningState.clearTimer = null;
    }
}

function _setTrapWarningMode(active) {
    const battlefield = document.getElementById('battlefield');
    if (!battlefield) return;
    const next = !!active;
    const prev = battlefield.classList.contains('trap-warning-mode');
    battlefield.classList.toggle('trap-warning-mode', next);
    if (prev !== next && typeof CardGlow !== 'undefined') {
        CardGlow.markDirty();
    }
}

function _clearTrapTargetWarnings(reason = 'manual') {
    _clearTrapWarningTimer();
    _setTrapWarningMode(false);
    document.querySelectorAll('.card-slot .card.spell-hover-target').forEach((el) => {
        el.classList.remove('spell-hover-target');
    });
    if (typeof CardGlow !== 'undefined') CardGlow.markDirty();
    trapWarningState.active = false;
    trapWarningState.waitingDamage = false;
    trapWarningState.targetKeys = new Set();
    if (typeof window.visTrace === 'function') {
        window.visTrace('trap:warning:clear', { reason });
    }
}

function _applyTrapTargetWarnings(targets, options = {}) {
    const waitForDamage = !!options.waitForDamage;
    _clearTrapTargetWarnings('replace');
    if (!Array.isArray(targets) || targets.length === 0) return 0;

    _setTrapWarningMode(true);
    let applied = 0;
    const keys = new Set();
    for (const target of targets) {
        const tPlayer = Number(target?.player);
        const tRow = Number(target?.row);
        const tCol = Number(target?.col);
        if (!Number.isFinite(tPlayer) || !Number.isFinite(tRow) || !Number.isFinite(tCol)) continue;
        if (tRow < 0 || tRow > 3 || tCol < 0 || tCol > 1) continue;
        const owner = tPlayer === myNum ? 'me' : 'opp';
        const slot = getSlot(owner, tRow, tCol);
        const cardEl = slot?.querySelector('.card');
        if (!cardEl) continue;
        cardEl.classList.add('spell-hover-target');
        keys.add(_trapWarningKey(tPlayer, tRow, tCol));
        applied++;
    }

    if (typeof CardGlow !== 'undefined') CardGlow.markDirty();
    trapWarningState.active = applied > 0;
    trapWarningState.waitingDamage = waitForDamage && applied > 0;
    trapWarningState.targetKeys = keys;

    if (trapWarningState.waitingDamage) {
        trapWarningState.clearTimer = setTimeout(() => {
            _clearTrapTargetWarnings('fallback-timeout');
        }, 15000);
    }

    if (typeof window.visTrace === 'function') {
        window.visTrace('trap:warning:targets', {
            count: applied,
            waitForDamage: trapWarningState.waitingDamage,
            targets: targets.map((t) => ({
                player: t?.player ?? null,
                row: t?.row ?? null,
                col: t?.col ?? null,
            })),
        });
    }
    return applied;
}

function _resolveTrapWarningByDamageBatch(batch) {
    if (!trapWarningState.active || !trapWarningState.waitingDamage) return;
    if (!Array.isArray(batch) || batch.length === 0) return;
    const hit = batch.some((d) => {
        const p = Number(d?.player);
        const r = Number(d?.row);
        const c = Number(d?.col);
        if (!Number.isFinite(p) || !Number.isFinite(r) || !Number.isFinite(c)) return false;
        return trapWarningState.targetKeys.has(_trapWarningKey(p, r, c));
    });
    if (hit) {
        _clearTrapTargetWarnings('damage-batch-done');
    }
}

function _releaseTrapWarningOnCombatEnd() {
    if (trapWarningState.active && trapWarningState.waitingDamage) {
        _clearTrapTargetWarnings('combat-end-fallback');
    }
}

// Initialiser le systÃƒÂ¨me d'animation
async function initCombatAnimations() {
    await CombatAnimations.init();
}

function queueAnimation(type, data) {
    if (data && data._queuedAt === undefined) {
        data._queuedAt = Date.now();
    }
    if (typeof window.visTrace === 'function') {
        window.visTrace('animQueue:enqueue:request', {
            type,
            row: data?.row,
            col: data?.col,
            player: data?.player,
            targetPlayer: data?.targetPlayer,
            targetRow: data?.targetRow,
            targetCol: data?.targetCol,
            qLenBefore: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
            isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            queueHead: _queuePreview(),
        });
    }

    // Pour zdejebel et onDeathDamage hÃƒÂ©ros, capturer les HP actuels AVANT que render() ne les mette ÃƒÂ  jour
    if ((type === 'zdejebel' || (type === 'onDeathDamage' && data.targetRow === undefined)) && state) {
        const target = data.targetPlayer === myNum ? 'me' : 'opp';
        const currentDisplayedHp = target === 'me' ? state.me?.hp : state.opponent?.hp;
        data._displayHpBefore = currentDisplayedHp;
    }

    // Pour burn, death, sacrifice, spell, trapTrigger, bloquer le render du cimetiÃƒÂ¨re IMMÃƒâ€°DIATEMENT
    if (type === 'burn' || type === 'death' || type === 'sacrifice' || type === 'spell' || type === 'trapTrigger') {
        const owner = (type === 'spell' ? data.caster : data.player) === myNum ? 'me' : 'opp';
        graveRenderBlocked.add(owner);
    }
    // Pour death/sacrifice, bloquer aussi le slot du terrain pour que render() ne retire pas
    // la carte avant que l'animation ne la prenne en charge
    if ((type === 'death' || type === 'sacrifice') && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // Pour deathTransform, bloquer le slot IMMÃƒâ€°DIATEMENT pour que render() ne remplace pas la carte
    if (type === 'deathTransform') {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // For reanimate/trapSummon, lock target slot immediately
    // to prevent visual flash before queued animation starts.
    if ((type === 'reanimate' || type === 'trapSummon') && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // Pour bounce, bloquer le slot pour que render() ne retire pas la carte
    if (type === 'bounce' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);

        // PrÃƒÂ©-enregistrer pendingBounce au moment du queue (mÃƒÂªme technique que graveyardReturn)
        // pour que render() cache la carte en main AVANT que l'animation ne dÃƒÂ©marre.
        // Sans ÃƒÂ§a, dans les parties longues avec beaucoup d'animations dans la queue,
        // le state arrive et render() montre la carte en main avant que bounce ne dÃƒÂ©marre.
        if (!data.toGraveyard && !pendingBounce) {
            const handPanel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
            const startHandCount = handPanel
                ? handPanel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back').length
                : 0;
            data._bounceTargetPromise = new Promise(resolve => {
                pendingBounce = {
                    owner,
                    card: data.card,
                    resolveTarget: resolve,
                    startHandCount,
                    queued: true
                };
            });
        }
    }

    // Pour onDeathDamage crÃƒÂ©ature (Torche vivante), bloquer le slot pour que render()
    // ne retire pas la carte avant que l'animation de dÃƒÂ©gÃƒÂ¢ts ne joue
    if (type === 'onDeathDamage' && data.targetRow !== undefined && data.targetCol !== undefined) {
        const owner = data.targetPlayer === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.add(slotKey);
    }

    // Pour lifesteal, capturer les HP ACTUELS (avant le heal) ET bloquer le slot immÃƒÂ©diatement
    // pour que render() ne puisse pas mettre ÃƒÂ  jour les HP avec le state soignÃƒÂ© avant l'animation
    if (type === 'lifesteal' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
        const side = owner === 'me' ? 'me' : 'opponent';
        const card = state?.[side]?.field?.[data.row]?.[data.col];
        if (card) {
            data._preHealHp = card.currentHp;
            data._preHealMax = card.hp;
            data._preHealAtk = card.atk;
        }
        // Pour heroHeal (lifelink), capturer les HP du hÃƒÂ©ros et bloquer render()
        if (data.heroHeal) {
            const hpEl = document.querySelector(`#${owner === 'me' ? 'me' : 'opp'}-hp .hero-hp-number`);
            data._preHeroHp = hpEl ? parseInt(hpEl.textContent) : undefined;
            lifestealHeroHealInProgress = true;
        }
    }

    // Pour heroHeal (hors lifesteal), capturer aussi les HP hÃƒÂ©ros affichÃƒÂ©s
    if (type === 'heroHeal' && data.player !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const hpEl = document.querySelector(`#${owner === 'me' ? 'me' : 'opp'}-hp .hero-hp-number`);
        data._preHeroHp = hpEl ? parseInt(hpEl.textContent) : undefined;
        lifestealHeroHealInProgress = true;
        if (window.DEBUG_LOGS) console.log(`[EREBETH-DBG] queue heroHeal owner=${owner} amount=${data.amount} preHeroHp=${data._preHeroHp}`);
    }

    // Pour regen, capturer les HP ACTUELS (avant le heal) Ã¢â‚¬â€ mÃƒÂªme technique que lifesteal
    if (type === 'regen' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const side = owner === 'me' ? 'me' : 'opponent';
        const card = state?.[side]?.field?.[data.row]?.[data.col];
        if (card) {
            data._preHealHp = card.currentHp;
            data._preHealMax = card.hp;
            data._preHealAtk = card.atk;
        }
    }

    // Pour graveyardReturn, prÃƒÂ©-enregistrer pendingBounce au moment du queue
    // pour que render() cache la carte AVANT que l'animation ne commence ÃƒÂ  jouer
    // (sinon la carte flash visible entre l'arrivÃƒÂ©e du state et le dÃƒÂ©but de l'animation)
    if (type === 'graveyardReturn' && data.player !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        if (!pendingBounce) {
            const handPanel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
            const startHandCount = handPanel
                ? handPanel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back').length
                : 0;
            data._bounceTargetPromise = new Promise(resolve => {
                pendingBounce = {
                    owner,
                    card: data.card,
                    resolveTarget: resolve,
                    startHandCount,
                    queued: true
                };
            });
        }
    }

    // Pour healOnDeath, capturer les HP ACTUELS (avant le heal) Ã¢â‚¬â€ mÃƒÂªme technique que lifesteal
    if (type === 'healOnDeath' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const side = owner === 'me' ? 'me' : 'opponent';
        const card = state?.[side]?.field?.[data.row]?.[data.col];
        if (card) {
            data._preHealHp = card.currentHp;
            data._preHealMax = card.hp;
            data._preHealAtk = card.atk;
        }
    }

    // Pour damage/spellDamage, bloquer le slot pour que render() ne mette pas ÃƒÂ  jour
    // les stats (HP, ATK via Puissance) avant que l'animation de dÃƒÂ©gÃƒÂ¢ts ne joue
    if ((type === 'damage' || type === 'spellDamage' || type === 'poisonDamage') && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
        const side = owner === 'me' ? 'me' : 'opponent';
        const preCard = state?.[side]?.field?.[data.row]?.[data.col];
        data._preHp = preCard?.currentHp;
        data._preMaxHp = preCard?.hp;
        if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] queue ${type} owner=${owner} slot=${data.row},${data.col} amount=${data.amount ?? '-'} preHp=${data._preHp ?? '-'} preMaxHp=${data._preMaxHp ?? '-'} card=${preCard?.name || '-'}`);
    }

    // Pour attack, bloquer le(s) slot(s) de l'attaquant pour que render() ne recrÃƒÂ©e pas
    // l'ÃƒÂ©lÃƒÂ©ment DOM pendant l'animation de charge/retour
    if (type === 'attack') {
        const blockedSlots = new Set();
        const addSlot = (owner, row, col) => {
            if (row === undefined || col === undefined || col === -1) return;
            blockedSlots.add(`${owner}-${row}-${col}`);
        };
        if (data.combatType === 'parallel_attacks') {
            if (data.attack1) {
                const o = data.attack1.attacker === myNum ? 'me' : 'opp';
                addSlot(o, data.attack1.row, data.attack1.col);
                const to = data.attack1.targetPlayer === myNum ? 'me' : 'opp';
                addSlot(to, data.attack1.targetRow, data.attack1.targetCol);
            }
            if (data.attack2) {
                const o = data.attack2.attacker === myNum ? 'me' : 'opp';
                addSlot(o, data.attack2.row, data.attack2.col);
                const to = data.attack2.targetPlayer === myNum ? 'me' : 'opp';
                addSlot(to, data.attack2.targetRow, data.attack2.targetCol);
            }
        } else if (data.combatType === 'mutual_shooters') {
            addSlot(data.attacker1 === myNum ? 'me' : 'opp', data.row1, data.col1);
            addSlot(data.attacker2 === myNum ? 'me' : 'opp', data.row2, data.col2);
        } else {
            // solo, shooter, mutual_melee, shooter_vs_flyer
            const o = data.attacker === myNum ? 'me' : 'opp';
            addSlot(o, data.row, data.col);
            // Bloquer aussi la cible pour ÃƒÂ©viter l'update HP avant l'impact visuel.
            const to = data.targetPlayer === myNum ? 'me' : 'opp';
            addSlot(to, data.targetRow, data.targetCol);
        }
        data._attackerSlots = Array.from(blockedSlots);
        for (const sk of data._attackerSlots) {
            animatingSlots.add(sk);
        }
    }

    // Keep combat readability: play queued damage/poison/spellDamage before later combat actions.
    // This avoids visuals where a later attacker moves before damage is shown.
    let insertAt = animationQueue.length;
    if ((type === 'damage' || type === 'spellDamage' || type === 'poisonDamage') && data && data.row !== undefined) {
        if (type === 'spellDamage') {
            // Visual priority: spell damage should not drift after combatEnd/phaseMessage
            // or behind future combat rows.
            const firstBarrierIdx = animationQueue.findIndex((item) => {
                if (!item) return false;
                return (
                    item.type === 'combatRowStart' ||
                    item.type === 'attack' ||
                    item.type === 'combatEnd' ||
                    item.type === 'phaseMessage'
                );
            });
            if (firstBarrierIdx >= 0) {
                insertAt = firstBarrierIdx;
            }

            // Preserve ordering with already queued direct damages before the barrier.
            for (let i = 0; i < animationQueue.length; i++) {
                const item = animationQueue[i];
                if (!item) continue;
                if (item.type !== 'damage' && item.type !== 'spellDamage') continue;
                const sameSlot =
                    Number(item.data?.player) === Number(data.player) &&
                    Number(item.data?.row) === Number(data.row) &&
                    Number(item.data?.col) === Number(data.col);
                if (!sameSlot) continue;
                if (firstBarrierIdx >= 0 && i >= firstBarrierIdx) break;
                insertAt = Math.max(insertAt, i + 1);
            }
        } else if (type === 'poisonDamage') {
            const firstQueuedCombatIdx = animationQueue.findIndex((item) => {
                if (!item) return false;
                if (item.type !== 'combatRowStart' && item.type !== 'attack') return false;
                return true;
            });
            if (firstQueuedCombatIdx >= 0) {
                insertAt = firstQueuedCombatIdx;
            }
        } else {
            const row = Number(data.row);
            const firstFutureCombatIdx = animationQueue.findIndex((item) => {
                if (!item) return false;
                if (item.type !== 'combatRowStart' && item.type !== 'attack') return false;
                const itemRow = Number(item.data?.row);
                return Number.isFinite(itemRow) && itemRow !== row;
            });
            if (firstFutureCombatIdx > 0) {
                insertAt = firstFutureCombatIdx;
            }
        }

        // If direct damage/attack for the same slot is already queued, keep poison after it.
        if (type === 'poisonDamage' && data.col !== undefined) {
            const owner = data.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${data.row}-${data.col}`;

            // If an attack involving this exact slot is still queued, keep poison after it.
            // This preserves "attack impact first, poison after" for the same combat.
            let relatedAttackIdx = -1;
            const _isSameSlot = (player, row, col) =>
                Number(player) === Number(data.player) &&
                Number(row) === Number(data.row) &&
                Number(col) === Number(data.col);
            for (let i = 0; i < animationQueue.length; i++) {
                const item = animationQueue[i];
                if (!item || item.type !== 'attack' || !item.data) continue;
                const sameAttacker = _isSameSlot(item.data.attacker, item.data.row, item.data.col);
                const sameTarget = _isSameSlot(item.data.targetPlayer, item.data.targetRow, item.data.targetCol);
                const subAttacks = [item.data.attack1, item.data.attack2].filter(Boolean);
                const sameInParallel = subAttacks.some((a) =>
                    _isSameSlot(a.attacker, a.row, a.col) ||
                    _isSameSlot(a.targetPlayer, a.targetRow, a.targetCol)
                );
                if (sameAttacker || sameTarget || sameInParallel) {
                    relatedAttackIdx = i;
                }
            }
            if (relatedAttackIdx >= 0) {
                let relatedTail = relatedAttackIdx;
                while (relatedTail + 1 < animationQueue.length) {
                    const next = animationQueue[relatedTail + 1];
                    if (!next) break;
                    if (
                        next.type === 'heroHit' ||
                        next.type === 'trampleHeroHit' ||
                        next.type === 'damage' ||
                        next.type === 'spellDamage' ||
                        next.type === 'onDeathDamage'
                    ) {
                        relatedTail++;
                        continue;
                    }
                    break;
                }
                insertAt = Math.max(insertAt, relatedTail + 1);
            }

            for (let i = 0; i < animationQueue.length; i++) {
                const item = animationQueue[i];
                if (!item || item.type !== 'damage' || !item.data) continue;
                const dmgOwner = item.data.player === myNum ? 'me' : 'opp';
                const dmgSlotKey = `${dmgOwner}-${item.data.row}-${item.data.col}`;
                if (dmgSlotKey === slotKey) {
                    insertAt = Math.max(insertAt, i + 1);
                }
            }
        }
    }

    animationQueue.splice(insertAt, 0, { type, data });
    if (typeof window.visTrace === 'function') {
        window.visTrace('animQueue:enqueue:done', {
            type,
            insertedAt: insertAt,
            qLenAfter: animationQueue.length,
            isAnimating: !!isAnimating,
            queueHead: _queuePreview(),
        });
    }
    if (window.PerfMon) window.PerfMon.recordAnimationQueue(animationQueue.length);
    // Soupape de sÃƒÂ©curitÃƒÂ© : si la queue dÃƒÂ©passe 100, vider les animations non-critiques
    if (animationQueue.length > 100) {
        const critical = new Set(['death', 'deathTransform', 'heroHit', 'zdejebel', 'trampleHeroHit']);
        for (let i = animationQueue.length - 1; i >= 0; i--) {
            if (!critical.has(animationQueue[i].type)) {
                const purged = animationQueue[i];
                // Nettoyer animatingSlots et graveRenderBlocked pour les animations purgÃƒÂ©es
                if (purged.data?.row !== undefined && purged.data?.col !== undefined) {
                    const pOwner = purged.data.player === myNum ? 'me' : 'opp';
                    animatingSlots.delete(`${pOwner}-${purged.data.row}-${purged.data.col}`);
                }
                if (purged.type === 'burn' || purged.type === 'death' || purged.type === 'sacrifice' || purged.type === 'spell' || purged.type === 'trapTrigger') {
                    const gOwner = (purged.type === 'spell' ? purged.data.caster : purged.data.player) === myNum ? 'me' : 'opp';
                    graveRenderBlocked.delete(gOwner);
                }
                animationQueue.splice(i, 1);
                if (typeof window.visTrace === 'function') {
                    window.visTrace('animQueue:purge', {
                        purgedType: purged.type,
                        qLenNow: animationQueue.length,
                    });
                }
            }
        }
    }
    if (!isAnimating) {
        // Pour les types batchables (burn, death), diffÃƒÂ©rer le dÃƒÂ©marrage
        // pour laisser les events du mÃƒÂªme batch serveur arriver
        if (type === 'burn' || type === 'death' || type === 'deathTransform' || type === 'sacrifice' || type === 'poisonDamage' || type === 'heroHeal') {
            if (!queueAnimation._batchTimeout) {
                queueAnimation._batchTimeout = setTimeout(() => {
                    queueAnimation._batchTimeout = null;
                    if (!isAnimating && animationQueue.length > 0) {
                        processAnimationQueue();
                    }
                }, 50);
            }
        } else {
            processAnimationQueue();
        }
    } else {
    }
}

async function processAnimationQueue(processorId = null) {
    // GÃƒÂ©nÃƒÂ©rer un ID unique pour ce processeur
    if (processorId === null) {
        currentProcessorId++;
        processorId = currentProcessorId;
        if (typeof window.visTrace === 'function') {
            window.visTrace('animQueue:processor:new', {
                processorId,
                qLen: animationQueue.length,
                queueHead: _queuePreview(),
            });
        }
    }

    try {
        // VÃƒÂ©rifier si un autre processeur a pris le relais
        if (processorId !== currentProcessorId) {
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:processor:stale', {
                    processorId,
                    currentProcessorId,
                    qLen: animationQueue.length,
                });
            }
            return;
        }

        if (animationQueue.length === 0) {
            isAnimating = false;
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:empty', {
                    processorId,
                    qLen: animationQueue.length,
                });
            }
            // Lancer les animations de pioche en attente (bloquÃƒÂ©es pendant les combats)
            if (typeof GameAnimations !== 'undefined') {
                GameAnimations.startPendingDrawAnimations();
            }
            return;
        }

        isAnimating = true;
        if (typeof window.visTrace === 'function') {
            window.visTrace('animQueue:tick', {
                processorId,
                qLen: animationQueue.length,
                queueHead: _queuePreview(),
            });
        }

        // Regrouper les animations de mort et transformation consÃƒÂ©cutives (jouÃƒÂ©es en parallÃƒÂ¨le)
        if (animationQueue[0].type === 'death' || animationQueue[0].type === 'deathTransform') {
            const deathBatch = [];
            const transformBatch = [];
            while (animationQueue.length > 0 && (animationQueue[0].type === 'death' || animationQueue[0].type === 'deathTransform')) {
                const item = animationQueue.shift();
                if (item.type === 'death') {
                    deathBatch.push(item.data);
                } else {
                    transformBatch.push(item.data);
                }
            }
            const allPromises = [
                ...deathBatch.map(data => animateDeathToGraveyard(data)),
                ...transformBatch.map(data => animateDeathTransform(data))
            ];
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:death', {
                    processorId,
                    deathCount: deathBatch.length,
                    transformCount: transformBatch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(deathBatch);
            _perfRecordBatchQueueWait(transformBatch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(allPromises);
            _perfRecordAnimationStep(_perfStepStart, deathBatch.length + transformBatch.length);
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.death));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations zdejebel consÃƒÂ©cutives (jouÃƒÂ©es en parallÃƒÂ¨le)
        if (animationQueue[0].type === 'zdejebel') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'zdejebel') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:zdejebel', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => animateZdejebelDamage(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            processAnimationQueue(processorId);
            return;
        }

        // Jouer les animations de burn consÃƒÂ©cutives une par une (sÃƒÂ©quentiellement)
        if (animationQueue[0].type === 'burn') {
            const burnBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'burn') {
                burnBatch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:burn', {
                    processorId,
                    count: burnBatch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(burnBatch);
            const _perfStepStart = _perfNowMs();
            for (const data of burnBatch) {
                await animateBurn(data);
            }
            _perfRecordAnimationStep(_perfStepStart, burnBatch.length);
            processAnimationQueue(processorId);
            return;
        }

        if (animationQueue[0].type === 'damage') {
            const damageBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'damage') {
                damageBatch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:damage', {
                    processorId,
                    count: damageBatch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(damageBatch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(damageBatch.map((data) => handlePixiDamage(data)));
            _perfRecordAnimationStep(_perfStepStart, damageBatch.length);
            for (const d of damageBatch) {
                const dmgOwner = d.player === myNum ? 'me' : 'opp';
                const dmgSlotKey = `${dmgOwner}-${d.row}-${d.col}`;
                const hasPendingDeath = animationQueue.some(item =>
                    item.type === 'death' && item.data &&
                    (item.data.player === myNum ? 'me' : 'opp') === dmgOwner &&
                    item.data.row === d.row && item.data.col === d.col
                );
                if (!hasPendingDeath) {
                    animatingSlots.delete(dmgSlotKey);
                }
            }
            render();
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.damage));
            _resolveTrapWarningByDamageBatch(damageBatch);
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations de dÃƒÂ©gÃƒÂ¢ts de sort consÃƒÂ©cutives en batch
        if (animationQueue[0].type === 'spellDamage') {
            const spellDamageBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'spellDamage') {
                spellDamageBatch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:spellDamage', {
                    processorId,
                    count: spellDamageBatch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(spellDamageBatch);
            const _perfStepStart = _perfNowMs();
            const promises = spellDamageBatch.map(data => {
                const owner = data.player === myNum ? 'me' : 'opp';
                return CombatAnimations.animateSpellDamage({
                    owner: owner,
                    row: data.row,
                    col: data.col,
                    amount: data.amount
                });
            });
            await Promise.all(promises);
            _perfRecordAnimationStep(_perfStepStart, spellDamageBatch.length);
            // DÃƒÂ©bloquer les slots de dÃƒÂ©gÃƒÂ¢ts de sort aprÃƒÂ¨s les animations
            // SAUF si une animation de mort est en attente pour ce slot
            for (const d of spellDamageBatch) {
                const sdOwner = d.player === myNum ? 'me' : 'opp';
                const sdSlotKey = `${sdOwner}-${d.row}-${d.col}`;
                const hasPendingDeath = animationQueue.some(item =>
                    item.type === 'death' && item.data &&
                    (item.data.player === myNum ? 'me' : 'opp') === sdOwner &&
                    item.data.row === d.row && item.data.col === d.col
                );
                if (!hasPendingDeath) {
                    animatingSlots.delete(sdSlotKey);
                }
            }
            render(); // Mettre ÃƒÂ  jour les stats visuellement aprÃƒÂ¨s dÃƒÂ©blocage des slots
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.damage));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations poisonDamage consÃƒÂ©cutives (jouÃƒÂ©es en parallÃƒÂ¨le)
        if (animationQueue[0].type === 'poisonDamage') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'poisonDamage') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:poisonDamage', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handlePoisonDamage(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations onDeathDamage consÃƒÂ©cutives (jouÃƒÂ©es en parallÃƒÂ¨le)
        if (animationQueue[0].type === 'onDeathDamage') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'onDeathDamage') {
                batch.push(animationQueue.shift().data);
            }
            // Bloquer le render HP pour toute la durÃƒÂ©e du batch
            const hasHeroTarget = batch.some(d => d.targetRow === undefined);
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:onDeathDamage', {
                    processorId,
                    count: batch.length,
                    hasHeroTarget,
                    qLenAfterShift: animationQueue.length,
                });
            }
            if (hasHeroTarget) {
                zdejebelAnimationInProgress = true;
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handleOnDeathDamage(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            // DÃƒÂ©bloquer aprÃƒÂ¨s TOUTES les animations
            if (hasHeroTarget) {
                zdejebelAnimationInProgress = false;
            }
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les heroHeal consecutifs (Erebeth etc.) pour les jouer en parallele
        if (animationQueue[0].type === 'heroHeal') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'heroHeal') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:heroHeal', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handleHeroHealAnim(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            lifestealHeroHealInProgress = false;
            render();
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les lifesteal consecutifs pour eviter les micro-decalages.
        if (animationQueue[0].type === 'lifesteal') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'lifesteal') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:lifesteal', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handleLifestealAnim(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            lifestealHeroHealInProgress = false;
            render();
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les regen consecutifs pour affichage simultane.
        if (animationQueue[0].type === 'regen') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'regen') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:regen', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handleRegenAnim(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            render();
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les powerBuff consecutifs pour affichage simultane.
        if (animationQueue[0].type === 'powerBuff') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'powerBuff') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:powerBuff', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handlePowerBuff(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            render();
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper healOnDeath consecutifs pour effets simultanes.
        if (animationQueue[0].type === 'healOnDeath') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'healOnDeath') {
                batch.push(animationQueue.shift().data);
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:batch:healOnDeath', {
                    processorId,
                    count: batch.length,
                    qLenAfterShift: animationQueue.length,
                });
            }
            _perfRecordBatchQueueWait(batch);
            const _perfStepStart = _perfNowMs();
            await Promise.all(batch.map(data => handleHealOnDeathAnim(data)));
            _perfRecordAnimationStep(_perfStepStart, batch.length);
            render();
            processAnimationQueue(processorId);
            return;
        }

        const { type, data } = animationQueue.shift();
        const delay = ANIMATION_DELAYS[type] || ANIMATION_DELAYS.default;
        if (typeof window !== 'undefined') {
            window.__activeAnimType = type;
            window.__activeAnimData = data || null;
        }
        if (typeof window.visTrace === 'function') {
            window.visTrace('animQueue:dequeue', {
                processorId,
                type,
                delay,
                qLenAfterShift: animationQueue.length,
                queueHead: _queuePreview(),
            });
        }

        if (window.PerfMon) {
            window.PerfMon.recordAnimationQueueWait(_queuedWaitMs(data), animationQueue.length);
        }
        const _perfStepStart = _perfNowMs();

        // ExÃƒÂ©cuter l'animation avec timeout de sÃƒÂ©curitÃƒÂ©
        try {
            const animationPromise = executeAnimationAsync(type, data);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Animation timeout: ${type}`)), 5000)
            );
            await Promise.race([animationPromise, timeoutPromise]);
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:done', {
                    processorId,
                    type,
                    qLen: animationQueue.length,
                });
            }
        } catch (e) {
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:error', {
                    processorId,
                    type,
                    error: String(e && e.message ? e.message : e),
                    qLen: animationQueue.length,
                });
            }
        } finally {
            _perfRecordAnimationStep(_perfStepStart, 1);
            if (typeof window !== 'undefined') {
                window.__activeAnimType = null;
                window.__activeAnimData = null;
            }
        }

        // DÃƒÂ©bloquer les slots d'attaquant aprÃƒÂ¨s l'animation d'attaque
        // SAUF si une animation de damage/death est en attente pour ce slot
        if (type === 'attack' && data._attackerSlots) {
            for (const sk of data._attackerSlots) {
                const hasPending = animationQueue.some(item =>
                    (item.type === 'damage' || item.type === 'death' || item.type === 'spellDamage') && item.data &&
                    `${(item.data.player === myNum ? 'me' : 'opp')}-${item.data.row}-${item.data.col}` === sk
                );
                if (window.DEBUG_LOGS) console.log(`[POISON-HP] post-attack slot=${sk} hasPending=${hasPending} animatingSlots.has=${animatingSlots.has(sk)} poisonOv=${!!poisonHpOverrides.get(sk)} queue=[${animationQueue.map(i=>i.type).join(',')}]`);
                if (!hasPending) {
                    animatingSlots.delete(sk);
                } else {
                }
            }
            render(); // Mettre ÃƒÂ  jour les stats visuellement aprÃƒÂ¨s l'attaque (dÃƒÂ©gÃƒÂ¢ts mutuels simultanÃƒÂ©s)
        }

        // DÃƒÂ©bloquer les slots de dÃƒÂ©gÃƒÂ¢ts aprÃƒÂ¨s l'animation
        // SAUF si une animation de mort est en attente pour ce slot (elle a besoin de la carte dans le DOM)
        if (type === 'damage' || type === 'spellDamage') {
            const dmgOwner = data.player === myNum ? 'me' : 'opp';
            const dmgSlotKey = `${dmgOwner}-${data.row}-${data.col}`;
            // Garder le slot bloquÃƒÂ© si death en attente (lifesteal n'a plus besoin de bloquer)
            const hasPendingBlock = animationQueue.some(item =>
                item.type === 'death' && item.data &&
                (item.data.player === myNum ? 'me' : 'opp') === dmgOwner &&
                item.data.row === data.row && item.data.col === data.col
            );
            if (!hasPendingBlock) {
                animatingSlots.delete(dmgSlotKey);
                render(); // Mettre ÃƒÂ  jour les stats visuellement aprÃƒÂ¨s dÃƒÂ©blocage du slot
            } else {
            }
        }

        // DÃƒÂ©bloquer le slot aprÃƒÂ¨s l'animation lifesteal et mettre ÃƒÂ  jour le rendu
        if (type === 'lifesteal') {
            const lsOwner = data.player === myNum ? 'me' : 'opp';
            const lsSlotKey = `${lsOwner}-${data.row}-${data.col}`;
            animatingSlots.delete(lsSlotKey);
            render();
        }

        // DÃƒÂ©bloquer le slot aprÃƒÂ¨s l'animation healOnDeath et mettre ÃƒÂ  jour le rendu
        if (type === 'healOnDeath') {
            const hodOwner = data.player === myNum ? 'me' : 'opp';
            const hodSlotKey = `${hodOwner}-${data.row}-${data.col}`;
            animatingSlots.delete(hodSlotKey);
            render();
        }

        // DÃƒÂ©bloquer le slot aprÃƒÂ¨s l'animation regen et mettre ÃƒÂ  jour le rendu
        if (type === 'regen') {
            const regenOwner = data.player === myNum ? 'me' : 'opp';
            const regenSlotKey = `${regenOwner}-${data.row}-${data.col}`;
            animatingSlots.delete(regenSlotKey);
            render();
        }

        if (type === 'heroHeal') {
            lifestealHeroHealInProgress = false;
            render();
        }

        // AprÃƒÂ¨s powerBuff, forcer render() pour synchroniser l'ATK depuis l'ÃƒÂ©tat serveur
        if (type === 'powerBuff') {
            render();
        }

        if (type === 'combatEnd') {
            _releaseTrapWarningOnCombatEnd();
        }

        // VÃƒÂ©rifier encore si on est toujours le processeur actif
        if (processorId !== currentProcessorId) {
            if (typeof window.visTrace === 'function') {
                window.visTrace('animQueue:processor:replaced', {
                    processorId,
                    currentProcessorId,
                    qLen: animationQueue.length,
                });
            }
            return;
        }

        // summon/move/trapPlace gÃƒÂ¨rent dÃƒÂ©jÃƒÂ  leur propre timing interne.
        const usesInternalTiming = type === 'summon' || type === 'move' || type === 'trapPlace';
        if (!usesInternalTiming) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Continuer la file (avec le mÃƒÂªme processorId)
        processAnimationQueue(processorId);
    } catch (globalError) {
        isAnimating = false;
        if (typeof window.visTrace === 'function') {
            window.visTrace('animQueue:fatal', {
                processorId,
                error: String(globalError && globalError.message ? globalError.message : globalError),
                qLen: animationQueue.length,
            });
        }
        if (animationQueue.length > 0) {
            setTimeout(() => processAnimationQueue(), 100);
        }
    }
}

async function executeAnimationAsync(type, data) {
    if (typeof window.visTrace === 'function') {
        window.visTrace('animExec:start', {
            type,
            row: data?.row,
            col: data?.col,
            player: data?.player,
            targetPlayer: data?.targetPlayer,
            targetRow: data?.targetRow,
            targetCol: data?.targetCol,
        });
    }
    switch(type) {
        case 'attack':
            await handlePixiAttack(data);
            break;
        case 'damage':
            await handlePixiDamage(data);
            break;
        case 'spellDamage':
            await handlePixiSpellDamage(data);
            break;
        case 'heroHit':
            await handlePixiHeroHit(data);
            break;
        case 'onDeathDamage':
            await handleOnDeathDamage(data);
            break;
        case 'zdejebel':
            await animateZdejebelDamage(data);
            break;
        case 'poisonDamage':
            await handlePoisonDamage(data);
            break;
        case 'poisonApply': {
            const paOwner = data.player === myNum ? 'me' : 'opp';
            const paSlot = getSlot(paOwner, data.row, data.col);
            if (paSlot) {
                const rect = paSlot.getBoundingClientRect();
                CombatVFX.createPoisonCloudEffect(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                    rect.width, rect.height
                );
            }
            await new Promise(r => setTimeout(r, 600));
            break;
        }
        case 'death':
            await animateDeathToGraveyard(data);
            break;
        case 'sacrifice':
            await animateSacrifice(data);
            break;
        case 'deathTransform':
            await animateDeathTransform(data);
            break;
        case 'discard':
            await animateDiscard(data);
            break;
        case 'burn':
            await animateBurn(data);
            break;
        case 'spell':
            await animateSpell(data);
            break;
        case 'trapTrigger':
            await animateTrap(data);
            break;
        case 'trapSummon':
            await animateTrapSummon(data);
            break;
        case 'reanimate':
            await animateReanimate(data);
            break;
        case 'trampleDamage':
            await animateTrampleDamage(data);
            break;
        case 'trampleHeroHit':
            await animateTrampleHeroHit(data);
            break;
        case 'bounce':
            await animateBounceToHand(data);
            break;
        case 'graveyardReturn':
            await animateGraveyardReturn(data);
            break;
        case 'lifesteal':
            await handleLifestealAnim(data);
            break;
        case 'healOnDeath':
            await handleHealOnDeathAnim(data);
            break;
        case 'regen':
            await handleRegenAnim(data);
            break;
        case 'buildingActivate':
            await handleBuildingActivate(data);
            break;
        case 'heroHeal':
            await handleHeroHealAnim(data);
            break;
        case 'combatRowStart':
            // Retirer le glow violet de toutes les cartes prÃƒÂ©cÃƒÂ©dentes
            document.querySelectorAll('.card[data-in-combat="true"]').forEach(c => {
                c.dataset.inCombat = 'false';
            });
            // Marquer uniquement les cartes qui vont combattre
            if (data.activeSlots) {
                for (const s of data.activeSlots) {
                    const owner = s.player === myNum ? 'me' : 'opp';
                    const slot = getSlot(owner, data.row, s.col);
                    const card = slot?.querySelector('.card');
                    if (card) card.dataset.inCombat = 'true';
                }
            }
            CardGlow.markDirty();
            // Laisser le glow apparaÃƒÂ®tre avant l'animation suivante
            await new Promise(r => setTimeout(r, 50));
            break;
        case 'combatEnd':
            document.querySelectorAll('.card[data-in-combat="true"]').forEach(c => {
                c.dataset.inCombat = 'false';
            });
            CardGlow.markDirty();
            break;
        case 'powerBuff':
            await handlePowerBuff(data);
            break;
        case 'summon':
            await animateSummon(data);
            break;
        case 'move':
            await animateMove(data);
            break;
        case 'trapPlace':
            await animateTrapPlace(data);
            break;
        case 'phaseMessage':
            showPhaseMessage(data.text, data.type);
            break;
    }
    if (typeof window.visTrace === 'function') {
        window.visTrace('animExec:end', {
            type,
            qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
            isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
        });
    }
}

// ==================== POWER BUFF (+X ATK) ====================
async function handlePowerBuff(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    if (!cardEl) {
        powerBuffAtkOverrides.delete(slotKey);
        return;
    }

    const atkEl = cardEl.querySelector('.arena-atk') || cardEl.querySelector('.img-atk');
    const fromAtk = data.fromAtk;
    const toAtk = fromAtk + data.amount;

    // VFX vert
    const rect = slot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    CombatVFX.createBuffEffect(cx, cy, data.amount, 0, rect.width, rect.height);

    // Animer le chiffre ATK de fromAtk Ã¢â€ â€™ toAtk
    if (atkEl) {
        atkEl.textContent = String(fromAtk);
        atkEl.classList.add('boosted');
        await new Promise(r => setTimeout(r, 400));
        atkEl.textContent = String(toAtk);
    }

    // DÃƒÂ©bloquer le render ATK pour ce slot
    powerBuffAtkOverrides.delete(slotKey);

    await new Promise(r => setTimeout(r, 400));
}

async function handlePixiAttack(data) {
    const attackerOwner = data.attacker === myNum ? 'me' : 'opp';
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const attackEventTs = data._queuedAt;

    // Cas spÃƒÂ©cial : Tireur vs Volant (simultanÃƒÂ© - projectile touche le volant en mouvement)
    if (data.combatType === 'shooter_vs_flyer') {
        await CombatAnimations.animateShooterVsFlyer({
            shooter: { owner: attackerOwner, row: data.row, col: data.col },
            flyer: { owner: targetOwner, row: data.targetRow, col: data.targetCol },
            shooterDamage: data.shooterDamage,
            flyerDamage: data.flyerDamage,
            attackEventTs
        });
        return;
    }

    // Attaques parallÃƒÂ¨les : deux crÃƒÂ©atures attaquent des cibles diffÃƒÂ©rentes en mÃƒÂªme temps
    if (data.combatType === 'parallel_attacks') {
        const attack1Owner = data.attack1.attacker === myNum ? 'me' : 'opp';
        const attack1TargetOwner = data.attack1.targetPlayer === myNum ? 'me' : 'opp';
        const attack2Owner = data.attack2.attacker === myNum ? 'me' : 'opp';
        const attack2TargetOwner = data.attack2.targetPlayer === myNum ? 'me' : 'opp';

        await CombatAnimations.animateParallelAttacks({
            attack1: {
                attackerOwner: attack1Owner,
                attackerRow: data.attack1.row,
                attackerCol: data.attack1.col,
                targetOwner: attack1TargetOwner,
                targetRow: data.attack1.targetRow,
                targetCol: data.attack1.targetCol,
                damage: data.attack1.damage,
                isShooter: data.attack1.isShooter,
                attackEventTs
            },
            attack2: {
                attackerOwner: attack2Owner,
                attackerRow: data.attack2.row,
                attackerCol: data.attack2.col,
                targetOwner: attack2TargetOwner,
                targetRow: data.attack2.targetRow,
                targetCol: data.attack2.targetCol,
                damage: data.attack2.damage,
                isShooter: data.attack2.isShooter,
                attackEventTs
            }
        });
        return;
    }

    // Combat mutuel tireurs = deux projectiles croisÃƒÂ©s simultanÃƒÂ©s
    if (data.combatType === 'mutual_shooters') {
        const owner1 = data.attacker1 === myNum ? 'me' : 'opp';
        const owner2 = data.attacker2 === myNum ? 'me' : 'opp';
        await CombatAnimations.animateMutualShooters({
            shooter1: { owner: owner1, row: data.row1, col: data.col1 },
            shooter2: { owner: owner2, row: data.row2, col: data.col2 },
            damage1: data.damage1,
            damage2: data.damage2,
            attackEventTs
        });
        return;
    }

    // Combat mutuel mÃƒÂªlÃƒÂ©e = les deux se rencontrent au milieu (50/50)
    if (data.combatType === 'mutual_melee' || data.isMutual) {
        await CombatAnimations.animateMutualMelee({
            attacker1: { owner: attackerOwner, row: data.row, col: data.col },
            attacker2: { owner: targetOwner, row: data.targetRow, col: data.targetCol },
            damage1: data.damage1 || data.attackerDamage,
            damage2: data.damage2 || data.targetDamage,
            attackEventTs
        });
        return;
    }

    // Tireur simple = projectile avec griffure ÃƒÂ  l'impact
    if (data.isShooter || data.combatType === 'shooter') {
        await CombatAnimations.animateProjectile({
            startOwner: attackerOwner,
            startRow: data.row,
            startCol: data.col,
            targetOwner: targetOwner,
            targetRow: data.targetRow,
            targetCol: data.targetCol,
            damage: data.damage,
            attackEventTs
        });
        return;
    }

    // Attaque solo (volant ou mÃƒÂªlÃƒÂ©e) = charge vers la cible avec griffure
    await CombatAnimations.animateSoloAttack({
        attackerOwner: attackerOwner,
        attackerRow: data.row,
        attackerCol: data.col,
        targetOwner: targetOwner,
        targetRow: data.targetRow,
        targetCol: data.targetCol,
        damage: data.damage,
        riposteDamage: data.riposteDamage,
        isFlying: data.isFlying,
        attackEventTs
    });
}

async function handlePixiDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    
    // Si les griffures ont dÃƒÂ©jÃƒÂ  ÃƒÂ©tÃƒÂ© affichÃƒÂ©es par l'animation de combat, skip
    if (data.skipScratch) return;
    
    await CombatAnimations.animateDamage({
        owner: owner,
        row: data.row,
        col: data.col,
        amount: data.amount
    });
}

async function handlePoisonDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    const slot = getSlot(owner, data.row, data.col);
    if (!slot) {
        poisonHpOverrides.delete(slotKey);
        return;
    }

    const cardEl = slot.querySelector('.card');
    const hpEl = cardEl?.querySelector('.arena-armor') || cardEl?.querySelector('.arena-hp') || cardEl?.querySelector('.img-hp');
    const cardUid = cardEl?.dataset?.uid || null;

    // Lire le HP prÃƒÂ©-poison depuis l'override ou le DOM
    let override = poisonHpOverrides.get(slotKey);
    if (override && override.uid && cardUid && override.uid !== cardUid) {
        poisonHpOverrides.delete(slotKey);
        override = null;
    }
    const rawAmount = data?.amount;
    let poisonAmount = Number(rawAmount);
    if (!Number.isFinite(poisonAmount)) {
        const stateSide = owner === 'me' ? 'me' : 'opponent';
        const stateCard = state?.[stateSide]?.field?.[data.row]?.[data.col];
        const counterFallback = Number(stateCard?.poisonCounters);
        poisonAmount = Number.isFinite(counterFallback) ? Math.max(0, counterFallback) : 0;
        if (typeof window.visTrace === 'function') {
            window.visTrace('poisonDamage:amount-fallback', {
                owner,
                row: data?.row ?? null,
                col: data?.col ?? null,
                amountRaw: rawAmount ?? null,
                amountFallback: poisonAmount,
                stateCard: stateCard ? {
                    name: stateCard.name ?? null,
                    uid: stateCard.uid ?? null,
                    poisonCounters: stateCard.poisonCounters ?? null,
                    hp: stateCard.hp ?? null,
                    currentHp: stateCard.currentHp ?? null
                } : null
            });
        }
    }

    const domHpRaw = hpEl ? parseInt(hpEl.textContent, 10) : NaN;
    const domHp = Number.isFinite(domHpRaw) ? domHpRaw : 0;
    const overrideHp = Number(override?.hp);
    const currentHp = Number.isFinite(overrideHp) ? overrideHp : domHp;
    const safePoisonAmount = Number.isFinite(poisonAmount) && poisonAmount > 0 ? poisonAmount : 0;
    const newHp = Math.max(0, currentHp - safePoisonAmount);
    if (window.DEBUG_LOGS) console.log(`[POISON-HP] handlePoisonDamage: slot=${slotKey} override=${JSON.stringify(override)} domHp=${domHp} currentHp=${currentHp} amount=${safePoisonAmount} rawAmount=${rawAmount} newHp=${newHp}`);

    // S'assurer que le HP affichÃƒÂ© est le prÃƒÂ©-poison avant le VFX
    if (hpEl) hpEl.textContent = String(currentHp);

    const rect = slot.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Animation de cloaques toxiques
    if (safePoisonAmount > 0) {
        CombatVFX.createPoisonDripEffect(x, y, safePoisonAmount, rect.width, rect.height);
    } else if (typeof window.visTrace === 'function') {
        window.visTrace('poisonDamage:skip-invalid-amount', {
            owner,
            row: data?.row ?? null,
            col: data?.col ?? null,
            amountRaw: rawAmount ?? null,
            amountResolved: safePoisonAmount
        });
    }

    // Attendre que l'animation principale soit visible avant de continuer
    await new Promise(r => setTimeout(r, 1400));

    // Mettre ÃƒÂ  jour le HP directement dans le DOM (post-poison)
    if (hpEl) {
        hpEl.textContent = String(newHp);
        hpEl.classList.remove('boosted');
        hpEl.classList.add('reduced');
    }

    // Marquer l'override comme consommÃƒÂ© avec le nouveau HP
    poisonHpOverrides.set(slotKey, {
        hp: newHp,
        consumed: true,
        uid: cardUid,
        updatedAt: Date.now()
    });

    // DÃƒÂ©bloquer le slot et rafraÃƒÂ®chir le rendu
    animatingSlots.delete(slotKey);
    render();
}

async function handlePixiHeroHit(data) {
    const owner = data.defender === myNum ? 'me' : 'opp';

    // Bloquer render() pour les HP pendant l'animation
    zdejebelAnimationInProgress = true;

    // Lire les HP depuis le DOM (ce que le joueur voit avant l'animation)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const domHp = hpElement ? parseInt(hpElement.textContent) : null;
    const hpBefore = domHp ?? ((owner === 'me' ? state?.me?.hp : state?.opponent?.hp) + data.damage);
    const hpAfter = hpBefore - data.damage;

    // Garder les HP d'avant pendant l'animation de dÃƒÂ©gÃƒÂ¢ts
    _setHeroHpText(hpElement, hpBefore);

    // Pour les sorts/effets : afficher le VFX (shake + explosion + chiffre)
    // Pour les crÃƒÂ©atures : dÃƒÂ©jÃƒÂ  fait par animateSoloAttack ÃƒÂ  l'impact
    if (!data.skipVfx) {
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.style.animation = 'heroShake 0.5s ease-out';
            heroEl.classList.add('hero-hit');
            setTimeout(() => { heroEl.style.animation = ''; heroEl.classList.remove('hero-hit'); }, 550);
            const rect = heroEl.getBoundingClientRect();
            CombatVFX.createHeroHitEffect(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width, rect.height);
            if (data.spellId === 'coup_de_poing') {
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const fx = CombatAnimations._createCardFxLayer(cx, cy);
                const slash = CombatVFX.spawnSlash(fx.container, 'cross', 162);
                slash.animateIn().then(() => slash.fadeOut()).then(() => fx.cleanup());
            }
            CombatVFX.createDamageExplosion(rect.left + rect.width / 2, rect.top + rect.height / 2, data.damage);
        }
        await new Promise(r => setTimeout(r, 400));
    } else {
        await new Promise(r => setTimeout(r, 50));
    }

    // Mettre ÃƒÂ  jour les HP APRÃƒË†S l'animation
    _setHeroHpText(hpElement, hpAfter);

    // DÃƒÂ©bloquer render()
    zdejebelAnimationInProgress = false;
}

async function handleOnDeathDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Cas 1 : dÃƒÂ©gÃƒÂ¢ts ÃƒÂ  une crÃƒÂ©ature (damageKiller Ã¢â‚¬â€ Torche vivante)
    if (data.targetRow !== undefined && data.targetCol !== undefined) {
        const slot = document.querySelector(
            `.card-slot[data-owner="${owner}"][data-row="${data.targetRow}"][data-col="${data.targetCol}"]`
        );
        if (slot) {
            // Secousse sur le slot
            slot.style.animation = 'slotShake 0.5s ease-out';
            setTimeout(() => slot.style.animation = '', 500);

            // Flash orange DOM (hÃƒÂ©rite de la perspective 3D)
            slot.classList.add('slot-hit');
            setTimeout(() => slot.classList.remove('slot-hit'), 500);

            // Slash VFX + onde de choc + ÃƒÂ©tincelles PixiJS
            const rect = slot.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            CombatVFX.createSlashEffect(x, y, data.damage);
            CombatVFX.createSlotHitEffect(x, y, rect.width, rect.height);
        }
        await new Promise(r => setTimeout(r, 600));

        // DÃƒÂ©bloquer le slot aprÃƒÂ¨s l'animation Ã¢â‚¬â€ la carte a ÃƒÂ©tÃƒÂ© visible pendant les dÃƒÂ©gÃƒÂ¢ts
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.delete(slotKey);
        return;
    }

    // Cas 2 : dÃƒÂ©gÃƒÂ¢ts au hÃƒÂ©ros (damageHero Ã¢â‚¬â€ Dragon CrÃƒÂ©pitant) Ã¢â‚¬â€ style Zdejebel
    zdejebelAnimationInProgress = true;

    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    // PrÃƒÂ©server les HP d'avant l'animation
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const currentHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
    const hpBeforeAnimation = data._displayHpBefore ?? (currentHp !== undefined ? currentHp + data.damage : undefined);

    if (hpBeforeAnimation !== undefined) {
        _setHeroHpText(hpElement, hpBeforeAnimation);
    }

    if (heroCard) {
        // Secousse + flash rouge DOM sur le hÃƒÂ©ros
        heroCard.style.animation = 'heroShake 0.5s ease-out';
        heroCard.classList.add('hero-hit');
        setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

        // Slash VFX + ring/ÃƒÂ©tincelles PixiJS
        const rect = heroCard.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        CombatVFX.createSlashEffect(cx, cy, data.damage);
        CombatVFX.createHeroHitEffect(cx, cy, rect.width, rect.height);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÂ  jour les HP APRÃƒË†S l'animation
    if (currentHp !== undefined) {
        _setHeroHpText(hpElement, currentHp);
    }

    // DÃƒÂ©bloquer render()
    zdejebelAnimationInProgress = false;

    await new Promise(r => setTimeout(r, 200));
}

async function animateZdejebelDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Bloquer render() pour les HP pendant toute l'animation
    zdejebelAnimationInProgress = true;

    // Lire les HP directement depuis le DOM (ce que le joueur voit actuellement)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const domHp = hpElement ? parseInt(hpElement.textContent) : null;
    const hpBefore = domHp ?? data._displayHpBefore ?? ((owner === 'me' ? state?.me?.hp : state?.opponent?.hp) + data.damage);
    const hpAfter = hpBefore - data.damage;

    // S'assurer que les HP d'avant sont affichÃƒÂ©s pendant l'animation
    _setHeroHpText(hpElement, hpBefore);

    // RÃƒÂ©cupÃƒÂ©rer la position du hÃƒÂ©ros ciblÃƒÂ©
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (heroCard) {
        // Secousse + flash rouge DOM sur le hÃƒÂ©ros
        heroCard.style.animation = 'heroShake 0.5s ease-out';
        heroCard.classList.add('hero-hit');
        setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

        // Slash VFX + ring/ÃƒÂ©tincelles PixiJS
        const rect = heroCard.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.createSlashEffect(x, y, data.damage);
        CombatVFX.createHeroHitEffect(x, y, rect.width, rect.height);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÂ  jour les HP APRÃƒË†S l'animation (hpBefore - damage, indÃƒÂ©pendant du state)
    _setHeroHpText(hpElement, hpAfter);

    // DÃƒÂ©bloquer render() pour les HP
    zdejebelAnimationInProgress = false;

    // Petit dÃƒÂ©lai supplÃƒÂ©mentaire pour voir le changement
    await new Promise(r => setTimeout(r, 200));
}

// Fonction utilitaire pour afficher un nombre de dÃƒÂ©gÃƒÂ¢ts sur un ÃƒÂ©lÃƒÂ©ment
function showDamageNumber(element, damage) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.showDamageNumber(x, y, damage);
}

// Animation de dÃƒÂ©gÃƒÂ¢ts de piÃƒÂ©tinement sur une crÃƒÂ©ature
async function animateTrampleDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    const card = slot?.querySelector('.card');

    if (!card) return;

    // Bloquer le slot pour que render() ne mette pas ÃƒÂ  jour les HP pendant l'animation
    const slotKey = `${owner}-${data.row}-${data.col}`;
    animatingSlots.add(slotKey);

    // Sauvegarder les HP d'avant dans l'affichage
    const hpEl = card.querySelector('.arena-armor') || card.querySelector('.arena-hp') || card.querySelector('.fa-hp') || card.querySelector('.img-hp');
    if (hpEl && data.hpBefore !== undefined) {
        hpEl.textContent = data.hpBefore;
    }
    // Pour le format ATK/HP combinÃƒÂ© dans arena-stats
    const statsEl = card.querySelector('.arena-stats');
    const atkEl = card.querySelector('.arena-atk');
    if (statsEl && !atkEl && data.hpBefore !== undefined) {
        const currentText = statsEl.textContent;
        const atkPart = currentText.split('/')[0];
        statsEl.textContent = `${atkPart}/${data.hpBefore}`;
    }

    // Animation de secousse
    card.style.animation = 'cardShake 0.4s ease-out';
    setTimeout(() => card.style.animation = '', 400);

    // Flash DOM (hÃƒÂ©rite de la perspective 3D)
    card.classList.add('card-damage-hit');
    setTimeout(() => card.classList.remove('card-damage-hit'), 420);

    // Slash VFX + ÃƒÂ©tincelles PixiJS
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createSlashEffect(x, y, data.amount);
    CombatVFX.createDamageFlashEffect(x, y, rect.width, rect.height);

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÂ  jour les HP APRÃƒË†S l'animation
    if (hpEl && data.hpAfter !== undefined) {
        hpEl.textContent = data.hpAfter;
        hpEl.classList.remove('boosted');
        hpEl.classList.toggle('reduced', data.hpAfter < (data.hpBefore || 0));
    }
    if (statsEl && !atkEl && data.hpAfter !== undefined) {
        const currentText = statsEl.textContent;
        const atkPart = currentText.split('/')[0];
        statsEl.textContent = `${atkPart}/${data.hpAfter}`;
    }

    // DÃƒÂ©bloquer le slot
    animatingSlots.delete(slotKey);

    await new Promise(r => setTimeout(r, 200));
}

// Animation de dÃƒÂ©gÃƒÂ¢ts de piÃƒÂ©tinement sur le hÃƒÂ©ros
async function animateTrampleHeroHit(data) {
    const owner = data.defender === myNum ? 'me' : 'opp';
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (!heroCard) return;

    // Bloquer render() pour les HP du hÃƒÂ©ros (dÃƒÂ©jÃƒÂ  bloquÃƒÂ© dÃƒÂ¨s la rÃƒÂ©ception, mais on s'assure)
    zdejebelAnimationInProgress = true;

    // Lire les HP directement depuis le DOM (ce que le joueur voit)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const domHp = hpElement ? parseInt(hpElement.textContent) : null;
    const hpBefore = domHp ?? ((owner === 'me' ? state?.me?.hp : state?.opponent?.hp) + data.damage);
    const hpAfter = hpBefore - data.damage;

    _setHeroHpText(hpElement, hpBefore);

    // Secousse + flash rouge DOM sur le hÃƒÂ©ros
    heroCard.style.animation = 'heroShake 0.5s ease-out';
    heroCard.classList.add('hero-hit');
    setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

    // Slash VFX + ring/ÃƒÂ©tincelles PixiJS
    const rect = heroCard.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createSlashEffect(x, y, data.damage);
    CombatVFX.createHeroHitEffect(x, y, rect.width, rect.height);

    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÂ  jour les HP APRÃƒË†S l'animation (hpBefore - damage, indÃƒÂ©pendant du state)
    _setHeroHpText(hpElement, hpAfter);

    zdejebelAnimationInProgress = false;
    await new Promise(r => setTimeout(r, 200));
}

async function handlePixiSpellDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    await CombatAnimations.animateSpellDamage({
        owner: owner,
        row: data.row,
        col: data.col,
        amount: data.amount
    });
}

// ==========================================
// ATK Boost Animation (Salamandre de braise)
// ==========================================
function animateAtkBoost(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (!slot) return;

    const rect = slot.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createAtkBoostEffect(x, y, rect.width, rect.height, data.boost);
}

function animateDeath(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    const card = slot?.querySelector('.card');
    if (card) card.classList.add('dying');
}

/**
 * Animation de transformation ÃƒÂ  la mort (Petit Os Ã¢â€ â€™ Pile d'Os)
 * Flip 3D de la carte : la face avant (fromCard) se retourne pour rÃƒÂ©vÃƒÂ©ler la face arriÃƒÂ¨re (toCard)
 */
async function animateDeathTransform(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    animatingSlots.add(slotKey);
    activeDeathTransformSlots.add(slotKey);

    const slot = document.querySelector(
        `.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`
    );
    if (!slot) {
        activeDeathTransformSlots.delete(slotKey);
        animatingSlots.delete(slotKey);
        return;
    }

    if (!data.fromCard || !data.toCard || typeof makeCard !== 'function') {
        activeDeathTransformSlots.delete(slotKey);
        animatingSlots.delete(slotKey);
        return;
    }

    // Retirer la carte du slot (garder le label)
    const slotLabel = slot.querySelector('.slot-label');
    const children = [...slot.children];
    for (const child of children) {
        if (!child.classList.contains('slot-label')) child.remove();
    }
    slot.classList.remove('has-card', 'has-flying');

    // Flip directement dans le slot Ã¢â‚¬â€ le tilt du board s'applique naturellement
    const origPerspective = slot.style.perspective;
    const origOverflow = slot.style.overflow;
    slot.style.perspective = '600px';
    slot.style.overflow = 'visible';

    const flipContainer = document.createElement('div');
    flipContainer.style.cssText = `
        width: 100%; height: 100%;
        transform-style: preserve-3d;
        transform-origin: center center;
        position: relative;
    `;

    // Face avant (Petit Os) Ã¢â‚¬â€ 144x192 + offset -2px pour couvrir la bordure du slot
    const frontFace = makeCard(data.fromCard, false);
    const frontBg = frontFace.style.backgroundImage;
    frontFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 144px; height: 192px; margin: 0;
        backface-visibility: hidden;
        border-color: rgba(255,255,255,0.4) !important;
    `;
    if (frontBg) frontFace.style.backgroundImage = frontBg;

    // Face arriÃƒÂ¨re Ã¢â‚¬â€ prÃƒÂ©-retournÃƒÂ©e de 180Ã‚Â°
    const backFace = makeCard(data.toCard, false);
    const backBg = backFace.style.backgroundImage;
    backFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 144px; height: 192px; margin: 0;
        backface-visibility: hidden;
        transform: rotateY(180deg);
    `;
    if (backBg) backFace.style.backgroundImage = backBg;

    flipContainer.appendChild(frontFace);
    flipContainer.appendChild(backFace);
    slot.appendChild(flipContainer);

    // --- Animation flip (600ms) Ã¢â‚¬â€ rotateY dans le slot ---
    const TOTAL = 600;

    await new Promise(resolve => {
        const startTime = performance.now();
        const safetyTimeout = setTimeout(() => { resolve(); }, TOTAL + 500);

        function animate() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / TOTAL, 1);
            const ep = easeInOutCubic(t);
            flipContainer.style.transform = `rotateY(${ep * 180}deg)`;

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });

    // Placer manuellement toCard dans le slot
    flipContainer.remove();
    slot.style.perspective = origPerspective;
    slot.style.overflow = origOverflow;

    // Garder le label, placer la nouvelle carte
    slot.innerHTML = '';
    if (slotLabel) slot.appendChild(slotLabel);
    const placedCard = makeCard(data.toCard, false);
    slot.appendChild(placedCard);
    slot.classList.add('has-card');

    // DÃƒÂ©bloquer le slot
    activeDeathTransformSlots.delete(slotKey);
    animatingSlots.delete(slotKey);
}

/**
 * Animation de transformation en dÃƒÂ©but de tour (Pile d'Os Ã¢â€ â€™ Petit Os)
 * Flip 3D inverse : la face avant (fromCard/Pile d'Os) se retourne pour rÃƒÂ©vÃƒÂ©ler la face arriÃƒÂ¨re (toCard/Petit Os)
 */
/**
 * Animation de dÃƒÂ©fausse depuis la main (dÃƒÂ©sintÃƒÂ©gration sur place)
 */
async function animateDiscard(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const handEl = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    if (!handEl) {
        return;
    }

    const cards = handEl.querySelectorAll(owner === 'me' ? '.card' : '.opp-card-back');
    const cardEl = cards[data.handIndex];
    if (!cardEl) {
        return;
    }

    const rect = cardEl.getBoundingClientRect();

    // CrÃƒÂ©er un clone pour l'animation
    const clone = cardEl.cloneNode(true);
    clone.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        z-index: 10000;
        pointer-events: none;
        margin: 0;
        transform: none;
    `;
    document.body.appendChild(clone);

    // Cacher la carte originale
    cardEl.style.visibility = 'hidden';

    // Animation de dÃƒÂ©sintÃƒÂ©gration avec timeout de sÃƒÂ©curitÃƒÂ©
    let timeoutId;
    try {
        await Promise.race([
            animateDisintegration(clone, owner),
            new Promise(resolve => {
                timeoutId = setTimeout(() => {
                    resolve();
                }, 1500); // Timeout 1.5s max
            })
        ]);
    } catch (e) {
    } finally {
        clearTimeout(timeoutId);
        // Toujours nettoyer le clone
        if (clone.parentNode) {
            clone.remove();
        }
    }
}

/**
 * Animation de burn professionnelle (style Hearthstone/Magic Arena)
 *
 * Phase 1 - Lift:    Dos de carte se soulÃƒÂ¨ve du deck
 * Phase 2 - Flip:    La carte se retourne prÃƒÂ¨s du deck (rÃƒÂ©vÃƒÂ¨le ce qui est brÃƒÂ»lÃƒÂ©)
 * Phase 3 - Hold:    Pause brÃƒÂ¨ve + teinte rouge (la carte est condamnÃƒÂ©e)
 * Phase 4 - Fly:     La carte vole vers le cimetiÃƒÂ¨re en rÃƒÂ©trÃƒÂ©cissant
 * Phase 5 - Impact:  Flash au cimetiÃƒÂ¨re, mise ÃƒÂ  jour du graveyard
 */
async function animateBurn(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const ownerKey = owner === 'me' ? 'me' : 'opp';
    const card = data.card;
    const deckEl = document.getElementById(owner === 'me' ? 'me-deck-stack' : 'opp-deck-stack');
    if (!deckEl) {
        graveRenderBlocked.delete(ownerKey);
        return;
    }
    const graveEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    const gameBoard = document.querySelector('.game-board');
    if (!gameBoard) {
        graveRenderBlocked.delete(ownerKey);
        return;
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const cardWidth = parseFloat(rootStyle.getPropertyValue('--card-w')) || 144;
    const cardHeight = parseFloat(rootStyle.getPropertyValue('--card-h')) || 192;
    function getLocalPos(el) {
        let x = 0;
        let y = 0;
        let cur = el;
        while (cur && cur !== gameBoard) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x, y };
    }
    const deckPos = getLocalPos(deckEl);
    const deckW = deckEl.offsetWidth || cardWidth;
    const deckH = deckEl.offsetHeight || cardHeight;
    const startX = deckPos.x + deckW / 2 - cardWidth / 2;
    const startY = deckPos.y + deckH / 2 - cardHeight / 2;
    const graveTopEl = document.getElementById(ownerKey + '-grave-top');
    const graveTarget = graveTopEl || graveEl;
    let graveX = startX;
    let graveY = startY + 200;
    let graveScale = 1;
    if (graveTarget) {
        const gravePos = getLocalPos(graveTarget);
        const gtW = graveTarget.offsetWidth || cardWidth;
        const gtH = graveTarget.offsetHeight || cardHeight;
        graveX = gravePos.x + gtW / 2 - cardWidth / 2;
        graveY = gravePos.y + gtH / 2 - cardHeight / 2;
    }
    const revealX = startX;
    const revealY = startY - cardHeight - 20;
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
        'position: absolute; z-index: 10000; pointer-events: none;' +
        'left: ' + startX + 'px; top: ' + startY + 'px;' +
        'width: ' + cardWidth + 'px; height: ' + cardHeight + 'px;' +
        'transform-origin: center center;' +
        'transform: scale(1); opacity: 0;' +
        'perspective: 800px;';
    let burnGhost = _createPixiAnimGhost(card, 11000);
    const flipper = document.createElement('div');
    flipper.style.cssText =
        'width: 100%; height: 100%;' +
        'position: relative;' +
        'transform-style: preserve-3d;' +
        'transform: rotateY(0deg);';
    const backFace = document.createElement('div');
    backFace.className = 'opp-card-back';
    backFace.style.cssText =
        'position: absolute; top: 0; left: 0;' +
        'width: 100%; height: 100%;' +
        'backface-visibility: hidden;' +
        'transform: rotateY(0deg);' +
        'border-radius: 6px;';
    const frontFace = (typeof makeCard === 'function')
        ? makeCard(card, false)
        : createCardElementForAnimation(card);
    frontFace.classList.remove('just-played', 'can-attack');
    frontFace.classList.add('in-graveyard');
    const bgImage = frontFace.style.backgroundImage;
    frontFace.style.position = 'absolute';
    frontFace.style.top = '0';
    frontFace.style.left = '0';
    frontFace.style.width = '100%';
    frontFace.style.height = '100%';
    frontFace.style.margin = '0';
    frontFace.style.backfaceVisibility = 'hidden';
    frontFace.style.transform = 'rotateY(180deg)';
    if (bgImage) frontFace.style.backgroundImage = bgImage;
    if (burnGhost) {
        frontFace.style.visibility = 'hidden';
    }
    flipper.appendChild(backFace);
    flipper.appendChild(frontFace);
    wrapper.appendChild(flipper);
    gameBoard.appendChild(wrapper);
    if (graveTarget) {
        const savedLeft = wrapper.style.left;
        const savedTop = wrapper.style.top;
        const savedTransform = wrapper.style.transform;
        const target = graveTarget.getBoundingClientRect();
        for (let pass = 0; pass < 6; pass++) {
            wrapper.style.left = graveX + 'px';
            wrapper.style.top = graveY + 'px';
            wrapper.style.transform = 'scale(' + graveScale + ')';
            const m = wrapper.getBoundingClientRect();
            if (m.width > 0 && m.height > 0) {
                const ratio = Math.min(target.width / m.width, target.height / m.height);
                graveScale *= ratio;
                graveX += (target.left + target.width / 2) - (m.left + m.width / 2);
                graveY += (target.top + target.height / 2) - (m.top + m.height / 2);
            }
        }
        wrapper.style.left = savedLeft;
        wrapper.style.top = savedTop;
        wrapper.style.transform = savedTransform;
    }
    const burnNameFit = frontFace.querySelector('.arena-name');
    if (burnNameFit) fitArenaName(burnNameFit);
    const liftDuration = 120;
    const flipDuration = 250;
    const holdDuration = 250;
    const flyDuration = 300;
    const totalDuration = liftDuration + flipDuration + holdDuration + flyDuration;
    await new Promise(resolve => {
        const startTime = performance.now();
        const safetyTimeout = setTimeout(() => {
            graveRenderBlocked.delete(ownerKey);
            if (burnGhost) {
                burnGhost.destroy();
                burnGhost = null;
            }
            wrapper.remove();
            resolve();
        }, totalDuration + 500);
        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);
            const t1 = liftDuration / totalDuration;
            const t2 = (liftDuration + flipDuration) / totalDuration;
            const t3 = (liftDuration + flipDuration + holdDuration) / totalDuration;
            let x, y, scale, opacity, flipDeg, redTint;
            if (progress <= t1) {
                const p = progress / t1;
                const ep = easeOutCubic(p);
                x = startX;
                y = startY - ep * 30;
                scale = 1 + ep * 0.05;
                opacity = 0.3 + ep * 0.7;
                flipDeg = 0;
                redTint = 0;
            } else if (progress <= t2) {
                const p = (progress - t1) / (t2 - t1);
                const ep = easeInOutCubic(p);
                x = startX + (revealX - startX) * ep;
                y = (startY - 30) + (revealY - (startY - 30)) * ep;
                scale = 1.05 + (1.2 - 1.05) * ep;
                opacity = 1;
                flipDeg = easeInOutCubic(p) * 180;
                redTint = 0;
            } else if (progress <= t3) {
                const p = (progress - t2) / (t3 - t2);
                x = revealX;
                y = revealY;
                scale = 1.2;
                opacity = 1;
                flipDeg = 180;
                redTint = easeOutCubic(p) * 0.6;
            } else {
                const p = (progress - t3) / (1 - t3);
                const ep = easeInOutCubic(p);
                x = revealX + (graveX - revealX) * ep;
                y = revealY + (graveY - revealY) * ep;
                scale = 1.2 + (graveScale - 1.2) * ep;
                opacity = 1;
                flipDeg = 180;
                redTint = 0.6;
            }
            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';
            wrapper.style.opacity = opacity;
            wrapper.style.transform = 'scale(' + scale + ')';
            flipper.style.transform = 'rotateY(' + flipDeg + 'deg)';
            if (burnGhost) {
                const showGhost = flipDeg >= 90;
                flipper.style.visibility = showGhost ? 'hidden' : 'visible';
                const g = Math.max(0, Math.min(255, Math.round(255 - redTint * 90)));
                const b = Math.max(0, Math.min(255, Math.round(255 - redTint * 165)));
                const tint = (255 << 16) | (g << 8) | b;
                burnGhost.syncFromElement(wrapper, {
                    alpha: showGhost ? opacity : 0,
                    gray: 0,
                    tint,
                    zIndex: 11000
                });
                wrapper.style.filter = 'none';
            } else if (redTint > 0) {
                wrapper.style.filter =
                    'sepia(' + (redTint * 0.5) + ') ' +
                    'saturate(' + (1 + redTint * 2) + ') ' +
                    'hue-rotate(-10deg) ' +
                    'brightness(' + (1 - redTint * 0.2) + ')';
            } else {
                wrapper.style.filter = 'none';
            }
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);
                wrapper.style.visibility = 'hidden';
                graveRenderBlocked.delete(ownerKey);
                if (burnGhost) {
                    burnGhost.destroy();
                    burnGhost = null;
                }
                const topContainer = document.getElementById(ownerKey + '-grave-top');
                if (topContainer) {
                    const burnCardId = card.uid || card.id;
                    topContainer.dataset.topCardUid = burnCardId;
                    topContainer.classList.remove('empty');
                    topContainer.innerHTML = '';
                    const burnCardEl = makeCard(card, false);
                    burnCardEl.classList.remove('just-played', 'can-attack');
                    burnCardEl.classList.add('grave-card', 'in-graveyard');
                    topContainer.appendChild(burnCardEl);
                    const burnNameEl = burnCardEl.querySelector('.arena-name');
                    if (burnNameEl) fitArenaName(burnNameEl);
                }
                if (state) {
                    const graveyard = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                    if (graveyard) {
                        updateGraveDisplay(ownerKey, graveyard);
                    }
                }
                addCardToGraveyardPopup(ownerKey, card);
                wrapper.remove();
                resolve();
            }
        }
        requestAnimationFrame(animate);
    });
}

/**
 * Animation de mort Ã¢â‚¬â€ la carte vole vers le cimetiÃƒÂ¨re (style Hearthstone/Arena)
 * Phase 1 - Death Mark (400ms) : greyscale progressif + lÃƒÂ©ger shrink
 * Phase 2 - Fly to Graveyard (500ms) : vol vers le cimetiÃƒÂ¨re avec perspective tilt
 */
async function animateDeathToGraveyard(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const ownerKey = owner;
    const deathSlotKey = `${owner}-${data.row}-${data.col}`;

    // graveRenderBlocked dÃƒÂ©jÃƒÂ  incrÃƒÂ©mentÃƒÂ© par queueAnimation Ã¢â‚¬â€ pas de double add

    // 1. Trouver le slot et la carte
    const slot = document.querySelector(
        `.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`
    );
    const cardEl = slot?.querySelector('.card');

    if (!slot) {
        graveRenderBlocked.delete(ownerKey);
        animatingSlots.delete(deathSlotKey);
        return;
    }

    // 2. Positions en coordonnÃƒÂ©es locales au game-board (pas en screen-space)
    //    Comme le wrapper sera DANS le board, la perspective s'applique naturellement
    const gameBoard = document.querySelector('.game-board');
    const boardRect = gameBoard.getBoundingClientRect();
    const cardWidth = 144;
    const cardHeight = 192;

    // Position du slot en coordonnÃƒÂ©es locales au board CSS (avant perspective)
    // On utilise offsetLeft/offsetTop rÃƒÂ©cursivement jusqu'au board
    function getLocalPos(el) {
        let x = 0, y = 0;
        let cur = el;
        while (cur && cur !== gameBoard) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return { x, y };
    }
    const slotPos = getLocalPos(slot);
    const slotW = slot.offsetWidth;
    const slotH = slot.offsetHeight;
    const startX = slotPos.x + slotW / 2 - cardWidth / 2;
    const startY = slotPos.y + slotH / 2 - cardHeight / 2;

    // 3. Position cible : cimetiÃƒÂ¨re (calibrÃƒÂ©e aprÃƒÂ¨s insertion dans le DOM)
    const deathGraveTop = document.getElementById(`${ownerKey}-grave-top`);
    const graveEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    const graveTarget = deathGraveTop || graveEl;
    let graveX = startX;
    let graveY = startY + 200;
    let graveScaleX = 1;
    let graveScaleY = 1;

    // 4. CrÃƒÂ©er le wrapper DANS le game-board (hÃƒÂ©rite de la perspective automatiquement)
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: absolute; z-index: 10000; pointer-events: none;
        left: ${startX}px; top: ${startY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        transform-origin: center center;
        opacity: 1;
    `;
    wrapper.dataset.animTrack = 'deathToGrave';
    wrapper.dataset.animOwner = ownerKey;
    wrapper.dataset.animRow = String(data.row);
    wrapper.dataset.animCol = String(data.col);
    wrapper.dataset.animUid = String(data.card?.uid || data.card?.id || '');
    let deathGhost = _createPixiAnimGhost(data.card || cardEl?.__cardData || null, 11000);

    // CrÃƒÂ©er la face de la carte
    let cardFace;
    if (data.card && typeof makeCard === 'function') {
        cardFace = makeCard(data.card, false);
    } else if (cardEl) {
        cardFace = cardEl.cloneNode(true);
    } else {
        graveRenderBlocked.delete(ownerKey);
        animatingSlots.delete(deathSlotKey);
        return;
    }
    const bgImage = cardFace.style.backgroundImage;
    cardFace.style.position = 'absolute';
    cardFace.style.top = '0';
    cardFace.style.left = '0';
    cardFace.style.width = cardWidth + 'px';
    cardFace.style.height = cardHeight + 'px';
    cardFace.style.margin = '0';
    if (bgImage) cardFace.style.backgroundImage = bgImage;
    // Figer les stats ÃƒÂ  la taille board (hors .card-slot, le CSS retombe sur des tailles plus petites)
    for (const statEl of cardFace.querySelectorAll('.arena-atk, .arena-hp, .arena-armor')) {
        statEl.style.width = '40px';
        statEl.style.height = '25px';
        statEl.style.fontSize = '20px';
    }
    if (deathGhost) {
        cardFace.style.visibility = 'hidden';
    }
    wrapper.appendChild(cardFace);

    // 5. Retirer la carte originale du slot immÃƒÂ©diatement
    if (cardEl) {
        cardEl.remove();
    }
    slot.classList.remove('has-card');
    slot.classList.remove('has-flying');

    // DÃƒÂ©bloquer le slot Ã¢â‚¬â€ la carte est maintenant dans le wrapper volant, render() peut toucher le slot
    animatingSlots.delete(deathSlotKey);

    // 6. Ajouter au DOM dans le game-board (hÃƒÂ©rite de la perspective)
    gameBoard.appendChild(wrapper);
    if (deathGhost) {
        deathGhost.syncFromElement(wrapper, { alpha: 1, gray: 0, zIndex: 11000 });
    }

    // 7. Calibrer graveX/graveY par itÃƒÂ©ration (la perspective rend offsetLeft inexact)
    if (graveTarget) {
        const gtRect = graveTarget.getBoundingClientRect();
        const gtCx = gtRect.left + gtRect.width / 2;
        const gtCy = gtRect.top + gtRect.height / 2;
        for (let pass = 0; pass < 6; pass++) {
            wrapper.style.left = graveX + 'px';
            wrapper.style.top = graveY + 'px';
            wrapper.style.transform = `scale(${graveScaleX}, ${graveScaleY})`;
            const wRect = wrapper.getBoundingClientRect();
            const wCx = wRect.left + wRect.width / 2;
            const wCy = wRect.top + wRect.height / 2;
            if (wRect.width > 0 && wRect.height > 0) {
                graveScaleX *= gtRect.width / wRect.width;
                graveScaleY *= gtRect.height / wRect.height;
            }
            graveX += (gtCx - wCx);
            graveY += (gtCy - wCy);
        }
        wrapper.style.left = startX + 'px';
        wrapper.style.top = startY + 'px';
        wrapper.style.transform = 'scale(1, 1)';
    }

    // Auto-fit du nom (les noms longs dÃƒÂ©bordent pendant l'animation)
    const deathNameFit = cardFace.querySelector('.arena-name');
    if (deathNameFit) fitArenaName(deathNameFit);

    // PrÃƒÂ©-charger l'image de la carte pour l'effet de dissipation
    let dissipCardImage = null;
    let dissipationStarted = false;
    const isDissipation = data.card?.abilities?.includes('dissipation');
    if (isDissipation) {
        const bgUrl = (cardFace.style.backgroundImage || '')
            .replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
        if (bgUrl) {
            dissipCardImage = new Image();
            dissipCardImage.src = bgUrl;
        }
    }

    // 7. Animation
    const deathMarkDuration = 400;
    const flyDuration = 500;
    const totalDuration = deathMarkDuration + flyDuration;

    await new Promise(resolve => {
        const startTime = performance.now();

        const safetyTimeout = setTimeout(() => {
            graveRenderBlocked.delete(ownerKey);
            if (deathGhost) {
                deathGhost.destroy();
                deathGhost = null;
            }
            wrapper.remove();
            resolve();
        }, totalDuration + 500);

        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);

            const t1 = deathMarkDuration / totalDuration;

            let x, y, scaleX, scaleY, opacity, greyAmount;

            if (progress <= t1) {
                // === PHASE 1: DEATH MARK ===
                const p = progress / t1;
                const ep = easeOutCubic(p);
                x = startX;
                y = startY;
                scaleX = scaleY = 1.0;
                opacity = 1.0;
                greyAmount = ep;
            } else if (isDissipation && !dissipationStarted) {
                // === PHASE 2 (DISSIPATION): DÃƒâ€°SINTÃƒâ€°GRATION EN FRAGMENTS CANVAS ===
                dissipationStarted = true;
                clearTimeout(safetyTimeout);

                // CrÃƒÂ©er le canvas source : image cover + bordure arrondie
                const srcRes = 2;
                const sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = cardWidth * srcRes;
                sourceCanvas.height = cardHeight * srcRes;
                const sctx = sourceCanvas.getContext('2d');
                const sw = sourceCanvas.width, sh = sourceCanvas.height;
                const borderR = 4 * srcRes;
                const brdW = 2 * srcRes;

                // Fond de bordure
                sctx.fillStyle = '#353535';
                sctx.beginPath();
                sctx.roundRect(0, 0, sw, sh, borderR);
                sctx.fill();

                // Clipper l'intÃƒÂ©rieur et dessiner l'image avec cover positioning
                sctx.save();
                sctx.beginPath();
                sctx.roundRect(brdW, brdW, sw - brdW * 2, sh - brdW * 2, borderR - brdW);
                sctx.clip();
                sctx.filter = 'grayscale(1) brightness(0.7)';
                if (dissipCardImage && dissipCardImage.complete && dissipCardImage.naturalWidth) {
                    const imgW = dissipCardImage.naturalWidth;
                    const imgH = dissipCardImage.naturalHeight;
                    const areaW = sw - brdW * 2;
                    const areaH = sh - brdW * 2;
                    const scale = Math.max(areaW / imgW, areaH / imgH);
                    const drawW = imgW * scale;
                    const drawH = imgH * scale;
                    const drawX = brdW + (areaW - drawW) / 2;
                    const drawY = brdW + (areaH - drawH) / 2;
                    sctx.drawImage(dissipCardImage, drawX, drawY, drawW, drawH);
                }
                sctx.restore();

                // Rendre transparent hors bordure arrondie
                sctx.globalCompositeOperation = 'destination-in';
                sctx.beginPath();
                sctx.roundRect(0, 0, sw, sh, borderR);
                sctx.fill();
                sctx.globalCompositeOperation = 'source-over';

                // Position visuelle du wrapper
                const wrapperRect = wrapper.getBoundingClientRect();
                wrapper.style.visibility = 'hidden';
                if (deathGhost) {
                    deathGhost.destroy();
                    deathGhost = null;
                }

                animateDissipationVanish(sourceCanvas, wrapperRect.left, wrapperRect.top, cardWidth, cardHeight, 0, null).then(() => {
                    wrapper.remove();
                    graveRenderBlocked.delete(ownerKey);
                    resolve();
                });
                return;
            } else if (isDissipation) {
                // Dissipation dÃƒÂ©jÃƒÂ  lancÃƒÂ©e Ã¢â‚¬â€ ne rien faire
                return;
            } else {
                // === PHASE 2: FLY TO GRAVEYARD ===
                const p = (progress - t1) / (1 - t1);
                const ep = easeInOutCubic(p);
                x = startX + (graveX - startX) * ep;
                y = startY + (graveY - startY) * ep;
                scaleX = 1 + (graveScaleX - 1) * ep;
                scaleY = 1 + (graveScaleY - 1) * ep;
                opacity = 1;
                greyAmount = 1.0;
            }

            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';
            wrapper.style.opacity = opacity;
            wrapper.style.transform = `scale(${scaleX}, ${scaleY})`;

            // Effet visuel de mort : greyscale + darkening
            if (greyAmount > 0) {
                wrapper.style.filter = `grayscale(${greyAmount}) brightness(${1 - greyAmount * 0.3})`;
            } else {
                wrapper.style.filter = 'none';
            }
            if (deathGhost) {
                deathGhost.syncFromElement(wrapper, { alpha: opacity, gray: greyAmount, zIndex: 11000 });
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);
                // Snap to calibrated destination before swapping with grave card.
                wrapper.style.left = graveX + 'px';
                wrapper.style.top = graveY + 'px';
                wrapper.style.transform = `scale(${graveScaleX}, ${graveScaleY})`;

                // Cacher le wrapper AVANT de placer la carte (mÃƒÂªme frame synchrone = pas de pop)
                wrapper.style.visibility = 'hidden';
                if (deathGhost) {
                    deathGhost.destroy();
                    deathGhost = null;
                }

                // Placer la carte directement dans le cimetiÃƒÂ¨re via data.card
                // Le state n'est pas encore ÃƒÂ  jour (graveyard.length=0), donc on
                // utilise la carte de l'animation pour prÃƒÂ©-remplir le cimetiÃƒÂ¨re
                // Dissipation : pas de placement au cimetiÃƒÂ¨re
                graveRenderBlocked.delete(ownerKey);
                const isDissip = data.card?.abilities?.includes('dissipation');
                if (data.card && !isDissip) {
                    const container = document.getElementById(`${ownerKey}-grave-top`);
                    if (container) {
                        const topId = data.card.uid || data.card.id;
                        container.dataset.topCardUid = topId;
                        container.classList.remove('empty');
                        container.innerHTML = '';
                        const cardEl = makeCard(data.card, false);
                        cardEl.classList.remove('just-played', 'can-attack', 'melody-locked', 'petrified');
                        // Nettoyer les effets Medusa (la carte au cimetiÃƒÂ¨re est reset)
                        const gazeMarkerEl = cardEl.querySelector('.gaze-marker');
                        if (gazeMarkerEl) gazeMarkerEl.remove();
                        cardEl.classList.add('grave-card', 'in-graveyard');
                        container.appendChild(cardEl);
                        const nameEl = cardEl.querySelector('.arena-name');
                        if (nameEl) fitArenaName(nameEl);
                    }
                    // Aussi mettre ÃƒÂ  jour le stack
                    const graveyard = owner === 'me' ? state?.me?.graveyard : state?.opponent?.graveyard;
                    updateGraveDisplay(ownerKey, graveyard || [data.card]);

                    // Mise ÃƒÂ  jour dynamique de la popup cimetiÃƒÂ¨re
                    addCardToGraveyardPopup(ownerKey, data.card);
                }

                // Retirer le wrapper au prochain frame
                requestAnimationFrame(() => {
                    wrapper.remove();
                });
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

/**
 * Animation de dissipation : la carte se dÃƒÂ©sintÃƒÂ¨gre en fragments qui s'envolent
 * Effet style Magic Arena Ã¢â‚¬â€ chaque fragment contient un sous-ensemble alÃƒÂ©atoire de pixels
 */
async function animateDissipationVanish(sourceCanvas, startX, startY, cardWidth, cardHeight, tiltDeg = 0, perspContainer = null) {
    const NUM_FRAGMENTS = 24;
    const FRAGMENT_DURATION = 900;
    const MAX_STAGGER = 500;
    const NUM_PARTICLES = 35;
    const REPS = 2;

    const ctx = sourceCanvas.getContext('2d');
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const original = ctx.getImageData(0, 0, w, h);

    // Distribuer les pixels dans les fragments Ã¢â‚¬â€ biaisÃƒÂ© par x (gauche se dissout en premier)
    const fragmentDatas = Array.from({ length: NUM_FRAGMENTS }, () => ctx.createImageData(w, h));
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            for (let r = 0; r < REPS; r++) {
                const idx = Math.min(
                    Math.floor(NUM_FRAGMENTS * (Math.random() + 2 * x / w) / 3),
                    NUM_FRAGMENTS - 1
                );
                const pi = (y * w + x) * 4;
                for (let o = 0; o < 4; o++) {
                    fragmentDatas[idx].data[pi + o] = original.data[pi + o];
                }
            }
        }
    }

    // Wrapper unique pour tous les fragments
    const fragWrapper = document.createElement('div');
    fragWrapper.style.cssText = `
        position: fixed;
        left: ${startX}px; top: ${startY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        pointer-events: none;
        transform: rotateX(${tiltDeg}deg);
        z-index: 10001;
    `;

    // Conteneur sÃƒÂ©parÃƒÂ© pour les particules (pas de tilt)
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
        z-index: 10001; pointer-events: none;
    `;

    // CrÃƒÂ©er les ÃƒÂ©lÃƒÂ©ments canvas pour chaque fragment
    const fragments = fragmentDatas.map((imgData, i) => {
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        cvs.getContext('2d').putImageData(imgData, 0, 0);
        cvs.style.cssText = `
            position: absolute;
            left: 0; top: 0;
            width: ${cardWidth}px; height: ${cardHeight}px;
            pointer-events: none;
            will-change: transform, opacity;
        `;

        const angle = Math.PI * 2 * (Math.random() - 0.5);
        const delay = MAX_STAGGER * (1.35 * i / NUM_FRAGMENTS);
        fragWrapper.appendChild(cvs);

        return {
            el: cvs,
            delay,
            elapsed: 0,
            duration: FRAGMENT_DURATION,
            tx: 60 * Math.cos(angle),
            ty: 30 * Math.sin(angle),
            rotation: (12 * (Math.random() - 0.5)) * Math.PI / 180,
        };
    });

    // CrÃƒÂ©er les particules violettes
    const particles = Array.from({ length: NUM_PARTICLES }, () => {
        const size = 3 + Math.random() * 3;
        const px = startX + Math.random() * cardWidth;
        const py = startY + Math.random() * cardHeight;
        const el = document.createElement('div');
        el.style.cssText = `
            position: fixed;
            left: ${px}px; top: ${py}px;
            width: ${size}px; height: ${size}px;
            border-radius: 50%;
            background: #c084fc;
            opacity: 0;
            pointer-events: none;
            will-change: transform, opacity;
        `;
        container.appendChild(el);

        return {
            el,
            delay: Math.random() * 400,
            vx: (Math.random() - 0.3) * 60,
            vy: (Math.random() - 0.5) * 40 - 15,
            life: 0,
            maxLife: 500 + Math.random() * 400,
            x: px,
            y: py,
        };
    });

    // Ajouter le wrapper dans le perspContainer (mÃƒÂªme perspective 3D que le plateau)
    if (perspContainer) {
        perspContainer.appendChild(fragWrapper);
    } else {
        document.body.appendChild(fragWrapper);
    }
    document.body.appendChild(container);

    // Compenser le dÃƒÂ©calage du wrapper causÃƒÂ© par le rotateX dans le perspContainer
    if (tiltDeg !== 0 && perspContainer) {
        const before = fragWrapper.getBoundingClientRect();
        const corrX = startX - before.left;
        const corrY = startY - before.top;
        fragWrapper.style.left = (startX + corrX) + 'px';
        fragWrapper.style.top = (startY + corrY) + 'px';
    }

    return new Promise(resolve => {
        const safetyTimeout = setTimeout(() => {
            fragWrapper.remove();
            container.remove();
            resolve();
        }, MAX_STAGGER + FRAGMENT_DURATION + 500);

        let lastTime = performance.now();

        function animate(now) {
            const delta = now - lastTime;
            lastTime = now;
            let allDone = true;

            for (const frag of fragments) {
                frag.elapsed += delta;
                if (frag.elapsed < frag.delay) { allDone = false; continue; }
                const t = Math.min((frag.elapsed - frag.delay) / frag.duration, 1);
                if (t < 1) allDone = false;

                const ease = easeOutCubic(t);
                const fadeEase = easeInQuad(t);
                frag.el.style.transform = `translate(${frag.tx * ease}px, ${frag.ty * ease}px) rotate(${frag.rotation * ease}rad)`;
                frag.el.style.opacity = 1 - fadeEase;
            }

            const deltaSec = delta / 1000;
            for (const p of particles) {
                if (p.delay > 0) {
                    p.delay -= delta;
                    allDone = false;
                    continue;
                }
                p.life += delta;
                if (p.life > p.maxLife) {
                    p.el.style.opacity = '0';
                    continue;
                }
                allDone = false;
                const lt = p.life / p.maxLife;
                p.x += p.vx * deltaSec;
                p.y += p.vy * deltaSec;
                p.el.style.left = p.x + 'px';
                p.el.style.top = p.y + 'px';
                const alpha = lt < 0.3 ? (lt / 0.3) * 0.7 : 0.7 * (1 - (lt - 0.3) / 0.7);
                p.el.style.opacity = Math.max(0, alpha);
                p.el.style.transform = `scale(${1 - lt * 0.5})`;
            }

            if (allDone) {
                clearTimeout(safetyTimeout);
                fragWrapper.remove();
                container.remove();
                resolve();
            } else {
                requestAnimationFrame(animate);
            }
        }

        requestAnimationFrame(animate);
    });
}

/**
 * Animation de sacrifice : blood slash VFX + fly to graveyard
 */
async function animateSacrifice(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    // Trouver le slot pour lancer le VFX dessus
    const slot = document.querySelector(
        `.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`
    );

    if (window.DEBUG_LOGS) console.log(`[EOC-SAC-DBG] animateSacrifice owner=${owner} row=${data.row} col=${data.col} card=${data.card?.name || '-'} uid=${data.card?.uid || '-'} slotFound=${!!slot} noFly=${!!data.noFlyToGrave}`);

    if (slot) {
        const rect = slot.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // Lancer le VFX slash en croix
        const fx = CombatAnimations._createCardFxLayer(cx, cy);
        const slash = CombatVFX.spawnSlash(fx.container, 'cross', 162);
        await slash.animateIn();
        await new Promise(r => setTimeout(r, 300));
        await slash.fadeOut();
        fx.cleanup();
    }

    if (data.noFlyToGrave) {
        // CrÃƒÂ©ature avec transformInto : pas de fly-to-graveyard, le deathTransform suivant gÃƒÂ¨re le flip
        // DÃƒÂ©bloquer seulement graveRenderBlocked Ã¢â‚¬â€ le slot reste bloquÃƒÂ© pour le deathTransform
        graveRenderBlocked.delete(owner);
    } else {
        // Mort normale : enchaÃƒÂ®ner avec l'animation fly-to-graveyard standard.
        // Safety race avoids queue hard-timeout if browser throttles rAF.
        await Promise.race([
            animateDeathToGraveyard(data),
            new Promise(resolve => setTimeout(resolve, 3200))
        ]);
    }
}

/**
 * CrÃƒÂ©e un ÃƒÂ©lÃƒÂ©ment carte pour l'animation (copie de celle dans animations.js)
 */
function createCardElementForAnimation(card) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    const hpNum = Number(card.currentHp ?? card.hp);
    const atkNum = Number(card.atk);
    const hp = Number.isFinite(hpNum) ? hpNum : 0;
    const atk = Number.isFinite(atkNum) ? atkNum : 0;
    if (card.type === 'creature' && (!Number.isFinite(hpNum) || !Number.isFinite(atkNum))) {
        if (typeof window.visTrace === 'function') {
            window.visTrace('card:invalid-stats:anim', {
                source: 'createCardElementForAnimation',
                uid: card.uid || null,
                id: card.id || null,
                name: card.name || null,
                atk: card.atk ?? null,
                hp: card.hp ?? null,
                currentHp: card.currentHp ?? null,
            });
        }
    }

    // Si la carte a une image, utiliser le nouveau systÃƒÂ¨me
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'CÃƒÂ©lÃƒÂ©ritÃƒÂ©', superhaste: 'SupercÃƒÂ©lÃƒÂ©ritÃƒÂ©', intangible: 'Intangible',
            trample: 'PiÃƒÂ©tinement', power: 'Puissance', immovable: 'Immobile', wall: 'Mur', regeneration: 'RÃƒÂ©gÃƒÂ©nÃƒÂ©ration',
            protection: 'Protection', untargetable: 'Inciblable', provocation: 'Provocation'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `RÃƒÂ©gÃƒÂ©nÃƒÂ©ration ${card.regenerationX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'MÃƒÂªlÃƒÂ©e';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost">${card.cost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">CrÃƒÂ©ature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk">${atk}</div>
            <div class="img-hp">${hp}</div>`;
        return el;
    }

    return el;
}

/**
 * Animation de rÃƒÂ©vÃƒÂ©lation d'un sort ou piÃƒÂ¨ge Ã¢â‚¬â€ style Hearthstone/Arena
 * La carte apparaÃƒÂ®t en grand (gauche = joueur, droite = adversaire)
 * puis vole vers le cimetiÃƒÂ¨re du propriÃƒÂ©taire.
 */
async function animateSpellReveal(card, casterPlayerNum, startRect = null) {
    const isMine = casterPlayerNum === myNum;
    const side = isMine ? 'me' : 'opp';
    const cardWidth = 144;
    const cardHeight = 192;

    // graveRenderBlocked dÃƒÂ©jÃƒÂ  incrÃƒÂ©mentÃƒÂ© par queueAnimation Ã¢â‚¬â€ pas de double add

    // 1. CrÃƒÂ©er l'ÃƒÂ©lÃƒÂ©ment carte (version on-field : juste le nom, comme au cimetiÃƒÂ¨re)
    const cardEl = (typeof makeCard === 'function')
        ? makeCard(card, false)
        : createCardElementForAnimation(card);
    cardEl.classList.remove('just-played', 'can-attack');
    const bgImage = cardEl.style.backgroundImage;
    cardEl.style.position = 'absolute';
    cardEl.style.top = '0';
    cardEl.style.left = '0';
    cardEl.style.width = '100%';
    cardEl.style.height = '100%';
    cardEl.style.margin = '0';
    if (bgImage) cardEl.style.backgroundImage = bgImage;

    // 2. Calculer la position showcase (gauche ou droite du game-board)
    const gameBoard = document.querySelector('.game-board');
    if (!gameBoard) return;
    const gbRect = gameBoard.getBoundingClientRect();
    const showcaseScale = 1.8;
    const showcaseX = isMine
        ? gbRect.left + gbRect.width * 0.20 - (cardWidth * showcaseScale) / 2
        : gbRect.left + gbRect.width * 0.80 - (cardWidth * showcaseScale) / 2;
    const showcaseY = gbRect.top + gbRect.height * 0.45 - (cardHeight * showcaseScale) / 2;

    // 3. Calculer la position du cimetiÃƒÂ¨re du caster Ã¢â‚¬â€ utiliser grave-top pour dimensions EXACTES
    const graveEl = document.getElementById(side + '-grave-box');
    const spellGraveTop = document.getElementById(side + '-grave-top');
    let graveX = showcaseX;
    let graveY = showcaseY + 200;
    let graveScaleX = 1.0, graveScaleY = 1.0;
    if (spellGraveTop) {
        const tRect = spellGraveTop.getBoundingClientRect();
        graveX = tRect.left + tRect.width / 2 - cardWidth / 2;
        graveY = tRect.top + tRect.height / 2 - cardHeight / 2;
        graveScaleX = tRect.width / cardWidth;
        graveScaleY = tRect.height / cardHeight;
    } else if (graveEl) {
        const gRect = graveEl.getBoundingClientRect();
        graveX = gRect.left + gRect.width / 2 - cardWidth / 2;
        graveY = gRect.top + gRect.height / 2 - cardHeight / 2;
        graveScaleX = gRect.width / cardWidth;
        graveScaleY = gRect.height / cardHeight;
    }

    // 4. Position de dÃƒÂ©part : depuis la main (startRect) ou materialisation classique
    const hasStartRect = !!startRect;
    const initX = hasStartRect ? startRect.left + startRect.width / 2 - cardWidth / 2 : showcaseX;
    const initY = hasStartRect ? startRect.top + startRect.height / 2 - cardHeight / 2 : showcaseY;
    const initScale = hasStartRect ? (startRect.width / cardWidth) : 0.3;
    const oppFlip = !isMine && hasStartRect;
    const initOpacity = oppFlip ? 1 : (hasStartRect ? 0.85 : 0);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed; z-index: 10000; pointer-events: none;
        left: ${initX}px; top: ${initY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        transform-origin: center center;
        transform: scale(${initScale}); opacity: ${initOpacity};
        perspective: 800px;
    `;
    let spellGhost = _createPixiAnimGhost(card, 11000);

    // Pour les sorts adverses : flip dos Ã¢â€ â€™ face au lieu de fade
    let flipInner = null;
    if (oppFlip) {
        cardEl.style.backfaceVisibility = 'hidden';
        cardEl.style.transform = 'rotateY(180deg)';

        flipInner = document.createElement('div');
        flipInner.style.cssText = 'width:100%;height:100%;position:relative;transform-style:preserve-3d;';

        const backFace = document.createElement('div');
        backFace.style.cssText = `
            position:absolute;top:0;left:0;width:100%;height:100%;
            border-radius:6px;overflow:hidden;backface-visibility:hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        const backImg = document.createElement('img');
        backImg.src = 'cardback/back_1.png';
        backImg.style.cssText = 'width:100%;height:100%;display:block;';
        backFace.appendChild(backImg);

        flipInner.appendChild(backFace);
        flipInner.appendChild(cardEl);
        wrapper.appendChild(flipInner);
    } else {
        wrapper.appendChild(cardEl);
    }
    if (spellGhost) {
        if (flipInner) flipInner.style.visibility = 'hidden';
        else cardEl.style.visibility = 'hidden';
    }

    // 5. Perspective container pour le fly-to-graveyard (mÃƒÂªme technique que animateBurn)
    const gameBoardWrapper = document.querySelector('.game-board-wrapper');
    let perspContainer = null;
    let graveTiltDeg = 0;
    if (gameBoardWrapper) {
        const gb = document.querySelector('.game-board');
        if (gb) {
            const computedTransform = getComputedStyle(gb).transform;
            if (computedTransform && computedTransform !== 'none') {
                const mat = new DOMMatrix(computedTransform);
                graveTiltDeg = Math.atan2(mat.m23, mat.m22) * (180 / Math.PI);
            }
        }
        const gbwRect = gameBoardWrapper.getBoundingClientRect();
        perspContainer = document.createElement('div');
        perspContainer.style.cssText = `
            position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
            z-index: 10000; pointer-events: none;
            perspective: 1000px;
            perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height * 0.8}px;
        `;
        document.body.appendChild(perspContainer);
        perspContainer.appendChild(wrapper);
    } else {
        document.body.appendChild(wrapper);
    }
    if (spellGhost) {
        spellGhost.syncFromElement(wrapper, { alpha: initOpacity, gray: 0, zIndex: 11000 });
    }

    // Calibrer graveScaleX/Y : 3 passes itÃƒÂ©ratives, correction indÃƒÂ©pendante W et H
    if (spellGraveTop) {
        const savedLeft = wrapper.style.left;
        const savedTop = wrapper.style.top;
        const savedTransform = wrapper.style.transform;
        const savedOpacity = wrapper.style.opacity;
        wrapper.style.opacity = '0';
        const target = spellGraveTop.getBoundingClientRect();
        for (let pass = 0; pass < 3; pass++) {
            wrapper.style.left = graveX + 'px';
            wrapper.style.top = graveY + 'px';
            wrapper.style.transform = `scale(${graveScaleX}, ${graveScaleY}) rotateX(${graveTiltDeg}deg)`;
            const m = wrapper.getBoundingClientRect();
            if (m.width > 0 && m.height > 0) {
                graveScaleX *= target.width / m.width;
                graveScaleY *= target.height / m.height;
                graveX += (target.left + target.width / 2) - (m.left + m.width / 2);
                graveY += (target.top + target.height / 2) - (m.top + m.height / 2);
            }
        }
        wrapper.style.left = savedLeft;
        wrapper.style.top = savedTop;
        wrapper.style.transform = savedTransform;
        wrapper.style.opacity = savedOpacity;
    }

    // Auto-fit du nom (les noms longs dÃƒÂ©bordent pendant l'animation)
    const spellNameFit = cardEl.querySelector('.arena-name');
    if (spellNameFit) fitArenaName(spellNameFit);

    // 6. DurÃƒÂ©es des phases (pas de phase impact Ã¢â‚¬â€ le fly est la derniÃƒÂ¨re, comme burn)
    const materializeDuration = 500;
    const holdDuration = 800;
    const shrinkDuration = 300;
    const flyDuration = 400;
    const totalDuration = materializeDuration + holdDuration + shrinkDuration + flyDuration;

    await new Promise(resolve => {
        const startTime = performance.now();

        const safetyTimeout = setTimeout(() => {
            graveRenderBlocked.delete(side);
            if (spellGhost) {
                spellGhost.destroy();
                spellGhost = null;
            }
            wrapper.remove();
            if (perspContainer) perspContainer.remove();
            resolve();
        }, totalDuration + 1000);

        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);

            const t1 = materializeDuration / totalDuration;
            const t2 = (materializeDuration + holdDuration) / totalDuration;
            const t3 = (materializeDuration + holdDuration + shrinkDuration) / totalDuration;

            let x, y, scaleX, scaleY, opacity, tiltDeg;

            if (progress <= t1) {
                // === PHASE 1: MATERIALIZE Ã¢â‚¬â€ montÃƒÂ©e progressive vers showcase ===
                const p = progress / t1;
                const ep = easeInOutCubic(p);
                x = initX + (showcaseX - initX) * ep;
                y = initY + (showcaseY - initY) * ep;
                if (hasStartRect) {
                    // Depuis la main : garder la taille initiale au dÃƒÂ©but, grossir aprÃƒÂ¨s avoir commencÃƒÂ© ÃƒÂ  monter
                    const scaleDelay = 0.3;
                    const sp = Math.max(0, (p - scaleDelay) / (1 - scaleDelay));
                    scaleX = scaleY = initScale + (showcaseScale - initScale) * easeOutCubic(sp);
                } else {
                    scaleX = scaleY = initScale + (showcaseScale - initScale) * ep;
                }
                opacity = initOpacity + (1 - initOpacity) * easeOutCubic(p);
                tiltDeg = 0;

            } else if (progress <= t2) {
                // === PHASE 2: HOLD / SHOWCASE ===
                const p = (progress - t1) / (t2 - t1);
                x = showcaseX;
                y = showcaseY;
                scaleX = scaleY = showcaseScale;
                opacity = 1;
                tiltDeg = 0;

            } else if (progress <= t3) {
                // === PHASE 3: SHRINK ===
                const p = (progress - t2) / (t3 - t2);
                const ep = easeInOutCubic(p);
                x = showcaseX;
                y = showcaseY;
                scaleX = scaleY = showcaseScale + (1.0 - showcaseScale) * ep;
                opacity = 1;
                tiltDeg = 0;

            } else {
                // === PHASE 4: FLY TO GRAVEYARD (derniÃƒÂ¨re phase, comme burn) ===
                const p = (progress - t3) / (1 - t3);
                const ep = easeInOutCubic(p);
                x = showcaseX + (graveX - showcaseX) * ep;
                y = showcaseY + (graveY - showcaseY) * ep;
                scaleX = 1.0 + (graveScaleX - 1.0) * ep;
                scaleY = 1.0 + (graveScaleY - 1.0) * ep;
                opacity = 1;
                tiltDeg = ep * graveTiltDeg;
            }

            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';
            wrapper.style.opacity = opacity;
            wrapper.style.transform = `scale(${scaleX}, ${scaleY}) rotateX(${tiltDeg}deg)`;
            if (spellGhost) {
                spellGhost.syncFromElement(wrapper, { alpha: opacity, gray: 0, zIndex: 11000 });
            }

            // Flip dos Ã¢â€ â€™ face pour les sorts adverses (pendant phase 1)
            if (flipInner) {
                const flipDeg = progress <= t1 ? 180 * easeInOutCubic(progress / t1) : 180;
                flipInner.style.transform = `rotateY(${flipDeg}deg)`;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);

                // Cacher le wrapper AVANT de placer la carte (mÃƒÂªme frame synchrone = pas de pop)
                wrapper.style.visibility = 'hidden';

                // VÃƒÂ©rifier si ce sort doit retourner en main (returnOnMiss)
                const spellId = card.uid || card.id;
                if (pendingSpellReturns.has(spellId)) {
                    pendingSpellReturns.delete(spellId);
                    graveRenderBlocked.delete(side);
                    if (state) {
                        const graveyard = side === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                        if (graveyard) {
                            updateGraveDisplay(side, graveyard);
                            updateGraveTopCard(side, graveyard);
                        }
                    }
                } else {
                    // Placer la carte visuellement dans le cimetiÃƒÂ¨re
                    const graveTopContainer = document.getElementById(side + '-grave-top');
                    if (graveTopContainer) {
                        const spellCardId = card.uid || card.id;
                        graveTopContainer.dataset.topCardUid = spellCardId;
                        graveTopContainer.classList.remove('empty');
                        graveTopContainer.innerHTML = '';
                        const graveCardEl = makeCard(card, false);
                        graveCardEl.classList.remove('just-played', 'can-attack');
                        graveCardEl.classList.add('grave-card', 'in-graveyard');
                        graveTopContainer.appendChild(graveCardEl);
                        const spellNameEl = graveCardEl.querySelector('.arena-name');
                        if (spellNameEl) fitArenaName(spellNameEl);
                    }
                    // Mise ÃƒÂ  jour dynamique de la popup cimetiÃƒÂ¨re
                    addCardToGraveyardPopup(side, card);

                    // GARDER graveRenderBlocked actif !
                    // Le state du serveur n'a pas encore le sort dans le cimetiÃƒÂ¨re.
                    // Si on dÃƒÂ©bloque maintenant, render() voit un cimetiÃƒÂ¨re vide et efface notre carte.
                    // On dÃƒÂ©bloque aprÃƒÂ¨s un dÃƒÂ©lai pour laisser le state se mettre ÃƒÂ  jour.
                    const capturedSide = side;
                    const spellUid = card.uid || card.id;
                    setTimeout(() => {
                        graveRenderBlocked.delete(capturedSide);
                        if (state) {
                            const graveyard = capturedSide === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                            if (graveyard) {
                                // VÃƒÂ©rifier que le state contient bien le sort avant de mettre ÃƒÂ  jour.
                                // Pour les sorts lents (destroy etc.), le state peut ne pas encore ÃƒÂªtre arrivÃƒÂ©.
                                // Dans ce cas, garder le placement manuel Ã¢â‚¬â€ render() mettra ÃƒÂ  jour quand le state arrivera.
                                const hasSpell = graveyard.some(c => (c.uid || c.id) === spellUid);
                                if (hasSpell) {
                                    updateGraveDisplay(capturedSide, graveyard);
                                    updateGraveTopCard(capturedSide, graveyard);
                                }
                            }
                        }
                    }, 2000);
                }

                wrapper.remove();
                if (spellGhost) {
                    spellGhost.destroy();
                    spellGhost = null;
                }
                if (perspContainer) perspContainer.remove();
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

async function animateSpell(data) {
    let startRect = null;
    // Fly from opponent hand before revealing the spell
    if (data.spell && data.caster !== myNum) {
        const gameBoard = document.querySelector('.game-board');
        if (gameBoard) {
            const gbRect = gameBoard.getBoundingClientRect();
            const cardW = 144, cardH = 192, sc = 1.8;
            const showcaseX = gbRect.left + gbRect.width * 0.80 - (cardW * sc) / 2;
            const showcaseY = gbRect.top + gbRect.height * 0.45 - (cardH * sc) / 2;
            // Prendre le dos de carte du DOM (filtrer les dÃƒÂ©jÃƒÂ  cachÃƒÂ©es)
            let savedRect = null;
            if (data.visualHandIndex >= 0) {
                const hp = document.getElementById('opp-hand');
                const allCards = hp ? hp.querySelectorAll('.opp-card-back') : [];
                const hc = [...allCards].filter(c => c.style.visibility !== 'hidden');
                if (data.visualHandIndex < hc.length) {
                    savedRect = hc[data.visualHandIndex].getBoundingClientRect();
                    hc[data.visualHandIndex].style.visibility = 'hidden';
                    smoothCloseOppHandGap(hc[data.visualHandIndex]);
                } else if (savedOppHandRects && data.visualHandIndex < savedOppHandRects.length) {
                    savedRect = savedOppHandRects[data.visualHandIndex];
                }
            }
            // Pas de flyFromOppHand Ã¢â‚¬â€ animateSpellReveal gÃƒÂ¨re tout le trajet mainÃ¢â€ â€™showcase avec scale progressif + flip
            startRect = savedRect || { left: showcaseX, top: showcaseY, width: cardW * sc, height: cardH * sc };
        }
    }
    // Pour nos propres sorts : rÃƒÂ©cupÃƒÂ©rer la position du sort engagÃƒÂ© dans la main
    if (data.spell && data.caster === myNum && committedSpells.length > 0) {
        const handPanel = document.getElementById('my-hand');
        const committedEls = handPanel ? handPanel.querySelectorAll('.committed-spell') : [];
        const csIdx = committedSpells.findIndex(cs => cs.card.id === data.spell.id);
        if (csIdx >= 0) {
            const commitId = committedSpells[csIdx].commitId;
            // Chercher l'ÃƒÂ©lÃƒÂ©ment DOM du sort engagÃƒÂ©
            let foundEl = null;
            for (const el of committedEls) {
                if (parseInt(el.dataset.commitId) === commitId) {
                    foundEl = el;
                    break;
                }
            }

            if (foundEl) {
                // Ãƒâ€°lÃƒÂ©ment trouvÃƒÂ© dans le DOM Ã¢â‚¬â€ rÃƒÂ©cupÃƒÂ©rer sa position et le retirer
                startRect = foundEl.getBoundingClientRect();

                // FLIP : capturer les positions des cartes voisines AVANT de retirer le sort
                const siblings = handPanel.querySelectorAll('.card');
                const oldPositions = new Map();
                for (const sibling of siblings) {
                    if (sibling === foundEl) continue;
                    oldPositions.set(sibling, sibling.getBoundingClientRect().left);
                }

                foundEl.remove();

                // FLIP : animer les cartes restantes vers leurs nouvelles positions
                const toAnimate = [];
                for (const [card, oldLeft] of oldPositions) {
                    if (!card.isConnected) continue;
                    const dx = oldLeft - card.getBoundingClientRect().left;
                    if (Math.abs(dx) > 1) {
                        card.style.transition = 'none';
                        card.style.transform = `translateX(${dx}px)`;
                        toAnimate.push(card);
                    }
                }
                if (toAnimate.length > 0) {
                    handPanel.getBoundingClientRect(); // force reflow
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            toAnimate.forEach(card => {
                                card.style.transition = 'transform 0.3s ease-out';
                                card.style.transform = '';
                            });
                            setTimeout(() => {
                                toAnimate.forEach(card => { card.style.transition = ''; });
                            }, 350);
                        });
                    });
                }
            } else if (cachedCommittedRects[commitId]) {
                // Ãƒâ€°lÃƒÂ©ment dÃƒÂ©jÃƒÂ  retirÃƒÂ© du DOM Ã¢â‚¬â€ utiliser la position cachÃƒÂ©e (par commitId, unique)
                startRect = cachedCommittedRects[commitId];
            }

            committedSpells.splice(csIdx, 1);
            delete cachedCommittedRects[commitId];
        }
    }
    // Afficher la carte du sort avec animation de rÃƒÂ©vÃƒÂ©lation
    if (data.spell) {
        await animateSpellReveal(data.spell, data.caster, startRect);
    }
}

function animateSpellMiss(data) {
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const slot = getSlot(targetOwner, data.row, data.col);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        CombatVFX.createSpellMissEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
    }
}

function animateSpellReturnToHand(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const spellId = data.card.uid || data.card.id;
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] spellReturnToHand event owner=${owner} card=${data.card?.name || data.card?.id || '-'} spellId=${spellId} handIndex=${data.handIndex}`);
    // Marquer ce sort comme devant retourner en main (pas au cimetiÃƒÂ¨re)
    pendingSpellReturns.set(spellId, { owner, handIndex: data.handIndex });
    // Si l'animation du sort a dÃƒÂ©jÃƒÂ  terminÃƒÂ© et placÃƒÂ© la carte dans le cimetiÃƒÂ¨re (race condition),
    // nettoyer immÃƒÂ©diatement le visuel du cimetiÃƒÂ¨re
    const graveTopContainer = document.getElementById(owner + '-grave-top');
    if (graveTopContainer && graveTopContainer.dataset.topCardUid === spellId) {
        if (window.DEBUG_LOGS) console.log(`[BLAST-RET] race-cleanup grave top already had spellId=${spellId} owner=${owner}`);
        graveRenderBlocked.delete(owner);
        pendingSpellReturns.delete(spellId);
        if (state) {
            const graveyard = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
            if (graveyard) {
                updateGraveDisplay(owner, graveyard);
                updateGraveTopCard(owner, graveyard);
            }
        }
    }
    // Marquer cet index comme retour depuis le cimetiÃƒÂ¨re
    const beforeReturns = [...GameAnimations.pendingGraveyardReturns[owner]];
    GameAnimations.pendingGraveyardReturns[owner].add(data.handIndex);
    const afterReturns = [...GameAnimations.pendingGraveyardReturns[owner]];
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] mark pendingGraveyardReturns owner=${owner} before=[${beforeReturns.join(',')}] after=[${afterReturns.join(',')}]`);
    // RÃƒÂ©utiliser le systÃƒÂ¨me de pioche standard (carte cachÃƒÂ©e au render, animation, reveal)
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] queue draw-prep owner=${owner} handIndex=${data.handIndex} spellId=${spellId}`);
    GameAnimations.prepareDrawAnimation({
        cards: [{ player: data.player, handIndex: data.handIndex, card: data.card }]
    });
}

function animateHeal(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (slot) {
        // Aura verte DOM (hÃƒÂ©rite de la perspective 3D)
        slot.classList.add('heal-aura');
        setTimeout(() => slot.classList.remove('heal-aura'), 600);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showHealNumber(x, y, data.amount);
        CombatVFX.createHealEffect(x, y, rect.width, rect.height);
    }
}

async function handleRegenAnim(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    // Bloquer le slot pour que render() ne touche pas ÃƒÂ  la carte
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    // Ãƒâ€°TAPE 1 : Forcer l'affichage des HP post-dÃƒÂ©gÃƒÂ¢ts (avant regen)
    if (cardEl && data._preHealHp !== undefined) {
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            hpEl.textContent = data._preHealHp;
            if (data._preHealHp < data._preHealMax) {
                hpEl.classList.add('reduced');
                hpEl.classList.remove('boosted');
            }
        }
    }

    // Ãƒâ€°TAPE 2 : Laisser le joueur voir les HP rÃƒÂ©duits pendant 500ms
    await new Promise(r => setTimeout(r, 500));

    // Ãƒâ€°TAPE 3 : Jouer l'animation de regen (nombre rouge style lifesteal)
    if (slot) {
        slot.classList.add('lifesteal-aura');
        setTimeout(() => slot.classList.remove('lifesteal-aura'), 700);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showLifestealNumber(x, y, data.amount);
    }

    // Ãƒâ€°TAPE 4 : Attendre que l'effet soit visible
    await new Promise(r => setTimeout(r, 600));

    // Ãƒâ€°TAPE 5 : Mettre ÃƒÂ  jour les HP finaux dans le DOM
    if (cardEl) {
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            const side = owner === 'me' ? 'me' : 'opponent';
            const finalCard = state?.[side]?.field?.[data.row]?.[data.col];
            if (finalCard) {
                hpEl.textContent = finalCard.currentHp;
                if (finalCard.currentHp < finalCard.hp) {
                    hpEl.classList.add('reduced');
                    hpEl.classList.remove('boosted');
                } else {
                    hpEl.classList.remove('reduced');
                }
            }
        }
    }
}

async function handleBuildingActivate(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (!slot) return;

    const rect = slot.getBoundingClientRect();
    CombatVFX.createBuildingActivateEffect(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect.width, rect.height
    );
    await new Promise(r => setTimeout(r, 900));

    // Nuage poison pour selfPoison (Pustule vivante) Ã¢â‚¬â€ jouÃƒÂ© APRÃƒË†S le VFX dorÃƒÂ©
    if (data.selfPoison) {
        const poisonRect = slot.getBoundingClientRect();
        CombatVFX.createPoisonCloudEffect(
            poisonRect.left + poisonRect.width / 2,
            poisonRect.top + poisonRect.height / 2,
            poisonRect.width, poisonRect.height
        );
    }
}

async function handleLifestealAnim(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    // Le slot est dÃƒÂ©jÃƒÂ  bloquÃƒÂ© depuis le queue (dans queueAnimation)
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    // Ãƒâ€°TAPE 1 : Forcer l'affichage des HP post-dÃƒÂ©gÃƒÂ¢ts directement dans le DOM
    // (le state global peut dÃƒÂ©jÃƒÂ  avoir les HP soignÃƒÂ©s, on utilise les HP capturÃƒÂ©s ÃƒÂ  la rÃƒÂ©ception)
    if (cardEl && data._preHealHp !== undefined) {
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            hpEl.textContent = data._preHealHp;
            // Colorer en rouge si endommagÃƒÂ© (classe "reduced" pour arena-style)
            if (data._preHealHp < data._preHealMax) {
                hpEl.classList.add('reduced');
                hpEl.classList.remove('boosted');
            }
        }
    }

    // Ãƒâ€°TAPE 1b : Pour heroHeal, forcer les HP prÃƒÂ©-soin du hÃƒÂ©ros dans le DOM
    if (data.heroHeal && data._preHeroHp !== undefined) {
        const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
        const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
        _setHeroHpText(hpElement, data._preHeroHp);
    }

    // Ãƒâ€°TAPE 2 : Laisser le joueur voir les HP rÃƒÂ©duits pendant 500ms
    await new Promise(r => setTimeout(r, 500));

    // Ãƒâ€°TAPE 3 : Jouer l'animation de lifesteal
    if (data.heroHeal) {
        // Lifelink : animation sur le portrait du hÃƒÂ©ros
        const heroEl = document.getElementById(`hero-${owner === 'me' ? 'me' : 'opp'}`);
        if (heroEl) {
            heroEl.classList.add('lifesteal-aura');
            setTimeout(() => heroEl.classList.remove('lifesteal-aura'), 700);

            const rect = heroEl.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            CombatVFX.showLifestealNumber(x, y, data.amount);
            CombatVFX.createLifestealEffect(x, y, rect.width, rect.height);
        }
    } else if (slot) {
        // Lifedrain : animation sur la crÃƒÂ©ature
        slot.classList.add('lifesteal-aura');
        setTimeout(() => slot.classList.remove('lifesteal-aura'), 700);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showLifestealNumber(x, y, data.amount);
        CombatVFX.createLifestealEffect(x, y, rect.width, rect.height);
    }

    // Ãƒâ€°TAPE 4 : Attendre que l'effet soit visible
    await new Promise(resolve => setTimeout(resolve, 600));

    // Ãƒâ€°TAPE 5 : Mettre ÃƒÂ  jour les HP finaux dans le DOM
    if (data.heroHeal) {
        // Lifelink : mettre ÃƒÂ  jour les HP du hÃƒÂ©ros
        const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
        const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
        if (hpElement) {
            const finalHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
            if (finalHp !== undefined) _setHeroHpText(hpElement, finalHp);
        }
        lifestealHeroHealInProgress = false;
    } else if (cardEl) {
        // Lifedrain : mettre ÃƒÂ  jour les HP de la crÃƒÂ©ature
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            const side = owner === 'me' ? 'me' : 'opponent';
            const finalCard = state?.[side]?.field?.[data.row]?.[data.col];
            if (finalCard) {
                hpEl.textContent = finalCard.currentHp;
                if (finalCard.currentHp < finalCard.hp) {
                    hpEl.classList.add('reduced');
                    hpEl.classList.remove('boosted');
                } else {
                    hpEl.classList.remove('reduced');
                }
            }
        }
    }
}

async function handleHeroHealAnim(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const amount = Number.isFinite(data.amount) ? data.amount : 0;

    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const heroEl = document.getElementById(`hero-${owner === 'me' ? 'me' : 'opp'}`);

    if (data._preHeroHp !== undefined) {
        _setHeroHpText(hpElement, data._preHeroHp);
    }

    await new Promise(r => setTimeout(r, 250));

    if (heroEl) {
        heroEl.classList.add('heal-aura');
        setTimeout(() => heroEl.classList.remove('heal-aura'), 700);

        const rect = heroEl.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showHealNumber(x, y, amount);
        CombatVFX.createHealEffect(x, y, rect.width, rect.height);
    }

    await new Promise(r => setTimeout(r, 600));

    if (hpElement) {
        const finalHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
        if (finalHp !== undefined) _setHeroHpText(hpElement, finalHp);
    }

    if (window.DEBUG_LOGS) console.log(`[EREBETH-DBG] heroHeal anim owner=${owner} amount=${amount} preHeroHp=${data._preHeroHp} finalHp=${owner === 'me' ? state?.me?.hp : state?.opponent?.hp}`);
}

async function handleHealOnDeathAnim(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    // Bloquer le slot pour que render() ne touche pas ÃƒÂ  la carte
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    // Ãƒâ€°TAPE 1 : Forcer l'affichage des HP post-dÃƒÂ©gÃƒÂ¢ts (avant heal)
    if (cardEl && data._preHealHp !== undefined) {
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            hpEl.textContent = data._preHealHp;
            if (data._preHealHp < data._preHealMax) {
                hpEl.classList.add('reduced');
                hpEl.classList.remove('boosted');
            }
        }
    }

    // Ãƒâ€°TAPE 2 : Laisser le joueur voir les HP rÃƒÂ©duits
    await new Promise(r => setTimeout(r, 500));

    // Ãƒâ€°TAPE 3 : Jouer l'animation de soin (mÃƒÂªme VFX que lifesteal avec couleur verte)
    if (slot) {
        slot.classList.add('lifesteal-aura');
        setTimeout(() => slot.classList.remove('lifesteal-aura'), 700);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showLifestealNumber(x, y, data.amount);
        CombatVFX.createLifestealEffect(x, y, rect.width, rect.height);
    }

    // Ãƒâ€°TAPE 4 : Attendre que l'effet soit visible
    await new Promise(resolve => setTimeout(resolve, 600));

    // Ãƒâ€°TAPE 5 : Mettre ÃƒÂ  jour les HP finaux dans le DOM
    if (cardEl) {
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            const side = owner === 'me' ? 'me' : 'opponent';
            const finalCard = state?.[side]?.field?.[data.row]?.[data.col];
            if (finalCard) {
                hpEl.textContent = finalCard.currentHp;
                if (finalCard.currentHp < finalCard.hp) {
                    hpEl.classList.add('reduced');
                    hpEl.classList.remove('boosted');
                } else {
                    hpEl.classList.remove('reduced');
                }
            }
        }
    }
}

function animateTrapPlace(data) {
    return new Promise((resolve) => {
        const owner = data.player === myNum ? 'me' : 'opp';
        const trapSlot = getTrapSlot(owner, data.row);
        if (!trapSlot) {
            resolve();
            return;
        }

        const trapRect = trapSlot.getBoundingClientRect();

        function showTrapReveal() {
            const rect = trapSlot.getBoundingClientRect();
            CombatVFX.createTrapRevealEffect(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                rect.width,
                rect.height
            );
        }

        function finalize() {
            setTimeout(resolve, 420);
        }

        // Si c'est l'adversaire, faire voler la carte de la main d'abord
        if (owner === 'opp') {
            // Prendre le dos de carte du DOM (filtrer les dÃƒÂ©jÃƒÂ  cachÃƒÂ©es)
            let savedRect = null;
            if (data.visualHandIndex >= 0) {
                const hp = document.getElementById('opp-hand');
                const allCards = hp ? hp.querySelectorAll('.opp-card-back') : [];
                const hc = [...allCards].filter(c => c.style.visibility !== 'hidden');
                if (data.visualHandIndex < hc.length) {
                    savedRect = hc[data.visualHandIndex].getBoundingClientRect();
                    hc[data.visualHandIndex].style.visibility = 'hidden';
                    smoothCloseOppHandGap(hc[data.visualHandIndex]);
                } else if (savedOppHandRects && data.visualHandIndex < savedOppHandRects.length) {
                    savedRect = savedOppHandRects[data.visualHandIndex];
                }
            }
            flyFromOppHand(trapRect, 280, null, savedRect).then(() => {
                showTrapReveal();
                finalize();
            }).catch(finalize);
        } else {
            showTrapReveal();
            finalize();
        }
    });
}

async function animateTrap(data) {
    function resolveTrapPreviewTargets(payload) {
        if (Array.isArray(payload?.targets) && payload.targets.length > 0) {
            return payload.targets;
        }

        const row = Number(payload?.row);
        if (!Number.isFinite(row) || row < 0 || row > 3) return [];

        const trapOwnerPlayer = Number(payload?.player);
        const attackerPlayer = Number.isFinite(Number(payload?.attackerPlayer))
            ? Number(payload.attackerPlayer)
            : (trapOwnerPlayer === 1 ? 2 : 1);
        const attackerSide = attackerPlayer === myNum ? 'me' : 'opponent';
        const attackerField = state?.[attackerSide]?.field;
        if (!attackerField || !attackerField[row]) return [];

        const trap = payload?.trap || {};
        if (trap.pattern === 'line') {
            return [0, 1]
                .filter((col) => !!attackerField[row][col])
                .map((col) => ({ player: attackerPlayer, row, col }));
        }

        const preferredCol = Number(payload?.triggerCol);
        const colOrder = Number.isFinite(preferredCol)
            ? [preferredCol, preferredCol === 0 ? 1 : 0]
            : [1, 0];
        for (const col of colOrder) {
            if (attackerField[row][col]) {
                return [{ player: attackerPlayer, row, col }];
            }
        }

        return [];
    }

    const owner = data.player === myNum ? 'me' : 'opp';
    const trapKey = `${owner}-${data.row}`;
    const trapSlot = getTrapSlot(owner, data.row);

    // Protect trap slot in case render arrives mid-animation.
    animatingTrapSlots.add(trapKey);

    // 1. Pre-signal: remove board glows and highlight only real trap targets.
    const previewTargets = resolveTrapPreviewTargets(data);
    const trapDamage = Number(data?.trap?.damage);
    const shouldHoldUntilDamage = Number.isFinite(trapDamage) && trapDamage > 0 && previewTargets.length > 0;
    const warnedCount = _applyTrapTargetWarnings(previewTargets, { waitForDamage: shouldHoldUntilDamage });

    // 2. Reveal starts when warning appears.
    const revealPromise = data.trap
        ? animateSpellReveal(data.trap, data.player)
        : Promise.resolve();

    // 3. Trap slot explosion (same time as warning/reveal).
    if (trapSlot) {
        trapSlot.classList.add('triggered');
        const rect = trapSlot.getBoundingClientRect();
        CombatVFX.createSpellImpactEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        setTimeout(() => {
            trapSlot.classList.remove('triggered', 'has-trap', 'mine');
            trapSlot.innerHTML = '';
        }, 600);
    }

    if (warnedCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 420));
    }
    await revealPromise;

    if (!shouldHoldUntilDamage) {
        _clearTrapTargetWarnings('trap-no-damage');
    }
}

// === SystÃƒÂ¨me de bounce (Voyage inattendu) ===
// Carte bounced en attente : sera cachÃƒÂ©e au prochain render, puis l'animation atterrit dessus
let pendingBounce = null;   // { owner, card, wrapper, resolveTarget }

/**
 * AppelÃƒÂ© par renderOppHand / renderHand pour savoir si la derniÃƒÂ¨re carte
 * vient d'un bounce et doit ÃƒÂªtre cachÃƒÂ©e + rendue face visible
 */
function checkPendingBounce(owner, cardElements) {
    if (!pendingBounce || pendingBounce.owner !== owner) return;
    // Cibler d'abord la vraie carte (uid) quand elle est revealed,
    // sinon fallback sur la derniÃƒÂ¨re carte de la main.
    let target = null;
    const panel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    if (pendingBounce.card && pendingBounce.card.uid && panel) {
        if (owner === 'opp') {
            target = panel.querySelector(`.opp-revealed[data-uid="${pendingBounce.card.uid}"]`);
        } else {
            target = panel.querySelector(`.card[data-uid="${pendingBounce.card.uid}"]`);
        }
    }
    // En prÃƒÂ©-enregistrement (queue time), attendre que la carte soit effectivement
    // ajoutÃƒÂ©e en main avant de fallback sur "la derniÃƒÂ¨re carte" (ÃƒÂ©vite le flash
    // de l'ancienne carte de droite).
    if (!target && pendingBounce.queued && typeof pendingBounce.startHandCount === 'number') {
        if (cardElements.length <= pendingBounce.startHandCount) return;
    }
    if (!target) target = cardElements[cardElements.length - 1];
    if (!target) return;
    target.style.visibility = 'hidden';
    // RÃƒÂ©soudre la cible une seule fois (premiÃƒÂ¨re render aprÃƒÂ¨s le state update)
    if (!pendingBounce.resolved) {
        const rect = target.getBoundingClientRect();
        pendingBounce.resolveTarget({
            el: target,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
        });
        pendingBounce.resolved = true;
    }
    // NE PAS null pendingBounce ici Ã¢â‚¬â€ l'animation le fera quand le fly est terminÃƒÂ©
    // Sinon un re-render pendant le fly montre la carte prÃƒÂ©maturÃƒÂ©ment
}

/**
 * Animation de bounce (Voyage inattendu) Ã¢â‚¬â€ style pioche inversÃƒÂ©e professionnelle
 *
 * Phase 1 - Lift (200ms):   Carte se soulÃƒÂ¨ve du slot avec glow magique
 * Phase 2 - Wait:           Carte flotte en attendant la position exacte de render()
 * Phase 3 - Fly (450ms):    Arc BÃƒÂ©zier fluide DIRECTEMENT vers la position exacte (pas d'approximation)
 */
async function animateBounceToHand(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    if (!slot) {
        animatingSlots.delete(slotKey);
        return;
    }

    const cardInSlot = slot.querySelector('.card');
    const slotRect = slot.getBoundingClientRect();

    // Dimensions de la carte sur le board
    const cardWidth = 144;
    const cardHeight = 192;
    const startX = slotRect.left + slotRect.width / 2 - cardWidth / 2;
    const startY = slotRect.top + slotRect.height / 2 - cardHeight / 2;

    // Cacher la vraie carte dans le slot
    if (cardInSlot) cardInSlot.style.visibility = 'hidden';

    // CrÃƒÂ©er le wrapper animÃƒÂ©
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        left: ${startX}px;
        top: ${startY}px;
        width: ${cardWidth}px;
        height: ${cardHeight}px;
        transform-origin: center center;
    `;

    // Carte face visible Ã¢â‚¬â€ prÃƒÂ©server le backgroundImage
    const cardFace = makeCard(data.card, false);
    const bgImage = cardFace.style.backgroundImage;
    cardFace.style.position = 'absolute';
    cardFace.style.top = '0';
    cardFace.style.left = '0';
    cardFace.style.width = '100%';
    cardFace.style.height = '100%';
    cardFace.style.margin = '0';
    cardFace.style.boxShadow = '0 0 20px rgba(100, 180, 255, 0.6)';
    if (bgImage) cardFace.style.backgroundImage = bgImage;

    wrapper.appendChild(cardFace);
    document.body.appendChild(wrapper);

    // Auto-fit du nom (les noms longs dÃƒÂ©bordent pendant l'animation)
    const bounceNameFit = cardFace.querySelector('.arena-name');
    if (bounceNameFit) fitArenaName(bounceNameFit);

    // === PHASE 1 : LIFT (200ms) Ã¢â‚¬â€ carte se soulÃƒÂ¨ve du slot ===
    const liftHeight = 40;
    const liftScale = 1.08;

    await new Promise(resolve => {
        const dur = 200;
        const t0 = performance.now();
        function animate() {
            const p = Math.min((performance.now() - t0) / dur, 1);
            const ep = easeOutCubic(p);
            wrapper.style.top = (startY - ep * liftHeight) + 'px';
            wrapper.style.transform = `scale(${1 + ep * (liftScale - 1)})`;
            const glow = ep * 25;
            cardFace.style.boxShadow = `0 0 ${glow}px rgba(100, 180, 255, ${ep * 0.8}), 0 4px 12px rgba(0,0,0,0.4)`;
            if (p < 1) requestAnimationFrame(animate); else resolve();
        }
        requestAnimationFrame(animate);
    });

    // Convertir de scale vers coordonnÃƒÂ©es visuelles rÃƒÂ©elles (pas de changement visuel)
    const liftEndCssY = startY - liftHeight;
    const floatX = startX + cardWidth * (1 - liftScale) / 2;
    const floatY = liftEndCssY + cardHeight * (1 - liftScale) / 2;
    const floatW = cardWidth * liftScale;
    const floatH = cardHeight * liftScale;

    wrapper.style.left = floatX + 'px';
    wrapper.style.top = floatY + 'px';
    wrapper.style.width = floatW + 'px';
    wrapper.style.height = floatH + 'px';
    wrapper.style.transform = 'none';

    // === Main pleine Ã¢â€ â€™ voler vers le cimetiÃƒÂ¨re avec teinte rouge ===
    if (data.toGraveyard) {
        const ownerKey = owner;
        const graveTopEl = document.getElementById(`${ownerKey}-grave-top`);
        const graveBox = document.getElementById(`${ownerKey}-grave-box`);
        const graveEl = graveTopEl || graveBox;

        // graveRenderBlocked dÃƒÂ©jÃƒÂ  incrÃƒÂ©mentÃƒÂ© par queueAnimation Ã¢â‚¬â€ pas de double add

        // Perspective container pour matcher l'inclinaison du board (mÃƒÂªme technique que animateBurn)
        const gameBoardWrapper = document.querySelector('.game-board-wrapper');
        let perspContainer = null;
        let graveTiltDeg = 0;
        if (gameBoardWrapper) {
            const gameBoard = document.querySelector('.game-board');
            if (gameBoard) {
                const computedTransform = getComputedStyle(gameBoard).transform;
                if (computedTransform && computedTransform !== 'none') {
                    const mat = new DOMMatrix(computedTransform);
                    graveTiltDeg = Math.atan2(mat.m23, mat.m22) * (180 / Math.PI);
                }
            }
            const gbwRect = gameBoardWrapper.getBoundingClientRect();
            perspContainer = document.createElement('div');
            perspContainer.style.cssText = `
                position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
                z-index: 10000; pointer-events: none;
                perspective: 1000px;
                perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height * 0.8}px;
            `;
            // TransfÃƒÂ©rer le wrapper dans le perspContainer
            wrapper.remove();
            perspContainer.appendChild(wrapper);
            document.body.appendChild(perspContainer);
        }

        let graveX = floatX, graveY = floatY + 200;
        let graveScaleX = 1, graveScaleY = 1;
        if (graveEl) {
            const gRect = graveEl.getBoundingClientRect();
            graveX = gRect.left + gRect.width / 2 - floatW / 2;
            graveY = gRect.top + gRect.height / 2 - floatH / 2;
            graveScaleX = gRect.width / floatW;
            graveScaleY = gRect.height / floatH;
        }

        // Calibration itÃƒÂ©rative (3 passes) pour position/scale exactes avec perspective
        if (graveEl) {
            const savedLeft = wrapper.style.left;
            const savedTop = wrapper.style.top;
            const savedTransform = wrapper.style.transform;
            const target = graveEl.getBoundingClientRect();
            for (let pass = 0; pass < 3; pass++) {
                wrapper.style.left = graveX + 'px';
                wrapper.style.top = graveY + 'px';
                wrapper.style.transform = `scale(${graveScaleX}, ${graveScaleY}) rotateX(${graveTiltDeg}deg)`;
                const m = wrapper.getBoundingClientRect();
                if (m.width > 0 && m.height > 0) {
                    graveScaleX *= target.width / m.width;
                    graveScaleY *= target.height / m.height;
                    graveX += (target.left + target.width / 2) - (m.left + m.width / 2);
                    graveY += (target.top + target.height / 2) - (m.top + m.height / 2);
                }
            }
            wrapper.style.left = savedLeft;
            wrapper.style.top = savedTop;
            wrapper.style.transform = savedTransform;
        }

        // Glow rouge pour indiquer "main pleine Ã¢â€ â€™ cimetiÃƒÂ¨re"
        cardFace.style.boxShadow = '0 0 25px rgba(255, 80, 80, 0.8), 0 4px 12px rgba(0,0,0,0.4)';

        const ctrlX = (floatX + graveX) / 2;
        const ctrlY = Math.min(floatY, graveY) - 100;
        const flyDuration = 500;

        await new Promise(resolve => {
            const t0 = performance.now();
            function animate() {
                const p = Math.min((performance.now() - t0) / flyDuration, 1);
                const t = easeInOutCubic(p);

                const x = (1-t)*(1-t)*floatX + 2*(1-t)*t*ctrlX + t*t*graveX;
                const y = (1-t)*(1-t)*floatY + 2*(1-t)*t*ctrlY + t*t*graveY;
                const sx = 1 + (graveScaleX - 1) * t;
                const sy = 1 + (graveScaleY - 1) * t;
                const tiltDeg = t * graveTiltDeg;
                wrapper.style.left = x + 'px';
                wrapper.style.top = y + 'px';
                wrapper.style.transform = `scale(${sx}, ${sy}) rotateX(${tiltDeg}deg)`;

                // Teinte rouge progressive (mÃƒÂªme filtre que animateBurn)
                const redTint = easeOutCubic(p) * 0.6;
                wrapper.style.filter = `sepia(${redTint * 0.5}) saturate(${1 + redTint * 2}) hue-rotate(-10deg) brightness(${1 - redTint * 0.2})`;

                if (p < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Cacher le wrapper avant de placer la carte dans le cimetiÃƒÂ¨re
                    wrapper.style.visibility = 'hidden';

                    // Placer la carte dans le cimetiÃƒÂ¨re (mÃƒÂªme logique que animateBurn)
                    graveRenderBlocked.delete(ownerKey);
                    if (graveTopEl) {
                        const cardUid = data.card.uid || data.card.id;
                        graveTopEl.dataset.topCardUid = cardUid;
                        graveTopEl.classList.remove('empty');
                        graveTopEl.innerHTML = '';
                        const graveCardEl = makeCard(data.card, false);
                        graveCardEl.classList.remove('just-played', 'can-attack');
                        graveCardEl.classList.add('grave-card', 'in-graveyard');
                        graveTopEl.appendChild(graveCardEl);
                        const nameEl = graveCardEl.querySelector('.arena-name');
                        if (nameEl) fitArenaName(nameEl);
                    }
                    if (state) {
                        const graveyard = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                        if (graveyard) updateGraveDisplay(ownerKey, graveyard);
                    }

                    // Mise ÃƒÂ  jour dynamique de la popup cimetiÃƒÂ¨re
                    addCardToGraveyardPopup(ownerKey, data.card);

                    wrapper.remove();
                    if (perspContainer) perspContainer.remove();
                    resolve();
                }
            }
            requestAnimationFrame(animate);
        });

        animatingSlots.delete(slotKey);
        return;
    }

    // === Main pas pleine Ã¢â€ â€™ voler vers la main (flow normal) ===

    // Utiliser le pendingBounce prÃƒÂ©-enregistrÃƒÂ© au queue time, ou en crÃƒÂ©er un nouveau
    let targetPromise;
    if (data._bounceTargetPromise) {
        targetPromise = data._bounceTargetPromise;
        if (pendingBounce) pendingBounce.wrapper = wrapper;
    } else {
        targetPromise = new Promise(resolve => {
            pendingBounce = { owner, card: data.card, wrapper, resolveTarget: resolve };
        });
    }

    // Forcer un render() au cas oÃƒÂ¹ l'ÃƒÂ©tat est dÃƒÂ©jÃƒÂ  arrivÃƒÂ© pendant que la queue traitait
    // une animation prÃƒÂ©cÃƒÂ©dente (ex: trapTrigger avant bounce). Sans ÃƒÂ§a, pendingBounce
    // ne serait jamais rÃƒÂ©solu car render() a dÃƒÂ©jÃƒÂ  tournÃƒÂ© avant qu'on le dÃƒÂ©finisse.
    render();

    // Animation de flottement pendant l'attente
    let floating = true;
    const floatT0 = performance.now();
    function floatLoop() {
        if (!floating) return;
        const elapsed = performance.now() - floatT0;
        const bob = Math.sin(elapsed / 300) * 3;
        const glowPulse = 20 + Math.sin(elapsed / 400) * 5;
        wrapper.style.top = (floatY + bob) + 'px';
        cardFace.style.boxShadow = `0 0 ${glowPulse}px rgba(100, 180, 255, 0.7), 0 4px 12px rgba(0,0,0,0.4)`;
        requestAnimationFrame(floatLoop);
    }
    requestAnimationFrame(floatLoop);

    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2000));
    const target = await Promise.race([targetPromise, timeoutPromise]);
    floating = false;

    if (target) {
        // === PHASE 3 : FLY vers la cible exacte (450ms) ===
        const flyX0 = floatX;
        const flyY0 = parseFloat(wrapper.style.top);
        const flyW0 = floatW;
        const flyH0 = floatH;

        const endX = target.x;
        const endY = target.y;
        const endW = target.w;
        const endH = target.h;

        const ctrlX = (flyX0 + endX) / 2;
        const ctrlY = Math.min(flyY0, endY) - 80;

        const flyDuration = 450;

        await new Promise(resolve => {
            const t0 = performance.now();
            function animate() {
                const p = Math.min((performance.now() - t0) / flyDuration, 1);
                const t = easeInOutCubic(p);

                const x = (1-t)*(1-t)*flyX0 + 2*(1-t)*t*ctrlX + t*t*endX;
                const y = (1-t)*(1-t)*flyY0 + 2*(1-t)*t*ctrlY + t*t*endY;
                const w = flyW0 + (endW - flyW0) * t;
                const h = flyH0 + (endH - flyH0) * t;
                const glow = 20 * (1 - t);

                wrapper.style.left = x + 'px';
                wrapper.style.top = y + 'px';
                wrapper.style.width = w + 'px';
                wrapper.style.height = h + 'px';
                cardFace.style.boxShadow = glow > 0
                    ? `0 0 ${glow}px rgba(100, 180, 255, ${glow/25}), 0 4px 12px rgba(0,0,0,0.4)`
                    : 'none';

                if (p < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Ne pas toucher la visibilitÃƒÂ© manuellement Ã¢â‚¬â€ laisser render() gÃƒÂ©rer
                    // Cela ÃƒÂ©vite un flash (diffÃƒÂ©rence de style entre wrapper board et carte hand)
                    wrapper.remove();
                    resolve();
                }
            }
            requestAnimationFrame(animate);
        });
    } else {
        wrapper.style.transition = 'opacity 0.2s';
        wrapper.style.opacity = '0';
        await new Promise(r => setTimeout(r, 200));
        wrapper.remove();
    }

    pendingBounce = null;
    animatingSlots.delete(slotKey);
    // render() va naturellement montrer la carte (pendingBounce est null)
    render();
}

// === Animation Graveyard Return (Goule tenace) ===
// Copie exacte de animateBounceToHand, mais part du cimetiÃƒÂ¨re au lieu du terrain.
// Utilise pendingBounce AVANT le lift (contrairement ÃƒÂ  bounce qui le fait aprÃƒÂ¨s) car
// emitAnimation et emitStateToBoth arrivent quasi-simultanÃƒÂ©ment du serveur.
async function animateGraveyardReturn(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const logPrefix = '[GRAVE-AXIS]';
    const rectStr = (r) => `x=${r.left.toFixed(1)} y=${r.top.toFixed(1)} w=${r.width.toFixed(1)} h=${r.height.toFixed(1)}`;
    const toDeg = (rad) => rad * (180 / Math.PI);
    function extractRotateXDeg(transformStr) {
        if (!transformStr || transformStr === 'none') return 0;
        try {
            const m = new DOMMatrix(transformStr);
            const raw = toDeg(Math.atan2(m.m23, m.m22));
            return Number.isFinite(raw) ? raw : 0;
        } catch (_) {
            return 0;
        }
    }

    // Retirer la carte de la popup cimetiÃƒÂ¨re si ouverte
    removeCardFromGraveyardPopup(owner, data.card);

    const graveEl = document.getElementById(owner + '-grave-box');
    const graveTopEl = document.getElementById(owner + '-grave-top');
    if (!graveEl) return;

    // Utiliser le pendingBounce prÃƒÂ©-enregistrÃƒÂ© au queue time, ou en crÃƒÂ©er un nouveau
    let targetPromise;
    if (data._bounceTargetPromise) {
        targetPromise = data._bounceTargetPromise;
    } else {
        targetPromise = new Promise(resolve => {
            pendingBounce = { owner, card: data.card, resolveTarget: resolve };
        });
    }

    // RÃƒÂ©fÃƒÂ©rence de gÃƒÂ©omÃƒÂ©trie: le slot du cimetiÃƒÂ¨re (stable), pas la carte interne
    // qui peut avoir un ratio/style diffÃƒÂ©rent (source d'effet "tassÃƒÂ©").
    const graveTopCardEl = graveTopEl ? graveTopEl.querySelector('.card') : null;
    const sourceSlotEl = graveTopEl || graveEl;
    const sourceRect = sourceSlotEl.getBoundingClientRect();
    const sourceCardRect = graveTopCardEl ? graveTopCardEl.getBoundingClientRect() : null;
    const sourceTransform = getComputedStyle(sourceSlotEl).transform;
    const sourceTiltDeg = extractRotateXDeg(sourceTransform);

    // Prendre la taille d'une carte de main existante pour garder exactement
    // le mÃƒÂªme axe/look pendant toute l'animation (pas de reconfiguration visuelle).
    function getHandCardSize() {
        const panel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
        if (!panel) return null;
        const sel = owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back';
        const cards = [...panel.querySelectorAll(sel)].filter(el => el.style.width !== '0px');
        if (cards.length === 0) return null;
        const ref = cards.find(el => el.style.visibility !== 'hidden') || cards[0];
        const r = ref.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
        return null;
    }

    const handSize = getHandCardSize();
    const cardW = handSize ? handSize.w : sourceRect.width;
    const cardH = handSize ? handSize.h : sourceRect.height;
    // Base "carte de main" + scale initiale.
    // IMPORTANT: ÃƒÂ©viter un scale anisotrope (X != Y) qui "tasse" la carte.
    const initialScaleXRaw = sourceRect.width / Math.max(1, cardW);
    const initialScaleYRaw = sourceRect.height / Math.max(1, cardH);
    const initialScaleRaw = Math.sqrt(Math.max(1e-6, initialScaleXRaw * initialScaleYRaw));
    const initialScale = Number.isFinite(initialScaleRaw) && initialScaleRaw > 0 ? initialScaleRaw : 1;
    const initialScaleX = initialScale;
    const initialScaleY = initialScale;
    // X centrÃƒÂ© sur le cimetiÃƒÂ¨re.
    const startX = sourceRect.left + sourceRect.width / 2 - cardW / 2;
    // Y: dÃƒÂ©marrer SOUS le bord bas du cimetiÃƒÂ¨re (full masquÃƒÂ©), puis extraction vers le haut.
    const sourceBottomY = sourceRect.top + sourceRect.height;
    const startY = sourceBottomY;

    // Inclinaison de dÃƒÂ©part (inspirÃƒÂ©e du board) pour la sortie du cimetiÃƒÂ¨re.
    let startTiltDeg = 10;
    let boardTransform = 'none';
    try {
        const boardEl = document.querySelector('.game-board');
        const tf = boardEl ? getComputedStyle(boardEl).transform : null;
        boardTransform = tf || 'none';
        if (tf && tf !== 'none') {
            const m = new DOMMatrix(tf);
            const extractedTilt = Math.atan2(m.m23, m.m22) * (180 / Math.PI);
            if (Number.isFinite(extractedTilt)) startTiltDeg = extractedTilt;
        }
    } catch (_) {}
    startTiltDeg = Math.max(-25, Math.min(25, startTiltDeg));
    const sourceCardRectStr = sourceCardRect ? rectStr(sourceCardRect) : '-';
    if (window.DEBUG_LOGS) console.log(`${logPrefix} setup owner=${owner} card=${data.card?.name || data.card?.id || '-'} sourceSlotRect{${rectStr(sourceRect)}} sourceCardRect{${sourceCardRectStr}} handBase=${cardW.toFixed(1)}x${cardH.toFixed(1)} rawScale=${initialScaleXRaw.toFixed(3)}x${initialScaleYRaw.toFixed(3)} initialScale=${initialScaleX.toFixed(3)}x${initialScaleY.toFixed(3)} sourceTilt=${sourceTiltDeg.toFixed(2)} boardTilt=${startTiltDeg.toFixed(2)} sourceTf=${sourceTransform} boardTf=${boardTransform}`);

    const flyCard = document.createElement('div');
    flyCard.style.cssText = `
        position: fixed; z-index: 10000; pointer-events: none; overflow: hidden;
        left: ${startX}px; top: ${startY}px;
        width: ${cardW}px; height: ${cardH}px;
        border-radius: 6px;
    `;
    const gameBoardWrapper = document.querySelector('.game-board-wrapper');
    let perspContainer = null;
    if (gameBoardWrapper) {
        const gbwRect = gameBoardWrapper.getBoundingClientRect();
        perspContainer = document.createElement('div');
        perspContainer.style.cssText = `
            position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
            z-index: 10000; pointer-events: none;
            perspective: 1000px;
            perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height * 0.8}px;
        `;
        document.body.appendChild(perspContainer);
        perspContainer.appendChild(flyCard);
    } else {
        document.body.appendChild(flyCard);
    }
    const overlayRoot = perspContainer || flyCard;
    let graveReturnGhost = _createPixiAnimGhost(data.card || null, 11000);
    function destroyGraveReturnGhost() {
        if (!graveReturnGhost) return;
        graveReturnGhost.destroy();
        graveReturnGhost = null;
    }

    // Carte volante "art-only": garder le fond/cadre, retirer tout le contenu interne
    // pour ÃƒÂ©viter les micro-mouvements de texte/stats pendant le vol.
    const cardEl = makeCard(data.card, true);
    while (cardEl.firstChild) cardEl.removeChild(cardEl.firstChild);
    cardEl.style.cssText = 'width: 100%; height: 100%; margin: 0; position: relative; border-radius: 6px;';
    if (data.card.image) {
        cardEl.style.backgroundImage = `url('/cards/${data.card.image}')`;
        cardEl.style.backgroundSize = 'cover';
        cardEl.style.backgroundPosition = 'center';
    }
    flyCard.appendChild(cardEl);
    flyCard.style.transformOrigin = 'center';
    flyCard.style.transformStyle = 'preserve-3d';
    flyCard.style.transform = `rotateX(${startTiltDeg}deg) scale(${initialScaleX}, ${initialScaleY})`;
    const spawnRect = flyCard.getBoundingClientRect();
    if (window.DEBUG_LOGS) console.log(`${logPrefix} spawn flyRect{${rectStr(spawnRect)}} deltaW=${(spawnRect.width - sourceRect.width).toFixed(2)} deltaH=${(spawnRect.height - sourceRect.height).toFixed(2)} transform=${flyCard.style.transform}`);

    // Auto-fit du nom
    const nameEl = cardEl.querySelector('.arena-name');
    if (nameEl) fitArenaName(nameEl);

    // === PHASE 1 : Extraire vers le haut avec clip-path (350ms) ===
    const visibleStartH = cardH * initialScaleY;
    const extractEndY = startY - visibleStartH - 50;
    const extractDistance = startY - extractEndY;
    const extractDur = 350;
    flyCard.style.clipPath = `inset(0 0 ${cardH}px 0)`;

    await new Promise(resolve => {
        const t0 = performance.now();
        function extractUp() {
            const p = Math.min((performance.now() - t0) / extractDur, 1);
            const ep = easeOutCubic(p);
            const curY = startY - ep * extractDistance;
            flyCard.style.top = curY + 'px';
            // Sortie du cimetiÃƒÂ¨re : garder l'axe inclinÃƒÂ© "cimetiÃƒÂ¨re".
            flyCard.style.transform = `rotateX(${startTiltDeg}deg) scale(${initialScaleX}, ${initialScaleY})`;
            // Clip basÃƒÂ© sur la gÃƒÂ©omÃƒÂ©trie PROJETÃƒâ€°E rÃƒÂ©elle (perspective + rotateX),
            // pour ÃƒÂ©viter l'effet de traversÃƒÂ©e en deux temps.
            const m = flyCard.getBoundingClientRect();
            const belowViewport = Math.max(0, m.bottom - sourceBottomY);
            const projectedScaleY = m.height / Math.max(1, cardH);
            const clipBottom = projectedScaleY > 0 ? (belowViewport / projectedScaleY) : belowViewport;
            flyCard.style.clipPath = clipBottom > 0.5 ? `inset(0 0 ${clipBottom}px 0)` : 'none';
            if (p < 1) requestAnimationFrame(extractUp); else { flyCard.style.clipPath = 'none'; resolve(); }
        }
        requestAnimationFrame(extractUp);
    });
    if (graveReturnGhost) {
        cardEl.style.visibility = 'hidden';
        graveReturnGhost.syncFromElement(flyCard, { alpha: 1, gray: 0, zIndex: 11000 });
    }
    const extractRect = flyCard.getBoundingClientRect();
    if (window.DEBUG_LOGS) console.log(`${logPrefix} extract-end flyRect{${rectStr(extractRect)}} expectedVisibleH=${visibleStartH.toFixed(2)} transform=${flyCard.style.transform}`);

    // DÃƒÂ©part de la phase 2 (on est dÃƒÂ©jÃƒÂ  en fixed/viewport)
    const extractedRect = flyCard.getBoundingClientRect();
    const extractedCx = extractedRect.left + extractedRect.width / 2;
    const extractedCy = extractedRect.top + extractedRect.height / 2;
    const startScaleX = initialScaleX;
    const startScaleY = initialScaleY;
    const flyX0 = extractedCx - cardW / 2;
    const flyY0 = extractedCy - cardH / 2;
    flyCard.style.transform = `rotateX(${startTiltDeg}deg) scale(${startScaleX}, ${startScaleY})`;

    if (pendingBounce) pendingBounce.wrapper = overlayRoot;

    // Forcer la rÃƒÂ©solution si le state est dÃƒÂ©jÃƒÂ  arrivÃƒÂ©
    if (pendingBounce && pendingBounce.owner === owner && !pendingBounce.resolved) {
        const existingCards = owner === 'me'
            ? document.querySelectorAll('#my-hand .card:not(.committed-spell)')
            : document.querySelectorAll('#opp-hand .opp-card-back');
        if (existingCards.length > 0) {
            checkPendingBounce(owner, existingCards);
        }
    }

    // Attendre la position cible dans la main
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2000));
    const target = await Promise.race([targetPromise, timeoutPromise]);

    // Helper : trouver la derniÃƒÂ¨re carte ACTUELLE dans la main
    // TOUJOURS requÃƒÂªter le DOM Ã¢â‚¬â€ ne jamais rÃƒÂ©utiliser target.el car un re-render
    // peut l'avoir remplacÃƒÂ© (l'ancien reste "connected" mais invisible/orphelin)
    function findCurrentTarget() {
        if (owner === 'me') {
            const cards = document.querySelectorAll('#my-hand .card:not(.committed-spell)');
            return cards[cards.length - 1] || null;
        } else {
            const cards = document.querySelectorAll('#opp-hand .opp-card-back');
            return cards[cards.length - 1] || null;
        }
    }

    function revealLastWithBridgeAndCleanup() {
        const panel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
        const sel = owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back';
        let cover = null;

        if (panel) {
            const cards = panel.querySelectorAll(sel);
            const last = cards[cards.length - 1];
            if (last) {
                const rect = last.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    cover = last.cloneNode(true);
                    cover.style.position = 'fixed';
                    cover.style.left = rect.left + 'px';
                    cover.style.top = rect.top + 'px';
                    cover.style.width = rect.width + 'px';
                    cover.style.height = rect.height + 'px';
                    cover.style.margin = '0';
                    cover.style.pointerEvents = 'none';
                    cover.style.zIndex = '10001';
                    cover.style.transition = 'none';
                    cover.style.transform = 'none';
                    cover.style.visibility = 'visible';
                    document.body.appendChild(cover);
                }
                last.style.visibility = '';
                last.style.transition = 'none';
            }
        }

        destroyGraveReturnGhost();
        requestAnimationFrame(() => {
            if (overlayRoot && overlayRoot.isConnected) overlayRoot.remove();
            requestAnimationFrame(() => {
                if (cover && cover.isConnected) cover.remove();
            });
        });
    }

    if (target) {
        // Position cible (recalculÃƒÂ©e au cas oÃƒÂ¹ un re-render a bougÃƒÂ© les cartes)
        const curTarget = findCurrentTarget();
        const endRect = curTarget ? curTarget.getBoundingClientRect() : { left: target.x, top: target.y, width: target.w, height: target.h };
        const endCx = endRect.left + endRect.width / 2;
        const endCy = endRect.top + endRect.height / 2;
        const startCx = flyX0 + cardW / 2;
        const startCy = flyY0 + cardH / 2;

        // === PHASE 2 : VOL vers la main (450ms) ===
        const ctrlX = (startCx + endCx) / 2;
        const ctrlY = Math.min(startCy, endCy) - 80;

        // Bridge progressif : on "dÃƒÂ©plie" la perspective du board vers la main
        // tout en convergeant vers la taille projetÃƒÂ©e de la cible.
        const endScaleX = endRect.width / cardW;
        const endScaleY = endRect.height / cardH;

        const apexDen = (startCy - 2 * ctrlY + endCy);
        let apexT = 0;
        if (Math.abs(apexDen) > 1e-6) {
            apexT = (startCy - ctrlY) / apexDen;
        }
        apexT = Math.max(0, Math.min(1, apexT));
        if (window.DEBUG_LOGS) console.log(`${logPrefix} fly-plan start=(${startCx.toFixed(1)},${startCy.toFixed(1)}) ctrl=(${ctrlX.toFixed(1)},${ctrlY.toFixed(1)}) end=(${endCx.toFixed(1)},${endCy.toFixed(1)}) apexT=${apexT.toFixed(3)} startScale=${startScaleX.toFixed(3)}x${startScaleY.toFixed(3)} endScale=${endScaleX.toFixed(3)}x${endScaleY.toFixed(3)} targetRect{${rectStr(endRect)}}`);

        await new Promise(resolve => {
            const t0 = performance.now();
            const flyDuration = 450;
            let loggedFlyStart = false;
            let loggedFlyApex = false;
            function animate() {
                const p = Math.min((performance.now() - t0) / flyDuration, 1);
                const t = easeInOutCubic(p);

                const cx = (1-t)*(1-t)*startCx + 2*(1-t)*t*ctrlX + t*t*endCx;
                const cy = (1-t)*(1-t)*startCy + 2*(1-t)*t*ctrlY + t*t*endCy;

                flyCard.style.left = (cx - cardW / 2) + 'px';
                flyCard.style.top = (cy - cardH / 2) + 'px';

                // DÃƒÂ©sinclinaison progressive pendant la descente + convergence d'ÃƒÂ©chelle.
                // Avant l'apex: on garde l'axe inclinÃƒÂ©.
                // AprÃƒÂ¨s l'apex: on redresse progressivement vers l'axe main.
                const sx = startScaleX + (endScaleX - startScaleX) * t;
                const sy = startScaleY + (endScaleY - startScaleY) * t;
                const descentT = t <= apexT ? 0 : (t - apexT) / Math.max(1e-6, (1 - apexT));
                const tilt = startTiltDeg * (1 - descentT);
                flyCard.style.transform = `rotateX(${tilt}deg) scale(${sx}, ${sy})`;
                if (graveReturnGhost) {
                    graveReturnGhost.syncFromElement(flyCard, { alpha: 1, gray: 0, zIndex: 11000 });
                }
                if (!loggedFlyStart && t >= 0.02) {
                    const r = flyCard.getBoundingClientRect();
                    if (window.DEBUG_LOGS) console.log(`${logPrefix} fly-start t=${t.toFixed(3)} p=${p.toFixed(3)} tilt=${tilt.toFixed(2)} scale=${sx.toFixed(3)}x${sy.toFixed(3)} flyRect{${rectStr(r)}}`);
                    loggedFlyStart = true;
                }
                if (!loggedFlyApex && t >= apexT) {
                    const r = flyCard.getBoundingClientRect();
                    if (window.DEBUG_LOGS) console.log(`${logPrefix} fly-apex t=${t.toFixed(3)} p=${p.toFixed(3)} tilt=${tilt.toFixed(2)} scale=${sx.toFixed(3)}x${sy.toFixed(3)} flyRect{${rectStr(r)}}`);
                    loggedFlyApex = true;
                }

                if (p < 1) {
                    requestAnimationFrame(animate);
                } else {
                    const r = flyCard.getBoundingClientRect();
                    if (window.DEBUG_LOGS) console.log(`${logPrefix} fly-end t=${t.toFixed(3)} p=${p.toFixed(3)} tilt=${tilt.toFixed(2)} scale=${sx.toFixed(3)}x${sy.toFixed(3)} flyRect{${rectStr(r)}}`);
                    // NE PAS null pendingBounce ici Ã¢â‚¬â€ le laisser vivre jusqu'au prochain render
                    // pour que le render puisse faire ses opÃƒÂ©rations DOM (purge, replaceWith, append)
                    // avec la flyCard en couverture visuelle et le pendingBounce bloquant la visibilitÃƒÂ©.
                    // Sinon: race condition Ã¢â‚¬â€ si le state arrive APRÃƒË†S le SWAP, le render fait
                    // purge + replaceWith + append avec pendingBounce=null Ã¢â€ â€™ flash visuel.

                    const stateAlreadyArrived = pendingBounce && pendingBounce.resolved;
                    if (pendingBounce) {
                        pendingBounce.completed = true;
                    }

                    if (stateAlreadyArrived) {
                        pendingBounce = null;
                        revealLastWithBridgeAndCleanup();
                    } else {
                        const capturedPB = pendingBounce;
                        setTimeout(() => {
                            if (capturedPB === pendingBounce && pendingBounce && pendingBounce.completed) {
                                pendingBounce = null;
                                revealLastWithBridgeAndCleanup();
                            }
                        }, 300);
                    }
                    resolve();
                }
            }
            requestAnimationFrame(animate);
        });
    } else {
        flyCard.style.transition = 'opacity 0.2s';
        flyCard.style.opacity = '0';
        await new Promise(r => setTimeout(r, 200));
        pendingBounce = null;
        destroyGraveReturnGhost();
        if (overlayRoot && overlayRoot.isConnected) overlayRoot.remove();
        if (window.DEBUG_LOGS) console.log(`${logPrefix} no-target timeout cleanup card=${data.card?.name || data.card?.id || '-'}`);
    }

    // pendingBounce sera null aprÃƒÂ¨s le cleanup (render ou safety timeout/rAF)

    // Forcer la mise ÃƒÂ  jour du cimetiÃƒÂ¨re depuis le state actuel
    if (state) {
        const graveyard = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
        if (graveyard) {
            updateGraveTopCard(owner, graveyard);
            updateGraveDisplay(owner, graveyard);
        }
    }
}

// Slots en cours d'animation - render() ne doit pas les toucher
let animatingSlots = new Set();
// Trap slots en cours d'animation Ã¢â‚¬â€ renderTraps() ne doit pas y toucher
let animatingTrapSlots = new Set();
// Slots avec deathTransform EN COURS D'EXÃƒâ€°CUTION (protÃƒÂ©gÃƒÂ©s contre resetAnimationStates)
let activeDeathTransformSlots = new Set();

/**
 * RÃƒÂ©initialise tous les ÃƒÂ©tats d'animation pour ÃƒÂ©viter les bugs de persistance
 * AppelÃƒÂ© au dÃƒÂ©but de chaque nouveau tour
 */
function resetAnimationStates() {
    // Ne pas vider les slots qui ont encore des animations en attente dans la queue
    // (ex: deathTransform bloque le slot avant que l'animation ne joue)
    const slotsStillNeeded = new Set();
    for (const item of animationQueue) {
        if (item.type === 'deathTransform' && item.data) {
            const owner = item.data.player === myNum ? 'me' : 'opp';
            slotsStillNeeded.add(`${owner}-${item.data.row}-${item.data.col}`);
        }
        if (item.type === 'onDeathDamage' && item.data && item.data.targetRow !== undefined) {
            const owner = item.data.targetPlayer === myNum ? 'me' : 'opp';
            slotsStillNeeded.add(`${owner}-${item.data.targetRow}-${item.data.targetCol}`);
        }
        if ((item.type === 'damage' || item.type === 'spellDamage' || item.type === 'poisonDamage') && item.data) {
            const owner = item.data.player === myNum ? 'me' : 'opp';
            slotsStillNeeded.add(`${owner}-${item.data.row}-${item.data.col}`);
        }
        if (item.type === 'death' && item.data) {
            const owner = item.data.player === myNum ? 'me' : 'opp';
            slotsStillNeeded.add(`${owner}-${item.data.row}-${item.data.col}`);
        }
        if (item.type === 'bounce' && item.data) {
            const owner = item.data.player === myNum ? 'me' : 'opp';
            slotsStillNeeded.add(`${owner}-${item.data.row}-${item.data.col}`);
        }
    }
    for (const key of [...animatingSlots]) {
        if (activeDeathTransformSlots.has(key)) {
        } else if (!slotsStillNeeded.has(key)) {
            animatingSlots.delete(key);
        } else {
        }
    }

    // Nettoyer les trap slots qui n'ont plus d'animation en attente
    const trapSlotsStillNeeded = new Set();
    for (const item of animationQueue) {
        if (item.type === 'trapTrigger' && item.data) {
            const owner = item.data.player === myNum ? 'me' : 'opp';
            trapSlotsStillNeeded.add(`${owner}-${item.data.row}`);
        }
    }
    for (const key of [...animatingTrapSlots]) {
        if (!trapSlotsStillNeeded.has(key)) {
            animatingTrapSlots.delete(key);
        }
    }

    // NE PAS vider la file d'animation - laisser les animations se terminer naturellement
    // Cela ÃƒÂ©vite de perdre des animations comme zdejebel qui arrivent en fin de tour
    // animationQueue.length = 0;
    // isAnimating = false;

    // Nettoyer les animations de pioche en attente
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.clear();
    }

    // RÃƒÂ©initialiser les flags de combat sur toutes les cartes
    document.querySelectorAll('.card[data-in-combat="true"]').forEach(card => {
        card.dataset.inCombat = 'false';
    });

    // Filet de sÃƒÂ©curitÃƒÂ© : aucun override visuel ne doit survivre ÃƒÂ  un nouveau tour.
    if (typeof poisonHpOverrides !== 'undefined' && poisonHpOverrides?.clear) {
        poisonHpOverrides.clear();
    }
    if (typeof powerBuffAtkOverrides !== 'undefined' && powerBuffAtkOverrides?.clear) {
        powerBuffAtkOverrides.clear();
    }

    // Retirer les classes d'animation rÃƒÂ©siduelles
    document.querySelectorAll('.card.dying').forEach(card => {
        card.classList.remove('dying');
    });

}

// Animation de lÃƒÂ©vitation continue pour les crÃƒÂ©atures volantes
// Utilise le temps global pour que l'animation reste synchronisÃƒÂ©e mÃƒÂªme aprÃƒÂ¨s re-render
const flyingAnimationSpeed = 0.002; // Vitesse de l'oscillation
const flyingAnimationAmplitude = 4; // Amplitude en pixels

function startFlyingAnimation(cardEl) {
    // Guard : ne pas empiler de boucles RAF sur le mÃƒÂªme ÃƒÂ©lÃƒÂ©ment
    if (cardEl.dataset.flyingAnimation === 'true') return;
    cardEl.dataset.flyingAnimation = 'true';

    function animate() {
        // Stop si la carte n'est plus dans le DOM
        if (!cardEl.isConnected) {
            delete cardEl.dataset.flyingAnimation;
            return;
        }

        // Stop si la carte est en train d'attaquer (l'animation de combat prend le dessus)
        if (cardEl.dataset.inCombat === 'true') {
            requestAnimationFrame(animate); // Continue ÃƒÂ  vÃƒÂ©rifier pour reprendre aprÃƒÂ¨s
            return;
        }

        const time = performance.now() * flyingAnimationSpeed;
        const offset = Math.sin(time) * flyingAnimationAmplitude;
        cardEl.style.transform = `translateY(${offset}px) translateZ(0)`;

        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}

/**
 * Anime un dos de carte volant de la main adverse vers une position cible.
 * Retourne une Promise rÃƒÂ©solue quand l'animation est terminÃƒÂ©e.
 * @param {DOMRect} targetRect - Rectangle cible (slot, trap, centre)
 * @param {number} duration - DurÃƒÂ©e en ms (dÃƒÂ©faut 300)
 * @returns {Promise<void>}
 */
function flyFromOppHand(targetRect, duration = 300, spell = null, savedSourceRect = null) {
    return new Promise(resolve => {
        let handRect = savedSourceRect;

        if (!handRect) {
            const handPanel = document.getElementById('opp-hand');
            const handCards = handPanel ? handPanel.querySelectorAll('.opp-card-back') : [];

            // Pour une carte revealed, trouver sa position exacte dans la main via son uid
            let sourceCard = handCards[handCards.length - 1];
            if (spell && spell.uid) {
                const match = handPanel?.querySelector(`.opp-revealed[data-uid="${spell.uid}"]`);
                if (match) sourceCard = match;
            }

            if (!sourceCard) { resolve(); return; }
            handRect = sourceCard.getBoundingClientRect();
        }

        // Cacher la carte revealed dans la main (elle va ÃƒÂªtre remplacÃƒÂ©e par le clone volant)
        if (spell && spell.uid) {
            const handPanel = document.getElementById('opp-hand');
            const match = handPanel?.querySelector(`.opp-revealed[data-uid="${spell.uid}"]`);
            if (match) {
                match.style.visibility = 'hidden';
                smoothCloseOppHandGap(match);
            }
        }

        // CrÃƒÂ©er la carte volante directement ÃƒÂ  la taille cible (comme un drag)
        const fw = targetRect.width, fh = targetRect.height;
        const flyCard = document.createElement('div');
        flyCard.style.cssText = `
            position: fixed; z-index: 10001; pointer-events: none; overflow: hidden;
            left: ${handRect.left + handRect.width / 2 - fw / 2}px;
            top: ${handRect.top + handRect.height / 2 - fh / 2}px;
            width: ${fw}px; height: ${fh}px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        if (spell && spell.revealedToOpponent && typeof makeCard === 'function') {
            const cardFace = makeCard(spell, false);
            const bgImage = cardFace.style.backgroundImage;
            cardFace.style.width = '100%';
            cardFace.style.height = '100%';
            cardFace.style.margin = '0';
            cardFace.style.position = 'relative';
            cardFace.style.borderRadius = '6px';
            flyCard.appendChild(cardFace);
        } else {
            const flyImg = document.createElement('img');
            flyImg.src = 'cardback/back_1.png';
            flyImg.style.cssText = 'width: 100%; height: 100%; display: block;';
            flyCard.appendChild(flyImg);
        }
        document.body.appendChild(flyCard);

        // Trajectoire par centres
        const scx = handRect.left + handRect.width / 2;
        const scy = handRect.top + handRect.height / 2;
        const ecx = targetRect.left + fw / 2;
        const ecy = targetRect.top + fh / 2;
        const ccx = (scx + ecx) / 2;
        const ccy = Math.max(scy, ecy) + 50;

        const t0 = performance.now();
        function animate() {
            const p = Math.min((performance.now() - t0) / duration, 1);
            const t = easeInOutCubic(p);

            // Centre sur la courbe de BÃƒÂ©zier
            const cx = (1-t)*(1-t)*scx + 2*(1-t)*t*ccx + t*t*ecx;
            const cy = (1-t)*(1-t)*scy + 2*(1-t)*t*ccy + t*t*ecy;

            // Convertir centre Ã¢â€ â€™ top-left (taille fixe)
            flyCard.style.left = (cx - fw / 2) + 'px';
            flyCard.style.top = (cy - fh / 2) + 'px';
            flyCard.style.opacity = (1 - t * 0.2);

            if (p < 1) {
                requestAnimationFrame(animate);
            } else {
                flyCard.remove();
                resolve();
            }
        }
        requestAnimationFrame(animate);
    });
}

// Animation d'invocation - overlay indÃƒÂ©pendant du render
// Carte adverse : vole de la main vers le slot puis apparaÃƒÂ®t
function animateSummon(data) {
    return new Promise((resolve) => {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    const stateSide = owner === 'me' ? 'me' : 'opponent';

    const toFiniteNumber = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };

    function getStateSummonCard() {
        return state?.[stateSide]?.field?.[data.row]?.[data.col] || null;
    }

    function getRenderableSummonCard(requireCombatStats = false) {
        const stateCard = getStateSummonCard();
        const animCard = data.card || null;
        const sourceCard = stateCard || animCard;
        if (!sourceCard) return null;

        const card = { ...(animCard || {}), ...(stateCard || {}) };
        if (!card.uid) card.uid = stateCard?.uid || animCard?.uid || null;
        if (!card.name) card.name = stateCard?.name || animCard?.name || 'Carte';
        if (!card.type) card.type = stateCard?.type || animCard?.type || 'creature';

        if (card.type === 'creature') {
            const atk = toFiniteNumber(card.atk);
            const hp = toFiniteNumber(card.hp);
            const curHp = toFiniteNumber(card.currentHp);
            const stateAtk = toFiniteNumber(stateCard?.atk);
            const stateHp = toFiniteNumber(stateCard?.hp);
            const stateCurHp = toFiniteNumber(stateCard?.currentHp);
            const animAtk = toFiniteNumber(animCard?.atk);
            const animHp = toFiniteNumber(animCard?.hp);
            const animCurHp = toFiniteNumber(animCard?.currentHp);

            if (atk === null) card.atk = stateAtk ?? animAtk;
            if (hp === null) card.hp = stateHp ?? animHp ?? stateCurHp ?? animCurHp;
            if (curHp === null) card.currentHp = stateCurHp ?? animCurHp ?? toFiniteNumber(card.hp);
            if (toFiniteNumber(card.baseAtk) === null) card.baseAtk = toFiniteNumber(card.atk);
            if (toFiniteNumber(card.baseHp) === null) card.baseHp = toFiniteNumber(card.hp);

            if (requireCombatStats) {
                if (toFiniteNumber(card.atk) === null || toFiniteNumber(card.hp) === null || toFiniteNumber(card.currentHp) === null) {
                    return null;
                }
            }
        }

        return card;
    }

    function ensureCardVisibleInSlot() {
        const renderCard = getRenderableSummonCard(true);
        if (!renderCard) {
            if (typeof window.visTrace === 'function') {
                const stateCard = getStateSummonCard();
                window.visTrace('summon:fallback-skip-invalid', {
                    owner,
                    row: data.row,
                    col: data.col,
                    hasAnimCard: !!data.card,
                    hasStateCard: !!stateCard,
                    animUid: data.card?.uid || null,
                    stateUid: stateCard?.uid || null,
                });
            }
            return false;
        }
        const targetSlot = getSlot(owner, data.row, data.col);
        if (!targetSlot) return false;
        if (targetSlot.querySelector('.card')) return true;

        const label = targetSlot.querySelector('.slot-label');
        targetSlot.innerHTML = '';
        if (label) targetSlot.appendChild(label.cloneNode(true));
        targetSlot.classList.add('has-card');
        const cardEl = makeCard(renderCard, false);
        targetSlot.appendChild(cardEl);
        if (typeof window.visTrace === 'function') {
            window.visTrace('summon:fallback-card', {
                owner,
                row: data.row,
                col: data.col,
                uid: renderCard?.uid || null,
                name: renderCard?.name || null,
                atk: renderCard?.atk ?? null,
                hp: renderCard?.currentHp ?? renderCard?.hp ?? null,
                source: getStateSummonCard() ? 'state' : 'anim',
            });
        }
        return true;
    }

    function releaseSummonSlotWhenStateReady(wrapperEl = null) {
        const expectedUid = getRenderableSummonCard(false)?.uid || data.card?.uid || null;
        const t0 = performance.now();
        const maxWait = 2200;

        function loop() {
            const stateCard = getStateSummonCard();
            const hasStateCard = !!stateCard;
            const uidMatches = !expectedUid || !stateCard?.uid || stateCard.uid === expectedUid;
            if ((hasStateCard && uidMatches) || (performance.now() - t0) > maxWait) {
                if (wrapperEl && wrapperEl.isConnected) wrapperEl.remove();
                animatingSlots.delete(slotKey);
                render();
                if (typeof window.visTrace === 'function') {
                    window.visTrace('summon:slot:release', {
                        owner,
                        row: data.row,
                        col: data.col,
                        waitedMs: Math.round(performance.now() - t0),
                        hasStateCard,
                        uidMatches,
                    });
                }
                return;
            }
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    }

    function finishOverlay(wrapperEl) {
        const pinned = ensureCardVisibleInSlot();
        if (pinned && wrapperEl && wrapperEl.isConnected) wrapperEl.remove();
        releaseSummonSlotWhenStateReady(pinned ? null : wrapperEl);
        resolve();
    }

    // Animation d'invocation pour ses propres crÃƒÂ©atures
    // DÃƒÂ©lai pour synchroniser la fin avec l'animation adverse (fly+flip Ã¢â€°Ë† 1040ms, ripple Ã¢â€°Ë† 820ms)
    if (data.player === myNum) {
        // Garder le slot bloquÃƒÂ© jusqu'ÃƒÂ  ce que le state serveur soit prÃƒÂªt pour ÃƒÂ©viter les flashs.
        animatingSlots.add(slotKey);
        setTimeout(() => {
            const slot = getSlot('me', data.row, data.col);
            if (!slot) return;
            const rect = slot.getBoundingClientRect();
            CombatVFX.createSummonEffect(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                rect.width,
                rect.height
            );
        }, 220);

        setTimeout(() => {
            ensureCardVisibleInSlot();
            releaseSummonSlotWhenStateReady();
            resolve();
        }, 560);
        return;
    }

    // Le slot devrait dÃƒÂ©jÃƒÂ  ÃƒÂªtre bloquÃƒÂ© par blockSlots, mais on s'assure
    animatingSlots.add(slotKey);

    // Trouver le slot cible
    const slot = getSlot(owner, data.row, data.col);
    if (!slot) {
        animatingSlots.delete(slotKey);
        resolve();
        return;
    }

    // Vider le slot (au cas oÃƒÂ¹)
    const label = slot.querySelector('.slot-label');
    slot.innerHTML = '';
    if (label) slot.appendChild(label.cloneNode(true));
    slot.classList.remove('has-card');

    const rect = slot.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;

    const summonCard = getRenderableSummonCard(false);
    const isRevealed = !!(summonCard && summonCard.revealedToOpponent);

    // Utiliser la position sauvegardÃƒÂ©e au dÃƒÂ©but de la rÃƒÂ©vÃƒÂ©lation (avant re-render)
    let savedSourceRect = null;
    if (isRevealed && summonCard?.uid) {
        savedSourceRect = savedRevealedCardRects.get(summonCard.uid) || null;
        // NE PAS supprimer du cache ici Ã¢â‚¬â€ la carte reste cachÃƒÂ©e dans le DOM
        // tant que l'animation n'est pas terminÃƒÂ©e (state updates peuvent re-render)
    }

    // Pour les crÃƒÂ©atures non rÃƒÂ©vÃƒÂ©lÃƒÂ©es : prendre le dos de carte directement du DOM
    // (renderOppHand est gelÃƒÂ© pendant les summons, donc les cartes sont encore lÃƒÂ )
    // Filtrer les cartes visibles (les cachÃƒÂ©es ont dÃƒÂ©jÃƒÂ  ÃƒÂ©tÃƒÂ© "prises" par une animation prÃƒÂ©cÃƒÂ©dente)
    if (!savedSourceRect && data.visualHandIndex >= 0) {
        const hp = document.getElementById('opp-hand');
        const allCards = hp ? hp.querySelectorAll('.opp-card-back') : [];
        const hc = [...allCards].filter(c => c.style.visibility !== 'hidden');
        if (data.visualHandIndex < hc.length) {
            savedSourceRect = hc[data.visualHandIndex].getBoundingClientRect();
            hc[data.visualHandIndex].style.visibility = 'hidden'; // Cacher sans reflow
            smoothCloseOppHandGap(hc[data.visualHandIndex]);
        } else if (savedOppHandRects && data.visualHandIndex < savedOppHandRects.length) {
            savedSourceRect = savedOppHandRects[data.visualHandIndex];
        }
    }

    // Phase 1 : carte vole de la main adverse vers le slot (300ms)
    // Si rÃƒÂ©vÃƒÂ©lÃƒÂ©e, la carte vole face visible depuis sa position sauvegardÃƒÂ©e
    flyFromOppHand(rect, 300, isRevealed ? summonCard : null, savedSourceRect).then(() => {
        if (isRevealed) {
            // Carte dÃƒÂ©jÃƒÂ  rÃƒÂ©vÃƒÂ©lÃƒÂ©e Ã¢â€ â€™ pas de flip, juste lever + poser face visible
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `
                position: fixed; z-index: 2000; pointer-events: none;
                left: ${rect.left}px; top: ${rect.top}px;
                width: ${cw}px; height: ${ch}px;
            `;

            const revealedCard = getRenderableSummonCard(true) || summonCard;
            if (!revealedCard) {
                finishOverlay(wrapper);
                return;
            }
            const cardEl = makeCard(revealedCard, false);
            cardEl.classList.add('summon-anim-card');
            const bgImage = cardEl.style.backgroundImage;
            cardEl.style.position = 'absolute';
            cardEl.style.top = '0';
            cardEl.style.left = '0';
            cardEl.style.width = '100%';
            cardEl.style.height = '100%';
            cardEl.style.margin = '0';
            if (bgImage) cardEl.style.backgroundImage = bgImage;

            wrapper.appendChild(cardEl);
            document.body.appendChild(wrapper);

            const liftDur = 180;
            const settleDur = 180;
            const liftPx = 25;
            const startY = rect.top;
            const t0 = performance.now();
            function easeInCubic(t) { return t * t * t; }

            function animate() {
                const elapsed = performance.now() - t0;
                if (elapsed < liftDur) {
                    const p = easeOutCubic(elapsed / liftDur);
                    wrapper.style.top = (startY - liftPx * p) + 'px';
                } else if (elapsed < liftDur + settleDur) {
                    const p = easeInCubic((elapsed - liftDur) / settleDur);
                    wrapper.style.top = (startY - liftPx + liftPx * p) + 'px';
                } else {
                    // Poser visuellement la carte puis attendre le state serveur avant unlock du slot.
                    if (summonCard?.uid) savedRevealedCardRects.delete(summonCard.uid);
                    finishOverlay(wrapper);
                    return;
                }
                requestAnimationFrame(animate);
            }
            requestAnimationFrame(animate);

        } else {
            // Carte cachÃƒÂ©e Ã¢â€ â€™ flip classique dos Ã¢â€ â€™ face
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `
                position: fixed; z-index: 2000; pointer-events: none;
                left: ${rect.left}px; top: ${rect.top}px;
                width: ${cw}px; height: ${ch}px;
                perspective: 800px;
            `;

            const flipInner = document.createElement('div');
            flipInner.style.cssText = `
                width: 100%; height: 100%;
                position: relative; transform-style: preserve-3d;
            `;

            const backFace = document.createElement('div');
            backFace.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%; margin: 0;
                border-radius: 6px; overflow: hidden;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                backface-visibility: hidden;
            `;
            const backImg = document.createElement('img');
            backImg.src = 'cardback/back_1.png';
            backImg.style.cssText = 'width: 100%; height: 100%; display: block;';
            backFace.appendChild(backImg);

            const faceCard = getRenderableSummonCard(true) || summonCard;
            let cardEl;
            if (faceCard) {
                cardEl = makeCard(faceCard, false);
                cardEl.classList.add('summon-anim-card');
                const bgImage = cardEl.style.backgroundImage;
                cardEl.style.position = 'absolute';
                cardEl.style.top = '0';
                cardEl.style.left = '0';
                cardEl.style.width = '100%';
                cardEl.style.height = '100%';
                cardEl.style.margin = '0';
                cardEl.style.backfaceVisibility = 'hidden';
                cardEl.style.transform = 'rotateY(180deg)';
                if (bgImage) cardEl.style.backgroundImage = bgImage;
            } else {
                // Safety fallback: never show "undefined" text on incomplete payloads.
                cardEl = document.createElement('div');
                cardEl.style.cssText = `
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; margin: 0;
                    border-radius: 6px; overflow: hidden; backface-visibility: hidden; transform: rotateY(180deg);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                `;
                const faceImg = document.createElement('img');
                faceImg.src = 'cardback/back_1.png';
                faceImg.style.cssText = 'width: 100%; height: 100%; display: block;';
                cardEl.appendChild(faceImg);
            }

            flipInner.appendChild(backFace);
            flipInner.appendChild(cardEl);
            wrapper.appendChild(flipInner);
            document.body.appendChild(wrapper);

            const liftDur = 180;
            const flipDur = 380;
            const settleDur = 180;
            const liftPx = 25;
            const startY = rect.top;
            const t0 = performance.now();

            function easeInOutQuad(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }
            function easeInCubic(t) { return t * t * t; }

            function animate() {
                const elapsed = performance.now() - t0;
                if (elapsed < liftDur) {
                    const p = easeOutCubic(elapsed / liftDur);
                    wrapper.style.top = (startY - liftPx * p) + 'px';
                } else if (elapsed < liftDur + flipDur) {
                    wrapper.style.top = (startY - liftPx) + 'px';
                    const p = easeInOutQuad((elapsed - liftDur) / flipDur);
                    flipInner.style.transform = `rotateY(${180 * p}deg)`;
                } else if (elapsed < liftDur + flipDur + settleDur) {
                    flipInner.style.transform = 'rotateY(180deg)';
                    const p = easeInCubic((elapsed - liftDur - flipDur) / settleDur);
                    wrapper.style.top = (startY - liftPx + liftPx * p) + 'px';
                } else {
                    // Poser visuellement la carte puis attendre le state serveur avant unlock du slot.
                    finishOverlay(wrapper);
                    return;
                }
                requestAnimationFrame(animate);
            }
            requestAnimationFrame(animate);
        }
    }).catch(() => {
        animatingSlots.delete(slotKey);
        resolve();
    });
    });
}

/**
 * Anime une carte face visible volant du cimetiÃƒÂ¨re vers une position cible.
 * MÃƒÂªme pattern que flyFromOppHand mais partant du cimetiÃƒÂ¨re, carte visible.
 */
function flyFromGraveyardFaceUp(owner, targetRect, card, duration = 500, targetSlot = null) {
    return new Promise(resolve => {
        const graveEl = document.getElementById(owner + '-grave-box');
        const board = document.querySelector('.game-board');
        if (!graveEl || !board) { resolve(); return; }

        // Position relative au board (coordonnÃƒÂ©es locales, dans le contexte 3D)
        function getBoardOffset(el) {
            let x = 0, y = 0;
            while (el && el !== board) {
                x += el.offsetLeft - el.scrollLeft;
                y += el.offsetTop - el.scrollTop;
                el = el.offsetParent;
            }
            return { x, y };
        }

        const graveOff = getBoardOffset(graveEl);
        const cardW = graveEl.offsetWidth;
        const cardH = graveEl.offsetHeight;

        // Position cible (slot sur le board)
        let endOff;
        if (targetSlot) {
            endOff = getBoardOffset(targetSlot);
        } else {
            // Fallback viewport
            const boardRect = board.getBoundingClientRect();
            endOff = { x: targetRect.left - boardRect.left, y: targetRect.top - boardRect.top };
        }

        const startX = graveOff.x;
        const startY = graveOff.y;

        // CrÃƒÂ©er la carte DANS le board Ã¢â€ â€™ hÃƒÂ©rite perspective + rotateX naturellement
        const flyCard = document.createElement('div');
        flyCard.style.cssText = `
            position: absolute; z-index: 1000; pointer-events: none; overflow: hidden;
            left: ${startX}px; top: ${startY}px;
            width: ${cardW}px; height: ${cardH}px;
            border-radius: 6px;
        `;

        const cardEl = makeCard(card, false);
        cardEl.style.cssText = 'width: 100%; height: 100%; margin: 0; position: relative; border-radius: 6px;';
        if (card.image) {
            cardEl.style.backgroundImage = `url('/cards/${card.image}')`;
            cardEl.style.backgroundSize = 'cover';
            cardEl.style.backgroundPosition = 'center';
        }
        flyCard.appendChild(cardEl);
        board.appendChild(flyCard);

        // --- DEBUG REANIMATE ---
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] card: ${card.name}, owner: ${owner}`);
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] IN BOARD Ã¢â‚¬â€ graveOff: (${startX}, ${startY}), cardSize: ${cardW}x${cardH}`);
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] endOff: (${endOff.x}, ${endOff.y})`);

        // === Ãƒâ€°TAPE 1 : Extraire vers le haut (350ms) ===
        // Monte dans l'espace local du board (vers le hÃƒÂ©ros = Y dÃƒÂ©croissant)
        const extractEndY = startY - cardH - 50;
        const extractDistance = startY - extractEndY;
        const extractDur = 350;

        // Clip : masquer la partie encore "dans" le cimetiÃƒÂ¨re
        flyCard.style.clipPath = `inset(0 0 ${cardH}px 0)`;
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] EXTRACT: from Y=${startY} to Y=${extractEndY}, dist=${extractDistance}`);

        let logCnt = 0;
        const extractT0 = performance.now();
        function extractUp() {
            const p = Math.min((performance.now() - extractT0) / extractDur, 1);
            const ep = easeOutCubic(p);
            const curY = startY - ep * extractDistance;
            flyCard.style.top = curY + 'px';

            // Clip : tout ce qui dÃƒÂ©passe sous startY (= top du cimetiÃƒÂ¨re)
            const belowGrave = Math.max(0, (curY + cardH) - startY);
            flyCard.style.clipPath = belowGrave > 0.5 ? `inset(0 0 ${belowGrave}px 0)` : 'none';

            if (logCnt++ % 6 === 0) {
                if (window.DEBUG_LOGS) console.log(`[REANIMATE] EXTRACT: p=${p.toFixed(2)}, Y=${curY.toFixed(0)}, clip=${belowGrave.toFixed(0)}, vis=${(cardH - belowGrave).toFixed(0)}/${cardH}`);
            }

            if (p < 1) {
                requestAnimationFrame(extractUp);
            } else {
                flyCard.style.clipPath = 'none';
                if (window.DEBUG_LOGS) console.log(`[REANIMATE] EXTRACT done at Y=${curY.toFixed(0)}`);

                // === Ãƒâ€°TAPE 2 : Voler vers le slot cible ===
                const flyDur = Math.max(duration - extractDur, 350);

                const scx = startX + cardW / 2;
                const scy = extractEndY + cardH / 2;
                const ecx = endOff.x + cardW / 2;
                const ecy = endOff.y + cardH / 2;
                const ccx = (scx + ecx) / 2;
                const ccy = Math.min(scy, ecy) - 80;

                if (window.DEBUG_LOGS) console.log(`[REANIMATE] FLY: from (${scx}, ${scy}) to (${ecx}, ${ecy})`);

                const flyT0 = performance.now();
                function flyToSlot() {
                    const p2 = Math.min((performance.now() - flyT0) / flyDur, 1);
                    const t = easeInOutCubic(p2);

                    const cx = (1-t)*(1-t)*scx + 2*(1-t)*t*ccx + t*t*ecx;
                    const cy = (1-t)*(1-t)*scy + 2*(1-t)*t*ccy + t*t*ecy;

                    flyCard.style.left = (cx - cardW / 2) + 'px';
                    flyCard.style.top = (cy - cardH / 2) + 'px';

                    if (p2 < 1) {
                        requestAnimationFrame(flyToSlot);
                    } else {
                        flyCard.remove();
                        resolve();
                    }
                }
                requestAnimationFrame(flyToSlot);
            }
        }
        requestAnimationFrame(extractUp);
    });
}

// Animation d'invocation par piÃƒÂ¨ge Ã¢â‚¬â€ apparition magique directement dans le slot (hÃƒÂ©rite de la perspective 3D)
// SynchronisÃƒÂ©e avec createTrapSummonEffect (PixiJS VFX) :
//   Phase 0: 0-400ms      Energy gathering (VFX only, card invisible)
//   Phase 1: 400-800ms    Portal opens (VFX only, card invisible)
//   Phase 2: 800-1000ms   Flash & card materializes (card scale 0Ã¢â€ â€™1, brightness 3Ã¢â€ â€™1)
//   Phase 3: 1000-1500ms  Card settles with easeOutBack (card stable, glow fades)
//   Phase 4: 1500-2800ms  Idle shimmer (card done, VFX trails off)
function animateTrapSummon(data) {
    return new Promise((resolve) => {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);

        const slot = getSlot(owner, data.row, data.col);
        if (!slot) {
            animatingSlots.delete(slotKey);
            resolve();
            return;
        }

        const label = slot.querySelector('.slot-label');
        slot.innerHTML = '';
        if (label) slot.appendChild(label.cloneNode(true));
        slot.classList.remove('has-card');

        const rect = slot.getBoundingClientRect();

        CombatVFX.createTrapSummonEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            rect.width,
            rect.height
        );

        const cardEl = makeCard(data.card, false);
        cardEl.style.transformOrigin = 'center center';
        cardEl.style.transform = 'scale(0)';
        cardEl.style.opacity = '0';
        cardEl.style.filter = 'brightness(3) saturate(0)';
        cardEl.style.pointerEvents = 'none';
        slot.appendChild(cardEl);
        slot.classList.add('has-card');

        const summonNameFit = cardEl.querySelector('.arena-name');
        if (summonNameFit) fitArenaName(summonNameFit);

        const glow = document.createElement('div');
        glow.style.cssText = `
            position: absolute; inset: -20px; z-index: -1; border-radius: 12px;
            background: radial-gradient(ellipse at center, rgba(122,90,240,0.8) 0%, rgba(180,140,255,0.4) 40%, transparent 70%);
            opacity: 0; pointer-events: none; transform: scale(0.3);
        `;
        slot.appendChild(glow);

        const totalDur = 1500;
        const t0 = performance.now();

        function finishAndResolve() {
            const waitStart = performance.now();
            const waitMax = 3500;
            function waitForState() {
                const field = owner === 'me' ? state?.me?.field : state?.opponent?.field;
                const arrived = !!field?.[data.row]?.[data.col];
                if (arrived || (performance.now() - waitStart) > waitMax) {
                    animatingSlots.delete(slotKey);
                    render();
                    resolve();
                } else {
                    requestAnimationFrame(waitForState);
                }
            }
            waitForState();
        }

        function animate() {
            const elapsed = performance.now() - t0;
            const tMs = Math.min(elapsed, totalDur);

            if (tMs < 800) {
                const p = tMs / 800;
                glow.style.opacity = `${easeOutCubic(p) * 0.7}`;
                glow.style.transform = `scale(${0.3 + 0.9 * easeOutCubic(p)})`;
                cardEl.style.transform = 'scale(0)';
                cardEl.style.opacity = '0';
            } else if (tMs < 1000) {
                const p = (tMs - 800) / 200;
                const ep = easeOutCubic(p);

                cardEl.style.transform = `scale(${easeOutBack(p)})`;
                cardEl.style.opacity = `${Math.min(ep * 3, 1)}`;
                const brightness = 3 - 2 * ep;
                const saturate = ep;
                cardEl.style.filter = `brightness(${brightness}) saturate(${saturate})`;

                glow.style.opacity = `${0.7 + 0.3 * (1 - p)}`;
                glow.style.transform = 'scale(1.2)';
            } else {
                const p = (tMs - 1000) / 500;
                const ep = easeOutCubic(p);

                cardEl.style.transform = 'scale(1)';
                cardEl.style.opacity = '1';
                cardEl.style.filter = 'none';

                glow.style.opacity = `${0.7 * (1 - ep)}`;
                glow.style.transform = `scale(${1.2 + 0.4 * ep})`;
            }

            if (elapsed < totalDur) {
                requestAnimationFrame(animate);
            } else {
                glow.remove();
                cardEl.style.pointerEvents = '';
                cardEl.style.transformOrigin = '';
                cardEl.style.transform = '';
                cardEl.style.filter = '';
                finishAndResolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

function animateReanimate(data) {
    return new Promise((resolve) => {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;

        animatingSlots.add(slotKey);

        const slot = getSlot(owner, data.row, data.col);
        if (!slot) {
            animatingSlots.delete(slotKey);
            resolve();
            return;
        }

        const label = slot.querySelector('.slot-label');
        slot.innerHTML = '';
        if (label) slot.appendChild(label.cloneNode(true));
        slot.classList.remove('has-card');

        const rect = slot.getBoundingClientRect();

        flyFromGraveyardFaceUp(owner, rect, data.card, 500, slot).then(() => {
            const tempCard = makeCard(data.card, false);
            const isFlying = data.card.type === 'creature' && data.card.abilities?.includes('fly');
            if (isFlying) {
                tempCard.classList.add('flying-creature');
                slot.classList.add('has-flying');
                const now = performance.now();
                const offset = Math.sin(now * flyingAnimationSpeed) * flyingAnimationAmplitude;
                tempCard.style.transform = `translateY(${offset.toFixed(2)}px)`;
                startFlyingAnimation(tempCard);
            }
            slot.appendChild(tempCard);
            slot.classList.add('has-card');

            const waitStart = performance.now();
            const waitMax = 3500;
            function waitForState() {
                const field = owner === 'me' ? state?.me?.field : state?.opponent?.field;
                const arrived = !!field?.[data.row]?.[data.col];
                if (arrived || (performance.now() - waitStart) > waitMax) {
                    animatingSlots.delete(slotKey);
                    render();
                    if (isFlying) {
                        const newCardEl = slot.querySelector('.card.flying-creature');
                        if (newCardEl) {
                            const now = performance.now();
                            const offset = Math.sin(now * flyingAnimationSpeed) * flyingAnimationAmplitude;
                            newCardEl.style.transform = `translateY(${offset}px)`;
                        }
                    }
                    resolve();
                } else {
                    requestAnimationFrame(waitForState);
                }
            }
            waitForState();
        }).catch(() => {
            animatingSlots.delete(slotKey);
            resolve();
        });
    });
}

function animateMove(data) {
    return new Promise((resolve) => {
    // Animation de coup de vent pour ses propres crÃƒÂ©atures dÃƒÂ©placÃƒÂ©es
    // DÃƒÂ©lai pour synchroniser la fin avec l'animation adverse (slide Ã¢â€°Ë† 500ms, vent Ã¢â€°Ë† 480ms)
    if (data.player === myNum) {
        setTimeout(() => {
            const toSlot = getSlot('me', data.toRow, data.toCol);
            if (!toSlot) return;

            const rect = toSlot.getBoundingClientRect();
            const dx = data.toCol - data.fromCol;
            const dy = data.toRow - data.fromRow;
            const angle = Math.atan2(dy, dx);

            CombatVFX.createWindGustEffect(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                rect.width,
                rect.height,
                angle
            );
        }, 20);
        setTimeout(resolve, 520);
        return;
    }

    const owner = 'opp';

    const fromKey = `${owner}-${data.fromRow}-${data.fromCol}`;
    const toKey = `${owner}-${data.toRow}-${data.toCol}`;

    const fromSlot = getSlot(owner, data.fromRow, data.fromCol);
    const toSlot = getSlot(owner, data.toRow, data.toCol);

    if (!fromSlot || !toSlot) {
        resolve();
        return;
    }

    // Forcer render() AVANT de bloquer les slots (pour afficher les mises ÃƒÂ  jour en attente, ex: poison)
    render();

    // Bloquer les deux slots (origine et destination)
    animatingSlots.add(fromKey);
    animatingSlots.add(toKey);

    // Vider les DEUX slots immÃƒÂ©diatement (pour ÃƒÂ©viter le doublon visuel)
    const labelFrom = fromSlot.querySelector('.slot-label');
    fromSlot.innerHTML = '';
    if (labelFrom) fromSlot.appendChild(labelFrom.cloneNode(true));
    fromSlot.classList.remove('has-card');

    const labelTo = toSlot.querySelector('.slot-label');
    toSlot.innerHTML = '';
    if (labelTo) toSlot.appendChild(labelTo.cloneNode(true));
    toSlot.classList.remove('has-card');

    // RÃƒÂ©cupÃƒÂ©rer les positions
    const fromRect = fromSlot.getBoundingClientRect();
    const toRect = toSlot.getBoundingClientRect();
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;

    // CrÃƒÂ©er une carte overlay (makeCard met le backgroundImage en inline, on ne doit pas l'ÃƒÂ©craser)
    const movingCard = makeCard(data.card, false);
    movingCard.style.position = 'fixed';
    movingCard.style.left = fromRect.left + 'px';
    movingCard.style.top = fromRect.top + 'px';
    movingCard.style.width = fromRect.width + 'px';
    movingCard.style.height = fromRect.height + 'px';
    movingCard.style.zIndex = '3000';
    movingCard.style.pointerEvents = 'none';
    movingCard.style.transform = 'translate3d(0px, 0px, 0px)';
    movingCard.style.transition = 'transform 0.5s ease-in-out';

    document.body.appendChild(movingCard);

    // Forcer le reflow puis dÃƒÂ©clencher la transition via transform
    movingCard.getBoundingClientRect();
    requestAnimationFrame(() => {
        movingCard.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    });

    // Nettoyer aprÃƒÂ¨s l'animation (500ms transition + 100ms marge)
    setTimeout(() => {
        // DÃƒÂ©bloquer et render AVANT de supprimer l'overlay
        // pour ÃƒÂ©viter un flash sans jeton buff
        animatingSlots.delete(fromKey);
        animatingSlots.delete(toKey);
        render();
        movingCard.remove();
        resolve();
    }, 600);
    });
}




