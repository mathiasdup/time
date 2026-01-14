/**
 * Combat VFX System - Effets visuels de qualité professionnelle
 * Inspiré de Hearthstone / Magic Arena
 * Utilise PixiJS 8 pour des animations fluides et performantes
 */

class CombatVFXSystem {
    constructor() {
        this.app = null;
        this.container = null;
        this.initialized = false;
        this.activeEffects = [];

        // Timings pour synchronisation
        this.TIMINGS = {
            SLASH_DURATION: 250,
            CLAW_DURATION: 350,
            BITE_DURATION: 400,
            IMPACT_DURATION: 300,
            PARTICLE_LIFETIME: 600,
            SCREEN_SHAKE: 150,
        };
    }

    async init() {
        if (this.initialized) return;

        try {
            // Créer l'application PixiJS en overlay
            this.app = new PIXI.Application();
            await this.app.init({
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundAlpha: 0,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
            });

            // Style du canvas
            this.app.canvas.style.position = 'fixed';
            this.app.canvas.style.top = '0';
            this.app.canvas.style.left = '0';
            this.app.canvas.style.pointerEvents = 'none';
            this.app.canvas.style.zIndex = '10000';
            document.body.appendChild(this.app.canvas);

            // Container principal
            this.container = new PIXI.Container();
            this.app.stage.addChild(this.container);

            // Gestion du resize
            window.addEventListener('resize', () => this.handleResize());

            // Boucle d'animation
            this.app.ticker.add(() => this.update());

            this.initialized = true;
            console.log('✅ Combat VFX System initialized (PixiJS 8)');

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
        // Nettoyer les effets terminés
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

    // ==================== UTILITAIRES ====================

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

    // ==================== EFFET SLASH ====================

    /**
     * Slash diagonal rapide - style Hearthstone
     * Trail lumineux avec afterglow
     */
    createSlashEffect(x, y, angle = -45, color = 0xFFFFFF) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: this.TIMINGS.SLASH_DURATION,
        };

        // Paramètres du slash
        const slashLength = 180;
        const slashWidth = 12;
        const angleRad = (angle * Math.PI) / 180;

        // Glow de fond (large et diffus)
        const glowGraphics = new PIXI.Graphics();
        glowGraphics.alpha = 0;
        effectContainer.addChild(glowGraphics);

        // Trail principal
        const trailGraphics = new PIXI.Graphics();
        trailGraphics.alpha = 0;
        effectContainer.addChild(trailGraphics);

        // Ligne centrale (core)
        const coreGraphics = new PIXI.Graphics();
        coreGraphics.alpha = 0;
        effectContainer.addChild(coreGraphics);

        // Particules d'étincelles
        const particles = [];
        for (let i = 0; i < 20; i++) {
            const particle = new PIXI.Graphics();
            const size = 2 + Math.random() * 4;
            particle.circle(0, 0, size);
            particle.fill({ color: i % 2 === 0 ? 0xFFFFFF : color });
            particle.alpha = 0;
            particle.particleData = {
                offsetAlongSlash: Math.random(),
                perpOffset: (Math.random() - 0.5) * 40,
                speed: 50 + Math.random() * 100,
                angle: angleRad + (Math.random() - 0.5) * 1.5,
                delay: Math.random() * 0.3,
            };
            effectContainer.addChild(particle);
            particles.push(particle);
        }

        // Animation
        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Phase de slash (0 -> 0.4)
            const slashProgress = Math.min(progress / 0.4, 1);
            const easeSlash = 1 - Math.pow(1 - slashProgress, 3); // ease-out cubic

            // Calcul des points du slash
            const startX = -slashLength / 2 * Math.cos(angleRad);
            const startY = -slashLength / 2 * Math.sin(angleRad);
            const currentLength = slashLength * easeSlash;
            const endX = startX + currentLength * Math.cos(angleRad);
            const endY = startY + currentLength * Math.sin(angleRad);

            // Dessiner le glow
            glowGraphics.clear();
            if (slashProgress > 0) {
                glowGraphics.moveTo(startX, startY);
                glowGraphics.lineTo(endX, endY);
                glowGraphics.stroke({ width: slashWidth * 4, color: color, alpha: 0.3 });
                glowGraphics.alpha = 1 - progress * 0.5;
            }

            // Dessiner le trail
            trailGraphics.clear();
            if (slashProgress > 0) {
                trailGraphics.moveTo(startX, startY);
                trailGraphics.lineTo(endX, endY);
                trailGraphics.stroke({ width: slashWidth * 2, color: color, alpha: 0.6 });
                trailGraphics.alpha = 1 - progress * 0.7;
            }

            // Dessiner le core
            coreGraphics.clear();
            if (slashProgress > 0 && slashProgress < 0.9) {
                // Le core suit le slash mais est plus court
                const coreStart = Math.max(0, easeSlash - 0.3) * slashLength;
                const coreEnd = easeSlash * slashLength;
                const coreStartX = startX + coreStart * Math.cos(angleRad);
                const coreStartY = startY + coreStart * Math.sin(angleRad);
                const coreEndX = startX + coreEnd * Math.cos(angleRad);
                const coreEndY = startY + coreEnd * Math.sin(angleRad);

                coreGraphics.moveTo(coreStartX, coreStartY);
                coreGraphics.lineTo(coreEndX, coreEndY);
                coreGraphics.stroke({ width: slashWidth, color: 0xFFFFFF });
                coreGraphics.alpha = 1;
            }

            // Animer les particules
            particles.forEach(p => {
                const data = p.particleData;
                const particleProgress = Math.max(0, (progress - data.delay) / (1 - data.delay));

                if (particleProgress > 0 && particleProgress < 1) {
                    // Position le long du slash
                    const posAlongSlash = data.offsetAlongSlash * currentLength;
                    const baseX = startX + posAlongSlash * Math.cos(angleRad);
                    const baseY = startY + posAlongSlash * Math.sin(angleRad);

                    // Mouvement perpendiculaire + dispersion
                    const perpAngle = angleRad + Math.PI / 2;
                    const dispersion = particleProgress * data.speed * 0.5;

                    p.x = baseX + data.perpOffset * particleProgress + Math.cos(data.angle) * dispersion;
                    p.y = baseY + Math.sin(data.angle) * dispersion;
                    p.alpha = (1 - particleProgress) * 0.8;
                    p.scale.set(1 - particleProgress * 0.5);
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

        // Screen shake léger
        this.screenShake(3, 100);

        return effect;
    }

    // ==================== EFFET GRIFFES ====================

    /**
     * Triple griffure - style attaque de bête
     * Trois traces qui s'animent en séquence rapide
     */
    createClawEffect(x, y, color = 0xFF3333) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: this.TIMINGS.CLAW_DURATION,
        };

        // Créer 3 griffures avec décalage
        const claws = [];
        const clawOffsets = [
            { x: -35, angle: -75, delay: 0 },
            { x: 0, angle: -80, delay: 0.1 },
            { x: 35, angle: -85, delay: 0.2 },
        ];

        clawOffsets.forEach((offset, i) => {
            const clawContainer = new PIXI.Container();
            clawContainer.position.set(offset.x, 0);
            effectContainer.addChild(clawContainer);

            const claw = {
                container: clawContainer,
                angle: offset.angle,
                delay: offset.delay,
                length: 140 + Math.random() * 20,
                width: 8 - i,
            };

            // Glow
            claw.glow = new PIXI.Graphics();
            clawContainer.addChild(claw.glow);

            // Trail
            claw.trail = new PIXI.Graphics();
            clawContainer.addChild(claw.trail);

            // Core (partie lumineuse)
            claw.core = new PIXI.Graphics();
            clawContainer.addChild(claw.core);

            claws.push(claw);
        });

        // Particules de sang/énergie
        const bloodParticles = [];
        for (let i = 0; i < 30; i++) {
            const particle = new PIXI.Graphics();
            const size = 2 + Math.random() * 5;
            particle.circle(0, 0, size);
            particle.fill({ color: i % 3 === 0 ? 0xFFFFFF : color });
            particle.alpha = 0;
            particle.particleData = {
                startX: (Math.random() - 0.5) * 80,
                startY: (Math.random() - 0.5) * 100,
                vx: (Math.random() - 0.5) * 200,
                vy: 50 + Math.random() * 150,
                gravity: 300,
                delay: 0.2 + Math.random() * 0.2,
            };
            effectContainer.addChild(particle);
            bloodParticles.push(particle);
        }

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Animer chaque griffe
            claws.forEach(claw => {
                const clawProgress = Math.max(0, Math.min((progress - claw.delay) / 0.3, 1));
                const easeProgress = 1 - Math.pow(1 - clawProgress, 4);

                const angleRad = (claw.angle * Math.PI) / 180;
                const startY = -claw.length / 2;
                const currentLength = claw.length * easeProgress;

                // Glow
                claw.glow.clear();
                if (clawProgress > 0) {
                    claw.glow.moveTo(0, startY);
                    claw.glow.lineTo(
                        Math.sin(-angleRad + Math.PI/2) * currentLength * 0.1,
                        startY + currentLength
                    );
                    claw.glow.stroke({ width: claw.width * 4, color: color, alpha: 0.4 });
                    claw.glow.alpha = Math.max(0, 1 - (progress - claw.delay) * 1.5);
                }

                // Trail
                claw.trail.clear();
                if (clawProgress > 0) {
                    // Courbe de Bezier pour effet organique
                    claw.trail.moveTo(0, startY);
                    claw.trail.quadraticCurveTo(
                        Math.sin(-angleRad + Math.PI/2) * currentLength * 0.3,
                        startY + currentLength * 0.5,
                        Math.sin(-angleRad + Math.PI/2) * currentLength * 0.15,
                        startY + currentLength
                    );
                    claw.trail.stroke({ width: claw.width * 2, color: color, alpha: 0.7 });
                    claw.trail.alpha = Math.max(0, 1 - (progress - claw.delay) * 1.2);
                }

                // Core
                claw.core.clear();
                if (clawProgress > 0.1 && clawProgress < 0.95) {
                    const coreStart = Math.max(0, easeProgress - 0.4) * claw.length;
                    const coreEnd = easeProgress * claw.length;

                    claw.core.moveTo(0, startY + coreStart);
                    claw.core.lineTo(
                        Math.sin(-angleRad + Math.PI/2) * coreEnd * 0.15,
                        startY + coreEnd
                    );
                    claw.core.stroke({ width: claw.width, color: 0xFFFFFF });
                }
            });

            // Animer les particules
            bloodParticles.forEach(p => {
                const data = p.particleData;
                const pProgress = Math.max(0, (progress - data.delay) / (1 - data.delay));

                if (pProgress > 0 && pProgress < 1) {
                    const t = pProgress * 0.8; // temps normalisé
                    p.x = data.startX + data.vx * t;
                    p.y = data.startY + data.vy * t + 0.5 * data.gravity * t * t;
                    p.alpha = (1 - pProgress) * 0.9;
                    p.scale.set(1 - pProgress * 0.6);
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

        this.screenShake(5, 120);

        return effect;
    }

    // ==================== EFFET MORSURE ====================

    /**
     * Morsure - deux arcs de cercle qui se referment
     * Style mâchoire de prédateur
     */
    createBiteEffect(x, y, color = 0xFF4444) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: this.TIMINGS.BITE_DURATION,
        };

        // Mâchoire supérieure et inférieure
        const topJaw = new PIXI.Container();
        const bottomJaw = new PIXI.Container();
        effectContainer.addChild(topJaw);
        effectContainer.addChild(bottomJaw);

        // Créer les dents
        const teethCount = 7;
        const teethWidth = 120;
        const topTeeth = [];
        const bottomTeeth = [];

        for (let i = 0; i < teethCount; i++) {
            const xPos = (i - (teethCount - 1) / 2) * (teethWidth / (teethCount - 1));
            const isCenter = i === Math.floor(teethCount / 2);
            const toothHeight = isCenter ? 35 : 25 + Math.random() * 10;

            // Dent du haut
            const topTooth = new PIXI.Graphics();
            topTooth.poly([
                { x: -6, y: 0 },
                { x: 0, y: toothHeight },
                { x: 6, y: 0 },
            ]);
            topTooth.fill({ color: 0xFFFFF0 });
            topTooth.stroke({ width: 2, color: color, alpha: 0.5 });
            topTooth.position.set(xPos, 0);
            topTooth.alpha = 0;
            topJaw.addChild(topTooth);
            topTeeth.push({ graphic: topTooth, height: toothHeight });

            // Dent du bas (miroir)
            const bottomTooth = new PIXI.Graphics();
            bottomTooth.poly([
                { x: -6, y: 0 },
                { x: 0, y: -toothHeight },
                { x: 6, y: 0 },
            ]);
            bottomTooth.fill({ color: 0xFFFFF0 });
            bottomTooth.stroke({ width: 2, color: color, alpha: 0.5 });
            bottomTooth.position.set(xPos, 0);
            bottomTooth.alpha = 0;
            bottomJaw.addChild(bottomTooth);
            bottomTeeth.push({ graphic: bottomTooth, height: toothHeight });
        }

        // Arcs de la mâchoire (gencives)
        const topGum = new PIXI.Graphics();
        topJaw.addChild(topGum);
        const bottomGum = new PIXI.Graphics();
        bottomJaw.addChild(bottomGum);

        // Effet de sang à l'impact
        const bloodSplatter = new PIXI.Container();
        effectContainer.addChild(bloodSplatter);

        const bloodDrops = [];
        for (let i = 0; i < 25; i++) {
            const drop = new PIXI.Graphics();
            const size = 3 + Math.random() * 6;
            drop.circle(0, 0, size);
            drop.fill({ color: color });
            drop.alpha = 0;
            drop.dropData = {
                angle: Math.random() * Math.PI * 2,
                speed: 80 + Math.random() * 120,
                delay: 0.4 + Math.random() * 0.1,
            };
            bloodSplatter.addChild(drop);
            bloodDrops.push(drop);
        }

        // Flash d'impact
        const impactFlash = new PIXI.Graphics();
        impactFlash.circle(0, 0, 60);
        impactFlash.fill({ color: 0xFFFFFF });
        impactFlash.alpha = 0;
        effectContainer.addChild(impactFlash);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Phase 1: Ouverture (0 -> 0.2)
            // Phase 2: Fermeture rapide (0.2 -> 0.45)
            // Phase 3: Impact + rebond (0.45 -> 0.6)
            // Phase 4: Fade out (0.6 -> 1)

            let jawOffset;
            if (progress < 0.2) {
                // Ouverture
                const openProgress = progress / 0.2;
                const easeOpen = Math.pow(openProgress, 0.5);
                jawOffset = 50 + easeOpen * 30;
            } else if (progress < 0.45) {
                // Fermeture rapide
                const closeProgress = (progress - 0.2) / 0.25;
                const easeClose = Math.pow(closeProgress, 2);
                jawOffset = 80 - easeClose * 80;
            } else if (progress < 0.6) {
                // Rebond
                const bounceProgress = (progress - 0.45) / 0.15;
                jawOffset = Math.sin(bounceProgress * Math.PI) * 15;
            } else {
                jawOffset = 0;
            }

            topJaw.position.y = -jawOffset;
            bottomJaw.position.y = jawOffset;

            // Opacité des dents
            const teethAlpha = progress < 0.15 ? progress / 0.15 :
                               progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;

            topTeeth.forEach(t => t.graphic.alpha = teethAlpha);
            bottomTeeth.forEach(t => t.graphic.alpha = teethAlpha);

            // Dessiner les gencives
            topGum.clear();
            bottomGum.clear();

            if (teethAlpha > 0) {
                // Arc supérieur
                topGum.arc(0, 15, 70, Math.PI, 0);
                topGum.stroke({ width: 12, color: color, alpha: 0.6 * teethAlpha });

                // Arc inférieur
                bottomGum.arc(0, -15, 70, 0, Math.PI);
                bottomGum.stroke({ width: 12, color: color, alpha: 0.6 * teethAlpha });
            }

            // Flash d'impact
            if (progress >= 0.43 && progress < 0.55) {
                const flashProgress = (progress - 0.43) / 0.12;
                impactFlash.alpha = (1 - flashProgress) * 0.8;
                impactFlash.scale.set(1 + flashProgress * 0.5);
            } else {
                impactFlash.alpha = 0;
            }

            // Particules de sang
            bloodDrops.forEach(drop => {
                const data = drop.dropData;
                const dropProgress = Math.max(0, (progress - data.delay) / (1 - data.delay));

                if (dropProgress > 0 && dropProgress < 1) {
                    const t = dropProgress;
                    drop.x = Math.cos(data.angle) * data.speed * t;
                    drop.y = Math.sin(data.angle) * data.speed * t + 200 * t * t;
                    drop.alpha = (1 - dropProgress) * 0.8;
                    drop.scale.set(1 - dropProgress * 0.5);
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

        // Screen shake plus fort pour la morsure
        setTimeout(() => this.screenShake(8, 150), this.TIMINGS.BITE_DURATION * 0.43);

        return effect;
    }

    // ==================== EFFET D'IMPACT GÉNÉRIQUE ====================

    /**
     * Impact générique avec onde de choc
     * Utilisé pour les attaques magiques ou de base
     */
    createImpactEffect(x, y, color = 0xFFAA00, intensity = 1) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: this.TIMINGS.IMPACT_DURATION * intensity,
        };

        // Onde de choc principale
        const shockwave = new PIXI.Graphics();
        effectContainer.addChild(shockwave);

        // Onde de choc secondaire
        const shockwave2 = new PIXI.Graphics();
        effectContainer.addChild(shockwave2);

        // Flash central
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 30 * intensity);
        flash.fill({ color: 0xFFFFFF });
        effectContainer.addChild(flash);

        // Étoile d'impact
        const star = new PIXI.Graphics();
        effectContainer.addChild(star);

        // Particules
        const particles = [];
        const particleCount = Math.floor(20 * intensity);
        for (let i = 0; i < particleCount; i++) {
            const particle = new PIXI.Graphics();
            const size = (2 + Math.random() * 4) * intensity;
            particle.circle(0, 0, size);
            particle.fill({ color: i % 2 === 0 ? 0xFFFFFF : color });
            particle.particleData = {
                angle: (i / particleCount) * Math.PI * 2 + Math.random() * 0.3,
                speed: (60 + Math.random() * 80) * intensity,
            };
            effectContainer.addChild(particle);
            particles.push(particle);
        }

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Expansion des ondes de choc
            const waveRadius1 = progress * 100 * intensity;
            const waveRadius2 = Math.max(0, progress - 0.15) * 80 * intensity / 0.85;

            shockwave.clear();
            shockwave.circle(0, 0, waveRadius1);
            shockwave.stroke({ width: 4 * (1 - progress), color: color, alpha: (1 - progress) * 0.8 });

            shockwave2.clear();
            if (progress > 0.15) {
                shockwave2.circle(0, 0, waveRadius2);
                shockwave2.stroke({ width: 3 * (1 - progress), color: 0xFFFFFF, alpha: (1 - progress) * 0.5 });
            }

            // Flash
            flash.alpha = Math.max(0, 1 - progress * 2);
            flash.scale.set(1 + progress * 0.5);

            // Étoile d'impact
            star.clear();
            if (progress < 0.5) {
                const starProgress = progress / 0.5;
                const starSize = 40 * intensity * (1 - starProgress * 0.5);
                const points = 8;

                star.moveTo(0, -starSize);
                for (let i = 1; i <= points * 2; i++) {
                    const angle = (i * Math.PI) / points - Math.PI / 2;
                    const radius = i % 2 === 0 ? starSize : starSize * 0.4;
                    star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                }
                star.closePath();
                star.fill({ color: 0xFFFFFF, alpha: 1 - starProgress });

                star.rotation = starProgress * Math.PI * 0.5;
            }

            // Particules
            particles.forEach(p => {
                const data = p.particleData;
                const dist = data.speed * progress;
                p.x = Math.cos(data.angle) * dist;
                p.y = Math.sin(data.angle) * dist;
                p.alpha = 1 - progress;
                p.scale.set(1 - progress * 0.5);
            });

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

        this.screenShake(4 * intensity, 100);

        return effect;
    }

    // ==================== EFFET DE CLASH (ENTRECHOC) ====================

    /**
     * Effet de clash épique - deux créatures qui s'entrechoquent
     * Grande explosion d'énergie avec étoile et étincelles
     */
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

        // Flash central intense
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 80);
        flash.fill({ color: 0xFFFFFF });
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // Étoile principale (8 branches)
        const star = new PIXI.Graphics();
        effectContainer.addChild(star);

        // Anneaux de shockwave
        const rings = [];
        for (let i = 0; i < 3; i++) {
            const ring = new PIXI.Graphics();
            ring.ringData = { delay: i * 0.1 };
            effectContainer.addChild(ring);
            rings.push(ring);
        }

        // Étincelles
        const sparks = [];
        for (let i = 0; i < 24; i++) {
            const spark = new PIXI.Graphics();
            const size = 4 + Math.random() * 6;
            spark.circle(0, 0, size);
            spark.fill({ color: i % 3 === 0 ? 0xFFFFFF : (i % 3 === 1 ? 0xFFDD00 : 0xFF8800) });
            spark.alpha = 0;
            spark.sparkData = {
                angle: (i / 24) * Math.PI * 2 + Math.random() * 0.3,
                speed: 100 + Math.random() * 150,
                rotSpeed: (Math.random() - 0.5) * 10,
            };
            effectContainer.addChild(spark);
            sparks.push(spark);
        }

        // Lignes d'énergie
        const energyLines = [];
        for (let i = 0; i < 12; i++) {
            const line = new PIXI.Graphics();
            line.lineData = {
                angle: (i / 12) * Math.PI * 2,
                length: 60 + Math.random() * 40,
            };
            effectContainer.addChild(line);
            energyLines.push(line);
        }

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Flash (apparition rapide, disparition progressive)
            if (progress < 0.15) {
                flash.alpha = (progress / 0.15) * 0.9;
                flash.scale.set(0.5 + (progress / 0.15) * 0.5);
            } else {
                flash.alpha = Math.max(0, 0.9 * (1 - (progress - 0.15) / 0.4));
                flash.scale.set(1 + (progress - 0.15) * 0.5);
            }

            // Étoile rotative
            star.clear();
            if (progress < 0.7) {
                const starProgress = progress / 0.7;
                const starSize = 70 * (1 - starProgress * 0.3);
                const points = 8;
                const innerRadius = starSize * 0.3;

                star.moveTo(0, -starSize);
                for (let i = 1; i <= points * 2; i++) {
                    const angle = (i * Math.PI) / points - Math.PI / 2;
                    const radius = i % 2 === 0 ? starSize : innerRadius;
                    star.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                }
                star.closePath();
                star.fill({ color: 0xFFDD00, alpha: (1 - starProgress) * 0.9 });
                star.rotation = starProgress * Math.PI;
            }

            // Anneaux de shockwave
            rings.forEach((ring, i) => {
                ring.clear();
                const ringProgress = Math.max(0, (progress - ring.ringData.delay) / (1 - ring.ringData.delay));
                if (ringProgress > 0 && ringProgress < 1) {
                    const radius = ringProgress * (120 + i * 30);
                    const thickness = 6 * (1 - ringProgress);
                    ring.circle(0, 0, radius);
                    ring.stroke({
                        width: thickness,
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
                    spark.alpha = Math.max(0, 1 - sparkProgress * 1.2);
                    spark.rotation += data.rotSpeed * 0.016;
                    spark.scale.set(1 - sparkProgress * 0.5);
                }
            });

            // Lignes d'énergie
            energyLines.forEach(line => {
                line.clear();
                const data = line.lineData;
                if (progress < 0.5) {
                    const lineProgress = progress / 0.5;
                    const currentLength = data.length * lineProgress;
                    const startDist = 20;
                    const endDist = startDist + currentLength;

                    line.moveTo(
                        Math.cos(data.angle) * startDist,
                        Math.sin(data.angle) * startDist
                    );
                    line.lineTo(
                        Math.cos(data.angle) * endDist,
                        Math.sin(data.angle) * endDist
                    );
                    line.stroke({
                        width: 3 * (1 - lineProgress),
                        color: 0xFFFFFF,
                        alpha: (1 - lineProgress) * 0.8
                    });
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

        // Screen shake important
        this.screenShake(10, 200);

        return effect;
    }

    // ==================== NOMBRE DE DÉGÂTS ====================

    /**
     * Affiche le nombre de dégâts avec style
     */
    showDamageNumber(x, y, damage, color = 0xFF0000) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1500,
        };

        // Texte principal
        const text = new PIXI.Text({
            text: `-${damage}`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 48,
                fontWeight: 'bold',
                fill: color,
                stroke: { color: 0x000000, width: 6 },
                dropShadow: {
                    color: 0x000000,
                    blur: 4,
                    angle: Math.PI / 4,
                    distance: 4,
                },
            }
        });
        text.anchor.set(0.5);
        effectContainer.addChild(text);

        // Glow derrière le texte
        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 40);
        glow.fill({ color: color, alpha: 0.3 });
        effectContainer.addChildAt(glow, 0);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Apparition rapide (0 -> 0.1)
            if (progress < 0.1) {
                const appearProgress = progress / 0.1;
                const scale = 0.5 + appearProgress * 0.7;
                text.scale.set(scale);
                text.alpha = appearProgress;
                glow.alpha = appearProgress * 0.5;
            }
            // Maintien (0.1 -> 0.6)
            else if (progress < 0.6) {
                text.scale.set(1.2);
                text.alpha = 1;

                // Léger pulse
                const pulseProgress = ((progress - 0.1) / 0.5) * Math.PI * 2;
                const pulse = 1 + Math.sin(pulseProgress) * 0.05;
                text.scale.set(1.2 * pulse);
            }
            // Montée et fade (0.6 -> 1)
            else {
                const fadeProgress = (progress - 0.6) / 0.4;
                effectContainer.y = y - fadeProgress * 50;
                text.alpha = 1 - fadeProgress;
                glow.alpha = (1 - fadeProgress) * 0.3;
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

    // ==================== API PRINCIPALE ====================

    /**
     * Joue un effet d'impact approprié au type d'attaque
     * @param {string} type - 'slash', 'claw', 'bite', 'impact', 'magic'
     * @param {number} x - Position X
     * @param {number} y - Position Y
     * @param {number} damage - Dégâts à afficher
     * @param {object} options - Options supplémentaires
     */
    async playDamageEffect(type, x, y, damage, options = {}) {
        if (!this.initialized) {
            console.warn('VFX System not initialized');
            return;
        }

        const color = options.color || 0xFF3333;

        switch (type) {
            case 'slash':
                this.createSlashEffect(x, y, options.angle || -45, color);
                break;
            case 'claw':
            case 'scratch':
                this.createClawEffect(x, y, color);
                break;
            case 'bite':
                this.createBiteEffect(x, y, color);
                break;
            case 'impact':
            case 'magic':
            default:
                this.createImpactEffect(x, y, color, options.intensity || 1);
                break;
        }

        // Afficher les dégâts avec un léger délai
        if (damage !== undefined && damage > 0) {
            setTimeout(() => {
                this.showDamageNumber(x, y, damage, color);
            }, 100);
        }
    }

    /**
     * Détermine automatiquement le type d'effet basé sur le contexte
     */
    async playAutoEffect(x, y, damage, attackerType = 'melee') {
        const effectTypes = {
            'melee': ['claw', 'slash'],
            'beast': ['claw', 'bite'],
            'flying': ['slash', 'claw'],
            'shooter': ['impact'],
            'magic': ['impact'],
        };

        const types = effectTypes[attackerType] || ['impact'];
        const type = types[Math.floor(Math.random() * types.length)];

        await this.playDamageEffect(type, x, y, damage);
    }
}

// Instance globale
const CombatVFX = new CombatVFXSystem();
