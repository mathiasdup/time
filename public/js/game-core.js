// ==================== CÅ’UR DU JEU ====================
// Socket/rÃ©seau, drag & drop, interactions utilisateur, initialisation

// VFX coordinate helpers â€” viewport coords passÃ©es directement (main app sans stage transform)
function _vfxRect(rect) {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        w: rect.width,
        h: rect.height
    };
}
function _vfxPos(x, y) { return { x, y }; }

// Pendant la resolution, plusieurs gameStateUpdate peuvent arriver en rafale.
// On limite le render a 1/frame sans changer l'ordre des animations.
let _pendingResolutionStateRender = false;
let _pendingResolutionStateRenderRaf = 0;

function _cancelPendingResolutionStateRender() {
    if (_pendingResolutionStateRenderRaf) {
        if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(_pendingResolutionStateRenderRaf);
        } else {
            clearTimeout(_pendingResolutionStateRenderRaf);
        }
        _pendingResolutionStateRenderRaf = 0;
    }
    _pendingResolutionStateRender = false;
}

function _renderFromStateUpdate(phase) {
    if (phase !== 'resolution') {
        _cancelPendingResolutionStateRender();
        render();
        return;
    }
    if (_pendingResolutionStateRender) return;
    _pendingResolutionStateRender = true;
    if (typeof requestAnimationFrame === 'function') {
        _pendingResolutionStateRenderRaf = requestAnimationFrame(() => {
            _pendingResolutionStateRenderRaf = 0;
            _pendingResolutionStateRender = false;
            render();
        });
        return;
    }
    _pendingResolutionStateRenderRaf = setTimeout(() => {
        _pendingResolutionStateRenderRaf = 0;
        _pendingResolutionStateRender = false;
        render();
    }, 16);
}

let _deferredPostResolutionState = null;

function _hasActiveResolutionClientWork() {
    const hasQueue = (typeof isAnimating !== 'undefined' && isAnimating) ||
        (typeof animationQueue !== 'undefined' && animationQueue && animationQueue.length > 0);
    const hasDraw =
        typeof GameAnimations !== 'undefined' &&
        (
            GameAnimations.hasActiveDrawAnimation('me') ||
            GameAnimations.hasActiveDrawAnimation('opp')
        );
    return !!(hasQueue || hasDraw);
}

function _pickAnimMeta(anim) {
    if (!anim || typeof anim !== 'object') return {};
    const out = {};
    const keys = [
        'type', 'player', 'attacker', 'defender', 'caster', 'targetPlayer',
        'row', 'col', 'fromRow', 'fromCol', 'toRow', 'toCol',
        'targetRow', 'targetCol', 'amount', 'damage', 'riposteDamage',
        'combatType', 'spellId', 'handIndex',
        'atkBuff', 'hpBuff', 'source', 'absorberName', 'absorberUid',
        'victimName', 'victimUid', 'rawAtkGain', 'rawHpGain',
        'cardName', 'cardUid', 'poisonCounters',
        'lastPoisonSource', 'lastPoisonTurn', 'lastPoisonByCard', 'lastPoisonAdded'
    ];
    for (const k of keys) {
        if (anim[k] !== undefined) out[k] = anim[k];
    }
    return out;
}

function _toFiniteAnimNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function _traceBuffApplyPayload(context, data) {
    if (!data || typeof window?.visTrace !== 'function') return;
    const atkBuff = _toFiniteAnimNumberOrNull(data.atkBuff);
    const hpBuff = _toFiniteAnimNumberOrNull(data.hpBuff);
    const source = typeof data.source === 'string' ? data.source : '';
    const absorberName = typeof data.absorberName === 'string' ? data.absorberName : '';
    const hasAbsorbContext = source.toLowerCase().includes('absorb') || absorberName.toLowerCase().includes('nourrisseur');
    const isInvalid = atkBuff === null || hpBuff === null;
    if (!hasAbsorbContext && !isInvalid) return;

    const side = data.player === myNum ? 'me' : 'opponent';
    const stateCard =
        data.player !== undefined && data.row !== undefined && data.col !== undefined
            ? state?.[side]?.field?.[data.row]?.[data.col]
            : null;

    window.visTrace(isInvalid ? 'buffApply:payload-invalid' : 'buffApply:payload', {
        context,
        source: data.source ?? null,
        player: data.player ?? null,
        row: data.row ?? null,
        col: data.col ?? null,
        atkBuffRaw: data.atkBuff ?? null,
        hpBuffRaw: data.hpBuff ?? null,
        atkBuff,
        hpBuff,
        absorberName: data.absorberName ?? null,
        absorberUid: data.absorberUid ?? null,
        victimName: data.victimName ?? null,
        victimUid: data.victimUid ?? null,
        rawAtkGain: data.rawAtkGain ?? null,
        rawHpGain: data.rawHpGain ?? null,
        stateCard: stateCard ? {
            name: stateCard.name ?? null,
            uid: stateCard.uid ?? null,
            atk: stateCard.atk ?? null,
            hp: stateCard.hp ?? null,
            currentHp: stateCard.currentHp ?? null
        } : null
    });
}

function setupCustomDrag() {
    CustomDrag.setCallbacks({
        canDrag: () => canPlay(),

        arrowMode: (data) => {
            return data.source === 'hand' && data.card &&
                   (data.card.type === 'spell' || data.card.type === 'trap');
        },

        dragStart: (data, sourceEl) => {
            hideCardPreview();
            if (data.source === 'hand') {
                dragged = { ...data.card, idx: data.idx, tooExpensive: data.tooExpensive, effectiveCost: data.effectiveCost };
                draggedFromField = null;
                highlightValidSlots(data.card);
            } else if (data.source === 'field') {
                if (state.me.inDeployPhase) return;
                if (data.card.isBuilding) return;
                if (data.card.abilities?.includes('immovable')) return;
                if (data.card.melodyLocked || data.card.petrified) return;
                draggedFromField = { row: data.row, col: data.col, card: data.card };
                dragged = null;
                highlightMoveTargets(data.row, data.col, data.card);
            }
        },

        dragMove: (x, y, data) => {
            // Cross-spell preview
            if (data.source === 'hand' && data.card && data.card.type === 'spell' && data.card.pattern === 'cross') {
                const target = CustomDrag.getDropTargetAt(x, y);
                if (target && target.type === 'field' && target.element.classList.contains('valid-target')) {
                    previewCrossTargets(target.owner, target.row, target.col);
                } else {
                    document.querySelectorAll('.card-slot.cross-target').forEach(s => {
                        const card = s.querySelector('.card');
                        if (card) card.classList.remove('spell-hover-target');
                        s.classList.remove('cross-target');
                    });
                }
            }
        },

        drop: (data, target, sourceEl) => {
            if (data.source === 'hand') {
                const accepted = handleHandDrop(data, target);
                if (accepted) {
                    // Si pendingReanimation est actif, confirmReanimation gÃ¨re le commit/remove
                    if (!pendingReanimation) {
                        if (data.card.type === 'spell') {
                            // Sort engagÃ© : stocker pour affichage grisÃ© dans la main
                            const tp = target.owner === 'me' ? myNum : (target.owner === 'opp' ? (myNum === 1 ? 2 : 1) : 0);
                            commitSpell(data.card, target.type, tp, target.row, target.col, data.idx);
                        }
                        handCardRemovedIndex = data.idx;
                    }
                    // Fade pour piÃ¨ges (mode flÃ¨che â€” la carte est encore visible dans la main)
                    if (sourceEl && data.card.type === 'trap') {
                        sourceEl.style.transition = 'opacity 0.15s ease-out';
                        sourceEl.style.opacity = '0';
                    }
                }
                return accepted;
            } else if (data.source === 'field') {
                return handleFieldDrop(data, target);
            }
            return false;
        },

        dragEnd: (data, wasDropped) => {
            if (!wasDropped && data && data.source === 'hand' && data.tooExpensive) {
                // Shake la carte dans la main
                const handCards = document.querySelectorAll('#my-hand .card');
                if (handCards[data.idx]) {
                    handCards[data.idx].classList.add('shake');
                    setTimeout(() => handCards[data.idx].classList.remove('shake'), 400);
                }
            }
            dragged = null;
            draggedFromField = null;
            clearHighlights();
        }
    });
}

function commitSpell(card, targetType, targetPlayer, row, col, handIndex) {
    committedSpells.push({
        card: { ...card },
        commitId: ++commitIdCounter,
        order: committedSpells.length + 1,
        handIndex: handIndex !== undefined ? handIndex : -1,
        targetType: targetType,
        targetPlayer: targetPlayer,
        row: row !== undefined ? row : -1,
        col: col !== undefined ? col : -1
    });
}

