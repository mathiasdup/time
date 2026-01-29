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

    // ==================== EFFET DE CLASH (ENTRECHOC) - ONDE DE CHOC ====================

    createClashEffect(x, y) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 800,
        };

        // Couleurs de l'onde de choc
        const coreColor = 0xFFFFFF;
        const shockColor1 = 0x00DDFF;  // Cyan
        const shockColor2 = 0xFFDD00;  // Or
        const shockColor3 = 0xFF6600;  // Orange

        // Flash central intense
        const coreFlash = new PIXI.Graphics();
        coreFlash.circle(0, 0, 30);
        coreFlash.fill({ color: coreColor });
        coreFlash.alpha = 0;
        effectContainer.addChild(coreFlash);

        // Noyau d'énergie pulsant
        const energyCore = new PIXI.Graphics();
        effectContainer.addChild(energyCore);

        // Ondes de choc concentriques (5 anneaux)
        const shockwaves = [];
        for (let i = 0; i < 5; i++) {
            const wave = new PIXI.Graphics();
            wave.waveData = {
                delay: i * 0.08,
                maxRadius: 180 + i * 40,
                thickness: 12 - i * 2,
                color: i < 2 ? shockColor1 : (i < 4 ? shockColor2 : shockColor3),
            };
            effectContainer.addChild(wave);
            shockwaves.push(wave);
        }

        // Éclairs radiaux
        const lightningBolts = [];
        for (let i = 0; i < 8; i++) {
            const bolt = new PIXI.Graphics();
            bolt.boltData = {
                angle: (i / 8) * Math.PI * 2,
                length: 80 + Math.random() * 60,
                segments: 4 + Math.floor(Math.random() * 3),
            };
            effectContainer.addChild(bolt);
            lightningBolts.push(bolt);
        }

        // Étincelles explosives
        const sparks = [];
        for (let i = 0; i < 35; i++) {
            const spark = new PIXI.Graphics();
            const size = 2 + Math.random() * 6;
            spark.circle(0, 0, size);
            const colors = [coreColor, shockColor1, shockColor2, shockColor3];
            spark.fill({ color: colors[Math.floor(Math.random() * colors.length)] });
            spark.alpha = 0;
            spark.sparkData = {
                angle: Math.random() * Math.PI * 2,
                speed: 150 + Math.random() * 200,
                rotSpeed: (Math.random() - 0.5) * 10,
                size: size,
            };
            effectContainer.addChild(spark);
            sparks.push(spark);
        }

        // Particules de débris
        const debris = [];
        for (let i = 0; i < 20; i++) {
            const particle = new PIXI.Graphics();
            const w = 3 + Math.random() * 8;
            const h = 2 + Math.random() * 4;
            particle.rect(-w/2, -h/2, w, h);
            particle.fill({ color: i % 2 === 0 ? 0x888888 : 0xAAAAAA });
            particle.alpha = 0;
            particle.debrisData = {
                angle: Math.random() * Math.PI * 2,
                speed: 80 + Math.random() * 150,
                rotSpeed: (Math.random() - 0.5) * 15,
                gravity: 200 + Math.random() * 100,
            };
            effectContainer.addChild(particle);
            debris.push(particle);
        }

        // Distorsion centrale (cercle qui se compresse puis explose)
        const distortion = new PIXI.Graphics();
        effectContainer.addChildAt(distortion, 0);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Phase 1: Compression (0-15%)
            // Phase 2: Explosion (15-40%)
            // Phase 3: Dissipation (40-100%)

            // Flash central
            if (progress < 0.15) {
                // Compression - le flash se concentre
                const compressProgress = progress / 0.15;
                coreFlash.alpha = compressProgress * 0.5;
                coreFlash.scale.set(1.5 - compressProgress * 0.8);
            } else if (progress < 0.25) {
                // Explosion - flash intense
                const explodeProgress = (progress - 0.15) / 0.1;
                coreFlash.alpha = 0.5 + explodeProgress * 0.5;
                coreFlash.scale.set(0.7 + explodeProgress * 2);
            } else {
                // Dissipation
                const fadeProgress = (progress - 0.25) / 0.75;
                coreFlash.alpha = Math.max(0, 1 - fadeProgress * 2);
                coreFlash.scale.set(2.7 + fadeProgress);
            }

            // Noyau d'énergie pulsant
            energyCore.clear();
            if (progress < 0.6) {
                const coreProgress = progress / 0.6;
                const pulse = 1 + Math.sin(coreProgress * Math.PI * 8) * 0.3;
                const coreRadius = 25 * (1 - coreProgress * 0.5) * pulse;
                energyCore.circle(0, 0, coreRadius);
                energyCore.fill({ color: coreColor, alpha: (1 - coreProgress) * 0.9 });

                // Halo autour du noyau
                energyCore.circle(0, 0, coreRadius * 1.5);
                energyCore.fill({ color: shockColor1, alpha: (1 - coreProgress) * 0.4 });
            }

            // Ondes de choc
            shockwaves.forEach(wave => {
                wave.clear();
                const data = wave.waveData;
                const waveProgress = Math.max(0, (progress - data.delay - 0.15) / (0.85 - data.delay));

                if (waveProgress > 0 && waveProgress < 1) {
                    const radius = waveProgress * data.maxRadius;
                    const thickness = data.thickness * (1 - waveProgress * 0.7);
                    const alpha = (1 - waveProgress) * 0.9;

                    // Onde principale
                    wave.circle(0, 0, radius);
                    wave.stroke({ width: thickness, color: data.color, alpha: alpha });

                    // Onde secondaire (plus fine, légèrement décalée)
                    if (waveProgress > 0.1) {
                        wave.circle(0, 0, radius * 0.85);
                        wave.stroke({ width: thickness * 0.5, color: coreColor, alpha: alpha * 0.5 });
                    }
                }
            });

            // Éclairs radiaux
            lightningBolts.forEach(bolt => {
                bolt.clear();
                const data = bolt.boltData;

                if (progress > 0.12 && progress < 0.5) {
                    const boltProgress = (progress - 0.12) / 0.38;
                    const alpha = boltProgress < 0.3 ? boltProgress / 0.3 : (1 - (boltProgress - 0.3) / 0.7);

                    bolt.moveTo(0, 0);
                    let currentX = 0, currentY = 0;
                    const segmentLength = data.length / data.segments;

                    for (let s = 0; s < data.segments; s++) {
                        const nextX = currentX + Math.cos(data.angle) * segmentLength;
                        const nextY = currentY + Math.sin(data.angle) * segmentLength;
                        // Ajouter du zigzag
                        const perpAngle = data.angle + Math.PI / 2;
                        const offset = (Math.random() - 0.5) * 20;
                        const midX = (currentX + nextX) / 2 + Math.cos(perpAngle) * offset;
                        const midY = (currentY + nextY) / 2 + Math.sin(perpAngle) * offset;

                        bolt.lineTo(midX, midY);
                        bolt.lineTo(nextX, nextY);
                        currentX = nextX;
                        currentY = nextY;
                    }

                    bolt.stroke({ width: 3, color: shockColor1, alpha: alpha * 0.8 });
                    // Glow
                    bolt.stroke({ width: 6, color: coreColor, alpha: alpha * 0.3 });
                }
            });

            // Étincelles
            sparks.forEach(spark => {
                const data = spark.sparkData;
                if (progress > 0.15) {
                    const sparkProgress = (progress - 0.15) / 0.85;
                    const dist = data.speed * sparkProgress;
                    spark.x = Math.cos(data.angle) * dist;
                    spark.y = Math.sin(data.angle) * dist;
                    spark.alpha = sparkProgress < 0.2 ? sparkProgress / 0.2 : Math.max(0, 1 - (sparkProgress - 0.2) / 0.8);
                    spark.scale.set(Math.max(0.1, 1 - sparkProgress * 0.8));
                    spark.rotation += data.rotSpeed * 0.016;
                }
            });

            // Débris
            debris.forEach(particle => {
                const data = particle.debrisData;
                if (progress > 0.18) {
                    const debrisProgress = (progress - 0.18) / 0.82;
                    const t = debrisProgress;
                    particle.x = Math.cos(data.angle) * data.speed * t;
                    particle.y = Math.sin(data.angle) * data.speed * t + 0.5 * data.gravity * t * t;
                    particle.alpha = debrisProgress < 0.15 ? debrisProgress / 0.15 : Math.max(0, 1 - (debrisProgress - 0.15) / 0.85);
                    particle.rotation += data.rotSpeed * 0.016;
                }
            });

            // Distorsion centrale
            distortion.clear();
            if (progress < 0.15) {
                // Compression
                const compressProgress = progress / 0.15;
                const radius = 50 * (1 - compressProgress * 0.6);
                distortion.circle(0, 0, radius);
                distortion.fill({ color: 0x000000, alpha: compressProgress * 0.3 });
            } else if (progress < 0.3) {
                // Expansion rapide
                const expandProgress = (progress - 0.15) / 0.15;
                const radius = 20 + expandProgress * 100;
                distortion.circle(0, 0, radius);
                distortion.fill({ color: 0x000000, alpha: (1 - expandProgress) * 0.3 });
            }

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        // Screen shake plus intense
        this.screenShake(15, 250);

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

    // ==================== EFFET DE SLASH (ZDEJEBEL) ====================

    /**
     * Effet de slash démoniaque - griffures rouges sang
     * Pour la capacité de Zdejebel
     */
    createSlashEffect(x, y, damage) {
        console.log('[SlashEffect] Creating at', x, y, 'with', this.activeEffects.length, 'active effects');
        console.log('[SlashEffect] Container children:', this.container?.children?.length);

        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 800,
        };

        // Couleurs démoniaques
        const bloodRed = 0xCC0000;
        const darkRed = 0x660000;
        const crimson = 0xFF1A1A;

        // Flash rouge initial
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 80);
        flash.fill({ color: crimson, alpha: 0.6 });
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // Créer 3 griffures diagonales
        const slashes = [];
        const slashData = [
            { offsetX: -25, angle: -0.3, length: 120 },
            { offsetX: 0, angle: 0, length: 140 },
            { offsetX: 25, angle: 0.3, length: 120 },
        ];

        slashData.forEach((data, i) => {
            const slash = new PIXI.Graphics();
            slash.slashData = { ...data, index: i, delay: i * 0.08 };
            effectContainer.addChild(slash);
            slashes.push(slash);
        });

        // Particules de sang
        const bloodParticles = [];
        for (let i = 0; i < 20; i++) {
            const particle = new PIXI.Graphics();
            const size = 2 + Math.random() * 5;
            particle.circle(0, 0, size);
            particle.fill({ color: i % 2 === 0 ? bloodRed : darkRed });
            particle.alpha = 0;
            particle.bloodData = {
                startX: (Math.random() - 0.5) * 60,
                startY: (Math.random() - 0.5) * 80,
                vx: (Math.random() - 0.5) * 150,
                vy: 50 + Math.random() * 100, // Tombe vers le bas
                delay: Math.random() * 0.3,
                gravity: 200,
            };
            effectContainer.addChild(particle);
            bloodParticles.push(particle);
        }

        // Aura démoniaque
        const aura = new PIXI.Graphics();
        effectContainer.addChildAt(aura, 0);

        let frameCount = 0;
        const animate = () => {
            frameCount++;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (frameCount === 1) {
                console.log('[SlashEffect] Animation started, first frame');
            }

            // Flash initial
            if (progress < 0.15) {
                flash.alpha = (progress / 0.15) * 0.8;
                flash.scale.set(0.5 + (progress / 0.15) * 0.5);
            } else if (progress < 0.4) {
                flash.alpha = 0.8 * (1 - (progress - 0.15) / 0.25);
            } else {
                flash.alpha = 0;
            }

            // Aura démoniaque pulsante
            aura.clear();
            if (progress < 0.7) {
                const auraProgress = progress / 0.7;
                const auraRadius = 60 + auraProgress * 40;
                const auraAlpha = (1 - auraProgress) * 0.4;
                aura.circle(0, 0, auraRadius);
                aura.fill({ color: darkRed, alpha: auraAlpha });
            }

            // Griffures
            slashes.forEach(slash => {
                slash.clear();
                const data = slash.slashData;
                const slashProgress = Math.max(0, Math.min((progress - data.delay) / 0.4, 1));

                if (slashProgress > 0) {
                    // La griffure se dessine progressivement
                    const drawLength = data.length * slashProgress;
                    const startY = -data.length / 2;
                    const endY = startY + drawLength;

                    // Largeur qui s'amincit
                    const width = 8 * (1 - slashProgress * 0.3);

                    // Couleur avec dégradé simulé
                    const alpha = progress < 0.6 ? 1 : (1 - (progress - 0.6) / 0.4);

                    // Dessiner la griffure comme un rectangle allongé (plus simple et compatible PixiJS 8)
                    slash.rect(data.offsetX - width / 2, startY, width, drawLength);
                    slash.fill({ color: crimson, alpha: alpha * 0.9 });

                    slash.rotation = data.angle;
                }
            });

            // Particules de sang
            bloodParticles.forEach(particle => {
                const data = particle.bloodData;
                const particleProgress = Math.max(0, (progress - data.delay) / (1 - data.delay));

                if (particleProgress > 0 && particleProgress < 1) {
                    const t = particleProgress;
                    particle.x = data.startX + data.vx * t;
                    particle.y = data.startY + data.vy * t + 0.5 * data.gravity * t * t;
                    particle.alpha = (1 - particleProgress) * 0.8;
                    particle.scale.set(1 - particleProgress * 0.5);
                }
            });

            if (progress >= 1) {
                effect.finished = true;
                console.log('[SlashEffect] Animation finished after', frameCount, 'frames');
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);
        console.log('[SlashEffect] Effect added, total effects:', this.activeEffects.length);

        // Afficher les dégâts
        if (damage !== undefined && damage > 0) {
            setTimeout(() => {
                this.showDamageNumber(x, y, damage);
            }, 200);
        }

        // Screen shake intense
        this.screenShake(8, 200);

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

// ==================== SYSTÈME D'ANIMATION ZZZ (SOMMEIL) ====================

class SleepAnimationSystem {
    constructor() {
        this.activeAnimations = new Map(); // slotKey -> animation data
        this.startTimes = new Map(); // slotKey -> startTime (persiste entre les renders)
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        // Attendre que CombatVFX soit prêt
        if (!CombatVFX.initialized) {
            await CombatVFX.init();
        }

        this.initialized = true;
        console.log('✅ Sleep Animation System initialized');

        // Démarrer la boucle de mise à jour
        this.startUpdateLoop();
    }

    startUpdateLoop() {
        const update = () => {
            this.updateAllAnimations();
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    updateAllAnimations() {
        // Trouver toutes les cartes avec la classe just-played
        const sleepingCards = document.querySelectorAll('.card.just-played');

        // Identifier les slots actifs ce frame
        const activeSlotKeys = new Set();

        sleepingCards.forEach(card => {
            // Trouver le slot parent pour identifier la carte de manière stable
            const slot = card.closest('.card-slot');
            if (!slot) return;
            const slotKey = `${slot.dataset.owner}-${slot.dataset.row}-${slot.dataset.col}`;
            activeSlotKeys.add(slotKey);

            if (!this.activeAnimations.has(slotKey)) {
                this.startAnimation(slotKey, card);
            } else {
                // Mettre à jour la référence DOM (peut changer à chaque render) et la position
                const animData = this.activeAnimations.get(slotKey);
                animData.cardRef = card;
                this.updateAnimationPosition(card, animData);
            }
        });

        // Supprimer les animations des slots qui ne dorment plus
        this.activeAnimations.forEach((animData, slotKey) => {
            if (!activeSlotKeys.has(slotKey)) {
                this.stopAnimation(slotKey);
                this.startTimes.delete(slotKey);
            }
        });
    }

    startAnimation(slotKey, card) {
        if (!CombatVFX.initialized || !CombatVFX.container) return;

        const container = new PIXI.Container();
        CombatVFX.container.addChild(container);

        // Créer 3 "Z" qui s'animent
        const zTexts = [];
        for (let i = 0; i < 3; i++) {
            const z = new PIXI.Text({
                text: 'Z',
                style: {
                    fontFamily: 'Arial Black, Arial',
                    fontSize: 16 - i * 2,
                    fontWeight: 'bold',
                    fill: 0xFFFFFF,
                    stroke: { color: 0x000000, width: 2 },
                }
            });
            z.anchor.set(0.5);
            z.alpha = 0;
            z.zData = {
                index: i,
                baseOffsetX: 5 + i * 8,
                baseOffsetY: -5 - i * 12,
                phase: i * (Math.PI * 2 / 3),
            };
            container.addChild(z);
            zTexts.push(z);
        }

        // Réutiliser le startTime existant pour que l'animation continue sans à-coup
        if (!this.startTimes.has(slotKey)) {
            this.startTimes.set(slotKey, performance.now());
        }

        const animData = {
            container,
            zTexts,
            cardRef: card,
            startTime: this.startTimes.get(slotKey),
        };

        this.activeAnimations.set(slotKey, animData);
        this.updateAnimationPosition(card, animData);
    }

    updateAnimationPosition(card, animData) {
        const rect = card.getBoundingClientRect();
        const x = rect.right - 5;
        const y = rect.top + 10;

        animData.container.position.set(x, y);

        // Animer les Z
        const elapsed = performance.now() - animData.startTime;
        const cycleTime = 2000; // 2 secondes par cycle

        animData.zTexts.forEach(z => {
            const data = z.zData;
            const phase = (elapsed / cycleTime * Math.PI * 2 + data.phase) % (Math.PI * 2);

            // Animation en boucle
            const cycleProgress = phase / (Math.PI * 2);

            // Opacité: fade in puis fade out (max 0.7 pour transparence)
            if (cycleProgress < 0.1) {
                z.alpha = (cycleProgress / 0.1) * 0.7;
            } else if (cycleProgress < 0.7) {
                z.alpha = 0.7;
            } else {
                z.alpha = (1 - (cycleProgress - 0.7) / 0.3) * 0.7;
            }

            // Position: monte et oscille
            const floatY = data.baseOffsetY - cycleProgress * 20;
            const wobbleX = Math.sin(phase * 2) * 3;

            z.x = data.baseOffsetX + wobbleX;
            z.y = floatY;

            // Légère rotation
            z.rotation = Math.sin(phase) * 0.2;

            // Scale qui pulse
            const scale = 0.8 + Math.sin(phase * 3) * 0.1;
            z.scale.set(scale);
        });
    }

    stopAnimation(slotKey) {
        const animData = this.activeAnimations.get(slotKey);
        if (animData) {
            if (animData.container && animData.container.parent) {
                animData.container.parent.removeChild(animData.container);
            }
            this.activeAnimations.delete(slotKey);
        }
    }

    // Nettoyer toutes les animations
    cleanup() {
        this.activeAnimations.forEach((animData, card) => {
            this.stopAnimation(card);
        });
    }
}

// Instance globale
const SleepAnimations = new SleepAnimationSystem();

// Initialiser quand le DOM est prêt
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        SleepAnimations.init().catch(e => console.warn('Sleep animations init failed:', e));
    }, 1000);
});
