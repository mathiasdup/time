let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;

const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

function initSocket() {
    socket = io();
    
    socket.on('gameStart', (s) => {
        state = s;
        myNum = s.myPlayer;
        setupHeroes();
        document.getElementById('lobby').classList.add('hidden');
        
        // Vérifier si on est en phase mulligan
        if (s.phase === 'mulligan') {
            showMulligan();
        } else {
            startGame();
        }
    });
    
    socket.on('gameStateUpdate', (s) => {
        const wasInDeployPhase = state?.me?.inDeployPhase;
        const wasMulligan = state?.phase === 'mulligan';
        state = s;
        
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
        
        // Message éphémère si on vient de passer en phase de déploiement
        if (!wasInDeployPhase && state.me.inDeployPhase && state.phase === 'planning') {
            showPhaseMessage('🎴 Phase principale', 'deploy');
        }
    });
    
    socket.on('timerUpdate', (t) => { 
        currentTimer = t;
        if(state) state.timeLeft = t;
        updateTimerDisplay(t);
    });
    
    socket.on('phaseChange', (p) => {
        if(state) state.phase = p; 
        updatePhaseDisplay();
        
        // Cacher le timer pendant la résolution
        if (p === 'resolution') {
            document.getElementById('header-timer').classList.remove('visible', 'urgent');
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
            document.getElementById('end-turn-btn').classList.add('waiting');
        } else {
            oppReady = true;
        }
        log(isMe ? 'Vous êtes prêt' : 'Adversaire prêt', 'action');
        
        // Cacher le timer si les deux joueurs sont prêts
        if (meReady && oppReady) {
            document.getElementById('header-timer').classList.remove('visible', 'urgent');
        }
    });
    
    socket.on('newTurn', (d) => {
        currentTimer = 90;
        meReady = false;
        oppReady = false;
        document.getElementById('end-turn-btn').classList.remove('waiting');
        clearSel();
        updateTimerDisplay(90);
        log(`🎮 Tour ${d.turn} — ⚡${d.maxEnergy} énergie`, 'phase');
        
        // Message éphémère de phase - seulement s'il y a des créatures à repositionner
        if (hasCreaturesOnMyField()) {
            showPhaseMessage('🔄 Phase de repositionnement', 'redeploy');
        }
    });
    
    socket.on('resolutionLog', (d) => log(d.msg, d.type));
    
    socket.on('directDamage', (d) => {
        const heroEl = document.getElementById(d.defender === myNum ? 'hero-me' : 'hero-opp');
        heroEl.classList.add('hit');
        setTimeout(() => heroEl.classList.remove('hit'), 500);
    });
    
    socket.on('animation', handleAnimation);
    
    // Bloquer les slots qui vont recevoir des créatures (avant le state)
    socket.on('blockSlots', (slots) => {
        slots.forEach(s => {
            // Bloquer seulement les créatures adverses
            if (s.player !== myNum) {
                const owner = 'opp';
                const slotKey = `${owner}-${s.row}-${s.col}`;
                animatingSlots.add(slotKey);
                
                // Vider le slot au cas où
                const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${s.row}"][data-col="${s.col}"]`);
                if (slot) {
                    const label = slot.querySelector('.slot-label');
                    slot.innerHTML = '';
                    if (label) slot.appendChild(label.cloneNode(true));
                    slot.classList.remove('has-card');
                }
            }
        });
    });
    
    // Highlight des cases pour les sorts
    socket.on('spellHighlight', (data) => {
        data.targets.forEach(t => {
            const owner = t.player === myNum ? 'me' : 'opp';
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${t.row}"][data-col="${t.col}"]`);
            if (slot) {
                slot.classList.add('spell-highlight-' + data.type);
                setTimeout(() => slot.classList.remove('spell-highlight-' + data.type), 1500);
            }
        });
    });
    
    socket.on('gameOver', (d) => {
        const won = d.winner === myNum;
        document.getElementById('result').textContent = won ? '🎉 Victoire !' : '😢 Défaite';
        document.getElementById('result').className = 'game-over-result ' + (won ? 'victory' : 'defeat');
        document.getElementById('game-over').classList.remove('hidden');
    });
    
    socket.on('playerDisconnected', () => log('⚠️ Adversaire déconnecté', 'damage'));
}

function handleAnimation(data) {
    const { type } = data;
    switch(type) {
        case 'attack': animateAttack(data); break;
        case 'damage': animateDamage(data); break;
        case 'death': animateDeath(data); break;
        case 'spell': animateSpell(data); break;
        case 'spellMiss': animateSpellMiss(data); break;
        case 'heal': animateHeal(data); break;
        case 'buff': animateBuff(data); break;
        case 'trapTrigger': animateTrap(data); break;
        case 'summon': animateSummon(data); break;
        case 'move': animateMove(data); break;
        case 'heroHit':
            const heroEl = document.getElementById(data.defender === myNum ? 'hero-me' : 'hero-opp');
            heroEl.classList.add('hit');
            setTimeout(() => heroEl.classList.remove('hit'), 500);
            break;
    }
}