function handleHandDrop(data, target) {
    const card = data.card;

    // Zone de sort global
    if (target.type === 'global') {
        if (card.type === 'spell' && ['global', 'all'].includes(card.pattern)) {
            if (data.tooExpensive) {
                data.triedToDrop = true;
                return false;
            }
            // GraveyardToHand : ouvrir le cimetiÃ¨re pour sÃ©lectionner une crÃ©ature
            if (card.effect === 'graveyardToHand') {
                pendingReanimation = {
                    card: { ...card },
                    handIndex: data.idx,
                    effectiveCost: card.effectiveCost || card.cost,
                    mode: 'graveyardToHand'
                };
                openGraveyardForSelection();
                clearSel();
                return true;
            }
            socket.emit('castGlobalSpell', { handIndex: data.idx });
            clearSel();
            return true;
        }
        return false;
    }

    // HÃ©ros cible
    if (target.type === 'hero') {
        if (!canTargetHero(card, target.owner)) return false;
        if (data.tooExpensive) {
            data.triedToDrop = true;
            return false;
        }
        const targetPlayer = target.owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        socket.emit('castSpell', {
            idx: data.idx,
            targetPlayer: targetPlayer,
            row: -1,
            col: -1
        });
        clearSel();
        return true;
    }

    // PiÃ¨ge
    if (target.type === 'trap') {
        if (!target.element.classList.contains('valid-target')) return false;
        dragged = { ...card, idx: data.idx, tooExpensive: data.tooExpensive };
        dropOnTrap(target.owner, target.row);
        return !data.tooExpensive;
    }

    // Slot de terrain (crÃ©ature ou sort ciblÃ©)
    if (target.type === 'field') {
        if (!target.element.classList.contains('valid-target')) return false;
        dragged = { ...card, idx: data.idx, tooExpensive: data.tooExpensive, effectiveCost: data.effectiveCost };
        dropOnSlot(target.owner, target.row, target.col);
        // RÃ©animation : graveyard ouvert, ne pas commit/remove encore
        if (pendingReanimation) return false;
        return !data.tooExpensive;
    }

    return false;
}

function handleFieldDrop(data, target) {
    if (target.type !== 'field') return false;
    if (!target.element.classList.contains('moveable')) return false;

    socket.emit('moveCard', {
        fromRow: data.row,
        fromCol: data.col,
        toRow: target.row,
        toCol: target.col
    });
    clearSel();
    return true;
}

function canTargetHero(spell, owner) {
    if (!spell || spell.type !== 'spell') return false;
    if (spell.pattern === 'hero') {
        if (owner === 'me' && !spell.targetSelf) return false;
        if (owner === 'opp' && !spell.targetEnemy) return false;
        return true;
    }
    if (spell.canTargetHero) return true;
    return false;
}

