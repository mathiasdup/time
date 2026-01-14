/**
 * Combat Animations System - Style Magic Arena / Hearthstone
 * Version fonctionnelle avec DOM + Canvas
 */

class CombatAnimationSystem {
    constructor() {
        this.app = null;
        this.container = null;
        this.initialized = false;
        
        this.TIMINGS = {
            PROJECTILE_FLIGHT: 400,
            ATTACK_MOVE: 300,
            ATTACK_RETURN: 250,
            SCRATCH_DISPLAY: 2000,
            BETWEEN_PHASES: 200,
        };
    }
    
    async init() {
        if (this.initialized) return;
        
        // Container pour les animations canvas
        this.container = document.createElement('div');
        this.container.id = 'combat-animation-layer';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            pointer-events: none;
            z-index: 9999;
        `;
        document.body.appendChild(this.container);
        
        // Initialiser PixiJS
        try {
            this.app = new PIXI.Application();
            await this.app.init({
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundAlpha: 0,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
            });
            this.container.appendChild(this.app.canvas);
            window.addEventListener('resize', () => this.handleResize());
        } catch (e) {
            console.warn('PixiJS init failed, using DOM fallback', e);
        }
        
        this.initialized = true;
        console.log('✅ Combat Animation System ready');
    }
    
    handleResize() {
        if (this.app?.renderer) {
            this.app.renderer.resize(window.innerWidth, window.innerHeight);
        }
    }
    
    // ==================== UTILITAIRES ====================
    
    getCardElement(owner, row, col) {
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        return slot?.querySelector('.card');
    }
    
    getSlotCenter(owner, row, col) {
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        if (!slot) return null;
        const rect = slot.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    
    getHeroCenter(owner) {
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (!heroEl) return null;
        const rect = heroEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ==================== ANIMATION DE GRIFFURE/DÉGÂTS (DOM) ====================
    
    /**
     * Affiche une animation de griffure avec le nombre de dégâts
     */
    showScratchDamage(x, y, damage) {
        // Conteneur principal
        const container = document.createElement('div');
        container.className = 'scratch-damage-container';
        container.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            z-index: 10000;
            pointer-events: none;
        `;
        
        // SVG des griffures
        const scratchSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        scratchSvg.setAttribute('width', '120');
        scratchSvg.setAttribute('height', '120');
        scratchSvg.setAttribute('viewBox', '-60 -60 120 120');
        scratchSvg.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
        `;
        
        // 3 griffures rouges
        const paths = [
            'M-30,-45 Q-20,-15 -10,15 T10,50',
            'M-5,-50 Q5,-20 0,10 T5,55',
            'M20,-40 Q30,-10 25,20 T30,45'
        ];
        
        paths.forEach((d, i) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('stroke', i === 0 ? '#ff0000' : i === 1 ? '#dd0000' : '#bb0000');
            path.setAttribute('stroke-width', 6 - i);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.style.filter = 'drop-shadow(0 0 3px rgba(255,0,0,0.8))';
            scratchSvg.appendChild(path);
        });
        
        container.appendChild(scratchSvg);
        
        // Nombre de dégâts
        const damageText = document.createElement('div');
        damageText.className = 'scratch-damage-number';
        damageText.textContent = `-${damage}`;
        damageText.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            font-family: 'Arial Black', Arial, sans-serif;
            font-size: 48px;
            font-weight: bold;
            color: #ff0000;
            text-shadow: 
                0 0 10px rgba(255,0,0,0.8),
                2px 2px 4px rgba(0,0,0,0.5);
            animation: damageNumberPop 0.3s ease-out;
        `;
        container.appendChild(damageText);
        
        // Particules de sang
        for (let i = 0; i < 8; i++) {
            const particle = document.createElement('div');
            const angle = (i / 8) * Math.PI * 2;
            const distance = 30 + Math.random() * 20;
            particle.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: ${6 + Math.random() * 6}px;
                height: ${6 + Math.random() * 6}px;
                background: #ff3333;
                border-radius: 50%;
                transform: translate(-50%, -50%);
                animation: bloodParticle 0.6s ease-out forwards;
                --tx: ${Math.cos(angle) * distance}px;
                --ty: ${Math.sin(angle) * distance}px;
            `;
            container.appendChild(particle);
        }
        
        document.body.appendChild(container);
        
        // Animation d'entrée
        container.style.animation = 'scratchAppear 0.15s ease-out';
        
        // Suppression après l'animation
        setTimeout(() => {
            container.style.animation = 'scratchDisappear 0.4s ease-out forwards';
            setTimeout(() => container.remove(), 400);
        }, this.TIMINGS.SCRATCH_DISPLAY);
    }
    
    // ==================== ANIMATION DE PROJECTILE ====================
    
    /**
     * Anime un projectile qui part d'une carte vers une cible
     */
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol, damage } = data;
        
        const startPos = this.getSlotCenter(startOwner, startRow, startCol);
        const endPos = targetCol === -1 
            ? this.getHeroCenter(targetOwner) 
            : this.getSlotCenter(targetOwner, targetRow, targetCol);
        
        if (!startPos || !endPos) return;
        
        // Créer le projectile (DOM)
        const projectile = document.createElement('div');
        projectile.className = 'combat-projectile';
        projectile.innerHTML = `
            <div class="projectile-core"></div>
            <div class="projectile-trail"></div>
            <div class="projectile-glow"></div>
        `;
        
        // Calculer l'angle
        const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);
        
        projectile.style.cssText = `
            position: fixed;
            left: ${startPos.x}px;
            top: ${startPos.y}px;
            transform: translate(-50%, -50%) rotate(${angle}rad);
            z-index: 10001;
            pointer-events: none;
        `;
        
        document.body.appendChild(projectile);
        
        // Animation du vol
        const duration = this.TIMINGS.PROJECTILE_FLIGHT;
        const startTime = performance.now();
        
        await new Promise(resolve => {
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Easing
                const eased = 1 - Math.pow(1 - progress, 3);
                
                const currentX = startPos.x + (endPos.x - startPos.x) * eased;
                const currentY = startPos.y + (endPos.y - startPos.y) * eased;
                
                projectile.style.left = currentX + 'px';
                projectile.style.top = currentY + 'px';
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    projectile.remove();
                    
                    // Impact + griffures
                    this.showImpactEffect(endPos.x, endPos.y);
                    if (damage !== undefined) {
                        this.showScratchDamage(endPos.x, endPos.y, damage);
                    }
                    
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    /**
     * Effet d'impact à l'arrivée du projectile
     */
    showImpactEffect(x, y) {
        const impact = document.createElement('div');
        impact.className = 'projectile-impact';
        impact.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(impact);
        setTimeout(() => impact.remove(), 500);
    }
    
    // ==================== ANIMATION DE CHARGE (solo) ====================
    
    /**
     * Une créature charge vers sa cible
     */
    async animateSoloAttack(data) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage, isFlying } = data;
        
        const attackerCard = this.getCardElement(attackerOwner, attackerRow, attackerCol);
        if (!attackerCard) return;
        
        let targetPos;
        if (targetCol === -1) {
            targetPos = this.getHeroCenter(targetOwner);
        } else {
            targetPos = this.getSlotCenter(targetOwner, targetRow, targetCol);
        }
        
        if (!targetPos) return;
        
        const rect = attackerCard.getBoundingClientRect();
        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;
        
        const dx = targetPos.x - startX;
        const dy = targetPos.y - startY;
        
        // Phase 1: Charge vers la cible
        attackerCard.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
        attackerCard.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
        attackerCard.style.zIndex = '1000';
        
        await this.wait(this.TIMINGS.ATTACK_MOVE);
        
        // Afficher les griffures à l'impact
        this.showImpactEffect(targetPos.x, targetPos.y);
        if (damage !== undefined) {
            this.showScratchDamage(targetPos.x, targetPos.y, damage);
        }
        
        // Phase 2: Retour
        attackerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms cubic-bezier(0.2, 0, 0.4, 1)`;
        attackerCard.style.transform = 'translate(0, 0) scale(1)';
        
        await this.wait(this.TIMINGS.ATTACK_RETURN);
        
        attackerCard.style.transition = '';
        attackerCard.style.zIndex = '';
    }
    
    // ==================== COMBAT MUTUEL MÊLÉE ====================
    
    /**
     * Deux créatures de mêlée s'entrechoquent au milieu
     * LES DEUX BOUGENT EN MÊME TEMPS
     */
    async animateMutualMelee(data) {
        const { attacker1, attacker2, damage1, damage2 } = data;
        
        const card1 = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2 = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!card1 || !card2) {
            console.warn('Cards not found for mutual combat', attacker1, attacker2);
            return;
        }
        
        const rect1 = card1.getBoundingClientRect();
        const rect2 = card2.getBoundingClientRect();
        
        const pos1 = { x: rect1.left + rect1.width / 2, y: rect1.top + rect1.height / 2 };
        const pos2 = { x: rect2.left + rect2.width / 2, y: rect2.top + rect2.height / 2 };
        
        // Point de rencontre au MILIEU
        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;
        
        // Déplacements pour chaque carte (50% du chemin)
        const dx1 = midX - pos1.x;
        const dy1 = midY - pos1.y;
        const dx2 = midX - pos2.x;
        const dy2 = midY - pos2.y;
        
        // Phase 1: LES DEUX cartes vont au milieu EN MÊME TEMPS
        card1.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
        card2.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
        
        card1.style.zIndex = '1000';
        card2.style.zIndex = '1001';
        
        // Appliquer les transformations SIMULTANÉMENT
        card1.style.transform = `translate(${dx1}px, ${dy1}px) scale(1.1)`;
        card2.style.transform = `translate(${dx2}px, ${dy2}px) scale(1.1)`;
        
        await this.wait(this.TIMINGS.ATTACK_MOVE);
        
        // Effet de CLASH au milieu
        this.showClashEffect(midX, midY);
        
        // Afficher les griffures pour les deux (décalées pour visibilité)
        if (damage1 !== undefined) {
            this.showScratchDamage(midX - 60, midY, damage1);
        }
        if (damage2 !== undefined) {
            setTimeout(() => {
                this.showScratchDamage(midX + 60, midY, damage2);
            }, 100);
        }
        
        await this.wait(100);
        
        // Phase 2: Les deux retournent EN MÊME TEMPS
        card1.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms cubic-bezier(0.2, 0, 0.4, 1)`;
        card2.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms cubic-bezier(0.2, 0, 0.4, 1)`;
        
        card1.style.transform = 'translate(0, 0) scale(1)';
        card2.style.transform = 'translate(0, 0) scale(1)';
        
        await this.wait(this.TIMINGS.ATTACK_RETURN);
        
        card1.style.transition = '';
        card2.style.transition = '';
        card1.style.zIndex = '';
        card2.style.zIndex = '';
    }
    
