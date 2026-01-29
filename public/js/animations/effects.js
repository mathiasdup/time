// =============================================
// Animations d'effets spéciaux
// =============================================
// Animations de mort, transformation, bouclier, etc.

/**
 * Animation de mort d'une créature
 */
function animateDeath(data) {
    // Utiliser la nouvelle animation fly-to-graveyard si disponible
    if (typeof animateDeathToGraveyard === 'function') {
        animateDeathToGraveyard(data);
        return;
    }

    // Fallback : animation CSS basique
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (!card) return;

    const cardRect = card.getBoundingClientRect();
    const dyingCard = card.cloneNode(true);
    dyingCard.style.cssText = `
        position: fixed;
        left: ${cardRect.left}px;
        top: ${cardRect.top}px;
        width: ${cardRect.width}px;
        height: ${cardRect.height}px;
        z-index: 10000;
        pointer-events: none;
        margin: 0;
    `;
    dyingCard.classList.add('dying');
    document.body.appendChild(dyingCard);

    card.remove();
    slot.classList.remove('has-card');
    slot.classList.remove('has-flying');

    setTimeout(() => {
        dyingCard.remove();
        if (typeof refreshGraveyardDisplay === 'function') {
            refreshGraveyardDisplay(owner);
        }
    }, 600);
}

/**
 * Animation Zdejebel (dégâts de fin de tour)
 */
async function animateZdejebelDamage(data) {
    const owner = data.targetPlayer === myNum ? 'me' : 'opp';
    console.log('[Zdejebel] START - owner:', owner, 'damage:', data.damage);

    zdejebelAnimationInProgress = true;

    const hpElement = document.getElementById(owner === 'me' ? 'me-hp' : 'opp-hp');
    const currentHp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
    const hpBeforeAnimation = data._displayHpBefore ?? (currentHp + data.damage);

    if (hpElement && hpBeforeAnimation !== undefined) {
        hpElement.textContent = hpBeforeAnimation;
    }

    const heroCard = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');

    if (heroCard) {
        heroCard.classList.add('hit');
        setTimeout(() => heroCard.classList.remove('hit'), 500);

        const vfxReady = typeof CombatVFX !== 'undefined' && CombatVFX.initialized && CombatVFX.container;

        if (vfxReady) {
            try {
                const rect = heroCard.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                CombatVFX.createSlashEffect(x, y, data.damage);
            } catch (e) {
                console.error('[Zdejebel] Slash effect error:', e);
                showDamageNumber(heroCard, data.damage);
            }
        } else {
            showDamageNumber(heroCard, data.damage);
        }
    }

    await new Promise(r => setTimeout(r, 600));

    if (hpElement && currentHp !== undefined) {
        hpElement.textContent = currentHp;
    }

    zdejebelAnimationInProgress = false;
    await new Promise(r => setTimeout(r, 200));
}

/**
 * Affiche un nombre de dégâts sur un élément
 */
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

/**
 * Animation de transformation à la mort (Petit Os → Pile d'os)
 */
