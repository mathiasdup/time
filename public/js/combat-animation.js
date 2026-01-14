/**
 * Combat Animations System - Style Magic Arena / Hearthstone
 * Animations fluides avec PixiJS
 * 
 * Types de combat :
 * - Tireur : projectile → griffure à l'impact
 * - Tireur vs Volant : projectile (griffure) puis charge du volant (griffure)
 * - Mêlée mutuel : entrechoc au milieu + griffures
 * - Solo (volant/mêlée) : charge vers cible + griffure
 */

class CombatAnimationSystem {
    constructor() {
        this.app = null;
        this.container = null;
        this.initialized = false;
        
        // Timing des animations (en ms)
        this.TIMINGS = {
            PROJECTILE_FLIGHT: 350,      // Durée vol du projectile
            ATTACK_MOVE: 280,            // Mouvement vers la cible
            ATTACK_RETURN: 220,          // Retour après attaque
            SCRATCH_DISPLAY: 1600,       // Durée affichage griffures
            IMPACT_DURATION: 350,        // Durée effet d'impact
            BETWEEN_PHASES: 150,         // Délai entre phases d'animation
            CLASH_PAUSE: 80,             // Pause lors de l'entrechoc
        };
    }
    
    async init() {
        if (this.initialized) return;
        
        // Créer le conteneur canvas
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
    
    getSlotElement(owner, row, col) {
        return document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
    }
    
    getSlotCenter(owner, row, col) {
        const slot = this.getSlotElement(owner, row, col);
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
    
    easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    
    easeOutQuad(t) {
        return t * (2 - t);
    }
    
    // ==================== ANIMATION DE GRIFFURE (SCRATCH) ====================
    
    /**
     * Crée l'animation de griffure sur une carte/héros
     * @param {number} x - Position X
     * @param {number} y - Position Y
     * @param {number} damage - Montant des dégâts
     */
    createScratchEffect(x, y, damage) {
        const container = new PIXI.Container();
        container.position.set(x, y);
        this.app.stage.addChild(container);
        
        // Créer 3 griffures rouges
        const scratches = new PIXI.Graphics();
        
        // Griffure 1 - principale (plus épaisse)
        scratches.moveTo(-20, -35);
        scratches.bezierCurveTo(-15, -10, 10, 10, 20, 35);
        scratches.stroke({ width: 6, color: 0xff2222, cap: 'round' });
        
        // Griffure 2
        scratches.moveTo(-5, -38);
        scratches.bezierCurveTo(0, -15, 5, 15, 10, 38);
        scratches.stroke({ width: 5, color: 0xff3333, cap: 'round' });
        
        // Griffure 3
        scratches.moveTo(-35, -25);
        scratches.bezierCurveTo(-25, 0, 20, 5, 30, 30);
        scratches.stroke({ width: 4, color: 0xff4444, cap: 'round' });
        
        // Highlights blancs pour effet de profondeur
        const highlights = new PIXI.Graphics();
        highlights.moveTo(-18, -33);
        highlights.bezierCurveTo(-13, -8, 12, 12, 22, 33);
        highlights.stroke({ width: 2, color: 0xffaaaa, alpha: 0.6, cap: 'round' });
        
        container.addChild(scratches);
        container.addChild(highlights);
        
        // Particules de sang/énergie
        const particles = [];
        for (let i = 0; i < 10; i++) {
            const particle = new PIXI.Graphics();
            particle.circle(0, 0, 2 + Math.random() * 4);
            particle.fill({ color: 0xff3333, alpha: 0.8 });
            particle.position.set(
                (Math.random() - 0.5) * 50,
                (Math.random() - 0.5) * 70
            );
            particle.vx = (Math.random() - 0.5) * 5;
            particle.vy = (Math.random() - 0.5) * 5;
            container.addChild(particle);
            particles.push(particle);
        }
        
        // Texte des dégâts - rouge vif sans contour noir
        const damageText = new PIXI.Text({
            text: `-${damage}`,
            style: {
                fontFamily: 'Arial Black, Arial, sans-serif',
                fontSize: 48,
                fontWeight: 'bold',
                fill: 0xff0000,
                dropShadow: {
                    color: 0x880000,
                    blur: 3,
                    distance: 2,
                    angle: Math.PI / 4,
                    alpha: 0.6
                }
            }
        });
        damageText.anchor.set(0.5);
        damageText.position.set(0, -55);
        container.addChild(damageText);
        
        // Animation
        container.scale.set(0.3);
        container.alpha = 0;
        
        const duration = this.TIMINGS.SCRATCH_DISPLAY;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 0.12) {
                // Apparition rapide avec overshoot
                const p = progress / 0.12;
                const scale = this.easeOutBack(p);
                container.scale.set(0.3 + 0.8 * scale);
                container.alpha = p;
            } else if (progress < 0.75) {
                // Stable
                container.scale.set(1.1);
                container.alpha = 1;
                scratches.rotation = Math.sin(elapsed * 0.008) * 0.02;
            } else {
                // Fade out en montant
                const p = (progress - 0.75) / 0.25;
                container.alpha = 1 - p;
                container.y = y - 35 * p;
                container.scale.set(1.1 - 0.15 * p);
            }
            
            // Animer les particules
            particles.forEach(particle => {
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.vy += 0.15; // gravité légère
                particle.alpha = Math.max(0, 0.8 - progress * 1.2);
            });
            
            // Texte monte légèrement
            damageText.y = -55 - progress * 20;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.app.stage.removeChild(container);
                container.destroy({ children: true });
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    // ==================== EFFET D'IMPACT ====================
    
    createImpactEffect(x, y, type = 'default') {
        const container = new PIXI.Container();
        container.position.set(x, y);
        this.app.stage.addChild(container);
        
        if (type === 'projectile') {
            // Impact de projectile - étoile dorée
            const burst = new PIXI.Graphics();
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const outerRadius = 25;
                const innerRadius = 10;
                
                if (i === 0) {
                    burst.moveTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
                } else {
                    burst.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
                }
                const midAngle = angle + Math.PI / 8;
                burst.lineTo(Math.cos(midAngle) * innerRadius, Math.sin(midAngle) * innerRadius);
            }
            burst.closePath();
            burst.fill({ color: 0xffdd00, alpha: 0.9 });
            container.addChild(burst);
            
            // Shockwave
            const ring = new PIXI.Graphics();
            ring.circle(0, 0, 15);
            ring.stroke({ width: 3, color: 0xffaa00, alpha: 0.7 });
            container.addChild(ring);
        } else {
            // Impact par défaut - éclats
            for (let i = 0; i < 12; i++) {
                const spark = new PIXI.Graphics();
                const angle = (Math.PI * 2 * i) / 12;
                const length = 15 + Math.random() * 12;
                
                spark.moveTo(0, 0);
                spark.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
                spark.stroke({ width: 3, color: 0xffdd00, cap: 'round' });
                container.addChild(spark);
            }
            
            const ring = new PIXI.Graphics();
            ring.circle(0, 0, 20);
            ring.stroke({ width: 4, color: 0xffaa00 });
            container.addChild(ring);
        }
        
        // Animation
        const duration = this.TIMINGS.IMPACT_DURATION;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;
            
            container.scale.set(1 + progress * 1.5);
            container.alpha = 1 - progress;
            container.rotation = progress * 0.3;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.app.stage.removeChild(container);
                container.destroy({ children: true });
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    // ==================== EFFET DE CHOC (CLASH) ====================
    
    createClashEffect(x, y) {
        const container = new PIXI.Container();
        container.position.set(x, y);
        this.app.stage.addChild(container);
        
        // Grande étoile d'énergie
        const star = new PIXI.Graphics();
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const outerRadius = 40;
            const innerRadius = 18;
            
            if (i === 0) {
                star.moveTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
            } else {
                star.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
            }
            const midAngle = angle + Math.PI / 12;
            star.lineTo(Math.cos(midAngle) * innerRadius, Math.sin(midAngle) * innerRadius);
        }
        star.closePath();
        star.fill({ color: 0xffdd00, alpha: 0.9 });
        container.addChild(star);
        
        // Cercle de shockwave
        const shockwave = new PIXI.Graphics();
        shockwave.circle(0, 0, 25);
        shockwave.stroke({ width: 5, color: 0xffffff, alpha: 0.8 });
        container.addChild(shockwave);
        
        // Étincelles
        const sparks = [];
        for (let i = 0; i < 18; i++) {
            const spark = new PIXI.Graphics();
            spark.circle(0, 0, 3 + Math.random() * 3);
            spark.fill({ color: i % 2 === 0 ? 0xffff00 : 0xff8800 });
            
            const angle = (i / 18) * Math.PI * 2;
            spark.vx = Math.cos(angle) * (4 + Math.random() * 3);
            spark.vy = Math.sin(angle) * (4 + Math.random() * 3);
            container.addChild(spark);
            sparks.push(spark);
        }
        
        // Animation
        container.scale.set(0.2);
        const duration = 450;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 0.2) {
                // Expansion rapide
                const p = progress / 0.2;
                container.scale.set(0.2 + 1.0 * this.easeOutBack(p));
                container.alpha = 1;
            } else {
                // Fade out
                const p = (progress - 0.2) / 0.8;
                container.scale.set(1.2 + p * 0.5);
                container.alpha = 1 - p;
            }
            
            star.rotation = progress * Math.PI;
            
            shockwave.scale.set(1 + progress * 3);
            shockwave.alpha = 0.8 * (1 - progress);
            
            sparks.forEach(spark => {
                spark.x += spark.vx;
                spark.y += spark.vy;
                spark.vy += 0.2;
                spark.alpha = 1 - progress;
            });
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.app.stage.removeChild(container);
                container.destroy({ children: true });
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    // ==================== ANIMATION DE PROJECTILE ====================
    
    /**
     * Anime un projectile + griffure à l'impact
     * @returns {Promise}
     */
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol, damage } = data;
        