    /**
     * Effet de choc au point de rencontre
     */
    showClashEffect(x, y) {
        const clash = document.createElement('div');
        clash.className = 'clash-effect';
        clash.innerHTML = `
            <div class="clash-star">✦</div>
            <div class="clash-ring"></div>
        `;
        clash.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            z-index: 10002;
            pointer-events: none;
        `;
        document.body.appendChild(clash);
        
        // Étincelles
        for (let i = 0; i < 12; i++) {
            const spark = document.createElement('div');
            const angle = (i / 12) * Math.PI * 2;
            spark.className = 'clash-spark';
            spark.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: 8px;
                height: 8px;
                background: ${i % 2 === 0 ? '#ffff00' : '#ff8800'};
                border-radius: 50%;
                transform: translate(-50%, -50%);
                animation: sparkFly 0.5s ease-out forwards;
                --angle: ${angle}rad;
                --distance: ${40 + Math.random() * 30}px;
            `;
            clash.appendChild(spark);
        }
        
        setTimeout(() => clash.remove(), 600);
    }
    
    // ==================== TIREUR VS VOLANT (2 temps) ====================
    
    /**
     * Combat tireur vs volant/mêlée en 2 temps :
     * 1. Le tireur tire (projectile → griffure)
     * 2. L'autre charge (mouvement → griffure)
     */
    async animateShooterVsFlyer(data) {
        const { shooter, flyer, shooterDamage, flyerDamage } = data;
        
        const shooterPos = this.getSlotCenter(shooter.owner, shooter.row, shooter.col);
        const flyerPos = this.getSlotCenter(flyer.owner, flyer.row, flyer.col);
        const flyerCard = this.getCardElement(flyer.owner, flyer.row, flyer.col);
        
        if (!shooterPos || !flyerPos) return;
        
        // Phase 1: Le tireur tire sur l'autre
        await this.animateProjectile({
            startOwner: shooter.owner,
            startRow: shooter.row,
            startCol: shooter.col,
            targetOwner: flyer.owner,
            targetRow: flyer.row,
            targetCol: flyer.col,
            damage: shooterDamage
        });
        
        await this.wait(this.TIMINGS.BETWEEN_PHASES);
        
        // Phase 2: L'autre charge sur le tireur
        if (flyerCard) {
            const rect = flyerCard.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;
            
            const dx = shooterPos.x - startX;
            const dy = shooterPos.y - startY;
            
            flyerCard.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            flyerCard.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
            flyerCard.style.zIndex = '1000';
            
            await this.wait(this.TIMINGS.ATTACK_MOVE);
            
            // Griffures sur le tireur
            this.showImpactEffect(shooterPos.x, shooterPos.y);
            if (flyerDamage !== undefined) {
                this.showScratchDamage(shooterPos.x, shooterPos.y, flyerDamage);
            }
            
            flyerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
            flyerCard.style.transform = 'translate(0, 0) scale(1)';
            
            await this.wait(this.TIMINGS.ATTACK_RETURN);
            
            flyerCard.style.transition = '';
            flyerCard.style.zIndex = '';
        }
    }
    
    // ==================== DÉGÂTS AU HÉROS ====================
    
    async animateHeroHit(data) {
        const { owner, damage } = data;
        
        const pos = this.getHeroCenter(owner);
        if (!pos) return;
        
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.classList.add('hit');
            setTimeout(() => heroEl.classList.remove('hit'), 500);
        }
        
        this.showScratchDamage(pos.x, pos.y, damage);
    }
    
    // ==================== DÉGÂTS SUR CRÉATURE (standalone) ====================
    
    async animateDamage(data) {
        const { owner, row, col, amount } = data;
        
        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;
        
        const cardElement = this.getCardElement(owner, row, col);
        if (cardElement) {
            cardElement.classList.add('taking-damage');
            setTimeout(() => cardElement.classList.remove('taking-damage'), 400);
        }
        
        this.showScratchDamage(pos.x, pos.y, amount);
    }
    
    // ==================== COMPATIBILITÉ ====================
    
    async animateAttack(data) {
        await this.animateSoloAttack(data);
    }
    
    async animateMutualAttack(data) {
        await this.animateMutualMelee({
            attacker1: data.attacker1,
            attacker2: data.attacker2,
            damage1: data.damage2,
            damage2: data.damage1
        });
    }
}