async function animateDeathTransform(data) {
    console.log('[DeathTransform] START');
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');

    if (!card) return;

    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Créer une copie de la carte pour l'animation (comme animateDeath)
    const dyingCard = card.cloneNode(true);
    dyingCard.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        z-index: 10000;
        pointer-events: none;
        margin: 0;
    `;
    document.body.appendChild(dyingCard);

    // Cacher la carte originale (le slot garde ses classes, pas besoin de les toucher)
    card.style.visibility = 'hidden';

    // Phase 1: Tremble et blanc sur la copie
    dyingCard.style.transition = 'transform 0.15s ease-in-out, filter 0.15s ease-in-out';
    dyingCard.style.transform = 'scale(1.1)';
    dyingCard.style.filter = 'brightness(2) saturate(0)';
    await new Promise(r => setTimeout(r, 150));

    // Phase 2: Particules d'os
    const numParticles = 12;
    const particles = [];

    for (let i = 0; i < numParticles; i++) {
        const particle = document.createElement('div');
        const angle = (i / numParticles) * Math.PI * 2;
        const distance = 40 + Math.random() * 60;
        const size = 8 + Math.random() * 10;

        particle.textContent = '🦴';
        particle.style.cssText = `
            position: fixed;
            left: ${centerX}px;
            top: ${centerY}px;
            font-size: ${size}px;
            z-index: 10001;
            pointer-events: none;
            opacity: 1;
            transform: translate(-50%, -50%) rotate(${Math.random() * 360}deg);
            transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        `;
        document.body.appendChild(particle);
        particles.push({ el: particle, angle, distance });
    }

    requestAnimationFrame(() => {
        particles.forEach(p => {
            const targetX = centerX + Math.cos(p.angle) * p.distance;
            const targetY = centerY + Math.sin(p.angle) * p.distance;
            p.el.style.left = targetX + 'px';
            p.el.style.top = targetY + 'px';
            p.el.style.opacity = '0.7';
            p.el.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 720}deg) scale(0.5)`;
        });
    });

    dyingCard.style.opacity = '0';
    dyingCard.style.transform = 'scale(0)';
    await new Promise(r => setTimeout(r, 250));

    // Phase 3: Retour au centre
    particles.forEach(p => {
        p.el.style.transition = 'all 0.2s cubic-bezier(0.55, 0.09, 0.68, 0.53)';
        p.el.style.left = centerX + 'px';
        p.el.style.top = centerY + 'px';
        p.el.style.opacity = '0';
        p.el.style.transform = 'translate(-50%, -50%) scale(0)';
    });

    await new Promise(r => setTimeout(r, 150));
    particles.forEach(p => p.el.remove());

    // Supprimer la copie mourante
    dyingCard.remove();

    // Phase 4: Révéler la nouvelle carte (qui a été mise à jour par le state)
    // La carte originale est maintenant la nouvelle carte (Pile d'os)
    card.style.visibility = 'visible';
    card.style.transition = 'none';
    card.style.transform = 'scale(0.8)';
    card.style.filter = 'brightness(3)';
    card.style.opacity = '1';

    requestAnimationFrame(() => {
        card.style.transition = 'transform 0.2s ease-out, filter 0.2s ease-out';
        card.style.transform = 'scale(1)';
        card.style.filter = 'brightness(1)';
    });

    await new Promise(r => setTimeout(r, 200));
    card.style.transition = '';
    card.style.transform = '';
    card.style.filter = '';
}

/**
 * Animation de résurrection (Pile d'os → Petit Os)
 */
async function animateBoneRevive(data) {
    console.log('[BoneRevive] START');
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');

    if (!card) return;

    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Phase 1: Tremble et illumine
    card.style.transition = 'transform 0.2s ease-in-out, filter 0.3s ease-in-out';
    card.style.animation = 'boneShake 0.1s ease-in-out infinite';
    card.style.filter = 'brightness(1.5) drop-shadow(0 0 10px gold)';

    const halo = document.createElement('div');
    halo.style.cssText = `
        position: fixed;
        left: ${centerX}px;
        top: ${centerY}px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,215,0,0.8) 0%, rgba(255,215,0,0.4) 40%, transparent 70%);
        transform: translate(-50%, -50%);
        z-index: 10000;
        pointer-events: none;
        transition: all 0.5s ease-out;
    `;
    document.body.appendChild(halo);

    requestAnimationFrame(() => {
        halo.style.width = '150px';
        halo.style.height = '150px';
        halo.style.opacity = '0.8';
    });

    await new Promise(r => setTimeout(r, 500));

    // Phase 2: Particules d'os montant
    const numParticles = 12;
    const particles = [];

    for (let i = 0; i < numParticles; i++) {
        const particle = document.createElement('div');
        const offsetX = (Math.random() - 0.5) * 80;
        const startY = centerY + 100 + Math.random() * 50;

        particle.textContent = '🦴';
        particle.style.cssText = `
            position: fixed;
            left: ${centerX + offsetX}px;
            top: ${startY}px;
            font-size: ${10 + Math.random() * 8}px;
            z-index: 10001;
            pointer-events: none;
            opacity: 0.8;
            transform: rotate(${Math.random() * 360}deg);
            transition: all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        `;
        document.body.appendChild(particle);
        particles.push(particle);
    }

    requestAnimationFrame(() => {
        particles.forEach(p => {
            p.style.left = centerX + 'px';
            p.style.top = centerY + 'px';
            p.style.opacity = '0';
            p.style.transform = 'rotate(720deg) scale(0.3)';
        });
    });

    await new Promise(r => setTimeout(r, 500));

    // Phase 3: Flash de transformation
    card.style.animation = '';
    card.style.transition = 'transform 0.15s ease-out, filter 0.15s ease-out';
    card.style.transform = 'scale(1.2)';
    card.style.filter = 'brightness(3) saturate(0)';

    halo.style.transition = 'all 0.2s ease-out';
    halo.style.transform = 'translate(-50%, -50%) scale(2)';
    halo.style.opacity = '0';

    await new Promise(r => setTimeout(r, 150));

    // Phase 4: Révéler Petit Os
    card.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease-out';
    card.style.transform = 'scale(1)';
    card.style.filter = 'brightness(1.2) drop-shadow(0 0 15px gold)';

    await new Promise(r => setTimeout(r, 300));

    particles.forEach(p => p.remove());
    halo.remove();

    card.style.transition = 'filter 0.5s ease-out';
    card.style.filter = 'brightness(1)';

    await new Promise(r => setTimeout(r, 500));
    card.style.transition = '';
    card.style.transform = '';
    card.style.filter = '';
}

