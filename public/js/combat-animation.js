/**
 * Combat Animations System - Hybrid DOM + PixiJS VFX
 * - Mouvements des créatures en DOM (mêlée/volant se déplacent, tireur tire)
 * - Effets d'impact en PixiJS (explosion, clash, flammes)
 */

class CombatAnimationSystem {
    constructor() {
        this.initialized = false;
        this.TIMINGS = {
            PROJECTILE_FLIGHT: 400,
            ATTACK_MOVE: 300,
            ATTACK_RETURN: 250,
            BETWEEN_PHASES: 200,
        };
    }

    async init() {
        this.initialized = true;

        // Initialiser le système VFX PixiJS
        await CombatVFX.init();

        return Promise.resolve();
    }

    // ==================== UTILITAIRES ====================

    getCardElement(owner, row, col) {
        const slot = getSlot(owner, row, col);
        return slot?.querySelector('.card');
    }

    getSlotCenter(owner, row, col) {
        const slot = getSlot(owner, row, col);
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

    // ==================== EFFET DE DÉGÂTS (EXPLOSION) ====================

    /**
     * Effet d'explosion avec dégâts affichés
     * C'est L'UNIQUE animation de dégâts
     */
    showDamageEffect(x, y, damage) {
        CombatVFX.createDamageExplosion(x, y, damage);
    }

    // ==================== EFFET DE FLAMMES (SORTS) ====================

    /**
     * Effet de flammes pour les sorts de dégâts
     */
    showFlameEffect(x, y, damage) {
        CombatVFX.createFlameEffect(x, y, damage);
    }

    // ==================== ANIMATION PROJECTILE (TIREUR) ====================

    /**
     * Un projectile part de la carte tireur vers la cible
     * LE TIREUR NE BOUGE PAS - Flèche d'énergie lumineuse
     */
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol, damage } = data;

        const startPos = this.getSlotCenter(startOwner, startRow, startCol);
        const endPos = targetCol === -1
            ? this.getHeroCenter(targetOwner)
            : this.getSlotCenter(targetOwner, targetRow, targetCol);

        if (!startPos || !endPos) {
            return;
        }

        // Animation de recul sur la carte tireur
        const shooterCard = this.getCardElement(startOwner, startRow, startCol);
        if (shooterCard) {
            shooterCard.classList.add('shooting');
            setTimeout(() => shooterCard.classList.remove('shooting'), 300);
        }

        // Projectile PixiJS (flèche d'énergie + traînée)
        await CombatVFX.animateProjectile(
            startPos.x, startPos.y,
            endPos.x, endPos.y,
            this.TIMINGS.PROJECTILE_FLIGHT
        );