function initSocket() {
    socket = io();
    if (window.PerfMon) window.PerfMon.attachSocket(socket);

    socket.on('gameStart', (s) => {
        state = s;
        myNum = s.myPlayer;
        if (typeof window !== 'undefined') {
            window.__visTraceContext = window.__visTraceContext || {};
            window.__visTraceContext.playerNum = Number(myNum || 0);
            const roomText = document.getElementById('room-code-display')?.textContent?.trim();
            if (roomText) window.__visTraceContext.roomCode = roomText;
        }
        if (s.features && typeof s.features.clientPacedResolution === 'boolean') {
            window.CLIENT_PACED_RESOLUTION = !!s.features.clientPacedResolution;
        }
        if (window.PerfMon) {
            window.PerfMon.setPlayer(myNum);
            window.PerfMon.onNewTurn(s.turn || 1);
        }
        setupHeroes();
        setRandomRanks();
        document.getElementById('lobby').classList.add('hidden');

        // VÃ©rifier si on est en phase mulligan
        if (s.phase === 'mulligan') {
            showModeSelector();
        } else {
            startGame();
        }
    });

    socket.on('gameStateUpdate', (s) => {
        const __perfGsuStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const prevStateSig = typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null;
        if (s.features && typeof s.features.clientPacedResolution === 'boolean') {
            window.CLIENT_PACED_RESOLUTION = !!s.features.clientPacedResolution;
        }
        if (typeof window.visTrace === 'function') {
            window.visTrace('gsu:recv', {
                prev: prevStateSig,
                nextPhase: s.phase || '?',
                nextTurn: Number(s.turn || 0),
                qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            });
        }
        // Traiter les blockSlots atomiquement AVANT le render (Ã©vite la race condition)
        if (s._blockSlots) {
            s._blockSlots.forEach(slot => {
                const owner = slot.player === myNum ? 'me' : 'opp';
                animatingSlots.add(`${owner}-${slot.row}-${slot.col}`);
            });
            if (typeof window.visTrace === 'function') {
                window.visTrace('gsu:blockSlots-inline', {
                    count: s._blockSlots.length,
                    slots: s._blockSlots.map((x) => `${x.player}:${x.row},${x.col}`),
                });
            }
            delete s._blockSlots;
        }

        // Le serveur peut omettre graveyard si inchange pour reduire le payload.
        // On conserve alors la copie locale precedente pour garder un rendu identique.
        if (state?.me?.graveyard && s.me && s.me.graveyard === undefined) {
            s.me.graveyard = state.me.graveyard;
        }
        if (state?.opponent?.graveyard && s.opponent && s.opponent.graveyard === undefined) {
            s.opponent.graveyard = state.opponent.graveyard;
        }

        const meGrave = s.me?.graveyard || [];
        const oppGrave = s.opponent?.graveyard || [];
        const prevMeGrave = state?.me?.graveyard?.length || 0;
        const prevOppGrave = state?.opponent?.graveyard?.length || 0;
        if (meGrave.length > prevMeGrave && !graveRenderBlocked.has('me')) {
        }
        if (oppGrave.length > prevOppGrave && !graveRenderBlocked.has('opp')) {
        }
        // Auto-cacher les nouvelles cartes adverses si le count augmente pendant la rÃ©solution
        // (sÃ©curitÃ© anti-flash si l'Ã©tat arrive avant l'event draw)
        if (typeof GameAnimations !== 'undefined' && state?.opponent) {
            const prevOppCount = state.opponent.handCount || 0;
            const newOppCount = s.opponent?.handCount || 0;
            if (newOppCount > prevOppCount && s.phase === 'resolution') {
                // Ne pas auto-cacher si pendingBounce gÃ¨re dÃ©jÃ  la visibilitÃ© (bounce/graveyardReturn)
                if (!(typeof pendingBounce !== 'undefined' && pendingBounce && pendingBounce.owner === 'opp')) {
                    GameAnimations.autoHideNewDraws('opp', prevOppCount, newOppCount);
                }
            }
        }

        const wasInDeployPhase = state?.me?.inDeployPhase;
        const wasMulligan = state?.phase === 'mulligan';
        // Tant qu'il reste du travail visuel de resolution (queue/anim draw),
        // ne jamais appliquer un state "planning" immediatement: sinon la phase
        // peut visuellement avancer avant la fin des animations.
        const shouldDeferPostResolutionState =
            s.phase === 'planning' &&
            _hasActiveResolutionClientWork();
        if (shouldDeferPostResolutionState) {
            _deferredPostResolutionState = s;
            if (typeof window.visTrace === 'function') {
                window.visTrace('gsu:defer-post-resolution', {
                    prevPhase: prevStateSig?.phase || '?',
                    nextPhase: s.phase || '?',
                    qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                });
            }
            if (window.PerfMon) {
                const __perfNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                window.PerfMon.recordGameStateUpdate(
                    __perfNow - __perfGsuStart,
                    s.turn || state?.turn || 1,
                    (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0
                );
            }
            return;
        }
        // DÃ©tecter si le hÃ©ros a changÃ© (mode complet force Erebeth)
        const heroChanged = window.heroData && s.me.hero && s.me.hero.id !== window.heroData.me?.id;
        state = s;

        const logRadjawakState = (sideLabel, sideState) => {
            const field = sideState?.field;
            if (!Array.isArray(field)) return;
            for (let rr = 0; rr < field.length; rr++) {
                for (let cc = 0; cc < (field[rr]?.length || 0); cc++) {
                    const card = field[rr][cc];
                    if (!card || typeof card.name !== 'string') continue;
                    if (!card.name.toLowerCase().includes('radjawak')) continue;
                    if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] state-update phase=${s.phase} side=${sideLabel} slot=${rr},${cc} uid=${card.uid || '-'} atk=${card.atk} hp=${card.currentHp}/${card.hp} canAttack=${card.canAttack}`);
                }
            }
        };
        const logHpStateAnomalies = (sideLabel, sideState) => {
            const field = sideState?.field;
            if (!Array.isArray(field)) return;
            for (let rr = 0; rr < field.length; rr++) {
                for (let cc = 0; cc < (field[rr]?.length || 0); cc++) {
                    const card = field[rr][cc];
                    if (!card) continue;
                    const cur = Number(card.currentHp);
                    const max = Number(card.hp);
                    if (Number.isFinite(cur) && cur <= 0) {
                        if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] state-zero-card phase=${s.phase} side=${sideLabel} slot=${rr},${cc} card=${card.name || '?'} uid=${card.uid || '-'} hp=${cur}/${Number.isFinite(max) ? max : '?'}`);
                    }
                }
            }
        };
        if (window.DEBUG_LOGS) {
            logRadjawakState('me', s.me);
            logRadjawakState('opp', s.opponent);
            logHpStateAnomalies('me', s.me);
            logHpStateAnomalies('opp', s.opponent);
        }

        if (heroChanged) {
            setupHeroes();
        }

        // Si on est en phase mulligan et qu'on reÃ§oit une mise Ã  jour (aprÃ¨s mulligan)
        if (s.phase === 'mulligan' && mulliganDone) {
            // Mettre Ã  jour l'affichage des nouvelles cartes
            const handContainer = document.getElementById('mulligan-hand');
            handContainer.innerHTML = '';
            s.me.hand.forEach(card => {
                const cardEl = makeCard(card, true);
                handContainer.appendChild(cardEl);
            });
        }

        // Transition mulligan -> planning
        if (wasMulligan && s.phase === 'planning') {
            document.getElementById('mulligan-overlay').classList.add('hidden');
            startGame();
        }

        _renderFromStateUpdate(s.phase);
        updatePhaseDisplay();
        if (typeof window.visTrace === 'function') {
            const nextSig = typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null;
            const domSig = typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null;
            window.visTrace('gsu:applied', {
                prev: prevStateSig,
                next: nextSig,
                dom: domSig,
            });
        }
        if (window.PerfMon) {
            const __perfNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            window.PerfMon.recordGameStateUpdate(
                __perfNow - __perfGsuStart,
                s.turn || state?.turn || 1,
                (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0
            );
        }

        // Plus de message ici - tout est gÃ©rÃ© par newTurn avec "Planification"
    });

    socket.on('timerUpdate', (t) => {
        currentTimer = t;
        if(state) state.timeLeft = t;
        updateTimerDisplay(t);
    });

    socket.on('phaseChange', (p) => {
        if(state) state.phase = p;
        updatePhaseDisplay();
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:phaseChange', {
                phase: p,
                statePhase: state?.phase || '?',
                qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            });
        }

        if (p === 'resolution') {
            _deferredPostResolutionState = null;
            // Annuler la rÃ©animation en cours si la popup est ouverte
            if (pendingReanimation) cancelReanimation();
            // Sauvegarder les positions des committed spells comme fallback (par commitId, unique)
            cachedCommittedRects = {};
            const handPanel = document.getElementById('my-hand');
            if (handPanel) {
                const committedEls = handPanel.querySelectorAll('.committed-spell');
                for (const el of committedEls) {
                    const commitId = el.dataset.commitId;
                    if (commitId) cachedCommittedRects[commitId] = el.getBoundingClientRect();
                }
            }
            // Sauvegarder les positions des cartes revealed AVANT que le state update ne re-render la main
            if (typeof saveRevealedCardPositions === 'function') saveRevealedCardPositions();
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.classList.remove('waiting', 'has-timer');
            endTurnBtn.classList.add('resolving');
            showPhaseMessage('Résolution', 'resolution');
        }
    });

    socket.on('phaseMessage', (data) => {
        // Passer par la queue d'animations pour garantir que le message de phase
        // ne s'affiche qu'aprÃ¨s toutes les animations en cours (ex: "Pioche" aprÃ¨s combat)
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:phaseMessage', { text: data?.text || '', type: data?.type || '' });
        }
        queueAnimation('phaseMessage', data);
    });

    let meReady = false, oppReady = false;

    socket.on('playerReady', (n) => {
        const isMe = n === myNum;
        if (isMe) {
            meReady = true;
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.classList.add('waiting');
            endTurnBtn.classList.remove('has-timer', 'urgent');
        } else {
            oppReady = true;
        }
        log(isMe ? 'Vous Ãªtes prÃªt' : 'Adversaire prÃªt', 'action');

        if (meReady && oppReady) {
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.classList.remove('has-timer', 'urgent');
        }
    });

    socket.on('newTurn', async (d) => {
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:newTurn:recv', {
                turn: d?.turn,
                maxEnergy: d?.maxEnergy,
                qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            });
        }
        if (window.PerfMon) window.PerfMon.onNewTurn(d.turn);
        // Mettre a jour le numero de tour immediatement.
        // Garder la phase courante jusqu'a la fin des animations pour eviter un render "planning" premature.
        if (state) {
            state.turn = d.turn;
        }

        // Attendre que la queue d'animations ET les animations de pioche soient terminÃ©es
        // avant de reset l'UI et afficher la banniÃ¨re de tour
        let waitMs = 0;
        let stableIdleMs = 0;
        const tickMs = 100;
        const maxWait = 30000;
        const isResolutionBusy = () => (
            isAnimating || animationQueue.length > 0 ||
            (typeof GameAnimations !== 'undefined' && (
                GameAnimations.hasActiveDrawAnimation('me') ||
                GameAnimations.hasActiveDrawAnimation('opp')
            ))
        );
        while (waitMs < maxWait) {
            if (isResolutionBusy()) {
                stableIdleMs = 0;
            } else {
                stableIdleMs += tickMs;
                if (stableIdleMs >= 200) break;
            }
            await new Promise(r => setTimeout(r, tickMs));
            waitMs += tickMs;
        }
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:newTurn:wait-done', {
                waitedMs: waitMs,
                maxWait,
                qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            });
            window.visTrace('socket:newTurn:start', {
                turn: d?.turn,
                maxEnergy: d?.maxEnergy,
                qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            });
        }

        if (_deferredPostResolutionState) {
            state = _deferredPostResolutionState;
            _deferredPostResolutionState = null;
        } else if (state) {
            state.phase = 'planning';
            state.turn = d.turn;
        }
        updatePhaseDisplay();

        currentTimer = 90;
        meReady = false;
        oppReady = false;
        const endTurnBtn = document.getElementById('end-turn-btn');
        endTurnBtn.classList.remove('waiting', 'resolving', 'has-timer', 'has-phase', 'urgent');
        clearSel();

        resetAnimationStates();
        committedSpells = [];
        if (pendingReanimation) cancelReanimation();
        committedGraveyardUids = [];
        committedReanimationSlots = [];

        log(`ðŸŽ® Tour ${d.turn} â€” âš¡${d.maxEnergy} Ã©nergie`, 'phase');

        // Forcer un render maintenant que les animations sont terminÃ©es et l'UI rÃ©initialisÃ©e
        // (le gameStateUpdate a dÃ©jÃ  mis phase='planning', mais canPlay() bloquait pendant les animations)
        render();

        // BanniÃ¨re de round AAA
        showRoundBanner(d.turn);
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:newTurn:ready', {
                turn: d?.turn,
                state: typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null,
                dom: typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null,
            });
        }
    });

    socket.on('resolutionLog', (d) => {
        if (window.PerfMon) window.PerfMon.recordResolutionLog();
        log(d.msg, d.type);
    });

    socket.on('directDamage', (d) => {
        const heroEl = document.getElementById(d.defender === myNum ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.style.animation = 'heroShake 0.5s ease-out';
            heroEl.classList.add('hero-hit');
            setTimeout(() => { heroEl.style.animation = ''; heroEl.classList.remove('hero-hit'); }, 550);
            const rect = heroEl.getBoundingClientRect();
            const v = _vfxRect(rect);
            CombatVFX.createHeroHitEffect(v.x, v.y, v.w, v.h);
        }
    });

    socket.on('animation', (data) => {
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:animation', _pickAnimMeta(data));
        }
        handleAnimation(data);
    });

    // Batch d'animations (pour les sorts de zone - jouÃ©es en parallÃ¨le)
    socket.on('animationBatch', (animations) => {
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:animationBatch', {
                count: Array.isArray(animations) ? animations.length : 0,
                types: Array.isArray(animations) ? animations.map((x) => x?.type || '?') : [],
            });
        }
        handleAnimationBatch(animations);
    });

    // Bloquer les slots pendant les animations de mort (pour que render() ne les efface pas)
    socket.on('blockSlots', (slots) => {
        slots.forEach(s => {
            const owner = s.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${s.row}-${s.col}`;
            animatingSlots.add(slotKey);
        });
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:blockSlots', {
                count: slots.length,
                slots: slots.map((s) => `${s.player}:${s.row},${s.col}`),
            });
        }
    });

    socket.on('unblockSlots', (slots) => {
        slots.forEach(s => {
            const owner = s.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${s.row}-${s.col}`;
            animatingSlots.delete(slotKey);
        });
        if (typeof window.visTrace === 'function') {
            window.visTrace('socket:unblockSlots', {
                count: slots.length,
                slots: slots.map((s) => `${s.player}:${s.row},${s.col}`),
                dom: typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null,
            });
        }
        // Forcer un render aprÃ¨s dÃ©blocage pour mettre Ã  jour l'affichage
        render();
    });

