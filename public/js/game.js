let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let combatAnimReady = false;

const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

// ==================== SYSTÈME DE FILE D'ATTENTE D'ANIMATIONS ====================
const animationQueue = [];
let isAnimating = false;
let currentProcessorId = 0; // Pour traquer le processeur actif

// Système de HP différés pour zdejebel (pour que les HP changent APRÈS l'animation)
let pendingHpUpdate = null; // { target: 'me'|'opp', oldHp: number, newHp: number }
let zdejebelAnimationInProgress = false; // Bloque render() pour les HP pendant zdejebel
const ANIMATION_DELAYS = {
    attack: 600,       // Délai après une attaque
    damage: 500,       // Délai après affichage des dégâts
    death: 200,        // Délai après une mort (le gros est dans animateDeathToGraveyard)
    heroHit: 200,      // Délai après dégâts au héros (réduit)
    discard: 800,      // Délai après défausse
    burn: 1000,        // Délai après burn (pioche vers cimetière)
    spell: 200,        // Délai après animation de sort (le gros est dans animateSpellReveal)
    trapTrigger: 500,  // Délai après animation de piège (séparation entre pièges consécutifs)
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

    // Initialiser le renderer de cartes PixiJS
    if (typeof CardRenderer !== 'undefined') {
        try {
            await CardRenderer.init();
            console.log('✅ CardRenderer PixiJS ready');
        } catch (e) {
            console.warn('CardRenderer init error:', e);
        }
    }
}

function queueAnimation(type, data) {
    console.log('[Queue] Adding:', type, 'isAnimating:', isAnimating, 'queueLength:', animationQueue.length, 'currentQueue:', animationQueue.map(a => a.type));

    // Pour zdejebel, capturer les HP actuels AVANT que render() ne les mette à jour
    if (type === 'zdejebel' && state) {
        const target = data.targetPlayer === myNum ? 'me' : 'opp';
        const currentDisplayedHp = target === 'me' ? state.me?.hp : state.opponent?.hp;
        // Stocker les HP actuellement affichés pour les restaurer temporairement
        data._displayHpBefore = currentDisplayedHp;
        console.log('[Queue] Zdejebel: captured HP before =', currentDisplayedHp, 'for', target);
    }

    // Pour burn et death, bloquer le render du cimetière IMMÉDIATEMENT (avant que render() ne l'affiche)
    if (type === 'burn' || type === 'death') {
        const owner = data.player === myNum ? 'me' : 'opp';
        graveRenderBlocked.add(owner);
        console.log('[Queue] Blocked graveyard render for', owner, '(type:', type + ')');
    }

    animationQueue.push({ type, data });
    if (!isAnimating) {
        // Pour les types batchables (burn, death), différer le démarrage
        // pour laisser les events du même batch serveur arriver
        if (type === 'burn' || type === 'death') {
            if (!queueAnimation._batchTimeout) {
                queueAnimation._batchTimeout = setTimeout(() => {
                    queueAnimation._batchTimeout = null;
                    if (!isAnimating && animationQueue.length > 0) {
                        console.log('[Queue] Deferred batch start, queue:', animationQueue.map(a => a.type).join(','));
                        processAnimationQueue();
                    }
                }, 50);
            }
        } else {
            console.log('[Queue] Starting queue processing for:', type);
            processAnimationQueue();
        }
    } else {
        console.log('[Queue] Animation in progress, queued:', type, 'will be processed after current');
    }
}