function animateBuff(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const indicator = document.createElement('div');
        indicator.className = 'buff-indicator';
        indicator.textContent = `+${data.atk}/+${data.hp}`;
        indicator.style.left = rect.left + rect.width/2 + 'px';
        indicator.style.top = rect.top + rect.height/2 + 'px';
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 1000);
    }
}

function animateAttack(data) {
    const owner = data.attacker === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (card) {
        card.classList.add('attacking');
        setTimeout(() => card.classList.remove('attacking'), 400);
    }
    
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const projectile = document.createElement('div');
        projectile.className = 'attack-projectile';
        projectile.textContent = data.isShooter ? '🏹' : data.isFlying ? '💨' : '⚔️';
        projectile.style.left = rect.left + rect.width/2 + 'px';
        projectile.style.top = rect.top + rect.height/2 + 'px';
        document.body.appendChild(projectile);
        
        const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
        let targetX, targetY;
        
        if (data.targetCol === -1) {
            const heroEl = document.getElementById(targetOwner === 'me' ? 'hero-me' : 'hero-opp');
            const heroRect = heroEl.getBoundingClientRect();
            targetX = heroRect.left + heroRect.width/2;
            targetY = heroRect.top + heroRect.height/2;
        } else {
            const targetSlot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${data.targetRow}"][data-col="${data.targetCol}"]`);
            if (targetSlot) {
                const targetRect = targetSlot.getBoundingClientRect();
                targetX = targetRect.left + targetRect.width/2;
                targetY = targetRect.top + targetRect.height/2;
            }
        }
        
        if (targetX && targetY) {
            setTimeout(() => {
                projectile.style.left = targetX + 'px';
                projectile.style.top = targetY + 'px';
                projectile.style.transform = 'scale(1.5)';
            }, 50);
        }
        setTimeout(() => projectile.remove(), 350);
    }
}

function animateDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (card) {
        card.classList.add('taking-damage');
        setTimeout(() => card.classList.remove('taking-damage'), 400);
    }
    
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const num = document.createElement('div');
        num.className = 'damage-number';
        num.textContent = `-${data.amount}`;
        num.style.left = rect.left + rect.width/2 - 20 + 'px';
        num.style.top = rect.top + 'px';
        document.body.appendChild(num);
        setTimeout(() => num.remove(), 1000);
    }
}

function animateDeath(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (card) card.classList.add('dying');
}

function animateSpell(data) {
    // Afficher la carte du sort
    if (data.spell) {
        showCardShowcase(data.spell);
    }
    
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const effect = document.createElement('div');
        effect.className = 'spell-effect';
        effect.textContent = data.spell.icon || '✨';
        effect.style.left = rect.left + rect.width/2 - 30 + 'px';
        effect.style.top = rect.top + rect.height/2 - 30 + 'px';
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 600);
    }
}

function animateSpellMiss(data) {
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const effect = document.createElement('div');
        effect.className = 'spell-miss';
        effect.textContent = '💨';
        effect.style.left = rect.left + rect.width/2 - 20 + 'px';
        effect.style.top = rect.top + rect.height/2 - 20 + 'px';
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 800);
    }
}

function animateHeal(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (card) {
        card.classList.add('healing');
        setTimeout(() => card.classList.remove('healing'), 500);
    }
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const num = document.createElement('div');
        num.className = 'damage-number heal';
        num.textContent = `+${data.amount}`;
        num.style.left = rect.left + rect.width/2 - 20 + 'px';
        num.style.top = rect.top + 'px';
        document.body.appendChild(num);
        setTimeout(() => num.remove(), 1000);
    }
}

function animateTrap(data) {
    // Afficher la carte du piège
    if (data.trap) {
        showCardShowcase(data.trap);
    }
    
    const owner = data.player === myNum ? 'me' : 'opp';
    const trapSlot = document.querySelector(`.trap-slot[data-owner="${owner}"][data-row="${data.row}"]`);
    if (trapSlot) {
        trapSlot.classList.add('triggered');
        const rect = trapSlot.getBoundingClientRect();
        const effect = document.createElement('div');
        effect.className = 'spell-effect';
        effect.textContent = '💥';
        effect.style.left = rect.left + rect.width/2 - 30 + 'px';
        effect.style.top = rect.top + rect.height/2 - 30 + 'px';
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 600);
        setTimeout(() => trapSlot.classList.remove('triggered'), 600);
    }
}

// Slots en cours d'animation - render() ne doit pas les toucher
let animatingSlots = new Set();

