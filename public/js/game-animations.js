// ==================== SYSTÃƒÆ’Ã‹â€ ME D'ANIMATIONS DU JEU ====================
// File d'attente, handlers combat/mort/sort/piÃƒÆ’Ã‚Â¨ge, effets visuels

// === Smooth close du trou dans la main adverse aprÃƒÆ’Ã‚Â¨s hide d'une carte ===
// Collapse la carte cachÃƒÆ’Ã‚Â©e (widthÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢0, marginÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢0) pour que le flexbox ferme le trou naturellement
function smoothCloseOppHandGap(hiddenCard) {
    if (!hiddenCard) return;
    hiddenCard.style.transition = 'width 0.3s ease-out, margin-left 0.3s ease-out';
    hiddenCard.style.width = '0px';
    hiddenCard.style.marginLeft = '0px';
    hiddenCard.style.overflow = 'hidden';
}

// === Mise ÃƒÆ’Ã‚Â  jour dynamique de la popup cimetiÃƒÆ’Ã‚Â¨re ===
function addCardToGraveyardPopup(owner, card) {
    const popup = document.getElementById('graveyard-popup');
    if (!popup || !popup.classList.contains('active')) return;
    if (popup.dataset.owner !== owner) return;
    // Ne pas ajouter pendant la sÃƒÆ’Ã‚Â©lection de rÃƒÆ’Ã‚Â©animation
    if (popup.classList.contains('selection-mode')) return;

    const container = document.getElementById('graveyard-cards');
    if (!container) return;

    // Retirer le message "vide" si prÃƒÆ’Ã‚Â©sent
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

    // Animation d'entrÃƒÆ’Ã‚Â©e
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'translateY(12px) scale(0.92)';
    cardEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    container.appendChild(cardEl);

    const nameEl = cardEl.querySelector('.arena-name');
    if (nameEl) fitArenaName(nameEl);

    // DÃƒÆ’Ã‚Â©clencher l'animation au frame suivant
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

// Cache des positions des cartes revealed dans la main adverse (sauvegardÃƒÆ’Ã‚Â© avant re-render de rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lation)
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

// Initialiser le systÃƒÆ’Ã‚Â¨me d'animation
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
    if (window.HAND_INDEX_DEBUG) {
        const isOppSpell = type === 'spell' && data?.caster !== myNum;
        const isOppSummon = type === 'summon' && data?.player !== myNum;
        const isOppTrapPlace = type === 'trapPlace' && data?.player !== myNum;
        if (isOppSpell || isOppSummon || isOppTrapPlace) {
            _oppPlayDbg('queue', {
                type,
                player: data?.player ?? null,
                caster: data?.caster ?? null,
                visualHandIndex: Number.isFinite(Number(data?.visualHandIndex)) ? Number(data.visualHandIndex) : null,
                handIndex: _isValidHandIndex(data?.handIndex) ? Number(data.handIndex) : null,
                originalHandIndex: _isValidHandIndex(data?.originalHandIndex) ? Number(data.originalHandIndex) : null,
                reconstructedHandIndex: _isValidHandIndex(data?.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
                row: Number.isFinite(Number(data?.row)) ? Number(data.row) : null,
                col: Number.isFinite(Number(data?.col)) ? Number(data.col) : null,
                cardUid: data?.spell?.uid || data?.spell?.id || data?.card?.uid || data?.card?.id || null,
                cardName: data?.spell?.name || data?.card?.name || null
            });
        }
    }

    // Pour zdejebel et onDeathDamage hÃƒÆ’Ã‚Â©ros, capturer les HP actuels AVANT que render() ne les mette ÃƒÆ’Ã‚Â  jour
    if ((type === 'zdejebel' || (type === 'onDeathDamage' && data.targetRow === undefined)) && state) {
        const target = data.targetPlayer === myNum ? 'me' : 'opp';
        const currentDisplayedHp = target === 'me' ? state.me?.hp : state.opponent?.hp;
        data._displayHpBefore = currentDisplayedHp;
    }

    // Pour burn, death, sacrifice, spell, trapTrigger, bloquer le render du cimetiÃƒÆ’Ã‚Â¨re IMMÃƒÆ’Ã¢â‚¬Â°DIATEMENT
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

    // Pour deathTransform, bloquer le slot IMMÃƒÆ’Ã¢â‚¬Â°DIATEMENT pour que render() ne remplace pas la carte
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
        _bounceDbg('queue:bounce', {
            owner,
            handIndex: data.handIndex ?? null,
            cardUid: data.card?.uid || data.card?.id || null,
            cardName: data.card?.name || null,
            row: data.row,
            col: data.col,
            toGraveyard: !!data.toGraveyard
        });

        // PrÃƒÆ’Ã‚Â©-enregistrer pendingBounce au moment du queue (mÃƒÆ’Ã‚Âªme technique que graveyardReturn)
        // pour que render() cache la carte en main AVANT que l'animation ne dÃƒÆ’Ã‚Â©marre.
        // Sans ÃƒÆ’Ã‚Â§a, dans les parties longues avec beaucoup d'animations dans la queue,
        // le state arrive et render() montre la carte en main avant que bounce ne dÃƒÆ’Ã‚Â©marre.
        if (!data.toGraveyard && !pendingBounce) {
            const handPanel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
            const startHandCount = handPanel
                ? handPanel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back').length
                : 0;
            data._bounceTargetPromise = new Promise(resolve => {
                pendingBounce = {
                    owner,
                    card: data.card,
                    handIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                    expectAtEnd: owner === 'me',
                    resolveTarget: resolve,
                    startHandCount,
                    queued: true
                };
                _bounceDbg('queue:bounce:pending-created', {
                    owner,
                    handIndex: pendingBounce.handIndex,
                    startHandCount,
                    cardUid: pendingBounce.card?.uid || pendingBounce.card?.id || null
                });
            });
        }
    }

    // Pour onDeathDamage crÃƒÆ’Ã‚Â©ature (Torche vivante), bloquer le slot pour que render()
    // ne retire pas la carte avant que l'animation de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts ne joue
    if (type === 'onDeathDamage' && data.targetRow !== undefined && data.targetCol !== undefined) {
        const owner = data.targetPlayer === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.add(slotKey);
    }

    // Pour lifesteal, capturer les HP ACTUELS (avant le heal) ET bloquer le slot immÃƒÆ’Ã‚Â©diatement
    // pour que render() ne puisse pas mettre ÃƒÆ’Ã‚Â  jour les HP avec le state soignÃƒÆ’Ã‚Â© avant l'animation
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
        // Pour heroHeal (lifelink), capturer les HP du hÃƒÆ’Ã‚Â©ros et bloquer render()
        if (data.heroHeal) {
            const hpEl = document.querySelector(`#${owner === 'me' ? 'me' : 'opp'}-hp .hero-hp-number`);
            data._preHeroHp = hpEl ? parseInt(hpEl.textContent) : undefined;
            lifestealHeroHealInProgress = true;
        }
    }

    // Pour heroHeal (hors lifesteal), capturer aussi les HP hÃƒÆ’Ã‚Â©ros affichÃƒÆ’Ã‚Â©s
    if (type === 'heroHeal' && data.player !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const hpEl = document.querySelector(`#${owner === 'me' ? 'me' : 'opp'}-hp .hero-hp-number`);
        data._preHeroHp = hpEl ? parseInt(hpEl.textContent) : undefined;
        lifestealHeroHealInProgress = true;
        if (window.DEBUG_LOGS) console.log(`[EREBETH-DBG] queue heroHeal owner=${owner} amount=${data.amount} preHeroHp=${data._preHeroHp}`);
    }

    // Pour regen, capturer les HP ACTUELS (avant le heal) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â mÃƒÆ’Ã‚Âªme technique que lifesteal
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

    // Pour graveyardReturn, prÃƒÆ’Ã‚Â©-enregistrer pendingBounce au moment du queue
    // pour que render() cache la carte AVANT que l'animation ne commence ÃƒÆ’Ã‚Â  jouer
    // (sinon la carte flash visible entre l'arrivÃƒÆ’Ã‚Â©e du state et le dÃƒÆ’Ã‚Â©but de l'animation)
    if (type === 'graveyardReturn' && data.player !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        _bounceDbg('queue:graveyardReturn', {
            owner,
            handIndex: data.handIndex ?? null,
            cardUid: data.card?.uid || data.card?.id || null,
            cardName: data.card?.name || null
        });
        if (!pendingBounce) {
            const handPanel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
            const startHandCount = handPanel
                ? handPanel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back').length
                : 0;
            data._bounceTargetPromise = new Promise(resolve => {
                pendingBounce = {
                    owner,
                    card: data.card,
                    handIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                    expectAtEnd: owner === 'me',
                    resolveTarget: resolve,
                    startHandCount,
                    queued: true
                };
                _bounceDbg('queue:graveyardReturn:pending-created', {
                    owner,
                    handIndex: pendingBounce.handIndex,
                    startHandCount,
                    cardUid: pendingBounce.card?.uid || pendingBounce.card?.id || null
                });
            });
        }
    }

    // Pour healOnDeath, capturer les HP ACTUELS (avant le heal) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â mÃƒÆ’Ã‚Âªme technique que lifesteal
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

    // Pour damage/spellDamage, bloquer le slot pour que render() ne mette pas ÃƒÆ’Ã‚Â  jour
    // les stats (HP, ATK via Puissance) avant que l'animation de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts ne joue
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

    // Pour attack, bloquer le(s) slot(s) de l'attaquant pour que render() ne recrÃƒÆ’Ã‚Â©e pas
    // l'ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ment DOM pendant l'animation de charge/retour
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
            // Bloquer aussi la cible pour ÃƒÆ’Ã‚Â©viter l'update HP avant l'impact visuel.
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
    // Soupape de sÃƒÆ’Ã‚Â©curitÃƒÆ’Ã‚Â© : si la queue dÃƒÆ’Ã‚Â©passe 100, vider les animations non-critiques
    if (animationQueue.length > 100) {
        const critical = new Set(['death', 'deathTransform', 'heroHit', 'zdejebel', 'trampleHeroHit']);
        for (let i = animationQueue.length - 1; i >= 0; i--) {
            if (!critical.has(animationQueue[i].type)) {
                const purged = animationQueue[i];
                // Nettoyer animatingSlots et graveRenderBlocked pour les animations purgÃƒÆ’Ã‚Â©es
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
        // Pour les types batchables (burn, death), diffÃƒÆ’Ã‚Â©rer le dÃƒÆ’Ã‚Â©marrage
        // pour laisser les events du mÃƒÆ’Ã‚Âªme batch serveur arriver
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
    // GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rer un ID unique pour ce processeur
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
        // VÃƒÆ’Ã‚Â©rifier si un autre processeur a pris le relais
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
            // Lancer les animations de pioche en attente (bloquÃƒÆ’Ã‚Â©es pendant les combats)
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

        // Regrouper les animations de mort et transformation consÃƒÆ’Ã‚Â©cutives (jouÃƒÆ’Ã‚Â©es en parallÃƒÆ’Ã‚Â¨le)
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

        // Regrouper les animations zdejebel consÃƒÆ’Ã‚Â©cutives (jouÃƒÆ’Ã‚Â©es en parallÃƒÆ’Ã‚Â¨le)
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

        // Jouer les animations de burn consÃƒÆ’Ã‚Â©cutives une par une (sÃƒÆ’Ã‚Â©quentiellement)
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

        // Regrouper les animations de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts de sort consÃƒÆ’Ã‚Â©cutives en batch
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
            // DÃƒÆ’Ã‚Â©bloquer les slots de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts de sort aprÃƒÆ’Ã‚Â¨s les animations
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
            render(); // Mettre ÃƒÆ’Ã‚Â  jour les stats visuellement aprÃƒÆ’Ã‚Â¨s dÃƒÆ’Ã‚Â©blocage des slots
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.damage));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations poisonDamage consÃƒÆ’Ã‚Â©cutives (jouÃƒÆ’Ã‚Â©es en parallÃƒÆ’Ã‚Â¨le)
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

        // Regrouper les animations onDeathDamage consÃƒÆ’Ã‚Â©cutives (jouÃƒÆ’Ã‚Â©es en parallÃƒÆ’Ã‚Â¨le)
        if (animationQueue[0].type === 'onDeathDamage') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'onDeathDamage') {
                batch.push(animationQueue.shift().data);
            }
            // Bloquer le render HP pour toute la durÃƒÆ’Ã‚Â©e du batch
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
            // DÃƒÆ’Ã‚Â©bloquer aprÃƒÆ’Ã‚Â¨s TOUTES les animations
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

        // ExÃƒÆ’Ã‚Â©cuter l'animation avec timeout de sÃƒÆ’Ã‚Â©curitÃƒÆ’Ã‚Â©
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

        // DÃƒÆ’Ã‚Â©bloquer les slots d'attaquant aprÃƒÆ’Ã‚Â¨s l'animation d'attaque
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
            render(); // Mettre ÃƒÆ’Ã‚Â  jour les stats visuellement aprÃƒÆ’Ã‚Â¨s l'attaque (dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts mutuels simultanÃƒÆ’Ã‚Â©s)
        }

        // DÃƒÆ’Ã‚Â©bloquer les slots de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts aprÃƒÆ’Ã‚Â¨s l'animation
        // SAUF si une animation de mort est en attente pour ce slot (elle a besoin de la carte dans le DOM)
        if (type === 'damage' || type === 'spellDamage') {
            const dmgOwner = data.player === myNum ? 'me' : 'opp';
            const dmgSlotKey = `${dmgOwner}-${data.row}-${data.col}`;
            // Garder le slot bloquÃƒÆ’Ã‚Â© si death en attente (lifesteal n'a plus besoin de bloquer)
            const hasPendingBlock = animationQueue.some(item =>
                item.type === 'death' && item.data &&
                (item.data.player === myNum ? 'me' : 'opp') === dmgOwner &&
                item.data.row === data.row && item.data.col === data.col
            );
            if (!hasPendingBlock) {
                animatingSlots.delete(dmgSlotKey);
                render(); // Mettre ÃƒÆ’Ã‚Â  jour les stats visuellement aprÃƒÆ’Ã‚Â¨s dÃƒÆ’Ã‚Â©blocage du slot
            } else {
            }
        }

        // DÃƒÆ’Ã‚Â©bloquer le slot aprÃƒÆ’Ã‚Â¨s l'animation lifesteal et mettre ÃƒÆ’Ã‚Â  jour le rendu
        if (type === 'lifesteal') {
            const lsOwner = data.player === myNum ? 'me' : 'opp';
            const lsSlotKey = `${lsOwner}-${data.row}-${data.col}`;
            animatingSlots.delete(lsSlotKey);
            render();
        }

        // DÃƒÆ’Ã‚Â©bloquer le slot aprÃƒÆ’Ã‚Â¨s l'animation healOnDeath et mettre ÃƒÆ’Ã‚Â  jour le rendu
        if (type === 'healOnDeath') {
            const hodOwner = data.player === myNum ? 'me' : 'opp';
            const hodSlotKey = `${hodOwner}-${data.row}-${data.col}`;
            animatingSlots.delete(hodSlotKey);
            render();
        }

        // DÃƒÆ’Ã‚Â©bloquer le slot aprÃƒÆ’Ã‚Â¨s l'animation regen et mettre ÃƒÆ’Ã‚Â  jour le rendu
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

        // AprÃƒÆ’Ã‚Â¨s powerBuff, forcer render() pour synchroniser l'ATK depuis l'ÃƒÆ’Ã‚Â©tat serveur
        if (type === 'powerBuff') {
            render();
        }

        if (type === 'combatEnd') {
            _releaseTrapWarningOnCombatEnd();
        }

        // VÃƒÆ’Ã‚Â©rifier encore si on est toujours le processeur actif
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

        // summon/move/trapPlace gÃƒÆ’Ã‚Â¨rent dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  leur propre timing interne.
        const usesInternalTiming = type === 'summon' || type === 'move' || type === 'trapPlace';
        if (!usesInternalTiming) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Continuer la file (avec le mÃƒÆ’Ã‚Âªme processorId)
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
            // Retirer le glow violet de toutes les cartes prÃƒÆ’Ã‚Â©cÃƒÆ’Ã‚Â©dentes
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
            // Laisser le glow apparaÃƒÆ’Ã‚Â®tre avant l'animation suivante
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

    // Animer le chiffre ATK de fromAtk ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ toAtk
    if (atkEl) {
        atkEl.textContent = String(fromAtk);
        atkEl.classList.add('boosted');
        await new Promise(r => setTimeout(r, 400));
        atkEl.textContent = String(toAtk);
    }

    // DÃƒÆ’Ã‚Â©bloquer le render ATK pour ce slot
    powerBuffAtkOverrides.delete(slotKey);

    await new Promise(r => setTimeout(r, 400));
}