        // Impact
        CombatVFX.createProjectileImpact(endPos.x, endPos.y, damage);
    }

    // ==================== ATTAQUE SOLO (mêlée/volant) ====================

    /**
     * Une créature mêlée ou volante charge vers sa cible
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

        // Marquer la carte comme étant en combat (désactive l'animation de vol)
        attackerCard.dataset.inCombat = 'true';

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

        // Effet d'explosion à l'impact
        if (damage !== undefined) {
            this.showDamageEffect(targetPos.x, targetPos.y, damage);
        }

        // Shake + explosion sur le héros à l'impact
        if (targetCol === -1) {
            const heroEl = document.getElementById(targetOwner === 'me' ? 'hero-me' : 'hero-opp');
            if (heroEl) {
                heroEl.style.animation = 'heroShake 0.5s ease-out';
                heroEl.classList.add('hero-hit');
                setTimeout(() => { heroEl.style.animation = ''; heroEl.classList.remove('hero-hit'); }, 550);
                const heroRect = heroEl.getBoundingClientRect();
                CombatVFX.createHeroHitEffect(heroRect.left + heroRect.width / 2, heroRect.top + heroRect.height / 2, heroRect.width, heroRect.height);
            }
        }

        // Retour
        attackerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
        attackerCard.style.transform = '';

        await this.wait(this.TIMINGS.ATTACK_RETURN);

        attackerCard.style.transition = '';
        attackerCard.style.zIndex = '';
    }

    // ==================== COMBAT MUTUEL MÊLÉE (ÉPIQUE) ====================

    /**
     * Animation cinématique de combat mutuel qualité AAA
     * Phase 1: Anticipation (recul + aura d'énergie)
     * Phase 2: Charge explosive (accélération brutale vers le centre)
     * Phase 3: Impact & Freeze-frame (flash + gel + clash VFX)
     * Phase 4: Recul shockwave (les cartes sont repoussées par l'onde de choc)
     * Phase 5: Retour fluide à la position initiale
     */
    async animateMutualMelee(data) {
        const { attacker1, attacker2, damage1, damage2 } = data;

        const card1 = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2 = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);

        if (!card1 || !card2) {
            return;
        }

        // Marquer les cartes comme étant en combat
        card1.dataset.inCombat = 'true';
        card2.dataset.inCombat = 'true';

        const rect1 = card1.getBoundingClientRect();
        const rect2 = card2.getBoundingClientRect();

        const pos1 = { x: rect1.left + rect1.width / 2, y: rect1.top + rect1.height / 2 };
        const pos2 = { x: rect2.left + rect2.width / 2, y: rect2.top + rect2.height / 2 };

        // Point d'impact AU MILIEU
        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;

        // Vecteurs vers le milieu
        const dx1 = midX - pos1.x;
        const dy1 = midY - pos1.y;
        const dx2 = midX - pos2.x;
        const dy2 = midY - pos2.y;

        // Vecteurs de recul (direction opposée au milieu, normalisés)
        const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
        const recoilDist = 30; // pixels de recul pour l'anticipation
        const recoil1X = -(dx1 / dist1) * recoilDist;
        const recoil1Y = -(dy1 / dist1) * recoilDist;
        const recoil2X = -(dx2 / dist2) * recoilDist;
        const recoil2Y = -(dy2 / dist2) * recoilDist;

        // Vecteurs de knockback post-impact (repoussés depuis le milieu)
        const knockbackDist = 45;
        const knock1X = -(dx1 / dist1) * knockbackDist;
        const knock1Y = -(dy1 / dist1) * knockbackDist;
        const knock2X = -(dx2 / dist2) * knockbackDist;
        const knock2Y = -(dy2 / dist2) * knockbackDist;

        card1.style.zIndex = '1000';
        card2.style.zIndex = '1001';

        // ═══════════════════════════════════════
        // PHASE 1 : ANTICIPATION (recul + scale down)
        // ═══════════════════════════════════════
        card1.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)';
        card2.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)';
        card1.style.transform = `translate(${recoil1X}px, ${recoil1Y}px) scale(0.92)`;
        card2.style.transform = `translate(${recoil2X}px, ${recoil2Y}px) scale(0.92)`;

        await this.wait(200);

        // ═══════════════════════════════════════
        // PHASE 2 : CHARGE EXPLOSIVE vers le centre
        // ═══════════════════════════════════════
        // cubic-bezier très agressif : lent au début → accélération brutale
        card1.style.transition = 'transform 180ms cubic-bezier(0.0, 0, 0.2, 1)';
        card2.style.transition = 'transform 180ms cubic-bezier(0.0, 0, 0.2, 1)';
        card1.style.transform = `translate(${dx1}px, ${dy1}px) scale(1.12)`;
        card2.style.transform = `translate(${dx2}px, ${dy2}px) scale(1.12)`;

        await this.wait(180);

        // ═══════════════════════════════════════
        // PHASE 3 : IMPACT — FREEZE-FRAME + VFX ÉPIQUES
        // ═══════════════════════════════════════
        // Freeze : on coupe la transition (les cartes restent en place)
        card1.style.transition = 'none';
        card2.style.transition = 'none';

        // Lancer l'effet de clash ÉPIQUE
        this.showClashEffect(midX, midY);

        // Dégâts affichés avec stagger
        if (damage1 !== undefined) {
            setTimeout(() => this.showDamageEffect(midX - 50, midY, damage1), 80);
        }
        if (damage2 !== undefined) {
            setTimeout(() => this.showDamageEffect(midX + 50, midY, damage2), 130);
        }

        // Freeze-frame : les cartes restent immobiles pendant l'explosion
        await this.wait(120);

        // ═══════════════════════════════════════
        // PHASE 4 : RECUL DÛ À L'ONDE DE CHOC
        // ═══════════════════════════════════════
        // Les cartes sont brutalement repoussées par l'impact
        card1.style.transition = 'transform 150ms cubic-bezier(0.0, 0.8, 0.4, 1)';
        card2.style.transition = 'transform 150ms cubic-bezier(0.0, 0.8, 0.4, 1)';
        card1.style.transform = `translate(${knock1X}px, ${knock1Y}px) scale(0.95) rotate(${(Math.random() - 0.5) * 6}deg)`;
        card2.style.transform = `translate(${knock2X}px, ${knock2Y}px) scale(0.95) rotate(${(Math.random() - 0.5) * 6}deg)`;

        await this.wait(150);

        // ═══════════════════════════════════════
        // PHASE 5 : RETOUR FLUIDE À LA POSITION
        // ═══════════════════════════════════════
        card1.style.transition = 'transform 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        card2.style.transition = 'transform 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        card1.style.transform = '';
        card2.style.transform = '';

        await this.wait(350);

        // Nettoyage
        card1.style.transition = '';
        card2.style.transition = '';
        card1.style.zIndex = '';
        card2.style.zIndex = '';
    }

    /**
     * Effet de CLASH (entrechoc)
     */
    showClashEffect(x, y) {
        CombatVFX.createClashEffect(x, y);
    }

    // ==================== TIREUR VS VOLANT (SIMULTANÉ) ====================

    /**
     * Animation SIMULTANÉE :
     * - Le volant charge vers le tireur
     * - Le projectile est tiré et touche le volant EN COURS DE DÉPLACEMENT (au milieu)
     * - Le volant termine son animation et frappe le tireur
     * - Les dégâts sont résolus ensemble à la fin
     */
    async animateShooterVsFlyer(data) {
        const { shooter, flyer, shooterDamage, flyerDamage } = data;

        const shooterPos = this.getSlotCenter(shooter.owner, shooter.row, shooter.col);
        const flyerPos = this.getSlotCenter(flyer.owner, flyer.row, flyer.col);
        const flyerCard = this.getCardElement(flyer.owner, flyer.row, flyer.col);

        if (!shooterPos || !flyerPos || !flyerCard) return;

        // Marquer la carte volante comme étant en combat
        flyerCard.dataset.inCombat = 'true';

        const flyerRect = flyerCard.getBoundingClientRect();
        const flyerStartX = flyerRect.left + flyerRect.width / 2;
        const flyerStartY = flyerRect.top + flyerRect.height / 2;

        // Calculer le déplacement du volant vers le tireur
        const dx = shooterPos.x - flyerStartX;
        const dy = shooterPos.y - flyerStartY;

        // Point d'interception : le volant sera à mi-chemin quand le projectile le touche
        const interceptX = flyerStartX + dx * 0.5;
        const interceptY = flyerStartY + dy * 0.5;

        // Durée totale de l'animation du volant
        const flyerMoveDuration = this.TIMINGS.ATTACK_MOVE;
        // Le projectile doit arriver au point d'interception quand le volant y est (à 50% du trajet)
        const projectileDuration = flyerMoveDuration * 0.5;

        // Lancer les deux animations EN PARALLÈLE
        const flyerAnimation = (async () => {
            // Le volant se déplace vers le tireur
            flyerCard.style.transition = `transform ${flyerMoveDuration}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            flyerCard.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
            flyerCard.style.zIndex = '1000';

            await this.wait(flyerMoveDuration);

            // Le volant frappe le tireur
            if (flyerDamage !== undefined) {
                this.showDamageEffect(shooterPos.x, shooterPos.y, flyerDamage);
            }

            // Retour du volant
            flyerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
            flyerCard.style.transform = '';

            await this.wait(this.TIMINGS.ATTACK_RETURN);

            flyerCard.style.transition = '';
            flyerCard.style.zIndex = '';
        })();

        const projectileAnimation = (async () => {
            // Créer le projectile qui vise le point d'interception
            await this.animateProjectileToPoint({
                startPos: shooterPos,
                targetPos: { x: interceptX, y: interceptY },
                duration: projectileDuration,
                damage: shooterDamage
            });
        })();

        // Attendre que les deux animations soient terminées
        await Promise.all([flyerAnimation, projectileAnimation]);
    }

    /**
     * Anime un projectile vers un point précis (pour l'interception)
     */
    async animateProjectileToPoint(data) {
        const { startPos, targetPos, duration, damage } = data;

        await CombatVFX.animateProjectile(
            startPos.x, startPos.y,
            targetPos.x, targetPos.y,
            duration
        );

        if (damage !== undefined) {
            this.showDamageEffect(targetPos.x, targetPos.y, damage);
        }
    }

    // ==================== COMBAT MUTUEL TIREURS ====================

    /**
     * Deux tireurs se tirent dessus EN MÊME TEMPS (projectiles croisés simultanés)
     */
    async animateMutualShooters(data) {
        const { shooter1, shooter2, damage1, damage2 } = data;

        // Lancer les deux projectiles en parallèle
        await Promise.all([
            this.animateProjectile({
                startOwner: shooter1.owner,
                startRow: shooter1.row,
                startCol: shooter1.col,
                targetOwner: shooter2.owner,
                targetRow: shooter2.row,
                targetCol: shooter2.col,
                damage: damage1
            }),
            this.animateProjectile({
                startOwner: shooter2.owner,
                startRow: shooter2.row,
                startCol: shooter2.col,
                targetOwner: shooter1.owner,
                targetRow: shooter1.row,
                targetCol: shooter1.col,
                damage: damage2
            })
        ]);
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

    // ==================== DÉGÂTS DE SORT (FLAMMES) ====================

    async animateSpellDamage(data) {
        const { owner, row, col, amount } = data;

        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;

        const card = this.getCardElement(owner, row, col);
        if (card) {
            card.style.animation = 'cardShake 0.4s ease-out';
            setTimeout(() => card.style.animation = '', 400);
        }

        // Utiliser l'effet de flammes pour les sorts
        this.showFlameEffect(pos.x, pos.y, amount);
    }

    // ==================== ATTAQUES PARALLÈLES ====================

    /**
     * Anime deux attaques qui se déroulent EN MÊME TEMPS
     * (chaque créature attaque sa propre cible, indépendamment)
     */
    async animateParallelAttacks(data) {
        const { attack1, attack2 } = data;

        // Préparer les animations
        const animations = [];

        // Animation de l'attaque 1
        if (attack1) {
            animations.push(this.animateSingleAttack(attack1));
        }

        // Animation de l'attaque 2
        if (attack2) {
            animations.push(this.animateSingleAttack(attack2));
        }

        // Lancer toutes les animations en parallèle
        await Promise.all(animations);
    }

    /**
     * Anime une seule attaque (utilisé par animateParallelAttacks)
     */
    async animateSingleAttack(attack) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage, isShooter } = attack;

        if (isShooter) {
            // Tireur = projectile
            await this.animateProjectile({
                startOwner: attackerOwner,
                startRow: attackerRow,
                startCol: attackerCol,
                targetOwner: targetOwner,
                targetRow: targetRow,
                targetCol: targetCol,
                damage: damage
            });
        } else {
            // Mêlée ou volant = charge
            await this.animateSoloAttack({
                attackerOwner,
                attackerRow,
                attackerCol,
                targetOwner,
                targetRow,
                targetCol,
                damage
            });
        }
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

@keyframes slotShake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-4px); }
    40% { transform: translateX(4px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(2px); }
}
`;
document.head.appendChild(combatCSS);