// Animation d'invocation - overlay indépendant du render
function animateSummon(data) {
    // N'animer que les créatures de l'adversaire (pas les nôtres)
    if (data.animateForOpponent && data.player === myNum) {
        return; // Notre carte est déjà visible, pas besoin d'animation
    }
    
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    
    // Le slot devrait déjà être bloqué par blockSlots, mais on s'assure
    animatingSlots.add(slotKey);
    
    // Trouver le slot cible
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;
    
    // Vider le slot (au cas où)
    const label = slot.querySelector('.slot-label');
    slot.innerHTML = '';
    if (label) slot.appendChild(label.cloneNode(true));
    slot.classList.remove('has-card');
    
    const rect = slot.getBoundingClientRect();
    
    // Créer une carte overlay en position fixe
    const cardEl = makeCard(data.card, false);
    cardEl.style.position = 'fixed';
    cardEl.style.left = rect.left + 'px';
    cardEl.style.top = rect.top + 'px';
    cardEl.style.width = rect.width + 'px';
    cardEl.style.height = rect.height + 'px';
    cardEl.style.zIndex = '2000';
    cardEl.style.pointerEvents = 'none';
    cardEl.classList.add('summon-overlay');
    
    document.body.appendChild(cardEl);
    
    // Après l'animation pop (550ms)
    setTimeout(() => {
        // Retirer l'overlay
        cardEl.remove();
        
        // Libérer le slot - render() pourra le mettre à jour
        animatingSlots.delete(slotKey);
        
        // Forcer un render pour afficher la carte du state
        render();
    }, 550);
}

function animateMove(data) {
    // N'animer que les déplacements de l'adversaire (pas les nôtres)
    if (data.player === myNum) {
        return; // Nos cartes sont déjà à leur nouvelle position
    }
    
    const owner = 'opp';
    
    // Bloquer les deux slots (origine et destination)
    const fromKey = `${owner}-${data.fromRow}-${data.fromCol}`;
    const toKey = `${owner}-${data.toRow}-${data.toCol}`;
    animatingSlots.add(fromKey);
    animatingSlots.add(toKey);
    
    const fromSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.fromRow}"][data-col="${data.fromCol}"]`);
    const toSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.toRow}"][data-col="${data.toCol}"]`);
    
    if (!fromSlot || !toSlot) return;
    
    // Vider le slot d'origine immédiatement
    const label = fromSlot.querySelector('.slot-label');
    fromSlot.innerHTML = '';
    if (label) fromSlot.appendChild(label.cloneNode(true));
    fromSlot.classList.remove('has-card');
    
    // Récupérer les positions
    const fromRect = fromSlot.getBoundingClientRect();
    const toRect = toSlot.getBoundingClientRect();
    
    // Créer une carte pour l'animation
    const movingCard = makeCard(data.card, false);
    movingCard.classList.add('card-moving');
    movingCard.style.left = fromRect.left + 'px';
    movingCard.style.top = fromRect.top + 'px';
    movingCard.style.width = fromRect.width + 'px';
    movingCard.style.height = fromRect.height + 'px';
    
    document.body.appendChild(movingCard);
    
    // Animer vers la destination
    requestAnimationFrame(() => {
        movingCard.style.left = toRect.left + 'px';
        movingCard.style.top = toRect.top + 'px';
    });
    
    // Nettoyer après l'animation
    setTimeout(() => {
        movingCard.remove();
        animatingSlots.delete(fromKey);
        animatingSlots.delete(toKey);
        render();
    }, 550);
}

// Afficher une carte à l'écran (pour sorts et pièges)
function showCardShowcase(card) {
    const cardEl = makeCard(card, false);
    cardEl.classList.add('card-showcase');
    document.body.appendChild(cardEl);
    
    setTimeout(() => {
        cardEl.remove();
    }, 1500);
}

function canPlay() {
    if (!state) return false;
    if (state.phase !== 'planning') return false;
    if (state.me.ready) return false;
    return true;
}

function updateTimerDisplay(t) {
    const timerEl = document.getElementById('header-timer');
    const endTurnBtn = document.getElementById('end-turn-btn');
    
    if (t > 0 && t <= 15 && state && state.phase === 'planning') {
        timerEl.classList.add('visible');
        timerEl.textContent = t;
        timerEl.classList.toggle('urgent', t <= 5);
    } else {
        // À 0 ou hors phase planning, cacher le timer
        timerEl.classList.remove('visible', 'urgent');
        
        // À 0, griser immédiatement le bouton comme si on avait cliqué
        if (t <= 0 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
            endTurnBtn.classList.add('waiting');
        }
    }
}

let phaseMessageTimeout = null;
let phaseMessageFadeTimeout = null;

function showPhaseMessage(text, type) {
    const el = document.getElementById('phase-indicator');
    
    // Clear les timeouts précédents
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);
    
    el.textContent = text;
    el.className = 'phase-indicator ' + type + ' visible';
    
    // Marquer qu'un message est en cours d'affichage
    el.dataset.showing = 'true';
    
    // Message éphémère sauf pour resolution
    if (type !== 'resolution') {
        phaseMessageTimeout = setTimeout(() => {
            el.classList.add('fade-out');
            phaseMessageFadeTimeout = setTimeout(() => {
                el.classList.remove('visible');
                el.dataset.showing = 'false';
            }, 500);
        }, 2000);
    }
}

function hidePhaseMessage() {
    const el = document.getElementById('phase-indicator');
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);
    el.classList.add('fade-out');
    phaseMessageFadeTimeout = setTimeout(() => {
        el.classList.remove('visible');
        el.dataset.showing = 'false';
    }, 500);
}