        const startPos = this.getSlotCenter(startOwner, startRow, startCol);
        const endPos = targetCol === -1 
            ? this.getHeroCenter(targetOwner) 
            : this.getSlotCenter(targetOwner, targetRow, targetCol);
        
        if (!startPos || !endPos) return;
        
        // Créer le projectile
        const projectile = new PIXI.Container();
        
        // Trainée lumineuse
        const trail = new PIXI.Graphics();
        trail.moveTo(-35, 0);
        trail.lineTo(0, 0);
        trail.stroke({ width: 6, color: 0xffaa00, alpha: 0.6 });
        trail.moveTo(-55, 0);
        trail.lineTo(-35, 0);
        trail.stroke({ width: 4, color: 0xff6600, alpha: 0.3 });
        projectile.addChild(trail);
        
        // Corps (flèche d'énergie)
        const arrow = new PIXI.Graphics();
        arrow.moveTo(18, 0);
        arrow.lineTo(0, -6);
        arrow.lineTo(0, 6);
        arrow.closePath();
        arrow.fill({ color: 0xffdd44 });
        arrow.circle(0, 0, 7);
        arrow.fill({ color: 0xffff88 });
        arrow.circle(0, 0, 3);
        arrow.fill({ color: 0xffffff });
        projectile.addChild(arrow);
        