// Highlight des cases pour les sorts
    socket.on('spellHighlight', (data) => {
        data.targets.forEach((t, index) => {
            const owner = t.player === myNum ? 'me' : 'opp';
            const slot = getSlot(owner, t.row, t.col);
            if (slot) {
                const rect = slot.getBoundingClientRect();
                const v = _vfxRect(rect);

                // Pour les sorts de zone (cross), flammes sur TOUTES les cases
                if (data.pattern === 'cross' && data.type === 'damage') {
                    setTimeout(() => {
                        CombatVFX.createFlameEffect(v.x, v.y, 0);
                    }, index * 80);
                } else {
                    // Sort simple : pas de highlight CSS, l'effet d'impact/miss PixiJS suffit
                }
            }
        });
    });

    socket.on('gameOver', async (d) => {
        if (window.CLIENT_PACED_RESOLUTION) {
            let waitMs = 0;
            const maxWait = 30000;
            while (waitMs < maxWait && _hasActiveResolutionClientWork()) {
                await new Promise(r => setTimeout(r, 100));
                waitMs += 100;
            }
        }
        if (window.PerfMon) window.PerfMon.flush();
        if (typeof window.flushVisTraceLogs === 'function') {
            if (typeof window.visTrace === 'function') {
                window.visTrace('visTrace:auto-save:start', {
                    reason: 'gameOver',
                    bufferedLines: Array.isArray(window.__visTraceBuffer) ? window.__visTraceBuffer.length : 0
                });
            }
            const flushResult = await window.flushVisTraceLogs('gameOver', { keepalive: false, reset: true });
            if (!flushResult?.ok) {
                const flushDetail = (() => {
                    try { return JSON.stringify(flushResult); } catch (_) { return String(flushResult); }
                })();
                console.warn('[VIS-TRACE] auto-save failed on gameOver', flushDetail);
                if (typeof window.visTrace === 'function') {
                    window.visTrace('visTrace:auto-save:failed', { detail: flushDetail });
                }
            } else {
                console.log('[VIS-TRACE] auto-saved', flushResult.file || null, flushResult.lineCount || 0);
                if (typeof window.visTrace === 'function') {
                    window.visTrace('visTrace:auto-save:success', {
                        file: flushResult.file || null,
                        lineCount: flushResult.lineCount || 0,
                        payloadBytes: flushResult.payloadBytes || null
                    });
                }
            }
        }
        let resultText, resultClass;
        if (d.draw) {
            resultText = 'ðŸ¤ Match nul !';
            resultClass = 'draw';
        } else {
            const won = d.winner === myNum;
            resultText = won ? 'ðŸŽ‰ Victoire !' : 'ðŸ˜¢ DÃ©faite';
            resultClass = won ? 'victory' : 'defeat';
        }
        document.getElementById('result').textContent = resultText;
        document.getElementById('result').className = 'game-over-result ' + resultClass;
        document.getElementById('game-over').classList.remove('hidden');
    });

    socket.on('playerDisconnected', () => log('âš ï¸ Adversaire dÃ©connectÃ©', 'damage'));

    // Resync quand la fenÃªtre revient au premier plan
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state && state.phase) {
            socket.emit('requestSync');
        }
    });

    // Le serveur envoie pÃ©riodiquement le numÃ©ro de tour pour dÃ©tecter la dÃ©synchronisation
    socket.on('turnCheck', (serverTurn) => {
        if (state && state.turn !== serverTurn) {
            socket.emit('requestSync');
        }
    });
}

// PowerBuff : bloquer render() ATK pendant l'animation (mis Ã  jour par le handler dans game-animations.js)
let powerBuffAtkOverrides = new Map(); // slotKey -> displayed ATK
// PoisonDamage : bloquer render() HP pendant l'animation (geler le HP prÃ©-poison)
let poisonHpOverrides = new Map(); // slotKey -> { hp: number, consumed: boolean, uid?: string|null, updatedAt?: number }