function updatePhaseDisplay() {
    if (!state) return;
    
    // Ne pas masquer si un message est en cours d'affichage (avec son propre timeout)
    const el = document.getElementById('phase-indicator');
    if (el.dataset.showing === 'true') return;
    
    // Ne pas afficher de message ici - le serveur envoie les messages de sous-phases
    if (state.phase !== 'resolution') {
        hidePhaseMessage();
    }
}

// ==================== MULLIGAN ====================
let mulliganTimer = null;

function showMulligan() {
    const overlay = document.getElementById('mulligan-overlay');
    const handContainer = document.getElementById('mulligan-hand');
    
    overlay.classList.remove('hidden');
    handContainer.innerHTML = '';
    
    // Afficher les cartes de la main (makeCard retourne un élément DOM)
    state.me.hand.forEach(card => {
        const cardEl = makeCard(card, true);
        handContainer.appendChild(cardEl);
    });
    
    // Démarrer le timer de 15 secondes
    startMulliganTimer();
}

function startMulliganTimer() {
    let timeLeft = 15;
    const timerEl = document.getElementById('mulligan-timer');
    timerEl.textContent = timeLeft;
    timerEl.classList.add('visible');
    
    mulliganTimer = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft;
        timerEl.classList.toggle('urgent', timeLeft <= 5);
        
        if (timeLeft <= 0) {
            clearInterval(mulliganTimer);
            // Auto-keep si le temps est écoulé
            if (!mulliganDone) {
                keepHand();
            }
        }
    }, 1000);
}

function startGame() {
    // Arrêter le timer mulligan si actif
    if (mulliganTimer) {
        clearInterval(mulliganTimer);
        mulliganTimer = null;
    }
    
    document.getElementById('mulligan-overlay').classList.add('hidden');
    document.getElementById('game-container').classList.add('active');
    buildBattlefield();
    render();
    log('🎮 Tour 1 - Partie lancée !', 'phase');
    // Pas de popup "Phase de repositionnement" au tour 1 car pas de créatures
}

// Helper pour vérifier si j'ai des créatures sur le terrain
function hasCreaturesOnMyField() {
    if (!state || !state.me || !state.me.field) return false;
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            if (state.me.field[r][c]) return true;
        }
    }
    return false;
}

function keepHand() {
    if (mulliganDone) return;
    mulliganDone = true;
    
    document.getElementById('mulligan-buttons').classList.add('hidden');
    document.getElementById('mulligan-waiting').classList.remove('hidden');
    document.getElementById('mulligan-timer').classList.remove('visible');
    
    socket.emit('keepHand');
}

function doMulligan() {
    if (mulliganDone) return;
    mulliganDone = true;
    
    document.getElementById('mulligan-buttons').classList.add('hidden');
    document.getElementById('mulligan-waiting').classList.remove('hidden');
    document.getElementById('mulligan-timer').classList.remove('visible');
    
    socket.emit('mulligan');
}

function setupHeroes() {
    document.getElementById('me-name').textContent = state.me.heroName;
    document.getElementById('opp-name').textContent = state.opponent.heroName;
    document.getElementById('me-hero-name').textContent = state.me.heroName;
    document.getElementById('opp-hero-name').textContent = state.opponent.heroName;
    document.getElementById('me-icon').textContent = myNum === 1 ? '🧙‍♂️' : '⚔️';
    document.getElementById('opp-icon').textContent = myNum === 1 ? '⚔️' : '🧙‍♂️';
}

function createRoom() {
    socket.emit('createRoom', (r) => {
        if (r.success) {
            myNum = r.playerNum;
            document.getElementById('room-code-display').textContent = r.code;
            document.getElementById('lobby-menu').classList.add('hidden');
            document.getElementById('lobby-waiting').classList.remove('hidden');
        }
    });
}

function joinRoom() {
    const code = document.getElementById('room-code-input').value.trim();
    if (!code) return;
    socket.emit('joinRoom', code, (r) => {
        if (r.success) myNum = r.playerNum;
        else alert(r.error);
    });
}

