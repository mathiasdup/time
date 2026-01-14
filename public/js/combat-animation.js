/**
 * Combat Animations System - 100% DOM (pas de PixiJS)
 * Fonctionne toujours, sans dépendances externes
 */

class CombatAnimationSystem {
    constructor() {
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
        // Pas besoin d'initialisation complexe - tout est en DOM
        this.initialized = true;
        console.log('✅ Combat Animation System ready (DOM mode)');
        return Promise.resolve();
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
    
    // ==================== ANIMATION DE DÉGÂTS (GRIFFURES) ====================
    
    /**
     * Affiche les griffures + nombre de dégâts
     * C'est L'ANIMATION PRINCIPALE quand une créature/héros prend des dégâts
     */
    showDamageEffect(x, y, damage) {
        // Container principal
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%) scale(0.3);
            z-index: 10000;
            pointer-events: none;
            opacity: 0;
            transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.1s ease-out;
        `;
        
        // Les 3 griffures en SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '140');
        svg.setAttribute('height', '140');
        svg.setAttribute('viewBox', '-70 -70 140 140');
        svg.style.cssText = 'position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);';
        
        // Griffure 1 (principale)
        const scratch1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        scratch1.setAttribute('d', 'M-25,-50 C-20,-25 -10,0 0,25 S15,50 20,55');
        scratch1.setAttribute('stroke', '#ff0000');
        scratch1.setAttribute('stroke-width', '8');
        scratch1.setAttribute('fill', 'none');
        scratch1.setAttribute('stroke-linecap', 'round');
        svg.appendChild(scratch1);
        
        // Griffure 2
        const scratch2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        scratch2.setAttribute('d', 'M0,-55 C5,-30 10,-5 5,20 S0,45 5,58');
        scratch2.setAttribute('stroke', '#dd0000');
        scratch2.setAttribute('stroke-width', '6');
        scratch2.setAttribute('fill', 'none');
        scratch2.setAttribute('stroke-linecap', 'round');
        svg.appendChild(scratch2);
        
        // Griffure 3
        const scratch3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        scratch3.setAttribute('d', 'M25,-45 C30,-20 20,5 25,30 S30,50 25,55');
        scratch3.setAttribute('stroke', '#cc0000');
        scratch3.setAttribute('stroke-width', '5');
        scratch3.setAttribute('fill', 'none');
        scratch3.setAttribute('stroke-linecap', 'round');
        svg.appendChild(scratch3);
        
        container.appendChild(svg);
        
        // Nombre de dégâts
        const damageNum = document.createElement('div');
        damageNum.textContent = `-${damage}`;
        damageNum.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            font-family: 'Arial Black', Arial, sans-serif;
            font-size: 52px;
            font-weight: bold;
            color: #ff0000;
            text-shadow: 
                0 0 10px rgba(255,0,0,0.9),
                0 0 20px rgba(255,0,0,0.6),
                3px 3px 6px rgba(0,0,0,0.7);
            white-space: nowrap;
        `;
        container.appendChild(damageNum);
        
        // Particules de sang
        for (let i = 0; i < 10; i++) {
            const particle = document.createElement('div');
            const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
            const distance = 40 + Math.random() * 30;
            const size = 5 + Math.random() * 8;
            
            particle.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: ${size}px;
                height: ${size}px;
                background: #ff2222;
                border-radius: 50%;
                transform: translate(-50%, -50%);
                opacity: 1;
                box-shadow: 0 0 4px #ff0000;
            `;
            particle.dataset.angle = angle;
            particle.dataset.distance = distance;
            container.appendChild(particle);
        }
        
        document.body.appendChild(container);
        
        // Déclencher l'animation d'apparition
        requestAnimationFrame(() => {
            container.style.transform = 'translate(-50%, -50%) scale(1)';
            container.style.opacity = '1';
        });
        
        // Animer les particules
        const particles = container.querySelectorAll('div[data-angle]');
        let startTime = performance.now();
        
        const animateParticles = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / 600, 1);
            
            particles.forEach(p => {
                const angle = parseFloat(p.dataset.angle);
                const distance = parseFloat(p.dataset.distance);
                const currentDist = distance * progress;
                const x = Math.cos(angle) * currentDist;
                const y = Math.sin(angle) * currentDist + progress * 20; // gravité
                p.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
                p.style.opacity = 1 - progress;
            });
            
            if (progress < 1) {
                requestAnimationFrame(animateParticles);
            }
        };
        animateParticles();
        
        // Disparition
        setTimeout(() => {
            container.style.transition = 'transform 0.4s ease-in, opacity 0.4s ease-in';
            container.style.transform = 'translate(-50%, -70%) scale(0.8)';
            container.style.opacity = '0';
            setTimeout(() => container.remove(), 400);
        }, this.TIMINGS.SCRATCH_DISPLAY);
    }
    
    // ==================== ANIMATION DE PROJECTILE (TIREUR) ====================
    
    /**
     * Un projectile part de la carte tireur vers la cible
     * LE TIREUR NE BOUGE PAS
     */
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol, damage } = data;
        
        const startPos = this.getSlotCenter(startOwner, startRow, startCol);
        const endPos = targetCol === -1 
            ? this.getHeroCenter(targetOwner) 
            : this.getSlotCenter(targetOwner, targetRow, targetCol);
        
        if (!startPos || !endPos) {
            console.warn('Positions not found for projectile');
            return;
        }
        
        // Créer le projectile
        const projectile = document.createElement('div');
        const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x) * (180 / Math.PI);
        
        projectile.innerHTML = `
            <div style="
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 0;
                height: 0;
                border-left: 22px solid #ffdd00;
                border-top: 11px solid transparent;
                border-bottom: 11px solid transparent;
                filter: drop-shadow(0 0 8px #ffaa00);
            "></div>
            <div style="
                position: absolute;
                right: 18px;
                top: 50%;
                transform: translateY(-50%);
                width: 50px;
                height: 10px;
                background: linear-gradient(to left, #ffcc00, #ff8800 60%, transparent);
                border-radius: 5px;
            "></div>
            <div style="
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                width: 30px;
                height: 30px;
                background: radial-gradient(circle, rgba(255,220,0,0.8), transparent 70%);
                border-radius: 50%;
            "></div>
        `;
        
        projectile.style.cssText = `
            position: fixed;
            width: 70px;
            height: 30px;
            left: ${startPos.x}px;
            top: ${startPos.y}px;
            transform: translate(-50%, -50%) rotate(${angle}deg);
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
                const eased = 1 - Math.pow(1 - progress, 3);
                
                const currentX = startPos.x + (endPos.x - startPos.x) * eased;
                const currentY = startPos.y + (endPos.y - startPos.y) * eased;
                
                projectile.style.left = currentX + 'px';
                projectile.style.top = currentY + 'px';
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    projectile.remove();
                    
                    // Impact
                    this.showImpact(endPos.x, endPos.y);
                    
                    // Griffures avec dégâts
                    if (damage !== undefined) {
                        this.showDamageEffect(endPos.x, endPos.y, damage);
                    }
                    
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    /**
     * Effet d'impact
     */
    showImpact(x, y) {
        const impact = document.createElement('div');
        impact.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 60px;
            height: 60px;
            transform: translate(-50%, -50%) scale(0.5);
            background: radial-gradient(circle, rgba(255,200,0,0.9) 0%, rgba(255,100,0,0.5) 40%, transparent 70%);
            border-radius: 50%;
            z-index: 10000;
            pointer-events: none;
            transition: transform 0.3s ease-out, opacity 0.3s ease-out;
        `;
        document.body.appendChild(impact);
        
        requestAnimationFrame(() => {
            impact.style.transform = 'translate(-50%, -50%) scale(2.5)';
            impact.style.opacity = '0';
        });
        
        setTimeout(() => impact.remove(), 300);
    }
    
    // ==================== ATTAQUE SOLO (mêlée/volant) ====================
    
    /**
     * Une créature charge vers sa cible
     */
    async animateSoloAttack(data) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage } = data;
        
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
        
        // Charge vers la cible
        attackerCard.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
        attackerCard.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
        attackerCard.style.zIndex = '1000';
        
        await this.wait(this.TIMINGS.ATTACK_MOVE);
        
        // Impact + Griffures
        this.showImpact(targetPos.x, targetPos.y);
        if (damage !== undefined) {
            this.showDamageEffect(targetPos.x, targetPos.y, damage);
        }
        
        // Retour
        attackerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
        attackerCard.style.transform = '';
        
        await this.wait(this.TIMINGS.ATTACK_RETURN);
        
        attackerCard.style.transition = '';
        attackerCard.style.zIndex = '';
    }
    
    // ==================== COMBAT MUTUEL MÊLÉE ====================
    
    /**
     * DEUX créatures vont AU MILIEU EN MÊME TEMPS et s'entrechoquent
     */
    async animateMutualMelee(data) {
        const { attacker1, attacker2, damage1, damage2 } = data;
        
        const card1 = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2 = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!card1 || !card2) {
            console.warn('Cards not found for mutual melee');
            return;
        }
        
        const rect1 = card1.getBoundingClientRect();
        const rect2 = card2.getBoundingClientRect();
        
        const pos1 = { x: rect1.left + rect1.width / 2, y: rect1.top + rect1.height / 2 };
        const pos2 = { x: rect2.left + rect2.width / 2, y: rect2.top + rect2.height / 2 };
        
        // Point de rencontre AU MILIEU
        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;
        
        // Chaque carte fait 50% du chemin
        const dx1 = midX - pos1.x;
        const dy1 = midY - pos1.y;
        const dx2 = midX - pos2.x;
        const dy2 = midY - pos2.y;
        
        // LES DEUX bougent EN MÊME TEMPS
        card1.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
        card2.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
        card1.style.zIndex = '1000';
        card2.style.zIndex = '1001';
        
        // Appliquer SIMULTANÉMENT
        card1.style.transform = `translate(${dx1}px, ${dy1}px) scale(1.1)`;
        card2.style.transform = `translate(${dx2}px, ${dy2}px) scale(1.1)`;
        
        await this.wait(this.TIMINGS.ATTACK_MOVE);
        
        // CLASH au milieu
        this.showClashEffect(midX, midY);
        
        // Griffures des deux côtés
        if (damage1 !== undefined) {
            this.showDamageEffect(midX - 70, midY, damage1);
        }
        if (damage2 !== undefined) {
            setTimeout(() => {
                this.showDamageEffect(midX + 70, midY, damage2);
            }, 80);
        }
        
        await this.wait(100);
        
        // Retour des deux EN MÊME TEMPS
        card1.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
        card2.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
        card1.style.transform = '';
        card2.style.transform = '';
        
        await this.wait(this.TIMINGS.ATTACK_RETURN);
        
        card1.style.transition = '';
        card2.style.transition = '';
        card1.style.zIndex = '';
        card2.style.zIndex = '';
    }
    
    /**
     * Effet de CLASH (entrechoc)
     */
    showClashEffect(x, y) {
        const clash = document.createElement('div');
        clash.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            z-index: 10002;
            pointer-events: none;
        `;
        
        // Grande étoile
        const star = document.createElement('div');
        star.textContent = '✦';
        star.style.cssText = `
            font-size: 100px;
            color: #ffdd00;
            text-shadow: 0 0 30px #ffaa00, 0 0 60px #ff8800;
            animation: clashStar 0.5s ease-out forwards;
        `;
        clash.appendChild(star);
        
        // Cercle de shockwave
        const ring = document.createElement('div');
        ring.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 50px;
            height: 50px;
            border: 5px solid white;
            border-radius: 50%;
            animation: clashRing 0.5s ease-out forwards;
        `;
        clash.appendChild(ring);
        
        // Étincelles
        for (let i = 0; i < 14; i++) {
            const spark = document.createElement('div');
            const angle = (i / 14) * Math.PI * 2;
            const distance = 50 + Math.random() * 40;
            spark.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: 10px;
                height: 10px;
                background: ${i % 2 === 0 ? '#ffff00' : '#ff8800'};
                border-radius: 50%;
                box-shadow: 0 0 8px currentColor;
                animation: sparkFly${i} 0.5s ease-out forwards;
            `;
            
            // Créer l'animation unique pour chaque étincelle
            const styleEl = document.createElement('style');
            styleEl.textContent = `
                @keyframes sparkFly${i} {
                    0% { transform: translate(-50%, -50%); opacity: 1; }
                    100% { 
                        transform: translate(
                            calc(-50% + ${Math.cos(angle) * distance}px), 
                            calc(-50% + ${Math.sin(angle) * distance}px)
                        ); 
                        opacity: 0; 
                    }
                }
            `;
            document.head.appendChild(styleEl);
            clash.appendChild(spark);
            
            setTimeout(() => styleEl.remove(), 600);
        }
        
        document.body.appendChild(clash);
        setTimeout(() => clash.remove(), 600);
    }
    
    // ==================== TIREUR VS VOLANT (2 temps) ====================
    
    async animateShooterVsFlyer(data) {
        const { shooter, flyer, shooterDamage, flyerDamage } = data;
        
        const shooterPos = this.getSlotCenter(shooter.owner, shooter.row, shooter.col);
        const flyerPos = this.getSlotCenter(flyer.owner, flyer.row, flyer.col);
        const flyerCard = this.getCardElement(flyer.owner, flyer.row, flyer.col);
        
        if (!shooterPos || !flyerPos) return;
        
        // Phase 1: Le tireur tire (projectile)
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
        
        // Phase 2: Le volant charge sur le tireur
        if (flyerCard) {
            const rect = flyerCard.getBoundingClientRect();
            const dx = shooterPos.x - (rect.left + rect.width / 2);
            const dy = shooterPos.y - (rect.top + rect.height / 2);
            
            flyerCard.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            flyerCard.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
            flyerCard.style.zIndex = '1000';
            
            await this.wait(this.TIMINGS.ATTACK_MOVE);
            
            this.showImpact(shooterPos.x, shooterPos.y);
            if (flyerDamage !== undefined) {
                this.showDamageEffect(shooterPos.x, shooterPos.y, flyerDamage);
            }
            
            flyerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
            flyerCard.style.transform = '';
            
            await this.wait(this.TIMINGS.ATTACK_RETURN);
            
            flyerCard.style.transition = '';
            flyerCard.style.zIndex = '';
        }
    }
    
    // ==================== DÉGÂTS AU HÉROS ====================
    
    async animateHeroHit(data) {
        const { owner, damage, amount } = data;
        const dmg = damage || amount;
        
        const pos = this.getHeroCenter(owner);
        if (!pos) return;
        
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.style.animation = 'heroShake 0.5s ease-out';
            setTimeout(() => heroEl.style.animation = '', 500);
        }
        
        this.showDamageEffect(pos.x, pos.y, dmg);
    }
    
    // ==================== DÉGÂTS SUR CRÉATURE ====================
    
    async animateDamage(data) {
        const { owner, row, col, amount } = data;
        
        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;
        
        const card = this.getCardElement(owner, row, col);
        if (card) {
            card.style.animation = 'cardShake 0.4s ease-out';
            setTimeout(() => card.style.animation = '', 400);
        }
        
        this.showDamageEffect(pos.x, pos.y, amount);
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

// Initialiser immédiatement
CombatAnimations.init();

// ==================== CSS ANIMATIONS ====================
const combatCSS = document.createElement('style');
combatCSS.textContent = `
@keyframes clashStar {
    0% { transform: scale(0.3) rotate(0deg); opacity: 1; }
    50% { transform: scale(1.2) rotate(180deg); opacity: 1; }
    100% { transform: scale(1.5) rotate(360deg); opacity: 0; }
}

@keyframes clashRing {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
}

@keyframes cardShake {
    0%, 100% { transform: translateX(0) rotate(0); }
    20% { transform: translateX(-12px) rotate(-4deg); }
    40% { transform: translateX(12px) rotate(4deg); }
    60% { transform: translateX(-8px) rotate(-2deg); }
    80% { transform: translateX(8px) rotate(2deg); }
}

@keyframes heroShake {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    15% { transform: scale(0.92); filter: brightness(2) saturate(0); }
    30% { transform: scale(1.05); filter: brightness(0.7); }
    50% { transform: scale(0.97); filter: brightness(1.4); }
    70% { transform: scale(1.02); filter: brightness(0.9); }
}
`;
document.head.appendChild(combatCSS);