async function handlePixiAttack(data) {
    const attackerOwner = data.attacker === myNum ? 'me' : 'opp';
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const attackEventTs = data._queuedAt;

    // Cas spÃƒÆ’Ã‚Â©cial : Tireur vs Volant (simultanÃƒÆ’Ã‚Â© - projectile touche le volant en mouvement)
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

    // Attaques parallÃƒÆ’Ã‚Â¨les : deux crÃƒÆ’Ã‚Â©atures attaquent des cibles diffÃƒÆ’Ã‚Â©rentes en mÃƒÆ’Ã‚Âªme temps
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

    // Combat mutuel tireurs = deux projectiles croisÃƒÆ’Ã‚Â©s simultanÃƒÆ’Ã‚Â©s
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

    // Combat mutuel mÃƒÆ’Ã‚ÂªlÃƒÆ’Ã‚Â©e = les deux se rencontrent au milieu (50/50)
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

    // Tireur simple = projectile avec griffure ÃƒÆ’Ã‚Â  l'impact
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

    // Attaque solo (volant ou mÃƒÆ’Ã‚ÂªlÃƒÆ’Ã‚Â©e) = charge vers la cible avec griffure
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
    
    // Si les griffures ont dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  ÃƒÆ’Ã‚Â©tÃƒÆ’Ã‚Â© affichÃƒÆ’Ã‚Â©es par l'animation de combat, skip
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

    // Lire le HP prÃƒÆ’Ã‚Â©-poison depuis l'override ou le DOM
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

    // S'assurer que le HP affichÃƒÆ’Ã‚Â© est le prÃƒÆ’Ã‚Â©-poison avant le VFX
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

    // Mettre ÃƒÆ’Ã‚Â  jour le HP directement dans le DOM (post-poison)
    if (hpEl) {
        hpEl.textContent = String(newHp);
        hpEl.classList.remove('boosted');
        hpEl.classList.add('reduced');
    }

    // Marquer l'override comme consommÃƒÆ’Ã‚Â© avec le nouveau HP
    poisonHpOverrides.set(slotKey, {
        hp: newHp,
        consumed: true,
        uid: cardUid,
        updatedAt: Date.now()
    });

    // DÃƒÆ’Ã‚Â©bloquer le slot et rafraÃƒÆ’Ã‚Â®chir le rendu
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

    // Garder les HP d'avant pendant l'animation de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts
    _setHeroHpText(hpElement, hpBefore);

    // Pour les sorts/effets : afficher le VFX (shake + explosion + chiffre)
    // Pour les crÃƒÆ’Ã‚Â©atures : dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  fait par animateSoloAttack ÃƒÆ’Ã‚Â  l'impact
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

    // Mettre ÃƒÆ’Ã‚Â  jour les HP APRÃƒÆ’Ã‹â€ S l'animation
    _setHeroHpText(hpElement, hpAfter);

    // DÃƒÆ’Ã‚Â©bloquer render()
    zdejebelAnimationInProgress = false;
}

async function handleOnDeathDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Cas 1 : dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts ÃƒÆ’Ã‚Â  une crÃƒÆ’Ã‚Â©ature (damageKiller ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Torche vivante)
    if (data.targetRow !== undefined && data.targetCol !== undefined) {
        const slot = document.querySelector(
            `.card-slot[data-owner="${owner}"][data-row="${data.targetRow}"][data-col="${data.targetCol}"]`
        );
        if (slot) {
            // Secousse sur le slot
            slot.style.animation = 'slotShake 0.5s ease-out';
            setTimeout(() => slot.style.animation = '', 500);

            // Flash orange DOM (hÃƒÆ’Ã‚Â©rite de la perspective 3D)
            slot.classList.add('slot-hit');
            setTimeout(() => slot.classList.remove('slot-hit'), 500);

            // Slash VFX + onde de choc + ÃƒÆ’Ã‚Â©tincelles PixiJS
            const rect = slot.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            CombatVFX.createSlashEffect(x, y, data.damage);
            CombatVFX.createSlotHitEffect(x, y, rect.width, rect.height);
        }
        await new Promise(r => setTimeout(r, 600));

        // DÃƒÆ’Ã‚Â©bloquer le slot aprÃƒÆ’Ã‚Â¨s l'animation ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â la carte a ÃƒÆ’Ã‚Â©tÃƒÆ’Ã‚Â© visible pendant les dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.delete(slotKey);
        return;
    }

    // Cas 2 : dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts au hÃƒÆ’Ã‚Â©ros (damageHero ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Dragon CrÃƒÆ’Ã‚Â©pitant) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â style Zdejebel
    zdejebelAnimationInProgress = true;

    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    // PrÃƒÆ’Ã‚Â©server les HP d'avant l'animation
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const currentHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
    const hpBeforeAnimation = data._displayHpBefore ?? (currentHp !== undefined ? currentHp + data.damage : undefined);

    if (hpBeforeAnimation !== undefined) {
        _setHeroHpText(hpElement, hpBeforeAnimation);
    }

    if (heroCard) {
        // Secousse + flash rouge DOM sur le hÃƒÆ’Ã‚Â©ros
        heroCard.style.animation = 'heroShake 0.5s ease-out';
        heroCard.classList.add('hero-hit');
        setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

        // Slash VFX + ring/ÃƒÆ’Ã‚Â©tincelles PixiJS
        const rect = heroCard.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        CombatVFX.createSlashEffect(cx, cy, data.damage);
        CombatVFX.createHeroHitEffect(cx, cy, rect.width, rect.height);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÆ’Ã‚Â  jour les HP APRÃƒÆ’Ã‹â€ S l'animation
    if (currentHp !== undefined) {
        _setHeroHpText(hpElement, currentHp);
    }

    // DÃƒÆ’Ã‚Â©bloquer render()
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

    // S'assurer que les HP d'avant sont affichÃƒÆ’Ã‚Â©s pendant l'animation
    _setHeroHpText(hpElement, hpBefore);

    // RÃƒÆ’Ã‚Â©cupÃƒÆ’Ã‚Â©rer la position du hÃƒÆ’Ã‚Â©ros ciblÃƒÆ’Ã‚Â©
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (heroCard) {
        // Secousse + flash rouge DOM sur le hÃƒÆ’Ã‚Â©ros
        heroCard.style.animation = 'heroShake 0.5s ease-out';
        heroCard.classList.add('hero-hit');
        setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

        // Slash VFX + ring/ÃƒÆ’Ã‚Â©tincelles PixiJS
        const rect = heroCard.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.createSlashEffect(x, y, data.damage);
        CombatVFX.createHeroHitEffect(x, y, rect.width, rect.height);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÆ’Ã‚Â  jour les HP APRÃƒÆ’Ã‹â€ S l'animation (hpBefore - damage, indÃƒÆ’Ã‚Â©pendant du state)
    _setHeroHpText(hpElement, hpAfter);

    // DÃƒÆ’Ã‚Â©bloquer render() pour les HP
    zdejebelAnimationInProgress = false;

    // Petit dÃƒÆ’Ã‚Â©lai supplÃƒÆ’Ã‚Â©mentaire pour voir le changement
    await new Promise(r => setTimeout(r, 200));
}

// Fonction utilitaire pour afficher un nombre de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts sur un ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ment
function showDamageNumber(element, damage) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.showDamageNumber(x, y, damage);
}

// Animation de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts de piÃƒÆ’Ã‚Â©tinement sur une crÃƒÆ’Ã‚Â©ature
async function animateTrampleDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    const card = slot?.querySelector('.card');

    if (!card) return;

    // Bloquer le slot pour que render() ne mette pas ÃƒÆ’Ã‚Â  jour les HP pendant l'animation
    const slotKey = `${owner}-${data.row}-${data.col}`;
    animatingSlots.add(slotKey);

    // Sauvegarder les HP d'avant dans l'affichage
    const hpEl = card.querySelector('.arena-armor') || card.querySelector('.arena-hp') || card.querySelector('.fa-hp') || card.querySelector('.img-hp');
    if (hpEl && data.hpBefore !== undefined) {
        hpEl.textContent = data.hpBefore;
    }
    // Pour le format ATK/HP combinÃƒÆ’Ã‚Â© dans arena-stats
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

    // Flash DOM (hÃƒÆ’Ã‚Â©rite de la perspective 3D)
    card.classList.add('card-damage-hit');
    setTimeout(() => card.classList.remove('card-damage-hit'), 420);

    // Slash VFX + ÃƒÆ’Ã‚Â©tincelles PixiJS
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createSlashEffect(x, y, data.amount);
    CombatVFX.createDamageFlashEffect(x, y, rect.width, rect.height);

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÆ’Ã‚Â  jour les HP APRÃƒÆ’Ã‹â€ S l'animation
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

    // DÃƒÆ’Ã‚Â©bloquer le slot
    animatingSlots.delete(slotKey);

    await new Promise(r => setTimeout(r, 200));
}

// Animation de dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts de piÃƒÆ’Ã‚Â©tinement sur le hÃƒÆ’Ã‚Â©ros
async function animateTrampleHeroHit(data) {
    const owner = data.defender === myNum ? 'me' : 'opp';
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (!heroCard) return;

    // Bloquer render() pour les HP du hÃƒÆ’Ã‚Â©ros (dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  bloquÃƒÆ’Ã‚Â© dÃƒÆ’Ã‚Â¨s la rÃƒÆ’Ã‚Â©ception, mais on s'assure)
    zdejebelAnimationInProgress = true;

    // Lire les HP directement depuis le DOM (ce que le joueur voit)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const domHp = hpElement ? parseInt(hpElement.textContent) : null;
    const hpBefore = domHp ?? ((owner === 'me' ? state?.me?.hp : state?.opponent?.hp) + data.damage);
    const hpAfter = hpBefore - data.damage;

    _setHeroHpText(hpElement, hpBefore);

    // Secousse + flash rouge DOM sur le hÃƒÆ’Ã‚Â©ros
    heroCard.style.animation = 'heroShake 0.5s ease-out';
    heroCard.classList.add('hero-hit');
    setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

    // Slash VFX + ring/ÃƒÆ’Ã‚Â©tincelles PixiJS
    const rect = heroCard.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createSlashEffect(x, y, data.damage);
    CombatVFX.createHeroHitEffect(x, y, rect.width, rect.height);

    await new Promise(r => setTimeout(r, 600));

    // Mettre ÃƒÆ’Ã‚Â  jour les HP APRÃƒÆ’Ã‹â€ S l'animation (hpBefore - damage, indÃƒÆ’Ã‚Â©pendant du state)
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
 * Animation de transformation ÃƒÆ’Ã‚Â  la mort (Petit Os ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Pile d'Os)
 * Flip 3D de la carte : la face avant (fromCard) se retourne pour rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©ler la face arriÃƒÆ’Ã‚Â¨re (toCard)
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

    // Retirer la carte du slot (garder la frame SVG + diamant central)
    _clearSlotContent(slot);
    slot.classList.remove('has-card', 'has-flying');

    // Flip directement dans le slot ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â le tilt du board s'applique naturellement
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

    // Face avant (Petit Os) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 144x192 + offset -2px pour couvrir la bordure du slot
    const frontFace = makeCard(data.fromCard, false);
    const frontBg = frontFace.style.backgroundImage;
    frontFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 144px; height: 192px; margin: 0;
        backface-visibility: hidden;
        border-color: rgba(255,255,255,0.4) !important;
    `;
    if (frontBg) frontFace.style.backgroundImage = frontBg;

    // Face arriÃƒÆ’Ã‚Â¨re ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â prÃƒÆ’Ã‚Â©-retournÃƒÆ’Ã‚Â©e de 180Ãƒâ€šÃ‚Â°
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

    // --- Animation flip (600ms) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â rotateY dans le slot ---
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

    // Nettoyer le slot (garder la frame SVG + diamant), placer la nouvelle carte
    _clearSlotContent(slot);
    const placedCard = makeCard(data.toCard, false);
    slot.appendChild(placedCard);
    slot.classList.add('has-card');

    // DÃƒÆ’Ã‚Â©bloquer le slot
    activeDeathTransformSlots.delete(slotKey);
    animatingSlots.delete(slotKey);
}

/**
 * Animation de transformation en dÃƒÆ’Ã‚Â©but de tour (Pile d'Os ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Petit Os)
 * Flip 3D inverse : la face avant (fromCard/Pile d'Os) se retourne pour rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©ler la face arriÃƒÆ’Ã‚Â¨re (toCard/Petit Os)
 */
/**
 * Animation de dÃƒÆ’Ã‚Â©fausse depuis la main (dÃƒÆ’Ã‚Â©sintÃƒÆ’Ã‚Â©gration sur place)
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

    // CrÃƒÆ’Ã‚Â©er un clone pour l'animation
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

    // Animation de dÃƒÆ’Ã‚Â©sintÃƒÆ’Ã‚Â©gration avec timeout de sÃƒÆ’Ã‚Â©curitÃƒÆ’Ã‚Â©
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
 * Phase 1 - Lift:    Dos de carte se soulÃƒÆ’Ã‚Â¨ve du deck
 * Phase 2 - Flip:    La carte se retourne prÃƒÆ’Ã‚Â¨s du deck (rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â¨le ce qui est brÃƒÆ’Ã‚Â»lÃƒÆ’Ã‚Â©)
 * Phase 3 - Hold:    Pause brÃƒÆ’Ã‚Â¨ve + teinte rouge (la carte est condamnÃƒÆ’Ã‚Â©e)
 * Phase 4 - Fly:     La carte vole vers le cimetiÃƒÆ’Ã‚Â¨re en rÃƒÆ’Ã‚Â©trÃƒÆ’Ã‚Â©cissant
 * Phase 5 - Impact:  Flash au cimetiÃƒÆ’Ã‚Â¨re, mise ÃƒÆ’Ã‚Â  jour du graveyard
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
    const boardRect = gameBoard.getBoundingClientRect();
    const revealX = Math.max(0, window.innerWidth / 2 - boardRect.left - cardWidth / 2);
    const revealY = Math.max(0, window.innerHeight / 2 - boardRect.top - cardHeight / 2 - 30);
    const deckRect = deckEl.getBoundingClientRect();
    const liftAmplitude = 30;
    const liftDeltaY = deckRect.top < (liftAmplitude + 8) ? liftAmplitude : -liftAmplitude;
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
                y = startY + ep * liftDeltaY;
                scale = 1 + ep * 0.05;
                opacity = 0.3 + ep * 0.7;
                flipDeg = 0;
                redTint = 0;
            } else if (progress <= t2) {
                const p = (progress - t1) / (t2 - t1);
                const ep = easeInOutCubic(p);
                x = startX + (revealX - startX) * ep;
                const liftEndY = startY + liftDeltaY;
                y = liftEndY + (revealY - liftEndY) * ep;
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
 * Animation de mort ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â la carte vole vers le cimetiÃƒÆ’Ã‚Â¨re (style Hearthstone/Arena)
 * Phase 1 - Death Mark (400ms) : greyscale progressif + lÃƒÆ’Ã‚Â©ger shrink
 * Phase 2 - Fly to Graveyard (500ms) : vol vers le cimetiÃƒÆ’Ã‚Â¨re avec perspective tilt
 */
async function animateDeathToGraveyard(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const ownerKey = owner;
    const deathSlotKey = `${owner}-${data.row}-${data.col}`;

    // graveRenderBlocked dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  incrÃƒÆ’Ã‚Â©mentÃƒÆ’Ã‚Â© par queueAnimation ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â pas de double add

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

    // 2. Positions en coordonnÃƒÆ’Ã‚Â©es locales au game-board (pas en screen-space)
    //    Comme le wrapper sera DANS le board, la perspective s'applique naturellement
    const gameBoard = document.querySelector('.game-board');
    const boardRect = gameBoard.getBoundingClientRect();
    const cardWidth = 144;
    const cardHeight = 192;

    // Position du slot en coordonnÃƒÆ’Ã‚Â©es locales au board CSS (avant perspective)
    // On utilise offsetLeft/offsetTop rÃƒÆ’Ã‚Â©cursivement jusqu'au board
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

    // 3. Position cible : cimetiÃƒÆ’Ã‚Â¨re (calibrÃƒÆ’Ã‚Â©e aprÃƒÆ’Ã‚Â¨s insertion dans le DOM)
    const deathGraveTop = document.getElementById(`${ownerKey}-grave-top`);
    const graveEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    const graveTarget = deathGraveTop || graveEl;
    let graveX = startX;
    let graveY = startY + 200;
    let graveScaleX = 1;
    let graveScaleY = 1;

    // 4. CrÃƒÆ’Ã‚Â©er le wrapper DANS le game-board (hÃƒÆ’Ã‚Â©rite de la perspective automatiquement)
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

    // CrÃƒÆ’Ã‚Â©er la face de la carte
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
    // Figer les stats ÃƒÆ’Ã‚Â  la taille board (hors .card-slot, le CSS retombe sur des tailles plus petites)
    for (const statEl of cardFace.querySelectorAll('.arena-atk, .arena-hp, .arena-armor')) {
        statEl.style.width = '40px';
        statEl.style.height = '25px';
        statEl.style.fontSize = '20px';
    }
    if (deathGhost) {
        cardFace.style.visibility = 'hidden';
    }
    wrapper.appendChild(cardFace);

    // 5. Retirer la carte originale du slot immÃƒÆ’Ã‚Â©diatement
    if (cardEl) {
        cardEl.remove();
    }
    slot.classList.remove('has-card');
    slot.classList.remove('has-flying');

    // DÃƒÆ’Ã‚Â©bloquer le slot ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â la carte est maintenant dans le wrapper volant, render() peut toucher le slot
    animatingSlots.delete(deathSlotKey);

    // 6. Ajouter au DOM dans le game-board (hÃƒÆ’Ã‚Â©rite de la perspective)
    gameBoard.appendChild(wrapper);
    if (deathGhost) {
        deathGhost.syncFromElement(wrapper, { alpha: 1, gray: 0, zIndex: 11000 });
    }

    // 7. Calibrer graveX/graveY par itÃƒÆ’Ã‚Â©ration (la perspective rend offsetLeft inexact)
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

    // Auto-fit du nom (les noms longs dÃƒÆ’Ã‚Â©bordent pendant l'animation)
    const deathNameFit = cardFace.querySelector('.arena-name');
    if (deathNameFit) fitArenaName(deathNameFit);

    // PrÃƒÆ’Ã‚Â©-charger l'image de la carte pour l'effet de dissipation
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
                // === PHASE 2 (DISSIPATION): DÃƒÆ’Ã¢â‚¬Â°SINTÃƒÆ’Ã¢â‚¬Â°GRATION EN FRAGMENTS CANVAS ===
                dissipationStarted = true;
                clearTimeout(safetyTimeout);

                // CrÃƒÆ’Ã‚Â©er le canvas source : image cover + bordure arrondie
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

                // Clipper l'intÃƒÆ’Ã‚Â©rieur et dessiner l'image avec cover positioning
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
                // Dissipation dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  lancÃƒÆ’Ã‚Â©e ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ne rien faire
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

                // Cacher le wrapper AVANT de placer la carte (mÃƒÆ’Ã‚Âªme frame synchrone = pas de pop)
                wrapper.style.visibility = 'hidden';
                if (deathGhost) {
                    deathGhost.destroy();
                    deathGhost = null;
                }

                // Placer la carte directement dans le cimetiÃƒÆ’Ã‚Â¨re via data.card
                // Le state n'est pas encore ÃƒÆ’Ã‚Â  jour (graveyard.length=0), donc on
                // utilise la carte de l'animation pour prÃƒÆ’Ã‚Â©-remplir le cimetiÃƒÆ’Ã‚Â¨re
                // Dissipation : pas de placement au cimetiÃƒÆ’Ã‚Â¨re
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
                        // Nettoyer les effets Medusa (la carte au cimetiÃƒÆ’Ã‚Â¨re est reset)
                        const gazeMarkerEl = cardEl.querySelector('.gaze-marker');
                        if (gazeMarkerEl) gazeMarkerEl.remove();
                        cardEl.classList.add('grave-card', 'in-graveyard');
                        container.appendChild(cardEl);
                        const nameEl = cardEl.querySelector('.arena-name');
                        if (nameEl) fitArenaName(nameEl);
                    }
                    // Aussi mettre ÃƒÆ’Ã‚Â  jour le stack
                    const graveyard = owner === 'me' ? state?.me?.graveyard : state?.opponent?.graveyard;
                    updateGraveDisplay(ownerKey, graveyard || [data.card]);

                    // Mise ÃƒÆ’Ã‚Â  jour dynamique de la popup cimetiÃƒÆ’Ã‚Â¨re
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
 * Animation de dissipation : la carte se dÃƒÆ’Ã‚Â©sintÃƒÆ’Ã‚Â¨gre en fragments qui s'envolent
 * Effet style Magic Arena ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â chaque fragment contient un sous-ensemble alÃƒÆ’Ã‚Â©atoire de pixels
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

    // Distribuer les pixels dans les fragments ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â biaisÃƒÆ’Ã‚Â© par x (gauche se dissout en premier)
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

    // Conteneur sÃƒÆ’Ã‚Â©parÃƒÆ’Ã‚Â© pour les particules (pas de tilt)
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
        z-index: 10001; pointer-events: none;
    `;

    // CrÃƒÆ’Ã‚Â©er les ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ments canvas pour chaque fragment
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

    // CrÃƒÆ’Ã‚Â©er les particules violettes
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

    // Ajouter le wrapper dans le perspContainer (mÃƒÆ’Ã‚Âªme perspective 3D que le plateau)
    if (perspContainer) {
        perspContainer.appendChild(fragWrapper);
    } else {
        document.body.appendChild(fragWrapper);
    }
    document.body.appendChild(container);

    // Compenser le dÃƒÆ’Ã‚Â©calage du wrapper causÃƒÆ’Ã‚Â© par le rotateX dans le perspContainer
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
        // CrÃƒÆ’Ã‚Â©ature avec transformInto : pas de fly-to-graveyard, le deathTransform suivant gÃƒÆ’Ã‚Â¨re le flip
        // DÃƒÆ’Ã‚Â©bloquer seulement graveRenderBlocked ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â le slot reste bloquÃƒÆ’Ã‚Â© pour le deathTransform
        graveRenderBlocked.delete(owner);
    } else {
        // Mort normale : enchaÃƒÆ’Ã‚Â®ner avec l'animation fly-to-graveyard standard.
        // Safety race avoids queue hard-timeout if browser throttles rAF.
        await Promise.race([
            animateDeathToGraveyard(data),
            new Promise(resolve => setTimeout(resolve, 3200))
        ]);
    }
}