function buildBattlefield() {
    const bf = document.getElementById('battlefield');
    bf.innerHTML = '<div class="global-spell-zone" id="global-spell-zone"></div>';
    
    const myField = document.createElement('div');
    myField.className = 'field-side';
    for (let row = 0; row < 4; row++) {
        myField.appendChild(makeSlot('me', row, 0));
        myField.appendChild(makeSlot('me', row, 1));
    }
    bf.appendChild(myField);
    
    const trapCenter = document.createElement('div');
    trapCenter.className = 'trap-center';
    
    const myTraps = document.createElement('div');
    myTraps.className = 'trap-col';
    for (let i = 0; i < 4; i++) myTraps.appendChild(makeTrapSlot('me', i));
    
    const oppTraps = document.createElement('div');
    oppTraps.className = 'trap-col';
    for (let i = 0; i < 4; i++) oppTraps.appendChild(makeTrapSlot('opp', i));
    
    trapCenter.appendChild(myTraps);
    trapCenter.appendChild(oppTraps);
    bf.appendChild(trapCenter);
    
    const oppField = document.createElement('div');
    oppField.className = 'field-side';
    for (let row = 0; row < 4; row++) {
        oppField.appendChild(makeSlot('opp', row, 1));
        oppField.appendChild(makeSlot('opp', row, 0));
    }
    bf.appendChild(oppField);
    
    // Setup global spell zone handlers
    const globalZone = document.getElementById('global-spell-zone');
    globalZone.ondragover = (e) => {
        e.preventDefault();
        if (globalZone.classList.contains('active')) {
            globalZone.style.borderColor = 'rgba(46, 204, 113, 1)';
            globalZone.style.background = 'rgba(46, 204, 113, 0.2)';
        }
    };
    globalZone.ondragleave = () => {
        globalZone.style.borderColor = '';
        globalZone.style.background = '';
    };
    globalZone.ondrop = (e) => {
        e.preventDefault();
        globalZone.style.borderColor = '';
        globalZone.style.background = '';
        
        if (dragged && dragged.type === 'spell' && ['global', 'all', 'hero'].includes(dragged.pattern)) {
            if (dragged.tooExpensive) {
                dragged.triedToDrop = true;
            } else {
                socket.emit('castGlobalSpell', { handIndex: dragged.idx });
            }
        }
        clearSel();
    };
}

function makeSlot(owner, row, col) {
    const el = document.createElement('div');
    const suffix = owner === 'me' ? '1' : '2';
    const label = SLOT_NAMES[row][col] + suffix;
    
    el.className = `card-slot ${owner}-slot`;
    el.dataset.owner = owner;
    el.dataset.row = row;
    el.dataset.col = col;
    el.innerHTML = `<span class="slot-label">${label}</span>`;
    
    el.onclick = () => clickSlot(owner, row, col);
    
    // Prévisualisation du sort croix au survol
    el.onmouseenter = () => {
        if (selected && selected.fromHand && selected.type === 'spell' && selected.pattern === 'cross') {
            if (el.classList.contains('valid-target')) {
                previewCrossTargets(owner, row, col);
            }
        }
    };
    el.onmouseleave = () => {
        document.querySelectorAll('.card-slot.cross-target').forEach(s => s.classList.remove('cross-target'));
    };
    
    el.ondragover = (e) => { 
        e.preventDefault(); 
        if (el.classList.contains('valid-target') || el.classList.contains('moveable')) {
            el.classList.add('drag-over');
        }
        // Prévisualisation croix au drag
        if (dragged && dragged.type === 'spell' && dragged.pattern === 'cross' && el.classList.contains('valid-target')) {
            previewCrossTargets(owner, row, col);
        }
    };
    el.ondragleave = () => {
        el.classList.remove('drag-over');
        document.querySelectorAll('.card-slot.cross-target').forEach(s => s.classList.remove('cross-target'));
    };
    el.ondrop = (e) => { 
        e.preventDefault(); 
        el.classList.remove('drag-over');
        
        // Drop from field (redeploy)
        if (draggedFromField) {
            if (el.classList.contains('moveable')) {
                socket.emit('moveCard', { 
                    fromRow: draggedFromField.row, 
                    fromCol: draggedFromField.col, 
                    toRow: parseInt(el.dataset.row), 
                    toCol: parseInt(el.dataset.col) 
                });
            }
            clearSel();
            return;
        }
        
        // Drop from hand
        if (el.classList.contains('valid-target')) {
            dropOnSlot(owner, row, col);
        }
    };
    return el;
}

function makeTrapSlot(owner, row) {
    const el = document.createElement('div');
    el.className = 'trap-slot';
    el.dataset.owner = owner;
    el.dataset.row = row;
    el.textContent = 'Piège';
    
    el.onclick = () => clickTrap(owner, row);
    el.ondragover = (e) => { 
        e.preventDefault(); 
        if (el.classList.contains('valid-target')) el.classList.add('drag-over');
    };
    el.ondragleave = () => el.classList.remove('drag-over');
    el.ondrop = (e) => { 
        e.preventDefault(); 
        el.classList.remove('drag-over'); 
        if (el.classList.contains('valid-target')) dropOnTrap(owner, row);
    };
    return el;
}

function canPlaceAt(card, col) {
    if (!card || card.type !== 'creature') return false;
    const shooter = card.abilities?.includes('shooter');
    const fly = card.abilities?.includes('fly');
    if (fly) return true;
    if (shooter) return col === 0;
    return col === 1;
}

function getValidSlots(card) {
    const valid = [];
    if (!card || !state) return valid;
    
    if (card.type === 'creature') {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 2; col++) {
                if (canPlaceAt(card, col) && !state.me.field[row][col]) {
                    valid.push({ row, col });
                }
            }
        }
    } else if (card.type === 'trap') {
        for (let row = 0; row < 4; row++) {
            if (!state.me.traps[row]) valid.push({ trap: true, row });
        }
    } else if (card.type === 'spell') {
        // Sorts globaux : zone spéciale (bordure du battlefield)
        if (['global', 'all', 'hero'].includes(card.pattern)) {
            valid.push({ global: true });
        } else {
            // Sorts ciblés : toutes les cases
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    valid.push({ owner: 'me', row, col });
                    valid.push({ owner: 'opp', row, col });
                }
            }
        }
    }
    return valid;
}

