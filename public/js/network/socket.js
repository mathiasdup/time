// =============================================
// Gestion des sockets
// =============================================
// Communication avec le serveur via Socket.IO

/**
 * Initialise la connexion socket
 */
function initSocket() {
    socket = io();

    socket.on('gameStart', (s) => {
        state = s;
        myNum = s.myPlayer;
        setupHeroes();
        document.getElementById('lobby').classList.add('hidden');

        if (s.phase === 'mulligan') {
            showMulligan();
        } else {
            startGame();
        }
    });

    socket.on('gameStateUpdate', (s) => {
        console.log(`[gameStateUpdate] Reçu, animatingSlots:`, [...animatingSlots]);
        const wasInDeployPhase = state?.me?.inDeployPhase;
        const wasMulligan = state?.phase === 'mulligan';
        state = s;

        if (s.phase === 'mulligan' && mulliganDone) {
            const handContainer = document.getElementById('mulligan-hand');
            handContainer.innerHTML = '';
            s.me.hand.forEach(card => {
                const cardEl = makeCard(card, true);
                handContainer.appendChild(cardEl);
            });
        }

        if (wasMulligan && s.phase === 'planning') {
            document.getElementById('mulligan-overlay').classList.add('hidden');
            startGame();
        }

        render();
        updatePhaseDisplay();
    });

    socket.on('timerUpdate', (t) => {
        currentTimer = t;
        if(state) state.timeLeft = t;
        updateTimerDisplay(t);
    });

    socket.on('phaseChange', (p) => {
        if(state) state.phase = p;
        updatePhaseDisplay();

        // Réinitialiser le bouton dès qu'on quitte la phase planning
        if (p !== 'planning') {
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.classList.remove('waiting', 'has-timer');
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
        console.log(`[newTurn] Received turn=${d.turn}, local turn=${state?.turn}`);

        if (state) {
            state.turn = d.turn;
            state.phase = 'planning';
        }

        currentTimer = 90;
        meReady = false;
        oppReady = false;
        const endTurnBtn = document.getElementById('end-turn-btn');
        endTurnBtn.classList.remove('waiting', 'has-timer', 'urgent');
        clearSel();

        resetAnimationStates();

        log(`🎮 Tour ${d.turn} — ⚡${d.maxEnergy} énergie`, 'phase');
        showPhaseMessage('Planification', 'planning');
    });

    socket.on('resolutionLog', (d) => log(d.msg, d.type));

    socket.on('directDamage', (d) => {
        const heroEl = document.getElementById(d.defender === myNum ? 'hero-me' : 'hero-opp');
        heroEl.classList.add('hit');
        setTimeout(() => heroEl.classList.remove('hit'), 500);
    });

    socket.on('animation', handleAnimation);
    socket.on('animationBatch', handleAnimationBatch);

    socket.on('blockSlots', (slots) => {
        slots.forEach(s => {
            const owner = s.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${s.row}-${s.col}`;
            animatingSlots.add(slotKey);

            if (s.hideCard) {
                const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${s.row}"][data-col="${s.col}"]`);
                if (slot) {
                    const card = slot.querySelector('.card');
                    if (card) {
                        card.style.visibility = 'hidden';
                    }
                }
            }
        });
    });

    socket.on('unblockSlots', (slots) => {
        slots.forEach(s => {
            const owner = s.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${s.row}-${s.col}`;
            animatingSlots.delete(slotKey);
        });
        render();
    });

    // NOTE: hideCards et revealCard ont été supprimés
    // Le serveur filtre maintenant les cartes adverses nouvelles pendant le planning

    socket.on('spellHighlight', (data) => {
        data.targets.forEach((t, index) => {
            const owner = t.player === myNum ? 'me' : 'opp';
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${t.row}"][data-col="${t.col}"]`);
            if (slot) {
                slot.classList.add('spell-highlight-' + data.type);

                if (data.type === 'damage') {
                    const rect = slot.getBoundingClientRect();
                    setTimeout(() => {
                        const flame = document.createElement('div');
                        flame.className = 'spell-flame';
                        flame.textContent = '🔥';
                        flame.style.left = rect.left + rect.width/2 - 30 + 'px';
                        flame.style.top = rect.top + rect.height/2 - 40 + 'px';
                        document.body.appendChild(flame);
                        setTimeout(() => flame.remove(), 600);
                    }, index * 100);
                }

                const cardInSlot = slot.querySelector('.card');
                if (cardInSlot) {
                    cardInSlot.classList.add('spell-target-' + data.type);
                    setTimeout(() => cardInSlot.classList.remove('spell-target-' + data.type), 1500);
                }
                setTimeout(() => slot.classList.remove('spell-highlight-' + data.type), 1500);
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
    // (les navigateurs throttle les WebSockets en arrière-plan)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state && state.phase) {
            console.log('[visibilitychange] Window visible, requesting sync');
            socket.emit('requestSync');
        }
    });

    // Le serveur envoie périodiquement le numéro de tour pour détecter la désynchronisation
    socket.on('turnCheck', (serverTurn) => {
        console.log(`[turnCheck] Server turn=${serverTurn}, local turn=${state?.turn}`);
        if (state && state.turn !== serverTurn) {
            console.log(`[turnCheck] DESYNC DETECTED! Requesting sync...`);
            socket.emit('requestSync');
        }
    });
}

