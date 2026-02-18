// ==================== CŒUR DU JEU ====================
// Socket/réseau, drag & drop, interactions utilisateur, initialisation

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
                    // Si pendingReanimation est actif, confirmReanimation gère le commit/remove
                    if (!pendingReanimation) {
                        if (data.card.type === 'spell') {
                            // Sort engagé : stocker pour affichage grisé dans la main
                            const tp = target.owner === 'me' ? myNum : (target.owner === 'opp' ? (myNum === 1 ? 2 : 1) : 0);
                            commitSpell(data.card, target.type, tp, target.row, target.col, data.idx);
                        }
                        handCardRemovedIndex = data.idx;
                    }
                    // Fade pour pièges (mode flèche — la carte est encore visible dans la main)
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
            // GraveyardToHand : ouvrir le cimetière pour sélectionner une créature
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

    // Héros cible
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

    // Piège
    if (target.type === 'trap') {
        if (!target.element.classList.contains('valid-target')) return false;
        dragged = { ...card, idx: data.idx, tooExpensive: data.tooExpensive };
        dropOnTrap(target.owner, target.row);
        return !data.tooExpensive;
    }

    // Slot de terrain (créature ou sort ciblé)
    if (target.type === 'field') {
        if (!target.element.classList.contains('valid-target')) return false;
        dragged = { ...card, idx: data.idx, tooExpensive: data.tooExpensive, effectiveCost: data.effectiveCost };
        dropOnSlot(target.owner, target.row, target.col);
        // Réanimation : graveyard ouvert, ne pas commit/remove encore
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

    socket.on('gameStart', (s) => {
        state = s;
        myNum = s.myPlayer;
        setupHeroes();
        setRandomRanks();
        document.getElementById('lobby').classList.add('hidden');

        // Vérifier si on est en phase mulligan
        if (s.phase === 'mulligan') {
            showModeSelector();
        } else {
            startGame();
        }
    });

    socket.on('gameStateUpdate', (s) => {
        const meGrave = s.me?.graveyard || [];
        const oppGrave = s.opponent?.graveyard || [];
        const prevMeGrave = state?.me?.graveyard?.length || 0;
        const prevOppGrave = state?.opponent?.graveyard?.length || 0;
        if (meGrave.length > prevMeGrave && !graveRenderBlocked.has('me')) {
        }
        if (oppGrave.length > prevOppGrave && !graveRenderBlocked.has('opp')) {
        }
        // Auto-cacher les nouvelles cartes adverses si le count augmente pendant la résolution
        // (sécurité anti-flash si l'état arrive avant l'event draw)
        if (typeof GameAnimations !== 'undefined' && state?.opponent) {
            const prevOppCount = state.opponent.handCount || 0;
            const newOppCount = s.opponent?.handCount || 0;
            if (newOppCount > prevOppCount && s.phase === 'resolution') {
                // Ne pas auto-cacher si pendingBounce gère déjà la visibilité (bounce/graveyardReturn)
                if (!(typeof pendingBounce !== 'undefined' && pendingBounce && pendingBounce.owner === 'opp')) {
                    GameAnimations.autoHideNewDraws('opp', prevOppCount, newOppCount);
                }
            }
        }

        const wasInDeployPhase = state?.me?.inDeployPhase;
        const wasMulligan = state?.phase === 'mulligan';
        // Détecter si le héros a changé (mode complet force Erebeth)
        const heroChanged = window.heroData && s.me.hero && s.me.hero.id !== window.heroData.me?.id;
        state = s;

        if (heroChanged) {
            setupHeroes();
        }

        // Si on est en phase mulligan et qu'on reçoit une mise à jour (après mulligan)
        if (s.phase === 'mulligan' && mulliganDone) {
            // Mettre à jour l'affichage des nouvelles cartes
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

        render();
        updatePhaseDisplay();

        // Plus de message ici - tout est géré par newTurn avec "Planification"
    });

    socket.on('timerUpdate', (t) => {
        currentTimer = t;
        if(state) state.timeLeft = t;
        updateTimerDisplay(t);
    });

    socket.on('phaseChange', (p) => {
        if(state) state.phase = p;
        updatePhaseDisplay();

        if (p === 'resolution') {
            // Annuler la réanimation en cours si la popup est ouverte
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
        showPhaseMessage(data.text, data.type);
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
        log(isMe ? 'Vous êtes prêt' : 'Adversaire prêt', 'action');

        if (meReady && oppReady) {
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.classList.remove('has-timer', 'urgent');
        }
    });

    socket.on('newTurn', (d) => {

        if (state) {
            state.turn = d.turn;
            state.phase = 'planning';
        }

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

        log(`🎮 Tour ${d.turn} — ⚡${d.maxEnergy} énergie`, 'phase');

        // Bannière de round AAA
        showRoundBanner(d.turn);
    });

    socket.on('resolutionLog', (d) => log(d.msg, d.type));

    socket.on('directDamage', (d) => {
        const heroEl = document.getElementById(d.defender === myNum ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.style.animation = 'heroShake 0.5s ease-out';
            heroEl.classList.add('hero-hit');
            setTimeout(() => { heroEl.style.animation = ''; heroEl.classList.remove('hero-hit'); }, 550);
            const rect = heroEl.getBoundingClientRect();
            CombatVFX.createHeroHitEffect(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width, rect.height);
        }
    });

    socket.on('animation', handleAnimation);

    // Batch d'animations (pour les sorts de zone - jouées en parallèle)
    socket.on('animationBatch', handleAnimationBatch);

    // Bloquer les slots pendant les animations de mort (pour que render() ne les efface pas)
    socket.on('blockSlots', (slots) => {
        slots.forEach(s => {
            const owner = s.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${s.row}-${s.col}`;
            animatingSlots.add(slotKey);
        });
    });

    socket.on('unblockSlots', (slots) => {
        slots.forEach(s => {
            const owner = s.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${s.row}-${s.col}`;
            animatingSlots.delete(slotKey);
        });
        // Forcer un render après déblocage pour mettre à jour l'affichage
        render();
    });

// Highlight des cases pour les sorts
    socket.on('spellHighlight', (data) => {
        data.targets.forEach((t, index) => {
            const owner = t.player === myNum ? 'me' : 'opp';
            const slot = getSlot(owner, t.row, t.col);
            if (slot) {
                const rect = slot.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                // Pour les sorts de zone (cross), flammes sur TOUTES les cases
                if (data.pattern === 'cross' && data.type === 'damage') {
                    setTimeout(() => {
                        CombatAnimations.showFlameEffect(cx, cy, 0);
                    }, index * 80);
                } else {
                    // Sort simple : pas de highlight CSS, l'effet d'impact/miss PixiJS suffit
                }
            }
        });
    });

    socket.on('gameOver', (d) => {
        let resultText, resultClass;
        if (d.draw) {
            resultText = '🤝 Match nul !';
            resultClass = 'draw';
        } else {
            const won = d.winner === myNum;
            resultText = won ? '🎉 Victoire !' : '😢 Défaite';
            resultClass = won ? 'victory' : 'defeat';
        }
        document.getElementById('result').textContent = resultText;
        document.getElementById('result').className = 'game-over-result ' + resultClass;
        document.getElementById('game-over').classList.remove('hidden');
    });

    socket.on('playerDisconnected', () => log('⚠️ Adversaire déconnecté', 'damage'));

    // Resync quand la fenêtre revient au premier plan
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state && state.phase) {
            socket.emit('requestSync');
        }
    });

    // Le serveur envoie périodiquement le numéro de tour pour détecter la désynchronisation
    socket.on('turnCheck', (serverTurn) => {
        if (state && state.turn !== serverTurn) {
            socket.emit('requestSync');
        }
    });
}