/**
 * CrÃƒÆ’Ã‚Â©e un ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ment carte pour l'animation (copie de celle dans animations.js)
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

    // Si la carte a une image, utiliser le nouveau systÃƒÆ’Ã‚Â¨me
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'CÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ritÃƒÆ’Ã‚Â©', superhaste: 'SupercÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ritÃƒÆ’Ã‚Â©', intangible: 'Intangible',
            trample: 'PiÃƒÆ’Ã‚Â©tinement', power: 'Puissance', immovable: 'Immobile', wall: 'Mur', regeneration: 'RÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©ration',
            protection: 'Protection', untargetable: 'Inciblable', provocation: 'Provocation'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `RÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©ration ${card.regenerationX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'MÃƒÆ’Ã‚ÂªlÃƒÆ’Ã‚Â©e';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost">${card.cost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">CrÃƒÆ’Ã‚Â©ature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk">${atk}</div>
            <div class="img-hp">${hp}</div>`;
        return el;
    }

    return el;
}

/**
 * Animation de rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lation d'un sort ou piÃƒÆ’Ã‚Â¨ge ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â style Hearthstone/Arena
 * La carte apparaÃƒÆ’Ã‚Â®t en grand (gauche = joueur, droite = adversaire)
 * puis vole vers le cimetiÃƒÆ’Ã‚Â¨re du propriÃƒÆ’Ã‚Â©taire.
 */