/**
 * Animation pour la capacité du Dragon d'Éclat
 * Effet visuel uniquement - la pioche est gérée par l'animation 'draw' standard
 */
async function animateRadiantDragonDraw(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;

    const card = slot.querySelector('.card');
    if (!card) return;

    const waterOverlay = document.createElement('div');
    waterOverlay.className = 'radiant-water-torrent';
    waterOverlay.innerHTML = `
        <div class="water-stream stream-1"></div>
        <div class="water-stream stream-2"></div>
        <div class="water-stream stream-3"></div>
        <div class="water-drops">
            <div class="drop drop-1"></div>
            <div class="drop drop-2"></div>
            <div class="drop drop-3"></div>
            <div class="drop drop-4"></div>
            <div class="drop drop-5"></div>
            <div class="drop drop-6"></div>
        </div>
        <div class="water-glow"></div>
    `;
    card.appendChild(waterOverlay);

    setTimeout(() => waterOverlay.classList.add('active'), 50);
    await new Promise(r => setTimeout(r, 600));

    waterOverlay.classList.add('fading');
    await new Promise(r => setTimeout(r, 400));
    waterOverlay.remove();
}

/**
 * Animation de buff
 */
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

/**
 * Animation de boost ATK - Style Magic Arena
 * Aura de feu + particules convergentes + impact flash + pulse
 */