function handleAnimation(data) {
    const { type } = data;
    if (typeof window.visTrace === 'function') {
        window.visTrace('anim:handle:start', _pickAnimMeta(data));
    }
    const getAnimFieldCard = (playerNum, row, col) => {
        if (row === undefined || col === undefined || col < 0) return null;
        const side = playerNum === myNum ? 'me' : 'opponent';
        return state?.[side]?.field?.[row]?.[col] || null;
    };
    const isRadjawak = (card) => !!(card && typeof card.name === 'string' && card.name.toLowerCase().includes('radjawak'));

    if (type === 'attack') {
        const attackerCard = getAnimFieldCard(data.attacker, data.row, data.col);
        const targetCard = getAnimFieldCard(data.targetPlayer, data.targetRow, data.targetCol);
        if (isRadjawak(attackerCard) || isRadjawak(targetCard)) {
            if (window.DEBUG_LOGS) console.log(
                `[RADJ-DBG] anim-attack combatType=${data.combatType || 'n/a'} attacker=${attackerCard?.name || 'unknown'} attackerPos=${data.row},${data.col} target=${data.targetCol === -1 ? 'hero' : (targetCard?.name || 'unknown')} targetPos=${data.targetRow},${data.targetCol} damage=${data.damage ?? 'n/a'} riposte=${data.riposteDamage ?? 'n/a'}`
            );
        }
    }
    if (type === 'damage') {
        const targetCard = getAnimFieldCard(data.player, data.row, data.col);
        if (isRadjawak(targetCard)) {
            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] anim-damage target=${targetCard.name} pos=${data.row},${data.col} amount=${data.amount} skipScratch=${!!data.skipScratch}`);
        }
    }

    // Les animations de combat utilisent la file d'attente.
    // En mode client-paced, on ajoute aussi les reveals (summon/move/trapPlace)
    // pour eviter les chevauchements quand le serveur n'attend plus entre les phases.
    const clientPacedResolution = !!window.CLIENT_PACED_RESOLUTION;
    const queuedTypes = ['attack', 'damage', 'spellDamage', 'death', 'deathTransform', 'heroHit', 'discard', 'burn', 'zdejebel', 'onDeathDamage', 'spell', 'spellDual', 'spellDualEnd', 'trapTrigger', 'trampleDamage', 'trampleHeroHit', 'bounce', 'sacrifice', 'poisonDamage', 'lifesteal', 'healOnDeath', 'regen', 'graveyardReturn', 'combatRowStart', 'combatEnd', 'buildingActivate', 'heroHeal', 'powerBuff', 'trapSummon', 'reanimate', ...(clientPacedResolution ? ['summon', 'move', 'trapPlace'] : [])];

    if (queuedTypes.includes(type)) {
        // Bloquer render() immÃ©diatement pour les animations trample (avant traitement de la queue)
        if (type === 'trampleHeroHit') {
            zdejebelAnimationInProgress = true;
        }
        if (type === 'trampleDamage') {
            const owner = data.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${data.row}-${data.col}`;
            animatingSlots.add(slotKey);
        }
        // Bloquer render() immÃ©diatement pour onDeathDamage hÃ©ros (Dragon CrÃ©pitant)
        if (type === 'onDeathDamage' && data.targetRow === undefined) {
            zdejebelAnimationInProgress = true;
        }
        // Bloquer render() ATK immÃ©diatement pour powerBuff (on utilise fromAtk du serveur)
        if (type === 'powerBuff' && data.row !== undefined) {
            const pbOwner = data.player === myNum ? 'me' : 'opp';
            const pbKey = `${pbOwner}-${data.row}-${data.col}`;
            // Ne capturer que la premiÃ¨re fois (s'il y a dÃ©jÃ  un override, on le garde)
            if (!powerBuffAtkOverrides.has(pbKey)) {
                powerBuffAtkOverrides.set(pbKey, data.fromAtk);
            }
        }
        // Bloquer render() HP immÃ©diatement pour poisonDamage (geler le HP prÃ©-poison)
        if (type === 'poisonDamage' && data.row !== undefined) {
            const poisonAmount = Number(data.amount);
            if (!Number.isFinite(poisonAmount) && typeof window.visTrace === 'function') {
                window.visTrace('poisonDamage:payload-invalid', {
                    context: 'socket:animation',
                    player: data.player ?? null,
                    row: data.row ?? null,
                    col: data.col ?? null,
                    amountRaw: data.amount ?? null,
                    qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                    isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
                });
            }
            const pdOwner = data.player === myNum ? 'me' : 'opp';
            const pdKey = `${pdOwner}-${data.row}-${data.col}`;
            const side = pdOwner === 'me' ? 'me' : 'opponent';
            const card = state?.[side]?.field?.[data.row]?.[data.col];
            const existing = poisonHpOverrides.get(pdKey);
            const cardUid = card?.uid || null;

            if (!card) {
                if (existing) poisonHpOverrides.delete(pdKey);
            } else {
                const shouldReplace =
                    !existing ||
                    existing.consumed === true ||
                    (existing.uid && cardUid && existing.uid !== cardUid);
                if (shouldReplace) {
                    poisonHpOverrides.set(pdKey, {
                        hp: card.currentHp,
                        consumed: false,
                        uid: cardUid,
                        updatedAt: Date.now()
                    });
                }
            }
        }
        // Bloquer renderTraps() immÃ©diatement pour les piÃ¨ges (avant traitement de la queue)
        if (type === 'trapTrigger') {
            const owner = data.player === myNum ? 'me' : 'opp';
            const trapKey = `${owner}-${data.row}`;
            animatingTrapSlots.add(trapKey);
        }
        if (type === 'summon' && data.row !== undefined && data.col !== undefined) {
            const owner = data.player === myNum ? 'me' : 'opp';
            animatingSlots.add(`${owner}-${data.row}-${data.col}`);
        }
        if (type === 'move') {
            const owner = data.player === myNum ? 'me' : 'opp';
            if (data.fromRow !== undefined && data.fromCol !== undefined) {
                animatingSlots.add(`${owner}-${data.fromRow}-${data.fromCol}`);
            }
            if (data.toRow !== undefined && data.toCol !== undefined) {
                animatingSlots.add(`${owner}-${data.toRow}-${data.toCol}`);
            }
        }
        if (type === 'trapPlace' && data.row !== undefined) {
            const owner = data.player === myNum ? 'me' : 'opp';
            animatingTrapSlots.add(`${owner}-${data.row}`);
        }
        queueAnimation(type, data);
        if (typeof window.visTrace === 'function') {
            window.visTrace('anim:handle:queued', {
                type,
                qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
            });
        }
    } else {
        // Les autres animations s'exÃ©cutent immÃ©diatement
        if (typeof window.visTrace === 'function') {
            window.visTrace('anim:handle:immediate', _pickAnimMeta(data));
        }
        switch(type) {
            case 'spellMiss': animateSpellMiss(data); break;
            case 'spellReturnToHand': animateSpellReturnToHand(data); break;
            case 'heal': animateHeal(data); break;
            case 'searchSpell': {
                const ssOwner = data.player === myNum ? 'me' : 'opp';
                const ssSlot = getSlot(ssOwner, data.row, data.col);
                if (ssSlot) {
                    const rect = ssSlot.getBoundingClientRect();
                    const v = _vfxRect(rect);
                    CombatVFX.createSearchSpellEffect(v.x, v.y, v.w, v.h);
                }
                break;
            }
            case 'buff': animateBuff(data); break;
            case 'buffApply': {
                _traceBuffApplyPayload('socket:animation', data);
                const baOwner = data.player === myNum ? 'me' : 'opp';
                const baSlot = getSlot(baOwner, data.row, data.col);
                if (baSlot) {
                    const rect = baSlot.getBoundingClientRect();
                    const v = _vfxRect(rect);
                    CombatVFX.createBuffEffect(v.x, v.y, data.atkBuff ?? 1, data.hpBuff ?? 1, v.w, v.h);
                }
                break;
            }
            case 'summon': animateSummon(data); break;
            case 'trapSummon': animateTrapSummon(data); break;
            case 'reanimate': animateReanimate(data); break;
            case 'move': animateMove(data); break;
            case 'atkBoost':
                if (typeof animateAtkBoost === 'function') {
                    animateAtkBoost(data);
                }
                break;
            case 'draw':
                if (typeof GameAnimations !== 'undefined') {
                    GameAnimations.prepareDrawAnimation(data);
                }
                break;
            case 'trapPlace':
                animateTrapPlace(data);
                break;
            case 'shield':
                animateShieldBreak(data);
                break;
            case 'destroy': {
                const destOwner = data.player === myNum ? 'me' : 'opp';
                const destSlot = getSlot(destOwner, data.row, data.col);
                if (destSlot) {
                    const rect = destSlot.getBoundingClientRect();
                    const v = _vfxRect(rect);
                    CombatVFX.createDestroyEffect(v.x, v.y, v.w, v.h);
                }
                break;
            }
            case 'entrave': {
                const entOwner = data.player === myNum ? 'me' : 'opp';
                const entSlot = getSlot(entOwner, data.row, data.col);
                if (entSlot) {
                    const rect = entSlot.getBoundingClientRect();
                    const v = _vfxRect(rect);
                    CombatVFX.createEntraveEffect(v.x, v.y, data.amount, v.w, v.h);
                }
                break;
            }
            case 'melodyGaze': {
                const gazeSrcOwner = data.srcPlayer === myNum ? 'me' : 'opp';
                const gazeTgtOwner = data.tgtPlayer === myNum ? 'me' : 'opp';
                const gazeSrcSlot = getSlot(gazeSrcOwner, data.srcRow, data.srcCol);
                const gazeTgtSlot = getSlot(gazeTgtOwner, data.tgtRow, data.tgtCol);
                if (gazeSrcSlot && gazeTgtSlot) {
                    const srcRect = gazeSrcSlot.getBoundingClientRect();
                    const tgtRect = gazeTgtSlot.getBoundingClientRect();
                    const sv = _vfxRect(srcRect);
                    const tv = _vfxRect(tgtRect);
                    CombatVFX.createMedusaGazeEffect(sv.x, sv.y, tv.x, tv.y);
                }
                break;
            }
            case 'petrify': {
                const petOwner = data.player === myNum ? 'me' : 'opp';
                const petSlot = getSlot(petOwner, data.row, data.col);
                if (petSlot) {
                    const rect = petSlot.getBoundingClientRect();
                    const v = _vfxRect(rect);
                    CombatVFX.createPetrifyEffect(v.x, v.y, v.w, v.h);
                } else {
                }
                break;
            }
        }
    }
    if (typeof window.visTrace === 'function') {
        window.visTrace('anim:handle:end', {
            type,
            qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
            isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
        });
    }
}

