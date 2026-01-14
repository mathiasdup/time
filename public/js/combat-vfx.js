/**
 * Combat VFX System - Effets visuels de qualité professionnelle
 * Utilise PixiJS 8 pour des animations fluides
 */

class CombatVFXSystem {
    constructor() {
        this.app = null;
        this.container = null;
        this.initialized = false;
        this.activeEffects = [];
    }

    async init() {
        if (this.initialized) return;

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

            this.app.canvas.style.position = 'fixed';
            this.app.canvas.style.top = '0';
            this.app.canvas.style.left = '0';
            this.app.canvas.style.pointerEvents = 'none';
            this.app.canvas.style.zIndex = '10000';
            document.body.appendChild(this.app.canvas);

            this.container = new PIXI.Container();
            this.app.stage.addChild(this.container);

            window.addEventListener('resize', () => this.handleResize());
            this.app.ticker.add(() => this.update());

            this.initialized = true;
            console.log('✅ Combat VFX System initialized');

        } catch (e) {
            console.error('❌ Combat VFX init failed:', e);
            throw e;
        }
    }

    handleResize() {
        if (this.app) {
            this.app.renderer.resize(window.innerWidth, window.innerHeight);
        }
    }

    update() {
        this.activeEffects = this.activeEffects.filter(effect => {
            if (effect.finished) {
                if (effect.container && effect.container.parent) {
                    effect.container.parent.removeChild(effect.container);
                }
                return false;
            }
            return true;
        });
    }

    // ==================== EFFET D'EXPLOSION/SPLASH (DÉGÂTS) ====================

    /**
     * Explosion avec onde de choc et nombre de dégâts
     * C'est L'UNIQUE effet de dégâts utilisé
     */
    createDamageExplosion(x, y, damage, color = 0xFF6600) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 400,
        };

        // Flash central
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 50);
        flash.fill({ color: 0xFFFFFF });
        effectContainer.addChild(flash);

        // Onde de choc 1
        const ring1 = new PIXI.Graphics();
        effectContainer.addChild(ring1);

        // Onde de choc 2
        const ring2 = new PIXI.Graphics();
        effectContainer.addChild(ring2);

        // Particules d'explosion
        const particles = [];
        for (let i = 0; i < 16; i++) {
            const particle = new PIXI.Graphics();
            const size = 4 + Math.random() * 6;
            particle.circle(0, 0, size);
            particle.fill({ color: i % 2 === 0 ? 0xFFFFFF : color });
            particle.particleData = {
                angle: (i / 16) * Math.PI * 2 + Math.random() * 0.4,
                speed: 80 + Math.random() * 100,
            };
            effectContainer.addChild(particle);
            particles.push(particle);
        }

        // Étoile d'impact
        const star = new PIXI.Graphics();
        effectContainer.addChild(star);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Flash central
            if (progress < 0.2) {
                flash.alpha = 1;
                flash.scale.set(0.5 + progress * 2.5);
            } else {
                flash.alpha = Math.max(0, 1 - (progress - 0.2) / 0.3);
                flash.scale.set(1 + (progress - 0.2) * 0.5);
            }

            // Ondes de choc
            ring1.clear();
            const ring1Radius = progress * 100;
            ring1.circle(0, 0, ring1Radius);
            ring1.stroke({ width: 5 * (1 - progress), color: color, alpha: (1 - progress) * 0.8 });

            ring2.clear();
            if (progress > 0.15) {
                const ring2Progress = (progress - 0.15) / 0.85;
                const ring2Radius = ring2Progress * 80;
                ring2.circle(0, 0, ring2Radius);
                ring2.stroke({ width: 3 * (1 - ring2Progress), color: 0xFFFFFF, alpha: (1 - ring2Progress) * 0.6 });
            }

            // Étoile
            star.clear();
            if (progress < 0.4) {
                const starProgress = progress / 0.4;
                const starSize = 50 * (1 - starProgress * 0.5);
                const points = 6;

                star.moveTo(0, -starSize);
                for (let i = 1; i <= points * 2; i++) {
                    const angle = (i * Math.PI) / points - Math.PI / 2;
                    const radius = i % 2 === 0 ? starSize : starSize * 0.4;
                    star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                }
                star.closePath();
                star.fill({ color: 0xFFFFFF, alpha: (1 - starProgress) * 0.8 });
                star.rotation = starProgress * Math.PI * 0.5;
            }

            // Particules
            particles.forEach(p => {
                const data = p.particleData;
                const dist = data.speed * progress;
                p.x = Math.cos(data.angle) * dist;
                p.y = Math.sin(data.angle) * dist;
                p.alpha = 1 - progress;
                p.scale.set(1 - progress * 0.6);
            });

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        // Afficher les dégâts
        if (damage !== undefined && damage > 0) {
            this.showDamageNumber(x, y, damage);
        }

        // Screen shake
        this.screenShake(6, 120);

        return effect;
    }

    // ==================== NOMBRE DE DÉGÂTS ====================

    showDamageNumber(x, y, damage) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1200,
        };

        // Texte des dégâts
        const text = new PIXI.Text({
            text: `-${damage}`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 52,
                fontWeight: 'bold',
                fill: 0xFF0000,
                stroke: { color: 0x000000, width: 6 },
                dropShadow: {
                    color: 0x000000,
                    blur: 4,
                    angle: Math.PI / 4,
                    distance: 3,
                },
            }
        });
        text.anchor.set(0.5);
        effectContainer.addChild(text);

        // Glow
        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 35);
        glow.fill({ color: 0xFF0000, alpha: 0.4 });
        effectContainer.addChildAt(glow, 0);

        const startY = y;

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Apparition (0 -> 0.1)
            if (progress < 0.1) {
                const p = progress / 0.1;
                text.scale.set(0.3 + p * 0.9);
                text.alpha = p;
                glow.alpha = p * 0.4;
            }
            // Maintien avec pulse (0.1 -> 0.5)
            else if (progress < 0.5) {
                text.scale.set(1.2);
                text.alpha = 1;
                const pulse = 1 + Math.sin((progress - 0.1) * Math.PI * 4) * 0.05;
                text.scale.set(1.2 * pulse);
            }
            // Montée et fade (0.5 -> 1)
            else {
                const fadeProgress = (progress - 0.5) / 0.5;
                effectContainer.y = startY - fadeProgress * 60;
                text.alpha = 1 - fadeProgress;
                glow.alpha = (1 - fadeProgress) * 0.4;
                text.scale.set(1.2 - fadeProgress * 0.3);
            }

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        return effect;
    }

    // ==================== EFFET DE CLASH (ENTRECHOC) ====================

    createClashEffect(x, y) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 500,
        };

        // Flash intense
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 80);
        flash.fill({ color: 0xFFFFFF });
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // Étoile principale
        const star = new PIXI.Graphics();
        effectContainer.addChild(star);

        // Anneaux
        const rings = [];
        for (let i = 0; i < 3; i++) {
            const ring = new PIXI.Graphics();
            ring.delay = i * 0.1;
            effectContainer.addChild(ring);
            rings.push(ring);
        }

        // Étincelles
        const sparks = [];
        for (let i = 0; i < 20; i++) {
            const spark = new PIXI.Graphics();
            const size = 3 + Math.random() * 5;
            spark.circle(0, 0, size);
            spark.fill({ color: i % 3 === 0 ? 0xFFFFFF : (i % 3 === 1 ? 0xFFDD00 : 0xFF8800) });
            spark.alpha = 0;
            spark.sparkData = {
                angle: (i / 20) * Math.PI * 2 + Math.random() * 0.3,
                speed: 100 + Math.random() * 120,
            };
            effectContainer.addChild(spark);
            sparks.push(spark);
        }

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Flash
            if (progress < 0.15) {
                flash.alpha = (progress / 0.15) * 0.9;
                flash.scale.set(0.5 + (progress / 0.15) * 0.5);
            } else {
                flash.alpha = Math.max(0, 0.9 * (1 - (progress - 0.15) / 0.3));
                flash.scale.set(1 + (progress - 0.15) * 0.3);
            }

            // Étoile
            star.clear();
            if (progress < 0.6) {
                const starProgress = progress / 0.6;
                const starSize = 60 * (1 - starProgress * 0.3);
                const points = 8;

                star.moveTo(0, -starSize);
                for (let i = 1; i <= points * 2; i++) {
                    const angle = (i * Math.PI) / points - Math.PI / 2;
                    const radius = i % 2 === 0 ? starSize : starSize * 0.35;
                    star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                }
                star.closePath();
                star.fill({ color: 0xFFDD00, alpha: (1 - starProgress) * 0.9 });
                star.rotation = starProgress * Math.PI;
            }

            // Anneaux
            rings.forEach((ring, i) => {
                ring.clear();
                const ringProgress = Math.max(0, (progress - ring.delay) / (1 - ring.delay));
                if (ringProgress > 0 && ringProgress < 1) {
                    const radius = ringProgress * (100 + i * 25);
                    ring.circle(0, 0, radius);
                    ring.stroke({
                        width: 5 * (1 - ringProgress),
                        color: i === 0 ? 0xFFFFFF : 0xFFDD00,
                        alpha: (1 - ringProgress) * 0.8
                    });
                }
            });

            // Étincelles
            sparks.forEach(spark => {
                const data = spark.sparkData;
                if (progress > 0.05) {
                    const sparkProgress = (progress - 0.05) / 0.95;
                    const dist = data.speed * sparkProgress;
                    spark.x = Math.cos(data.angle) * dist;
                    spark.y = Math.sin(data.angle) * dist;
                    spark.alpha = Math.max(0, 1 - sparkProgress * 1.3);
                    spark.scale.set(1 - sparkProgress * 0.5);
                }
            });

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        this.screenShake(10, 180);

        return effect;
    }

    // ==================== EFFET DE FLAMMES (SORTS) ====================

    /**
     * Flammes qui jaillissent sur une case
     * Pour les sorts de dégâts
     */
    createFlameEffect(x, y, damage, intensity = 1) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 600 * intensity,
        };

        // Flammes (plusieurs langues de feu)
        const flames = [];
        const flameCount = 8;
        for (let i = 0; i < flameCount; i++) {
            const flame = new PIXI.Graphics();
            flame.flameData = {
                offsetX: (Math.random() - 0.5) * 60,
                delay: Math.random() * 0.2,
                height: 60 + Math.random() * 40,
                width: 15 + Math.random() * 10,
                speed: 0.8 + Math.random() * 0.4,
            };
            effectContainer.addChild(flame);
            flames.push(flame);
        }

        // Particules de braise
        const embers = [];
        for (let i = 0; i < 15; i++) {
            const ember = new PIXI.Graphics();
            const size = 2 + Math.random() * 4;
            ember.circle(0, 0, size);
            ember.fill({ color: i % 2 === 0 ? 0xFFAA00 : 0xFF4400 });
            ember.alpha = 0;
            ember.emberData = {
                startX: (Math.random() - 0.5) * 80,
                startY: 0,
                vx: (Math.random() - 0.5) * 60,
                vy: -80 - Math.random() * 60,
                delay: Math.random() * 0.4,
            };
            effectContainer.addChild(ember);
            embers.push(ember);
        }

        // Glow de base
        const baseGlow = new PIXI.Graphics();
        baseGlow.circle(0, 20, 50);
        baseGlow.fill({ color: 0xFF4400, alpha: 0.5 });
        effectContainer.addChildAt(baseGlow, 0);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Glow de base
            if (progress < 0.3) {
                baseGlow.alpha = (progress / 0.3) * 0.6;
            } else if (progress > 0.7) {
                baseGlow.alpha = ((1 - progress) / 0.3) * 0.6;
            } else {
                baseGlow.alpha = 0.6;
            }

            // Flammes
            flames.forEach(flame => {
                flame.clear();
                const data = flame.flameData;
                const flameProgress = Math.max(0, Math.min((progress - data.delay) / (0.8 - data.delay), 1));

                if (flameProgress > 0 && flameProgress < 1) {
                    // Hauteur animée
                    const heightMod = Math.sin(flameProgress * Math.PI);
                    const currentHeight = data.height * heightMod;
                    const currentWidth = data.width * (1 - flameProgress * 0.3);

                    // Oscillation
                    const wobble = Math.sin(progress * 20 * data.speed) * 5;

                    // Dessiner la flamme (forme de goutte inversée)
                    const baseY = 30;
                    flame.moveTo(data.offsetX + wobble, baseY);
                    flame.quadraticCurveTo(
                        data.offsetX - currentWidth + wobble,
                        baseY - currentHeight * 0.5,
                        data.offsetX + wobble * 0.5,
                        baseY - currentHeight
                    );
                    flame.quadraticCurveTo(
                        data.offsetX + currentWidth + wobble,
                        baseY - currentHeight * 0.5,
                        data.offsetX + wobble,
                        baseY
                    );

                    // Gradient de couleur simulé
                    const alpha = (1 - flameProgress * 0.5) * 0.9;
                    flame.fill({ color: 0xFF6600, alpha: alpha });
                }
            });

            // Braises
            embers.forEach(ember => {
                const data = ember.emberData;
                const emberProgress = Math.max(0, (progress - data.delay) / (1 - data.delay));

                if (emberProgress > 0 && emberProgress < 1) {
                    const t = emberProgress;
                    ember.x = data.startX + data.vx * t;
                    ember.y = data.startY + data.vy * t - 50 * t;
                    ember.alpha = (1 - emberProgress) * 0.9;
                    ember.scale.set(1 - emberProgress * 0.5);
                }
            });

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        // Afficher les dégâts si spécifié
        if (damage !== undefined && damage > 0) {
            setTimeout(() => {
                this.showDamageNumber(x, y - 20, damage);
            }, 150);
        }

        this.screenShake(4 * intensity, 100);

        return effect;
    }

    // ==================== EFFET D'IMPACT PROJECTILE ====================

    /**
     * Impact quand un projectile touche sa cible
     */
    createProjectileImpact(x, y, damage) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 300,
        };

        // Flash d'impact
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 40);
        flash.fill({ color: 0xFFDD00 });
        effectContainer.addChild(flash);

        // Onde
        const ring = new PIXI.Graphics();
        effectContainer.addChild(ring);

        // Particules
        const particles = [];
        for (let i = 0; i < 12; i++) {
            const particle = new PIXI.Graphics();
            particle.circle(0, 0, 3 + Math.random() * 3);
            particle.fill({ color: i % 2 === 0 ? 0xFFFF00 : 0xFFAA00 });
            particle.pData = {
                angle: (i / 12) * Math.PI * 2,
                speed: 60 + Math.random() * 40,
            };
            effectContainer.addChild(particle);
            particles.push(particle);
        }

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Flash
            flash.alpha = Math.max(0, 1 - progress * 2);
            flash.scale.set(1 + progress);

            // Onde
            ring.clear();
            ring.circle(0, 0, progress * 70);
            ring.stroke({ width: 4 * (1 - progress), color: 0xFFAA00, alpha: 1 - progress });

            // Particules
            particles.forEach(p => {
                const dist = p.pData.speed * progress;
                p.x = Math.cos(p.pData.angle) * dist;
                p.y = Math.sin(p.pData.angle) * dist;
                p.alpha = 1 - progress;
            });

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        // Afficher les dégâts
        if (damage !== undefined && damage > 0) {
            this.showDamageNumber(x, y, damage);
        }

        this.screenShake(4, 80);

        return effect;
    }

    // ==================== SCREEN SHAKE ====================

    screenShake(intensity = 5, duration = 100) {
        const gameContainer = document.getElementById('game-container');
        if (!gameContainer) return;

        const startTime = performance.now();
        const originalTransform = gameContainer.style.transform;

        const shake = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;

            if (progress < 1) {
                const currentIntensity = intensity * (1 - progress);
                const offsetX = (Math.random() - 0.5) * 2 * currentIntensity;
                const offsetY = (Math.random() - 0.5) * 2 * currentIntensity;
                gameContainer.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                requestAnimationFrame(shake);
            } else {
                gameContainer.style.transform = originalTransform || '';
            }
        };

        requestAnimationFrame(shake);
    }
}

// Instance globale
const CombatVFX = new CombatVFXSystem();