async function processAnimationQueue(processorId = null) {
    // Générer un ID unique pour ce processeur
    if (processorId === null) {
        currentProcessorId++;
        processorId = currentProcessorId;
    }

    try {
        // Vérifier si un autre processeur a pris le relais
        if (processorId !== currentProcessorId) {
            console.log('[Queue] Processor', processorId, 'stopping - newer processor', currentProcessorId, 'is active');
            return;
        }

        if (animationQueue.length === 0) {
            console.log('[Queue] Empty, stopping. Processor:', processorId);
            isAnimating = false;
            return;
        }

        isAnimating = true;
        console.log('[Queue] Processor', processorId, '- Processing, queueLength:', animationQueue.length, 'items:', animationQueue.map(a => a.type).join(','));

        // Regrouper les animations de mort consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'death') {
            const deathBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'death') {
                deathBatch.push(animationQueue.shift().data);
            }
            const deathPromises = deathBatch.map(data => animateDeathToGraveyard(data));
            await Promise.all(deathPromises);
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.death));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations de burn consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'burn') {
            const burnBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'burn') {
                burnBatch.push(animationQueue.shift().data);
            }
            console.log('[Queue] Burn batch:', burnBatch.length, 'animations');
            const burnPromises = burnBatch.map(data => animateBurn(data));
            await Promise.all(burnPromises);
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations de dégâts de sort consécutives en batch
        if (animationQueue[0].type === 'spellDamage') {
            const spellDamageBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'spellDamage') {
                spellDamageBatch.push(animationQueue.shift().data);
            }
            const promises = spellDamageBatch.map(data => {
                const owner = data.player === myNum ? 'me' : 'opp';
                if (combatAnimReady && CombatAnimations) {
                    return CombatAnimations.animateSpellDamage({
                        owner: owner,
                        row: data.row,
                        col: data.col,
                        amount: data.amount
                    });
                } else {
                    animateDamageFallback(data);
                    return Promise.resolve();
                }
            });
            await Promise.all(promises);
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.damage));
            processAnimationQueue(processorId);
            return;
        }

        const { type, data } = animationQueue.shift();
        const delay = ANIMATION_DELAYS[type] || ANIMATION_DELAYS.default;
        console.log('[Queue] Processor', processorId, '- Shifted:', type, '- remaining:', animationQueue.length);

        // Exécuter l'animation avec timeout de sécurité
        try {
            const animationPromise = executeAnimationAsync(type, data);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Animation timeout: ${type}`)), 5000)
            );
            await Promise.race([animationPromise, timeoutPromise]);
            console.log('[Queue] Processor', processorId, '- Animation completed:', type);
        } catch (e) {
            console.error('[Queue] Animation error:', type, e);
        }

        // Vérifier encore si on est toujours le processeur actif
        if (processorId !== currentProcessorId) {
            console.log('[Queue] Processor', processorId, 'stopping after animation - newer processor active');
            return;
        }

        // Attendre le délai
        await new Promise(resolve => setTimeout(resolve, delay));

        // Continuer la file (avec le même processorId)
        console.log('[Queue] Processor', processorId, '- After delay, remaining:', animationQueue.length);
        processAnimationQueue(processorId);
    } catch (globalError) {
        console.error('[Queue] GLOBAL ERROR in processAnimationQueue:', globalError);
        isAnimating = false;
        if (animationQueue.length > 0) {
            console.log('[Queue] Attempting recovery, remaining:', animationQueue.length);
            setTimeout(() => processAnimationQueue(), 100);
        }
    }
}

async function executeAnimationAsync(type, data) {
    console.log('[executeAnimationAsync] type:', type, 'combatAnimReady:', combatAnimReady);
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
            case 'onDeathDamage':
                await handleOnDeathDamage(data);
                return;
            case 'zdejebel':
                await animateZdejebelDamage(data);
                return;
            case 'death':
                await animateDeathToGraveyard(data);
                return;
            case 'discard':
                await animateDiscard(data);
                return;
            case 'burn':
                await animateBurn(data);
                return;
            case 'spell':
                await animateSpell(data);
                return;
            case 'trapTrigger':
                await animateTrap(data);
                return;
        }
    }

    // Fallback si PixiJS pas dispo
    switch(type) {
        case 'attack': animateAttackFallback(data); break;
        case 'damage': animateDamageFallback(data); break;
        case 'spellDamage': animateDamageFallback(data); break;
        case 'death': await animateDeathToGraveyard(data); break;
        case 'heroHit': animateHeroHitFallback(data); break;
        case 'zdejebel': await animateZdejebelDamage(data); break;
        case 'discard': await animateDiscard(data); break;
        case 'burn': await animateBurn(data); break;
        case 'spell': await animateSpell(data); break;
        case 'trapTrigger': await animateTrap(data); break;
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

    // Combat mutuel tireurs = deux projectiles croisés simultanés
    if (data.combatType === 'mutual_shooters') {
        const owner1 = data.attacker1 === myNum ? 'me' : 'opp';
        const owner2 = data.attacker2 === myNum ? 'me' : 'opp';
        await CombatAnimations.animateMutualShooters({
            shooter1: { owner: owner1, row: data.row1, col: data.col1 },
            shooter2: { owner: owner2, row: data.row2, col: data.col2 },
            damage1: data.damage1,
            damage2: data.damage2
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

async function handleOnDeathDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Afficher un effet visuel spécial pour les dégâts de mort
    const heroZone = document.querySelector(`.hero-zone.${owner}`);
    if (heroZone) {
        // Créer un effet de flamme/explosion sur le héros
        const deathEffect = document.createElement('div');
        deathEffect.className = 'on-death-effect';
        deathEffect.innerHTML = `<span class="death-source">💀 ${data.source}</span>`;
        heroZone.appendChild(deathEffect);

        // Animer l'effet
        setTimeout(() => deathEffect.classList.add('active'), 50);
        setTimeout(() => deathEffect.remove(), 1500);
    }

    // Utiliser l'animation de dégâts sur héros existante
    await CombatAnimations.animateHeroHit({
        owner: owner,
        amount: data.damage
    });
}

async function animateZdejebelDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';
    console.log('[Zdejebel] START - owner:', owner, 'damage:', data.damage, 'timestamp:', Date.now());

    // Bloquer render() pour les HP pendant toute l'animation
    zdejebelAnimationInProgress = true;

    // Restaurer les HP d'avant l'animation (render() les a déjà mis à jour)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const currentHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
    const hpBeforeAnimation = data._displayHpBefore ?? (currentHp + data.damage); // Estimer si pas capturé

    if (hpElement && hpBeforeAnimation !== undefined) {
        // Afficher les HP d'AVANT les dégâts pendant l'animation
        hpElement.textContent = hpBeforeAnimation;
        console.log('[Zdejebel] Restored HP display to', hpBeforeAnimation, '(actual:', currentHp, ')');
    }

    // Récupérer la position du héros ciblé
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (heroCard) {
        // Animation de secousse sur le héros
        heroCard.classList.add('hit');
        setTimeout(() => heroCard.classList.remove('hit'), 500);

        // Utiliser l'effet slash PixiJS si disponible
        const vfxReady = typeof CombatVFX !== 'undefined' && CombatVFX.initialized && CombatVFX.container;
        console.log('[Zdejebel] VFX ready:', vfxReady, 'CombatVFX:', typeof CombatVFX, 'initialized:', CombatVFX?.initialized);

        if (vfxReady) {
            try {
                const rect = heroCard.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                console.log('[Zdejebel] Creating slash effect at', x, y);
                CombatVFX.createSlashEffect(x, y, data.damage);
            } catch (e) {
                console.error('[Zdejebel] Slash effect error:', e);
                // Fallback en cas d'erreur - afficher les dégâts avec le système standard
                showDamageNumber(heroCard, data.damage);
            }
        } else {
            console.log('[Zdejebel] Using fallback animation');
            // Fallback : afficher juste les dégâts
            showDamageNumber(heroCard, data.damage);
        }
    } else {
        console.warn('[Zdejebel] Hero card not found for', owner);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation
    if (hpElement && currentHp !== undefined) {
        hpElement.textContent = currentHp;
        console.log('[Zdejebel] Updated HP display to', currentHp);
    }

    // Débloquer render() pour les HP
    zdejebelAnimationInProgress = false;

    // Petit délai supplémentaire pour voir le changement
    await new Promise(r => setTimeout(r, 200));
}

// Fonction utilitaire pour afficher un nombre de dégâts sur un élément
function showDamageNumber(element, damage) {
    const rect = element.getBoundingClientRect();
    const damageEl = document.createElement('div');
    damageEl.className = 'damage-number';
    damageEl.textContent = `-${damage}`;
    damageEl.style.left = `${rect.left + rect.width / 2}px`;
    damageEl.style.top = `${rect.top + rect.height / 2}px`;
    document.body.appendChild(damageEl);
    setTimeout(() => damageEl.remove(), 1000);
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

// ==========================================
// Custom Drag & Drop Setup
// ==========================================
function setupCustomDrag() {
    CustomDrag.setCallbacks({
        canDrag: () => canPlay(),

        dragStart: (data, sourceEl) => {
            hideCardPreview();
            if (data.source === 'hand') {
                dragged = { ...data.card, idx: data.idx, tooExpensive: data.tooExpensive, effectiveCost: data.effectiveCost };
                draggedFromField = null;
                highlightValidSlots(data.card);
            } else if (data.source === 'field') {
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
                    document.querySelectorAll('.card-slot.cross-target').forEach(s => s.classList.remove('cross-target'));
                }
            }
        },

        drop: (data, target, sourceEl) => {
            if (data.source === 'hand') {
                return handleHandDrop(data, target);
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

function handleHandDrop(data, target) {
    const card = data.card;

    // Zone de sort global
    if (target.type === 'global') {
        if (card.type === 'spell' && ['global', 'all'].includes(card.pattern)) {
            if (data.tooExpensive) {
                data.triedToDrop = true;
                return false;
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
        if (spell.targetEnemy && owner === 'me') return false;
        if (spell.targetSelf && owner === 'opp') return false;
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
        console.log(`[newTurn] Received turn=${d.turn}, local turn=${state?.turn}`);

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

        log(`🎮 Tour ${d.turn} — ⚡${d.maxEnergy} énergie`, 'phase');
    });

    socket.on('resolutionLog', (d) => log(d.msg, d.type));

    socket.on('directDamage', (d) => {
        const heroEl = document.getElementById(d.defender === myNum ? 'hero-me' : 'hero-opp');
        heroEl.classList.add('hit');
        setTimeout(() => heroEl.classList.remove('hit'), 500);
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

    // Resync quand la fenêtre revient au premier plan
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

function handleAnimation(data) {
    const { type } = data;
    console.log('[Animation] Received:', type, data);

    // Les animations de combat utilisent la file d'attente
    const queuedTypes = ['attack', 'damage', 'spellDamage', 'death', 'heroHit', 'discard', 'burn', 'zdejebel', 'spell', 'trapTrigger'];

    if (queuedTypes.includes(type)) {
        queueAnimation(type, data);
    } else {
        // Les autres animations s'exécutent immédiatement
        switch(type) {
            case 'spellMiss': animateSpellMiss(data); break;
            case 'heal': animateHeal(data); break;
            case 'buff': animateBuff(data); break;
            case 'summon': animateSummon(data); break;
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
        }
    }
}

// Handler pour les batches d'animations (sorts de zone - jouées en parallèle)
function handleAnimationBatch(animations) {
    console.log('[AnimationBatch] Received batch of', animations.length, 'animations');

    // Jouer toutes les animations en parallèle immédiatement
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
            return animateDeathToGraveyard(anim);
        }

        return Promise.resolve();
    });

    // Attendre que toutes les animations soient terminées (optionnel, pour le logging)
    Promise.all(promises).then(() => {
        console.log('[AnimationBatch] All animations completed');
    });
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

/**
 * Animation de défausse depuis la main (désintégration sur place)
 */
async function animateDiscard(data) {
    console.log('[Discard] START - data:', JSON.stringify(data));
    const owner = data.player === myNum ? 'me' : 'opp';
    const handEl = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    if (!handEl) {
        console.log('[Discard] END - No hand element found for owner:', owner);
        return;
    }

    const cards = handEl.querySelectorAll(owner === 'me' ? '.card' : '.opp-card-back');
    console.log('[Discard] Found', cards.length, 'cards in hand, looking for index', data.handIndex);
    const cardEl = cards[data.handIndex];
    if (!cardEl) {
        console.log('[Discard] END - No card at index', data.handIndex, '- hand may have been updated by render()');
        return;
    }

    const rect = cardEl.getBoundingClientRect();
    console.log('[Discard] Card found at', rect.left, rect.top);

    // Créer un clone pour l'animation
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

    // Animation de désintégration avec timeout de sécurité
    let timeoutId;
    console.log('[Discard] Starting disintegration animation');
    try {
        await Promise.race([
            animateDisintegration(clone, owner),
            new Promise(resolve => {
                timeoutId = setTimeout(() => {
                    console.log('[Discard] TIMEOUT reached after 1.5s, forcing completion');
                    resolve();
                }, 1500); // Timeout 1.5s max
            })
        ]);
        console.log('[Discard] Disintegration finished normally');
    } catch (e) {
        console.error('[Discard] Animation error:', e);
    } finally {
        clearTimeout(timeoutId);
        // Toujours nettoyer le clone
        if (clone.parentNode) {
            clone.remove();
            console.log('[Discard] Clone removed');
        }
    }
    console.log('[Discard] END - Animation completed');
}

/**
 * Animation de burn professionnelle (style Hearthstone/Magic Arena)
 *
 * Phase 1 - Lift:    Dos de carte se soulève du deck
 * Phase 2 - Flip:    La carte se retourne près du deck (révèle ce qui est brûlé)
 * Phase 3 - Hold:    Pause brève + teinte rouge (la carte est condamnée)
 * Phase 4 - Fly:     La carte vole vers le cimetière en rétrécissant
 * Phase 5 - Impact:  Flash au cimetière, mise à jour du graveyard
 */
async function animateBurn(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const ownerKey = owner === 'me' ? 'me' : 'opp';
    const card = data.card;

    // Bloquer le render du cimetière pendant l'animation
    graveRenderBlocked.add(ownerKey);

    const deckEl = document.getElementById(owner === 'me' ? 'me-deck-stack' : 'opp-deck-stack');
    if (!deckEl) {
        graveRenderBlocked.delete(ownerKey);
        return;
    }

    const graveEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');

    const deckRect = deckEl.getBoundingClientRect();
    const cardWidth = 105;
    const cardHeight = 140;

    const startX = deckRect.left + deckRect.width / 2 - cardWidth / 2;
    const startY = deckRect.top;

    // Cacher le cimetière temporairement (la carte n'y est pas encore visuellement)
    const graveTopEl = document.getElementById(`${owner}-grave-top`);
    let graveSnapshot = null;
    if (graveTopEl) {
        graveSnapshot = graveTopEl.innerHTML;
    }

    // Position et taille visuelle du cimetière (inclut perspective + rotateX du game-board)
    let graveX = startX;
    let graveY = startY + 200;
    let graveScale = 1.0;
    if (graveEl) {
        const gRect = graveEl.getBoundingClientRect();
        graveX = gRect.left + gRect.width / 2 - cardWidth / 2;
        graveY = gRect.top + gRect.height / 2 - cardHeight / 2;
        // Scale pour matcher la taille visuelle du cimetière (réduite par la perspective)
        graveScale = Math.min(gRect.width / cardWidth, gRect.height / cardHeight);
    }

    // Position de reveal : à côté du deck (pas au centre)
    const revealX = startX;
    const revealY = startY - cardHeight - 20;

    // Wrapper avec perspective
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed; z-index: 10000; pointer-events: none;
        left: ${startX}px; top: ${startY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        transform-origin: center center;
        transform: scale(1); opacity: 0;
        perspective: 800px;
    `;

    // Flipper 3D
    const flipper = document.createElement('div');
    flipper.style.cssText = `
        width: 100%; height: 100%;
        position: relative;
        transform-style: preserve-3d;
        transform: rotateY(0deg);
    `;

    // Dos de carte
    const backFace = document.createElement('div');
    backFace.className = 'opp-card-back';
    backFace.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%;
        backface-visibility: hidden;
        transform: rotateY(0deg);
        border-radius: 6px;
    `;

    // Face avant
    const frontFace = (typeof makeCard === 'function')
        ? makeCard(card, true)
        : createCardElementForAnimation(card);
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

    flipper.appendChild(backFace);
    flipper.appendChild(frontFace);
    wrapper.appendChild(flipper);

    // Conteneur perspective pour matcher l'inclinaison du game-board
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
            perspective: 1500px;
            perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height / 2}px;
        `;
        document.body.appendChild(perspContainer);
        perspContainer.appendChild(wrapper);
    } else {
        document.body.appendChild(wrapper);
    }

    // Durées
    const liftDuration = 200;
    const flipDuration = 350;
    const holdDuration = 600;
    const flyDuration = 400;
    const totalDuration = liftDuration + flipDuration + holdDuration + flyDuration;

    await new Promise(resolve => {
        const startTime = performance.now();

        const safetyTimeout = setTimeout(() => {
            graveRenderBlocked.delete(ownerKey);
            wrapper.remove();
            if (perspContainer) perspContainer.remove();
            resolve();
        }, totalDuration + 500);

        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);

            const t1 = liftDuration / totalDuration;
            const t2 = (liftDuration + flipDuration) / totalDuration;
            const t3 = (liftDuration + flipDuration + holdDuration) / totalDuration;

            let x, y, scale, opacity, flipDeg, redTint, tiltDeg;

            if (progress <= t1) {
                // === PHASE 1: LIFT ===
                const p = progress / t1;
                const ep = easeOutCubic(p);
                x = startX;
                y = startY - ep * 30;
                scale = 1 + ep * 0.05;
                opacity = 0.3 + ep * 0.7;
                flipDeg = 0;
                redTint = 0;
                tiltDeg = 0;

            } else if (progress <= t2) {
                // === PHASE 2: FLIP (retourne la carte près du deck) ===
                const p = (progress - t1) / (t2 - t1);
                const ep = easeInOutCubic(p);
                x = startX + (revealX - startX) * ep;
                y = (startY - 30) + (revealY - (startY - 30)) * ep;
                scale = 1.05 + (1.2 - 1.05) * ep;
                opacity = 1;
                flipDeg = easeInOutCubic(p) * 180;
                redTint = 0;
                tiltDeg = 0;

            } else if (progress <= t3) {
                // === PHASE 3: HOLD (teinte rouge progressive) ===
                const p = (progress - t2) / (t3 - t2);
                x = revealX;
                y = revealY;
                scale = 1.2;
                opacity = 1;
                flipDeg = 180;
                redTint = easeOutCubic(p) * 0.6;
                tiltDeg = 0;

            } else {
                // === PHASE 4: FLY TO GRAVEYARD ===
                const p = (progress - t3) / (1 - t3);
                const ep = easeInOutCubic(p);
                x = revealX + (graveX - revealX) * ep;
                y = revealY + (graveY - revealY) * ep;
                scale = 1.2 + (graveScale - 1.2) * ep;
                opacity = 1 - 0.3 * ep;
                flipDeg = 180;
                redTint = 0.6;
                // Inclinaison progressive pour matcher le game-board
                tiltDeg = ep * graveTiltDeg;
            }

            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';
            wrapper.style.opacity = opacity;
            wrapper.style.transform = `scale(${scale}) rotateX(${tiltDeg}deg)`;
            flipper.style.transform = `rotateY(${flipDeg}deg)`;

            // Teinte rouge via overlay
            if (redTint > 0) {
                wrapper.style.filter = `sepia(${redTint * 0.5}) saturate(${1 + redTint * 2}) hue-rotate(-10deg) brightness(${1 - redTint * 0.2})`;
            } else {
                wrapper.style.filter = 'none';
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);

                // Débloquer et mettre à jour le cimetière
                graveRenderBlocked.delete(ownerKey);
                if (state) {
                    const graveyard = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                    if (graveyard) {
                        updateGraveDisplay(ownerKey, graveyard);
                        updateGraveTopCard(ownerKey, graveyard);
                    }
                }

                wrapper.remove();
                if (perspContainer) perspContainer.remove();
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

/**
 * Animation de mort — la carte vole vers le cimetière (style Hearthstone/Arena)
 * Phase 1 - Death Mark (400ms) : greyscale progressif + léger shrink
 * Phase 2 - Fly to Graveyard (500ms) : vol vers le cimetière avec perspective tilt
 */
async function animateDeathToGraveyard(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const ownerKey = owner;

    // Bloquer le render du cimetière pendant l'animation
    graveRenderBlocked.add(ownerKey);

    // 1. Trouver le slot et la carte
    const slot = document.querySelector(
        `.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`
    );
    const cardEl = slot?.querySelector('.card');

    if (!slot) {
        graveRenderBlocked.delete(ownerKey);
        return;
    }

    // 2. Positions de départ (slot sur le battlefield)
    const slotRect = slot.getBoundingClientRect();
    const cardWidth = slotRect.width || 105;
    const cardHeight = slotRect.height || 140;
    const startX = slotRect.left;
    const startY = slotRect.top;

    // 3. Position cible : cimetière du propriétaire
    const graveEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    let graveX = startX;
    let graveY = startY + 200;
    let graveScale = 1.0;
    if (graveEl) {
        const gRect = graveEl.getBoundingClientRect();
        graveX = gRect.left + gRect.width / 2 - cardWidth / 2;
        graveY = gRect.top + gRect.height / 2 - cardHeight / 2;
        graveScale = Math.min(gRect.width / cardWidth, gRect.height / cardHeight);
    }

    // 4. Créer le wrapper avec la carte
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed; z-index: 10000; pointer-events: none;
        left: ${startX}px; top: ${startY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        transform-origin: center center;
        transform: scale(1); opacity: 1;
    `;

    // Créer la face de la carte
    let cardFace;
    if (data.card && typeof makeCard === 'function') {
        cardFace = makeCard(data.card, true);
    } else if (cardEl) {
        cardFace = cardEl.cloneNode(true);
    } else {
        graveRenderBlocked.delete(ownerKey);
        return;
    }
    const bgImage = cardFace.style.backgroundImage;
    cardFace.style.position = 'absolute';
    cardFace.style.top = '0';
    cardFace.style.left = '0';
    cardFace.style.width = '100%';
    cardFace.style.height = '100%';
    cardFace.style.margin = '0';
    if (bgImage) cardFace.style.backgroundImage = bgImage;
    wrapper.appendChild(cardFace);

    // 5. Retirer la carte originale du slot immédiatement
    if (cardEl) {
        cardEl.remove();
    }
    slot.classList.remove('has-card');
    slot.classList.remove('has-flying');

    // 6. Perspective container (même technique que animateBurn)
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
            perspective: 1500px;
            perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height / 2}px;
        `;
        document.body.appendChild(perspContainer);
        perspContainer.appendChild(wrapper);
    } else {
        document.body.appendChild(wrapper);
    }

    // 7. Animation
    const deathMarkDuration = 400;
    const flyDuration = 500;
    const totalDuration = deathMarkDuration + flyDuration;

    await new Promise(resolve => {
        const startTime = performance.now();

        const safetyTimeout = setTimeout(() => {
            graveRenderBlocked.delete(ownerKey);
            wrapper.remove();
            if (perspContainer) perspContainer.remove();
            resolve();
        }, totalDuration + 500);

        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);

            const t1 = deathMarkDuration / totalDuration;

            let x, y, scale, opacity, greyAmount, tiltDeg;

            if (progress <= t1) {
                // === PHASE 1: DEATH MARK ===
                const p = progress / t1;
                const ep = easeOutCubic(p);
                x = startX;
                y = startY;
                scale = 1.0 - ep * 0.05;
                opacity = 1.0;
                greyAmount = ep;
                tiltDeg = 0;
            } else {
                // === PHASE 2: FLY TO GRAVEYARD ===
                const p = (progress - t1) / (1 - t1);
                const ep = easeInOutCubic(p);
                x = startX + (graveX - startX) * ep;
                y = startY + (graveY - startY) * ep;
                scale = 0.95 + (graveScale - 0.95) * ep;
                opacity = 1.0 - 0.3 * ep;
                greyAmount = 1.0;
                tiltDeg = ep * graveTiltDeg;
            }

            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';
            wrapper.style.opacity = opacity;
            wrapper.style.transform = `scale(${scale}) rotateX(${tiltDeg}deg)`;

            // Effet visuel de mort : greyscale + darkening
            if (greyAmount > 0) {
                wrapper.style.filter = `grayscale(${greyAmount}) brightness(${1 - greyAmount * 0.3})`;
            } else {
                wrapper.style.filter = 'none';
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);

                // Cacher le wrapper AVANT de placer la carte
                wrapper.style.display = 'none';

                // Débloquer et mettre à jour le cimetière
                graveRenderBlocked.delete(ownerKey);
                if (state) {
                    const graveyard = owner === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                    if (graveyard) {
                        updateGraveDisplay(ownerKey, graveyard);
                        updateGraveTopCard(ownerKey, graveyard);
                    }
                }

                wrapper.remove();
                if (perspContainer) perspContainer.remove();
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

/**
 * Crée un élément carte pour l'animation (copie de celle dans animations.js)
 */
function createCardElementForAnimation(card) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    const hp = card.currentHp ?? card.hp;

    // Si la carte a une image, utiliser le nouveau système
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', initiative: 'Initiative', power: 'Puissance'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost">${card.cost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">Créature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk">${card.atk}</div>
            <div class="img-hp">${hp}</div>`;
        return el;
    }

    const icons = {
        fly: '🦅', shooter: '🎯', haste: '⚡', intangible: '👻',
        trample: '🦏', initiative: '🗡️', power: '💪', cleave: '⛏️'
    };
    const abilities = (card.abilities || []).map(a => icons[a] || '').join(' ');

    let typeIcon = '';
    if (card.type === 'spell') typeIcon = `<div class="card-type-icon spell-icon">✨</div>`;
    else if (card.type === 'trap') typeIcon = `<div class="card-type-icon trap-icon">🪤</div>`;

    el.innerHTML = `
        <div class="card-cost">${card.cost}</div>
        ${typeIcon}
        <div class="card-art">${card.icon || '❓'}</div>
        <div class="card-body">
            <div class="card-name">${card.name}</div>
            <div class="card-abilities">${abilities || (card.type === 'spell' ? (card.offensive ? '⚔️' : '💚') : '')}</div>
            <div class="card-stats">
                ${card.atk !== undefined ? `<span class="stat stat-atk">${card.atk}</span>` : ''}
                ${card.damage ? `<span class="stat stat-atk">${card.damage}</span>` : ''}
                ${card.heal ? `<span class="stat stat-hp">${card.heal}</span>` : ''}
                ${card.type === 'creature' ? `<span class="stat stat-hp">${hp}</span>` : ''}
            </div>
        </div>`;

    return el;
}

/**
 * Animation de révélation d'un sort ou piège — style Hearthstone/Arena
 * La carte apparaît en grand (gauche = joueur, droite = adversaire)
 * puis vole vers le cimetière du propriétaire.
 */
async function animateSpellReveal(card, casterPlayerNum) {
    const isMine = casterPlayerNum === myNum;
    const side = isMine ? 'me' : 'opp';
    const cardWidth = 105;
    const cardHeight = 140;

    // 1. Créer l'élément carte (version on-field : juste le nom, comme au cimetière)
    const cardEl = (typeof makeCard === 'function')
        ? makeCard(card, false)
        : createCardElementForAnimation(card);
    const bgImage = cardEl.style.backgroundImage;
    cardEl.style.width = cardWidth + 'px';
    cardEl.style.height = cardHeight + 'px';
    cardEl.style.margin = '0';
    cardEl.style.position = 'absolute';
    cardEl.style.top = '0';
    cardEl.style.left = '0';
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

    // 3. Calculer la position du cimetière du caster
    const graveEl = document.getElementById(side + '-grave-box');
    let graveX = showcaseX;
    let graveY = showcaseY + 200;
    let graveScale = 1.0;
    if (graveEl) {
        const gRect = graveEl.getBoundingClientRect();
        graveX = gRect.left + gRect.width / 2 - cardWidth / 2;
        graveY = gRect.top + gRect.height / 2 - cardHeight / 2;
        graveScale = Math.min(gRect.width / cardWidth, gRect.height / cardHeight);
    }

    // 4. Wrapper positionné
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed; z-index: 10000; pointer-events: none;
        left: ${showcaseX}px; top: ${showcaseY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        transform-origin: center center;
        transform: scale(0.3); opacity: 0;
    `;
    wrapper.appendChild(cardEl);

    // 5. Perspective container pour le fly-to-graveyard (même technique que animateBurn)
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
            perspective: 1500px;
            perspective-origin: ${gbwRect.left + gbwRect.width / 2}px ${gbwRect.top + gbwRect.height / 2}px;
        `;
        document.body.appendChild(perspContainer);
        perspContainer.appendChild(wrapper);
    } else {
        document.body.appendChild(wrapper);
    }

    // 6. Durées des phases
    const materializeDuration = 300;
    const holdDuration = 1000;
    const shrinkDuration = 300;
    const flyDuration = 400;
    const impactDuration = 100;
    const totalDuration = materializeDuration + holdDuration + shrinkDuration + flyDuration + impactDuration;

    await new Promise(resolve => {
        const startTime = performance.now();

        const safetyTimeout = setTimeout(() => {
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
            const t4 = (materializeDuration + holdDuration + shrinkDuration + flyDuration) / totalDuration;

            let x, y, scale, opacity, tiltDeg, glowIntensity;

            if (progress <= t1) {
                // === PHASE 1: MATERIALIZE ===
                const p = progress / t1;
                const ep = easeOutBack(p);
                x = showcaseX;
                y = showcaseY;
                scale = 0.3 + (showcaseScale - 0.3) * ep;
                opacity = easeOutCubic(p);
                tiltDeg = 0;
                glowIntensity = easeOutCubic(p);

            } else if (progress <= t2) {
                // === PHASE 2: HOLD / SHOWCASE ===
                const p = (progress - t1) / (t2 - t1);
                x = showcaseX;
                y = showcaseY;
                scale = showcaseScale;
                opacity = 1;
                tiltDeg = 0;
                // Léger pulse du glow
                glowIntensity = 0.8 + 0.2 * Math.sin(p * Math.PI * 2);

            } else if (progress <= t3) {
                // === PHASE 3: SHRINK ===
                const p = (progress - t2) / (t3 - t2);
                const ep = easeInOutCubic(p);
                x = showcaseX;
                y = showcaseY;
                scale = showcaseScale + (1.0 - showcaseScale) * ep;
                opacity = 1;
                tiltDeg = 0;
                glowIntensity = 1.0 - ep;

            } else if (progress <= t4) {
                // === PHASE 4: FLY TO GRAVEYARD ===
                const p = (progress - t3) / (t4 - t3);
                const ep = easeInOutCubic(p);
                x = showcaseX + (graveX - showcaseX) * ep;
                y = showcaseY + (graveY - showcaseY) * ep;
                scale = 1.0 + (graveScale - 1.0) * ep;
                opacity = 1 - 0.3 * ep;
                tiltDeg = ep * graveTiltDeg;
                glowIntensity = 0;

            } else {
                // === PHASE 5: IMPACT — pas de fade, transition nette ===
                x = graveX;
                y = graveY;
                scale = graveScale;
                opacity = 0.7;
                tiltDeg = graveTiltDeg;
                glowIntensity = 0;
            }

            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';
            wrapper.style.opacity = opacity;
            wrapper.style.transform = `scale(${scale}) rotateX(${tiltDeg}deg)`;

            // Glow doré
            if (glowIntensity > 0) {
                const glowSize1 = 30 * glowIntensity;
                const glowSize2 = 60 * glowIntensity;
                const glowAlpha1 = 0.8 * glowIntensity;
                const glowAlpha2 = 0.4 * glowIntensity;
                wrapper.style.boxShadow = `0 0 ${glowSize1}px rgba(255, 215, 0, ${glowAlpha1}), 0 0 ${glowSize2}px rgba(255, 215, 0, ${glowAlpha2})`;
                wrapper.style.borderRadius = '8px';
            } else {
                wrapper.style.boxShadow = 'none';
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);

                // Cacher le wrapper AVANT de placer la carte pour éviter tout flash
                wrapper.style.display = 'none';

                // Mettre la carte directement dans le cimetière
                const graveTopContainer = document.getElementById(side + '-grave-top');
                if (graveTopContainer && typeof makeCard === 'function') {
                    graveTopContainer.classList.remove('empty');
                    graveTopContainer.innerHTML = '';
                    const graveCardEl = makeCard(card, false);
                    graveCardEl.classList.add('grave-card', 'in-graveyard');
                    graveTopContainer.appendChild(graveCardEl);
                }

                // Bloquer le re-render du cimetière pour éviter le clignotement
                // quand le state update arrive et que render() appelle updateGraveTopCard()
                graveRenderBlocked.add(side);
                setTimeout(() => graveRenderBlocked.delete(side), 500);

                wrapper.remove();
                if (perspContainer) perspContainer.remove();
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

async function animateSpell(data) {
    // Afficher la carte du sort avec animation de révélation
    if (data.spell) {
        await animateSpellReveal(data.spell, data.caster);
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
        // Grande croix rouge avec deux barres
        effect.innerHTML = '<div class="miss-cross"></div>';
        effect.style.left = rect.left + rect.width / 2 + 'px';
        effect.style.top = rect.top + rect.height / 2 + 'px';
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

function animateTrapPlace(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const trapSlot = document.querySelector(`.trap-slot[data-owner="${owner}"][data-row="${data.row}"]`);
    if (!trapSlot) return;

    // Aura de révélation : flash + anneaux d'énergie
    trapSlot.classList.add('revealing');

    const flash = document.createElement('div');
    flash.className = 'trap-reveal-flash';
    trapSlot.appendChild(flash);

    const ring1 = document.createElement('div');
    ring1.className = 'trap-reveal-ring';
    trapSlot.appendChild(ring1);

    setTimeout(() => {
        const ring2 = document.createElement('div');
        ring2.className = 'trap-reveal-ring';
        trapSlot.appendChild(ring2);
        setTimeout(() => ring2.remove(), 700);
    }, 150);

    // Nettoyage
    setTimeout(() => {
        flash.remove();
        ring1.remove();
        trapSlot.classList.remove('revealing');
    }, 800);
}

async function animateTrap(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const trapSlot = document.querySelector(`.trap-slot[data-owner="${owner}"][data-row="${data.row}"]`);

    // 1. Afficher la carte du piège avec animation de révélation
    if (data.trap) {
        await animateSpellReveal(data.trap, data.player);
    }

    // 2. Explosion du slot du piège
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


/**
 * Réinitialise tous les états d'animation pour éviter les bugs de persistance
 * Appelé au début de chaque nouveau tour
 */
function resetAnimationStates() {
    // Vider les sets d'état
    animatingSlots.clear();

    // NE PAS vider la file d'animation - laisser les animations se terminer naturellement
    // Cela évite de perdre des animations comme zdejebel qui arrivent en fin de tour
    // animationQueue.length = 0;
    // isAnimating = false;
    console.log('[Reset] Animation states reset, queue preserved:', animationQueue.length, 'items');

    // Nettoyer les animations de pioche en attente
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.clear();
    }

    // Réinitialiser les flags de combat sur toutes les cartes
    document.querySelectorAll('.card[data-in-combat="true"]').forEach(card => {
        card.dataset.inCombat = 'false';
    });

    // Retirer les classes d'animation résiduelles
    document.querySelectorAll('.card.dying, .card.taking-damage, .card.healing').forEach(card => {
        card.classList.remove('dying', 'taking-damage', 'healing');
    });

    // Supprimer les éléments d'animation orphelins
    document.querySelectorAll('.damage-number, .buff-indicator, .spell-effect, .spell-miss').forEach(el => {
        el.remove();
    });
}

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
    // N'animer que les créatures adverses (le joueur voit déjà ses propres cartes posées pendant le planning)
    if (data.player === myNum) return;

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
    console.log('[animateMove] Called with:', data, 'myNum:', myNum);
    // N'animer que les déplacements adverses (le joueur voit déjà ses propres déplacements)
    if (data.player === myNum) {
        console.log('[animateMove] Skipped - own card');
        return;
    }

    const owner = 'opp';

    // Bloquer les deux slots (origine et destination)
    const fromKey = `${owner}-${data.fromRow}-${data.fromCol}`;
    const toKey = `${owner}-${data.toRow}-${data.toCol}`;
    animatingSlots.add(fromKey);
    animatingSlots.add(toKey);
    console.log('[animateMove] Blocked slots:', fromKey, toKey);

    const fromSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.fromRow}"][data-col="${data.fromCol}"]`);
    const toSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.toRow}"][data-col="${data.toCol}"]`);

    console.log('[animateMove] fromSlot:', fromSlot, 'toSlot:', toSlot);
    console.log('[animateMove] fromSlot has card?', fromSlot?.classList.contains('has-card'), 'children:', fromSlot?.children.length);
    if (!fromSlot || !toSlot) {
        console.log('[animateMove] ABORT - slot not found');
        return;
    }

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
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;
    console.log('[animateMove] from:', fromRect.left, fromRect.top, '→ to:', toRect.left, toRect.top, 'delta:', dx, dy);

    // Créer une carte overlay (makeCard met le backgroundImage en inline, on ne doit pas l'écraser)
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

    // Forcer le reflow puis déclencher la transition via transform
    movingCard.getBoundingClientRect();
    requestAnimationFrame(() => {
        console.log('[animateMove] Setting transform translate3d(%s, %s)', dx, dy);
        movingCard.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    });

    // Nettoyer après l'animation (500ms transition + 100ms marge)
    setTimeout(() => {
        console.log('[animateMove] Cleanup - removing overlay');
        movingCard.remove();
        animatingSlots.delete(fromKey);
        animatingSlots.delete(toKey);
        render();
    }, 600);
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
    if (!state) {
        console.log('[canPlay] false: no state');
        return false;
    }
    if (state.phase !== 'planning') {
        console.log('[canPlay] false: phase is', state.phase, 'not planning');
        return false;
    }
    if (state.me.ready) {
        console.log('[canPlay] false: already ready');
        return false;
    }
    return true;
}