// Handler pour les batches d'animations (sorts de zone - jouÃ©es en parallÃ¨le)
function handleAnimationBatch(animations) {
    if (typeof window.visTrace === 'function') {
        window.visTrace('animBatch:handle:start', {
            count: Array.isArray(animations) ? animations.length : 0,
            types: Array.isArray(animations) ? animations.map((x) => x?.type || '?') : [],
        });
    }

    // Bloquer immÃ©diatement les slots des deathTransform pour que render() ne les Ã©crase pas
    for (const anim of animations) {
        if (anim.type === 'deathTransform') {
            const owner = anim.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${anim.row}-${anim.col}`;
            animatingSlots.add(slotKey);
        }
    }

    // SÃ©parer les animations : death/deathTransform passent par la file d'attente, le reste joue immÃ©diatement
    const immediatePromises = [];
    for (const anim of animations) {
        const owner = anim.player === myNum ? 'me' : 'opp';

        if (anim.type === 'spellDamage') {
            immediatePromises.push(CombatAnimations.animateSpellDamageAoE({
                owner: owner,
                row: anim.row,
                col: anim.col,
                amount: anim.amount
            }));
        } else if (anim.type === 'zdejebel') {
            const target = anim.targetPlayer === myNum ? 'me' : 'opp';
            const stateHp = target === 'me' ? state?.me?.hp : state?.opponent?.hp;
            const displayedHp = document.querySelector(`#${target === 'me' ? 'me' : 'opp'}-hp .hero-hp-number`)?.textContent;
            immediatePromises.push(animateZdejebelDamage(anim));
        } else if (anim.type === 'poisonDamage') {
            const poisonAmount = Number(anim.amount);
            if (!Number.isFinite(poisonAmount) && typeof window.visTrace === 'function') {
                window.visTrace('poisonDamage:payload-invalid', {
                    context: 'socket:animationBatch',
                    player: anim.player ?? null,
                    row: anim.row ?? null,
                    col: anim.col ?? null,
                    amountRaw: anim.amount ?? null,
                    qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
                    isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
                });
            }
            if (typeof window.visTrace === 'function') {
                window.visTrace('poisonDamage:batch-payload', {
                    player: anim.player ?? null,
                    row: anim.row ?? null,
                    col: anim.col ?? null,
                    amountRaw: anim.amount ?? null,
                    amount: Number.isFinite(poisonAmount) ? poisonAmount : null,
                    source: anim.source ?? null,
                    poisonCounters: anim.poisonCounters ?? null,
                    cardName: anim.cardName ?? null,
                    cardUid: anim.cardUid ?? null,
                    lastPoisonSource: anim.lastPoisonSource ?? null,
                    lastPoisonTurn: anim.lastPoisonTurn ?? null,
                    lastPoisonByCard: anim.lastPoisonByCard ?? null,
                    lastPoisonAdded: anim.lastPoisonAdded ?? null
                });
            }
            // Bloquer render() HP immÃ©diatement (mÃªme logique que handleAnimation)
            const pdOwner = anim.player === myNum ? 'me' : 'opp';
            const pdKey = `${pdOwner}-${anim.row}-${anim.col}`;
            const side = pdOwner === 'me' ? 'me' : 'opponent';
            const card = state?.[side]?.field?.[anim.row]?.[anim.col];
            const existing = poisonHpOverrides.get(pdKey);
            const cardUid = card?.uid || null;
            if (!card) {
                if (existing) poisonHpOverrides.delete(pdKey);
            } else {
                const shouldReplace =
                    !existing ||
                    existing.consumed === true ||
                    (existing.uid && cardUid && existing.uid !== cardUid);
                if (shouldReplace) {
                    poisonHpOverrides.set(pdKey, {
                        hp: card.currentHp,
                        consumed: false,
                        uid: cardUid,
                        updatedAt: Date.now()
                    });
                }
            }
            // Animation de poison : passer par la file d'attente pour le batch processing
            queueAnimation(anim.type, anim);
        } else if (anim.type === 'poisonApply') {
            // VFX nuage toxique sur la carte ciblÃ©e
            const poisonOwner = anim.player === myNum ? 'me' : 'opp';
            const poisonSlot = getSlot(poisonOwner, anim.row, anim.col);
            if (poisonSlot) {
                const rect = poisonSlot.getBoundingClientRect();
                const v = _vfxRect(rect);
                CombatVFX.createPoisonCloudEffect(v.x, v.y, v.w, v.h);
            }
        } else if (anim.type === 'buffApply') {
            _traceBuffApplyPayload('socket:animationBatch', anim);
            const buffOwner = anim.player === myNum ? 'me' : 'opp';
            const buffSlot = getSlot(buffOwner, anim.row, anim.col);
            if (buffSlot) {
                const rect = buffSlot.getBoundingClientRect();
                const v = _vfxRect(rect);
                CombatVFX.createBuffEffect(v.x, v.y, anim.atkBuff ?? 1, anim.hpBuff ?? 1, v.w, v.h);
            }
        } else if (anim.type === 'death' || anim.type === 'deathTransform') {
            // Passer par la file pour respecter l'ordre des animations (aprÃ¨s damage, etc.)
            queueAnimation(anim.type, anim);
        } else if (anim.type === 'trapSummon') {
            // Keep strict ordering with queued combat/death animations.
            queueAnimation(anim.type, anim);
        } else {
            // Fallback: preserve ordering for any batched animation type
            // that is not handled as an immediate VFX-only event above.
            queueAnimation(anim.type, anim);
        }
    }

    if (immediatePromises.length > 0) {
        Promise.all(immediatePromises).then(() => {
        });
    }
    if (typeof window.visTrace === 'function') {
        window.visTrace('animBatch:handle:end', {
            count: Array.isArray(animations) ? animations.length : 0,
            qLen: (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0,
            isAnimating: (typeof isAnimating !== 'undefined') ? !!isAnimating : false,
        });
    }
}

function animateBuff(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const v = _vfxRect(rect);
        CombatVFX.createBuffEffect(v.x, v.y, data.atk || 0, data.hp || 0, v.w, v.h);
    }
}


function animateShieldBreak(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (!slot) return;
    const cardEl = slot.querySelector('.card');
    if (!cardEl) return;

    // Retirer le bouclier PixiJS
    const shieldSlotKey = `${owner}-${data.row}-${data.col}`;
    CombatVFX.removeShield(shieldSlotKey);

    const rect = slot.getBoundingClientRect();
    const v = _vfxRect(rect);

    // Effet de bris de verre PixiJS
    CombatVFX.createShieldBreakEffect(v.x, v.y, v.w, v.h);
}

// Les fonctions animateAttack et animateDamage sont maintenant gÃ©rÃ©es par le systÃ¨me PixiJS
// Voir combat-animations.js et les fonctions handlePixiAttack/handlePixiDamage ci-dessus

function selectCard(i) {
    if (!canPlay()) return;
    const card = state.me.hand[i];
    let cost = card.cost;
    if (card.poisonCostReduction && state.me.totalPoisonCounters > 0) {
        cost = Math.max(0, cost - state.me.totalPoisonCounters);
    }
    if (cost > state.me.energy) return;

    clearSel();
    selected = { ...card, idx: i, fromHand: true };
    document.querySelectorAll('.my-hand .card')[i]?.classList.add('selected');
    highlightValidSlots(card);
}

function clickFieldCard(row, col, card) {
    if (!canPlay()) return;
    if (state.me.inDeployPhase) return;
    if (card.movedThisTurn) return;
    if (card.isBuilding) return;
    if (card.abilities?.includes('immovable')) return;
    if (card.melodyLocked || card.petrified) return;

    clearSel();
    selected = { ...card, fromField: true, row, col };

    const slot = getSlot('me', row, col);
    const cardEl = slot?.querySelector('.card');
    if (cardEl) cardEl.classList.add('field-selected');

    highlightMoveTargets(row, col, card);
}

function clickSlot(owner, row, col) {
    if (!canPlay()) return;

    if (selected && selected.fromHand && selected.type === 'spell') {
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        // RÃ©animation : ouvrir sÃ©lection cimetiÃ¨re au lieu d'Ã©mettre
        if (selected.requiresGraveyardCreature) {
            pendingReanimation = {
                card: { ...selected },
                handIndex: selected.idx,
                effectiveCost: selected.effectiveCost || selected.cost,
                targetPlayer, row, col
            };
            openGraveyardForSelection();
            clearSel();
            return;
        }
        commitSpell(selected, 'field', targetPlayer, row, col, selected.idx);
        handCardRemovedIndex = selected.idx;
        socket.emit('castSpell', { handIndex: selected.idx, targetPlayer, row, col });
        clearSel();
        return;
    }

    if (owner !== 'me') return;

    if (selected && selected.fromHand && selected.type === 'creature') {
        if (canPlaceAt(selected, col) && !state.me.field[row][col]
            && !committedReanimationSlots.some(s => s.row === row && s.col === col)
            && respectsProvocationPriority(selected, row, col)) {
            socket.emit('placeCard', { handIndex: selected.idx, row, col });
            clearSel();
        }
        return;
    }

    if (selected && selected.fromField) {
        const slot = getSlot('me', row, col);
        if (slot && slot.classList.contains('moveable')) {
            socket.emit('moveCard', { fromRow: selected.row, fromCol: selected.col, toRow: row, toCol: col });
            clearSel();
            return;
        }
    }

    const card = state.me.field[row][col];
    if (card && !state.me.inDeployPhase && !card.movedThisTurn) {
        clickFieldCard(row, col, card);
    }
}

function clickTrap(owner, row) {
    if (!canPlay() || owner !== 'me') return;
    if (selected && selected.fromHand && selected.type === 'trap') {
        if (!state.me.traps[row]) {
            socket.emit('placeTrap', { handIndex: selected.idx, trapIndex: row });
            clearSel();
        }
    }
}