async function animateAtkBoost(data) {
    console.log('[AtkBoost] START - data:', data);
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    const card = slot?.querySelector('.card');
    if (!card) {
        console.log('[AtkBoost] No card found at slot', owner, data.row, data.col);
        return;
    }

    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Container pour tous les effets
    const container = document.createElement('div');
    container.style.cssText = `position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:10000;`;
    document.body.appendChild(container);

    // 1. Aura de feu multicouche
    const auraLayers = [];
    for (let i = 0; i < 3; i++) {
        const aura = document.createElement('div');
        const expand = 6 + i * 5;
        aura.style.cssText = `
            position:fixed;
            left:${rect.left - expand}px;
            top:${rect.top - expand}px;
            width:${rect.width + expand * 2}px;
            height:${rect.height + expand * 2}px;
            border-radius:10px;
            box-shadow: 0 0 ${12 + i * 8}px rgba(255,${80 - i * 25},0,${0.7 - i * 0.15}),
                        inset 0 0 ${8 + i * 4}px rgba(255,${120 - i * 35},0,${0.4 - i * 0.1});
            opacity:0;
            transform:scale(0.96);
            transition:all ${0.12 + i * 0.04}s ease-out;
        `;
        container.appendChild(aura);
        auraLayers.push(aura);
    }

    // 2. Particules de feu convergentes
    const fireParticles = [];
    for (let i = 0; i < 10; i++) {
        const p = document.createElement('div');
        const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 70 + Math.random() * 30;
        const size = 5 + Math.random() * 5;
        p.style.cssText = `
            position:fixed;
            left:${centerX + Math.cos(angle) * dist}px;
            top:${centerY + Math.sin(angle) * dist}px;
            width:${size}px;
            height:${size}px;
            background:radial-gradient(circle,#fff 0%,#ffaa00 35%,#ff4400 65%,transparent 100%);
            border-radius:50%;
            opacity:0;
            transform:translate(-50%,-50%) scale(0);
            filter:blur(0.5px);
            transition:all 0.22s cubic-bezier(0.4,0,0.2,1);
        `;
        container.appendChild(p);
        fireParticles.push({ el: p, delay: i * 12 });
    }

    // 3. Anneau d'énergie
    const ring = document.createElement('div');
    ring.style.cssText = `
        position:fixed;
        left:${centerX}px;
        top:${centerY}px;
        width:16px;
        height:16px;
        border:2px solid rgba(255,140,0,0.9);
        border-radius:50%;
        transform:translate(-50%,-50%) scale(0);
        opacity:0;
        box-shadow:0 0 15px rgba(255,80,0,0.8),inset 0 0 8px rgba(255,180,0,0.5);
        transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1);
    `;
    container.appendChild(ring);

    // 4. Flash d'impact
    const flash = document.createElement('div');
    flash.style.cssText = `
        position:fixed;
        left:${rect.left}px;
        top:${rect.top}px;
        width:${rect.width}px;
        height:${rect.height}px;
        background:radial-gradient(ellipse at center,rgba(255,255,255,0.85) 0%,rgba(255,180,50,0.5) 35%,transparent 70%);
        border-radius:8px;
        opacity:0;
        transform:scale(1.05);
        transition:all 0.08s ease-out;
    `;
    container.appendChild(flash);

    // 5. Étincelles jaillissantes
    const sparks = [];
    for (let i = 0; i < 6; i++) {
        const spark = document.createElement('div');
        spark.style.cssText = `
            position:fixed;
            left:${centerX}px;
            top:${centerY}px;
            width:2px;
            height:6px;
            background:linear-gradient(to bottom,#fff,#ffaa00,transparent);
            border-radius:1px;
            opacity:0;
            transform:translate(-50%,-50%) rotate(${i * 60}deg) scaleY(0);
            transform-origin:center bottom;
            transition:all 0.18s ease-out;
        `;
        container.appendChild(spark);
        sparks.push(spark);
    }

    // === ANIMATION ===

    // Phase 1: Auras (0-80ms)
    requestAnimationFrame(() => {
        auraLayers.forEach((aura, i) => {
            setTimeout(() => {
                aura.style.opacity = '1';
                aura.style.transform = 'scale(1)';
            }, i * 25);
        });
    });

    await new Promise(r => setTimeout(r, 40));

    // Phase 2: Particules convergent (40-180ms)
    fireParticles.forEach((p) => {
        setTimeout(() => {
            p.el.style.opacity = '1';
            p.el.style.transform = 'translate(-50%,-50%) scale(1)';
            setTimeout(() => {
                p.el.style.transition = 'all 0.18s cubic-bezier(0.4,0,1,1)';
                p.el.style.left = centerX + 'px';
                p.el.style.top = centerY + 'px';
                p.el.style.opacity = '0.7';
                p.el.style.transform = 'translate(-50%,-50%) scale(0.3)';
            }, 25);
        }, p.delay);
    });

    await new Promise(r => setTimeout(r, 130));

    // Phase 3: Impact (180-280ms)
    flash.style.opacity = '1';
    flash.style.transform = 'scale(1)';
    ring.style.opacity = '1';
    ring.style.transform = 'translate(-50%,-50%) scale(3.5)';

    sparks.forEach((spark, i) => {
        setTimeout(() => {
            spark.style.opacity = '1';
            spark.style.transform = `translate(-50%,-50%) rotate(${i * 60}deg) translateY(-25px) scaleY(1)`;
        }, i * 8);
    });

    // Pulse sur la carte
    card.style.transition = 'transform 0.08s ease-out,filter 0.08s ease-out';
    card.style.transform = 'scale(1.06)';
    card.style.filter = 'brightness(1.35) saturate(1.15)';

    await new Promise(r => setTimeout(r, 80));

    // Phase 4: Retour (280-400ms)
    flash.style.transition = 'opacity 0.12s ease-out';
    flash.style.opacity = '0';
    ring.style.transition = 'all 0.15s ease-out';
    ring.style.opacity = '0';
    ring.style.transform = 'translate(-50%,-50%) scale(5)';

    sparks.forEach(spark => { spark.style.opacity = '0'; });
    auraLayers.forEach(aura => {
        aura.style.transition = 'opacity 0.15s ease-out';
        aura.style.opacity = '0';
    });

    card.style.transform = 'scale(1)';
    card.style.filter = 'brightness(1) saturate(1)';

    await new Promise(r => setTimeout(r, 120));

    // Nettoyage
    card.style.transition = '';
    card.style.transform = '';
    card.style.filter = '';
    container.remove();
}

/**
 * Animation de sort
 */
function animateSpell(data) {
    if (data.spell) {
        // Le caster possède le sort → la carte va dans son cimetière
        const casterOwner = data.caster === myNum ? 'me' : 'opp';
        showCardShowcase(data.spell, casterOwner);
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

/**
 * Animation de sort manqué
 */
function animateSpellMiss(data) {
    const targetOwner = data.targetPlayer === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${targetOwner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (slot) {
        const rect = slot.getBoundingClientRect();
        const effect = document.createElement('div');
        effect.className = 'spell-miss';
        effect.innerHTML = '<div class="miss-cross"></div>';
        effect.style.left = rect.left + rect.width / 2 + 'px';
        effect.style.top = rect.top + rect.height / 2 + 'px';
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 800);
    }
}

/**
 * Animation de soin
 */
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

/**
 * Animation de piège
 */
function animateTrap(data) {
    // Le piège appartient au défenseur (data.player) → va dans son cimetière
    const owner = data.player === myNum ? 'me' : 'opp';
    if (data.trap) {
        showCardShowcase(data.trap, owner);
    }
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
