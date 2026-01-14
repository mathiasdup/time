/**
 * Combat Animations System - Style Magic Arena / Hearthstone
 * Animations fluides avec PixiJS
 */

class CombatAnimationSystem {
    constructor() {
        this.app = null;
        this.container = null;
        this.animationQueue = [];
        this.isProcessing = false;
        this.initialized = false;
        
        // Timing des animations (en ms) - Plus rapide
        this.TIMINGS = {
            ATTACK_MOVE_DURATION: 250,      // Mouvement rapide vers la cible
            ATTACK_RETURN_DURATION: 200,    // Retour rapide
            IMPACT_DURATION: 400,           // Durée de l'impact
            DAMAGE_DISPLAY: 1800,           // Durée affichage dégâts (griffures)
            DELAY_BETWEEN_ATTACKS: 700,     // Délai entre attaques
            PROJECTILE_DURATION: 300,       // Projectile rapide
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
        
        // Gérer le redimensionnement
        window.addEventListener('resize', () => this.handleResize());
        
        this.initialized = true;
        console.log('✅ Combat Animation System initialized');
    }
    
    handleResize() {
        if (this.app && this.app.renderer) {
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
    
    // ==================== ANIMATION D'ATTAQUE ====================
    
    async animateAttack(data) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, isFlying } = data;
        
        const cardElement = this.getCardElement(attackerOwner, attackerRow, attackerCol);
        if (!cardElement) return;
        
        const startPos = this.getSlotCenter(attackerOwner, attackerRow, attackerCol);
        const endPos = targetCol === -1 
            ? this.getHeroCenter(targetOwner)
            : this.getSlotCenter(targetOwner, targetRow, targetCol);
        
        if (!startPos || !endPos) return;
        
        // Calculer le déplacement complet vers la cible
        const deltaX = endPos.x - startPos.x;
        const deltaY = endPos.y - startPos.y;
        
        // Animation CSS fluide sur la carte DOM
        cardElement.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        cardElement.style.zIndex = '1000';
        cardElement.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.1)`;
        
        await this.wait(this.TIMINGS.ATTACK_MOVE_DURATION);
        
        // Impact à destination
        this.createImpactEffect(endPos.x, endPos.y, isFlying ? 'wind' : 'slash');
        
        // Retour
        cardElement.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`;
        cardElement.style.transform = '';
        
        await this.wait(this.TIMINGS.ATTACK_RETURN_DURATION);
        
        cardElement.style.zIndex = '';
        cardElement.style.transition = '';
    }
    
    // ==================== COMBAT MUTUEL - 50/50 AU MILIEU ====================
    
    async animateMutualAttack(data) {
        const { attacker1, attacker2 } = data;
        
        const card1 = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2 = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!card1 || !card2) return;
        
        const pos1 = this.getSlotCenter(attacker1.owner, attacker1.row, attacker1.col);
        const pos2 = this.getSlotCenter(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!pos1 || !pos2) return;
        
        // Point de collision au milieu exact (50/50)
        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;
        
        // Déplacement de chaque carte vers le milieu
        const delta1X = midX - pos1.x;
        const delta1Y = midY - pos1.y;
        const delta2X = midX - pos2.x;
        const delta2Y = midY - pos2.y;
        
