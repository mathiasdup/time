// ==================== SYSTÈME D'ANIMATIONS DU JEU ====================
// File d'attente, handlers combat/mort/sort/piège, effets visuels

// Initialiser le système d'animation
async function initCombatAnimations() {
    await CombatAnimations.init();
    await CardRenderer.init();
}

function queueAnimation(type, data) {

    // Pour zdejebel et onDeathDamage héros, capturer les HP actuels AVANT que render() ne les mette à jour
    if ((type === 'zdejebel' || (type === 'onDeathDamage' && data.targetRow === undefined)) && state) {
        const target = data.targetPlayer === myNum ? 'me' : 'opp';
        const currentDisplayedHp = target === 'me' ? state.me?.hp : state.opponent?.hp;
        data._displayHpBefore = currentDisplayedHp;
    }

    // Pour burn, death, spell, trapTrigger, bloquer le render du cimetière IMMÉDIATEMENT
    if (type === 'burn' || type === 'death' || type === 'spell' || type === 'trapTrigger') {
        const owner = (type === 'spell' ? data.caster : data.player) === myNum ? 'me' : 'opp';
        graveRenderBlocked.add(owner);
    }

    // Pour death, bloquer aussi le slot du terrain pour que render() ne retire pas
    // la carte avant que l'animation de mort ne la prenne en charge
    if (type === 'death' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // Pour deathTransform, bloquer le slot IMMÉDIATEMENT pour que render() ne remplace pas la carte
    if (type === 'deathTransform') {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // Pour bounce, bloquer le slot pour que render() ne retire pas la carte
    if (type === 'bounce' && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // Pour onDeathDamage créature (Torche vivante), bloquer le slot pour que render()
    // ne retire pas la carte avant que l'animation de dégâts ne joue
    if (type === 'onDeathDamage' && data.targetRow !== undefined && data.targetCol !== undefined) {
        const owner = data.targetPlayer === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.add(slotKey);
    }

    // Pour damage/spellDamage, bloquer le slot pour que render() ne mette pas à jour
    // les stats (HP, ATK via Puissance) avant que l'animation de dégâts ne joue
    if ((type === 'damage' || type === 'spellDamage') && data.row !== undefined && data.col !== undefined) {
        const owner = data.player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${data.row}-${data.col}`;
        animatingSlots.add(slotKey);
    }

    // Pour attack, bloquer le(s) slot(s) de l'attaquant pour que render() ne recrée pas
    // l'élément DOM pendant l'animation de charge/retour
    if (type === 'attack') {
        const attackerSlots = [];
        if (data.combatType === 'parallel_attacks') {
            if (data.attack1) {
                const o = data.attack1.attacker === myNum ? 'me' : 'opp';
                attackerSlots.push(`${o}-${data.attack1.row}-${data.attack1.col}`);
            }
            if (data.attack2) {
                const o = data.attack2.attacker === myNum ? 'me' : 'opp';
                attackerSlots.push(`${o}-${data.attack2.row}-${data.attack2.col}`);
            }
        } else if (data.combatType === 'mutual_shooters') {
            attackerSlots.push(`${data.attacker1 === myNum ? 'me' : 'opp'}-${data.row1}-${data.col1}`);
            attackerSlots.push(`${data.attacker2 === myNum ? 'me' : 'opp'}-${data.row2}-${data.col2}`);
        } else {
            // solo, shooter, mutual_melee, shooter_vs_flyer
            const o = data.attacker === myNum ? 'me' : 'opp';
            attackerSlots.push(`${o}-${data.row}-${data.col}`);
            // Pour mutual_melee et shooter_vs_flyer, bloquer aussi la cible (elle bouge)
            if (data.combatType === 'mutual_melee' || data.isMutual || data.combatType === 'shooter_vs_flyer') {
                const to = data.targetPlayer === myNum ? 'me' : 'opp';
                if (data.targetRow !== undefined && data.targetCol !== undefined && data.targetCol !== -1) {
                    attackerSlots.push(`${to}-${data.targetRow}-${data.targetCol}`);
                }
            }
        }
        data._attackerSlots = attackerSlots;
        for (const sk of attackerSlots) {
            animatingSlots.add(sk);
        }
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
    // Générer un ID unique pour ce processeur
    if (processorId === null) {
        currentProcessorId++;
        processorId = currentProcessorId;
    }

    try {
        // Vérifier si un autre processeur a pris le relais
        if (processorId !== currentProcessorId) {
            return;
        }

        if (animationQueue.length === 0) {
            isAnimating = false;
            return;
        }

        isAnimating = true;

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
                return CombatAnimations.animateSpellDamage({
                    owner: owner,
                    row: data.row,
                    col: data.col,
                    amount: data.amount
                });
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

        // Exécuter l'animation avec timeout de sécurité
        try {
            const animationPromise = executeAnimationAsync(type, data);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Animation timeout: ${type}`)), 5000)
            );
            await Promise.race([animationPromise, timeoutPromise]);
        } catch (e) {
        }

        // Débloquer les slots d'attaquant après l'animation d'attaque
        // SAUF si une animation de damage/death est en attente pour ce slot
        if (type === 'attack' && data._attackerSlots) {
            for (const sk of data._attackerSlots) {
                const hasPending = animationQueue.some(item =>
                    (item.type === 'damage' || item.type === 'death' || item.type === 'spellDamage') && item.data &&
                    `${(item.data.player === myNum ? 'me' : 'opp')}-${item.data.row}-${item.data.col}` === sk
                );
                if (!hasPending) {
                    animatingSlots.delete(sk);
                } else {
                }
            }
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
            }
        }

        // Vérifier encore si on est toujours le processeur actif
        if (processorId !== currentProcessorId) {
            return;
        }

        // Attendre le délai
        await new Promise(resolve => setTimeout(resolve, delay));

        // Continuer la file (avec le même processorId)
        processAnimationQueue(processorId);
    } catch (globalError) {
        isAnimating = false;
        if (animationQueue.length > 0) {
            setTimeout(() => processAnimationQueue(), 100);
        }
    }
}

