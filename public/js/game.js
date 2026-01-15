let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let combatAnimReady = false;

const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

// ==================== SYSTÈME DE FILE D'ATTENTE D'ANIMATIONS ====================
const animationQueue = [];
let isAnimating = false;
const ANIMATION_DELAYS = {
    attack: 600,       // Délai après une attaque
    damage: 500,       // Délai après affichage des dégâts
    death: 600,        // Délai après une mort
    heroHit: 500,      // Délai après dégâts au héros
    default: 300       // Délai par défaut
};

// Initialiser le système d'animation
async function initCombatAnimations() {
    if (typeof CombatAnimations !== 'undefined') {
        try {
            await CombatAnimations.init();
            combatAnimReady = true;
            console.log('✅ Combat animations ready');
        } catch (e) {
            console.warn('Combat animations init error:', e);
            // Le système DOM fonctionne quand même
            combatAnimReady = true;
        }
    } else {
        console.warn('CombatAnimations not found');
        combatAnimReady = false;
    }
}

function queueAnimation(type, data) {
    animationQueue.push({ type, data });
    if (!isAnimating) {
        processAnimationQueue();
    }
}

async function processAnimationQueue() {
    if (animationQueue.length === 0) {
        isAnimating = false;
        return;
    }
    
    isAnimating = true;
    const { type, data } = animationQueue.shift();
    const delay = ANIMATION_DELAYS[type] || ANIMATION_DELAYS.default;
    
    // Exécuter l'animation
    await executeAnimationAsync(type, data);
    
    // Attendre le délai
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Continuer la file
    processAnimationQueue();
}

async function executeAnimationAsync(type, data) {
    // Utiliser le système PixiJS si disponible
    if (combatAnimReady && CombatAnimations) {
        switch(type) {
            case 'attack':
                await handlePixiAttack(data);
                return;
            case 'damage':
                await handlePixiDamage(data);
                return;
            case 'spellDamage':
                await handlePixiSpellDamage(data);
                return;
            case 'heroHit':
                await handlePixiHeroHit(data);
                return;
            case 'death':
                animateDeath(data);
                return;
        }
    }

    // Fallback si PixiJS pas dispo
    switch(type) {
        case 'attack': animateAttackFallback(data); break;
        case 'damage': animateDamageFallback(data); break;
        case 'spellDamage': animateDamageFallback(data); break;
        case 'death': animateDeath(data); break;
        case 'heroHit': animateHeroHitFallback(data); break;
    }
}

async function handlePixiAttack(data) {
    const attackerOwner = data.attacker === myNum ? 'me' : 'opp';
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Cas spécial : Tireur vs Volant (simultané - projectile touche le volant en mouvement)
    if (data.combatType === 'shooter_vs_flyer') {
        await CombatAnimations.animateShooterVsFlyer({
            shooter: { owner: attackerOwner, row: data.row, col: data.col },
            flyer: { owner: targetOwner, row: data.targetRow, col: data.targetCol },
            shooterDamage: data.shooterDamage,
            flyerDamage: data.flyerDamage
        });
        return;
    }

    // Attaques parallèles : deux créatures attaquent des cibles différentes en même temps
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
                isShooter: data.attack1.isShooter
            },
            attack2: {
                attackerOwner: attack2Owner,
                attackerRow: data.attack2.row,
                attackerCol: data.attack2.col,
                targetOwner: attack2TargetOwner,
                targetRow: data.attack2.targetRow,
                targetCol: data.attack2.targetCol,
                damage: data.attack2.damage,
                isShooter: data.attack2.isShooter
            }
        });
        return;
    }

    // Combat mutuel mêlée = les deux se rencontrent au milieu (50/50)
    if (data.combatType === 'mutual_melee' || data.isMutual) {
        await CombatAnimations.animateMutualMelee({
            attacker1: { owner: attackerOwner, row: data.row, col: data.col },
            attacker2: { owner: targetOwner, row: data.targetRow, col: data.targetCol },
            damage1: data.damage1 || data.attackerDamage,
            damage2: data.damage2 || data.targetDamage
        });
        return;
    }

    // Tireur simple = projectile avec griffure à l'impact
    if (data.isShooter || data.combatType === 'shooter') {
        await CombatAnimations.animateProjectile({
            startOwner: attackerOwner,
            startRow: data.row,
            startCol: data.col,
            targetOwner: targetOwner,
            targetRow: data.targetRow,
            targetCol: data.targetCol,
            damage: data.damage
        });
        return;
    }

    // Attaque solo (volant ou mêlée) = charge vers la cible avec griffure
    await CombatAnimations.animateSoloAttack({
        attackerOwner: attackerOwner,
        attackerRow: data.row,
        attackerCol: data.col,
        targetOwner: targetOwner,
        targetRow: data.targetRow,
        targetCol: data.targetCol,
        damage: data.damage,
        isFlying: data.isFlying
    });
}