        // Animation simultanée des deux cartes vers le milieu
        card1.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        card2.style.transition = `transform ${this.TIMINGS.ATTACK_MOVE_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        card1.style.zIndex = '1000';
        card2.style.zIndex = '1001';
        
        card1.style.transform = `translate(${delta1X}px, ${delta1Y}px) scale(1.05)`;
        card2.style.transform = `translate(${delta2X}px, ${delta2Y}px) scale(1.05)`;
        
        await this.wait(this.TIMINGS.ATTACK_MOVE_DURATION);
        
        // Impact violent au milieu
        this.createClashEffect(midX, midY);
        
        // Légère pause pour l'impact
        await this.wait(80);
        
        // Retour des deux cartes
        card1.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`;
        card2.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`;
        card1.style.transform = '';
        card2.style.transform = '';
        
        await this.wait(this.TIMINGS.ATTACK_RETURN_DURATION);
        
        card1.style.zIndex = '';
        card2.style.zIndex = '';
        card1.style.transition = '';
        card2.style.transition = '';
    }
    
    // ==================== PROJECTILE TIREUR ====================
    
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol } = data;
        
        const startPos = this.getSlotCenter(startOwner, startRow, startCol);
        const endPos = targetCol === -1 
            ? this.getHeroCenter(targetOwner) 
            : this.getSlotCenter(targetOwner, targetRow, targetCol);
        
        if (!startPos || !endPos) return;
        
        // Créer le projectile avec PixiJS
        const projectile = new PIXI.Container();
        
        // Trainée lumineuse
        const trail = new PIXI.Graphics();
        trail.moveTo(-30, 0);
        trail.lineTo(0, 0);
        trail.stroke({ width: 6, color: 0xffaa00, alpha: 0.6 });
        trail.moveTo(-50, 0);
        trail.lineTo(-30, 0);
        trail.stroke({ width: 4, color: 0xff6600, alpha: 0.3 });
        projectile.addChild(trail);
        
        // Corps du projectile (flèche/énergie)
        const arrow = new PIXI.Graphics();
        // Pointe
        arrow.moveTo(15, 0);
        arrow.lineTo(0, -5);
        arrow.lineTo(0, 5);
        arrow.closePath();
        arrow.fill({ color: 0xffdd44 });
        // Corps lumineux
        arrow.circle(0, 0, 6);
        arrow.fill({ color: 0xffff88 });
        arrow.circle(0, 0, 3);
        arrow.fill({ color: 0xffffff });
        projectile.addChild(arrow);
        
        // Glow effect
        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 12);
        glow.fill({ color: 0xffaa00, alpha: 0.3 });
        projectile.addChildAt(glow, 0);
        
        // Angle vers la cible
        const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);
        projectile.rotation = angle;
        projectile.x = startPos.x;
        projectile.y = startPos.y;
        
        this.app.stage.addChild(projectile);
        
        // Animation du projectile
        const duration = this.TIMINGS.PROJECTILE_DURATION;
        const startTime = performance.now();
        
        await new Promise(resolve => {
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Easing rapide au début, ralentit à la fin
                const eased = 1 - Math.pow(1 - progress, 2);
                
                projectile.x = startPos.x + (endPos.x - startPos.x) * eased;
                projectile.y = startPos.y + (endPos.y - startPos.y) * eased;
                
                // Effet de pulsation
                const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.1;
                glow.scale.set(pulse);
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    this.app.stage.removeChild(projectile);
                    projectile.destroy();
                    // Impact à l'arrivée
                    this.createImpactEffect(endPos.x, endPos.y, 'arrow');
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    // ==================== ANIMATION DE DÉGÂTS - GRIFFURES ====================
    
    async animateDamage(data) {
        const { owner, row, col, amount } = data;
        
        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;
        
        // Shake sur la carte DOM
        const cardElement = this.getCardElement(owner, row, col);
        if (cardElement) {
            cardElement.classList.add('taking-damage');
            setTimeout(() => cardElement.classList.remove('taking-damage'), 400);
        }
        
        // Créer l'effet de griffures avec PixiJS
        this.createScratchEffect(pos.x, pos.y, amount);
    }
    
    createScratchEffect(x, y, amount) {
        const container = new PIXI.Container();
        container.x = x;
        container.y = y;
        
        // Créer 3 griffures
        const scratches = new PIXI.Graphics();
        const scratchColor = 0xff3333;
        
        // Griffure 1 - principale
        this.drawScratch(scratches, -25, -30, 25, 30, scratchColor, 5);
        // Griffure 2
        this.drawScratch(scratches, -10, -35, 15, 25, scratchColor, 4);
        // Griffure 3
        this.drawScratch(scratches, -35, -20, 30, 35, scratchColor, 3);
        
        container.addChild(scratches);
        
        // Particules de sang/énergie
        for (let i = 0; i < 8; i++) {
            const particle = new PIXI.Graphics();
            const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
            const size = 3 + Math.random() * 4;
            particle.circle(0, 0, size);
            particle.fill({ color: 0xff4444 });
            particle.x = Math.cos(angle) * 15;
            particle.y = Math.sin(angle) * 15;
            particle.alpha = 0.8;
            container.addChild(particle);
        }
        
        // Texte des dégâts - SANS contour noir, juste rouge vif
        const damageText = new PIXI.Text({
            text: `-${amount}`,
            style: {
                fontFamily: 'Arial Black, sans-serif',
                fontSize: 52,
                fontWeight: 'bold',
                fill: 0xff2222,
                dropShadow: {
                    color: 0x990000,
                    blur: 2,
                    angle: Math.PI / 4,
                    distance: 2,
                    alpha: 0.5
                }
            }
        });
        damageText.anchor.set(0.5);
        damageText.y = -5;
        container.addChild(damageText);
        
        this.app.stage.addChild(container);
        
        // Animation
        container.scale.set(0.3);
        container.alpha = 0;
        
        const duration = this.TIMINGS.DAMAGE_DISPLAY;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 0.15) {
                // Phase 1: Apparition rapide avec overshoot
                const p = progress / 0.15;
                const scale = this.easeOutBack(p);
                container.scale.set(0.3 + 0.9 * scale);
                container.alpha = p;
            } else if (progress < 0.8) {
                // Phase 2: Stable
                container.scale.set(1.2);
                container.alpha = 1;
                
                // Légère ondulation des griffures
                scratches.rotation = Math.sin(elapsed * 0.01) * 0.02;
            } else {
                // Phase 3: Fade out en montant
                const p = (progress - 0.8) / 0.2;
                container.alpha = 1 - p;
                container.y = y - 30 * p;
                container.scale.set(1.2 - 0.2 * p);
            }
            
            // Animer les particules
            container.children.forEach((child, i) => {
                if (child !== scratches && child !== damageText) {
                    const angle = (Math.PI * 2 * i) / 8;
                    const dist = 15 + progress * 40;
                    child.x = Math.cos(angle) * dist;
                    child.y = Math.sin(angle) * dist;
                    child.alpha = Math.max(0, 0.8 - progress);
                }
            });
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.app.stage.removeChild(container);
                container.destroy();
            }
        };
        requestAnimationFrame(animate);
    }
    
    drawScratch(graphics, x1, y1, x2, y2, color, width) {
        // Ligne principale de la griffure
        graphics.moveTo(x1, y1);
        
        // Ajouter des variations pour un aspect naturel
        const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * 10;
        const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * 10;
        
        graphics.quadraticCurveTo(midX, midY, x2, y2);
        graphics.stroke({ width: width, color: color, cap: 'round' });
        
        // Ligne plus fine par-dessus (highlight)
        graphics.moveTo(x1 + 2, y1 + 2);
        graphics.quadraticCurveTo(midX + 2, midY + 2, x2 + 2, y2 + 2);
        graphics.stroke({ width: width * 0.4, color: 0xffaaaa, cap: 'round' });
    }
    
    // ==================== DÉGÂTS AU HÉROS ====================
    
    async animateHeroHit(data) {
        const { owner, amount } = data;
        
        const pos = this.getHeroCenter(owner);
        if (!pos) return;
        
        // Shake sur le héros DOM
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.classList.add('hit');
            setTimeout(() => heroEl.classList.remove('hit'), 500);
        }
        
        // Effet de griffures sur le héros
        this.createScratchEffect(pos.x, pos.y, amount);
    }
    
    // ==================== EFFETS D'IMPACT ====================
    
    createImpactEffect(x, y, type = 'slash') {
        const container = new PIXI.Container();
        container.x = x;
        container.y = y;
        
        if (type === 'slash') {
            // Impact de mêlée - éclats
            for (let i = 0; i < 12; i++) {
                const spark = new PIXI.Graphics();
                const angle = (Math.PI * 2 * i) / 12;
                const length = 15 + Math.random() * 10;
                
                spark.moveTo(0, 0);
                spark.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
                spark.stroke({ width: 3, color: 0xffdd00, cap: 'round' });
                
                container.addChild(spark);
            }
            
            // Cercle d'impact
            const ring = new PIXI.Graphics();
            ring.circle(0, 0, 25);
            ring.stroke({ width: 4, color: 0xffaa00 });
            container.addChild(ring);
            
        } else if (type === 'wind') {
            // Impact aérien - lignes de vent
            for (let i = 0; i < 8; i++) {
                const line = new PIXI.Graphics();
                const angle = (Math.PI * 2 * i) / 8;
                const curve = Math.random() * 20;
                
                line.moveTo(0, 0);
                line.quadraticCurveTo(
                    Math.cos(angle + 0.3) * curve,
                    Math.sin(angle + 0.3) * curve,
                    Math.cos(angle) * 30,
                    Math.sin(angle) * 30
                );
                line.stroke({ width: 2, color: 0x88ccff, cap: 'round' });
                container.addChild(line);
            }
            
        } else if (type === 'arrow') {
            // Impact de projectile - éclat
            const burst = new PIXI.Graphics();
            burst.star(0, 0, 6, 20, 10);
            burst.fill({ color: 0xffaa00 });
            container.addChild(burst);
            
            // Particules
            for (let i = 0; i < 6; i++) {
                const p = new PIXI.Graphics();
                p.circle(0, 0, 3);
                p.fill({ color: 0xffdd00 });
                const angle = (Math.PI * 2 * i) / 6;
                p.x = Math.cos(angle) * 10;
                p.y = Math.sin(angle) * 10;
                container.addChild(p);
            }
        }
        
        this.app.stage.addChild(container);
        
        // Animation de l'impact
        const duration = this.TIMINGS.IMPACT_DURATION;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;
            
            // Expansion et fade
            container.scale.set(1 + progress * 1.5);
            container.alpha = 1 - progress;
            container.rotation = progress * 0.3;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.app.stage.removeChild(container);
                container.destroy();
            }
        };
        requestAnimationFrame(animate);
    }
    
    createClashEffect(x, y) {
        const container = new PIXI.Container();
        container.x = x;
        container.y = y;
        
        // Explosion d'énergie au centre
        const burst = new PIXI.Graphics();
        burst.star(0, 0, 8, 40, 20);
        burst.fill({ color: 0xffdd00 });
        container.addChild(burst);
        
        // Cercle de choc
        const shockwave = new PIXI.Graphics();
        shockwave.circle(0, 0, 30);
        shockwave.stroke({ width: 5, color: 0xffffff });
        container.addChild(shockwave);
        
        // Étincelles
        for (let i = 0; i < 16; i++) {
            const spark = new PIXI.Graphics();
            const angle = (Math.PI * 2 * i) / 16;
            
            spark.moveTo(0, 0);
            spark.lineTo(Math.cos(angle) * 25, Math.sin(angle) * 25);
            spark.stroke({ width: 3, color: i % 2 === 0 ? 0xffff00 : 0xff8800, cap: 'round' });
            
            container.addChild(spark);
        }
        
        // Particules d'énergie
        for (let i = 0; i < 10; i++) {
            const p = new PIXI.Graphics();
            const size = 4 + Math.random() * 6;
            p.circle(0, 0, size);
            p.fill({ color: 0xffffaa });
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 20;
            p.x = Math.cos(angle) * dist;
            p.y = Math.sin(angle) * dist;
            container.addChild(p);
        }
        
        this.app.stage.addChild(container);
        
        // Animation explosive
        container.scale.set(0.3);
        const duration = 500;
        const startTime = performance.now();
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 0.2) {
                // Expansion rapide
                const p = progress / 0.2;
                container.scale.set(0.3 + 1.2 * this.easeOutBack(p));
                container.alpha = 1;
            } else {
                // Fade out
                const p = (progress - 0.2) / 0.8;
                container.scale.set(1.5 + p * 0.5);
                container.alpha = 1 - p;
            }
            
            // Rotation de l'étoile
            burst.rotation = progress * Math.PI;
            
            // Expansion de la shockwave
            shockwave.scale.set(1 + progress * 2);
            shockwave.alpha = 1 - progress;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.app.stage.removeChild(container);
                container.destroy();
            }
        };
        requestAnimationFrame(animate);
    }
    
    // ==================== EASING FUNCTIONS ====================
    
    easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    
    easeOutQuad(t) {
        return t * (2 - t);
    }
    
    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }
}

// Instance globale
const CombatAnimations = new CombatAnimationSystem();