function handleAnimation(data) {
    const { type } = data;
    // Les animations de combat utilisent la file d'attente
    const queuedTypes = ['attack', 'damage', 'spellDamage', 'death', 'deathTransform', 'heroHit', 'discard', 'burn', 'zdejebel', 'onDeathDamage', 'spell', 'spellDual', 'spellDualEnd', 'trapTrigger', 'trampleDamage', 'trampleHeroHit', 'bounce', 'sacrifice', 'poisonDamage', 'lifesteal', 'healOnDeath', 'regen', 'graveyardReturn', 'combatRowStart', 'combatEnd', 'buildingActivate'];

    if (queuedTypes.includes(type)) {
        // Bloquer render() immédiatement pour les animations trample (avant traitement de la queue)
        if (type === 'trampleHeroHit') {
            zdejebelAnimationInProgress = true;
        }
        if (type === 'trampleDamage') {
            const owner = data.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${data.row}-${data.col}`;
            animatingSlots.add(slotKey);
        }
        // Bloquer render() immédiatement pour onDeathDamage héros (Dragon Crépitant)
        if (type === 'onDeathDamage' && data.targetRow === undefined) {
            zdejebelAnimationInProgress = true;
        }
        // Bloquer renderTraps() immédiatement pour les pièges (avant traitement de la queue)
        if (type === 'trapTrigger') {
            const owner = data.player === myNum ? 'me' : 'opp';
            const trapKey = `${owner}-${data.row}`;
            animatingTrapSlots.add(trapKey);
        }
        queueAnimation(type, data);
    } else {
        // Les autres animations s'exécutent immédiatement
        switch(type) {
            case 'spellMiss': animateSpellMiss(data); break;
            case 'spellReturnToHand': animateSpellReturnToHand(data); break;
            case 'heal': animateHeal(data); break;
            case 'searchSpell': {
                const ssOwner = data.player === myNum ? 'me' : 'opp';
                const ssSlot = getSlot(ssOwner, data.row, data.col);
                if (ssSlot) {
                    const rect = ssSlot.getBoundingClientRect();
                    CombatVFX.createSearchSpellEffect(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                        rect.width,
                        rect.height
                    );
                }
                break;
            }
            case 'buff': animateBuff(data); break;
            case 'buffApply': {
                const baOwner = data.player === myNum ? 'me' : 'opp';
                const baSlot = getSlot(baOwner, data.row, data.col);
                if (baSlot) {
                    const rect = baSlot.getBoundingClientRect();
                    CombatVFX.createBuffEffect(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                        data.atkBuff ?? 1,
                        data.hpBuff ?? 1,
                        rect.width,
                        rect.height
                    );
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
                    CombatVFX.createDestroyEffect(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                        rect.width,
                        rect.height
                    );
                }
                break;
            }
            case 'entrave': {
                const entOwner = data.player === myNum ? 'me' : 'opp';
                const entSlot = getSlot(entOwner, data.row, data.col);
                if (entSlot) {
                    const rect = entSlot.getBoundingClientRect();
                    CombatVFX.createEntraveEffect(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                        data.amount,
                        rect.width,
                        rect.height
                    );
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
                    CombatVFX.createMedusaGazeEffect(
                        srcRect.left + srcRect.width / 2,
                        srcRect.top + srcRect.height / 2,
                        tgtRect.left + tgtRect.width / 2,
                        tgtRect.top + tgtRect.height / 2
                    );
                }
                break;
            }
            case 'petrify': {
                const petOwner = data.player === myNum ? 'me' : 'opp';
                const petSlot = getSlot(petOwner, data.row, data.col);
                if (petSlot) {
                    const rect = petSlot.getBoundingClientRect();
                    CombatVFX.createPetrifyEffect(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                        rect.width,
                        rect.height
                    );
                } else {
                }
                break;
            }
        }
    }
}

// Handler pour les batches d'animations (sorts de zone - jouées en parallèle)
function handleAnimationBatch(animations) {

    // Bloquer immédiatement les slots des deathTransform pour que render() ne les écrase pas
    for (const anim of animations) {
        if (anim.type === 'deathTransform') {
            const owner = anim.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${anim.row}-${anim.col}`;
            animatingSlots.add(slotKey);
        }
    }

    // Séparer les animations : death/deathTransform passent par la file d'attente, le reste joue immédiatement
    const immediatePromises = [];
    for (const anim of animations) {
        const owner = anim.player === myNum ? 'me' : 'opp';

        if (anim.type === 'spellDamage') {
            immediatePromises.push(CombatAnimations.animateSpellDamage({
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
            // Animation de poison : passer par la file d'attente pour le batch processing
            queueAnimation(anim.type, anim);
        } else if (anim.type === 'poisonApply') {
            // VFX nuage toxique sur la carte ciblée
            const poisonOwner = anim.player === myNum ? 'me' : 'opp';
            const poisonSlot = getSlot(poisonOwner, anim.row, anim.col);
            if (poisonSlot) {
                const rect = poisonSlot.getBoundingClientRect();
                CombatVFX.createPoisonCloudEffect(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                    rect.width, rect.height
                );
            }
        } else if (anim.type === 'buffApply') {
            const buffOwner = anim.player === myNum ? 'me' : 'opp';
            const buffSlot = getSlot(buffOwner, anim.row, anim.col);
            if (buffSlot) {
                const rect = buffSlot.getBoundingClientRect();
                CombatVFX.createBuffEffect(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                    anim.atkBuff ?? 1,
                    anim.hpBuff ?? 1,
                    rect.width,
                    rect.height
                );
            }
        } else if (anim.type === 'death' || anim.type === 'deathTransform') {
            // Passer par la file pour respecter l'ordre des animations (après damage, etc.)
            queueAnimation(anim.type, anim);
        } else if (anim.type === 'trapSummon') {
            // Invocation via sort (ex: Mur de zombie) — jouer en parallèle
            animateTrapSummon(anim);
        } else {
        }
    }

    if (immediatePromises.length > 0) {
        Promise.all(immediatePromises).then(() => {
        });
    }
}

function animateBuff(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = getSlot(owner, data.row, data.col);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        CombatVFX.createBuffEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            data.atk || 0,
            data.hp || 0,
            rect.width,
            rect.height
        );
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

    // Effet de bris de verre PixiJS
    CombatVFX.createShieldBreakEffect(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect.width,
        rect.height
    );
}

// Les fonctions animateAttack et animateDamage sont maintenant gérées par le système PixiJS
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
        // Réanimation : ouvrir sélection cimetière au lieu d'émettre
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
            && !committedReanimationSlots.some(s => s.row === row && s.col === col)) {
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

    // Si la carte est trop chère, marquer qu'on a essayé et ne rien faire
    if (dragged.tooExpensive) {
        dragged.triedToDrop = true;
        return;
    }

    if (dragged.type === 'spell') {
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        // Réanimation : ouvrir la sélection du cimetière au lieu d'émettre directement
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
            && !committedReanimationSlots.some(s => s.row === row && s.col === col)) {
            socket.emit('placeCard', { handIndex: dragged.idx, row, col });
        }
    }
    clearSel();
}