function updateTimerDisplay(t) {
    const endTurnBtn = document.getElementById('end-turn-btn');
    const timerSpan = endTurnBtn.querySelector('.end-turn-timer');

    if (t > 0 && t <= 15 && state && state.phase === 'planning' && !endTurnBtn.classList.contains('waiting')) {
        // Afficher le compteur dans le bouton (sans changer les couleurs)
        if (timerSpan) timerSpan.textContent = t;
        endTurnBtn.classList.add('has-timer');
        endTurnBtn.classList.remove('has-phase');
    } else {
        // Masquer le timer
        if (endTurnBtn.classList.contains('has-timer')) {
            if (timerSpan) timerSpan.textContent = '';
            endTurnBtn.classList.remove('has-timer');
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
    const endTurnBtn = document.getElementById('end-turn-btn');
    const phaseEl = endTurnBtn.querySelector('.end-turn-phase');

    // Clear les timeouts précédents
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);

    // Afficher la phase dans le bouton
    phaseEl.textContent = text;
    endTurnBtn.classList.add('has-phase');
    endTurnBtn.classList.remove('has-timer');

    // Message éphémère sauf pendant la résolution - retour à "FIN DE TOUR" après 2s
    if (type !== 'resolution' && (!state || state.phase !== 'resolution')) {
        phaseMessageTimeout = setTimeout(() => {
            endTurnBtn.classList.remove('has-phase');
        }, 2000);
    }
}

function hidePhaseMessage() {
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (phaseMessageTimeout) clearTimeout(phaseMessageTimeout);
    if (phaseMessageFadeTimeout) clearTimeout(phaseMessageFadeTimeout);
    endTurnBtn.classList.remove('has-phase');
}

function updatePhaseDisplay() {
    if (!state) return;

    // Ne pas masquer si un message est en cours d'affichage (avec son propre timeout)
    const endTurnBtn = document.getElementById('end-turn-btn');
    if (endTurnBtn.classList.contains('has-phase')) return;

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
    setupCustomDrag();
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
    // Setup hero backgrounds et titres
    const meHero = state.me.hero;
    const oppHero = state.opponent.hero;

    const meHeroInner = document.getElementById('me-hero-inner');
    const oppHeroInner = document.getElementById('opp-hero-inner');

    if (meHero && meHero.image) {
        meHeroInner.style.backgroundImage = `url('/cards/${meHero.image}')`;
        document.getElementById('me-hero-title').textContent = meHero.name;
        document.getElementById('me-hero-title').style.background = meHero.titleColor;
    }

    if (oppHero && oppHero.image) {
        oppHeroInner.style.backgroundImage = `url('/cards/${oppHero.image}')`;
        document.getElementById('opp-hero-title').textContent = oppHero.name;
        document.getElementById('opp-hero-title').style.background = oppHero.titleColor;
    }

    // Stocker les héros pour réutilisation (AVANT les event listeners)
    window.heroData = { me: meHero, opp: oppHero };

    // Preview au survol des héros
    const heroMe = document.getElementById('hero-me');
    const heroOpp = document.getElementById('hero-opp');

    // Fonction pour gérer le clic sur un héros
    const handleHeroClick = (heroEl, owner) => {
        return (e) => {
            e.stopPropagation();

            // Si un sort est sélectionné et peut cibler ce héros, le lancer
            if (selected && selected.fromHand && selected.type === 'spell') {
                const canTarget = selected.pattern === 'hero' || selected.canTargetHero;
                if (canTarget && canPlay() && selected.cost <= state.me.energy) {
                    const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
                    socket.emit('castSpell', {
                        idx: selected.idx,
                        targetPlayer: targetPlayer,
                        row: -1,
                        col: -1
                    });
                    clearSel();
                    return;
                }
            }

            // Sinon, afficher le détail du héros
            const hero = owner === 'me' ? window.heroData.me : window.heroData.opp;
            const hp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
            showHeroDetail(hero, hp);
        };
    };

    if (heroMe) {
        // Hover preview
        heroMe.onmouseenter = () => showHeroPreview(window.heroData.me, state?.me?.hp);
        heroMe.onmouseleave = hideCardPreview;
        // Clic gauche
        heroMe.onclick = handleHeroClick(heroMe, 'me');
    }

    if (heroOpp) {
        // Hover preview
        heroOpp.onmouseenter = () => showHeroPreview(window.heroData.opp, state?.opponent?.hp);
        heroOpp.onmouseleave = hideCardPreview;
        // Clic gauche
        heroOpp.onclick = handleHeroClick(heroOpp, 'opp');
    }

    // Drag/drop sur les héros pour les sorts
    setupHeroDragDrop(heroMe, 'me');
    setupHeroDragDrop(heroOpp, 'opp');
}

function setupHeroDragDrop(heroEl, owner) {
    // Les handlers drag natifs ont été supprimés.
    // Le custom drag gère le hover et le drop via CustomDrag callbacks
    // (updateHoverFeedback + handleHandDrop dans game.js)

    // Note: onclick est géré dans setupHeroes pour permettre à la fois
    // le lancer de sort ET l'affichage du détail du héros
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

    // Ne pas mettre à jour les HP si une animation zdejebel est en cours ou en attente
    // L'animation zdejebel gère elle-même l'affichage des HP
    const hasZdejebelPending = animationQueue.some(a => a.type === 'zdejebel') || zdejebelAnimationInProgress;
    if (!hasZdejebelPending) {
        const meHpNum = document.querySelector('#me-hp .hero-hp-number');
        const oppHpNum = document.querySelector('#opp-hp .hero-hp-number');
        if (meHpNum) meHpNum.textContent = me.hp;
        if (oppHpNum) oppHpNum.textContent = opp.hp;
    }
    const meManaNum = document.querySelector('#me-energy .hero-mana-number');
    const oppManaNum = document.querySelector('#opp-energy .hero-mana-number');
    if (meManaNum) {
        meManaNum.textContent = `${me.energy}/${me.maxEnergy}`;
        meManaNum.style.fontSize = (me.energy >= 10 || me.maxEnergy >= 10) ? '1em' : '';
    }
    if (oppManaNum) {
        oppManaNum.textContent = `${opp.energy}/${opp.maxEnergy}`;
        oppManaNum.style.fontSize = (opp.energy >= 10 || opp.maxEnergy >= 10) ? '1em' : '';
    }
    // Mettre à jour les tooltips du deck
    const meDeckTooltip = document.getElementById('me-deck-tooltip');
    const oppDeckTooltip = document.getElementById('opp-deck-tooltip');
    if (meDeckTooltip) meDeckTooltip.textContent = me.deckCount + (me.deckCount > 1 ? ' cartes' : ' carte');
    if (oppDeckTooltip) oppDeckTooltip.textContent = opp.deckCount + (opp.deckCount > 1 ? ' cartes' : ' carte');
    // Mettre à jour les tooltips du cimetière
    const meGraveCount = me.graveyardCount || 0;
    const oppGraveCount = opp.graveyardCount || 0;
    const meGraveTooltip = document.getElementById('me-grave-tooltip');
    const oppGraveTooltip = document.getElementById('opp-grave-tooltip');
    if (meGraveTooltip) meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
    if (oppGraveTooltip) oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');
    
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
    
    if (me.ready && state.phase === 'planning') {
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

// Bloquer le render du cimetière pendant les animations de burn
const graveRenderBlocked = new Set(); // 'me' ou 'opp'

function updateGraveDisplay(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) return;
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
    if (graveRenderBlocked.has(owner)) return;
    const container = document.getElementById(`${owner}-grave-top`);
    if (!container) return;

    if (graveyard && graveyard.length > 0) {
        const topCard = graveyard[graveyard.length - 1];
        container.classList.remove('empty');
        container.innerHTML = '';
        // Utiliser le même template arena que le battlefield
        const cardEl = makeCard(topCard, false);
        cardEl.classList.add('grave-card', 'in-graveyard');
        container.appendChild(cardEl);
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
            if (animatingSlots.has(slotKey)) {
                console.log('[renderField] Slot BLOCKED by animation:', slotKey);
                continue;
            }

            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));

            slot.classList.remove('has-card');
            slot.classList.remove('has-flying');
            const card = field[r][c];

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

                // Custom drag pour redéploiement (seulement mes cartes)
                if (owner === 'me' && !state.me.inDeployPhase && !card.movedThisTurn) {
                    CustomDrag.makeDraggable(cardEl, {
                        source: 'field',
                        card: card,
                        row: r,
                        col: c,
                        owner: owner
                    });
                }

                // Clic gauche = zoom sur la carte (pour toutes les cartes)
                cardEl.onclick = (e) => {
                    e.stopPropagation();
                    showCardZoom(card);
                };
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
    power: { name: 'Puissance', desc: 'Quand cette créature subit des dégâts sans mourir, elle gagne +1 ATK.' },
    cleave: { name: 'Clivant', desc: 'Quand cette créature attaque, elle inflige X dégâts aux créatures sur les lignes adjacentes. Ces créatures ne ripostent pas.' }
};

function showCardPreview(card, e) {
    hideCardPreview();
    
    // Créer le container
    previewEl = document.createElement('div');
    previewEl.className = 'preview-container card-preview';
    
    // Ajouter la carte (version complète avec tous les détails)
    const cardEl = makeCard(card, true);
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
                // Type de combat (shooter/fly) en blanc, capacités communes en jaune
                const isTypeAbility = ability === 'shooter' || ability === 'fly';
                abilityEl.innerHTML = `
                    <div class="ability-name ${isTypeAbility ? 'type-ability' : ''}">${abilityInfo.name}</div>
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
    const el = previewEl; // Garder une référence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function showCardBackPreview() {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'card-back-preview card-preview';
    document.body.appendChild(previewEl);
    const el = previewEl; // Garder une référence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function makeHeroCard(hero, hp) {
    const faction = hero.faction || 'neutral';
    const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
    const rarityClass = rarityMap[hero.edition] || 'common';
    const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;
    const el = document.createElement('div');
    el.className = `card creature arena-style faction-${faction}`;
    el.style.backgroundImage = `url('/cards/${hero.image}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';

    el.innerHTML = `
        <div class="arena-title"><div class="arena-name">${hero.name}</div></div>
        <div class="arena-hero-hp">
            <div class="arena-hero-hp-border">
                <div class="arena-hero-hp-inner">
                    <span class="arena-hero-hp-number">${hp}</span>
                </div>
            </div>
        </div>
        <div class="arena-text-zone">
            <div class="arena-type">Héros</div>
            <div class="arena-special">${hero.ability}</div>
        </div>
        ${rarityDiamond}`;

    return el;
}

function showHeroPreview(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'hero-preview';

    if (hero && hero.image) {
        const cardEl = makeHeroCard(hero, hp);
        previewEl.appendChild(cardEl);
    } else {
        previewEl.innerHTML = `<div class="hero-preview-name">${hero ? hero.name : 'Héros'}</div>`;
    }
    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) {
            el.classList.add('visible');
        }
    });
}