function highlightValidSlots(card, forceShow = false) {
    clearHighlights();
    if (!card) return;
    // Si la carte est trop chère et qu'on ne force pas l'affichage, ne pas highlight
    // Mais si on drag, on veut montrer où ça irait (forceShow via le drag)
    if (card.cost > state.me.energy && !forceShow && !dragged) return;
    
    const valid = getValidSlots(card);
    valid.forEach(v => {
        if (v.global) {
            // Activer la zone globale
            const zone = document.querySelector('.global-spell-zone');
            if (zone) zone.classList.add('active');
        } else if (v.trap) {
            const slot = document.querySelector(`.trap-slot[data-owner="me"][data-row="${v.row}"]`);
            if (slot) slot.classList.add('valid-target');
        } else {
            const owner = v.owner || 'me';
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${v.row}"][data-col="${v.col}"]`);
            if (slot) slot.classList.add('valid-target');
        }
    });
}

// Prévisualiser les cibles du sort croix au survol (centre + adjacents)
function previewCrossTargets(targetOwner, row, col) {
    // Nettoyer les anciennes prévisualisations
    document.querySelectorAll('.card-slot.cross-target').forEach(s => s.classList.remove('cross-target'));
    
    const targetPlayer = targetOwner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
    const adjacents = getCrossTargetsClient(targetPlayer, row, col);
    
    // Le centre est déjà surligné en vert (valid-target), on ajoute les adjacents en orange
    adjacents.forEach(t => {
        const owner = t.player === myNum ? 'me' : 'opp';
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${t.row}"][data-col="${t.col}"]`);
        if (slot) slot.classList.add('cross-target');
    });
}

// Version client de getCrossTargets (cases adjacentes seulement, le centre est la cible principale)
function getCrossTargetsClient(targetPlayer, row, col) {
    const targets = [];
    if (row > 0) targets.push({ row: row - 1, col, player: targetPlayer });
    if (row < 3) targets.push({ row: row + 1, col, player: targetPlayer });
    if (col > 0) targets.push({ row, col: col - 1, player: targetPlayer });
    if (col < 1) targets.push({ row, col: col + 1, player: targetPlayer });
    return targets;
}

function highlightMoveTargets(fromRow, fromCol, card) {
    clearHighlights();
    const isFlying = card.abilities?.includes('fly');
    
    // Déplacements verticaux (toutes les créatures)
    [fromRow - 1, fromRow + 1].forEach(toRow => {
        if (toRow < 0 || toRow > 3) return;
        if (state.me.field[toRow][fromCol]) return;
        const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${toRow}"][data-col="${fromCol}"]`);
        if (slot) slot.classList.add('moveable');
    });
    
    // Déplacements horizontaux (seulement les volants)
    if (isFlying) {
        const toCol = fromCol === 0 ? 1 : 0;
        if (!state.me.field[fromRow][toCol]) {
            const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${fromRow}"][data-col="${toCol}"]`);
            if (slot) slot.classList.add('moveable');
        }
    }
}

function clearHighlights() {
    document.querySelectorAll('.card-slot, .trap-slot').forEach(s => {
        s.classList.remove('valid-target', 'drag-over', 'moveable', 'cross-target');
    });
    const zone = document.querySelector('.global-spell-zone');
    if (zone) zone.classList.remove('active');
}

function render() {
    if (!state) return;
    const me = state.me, opp = state.opponent;
    
    document.getElementById('me-hp').textContent = me.hp;
    document.getElementById('opp-hp').textContent = opp.hp;
    document.getElementById('me-energy').textContent = `${me.energy}/${me.maxEnergy}`;
    document.getElementById('opp-energy').textContent = `${opp.energy}/${opp.maxEnergy}`;
    document.getElementById('me-deck').textContent = me.deckCount;
    document.getElementById('opp-deck').textContent = opp.deckCount;
    document.getElementById('me-grave').textContent = me.graveyardCount || 0;
    document.getElementById('opp-grave').textContent = opp.graveyardCount || 0;
    
    renderField('me', me.field);
    renderField('opp', opp.field);
    renderTraps();
    renderHand(me.hand, me.energy);
    renderOppHand(opp.handCount);
    
    if (me.ready) {
        document.getElementById('end-turn-btn').classList.add('waiting');
    }
}