function dropOnSlot(owner, row, col) {
    if (!dragged || !canPlay()) return;

    // Si la carte est trop chÃ¨re, marquer qu'on a essayÃ© et ne rien faire
    if (dragged.tooExpensive) {
        dragged.triedToDrop = true;
        return;
    }

    if (dragged.type === 'spell') {
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        // RÃ©animation : ouvrir la sÃ©lection du cimetiÃ¨re au lieu d'Ã©mettre directement
        if (dragged.requiresGraveyardCreature) {
            pendingReanimation = {
                card: { ...dragged },
                handIndex: dragged.idx,
                effectiveCost: dragged.effectiveCost || dragged.cost,
                targetPlayer, row, col
            };
            openGraveyardForSelection();
            clearSel();
            return;
        }
        socket.emit('castSpell', { handIndex: dragged.idx, targetPlayer, row, col });
    } else if (dragged.type === 'creature' && owner === 'me') {
        if (canPlaceAt(dragged, col) && !state.me.field[row][col]
            && !committedReanimationSlots.some(s => s.row === row && s.col === col)
            && respectsProvocationPriority(dragged, row, col)) {
            socket.emit('placeCard', { handIndex: dragged.idx, row, col });
        }
    }
    clearSel();
}

function dropOnTrap(owner, row) {
    if (!dragged || !canPlay() || owner !== 'me') return;

    // Si la carte est trop chÃ¨re, marquer qu'on a essayÃ© et ne rien faire
    if (dragged.tooExpensive) {
        dragged.triedToDrop = true;
        return;
    }

    if (dragged.type === 'trap' && !state.me.traps[row]) {
        socket.emit('placeTrap', { handIndex: dragged.idx, trapIndex: row });
    }
    clearSel();
}

function endTurn() {
    if (!canPlay()) return;
    const btn = document.getElementById('end-turn-btn');
    // Ne pas accepter le clic si le bouton n'affiche pas "FIN DE TOUR"
    if (btn.classList.contains('waiting') || btn.classList.contains('has-phase')) return;
    // Annuler sÃ©lection rÃ©animation en cours
    if (pendingReanimation) cancelReanimation();
    btn.classList.add('waiting');
    socket.emit('ready');
    // Re-render la main pour retirer les bordures .playable
    if (state && state.me) {
        renderHand(state.me.hand, state.me.energy);
    }
    // Forcer CardGlow Ã  recalculer (renderHand seul ne marque pas dirty)
    if (typeof CardGlow !== 'undefined') CardGlow.markDirty();
}

function openGraveyard(owner) {
    const popup = document.getElementById('graveyard-popup');
    const title = document.getElementById('graveyard-popup-title');
    const container = document.getElementById('graveyard-cards');

    const graveyard = owner === 'me' ? state.me.graveyard : state.opponent.graveyard;
    const pseudoEl = document.getElementById(owner === 'me' ? 'me-pseudo' : 'opp-pseudo');
    const playerName = pseudoEl ? pseudoEl.textContent : (owner === 'me' ? 'Vous' : 'Adversaire');

    title.textContent = `CimetiÃ¨re de ${playerName}`;
    container.innerHTML = '';

    if (!graveyard || graveyard.length === 0) {
        container.innerHTML = '<div class="graveyard-empty">Aucune carte au cimetiÃ¨re</div>';
    } else {
        graveyard.forEach(card => {
            const cardEl = makeCard(card, true);
            cardEl.dataset.uid = card.uid || card.id || '';
            cardEl.classList.add('in-graveyard');
            // Ajouter le preview au hover
            cardEl.onmouseenter = (e) => showCardPreview(card, e);
            cardEl.onmouseleave = hideCardPreview;
            // Clic = zoom
            cardEl.onclick = (e) => {
                e.stopPropagation();
                showCardZoom(card);
            };
            container.appendChild(cardEl);
            const nameEl = cardEl.querySelector('.arena-name');
            if (nameEl) fitArenaName(nameEl);
        });
    }

    popup.dataset.owner = owner;
    popup.classList.add('active');
}

function closeGraveyard() {
    if (pendingReanimation) {
        cancelReanimation();
        return;
    }
    const popup = document.getElementById('graveyard-popup');
    popup.classList.remove('active');
    delete popup.dataset.owner;
    // Nettoyer les cartes du popup pour libÃ©rer le DOM
    document.getElementById('graveyard-cards').innerHTML = '';
}

// === RÃ©animation : sÃ©lection de crÃ©ature au cimetiÃ¨re ===

let graveyardSelectionOpenedAt = 0;

function openGraveyardForSelection() {
    if (!pendingReanimation) return;

    const popup = document.getElementById('graveyard-popup');
    const title = document.getElementById('graveyard-popup-title');
    const container = document.getElementById('graveyard-cards');

    const graveyard = state.me.graveyard;
    const isGraveyardToHand = pendingReanimation.mode === 'graveyardToHand';

    title.textContent = isGraveyardToHand
        ? 'Choisissez une crÃ©ature Ã  renvoyer en main'
        : 'Choisissez une crÃ©ature Ã  rÃ©animer';
    container.innerHTML = '';
    popup.classList.add('selection-mode');

    if (!graveyard || graveyard.length === 0) {
        cancelReanimation();
        return;
    }

    const targetCol = pendingReanimation.col;
    const targetRow = pendingReanimation.row;

    let hasCreature = false;
    graveyard.forEach((card, index) => {
        const cardEl = makeCard(card, true);
        cardEl.classList.add('in-graveyard');

        const uid = card.uid || card.id;
        const alreadyCommitted = committedGraveyardUids.includes(uid);
        // GraveyardToHand : toute crÃ©ature est sÃ©lectionnable (pas de filtre colonne)
        const fitsSlot = card.type === 'creature' && (
            isGraveyardToHand ||
            (canPlaceAt(card, targetCol) && respectsProvocationPriority(card, targetRow, targetCol))
        );

        if (fitsSlot && !alreadyCommitted) {
            hasCreature = true;
            cardEl.classList.add('graveyard-selectable');
            cardEl.onclick = (e) => {
                e.stopPropagation();
                confirmReanimation(uid, index);
            };
        } else {
            cardEl.classList.add('graveyard-unselectable');
        }

        cardEl.onmouseenter = (e) => showCardPreview(card, e);
        cardEl.onmouseleave = hideCardPreview;
        container.appendChild(cardEl);
        const nameEl = cardEl.querySelector('.arena-name');
        if (nameEl) fitArenaName(nameEl);
    });

    if (!hasCreature) {
        cancelReanimation();
        return;
    }

    graveyardSelectionOpenedAt = Date.now();
    document.getElementById('reanimate-backdrop').classList.add('active');
    popup.dataset.owner = 'me';
    popup.classList.add('active');
}

function confirmReanimation(creatureUid, graveyardIndex) {
    if (!pendingReanimation) return;

    const data = pendingReanimation;
    const isGraveyardToHand = data.mode === 'graveyardToHand';
    pendingReanimation = null;

    // Tracker cette crÃ©ature comme engagÃ©e (empÃªche double sÃ©lection)
    committedGraveyardUids.push(creatureUid);

    // Fermer le popup et le backdrop
    const popup = document.getElementById('graveyard-popup');
    popup.classList.remove('active', 'selection-mode');
    document.getElementById('reanimate-backdrop').classList.remove('active');

    if (isGraveyardToHand) {
        // GraveyardToHand : sort global, pas de slot rÃ©servÃ©
        commitSpell(data.card, 'global', 0, -1, -1, data.handIndex);
        handCardRemovedIndex = data.handIndex;
        socket.emit('castGlobalSpell', {
            handIndex: data.handIndex,
            graveyardCreatureUid: creatureUid,
            graveyardIndex: graveyardIndex
        });
    } else {
        // RÃ©animation classique : rÃ©server le slot
        committedReanimationSlots.push({ row: data.row, col: data.col });
        commitSpell(data.card, 'field', data.targetPlayer, data.row, data.col, data.handIndex);
        handCardRemovedIndex = data.handIndex;
        socket.emit('castSpell', {
            handIndex: data.handIndex,
            targetPlayer: data.targetPlayer,
            row: data.row,
            col: data.col,
            graveyardCreatureUid: creatureUid,
            graveyardIndex: graveyardIndex
        });
    }
    // Le re-render de la main sera dÃ©clenchÃ© par le gameStateUpdate du serveur
    // avec handCardRemovedIndex pour l'animation FLIP smooth
}

function cancelReanimation() {
    pendingReanimation = null;
    const popup = document.getElementById('graveyard-popup');
    popup.classList.remove('active', 'selection-mode');
    delete popup.dataset.owner;
    document.getElementById('reanimate-backdrop').classList.remove('active');
}

// Fermer le popup cimetiÃ¨re en cliquant ailleurs
document.addEventListener('click', (e) => {
    const popup = document.getElementById('graveyard-popup');
    if (popup.classList.contains('active')) {
        // Ignorer les clics juste aprÃ¨s l'ouverture de la sÃ©lection (le mouseup du drop dÃ©clenche un click)
        if (popup.classList.contains('selection-mode') && Date.now() - graveyardSelectionOpenedAt < 300) return;
        if (!popup.contains(e.target) && !e.target.closest('.grave-box')) {
            closeGraveyard();
        }
    }
});

