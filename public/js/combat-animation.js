/**
 * Combat Animations System - Hybrid DOM + PixiJS VFX
 * Mouvements en DOM, effets d'impact en PixiJS
 */

class CombatAnimationSystem {
    constructor() {
        this.initialized = false;
        this.vfxReady = false;
        this.TIMINGS = {
            PROJECTILE_FLIGHT: 400,
            ATTACK_MOVE: 300,
            ATTACK_RETURN: 250,
            SCRATCH_DISPLAY: 2000,
            BETWEEN_PHASES: 200,
        };
    }

    async init() {
        this.initialized = true;

        // Initialiser le système VFX PixiJS
        if (typeof CombatVFX !== 'undefined') {
            try {
                await CombatVFX.init();
                this.vfxReady = true;
                console.log('✅ Combat Animation System ready (DOM + PixiJS VFX)');
            } catch (e) {
                console.warn('VFX init failed, using fallback:', e);
                this.vfxReady = false;
            }
        } else {
            console.warn('CombatVFX not found, using DOM fallback');
        }

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
    
    // ==================== ANIMATION DE DÉGÂTS (VFX) ====================

    /**
     * Affiche un effet d'impact + nombre de dégâts
     * Utilise PixiJS VFX si disponible, sinon fallback DOM
     * @param {number} x - Position X
     * @param {number} y - Position Y
     * @param {number} damage - Dégâts
     * @param {string} effectType - Type d'effet: 'claw', 'slash', 'bite', 'impact'
     */
    showDamageEffect(x, y, damage, effectType = 'claw') {
        // Utiliser le système VFX PixiJS si disponible
        if (this.vfxReady && typeof CombatVFX !== 'undefined') {
            CombatVFX.playDamageEffect(effectType, x, y, damage, { color: 0xFF3333 });
            return;
        }

        // Fallback DOM simple
        this.showDamageEffectFallback(x, y, damage);
    }

    /**
     * Fallback DOM pour l'effet de dégâts
     */
    showDamageEffectFallback(x, y, damage) {
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

        // Nombre de dégâts
        const damageNum = document.createElement('div');
        damageNum.textContent = `-${damage}`;
        damageNum.style.cssText = `
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

        document.body.appendChild(container);

        requestAnimationFrame(() => {
            container.style.transform = 'translate(-50%, -50%) scale(1)';
            container.style.opacity = '1';
        });

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
                    
                    // Impact avec effet de projectile
                    if (damage !== undefined) {
                        this.showDamageEffect(endPos.x, endPos.y, damage, 'impact');
                    }
                    
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    /**
     * Effet d'impact - utilise VFX ou fallback
     */
    showImpact(x, y) {
        if (this.vfxReady && typeof CombatVFX !== 'undefined') {
            CombatVFX.createImpactEffect(x, y, 0xFFAA00, 0.7);
            return;
        }

        // Fallback DOM
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

        // Effet de dégâts - griffes ou slash selon le type
        const effectType = data.isFlying ? 'slash' : 'claw';
        if (damage !== undefined) {
            this.showDamageEffect(targetPos.x, targetPos.y, damage, effectType);
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
        
        // CLASH au milieu avec effet VFX
        this.showClashEffect(midX, midY);

        // Griffures des deux côtés - slash croisés
        if (damage1 !== undefined) {
            this.showDamageEffect(midX - 60, midY, damage1, 'slash');
        }
        if (damage2 !== undefined) {
            setTimeout(() => {
                this.showDamageEffect(midX + 60, midY, damage2, 'slash');
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
     * Effet de CLASH (entrechoc) - utilise VFX ou fallback
     */
    showClashEffect(x, y) {
        // Utiliser le système VFX PixiJS si disponible
        if (this.vfxReady && typeof CombatVFX !== 'undefined') {
            CombatVFX.createClashEffect(x, y);
            return;
        }

        // Fallback DOM
        const clash = document.createElement('div');
        clash.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            z-index: 10002;
            pointer-events: none;
        `;

        const star = document.createElement('div');
        star.textContent = '✦';
        star.style.cssText = `
            font-size: 100px;
            color: #ffdd00;
            text-shadow: 0 0 30px #ffaa00, 0 0 60px #ff8800;
            animation: clashStar 0.5s ease-out forwards;
        `;
        clash.appendChild(star);

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
            
            // Le volant attaque avec un slash
            if (flyerDamage !== undefined) {
                this.showDamageEffect(shooterPos.x, shooterPos.y, flyerDamage, 'slash');
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

        // Effet aléatoire pour le héros (griffe ou morsure)
        const effectType = Math.random() > 0.5 ? 'claw' : 'bite';
        this.showDamageEffect(pos.x, pos.y, dmg, effectType);
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

        // Effet aléatoire (claw, slash ou bite)
        const effects = ['claw', 'slash', 'bite'];
        const effectType = effects[Math.floor(Math.random() * effects.length)];
        this.showDamageEffect(pos.x, pos.y, amount, effectType);
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