function renderField(owner, field) {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${r}"][data-col="${c}"]`);
            if (!slot) continue;
            
            // Si ce slot est en cours d'animation, ne pas y toucher
            const slotKey = `${owner}-${r}-${c}`;
            if (animatingSlots.has(slotKey)) continue;
            
            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));
            
            slot.classList.remove('has-card');
            const card = field[r][c];
            
            if (card) {
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);
                
                // Hover preview pour voir la carte en grand
                cardEl.onmouseenter = (e) => showCardPreview(card, e);
                cardEl.onmouseleave = hideCardPreview;
                cardEl.onmousemove = (e) => moveCardPreview(e);
                
                // Drag & drop pour redéploiement (seulement mes cartes)
                if (owner === 'me' && !state.me.inDeployPhase && !card.movedThisTurn) {
                    cardEl.draggable = true;
                    cardEl.ondragstart = (e) => {
                        if (!canPlay()) { e.preventDefault(); return; }
                        draggedFromField = { row: r, col: c, card };
                        cardEl.classList.add('dragging');
                        hideCardPreview();
                        highlightMoveTargets(r, c, card);
                    };
                    cardEl.ondragend = () => {
                        cardEl.classList.remove('dragging');
                        draggedFromField = null;
                        clearHighlights();
                    };
                }
                
                if (owner === 'me') {
                    cardEl.onclick = (e) => { e.stopPropagation(); clickFieldCard(r, c, card); };
                }
                slot.appendChild(cardEl);
            }
        }
    }
}

// Preview flottante d'une carte
let previewEl = null;
function showCardPreview(card, e) {
    hideCardPreview();
    previewEl = makeCard(card, false);
    previewEl.classList.add('card-preview');
    previewEl.style.left = (e.clientX + 20) + 'px';
    previewEl.style.top = (e.clientY - 100) + 'px';
    document.body.appendChild(previewEl);
}
function moveCardPreview(e) {
    if (previewEl) {
        previewEl.style.left = (e.clientX + 20) + 'px';
        previewEl.style.top = Math.max(10, e.clientY - 100) + 'px';
    }
}
function hideCardPreview() {
    if (previewEl) {
        previewEl.remove();
        previewEl = null;
    }
}

function renderTraps() {
    state.me.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="me"][data-row="${i}"]`);
        if (slot) {
            slot.classList.remove('has-trap', 'mine');
            if (trap) {
                slot.classList.add('has-trap', 'mine');
                slot.textContent = '💣';
                
                // Hover preview pour voir le piège posé
                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
                slot.textContent = 'Piège';
                slot.onmouseenter = null;
                slot.onmouseleave = null;
                slot.onmousemove = null;
            }
        }
    });
    
    state.opponent.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="opp"][data-row="${i}"]`);
        if (slot) {
            slot.classList.remove('has-trap', 'mine');
            if (trap) {
                slot.classList.add('has-trap');
                slot.textContent = '❓';
            } else {
                slot.textContent = 'Piège';
            }
        }
    });
}

function renderHand(hand, energy) {
    const panel = document.getElementById('my-hand');
    panel.innerHTML = '';
    hand.forEach((card, i) => {
        const el = makeCard(card, true);
        el.dataset.idx = i;
        el.dataset.cost = card.cost;
        
        // Z-index incrémental pour éviter les saccades au hover
        el.style.zIndex = i + 1;
        
        // Toujours draggable
        el.draggable = true;
        
        el.onclick = (e) => { e.stopPropagation(); selectCard(i); };
        
        el.ondragstart = (e) => {
            if (!canPlay()) { e.preventDefault(); return; }
            
            // Stocker si la carte est trop chère
            const tooExpensive = card.cost > energy;
            
            dragged = { ...card, idx: i, tooExpensive };
            draggedFromField = null;
            el.classList.add('dragging');
            
            // Highlight même si trop cher (pour montrer où ça irait)
            highlightValidSlots(card);
        };
        el.ondragend = (e) => {
            el.classList.remove('dragging');
            
            // Si on a essayé de poser une carte trop chère, faire vibrer
            if (dragged && dragged.tooExpensive && dragged.triedToDrop) {
                el.classList.add('shake');
                setTimeout(() => el.classList.remove('shake'), 400);
            }
            
            dragged = null;
            clearHighlights();
        };
        
        panel.appendChild(el);
    });
}

function renderOppHand(count) {
    const panel = document.getElementById('opp-hand');
    panel.innerHTML = '';
    for (let i = 0; i < Math.min(count, 12); i++) {
        const el = document.createElement('div');
        el.className = 'opp-card-back';
        el.textContent = '🎴';
        el.style.zIndex = i + 1; // Z-index incrémental
        panel.appendChild(el);
    }
}