async function executeAnimationAsync(type, data) {
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
        case 'death':
            await animateDeathToGraveyard(data);
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
        case 'trampleDamage':
            await animateTrampleDamage(data);
            break;
        case 'trampleHeroHit':
            await animateTrampleHeroHit(data);
            break;
        case 'bounce':
            await animateBounceToHand(data);
            break;
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

    // Cas 1 : dégâts à une créature (damageKiller — Torche vivante)
    if (data.targetRow !== undefined && data.targetCol !== undefined) {
        const slot = document.querySelector(
            `.card-slot[data-owner="${owner}"][data-row="${data.targetRow}"][data-col="${data.targetCol}"]`
        );
        if (slot) {
            // Secousse sur le slot
            slot.style.animation = 'slotShake 0.5s ease-out';
            setTimeout(() => slot.style.animation = '', 500);

            // Flash orange DOM (hérite de la perspective 3D)
            slot.classList.add('slot-hit');
            setTimeout(() => slot.classList.remove('slot-hit'), 500);

            // Slash VFX + onde de choc + étincelles PixiJS
            const rect = slot.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            CombatVFX.createSlashEffect(x, y, data.damage);
            CombatVFX.createSlotHitEffect(x, y, rect.width, rect.height);
        }
        await new Promise(r => setTimeout(r, 600));

        // Débloquer le slot après l'animation — la carte a été visible pendant les dégâts
        const slotKey = `${owner}-${data.targetRow}-${data.targetCol}`;
        animatingSlots.delete(slotKey);
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
    }

    if (heroCard) {
        // Secousse + flash rouge DOM sur le héros
        heroCard.style.animation = 'heroShake 0.5s ease-out';
        heroCard.classList.add('hero-hit');
        setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

        // Slash VFX + ring/étincelles PixiJS
        const rect = heroCard.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        CombatVFX.createSlashEffect(cx, cy, data.damage);
        CombatVFX.createHeroHitEffect(cx, cy, rect.width, rect.height);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation
    if (hpElement && currentHp !== undefined) {
        hpElement.textContent = currentHp;
    }

    // Débloquer render()
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

if (hpElement) {
        // S'assurer que les HP d'avant sont affichés pendant l'animation
        hpElement.textContent = hpBefore;
    }

    // Récupérer la position du héros ciblé
    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (heroCard) {
        // Secousse + flash rouge DOM sur le héros
        heroCard.style.animation = 'heroShake 0.5s ease-out';
        heroCard.classList.add('hero-hit');
        setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

        // Slash VFX + ring/étincelles PixiJS
        const rect = heroCard.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.createSlashEffect(x, y, data.damage);
        CombatVFX.createHeroHitEffect(x, y, rect.width, rect.height);
    }

    // Attendre que l'animation soit visible
    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation (hpBefore - damage, indépendant du state)
    if (hpElement) {
        hpElement.textContent = hpAfter;
    }

    // Débloquer render() pour les HP
    zdejebelAnimationInProgress = false;

    // Petit délai supplémentaire pour voir le changement
    await new Promise(r => setTimeout(r, 200));
}

// Fonction utilitaire pour afficher un nombre de dégâts sur un élément
function showDamageNumber(element, damage) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.showDamageNumber(x, y, damage);
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
    card.style.animation = 'cardShake 0.4s ease-out';
    setTimeout(() => card.style.animation = '', 400);

    // Flash DOM (hérite de la perspective 3D)
    card.classList.add('card-damage-hit');
    setTimeout(() => card.classList.remove('card-damage-hit'), 420);

    // Slash VFX + étincelles PixiJS
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createSlashEffect(x, y, data.amount);
    CombatVFX.createDamageFlashEffect(x, y, rect.width, rect.height);

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

if (hpElement) {
        hpElement.textContent = hpBefore;
    }

    // Secousse + flash rouge DOM sur le héros
    heroCard.style.animation = 'heroShake 0.5s ease-out';
    heroCard.classList.add('hero-hit');
    setTimeout(() => { heroCard.style.animation = ''; heroCard.classList.remove('hero-hit'); }, 550);

    // Slash VFX + ring/étincelles PixiJS
    const rect = heroCard.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createSlashEffect(x, y, data.damage);
    CombatVFX.createHeroHitEffect(x, y, rect.width, rect.height);

    await new Promise(r => setTimeout(r, 600));

    // Mettre à jour les HP APRÈS l'animation (hpBefore - damage, indépendant du state)
    if (hpElement) {
        hpElement.textContent = hpAfter;
    }

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
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;

    const rect = slot.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    CombatVFX.createAtkBoostEffect(x, y, rect.width, rect.height, data.boost);
}

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
    const deathSlotKey = `${owner}-${data.row}-${data.col}`;

    // Bloquer le render du cimetière pendant l'animation
    graveRenderBlocked.add(ownerKey);

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
async function animateSpellReveal(card, casterPlayerNum, startRect = null) {
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

    // 4. Position de départ : depuis la main (startRect) ou materialisation classique
    const hasStartRect = !!startRect;
    const initX = hasStartRect ? startRect.left + startRect.width / 2 - cardWidth / 2 : showcaseX;
    const initY = hasStartRect ? startRect.top + startRect.height / 2 - cardHeight / 2 : showcaseY;
    const initScale = hasStartRect ? (startRect.width / cardWidth) : 0.3;
    const initOpacity = hasStartRect ? 0.85 : 0;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: fixed; z-index: 10000; pointer-events: none;
        left: ${initX}px; top: ${initY}px;
        width: ${cardWidth}px; height: ${cardHeight}px;
        transform-origin: center center;
        transform: scale(${initScale}); opacity: ${initOpacity};
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
                // === PHASE 1: MATERIALIZE (ou fly-from-hand si startRect) ===
                const p = progress / t1;
                const ep = hasStartRect ? easeInOutCubic(p) : easeOutBack(p);
                x = initX + (showcaseX - initX) * ep;
                y = initY + (showcaseY - initY) * ep;
                scale = initScale + (showcaseScale - initScale) * ep;
                opacity = initOpacity + (1 - initOpacity) * easeOutCubic(p);
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

                // Vérifier si ce sort doit retourner en main (returnOnMiss)
                const spellId = card.uid || card.id;
                if (pendingSpellReturns.has(spellId)) {
                    pendingSpellReturns.delete(spellId);
                    // Ne PAS placer la carte dans le cimetière — elle retourne en main
                    // Débloquer le render du cimetière et mettre à jour depuis le state
                    graveRenderBlocked.delete(side);
                    if (state) {
                        const graveyard = side === 'me' ? state.me?.graveyard : state.opponent?.graveyard;
                        if (graveyard) {
                            updateGraveDisplay(side, graveyard);
                            updateGraveTopCard(side, graveyard);
                        }
                    }
                } else {
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
                    }
                    // graveRenderBlocked reste actif (posé par queueAnimation)
                    // updateGraveTopCard le retirera quand le state aura rattrapé
                }

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
            await flyFromOppHand({ left: showcaseX, top: showcaseY, width: cardW * sc, height: cardH * sc }, 300, data.spell);
        }
    }
    // Pour nos propres sorts : récupérer la position du sort engagé dans la main
    let startRect = null;
    if (data.spell && data.caster === myNum && committedSpells.length > 0) {
        const handPanel = document.getElementById('my-hand');
        const committedEls = handPanel ? handPanel.querySelectorAll('.committed-spell') : [];
        const csIdx = committedSpells.findIndex(cs => cs.card.id === data.spell.id);
        if (csIdx >= 0) {
            const commitId = committedSpells[csIdx].commitId;
            for (const el of committedEls) {
                if (parseInt(el.dataset.commitId) === commitId) {
                    startRect = el.getBoundingClientRect();
                    el.style.visibility = 'hidden';
                    setTimeout(() => el.remove(), 50);
                    break;
                }
            }
            committedSpells.splice(csIdx, 1);
        }
    }
    // Afficher la carte du sort avec animation de révélation
    if (data.spell) {
        await animateSpellReveal(data.spell, data.caster, startRect);
    }
}

