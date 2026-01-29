// =============================================
// Animations de combat (PixiJS handlers)
// =============================================
// Gestion des animations d'attaque, dégâts, etc.

/**
 * Gère l'animation d'attaque PixiJS
 */
async function handlePixiAttack(data) {
    const attackerOwner = data.attacker === myNum ? 'me' : 'opp';
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';

    // Tireur vs Volant (simultané)
    if (data.combatType === 'shooter_vs_flyer') {
        await CombatAnimations.animateShooterVsFlyer({
            shooter: { owner: attackerOwner, row: data.row, col: data.col },
            flyer: { owner: targetOwner, row: data.targetRow, col: data.targetCol },
            shooterDamage: data.shooterDamage,
            flyerDamage: data.flyerDamage
        });
        return;
    }

    // Attaques parallèles
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

    // Tireur simple
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

    // Combat mutuel mêlée
    if (data.combatType === 'mutual_melee' || data.isMutual) {
        await CombatAnimations.animateMutualMelee({
            attacker1: { owner: attackerOwner, row: data.row, col: data.col },
            attacker2: { owner: targetOwner, row: data.targetRow, col: data.targetCol },
            damage1: data.damage1 || data.attackerDamage,
            damage2: data.damage2 || data.targetDamage
        });
        return;
    }

    // Attaque solo
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

/**
 * Gère l'animation de dégâts PixiJS
 */
async function handlePixiDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    if (data.skipScratch) return;

    await CombatAnimations.animateDamage({
        owner: owner,
        row: data.row,
        col: data.col,
        amount: data.amount
    });
}

/**
 * Gère l'animation de dégâts au héros
 */
async function handlePixiHeroHit(data) {
    const owner = data.defender === myNum ? 'me' : 'opp';
    await CombatAnimations.animateHeroHit({
        owner: owner,
        amount: data.damage
    });
}

/**
 * Gère l'animation de dégâts de sort
 */
async function handlePixiSpellDamage(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    await CombatAnimations.animateSpellDamage({
        owner: owner,
        row: data.row,
        col: data.col,
        amount: data.amount
    });
}

/**
 * Gère les dégâts à la mort (onDeath)
 */
async function handleOnDeathDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';

    const heroZone = document.querySelector(`.hero-zone.${owner}`);
    if (heroZone) {
        const deathEffect = document.createElement('div');
        deathEffect.className = 'on-death-effect';
        deathEffect.innerHTML = `<span class="death-source">💀 ${data.source}</span>`;
        heroZone.appendChild(deathEffect);

        setTimeout(() => deathEffect.classList.add('active'), 50);
        setTimeout(() => deathEffect.remove(), 1500);
    }

    await CombatAnimations.animateHeroHit({
        owner: owner,
        amount: data.damage
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