        // Glow
        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 14);
        glow.fill({ color: 0xffaa00, alpha: 0.35 });
        projectile.addChildAt(glow, 0);
        
        // Angle vers la cible
        const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);
        projectile.rotation = angle;
        projectile.position.set(startPos.x, startPos.y);
        
        this.app.stage.addChild(projectile);
        
        // Animation du projectile
        const duration = this.TIMINGS.PROJECTILE_FLIGHT;
        const startTime = performance.now();
        
        await new Promise(resolve => {
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Easing
                const eased = 1 - Math.pow(1 - progress, 2.5);
                
                projectile.x = startPos.x + (endPos.x - startPos.x) * eased;
                projectile.y = startPos.y + (endPos.y - startPos.y) * eased;
                
                // Pulsation du glow
                glow.scale.set(1 + Math.sin(progress * Math.PI * 5) * 0.15);
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    this.app.stage.removeChild(projectile);
                    projectile.destroy({ children: true });
                    
                    // IMPACT + GRIFFURE
                    this.createImpactEffect(endPos.x, endPos.y, 'projectile');
                    if (damage !== undefined) {
                        this.createScratchEffect(endPos.x, endPos.y, damage);
                    }
                    
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    // ==================== ANIMATION DE CHARGE (MOUVEMENT) ====================
    
    /**
     * Anime une carte qui charge vers une cible
     * @returns {Promise}
     */
    async animateCharge(cardElement, targetPos, returnToOrigin = true) {
        if (!cardElement) return;
        
        const rect = cardElement.getBoundingClientRect();
        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;
        
        const dx = targetPos.x - startX;
        const dy = targetPos.y - startY;
        
        return new Promise(resolve => {
            // Phase 1: Charge vers la cible
            cardElement.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            cardElement.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
            cardElement.style.zIndex = '1000';
            
            setTimeout(() => {
                if (returnToOrigin) {
                    // Phase 2: Retour
                    cardElement.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms cubic-bezier(0.2, 0, 0.4, 1)`;
                    cardElement.style.transform = 'translate(0, 0) scale(1)';
                    
                    setTimeout(() => {
                        cardElement.style.transition = '';
                        cardElement.style.zIndex = '';
                        resolve();
                    }, this.TIMINGS.ATTACK_RETURN);
                } else {
                    resolve();
                }
            }, this.TIMINGS.ATTACK_MOVE);
        });
    }
    
    // ==================== ATTAQUE SOLO (volant/mêlée seul) ====================
    
    /**
     * Une créature charge vers sa cible et inflige des dégâts
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
        
        // Charge vers la cible
        await this.animateCharge(attackerCard, targetPos, true);
        
        // Impact + Griffure
        this.createImpactEffect(targetPos.x, targetPos.y, isFlying ? 'default' : 'default');
        if (damage !== undefined) {
            this.createScratchEffect(targetPos.x, targetPos.y, damage);
        }
    }
    
    // ==================== COMBAT MUTUEL MÊLÉE (entrechoc au milieu) ====================
    
    /**
     * Deux créatures de mêlée s'entrechoquent au milieu
     */
    async animateMutualMelee(data) {
        const { attacker1, attacker2, damage1, damage2 } = data;
        
        const card1 = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2 = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!card1 || !card2) return;
        
        const pos1 = this.getSlotCenter(attacker1.owner, attacker1.row, attacker1.col);
        const pos2 = this.getSlotCenter(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!pos1 || !pos2) return;
        
        // Point de rencontre au milieu
        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;
        
        // Déplacements (50% du chemin chacun)
        const delta1X = midX - pos1.x;
        const delta1Y = midY - pos1.y;
        const delta2X = midX - pos2.x;
        const delta2Y = midY - pos2.y;
        
        return new Promise(resolve => {
            // Phase 1: Les deux vont au milieu
            card1.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            card2.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            
            card1.style.transform = `translate(${delta1X}px, ${delta1Y}px) scale(1.08)`;
            card2.style.transform = `translate(${delta2X}px, ${delta2Y}px) scale(1.08)`;
            
            card1.style.zIndex = '1000';
            card2.style.zIndex = '1001';
            
            setTimeout(() => {
                // CLASH au milieu
                this.createClashEffect(midX, midY);
                
                // Griffures sur les deux (légèrement décalées pour visibilité)
                if (damage1 !== undefined) {
                    this.createScratchEffect(midX - 50, midY, damage1);
                }
                if (damage2 !== undefined) {
                    this.createScratchEffect(midX + 50, midY, damage2);
                }
                
                // Pause à l'impact
                setTimeout(() => {
                    // Phase 2: Retour
                    card1.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms cubic-bezier(0.2, 0, 0.4, 1)`;
                    card2.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms cubic-bezier(0.2, 0, 0.4, 1)`;
                    
                    card1.style.transform = 'translate(0, 0) scale(1)';
                    card2.style.transform = 'translate(0, 0) scale(1)';
                    
                    setTimeout(() => {
                        card1.style.transition = '';
                        card2.style.transition = '';
                        card1.style.zIndex = '';
                        card2.style.zIndex = '';
                        resolve();
                    }, this.TIMINGS.ATTACK_RETURN);
                }, this.TIMINGS.CLASH_PAUSE);
            }, this.TIMINGS.ATTACK_MOVE);
        });
    }
    
    // ==================== TIREUR VS VOLANT (2 temps) ====================
    
    /**
     * Combat tireur vs volant en 2 temps :
     * 1. Le tireur tire (projectile → griffure sur volant)
     * 2. Le volant charge (mouvement → griffure sur tireur)
     */
    async animateShooterVsFlyer(data) {
        const { shooter, flyer, shooterDamage, flyerDamage } = data;
        
        const shooterPos = this.getSlotCenter(shooter.owner, shooter.row, shooter.col);
        const flyerPos = this.getSlotCenter(flyer.owner, flyer.row, flyer.col);
        const flyerCard = this.getCardElement(flyer.owner, flyer.row, flyer.col);
        
        if (!shooterPos || !flyerPos) return;
        
        // Phase 1: Le tireur tire sur le volant
        await this.animateProjectile({
            startOwner: shooter.owner,
            startRow: shooter.row,
            startCol: shooter.col,
            targetOwner: flyer.owner,
            targetRow: flyer.row,
            targetCol: flyer.col,
            damage: shooterDamage
        });
        
        // Délai entre les deux phases
        await this.wait(this.TIMINGS.BETWEEN_PHASES);
        
        // Phase 2: Le volant charge sur le tireur
        if (flyerCard) {
            await this.animateCharge(flyerCard, shooterPos, true);
            
            // Griffure sur le tireur
            this.createImpactEffect(shooterPos.x, shooterPos.y, 'default');
            if (flyerDamage !== undefined) {
                this.createScratchEffect(shooterPos.x, shooterPos.y, flyerDamage);
            }
        }
    }
    
    // ==================== DÉGÂTS AU HÉROS ====================
    
    async animateHeroHit(data) {
        const { owner, damage } = data;
        
        const pos = this.getHeroCenter(owner);
        if (!pos) return;
        
        // Shake sur le héros
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.classList.add('hit');
            setTimeout(() => heroEl.classList.remove('hit'), 500);
        }
        
        // Griffure sur le héros
        this.createScratchEffect(pos.x, pos.y, damage);
    }
    
    // ==================== DÉGÂTS SUR CRÉATURE (standalone) ====================
    
    async animateDamage(data) {
        const { owner, row, col, amount } = data;
        
        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;
        
        // Shake sur la carte
        const cardElement = this.getCardElement(owner, row, col);
        if (cardElement) {
            cardElement.classList.add('taking-damage');
            setTimeout(() => cardElement.classList.remove('taking-damage'), 400);
        }
        
        // Griffure
        this.createScratchEffect(pos.x, pos.y, amount);
    }
    
    // ==================== ANCIENNES MÉTHODES (compatibilité) ====================
    
    // Pour compatibilité avec l'ancien système
    async animateAttack(data) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, isFlying, damage } = data;
        
        await this.animateSoloAttack({
            attackerOwner,
            attackerRow,
            attackerCol,
            targetOwner,
            targetRow,
            targetCol,
            damage,
            isFlying
        });
    }
    
    async animateMutualAttack(data) {
        const { attacker1, attacker2, damage1, damage2 } = data;
        
        await this.animateMutualMelee({
            attacker1,
            attacker2,
            damage1: damage2, // Les dégâts que attacker1 inflige à attacker2
            damage2: damage1  // Les dégâts que attacker2 inflige à attacker1
        });
    }
}

// Instance globale
const CombatAnimations = new CombatAnimationSystem();

// CSS pour les animations DOM
const combatAnimStyle = document.createElement('style');
combatAnimStyle.textContent = `
.taking-damage {
    animation: takeDamage 0.4s ease-out;
}

@keyframes takeDamage {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px) rotate(-2deg); }
    40% { transform: translateX(8px) rotate(2deg); }
    60% { transform: translateX(-5px) rotate(-1deg); }
    80% { transform: translateX(5px) rotate(1deg); }
}

.hero-card.hit {
    animation: heroHit 0.5s ease-out;
}

@keyframes heroHit {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    20% { transform: scale(0.95); filter: brightness(1.5) saturate(0.5); }
    40% { transform: scale(1.02); filter: brightness(0.9); }
}
`;
document.head.appendChild(combatAnimStyle);