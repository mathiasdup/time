/**
 * Combat Animations System - Style Hearthstone avec PixiJS
 * Animations fluides pour les combats de cartes
 */

class CombatAnimationSystem {
    constructor() {
        this.app = null;
        this.container = null;
        this.textures = {};
        this.animationQueue = [];
        this.isProcessing = false;
        this.initialized = false;
        
        // Timing des animations (en ms)
        this.TIMINGS = {
            ATTACK_MOVE_DURATION: 400,      // Durée du déplacement d'attaque
            ATTACK_RETURN_DURATION: 300,    // Durée du retour
            IMPACT_DISPLAY: 600,            // Durée affichage impact
            DAMAGE_SPLASH_DURATION: 2000,   // Durée du splash de dégâts (2 secondes)
            DELAY_BETWEEN_ATTACKS: 900,     // Délai entre chaque attaque
            DELAY_AFTER_DAMAGE: 500,        // Délai après affichage dégâts
            PROJECTILE_DURATION: 450,       // Durée du projectile tireur
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
        
        // Charger les textures
        await this.loadTextures();
        
        // Gérer le redimensionnement
        window.addEventListener('resize', () => this.handleResize());
        
        this.initialized = true;
        console.log('✅ Combat Animation System initialized with PixiJS');
    }
    
    async loadTextures() {
        try {
            // Charger l'image de dégâts
            this.textures.damage = await PIXI.Assets.load('/css/degats.png');
            console.log('✅ Damage texture loaded');
        } catch (e) {
            console.warn('Could not load damage texture, using fallback');
            this.textures.damage = null;
        }
    }
    
    handleResize() {
        if (this.app && this.app.renderer) {
            this.app.renderer.resize(window.innerWidth, window.innerHeight);
        }
    }
    
    // ==================== FILE D'ATTENTE D'ANIMATIONS ====================
    
    queueAnimation(type, data, delay = 0) {
        this.animationQueue.push({ type, data, delay });
        if (!this.isProcessing) {
            this.processQueue();
        }
    }
    
    async processQueue() {
        if (this.animationQueue.length === 0) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        const { type, data, delay } = this.animationQueue.shift();
        
        // Attendre le délai si spécifié
        if (delay > 0) {
            await this.wait(delay);
        }
        
        // Exécuter l'animation
        await this.executeAnimation(type, data);
        
        // Continuer la file
        this.processQueue();
    }
    
    async executeAnimation(type, data) {
        switch (type) {
            case 'attack':
                await this.animateAttack(data);
                break;
            case 'damage':
                await this.animateDamage(data);
                break;
            case 'heroHit':
                await this.animateHeroHit(data);
                break;
            case 'mutual_attack':
                await this.animateMutualAttack(data);
                break;
            case 'projectile':
                await this.animateProjectile(data);
                break;
        }
    }
    
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ==================== UTILITAIRES ====================
    
    getCardElement(owner, row, col) {
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        return slot?.querySelector('.card');
    }
    
    getSlotPosition(owner, row, col) {
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        if (!slot) return null;
        const rect = slot.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
        };
    }
    