/**
 * Gère une animation reçue
 */
function handleAnimation(data) {
    const { type } = data;
    console.log('[Animation] Received:', type, data);

    const queuedTypes = ['attack', 'damage', 'spellDamage', 'death', 'heroHit', 'discard', 'burn', 'zdejebel', 'deathTransform', 'reveal', 'radiantDragonDraw', 'shieldDeploy', 'move', 'summon'];

    if (queuedTypes.includes(type)) {
        // Bloquer les slots pendant l'animation pour move et summon adverses
        if (type === 'move' && data.player !== myNum) {
            const owner = 'opp';
            const fromKey = `${owner}-${data.fromRow}-${data.fromCol}`;
            const toKey = `${owner}-${data.toRow}-${data.toCol}`;
            animatingSlots.add(fromKey);
            animatingSlots.add(toKey);
            console.log(`[handleAnimation] MOVE reçu: ${data.card.name}`);
        } else if (type === 'summon' && data.player !== myNum) {
            const owner = 'opp';
            animatingSlots.add(`${owner}-${data.row}-${data.col}`);
        }
        queueAnimation(type, data);
    } else {
        switch(type) {
            case 'spell': animateSpell(data); break;
            case 'spellMiss': animateSpellMiss(data); break;
            case 'heal': animateHeal(data); break;
            case 'buff': animateBuff(data); break;
            case 'trapTrigger': animateTrap(data); break;
            case 'shieldBreak': animateShieldBreak(data); break;
            case 'draw':
                if (typeof GameAnimations !== 'undefined') {
                    GameAnimations.prepareDrawAnimation(data);
                }
                break;
        }
    }
}

/**
 * Gère un batch d'animations
 */
function handleAnimationBatch(animations) {
    console.log('[AnimationBatch] Received batch of', animations.length, 'animations');

    const promises = animations.map(anim => {
        const owner = anim.player === myNum ? 'me' : 'opp';

        if (anim.type === 'spellDamage') {
            if (combatAnimReady && CombatAnimations) {
                return CombatAnimations.animateSpellDamage({
                    owner: owner,
                    row: anim.row,
                    col: anim.col,
                    amount: anim.amount
                });
            } else {
                animateDamageFallback(anim);
                return Promise.resolve();
            }
        }

        if (anim.type === 'death') {
            animateDeath(anim);
            return Promise.resolve();
        }

        if (anim.type === 'deathTransform') {
            return animateDeathTransform(anim);
        }

        return Promise.resolve();
    });

    Promise.all(promises).then(() => {
        console.log('[AnimationBatch] All animations completed');
    });
}