function clearSel() {
    selected = null;
    dragged = null;
    draggedFromField = null;
    // Scope aux conteneurs connus pour Ã©viter de scanner tout le DOM
    const containers = ['#my-hand', '#opp-hand', '.battlefield'];
    for (const sel of containers) {
        const c = document.querySelector(sel);
        if (c) c.querySelectorAll('.card.selected, .card.field-selected').forEach(e => e.classList.remove('selected', 'field-selected'));
    }
    clearHighlights();
}

// ==================== PANNEAUX UI ====================
function closeAllPanels() {
    document.getElementById('panelJournal').classList.remove('open');
    document.getElementById('panelSettings').classList.remove('open');
    document.getElementById('btnJournal').classList.remove('active');
    document.getElementById('btnSettings').classList.remove('active');
    document.getElementById('panel-overlay').classList.remove('visible');
}

function togglePanel(panelId, btnId) {
    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);
    const isOpen = panel.classList.contains('open');
    closeAllPanels();

    if (!isOpen) {
        panel.classList.add('open');
        btn.classList.add('active');
        document.getElementById('panel-overlay').classList.add('visible');
    }
}

function toggleLog() {
    togglePanel('panelJournal', 'btnJournal');
}

function toggleSettings() {
    togglePanel('panelSettings', 'btnSettings');
}

// Initialiser les event listeners des panneaux
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnJournal')?.addEventListener('click', () => togglePanel('panelJournal', 'btnJournal'));
    document.getElementById('btnSettings')?.addEventListener('click', () => togglePanel('panelSettings', 'btnSettings'));
    document.getElementById('closeJournal')?.addEventListener('click', closeAllPanels);
    document.getElementById('closeSettings')?.addEventListener('click', closeAllPanels);
    document.getElementById('panel-overlay')?.addEventListener('click', closeAllPanels);

    // Update slider values display
    const musicSlider = document.getElementById('musicVolume');
    const sfxSlider = document.getElementById('sfxVolume');
    if (musicSlider) {
        musicSlider.addEventListener('input', (e) => {
            document.getElementById('musicValue').textContent = e.target.value + '%';
        });
    }
    if (sfxSlider) {
        sfxSlider.addEventListener('input', (e) => {
            document.getElementById('sfxValue').textContent = e.target.value + '%';
        });
    }
});

function setMusicVolume(val) {
    // TODO: Connecter Ã  un systÃ¨me audio
    document.getElementById('musicValue').textContent = val + '%';
}

function setSfxVolume(val) {
    // TODO: Connecter Ã  un systÃ¨me audio
    document.getElementById('sfxValue').textContent = val + '%';
}

function surrender() {
    socket.emit('surrender');
}

const LOG_MAX_ENTRIES = 150;
let _pendingBattleLogs = [];
let _logFlushHandle = 0;

function _flushBattleLogs() {
    _logFlushHandle = 0;
    if (_pendingBattleLogs.length === 0) return;
    const c = document.getElementById('log-content');
    if (!c) {
        _pendingBattleLogs = [];
        return;
    }

    const entries = _pendingBattleLogs;
    _pendingBattleLogs = [];
    const frag = document.createDocumentFragment();

    // On prepend en un seul passage tout en gardant le "plus recent en haut".
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        const el = document.createElement('div');
        el.className = `battle-log-entry ${entry.type}`;

        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = entry.timeText;

        const message = document.createElement('div');
        message.className = 'message';
        message.textContent = entry.msg;

        el.appendChild(time);
        el.appendChild(message);
        frag.appendChild(el);
    }

    c.insertBefore(frag, c.firstChild);

    while (c.children.length > LOG_MAX_ENTRIES) {
        c.removeChild(c.lastChild);
    }
}

function _scheduleBattleLogFlush() {
    if (_logFlushHandle) return;
    if (typeof requestAnimationFrame === 'function' && !document.hidden) {
        _logFlushHandle = requestAnimationFrame(_flushBattleLogs);
        return;
    }
    _logFlushHandle = setTimeout(_flushBattleLogs, 16);
}

function log(msg, type = 'action') {
    const now = new Date();
    _pendingBattleLogs.push({
        msg,
        type,
        timeText: now.toLocaleTimeString('fr-FR')
    });
    _scheduleBattleLogFlush();
}

// ==================== CARD ZOOM ====================
let zoomCardData = null;

function showCardZoom(card) {
    const overlay = document.getElementById('card-zoom-overlay');
    const container = document.getElementById('card-zoom-container');

    // CrÃ©er la version complÃ¨te de la carte (inHand = true pour avoir tous les dÃ©tails)
    container.innerHTML = '';
    const cardEl = makeCard(card, true);
    container.appendChild(cardEl);

    // Bouton oeil pour toggle art-only
    if (card.arenaStyle && card.image) {
        const eyeBtn = document.createElement('div');
        eyeBtn.className = 'zoom-art-toggle';
        eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cardEl.classList.toggle('art-only');
            eyeBtn.classList.toggle('active');
        });
        container.appendChild(eyeBtn);
    }

    zoomCardData = card;
    overlay.classList.remove('hidden');

    // Auto-fit du nom (aprÃ¨s remove('hidden') pour que le layout soit calculÃ©)
    const zoomNameEl = cardEl.querySelector('.arena-name');
    if (zoomNameEl) fitArenaName(zoomNameEl);
}

function hideCardZoom() {
    const overlay = document.getElementById('card-zoom-overlay');
    overlay.classList.add('hidden');
    zoomCardData = null;
}

// â”€â”€ Game Scaler : adapte le jeu Ã  toutes les rÃ©solutions â”€â”€
// zoom re-rastÃ©rise au lieu de scaler un bitmap â†’ cartes nettes Ã  toute rÃ©solution
// (le layout est calculÃ© Ã  1920Ã—1080, puis zoomÃ©)
function resizeGame() {
    const scaler = document.getElementById('game-scaler');
    if (!scaler) return;
    const REF_W = 1920, REF_H = 1080;
    const scaleX = window.innerWidth / REF_W;
    const scaleY = window.innerHeight / REF_H;
    const scale = Math.min(scaleX, scaleY);
    scaler.style.zoom = scale;
    // Centrage letterbox (bandes noires si ratio â‰  16:9)
    scaler.style.left = `${(window.innerWidth - REF_W * scale) / 2}px`;
    scaler.style.top = `${(window.innerHeight - REF_H * scale) / 2}px`;
    // Exposer le scale pour les Ã©lÃ©ments hors-scaler (drag ghost, animations)
    document.documentElement.style.setProperty('--game-scale', scale);
    // Synchroniser les stages PIXI avec le nouveau zoom/position
    if (typeof CombatVFX !== 'undefined' && CombatVFX.initialized) {
        CombatVFX._syncStageTransform();
    }
}
window.addEventListener('resize', resizeGame);

document.addEventListener('DOMContentLoaded', async () => {
    // Adapter le scaling Ã  la rÃ©solution
    resizeGame();

    // Initialiser le systÃ¨me d'animation PixiJS
    await initCombatAnimations();

    initSocket();
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });

    // Fermer le zoom au clic sur l'overlay
    document.getElementById('card-zoom-overlay').addEventListener('click', hideCardZoom);

    document.addEventListener('click', (e) => {
        // Fermer le log si on clique en dehors
        if (!e.target.closest('.log-popup') && !e.target.closest('.log-btn')) {
            document.getElementById('log-popup')?.classList.remove('active');
        }
        // Fermer settings si on clique en dehors
        if (!e.target.closest('.settings-popup') && !e.target.closest('.options-btn')) {
            document.getElementById('settings-popup')?.classList.remove('active');
        }
        // DÃ©sÃ©lectionner les cartes
        if (!e.target.closest('.card') && !e.target.closest('.card-slot') && !e.target.closest('.trap-slot')) {
            clearSel();
        }
    });

    // â”€â”€ Curseur fantasy custom â”€â”€
    const cursorEl = document.getElementById('cursor-fantasy');

    document.addEventListener('mousemove', e => {
        cursorEl.style.left = e.clientX + 'px';
        cursorEl.style.top = e.clientY + 'px';
        cursorEl.style.opacity = '1';
    });

    document.addEventListener('mousedown', e => {
        cursorEl.classList.add('clicking');

        CombatVFX.createClickRing(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
        cursorEl.classList.remove('clicking');
    });

    document.addEventListener('mouseleave', () => cursorEl.style.opacity = '0');
    document.addEventListener('mouseenter', () => cursorEl.style.opacity = '1');
});