function animateSpellMiss(data) {
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${data.row}"][data-col="${data.col}"]`);
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
    // Marquer ce sort comme devant retourner en main (pas au cimetière)
    pendingSpellReturns.add(spellId);
    // Si l'animation du sort a déjà terminé et placé la carte dans le cimetière (race condition),
    // nettoyer immédiatement le visuel du cimetière
    const graveTopContainer = document.getElementById(owner + '-grave-top');
    if (graveTopContainer && graveTopContainer.dataset.topCardUid === spellId) {
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
    // Marquer cet index comme retour depuis le cimetière
    GameAnimations.pendingGraveyardReturns[owner].add(data.handIndex);
    // Réutiliser le système de pioche standard (carte cachée au render, animation, reveal)
    GameAnimations.prepareDrawAnimation({
        cards: [{ player: data.player, handIndex: data.handIndex, card: data.card }]
    });
}

function animateHeal(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (slot) {
        // Aura verte DOM (hérite de la perspective 3D)
        slot.classList.add('heal-aura');
        setTimeout(() => slot.classList.remove('heal-aura'), 600);

        const rect = slot.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        CombatVFX.showHealNumber(x, y, data.amount);
        CombatVFX.createHealEffect(x, y, rect.width, rect.height);
    }
}

function animateTrapPlace(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const trapSlot = document.querySelector(`.trap-slot[data-owner="${owner}"][data-row="${data.row}"]`);
    if (!trapSlot) return;

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

    // 1. Afficher la carte du piège avec animation de révélation
    if (data.trap) {
        await animateSpellReveal(data.trap, data.player);
    }

    // 2. Explosion du slot du piège
    if (trapSlot) {
        trapSlot.classList.add('triggered');
        const rect = trapSlot.getBoundingClientRect();
        CombatVFX.createSpellImpactEffect(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        setTimeout(() => {
            trapSlot.classList.remove('triggered');
        }, 600);
    }
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
        } else if (!slotsStillNeeded.has(key)) {
            animatingSlots.delete(key);
        } else {
        }
    }

    // NE PAS vider la file d'animation - laisser les animations se terminer naturellement
    // Cela évite de perdre des animations comme zdejebel qui arrivent en fin de tour
    // animationQueue.length = 0;
    // isAnimating = false;

    // Nettoyer les animations de pioche en attente
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.clear();
    }

    // Réinitialiser les flags de combat sur toutes les cartes
    document.querySelectorAll('.card[data-in-combat="true"]').forEach(card => {
        card.dataset.inCombat = 'false';
    });

    // Retirer les classes d'animation résiduelles
    document.querySelectorAll('.card.dying').forEach(card => {
        card.classList.remove('dying');
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
function flyFromOppHand(targetRect, duration = 300, spell = null) {
    return new Promise(resolve => {
        const handPanel = document.getElementById('opp-hand');
        const handCards = handPanel ? handPanel.querySelectorAll('.opp-card-back') : [];
        const lastCard = handCards[handCards.length - 1];

        if (!lastCard) { resolve(); return; }

        const handRect = lastCard.getBoundingClientRect();

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
        if (spell && spell.revealedToOpponent && typeof makeCard === 'function') {
            const cardFace = makeCard(spell, false);
            cardFace.style.cssText = 'width: 100%; height: 100%; margin: 0; position: relative; border-radius: 6px;';
            if (spell.image) {
                cardFace.style.backgroundImage = `url('/cards/${spell.image}')`;
                cardFace.style.backgroundSize = 'cover';
                cardFace.style.backgroundPosition = 'center';
            }
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
            const rect = slot.getBoundingClientRect();
            CombatVFX.createSummonEffect(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                rect.width,
                rect.height
            );
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
        backImg.src = 'cardback/back_1.png';
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
            const angle = Math.atan2(dy, dx);

            CombatVFX.createWindGustEffect(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                rect.width,
                rect.height,
                angle
            );
        }, 20);
        return;
    }

    const owner = 'opp';

    // Bloquer les deux slots (origine et destination)
    const fromKey = `${owner}-${data.fromRow}-${data.fromCol}`;
    const toKey = `${owner}-${data.toRow}-${data.toCol}`;
    animatingSlots.add(fromKey);
    animatingSlots.add(toKey);

    const fromSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.fromRow}"][data-col="${data.fromCol}"]`);
    const toSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.toRow}"][data-col="${data.toCol}"]`);

    if (!fromSlot || !toSlot) {
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
        movingCard.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    });

    // Nettoyer après l'animation (500ms transition + 100ms marge)
    setTimeout(() => {
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