function makeCard(card, inHand) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    
    if (!inHand && card.type === 'creature') {
        if (card.turnsOnField === 0 && !card.abilities?.includes('haste')) el.classList.add('just-played');
        if (card.canAttack) el.classList.add('can-attack');
    }
    
    const icons = { 
        fly: '🦅', 
        shooter: '🎯', 
        haste: '⚡',
        intangible: '👻',
        trample: '🦏',
        initiative: '🗡️',
        power: '💪'
    };
    const abilities = (card.abilities || []).map(a => icons[a] || '').join(' ');
    const hp = card.currentHp ?? card.hp;
    
    // Classes pour les stats
    let hpClass = '';
    let atkClass = '';
    if (card.type === 'creature') {
        // HP damaged (rouge) ou boosted (vert)
        if (hp < card.hp) {
            hpClass = 'damaged';
        } else if (card.baseHp !== undefined && card.hp > card.baseHp) {
            hpClass = 'boosted';
        }
        // ATK boosted (vert)
        if (card.baseAtk !== undefined && card.atk > card.baseAtk) {
            atkClass = 'boosted';
        }
    }
    
    // Type icon for spells and traps
    let typeIcon = '';
    if (card.type === 'spell') {
        typeIcon = `<div class="card-type-icon spell-icon">✨</div>`;
    } else if (card.type === 'trap') {
        typeIcon = `<div class="card-type-icon trap-icon">🪤</div>`;
    }
    
    // Pattern info for spells
    let patternInfo = '';
    if (card.pattern === 'cross') {
        patternInfo = '<div style="font-size:0.5em;color:#ff9800;">✝️ Zone</div>';
    } else if (card.pattern === 'global' || card.pattern === 'all' || card.pattern === 'hero') {
        patternInfo = '<div style="font-size:0.5em;color:#3498db;">🌍 Global</div>';
    }
    
    el.innerHTML = `
        <div class="card-cost">${card.cost}</div>
        ${typeIcon}
        <div class="card-art">${card.icon || '❓'}</div>
        <div class="card-body">
            <div class="card-name">${card.name}</div>
            <div class="card-abilities">${abilities || (card.type === 'spell' ? (card.offensive ? '⚔️' : '💚') : '')}${patternInfo}</div>
            <div class="card-stats">
                ${card.atk !== undefined ? `<span class="stat stat-atk ${atkClass}">${card.atk}</span>` : ''}
                ${card.damage ? `<span class="stat stat-atk">${card.damage}</span>` : ''}
                ${card.heal ? `<span class="stat stat-hp">${card.heal}</span>` : ''}
                ${card.type === 'creature' ? `<span class="stat stat-hp ${hpClass}">${hp}</span>` : ''}
            </div>
        </div>`;
    return el;
}

function selectCard(i) {
    if (!canPlay()) return;
    const card = state.me.hand[i];
    if (card.cost > state.me.energy) return;
    
    clearSel();
    selected = { ...card, idx: i, fromHand: true };
    document.querySelectorAll('.my-hand .card')[i]?.classList.add('selected');
    highlightValidSlots(card);
}

function clickFieldCard(row, col, card) {
    if (!canPlay()) return;
    if (state.me.inDeployPhase) return;
    if (card.movedThisTurn) return;
    
    clearSel();
    selected = { ...card, fromField: true, row, col };
    
    const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${row}"][data-col="${col}"]`);
    const cardEl = slot?.querySelector('.card');
    if (cardEl) cardEl.classList.add('field-selected');
    
    highlightMoveTargets(row, col, card);
}

function clickSlot(owner, row, col) {
    if (!canPlay()) return;
    
    if (selected && selected.fromHand && selected.type === 'spell') {
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        socket.emit('castSpell', { handIndex: selected.idx, targetPlayer, row, col });
        clearSel();
        return;
    }
    
    if (owner !== 'me') return;
    
    if (selected && selected.fromHand && selected.type === 'creature') {
        if (canPlaceAt(selected, col) && !state.me.field[row][col]) {
            socket.emit('placeCard', { handIndex: selected.idx, row, col });
            clearSel();
        }
        return;
    }
    
    if (selected && selected.fromField) {
        const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${row}"][data-col="${col}"]`);
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
        socket.emit('castSpell', { handIndex: dragged.idx, targetPlayer, row, col });
    } else if (dragged.type === 'creature' && owner === 'me') {
        if (canPlaceAt(dragged, col) && !state.me.field[row][col]) {
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
    document.getElementById('end-turn-btn').classList.add('waiting');
    socket.emit('ready');
}

function openGraveyard(owner) {
    const popup = document.getElementById('graveyard-popup');
    const title = document.getElementById('graveyard-popup-title');
    const container = document.getElementById('graveyard-cards');
    
    const graveyard = owner === 'me' ? state.me.graveyard : state.opponent.graveyard;
    const playerName = owner === 'me' ? state.me.heroName : state.opponent.heroName;
    
    title.textContent = `☠️ Cimetière de ${playerName}`;
    container.innerHTML = '';
    
    if (!graveyard || graveyard.length === 0) {
        container.innerHTML = '<div class="graveyard-empty">Aucune carte au cimetière</div>';
    } else {
        graveyard.forEach(card => {
            const cardEl = makeCard(card, false);
            container.appendChild(cardEl);
        });
    }
    
    popup.classList.add('active');
}

function closeGraveyard() {
    document.getElementById('graveyard-popup').classList.remove('active');
}

// Fermer le popup cimetière en cliquant ailleurs
document.addEventListener('click', (e) => {
    const popup = document.getElementById('graveyard-popup');
    if (popup.classList.contains('active')) {
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

function toggleLog() {
    document.getElementById('log-popup').classList.toggle('active');
}

function log(msg, type = 'action') {
    const el = document.createElement('div');
    el.className = `log-entry log-${type}`;
    el.textContent = msg;
    const c = document.getElementById('log-content');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
}

document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.card') && !e.target.closest('.card-slot') && !e.target.closest('.trap-slot')) {
            clearSel();
        }
    });
});