async function handlePixiDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    
    // Si les griffures ont déjà été affichées par l'animation de combat, skip
    if (data.skipScratch) return;
    
    await CombatAnimations.animateDamage({
        owner: owner,
        row: data.row,
        col: data.col,
        amount: data.amount
    });
}

async function handlePixiHeroHit(data) {
    const owner = data.defender === myNum ? 'me' : 'opp';
    await CombatAnimations.animateHeroHit({
        owner: owner,
        amount: data.damage
    });
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

// ==================== FALLBACK ANIMATIONS ====================

function animateAttackFallback(data) {
    const owner = data.attacker === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (!card) return;
    
    const rect = slot.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    let targetX, targetY;
    
    if (data.targetCol === -1) {
        const heroEl = document.getElementById(targetOwner === 'me' ? 'hero-me' : 'hero-opp');
        const heroRect = heroEl.getBoundingClientRect();
        targetX = heroRect.left + heroRect.width / 2;
        targetY = heroRect.top + heroRect.height / 2;
    } else {
        const targetSlot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${data.targetRow}"][data-col="${data.targetCol}"]`);
        if (targetSlot) {
            const targetRect = targetSlot.getBoundingClientRect();
            targetX = targetRect.left + targetRect.width / 2;
            targetY = targetRect.top + targetRect.height / 2;
        }
    }
    
    if (!targetX || !targetY) return;
    
    const deltaX = data.isMutual ? (targetX - startX) / 2 : (targetX - startX);
    const deltaY = data.isMutual ? (targetY - startY) / 2 : (targetY - startY);
    
    card.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    card.style.zIndex = '1000';
    card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    
    setTimeout(() => {
        card.style.transition = 'transform 0.2s ease-out';
        card.style.transform = '';
        setTimeout(() => {
            card.style.zIndex = '';
            card.style.transition = '';
        }, 200);
    }, 280);
}

function animateDamageFallback(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    
    if (card) {
        card.classList.add('taking-damage');
        setTimeout(() => card.classList.remove('taking-damage'), 400);
    }
}

function animateHeroHitFallback(data) {
    const heroEl = document.getElementById(data.defender === myNum ? 'hero-me' : 'hero-opp');
    if (heroEl) {
        heroEl.classList.add('hit');
        setTimeout(() => heroEl.classList.remove('hit'), 500);
    }
}

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
            showPhaseMessage('Phase principale', 'deploy');
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
        
        // Réinitialiser le bouton pendant la résolution
        if (p === 'resolution') {
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.innerHTML = '<span>FIN DU</span><span>TOUR</span>';
            endTurnBtn.classList.remove('has-timer', 'urgent');
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
            endTurnBtn.innerHTML = '<span>FIN DU</span><span>TOUR</span>';
            endTurnBtn.classList.remove('has-timer', 'urgent');
        } else {
            oppReady = true;
        }
        log(isMe ? 'Vous êtes prêt' : 'Adversaire prêt', 'action');
        
        // Réinitialiser le bouton si les deux joueurs sont prêts
        if (meReady && oppReady) {
            const endTurnBtn = document.getElementById('end-turn-btn');
            endTurnBtn.innerHTML = '<span>FIN DU</span><span>TOUR</span>';
            endTurnBtn.classList.remove('has-timer', 'urgent');
        }
    });
    
    socket.on('newTurn', (d) => {
        currentTimer = 90;
        meReady = false;
        oppReady = false;
        const endTurnBtn = document.getElementById('end-turn-btn');
        endTurnBtn.classList.remove('waiting', 'has-timer', 'urgent');
        endTurnBtn.innerHTML = '<span>FIN DU</span><span>TOUR</span>';
        clearSel();
        log(`🎮 Tour ${d.turn} — ⚡${d.maxEnergy} énergie`, 'phase');
        
        // Message éphémère de phase - seulement s'il y a des créatures à repositionner
        if (hasCreaturesOnMyField()) {
            showPhaseMessage('Phase de repositionnement', 'redeploy');
        }
    });
    
    socket.on('resolutionLog', (d) => log(d.msg, d.type));
    
    socket.on('directDamage', (d) => {
        const heroEl = document.getElementById(d.defender === myNum ? 'hero-me' : 'hero-opp');
        heroEl.classList.add('hit');
        setTimeout(() => heroEl.classList.remove('hit'), 500);
    });
    
    socket.on('animation', handleAnimation);
    
    // Cacher les cartes qui vont être révélées plus tard (pendant les déplacements)
    // Ces cartes sont cachées dans renderField via hiddenCards
    socket.on('hideCards', (cards) => {
        cards.forEach(c => {
            // Cacher les cartes adverses OU les cartes locales si hideLocal est true
            const isOpponent = c.player !== myNum;
            const shouldHide = isOpponent || c.hideLocal;

            if (shouldHide) {
                const owner = c.player === myNum ? 'me' : 'opp';
                const cardKey = `${owner}-${c.row}-${c.col}`;
                hiddenCards.add(cardKey);
            }
        });
    });

    // Révéler une carte spécifique (appelé juste avant l'animation summon)
    socket.on('revealCard', (c) => {
        const owner = c.player === myNum ? 'me' : 'opp';
        const cardKey = `${owner}-${c.row}-${c.col}`;
        hiddenCards.delete(cardKey);
    });
    
    // Highlight des cases pour les sorts
    socket.on('spellHighlight', (data) => {
        data.targets.forEach((t, index) => {
            const owner = t.player === myNum ? 'me' : 'opp';
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${t.row}"][data-col="${t.col}"]`);
            if (slot) {
                slot.classList.add('spell-highlight-' + data.type);
                
                // Si sort de dégâts, ajouter animation de flamme
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
                    }, index * 100); // Décalage pour effet cascade
                }
                
                // Si la case contient une carte, ajouter une classe à la carte aussi
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
}

function handleAnimation(data) {
    const { type } = data;
    
    // Les animations de combat utilisent la file d'attente
    const queuedTypes = ['attack', 'damage', 'spellDamage', 'death', 'heroHit'];
    
    if (queuedTypes.includes(type)) {
        queueAnimation(type, data);
    } else {
        // Les autres animations s'exécutent immédiatement
        switch(type) {
            case 'spell': animateSpell(data); break;
            case 'spellMiss': animateSpellMiss(data); break;
            case 'heal': animateHeal(data); break;
            case 'buff': animateBuff(data); break;
            case 'trapTrigger': animateTrap(data); break;
            case 'summon': animateSummon(data); break;
            case 'move': animateMove(data); break;
            case 'draw': 
                if (typeof GameAnimations !== 'undefined') {
                    GameAnimations.prepareDrawAnimation(data);
                }
                break;
        }
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

// Les fonctions animateAttack et animateDamage sont maintenant gérées par le système PixiJS
// Voir combat-animations.js et les fonctions handlePixiAttack/handlePixiDamage ci-dessus

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

// Cartes cachées en attente de révélation (pendant la phase de déplacement)
let hiddenCards = new Set();

// Animation de lévitation continue pour les créatures volantes
// Utilise le temps global pour que l'animation reste synchronisée même après re-render
const flyingAnimationSpeed = 0.002; // Vitesse de l'oscillation
const flyingAnimationAmplitude = 4; // Amplitude en pixels

function startFlyingAnimation(cardEl) {
    // Marquer la carte comme ayant une animation de vol active
    cardEl.dataset.flyingAnimation = 'true';

    function animate() {
        // Stop si la carte n'est plus dans le DOM
        if (!cardEl.isConnected) return;

        // Stop si la carte est en train d'attaquer (l'animation de combat prend le dessus)
        if (cardEl.dataset.inCombat === 'true') {
            requestAnimationFrame(animate); // Continue à vérifier pour reprendre après
            return;
        }

        const time = performance.now() * flyingAnimationSpeed;
        const offset = Math.sin(time) * flyingAnimationAmplitude;
        cardEl.style.transform = `translateY(${offset}px)`;

        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}

// Animation d'invocation - overlay indépendant du render
// La carte "tombe" sur le plateau avec un effet de rebond
function animateSummon(data) {
    // N'animer que les créatures de l'adversaire (pas les nôtres)
    // SAUF si animateForLocal est true (cas où on déplace puis place sur le même slot)
    if (data.animateForOpponent && data.player === myNum && !data.animateForLocal) {
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
    cardEl.style.width = rect.width + 'px';
    cardEl.style.height = rect.height + 'px';
    cardEl.style.zIndex = '2000';
    cardEl.style.pointerEvents = 'none';

    // Position de départ : au-dessus de l'écran
    cardEl.style.top = '-150px';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.8) rotateX(30deg)';
    cardEl.classList.add('summon-drop');

    document.body.appendChild(cardEl);

    // Déclencher l'animation de chute
    requestAnimationFrame(() => {
        cardEl.style.transition = 'top 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        cardEl.style.top = rect.top + 'px';
        cardEl.style.opacity = '1';
        cardEl.style.transform = 'scale(1) rotateX(0deg)';
    });

    // Après l'animation de chute (550ms)
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

    // Vider les DEUX slots immédiatement (pour éviter le doublon visuel)
    const labelFrom = fromSlot.querySelector('.slot-label');
    fromSlot.innerHTML = '';
    if (labelFrom) fromSlot.appendChild(labelFrom.cloneNode(true));
    fromSlot.classList.remove('has-card');

    const labelTo = toSlot.querySelector('.slot-label');
    toSlot.innerHTML = '';
    if (labelTo) toSlot.appendChild(labelTo.cloneNode(true));
    toSlot.classList.remove('has-card');

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
    const endTurnBtn = document.getElementById('end-turn-btn');
    
    if (t > 0 && t <= 15 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
        // Afficher le compteur dans le bouton
        endTurnBtn.innerHTML = `<span class="btn-timer">${t}</span>`;
        endTurnBtn.classList.add('has-timer');
        endTurnBtn.classList.toggle('urgent', t <= 5);
    } else {
        // Remettre "FIN DU TOUR"
        if (endTurnBtn.classList.contains('has-timer') || endTurnBtn.innerHTML.includes('btn-timer')) {
            endTurnBtn.innerHTML = '<span>FIN DU</span><span>TOUR</span>';
            endTurnBtn.classList.remove('has-timer', 'urgent');
        }
        
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
    const meIcon = myNum === 1 ? '🧙‍♂️' : '⚔️';
    const oppIcon = myNum === 1 ? '⚔️' : '🧙‍♂️';
    document.getElementById('me-icon').textContent = meIcon;
    document.getElementById('opp-icon').textContent = oppIcon;
    
    // Preview au survol des héros
    const heroMe = document.getElementById('hero-me');
    const heroOpp = document.getElementById('hero-opp');
    
    heroMe.onmouseenter = () => showHeroPreview(state.me.heroName, meIcon, state.me.hp);
    heroMe.onmouseleave = hideCardPreview;
    
    heroOpp.onmouseenter = () => showHeroPreview(state.opponent.heroName, oppIcon, state.opponent.hp);
    heroOpp.onmouseleave = hideCardPreview;
    
    // Drag/drop sur les héros pour les sorts
    setupHeroDragDrop(heroMe, 'me');
    setupHeroDragDrop(heroOpp, 'opp');
    
    // Stocker les icônes pour réutilisation
    window.heroIcons = { me: meIcon, opp: oppIcon };
}

function setupHeroDragDrop(heroEl, owner) {
    // Fonction pour vérifier si le sort peut cibler ce héros
    const canTargetThisHero = (spell) => {
        if (!spell || spell.type !== 'spell') return false;
        if (spell.pattern === 'hero') {
            if (spell.targetEnemy && owner === 'me') return false; // Frappe directe = adversaire seulement
            if (spell.targetSelf && owner === 'opp') return false; // Cristal de mana = soi-même seulement
            return true;
        }
        if (spell.canTargetHero) return true;
        return false;
    };
    
    heroEl.ondragover = (e) => {
        e.preventDefault();
        if (!dragged || !canTargetThisHero(dragged)) return;
        heroEl.classList.add('hero-drag-over');
    };
    
    heroEl.ondragleave = () => {
        heroEl.classList.remove('hero-drag-over');
    };
    
    heroEl.ondrop = (e) => {
        e.preventDefault();
        heroEl.classList.remove('hero-drag-over');
        
        if (!dragged || !canTargetThisHero(dragged)) return;
        if (!canPlay()) return;
        if (dragged.cost > state.me.energy) {
            dragged.triedToDrop = true;
            return;
        }
        
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        
        // Envoyer le sort sur le héros (row = -1 pour indiquer un héros)
        socket.emit('castSpell', { 
            idx: dragged.idx, 
            targetPlayer: targetPlayer, 
            row: -1, 
            col: -1 
        });
        
        clearSel();
        dragged = null;
    };
    
    // Click pour lancer le sort sélectionné
    heroEl.onclick = (e) => {
        if (!selected || !selected.fromHand || !canTargetThisHero(selected)) return;
        if (!canPlay()) return;
        if (selected.cost > state.me.energy) return;
        
        e.stopPropagation();
        
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        
        socket.emit('castSpell', { 
            idx: selected.idx, 
            targetPlayer: targetPlayer, 
            row: -1, 
            col: -1 
        });
        
        clearSel();
    };
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
        
        // Les sorts 'hero' ne passent plus par ici, ils ciblent les héros directement
        if (dragged && dragged.type === 'spell' && ['global', 'all'].includes(dragged.pattern)) {
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
        // Sorts globaux
        if (card.pattern === 'global' || card.pattern === 'all') {
            valid.push({ global: true });
        } 
        // Sorts qui ciblent un héros
        else if (card.pattern === 'hero') {
            // targetEnemy = seulement héros adverse (ex: Frappe directe)
            // targetSelf = seulement notre héros (ex: Cristal de mana)
            // sinon = les deux héros (ex: Inspiration)
            if (card.targetEnemy) {
                valid.push({ hero: true, owner: 'opp' });
            } else if (card.targetSelf) {
                valid.push({ hero: true, owner: 'me' });
            } else {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
            }
        } 
        // Sorts ciblés normaux
        else {
            // Toutes les cases créatures
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    valid.push({ owner: 'me', row, col });
                    valid.push({ owner: 'opp', row, col });
                }
            }
            // Si le sort peut aussi cibler les héros
            if (card.canTargetHero) {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
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
        } else if (v.hero) {
            // Highlight le héros ciblable
            const heroId = v.owner === 'me' ? 'hero-me' : 'hero-opp';
            const hero = document.getElementById(heroId);
            if (hero) hero.classList.add('hero-targetable');
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
    // Enlever le highlight des héros
    document.querySelectorAll('.hero-card').forEach(h => {
        h.classList.remove('hero-targetable', 'hero-drag-over');
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
    
    // Afficher/cacher le contenu du deck selon le nombre de cartes
    updateDeckDisplay('me', me.deckCount);
    updateDeckDisplay('opp', opp.deckCount);
    
    // Afficher la dernière carte du cimetière
    updateGraveTopCard('me', me.graveyard);
    updateGraveTopCard('opp', opp.graveyard);
    
    // Mettre à jour l'affichage de la pile du cimetière
    updateGraveDisplay('me', me.graveyard);
    updateGraveDisplay('opp', opp.graveyard);
    
    renderField('me', me.field);
    renderField('opp', opp.field);
    renderTraps();
    renderHand(me.hand, me.energy);
    renderOppHand(opp.handCount);
    
    // Lancer les animations de pioche après les renders
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.startPendingDrawAnimations();
    }
    
    if (me.ready) {
        document.getElementById('end-turn-btn').classList.add('waiting');
    }
}

function updateDeckDisplay(owner, deckCount) {
    const stack = document.getElementById(`${owner}-deck-stack`);
    if (!stack) return;
    
    // Gérer l'état vide
    if (deckCount <= 0) {
        stack.classList.add('empty');
    } else {
        stack.classList.remove('empty');
    }
    
    // Ajuster le nombre de couches visibles selon le nombre de cartes
    const layers = stack.querySelectorAll('.deck-card-layer');
    const visibleLayers = Math.min(5, Math.ceil(deckCount / 8)); // 1 couche par 8 cartes, max 5
    
    layers.forEach((layer, i) => {
        if (i < visibleLayers) {
            layer.style.display = 'block';
        } else {
            layer.style.display = 'none';
        }
    });
}

function updateGraveDisplay(owner, graveyard) {
    const stack = document.getElementById(`${owner}-grave-stack`);
    if (!stack) return;
    
    const count = graveyard ? graveyard.length : 0;
    
    // Réinitialiser les classes
    stack.classList.remove('has-cards', 'cards-1', 'cards-2');
    
    if (count > 0) {
        stack.classList.add('has-cards');
        if (count === 1) stack.classList.add('cards-1');
        else if (count === 2) stack.classList.add('cards-2');
    }
}

function updateGraveTopCard(owner, graveyard) {
    const container = document.getElementById(`${owner}-grave-top`);
    if (!container) return;
    
    if (graveyard && graveyard.length > 0) {
        const topCard = graveyard[graveyard.length - 1];
        container.classList.remove('empty');
        
        if (topCard.type === 'creature') {
            container.innerHTML = `
                <div class="mini-card">
                    <div class="card-icon">${topCard.icon || '❓'}</div>
                    <div class="card-name">${topCard.name || 'Inconnu'}</div>
                    <div class="card-stats">
                        <span class="atk">⚔️${topCard.atk}</span>
                        <span class="hp">❤️${topCard.hp}</span>
                    </div>
                </div>
            `;
        } else if (topCard.type === 'spell') {
            container.innerHTML = `
                <div class="mini-card">
                    <div class="card-icon">${topCard.icon || '✨'}</div>
                    <div class="card-name">${topCard.name || 'Sort'}</div>
                    <div class="card-stats">
                        <span style="color:#9b59b6;">🔮 Sort</span>
                    </div>
                </div>
            `;
        } else if (topCard.type === 'trap') {
            container.innerHTML = `
                <div class="mini-card">
                    <div class="card-icon">${topCard.icon || '⚠️'}</div>
                    <div class="card-name">${topCard.name || 'Piège'}</div>
                    <div class="card-stats">
                        <span style="color:#e74c3c;">💥 Piège</span>
                    </div>
                </div>
            `;
        }
    } else {
        container.classList.add('empty');
        container.innerHTML = '';
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
            slot.classList.remove('has-flying');
            const card = field[r][c];

            // Si la carte est cachée (en attente de révélation), ne pas l'afficher
            const cardKey = `${owner}-${r}-${c}`;
            if (hiddenCards.has(cardKey)) {
                continue; // Ne pas afficher cette carte, elle sera révélée plus tard
            }

            if (card) {
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);

                // Ajouter l'effet de lévitation pour les créatures volantes
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    cardEl.classList.add('flying-creature');
                    slot.classList.add('has-flying');
                    // Démarrer l'animation de lévitation continue
                    startFlyingAnimation(cardEl);
                } else {
                    slot.classList.remove('has-flying');
                }

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
// Descriptions des capacités
const ABILITY_DESCRIPTIONS = {
    fly: { name: 'Vol', desc: 'Cette créature peut attaquer n\'importe quel emplacement adverse, pas seulement celui en face.' },
    shooter: { name: 'Tireur', desc: 'Cette créature peut attaquer à distance sans recevoir de riposte.' },
    haste: { name: 'Célérité', desc: 'Cette créature peut attaquer dès le tour où elle est invoquée.' },
    intangible: { name: 'Intangible', desc: 'Cette créature ne peut pas être ciblée par les sorts ou les pièges.' },
    trample: { name: 'Piétinement', desc: 'Les dégâts excédentaires sont infligés au héros adverse.' },
    initiative: { name: 'Initiative', desc: 'Quand cette créature attaque, ses dégâts sont appliqués en priorité. Si la créature adverse est détruite, elle ne peut pas riposter.' },
    power: { name: 'Puissance', desc: 'Quand cette créature subit des dégâts sans mourir, elle gagne +1 ATK.' }
};

function showCardPreview(card, e) {
    hideCardPreview();
    
    // Créer le container
    previewEl = document.createElement('div');
    previewEl.className = 'preview-container card-preview';
    
    // Ajouter la carte
    const cardEl = makeCard(card, false);
    cardEl.classList.add('preview-card');
    previewEl.appendChild(cardEl);
    
    // Container pour capacités + effets
    const infoContainer = document.createElement('div');
    infoContainer.className = 'preview-info-container';
    
    // Ajouter les capacités si c'est une créature avec des abilities
    if (card.type === 'creature' && card.abilities && card.abilities.length > 0) {
        const abilitiesContainer = document.createElement('div');
        abilitiesContainer.className = 'preview-abilities';
        
        card.abilities.forEach(ability => {
            const abilityInfo = ABILITY_DESCRIPTIONS[ability];
            if (abilityInfo) {
                const abilityEl = document.createElement('div');
                abilityEl.className = 'preview-ability';
                abilityEl.innerHTML = `
                    <div class="ability-name">${abilityInfo.name}</div>
                    <div class="ability-desc">${abilityInfo.desc}</div>
                `;
                abilitiesContainer.appendChild(abilityEl);
            }
        });
        
        infoContainer.appendChild(abilitiesContainer);
    }
    
    // Ajouter les effets appliqués (sorts) si présents
    if (card.appliedEffects && card.appliedEffects.length > 0) {
        const effectsContainer = document.createElement('div');
        effectsContainer.className = 'preview-effects';
        
        card.appliedEffects.forEach(effect => {
            const effectEl = document.createElement('div');
            effectEl.className = 'preview-effect';
            effectEl.innerHTML = `
                <div class="effect-name">${effect.name}</div>
                <div class="effect-desc">${effect.description}</div>
            `;
            effectsContainer.appendChild(effectEl);
        });
        
        infoContainer.appendChild(effectsContainer);
    }
    
    if (infoContainer.children.length > 0) {
        previewEl.appendChild(infoContainer);
    }
    
    document.body.appendChild(previewEl);
    requestAnimationFrame(() => {
        previewEl.classList.add('visible');
    });
}

function showCardBackPreview() {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'card-back-preview card-preview';
    previewEl.innerHTML = '<div class="card-back-inner">🎴</div>';
    document.body.appendChild(previewEl);
    requestAnimationFrame(() => {
        previewEl.classList.add('visible');
    });
}

function showHeroPreview(heroName, heroIcon, hp) {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'hero-preview card-preview';
    previewEl.innerHTML = `
        <div class="hero-preview-icon">${heroIcon}</div>
        <div class="hero-preview-name">${heroName}</div>
        <div class="hero-preview-hp">❤️ ${hp}</div>
    `;
    document.body.appendChild(previewEl);
    requestAnimationFrame(() => {
        previewEl.classList.add('visible');
    });
}

function moveCardPreview(e) {
    // Plus besoin de suivre la souris - position fixe
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
                slot.textContent = '';
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
                slot.textContent = '';
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
        
        // Cacher si animation de pioche en attente
        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i)) {
            el.style.visibility = 'hidden';
        }
        
        // Toujours draggable
        el.draggable = true;
        
        // Preview au survol
        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onmouseleave = hideCardPreview;
        
        el.onclick = (e) => { e.stopPropagation(); selectCard(i); };
        
        el.ondragstart = (e) => {
            if (!canPlay()) { e.preventDefault(); return; }
            
            // Stocker si la carte est trop chère
            const tooExpensive = card.cost > energy;
            
            dragged = { ...card, idx: i, tooExpensive };
            draggedFromField = null;
            el.classList.add('dragging');
            hideCardPreview(); // Cacher le preview quand on drag
            
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
        
        // Cacher si animation de pioche en attente
        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i)) {
            el.style.visibility = 'hidden';
        }
        
        // Preview dos de carte au survol
        el.onmouseenter = () => showCardBackPreview();
        el.onmouseleave = hideCardPreview;
        
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
    } else if (card.pattern === 'global' || card.pattern === 'all') {
        patternInfo = '<div style="font-size:0.5em;color:#3498db;">🌍 Global</div>';
    } else if (card.pattern === 'hero') {
        patternInfo = '<div style="font-size:0.5em;color:#e74c3c;">🎯 Héros</div>';
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
    
    title.textContent = `Cimetière de ${playerName}`;
    container.innerHTML = '';
    
    if (!graveyard || graveyard.length === 0) {
        container.innerHTML = '<div class="graveyard-empty">Aucune carte au cimetière</div>';
    } else {
        graveyard.forEach(card => {
            const cardEl = makeCard(card, false);
            // Ajouter le preview au hover
            cardEl.onmouseenter = (e) => showCardPreview(card, e);
            cardEl.onmouseleave = hideCardPreview;
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

function toggleSettings() {
    document.getElementById('settings-popup').classList.toggle('active');
}

function setMusicVolume(val) {
    // TODO: Connecter à un système audio
    console.log('Music volume:', val);
}

function setSfxVolume(val) {
    // TODO: Connecter à un système audio
    console.log('SFX volume:', val);
}

function surrender() {
    socket.emit('surrender');
}

function log(msg, type = 'action') {
    const el = document.createElement('div');
    el.className = `log-entry log-${type}`;
    el.textContent = msg;
    const c = document.getElementById('log-content');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialiser le système d'animation PixiJS
    await initCombatAnimations();
    
    initSocket();
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    document.addEventListener('click', (e) => {
        // Fermer le log si on clique en dehors
        if (!e.target.closest('.log-popup') && !e.target.closest('.log-btn')) {
            document.getElementById('log-popup').classList.remove('active');
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
});