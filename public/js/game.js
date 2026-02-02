let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let combatAnimReady = false;
let testModeSelection = [];
let cardCatalog = null;

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

    // Pour zdejebel et onDeathDamage héros, capturer les HP actuels AVANT que render() ne les mette à jour
    if ((type === 'zdejebel' || (type === 'onDeathDamage' && data.targetRow === undefined)) && state) {
        const target = data.targetPlayer === myNum ? 'me' : 'opp';
        const currentDisplayedHp = target === 'me' ? state.me?.hp : state.opponent?.hp;
        data._displayHpBefore = currentDisplayedHp;
        console.log('[Queue] HP capture for', type, ': HP before =', currentDisplayedHp, 'for', target);
    }

    // Pour burn, death, spell, trapTrigger, bloquer le render du cimetière IMMÉDIATEMENT
    if (type === 'burn' || type === 'death' || type === 'spell' || type === 'trapTrigger') {
        const owner = (type === 'spell' ? data.caster : data.player) === myNum ? 'me' : 'opp';
        graveRenderBlocked.add(owner);
        console.log('[Queue] Blocked graveyard render for', owner, '(type:', type + ')');
    }

    // Pour death, bloquer aussi le slot du terrain pour que render() ne retire pas
    // la carte avant que l'animation de mort ne la prenne en charge
    if (type === 'death' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
        console.log('[Queue] Blocked slot for death:', slotKey);
    }

    // Pour deathTransform, bloquer le slot IMMÉDIATEMENT pour que render() ne remplace pas la carte
    if (type === 'deathTransform') {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
        console.log('[Queue] Blocked slot for deathTransform:', slotKey);
    }

    // Pour bounce, bloquer le slot pour que render() ne retire pas la carte
    if (type === 'bounce' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
        console.log('[Queue] Blocked slot for bounce:', slotKey);
    }

    // Pour onDeathDamage créature (Torche vivante), bloquer le slot pour que render()
    // ne retire pas la carte avant que l'animation de dégâts ne joue
    if (type === 'onDeathDamage' && data.targetRow !== undefined && data.targetCol !== undefined) {
        const owner = data.targetPlayer === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.add(slotKey);
        console.log('[Queue] Blocked slot for onDeathDamage creature:', slotKey);
    }

    // Pour damage/spellDamage, bloquer le slot pour que render() ne mette pas à jour
    // les stats (HP, ATK via Puissance) avant que l'animation de dégâts ne joue
    if ((type === 'damage' || type === 'spellDamage') && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    animationQueue.push({ type, data });
    if (!isAnimating) {
        // Pour les types batchables (burn, death), différer le démarrage
        // pour laisser les events du même batch serveur arriver
        if (type === 'burn' || type === 'death' || type === 'deathTransform') {
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
            console.log(`[Queue] Death batch: ${deathBatch.length} deaths:`, deathBatch.map(d => `${d.card?.name||'?'}(p${d.player},r${d.row},c${d.col})`).join(', '), '| animatingSlots:', [...animatingSlots]);
            const deathPromises = deathBatch.map(data => animateDeathToGraveyard(data));
            await Promise.all(deathPromises);
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.death));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations de deathTransform consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'deathTransform') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'deathTransform') {
                batch.push(animationQueue.shift().data);
            }
            await Promise.all(batch.map(data => animateDeathTransform(data)));
            await new Promise(resolve => setTimeout(resolve, 200));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations zdejebel consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'zdejebel') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'zdejebel') {
                batch.push(animationQueue.shift().data);
            }
            console.log('[Queue] Zdejebel batch:', batch.length, 'animations');
            await Promise.all(batch.map(data => animateZdejebelDamage(data)));
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
            // Débloquer les slots de dégâts de sort après les animations
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
            render(); // Mettre à jour les stats visuellement après déblocage des slots
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.damage));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations onDeathDamage consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'onDeathDamage') {
            const batch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'onDeathDamage') {
                batch.push(animationQueue.shift().data);
            }
            console.log(`[Queue] onDeathDamage batch: ${batch.length} effects, timestamp=${Date.now()}`);
            // Bloquer le render HP pour toute la durée du batch
            const hasHeroTarget = batch.some(d => d.targetRow === undefined);
            if (hasHeroTarget) {
                zdejebelAnimationInProgress = true;
            }
            await Promise.all(batch.map(data => handleOnDeathDamage(data)));
            // Débloquer après TOUTES les animations
            if (hasHeroTarget) {
                zdejebelAnimationInProgress = false;
            }
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

        // Débloquer les slots de dégâts après l'animation
        // SAUF si une animation de mort est en attente pour ce slot (elle a besoin de la carte dans le DOM)
        if (type === 'damage' || type === 'spellDamage') {
            const dmgOwner = data.player === myNum ? 'me' : 'opp';
            const dmgSlotKey = `${dmgOwner}-${data.row}-${data.col}`;
            const hasPendingDeath = animationQueue.some(item =>
                item.type === 'death' && item.data &&
                (item.data.player === myNum ? 'me' : 'opp') === dmgOwner &&
                item.data.row === data.row && item.data.col === data.col
            );
            if (!hasPendingDeath) {
                animatingSlots.delete(dmgSlotKey);
                render(); // Mettre à jour les stats visuellement après déblocage du slot
            } else {
                console.log('[Queue] Keeping slot blocked for pending death:', dmgSlotKey);
            }
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
            case 'deathTransform':
                await animateDeathTransform(data);
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
            case 'trampleDamage':
                await animateTrampleDamage(data);
                return;
            case 'trampleHeroHit':
                await animateTrampleHeroHit(data);
                return;
            case 'bounce':
                await animateBounceToHand(data);
                return;
        }
    }

    // Fallback si PixiJS pas dispo
    switch(type) {
        case 'attack': animateAttackFallback(data); break;
        case 'damage': animateDamageFallback(data); break;
        case 'spellDamage': animateDamageFallback(data); break;
        case 'death': await animateDeathToGraveyard(data); break;
        case 'deathTransform': await animateDeathTransform(data); break;
        case 'heroHit': animateHeroHitFallback(data); break;
        case 'zdejebel': await animateZdejebelDamage(data); break;
        case 'onDeathDamage': await handleOnDeathDamage(data); break;
        case 'discard': await animateDiscard(data); break;
        case 'burn': await animateBurn(data); break;
        case 'spell': await animateSpell(data); break;
        case 'trapTrigger': await animateTrap(data); break;
        case 'trampleDamage': await animateTrampleDamage(data); break;
        case 'trampleHeroHit': await animateTrampleHeroHit(data); break;
        case 'bounce': await animateBounceToHand(data); break;
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
    console.log(`[ONDEATH ANIM] START source=${data.source} targetPlayer=${data.targetPlayer} targetRow=${data.targetRow} targetCol=${data.targetCol} timestamp=${Date.now()}`);
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Cas 1 : dégâts à une créature (damageKiller — Torche vivante)
    if (data.targetRow !== undefined && data.targetCol !== undefined) {
        const slot = document.querySelector(
            `.card-slot[data-owner="${owner}"][data-row="${data.targetRow}"][data-col="${data.targetCol}"]`
        );
        if (slot) {
            // Secousse sur le slot
            slot.classList.add('hit');
            setTimeout(() => slot.classList.remove('hit'), 500);

            // Slash VFX (style Zdejebel) si PixiJS disponible
            const vfxReady = typeof CombatVFX !== 'undefined' && CombatVFX.initialized && CombatVFX.container;
            if (vfxReady) {
                try {
                    const rect = slot.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;
                    CombatVFX.createSlashEffect(x, y, data.damage);
                } catch (e) {
                    showDamageNumber(slot, data.damage);
                }
            } else {
                showDamageNumber(slot, data.damage);
            }

            // Label "💀 Source"
            const deathEffect = document.createElement('div');
            deathEffect.className = 'on-death-effect';
            deathEffect.innerHTML = `<span class="death-source">💀 ${data.source}</span>`;
            slot.appendChild(deathEffect);
            setTimeout(() => deathEffect.classList.add('active'), 50);
            setTimeout(() => deathEffect.remove(), 1500);
        }
        await new Promise(r => setTimeout(r, 600));

        // Débloquer le slot après l'animation — la carte a été visible pendant les dégâts
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.delete(slotKey);
        console.log('[OnDeathDamage] Unblocked slot:', slotKey);
        return;
    }

    // Cas 2 : dégâts au héros (damageHero — Dragon Crépitant) — style Zdejebel
    zdejebelAnimationInProgress = true;

    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    // Préserver les HP d'avant l'animation
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const currentHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
    const hpBeforeAnimation = data._displayHpBefore ?? (currentHp !== undefined ? currentHp + data.damage : undefined);

    if (hpElement && hpBeforeAnimation !== undefined) {
        hpElement.textContent = hpBeforeAnimation;
        console.log('[OnDeathDamage] Restored HP display to', hpBeforeAnimation, '(actual:', currentHp, ')');
    }

    // Label "💀 Source" sur la zone héros
    const heroZone = document.querySelector(`.hero-zone.${owner}`);
    if (heroZone) {
        const deathEffect = document.createElement('div');
        deathEffect.className = 'on-death-effect';
        deathEffect.innerHTML = `<span class="death-source">💀 ${data.source}</span>`;
        heroZone.appendChild(deathEffect);
        setTimeout(() => deathEffect.classList.add('active'), 50);
        setTimeout(() => deathEffect.remove(), 1500);
    }

    if (heroCard) {
        // Secousse sur le héros
        heroCard.classList.add('hit');
        setTimeout(() => heroCard.classList.remove('hit'), 500);

        // Slash VFX (style Zdejebel) si PixiJS disponible
        const vfxReady = typeof CombatVFX !== 'undefined' && CombatVFX.initialized && CombatVFX.container;
        if (vfxReady) {
            try {
                const rect = heroCard.getBoundingClientRect();
                CombatVFX.createSlashEffect(rect.left + rect.width / 2, rect.top + rect.height / 2, data.damage);
            } catch (e) {
                showDamageNumber(heroCard, data.damage);
            }
        } else {
            showDamageNumber(heroCard, data.damage);
        }
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation
    if (hpElement && currentHp !== undefined) {
        hpElement.textContent = currentHp;
        console.log('[OnDeathDamage] Updated HP display to', currentHp);
    }

    // Débloquer render()
    zdejebelAnimationInProgress = false;

    await new Promise(r => setTimeout(r, 200));
    console.log(`[ONDEATH ANIM] END source=${data.source} timestamp=${Date.now()}`);
}

async function animateZdejebelDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';
    console.log('[Zdejebel] START - owner:', owner, 'damage:', data.damage, 'timestamp:', Date.now());

    // Bloquer render() pour les HP pendant toute l'animation
    zdejebelAnimationInProgress = true;

    // Lire les HP directement depuis le DOM (ce que le joueur voit actuellement)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const domHp = hpElement ? parseInt(hpElement.textContent) : null;
    const hpBefore = domHp ?? data._displayHpBefore ?? ((owner === 'me' ? state?.me?.hp : state?.opponent?.hp) + data.damage);
    const hpAfter = hpBefore - data.damage;

    console.log('[Zdejebel] HP: DOM=', domHp, 'before=', hpBefore, 'after=', hpAfter);

    if (hpElement) {
        // S'assurer que les HP d'avant sont affichés pendant l'animation
        hpElement.textContent = hpBefore;
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

    // Mettre à jour les HP APRÈS l'animation (hpBefore - damage, indépendant du state)
    if (hpElement) {
        hpElement.textContent = hpAfter;
        console.log('[Zdejebel] Updated HP display to', hpAfter);
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

// Animation de dégâts de piétinement sur une créature
async function animateTrampleDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');

    if (!card) return;

    // Bloquer le slot pour que render() ne mette pas à jour les HP pendant l'animation
    const slotKey = `${owner}-${data.row}-${data.col}`;
    animatingSlots.add(slotKey);

    // Sauvegarder les HP d'avant dans l'affichage
    const hpEl = card.querySelector('.arena-hp') || card.querySelector('.fa-hp') || card.querySelector('.img-hp');
    if (hpEl && data.hpBefore !== undefined) {
        hpEl.textContent = data.hpBefore;
    }
    // Pour le format ATK/HP combiné dans arena-stats
    const statsEl = card.querySelector('.arena-stats');
    const atkEl = card.querySelector('.arena-atk');
    if (statsEl && !atkEl && data.hpBefore !== undefined) {
        const currentText = statsEl.textContent;
        const atkPart = currentText.split('/')[0];
        statsEl.textContent = `${atkPart}/${data.hpBefore}`;
    }

    // Animation de secousse
    card.classList.add('taking-damage');
    setTimeout(() => card.classList.remove('taking-damage'), 500);

    // Effet slash VFX si disponible
    const vfxReady = typeof CombatVFX !== 'undefined' && CombatVFX.initialized && CombatVFX.container;
    if (vfxReady) {
        try {
            const rect = card.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            CombatVFX.createSlashEffect(x, y, data.amount);
        } catch (e) {
            showDamageNumber(card, data.amount);
        }
    } else {
        showDamageNumber(card, data.amount);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation
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

    // Débloquer le slot
    animatingSlots.delete(slotKey);

    await new Promise(r => setTimeout(r, 200));
}

// Animation de dégâts de piétinement sur le héros
async function animateTrampleHeroHit(data) {
    const owner = data.defender === myNum ? 'me' : 'opp';
    console.log('[TrampleHero] START - owner:', owner, 'damage:', data.damage);
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (!heroCard) return;

    // Bloquer render() pour les HP du héros (déjà bloqué dès la réception, mais on s'assure)
    zdejebelAnimationInProgress = true;

    // Lire les HP directement depuis le DOM (ce que le joueur voit)
    const hpContainer = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const hpElement = hpContainer?.querySelector('.hero-hp-number') || hpContainer;
    const domHp = hpElement ? parseInt(hpElement.textContent) : null;
    const hpBefore = domHp ?? ((owner === 'me' ? state?.me?.hp : state?.opponent?.hp) + data.damage);
    const hpAfter = hpBefore - data.damage;

    console.log('[TrampleHero] domHp:', domHp, 'hpBefore:', hpBefore, 'hpAfter:', hpAfter);

    if (hpElement) {
        hpElement.textContent = hpBefore;
    }

    // Animation de secousse
    heroCard.classList.add('hit');
    setTimeout(() => heroCard.classList.remove('hit'), 500);

    // Effet slash VFX
    const vfxReady = typeof CombatVFX !== 'undefined' && CombatVFX.initialized && CombatVFX.container;
    if (vfxReady) {
        try {
            const rect = heroCard.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            CombatVFX.createSlashEffect(x, y, data.damage);
        } catch (e) {
            showDamageNumber(heroCard, data.damage);
        }
    } else {
        showDamageNumber(heroCard, data.damage);
    }

    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation (hpBefore - damage, indépendant du state)
    if (hpElement) {
        hpElement.textContent = hpAfter;
        console.log('[TrampleHero] Updated display to hpAfter:', hpAfter);
    }

    zdejebelAnimationInProgress = false;
    console.log('[TrampleHero] DONE - unblocked render');
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
// ATK Boost Animation (Salamandre de braise)
// ==========================================
function animateAtkBoost(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;

    const rect = slot.getBoundingClientRect();

    // Conteneur fixe sur le body (insensible au render/innerHTML du slot)
    const container = document.createElement('div');
    container.className = 'atk-boost-container';
    container.style.cssText = `
        position: fixed;
        left: ${rect.left - 4}px;
        top: ${rect.top - 4}px;
        width: ${rect.width + 8}px;
        height: ${rect.height + 8}px;
        pointer-events: none;
        z-index: 9999;
    `;
    document.body.appendChild(container);

    // === 1. Aura de feu ===
    const aura = document.createElement('div');
    aura.className = 'atk-boost-aura';
    container.appendChild(aura);

    // === 2. Particules de feu montantes ===
    for (let i = 0; i < 10; i++) {
        const particle = document.createElement('div');
        particle.className = 'atk-boost-particle';
        const xPct = 15 + Math.random() * 70;
        const delay = Math.random() * 400;
        particle.style.left = `${xPct}%`;
        particle.style.animationDelay = `${delay}ms`;
        container.appendChild(particle);
    }

    // === 3. Label "+X ATK" flottant ===
    const label = document.createElement('div');
    label.className = 'atk-boost-label';
    label.textContent = `+${data.boost} ATK`;
    container.appendChild(label);
    requestAnimationFrame(() => label.classList.add('active'));

    // === Cleanup ===
    setTimeout(() => container.remove(), 1000);
}

// ==========================================
// Custom Drag & Drop Setup
// ==========================================
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
                if (data.card.abilities?.includes('immovable')) return;
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
        console.log('[STATE UPDATE] me.graveyard:', meGrave.length, meGrave.map(c => c.id), '| opp.graveyard:', oppGrave.length, oppGrave.map(c => c.id), '| graveRenderBlocked:', [...graveRenderBlocked]);
        if (meGrave.length > prevMeGrave && !graveRenderBlocked.has('me')) {
            console.warn('[STATE UPDATE] ⚠️ me graveyard INCREASED but graveRenderBlocked is NOT set! Was:', prevMeGrave, 'Now:', meGrave.length);
        }
        if (oppGrave.length > prevOppGrave && !graveRenderBlocked.has('opp')) {
            console.warn('[STATE UPDATE] ⚠️ opp graveyard INCREASED but graveRenderBlocked is NOT set! Was:', prevOppGrave, 'Now:', oppGrave.length);
        }
        // Auto-cacher les nouvelles cartes adverses si le count augmente pendant la résolution
        // (sécurité anti-flash si l'état arrive avant l'event draw)
        if (typeof GameAnimations !== 'undefined' && state?.opponent) {
            const prevOppCount = state.opponent.handCount || 0;
            const newOppCount = s.opponent?.handCount || 0;
            if (newOppCount > prevOppCount && s.phase === 'resolution') {
                GameAnimations.autoHideNewDraws('opp', prevOppCount, newOppCount);
            }
        }

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
                // Pour les sorts de zone (cross), flammes sur TOUTES les cases, pas de glow rouge
                if (data.pattern === 'cross' && data.type === 'damage') {
                    setTimeout(() => {
                        const rect = slot.getBoundingClientRect();
                        const cx = rect.left + rect.width / 2;
                        const cy = rect.top + rect.height / 2;
                        if (combatAnimReady && CombatAnimations) {
                            CombatAnimations.showFlameEffect(cx, cy, 0);
                        } else {
                            // Fallback DOM : flamme CSS
                            const flame = document.createElement('div');
                            flame.className = 'spell-flame-effect';
                            flame.style.left = cx + 'px';
                            flame.style.top = cy + 'px';
                            document.body.appendChild(flame);
                            setTimeout(() => flame.remove(), 800);
                        }
                    }, index * 80);
                } else {
                    // Sort simple : glow classique
                    slot.classList.add('spell-highlight-' + data.type);
                    setTimeout(() => slot.classList.remove('spell-highlight-' + data.type), 1500);
                }

                // Si la case contient une carte, ajouter une classe à la carte aussi
                const cardInSlot = slot.querySelector('.card');
                if (cardInSlot) {
                    cardInSlot.classList.add('spell-target-' + data.type);
                    setTimeout(() => cardInSlot.classList.remove('spell-target-' + data.type), 1500);
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
    const queuedTypes = ['attack', 'damage', 'spellDamage', 'death', 'deathTransform', 'heroHit', 'discard', 'burn', 'zdejebel', 'onDeathDamage', 'spell', 'trapTrigger', 'trampleDamage', 'trampleHeroHit', 'bounce'];

    if (queuedTypes.includes(type)) {
        // Bloquer render() immédiatement pour les animations trample (avant traitement de la queue)
        if (type === 'trampleHeroHit') {
            zdejebelAnimationInProgress = true;
            console.log('[Animation] trampleHeroHit received - blocking hero HP render immediately');
        }
        if (type === 'trampleDamage') {
            const owner = data.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${data.row}-${data.col}`;
            animatingSlots.add(slotKey);
            console.log('[Animation] trampleDamage received - blocking slot', slotKey, 'immediately');
        }
        // Bloquer render() immédiatement pour onDeathDamage héros (Dragon Crépitant)
        if (type === 'onDeathDamage' && data.targetRow === undefined) {
            zdejebelAnimationInProgress = true;
            console.log('[Animation] onDeathDamage (hero) received - blocking hero HP render immediately');
        }
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
            case 'shield':
                animateShieldBreak(data);
                break;
            case 'startOfTurnTransform': {
                // Bloquer le slot IMMÉDIATEMENT (avant que le state update ne render Petit Os)
                const stOwner = data.player === myNum ? 'me' : 'opp';
                const stSlotKey = `${stOwner}-${data.row}-${data.col}`;
                animatingSlots.add(stSlotKey);
                activeDeathTransformSlots.add(stSlotKey);
                animateStartOfTurnTransform(data);
                break;
            }
        }
    }
}

// Handler pour les batches d'animations (sorts de zone - jouées en parallèle)
function handleAnimationBatch(animations) {
    console.log('[AnimationBatch] Received batch of', animations.length, 'animations');

    // Bloquer immédiatement les slots des deathTransform pour que render() ne les écrase pas
    for (const anim of animations) {
        console.log('[AnimationBatch] Processing anim type:', anim.type, 'player:', anim.player, 'row:', anim.row, 'col:', anim.col);
        if (anim.type === 'deathTransform') {
            const owner = anim.player === myNum ? 'me' : 'opp';
            const slotKey = `${owner}-${anim.row}-${anim.col}`;
            animatingSlots.add(slotKey);
            console.log('[AnimationBatch] Blocked slot for deathTransform:', slotKey);
        }
    }

    // Séparer les animations : death/deathTransform passent par la file d'attente, le reste joue immédiatement
    const immediatePromises = [];
    for (const anim of animations) {
        const owner = anim.player === myNum ? 'me' : 'opp';

        if (anim.type === 'spellDamage') {
            if (combatAnimReady && CombatAnimations) {
                immediatePromises.push(CombatAnimations.animateSpellDamage({
                    owner: owner,
                    row: anim.row,
                    col: anim.col,
                    amount: anim.amount
                }));
            } else {
                animateDamageFallback(anim);
            }
        } else if (anim.type === 'zdejebel') {
            const target = anim.targetPlayer === myNum ? 'me' : 'opp';
            const stateHp = target === 'me' ? state?.me?.hp : state?.opponent?.hp;
            const displayedHp = document.querySelector(`#${target === 'me' ? 'me' : 'opp'}-hp .hero-hp-number`)?.textContent;
            console.log(`[AnimationBatch] Zdejebel targetPlayer=${anim.targetPlayer} target=${target} stateHp=${stateHp} displayedHp=${displayedHp} _displayHpBefore=${anim._displayHpBefore}`);
            immediatePromises.push(animateZdejebelDamage(anim));
        } else if (anim.type === 'death' || anim.type === 'deathTransform') {
            // Passer par la file pour respecter l'ordre des animations (après damage, etc.)
            console.log(`[AnimationBatch] Routing ${anim.type} to queue for player=${anim.player} row=${anim.row} col=${anim.col}`);
            queueAnimation(anim.type, anim);
        } else {
            console.log(`[AnimationBatch] Unknown type in batch:`, anim.type);
        }
    }

    if (immediatePromises.length > 0) {
        Promise.all(immediatePromises).then(() => {
            console.log('[AnimationBatch] Immediate animations completed');
        });
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

let shieldIdCounter = 0;
const shieldStartTimes = new Map(); // slotKey -> timestamp de première apparition

/**
 * Crée l'overlay SVG Bouclier Nid d'Abeilles (7 hexagones)
 * avec animations de glow, reflet diagonal et rune centrale.
 */
function createShieldOverlay(slotKey) {
    const n = ++shieldIdCounter;
    const el = document.createElement('div');
    el.className = 'shield-indicator';

    el.innerHTML = `
        <div class="shield-3d">
            <svg viewBox="30 40 140 140" class="shield-svg">
                <defs>
                    <polygon id="hxB${n}" points="18,0 36,10.5 36,31.5 18,42 0,31.5 0,10.5"/>
                    <linearGradient id="lnC${n}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(255,255,255,0.4)"/>
                        <stop offset="50%" style="stop-color:rgba(200,220,250,0.25)"/>
                        <stop offset="100%" style="stop-color:rgba(60,80,120,0.3)"/>
                    </linearGradient>
                    <radialGradient id="hxG${n}" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" style="stop-color:rgba(0,220,255,0.3)"/>
                        <stop offset="60%" style="stop-color:rgba(0,200,240,0.12)"/>
                        <stop offset="100%" style="stop-color:rgba(0,180,220,0)"/>
                    </radialGradient>
                    <clipPath id="hcC${n}">
                        <polygon points="82,53 100,63.5 100,84.5 82,95 64,84.5 64,63.5"/>
                        <polygon points="118,53 136,63.5 136,84.5 118,95 100,84.5 100,63.5"/>
                        <polygon points="64,84 82,94.5 82,115.5 64,126 46,115.5 46,94.5"/>
                        <polygon points="100,84 118,94.5 118,115.5 100,126 82,115.5 82,94.5"/>
                        <polygon points="136,84 154,94.5 154,115.5 136,126 118,115.5 118,94.5"/>
                        <polygon points="82,115 100,125.5 100,146.5 82,157 64,146.5 64,125.5"/>
                        <polygon points="118,115 136,125.5 136,146.5 118,157 100,146.5 100,125.5"/>
                    </clipPath>
                    <linearGradient id="shG${n}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:rgba(255,255,255,0)"/>
                        <stop offset="40%" style="stop-color:rgba(255,255,255,0.1)"/>
                        <stop offset="50%" style="stop-color:rgba(255,255,255,0.3)"/>
                        <stop offset="60%" style="stop-color:rgba(255,255,255,0.1)"/>
                        <stop offset="100%" style="stop-color:rgba(255,255,255,0)"/>
                    </linearGradient>
                </defs>

                <!-- Hexagones structurels -->
                <use href="#hxB${n}" x="64" y="53" fill="none" stroke="url(#lnC${n})" stroke-width="1.2"/>
                <use href="#hxB${n}" x="100" y="53" fill="none" stroke="url(#lnC${n})" stroke-width="1.2"/>
                <use href="#hxB${n}" x="46" y="84" fill="none" stroke="url(#lnC${n})" stroke-width="1.2"/>
                <use href="#hxB${n}" x="82" y="84" fill="none" stroke="url(#lnC${n})" stroke-width="1.3"/>
                <use href="#hxB${n}" x="118" y="84" fill="none" stroke="url(#lnC${n})" stroke-width="1.2"/>
                <use href="#hxB${n}" x="64" y="115" fill="none" stroke="url(#lnC${n})" stroke-width="1.2"/>
                <use href="#hxB${n}" x="100" y="115" fill="none" stroke="url(#lnC${n})" stroke-width="1.2"/>

                <!-- Hexagones lumineux animés — pulsation séquentielle -->
                <use href="#hxB${n}" x="82" y="84" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.5)" stroke-width="1.5" opacity="0">
                    <animate attributeName="opacity" values="0;0.8;0" dur="8s" repeatCount="indefinite" begin="0s"/>
                </use>
                <use href="#hxB${n}" x="64" y="53" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.4)" stroke-width="1.2" opacity="0">
                    <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="1.3s"/>
                </use>
                <use href="#hxB${n}" x="100" y="53" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.4)" stroke-width="1.2" opacity="0">
                    <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="2.6s"/>
                </use>
                <use href="#hxB${n}" x="46" y="84" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.4)" stroke-width="1.2" opacity="0">
                    <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="3.9s"/>
                </use>
                <use href="#hxB${n}" x="118" y="84" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.4)" stroke-width="1.2" opacity="0">
                    <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="5.2s"/>
                </use>
                <use href="#hxB${n}" x="64" y="115" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.4)" stroke-width="1.2" opacity="0">
                    <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="6.5s"/>
                </use>
                <use href="#hxB${n}" x="100" y="115" fill="url(#hxG${n})" stroke="rgba(0,220,255,0.4)" stroke-width="1.2" opacity="0">
                    <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="7.8s"/>
                </use>

                <!-- Reflet diagonal animé -->
                <g clip-path="url(#hcC${n})">
                    <rect x="-50" y="0" width="35" height="220" fill="url(#shG${n})" transform="rotate(18 100 110)">
                        <animate attributeName="x" values="-50;200;200;-50" dur="5s" repeatCount="indefinite" keyTimes="0;0.4;0.5;1"/>
                        <animate attributeName="opacity" values="0;1;1;0;0" dur="5s" repeatCount="indefinite" keyTimes="0;0.05;0.4;0.45;1"/>
                    </rect>
                </g>

                <!-- Rune centrale -->
                <text x="100" y="112" font-size="16" fill="rgba(180,210,255,0.5)" text-anchor="middle" dominant-baseline="middle" style="filter: drop-shadow(0 0 6px rgba(150,200,255,0.8));">
                    <animate attributeName="opacity" values="0.3;0.9;0.3" dur="4s" repeatCount="indefinite"/>
                    \u16DF
                </text>
            </svg>
        </div>
    `;

    // Reprendre l'animation là où elle en était (pas de reset au render)
    if (slotKey) {
        const now = performance.now();
        if (!shieldStartTimes.has(slotKey)) {
            shieldStartTimes.set(slotKey, now);
        }
        const elapsed = now - shieldStartTimes.get(slotKey);
        const delayMs = -elapsed;
        el.style.animationDelay = `${delayMs}ms`;
        const shield3d = el.querySelector('.shield-3d');
        if (shield3d) shield3d.style.animationDelay = `${delayMs}ms`;
    }

    return el;
}

function animateShieldBreak(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;
    const cardEl = slot.querySelector('.card');
    if (!cardEl) return;

    // Nettoyer le startTime pour que le prochain bouclier sur ce slot reparte à zéro
    const shieldSlotKey = `${owner}-${data.row}-${data.col}`;
    shieldStartTimes.delete(shieldSlotKey);

    const rect = slot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Flash + disparition du bouclier SVG
    const shieldEl = cardEl.querySelector('.shield-indicator');
    if (shieldEl) {
        shieldEl.style.animation = 'none'; // Stopper le flottement
        shieldEl.style.transition = 'opacity 0.3s, filter 0.15s, transform 0.3s';
        shieldEl.style.filter = 'brightness(3) saturate(2)';
        setTimeout(() => {
            shieldEl.style.opacity = '0';
            shieldEl.style.transform = 'translate(-50%, -50%) scale(1.4)';
        }, 150);
        setTimeout(() => shieldEl.remove(), 500);
    }

    // Fragments hexagonaux qui se dispersent
    const fragAngles = [0, 51, 103, 154, 206, 257, 309];
    for (let i = 0; i < 7; i++) {
        const frag = document.createElement('div');
        const angle = (fragAngles[i] * Math.PI) / 180;
        const dist = 35 + Math.random() * 25;
        const endX = Math.cos(angle) * dist;
        const endY = Math.sin(angle) * dist;
        const size = 10 + Math.random() * 6;

        frag.style.cssText = `
            position: fixed;
            left: ${cx - size / 2}px;
            top: ${cy - size / 2}px;
            width: ${size}px;
            height: ${size}px;
            background: rgba(0, 220, 255, 0.7);
            clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
            z-index: 10001;
            pointer-events: none;
            opacity: 1;
            transition: all 0.5s ease-out;
            box-shadow: 0 0 6px rgba(0, 220, 255, 0.8);
        `;
        document.body.appendChild(frag);

        requestAnimationFrame(() => {
            frag.style.left = `${cx - size / 2 + endX}px`;
            frag.style.top = `${cy - size / 2 + endY}px`;
            frag.style.opacity = '0';
            frag.style.transform = `rotate(${Math.random() * 360}deg) scale(0.3)`;
        });
        setTimeout(() => frag.remove(), 600);
    }

    // Flash radial sur la carte
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: radial-gradient(circle, rgba(0, 220, 255, 0.6), transparent 70%);
        border: 2px solid rgba(0, 220, 255, 0.8);
        border-radius: 8px;
        z-index: 10001;
        pointer-events: none;
        animation: shieldBreakFlash 0.6s ease-out forwards;
    `;
    document.body.appendChild(flash);

    // Texte "Bloqué!"
    const text = document.createElement('div');
    text.style.cssText = `
        position: fixed;
        left: ${cx}px;
        top: ${cy}px;
        transform: translate(-50%, -50%);
        color: #00dcff;
        font-size: 14px;
        font-weight: bold;
        text-shadow: 0 0 8px rgba(0, 220, 255, 0.9);
        z-index: 10002;
        pointer-events: none;
        animation: shieldText 0.8s ease-out forwards;
    `;
    text.textContent = 'IMMUNE';
    document.body.appendChild(text);

    setTimeout(() => { flash.remove(); text.remove(); }, 1000);
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
 * Animation de transformation à la mort (Petit Os → Pile d'Os)
 * Flip 3D de la carte : la face avant (fromCard) se retourne pour révéler la face arrière (toCard)
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

    // Flip directement dans le slot — le tilt du board s'applique naturellement
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

    // Face avant (Petit Os) — 105x140 + offset -2px pour couvrir la bordure du slot
    const frontFace = makeCard(data.fromCard, false);
    const frontBg = frontFace.style.backgroundImage;
    frontFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 105px; height: 140px; margin: 0;
        backface-visibility: hidden;
        border-color: rgba(255,255,255,0.4) !important;
    `;
    if (frontBg) frontFace.style.backgroundImage = frontBg;

    // Face arrière (Pile d'Os) — pré-retournée de 180°
    const backFace = makeCard(data.toCard, false);
    const backBg = backFace.style.backgroundImage;
    backFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 105px; height: 140px; margin: 0;
        backface-visibility: hidden;
        border-color: rgba(255,255,255,0.4) !important;
        transform: rotateY(180deg);
    `;
    if (backBg) backFace.style.backgroundImage = backBg;

    flipContainer.appendChild(frontFace);
    flipContainer.appendChild(backFace);
    slot.appendChild(flipContainer);

    // --- Animation flip (600ms) — rotateY dans le slot ---
    const TOTAL = 600;
    console.log(`[DeathTransform] START flip owner=${owner} slot=${slotKey} fromCard=${data.fromCard.id} toCard=${data.toCard.id}`);

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

    // Débloquer le slot
    activeDeathTransformSlots.delete(slotKey);
    animatingSlots.delete(slotKey);
}

/**
 * Animation de transformation en début de tour (Pile d'Os → Petit Os)
 * Flip 3D inverse : la face avant (fromCard/Pile d'Os) se retourne pour révéler la face arrière (toCard/Petit Os)
 */
async function animateStartOfTurnTransform(data) {
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

    // Retirer la carte actuelle du slot (garder le label)
    const slotLabel = slot.querySelector('.slot-label');
    const allChildren = [...slot.children];
    for (const child of allChildren) {
        if (!child.classList.contains('slot-label')) child.remove();
    }

    // Flip directement dans le slot — le tilt du board s'applique naturellement
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

    // Face avant (Pile d'Os) — 105x140 + offset -2px pour couvrir la bordure du slot
    const frontFace = makeCard(data.fromCard, false);
    const frontBg = frontFace.style.backgroundImage;
    frontFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 105px; height: 140px; margin: 0;
        backface-visibility: hidden;
        border-color: rgba(255,255,255,0.4) !important;
    `;
    if (frontBg) frontFace.style.backgroundImage = frontBg;

    // Face arrière (Petit Os) — pré-retournée, révélée par le flip inverse
    const backFace = makeCard(data.toCard, false);
    const backBg = backFace.style.backgroundImage;
    backFace.style.cssText = `
        position: absolute; top: -2px; left: -2px; width: 105px; height: 140px; margin: 0;
        backface-visibility: hidden;
        border-color: rgba(255,255,255,0.4) !important;
        transform: rotateY(-180deg);
    `;
    if (backBg) backFace.style.backgroundImage = backBg;

    flipContainer.appendChild(frontFace);
    flipContainer.appendChild(backFace);
    slot.appendChild(flipContainer);

    // --- Animation flip inverse (600ms) — rotateY dans le slot ---
    const TOTAL = 600;
    console.log(`[Revive] START flip owner=${owner} slot=${slotKey} fromCard=${data.fromCard.id} toCard=${data.toCard.id}`);

    await new Promise(resolve => {
        const startTime = performance.now();
        const safetyTimeout = setTimeout(() => { resolve(); }, TOTAL + 500);

        function animate() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / TOTAL, 1);
            const ep = easeInOutCubic(t);
            flipContainer.style.transform = `rotateY(${ep * -180}deg)`;

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

    // Débloquer le slot
    activeDeathTransformSlots.delete(slotKey);
    animatingSlots.delete(slotKey);
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
    console.log(`[BURN ANIM] START ${card?.name || card?.id} owner=${owner} graveBlocked=${graveRenderBlocked.has(ownerKey)} timestamp=${Date.now()}`);

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
    const deathSlotKey = `${owner}-${data.row}-${data.col}`;
    console.log(`[DeathAnim] START ${data.card?.name || '?'} owner=${owner} row=${data.row} col=${data.col} slotBlocked=${animatingSlots.has(deathSlotKey)}`);

    // Bloquer le render du cimetière pendant l'animation
    graveRenderBlocked.add(ownerKey);

    // 1. Trouver le slot et la carte
    const slot = document.querySelector(
        `.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`
    );
    const cardEl = slot?.querySelector('.card');
    console.log(`[DeathAnim] ${data.card?.name || '?'} slot=${!!slot} cardEl=${!!cardEl} hasCard=${slot?.classList.contains('has-card')} data.card=${!!data.card}`);

    if (!slot) {
        console.log(`[DeathAnim] ${data.card?.name || '?'} ABORT: no slot found`);
        graveRenderBlocked.delete(ownerKey);
        animatingSlots.delete(deathSlotKey);
        return;
    }

    // 2. Positions de départ (slot sur le battlefield)
    // Dimensions CSS fixes — getBoundingClientRect retourne la projection 2D après le tilt du board
    const slotRect = slot.getBoundingClientRect();
    const cardWidth = 105;
    const cardHeight = 140;
    // Centrer la carte fixe sur le centre visuel du slot
    const startX = slotRect.left + slotRect.width / 2 - cardWidth / 2;
    const startY = slotRect.top + slotRect.height / 2 - cardHeight / 2;

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
        cardFace = makeCard(data.card, false);
    } else if (cardEl) {
        cardFace = cardEl.cloneNode(true);
    } else {
        console.log(`[DeathAnim] ${data.card?.name || '?'} ABORT: no cardFace (no data.card and no cardEl)`);
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
    wrapper.appendChild(cardFace);

    // 5. Retirer la carte originale du slot immédiatement
    if (cardEl) {
        cardEl.remove();
    }
    slot.classList.remove('has-card');
    slot.classList.remove('has-flying');

    // Débloquer le slot — la carte est maintenant dans le wrapper volant, render() peut toucher le slot
    animatingSlots.delete(deathSlotKey);

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
                tiltDeg = graveTiltDeg;
            } else {
                // === PHASE 2: FLY TO GRAVEYARD ===
                const p = (progress - t1) / (1 - t1);
                const ep = easeInOutCubic(p);
                x = startX + (graveX - startX) * ep;
                y = startY + (graveY - startY) * ep;
                scale = 0.95 + (graveScale - 0.95) * ep;
                opacity = 1.0 - 0.3 * ep;
                greyAmount = 1.0;
                tiltDeg = graveTiltDeg;
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

                // Placer la carte directement dans le cimetière via data.card
                // Le state n'est pas encore à jour (graveyard.length=0), donc on
                // utilise la carte de l'animation pour pré-remplir le cimetière
                graveRenderBlocked.delete(ownerKey);
                if (data.card) {
                    const container = document.getElementById(`${ownerKey}-grave-top`);
                    if (container) {
                        const topId = data.card.uid || data.card.id;
                        container.dataset.topCardUid = topId;
                        container.classList.remove('empty');
                        container.innerHTML = '';
                        const cardEl = makeCard(data.card, false);
                        cardEl.classList.add('grave-card', 'in-graveyard');
                        container.appendChild(cardEl);
                    }
                    // Aussi mettre à jour le stack
                    const graveyard = owner === 'me' ? state?.me?.graveyard : state?.opponent?.graveyard;
                    updateGraveDisplay(ownerKey, graveyard || [data.card]);
                }

                // Retirer le wrapper au prochain frame
                requestAnimationFrame(() => {
                    wrapper.remove();
                    if (perspContainer) perspContainer.remove();
                });
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
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
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
        trample: '🦏', power: '💪', cleave: '⛏️', immovable: '🪨', regeneration: '💚',
        protection: '🛡️'
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

                // Cacher le wrapper
                wrapper.style.display = 'none';

                // Placer la carte manuellement dans le cimetière
                // Le state n'a pas encore le sort — on garde graveRenderBlocked
                // pour empêcher les state updates (graveyard vide) de l'effacer
                const graveTopContainer = document.getElementById(side + '-grave-top');
                if (graveTopContainer && typeof makeCard === 'function') {
                    graveTopContainer.classList.remove('empty');
                    graveTopContainer.innerHTML = '';
                    const graveCardEl = makeCard(card, false);
                    graveCardEl.classList.add('grave-card', 'in-graveyard');
                    graveTopContainer.appendChild(graveCardEl);
                    graveTopContainer.dataset.topCardUid = card.uid || card.id;
                    console.log(`[SpellReveal] Card placed in graveyard DOM: ${card.name || card.id} uid=${card.uid || card.id} side=${side} graveBlocked=${graveRenderBlocked.has(side)}`);
                }
                // graveRenderBlocked reste actif (posé par queueAnimation)
                // updateGraveTopCard le retirera quand le state aura rattrapé

                wrapper.remove();
                if (perspContainer) perspContainer.remove();
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

async function animateSpell(data) {
    // Fly from opponent hand before revealing the spell
    if (data.spell && data.caster !== myNum) {
        const gameBoard = document.querySelector('.game-board');
        if (gameBoard) {
            const gbRect = gameBoard.getBoundingClientRect();
            const cardW = 105, cardH = 140, sc = 1.8;
            const showcaseX = gbRect.left + gbRect.width * 0.80 - (cardW * sc) / 2;
            const showcaseY = gbRect.top + gbRect.height * 0.45 - (cardH * sc) / 2;
            await flyFromOppHand({ left: showcaseX, top: showcaseY, width: cardW * sc, height: cardH * sc }, 300);
        }
    }
    // Afficher la carte du sort avec animation de révélation
    if (data.spell) {
        await animateSpellReveal(data.spell, data.caster);
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

    const trapRect = trapSlot.getBoundingClientRect();

    function showTrapReveal() {
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

    // Si c'est l'adversaire, faire voler la carte de la main d'abord
    if (owner === 'opp') {
        flyFromOppHand(trapRect, 280).then(showTrapReveal);
    } else {
        showTrapReveal();
    }
}

async function animateTrap(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const trapSlot = document.querySelector(`.trap-slot[data-owner="${owner}"][data-row="${data.row}"]`);
    console.log(`[TRAP] animateTrap START owner=${owner} row=${data.row} hasTrap=${!!data.trap} graveBlocked=${graveRenderBlocked.has(owner)} trapSlotHasTrap=${trapSlot?.classList.contains('has-trap')}`);

    // 1. Afficher la carte du piège avec animation de révélation
    if (data.trap) {
        await animateSpellReveal(data.trap, data.player);
    }
    console.log(`[TRAP] animateSpellReveal DONE owner=${owner} graveBlocked=${graveRenderBlocked.has(owner)} trapSlotHasTrap=${trapSlot?.classList.contains('has-trap')}`);

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
        setTimeout(() => {
            trapSlot.classList.remove('triggered');
            console.log(`[TRAP] explosion cleanup DONE owner=${owner} row=${data.row}`);
        }, 600);
    }
    console.log(`[TRAP] animateTrap END owner=${owner} row=${data.row}`);
}

// === Système de bounce (Voyage inattendu) ===
// Carte bounced en attente : sera cachée au prochain render, puis l'animation atterrit dessus
let pendingBounce = null;   // { owner, card, wrapper, resolveTarget }

/**
 * Appelé par renderOppHand / renderHand pour savoir si la dernière carte
 * vient d'un bounce et doit être cachée + rendue face visible
 */
function checkPendingBounce(owner, cardElements) {
    if (!pendingBounce || pendingBounce.owner !== owner) return;
    // La carte bouncée est la dernière de la main
    const target = cardElements[cardElements.length - 1];
    if (!target) return;
    target.style.visibility = 'hidden';
    const rect = target.getBoundingClientRect();
    console.log(`[Bounce] checkPendingBounce owner=${owner} targetIndex=${cardElements.length - 1} rect=`, rect.left.toFixed(1), rect.top.toFixed(1), rect.width.toFixed(1), rect.height.toFixed(1), 'tagName=', target.tagName, 'className=', target.className);
    pendingBounce.resolveTarget({
        el: target,
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height
    });
    pendingBounce = null;
}

/**
 * Animation de bounce (Voyage inattendu) — style pioche inversée professionnelle
 *
 * Phase 1 - Lift (200ms):   Carte se soulève du slot avec glow magique
 * Phase 2 - Wait:           Carte flotte en attendant la position exacte de render()
 * Phase 3 - Fly (450ms):    Arc Bézier fluide DIRECTEMENT vers la position exacte (pas d'approximation)
 */
async function animateBounceToHand(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;
    animatingSlots.add(slotKey);

    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) {
        animatingSlots.delete(slotKey);
        return;
    }

    const cardInSlot = slot.querySelector('.card');
    const slotRect = slot.getBoundingClientRect();

    // Dimensions de la carte sur le board
    const cardWidth = 105;
    const cardHeight = 140;
    const startX = slotRect.left + slotRect.width / 2 - cardWidth / 2;
    const startY = slotRect.top + slotRect.height / 2 - cardHeight / 2;

    // Cacher la vraie carte dans le slot
    if (cardInSlot) cardInSlot.style.visibility = 'hidden';

    // Créer le wrapper animé
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

    // Carte face visible — préserver le backgroundImage
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

    // Easings
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

    // === PHASE 1 : LIFT (200ms) — carte se soulève du slot ===
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

    // === PHASE 2 : WAIT — flottement magique en attendant la cible exacte ===
    // Convertir de scale vers coordonnées visuelles réelles (pas de changement visuel)
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

    // Enregistrer le pending bounce — render() fournira la position exacte
    const targetPromise = new Promise(resolve => {
        pendingBounce = { owner, card: data.card, wrapper, resolveTarget: resolve };
    });

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
        // Position de départ = position flottante actuelle
        const flyX0 = floatX;
        const flyY0 = parseFloat(wrapper.style.top); // inclut le bob
        const flyW0 = floatW;
        const flyH0 = floatH;

        // Position d'arrivée = exactement la carte dans la main
        const endX = target.x;
        const endY = target.y;
        const endW = target.w;
        const endH = target.h;

        // Point de contrôle Bézier : au-dessus pour un bel arc
        const ctrlX = (flyX0 + endX) / 2;
        const ctrlY = Math.min(flyY0, endY) - 80;

        const flyDuration = 450;

        await new Promise(resolve => {
            const t0 = performance.now();
            function animate() {
                const p = Math.min((performance.now() - t0) / flyDuration, 1);
                const t = easeInOutCubic(p);

                // Arc Bézier quadratique pour la position
                const x = (1-t)*(1-t)*flyX0 + 2*(1-t)*t*ctrlX + t*t*endX;
                const y = (1-t)*(1-t)*flyY0 + 2*(1-t)*t*ctrlY + t*t*endY;
                // Interpolation linéaire de la taille
                const w = flyW0 + (endW - flyW0) * t;
                const h = flyH0 + (endH - flyH0) * t;
                // Glow décroissant
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
                    target.el.style.visibility = 'visible';
                    wrapper.remove();
                    resolve();
                }
            }
            requestAnimationFrame(animate);
        });
    } else {
        // Timeout : pas de render reçu, fade out proprement
        wrapper.style.transition = 'opacity 0.2s';
        wrapper.style.opacity = '0';
        setTimeout(() => wrapper.remove(), 200);
    }

    animatingSlots.delete(slotKey);
}

// Slots en cours d'animation - render() ne doit pas les toucher
let animatingSlots = new Set();
// Slots avec deathTransform EN COURS D'EXÉCUTION (protégés contre resetAnimationStates)
let activeDeathTransformSlots = new Set();


/**
 * Réinitialise tous les états d'animation pour éviter les bugs de persistance
 * Appelé au début de chaque nouveau tour
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
        if ((item.type === 'damage' || item.type === 'spellDamage') && item.data) {
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
            console.log('[Reset] Keeping animatingSlot (active deathTransform running):', key);
        } else if (!slotsStillNeeded.has(key)) {
            animatingSlots.delete(key);
        } else {
            console.log('[Reset] Keeping animatingSlot (pending in queue):', key);
        }
    }

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

/**
 * Anime un dos de carte volant de la main adverse vers une position cible.
 * Retourne une Promise résolue quand l'animation est terminée.
 * @param {DOMRect} targetRect - Rectangle cible (slot, trap, centre)
 * @param {number} duration - Durée en ms (défaut 300)
 * @returns {Promise<void>}
 */
function flyFromOppHand(targetRect, duration = 300) {
    return new Promise(resolve => {
        const handPanel = document.getElementById('opp-hand');
        const handCards = handPanel ? handPanel.querySelectorAll('.opp-card-back') : [];
        const lastCard = handCards[handCards.length - 1];

        if (!lastCard) { resolve(); return; }

        const handRect = lastCard.getBoundingClientRect();
        // Ne PAS cacher la carte ici : le emitStateToBoth (bonus--)
        // a déjà réduit le handCount et déclenché un REBUILD qui a retiré
        // la carte du DOM. On prend juste la position pour l'animation.

        // Créer la carte volante directement à la taille cible (comme un drag)
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
        const flyImg = document.createElement('img');
        flyImg.src = 'css/back1.png';
        flyImg.style.cssText = 'width: 100%; height: 100%; display: block;';
        flyCard.appendChild(flyImg);
        document.body.appendChild(flyCard);

        // Trajectoire par centres
        const scx = handRect.left + handRect.width / 2;
        const scy = handRect.top + handRect.height / 2;
        const ecx = targetRect.left + fw / 2;
        const ecy = targetRect.top + fh / 2;
        const ccx = (scx + ecx) / 2;
        const ccy = Math.max(scy, ecy) + 50;

        function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

        const t0 = performance.now();
        function animate() {
            const p = Math.min((performance.now() - t0) / duration, 1);
            const t = easeInOutCubic(p);

            // Centre sur la courbe de Bézier
            const cx = (1-t)*(1-t)*scx + 2*(1-t)*t*ccx + t*t*ecx;
            const cy = (1-t)*(1-t)*scy + 2*(1-t)*t*ccy + t*t*ecy;

            // Convertir centre → top-left (taille fixe)
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

// Animation d'invocation - overlay indépendant du render
// Carte adverse : vole de la main vers le slot puis apparaît
function animateSummon(data) {
    // Animation d'invocation pour ses propres créatures
    // Délai pour synchroniser la fin avec l'animation adverse (fly+flip ≈ 1040ms, ripple ≈ 820ms)
    if (data.player === myNum) {
        setTimeout(() => {
            const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${data.row}"][data-col="${data.col}"]`);
            if (!slot) return;

            slot.classList.add('summoning');

            const flash = document.createElement('div');
            flash.className = 'summon-flash';
            slot.appendChild(flash);

            const ring1 = document.createElement('div');
            ring1.className = 'summon-ring';
            slot.appendChild(ring1);

            setTimeout(() => {
                const ring2 = document.createElement('div');
                ring2.className = 'summon-ring';
                slot.appendChild(ring2);
                setTimeout(() => ring2.remove(), 700);
            }, 120);

            setTimeout(() => {
                flash.remove();
                ring1.remove();
                slot.classList.remove('summoning');
            }, 800);
        }, 220);

        return;
    }

    const owner = 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    // Le slot devrait déjà être bloqué par blockSlots, mais on s'assure
    animatingSlots.add(slotKey);

    // Trouver le slot cible
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) { animatingSlots.delete(slotKey); return; }

    // Vider le slot (au cas où)
    const label = slot.querySelector('.slot-label');
    slot.innerHTML = '';
    if (label) slot.appendChild(label.cloneNode(true));
    slot.classList.remove('has-card');

    const rect = slot.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;

    // Phase 1 : carte-dos vole de la main adverse vers le slot (300ms)
    flyFromOppHand(rect, 300).then(() => {
        // Construire le conteneur 3D avec deux faces (dos + face)
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

        // Dos de la carte
        const backFace = document.createElement('div');
        backFace.style.cssText = `
            position: absolute; top: 0; left: 0;
            width: 100%; height: 100%; margin: 0;
            border-radius: 6px; overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            backface-visibility: hidden;
        `;
        const backImg = document.createElement('img');
        backImg.src = 'css/back1.png';
        backImg.style.cssText = 'width: 100%; height: 100%; display: block;';
        backFace.appendChild(backImg);

        // Face avant (la vraie carte)
        const cardEl = makeCard(data.card, false);
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

        flipInner.appendChild(backFace);
        flipInner.appendChild(cardEl);
        wrapper.appendChild(flipInner);
        document.body.appendChild(wrapper);

        // Animation : Lever → Flip → Poser
        const liftDur = 180;    // montée
        const flipDur = 380;    // retournement
        const settleDur = 180;  // descente
        const liftPx = 25;     // hauteur de levée
        const startY = rect.top;
        const t0 = performance.now();

        function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
        function easeInOutQuad(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }
        function easeInCubic(t) { return t * t * t; }

        function animate() {
            const elapsed = performance.now() - t0;

            if (elapsed < liftDur) {
                // Phase 2 : Lever (on voit le dos)
                const p = easeOutCubic(elapsed / liftDur);
                wrapper.style.top = (startY - liftPx * p) + 'px';
            } else if (elapsed < liftDur + flipDur) {
                // Phase 3 : Flip 3D
                wrapper.style.top = (startY - liftPx) + 'px';
                const p = easeInOutQuad((elapsed - liftDur) / flipDur);
                flipInner.style.transform = `rotateY(${180 * p}deg)`;
            } else if (elapsed < liftDur + flipDur + settleDur) {
                // Phase 4 : Reposer au bon endroit
                flipInner.style.transform = 'rotateY(180deg)';
                const p = easeInCubic((elapsed - liftDur - flipDur) / settleDur);
                wrapper.style.top = (startY - liftPx + liftPx * p) + 'px';
            } else {
                // Terminé
                wrapper.remove();
                animatingSlots.delete(slotKey);
                render();
                return;
            }

            requestAnimationFrame(animate);
        }

        requestAnimationFrame(animate);
    });
}

function animateMove(data) {
    // Animation de coup de vent pour ses propres créatures déplacées
    // Délai pour synchroniser la fin avec l'animation adverse (slide ≈ 500ms, vent ≈ 480ms)
    if (data.player === myNum) {
        setTimeout(() => {
            const toSlot = document.querySelector(`.card-slot[data-owner="me"][data-row="${data.toRow}"][data-col="${data.toCol}"]`);
            if (!toSlot) return;

            const rect = toSlot.getBoundingClientRect();
            const dx = data.toCol - data.fromCol;
            const dy = data.toRow - data.fromRow;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);

            // Overlay fixe (pas enfant du slot → survit au render)
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed; z-index: 2000; pointer-events: none;
                left: ${rect.left}px; top: ${rect.top}px;
                width: ${rect.width}px; height: ${rect.height}px;
            `;

            // Container rotatif orienté dans la direction du déplacement
            const gustInner = document.createElement('div');
            gustInner.className = 'wind-gust';
            gustInner.style.transform = `rotate(${angle}deg)`;
            overlay.appendChild(gustInner);

            // Traînées de vent avec offsets naturels
            const offsets = [12, 28, 48, 66, 84];
            const delays = [0, 45, 20, 70, 100];
            const widths = [45, 60, 55, 50, 40];
            for (let i = 0; i < 5; i++) {
                const streak = document.createElement('div');
                streak.className = 'wind-streak';
                streak.style.top = offsets[i] + '%';
                streak.style.animationDelay = delays[i] + 'ms';
                streak.style.width = widths[i] + '%';
                gustInner.appendChild(streak);
            }

            // Flash lumineux par-dessus la carte
            const flash = document.createElement('div');
            flash.className = 'wind-flash';
            overlay.appendChild(flash);

            document.body.appendChild(overlay);

            setTimeout(() => overlay.remove(), 650);
        }, 20);
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

// ==================== MODE TEST ====================

function showModeSelector() {
    document.getElementById('mode-selector-overlay').classList.remove('hidden');
}

function selectMode(mode) {
    document.getElementById('mode-selector-overlay').classList.add('hidden');
    if (mode === 'normal') {
        showMulligan();
    } else if (mode === 'test') {
        showCardPicker();
    }
}

function showCardPicker() {
    testModeSelection = [];
    const overlay = document.getElementById('card-picker-overlay');
    const grid = document.getElementById('card-picker-grid');

    // Afficher l'overlay immédiatement avec un état de chargement
    overlay.classList.remove('hidden');
    grid.innerHTML = '<div class="picker-loading">Chargement des cartes...</div>';

    socket.emit('requestCardCatalog', (catalog) => {
        if (!catalog || (!catalog.creatures && !catalog.spells && !catalog.traps)) {
            grid.innerHTML = '<div class="picker-loading" style="color:#e74c3c;">Erreur: catalogue vide</div>';
            console.error('requestCardCatalog returned empty catalog:', catalog);
            return;
        }
        cardCatalog = catalog;
        renderPickerGrid('creatures');
        updatePickerUI();
    });

    // Timeout de sécurité si le callback ne revient jamais
    setTimeout(() => {
        if (!cardCatalog) {
            grid.innerHTML = '<div class="picker-loading" style="color:#e74c3c;">Le serveur ne répond pas. Rechargez la page.</div>';
            console.error('requestCardCatalog timeout - no response from server');
        }
    }, 5000);
}

function renderPickerGrid(tab) {
    const grid = document.getElementById('card-picker-grid');
    grid.innerHTML = '';

    document.querySelectorAll('.picker-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    const cards = cardCatalog[tab] || [];

    cards.forEach(cardTemplate => {
        const wrapper = document.createElement('div');
        wrapper.className = 'picker-card-wrapper';

        const cardEl = makeCard(cardTemplate, true);
        cardEl.style.cursor = 'default';
        cardEl.style.pointerEvents = 'none';
        wrapper.appendChild(cardEl);

        const addBtn = document.createElement('button');
        addBtn.className = 'picker-add-btn';
        addBtn.textContent = 'Ajouter';
        addBtn.onclick = () => addToTestHand(cardTemplate);
        wrapper.appendChild(addBtn);

        grid.appendChild(wrapper);
    });
}

function switchPickerTab(tab) {
    renderPickerGrid(tab);
}

function addToTestHand(cardTemplate) {
    if (testModeSelection.length >= 7) return;
    testModeSelection.push({ ...cardTemplate });
    updatePickerUI();
}

function removeFromTestHand(index) {
    testModeSelection.splice(index, 1);
    updatePickerUI();
}

function updatePickerUI() {
    const counter = document.getElementById('card-picker-counter');
    counter.textContent = `${testModeSelection.length} / 7 cartes`;

    const row = document.getElementById('card-picker-selection-row');
    row.innerHTML = '';

    testModeSelection.forEach((card, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'picker-selection-thumb';

        const cardEl = makeCard(card, true);
        cardEl.style.pointerEvents = 'none';
        thumb.appendChild(cardEl);

        thumb.onclick = () => removeFromTestHand(i);

        const removeBadge = document.createElement('div');
        removeBadge.className = 'picker-remove-badge';
        removeBadge.textContent = '\u00D7';
        thumb.appendChild(removeBadge);

        row.appendChild(thumb);
    });

    const startBtn = document.getElementById('picker-start-btn');
    startBtn.disabled = testModeSelection.length < 1;

    document.querySelectorAll('.picker-add-btn').forEach(btn => {
        btn.disabled = testModeSelection.length >= 7;
    });
}

function confirmTestHand() {
    if (testModeSelection.length < 1) return;
    const cardIds = testModeSelection.map(c => c.id);

    socket.emit('setTestHand', cardIds, (response) => {
        if (response.success) {
            document.getElementById('card-picker-overlay').classList.add('hidden');
            showMulligan();
        } else {
            console.error('setTestHand failed:', response.error);
        }
    });
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
        document.querySelectorAll('.card-slot.cross-target').forEach(s => {
            const card = s.querySelector('.card');
            if (card) card.classList.remove('spell-hover-target');
            s.classList.remove('cross-target');
        });
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
        document.querySelectorAll('.card-slot.cross-target').forEach(s => {
            const card = s.querySelector('.card');
            if (card) card.classList.remove('spell-hover-target');
            s.classList.remove('cross-target');
        });
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
        // Vérifier les conditions d'invocation spéciales (ex: Kraken Colossal)
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) return valid;
        }
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
        // Sorts qui ciblent un slot vide ennemi (ex: Plan douteux)
        else if (card.targetEmptySlot) {
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    if (!state.opponent.field[row][col]) {
                        valid.push({ owner: 'opp', row, col });
                    }
                }
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
    document.querySelectorAll('.card-slot.cross-target').forEach(s => {
        s.classList.remove('cross-target');
        const card = s.querySelector('.card');
        if (card) card.classList.remove('spell-hover-target');
    });

    const targetPlayer = targetOwner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
    const adjacents = getCrossTargetsClient(targetPlayer, row, col);

    // Centre en orange aussi (cross-target prime sur drag-over/valid-target)
    const centerSlot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${row}"][data-col="${col}"]`);
    if (centerSlot) {
        centerSlot.classList.add('cross-target');
        const centerCard = centerSlot.querySelector('.card');
        if (centerCard) centerCard.classList.add('spell-hover-target');
    }

    // Adjacents en orange + bordure orange sur les créatures présentes
    adjacents.forEach(t => {
        const owner = t.player === myNum ? 'me' : 'opp';
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${t.row}"][data-col="${t.col}"]`);
        if (slot) {
            slot.classList.add('cross-target');
            const card = slot.querySelector('.card');
            if (card) card.classList.add('spell-hover-target');
        }
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
    if (card.abilities?.includes('immovable')) return;
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

// ==========================================
// Rank Badge System
// ==========================================
const RANK_CONFIG = {
    bronze: {
        name: 'Bronze',
        primary: '#E88A4C', secondary: '#C46A30', highlight: '#FFB87A',
        dark: '#8B4513', glow: 'rgba(232, 138, 76, 0.5)',
        borderLight: '#FFEECC', borderMid: '#FFD4A8'
    },
    silver: {
        name: 'Argent',
        primary: '#B8C8D8', secondary: '#8BA4BC', highlight: '#E8F0FF',
        dark: '#5A7088', glow: 'rgba(184, 200, 216, 0.5)',
        borderLight: '#FFFFFF', borderMid: '#D8E4F0'
    },
    gold: {
        name: 'Or',
        primary: '#FFD060', secondary: '#E8A830', highlight: '#FFF0A0',
        dark: '#A87820', glow: 'rgba(255, 208, 96, 0.6)',
        borderLight: '#FFFFD8', borderMid: '#FFE898'
    },
    emerald: {
        name: 'Émeraude',
        primary: '#50D080', secondary: '#30A858', highlight: '#90FFB0',
        dark: '#1A7838', glow: 'rgba(80, 208, 128, 0.5)',
        borderLight: '#C0FFD8', borderMid: '#80F0A8'
    },
    diamond: {
        name: 'Diamant',
        primary: '#D8C8F8', secondary: '#A890E0', highlight: '#FFFFFF',
        dark: '#7860B8', glow: 'rgba(216, 200, 248, 0.6)',
        borderLight: '#FFFFFF', borderMid: '#E8DCF8'
    },
    mythic: {
        name: 'Mythique',
        primary: '#FF6B35', secondary: '#E84A10', highlight: '#FFAA80',
        dark: '#A02800', glow: 'rgba(255, 107, 53, 0.6)',
        borderLight: '#FFDDCC', borderMid: '#FFAA80'
    }
};

function generateRankGemSVG(rank, tier, uniqueId) {
    const c = RANK_CONFIG[rank];
    const gradId = `bg-${uniqueId}`;
    const gradDef = `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">` +
        `<stop offset="0%" stop-color="${c.borderLight}"/>` +
        `<stop offset="30%" stop-color="${c.borderMid}"/>` +
        `<stop offset="50%" stop-color="${c.borderLight}"/>` +
        `<stop offset="70%" stop-color="${c.borderMid}"/>` +
        `<stop offset="100%" stop-color="${c.borderLight}"/>` +
        `</linearGradient></defs>`;

    if (rank === 'mythic') {
        const pts = [], gPts = [];
        for (let i = 0; i < 12; i++) {
            const a = (i * 30 - 90) * Math.PI / 180;
            pts.push(`${(50+42*Math.cos(a)).toFixed(1)},${(50+42*Math.sin(a)).toFixed(1)}`);
            gPts.push({x: 50+41*Math.cos(a), y: 50+41*Math.sin(a)});
        }
        let facets = '';
        gPts.forEach((p, i) => {
            const np = gPts[(i+1)%12];
            let fill, op;
            if (i < 3) { fill = c.highlight; op = 0.55 - i*0.08; }
            else if (i < 6) { fill = c.primary; op = 0.7; }
            else if (i < 9) { fill = c.secondary; op = 0.6 + (i-6)*0.1; }
            else { fill = c.dark; op = 0.55; }
            facets += `<path d="M50 50 L${p.x.toFixed(1)} ${p.y.toFixed(1)} L${np.x.toFixed(1)} ${np.y.toFixed(1)} Z" fill="${fill}" opacity="${op}"/>`;
        });
        return gradDef +
            `<polygon points="${pts.join(' ')}" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linejoin="round"/>` +
            `<polygon points="${gPts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="${c.primary}"/>` +
            facets;
    }

    if (tier === 1) {
        return gradDef +
            `<path d="M50 8 L92 50 L50 92 L8 50 Z" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linejoin="round"/>` +
            `<path d="M50 9 L91 50 L50 91 L9 50 Z" fill="${c.primary}"/>` +
            `<path d="M50 9 L9 50 L50 50 Z" fill="${c.highlight}" opacity="0.5"/>` +
            `<path d="M50 9 L91 50 L50 50 Z" fill="${c.highlight}" opacity="0.3"/>` +
            `<path d="M50 91 L9 50 L50 50 Z" fill="${c.secondary}"/>` +
            `<path d="M50 91 L91 50 L50 50 Z" fill="${c.dark}" opacity="0.6"/>`;
    }
    if (tier === 2) {
        return gradDef +
            `<path d="M50 8 L87 29 L87 71 L50 92 L13 71 L13 29 Z" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linejoin="round"/>` +
            `<path d="M50 9 L86 29.5 L86 70.5 L50 91 L14 70.5 L14 29.5 Z" fill="${c.primary}"/>` +
            `<path d="M50 9 L14 29.5 L50 50 Z" fill="${c.highlight}" opacity="0.6"/>` +
            `<path d="M50 9 L86 29.5 L50 50 Z" fill="${c.highlight}" opacity="0.35"/>` +
            `<path d="M14 29.5 L14 70.5 L50 50 Z" fill="${c.highlight}" opacity="0.3"/>` +
            `<path d="M86 29.5 L86 70.5 L50 50 Z" fill="${c.secondary}" opacity="0.5"/>` +
            `<path d="M50 91 L14 70.5 L50 50 Z" fill="${c.secondary}" opacity="0.9"/>` +
            `<path d="M50 91 L86 70.5 L50 50 Z" fill="${c.dark}" opacity="0.6"/>`;
    }
    if (tier === 3) {
        return gradDef +
            `<path d="M50 8 L79 21 L92 50 L79 79 L50 92 L21 79 L8 50 L21 21 Z" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linejoin="round"/>` +
            `<path d="M50 9 L78.5 21.5 L91 50 L78.5 78.5 L50 91 L21.5 78.5 L9 50 L21.5 21.5 Z" fill="${c.primary}"/>` +
            `<path d="M50 9 L21.5 21.5 L50 50 Z" fill="${c.highlight}" opacity="0.6"/>` +
            `<path d="M50 9 L78.5 21.5 L50 50 Z" fill="${c.highlight}" opacity="0.4"/>` +
            `<path d="M21.5 21.5 L9 50 L50 50 Z" fill="${c.highlight}" opacity="0.45"/>` +
            `<path d="M78.5 21.5 L91 50 L50 50 Z" fill="${c.primary}" opacity="0.8"/>` +
            `<path d="M9 50 L21.5 78.5 L50 50 Z" fill="${c.secondary}" opacity="0.6"/>` +
            `<path d="M91 50 L78.5 78.5 L50 50 Z" fill="${c.dark}" opacity="0.4"/>` +
            `<path d="M50 91 L21.5 78.5 L50 50 Z" fill="${c.secondary}" opacity="0.9"/>` +
            `<path d="M50 91 L78.5 78.5 L50 50 Z" fill="${c.dark}" opacity="0.65"/>`;
    }
    // tier 4 - decagon
    const pts = [], gPts = [];
    for (let i = 0; i < 10; i++) {
        const a = (i * 36 - 90) * Math.PI / 180;
        pts.push(`${(50+42*Math.cos(a)).toFixed(1)},${(50+42*Math.sin(a)).toFixed(1)}`);
        gPts.push({x: 50+41*Math.cos(a), y: 50+41*Math.sin(a)});
    }
    let facets = '';
    gPts.forEach((p, i) => {
        const np = gPts[(i+1)%10];
        let fill, op;
        if (i < 3) { fill = c.highlight; op = 0.5 - i*0.1; }
        else if (i < 5) { fill = c.primary; op = 0.7; }
        else if (i < 8) { fill = c.secondary; op = 0.6 + (i-5)*0.1; }
        else { fill = c.dark; op = 0.5; }
        facets += `<path d="M50 50 L${p.x.toFixed(1)} ${p.y.toFixed(1)} L${np.x.toFixed(1)} ${np.y.toFixed(1)} Z" fill="${fill}" opacity="${op}"/>`;
    });
    return gradDef +
        `<polygon points="${pts.join(' ')}" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linejoin="round"/>` +
        `<polygon points="${gPts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="${c.primary}"/>` +
        facets;
}

function createRankBadge(rank, tier, mythicPosition) {
    const c = RANK_CONFIG[rank];
    const tierLabels = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
    const uid = `rank-${rank}-${tier}-${Date.now()}`;

    const wrapper = document.createElement('div');
    wrapper.className = 'rank-badge';

    // SVG gem
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgWrapper = document.createElement('div');
    svgWrapper.className = 'rank-gem';
    svgWrapper.innerHTML = `<svg viewBox="0 0 100 100">${generateRankGemSVG(rank, tier, uid)}</svg>`;
    wrapper.appendChild(svgWrapper);

    // Tier label
    const label = document.createElement('div');
    label.className = 'rank-tier-label';
    label.style.color = c.primary;
    label.textContent = rank === 'mythic' ? `#${mythicPosition || 1}` : tierLabels[tier];
    wrapper.appendChild(label);

    return wrapper;
}

function setRandomRanks() {
    const ranks = ['bronze', 'silver', 'gold', 'emerald', 'diamond'];
    const tiers = [1, 2, 3, 4];

    // Inclure mythic avec une petite chance
    const useMythic = Math.random() < 0.1;

    const meContainer = document.getElementById('me-rank-badge');
    const oppContainer = document.getElementById('opp-rank-badge');

    if (meContainer) {
        meContainer.innerHTML = '';
        if (useMythic) {
            meContainer.appendChild(createRankBadge('mythic', 1, Math.floor(Math.random() * 200) + 1));
        } else {
            const r = ranks[Math.floor(Math.random() * ranks.length)];
            const t = tiers[Math.floor(Math.random() * tiers.length)];
            meContainer.appendChild(createRankBadge(r, t));
        }
    }
    if (oppContainer) {
        oppContainer.innerHTML = '';
        const r = ranks[Math.floor(Math.random() * ranks.length)];
        const t = tiers[Math.floor(Math.random() * tiers.length)];
        oppContainer.appendChild(createRankBadge(r, t));
    }
}

function render() {
    if (!state) return;
    const me = state.me, opp = state.opponent;

    // Ne pas mettre à jour les HP si une animation zdejebel/trample est en cours ou en attente
    // Ces animations gèrent elles-mêmes l'affichage des HP
    const hasHpAnimPending = animationQueue.some(a => a.type === 'zdejebel' || a.type === 'trampleHeroHit' || (a.type === 'onDeathDamage' && a.data?.targetRow === undefined)) || zdejebelAnimationInProgress;
    if (!hasHpAnimPending) {
        const meHpNum = document.querySelector('#me-hp .hero-hp-number');
        const oppHpNum = document.querySelector('#opp-hp .hero-hp-number');
        const meOld = meHpNum?.textContent, oppOld = oppHpNum?.textContent;
        if (meHpNum) meHpNum.textContent = me.hp;
        if (oppHpNum) oppHpNum.textContent = opp.hp;
        if (meOld !== String(me.hp) || oppOld !== String(opp.hp)) {
            console.log(`[render] HP updated: me ${meOld}→${me.hp} opp ${oppOld}→${opp.hp}`);
        }
    } else {
        const meHpNum = document.querySelector('#me-hp .hero-hp-number');
        const oppHpNum = document.querySelector('#opp-hp .hero-hp-number');
        console.log(`[render] HP BLOCKED (zdejebelInProgress=${zdejebelAnimationInProgress} queueTypes=${animationQueue.map(a=>a.type)}) DOM: me=${meHpNum?.textContent} opp=${oppHpNum?.textContent} state: me=${me.hp} opp=${opp.hp}`);
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

    renderOppHand(opp.handCount, opp.oppHand);

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
    stack.classList.remove('has-cards', 'cards-1', 'cards-2', 'cards-3');

    if (count > 0) {
        stack.classList.add('has-cards');
        if (count === 1) stack.classList.add('cards-1');
        else if (count === 2) stack.classList.add('cards-2');
        else if (count === 3) stack.classList.add('cards-3');
    }

    // Remplir les layers avec de vraies cartes
    const layers = stack.querySelectorAll('.grave-card-layer');
    layers.forEach((layer, i) => {
        // Layer 0 (nth-child(1), bottom, most offset): graveyard[count-4]
        // Layer 1 (nth-child(2), middle):              graveyard[count-3]
        // Layer 2 (nth-child(3), top layer):           graveyard[count-2]
        const cardIndex = count - (3 - i) - 1;
        const card = (cardIndex >= 0 && graveyard) ? graveyard[cardIndex] : null;
        const cardId = card ? (card.uid || card.id) : '';

        // Cache: ne re-render que si la carte a changé
        if (layer.dataset.cardUid === cardId) return;
        layer.dataset.cardUid = cardId;
        layer.innerHTML = '';

        if (card) {
            const cardEl = makeCard(card, false);
            cardEl.classList.add('grave-card', 'in-graveyard');
            layer.appendChild(cardEl);
        }
    });
}

function updateGraveTopCard(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) {
        // Rester bloqué — l'animation (burn, death, spell, trap) débloquera elle-même
        // quand elle sera terminée et appellera updateGraveTopCard à ce moment-là
        console.log('[GRAVE TOP] BLOCKED for', owner, '(graveRenderBlocked active)');
        return;
    }
    const container = document.getElementById(`${owner}-grave-top`);
    if (!container) return;
    console.log('[GRAVE TOP] Updating', owner, '| graveyard:', graveyard?.length, graveyard?.map(c => c.id), '| current topCardUid:', container.dataset.topCardUid);

    if (graveyard && graveyard.length > 0) {
        const topCard = graveyard[graveyard.length - 1];
        const topId = topCard.uid || topCard.id;
        if (container.dataset.topCardUid === topId) return;
        console.log(`[GRAVE TOP] RE-RENDERING ${owner} topCard=${topId} (was: ${container.dataset.topCardUid}) childCount=${container.children.length}`);
        container.dataset.topCardUid = topId;
        container.classList.remove('empty');
        container.innerHTML = '';
        const cardEl = makeCard(topCard, false);
        cardEl.classList.add('grave-card', 'in-graveyard');
        container.appendChild(cardEl);
    } else {
        if (container.classList.contains('empty') && container.children.length === 0) return;
        console.log(`[GRAVE TOP] CLEARING ${owner} graveyard empty (was: ${container.dataset.topCardUid} childCount=${container.children.length})`);
        delete container.dataset.topCardUid;
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

            const hadCard = slot.classList.contains('has-card');
            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));

            slot.classList.remove('has-card');
            slot.classList.remove('has-flying');
            const card = field[r][c];

            // Log quand une carte disparait du slot (aide au debug des animations de mort)
            if (hadCard && !card) {
                console.log(`[renderField] Card REMOVED from slot ${slotKey} by render (state=null)`);
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

                // Indicateur de bouclier (Protection) — Bouclier Nid d'Abeilles SVG
                if (card.hasProtection) {
                    cardEl.style.position = 'relative';
                    cardEl.style.overflow = 'visible';
                    cardEl.appendChild(createShieldOverlay(slotKey));
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

    power: { name: 'Puissance', desc: 'Quand cette créature subit des dégâts sans mourir, elle gagne +X ATK (X = valeur de Puissance).' },
    cleave: { name: 'Clivant', desc: 'Quand cette créature attaque, elle inflige X dégâts aux créatures sur les lignes adjacentes. Ces créatures ne ripostent pas.' },
    immovable: { name: 'Immobile', desc: 'Cette créature ne peut pas se déplacer.' },
    regeneration: { name: 'Régénération', desc: 'En fin de tour, cette créature récupère X PV (sans dépasser ses PV max).' },
    protection: { name: 'Protection', desc: 'Cette créature est protégée contre la prochaine source de dégâts qu\'elle subirait. Le bouclier est consommé après avoir bloqué une source.' }
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
            const hadTrap = slot.classList.contains('has-trap');
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
                if (hadTrap) {
                    console.log(`[renderTraps] me trap row=${i} CLEARED (was has-trap, now null) triggered=${slot.classList.contains('triggered')}`, new Error().stack.split('\n').slice(1,4).join(' <- '));
                }
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
            const hadTrap = slot.classList.contains('has-trap');
            slot.classList.remove('has-trap', 'mine');
            if (trap) {
                slot.classList.add('has-trap');
                slot.innerHTML = '<img class="trap-icon-img enemy" src="/css/beartraparmed.png" alt="trap">';
            } else {
                if (hadTrap) {
                    console.log(`[renderTraps] opp trap row=${i} CLEARED (was has-trap, now null) triggered=${slot.classList.contains('triggered')}`, new Error().stack.split('\n').slice(1,4).join(' <- '));
                }
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

        // Retirer playable si aucun slot libre sur le board (créatures et pièges)
        if ((card.type === 'creature' || card.type === 'trap') && getValidSlots(card).length === 0) {
            el.classList.remove('playable');
        }

        // Z-index incrémental pour éviter les saccades au hover
        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente
        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i)) {
            el.style.visibility = 'hidden';
        }

        // Vérifier les conditions d'invocation spéciales (ex: Kraken Colossal)
        let cantSummon = false;
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }

        // Custom drag
        const tooExpensive = effectiveCost > energy || cantSummon;
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

    // Bounce : cacher la dernière carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'me') {
        const allCards = panel.querySelectorAll('.card');
        checkPendingBounce('me', allCards);
    }
}

function renderOppHand(count, oppHand) {
    const panel = document.getElementById('opp-hand');
    const oldCards = panel.querySelectorAll('.opp-card-back');
    const oldCount = oldCards.length;
    const drawActive = typeof GameAnimations !== 'undefined' && GameAnimations.hasActiveDrawAnimation('opp');

    // --- Mode incrémental : ne PAS détruire le DOM pendant une animation de pioche ---
    if (drawActive && count >= oldCount) {
        // Remappe les indices de pioche opp vers les nouvelles cartes en fin de main
        // Le serveur renvoie un handIndex interne, mais côté DOM toutes les cartes adverses
        // sont des dos identiques — on anime toujours la nouvelle carte à la fin
        if (count > oldCount) {
            GameAnimations.remapOppDrawIndices(oldCount);
        }
        // Cartes existantes :
        // - Si la main grandit (count > oldCount) : garder visibles (la nouvelle carte à la fin sera cachée)
        // - Si même taille (count == oldCount) : cacher la carte ciblée par l'animation pending
        for (let i = 0; i < oldCount; i++) {
            if (count === oldCount) {
                const shouldHide = GameAnimations.shouldHideCard('opp', i);
                oldCards[i].style.visibility = shouldHide ? 'hidden' : '';
            } else {
                oldCards[i].style.visibility = '';
            }
        }
        // Ajouter les nouvelles cartes (si le count a augmenté)
        for (let i = oldCount; i < Math.min(count, 12); i++) {
            const revealedCard = oppHand && oppHand[i];
            const el = document.createElement('div');
            el.className = 'opp-card-back';
            if (revealedCard && revealedCard.image) {
                el.style.backgroundImage = `url('/cards/${revealedCard.image}')`;
                el.onmouseenter = (e) => showCardPreview(revealedCard, e);
                el.onmouseleave = hideCardPreview;
            } else {
                el.onmouseenter = () => showCardBackPreview();
                el.onmouseleave = hideCardPreview;
            }
            el.style.zIndex = i + 1;
            const shouldHide = GameAnimations.shouldHideCard('opp', i);
            if (shouldHide) {
                el.style.visibility = 'hidden';
            }
            panel.appendChild(el);
        }
        // Bounce check
        if (pendingBounce && pendingBounce.owner === 'opp') {
            const allCards = panel.querySelectorAll('.opp-card-back');
            checkPendingBounce('opp', allCards);
        }
        return;
    }

    // --- Mode normal : rebuild complet ---
    // FLIP : sauvegarder les positions avant de reconstruire
    const oldRects = Array.from(oldCards).map(c => c.getBoundingClientRect());

    panel.innerHTML = '';

    for (let i = 0; i < Math.min(count, 12); i++) {
        const revealedCard = oppHand && oppHand[i];
        const el = document.createElement('div');
        el.className = 'opp-card-back';

        if (revealedCard && revealedCard.image) {
            el.style.backgroundImage = `url('/cards/${revealedCard.image}')`;
            el.onmouseenter = (e) => showCardPreview(revealedCard, e);
            el.onmouseleave = hideCardPreview;
        } else {
            el.onmouseenter = () => showCardBackPreview();
            el.onmouseleave = hideCardPreview;
        }

        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente
        const shouldHide = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i);
        if (shouldHide) {
            el.style.visibility = 'hidden';
        }

        panel.appendChild(el);
    }

    // Animation glissante si la main a rétréci
    if (count < oldCount && oldCount > 0) {
        const newCards = panel.querySelectorAll('.opp-card-back');
        newCards.forEach((card, i) => {
            if (i < oldRects.length) {
                const newRect = card.getBoundingClientRect();
                const dx = oldRects[i].left - newRect.left;
                if (Math.abs(dx) > 1) {
                    card.style.transition = 'none';
                    card.style.transform = `translateX(${dx}px)`;
                    requestAnimationFrame(() => {
                        card.style.transition = 'transform 0.3s ease-out';
                        card.style.transform = '';
                        setTimeout(() => { card.style.transition = ''; }, 350);
                    });
                }
            }
        });
    }

    // Bounce : cacher la dernière carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'opp') {
        const allCards = panel.querySelectorAll('.opp-card-back');
        checkPendingBounce('opp', allCards);
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
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection'
        };
        // Filtrer shooter et fly des capacités affichées
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
                if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
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
                <div class="arena-stats ${atkClass || hpClass ? 'modified' : ''}"><span class="arena-atk ${atkClass}">${card.atk}</span>/<span class="arena-hp ${hpClass}">${hp}</span></div>`;
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
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection'
        };
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
                if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
                if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
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
            trample: 'Piétinement', power: 'Puissance', immovable: 'Immobile', regeneration: 'Régénération',
            protection: 'Protection'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            if (a === 'power') return `Puissance ${card.powerX || ''}`.trim();
            if (a === 'regeneration') return `Régénération ${card.regenerationX || ''}`.trim();
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
        power: '💪',
        cleave: '⛏️',
        immovable: '🪨',
        regeneration: '💚',
        protection: '🛡️'
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
    if (card.abilities?.includes('immovable')) return;

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

    // ── Curseur fantasy custom ──
    const cursorEl = document.getElementById('cursor-fantasy');
    let cursorTrailCounter = 0;

    document.addEventListener('mousemove', e => {
        cursorEl.style.left = e.clientX + 'px';
        cursorEl.style.top = e.clientY + 'px';

        cursorTrailCounter++;
        if (cursorTrailCounter % 3 === 0) {
            const trail = document.createElement('div');
            trail.className = 'cursor-trail';
            trail.style.left = e.clientX + 'px';
            trail.style.top = e.clientY + 'px';
            document.body.appendChild(trail);
            setTimeout(() => trail.remove(), 400);
        }
    });

    document.addEventListener('mousedown', e => {
        cursorEl.classList.add('clicking');

        const effect = document.createElement('div');
        effect.className = 'click-effect';
        effect.style.left = e.clientX + 'px';
        effect.style.top = e.clientY + 'px';
        effect.innerHTML = '<div class="click-ring"></div><div class="click-ring" style="animation-delay:0.1s"></div>';
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 500);
    });

    document.addEventListener('mouseup', () => {
        cursorEl.classList.remove('clicking');
    });

    document.addEventListener('mouseleave', () => cursorEl.style.opacity = '0');
    document.addEventListener('mouseenter', () => cursorEl.style.opacity = '1');
});