    getHeroPosition(owner) {
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (!heroEl) return null;
        const rect = heroEl.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
        };
    }
    
    // Créer un sprite de carte pour l'animation
    createCardSprite(cardElement) {
        if (!cardElement) return null;
        
        const rect = cardElement.getBoundingClientRect();
        const container = new PIXI.Container();
        
        // Fond de la carte
        const bg = new PIXI.Graphics();
        bg.roundRect(-rect.width/2, -rect.height/2, rect.width, rect.height, 8);
        bg.fill({ color: 0x2a1a0a });
        bg.stroke({ width: 3, color: 0x8b7355 });
        container.addChild(bg);
        
        // Récupérer l'icône de la carte
        const iconEl = cardElement.querySelector('.card-art');
        if (iconEl) {
            const text = new PIXI.Text({
                text: iconEl.textContent,
                style: {
                    fontSize: 36,
                    fill: 0xffffff,
                }
            });
            text.anchor.set(0.5);
            text.y = -10;
            container.addChild(text);
        }
        
        container.x = rect.left + rect.width / 2;
        container.y = rect.top + rect.height / 2;
        
        return container;
    }
    
    // ==================== ANIMATIONS DE COMBAT ====================
    
    async animateAttack(data) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, isFlying } = data;
        
        const cardElement = this.getCardElement(attackerOwner, attackerRow, attackerCol);
        if (!cardElement) return;
        
        const startPos = this.getSlotPosition(attackerOwner, attackerRow, attackerCol);
        let endPos;
        
        if (targetCol === -1) {
            // Cible = héros
            endPos = this.getHeroPosition(targetOwner);
        } else {
            // Cible = créature
            endPos = this.getSlotPosition(targetOwner, targetRow, targetCol);
        }
        
        if (!startPos || !endPos) return;
        
        // Créer le sprite de carte pour l'animation
        const cardSprite = this.createCardSprite(cardElement);
        if (!cardSprite) return;
        
        this.app.stage.addChild(cardSprite);
        
        // Cacher la carte originale pendant l'animation
        cardElement.style.visibility = 'hidden';
        
        // Animation de déplacement vers la cible
        await this.tweenPosition(cardSprite, startPos, endPos, this.TIMINGS.ATTACK_MOVE_DURATION, 'easeInQuad');
        
        // Créer l'impact
        await this.createImpact(endPos.x, endPos.y, isFlying ? 'wind' : 'clash');
        
        // Animation de retour
        await this.tweenPosition(cardSprite, endPos, startPos, this.TIMINGS.ATTACK_RETURN_DURATION, 'easeOutQuad');
        
        // Nettoyer
        this.app.stage.removeChild(cardSprite);
        cardSprite.destroy();
        cardElement.style.visibility = 'visible';
    }
    
    async animateMutualAttack(data) {
        const { attacker1, attacker2 } = data;
        
        const card1Element = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2Element = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!card1Element || !card2Element) return;
        
        const pos1 = this.getSlotPosition(attacker1.owner, attacker1.row, attacker1.col);
        const pos2 = this.getSlotPosition(attacker2.owner, attacker2.row, attacker2.col);
        
        if (!pos1 || !pos2) return;
        
        // Point de rencontre au milieu
        const midPoint = {
            x: (pos1.x + pos2.x) / 2,
            y: (pos1.y + pos2.y) / 2
        };
        
        // Créer les sprites
        const sprite1 = this.createCardSprite(card1Element);
        const sprite2 = this.createCardSprite(card2Element);
        
        if (!sprite1 || !sprite2) return;
        
        this.app.stage.addChild(sprite1);
        this.app.stage.addChild(sprite2);
        
        // Cacher les cartes originales
        card1Element.style.visibility = 'hidden';
        card2Element.style.visibility = 'hidden';
        
        // Animation simultanée vers le milieu
        await Promise.all([
            this.tweenPosition(sprite1, pos1, midPoint, this.TIMINGS.ATTACK_MOVE_DURATION, 'easeInQuad'),
            this.tweenPosition(sprite2, pos2, midPoint, this.TIMINGS.ATTACK_MOVE_DURATION, 'easeInQuad')
        ]);
        
        // Impact au milieu
        await this.createImpact(midPoint.x, midPoint.y, 'clash');
        
        // Retour aux positions
        await Promise.all([
            this.tweenPosition(sprite1, midPoint, pos1, this.TIMINGS.ATTACK_RETURN_DURATION, 'easeOutQuad'),
            this.tweenPosition(sprite2, midPoint, pos2, this.TIMINGS.ATTACK_RETURN_DURATION, 'easeOutQuad')
        ]);
        
        // Nettoyer
        this.app.stage.removeChild(sprite1);
        this.app.stage.removeChild(sprite2);
        sprite1.destroy();
        sprite2.destroy();
        card1Element.style.visibility = 'visible';
        card2Element.style.visibility = 'visible';
    }
    
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol } = data;
        
        const startPos = this.getSlotPosition(startOwner, startRow, startCol);
        let endPos;
        
        if (targetCol === -1) {
            endPos = this.getHeroPosition(targetOwner);
        } else {
            endPos = this.getSlotPosition(targetOwner, targetRow, targetCol);
        }
        
        if (!startPos || !endPos) return;
        
        // Créer le projectile (flèche)
        const projectile = new PIXI.Container();
        
        // Corps de la flèche
        const arrow = new PIXI.Graphics();
        arrow.moveTo(-20, 0);
        arrow.lineTo(15, 0);
        arrow.stroke({ width: 4, color: 0xd4a574 });
        
        // Pointe de la flèche
        arrow.moveTo(15, 0);
        arrow.lineTo(5, -6);
        arrow.moveTo(15, 0);
        arrow.lineTo(5, 6);
        arrow.stroke({ width: 3, color: 0x8b4513 });
        
        projectile.addChild(arrow);
        
        // Calculer l'angle
        const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);
        projectile.rotation = angle;
        projectile.x = startPos.x;
        projectile.y = startPos.y;
        
        // Effet de trainée
        const trail = new PIXI.Graphics();
        trail.circle(0, 0, 3);
        trail.fill({ color: 0xffdd00, alpha: 0.8 });
        projectile.addChild(trail);
        
        this.app.stage.addChild(projectile);
        
        // Animation du projectile
        await this.tweenPosition(projectile, startPos, endPos, this.TIMINGS.PROJECTILE_DURATION, 'linear');
        
        // Impact
        await this.createImpact(endPos.x, endPos.y, 'arrow');
        
        // Nettoyer
        this.app.stage.removeChild(projectile);
        projectile.destroy();
    }
    
    // ==================== ANIMATIONS DE DÉGÂTS ====================
    
    async animateDamage(data) {
        const { owner, row, col, amount } = data;
        
        const pos = this.getSlotPosition(owner, row, col);
        if (!pos) return;
        
        await this.createDamageSplash(pos.x, pos.y, amount);
    }
    
    async animateHeroHit(data) {
        const { owner, amount } = data;
        
        const pos = this.getHeroPosition(owner);
        if (!pos) return;
        
        // Shake effect sur le héros
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.classList.add('hit');
            setTimeout(() => heroEl.classList.remove('hit'), 500);
        }
        
        await this.createDamageSplash(pos.x, pos.y, amount);
    }
    
    async createDamageSplash(x, y, amount) {
        const container = new PIXI.Container();
        container.x = x;
        container.y = y;
        
        // Taille du splash (2x plus grand)
        const splashSize = 180;
        
        // Image de dégâts ou fallback
        if (this.textures.damage) {
            const damageSprite = new PIXI.Sprite(this.textures.damage);
            damageSprite.anchor.set(0.5);
            damageSprite.width = splashSize;
            damageSprite.height = splashSize;
            container.addChild(damageSprite);
        } else {
            // Fallback: étoile de dégâts
            const star = new PIXI.Graphics();
            const spikes = 8;
            const outerRadius = splashSize / 2;
            const innerRadius = splashSize / 3;
            
            star.moveTo(0, -outerRadius);
            for (let i = 0; i < spikes * 2; i++) {
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const angle = (Math.PI * i) / spikes - Math.PI / 2;
                star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
            }
            star.closePath();
            star.fill({ color: 0xffa500 });
            star.stroke({ width: 4, color: 0xff6600 });
            container.addChild(star);
        }
        
        // Texte du nombre de dégâts
        const damageText = new PIXI.Text({
            text: `-${amount}`,
            style: {
                fontFamily: 'Cinzel, serif',
                fontSize: 48,
                fontWeight: 'bold',
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 6 },
                dropShadow: {
                    color: 0x000000,
                    blur: 4,
                    angle: Math.PI / 4,
                    distance: 4,
                }
            }
        });
        damageText.anchor.set(0.5);
        container.addChild(damageText);
        
        this.app.stage.addChild(container);
        
        // Animation d'apparition
        container.scale.set(0.2);
        container.alpha = 0;
        
        // Phase 1: Pop in
        await this.tweenScale(container, 0.2, 1.3, 150, 'easeOutBack');
        container.alpha = 1;
        
        // Phase 2: Settle
        await this.tweenScale(container, 1.3, 1.0, 100, 'easeInOutQuad');
        
        // Phase 3: Stay visible
        await this.wait(this.TIMINGS.DAMAGE_SPLASH_DURATION - 500);
        
        // Phase 4: Fade out et monte
        await this.tweenFadeUp(container, 250);
        
        // Nettoyer
        this.app.stage.removeChild(container);
        container.destroy();
    }
    
    // ==================== EFFETS D'IMPACT ====================
    
    async createImpact(x, y, type = 'clash') {
        const container = new PIXI.Container();
        container.x = x;
        container.y = y;
        
        // Particules d'impact
        const particleCount = type === 'clash' ? 12 : 8;
        const particles = [];
        
        for (let i = 0; i < particleCount; i++) {
            const particle = new PIXI.Graphics();
            const angle = (Math.PI * 2 * i) / particleCount;
            
            if (type === 'clash') {
                // Étoiles dorées pour le clash
                particle.star(0, 0, 5, 8, 4);
                particle.fill({ color: 0xffdd00 });
            } else if (type === 'wind') {
                // Lignes pour le vent
                particle.moveTo(0, 0);
                particle.lineTo(15, 0);
                particle.stroke({ width: 2, color: 0xaaddff });
            } else if (type === 'arrow') {
                // Points pour l'impact de flèche
                particle.circle(0, 0, 4);
                particle.fill({ color: 0xffaa00 });
            }
            
            particle.x = Math.cos(angle) * 5;
            particle.y = Math.sin(angle) * 5;
            particle.rotation = angle;
            particles.push({ sprite: particle, angle });
            container.addChild(particle);
        }
        
        // Cercle d'impact central
        const impactRing = new PIXI.Graphics();
        impactRing.circle(0, 0, 20);
        impactRing.stroke({ width: 4, color: type === 'wind' ? 0xaaddff : 0xffdd00 });
        container.addChild(impactRing);
        
        this.app.stage.addChild(container);
        
        // Animation des particules
        const duration = this.TIMINGS.IMPACT_DISPLAY;
        const startTime = performance.now();
        
        return new Promise(resolve => {
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Expansion des particules
                particles.forEach(p => {
                    const distance = 60 * this.easeOutQuad(progress);
                    p.sprite.x = Math.cos(p.angle) * distance;
                    p.sprite.y = Math.sin(p.angle) * distance;
                    p.sprite.alpha = 1 - progress;
                    p.sprite.scale.set(1 + progress * 0.5);
                });
                
                // Expansion et fade du cercle
                impactRing.scale.set(1 + progress * 2);
                impactRing.alpha = 1 - progress;
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    this.app.stage.removeChild(container);
                    container.destroy();
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    // ==================== TWEENING ====================
    
    tweenPosition(sprite, from, to, duration, easing = 'linear') {
        return new Promise(resolve => {
            const startTime = performance.now();
            
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easedProgress = this.applyEasing(progress, easing);
                
                sprite.x = from.x + (to.x - from.x) * easedProgress;
                sprite.y = from.y + (to.y - from.y) * easedProgress;
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    tweenScale(sprite, from, to, duration, easing = 'linear') {
        return new Promise(resolve => {
            const startTime = performance.now();
            
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easedProgress = this.applyEasing(progress, easing);
                
                const scale = from + (to - from) * easedProgress;
                sprite.scale.set(scale);
                sprite.alpha = Math.min(progress * 3, 1);
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    tweenFadeUp(sprite, duration) {
        return new Promise(resolve => {
            const startTime = performance.now();
            const startY = sprite.y;
            
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                sprite.alpha = 1 - progress;
                sprite.y = startY - 30 * progress;
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }
    
    applyEasing(t, type) {
        switch (type) {
            case 'easeInQuad':
                return t * t;
            case 'easeOutQuad':
                return t * (2 - t);
            case 'easeInOutQuad':
                return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            case 'easeOutBack':
                const c1 = 1.70158;
                const c3 = c1 + 1;
                return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
            case 'easeOutElastic':
                if (t === 0 || t === 1) return t;
                return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
            default:
                return t;
        }
    }
    
    easeOutQuad(t) {
        return t * (2 - t);
    }
}

// Instance globale
const CombatAnimations = new CombatAnimationSystem();