function dropOnTrap(owner, row) {
    if (!dragged || !canPlay() || owner !== 'me') return;

    // Si la carte est trop chère, marquer qu'on a essayé et ne rien faire
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
    // Annuler sélection réanimation en cours
    if (pendingReanimation) cancelReanimation();
    btn.classList.add('waiting');
    socket.emit('ready');
    // Re-render la main pour retirer les bordures .playable
    if (state && state.me) {
        renderHand(state.me.hand, state.me.energy);
    }
}

function openGraveyard(owner) {
    const popup = document.getElementById('graveyard-popup');
    const title = document.getElementById('graveyard-popup-title');
    const container = document.getElementById('graveyard-cards');

    const graveyard = owner === 'me' ? state.me.graveyard : state.opponent.graveyard;
    const pseudoEl = document.getElementById(owner === 'me' ? 'me-pseudo' : 'opp-pseudo');
    const playerName = pseudoEl ? pseudoEl.textContent : (owner === 'me' ? 'Vous' : 'Adversaire');

    title.textContent = `Cimetière de ${playerName}`;
    container.innerHTML = '';

    if (!graveyard || graveyard.length === 0) {
        container.innerHTML = '<div class="graveyard-empty">Aucune carte au cimetière</div>';
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
    // Nettoyer les cartes du popup pour libérer le DOM
    document.getElementById('graveyard-cards').innerHTML = '';
}

// === Réanimation : sélection de créature au cimetière ===

let graveyardSelectionOpenedAt = 0;

function openGraveyardForSelection() {
    if (!pendingReanimation) return;

    const popup = document.getElementById('graveyard-popup');
    const title = document.getElementById('graveyard-popup-title');
    const container = document.getElementById('graveyard-cards');

    const graveyard = state.me.graveyard;
    const isGraveyardToHand = pendingReanimation.mode === 'graveyardToHand';

    title.textContent = isGraveyardToHand
        ? 'Choisissez une créature à renvoyer en main'
        : 'Choisissez une créature à réanimer';
    container.innerHTML = '';
    popup.classList.add('selection-mode');

    if (!graveyard || graveyard.length === 0) {
        cancelReanimation();
        return;
    }

    const targetCol = pendingReanimation.col;

    let hasCreature = false;
    graveyard.forEach((card, index) => {
        const cardEl = makeCard(card, true);
        cardEl.classList.add('in-graveyard');

        const uid = card.uid || card.id;
        const alreadyCommitted = committedGraveyardUids.includes(uid);
        // GraveyardToHand : toute créature est sélectionnable (pas de filtre colonne)
        const fitsSlot = card.type === 'creature' && (isGraveyardToHand || canPlaceAt(card, targetCol));

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

    // Tracker cette créature comme engagée (empêche double sélection)
    committedGraveyardUids.push(creatureUid);

    // Fermer le popup et le backdrop
    const popup = document.getElementById('graveyard-popup');
    popup.classList.remove('active', 'selection-mode');
    document.getElementById('reanimate-backdrop').classList.remove('active');

    if (isGraveyardToHand) {
        // GraveyardToHand : sort global, pas de slot réservé
        commitSpell(data.card, 'global', 0, -1, -1, data.handIndex);
        handCardRemovedIndex = data.handIndex;
        socket.emit('castGlobalSpell', {
            handIndex: data.handIndex,
            graveyardCreatureUid: creatureUid,
            graveyardIndex: graveyardIndex
        });
    } else {
        // Réanimation classique : réserver le slot
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
    // Le re-render de la main sera déclenché par le gameStateUpdate du serveur
    // avec handCardRemovedIndex pour l'animation FLIP smooth
}

function cancelReanimation() {
    pendingReanimation = null;
    const popup = document.getElementById('graveyard-popup');
    popup.classList.remove('active', 'selection-mode');
    delete popup.dataset.owner;
    document.getElementById('reanimate-backdrop').classList.remove('active');
}

// Fermer le popup cimetière en cliquant ailleurs
document.addEventListener('click', (e) => {
    const popup = document.getElementById('graveyard-popup');
    if (popup.classList.contains('active')) {
        // Ignorer les clics juste après l'ouverture de la sélection (le mouseup du drop déclenche un click)
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
    document.querySelectorAll('.card').forEach(e => e.classList.remove('selected', 'field-selected'));
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
    // TODO: Connecter à un système audio
    document.getElementById('musicValue').textContent = val + '%';
}

function setSfxVolume(val) {
    // TODO: Connecter à un système audio
    document.getElementById('sfxValue').textContent = val + '%';
}

function surrender() {
    socket.emit('surrender');
}

function log(msg, type = 'action') {
    const el = document.createElement('div');
    el.className = `battle-log-entry ${type}`;

    const time = document.createElement('div');
    time.className = 'time';
    const now = new Date();
    time.textContent = now.toLocaleTimeString('fr-FR');

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = msg;

    el.appendChild(time);
    el.appendChild(message);

    const c = document.getElementById('log-content');
    // Insérer en haut (plus récent en premier)
    c.insertBefore(el, c.firstChild);

    // Limiter à 150 entrées pour éviter la croissance DOM infinie
    while (c.children.length > 150) {
        c.removeChild(c.lastChild);
    }
}

// ==================== CARD ZOOM ====================
let zoomCardData = null;

function showCardZoom(card) {
    const overlay = document.getElementById('card-zoom-overlay');
    const container = document.getElementById('card-zoom-container');

    // Créer la version complète de la carte (inHand = true pour avoir tous les détails)
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

    // Auto-fit du nom (après remove('hidden') pour que le layout soit calculé)
    const zoomNameEl = cardEl.querySelector('.arena-name');
    if (zoomNameEl) fitArenaName(zoomNameEl);
}

function hideCardZoom() {
    const overlay = document.getElementById('card-zoom-overlay');
    overlay.classList.add('hidden');
    zoomCardData = null;
}

// ── Game Scaler : adapte le jeu à toutes les résolutions ──
// transform:scale() au lieu de zoom → rendu identique à toutes les résolutions
// (le layout est calculé à 1920×1080, puis mis à l'échelle GPU)
function resizeGame() {
    const scaler = document.getElementById('game-scaler');
    if (!scaler) return;
    const REF_W = 1920, REF_H = 1080;
    const scaleX = window.innerWidth / REF_W;
    const scaleY = window.innerHeight / REF_H;
    const scale = Math.min(scaleX, scaleY);
    scaler.style.transform = `scale(${scale})`;
    // Centrage letterbox (bandes noires si ratio ≠ 16:9)
    scaler.style.left = `${(window.innerWidth - REF_W * scale) / 2}px`;
    scaler.style.top = `${(window.innerHeight - REF_H * scale) / 2}px`;
    // Exposer le scale pour les éléments hors-scaler (drag ghost, animations)
    document.documentElement.style.setProperty('--game-scale', scale);
}
window.addEventListener('resize', resizeGame);

document.addEventListener('DOMContentLoaded', async () => {
    // Adapter le scaling à la résolution
    resizeGame();

    // Initialiser le système d'animation PixiJS
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
        // Désélectionner les cartes
        if (!e.target.closest('.card') && !e.target.closest('.card-slot') && !e.target.closest('.trap-slot')) {
            clearSel();
        }
    });

    // ── Curseur fantasy custom ──
    const cursorEl = document.getElementById('cursor-fantasy');
    let cursorTrailCounter = 0;

    document.addEventListener('mousemove', e => {
        cursorEl.style.left = e.clientX + 'px';
        cursorEl.style.top = e.clientY + 'px';
        cursorEl.style.opacity = '1';

        cursorTrailCounter++;
        if (cursorTrailCounter % 3 === 0) {
            CombatVFX.createCursorTrail(e.clientX, e.clientY);
        }
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