async function animateSpellReveal(card, casterPlayerNum, startRect = null) {
    const isMine = casterPlayerNum === myNum;
    const side = isMine ? 'me' : 'opp';
    const cardWidth = 144;
    const cardHeight = 192;

    // graveRenderBlocked dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  incrÃƒÆ’Ã‚Â©mentÃƒÆ’Ã‚Â© par queueAnimation ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â pas de double add

    // 1. CrÃƒÆ’Ã‚Â©er l'ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ment carte (version on-field : juste le nom, comme au cimetiÃƒÆ’Ã‚Â¨re)
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

    // 3. Calculer la position du cimetiÃƒÆ’Ã‚Â¨re du caster ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â utiliser grave-top pour dimensions EXACTES
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

    // 4. Position de dÃƒÆ’Ã‚Â©part : depuis la main (startRect) ou materialisation classique
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

    // Pour les sorts adverses : flip dos ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ face au lieu de fade
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

    // 5. Perspective container pour le fly-to-graveyard (mÃƒÆ’Ã‚Âªme technique que animateBurn)
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

    // Calibrer graveScaleX/Y : 3 passes itÃƒÆ’Ã‚Â©ratives, correction indÃƒÆ’Ã‚Â©pendante W et H
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

    // Auto-fit du nom (les noms longs dÃƒÆ’Ã‚Â©bordent pendant l'animation)
    const spellNameFit = cardEl.querySelector('.arena-name');
    if (spellNameFit) fitArenaName(spellNameFit);

    // 6. DurÃƒÆ’Ã‚Â©es des phases (pas de phase impact ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â le fly est la derniÃƒÆ’Ã‚Â¨re, comme burn)
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
                // === PHASE 1: MATERIALIZE ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â montÃƒÆ’Ã‚Â©e progressive vers showcase ===
                const p = progress / t1;
                const ep = easeInOutCubic(p);
                x = initX + (showcaseX - initX) * ep;
                y = initY + (showcaseY - initY) * ep;
                if (hasStartRect) {
                    // Depuis la main : garder la taille initiale au dÃƒÆ’Ã‚Â©but, grossir aprÃƒÆ’Ã‚Â¨s avoir commencÃƒÆ’Ã‚Â© ÃƒÆ’Ã‚Â  monter
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
                // === PHASE 4: FLY TO GRAVEYARD (derniÃƒÆ’Ã‚Â¨re phase, comme burn) ===
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

            // Flip dos ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ face pour les sorts adverses (pendant phase 1)
            if (flipInner) {
                const flipDeg = progress <= t1 ? 180 * easeInOutCubic(progress / t1) : 180;
                flipInner.style.transform = `rotateY(${flipDeg}deg)`;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);

                // Cacher le wrapper AVANT de placer la carte (mÃƒÆ’Ã‚Âªme frame synchrone = pas de pop)
                wrapper.style.visibility = 'hidden';

                // VÃƒÆ’Ã‚Â©rifier si ce sort doit retourner en main (returnOnMiss)
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
                    // Placer la carte visuellement dans le cimetiÃƒÆ’Ã‚Â¨re
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
                    // Mise ÃƒÆ’Ã‚Â  jour dynamique de la popup cimetiÃƒÆ’Ã‚Â¨re
                    addCardToGraveyardPopup(side, card);

                    // GARDER graveRenderBlocked actif !
                    // Le state du serveur n'a pas encore le sort dans le cimetiÃƒÆ’Ã‚Â¨re.
                    // Si on dÃƒÆ’Ã‚Â©bloque maintenant, render() voit un cimetiÃƒÆ’Ã‚Â¨re vide et efface notre carte.
                    // On dÃƒÆ’Ã‚Â©bloque aprÃƒÆ’Ã‚Â¨s un dÃƒÆ’Ã‚Â©lai pour laisser le state se mettre ÃƒÆ’Ã‚Â  jour.
                    const capturedSide = side;
                    const spellUid = card.uid || card.id;
                    setTimeout(() => {
                        graveRenderBlocked.delete(capturedSide);
                        if (state) {
                            const graveyard = capturedSide === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                            if (graveyard) {
                                // VÃƒÆ’Ã‚Â©rifier que le state contient bien le sort avant de mettre ÃƒÆ’Ã‚Â  jour.
                                // Pour les sorts lents (destroy etc.), le state peut ne pas encore ÃƒÆ’Ã‚Âªtre arrivÃƒÆ’Ã‚Â©.
                                // Dans ce cas, garder le placement manuel ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â render() mettra ÃƒÆ’Ã‚Â  jour quand le state arrivera.
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
        const oppAnimIndex = _pickOppAnimIndex(data) ?? (_isValidHandIndex(data?._oppSourceIndex) ? Number(data._oppSourceIndex) : null);
        const preferredSpellUid = data?._oppSourceUid || data.spell?.uid || data.spell?.id || null;
        _oppPlayDbg('spell:resolve-source:start', {
            visualHandIndex: Number.isFinite(Number(data.visualHandIndex)) ? Number(data.visualHandIndex) : null,
            fallbackHandIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
            originalHandIndex: _isValidHandIndex(data.originalHandIndex) ? Number(data.originalHandIndex) : null,
            reconstructedHandIndex: _isValidHandIndex(data.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
            oppAnimIndex,
            spellUid: preferredSpellUid,
            spellName: data.spell?.name || null
        });
        const gameBoard = document.querySelector('.game-board');
        if (gameBoard) {
            const gbRect = gameBoard.getBoundingClientRect();
            const cardW = 144, cardH = 192, sc = 1.8;
            const showcaseX = gbRect.left + gbRect.width * 0.80 - (cardW * sc) / 2;
            const showcaseY = gbRect.top + gbRect.height * 0.45 - (cardH * sc) / 2;
            // Prendre le dos de carte du DOM (filtrer les dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  cachÃƒÆ’Ã‚Â©es)
            let savedRect = _coerceRectLike(data?._oppSourceRect);
            let sourceMode = savedRect ? (data?._oppSourceMode || 'socket-snapshot') : 'showcase-fallback';
            if (oppAnimIndex !== null || !!preferredSpellUid) {
                const resolved = _resolveOppHandSourceByIndexAndUid(
                    oppAnimIndex,
                    preferredSpellUid,
                    {
                        strictIndex: oppAnimIndex !== null,
                        strictNoFallback: !!(preferredSpellUid || oppAnimIndex !== null)
                    }
                );
                if (resolved.el && resolved.rect) {
                    savedRect = resolved.rect;
                    resolved.el.style.visibility = 'hidden';
                    smoothCloseOppHandGap(resolved.el);
                    sourceMode = resolved.mode;
                } else if (!savedRect && savedOppHandRects && oppAnimIndex !== null && oppAnimIndex < savedOppHandRects.length) {
                    savedRect = savedOppHandRects[oppAnimIndex];
                    sourceMode = 'saved-cache-index';
                }
            }
            // Pas de flyFromOppHand ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â animateSpellReveal gÃƒÆ’Ã‚Â¨re tout le trajet mainÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢showcase avec scale progressif + flip
            startRect = savedRect || { left: showcaseX, top: showcaseY, width: cardW * sc, height: cardH * sc };
            _oppPlayDbg('spell:resolve-source:end', {
                visualHandIndex: Number.isFinite(Number(data.visualHandIndex)) ? Number(data.visualHandIndex) : null,
                fallbackHandIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                originalHandIndex: _isValidHandIndex(data.originalHandIndex) ? Number(data.originalHandIndex) : null,
                reconstructedHandIndex: _isValidHandIndex(data.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
                oppAnimIndex,
                sourceMode,
                startRect: _handIdxRectToLog(startRect),
                savedRect: _handIdxRectToLog(savedRect),
                savedRectsCount: savedOppHandRects ? savedOppHandRects.length : 0
            });
        }
    }
    // Pour nos propres sorts : rÃƒÆ’Ã‚Â©cupÃƒÆ’Ã‚Â©rer la position du sort engagÃƒÆ’Ã‚Â© dans la main
    if (data.spell && data.caster === myNum && committedSpells.length > 0) {
        const handPanel = document.getElementById('my-hand');
        const committedEls = handPanel ? handPanel.querySelectorAll('.committed-spell') : [];
        const csIdx = committedSpells.findIndex(cs => cs.card.id === data.spell.id);
        if (csIdx >= 0) {
            const commitId = committedSpells[csIdx].commitId;
            // Chercher l'ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ment DOM du sort engagÃƒÆ’Ã‚Â©
            let foundEl = null;
            for (const el of committedEls) {
                if (parseInt(el.dataset.commitId) === commitId) {
                    foundEl = el;
                    break;
                }
            }

            if (foundEl) {
                // ÃƒÆ’Ã¢â‚¬Â°lÃƒÆ’Ã‚Â©ment trouvÃƒÆ’Ã‚Â© dans le DOM ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â rÃƒÆ’Ã‚Â©cupÃƒÆ’Ã‚Â©rer sa position et le retirer
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
                // ÃƒÆ’Ã¢â‚¬Â°lÃƒÆ’Ã‚Â©ment dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  retirÃƒÆ’Ã‚Â© du DOM ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â utiliser la position cachÃƒÆ’Ã‚Â©e (par commitId, unique)
                startRect = cachedCommittedRects[commitId];
            }

            committedSpells.splice(csIdx, 1);
            delete cachedCommittedRects[commitId];
        }
    }
    // Afficher la carte du sort avec animation de rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lation
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
    // Marquer ce sort comme devant retourner en main (pas au cimetiÃƒÆ’Ã‚Â¨re)
    pendingSpellReturns.set(spellId, { owner, handIndex: data.handIndex });
    // Si l'animation du sort a dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  terminÃƒÆ’Ã‚Â© et placÃƒÆ’Ã‚Â© la carte dans le cimetiÃƒÆ’Ã‚Â¨re (race condition),
    // nettoyer immÃƒÆ’Ã‚Â©diatement le visuel du cimetiÃƒÆ’Ã‚Â¨re
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
    // Marquer cet index comme retour depuis le cimetiÃƒÆ’Ã‚Â¨re
    const beforeReturns = [...GameAnimations.pendingGraveyardReturns[owner]];
    GameAnimations.pendingGraveyardReturns[owner].add(data.handIndex);
    const afterReturns = [...GameAnimations.pendingGraveyardReturns[owner]];
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] mark pendingGraveyardReturns owner=${owner} before=[${beforeReturns.join(',')}] after=[${afterReturns.join(',')}]`);
    // RÃƒÆ’Ã‚Â©utiliser le systÃƒÆ’Ã‚Â¨me de pioche standard (carte cachÃƒÆ’Ã‚Â©e au render, animation, reveal)
    if (window.DEBUG_LOGS) console.log(`[BLAST-RET] queue draw-prep owner=${owner} handIndex=${data.handIndex} spellId=${spellId}`);
    GameAnimations.prepareDrawAnimation({
        cards: [{ player: data.player, handIndex: data.handIndex, card: data.card }]
    });
}

function animateHeal(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (slot) {
        // Aura verte DOM (hÃƒÆ’Ã‚Â©rite de la perspective 3D)
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

    // Bloquer le slot pour que render() ne touche pas ÃƒÆ’Ã‚Â  la carte
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 1 : Forcer l'affichage des HP post-dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts (avant regen)
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

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 2 : Laisser le joueur voir les HP rÃƒÆ’Ã‚Â©duits pendant 500ms
    await new Promise(r => setTimeout(r, 500));

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 3 : Jouer l'animation de regen (nombre rouge style lifesteal)
    if (slot) {
        slot.classList.add('lifesteal-aura');
        setTimeout(() => slot.classList.remove('lifesteal-aura'), 700);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showLifestealNumber(x, y, data.amount);
    }

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 4 : Attendre que l'effet soit visible
    await new Promise(r => setTimeout(r, 600));

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 5 : Mettre ÃƒÆ’Ã‚Â  jour les HP finaux dans le DOM
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

    // Nuage poison pour selfPoison (Pustule vivante) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â jouÃƒÆ’Ã‚Â© APRÃƒÆ’Ã‹â€ S le VFX dorÃƒÆ’Ã‚Â©
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

    // Le slot est dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  bloquÃƒÆ’Ã‚Â© depuis le queue (dans queueAnimation)
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 1 : Forcer l'affichage des HP post-dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts directement dans le DOM
    // (le state global peut dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  avoir les HP soignÃƒÆ’Ã‚Â©s, on utilise les HP capturÃƒÆ’Ã‚Â©s ÃƒÆ’Ã‚Â  la rÃƒÆ’Ã‚Â©ception)
    if (cardEl && data._preHealHp !== undefined) {
        const hpEl = cardEl.querySelector('.arena-armor') || cardEl.querySelector('.arena-hp') || cardEl.querySelector('.img-hp');
        if (hpEl) {
            hpEl.textContent = data._preHealHp;
            // Colorer en rouge si endommagÃƒÆ’Ã‚Â© (classe "reduced" pour arena-style)
            if (data._preHealHp < data._preHealMax) {
                hpEl.classList.add('reduced');
                hpEl.classList.remove('boosted');
            }
        }
    }

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 1b : Pour heroHeal, forcer les HP prÃƒÆ’Ã‚Â©-soin du hÃƒÆ’Ã‚Â©ros dans le DOM
    if (data.heroHeal && data._preHeroHp !== undefined) {
        const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
        const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
        _setHeroHpText(hpElement, data._preHeroHp);
    }

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 2 : Laisser le joueur voir les HP rÃƒÆ’Ã‚Â©duits pendant 500ms
    await new Promise(r => setTimeout(r, 500));

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 3 : Jouer l'animation de lifesteal
    if (data.heroHeal) {
        // Lifelink : animation sur le portrait du hÃƒÆ’Ã‚Â©ros
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
        // Lifedrain : animation sur la crÃƒÆ’Ã‚Â©ature
        slot.classList.add('lifesteal-aura');
        setTimeout(() => slot.classList.remove('lifesteal-aura'), 700);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showLifestealNumber(x, y, data.amount);
        CombatVFX.createLifestealEffect(x, y, rect.width, rect.height);
    }

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 4 : Attendre que l'effet soit visible
    await new Promise(resolve => setTimeout(resolve, 600));

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 5 : Mettre ÃƒÆ’Ã‚Â  jour les HP finaux dans le DOM
    if (data.heroHeal) {
        // Lifelink : mettre ÃƒÆ’Ã‚Â  jour les HP du hÃƒÆ’Ã‚Â©ros
        const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
        const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
        if (hpElement) {
            const finalHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
            if (finalHp !== undefined) _setHeroHpText(hpElement, finalHp);
        }
        lifestealHeroHealInProgress = false;
    } else if (cardEl) {
        // Lifedrain : mettre ÃƒÆ’Ã‚Â  jour les HP de la crÃƒÆ’Ã‚Â©ature
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

    // Bloquer le slot pour que render() ne touche pas ÃƒÆ’Ã‚Â  la carte
    animatingSlots.add(slotKey);

    const slot = getSlot(owner, data.row, data.col);
    const cardEl = slot?.querySelector('.card');

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 1 : Forcer l'affichage des HP post-dÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â¢ts (avant heal)
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

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 2 : Laisser le joueur voir les HP rÃƒÆ’Ã‚Â©duits
    await new Promise(r => setTimeout(r, 500));

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 3 : Jouer l'animation de soin (mÃƒÆ’Ã‚Âªme VFX que lifesteal avec couleur verte)
    if (slot) {
        slot.classList.add('lifesteal-aura');
        setTimeout(() => slot.classList.remove('lifesteal-aura'), 700);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showLifestealNumber(x, y, data.amount);
        CombatVFX.createLifestealEffect(x, y, rect.width, rect.height);
    }

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 4 : Attendre que l'effet soit visible
    await new Promise(resolve => setTimeout(resolve, 600));

    // ÃƒÆ’Ã¢â‚¬Â°TAPE 5 : Mettre ÃƒÆ’Ã‚Â  jour les HP finaux dans le DOM
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
        const trapKey = `${owner}-${data.row}`;
        animatingTrapSlots.add(trapKey);
        const trapSlot = getTrapSlot(owner, data.row);
        if (!trapSlot) {
            animatingTrapSlots.delete(trapKey);
            resolve();
            return;
        }

        const trapRect = trapSlot.getBoundingClientRect();
        const paintFacedownTrap = () => {
            const content = trapSlot.querySelector('.trap-content');
            if (!content) return;
            trapSlot.classList.add('has-trap');
            if (owner === 'me') trapSlot.classList.add('mine');
            else trapSlot.classList.remove('mine');
            trapSlot.dataset.trapState = '1';
            content.innerHTML = `<div class="trap-card-back ${owner === 'me' ? 'mine' : 'enemy'}"></div>`;
        };

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
            paintFacedownTrap();
            setTimeout(() => {
                animatingTrapSlots.delete(trapKey);
                render();
                resolve();
            }, 420);
        }

        // Si c'est l'adversaire, faire voler la carte de la main d'abord
        if (owner === 'opp') {
            const oppAnimIndex = _pickOppAnimIndex(data) ?? (_isValidHandIndex(data?._oppSourceIndex) ? Number(data._oppSourceIndex) : null);
            _oppPlayDbg('trapPlace:resolve-source:start', {
                visualHandIndex: Number.isFinite(Number(data.visualHandIndex)) ? Number(data.visualHandIndex) : null,
                fallbackHandIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                originalHandIndex: _isValidHandIndex(data.originalHandIndex) ? Number(data.originalHandIndex) : null,
                reconstructedHandIndex: _isValidHandIndex(data.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
                oppAnimIndex,
                row: Number.isFinite(Number(data.row)) ? Number(data.row) : null
            });
            // Source prioritaire: snapshot socket de la main adverse au moment du play.
            let savedRect = _coerceRectLike(data?._oppSourceRect);
            const preferredTrapUid = data?._oppSourceUid || null;
            const strictTrapSource = !!(data?._oppSourceStrict) || oppAnimIndex !== null || !!preferredTrapUid || !!savedRect;
            let sourceMode = savedRect ? (data?._oppSourceMode || 'socket-snapshot') : 'fly-fallback';
            if (strictTrapSource) {
                const resolved = _resolveOppHandSourceByIndexAndUid(oppAnimIndex, preferredTrapUid, {
                    strictIndex: oppAnimIndex !== null,
                    strictNoFallback: strictTrapSource
                });
                if (resolved.el && resolved.rect) {
                    savedRect = resolved.rect;
                    resolved.el.style.visibility = 'hidden';
                    smoothCloseOppHandGap(resolved.el);
                    sourceMode = resolved.mode;
                } else if (!savedRect && savedOppHandRects && oppAnimIndex !== null && oppAnimIndex < savedOppHandRects.length) {
                    savedRect = savedOppHandRects[oppAnimIndex];
                    sourceMode = 'saved-cache-index';
                }
            }
            _oppPlayDbg('trapPlace:resolve-source:end', {
                visualHandIndex: Number.isFinite(Number(data.visualHandIndex)) ? Number(data.visualHandIndex) : null,
                fallbackHandIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                originalHandIndex: _isValidHandIndex(data.originalHandIndex) ? Number(data.originalHandIndex) : null,
                reconstructedHandIndex: _isValidHandIndex(data.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
                oppAnimIndex,
                sourceMode,
                savedRect: _handIdxRectToLog(savedRect),
                targetRect: _handIdxRectToLog(trapRect),
                savedRectsCount: savedOppHandRects ? savedOppHandRects.length : 0
            });
            flyFromOppHand(trapRect, 280, null, savedRect, {
                sourceIndex: oppAnimIndex,
                preferredUid: preferredTrapUid,
                strictNoLastFallback: strictTrapSource
            }).then(() => {
                showTrapReveal();
                finalize();
            }).catch(() => {
                paintFacedownTrap();
                animatingTrapSlots.delete(trapKey);
                render();
                resolve();
            });
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

    function createTrapFaceCard(trapCard) {
        const card = makeCard(trapCard, false);
        card.classList.remove('just-played', 'can-attack');
        card.classList.add('trap-trigger-face');
        card.style.position = 'absolute';
        card.style.inset = '0';
        card.style.width = '100%';
        card.style.height = '100%';
        card.style.margin = '0';
        card.style.transform = 'none';
        card.style.backfaceVisibility = 'visible';
        card.style.webkitBackfaceVisibility = 'visible';
        const nameEl = card.querySelector('.arena-name');
        if (nameEl) fitArenaName(nameEl);
        return card;
    }

    async function animateTrapFlyToGrave(slotEl, faceEl, ownerKey, startRect = null) {
        const gameBoard = document.querySelector('.game-board');
        const graveTop = document.getElementById(`${ownerKey}-grave-top`);
        const graveBox = document.getElementById(`${ownerKey}-grave-box`);
        const graveTarget = graveTop || graveBox;

        if (!gameBoard || !graveTarget) {
            const srcRect = startRect || faceEl.getBoundingClientRect();
            const targetRect = graveTarget ? graveTarget.getBoundingClientRect() : null;
            const fly = faceEl.cloneNode(true);
            fly.style.position = 'fixed';
            fly.style.left = srcRect.left + 'px';
            fly.style.top = srcRect.top + 'px';
            fly.style.width = srcRect.width + 'px';
            fly.style.height = srcRect.height + 'px';
            fly.style.margin = '0';
            fly.style.zIndex = '10000';
            fly.style.pointerEvents = 'none';
            fly.style.transform = 'none';
            fly.style.backfaceVisibility = 'visible';
            fly.style.webkitBackfaceVisibility = 'visible';
            document.body.appendChild(fly);

            const startX = srcRect.left;
            const startY = srcRect.top;
            const endW = targetRect ? targetRect.width : srcRect.width * 0.55;
            const endH = targetRect ? targetRect.height : srcRect.height * 0.55;
            const endX = targetRect ? targetRect.left + targetRect.width / 2 - endW / 2 : startX;
            const endY = targetRect ? targetRect.top + targetRect.height / 2 - endH / 2 : startY + 120;
            const ctrlX = (startX + endX) / 2;
            const ctrlY = Math.min(startY, endY) - 90;

            await new Promise((resolve) => {
                const dur = 460;
                const t0 = performance.now();
                function step() {
                    const p = Math.min((performance.now() - t0) / dur, 1);
                    const t = easeInOutCubic(p);
                    const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * endX;
                    const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * ctrlY + t * t * endY;
                    const w = srcRect.width + (endW - srcRect.width) * t;
                    const h = srcRect.height + (endH - srcRect.height) * t;
                    fly.style.left = x + 'px';
                    fly.style.top = y + 'px';
                    fly.style.width = w + 'px';
                    fly.style.height = h + 'px';
                    fly.style.opacity = String(1 - t * 0.18);
                    if (p < 1) requestAnimationFrame(step); else resolve();
                }
                requestAnimationFrame(step);
            });

            fly.remove();
            return;
        }

        const cardWidth = 144;
        const cardHeight = 192;
        const getLocalPos = (el) => {
            let x = 0, y = 0;
            let cur = el;
            while (cur && cur !== gameBoard) {
                x += cur.offsetLeft;
                y += cur.offsetTop;
                cur = cur.offsetParent;
            }
            return { x, y };
        };

        const slotPos = getLocalPos(slotEl);
        const startX = slotPos.x + slotEl.offsetWidth / 2 - cardWidth / 2;
        const startY = slotPos.y + slotEl.offsetHeight / 2 - cardHeight / 2;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            position: absolute; z-index: 10000; pointer-events: none;
            left: ${startX}px; top: ${startY}px;
            width: ${cardWidth}px; height: ${cardHeight}px;
            transform-origin: center center;
            opacity: 1;
        `;

        const flyCard = faceEl.cloneNode(true);
        flyCard.style.position = 'absolute';
        flyCard.style.inset = '0';
        flyCard.style.width = cardWidth + 'px';
        flyCard.style.height = cardHeight + 'px';
        flyCard.style.margin = '0';
        flyCard.style.transform = 'none';
        flyCard.style.backfaceVisibility = 'visible';
        flyCard.style.webkitBackfaceVisibility = 'visible';
        wrapper.appendChild(flyCard);
        gameBoard.appendChild(wrapper);

        let endX = startX;
        let endY = startY + 140;
        let endScaleX = 0.55;
        let endScaleY = 0.55;

        const gtRect = graveTarget.getBoundingClientRect();
        const gtCx = gtRect.left + gtRect.width / 2;
        const gtCy = gtRect.top + gtRect.height / 2;
        endScaleX = gtRect.width / cardWidth;
        endScaleY = gtRect.height / cardHeight;

        for (let pass = 0; pass < 5; pass++) {
            wrapper.style.left = endX + 'px';
            wrapper.style.top = endY + 'px';
            wrapper.style.transform = `scale(${endScaleX}, ${endScaleY})`;
            const wRect = wrapper.getBoundingClientRect();
            const wCx = wRect.left + wRect.width / 2;
            const wCy = wRect.top + wRect.height / 2;
            if (wRect.width > 0 && wRect.height > 0) {
                endScaleX *= gtRect.width / wRect.width;
                endScaleY *= gtRect.height / wRect.height;
            }
            endX += (gtCx - wCx);
            endY += (gtCy - wCy);
        }

        wrapper.style.left = startX + 'px';
        wrapper.style.top = startY + 'px';
        wrapper.style.transform = 'scale(1,1)';

        await new Promise((resolve) => {
            const dur = 500;
            const t0 = performance.now();
            function step() {
                const p = Math.min((performance.now() - t0) / dur, 1);
                const t = easeInOutCubic(p);
                const arc = Math.sin(Math.PI * t) * 34;
                const x = startX + (endX - startX) * t;
                const y = startY + (endY - startY) * t - arc;
                const sX = 1 + (endScaleX - 1) * t;
                const sY = 1 + (endScaleY - 1) * t;
                wrapper.style.left = x + 'px';
                wrapper.style.top = y + 'px';
                wrapper.style.transform = `scale(${sX}, ${sY})`;
                wrapper.style.opacity = String(1 - t * 0.16);
                if (p < 1) requestAnimationFrame(step); else resolve();
            }
            requestAnimationFrame(step);
        });

        wrapper.remove();
    }

    const owner = data.player === myNum ? 'me' : 'opp';
    const trapKey = `${owner}-${data.row}`;
    const trapSlot = getTrapSlot(owner, data.row);

    // Protect trap slot while the trap is visible/consuming.
    animatingTrapSlots.add(trapKey);

    // 1. Pre-signal: highlight real trap targets.
    const previewTargets = resolveTrapPreviewTargets(data);
    const trapDamage = Number(data?.trap?.damage);
    const shouldHoldUntilDamage = Number.isFinite(trapDamage) && trapDamage > 0 && previewTargets.length > 0;
    // Keep target warning until trap consume ends (no early clear by damage batches).
    const warnedCount = _applyTrapTargetWarnings(previewTargets, { waitForDamage: false });

    // Nothing to animate on board: keep legacy behavior minimal.
    if (!trapSlot || !data.trap) {
        if (warnedCount > 0) await new Promise((resolve) => setTimeout(resolve, 420));
        _clearTrapTargetWarnings('trap-no-board');
        // Release protection so render can proceed normally.
        animatingTrapSlots.delete(trapKey);
        graveRenderBlocked.delete(owner);
        return;
    }

    const trapContent = trapSlot.querySelector('.trap-content');
    if (!trapContent) {
        _clearTrapTargetWarnings('trap-no-content');
        animatingTrapSlots.delete(trapKey);
        graveRenderBlocked.delete(owner);
        return;
    }

    // Keep the facedown trap visible before the flip starts.
    trapSlot.classList.add('has-trap');
    if (owner === 'me') trapSlot.classList.add('mine');
    else trapSlot.classList.remove('mine');
    trapSlot.dataset.trapState = '1';

    // 2. Deterministic 2-phase flip (no backface artifacts).
    trapContent.innerHTML = '';
    trapContent.style.perspective = '800px';
    trapContent.style.transformStyle = 'preserve-3d';

    const flipShell = document.createElement('div');
    flipShell.className = 'trap-trigger-flipper';
    flipShell.style.cssText = `
        position: absolute; inset: 0;
        transform: rotateY(0deg);
        transform-origin: center center;
        will-change: transform;
    `;

    const backFace = document.createElement('div');
    backFace.className = `trap-card-back ${owner === 'me' ? 'mine' : 'enemy'}`;
    backFace.style.cssText = `
        position: absolute; inset: 0;
        border-radius: 4px;
    `;
    flipShell.appendChild(backFace);
    trapContent.appendChild(flipShell);

    // 3. Trigger VFX directly on trap slot.
    trapSlot.classList.add('triggered');
    {
        const rect = trapSlot.getBoundingClientRect();
        CombatVFX.createTrapRevealEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            rect.width,
            rect.height
        );
        CombatVFX.createSpellImpactEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
    }

    // 4. Flip in place (board card back -> trap face).
    await new Promise((resolve) => {
        const dur = 120;
        const t0 = performance.now();
        function step() {
            const p = Math.min((performance.now() - t0) / dur, 1);
            const ep = easeInOutCubic(p);
            const angle = 90 * ep;
            flipShell.style.transform = `rotateY(${angle}deg)`;
            if (p < 1) requestAnimationFrame(step); else resolve();
        }
        requestAnimationFrame(step);
    });

    // Swap at 90deg, then finish the flip to front.
    const frontFace = createTrapFaceCard(data.trap);
    flipShell.innerHTML = '';
    flipShell.appendChild(frontFace);
    flipShell.style.transform = 'rotateY(-90deg)';
    await new Promise((resolve) => {
        const dur = 130;
        const t0 = performance.now();
        function step() {
            const p = Math.min((performance.now() - t0) / dur, 1);
            const ep = easeInOutCubic(p);
            const angle = -90 + 90 * ep;
            flipShell.style.transform = `rotateY(${angle}deg)`;
            if (p < 1) requestAnimationFrame(step); else resolve();
        }
        requestAnimationFrame(step);
    });
    flipShell.style.transform = 'none';

    // Small settle pulse while remaining on board.
    await new Promise((resolve) => setTimeout(resolve, warnedCount > 0 ? 120 : 80));

    // 5. Consume sequence (grayscale + fly to graveyard) is delayed so creature animation can play first.
    const consumeDelay = (() => {
        const effect = String(data?.trap?.effect || '');
        if (effect === 'summon') return 3600;
        if (effect === 'bounce') return 3200;
        if (shouldHoldUntilDamage) return 3000;
        return 2600;
    })();

    setTimeout(async () => {
        const slotNow = getTrapSlot(owner, data.row);
        const contentNow = slotNow?.querySelector('.trap-content');
        const faceNow = contentNow?.querySelector('.trap-trigger-face') || contentNow?.querySelector('.card');

        // If slot changed meanwhile, just release locks/flags.
        if (!slotNow || !contentNow || !faceNow) {
            animatingTrapSlots.delete(trapKey);
            graveRenderBlocked.delete(owner);
            _clearTrapTargetWarnings('trap-consume-missing');
            return;
        }

        // Grayscale death mark before flying to graveyard.
        await new Promise((resolve) => {
            const dur = 300;
            const t0 = performance.now();
            function step() {
                const p = Math.min((performance.now() - t0) / dur, 1);
                const ep = easeOutCubic(p);
                faceNow.style.filter = `grayscale(${ep}) brightness(${1 - ep * 0.25}) contrast(${1 - ep * 0.1})`;
                faceNow.style.opacity = String(1 - ep * 0.12);
                faceNow.style.transform = `scale(${1 - ep * 0.06})`;
                if (p < 1) requestAnimationFrame(step); else resolve();
            }
            requestAnimationFrame(step);
        });

        const faceRect = faceNow.getBoundingClientRect();
        const flySource = faceNow.cloneNode(true);
        slotNow.classList.remove('triggered', 'has-trap', 'mine');
        delete slotNow.dataset.trapState;
        _clearTrapSlotContent(slotNow);

        await animateTrapFlyToGrave(slotNow, flySource, owner, faceRect);

        slotNow.classList.remove('triggered', 'has-trap', 'mine');
        delete slotNow.dataset.trapState;
        _clearTrapSlotContent(slotNow);

        // Release render locks now that trap has visually moved to graveyard.
        animatingTrapSlots.delete(trapKey);
        graveRenderBlocked.delete(owner);

        _clearTrapTargetWarnings('trap-consume-done');

        if (state) {
            const gy = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
            if (gy) updateGraveDisplay(owner, gy);
        }
        addCardToGraveyardPopup(owner, data.trap);
        render();
    }, consumeDelay);

    // Do not clear here: keep warning active until consume sequence ends.
}

// === SystÃƒÆ’Ã‚Â¨me de bounce (Voyage inattendu) ===
// Carte bounced en attente : sera cachÃƒÆ’Ã‚Â©e au prochain render, puis l'animation atterrit dessus
let pendingBounce = null;   // { owner, card, wrapper, resolveTarget }

function _bounceDbg(stage, payload = {}) {
    if (!window.HAND_INDEX_DEBUG) return;
    try {
        console.log(`[HAND-IDX][ANIM] ${stage}`, payload);
        console.log(`[HAND-IDX][ANIM][JSON] ${stage} ${JSON.stringify(payload)}`);
    } catch (_) {}
}

function _handIdxRectToLog(rect) {
    if (!rect) return null;
    const toNum = (n) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(2)) : null;
    return {
        left: toNum(rect.left),
        top: toNum(rect.top),
        width: toNum(rect.width),
        height: toNum(rect.height)
    };
}

function _coerceRectLike(rect) {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }
    if (width <= 0 || height <= 0) return null;
    return { left, top, width, height };
}

function _isValidHandIndex(value) {
    if (value === null || value === undefined || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && Math.floor(n) === n;
}

function _pickOppAnimIndex(data) {
    if (_isValidHandIndex(data?.visualHandIndex)) return Number(data.visualHandIndex);
    if (_isValidHandIndex(data?.handIndex)) return Number(data.handIndex);
    if (_isValidHandIndex(data?.reconstructedHandIndex)) return Number(data.reconstructedHandIndex);
    if (_isValidHandIndex(data?.originalHandIndex)) return Number(data.originalHandIndex);
    return null;
}

function _oppHandDomSnapshot() {
    const panel = document.getElementById('opp-hand');
    if (!panel) return [];
    const cards = panel.querySelectorAll('.opp-card-back');
    return Array.from(cards).map((el, domIndex) => {
        const rect = el.getBoundingClientRect();
        return {
            domIndex,
            uid: el.dataset?.uid || null,
            revealed: el.classList.contains('opp-revealed'),
            hidden: el.style.visibility === 'hidden',
            w0: el.style.width === '0px',
            z: el.style.zIndex || null,
            left: Number(rect.left.toFixed(2)),
            width: Number(rect.width.toFixed(2))
        };
    });
}

function _oppVisibleHandSnapshot(domSnapshot) {
    if (!Array.isArray(domSnapshot)) return [];
    return domSnapshot
        .filter((c) => !c.hidden && !c.w0 && Number(c.width) > 0.5)
        .map((c, visibleIndex) => ({
            visibleIndex,
            domIndex: c.domIndex,
            uid: c.uid,
            revealed: c.revealed,
            left: c.left,
            width: c.width,
            z: c.z
        }));
}

function _oppPlayDbg(stage, payload = {}) {
    if (!window.HAND_INDEX_DEBUG) return;
    try {
        const dom = _oppHandDomSnapshot();
        const visible = _oppVisibleHandSnapshot(dom);
        const fullPayload = {
            ...payload,
            domCount: dom.length,
            visibleCount: visible.length,
            dom,
            visible
        };
        console.log(`[HAND-IDX][OPP-PLAY] ${stage}`, fullPayload);
        console.log(`[HAND-IDX][OPP-PLAY][JSON] ${stage} ${JSON.stringify(fullPayload)}`);
    } catch (_) {}
}

function _resolveOppHandSourceByIndexAndUid(visualHandIndex = null, preferredUid = null, options = {}) {
    const panel = document.getElementById('opp-hand');
    if (!panel) return { el: null, mode: 'no-panel', rect: null };
    const strictIndex = !!options.strictIndex;
    const strictNoFallback = !!options.strictNoFallback;

    const all = Array.from(panel.querySelectorAll('.opp-card-back'));
    const logical = all.filter((el) => el.style.width !== '0px');
    const visible = logical.filter((el) => el.style.visibility !== 'hidden');

    let el = null;
    let mode = 'none';

    if (preferredUid) {
        const uidMatch = panel.querySelector(`.opp-card-back[data-uid="${preferredUid}"]`);
        if (uidMatch && uidMatch.style.width !== '0px') {
            el = uidMatch;
            mode = 'uid-match';
        }
    }

    const idx = _isValidHandIndex(visualHandIndex) ? Number(visualHandIndex) : null;
    if (!el && idx !== null && idx >= 0) {
        if (idx < logical.length) {
            el = logical[idx];
            mode = 'logical-index';
        }
        if ((!el || el.style.width === '0px') && idx < visible.length) {
            el = visible[idx];
            mode = 'visible-index';
        }
    }

    // Si un index explicite est fourni, ne pas dÃ©grader vers la "derniÃ¨re carte":
    // c'est prÃ©cisÃ©ment ce fallback qui crÃ©e l'effet "part de la fin de main".
    if (!el && strictNoFallback) {
        mode = 'strict-no-fallback-miss';
    } else if (!el && strictIndex && idx !== null) {
        mode = 'index-miss';
    } else if (!el && visible.length > 0) {
        el = visible[visible.length - 1];
        mode = 'visible-last-fallback';
    } else if (!el && logical.length > 0) {
        el = logical[logical.length - 1];
        mode = 'logical-last-fallback';
    }

    return {
        el,
        mode,
        rect: el ? el.getBoundingClientRect() : null,
        logicalCount: logical.length,
        visibleCount: visible.length
    };
}

function _bounceHandSnapshot(owner) {
    const panel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    if (!panel) return [];
    const selector = owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back';
    return Array.from(panel.querySelectorAll(selector)).map((el, i) => ({
        i,
        uid: el.dataset?.uid || null,
        z: el.style.zIndex || null,
        hidden: el.style.visibility === 'hidden',
        w0: el.style.width === '0px',
        rectW: Number(el.getBoundingClientRect().width.toFixed(1)),
        rectH: Number(el.getBoundingClientRect().height.toFixed(1)),
        tf: el.style.transform || '',
        nameFs: (() => {
            const nameEl = el.querySelector('.arena-name');
            if (!nameEl) return null;
            const fs = parseFloat(getComputedStyle(nameEl).fontSize);
            return Number.isFinite(fs) ? Number(fs.toFixed(2)) : null;
        })()
    }));
}

/**
 * AppelÃƒÆ’Ã‚Â© par renderOppHand / renderHand pour savoir si la derniÃƒÆ’Ã‚Â¨re carte
 * vient d'un bounce et doit ÃƒÆ’Ã‚Âªtre cachÃƒÆ’Ã‚Â©e + rendue face visible
 */
function checkPendingBounce(owner, cardElements) {
    if (!pendingBounce || pendingBounce.owner !== owner) return;
    _bounceDbg('check:start', {
        owner,
        pendingOwner: pendingBounce.owner,
        handIndex: pendingBounce.handIndex ?? null,
        targetUid: pendingBounce.targetUid || null,
        targetIndex: pendingBounce.targetIndex ?? null,
        resolved: !!pendingBounce.resolved,
        cardUid: pendingBounce.card?.uid || pendingBounce.card?.id || null,
        domCards: cardElements ? cardElements.length : null
    });
    const preferEndForOppUnknownIndex = owner === 'opp' && !_isValidHandIndex(pendingBounce.handIndex);
    const forceEndTarget = !!pendingBounce.expectAtEnd || preferEndForOppUnknownIndex;
    // Cibler d'abord la vraie carte (uid) quand elle est revealed,
    // sinon fallback sur index/derniere carte. En mode forceEndTarget,
    // forcer la carte de fin de main pour eviter toute ambiguite d'index.
    let target = null;
    const panel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    const hasUid = !!(pendingBounce.card && pendingBounce.card.uid);

    if (hasUid && panel && !preferEndForOppUnknownIndex) {
        if (owner === 'opp') {
            target = panel.querySelector(`.opp-revealed[data-uid="${pendingBounce.card.uid}"]`);
        } else {
            target = panel.querySelector(`.card:not(.committed-spell)[data-uid="${pendingBounce.card.uid}"]`);
        }
    }

    // En pre-enregistrement (queue time), attendre que la carte soit effectivement
    // ajoutee en main avant de fallback sur "la derniere carte".
    if (!target && pendingBounce.queued && typeof pendingBounce.startHandCount === 'number') {
        if (cardElements.length <= pendingBounce.startHandCount) return;
    }

    if (!target && !forceEndTarget && panel && _isValidHandIndex(pendingBounce.handIndex)) {
        const cards = panel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back');
        const idx = Number(pendingBounce.handIndex);
        if (idx >= 0 && idx < cards.length) target = cards[idx];
    }

    if (!target) {
        if (forceEndTarget && panel) {
            const cards = Array.from(panel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back'))
                .filter((el) => el.style.width !== '0px');
            target = cards[cards.length - 1] || null;
        } else {
            target = cardElements[cardElements.length - 1];
        }
    }
    if (!target) return;
    target.style.visibility = 'hidden';
    pendingBounce.targetUid = target.dataset?.uid || pendingBounce.card?.uid || null;
    if (panel) {
        const cards = panel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back');
        pendingBounce.targetIndex = Array.from(cards).indexOf(target);
    }

    // Resoudre la cible une seule fois (premiere render apres le state update)
    if (!pendingBounce.resolved) {
        const rect = target.getBoundingClientRect();
        _bounceDbg('check:resolved-target', {
            owner,
            handIndex: pendingBounce.handIndex ?? null,
            resolvedUid: pendingBounce.targetUid || null,
            resolvedIndex: pendingBounce.targetIndex ?? null,
            rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
            hand: _bounceHandSnapshot(owner)
        });
        pendingBounce.resolveTarget({
            el: target,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
        });
        pendingBounce.resolved = true;
    }
    // NE PAS null pendingBounce ici - l'animation le fera quand le fly est termine.
}
/**
 * Animation de bounce (Voyage inattendu) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â style pioche inversÃƒÆ’Ã‚Â©e professionnelle
 *
 * Phase 1 - Lift (200ms):   Carte se soulÃƒÆ’Ã‚Â¨ve du slot avec glow magique
 * Phase 2 - Wait:           Carte flotte en attendant la position exacte de render()
 * Phase 3 - Fly (450ms):    Arc BÃƒÆ’Ã‚Â©zier fluide DIRECTEMENT vers la position exacte (pas d'approximation)
 */
async function animateBounceToHand(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    animatingSlots.add(slotKey);
    _bounceDbg('anim:start', {
        owner,
        handIndex: data.handIndex ?? null,
        cardUid: data.card?.uid || data.card?.id || null,
        cardName: data.card?.name || null,
        row: data.row,
        col: data.col,
        toGraveyard: !!data.toGraveyard,
        handBefore: _bounceHandSnapshot(owner)
    });
    let targetPromise = null;
    let handPerspContainer = null;
    let handStartTiltDeg = 0;

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

    // CrÃƒÆ’Ã‚Â©er le wrapper animÃƒÆ’Ã‚Â©
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

    // Carte face visible ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â prÃƒÆ’Ã‚Â©server le backgroundImage
    // Pendant le trajet, utiliser le skin board pour eviter l'effet
    // de typo agrandie observe avec le template "in-hand".
    const cardFace = makeCard(data.card, false);
    const stripSelectors = [
        '.arena-title',
        '.arena-text-zone',
        '.arena-edition',
        '.arena-stat-atk',
        '.arena-stat-hp',
        '.arena-stat-riposte',
        '.arena-mana-group',
        '.img-cost',
        '.img-atk',
        '.img-hp',
        '.gaze-marker',
        '.poison-marker',
        '.entrave-marker',
        '.buff-marker'
    ];
    for (const sel of stripSelectors) {
        cardFace.querySelectorAll(sel).forEach((el) => el.remove());
    }
    const bgImage = cardFace.style.backgroundImage;
    cardFace.style.position = 'absolute';
    cardFace.style.top = '0';
    cardFace.style.left = '0';
    cardFace.style.width = '100%';
    cardFace.style.height = '100%';
    cardFace.style.margin = '0';
    cardFace.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
    if (bgImage) cardFace.style.backgroundImage = bgImage;

    wrapper.appendChild(cardFace);
    document.body.appendChild(wrapper);

    // Auto-fit du nom (les noms longs dÃƒÆ’Ã‚Â©bordent pendant l'animation)
    // no-op: art-only card during bounce travel

    // PrÃƒÂ©parer la cible main avant le lift: empÃƒÂªche l'apparition prÃƒÂ©maturÃƒÂ©e.
    const tryResolveBounceTargetNow = () => {
        if (!pendingBounce || pendingBounce.owner !== owner || pendingBounce.resolved) return false;
        const panel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
        if (!panel) return false;
        const selector = owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back';
        const cards = panel.querySelectorAll(selector);
        if (!cards || cards.length === 0) return false;
        const preferEndForOppUnknownIndex = owner === 'opp' && !_isValidHandIndex(pendingBounce.handIndex);

        // Tant que la nouvelle carte n'est pas rÃ©ellement entrÃ©e en main,
        // ne surtout pas rÃ©soudre la cible (sinon on vise une carte existante).
        if (pendingBounce.queued && typeof pendingBounce.startHandCount === 'number') {
            if (cards.length <= pendingBounce.startHandCount) return false;
        }

        const forceEndTarget = !!pendingBounce.expectAtEnd || preferEndForOppUnknownIndex;
        let target = null;
        const uid = pendingBounce.card?.uid || null;
        if (uid && !preferEndForOppUnknownIndex) {
            target = panel.querySelector(`${selector}[data-uid="${uid}"]`);
        }
        if (!target && !forceEndTarget && _isValidHandIndex(pendingBounce.handIndex)) {
            const idx = Number(pendingBounce.handIndex);
            if (idx >= 0 && idx < cards.length) target = cards[idx];
        }
        if (!target) {
            const logicalCards = Array.from(cards).filter((el) => el.style.width !== '0px');
            target = logicalCards[logicalCards.length - 1] || cards[cards.length - 1];
        }
        if (!target) return false;

        target.style.visibility = 'hidden';
        pendingBounce.targetUid = target.dataset?.uid || uid || null;
        pendingBounce.targetIndex = Array.from(cards).indexOf(target);
        const rect = target.getBoundingClientRect();
        _bounceDbg('anim:poll-resolved-target', {
            owner,
            handIndex: pendingBounce.handIndex ?? null,
            resolvedUid: pendingBounce.targetUid || null,
            resolvedIndex: pendingBounce.targetIndex ?? null,
            rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
            hand: _bounceHandSnapshot(owner)
        });
        pendingBounce.resolveTarget({
            el: target,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
        });
        pendingBounce.resolved = true;
        return true;
    };

    if (!data.toGraveyard) {
        if (data._bounceTargetPromise) {
            targetPromise = data._bounceTargetPromise;
            if (pendingBounce) {
                pendingBounce.wrapper = wrapper;
                if (_isValidHandIndex(data.handIndex)) {
                    pendingBounce.handIndex = Number(data.handIndex);
                }
            }
        } else {
            targetPromise = new Promise(resolve => {
                const handPanel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
                const startHandCount = handPanel
                    ? handPanel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back').length
                    : 0;
                pendingBounce = {
                    owner,
                    card: data.card,
                    handIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                    expectAtEnd: owner === 'me',
                    wrapper,
                    resolveTarget: resolve,
                    startHandCount,
                    queued: true
                };
            });
        }
        render();

        // Fallback actif: si aucun render supplementaire ne survient,
        // resoudre la cible depuis le DOM pour garantir le fly vers la main.
        let pollCount = 0;
        const pollMax = 90; // ~1.5s a 60fps
        const pollResolve = () => {
            if (!pendingBounce || pendingBounce.owner !== owner || pendingBounce.resolved) return;
            tryResolveBounceTargetNow();
            pollCount++;
            if ((!pendingBounce || pendingBounce.owner !== owner || pendingBounce.resolved) || pollCount >= pollMax) return;
            requestAnimationFrame(pollResolve);
        };
        requestAnimationFrame(pollResolve);
    }

    // === PHASE 1 : LIFT (200ms) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â carte se soulÃƒÆ’Ã‚Â¨ve du slot ===
    // Installer la perspective/rotation avant le lift pour eviter la mini-saccade.
    if (!data.toGraveyard) {
        const gameBoard = document.querySelector('.game-board');
        if (gameBoard) {
            try {
                const computedTransform = getComputedStyle(gameBoard).transform;
                if (computedTransform && computedTransform !== 'none') {
                    const mat = new DOMMatrix(computedTransform);
                    const tilt = Math.atan2(mat.m23, mat.m22) * (180 / Math.PI);
                    if (Number.isFinite(tilt)) handStartTiltDeg = Math.max(-25, Math.min(25, tilt));
                }
            } catch (_) {}
        }
        const gameBoardWrapper = document.querySelector('.game-board-wrapper');
        if (gameBoardWrapper) {
            const gbwRect = gameBoardWrapper.getBoundingClientRect();
            handPerspContainer = document.createElement('div');
            handPerspContainer.style.cssText = `
                position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
                z-index: 10000; pointer-events: none;
                perspective: 1000px;
                perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height * 0.8}px;
            `;
            wrapper.remove();
            handPerspContainer.appendChild(wrapper);
            document.body.appendChild(handPerspContainer);
        }
        if (pendingBounce) pendingBounce.wrapper = handPerspContainer || wrapper;
    }

    const liftHeight = 18;
    const liftScale = 1.04;
    let _liftLoggedStart = false;
    let _liftLoggedMid = false;
    let _liftLoggedEnd = false;
    _bounceDbg('anim:lift:setup', {
        owner,
        handIndex: data.handIndex ?? null,
        tiltDeg: Number(handStartTiltDeg.toFixed(2)),
        parent: handPerspContainer ? 'perspective-container' : 'body',
        startX,
        startY,
        cardWidth,
        cardHeight
    });

    await new Promise(resolve => {
        const dur = 140;
        const t0 = performance.now();
        function animate() {
            const p = Math.min((performance.now() - t0) / dur, 1);
            const ep = easeOutCubic(p);
            wrapper.style.top = (startY - ep * liftHeight) + 'px';
            const s = 1 + ep * (liftScale - 1);
            if (Math.abs(handStartTiltDeg) > 0.01 && !data.toGraveyard) {
                wrapper.style.transform = `rotateX(${handStartTiltDeg}deg) scale(${s})`;
            } else {
                wrapper.style.transform = `scale(${s})`;
            }
            if (window.HAND_INDEX_DEBUG) {
                if (!_liftLoggedStart && p <= 0.05) {
                    _liftLoggedStart = true;
                    _bounceDbg('anim:lift:frame', {
                        mark: 'start',
                        p: Number(p.toFixed(2)),
                        transform: wrapper.style.transform,
                        top: wrapper.style.top,
                        left: wrapper.style.left
                    });
                } else if (!_liftLoggedMid && p >= 0.5) {
                    _liftLoggedMid = true;
                    _bounceDbg('anim:lift:frame', {
                        mark: 'mid',
                        p: Number(p.toFixed(2)),
                        transform: wrapper.style.transform,
                        top: wrapper.style.top,
                        left: wrapper.style.left
                    });
                } else if (!_liftLoggedEnd && p >= 0.95) {
                    _liftLoggedEnd = true;
                    _bounceDbg('anim:lift:frame', {
                        mark: 'end',
                        p: Number(p.toFixed(2)),
                        transform: wrapper.style.transform,
                        top: wrapper.style.top,
                        left: wrapper.style.left
                    });
                }
            }
            cardFace.style.boxShadow = '0 6px 14px rgba(0,0,0,0.38)';
            if (p < 1) requestAnimationFrame(animate); else resolve();
        }
        requestAnimationFrame(animate);
    });

    // Convertir de scale vers coordonnÃƒÆ’Ã‚Â©es visuelles rÃƒÆ’Ã‚Â©elles (pas de changement visuel)
    const liftEndCssY = startY - liftHeight;
    const floatX = startX + cardWidth * (1 - liftScale) / 2;
    const floatY = liftEndCssY + cardHeight * (1 - liftScale) / 2;
    const floatW = cardWidth * liftScale;
    const floatH = cardHeight * liftScale;

    wrapper.style.left = floatX + 'px';
    wrapper.style.top = floatY + 'px';
    wrapper.style.width = floatW + 'px';
    wrapper.style.height = floatH + 'px';
    if (Math.abs(handStartTiltDeg) > 0.01 && !data.toGraveyard) {
        wrapper.style.transform = `rotateX(${handStartTiltDeg}deg)`;
    } else {
        wrapper.style.transform = 'none';
    }

    // === Main pleine ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ voler vers le cimetiÃƒÆ’Ã‚Â¨re avec teinte rouge ===
    if (data.toGraveyard) {
        const ownerKey = owner;
        const graveTopEl = document.getElementById(`${ownerKey}-grave-top`);
        const graveBox = document.getElementById(`${ownerKey}-grave-box`);
        const graveEl = graveTopEl || graveBox;

        // graveRenderBlocked dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  incrÃƒÆ’Ã‚Â©mentÃƒÆ’Ã‚Â© par queueAnimation ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â pas de double add

        // Perspective container pour matcher l'inclinaison du board (mÃƒÆ’Ã‚Âªme technique que animateBurn)
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
            // TransfÃƒÆ’Ã‚Â©rer le wrapper dans le perspContainer
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

        // Calibration itÃƒÆ’Ã‚Â©rative (3 passes) pour position/scale exactes avec perspective
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

        // Glow rouge pour indiquer "main pleine ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ cimetiÃƒÆ’Ã‚Â¨re"
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

                // Teinte rouge progressive (mÃƒÆ’Ã‚Âªme filtre que animateBurn)
                const redTint = easeOutCubic(p) * 0.6;
                wrapper.style.filter = `sepia(${redTint * 0.5}) saturate(${1 + redTint * 2}) hue-rotate(-10deg) brightness(${1 - redTint * 0.2})`;

                if (p < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Cacher le wrapper avant de placer la carte dans le cimetiÃƒÆ’Ã‚Â¨re
                    wrapper.style.visibility = 'hidden';

                    // Placer la carte dans le cimetiÃƒÆ’Ã‚Â¨re (mÃƒÆ’Ã‚Âªme logique que animateBurn)
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

                    // Mise ÃƒÆ’Ã‚Â  jour dynamique de la popup cimetiÃƒÆ’Ã‚Â¨re
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

    // === Main pas pleine ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ voler vers la main (flow normal) ===

    if (pendingBounce) pendingBounce.wrapper = handPerspContainer || wrapper;

    if (Math.abs(handStartTiltDeg) > 0.01) {
        wrapper.style.transform = `rotateX(${handStartTiltDeg}deg)`;
    }

    // Target resolution window: keep short to avoid visible stalls.
    const targetTimeoutMs = 1600;
    let resolvedTarget = null;
    const targetReadyPromise = Promise.race([
        targetPromise,
        new Promise(resolve => setTimeout(() => resolve(null), targetTimeoutMs))
    ]).then((target) => {
        resolvedTarget = target || null;
        return resolvedTarget;
    });
    void targetReadyPromise;

    const handPanelSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const handCardSelector = owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back';

    function findResolvedTargetElement() {
        const panel = document.querySelector(handPanelSelector);
        if (!panel) return null;
        const cards = Array.from(panel.querySelectorAll(handCardSelector)).filter((el) => el.style.width !== '0px');
        if (!cards.length) return null;
        const mustWaitForNewCard = !!(
            pendingBounce &&
            pendingBounce.queued &&
            typeof pendingBounce.startHandCount === 'number' &&
            cards.length <= pendingBounce.startHandCount &&
            !pendingBounce.resolved
        );
        if (mustWaitForNewCard) return null;

        if (pendingBounce?.targetUid) {
            const byUid = panel.querySelector(`${handCardSelector}[data-uid="${pendingBounce.targetUid}"]`);
            if (byUid && byUid.style.width !== '0px') return byUid;
        }
        if (_isValidHandIndex(pendingBounce?.targetIndex)) {
            const idx = Number(pendingBounce.targetIndex);
            if (idx >= 0 && idx < cards.length) return cards[idx];
        }
        if (_isValidHandIndex(pendingBounce?.handIndex) && !pendingBounce?.expectAtEnd) {
            const idx = Number(pendingBounce.handIndex);
            if (idx >= 0 && idx < cards.length) return cards[idx];
        }
        if (pendingBounce?.expectAtEnd) return cards[cards.length - 1] || null;
        return null;
    }

    function buildFallbackEndTarget() {
        const panel = document.querySelector(handPanelSelector);
        const w = Math.max(36, floatW * 0.68);
        const h = Math.max(48, floatH * 0.68);
        let x = floatX;
        let y = floatY + Math.min(160, Math.max(70, floatH * 0.7));

        if (panel) {
            const pr = panel.getBoundingClientRect();
            // Fallback stays around hand horizontal zone, but never dives deep.
            x = owner === 'me' ? (pr.left + pr.width * 0.5 - w * 0.5) : (pr.left + pr.width * 0.5 - w * 0.5);
            const safeLowY = Math.max(12, window.innerHeight - h - 12);
            y = Math.min(pr.top + Math.max(6, (pr.height - h) / 2), safeLowY);
        }

        // Never let provisional target leave viewport.
        const minX = 8;
        const minY = 8;
        const maxX = Math.max(minX, window.innerWidth - w - 8);
        const maxY = Math.max(minY, window.innerHeight - h - 8);
        x = Math.min(maxX, Math.max(minX, x));
        y = Math.min(maxY, Math.max(minY, y));
        return { x, y, w, h };
    }

    // Small settle phase after lift while target resolves (no hard freeze).
    const settleDuration = 220;
    const settleMaxWait = 1200;
    await new Promise(resolve => {
        const t0 = performance.now();
        function animateSettle() {
            const elapsed = performance.now() - t0;
            const p = Math.min(elapsed / settleDuration, 1);
            const bob = Math.sin(p * Math.PI) * 2.2;
            wrapper.style.left = floatX + 'px';
            wrapper.style.top = (floatY - bob) + 'px';
            const live = findResolvedTargetElement();
            if (!resolvedTarget && live) {
                const r = live.getBoundingClientRect();
                resolvedTarget = { x: r.left, y: r.top, w: r.width, h: r.height };
            }
            if ((!resolvedTarget && elapsed < settleMaxWait) || (p < 1 && !resolvedTarget)) {
                requestAnimationFrame(animateSettle);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(animateSettle);
    });

    // PHASE 3: fly to hand (slower and stable target to avoid off-screen dip)
    const flyX0 = floatX;
    const flyY0 = floatY;
    const flyW0 = floatW;
    const flyH0 = floatH;
    const fallbackEnd = buildFallbackEndTarget();
    const flyDuration = 540;
    let sawRealTarget = false;
    _bounceDbg('anim:fly:init', {
        owner,
        handIndex: data.handIndex ?? null,
        floatStart: { x: Number(flyX0.toFixed(2)), y: Number(flyY0.toFixed(2)), w: Number(flyW0.toFixed(2)), h: Number(flyH0.toFixed(2)) },
        fallbackEnd: { x: Number(fallbackEnd.x.toFixed(2)), y: Number(fallbackEnd.y.toFixed(2)), w: Number(fallbackEnd.w.toFixed(2)), h: Number(fallbackEnd.h.toFixed(2)) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        pendingUid: pendingBounce?.targetUid || null,
        pendingIndex: pendingBounce?.targetIndex ?? null
    });

    await new Promise(resolve => {
        const t0 = performance.now();
        let lastTargetKind = null;
        let loggedStart = false;
        let loggedMid = false;
        let loggedEnd = false;
        function animate() {
            const p = Math.min((performance.now() - t0) / flyDuration, 1);
            const t = easeInOutCubic(p);

            let end = fallbackEnd;
            let targetKind = 'fallback';
            const liveTarget = findResolvedTargetElement();
            if (liveTarget) {
                const r = liveTarget.getBoundingClientRect();
                end = { x: r.left, y: r.top, w: r.width, h: r.height };
                sawRealTarget = true;
                targetKind = 'live';
            } else if (resolvedTarget) {
                end = { x: resolvedTarget.x, y: resolvedTarget.y, w: resolvedTarget.w, h: resolvedTarget.h };
                sawRealTarget = true;
                targetKind = 'resolved';
            }

            if (targetKind !== lastTargetKind) {
                lastTargetKind = targetKind;
                _bounceDbg('anim:fly:target-switch', {
                    owner,
                    handIndex: data.handIndex ?? null,
                    p: Number(p.toFixed(3)),
                    targetKind,
                    end: {
                        x: Number(end.x.toFixed(2)),
                        y: Number(end.y.toFixed(2)),
                        w: Number(end.w.toFixed(2)),
                        h: Number(end.h.toFixed(2))
                    }
                });
            }

            const endX = end.x;
            const endY = end.y;
            const endW = end.w;
            const endH = end.h;
            const ctrlX = (flyX0 + endX) / 2;
            const ctrlY = Math.min(flyY0, endY) - 34;

            const x = (1-t)*(1-t)*flyX0 + 2*(1-t)*t*ctrlX + t*t*endX;
            const y = (1-t)*(1-t)*flyY0 + 2*(1-t)*t*ctrlY + t*t*endY;
            const w = flyW0 + (endW - flyW0) * t;
            const h = flyH0 + (endH - flyH0) * t;

            let finalX = x;
            let finalY = y;
            if (targetKind === 'fallback') {
                const minX = 4;
                const minY = 4;
                const maxX = Math.max(minX, window.innerWidth - w - 4);
                const maxY = Math.max(minY, window.innerHeight - h - 4);
                finalX = Math.min(maxX, Math.max(minX, x));
                finalY = Math.min(maxY, Math.max(minY, y));
            }
            wrapper.style.left = finalX + 'px';
            wrapper.style.top = finalY + 'px';
            wrapper.style.width = w + 'px';
            wrapper.style.height = h + 'px';
            if (Math.abs(handStartTiltDeg) > 0.01) {
                const tilt = handStartTiltDeg * (1 - t);
                wrapper.style.transform = `rotateX(${tilt}deg)`;
            } else {
                wrapper.style.transform = 'none';
            }
            cardFace.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';

            if (!loggedStart && p <= 0.04) {
                loggedStart = true;
                _bounceDbg('anim:fly:frame', {
                    mark: 'start',
                    owner,
                    handIndex: data.handIndex ?? null,
                    p: Number(p.toFixed(3)),
                    targetKind,
                    calc: {
                        x: Number(x.toFixed(2)),
                        y: Number(y.toFixed(2)),
                        finalX: Number(finalX.toFixed(2)),
                        finalY: Number(finalY.toFixed(2)),
                        w: Number(w.toFixed(2)),
                        h: Number(h.toFixed(2))
                    },
                    end: {
                        x: Number(endX.toFixed(2)),
                        y: Number(endY.toFixed(2)),
                        w: Number(endW.toFixed(2)),
                        h: Number(endH.toFixed(2))
                    }
                });
            } else if (!loggedMid && p >= 0.5) {
                loggedMid = true;
                _bounceDbg('anim:fly:frame', {
                    mark: 'mid',
                    owner,
                    handIndex: data.handIndex ?? null,
                    p: Number(p.toFixed(3)),
                    targetKind,
                    calc: {
                        x: Number(x.toFixed(2)),
                        y: Number(y.toFixed(2)),
                        finalX: Number(finalX.toFixed(2)),
                        finalY: Number(finalY.toFixed(2)),
                        w: Number(w.toFixed(2)),
                        h: Number(h.toFixed(2))
                    },
                    end: {
                        x: Number(endX.toFixed(2)),
                        y: Number(endY.toFixed(2)),
                        w: Number(endW.toFixed(2)),
                        h: Number(endH.toFixed(2))
                    }
                });
            } else if (!loggedEnd && p >= 0.96) {
                loggedEnd = true;
                _bounceDbg('anim:fly:frame', {
                    mark: 'end',
                    owner,
                    handIndex: data.handIndex ?? null,
                    p: Number(p.toFixed(3)),
                    targetKind,
                    calc: {
                        x: Number(x.toFixed(2)),
                        y: Number(y.toFixed(2)),
                        finalX: Number(finalX.toFixed(2)),
                        finalY: Number(finalY.toFixed(2)),
                        w: Number(w.toFixed(2)),
                        h: Number(h.toFixed(2))
                    },
                    end: {
                        x: Number(endX.toFixed(2)),
                        y: Number(endY.toFixed(2)),
                        w: Number(endW.toFixed(2)),
                        h: Number(endH.toFixed(2))
                    }
                });
            }

            if (p < 1) {
                requestAnimationFrame(animate);
            } else {
                const wr = wrapper.getBoundingClientRect();
                _bounceDbg('anim:fly:landing-check', {
                    owner,
                    handIndex: data.handIndex ?? null,
                    targetKind: lastTargetKind || 'unknown',
                    wrapperRect: _handIdxRectToLog(wr),
                    endRect: {
                        left: Number(endX.toFixed(2)),
                        top: Number(endY.toFixed(2)),
                        width: Number(endW.toFixed(2)),
                        height: Number(endH.toFixed(2))
                    },
                    delta: {
                        dx: Number((wr.left - endX).toFixed(2)),
                        dy: Number((wr.top - endY).toFixed(2)),
                        dw: Number((wr.width - endW).toFixed(2)),
                        dh: Number((wr.height - endH).toFixed(2))
                    }
                });
                resolve();
            }
        }
        requestAnimationFrame(animate);
    });

    _bounceDbg('anim:target-result', {
        owner,
        handIndex: data.handIndex ?? null,
        hasTarget: !!(sawRealTarget || pendingBounce?.resolved),
        target: resolvedTarget ? { x: resolvedTarget.x, y: resolvedTarget.y, w: resolvedTarget.w, h: resolvedTarget.h } : null,
        pending: !!pendingBounce,
        pendingResolved: !!pendingBounce?.resolved,
        pendingUid: pendingBounce?.targetUid || null,
        pendingIndex: pendingBounce?.targetIndex ?? null
    });

    // Let render() own final reveal, to avoid visual flashes.
    if (pendingBounce) {
        pendingBounce.completed = true;
        pendingBounce.wrapper = handPerspContainer || wrapper;
        _bounceDbg('anim:fly-complete', {
            owner,
            handIndex: data.handIndex ?? null,
            pendingUid: pendingBounce.targetUid || null,
            pendingIndex: pendingBounce.targetIndex ?? null,
            handAfterFly: _bounceHandSnapshot(owner)
        });
    } else if (handPerspContainer && handPerspContainer.isConnected) {
        handPerspContainer.remove();
    } else {
        wrapper.remove();
    }
    animatingSlots.delete(slotKey);
    // render() gÃƒÂ¨re la rÃƒÂ©vÃƒÂ©lation finale (pendingBounce.completed) et le cleanup visuel.
    render();
}

// === Animation Graveyard Return (Goule tenace) ===
// Copie exacte de animateBounceToHand, mais part du cimetiÃƒÆ’Ã‚Â¨re au lieu du terrain.
// Utilise pendingBounce AVANT le lift (contrairement ÃƒÆ’Ã‚Â  bounce qui le fait aprÃƒÆ’Ã‚Â¨s) car
// emitAnimation et emitStateToBoth arrivent quasi-simultanÃƒÆ’Ã‚Â©ment du serveur.
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

    // Retirer la carte de la popup cimetiÃƒÆ’Ã‚Â¨re si ouverte
    removeCardFromGraveyardPopup(owner, data.card);

    const graveEl = document.getElementById(owner + '-grave-box');
    const graveTopEl = document.getElementById(owner + '-grave-top');
    if (!graveEl) return;

    // Utiliser le pendingBounce prÃƒÆ’Ã‚Â©-enregistrÃƒÆ’Ã‚Â© au queue time, ou en crÃƒÆ’Ã‚Â©er un nouveau
    let targetPromise;
    if (data._bounceTargetPromise) {
        targetPromise = data._bounceTargetPromise;
    } else {
        targetPromise = new Promise(resolve => {
            const handPanel = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
            const startHandCount = handPanel
                ? handPanel.querySelectorAll(owner === 'me' ? '.card:not(.committed-spell)' : '.opp-card-back').length
                : 0;
            pendingBounce = {
                owner,
                card: data.card,
                handIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
                expectAtEnd: owner === 'me',
                resolveTarget: resolve,
                startHandCount,
                queued: true
            };
        });
    }

    // RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence de gÃƒÆ’Ã‚Â©omÃƒÆ’Ã‚Â©trie: le slot du cimetiÃƒÆ’Ã‚Â¨re (stable), pas la carte interne
    // qui peut avoir un ratio/style diffÃƒÆ’Ã‚Â©rent (source d'effet "tassÃƒÆ’Ã‚Â©").
    const graveTopCardEl = graveTopEl ? graveTopEl.querySelector('.card') : null;
    const sourceSlotEl = graveTopEl || graveEl;
    const sourceRect = sourceSlotEl.getBoundingClientRect();
    const sourceCardRect = graveTopCardEl ? graveTopCardEl.getBoundingClientRect() : null;
    const sourceTransform = getComputedStyle(sourceSlotEl).transform;
    const sourceTiltDeg = extractRotateXDeg(sourceTransform);

    // Prendre la taille d'une carte de main existante pour garder exactement
    // le mÃƒÆ’Ã‚Âªme axe/look pendant toute l'animation (pas de reconfiguration visuelle).
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
    // IMPORTANT: ÃƒÆ’Ã‚Â©viter un scale anisotrope (X != Y) qui "tasse" la carte.
    const initialScaleXRaw = sourceRect.width / Math.max(1, cardW);
    const initialScaleYRaw = sourceRect.height / Math.max(1, cardH);
    const initialScaleRaw = Math.sqrt(Math.max(1e-6, initialScaleXRaw * initialScaleYRaw));
    const initialScale = Number.isFinite(initialScaleRaw) && initialScaleRaw > 0 ? initialScaleRaw : 1;
    const initialScaleX = initialScale;
    const initialScaleY = initialScale;
    // X centrÃƒÆ’Ã‚Â© sur le cimetiÃƒÆ’Ã‚Â¨re.
    const startX = sourceRect.left + sourceRect.width / 2 - cardW / 2;
    // Y: dÃƒÆ’Ã‚Â©marrer SOUS le bord bas du cimetiÃƒÆ’Ã‚Â¨re (full masquÃƒÆ’Ã‚Â©), puis extraction vers le haut.
    const sourceBottomY = sourceRect.top + sourceRect.height;
    const startY = sourceBottomY;

    // Inclinaison de dÃƒÆ’Ã‚Â©part (inspirÃƒÆ’Ã‚Â©e du board) pour la sortie du cimetiÃƒÆ’Ã‚Â¨re.
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
    // pour ÃƒÆ’Ã‚Â©viter les micro-mouvements de texte/stats pendant le vol.
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
            // Sortie du cimetiÃƒÆ’Ã‚Â¨re : garder l'axe inclinÃƒÆ’Ã‚Â© "cimetiÃƒÆ’Ã‚Â¨re".
            flyCard.style.transform = `rotateX(${startTiltDeg}deg) scale(${initialScaleX}, ${initialScaleY})`;
            // Clip basÃƒÆ’Ã‚Â© sur la gÃƒÆ’Ã‚Â©omÃƒÆ’Ã‚Â©trie PROJETÃƒÆ’Ã¢â‚¬Â°E rÃƒÆ’Ã‚Â©elle (perspective + rotateX),
            // pour ÃƒÆ’Ã‚Â©viter l'effet de traversÃƒÆ’Ã‚Â©e en deux temps.
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

    // DÃƒÆ’Ã‚Â©part de la phase 2 (on est dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  en fixed/viewport)
    const extractedRect = flyCard.getBoundingClientRect();
    const extractedCx = extractedRect.left + extractedRect.width / 2;
    const extractedCy = extractedRect.top + extractedRect.height / 2;
    const startScaleX = initialScaleX;
    const startScaleY = initialScaleY;
    const flyX0 = extractedCx - cardW / 2;
    const flyY0 = extractedCy - cardH / 2;
    flyCard.style.transform = `rotateX(${startTiltDeg}deg) scale(${startScaleX}, ${startScaleY})`;

    if (pendingBounce) pendingBounce.wrapper = overlayRoot;

    // Forcer la rÃƒÆ’Ã‚Â©solution si le state est dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  arrivÃƒÆ’Ã‚Â©
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

    // Helper : trouver la derniÃƒÆ’Ã‚Â¨re carte ACTUELLE dans la main
    // TOUJOURS requÃƒÆ’Ã‚Âªter le DOM ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ne jamais rÃƒÆ’Ã‚Â©utiliser target.el car un re-render
    // peut l'avoir remplacÃƒÆ’Ã‚Â© (l'ancien reste "connected" mais invisible/orphelin)
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
        // Position cible (recalculÃƒÆ’Ã‚Â©e au cas oÃƒÆ’Ã‚Â¹ un re-render a bougÃƒÆ’Ã‚Â© les cartes)
        const curTarget = findCurrentTarget();
        const endRect = curTarget ? curTarget.getBoundingClientRect() : { left: target.x, top: target.y, width: target.w, height: target.h };
        const endCx = endRect.left + endRect.width / 2;
        const endCy = endRect.top + endRect.height / 2;
        const startCx = flyX0 + cardW / 2;
        const startCy = flyY0 + cardH / 2;

        // === PHASE 2 : VOL vers la main (450ms) ===
        const ctrlX = (startCx + endCx) / 2;
        const ctrlY = Math.min(startCy, endCy) - 80;

        // Bridge progressif : on "dÃƒÆ’Ã‚Â©plie" la perspective du board vers la main
        // tout en convergeant vers la taille projetÃƒÆ’Ã‚Â©e de la cible.
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

                // DÃƒÆ’Ã‚Â©sinclinaison progressive pendant la descente + convergence d'ÃƒÆ’Ã‚Â©chelle.
                // Avant l'apex: on garde l'axe inclinÃƒÆ’Ã‚Â©.
                // AprÃƒÆ’Ã‚Â¨s l'apex: on redresse progressivement vers l'axe main.
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
                    // NE PAS null pendingBounce ici ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â le laisser vivre jusqu'au prochain render
                    // pour que le render puisse faire ses opÃƒÆ’Ã‚Â©rations DOM (purge, replaceWith, append)
                    // avec la flyCard en couverture visuelle et le pendingBounce bloquant la visibilitÃƒÆ’Ã‚Â©.
                    // Sinon: race condition ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â si le state arrive APRÃƒÆ’Ã‹â€ S le SWAP, le render fait
                    // purge + replaceWith + append avec pendingBounce=null ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ flash visuel.

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

    // pendingBounce sera null aprÃƒÆ’Ã‚Â¨s le cleanup (render ou safety timeout/rAF)

    // Forcer la mise ÃƒÆ’Ã‚Â  jour du cimetiÃƒÆ’Ã‚Â¨re depuis le state actuel
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
// Trap slots en cours d'animation ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â renderTraps() ne doit pas y toucher
let animatingTrapSlots = new Set();
// Slots avec deathTransform EN COURS D'EXÃƒÆ’Ã¢â‚¬Â°CUTION (protÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â©s contre resetAnimationStates)
let activeDeathTransformSlots = new Set();

/**
 * RÃƒÆ’Ã‚Â©initialise tous les ÃƒÆ’Ã‚Â©tats d'animation pour ÃƒÆ’Ã‚Â©viter les bugs de persistance
 * AppelÃƒÆ’Ã‚Â© au dÃƒÆ’Ã‚Â©but de chaque nouveau tour
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
        if (trapSlotsStillNeeded.has(key)) continue;
        const [owner, rowStr] = key.split('-');
        const row = Number(rowStr);
        const trapSlot = Number.isFinite(row) ? getTrapSlot(owner, row) : null;
        const hasActiveTrapVisual = !!trapSlot?.querySelector('.trap-trigger-flipper, .trap-trigger-face');
        if (hasActiveTrapVisual) continue;
        animatingTrapSlots.delete(key);
    }

    // NE PAS vider la file d'animation - laisser les animations se terminer naturellement
    // Cela ÃƒÆ’Ã‚Â©vite de perdre des animations comme zdejebel qui arrivent en fin de tour
    // animationQueue.length = 0;
    // isAnimating = false;

    // Nettoyer les animations de pioche en attente
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.clear();
    }

    // RÃƒÆ’Ã‚Â©initialiser les flags de combat sur toutes les cartes
    document.querySelectorAll('.card[data-in-combat="true"]').forEach(card => {
        card.dataset.inCombat = 'false';
    });

    // Filet de sÃƒÆ’Ã‚Â©curitÃƒÆ’Ã‚Â© : aucun override visuel ne doit survivre ÃƒÆ’Ã‚Â  un nouveau tour.
    if (typeof poisonHpOverrides !== 'undefined' && poisonHpOverrides?.clear) {
        poisonHpOverrides.clear();
    }
    if (typeof powerBuffAtkOverrides !== 'undefined' && powerBuffAtkOverrides?.clear) {
        powerBuffAtkOverrides.clear();
    }

    // Retirer les classes d'animation rÃƒÆ’Ã‚Â©siduelles
    document.querySelectorAll('.card.dying').forEach(card => {
        card.classList.remove('dying');
    });

}

// Animation de lÃƒÆ’Ã‚Â©vitation continue pour les crÃƒÆ’Ã‚Â©atures volantes
// Utilise le temps global pour que l'animation reste synchronisÃƒÆ’Ã‚Â©e mÃƒÆ’Ã‚Âªme aprÃƒÆ’Ã‚Â¨s re-render
const flyingAnimationSpeed = 0.002; // Vitesse de l'oscillation
const flyingAnimationAmplitude = 4; // Amplitude en pixels

function startFlyingAnimation(cardEl) {
    // Guard : ne pas empiler de boucles RAF sur le mÃƒÆ’Ã‚Âªme ÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©ment
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
            requestAnimationFrame(animate); // Continue ÃƒÆ’Ã‚Â  vÃƒÆ’Ã‚Â©rifier pour reprendre aprÃƒÆ’Ã‚Â¨s
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
 * Retourne une Promise rÃƒÆ’Ã‚Â©solue quand l'animation est terminÃƒÆ’Ã‚Â©e.
 * @param {DOMRect} targetRect - Rectangle cible (slot, trap, centre)
 * @param {number} duration - DurÃƒÆ’Ã‚Â©e en ms (dÃƒÆ’Ã‚Â©faut 300)
 * @returns {Promise<void>}
 */
function flyFromOppHand(targetRect, duration = 300, spell = null, savedSourceRect = null, options = {}) {
    return new Promise(resolve => {
        let handRect = savedSourceRect;
        let sourceMode = savedSourceRect ? 'saved-source-rect' : 'fallback-last-visible';
        const sourceIndex = _isValidHandIndex(options?.sourceIndex) ? Number(options.sourceIndex) : null;
        const strictNoLastFallback = !!options?.strictNoLastFallback;
        const preferredUid = options?.preferredUid || spell?.uid || spell?.id || null;

        if (!handRect) {
            const resolved = _resolveOppHandSourceByIndexAndUid(
                sourceIndex,
                preferredUid,
                {
                    strictIndex: sourceIndex !== null,
                    strictNoFallback: strictNoLastFallback
                }
            );
            if (!resolved.el || !resolved.rect) {
                _oppPlayDbg('flyFromOppHand:no-source', {
                    sourceMode,
                    spellUid: preferredUid,
                    sourceIndex,
                    strictNoLastFallback,
                    targetRect: _handIdxRectToLog(targetRect)
                });
                if (strictNoLastFallback) {
                    resolve();
                    return;
                }
                resolve();
                return;
            }
            handRect = resolved.rect;
            sourceMode = resolved.mode || sourceMode;
        }

        // Cacher la carte revealed dans la main (elle va ÃƒÆ’Ã‚Âªtre remplacÃƒÆ’Ã‚Â©e par le clone volant)
        _oppPlayDbg('flyFromOppHand:source', {
            sourceMode,
            spellUid: preferredUid,
            sourceIndex,
            strictNoLastFallback,
            spellName: spell?.name || null,
            handRect: _handIdxRectToLog(handRect),
            targetRect: _handIdxRectToLog(targetRect),
            duration
        });
        if (spell && spell.uid) {
            const handPanel = document.getElementById('opp-hand');
            const match = handPanel?.querySelector(`.opp-revealed[data-uid="${spell.uid}"]`);
            if (match) {
                match.style.visibility = 'hidden';
                smoothCloseOppHandGap(match);
            }
        }

        // CrÃƒÆ’Ã‚Â©er la carte volante directement ÃƒÆ’Ã‚Â  la taille cible (comme un drag)
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

            // Centre sur la courbe de BÃƒÆ’Ã‚Â©zier
            const cx = (1-t)*(1-t)*scx + 2*(1-t)*t*ccx + t*t*ecx;
            const cy = (1-t)*(1-t)*scy + 2*(1-t)*t*ccy + t*t*ecy;

            // Convertir centre ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ top-left (taille fixe)
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

// Animation d'invocation - overlay indÃƒÆ’Ã‚Â©pendant du render
// Carte adverse : vole de la main vers le slot puis apparaÃƒÆ’Ã‚Â®t
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

        _clearSlotContent(targetSlot);
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

    // Animation d'invocation pour ses propres crÃƒÆ’Ã‚Â©atures
    // DÃƒÆ’Ã‚Â©lai pour synchroniser la fin avec l'animation adverse (fly+flip ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  1040ms, ripple ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  820ms)
    if (data.player === myNum) {
        // Garder le slot bloquÃƒÆ’Ã‚Â© jusqu'ÃƒÆ’Ã‚Â  ce que le state serveur soit prÃƒÆ’Ã‚Âªt pour ÃƒÆ’Ã‚Â©viter les flashs.
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

    // Le slot devrait dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  ÃƒÆ’Ã‚Âªtre bloquÃƒÆ’Ã‚Â© par blockSlots, mais on s'assure
    animatingSlots.add(slotKey);

    // Trouver le slot cible
    const slot = getSlot(owner, data.row, data.col);
    if (!slot) {
        animatingSlots.delete(slotKey);
        resolve();
        return;
    }

    // Vider le slot (au cas oÃ¹) â€” garder la frame SVG + diamant
    _clearSlotContent(slot);
    slot.classList.remove('has-card');

    const rect = slot.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;

    const summonCard = getRenderableSummonCard(false);
    const isRevealed = !!(summonCard && summonCard.revealedToOpponent);

    // Utiliser la position sauvegardÃƒÆ’Ã‚Â©e au dÃƒÆ’Ã‚Â©but de la rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lation (avant re-render)
    let savedSourceRect = _coerceRectLike(data?._oppSourceRect);
    const revealedCacheRect = (isRevealed && summonCard?.uid)
        ? (savedRevealedCardRects.get(summonCard.uid) || null)
        : null;

    // Pour les crÃƒÆ’Ã‚Â©atures non rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©es : prendre le dos de carte directement du DOM
    // (renderOppHand est gelÃƒÆ’Ã‚Â© pendant les summons, donc les cartes sont encore lÃƒÆ’Ã‚Â )
    // Filtrer les cartes visibles (les cachÃƒÆ’Ã‚Â©es ont dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  ÃƒÆ’Ã‚Â©tÃƒÆ’Ã‚Â© "prises" par une animation prÃƒÆ’Ã‚Â©cÃƒÆ’Ã‚Â©dente)
    const oppAnimIndex = _pickOppAnimIndex(data) ?? (_isValidHandIndex(data?._oppSourceIndex) ? Number(data._oppSourceIndex) : null);
    const preferredSummonUid = data?._oppSourceUid || summonCard?.uid || data.card?.uid || data.card?.id || null;
    const strictSummonSource = !!(data?._oppSourceStrict) || oppAnimIndex !== null || !!preferredSummonUid || !!savedSourceRect;
    if (strictSummonSource) {
        _oppPlayDbg('summon:resolve-source:start', {
            visualHandIndex: Number.isFinite(Number(data.visualHandIndex)) ? Number(data.visualHandIndex) : null,
            fallbackHandIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
            originalHandIndex: _isValidHandIndex(data.originalHandIndex) ? Number(data.originalHandIndex) : null,
            reconstructedHandIndex: _isValidHandIndex(data.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
            oppAnimIndex,
            row: Number.isFinite(Number(data.row)) ? Number(data.row) : null,
            col: Number.isFinite(Number(data.col)) ? Number(data.col) : null,
            cardUid: preferredSummonUid,
            cardName: summonCard?.name || data.card?.name || null
        });
        let sourceMode = savedSourceRect ? (data?._oppSourceMode || 'socket-snapshot') : 'fly-fallback';
        const resolved = _resolveOppHandSourceByIndexAndUid(
            oppAnimIndex,
            preferredSummonUid,
            {
                strictIndex: strictSummonSource,
                strictNoFallback: strictSummonSource
            }
        );
        if (resolved.el && resolved.rect) {
            savedSourceRect = resolved.rect;
            resolved.el.style.visibility = 'hidden'; // Cacher sans reflow
            smoothCloseOppHandGap(resolved.el);
            sourceMode = resolved.mode;
        } else if (!savedSourceRect && revealedCacheRect) {
            savedSourceRect = revealedCacheRect;
            sourceMode = 'saved-revealed-cache';
        } else if (!strictSummonSource && savedOppHandRects && oppAnimIndex !== null && oppAnimIndex < savedOppHandRects.length) {
            savedSourceRect = savedOppHandRects[oppAnimIndex];
            sourceMode = 'saved-cache-index';
        }
        _oppPlayDbg('summon:resolve-source:end', {
            visualHandIndex: Number.isFinite(Number(data.visualHandIndex)) ? Number(data.visualHandIndex) : null,
            fallbackHandIndex: _isValidHandIndex(data.handIndex) ? Number(data.handIndex) : null,
            originalHandIndex: _isValidHandIndex(data.originalHandIndex) ? Number(data.originalHandIndex) : null,
            reconstructedHandIndex: _isValidHandIndex(data.reconstructedHandIndex) ? Number(data.reconstructedHandIndex) : null,
            oppAnimIndex,
            strictSummonSource,
            sourceMode,
            savedRect: _handIdxRectToLog(savedSourceRect),
            savedRectsCount: savedOppHandRects ? savedOppHandRects.length : 0
        });
    }

    // Phase 1 : carte vole de la main adverse vers le slot (300ms)
    // Si rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©e, la carte vole face visible depuis sa position sauvegardÃƒÆ’Ã‚Â©e
    flyFromOppHand(rect, 300, isRevealed ? summonCard : null, savedSourceRect, {
        sourceIndex: oppAnimIndex,
        strictNoLastFallback: true,
        preferredUid: preferredSummonUid
    }).then(() => {
        if (isRevealed) {
            // Carte dÃƒÆ’Ã‚Â©jÃƒÆ’Ã‚Â  rÃƒÆ’Ã‚Â©vÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©e ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ pas de flip, juste lever + poser face visible
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
            // Carte cachÃƒÆ’Ã‚Â©e ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ flip classique dos ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ face
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
 * Anime une carte face visible volant du cimetiÃƒÆ’Ã‚Â¨re vers une position cible.
 * MÃƒÆ’Ã‚Âªme pattern que flyFromOppHand mais partant du cimetiÃƒÆ’Ã‚Â¨re, carte visible.
 */
function flyFromGraveyardFaceUp(owner, targetRect, card, duration = 500, targetSlot = null) {
    return new Promise(resolve => {
        const graveEl = document.getElementById(owner + '-grave-box');
        const board = document.querySelector('.game-board');
        if (!graveEl || !board) { resolve(); return; }

        // Position relative au board (coordonnÃƒÆ’Ã‚Â©es locales, dans le contexte 3D)
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

        // CrÃƒÆ’Ã‚Â©er la carte DANS le board ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ hÃƒÆ’Ã‚Â©rite perspective + rotateX naturellement
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
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] IN BOARD ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â graveOff: (${startX}, ${startY}), cardSize: ${cardW}x${cardH}`);
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] endOff: (${endOff.x}, ${endOff.y})`);

        // === ÃƒÆ’Ã¢â‚¬Â°TAPE 1 : Extraire vers le haut (350ms) ===
        // Monte dans l'espace local du board (vers le hÃƒÆ’Ã‚Â©ros = Y dÃƒÆ’Ã‚Â©croissant)
        const extractEndY = startY - cardH - 50;
        const extractDistance = startY - extractEndY;
        const extractDur = 350;

        // Clip : masquer la partie encore "dans" le cimetiÃƒÆ’Ã‚Â¨re
        flyCard.style.clipPath = `inset(0 0 ${cardH}px 0)`;
        if (window.DEBUG_LOGS) console.log(`[REANIMATE] EXTRACT: from Y=${startY} to Y=${extractEndY}, dist=${extractDistance}`);

        let logCnt = 0;
        const extractT0 = performance.now();
        function extractUp() {
            const p = Math.min((performance.now() - extractT0) / extractDur, 1);
            const ep = easeOutCubic(p);
            const curY = startY - ep * extractDistance;
            flyCard.style.top = curY + 'px';

            // Clip : tout ce qui dÃƒÆ’Ã‚Â©passe sous startY (= top du cimetiÃƒÆ’Ã‚Â¨re)
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

                // === ÃƒÆ’Ã¢â‚¬Â°TAPE 2 : Voler vers le slot cible ===
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

// Animation d'invocation par piÃƒÆ’Ã‚Â¨ge ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â apparition magique directement dans le slot (hÃƒÆ’Ã‚Â©rite de la perspective 3D)
// SynchronisÃƒÆ’Ã‚Â©e avec createTrapSummonEffect (PixiJS VFX) :
//   Phase 0: 0-400ms      Energy gathering (VFX only, card invisible)
//   Phase 1: 400-800ms    Portal opens (VFX only, card invisible)
//   Phase 2: 800-1000ms   Flash & card materializes (card scale 0ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢1, brightness 3ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢1)
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

        _clearSlotContent(slot);
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

        _clearSlotContent(slot);
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
    // Animation de coup de vent pour ses propres crÃƒÆ’Ã‚Â©atures dÃƒÆ’Ã‚Â©placÃƒÆ’Ã‚Â©es
    // DÃƒÆ’Ã‚Â©lai pour synchroniser la fin avec l'animation adverse (slide ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  500ms, vent ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  480ms)
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

    // Forcer render() AVANT de bloquer les slots (pour afficher les mises ÃƒÆ’Ã‚Â  jour en attente, ex: poison)
    render();

    // Bloquer les deux slots (origine et destination)
    animatingSlots.add(fromKey);
    animatingSlots.add(toKey);

    // Vider les DEUX slots immÃƒÆ’Ã‚Â©diatement (pour ÃƒÆ’Ã‚Â©viter le doublon visuel)
    _clearSlotContent(fromSlot);
    fromSlot.classList.remove('has-card');

    _clearSlotContent(toSlot);
    toSlot.classList.remove('has-card');

    // RÃƒÆ’Ã‚Â©cupÃƒÆ’Ã‚Â©rer les positions
    const fromRect = fromSlot.getBoundingClientRect();
    const toRect = toSlot.getBoundingClientRect();
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;

    // CrÃƒÆ’Ã‚Â©er une carte overlay (makeCard met le backgroundImage en inline, on ne doit pas l'ÃƒÆ’Ã‚Â©craser)
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

    // Forcer le reflow puis dÃƒÆ’Ã‚Â©clencher la transition via transform
    movingCard.getBoundingClientRect();
    requestAnimationFrame(() => {
        movingCard.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    });

    // Nettoyer aprÃƒÆ’Ã‚Â¨s l'animation (500ms transition + 100ms marge)
    setTimeout(() => {
        // DÃƒÆ’Ã‚Â©bloquer et render AVANT de supprimer l'overlay
        // pour ÃƒÆ’Ã‚Â©viter un flash sans jeton buff
        animatingSlots.delete(fromKey);
        animatingSlots.delete(toKey);
        render();
        movingCard.remove();
        resolve();
    }, 600);
    });
}