function showHeroDetail(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
        if (!hero) return;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    const overlay = document.getElementById('card-zoom-overlay');
    const container = document.getElementById('card-zoom-container');

    container.innerHTML = '';
    const cardEl = makeHeroCard(hero, hp);
    container.appendChild(cardEl);

    zoomCardData = hero;
    overlay.classList.remove('hidden');
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
                slot.innerHTML = '<img class="trap-icon-img mine" src="/css/beartraparmed.png" alt="trap">';

                // Hover preview pour voir le piège posé
                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
                slot.innerHTML = '';
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
                slot.innerHTML = '<img class="trap-icon-img enemy" src="/css/beartraparmed.png" alt="trap">';
            } else {
                slot.innerHTML = '';
            }
        }
    });
}

function renderHand(hand, energy) {
    const panel = document.getElementById('my-hand');
    panel.innerHTML = '';

    // Vérifier si Hyrule peut réduire le coût du 2ème sort
    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1;

    hand.forEach((card, i) => {
        // Calculer le coût effectif pour les sorts avec Hyrule
        let effectiveCost = card.cost;
        let hasDiscount = false;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
            hasDiscount = true;
        }

        const el = makeCard(card, true, hasDiscount ? effectiveCost : null);
        el.dataset.idx = i;
        el.dataset.cost = effectiveCost;

        // Marquer comme jouable si assez de mana (avec coût réduit)
        if (effectiveCost <= energy) {
            el.classList.add('playable');
        }

        // Z-index incrémental pour éviter les saccades au hover
        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente
        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i)) {
            el.style.visibility = 'hidden';
        }

        // Custom drag
        const tooExpensive = effectiveCost > energy;
        CustomDrag.makeDraggable(el, {
            source: 'hand',
            card: card,
            idx: i,
            effectiveCost: effectiveCost,
            tooExpensive: tooExpensive
        });

        // Preview au survol
        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onmouseleave = hideCardPreview;

        // Clic gauche = zoom sur la carte
        el.onclick = (e) => {
            e.stopPropagation();
            showCardZoom(card);
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

function makeCard(card, inHand, discountedCost = null) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;

    if (!inHand && card.type === 'creature') {
        if (card.turnsOnField === 0 && !card.abilities?.includes('haste')) el.classList.add('just-played');
        if (card.canAttack) el.classList.add('can-attack');
    }

    const hp = card.currentHp ?? card.hp;

    // Coût affiché (réduit si Hyrule actif)
    const displayCost = discountedCost !== null ? discountedCost : card.cost;
    const costClass = discountedCost !== null ? 'discounted' : '';

    // Classes pour les stats (comparaison avec les stats de BASE)
    // boosted = supérieur à la base (vert), reduced = inférieur à la base (rouge)
    let hpClass = '';
    let atkClass = '';
    if (card.type === 'creature') {
        const baseHp = card.baseHp ?? card.hp; // Si pas de baseHp, utiliser hp comme référence
        const baseAtk = card.baseAtk ?? card.atk; // Si pas de baseAtk, utiliser atk comme référence

        // HP: comparer currentHp avec baseHp
        if (hp > baseHp) {
            hpClass = 'boosted';
        } else if (hp < baseHp) {
            hpClass = 'reduced';
        }

        // ATK: comparer atk avec baseAtk
        if (card.atk > baseAtk) {
            atkClass = 'boosted';
        } else if (card.atk < baseAtk) {
            atkClass = 'reduced';
        }
    }

    // Carte style Arena (Magic Arena) : pilule stats en bas à droite, mana en rond bleu
    if (card.arenaStyle && card.image) {
        el.classList.add('arena-style');
        if (card.faction) {
            el.classList.add(`faction-${card.faction}`);
        }
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // Capacités communes (sans shooter/fly car déjà dans le type)
        const commonAbilityNames = {
            haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', initiative: 'Initiative', power: 'Puissance'
        };
        // Filtrer shooter et fly des capacités affichées
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                return commonAbilityNames[a] || a;
            });
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        // Type de créature (mort-vivant, humain, dragon...)
        const creatureTypeNames = {
            undead: 'Mort-vivant',
            human: 'Humain',
            dragon: 'Dragon'
        };
        const creatureTypeName = card.creatureType ? creatureTypeNames[card.creatureType] : null;

        // Capacité spéciale/unique si présente
        let specialAbility = '';
        if (card.description) {
            specialAbility = card.description;
        } else {
            if (card.onHeroHit === 'draw') {
                specialAbility = 'Quand cette créature attaque le héros adverse, piochez une carte.';
            }
            if (card.onDeath?.damageHero) {
                specialAbility = `À la mort de cette créature, le héros adverse subit ${card.onDeath.damageHero} blessures.`;
            }
        }

        // Diamant de rareté basé sur l'édition
        const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
        const rarityClass = rarityMap[card.edition] || 'common';
        const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;

        // Ligne de type complète
        let typeLineText = `Créature - ${combatTypeText}`;
        if (creatureTypeName) {
            typeLineText += ` - ${creatureTypeName}`;
        }

        // Style du titre (couleur personnalisée si définie)
        const titleStyle = card.titleColor ? `style="background: ${card.titleColor}"` : '';

        // Les sorts et pièges n'ont pas de stats
        const isSpell = card.type === 'spell';
        const isTrap = card.type === 'trap';
        const noStats = isSpell || isTrap;

        // Version allégée sur le terrain
        if (!inHand) {
            el.classList.add('on-field');
            if (noStats) {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>`;
            } else {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>
                    <div class="arena-stats"><span class="arena-atk ${atkClass}">${card.atk}</span>/<span class="arena-hp ${hpClass}">${hp}</span></div>`;
            }
            return el;
        }

        // Version complète (main, hover, cimetière)
        if (noStats) {
            const typeName = isTrap ? 'Piège' : 'Sort';
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeName}</div>
                    ${card.description ? `<div class="arena-special">${card.description}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>`;
        } else {
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name">${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeLineText}</div>
                    ${abilitiesText ? `<div class="arena-abilities">${abilitiesText}</div>` : ''}
                    ${specialAbility ? `<div class="arena-special">${specialAbility}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>
                <div class="arena-stats ${atkClass || hpClass ? 'modified' : ''}">${card.atk}/${hp}</div>`;
        }
        return el;
    }

    // Carte fullArt : image plein fond + ronds colorés style héros
    if (card.fullArt && card.image) {
        el.classList.add('full-art');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // Version allégée sur le terrain (sans zone de texte type/capacités, sans mana)
        if (!inHand) {
            el.classList.add('on-field');
            el.innerHTML = `
                <div class="fa-title"><div class="fa-name">${card.name}</div></div>
                <div class="fa-atk ${atkClass}">${card.atk}</div>
                <div class="fa-hp ${hpClass}">${hp}</div>`;
            return el;
        }

        // Version complète (main, hover, cimetière)
        // Capacités communes (sans shooter/fly car déjà dans le type)
        const commonAbilityNames = {
            haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', initiative: 'Initiative', power: 'Puissance'
        };
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                return commonAbilityNames[a] || a;
            });
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="fa-mana">${card.cost}</div>
            <div class="fa-title"><div class="fa-name">${card.name}</div></div>
            <div class="fa-text-zone">
                <div class="fa-type">Créature - ${combatTypeText}</div>
                ${abilitiesText ? `<div class="fa-abilities">${abilitiesText}</div>` : ''}
            </div>
            <div class="fa-atk ${atkClass}">${card.atk}</div>
            <div class="fa-hp ${hpClass}">${hp}</div>`;
        return el;
    }

    // Si la carte a une image (système template avec texte positionné)
    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', initiative: 'Initiative', power: 'Puissance'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost ${costClass}">${displayCost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">Créature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk ${atkClass}">${card.atk}</div>
            <div class="img-hp ${hpClass}">${hp}</div>`;
        return el;
    }

    // Système classique avec emojis
    const icons = {
        fly: '🦅',
        shooter: '🎯',
        haste: '⚡',
        intangible: '👻',
        trample: '🦏',
        initiative: '🗡️',
        power: '💪',
        cleave: '⛏️'
    };
    const abilities = (card.abilities || []).map(a => icons[a] || '').join(' ');

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
        <div class="card-cost ${costClass}">${displayCost}</div>
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
    console.log('[endTurn] called, canPlay:', canPlay(), 'state:', state ? { phase: state.phase, ready: state.me?.ready } : null);
    if (!canPlay()) return;
    const btn = document.getElementById('end-turn-btn');
    // Ne pas accepter le clic si le bouton n'affiche pas "FIN DE TOUR"
    if (btn.classList.contains('waiting') || btn.classList.contains('has-phase')) return;
    btn.classList.add('waiting');
    socket.emit('ready');
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
    console.log('Music volume:', val);
    document.getElementById('musicValue').textContent = val + '%';
}

function setSfxVolume(val) {
    // TODO: Connecter à un système audio
    console.log('SFX volume:', val);
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

    zoomCardData = card;
    overlay.classList.remove('hidden');
}

function hideCardZoom() {
    const overlay = document.getElementById('card-zoom-overlay');
    overlay.classList.add('hidden');
    zoomCardData = null;
}

document.addEventListener('DOMContentLoaded', async () => {
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
});