// Instance globale
const CombatAnimations = new CombatAnimationSystem();

// ==================== CSS DES ANIMATIONS ====================
const combatAnimStyles = document.createElement('style');
combatAnimStyles.textContent = `
/* Animation d'apparition des griffures */
@keyframes scratchAppear {
    0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}

@keyframes scratchDisappear {
    0% { transform: translate(-50%, -50%) scale(1) translateY(0); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(0.8) translateY(-30px); opacity: 0; }
}

@keyframes damageNumberPop {
    0% { transform: translate(-50%, -50%) scale(0.5); }
    50% { transform: translate(-50%, -50%) scale(1.2); }
    100% { transform: translate(-50%, -50%) scale(1); }
}

@keyframes bloodParticle {
    0% { 
        transform: translate(-50%, -50%) translate(0, 0); 
        opacity: 1; 
    }
    100% { 
        transform: translate(-50%, -50%) translate(var(--tx), var(--ty)); 
        opacity: 0; 
    }
}

/* Projectile */
.combat-projectile {
    width: 60px;
    height: 20px;
}

.projectile-core {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 0;
    height: 0;
    border-left: 20px solid #ffdd00;
    border-top: 10px solid transparent;
    border-bottom: 10px solid transparent;
    filter: drop-shadow(0 0 8px rgba(255, 200, 0, 0.9));
}

.projectile-trail {
    position: absolute;
    right: 15px;
    top: 50%;
    transform: translateY(-50%);
    width: 45px;
    height: 8px;
    background: linear-gradient(to left, #ffaa00, #ff6600 50%, transparent);
    border-radius: 4px;
    filter: blur(2px);
}

.projectile-glow {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    width: 25px;
    height: 25px;
    background: radial-gradient(circle, rgba(255,220,0,0.8), transparent 70%);
    border-radius: 50%;
    animation: glowPulse 0.1s ease-in-out infinite alternate;
}

@keyframes glowPulse {
    0% { transform: translateY(-50%) scale(1); opacity: 0.8; }
    100% { transform: translateY(-50%) scale(1.3); opacity: 1; }
}

/* Impact */
.projectile-impact {
    width: 80px;
    height: 80px;
    background: radial-gradient(circle, rgba(255,200,0,0.9) 0%, rgba(255,100,0,0.5) 40%, transparent 70%);
    border-radius: 50%;
    animation: impactBurst 0.4s ease-out forwards;
}

@keyframes impactBurst {
    0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
}

/* Clash (entrechoc) */
.clash-effect {
    width: 100px;
    height: 100px;
}

.clash-star {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-size: 80px;
    color: #ffdd00;
    text-shadow: 0 0 20px rgba(255, 200, 0, 1), 0 0 40px rgba(255, 150, 0, 0.8);
    animation: starBurst 0.5s ease-out forwards;
}

@keyframes starBurst {
    0% { transform: translate(-50%, -50%) scale(0.3) rotate(0deg); opacity: 1; }
    50% { transform: translate(-50%, -50%) scale(1.2) rotate(180deg); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1.5) rotate(360deg); opacity: 0; }
}

.clash-ring {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    border: 4px solid #ffffff;
    border-radius: 50%;
    animation: ringExpand 0.5s ease-out forwards;
}

@keyframes ringExpand {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
}

@keyframes sparkFly {
    0% { 
        transform: translate(-50%, -50%) translate(0, 0); 
        opacity: 1; 
    }
    100% { 
        transform: translate(-50%, -50%) 
                   translate(calc(cos(var(--angle)) * var(--distance)), 
                             calc(sin(var(--angle)) * var(--distance))); 
        opacity: 0; 
    }
}

.clash-spark {
    box-shadow: 0 0 6px currentColor;
}

/* Cartes qui prennent des dégâts */
.taking-damage {
    animation: cardShake 0.4s ease-out !important;
}

@keyframes cardShake {
    0%, 100% { transform: translateX(0) rotate(0); }
    20% { transform: translateX(-10px) rotate(-3deg); }
    40% { transform: translateX(10px) rotate(3deg); }
    60% { transform: translateX(-6px) rotate(-2deg); }
    80% { transform: translateX(6px) rotate(2deg); }
}

/* Héros touché */
.hero-card.hit {
    animation: heroShake 0.5s ease-out !important;
}

@keyframes heroShake {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    10% { transform: scale(0.95); filter: brightness(2) saturate(0); }
    30% { transform: scale(1.02); filter: brightness(0.8); }
    50% { transform: scale(0.98); filter: brightness(1.3); }
}
`;
document.head.appendChild(combatAnimStyles);