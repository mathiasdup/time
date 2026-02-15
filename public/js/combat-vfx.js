/**
 * Game VFX System - Effets visuels GPU via PixiJS 8
 * Gère les effets visuels ponctuels : particules, explosions, trails, rings
 * Le canvas overlay est transparent et superposé au DOM (pointer-events: none)
 */

class GameVFXSystem {
    constructor() {
        this.app = null;
        this.shieldApp = null;       // App PixiJS séparée pour les boucliers (z-index bas)
        this.container = null;       // Effets ponctuels (explosions, impacts)
        this.shieldLayer = null;     // Couche persistante pour les boucliers
        this.initialized = false;
        this.activeEffects = [];
        this.activeShields = new Map(); // slotKey → { container, element, startTime }
        this.activeCamouflages = new Map(); // slotKey → { container, element, startTime, particles }
        this._camoNoiseA = null; // Noise generators (initialized lazily)
        this._camoNoiseB = null;
    }

    async init() {
        if (this.initialized) return;

        try {
            // Canvas principal pour les VFX de combat (z-index élevé)
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

            // Canvas séparé pour les boucliers (z-index bas, juste au-dessus du board)
            this.shieldApp = new PIXI.Application();
            await this.shieldApp.init({
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundAlpha: 0,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
            });

            this.shieldApp.canvas.style.position = 'fixed';
            this.shieldApp.canvas.style.top = '0';
            this.shieldApp.canvas.style.left = '0';
            this.shieldApp.canvas.style.pointerEvents = 'none';
            this.shieldApp.canvas.style.zIndex = '100';
            document.body.appendChild(this.shieldApp.canvas);

            this.shieldLayer = new PIXI.Container();
            this.shieldApp.stage.addChild(this.shieldLayer);

            window.addEventListener('resize', () => this.handleResize());
            this.app.ticker.add(() => this.update());

            this.initialized = true;

        } catch (e) {
            throw e;
        }
    }

    handleResize() {
        if (this.app) {
            this.app.renderer.resize(window.innerWidth, window.innerHeight);
        }
        if (this.shieldApp) {
            this.shieldApp.renderer.resize(window.innerWidth, window.innerHeight);
        }
    }

    update() {
        // Nettoyer les effets ponctuels terminés
        this.activeEffects = this.activeEffects.filter(effect => {
            if (effect.finished) {
                if (effect.container) {
                    if (effect.container.parent) {
                        effect.container.parent.removeChild(effect.container);
                    }
                    effect.container.destroy({ children: true });
                }
                return false;
            }
            return true;
        });

        // Mettre à jour les boucliers persistants
        this.updateShields();

        // Mettre à jour les effets de camouflage
        this.updateCamouflages();
    }

    // ==================== MÉTHODES UTILITAIRES VFX ====================

    /**
     * Flash radial éphémère (invocation, impact, etc.)
     */
    addFlash(x, y, color, duration = 400, maxRadius = 60) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const flash = new PIXI.Graphics();
        effectContainer.addChild(flash);

        const effect = { container: effectContainer, finished: false, startTime: performance.now(), duration };
        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / duration;
            if (progress >= 1) { effect.finished = true; return; }
            const r = maxRadius * progress;
            const a = 1 - progress;
            flash.clear();
            flash.circle(0, 0, r);
            flash.fill({ color, alpha: a * 0.6 });
            requestAnimationFrame(animate);
        };
        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    /**
     * Anneau qui s'expand (invocation, piège, etc.)
     */
    addRing(x, y, color, duration = 700, maxRadius = 70) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const ring = new PIXI.Graphics();
        effectContainer.addChild(ring);

        const effect = { container: effectContainer, finished: false, startTime: performance.now(), duration };
        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / duration;
            if (progress >= 1) { effect.finished = true; return; }
            const r = 10 + (maxRadius - 10) * progress;
            const a = 1 - progress;
            const lineWidth = 3 * (1 - progress) + 0.5;
            ring.clear();
            ring.circle(0, 0, r);
            ring.stroke({ color, width: lineWidth, alpha: a });
            requestAnimationFrame(animate);
        };
        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== CURSOR TRAIL ====================

    createCursorTrail(x, y) {
        if (!this.initialized) return;
        const dot = new PIXI.Graphics();
        dot.circle(0, 0, 3);
        dot.fill({ color: 0xFFAB40, alpha: 0.9 });
        dot.position.set(x, y);
        this.container.addChild(dot);

        const effect = { container: dot, finished: false, startTime: performance.now(), duration: 350 };

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / 350, 1);

            if (progress >= 1) {
                effect.finished = true;
                dot.parent?.removeChild(dot);
                dot.destroy();
                return;
            }

            dot.alpha = (1 - progress) * 0.9;
            dot.scale.set(1 - progress * 0.5);
            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== CLICK RING ====================

    createClickRing(x, y) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const rings = [];
        for (let i = 0; i < 2; i++) {
            const ring = new PIXI.Graphics();
            ring.alpha = 0;
            effectContainer.addChild(ring);
            rings.push({ gfx: ring, delay: i * 0.28 });
        }

        const effect = { container: effectContainer, finished: false, startTime: performance.now(), duration: 350 };

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;

            let allDone = true;
            for (const r of rings) {
                const t = (elapsed - r.delay * 350) / 350;
                if (t < 0) { allDone = false; continue; }
                if (t >= 1) { r.gfx.alpha = 0; continue; }
                allDone = false;
                const scale = 6 + t * 18; // 6px → 24px rayon
                const alpha = 1 - t;
                const width = 2.5 * (1 - t) + 0.5;
                r.gfx.clear();
                r.gfx.circle(0, 0, scale);
                r.gfx.stroke({ color: 0xFFAB40, width, alpha: alpha * 0.85 });
            }

            if (allDone || elapsed > 700) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== SUMMON RING (INVOCATION) ====================

    createSummonEffect(x, y, w, h) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 800,
        };

        const maxR = Math.max(w, h) * 0.6;

        // Flash central blanc-cyan
        const flash = new PIXI.Graphics();
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // 2 anneaux séquentiels
        const rings = [];
        for (let i = 0; i < 2; i++) {
            const ring = new PIXI.Graphics();
            ring.alpha = 0;
            effectContainer.addChild(ring);
            rings.push({ gfx: ring, delay: i * 0.15 });
        }

        // 8 particules lumineuses convergentes
        const particles = [];
        for (let i = 0; i < 8; i++) {
            const gfx = new PIXI.Graphics();
            const size = 1.5 + Math.random() * 2;
            gfx.circle(0, 0, size);
            gfx.fill({ color: 0x62D7FF, alpha: 0.9 });
            gfx.alpha = 0;
            const angle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const dist = maxR * (0.8 + Math.random() * 0.4);
            particles.push({
                gfx, angle, dist,
                startX: Math.cos(angle) * dist,
                startY: Math.sin(angle) * dist,
            });
            effectContainer.addChild(gfx);
        }

        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / effect.duration;
            if (progress >= 1) { effect.finished = true; return; }

            // Flash (0 → 0.5)
            if (progress < 0.5) {
                const fp = progress / 0.5;
                const flashAlpha = Math.sin(fp * Math.PI) * 0.7;
                const flashScale = 10 + fp * 30;
                flash.clear();
                flash.circle(0, 0, flashScale);
                flash.fill({ color: 0xFFFFFF, alpha: flashAlpha * 0.5 });
                flash.circle(0, 0, flashScale * 0.6);
                flash.fill({ color: 0x62D7FF, alpha: flashAlpha * 0.3 });
            } else {
                flash.alpha = 0;
            }

            // Anneaux
            for (const r of rings) {
                const rp = (progress - r.delay) / (1 - r.delay);
                if (rp < 0 || rp >= 1) { r.gfx.alpha = 0; continue; }
                const radius = 10 + rp * (maxR - 10);
                const alpha = (1 - rp) * 0.9;
                const width = 3 * (1 - rp) + 0.5;
                r.gfx.clear();
                r.gfx.circle(0, 0, radius);
                r.gfx.stroke({ color: 0x62D7FF, width, alpha });
                r.gfx.alpha = 1;
            }

            // Particules convergentes (0 → 0.6)
            if (progress < 0.6) {
                const pp = progress / 0.6;
                for (const p of particles) {
                    const t = Math.min(pp * 1.5, 1);
                    const ease = 1 - Math.pow(1 - t, 3);
                    p.gfx.position.set(
                        p.startX * (1 - ease),
                        p.startY * (1 - ease)
                    );
                    p.gfx.alpha = t < 0.8 ? Math.min(t / 0.1, 1) : Math.max(0, (1 - t) / 0.2);
                }
            } else {
                for (const p of particles) p.gfx.alpha = 0;
            }

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== TRAP REVEAL RING ====================

    createTrapRevealEffect(x, y, w, h) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 800,
        };

        const maxR = Math.max(w, h) * 0.7;

        // Flash central orange-doré
        const flash = new PIXI.Graphics();
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // 2 anneaux séquentiels oranges
        const rings = [];
        for (let i = 0; i < 2; i++) {
            const ring = new PIXI.Graphics();
            ring.alpha = 0;
            effectContainer.addChild(ring);
            rings.push({ gfx: ring, delay: i * 0.18 });
        }

        // 6 étincelles qui jaillissent vers l'extérieur
        const sparks = [];
        for (let i = 0; i < 6; i++) {
            const gfx = new PIXI.Graphics();
            const size = 1.5 + Math.random() * 2;
            gfx.circle(0, 0, size);
            gfx.fill({ color: 0xFFCC33, alpha: 0.9 });
            gfx.alpha = 0;
            const angle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const speed = maxR * (0.8 + Math.random() * 0.5);
            sparks.push({
                gfx, angle, speed,
                endX: Math.cos(angle) * speed,
                endY: Math.sin(angle) * speed,
            });
            effectContainer.addChild(gfx);
        }

        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / effect.duration;
            if (progress >= 1) { effect.finished = true; return; }

            // Flash (0 → 0.5)
            if (progress < 0.5) {
                const fp = progress / 0.5;
                const flashAlpha = Math.sin(fp * Math.PI) * 0.7;
                const flashScale = 8 + fp * 25;
                flash.clear();
                flash.circle(0, 0, flashScale);
                flash.fill({ color: 0xFFC832, alpha: flashAlpha * 0.5 });
                flash.circle(0, 0, flashScale * 0.5);
                flash.fill({ color: 0xFFAA22, alpha: flashAlpha * 0.3 });
            } else {
                flash.alpha = 0;
            }

            // Anneaux
            for (const r of rings) {
                const rp = (progress - r.delay) / (1 - r.delay);
                if (rp < 0 || rp >= 1) { r.gfx.alpha = 0; continue; }
                const radius = 15 + rp * (maxR - 15);
                const alpha = (1 - rp) * 0.9;
                const width = 3 * (1 - rp) + 0.5;
                r.gfx.clear();
                r.gfx.circle(0, 0, radius);
                r.gfx.stroke({ color: 0xFFAA32, width, alpha });
                r.gfx.alpha = 1;
            }

            // Étincelles vers l'extérieur (0.05 → 0.7)
            if (progress >= 0.05 && progress < 0.7) {
                const sp = (progress - 0.05) / 0.65;
                for (const s of sparks) {
                    const ease = 1 - Math.pow(1 - sp, 2);
                    s.gfx.position.set(s.endX * ease, s.endY * ease);
                    s.gfx.alpha = sp < 0.2 ? sp / 0.2 : Math.max(0, 1 - (sp - 0.4) / 0.6);
                    s.gfx.scale.set(1 - sp * 0.5);
                }
            } else {
                for (const s of sparks) s.gfx.alpha = 0;
            }

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== WIND GUST (DÉPLACEMENT) ====================

    /**
     * Effet de vent élégant et contenu sur la carte pour le déplacement.
     * Style Magic Arena / Hearthstone : subtil, propre, directionnel.
     */
    createWindGustEffect(x, y, w, h, angle) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        effectContainer.rotation = angle;
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 500,
        };

        const hw = w / 2, hh = h / 2;

        // ===== 1) 4 traînées fines qui balayent la carte =====
        const streaks = [];
        const yPositions = [-hh * 0.55, -hh * 0.15, hh * 0.2, hh * 0.55];
        for (let i = 0; i < 4; i++) {
            const gfx = new PIXI.Graphics();
            gfx.alpha = 0;
            effectContainer.addChild(gfx);
            streaks.push({
                gfx,
                y: yPositions[i] + (Math.random() - 0.5) * 4,
                thickness: 1 + Math.random() * 0.8,
                delay: i * 0.06,
                curve: (Math.random() - 0.5) * 5,
            });
        }

        // ===== 2) Voile directionnel (une seule forme douce) =====
        const veil = new PIXI.Graphics();
        veil.alpha = 0;
        effectContainer.addChild(veil);

        // ===== 3) Quelques points lumineux qui filent =====
        const dots = [];
        for (let i = 0; i < 5; i++) {
            const gfx = new PIXI.Graphics();
            const r = 1 + Math.random() * 1.2;
            gfx.circle(0, 0, r);
            gfx.fill({ color: 0xFFFFFF, alpha: 0.8 });
            gfx.alpha = 0;
            effectContainer.addChild(gfx);
            dots.push({
                gfx,
                y: (Math.random() - 0.5) * hh * 1.4,
                speed: 1 + Math.random() * 0.6,
                delay: Math.random() * 0.2,
            });
        }

        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / effect.duration;
            if (progress >= 1) { effect.finished = true; return; }

            // --- Traînées ---
            for (const s of streaks) {
                const sp = Math.max(0, (progress - s.delay) / (0.8 - s.delay));
                if (sp <= 0 || sp >= 1) { s.gfx.alpha = 0; continue; }

                // La tête avance de gauche à droite dans la carte
                const headX = -hw + sp * hw * 2.8;
                const tailX = headX - hw * 0.7;
                // Clipper aux bords de la carte
                const l = Math.max(tailX, -hw);
                const r = Math.min(headX, hw);
                if (l >= r) { s.gfx.alpha = 0; continue; }

                const alpha = Math.sin(sp * Math.PI) * 0.6;
                const mid = (l + r) / 2;

                s.gfx.clear();
                s.gfx.moveTo(l, s.y);
                s.gfx.quadraticCurveTo(mid, s.y + s.curve, r, s.y);
                s.gfx.stroke({ color: 0xDDEEFF, width: s.thickness, alpha });
                // Coeur blanc plus fin
                s.gfx.moveTo(l, s.y);
                s.gfx.quadraticCurveTo(mid, s.y + s.curve * 0.4, r, s.y);
                s.gfx.stroke({ color: 0xFFFFFF, width: s.thickness * 0.35, alpha: alpha * 0.7 });
                s.gfx.alpha = 1;
            }

            // --- Voile ---
            if (progress < 0.7) {
                const vp = progress / 0.7;
                const alpha = Math.sin(vp * Math.PI) * 0.1;
                const sweepX = -hw + vp * hw * 2;
                veil.clear();
                veil.ellipse(sweepX * 0.3, 0, hw * 0.6, hh * 0.7);
                veil.fill({ color: 0xCCDDFF, alpha });
                veil.alpha = 1;
            } else {
                veil.alpha = 0;
            }

            // --- Points lumineux ---
            for (const d of dots) {
                const dp = Math.max(0, (progress - d.delay) / (0.75 - d.delay));
                if (dp <= 0 || dp >= 1) { d.gfx.alpha = 0; continue; }

                const dx = -hw * 0.8 + dp * d.speed * hw * 2;
                // Rester dans la carte
                if (dx < -hw || dx > hw) { d.gfx.alpha = 0; continue; }

                d.gfx.position.set(dx, d.y);
                d.gfx.alpha = Math.sin(dp * Math.PI) * 0.7;
            }

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
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
        for (let i = 0; i < 8; i++) {
            const particle = new PIXI.Graphics();
            const size = 4 + Math.random() * 6;
            particle.circle(0, 0, size);
            particle.fill({ color: i % 2 === 0 ? 0xFFFFFF : color });
            particle.particleData = {
                angle: (i / 8) * Math.PI * 2 + Math.random() * 0.4,
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

    // ==================== NOMBRE DE SOIN ====================

    showHealNumber(x, y, amount) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1200,
        };

        // Texte du soin
        const text = new PIXI.Text({
            text: `+${amount}`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 48,
                fontWeight: 'bold',
                fill: 0x2ECC71,
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

        // Glow vert
        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 30);
        glow.fill({ color: 0x2ECC71, alpha: 0.3 });
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
                glow.alpha = p * 0.3;
            }
            // Maintien avec pulse (0.1 -> 0.5)
            else if (progress < 0.5) {
                text.alpha = 1;
                const pulse = 1 + Math.sin((progress - 0.1) * Math.PI * 4) * 0.05;
                text.scale.set(1.1 * pulse);
                glow.alpha = 0.3;
            }
            // Montée et fade (0.5 -> 1)
            else {
                const fadeProgress = (progress - 0.5) / 0.5;
                effectContainer.y = startY - fadeProgress * 50;
                text.alpha = 1 - fadeProgress;
                glow.alpha = (1 - fadeProgress) * 0.3;
                text.scale.set(1.1 - fadeProgress * 0.2);
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

    // ==================== INDICATEUR DE BUFF ====================

    showBuffNumber(x, y, atk, hp) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1200,
        };

        const text = new PIXI.Text({
            text: `+${atk}/+${hp}`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 44,
                fontWeight: 'bold',
                fill: 0xFFFFFF,
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

        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 30);
        glow.fill({ color: 0xFFDD44, alpha: 0.3 });
        effectContainer.addChildAt(glow, 0);

        const startY = y;

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (progress < 0.1) {
                // Fade in: scale 0.3 → 1.1
                const p = progress / 0.1;
                text.scale.set(0.3 + p * 0.8);
                text.alpha = p;
                glow.alpha = p * 0.3;
            } else if (progress < 0.5) {
                // Pulse: 2 cycles complets (sin revient à 0 en fin de phase)
                text.alpha = 1;
                const pulse = 1 + Math.sin((progress - 0.1) * Math.PI * 10) * 0.05;
                text.scale.set(1.1 * pulse);
                glow.alpha = 0.3;
            } else {
                // Fade out: scale 1.1 → 0.9
                const fadeProgress = (progress - 0.5) / 0.5;
                effectContainer.y = startY - fadeProgress * 50;
                text.alpha = 1 - fadeProgress;
                glow.alpha = (1 - fadeProgress) * 0.3;
                text.scale.set(1.1 - fadeProgress * 0.2);
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

    // ==================== TORRENT D'EAU (DRAGON D'ÉCLAT) ====================

    createWaterTorrentEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1600,
        };

        // Helper : goutte d'eau (ellipse allongée)
        const drawDrop = (g, size, color, coreColor) => {
            g.moveTo(0, -size);
            g.bezierCurveTo(size * 0.3, -size * 0.4, size * 0.4, size * 0.1, size * 0.25, size * 0.4);
            g.quadraticCurveTo(0, size * 0.6, -size * 0.25, size * 0.4);
            g.bezierCurveTo(-size * 0.4, size * 0.1, -size * 0.3, -size * 0.4, 0, -size);
            g.fill({ color });
            if (coreColor) {
                const cs = size * 0.45;
                g.moveTo(0, -cs);
                g.bezierCurveTo(cs * 0.25, -cs * 0.3, cs * 0.3, cs * 0.1, cs * 0.15, cs * 0.35);
                g.quadraticCurveTo(0, cs * 0.5, -cs * 0.15, cs * 0.35);
                g.bezierCurveTo(-cs * 0.3, cs * 0.1, -cs * 0.25, -cs * 0.3, 0, -cs);
                g.fill({ color: coreColor });
            }
        };

        // ===== Halo d'eau =====
        const halo = new PIXI.Graphics();
        effectContainer.addChild(halo);

        // ===== Anneaux d'eau =====
        const rings = [];
        for (let i = 0; i < 2; i++) {
            const ring = new PIXI.Graphics();
            ring.alpha = 0;
            effectContainer.addChild(ring);
            rings.push({ gfx: ring, delay: i * 0.06 });
        }

        // ===== Flux d'eau ascendants (streams) =====
        const streams = [];
        const NUM_STREAMS = 30;
        const streamPalette = [
            { outer: 0x2288DD, core: 0x88DDFF },
            { outer: 0x1177CC, core: 0x66CCFF },
            { outer: 0x44AAEE, core: 0xAAEEFF },
            { outer: 0x0066BB, core: 0x55BBEE },
        ];
        for (let i = 0; i < NUM_STREAMS; i++) {
            const p = new PIXI.Graphics();
            const palette = streamPalette[Math.floor(Math.random() * streamPalette.length)];
            const size = 4 + Math.random() * 7;
            drawDrop(p, size, palette.outer, palette.core);
            p.alpha = 0;
            effectContainer.addChild(p);
            streams.push({
                gfx: p,
                xOffset: (Math.random() - 0.5) * w * 0.7,
                speed: 80 + Math.random() * 140,
                wobble: (Math.random() - 0.5) * 2.5,
                wobbleFreq: 4 + Math.random() * 6,
                delay: 0.05 + Math.random() * 0.35,
            });
        }

        // ===== Gouttes qui éclaboussent =====
        const splashes = [];
        const NUM_SPLASHES = 16;
        for (let i = 0; i < NUM_SPLASHES; i++) {
            const s = new PIXI.Graphics();
            const size = 2 + Math.random() * 4;
            const palette = streamPalette[Math.floor(Math.random() * streamPalette.length)];
            drawDrop(s, size, palette.outer, palette.core);
            s.alpha = 0;
            effectContainer.addChild(s);
            const angle = Math.random() * Math.PI * 2;
            splashes.push({
                gfx: s, angle,
                speed: 40 + Math.random() * 100,
                gravity: 60 + Math.random() * 80,
                delay: 0.15 + Math.random() * 0.15,
            });
        }

        // ===== Flash d'activation =====
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 8);
        flash.fill({ color: 0xAAEEFF });
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // ===== Brume résiduelle =====
        const mist = [];
        const NUM_MIST = 10;
        for (let i = 0; i < NUM_MIST; i++) {
            const m = new PIXI.Graphics();
            const radius = 6 + Math.random() * 10;
            m.circle(0, 0, radius);
            m.fill({ color: 0x88CCEE, alpha: 0.15 });
            m.alpha = 0;
            effectContainer.addChild(m);
            mist.push({
                gfx: m,
                x: (Math.random() - 0.5) * w * 0.9,
                y: -h * 0.2 - Math.random() * h * 0.4,
                driftX: (Math.random() - 0.5) * 30,
                driftY: -(10 + Math.random() * 20),
                delay: 0.4 + Math.random() * 0.3,
            });
        }

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);
            const t = elapsed / 1000;

            // ── Flash d'activation (0 → 0.12) ──
            if (progress < 0.12) {
                const fp = progress / 0.12;
                flash.scale.set(1 + fp * 6);
                flash.alpha = (1 - fp) * 0.8;
            } else {
                flash.alpha = 0;
            }

            // ── Halo d'eau (0.05 → 0.7) ──
            if (progress > 0.05 && progress < 0.7) {
                const hp = (progress - 0.05) / 0.65;
                const fadeIn = Math.min(hp / 0.2, 1);
                const fadeOut = hp > 0.6 ? 1 - (hp - 0.6) / 0.4 : 1;
                const pulse = 1 + Math.sin(t * 8) * 0.1;
                halo.clear();
                const radius = (w * 0.55 + 8) * pulse;
                halo.circle(0, 0, radius);
                halo.fill({ color: 0x2288DD, alpha: 0.1 * fadeIn * fadeOut });
                halo.circle(0, 0, radius * 0.55);
                halo.fill({ color: 0x44AAEE, alpha: 0.07 * fadeIn * fadeOut });
            } else {
                halo.clear();
            }

            // ── Anneaux d'eau (0 → 0.3) ──
            for (const r of rings) {
                const rp = Math.max(0, progress - r.delay) / 0.25;
                if (rp <= 0 || rp >= 1) { r.gfx.alpha = 0; continue; }
                const radius = rp * Math.max(w, h) * 0.8;
                r.gfx.clear();
                r.gfx.circle(0, 0, radius);
                r.gfx.stroke({ color: 0x44AAEE, width: 2.5 * (1 - rp), alpha: 0.6 * (1 - rp) });
            }

            // ── Flux d'eau ascendants (0.05 → 0.8) ──
            for (const s of streams) {
                const sp = Math.max(0, progress - s.delay) / 0.5;
                if (sp <= 0 || sp >= 1) { s.gfx.alpha = 0; continue; }

                const wobbleX = Math.sin(t * s.wobbleFreq) * s.wobble * 8;
                s.gfx.x = s.xOffset + wobbleX;
                s.gfx.y = h * 0.35 - sp * s.speed;
                // Gouttes pointent vers le haut, ondulation
                s.gfx.rotation = Math.sin(t * s.wobbleFreq * 1.5) * 0.25;

                const fadeIn = Math.min(sp / 0.1, 1);
                const fadeOut = sp > 0.6 ? 1 - (sp - 0.6) / 0.4 : 1;
                s.gfx.alpha = fadeIn * fadeOut * 0.85;
                const shrink = 1 - sp * 0.5;
                s.gfx.scale.set(Math.max(0.2, shrink));
            }

            // ── Éclaboussures (0.15 → 0.5) ──
            for (const sp of splashes) {
                const spp = Math.max(0, progress - sp.delay) / 0.35;
                if (spp <= 0 || spp >= 1) { sp.gfx.alpha = 0; continue; }
                sp.gfx.x = Math.cos(sp.angle) * spp * sp.speed;
                sp.gfx.y = Math.sin(sp.angle) * spp * sp.speed + spp * spp * sp.gravity;
                // Orienter dans la direction du mouvement
                const dx = Math.cos(sp.angle);
                const dy = Math.sin(sp.angle) + spp * 2 * sp.gravity / sp.speed;
                sp.gfx.rotation = Math.atan2(dy, dx) + Math.PI / 2;
                sp.gfx.alpha = (1 - spp) * 0.8;
            }

            // ── Brume résiduelle (0.4 → 1.0) ──
            for (const m of mist) {
                const mp = Math.max(0, progress - m.delay) / (1 - m.delay);
                if (mp <= 0 || mp >= 1) { m.gfx.alpha = 0; continue; }
                m.gfx.x = m.x + m.driftX * mp;
                m.gfx.y = m.y + m.driftY * mp;
                const fadeIn = Math.min(mp / 0.2, 1);
                const fadeOut = mp > 0.4 ? 1 - (mp - 0.4) / 0.6 : 1;
                m.gfx.alpha = fadeIn * fadeOut * 0.4;
                m.gfx.scale.set(1 + mp * 0.8);
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

    // ==================== SPELL EFFECT (IMPACT DE SORT) ====================

    /**
     * Flash d'impact de sort sur une cible.
     * Remplace le div emoji — pulse lumineux + anneau + particules.
     */
    createSpellImpactEffect(x, y) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 600,
        };

        // Flash central
        const flash = new PIXI.Graphics();
        effectContainer.addChild(flash);

        // Anneau
        const ring = new PIXI.Graphics();
        effectContainer.addChild(ring);

        // 8 éclats de lumière
        const sparks = [];
        for (let i = 0; i < 8; i++) {
            const gfx = new PIXI.Graphics();
            gfx.alpha = 0;
            const angle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const speed = 25 + Math.random() * 20;
            sparks.push({ gfx, angle, speed });
            effectContainer.addChild(gfx);
        }

        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / effect.duration;
            if (progress >= 1) { effect.finished = true; return; }

            // Flash (0 → 0.4)
            flash.clear();
            if (progress < 0.4) {
                const fp = progress / 0.4;
                const a = Math.sin(fp * Math.PI) * 0.6;
                const r = 8 + fp * 16;
                flash.circle(0, 0, r);
                flash.fill({ color: 0xFFFFFF, alpha: a * 0.5 });
                flash.circle(0, 0, r * 0.5);
                flash.fill({ color: 0xFFDD66, alpha: a });
            }

            // Anneau
            ring.clear();
            if (progress < 0.7) {
                const rp = progress / 0.7;
                const radius = 5 + rp * 35;
                const a = (1 - rp) * 0.7;
                const w = 2.5 * (1 - rp) + 0.5;
                ring.circle(0, 0, radius);
                ring.stroke({ color: 0xFFCC44, width: w, alpha: a });
            }

            // Éclats
            for (const s of sparks) {
                if (progress < 0.05 || progress > 0.7) { s.gfx.alpha = 0; continue; }
                const sp = (progress - 0.05) / 0.65;
                const dist = sp * s.speed;
                s.gfx.clear();
                s.gfx.circle(Math.cos(s.angle) * dist, Math.sin(s.angle) * dist, 1.5 - sp * 0.8);
                s.gfx.fill({ color: 0xFFDD88, alpha: (1 - sp) * 0.8 });
                s.gfx.alpha = 1;
            }

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== SPELL MISS (SORT MANQUÉ) ====================

    /**
     * Croix rouge élégante pour un sort esquivé/manqué.
     */
    createSpellMissEffect(x, y) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 800,
        };

        // Deux barres de la croix
        const bar1 = new PIXI.Graphics();
        const bar2 = new PIXI.Graphics();
        effectContainer.addChild(bar1);
        effectContainer.addChild(bar2);

        // Flash de fond rouge
        const bgFlash = new PIXI.Graphics();
        effectContainer.addChild(bgFlash);
        // Remettre les barres devant
        effectContainer.addChild(bar1);
        effectContainer.addChild(bar2);

        const barLen = 28, barW = 5, barR = 2.5;

        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / effect.duration;
            if (progress >= 1) { effect.finished = true; return; }

            // Apparition rapide (0 → 0.15)
            let scale, alpha;
            if (progress < 0.15) {
                const ip = progress / 0.15;
                const ease = 1 - Math.pow(1 - ip, 3);
                scale = 0.3 + ease * 0.9;
                alpha = ease;
            } else if (progress < 0.5) {
                scale = 1.2 - (progress - 0.15) / 0.35 * 0.2;
                alpha = 1;
            } else {
                const fp = (progress - 0.5) / 0.5;
                scale = 1 - fp * 0.2;
                alpha = 1 - fp;
            }

            // Barres de la croix
            bar1.clear();
            bar2.clear();
            bar1.roundRect(-barLen, -barW / 2, barLen * 2, barW, barR);
            bar1.fill({ color: 0xDD2200, alpha: alpha * 0.9 });
            bar1.roundRect(-barLen, -barW / 2, barLen * 2, barW, barR);
            bar1.stroke({ color: 0xFF4422, width: 1, alpha: alpha * 0.5 });
            bar1.rotation = Math.PI / 4;
            bar1.scale.set(scale);

            bar2.roundRect(-barLen, -barW / 2, barLen * 2, barW, barR);
            bar2.fill({ color: 0xDD2200, alpha: alpha * 0.9 });
            bar2.roundRect(-barLen, -barW / 2, barLen * 2, barW, barR);
            bar2.stroke({ color: 0xFF4422, width: 1, alpha: alpha * 0.5 });
            bar2.rotation = -Math.PI / 4;
            bar2.scale.set(scale);

            // Flash rouge de fond
            bgFlash.clear();
            if (progress < 0.3) {
                const fp = progress / 0.3;
                bgFlash.circle(0, 0, 20 + fp * 10);
                bgFlash.fill({ color: 0xFF2200, alpha: Math.sin(fp * Math.PI) * 0.15 });
            }

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== SHIELD BREAK (VERRE BRISÉ) ====================

    createShieldBreakEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1800,
        };

        const hw = w / 2, hh = h / 2;

        // ===== Helper : dessiner un fragment de verre irrégulier (polygone 4-6 côtés) =====
        const drawGlassShard = (g, points, color, alpha, edgeColor) => {
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
            }
            g.closePath();
            g.fill({ color, alpha });
            g.stroke({ color: edgeColor, width: 1.2, alpha: alpha + 0.2 });
        };

        // Générer un polygone de verre irrégulier autour d'un point
        const generateShard = (cx, cy, avgSize) => {
            const sides = 4 + Math.floor(Math.random() * 3); // 4-6 côtés
            const points = [];
            for (let i = 0; i < sides; i++) {
                const a = (i / sides) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
                const r = avgSize * (0.5 + Math.random() * 0.7);
                points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
            }
            return points;
        };

        // ===== Palette de verre cyan translucide =====
        const glassColors = [
            { fill: 0x00DDFF, edge: 0x88EEFF },
            { fill: 0x00BBEE, edge: 0x66DDFF },
            { fill: 0x00AADD, edge: 0x44CCEE },
            { fill: 0x22CCFF, edge: 0xAAEEFF },
            { fill: 0x0099CC, edge: 0x55CCEE },
        ];

        // ===== 1) Flash d'impact initial =====
        const impactFlash = new PIXI.Graphics();
        impactFlash.ellipse(0, 0, hw * 1.2, hh * 1.2);
        impactFlash.fill({ color: 0x00DDFF, alpha: 0 });
        effectContainer.addChild(impactFlash);

        // ===== 2) Réseau de fissures (lignes qui rayonnent du centre) =====
        const cracks = [];
        const crackCount = 12 + Math.floor(Math.random() * 6);
        for (let i = 0; i < crackCount; i++) {
            const crack = new PIXI.Graphics();
            const baseAngle = (i / crackCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const segments = 3 + Math.floor(Math.random() * 3);
            const segmentPoints = [{ x: 0, y: 0 }];
            let cx = 0, cy = 0;
            for (let s = 0; s < segments; s++) {
                const segLen = (8 + Math.random() * 15) * (1 - s * 0.15);
                const deviate = baseAngle + (Math.random() - 0.5) * 0.7;
                cx += Math.cos(deviate) * segLen;
                cy += Math.sin(deviate) * segLen;
                segmentPoints.push({ x: cx, y: cy });
            }
            cracks.push({ gfx: crack, points: segmentPoints, alpha: 0 });
            effectContainer.addChild(crack);
        }

        // ===== 3) Éclats de verre (fragments qui volent) =====
        const shards = [];
        const shardCount = 22 + Math.floor(Math.random() * 8);
        for (let i = 0; i < shardCount; i++) {
            const gfx = new PIXI.Graphics();
            const angle = Math.random() * Math.PI * 2;
            const startDist = Math.random() * 15;
            const startX = Math.cos(angle) * startDist;
            const startY = Math.sin(angle) * startDist;
            const size = 4 + Math.random() * 10;
            const palette = glassColors[Math.floor(Math.random() * glassColors.length)];
            const points = generateShard(0, 0, size);

            drawGlassShard(gfx, points, palette.fill, 0.5 + Math.random() * 0.3, palette.edge);

            // Reflet brillant sur le fragment (petite ligne blanche)
            const rAngle = Math.random() * Math.PI;
            const rLen = size * 0.5;
            gfx.moveTo(Math.cos(rAngle) * rLen * 0.3, Math.sin(rAngle) * rLen * 0.3);
            gfx.lineTo(Math.cos(rAngle) * rLen, Math.sin(rAngle) * rLen);
            gfx.stroke({ color: 0xFFFFFF, width: 1, alpha: 0.6 });

            gfx.position.set(startX, startY);
            gfx.alpha = 0;

            const speed = 60 + Math.random() * 120;
            const velX = Math.cos(angle) * speed;
            const velY = Math.sin(angle) * speed;
            const gravity = 80 + Math.random() * 60;
            const rotSpeed = (Math.random() - 0.5) * 12;
            const spinAxis = Math.random() > 0.5; // rotation X ou Y pour effet 3D

            shards.push({
                gfx, velX, velY, gravity, rotSpeed, spinAxis,
                startX, startY, delay: Math.random() * 0.15,
            });
            effectContainer.addChild(gfx);
        }

        // ===== 4) Éclats lumineux (petites particules brillantes rapides) =====
        const sparks = [];
        const sparkCount = 30;
        for (let i = 0; i < sparkCount; i++) {
            const gfx = new PIXI.Graphics();
            const size = 1.5 + Math.random() * 2.5;
            gfx.circle(0, 0, size);
            gfx.fill({ color: 0xAAEEFF, alpha: 0.9 });
            gfx.alpha = 0;

            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 200;

            sparks.push({
                gfx,
                velX: Math.cos(angle) * speed,
                velY: Math.sin(angle) * speed,
                gravity: 50 + Math.random() * 80,
                delay: Math.random() * 0.1,
                life: 0.4 + Math.random() * 0.3,
            });
            effectContainer.addChild(gfx);
        }

        // ===== 5) Onde de choc (anneau qui s'expand) =====
        const shockwave = new PIXI.Graphics();
        shockwave.alpha = 0;
        effectContainer.addChild(shockwave);

        // ===== 6) Poussière de verre (brume qui retombe) =====
        const dustParticles = [];
        const dustCount = 18;
        for (let i = 0; i < dustCount; i++) {
            const gfx = new PIXI.Graphics();
            const size = 2 + Math.random() * 4;
            gfx.circle(0, 0, size);
            gfx.fill({ color: 0x88DDFF, alpha: 0.3 });
            gfx.alpha = 0;

            const angle = Math.random() * Math.PI * 2;
            const dist = 10 + Math.random() * 30;

            dustParticles.push({
                gfx,
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist,
                driftX: (Math.random() - 0.5) * 20,
                fallSpeed: 15 + Math.random() * 25,
                delay: 0.15 + Math.random() * 0.2,
                life: 0.5 + Math.random() * 0.4,
            });
            effectContainer.addChild(gfx);
        }

        // ===== 7) Texte "IMMUNE" avec slam-in =====
        const text = new PIXI.Text({
            text: 'IMMUNE',
            style: {
                fontFamily: 'Arial Black, Impact, sans-serif',
                fontSize: 22,
                fontWeight: '900',
                fill: 0x00DDFF,
                letterSpacing: 3,
                dropShadow: {
                    alpha: 0.9,
                    angle: Math.PI / 2,
                    blur: 8,
                    color: 0x006688,
                    distance: 0,
                },
            },
        });
        text.anchor.set(0.5);
        text.position.set(0, 0);
        text.alpha = 0;
        text.scale.set(0);
        effectContainer.addChild(text);

        this.screenShake(6, 150);

        // ===== Animation loop =====
        const animate = () => {
            const now = performance.now();
            const elapsed = (now - effect.startTime) / effect.duration;
            const progress = Math.min(elapsed, 1);

            // --- Phase 1 : Impact flash + fissures (0 → 0.15) ---
            if (progress < 0.15) {
                const p = progress / 0.15;
                // Flash blanc-cyan
                impactFlash.clear();
                const flashAlpha = Math.sin(p * Math.PI) * 0.7;
                impactFlash.ellipse(0, 0, hw * (0.8 + p * 0.6), hh * (0.8 + p * 0.6));
                impactFlash.fill({ color: 0xBBEEFF, alpha: flashAlpha });

                // Fissures apparaissent progressivement
                for (let i = 0; i < cracks.length; i++) {
                    const c = cracks[i];
                    const crackProgress = Math.min(p * 1.5, 1);
                    c.gfx.clear();
                    c.alpha = crackProgress;
                    const visibleSegments = Math.ceil(crackProgress * c.points.length);
                    if (visibleSegments >= 2) {
                        c.gfx.moveTo(c.points[0].x, c.points[0].y);
                        for (let s = 1; s < visibleSegments; s++) {
                            c.gfx.lineTo(c.points[s].x, c.points[s].y);
                        }
                        c.gfx.stroke({ color: 0xAAEEFF, width: 1.5, alpha: c.alpha * 0.9 });
                        // Lueur le long des fissures
                        c.gfx.moveTo(c.points[0].x, c.points[0].y);
                        for (let s = 1; s < visibleSegments; s++) {
                            c.gfx.lineTo(c.points[s].x, c.points[s].y);
                        }
                        c.gfx.stroke({ color: 0x00DDFF, width: 4, alpha: c.alpha * 0.25 });
                    }
                }
            }

            // --- Phase 2 : Explosion de verre (0.1 → 0.85) ---
            if (progress >= 0.1 && progress < 0.85) {
                const p = (progress - 0.1) / 0.75;

                // Fissures disparaissent
                for (const c of cracks) {
                    c.gfx.alpha = Math.max(0, 1 - p * 3);
                }

                // Éclats de verre s'envolent avec gravité
                for (const s of shards) {
                    const sp = Math.max(0, Math.min((p - s.delay) / (1 - s.delay), 1));
                    if (sp <= 0) continue;

                    const t = sp * 1.2; // temps normalisé
                    s.gfx.alpha = sp < 0.1 ? sp / 0.1 : Math.max(0, 1 - (sp - 0.3) / 0.7);
                    s.gfx.position.set(
                        s.startX + s.velX * t,
                        s.startY + s.velY * t + 0.5 * s.gravity * t * t
                    );
                    s.gfx.rotation = s.rotSpeed * t;
                    // Effet 3D : compression sur un axe
                    if (s.spinAxis) {
                        s.gfx.scale.set(1, Math.abs(Math.cos(t * 6)));
                    } else {
                        s.gfx.scale.set(Math.abs(Math.cos(t * 6)), 1);
                    }
                }

                // Étincelles rapides
                for (const sp of sparks) {
                    const sparkP = Math.max(0, Math.min((p - sp.delay) / sp.life, 1));
                    if (sparkP <= 0) continue;
                    const t = sparkP * 0.8;
                    sp.gfx.alpha = sparkP < 0.15 ? sparkP / 0.15 : Math.max(0, 1 - (sparkP - 0.3) / 0.7);
                    sp.gfx.position.set(
                        sp.velX * t,
                        sp.velY * t + 0.5 * sp.gravity * t * t
                    );
                    sp.gfx.scale.set(1 - sparkP * 0.5);
                }

                // Onde de choc
                const waveP = Math.min(p * 2.5, 1);
                shockwave.clear();
                const waveRadius = hw * (0.5 + waveP * 1.5);
                shockwave.circle(0, 0, waveRadius);
                shockwave.stroke({ color: 0x00CCEE, width: 2.5 - waveP * 2, alpha: (1 - waveP) * 0.6 });
                shockwave.alpha = 1;

                // Poussière
                for (const d of dustParticles) {
                    const dp = Math.max(0, Math.min((p - d.delay) / d.life, 1));
                    if (dp <= 0) continue;
                    d.gfx.alpha = dp < 0.2 ? dp / 0.2 : Math.max(0, (1 - dp) * 0.4);
                    d.gfx.position.set(
                        d.x + d.driftX * dp,
                        d.y + d.fallSpeed * dp * dp
                    );
                }
            }

            // --- Phase 3 : Texte IMMUNE slam-in (0.08 → 0.7) ---
            if (progress >= 0.08 && progress < 0.7) {
                const tp = (progress - 0.08) / 0.62;
                if (tp < 0.15) {
                    // Slam-in : scale rapide de 2.5 → 1
                    const slamP = tp / 0.15;
                    const ease = 1 - Math.pow(1 - slamP, 3);
                    text.scale.set(2.5 - 1.5 * ease);
                    text.alpha = ease;
                } else if (tp < 0.5) {
                    text.scale.set(1);
                    text.alpha = 1;
                    // Légère pulsation
                    const pulseP = (tp - 0.15) / 0.35;
                    text.scale.set(1 + Math.sin(pulseP * Math.PI * 2) * 0.05);
                } else {
                    // Montée héroïque + fade
                    const riseP = (tp - 0.5) / 0.5;
                    const ease = riseP * riseP;
                    text.position.set(0, -20 * ease);
                    text.alpha = 1 - ease;
                    text.scale.set(1 + riseP * 0.15);
                }
            }

            // --- Fade out global (0.85 → 1) ---
            if (progress >= 0.85) {
                const fadeP = (progress - 0.85) / 0.15;
                effectContainer.alpha = 1 - fadeP;
            }

            // Flash disparaît
            if (progress >= 0.15) {
                impactFlash.alpha = Math.max(0, impactFlash.alpha - 0.05);
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

    // ==================== ATK BOOST (FEU) ====================

    createAtkBoostEffect(x, y, w, h, boost) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 2000,
        };

        // Helper : dessine une flamme (goutte inversée, pointe vers le haut)
        const drawFlame = (g, size, color, coreColor) => {
            // Flamme extérieure
            g.moveTo(0, -size);
            g.bezierCurveTo(size * 0.25, -size * 0.6, size * 0.45, -size * 0.05, size * 0.3, size * 0.35);
            g.quadraticCurveTo(0, size * 0.55, -size * 0.3, size * 0.35);
            g.bezierCurveTo(-size * 0.45, -size * 0.05, -size * 0.25, -size * 0.6, 0, -size);
            g.fill({ color });
            // Noyau brillant
            if (coreColor) {
                const cs = size * 0.5;
                g.moveTo(0, -cs);
                g.bezierCurveTo(cs * 0.25, -cs * 0.5, cs * 0.35, 0, cs * 0.2, cs * 0.35);
                g.quadraticCurveTo(0, cs * 0.5, -cs * 0.2, cs * 0.35);
                g.bezierCurveTo(-cs * 0.35, 0, -cs * 0.25, -cs * 0.5, 0, -cs);
                g.fill({ color: coreColor });
            }
        };

        // ===== COUCHE 0 : Halo de chaleur (fond) =====
        const heatHalo = new PIXI.Graphics();
        effectContainer.addChild(heatHalo);

        // ===== COUCHE 1 : Anneaux d'onde de choc =====
        const rings = [];
        for (let i = 0; i < 3; i++) {
            const ring = new PIXI.Graphics();
            ring.alpha = 0;
            effectContainer.addChild(ring);
            rings.push({ gfx: ring, delay: i * 0.08 });
        }

        // ===== COUCHE 2 : Vortex de feu (flammes spirales) =====
        const vortex = [];
        const NUM_VORTEX = 28;
        const vortexPalette = [
            { outer: 0xFF2200, core: 0xFFAA00 },
            { outer: 0xFF4400, core: 0xFFCC00 },
            { outer: 0xFF6600, core: 0xFFDD44 },
            { outer: 0xFFAA00, core: 0xFFFFAA },
        ];
        for (let i = 0; i < NUM_VORTEX; i++) {
            const p = new PIXI.Graphics();
            const baseAngle = (i / NUM_VORTEX) * Math.PI * 2;
            const palette = vortexPalette[Math.floor(Math.random() * vortexPalette.length)];
            const size = 5 + Math.random() * 7;
            drawFlame(p, size, palette.outer, palette.core);
            p.alpha = 0;
            effectContainer.addChild(p);
            vortex.push({
                gfx: p, baseAngle,
                maxRadius: w * 0.5 + Math.random() * 15,
                rotSpeed: 3 + Math.random() * 4,
                riseSpeed: 50 + Math.random() * 80,
                delay: Math.random() * 0.3,
                prevX: 0, prevY: 0,
            });
        }

        // ===== COUCHE 3 : Colonne de feu ascendante =====
        const column = [];
        const NUM_COLUMN = 36;
        const columnPalette = [
            { outer: 0xFFDD00, core: 0xFFFFFF },
            { outer: 0xFFAA00, core: 0xFFEE88 },
            { outer: 0xFF6600, core: 0xFFCC00 },
            { outer: 0xFF4400, core: 0xFFAA00 },
        ];
        for (let i = 0; i < NUM_COLUMN; i++) {
            const p = new PIXI.Graphics();
            const palette = columnPalette[Math.floor(Math.random() * columnPalette.length)];
            const size = 4 + Math.random() * 8;
            drawFlame(p, size, palette.outer, palette.core);
            p.alpha = 0;
            effectContainer.addChild(p);
            column.push({
                gfx: p,
                xOffset: (Math.random() - 0.5) * w * 0.6,
                speed: 100 + Math.random() * 160,
                wobble: (Math.random() - 0.5) * 2,
                wobbleFreq: 3 + Math.random() * 5,
                delay: 0.1 + Math.random() * 0.4,
            });
        }

        // ===== COUCHE 4 : Étincelles explosives (points lumineux) =====
        const sparks = [];
        const NUM_SPARKS = 18;
        for (let i = 0; i < NUM_SPARKS; i++) {
            const s = new PIXI.Graphics();
            s.circle(0, 0, 1.5);
            s.fill({ color: 0xFFEE44 });
            s.alpha = 0;
            effectContainer.addChild(s);
            const angle = Math.random() * Math.PI * 2;
            sparks.push({
                gfx: s, angle,
                speed: 60 + Math.random() * 140,
                gravity: 80 + Math.random() * 60,
                delay: 0.3 + Math.random() * 0.1,
            });
        }

        // ===== COUCHE 5 : Flash d'ignition =====
        const flash = new PIXI.Graphics();
        flash.circle(0, 0, 8);
        flash.fill({ color: 0xFFFFFF });
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // ===== COUCHE 6 : Braises finales (petites flammes) =====
        const embers = [];
        const NUM_EMBERS = 14;
        for (let i = 0; i < NUM_EMBERS; i++) {
            const e = new PIXI.Graphics();
            const size = 3 + Math.random() * 4;
            const c = Math.random() > 0.5 ? 0xFF6600 : 0xFFAA00;
            drawFlame(e, size, c, 0xFFDD44);
            e.alpha = 0;
            effectContainer.addChild(e);
            embers.push({
                gfx: e,
                x: (Math.random() - 0.5) * w * 0.8,
                y: (Math.random() - 0.5) * h * 0.3,
                driftX: (Math.random() - 0.5) * 40,
                driftY: -(20 + Math.random() * 50),
                delay: 0.6 + Math.random() * 0.2,
            });
        }

        // ===== COUCHE 7 : Texte "+X ATK" =====
        const text = new PIXI.Text({
            text: `+${boost} ATK`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 40,
                fontWeight: 'bold',
                fill: 0xFFDD00,
                stroke: { color: 0x331100, width: 6 },
                dropShadow: {
                    color: 0xFF4400,
                    blur: 12,
                    distance: 0,
                },
            }
        });
        text.anchor.set(0.5);
        text.alpha = 0;
        text.scale.set(0);
        effectContainer.addChild(text);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);
            const t = elapsed / 1000;

            // ── Phase 1 : IGNITION (0 → 0.15) ──
            if (progress < 0.15) {
                const ip = progress / 0.15;
                flash.scale.set(1 + ip * 8);
                flash.alpha = (1 - ip) * 0.9;
                if (ip < 0.5) {
                    effectContainer.x = x + (Math.random() - 0.5) * 4;
                    effectContainer.y = y + (Math.random() - 0.5) * 4;
                } else {
                    effectContainer.x = x;
                    effectContainer.y = y;
                }
            } else {
                flash.alpha = 0;
                effectContainer.x = x;
                effectContainer.y = y;
            }

            // ── Halo de chaleur (0.05 → 0.75) ──
            if (progress > 0.05 && progress < 0.75) {
                const hp = (progress - 0.05) / 0.7;
                const fadeIn = Math.min(hp / 0.2, 1);
                const fadeOut = hp > 0.7 ? 1 - (hp - 0.7) / 0.3 : 1;
                const pulse = 1 + Math.sin(t * 10) * 0.15;
                heatHalo.clear();
                const radius = (w * 0.6 + 10) * pulse;
                heatHalo.circle(0, 0, radius);
                heatHalo.fill({ color: 0xFF4400, alpha: 0.12 * fadeIn * fadeOut });
                heatHalo.circle(0, 0, radius * 0.6);
                heatHalo.fill({ color: 0xFF6600, alpha: 0.08 * fadeIn * fadeOut });
            } else {
                heatHalo.clear();
            }

            // ── Anneaux d'onde de choc (0 → 0.35) ──
            for (const r of rings) {
                const rp = Math.max(0, progress - r.delay) / 0.3;
                if (rp <= 0 || rp >= 1) { r.gfx.alpha = 0; continue; }
                const radius = rp * Math.max(w, h) * 0.9;
                r.gfx.clear();
                r.gfx.circle(0, 0, radius);
                r.gfx.stroke({ color: 0xFF6600, width: 3 * (1 - rp), alpha: 0.7 * (1 - rp) });
            }

            // ── Vortex de flammes (0.05 → 0.7) ──
            for (const v of vortex) {
                const vp = Math.max(0, progress - v.delay) / 0.55;
                if (vp <= 0 || vp >= 1) { v.gfx.alpha = 0; continue; }

                const contractPhase = Math.min(vp / 0.6, 1);
                const expandPhase = Math.max(0, (vp - 0.6) / 0.4);
                const currentRadius = expandPhase > 0
                    ? v.maxRadius * 0.3 + expandPhase * v.maxRadius
                    : v.maxRadius * (1 - contractPhase * 0.7);
                const angle = v.baseAngle + t * v.rotSpeed;

                const newX = Math.cos(angle) * currentRadius;
                const newY = Math.sin(angle) * currentRadius - vp * v.riseSpeed * 0.3;

                // Orienter la flamme dans la direction du mouvement
                const dx = newX - v.prevX;
                const dy = newY - v.prevY;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    v.gfx.rotation = Math.atan2(dy, dx) + Math.PI / 2;
                }
                v.prevX = newX;
                v.prevY = newY;

                v.gfx.x = newX;
                v.gfx.y = newY;

                const fadeIn = Math.min(vp / 0.15, 1);
                const fadeOut = vp > 0.75 ? 1 - (vp - 0.75) / 0.25 : 1;
                v.gfx.alpha = fadeIn * fadeOut * 0.85;
                v.gfx.scale.set(1 + (1 - fadeOut) * 0.5);
            }

            // ── Colonne de flammes ascendantes (0.15 → 0.85) ──
            for (const c of column) {
                const cp = Math.max(0, progress - c.delay) / 0.5;
                if (cp <= 0 || cp >= 1) { c.gfx.alpha = 0; continue; }

                const wobbleX = Math.sin(t * c.wobbleFreq) * c.wobble * 8;
                c.gfx.x = c.xOffset + wobbleX;
                c.gfx.y = h * 0.3 - cp * c.speed;
                // Flammes pointent vers le haut (rotation 0), léger vacillement
                c.gfx.rotation = Math.sin(t * c.wobbleFreq * 2) * 0.2;

                const fadeIn = Math.min(cp / 0.1, 1);
                const fadeOut = cp > 0.6 ? 1 - (cp - 0.6) / 0.4 : 1;
                c.gfx.alpha = fadeIn * fadeOut * 0.9;
                const shrink = 1 - cp * 0.6;
                c.gfx.scale.set(Math.max(0.2, shrink));
            }

            // ── Étincelles explosives (0.3 → 0.6) ──
            for (const s of sparks) {
                const sp = Math.max(0, progress - s.delay) / 0.3;
                if (sp <= 0 || sp >= 1) { s.gfx.alpha = 0; continue; }
                s.gfx.x = Math.cos(s.angle) * sp * s.speed;
                s.gfx.y = Math.sin(s.angle) * sp * s.speed + sp * sp * s.gravity;
                s.gfx.alpha = (1 - sp) * 0.95;
            }

            // ── Texte "+X ATK" (0.35 → 0.9) ──
            if (progress > 0.35 && progress < 0.9) {
                const tp = (progress - 0.35) / 0.55;
                if (tp < 0.12) {
                    const slam = tp / 0.12;
                    const bounce = 1 + (1 - slam) * 1.5;
                    text.scale.set(bounce);
                    text.alpha = slam;
                    text.y = -5;
                    if (slam > 0.7) text.x = (Math.random() - 0.5) * 3;
                } else if (tp < 0.6) {
                    text.x = 0;
                    const pulseT = (tp - 0.12) / 0.48;
                    const pulse = 1 + Math.sin(pulseT * Math.PI * 4) * 0.06;
                    text.scale.set(1.1 * pulse);
                    text.alpha = 1;
                    text.y = -5;
                } else {
                    const fadeP = (tp - 0.6) / 0.4;
                    text.y = -5 - fadeP * 55;
                    text.alpha = 1 - fadeP * fadeP;
                    text.scale.set(1.1 - fadeP * 0.2);
                }
            } else if (progress >= 0.9) {
                text.alpha = 0;
            }

            // ── Braises finales (0.6 → 1.0) ──
            for (const e of embers) {
                const ep = Math.max(0, progress - e.delay) / (1 - e.delay);
                if (ep <= 0 || ep >= 1) { e.gfx.alpha = 0; continue; }
                e.gfx.x = e.x + e.driftX * ep;
                e.gfx.y = e.y + e.driftY * ep;
                // Flammes braises pointent vers le haut
                e.gfx.rotation = Math.sin(t * 12 + e.x) * 0.15;
                const fadeIn = Math.min(ep / 0.15, 1);
                const fadeOut = ep > 0.5 ? 1 - (ep - 0.5) / 0.5 : 1;
                e.gfx.alpha = fadeIn * fadeOut * 0.7;
                e.gfx.alpha *= 0.7 + Math.sin(t * 15 + e.x) * 0.3;
            }

            if (progress >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);
        this.screenShake(5, 150);

        return effect;
    }

    // ==================== EFFET DE CLASH ÉPIQUE (ENTRECHOC PRO) ====================

    /**
     * Effet de clash épique qualité AAA - inspiré Magic Arena / Hearthstone
     * Phases: Flash d'impact → Shockwave multi-couches → Éclairs électriques ramifiés
     *         → Fumée/poussière volumétrique → Débris métalliques → Dissipation
     */
    createClashEffect(x, y) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1400,
        };

        // === PALETTE DE COULEURS ===
        const white = 0xFFFFFF;
        const hotWhite = 0xFFFAF0;
        const electricBlue = 0x44CCFF;
        const electricCyan = 0x00EEFF;
        const gold = 0xFFCC00;
        const hotOrange = 0xFF8800;
        const impactRed = 0xFF4422;
        const smokeGrey = 0x666677;
        const dustBrown = 0x998866;

        // ============================
        // COUCHE 1 : NOYAU CENTRAL (compression → explosion)
        // ============================
        const coreGlow = new PIXI.Graphics();
        effectContainer.addChild(coreGlow);

        // Orbe d'impact incandescent
        const impactOrb = new PIXI.Graphics();
        effectContainer.addChild(impactOrb);

        // ============================
        // COUCHE 2 : ONDES DE CHOC (5 vagues transparentes, couleur unique)
        // ============================
        const shockwaves = [];
        const shockColor = 0xFFFFFF;
        const waveConfigs = [
            { delay: 0,    maxRadius: 280, thickness: 22, baseAlpha: 0.45, fadeSpeed: 1.2 },
            { delay: 0.03, maxRadius: 250, thickness: 16, baseAlpha: 0.35, fadeSpeed: 1.0 },
            { delay: 0.08, maxRadius: 320, thickness: 12, baseAlpha: 0.28, fadeSpeed: 0.9 },
            { delay: 0.14, maxRadius: 360, thickness: 8,  baseAlpha: 0.20, fadeSpeed: 0.8 },
            { delay: 0.22, maxRadius: 400, thickness: 5,  baseAlpha: 0.14, fadeSpeed: 0.7 },
        ];
        for (const cfg of waveConfigs) {
            const wave = new PIXI.Graphics();
            wave.waveData = cfg;
            effectContainer.addChild(wave);
            shockwaves.push(wave);
        }

        // ============================
        // COUCHE 3 : ÉCLAIRS ÉLECTRIQUES RAMIFIÉS (8 branches principales)
        // ============================
        const lightningBolts = [];
        for (let i = 0; i < 8; i++) {
            const bolt = new PIXI.Graphics();
            const baseAngle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            bolt.boltData = {
                angle: baseAngle,
                length: 120 + Math.random() * 100,
                segments: 6 + Math.floor(Math.random() * 4),
                thickness: 2 + Math.random() * 2,
                branches: Math.floor(Math.random() * 3),
                flickerSeed: Math.random() * 1000,
            };
            effectContainer.addChild(bolt);
            lightningBolts.push(bolt);
        }

        // ============================
        // COUCHE 4 : ÉTINCELLES EXPLOSIVES (hot sparks, 20 particules)
        // ============================
        const sparks = [];
        for (let i = 0; i < 20; i++) {
            const spark = new PIXI.Graphics();
            const angle = Math.random() * Math.PI * 2;
            const isHot = Math.random() > 0.4;
            const size = isHot ? (1.5 + Math.random() * 3) : (3 + Math.random() * 5);
            spark.circle(0, 0, size);
            spark.fill({ color: isHot ? white : [electricCyan, gold, hotOrange, impactRed][Math.floor(Math.random() * 4)] });
            spark.alpha = 0;
            spark.sparkData = {
                angle,
                speed: 200 + Math.random() * 350,
                deceleration: 0.92 + Math.random() * 0.05,
                gravity: 80 + Math.random() * 120,
                rotSpeed: (Math.random() - 0.5) * 15,
                life: 0.4 + Math.random() * 0.5,
                isHot,
                trailLength: isHot ? 3 : 0,
            };
            effectContainer.addChild(spark);
            sparks.push(spark);
        }

        // ============================
        // COUCHE 5 : FUMÉE / POUSSIÈRE VOLUMÉTRIQUE (8 nuages)
        // ============================
        const smokeClouds = [];
        for (let i = 0; i < 8; i++) {
            const cloud = new PIXI.Graphics();
            const angle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const baseRadius = 20 + Math.random() * 15;
            // Dessiner un nuage composé de plusieurs cercles superposés
            const color = Math.random() > 0.5 ? smokeGrey : dustBrown;
            for (let c = 0; c < 3; c++) {
                const ox = (Math.random() - 0.5) * baseRadius * 0.6;
                const oy = (Math.random() - 0.5) * baseRadius * 0.4;
                cloud.circle(ox, oy, baseRadius * (0.6 + Math.random() * 0.4));
                cloud.fill({ color, alpha: 0.3 });
            }
            cloud.alpha = 0;
            cloud.smokeData = {
                angle,
                speed: 60 + Math.random() * 100,
                riseSpeed: -20 - Math.random() * 40,
                expandRate: 1 + Math.random() * 0.8,
                rotSpeed: (Math.random() - 0.5) * 2,
                delay: 0.05 + Math.random() * 0.15,
                life: 0.6 + Math.random() * 0.3,
            };
            effectContainer.addChild(cloud);
            smokeClouds.push(cloud);
        }

        // ============================
        // COUCHE 6 : DÉBRIS MÉTALLIQUES (12 fragments)
        // ============================
        const debris = [];
        for (let i = 0; i < 12; i++) {
            const particle = new PIXI.Graphics();
            const w = 3 + Math.random() * 10;
            const h = 2 + Math.random() * 5;
            // Forme irrégulière (pas un simple rect)
            particle.moveTo(-w/2, -h/2);
            particle.lineTo(w/2 * (0.6 + Math.random() * 0.4), -h/2 * (0.5 + Math.random() * 0.5));
            particle.lineTo(w/2, h/2 * (0.7 + Math.random() * 0.3));
            particle.lineTo(-w/2 * (0.5 + Math.random() * 0.5), h/2);
            particle.closePath();
            const debrisColors = [0x999999, 0xBBBBBB, 0x777788, 0xAA9988];
            particle.fill({ color: debrisColors[i % debrisColors.length] });
            particle.alpha = 0;
            particle.debrisData = {
                angle: Math.random() * Math.PI * 2,
                speed: 100 + Math.random() * 250,
                rotSpeed: (Math.random() - 0.5) * 20,
                gravity: 300 + Math.random() * 200,
                bounce: Math.random() > 0.7,
                size: w,
            };
            effectContainer.addChild(particle);
            debris.push(particle);
        }

        // ============================
        // COUCHE 7 : LIGNES DE VITESSE / IMPACT LINES (rayons radiaux)
        // ============================
        const speedLines = new PIXI.Graphics();
        effectContainer.addChild(speedLines);

        // ============================
        // ANIMATION PRINCIPALE
        // ============================
        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // ─── TIMING MAP ───
            // 0.00 - 0.05 : Compression noyau
            // 0.05 - 0.12 : Explosion noyau + début shockwaves
            // 0.12 - 0.35 : Shockwaves + éclairs + speed lines
            // 0.15 - 0.60 : Étincelles + débris
            // 0.20 - 0.80 : Fumée volumétrique
            // 0.60 - 1.00 : Dissipation finale

            // ── NOYAU CENTRAL ──
            coreGlow.clear();
            impactOrb.clear();
            if (progress < 0.05) {
                // Compression - aspiration d'énergie
                const p = progress / 0.05;
                const radius = 40 * (1 - p * 0.6);
                coreGlow.circle(0, 0, radius);
                coreGlow.fill({ color: white, alpha: p * 0.8 });
                // Halo cyan qui se contracte
                coreGlow.circle(0, 0, radius * 2);
                coreGlow.fill({ color: electricBlue, alpha: p * 0.3 });
            } else if (progress < 0.15) {
                // Explosion du noyau
                const p = (progress - 0.05) / 0.10;
                const radius = 16 + p * 60;
                const alpha = (1 - p) * 1.0;
                // Orbe incandescent
                impactOrb.circle(0, 0, radius * 0.4);
                impactOrb.fill({ color: hotWhite, alpha: alpha });
                // Halo chaud
                impactOrb.circle(0, 0, radius * 0.7);
                impactOrb.fill({ color: gold, alpha: alpha * 0.6 });
                // Couronne externe
                impactOrb.circle(0, 0, radius);
                impactOrb.fill({ color: hotOrange, alpha: alpha * 0.3 });
            } else if (progress < 0.40) {
                // Noyau résiduel pulsant
                const p = (progress - 0.15) / 0.25;
                const pulse = 1 + Math.sin(p * Math.PI * 6) * 0.4 * (1 - p);
                const radius = 20 * (1 - p) * pulse;
                if (radius > 1) {
                    coreGlow.circle(0, 0, radius);
                    coreGlow.fill({ color: electricCyan, alpha: (1 - p) * 0.6 });
                    coreGlow.circle(0, 0, radius * 1.8);
                    coreGlow.fill({ color: electricBlue, alpha: (1 - p) * 0.15 });
                }
            }

            // ── ONDES DE CHOC (transparentes, couleur unique) ──
            shockwaves.forEach(wave => {
                wave.clear();
                const d = wave.waveData;
                const wStart = 0.05 + d.delay;
                const wDuration = 0.50;
                const wp = (progress - wStart) / wDuration;

                if (wp > 0 && wp < 1) {
                    // Ease-out pour expansion naturelle
                    const easedWp = 1 - Math.pow(1 - wp, 2.5);
                    const radius = easedWp * d.maxRadius;
                    const thickness = d.thickness * (1 - wp * 0.8);
                    const alpha = (1 - Math.pow(wp, d.fadeSpeed)) * d.baseAlpha;

                    // Onde principale
                    wave.circle(0, 0, radius);
                    wave.stroke({ width: thickness, color: shockColor, alpha });

                    // Onde fantôme interne (plus fine, même couleur)
                    if (wp > 0.05 && wp < 0.7) {
                        wave.circle(0, 0, radius * 0.88);
                        wave.stroke({ width: thickness * 0.3, color: shockColor, alpha: alpha * 0.5 });
                    }
                }
            });

            // ── SPEED LINES (lignes radiales d'impact) ──
            speedLines.clear();
            if (progress > 0.04 && progress < 0.25) {
                const sp = (progress - 0.04) / 0.21;
                const alpha = sp < 0.3 ? sp / 0.3 : (1 - (sp - 0.3) / 0.7);
                for (let i = 0; i < 16; i++) {
                    const angle = (i / 16) * Math.PI * 2 + Math.sin(i * 7.3) * 0.2;
                    const innerR = 30 + sp * 80;
                    const outerR = innerR + 40 + sp * 120;
                    const thickness = (1.5 + Math.sin(i * 3.7) * 1) * (1 - sp * 0.5);
                    speedLines.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
                    speedLines.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
                    speedLines.stroke({ width: thickness, color: white, alpha: alpha * (0.3 + Math.sin(i * 2.1) * 0.15) });
                }
            }

            // ── ÉCLAIRS ÉLECTRIQUES RAMIFIÉS ──
            lightningBolts.forEach(bolt => {
                bolt.clear();
                const d = bolt.boltData;

                if (progress > 0.06 && progress < 0.55) {
                    const bp = (progress - 0.06) / 0.49;
                    // Flicker : les éclairs clignotent
                    const flickerTime = performance.now() * 0.03 + d.flickerSeed;
                    const flickerAlpha = 0.5 + Math.sin(flickerTime) * 0.3 + Math.sin(flickerTime * 2.7) * 0.2;
                    const alpha = (bp < 0.2 ? bp / 0.2 : Math.max(0, 1 - (bp - 0.2) / 0.8)) * flickerAlpha;

                    if (alpha > 0.05) {
                        const currentLength = d.length * Math.min(1, bp * 3);
                        // Branche principale
                        this._drawLightningBranch(bolt, 0, 0, d.angle, currentLength, d.segments, d.thickness, electricCyan, alpha);
                        // Glow
                        this._drawLightningBranch(bolt, 0, 0, d.angle, currentLength, d.segments, d.thickness * 3, electricBlue, alpha * 0.2);
                        // Sous-branches
                        if (d.branches > 0 && bp > 0.1) {
                            for (let b = 0; b < d.branches; b++) {
                                const branchStart = (0.3 + b * 0.25) * currentLength;
                                const bx = Math.cos(d.angle) * branchStart;
                                const by = Math.sin(d.angle) * branchStart;
                                const branchAngle = d.angle + (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.6);
                                const branchLen = currentLength * (0.2 + Math.random() * 0.3);
                                this._drawLightningBranch(bolt, bx, by, branchAngle, branchLen, 3, d.thickness * 0.6, electricCyan, alpha * 0.6);
                            }
                        }
                    }
                }
            });

            // ── ÉTINCELLES ──
            sparks.forEach(spark => {
                const d = spark.sparkData;
                const sparkStart = 0.05;
                if (progress > sparkStart && progress < sparkStart + d.life) {
                    const sp = (progress - sparkStart) / d.life;
                    // Vitesse avec décélération
                    const t = sp;
                    const decayFactor = (1 - Math.pow(d.deceleration, t * 60)) / (1 - d.deceleration);
                    const dist = d.speed * t * Math.pow(d.deceleration, t * 30);
                    spark.x = Math.cos(d.angle) * dist;
                    spark.y = Math.sin(d.angle) * dist + d.gravity * t * t;
                    spark.alpha = sp < 0.1 ? sp / 0.1 : Math.max(0, 1 - Math.pow((sp - 0.1) / 0.9, 0.5));
                    spark.scale.set(Math.max(0.05, 1 - sp * 0.7));
                    spark.rotation += d.rotSpeed * 0.016;
                } else if (progress >= sparkStart + d.life) {
                    spark.alpha = 0;
                }
            });

            // ── FUMÉE / POUSSIÈRE ──
            smokeClouds.forEach(cloud => {
                const d = cloud.smokeData;
                const smokeStart = 0.10 + d.delay;
                if (progress > smokeStart && progress < smokeStart + d.life) {
                    const sp = (progress - smokeStart) / d.life;
                    const dist = d.speed * sp;
                    cloud.x = Math.cos(d.angle) * dist;
                    cloud.y = Math.sin(d.angle) * dist + d.riseSpeed * sp;
                    // Grossit en se dissipant
                    cloud.scale.set(0.3 + sp * d.expandRate);
                    // Fade: apparition rapide, disparition lente
                    cloud.alpha = sp < 0.15 ? (sp / 0.15) * 0.5 : 0.5 * Math.max(0, 1 - Math.pow((sp - 0.15) / 0.85, 0.6));
                    cloud.rotation += d.rotSpeed * 0.016;
                } else if (progress >= smokeStart + d.life) {
                    cloud.alpha = 0;
                }
            });

            // ── DÉBRIS ──
            debris.forEach(particle => {
                const d = particle.debrisData;
                const debrisStart = 0.06;
                if (progress > debrisStart) {
                    const dp = (progress - debrisStart) / (1 - debrisStart);
                    if (dp < 1) {
                        const t = dp;
                        particle.x = Math.cos(d.angle) * d.speed * t;
                        particle.y = Math.sin(d.angle) * d.speed * t + 0.5 * d.gravity * t * t;
                        particle.alpha = dp < 0.05 ? dp / 0.05 : Math.max(0, 1 - Math.pow((dp - 0.05) / 0.95, 0.7));
                        particle.rotation += d.rotSpeed * 0.016;
                        particle.scale.set(Math.max(0.2, 1 - dp * 0.5));
                    } else {
                        particle.alpha = 0;
                    }
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

        // Screen shake INTENSE en 2 phases
        this.screenShake(22, 350);
        // Deuxième secousse plus lourde et sourde après 150ms
        setTimeout(() => this.screenShake(10, 200), 150);

        return effect;
    }

    /**
     * Dessine une branche d'éclair avec zigzag aléatoire
     */
    _drawLightningBranch(graphics, startX, startY, angle, length, segments, thickness, color, alpha) {
        if (length < 2 || alpha < 0.02) return;
        graphics.moveTo(startX, startY);
        let cx = startX, cy = startY;
        const segLen = length / segments;
        for (let s = 0; s < segments; s++) {
            const nx = cx + Math.cos(angle) * segLen;
            const ny = cy + Math.sin(angle) * segLen;
            const perpAngle = angle + Math.PI / 2;
            const jitter = (Math.random() - 0.5) * segLen * 0.8;
            const mx = (cx + nx) / 2 + Math.cos(perpAngle) * jitter;
            const my = (cy + ny) / 2 + Math.sin(perpAngle) * jitter;
            graphics.lineTo(mx, my);
            graphics.lineTo(nx, ny);
            cx = nx;
            cy = ny;
        }
        graphics.stroke({ width: thickness, color, alpha });
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

    // ==================== PROJECTILE MAGIQUE ====================

    /**
     * Orbe d'énergie magique qui vole du tireur vers la cible.
     * Style Magic Arena : noyau lumineux, sillage fluide, particules d'énergie.
     * Retourne une Promise résolue à l'arrivée.
     */
    animateProjectile(fromX, fromY, toX, toY, duration = 400) {
        if (!this.initialized) return Promise.resolve();

        const effectContainer = new PIXI.Container();
        this.container.addChild(effectContainer);

        const dx = toX - fromX, dy = toY - fromY;
        const angle = Math.atan2(dy, dx);
        const perpX = -Math.sin(angle), perpY = Math.cos(angle);

        // ===== Couches de traînée (dessinées en continu) =====
        const trailOuter = new PIXI.Graphics();
        const trailMid = new PIXI.Graphics();
        const trailCore = new PIXI.Graphics();
        effectContainer.addChild(trailOuter);
        effectContainer.addChild(trailMid);
        effectContainer.addChild(trailCore);

        // ===== Orbe (noyau du projectile) =====
        const orb = new PIXI.Container();
        effectContainer.addChild(orb);

        // Halo externe diffus
        const halo = new PIXI.Graphics();
        halo.circle(0, 0, 16);
        halo.fill({ color: 0x0066CC, alpha: 0.12 });
        orb.addChild(halo);

        // Lueur moyenne
        const midGlow = new PIXI.Graphics();
        midGlow.circle(0, 0, 9);
        midGlow.fill({ color: 0x00AAEE, alpha: 0.3 });
        orb.addChild(midGlow);

        // Noyau brillant
        const core = new PIXI.Graphics();
        core.circle(0, 0, 4.5);
        core.fill({ color: 0x88EEFF, alpha: 0.85 });
        core.circle(0, 0, 2.5);
        core.fill({ color: 0xFFFFFF, alpha: 0.95 });
        orb.addChild(core);

        // ===== Historique de positions pour le sillage =====
        const trail = []; // { x, y, time }
        const trailLife = 150; // durée de vie du sillage en ms

        // ===== Particules d'énergie =====
        const particles = [];
        let lastParticleTime = 0;
        const particleRate = 14; // ms entre chaque particule

        // ===== Filaments d'énergie (2 rubans qui ondulent autour de la trajectoire) =====
        const filaments = [
            { phase: 0, amp: 5, freq: 12, color: 0x44CCFF },
            { phase: Math.PI, amp: 4, freq: 14, color: 0x0088DD },
        ];
        for (const f of filaments) {
            f.gfx = new PIXI.Graphics();
            effectContainer.addChild(f.gfx);
        }
        // Remettre l'orbe au premier plan
        effectContainer.addChild(orb);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: duration + trailLife,
        };

        return new Promise(resolve => {
            const startTime = performance.now();
            let arrived = false;

            const animate = () => {
                const now = performance.now();
                const elapsed = now - startTime;
                const fp = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - fp, 3);

                const cx = fromX + dx * eased;
                const cy = fromY + dy * eased;

                // --- Orbe en vol ---
                if (fp < 1) {
                    orb.position.set(cx, cy);
                    orb.alpha = 1;

                    // Pulsation du noyau
                    const pulse = 1 + Math.sin(fp * Math.PI * 10) * 0.15;
                    core.scale.set(pulse);
                    midGlow.scale.set(1 + Math.sin(fp * Math.PI * 7) * 0.1);
                    halo.scale.set(1 + Math.sin(fp * Math.PI * 5) * 0.08);

                    // Enregistrer la position
                    trail.push({ x: cx, y: cy, time: now });

                    // Spawner des particules
                    if (now - lastParticleTime > particleRate) {
                        const gfx = new PIXI.Graphics();
                        // Particule = petit disque lumineux
                        const r = 1 + Math.random() * 2;
                        gfx.circle(0, 0, r);
                        gfx.fill({ color: Math.random() > 0.3 ? 0x66DDFF : 0xFFFFFF, alpha: 0.7 });
                        // Position : derrière l'orbe avec dispersion latérale
                        const back = 6 + Math.random() * 10;
                        const lateral = (Math.random() - 0.5) * 10;
                        gfx.position.set(
                            cx - Math.cos(angle) * back + perpX * lateral,
                            cy - Math.sin(angle) * back + perpY * lateral
                        );
                        effectContainer.addChild(gfx);
                        // Vélocité : légère dérive vers l'arrière + dispersion
                        particles.push({
                            gfx, born: now,
                            life: 120 + Math.random() * 100,
                            vx: -Math.cos(angle) * (15 + Math.random() * 20) + (Math.random() - 0.5) * 30,
                            vy: -Math.sin(angle) * (15 + Math.random() * 20) + (Math.random() - 0.5) * 30,
                        });
                        lastParticleTime = now;
                    }
                } else if (!arrived) {
                    arrived = true;
                    orb.alpha = 0;
                    resolve();
                }

                // --- Nettoyer le sillage ---
                while (trail.length > 0 && now - trail[0].time > trailLife) {
                    trail.shift();
                }

                // --- Dessiner le sillage (3 couches : large diffuse → fine brillante) ---
                trailOuter.clear();
                trailMid.clear();
                trailCore.clear();

                if (trail.length >= 2) {
                    const layers = [
                        { gfx: trailOuter, maxW: 10, color: 0x004488, alphaScale: 0.08 },
                        { gfx: trailMid,   maxW: 5,  color: 0x0099DD, alphaScale: 0.25 },
                        { gfx: trailCore,  maxW: 2,  color: 0x88EEFF, alphaScale: 0.5  },
                    ];

                    for (const layer of layers) {
                        for (let i = 1; i < trail.length; i++) {
                            const age = (now - trail[i].time) / trailLife;
                            const freshness = 1 - age;
                            const w = layer.maxW * freshness;
                            const a = layer.alphaScale * freshness;
                            if (w < 0.3) continue;
                            layer.gfx.moveTo(trail[i - 1].x, trail[i - 1].y);
                            layer.gfx.lineTo(trail[i].x, trail[i].y);
                            layer.gfx.stroke({ color: layer.color, width: w, alpha: a, cap: 'round' });
                        }
                    }
                }

                // --- Filaments d'énergie ---
                for (const f of filaments) {
                    f.gfx.clear();
                    if (trail.length < 3) continue;
                    // Dessiner le filament le long des derniers points du sillage
                    const count = Math.min(trail.length, 20);
                    const startIdx = trail.length - count;
                    let first = true;
                    for (let i = startIdx; i < trail.length; i++) {
                        const age = (now - trail[i].time) / trailLife;
                        const freshness = 1 - age;
                        const t = (i - startIdx) / count;
                        // Ondulation sinusoïdale autour de la trajectoire
                        const wave = Math.sin(t * f.freq + fp * 30 + f.phase) * f.amp * freshness;
                        const px = trail[i].x + perpX * wave;
                        const py = trail[i].y + perpY * wave;
                        if (first) { f.gfx.moveTo(px, py); first = false; }
                        else { f.gfx.lineTo(px, py); }
                    }
                    f.gfx.stroke({ color: f.color, width: 1.2, alpha: 0.3 });
                }

                // --- Particules : drift + fade ---
                for (let i = particles.length - 1; i >= 0; i--) {
                    const p = particles[i];
                    const age = (now - p.born) / p.life;
                    if (age >= 1) {
                        p.gfx.destroy();
                        particles.splice(i, 1);
                    } else {
                        const dt = 1 / 60; // approximation
                        p.gfx.position.x += p.vx * dt;
                        p.gfx.position.y += p.vy * dt;
                        // Décélération
                        p.vx *= 0.96;
                        p.vy *= 0.96;
                        p.gfx.alpha = (1 - age * age) * 0.6;
                        p.gfx.scale.set(1 - age * 0.4);
                    }
                }

                // Terminé ?
                if (arrived && trail.length === 0 && particles.length === 0) {
                    effect.finished = true;
                } else {
                    requestAnimationFrame(animate);
                }
            };

            this.activeEffects.push(effect);
            requestAnimationFrame(animate);
        });
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
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.activeEffects.push(effect);

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

    // ==================== SACRIFICE BLOOD SLASH ====================

    createSacrificeSlashEffect(x, y, w, h) {
        if (!this.initialized) return;

        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 900,
        };

        const bloodRed = 0xCC0000;
        const darkRed = 0x880000;
        const crimson = 0xFF1A1A;
        const shadowPurple = 0x3D0022;
        const cardW = w * 0.5;
        const cardH = h * 0.5;

        // Fond sombre — assombrit la zone de la carte
        const darkOverlay = new PIXI.Graphics();
        darkOverlay.rect(-cardW, -cardH, cardW * 2, cardH * 2);
        darkOverlay.fill({ color: 0x000000, alpha: 0.0 });
        effectContainer.addChild(darkOverlay);

        // Grand X slash — deux traits croisés
        const slash1 = new PIXI.Graphics();
        const slash2 = new PIXI.Graphics();
        effectContainer.addChild(slash1);
        effectContainer.addChild(slash2);

        // Éclats de sang (particules)
        const bloodParticles = [];
        for (let i = 0; i < 24; i++) {
            const p = new PIXI.Graphics();
            const size = 1.5 + Math.random() * 4;
            p.circle(0, 0, size);
            const colors = [bloodRed, darkRed, crimson, 0xAA0000];
            p.fill({ color: colors[i % colors.length] });
            p.alpha = 0;
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 140;
            p.bloodData = {
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: 180 + Math.random() * 100,
                delay: 0.15 + Math.random() * 0.15,
                size: size,
            };
            effectContainer.addChild(p);
            bloodParticles.push(p);
        }

        // Gouttelettes qui tombent (post-slash)
        const drips = [];
        for (let i = 0; i < 8; i++) {
            const drip = new PIXI.Graphics();
            drip.rect(-1.5, 0, 3, 6 + Math.random() * 10);
            drip.fill({ color: bloodRed, alpha: 0.8 });
            drip.alpha = 0;
            drip.dripData = {
                startX: (Math.random() - 0.5) * cardW * 1.4,
                startY: (Math.random() - 0.3) * cardH * 0.8,
                speed: 40 + Math.random() * 80,
                delay: 0.3 + Math.random() * 0.2,
            };
            effectContainer.addChild(drip);
            drips.push(drip);
        }

        // Aura démoniaque sombre (derrière tout)
        const demonAura = new PIXI.Graphics();
        effectContainer.addChildAt(demonAura, 0);

        // Flash d'impact central
        const impactFlash = new PIXI.Graphics();
        impactFlash.alpha = 0;
        effectContainer.addChild(impactFlash);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // === Phase 1 : Aura sombre (0→0.3) ===
            demonAura.clear();
            if (progress < 0.5) {
                const ap = Math.min(progress / 0.2, 1);
                const auraR = cardW * 1.2 + ap * 20;
                const auraAlpha = ap * 0.35 * (progress < 0.35 ? 1 : (1 - (progress - 0.35) / 0.15));
                demonAura.circle(0, 0, auraR);
                demonAura.fill({ color: shadowPurple, alpha: Math.max(0, auraAlpha) });
            }

            // === Fond sombre (flash) ===
            darkOverlay.clear();
            if (progress > 0.1 && progress < 0.5) {
                const dp = (progress - 0.1) / 0.15;
                const darkAlpha = dp < 1 ? dp * 0.4 : 0.4 * (1 - (progress - 0.25) / 0.25);
                darkOverlay.rect(-cardW, -cardH, cardW * 2, cardH * 2);
                darkOverlay.fill({ color: 0x000000, alpha: Math.max(0, darkAlpha) });
            }

            // === Phase 2 : Les deux slashs en X (0.12→0.5) ===
            // Slash 1 : haut-gauche → bas-droite
            slash1.clear();
            const s1Start = 0.12;
            const s1End = 0.35;
            if (progress > s1Start) {
                const sp = Math.min((progress - s1Start) / (s1End - s1Start), 1);
                const drawLen = sp;
                const fadeAlpha = progress < 0.6 ? 1 : Math.max(0, 1 - (progress - 0.6) / 0.3);

                // Trait principal (large, doux)
                const x1 = -cardW * 0.7, y1 = -cardH * 0.7;
                const x2 = cardW * 0.7, y2 = cardH * 0.7;
                const mx = x1 + (x2 - x1) * drawLen;
                const my = y1 + (y2 - y1) * drawLen;

                slash1.moveTo(x1, y1);
                slash1.lineTo(mx, my);
                slash1.stroke({ color: crimson, width: 10, alpha: fadeAlpha * 0.4 });

                slash1.moveTo(x1, y1);
                slash1.lineTo(mx, my);
                slash1.stroke({ color: 0xFF3333, width: 5, alpha: fadeAlpha * 0.8 });

                slash1.moveTo(x1, y1);
                slash1.lineTo(mx, my);
                slash1.stroke({ color: 0xFFAAAA, width: 2, alpha: fadeAlpha });
            }

            // Slash 2 : haut-droite → bas-gauche (léger décalage)
            slash2.clear();
            const s2Start = 0.18;
            const s2End = 0.40;
            if (progress > s2Start) {
                const sp = Math.min((progress - s2Start) / (s2End - s2Start), 1);
                const drawLen = sp;
                const fadeAlpha = progress < 0.6 ? 1 : Math.max(0, 1 - (progress - 0.6) / 0.3);

                const x1 = cardW * 0.7, y1 = -cardH * 0.7;
                const x2 = -cardW * 0.7, y2 = cardH * 0.7;
                const mx = x1 + (x2 - x1) * drawLen;
                const my = y1 + (y2 - y1) * drawLen;

                slash2.moveTo(x1, y1);
                slash2.lineTo(mx, my);
                slash2.stroke({ color: crimson, width: 10, alpha: fadeAlpha * 0.4 });

                slash2.moveTo(x1, y1);
                slash2.lineTo(mx, my);
                slash2.stroke({ color: 0xFF3333, width: 5, alpha: fadeAlpha * 0.8 });

                slash2.moveTo(x1, y1);
                slash2.lineTo(mx, my);
                slash2.stroke({ color: 0xFFAAAA, width: 2, alpha: fadeAlpha });
            }

            // === Flash d'impact au croisement des slashs (0.25→0.45) ===
            impactFlash.clear();
            if (progress > 0.22 && progress < 0.50) {
                const fp = (progress - 0.22) / 0.28;
                const flashAlpha = fp < 0.3 ? fp / 0.3 : (1 - (fp - 0.3) / 0.7);
                const flashR = 15 + fp * 25;
                impactFlash.circle(0, 0, flashR);
                impactFlash.fill({ color: 0xFFCCCC, alpha: Math.max(0, flashAlpha * 0.7) });
                impactFlash.circle(0, 0, flashR * 0.5);
                impactFlash.fill({ color: 0xFFFFFF, alpha: Math.max(0, flashAlpha * 0.5) });
            }

            // === Particules de sang (0.15→fin) ===
            bloodParticles.forEach(p => {
                const d = p.bloodData;
                const pp = Math.max(0, (progress - d.delay) / (1 - d.delay));
                if (pp > 0 && pp < 1) {
                    const t = pp;
                    p.x = d.vx * t;
                    p.y = d.vy * t + 0.5 * d.gravity * t * t;
                    p.alpha = (1 - pp) * 0.85;
                    p.scale.set(1 - pp * 0.6);
                } else {
                    p.alpha = 0;
                }
            });

            // === Gouttelettes tombantes (0.3→fin) ===
            drips.forEach(drip => {
                const d = drip.dripData;
                const dp = Math.max(0, (progress - d.delay) / (1 - d.delay));
                if (dp > 0 && dp < 1) {
                    drip.x = d.startX;
                    drip.y = d.startY + d.speed * dp;
                    drip.alpha = (1 - dp) * 0.7;
                    drip.scale.y = 1 + dp * 0.5;
                } else {
                    drip.alpha = 0;
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

        // Screen shake
        this.screenShake(6, 180);

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

    // ==================== HERO HIT EFFECT (FLASH ROUGE + ÉTINCELLES) ====================

    createHeroHitEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 550,
        };

        const hw = w / 2, hh = h / 2;

        // Flash rouge = géré par CSS (.hero-hit::before) pour respecter la perspective 3D

        // Anneau rouge qui s'expand
        const ring = new PIXI.Graphics();
        effectContainer.addChild(ring);

        // 7 étincelles cramoisies
        const sparks = [];
        for (let i = 0; i < 7; i++) {
            const angle = (Math.PI * 2 * i / 7) + (Math.random() - 0.5) * 0.5;
            const speed = 80 + Math.random() * 60;
            const spark = new PIXI.Graphics();
            effectContainer.addChild(spark);
            sparks.push({
                gfx: spark,
                angle,
                speed,
                len: 4 + Math.random() * 4,
                color: Math.random() > 0.4 ? 0xFF1a1a : 0xFF6633,
            });
        }

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (progress >= 1) {
                effect.finished = true;
                effectContainer.parent?.removeChild(effectContainer);
                effectContainer.destroy({ children: true });
                return;
            }

            // Anneau rouge
            ring.clear();
            if (progress < 0.6) {
                const rp = progress / 0.6;
                const ringRadius = Math.max(hw, hh) + rp * 25;
                const ringAlpha = (1 - rp) * 0.5;
                ring.circle(0, 0, ringRadius);
                ring.stroke({ color: 0xFF2200, width: 1.5 * (1 - rp), alpha: ringAlpha });
            }

            // Étincelles
            sparks.forEach(s => {
                s.gfx.clear();
                if (progress < 0.7) {
                    const sp = progress / 0.7;
                    const dist = sp * s.speed;
                    const sx = Math.cos(s.angle) * dist;
                    const sy = Math.sin(s.angle) * dist;
                    const alpha = (1 - sp) * 0.9;
                    const len = s.len * (1 - sp * 0.5);
                    const dx = Math.cos(s.angle) * len;
                    const dy = Math.sin(s.angle) * len;
                    s.gfx.moveTo(sx - dx, sy - dy);
                    s.gfx.lineTo(sx + dx, sy + dy);
                    s.gfx.stroke({ color: s.color, width: 2 * (1 - sp), alpha });
                }
            });

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== SLOT HIT EFFECT (FLASH ORANGE + ONDE DE CHOC) ====================

    createSlotHitEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 500,
        };

        const hw = w / 2, hh = h / 2;

        // Flash orange = géré par CSS (.slot-hit::before) pour hériter de la perspective 3D

        // Onde de choc
        const ring = new PIXI.Graphics();
        effectContainer.addChild(ring);

        // 5 étincelles orange
        const sparks = [];
        for (let i = 0; i < 5; i++) {
            const angle = (Math.PI * 2 * i / 5) + (Math.random() - 0.5) * 0.6;
            const speed = 50 + Math.random() * 40;
            const spark = new PIXI.Graphics();
            effectContainer.addChild(spark);
            sparks.push({
                gfx: spark,
                angle,
                speed,
                color: Math.random() > 0.5 ? 0xFF8800 : 0xFFAA33,
            });
        }

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (progress >= 1) {
                effect.finished = true;
                effectContainer.parent?.removeChild(effectContainer);
                effectContainer.destroy({ children: true });
                return;
            }

            // Onde de choc
            ring.clear();
            if (progress > 0.05 && progress < 0.6) {
                const rp = (progress - 0.05) / 0.55;
                const radius = Math.max(hw, hh) * 0.6 + rp * 30;
                ring.circle(0, 0, radius);
                ring.stroke({ color: 0xFF8800, width: 1.5 * (1 - rp), alpha: (1 - rp) * 0.45 });
            }

            // Étincelles
            sparks.forEach(s => {
                s.gfx.clear();
                if (progress < 0.65) {
                    const sp = progress / 0.65;
                    const dist = sp * s.speed;
                    const sx = Math.cos(s.angle) * dist;
                    const sy = Math.sin(s.angle) * dist;
                    const alpha = (1 - sp) * 0.8;
                    s.gfx.circle(sx, sy, 1.5 * (1 - sp));
                    s.gfx.fill({ color: s.color, alpha });
                }
            });

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== HEAL EFFECT (AURA VERTE + PARTICULES MONTANTES) ====================

    createHealEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 700,
        };

        const hw = w / 2, hh = h / 2;

        // Aura verte = géré par CSS (.heal-aura::before) pour hériter de la perspective 3D

        // 10 particules lumineuses montantes
        const particles = [];
        for (let i = 0; i < 10; i++) {
            const p = new PIXI.Graphics();
            effectContainer.addChild(p);
            particles.push({
                gfx: p,
                // Démarrage dispersé dans la moitié basse de la carte
                startX: (Math.random() - 0.5) * w * 0.8,
                startY: hh * 0.3 + Math.random() * hh * 0.5,
                driftX: (Math.random() - 0.5) * 15,
                speed: 40 + Math.random() * 50,
                delay: Math.random() * 0.25,
                size: 1.5 + Math.random() * 2,
                color: Math.random() > 0.3 ? 0x2ECC71 : 0x82E0AA,
            });
        }

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (progress >= 1) {
                effect.finished = true;
                effectContainer.parent?.removeChild(effectContainer);
                effectContainer.destroy({ children: true });
                return;
            }

            // Particules montantes
            particles.forEach(p => {
                p.gfx.clear();
                const localP = Math.max(0, (progress - p.delay) / (1 - p.delay));
                if (localP > 0 && localP < 1) {
                    const px = p.startX + p.driftX * localP;
                    const py = p.startY - p.speed * localP;
                    const alpha = localP < 0.2
                        ? localP / 0.2
                        : Math.max(0, 1 - (localP - 0.2) / 0.8);
                    const size = p.size * (1 - localP * 0.4);
                    // Petit losange lumineux
                    p.gfx.moveTo(px, py - size);
                    p.gfx.lineTo(px + size * 0.6, py);
                    p.gfx.lineTo(px, py + size);
                    p.gfx.lineTo(px - size * 0.6, py);
                    p.gfx.closePath();
                    p.gfx.fill({ color: p.color, alpha: alpha * 0.8 });
                }
            });

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== LIFESTEAL (PARTICULES SANG ASPIRÉES + FLASH ROUGE) ====================

    createLifestealEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 900,
        };

        const hw = w / 2, hh = h / 2;

        // Flash central rouge sang (pulse)
        const flash = new PIXI.Graphics();
        flash.roundRect(-hw, -hh, w, h, 8);
        flash.fill({ color: 0x8B0000, alpha: 0 });
        effectContainer.addChild(flash);

        // 16 particules de sang aspirées vers le centre (viennent de l'extérieur)
        const particles = [];
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
            const dist = 60 + Math.random() * 40;
            const p = new PIXI.Graphics();
            effectContainer.addChild(p);
            particles.push({
                gfx: p,
                startX: Math.cos(angle) * dist,
                startY: Math.sin(angle) * dist,
                endX: (Math.random() - 0.5) * w * 0.3,
                endY: (Math.random() - 0.5) * h * 0.3,
                delay: Math.random() * 0.15,
                size: 2 + Math.random() * 2.5,
                color: [0xCC0000, 0x8B0000, 0xFF1A1A, 0xAA0000][i % 4],
            });
        }

        // 6 étincelles lumineuses qui convergent (plus lent, plus grand)
        const sparks = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const s = new PIXI.Graphics();
            effectContainer.addChild(s);
            sparks.push({
                gfx: s,
                startX: Math.cos(angle) * 80,
                startY: Math.sin(angle) * 80,
                delay: 0.05 + Math.random() * 0.1,
                size: 3 + Math.random() * 2,
            });
        }

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (progress >= 1) {
                effect.finished = true;
                effectContainer.parent?.removeChild(effectContainer);
                effectContainer.destroy({ children: true });
                return;
            }

            // Flash central : pulse in-out
            flash.clear();
            flash.roundRect(-hw, -hh, w, h, 8);
            if (progress < 0.3) {
                const p = progress / 0.3;
                flash.fill({ color: 0x8B0000, alpha: p * 0.25 });
            } else if (progress < 0.6) {
                flash.fill({ color: 0x8B0000, alpha: 0.25 });
            } else {
                const p = (progress - 0.6) / 0.4;
                flash.fill({ color: 0x8B0000, alpha: 0.25 * (1 - p) });
            }

            // Particules de sang : convergent vers le centre
            particles.forEach(p => {
                p.gfx.clear();
                const localP = Math.max(0, Math.min(1, (progress - p.delay) / (0.6 - p.delay)));
                if (localP > 0 && localP < 1) {
                    // Ease-in (accélération vers le centre, comme une aspiration)
                    const eased = localP * localP;
                    const px = p.startX + (p.endX - p.startX) * eased;
                    const py = p.startY + (p.endY - p.startY) * eased;
                    // Alpha : apparition rapide, maintien, disparition au centre
                    const alpha = localP < 0.15 ? localP / 0.15
                        : localP > 0.85 ? (1 - localP) / 0.15
                        : 1;
                    const size = p.size * (1.2 - eased * 0.5);
                    // Goutte de sang (cercle + petit trail)
                    p.gfx.circle(px, py, size);
                    p.gfx.fill({ color: p.color, alpha: alpha * 0.9 });
                    // Petit trail derrière la particule
                    const trailX = px + (p.startX - p.endX) * 0.1;
                    const trailY = py + (p.startY - p.endY) * 0.1;
                    p.gfx.circle(trailX, trailY, size * 0.5);
                    p.gfx.fill({ color: p.color, alpha: alpha * 0.4 });
                }
            });

            // Étincelles lumineuses : convergent plus lentement
            sparks.forEach(s => {
                s.gfx.clear();
                const localP = Math.max(0, Math.min(1, (progress - s.delay) / (0.7 - s.delay)));
                if (localP > 0 && localP < 1) {
                    const eased = localP * localP;
                    const sx = s.startX * (1 - eased);
                    const sy = s.startY * (1 - eased);
                    const alpha = localP < 0.2 ? localP / 0.2
                        : localP > 0.8 ? (1 - localP) / 0.2
                        : 1;
                    // Losange lumineux (comme le heal mais rouge)
                    const sz = s.size * (1 - eased * 0.3);
                    s.gfx.moveTo(sx, sy - sz);
                    s.gfx.lineTo(sx + sz * 0.6, sy);
                    s.gfx.lineTo(sx, sy + sz);
                    s.gfx.lineTo(sx - sz * 0.6, sy);
                    s.gfx.closePath();
                    s.gfx.fill({ color: 0xFF4444, alpha: alpha * 0.8 });
                }
            });

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    showLifestealNumber(x, y, amount) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1300,
        };

        // Texte "+X" rouge sang
        const text = new PIXI.Text({
            text: `+${amount}`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 48,
                fontWeight: 'bold',
                fill: 0xCC0000,
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

        // Glow rouge sang
        const glow = new PIXI.Graphics();
        glow.circle(0, 0, 30);
        glow.fill({ color: 0xCC0000, alpha: 0.35 });
        effectContainer.addChildAt(glow, 0);

        const startY = y;

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            // Apparition (0 → 0.1) — le nombre arrive en scale-up
            if (progress < 0.1) {
                const p = progress / 0.1;
                text.scale.set(0.3 + p * 0.9);
                text.alpha = p;
                glow.alpha = p * 0.35;
            }
            // Maintien avec pulse (0.1 → 0.5)
            else if (progress < 0.5) {
                text.alpha = 1;
                const pulse = 1 + Math.sin((progress - 0.1) * Math.PI * 4) * 0.05;
                text.scale.set(1.15 * pulse);
                glow.alpha = 0.35;
            }
            // Montée et fade (0.5 → 1)
            else {
                const fadeProgress = (progress - 0.5) / 0.5;
                effectContainer.y = startY - fadeProgress * 55;
                text.alpha = 1 - fadeProgress;
                glow.alpha = (1 - fadeProgress) * 0.35;
                text.scale.set(1.15 - fadeProgress * 0.2);
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

    // ==================== DAMAGE FLASH (FLASH BLANC + ÉTINCELLES ROUGES) ====================

    createDamageFlashEffect(x, y, w, h) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 420,
        };

        const hw = w / 2, hh = h / 2;

        // Flash blanc + bord rouge = géré par CSS (.card-damage-hit::before) pour hériter de la perspective 3D

        // 5 micro-étincelles rouge-orange
        const sparks = [];
        for (let i = 0; i < 5; i++) {
            const angle = (Math.PI * 2 * i / 5) + (Math.random() - 0.5) * 0.8;
            const spark = new PIXI.Graphics();
            effectContainer.addChild(spark);
            sparks.push({
                gfx: spark,
                angle,
                speed: 35 + Math.random() * 35,
                color: Math.random() > 0.5 ? 0xFF3300 : 0xFF6644,
            });
        }

        const animate = () => {
            if (effect.finished) return;
            const elapsed = performance.now() - effect.startTime;
            const progress = Math.min(elapsed / effect.duration, 1);

            if (progress >= 1) {
                effect.finished = true;
                effectContainer.parent?.removeChild(effectContainer);
                effectContainer.destroy({ children: true });
                return;
            }

            // Étincelles
            sparks.forEach(s => {
                s.gfx.clear();
                if (progress > 0.05 && progress < 0.6) {
                    const sp = (progress - 0.05) / 0.55;
                    const dist = sp * s.speed;
                    const sx = Math.cos(s.angle) * dist;
                    const sy = Math.sin(s.angle) * dist;
                    const alpha = (1 - sp) * 0.7;
                    s.gfx.circle(sx, sy, 1.2 * (1 - sp));
                    s.gfx.fill({ color: s.color, alpha });
                }
            });

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== SPELL HIGHLIGHT (GLOW SUR SLOT + CARTE) ====================

    // createSpellHighlight — migré vers CSS (.spell-highlight-*::before) pour hériter de la perspective 3D
    // Conservé comme stub pour éviter les erreurs si appelé
    createSpellHighlight(x, y, w, h, type) {
        // Désormais géré par CSS dans game.js
    }

    // ==================== SHIELD SYSTEM (BOUCLIER PERSISTANT PIXIJS) ====================

    // Hexagone helper — retourne un tableau de points [{x,y}] pour un hex centré
    _hexPoints(cx, cy, r) {
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 6 + (Math.PI / 3) * i;
            pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
        }
        return pts;
    }

    registerShield(slotKey, element) {
        if (!this.initialized) return;

        // Si le bouclier existe déjà, mettre à jour l'élément DOM (après re-render)
        if (this.activeShields.has(slotKey)) {
            this.activeShields.get(slotKey).element = element;
            return;
        }

        const container = new PIXI.Container();
        this.shieldLayer.addChild(container);

        // Pré-créer les graphics pour les hexagones
        const hexGfx = new PIXI.Graphics();
        container.addChild(hexGfx);

        // Sweep reflet
        const sweepGfx = new PIXI.Graphics();
        container.addChild(sweepGfx);

        // Rune centrale
        const runeText = new PIXI.Text({
            text: '\u16DF',
            style: {
                fontFamily: 'serif',
                fontSize: 14,
                fill: 0xB4D2FF,
                align: 'center',
            }
        });
        runeText.anchor.set(0.5, 0.5);
        container.addChild(runeText);

        this.activeShields.set(slotKey, {
            container,
            element,
            startTime: performance.now(),
            hexGfx,
            sweepGfx,
            runeText,
        });
    }

    removeShield(slotKey) {
        const shield = this.activeShields.get(slotKey);
        if (!shield) return;
        shield.container.parent?.removeChild(shield.container);
        shield.container.destroy({ children: true });
        this.activeShields.delete(slotKey);
    }

    // Appelé après render() — supprime les boucliers qui ne sont plus actifs
    syncShields(activeSlotKeys) {
        for (const slotKey of this.activeShields.keys()) {
            if (!activeSlotKeys.has(slotKey)) {
                this.removeShield(slotKey);
            }
        }
    }

    updateShields() {
        const now = performance.now();

        for (const [slotKey, shield] of this.activeShields) {
            const { container, element, startTime, hexGfx, sweepGfx, runeText } = shield;

            // Si l'élément DOM est détaché, masquer le bouclier
            if (!element || !document.contains(element)) {
                container.visible = false;
                continue;
            }
            container.visible = true;

            const rect = element.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            // Bob vertical subtil (3s cycle, ±3px)
            const elapsed = (now - startTime) / 1000;
            const bobY = Math.sin(elapsed * 2.094) * 3; // 2π/3 ≈ 2.094 → 3s

            container.position.set(cx, cy + bobY);

            // Tilt subtil via skew (approxime la rotation 3D)
            const tiltX = Math.sin(elapsed * 1.047) * 0.02; // 6s cycle
            container.skew.set(tiltX, 0);

            // Dimensions de la grille hex
            const hexR = Math.min(rect.width, rect.height) * 0.15;
            const hexW = hexR * Math.sqrt(3);
            const hexH = hexR * 2;

            // Positions des 7 hexagones (honeycomb)
            const positions = [
                { x: -hexW * 0.5, y: -hexH * 0.75 },  // top-left
                { x: hexW * 0.5, y: -hexH * 0.75 },    // top-right
                { x: -hexW, y: 0 },                     // mid-left
                { x: 0, y: 0 },                         // center
                { x: hexW, y: 0 },                       // mid-right
                { x: -hexW * 0.5, y: hexH * 0.75 },     // bot-left
                { x: hexW * 0.5, y: hexH * 0.75 },      // bot-right
            ];

            hexGfx.clear();

            for (let i = 0; i < positions.length; i++) {
                const pos = positions[i];
                const pts = this._hexPoints(pos.x, pos.y, hexR);

                // Outline structurel (toujours visible, faible)
                hexGfx.moveTo(pts[0].x, pts[0].y);
                for (let j = 1; j < 6; j++) hexGfx.lineTo(pts[j].x, pts[j].y);
                hexGfx.closePath();
                hexGfx.stroke({ color: 0xC8DCFA, width: 1.2, alpha: 0.25 });

                // Pulse séquentiel — chaque hex pulse avec un décalage de 1.3s (8s cycle)
                const pulsePhase = ((elapsed - i * 1.3) % 8) / 8;
                const pulseAlpha = Math.max(0, Math.sin(pulsePhase * Math.PI * 2)) * 0.6;

                if (pulseAlpha > 0.01) {
                    hexGfx.moveTo(pts[0].x, pts[0].y);
                    for (let j = 1; j < 6; j++) hexGfx.lineTo(pts[j].x, pts[j].y);
                    hexGfx.closePath();
                    hexGfx.fill({ color: 0x00DCFF, alpha: pulseAlpha * 0.2 });
                    hexGfx.stroke({ color: 0x00DCFF, width: 1.5, alpha: pulseAlpha });
                }
            }

            // Sweep diagonal (reflet qui traverse — 5s cycle)
            sweepGfx.clear();
            const sweepPhase = (elapsed % 5) / 5;
            if (sweepPhase < 0.4) {
                const sp = sweepPhase / 0.4;
                const sweepX = -hexW * 1.5 + sp * hexW * 3;
                const sweepAlpha = sp < 0.1 ? sp / 0.1 : sp > 0.9 ? (1 - sp) / 0.1 : 1;
                sweepGfx.rect(sweepX - 4, -hexH * 1.2, 8, hexH * 2.4);
                sweepGfx.fill({ color: 0xFFFFFF, alpha: sweepAlpha * 0.15 });
            }

            // Rune pulsante (4s cycle)
            const runeAlpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(elapsed * 1.571)); // π/2 ≈ 1.571 → 4s
            runeText.alpha = runeAlpha;
            runeText.position.set(0, 0);
        }
    }
    // Effet de pétrification — vague de gris + fissures + flash pierre
    createPetrifyEffect(x, y, w, h) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1100,
        };

        const maxR = Math.max(w, h) * 0.7;

        // Flash central gris-blanc
        const flash = new PIXI.Graphics();
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // Anneau de pierre qui se contracte
        const ring = new PIXI.Graphics();
        ring.alpha = 0;
        effectContainer.addChild(ring);

        // Particules de pierre (fragments convergents)
        const particles = [];
        for (let i = 0; i < 12; i++) {
            const gfx = new PIXI.Graphics();
            const size = 2 + Math.random() * 3;
            gfx.rect(-size / 2, -size / 2, size, size);
            gfx.fill({ color: 0x808080, alpha: 0.9 });
            gfx.alpha = 0;
            const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const dist = maxR * (0.9 + Math.random() * 0.5);
            particles.push({
                gfx, angle, dist,
                startX: Math.cos(angle) * dist,
                startY: Math.sin(angle) * dist,
                rotSpeed: (Math.random() - 0.5) * 4,
            });
            effectContainer.addChild(gfx);
        }

        // Fissures radiales
        const cracks = new PIXI.Graphics();
        cracks.alpha = 0;
        effectContainer.addChild(cracks);

        // Pré-calculer les chemins de fissures
        const crackPaths = [];
        for (let i = 0; i < 6; i++) {
            const baseAngle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const segments = [];
            let cx = 0, cy = 0;
            const segCount = 3 + Math.floor(Math.random() * 3);
            for (let s = 0; s < segCount; s++) {
                const segAngle = baseAngle + (Math.random() - 0.5) * 0.8;
                const segLen = (maxR / segCount) * (0.6 + Math.random() * 0.8);
                const nx = cx + Math.cos(segAngle) * segLen;
                const ny = cy + Math.sin(segAngle) * segLen;
                segments.push({ x: nx, y: ny });
                cx = nx; cy = ny;
            }
            crackPaths.push(segments);
        }

        const animate = () => {
            if (effect.finished) return;
            const progress = (performance.now() - effect.startTime) / effect.duration;
            if (progress >= 1) { effect.finished = true; return; }

            // Phase 1: Flash blanc-gris (0 → 0.3)
            if (progress < 0.3) {
                const fp = progress / 0.3;
                const flashAlpha = Math.sin(fp * Math.PI) * 0.8;
                const flashScale = 5 + fp * maxR * 0.8;
                flash.clear();
                flash.circle(0, 0, flashScale);
                flash.fill({ color: 0xB0B0B0, alpha: flashAlpha * 0.6 });
                flash.alpha = 1;
            } else {
                flash.alpha = Math.max(0, flash.alpha - 0.05);
            }

            // Phase 2: Anneau convergent (0.1 → 0.6)
            if (progress > 0.1 && progress < 0.6) {
                const rp = (progress - 0.1) / 0.5;
                const ringRadius = maxR * (1 - rp * 0.7);
                const ringAlpha = rp < 0.2 ? rp / 0.2 : rp > 0.8 ? (1 - rp) / 0.2 : 1;
                ring.clear();
                ring.circle(0, 0, ringRadius);
                ring.stroke({ color: 0x9E9E9E, width: 3, alpha: ringAlpha * 0.7 });
                ring.circle(0, 0, ringRadius * 0.85);
                ring.stroke({ color: 0x757575, width: 1.5, alpha: ringAlpha * 0.4 });
                ring.alpha = 1;
            } else if (progress >= 0.6) {
                ring.alpha = Math.max(0, ring.alpha - 0.08);
            }

            // Phase 3: Particules convergentes (0.05 → 0.7)
            for (const p of particles) {
                if (progress < 0.05) { p.gfx.alpha = 0; continue; }
                if (progress > 0.7) { p.gfx.alpha = Math.max(0, p.gfx.alpha - 0.06); continue; }
                const pp = (progress - 0.05) / 0.65;
                const ease = 1 - Math.pow(1 - pp, 3);
                p.gfx.position.set(p.startX * (1 - ease), p.startY * (1 - ease));
                p.gfx.rotation += p.rotSpeed * 0.016;
                p.gfx.alpha = pp < 0.15 ? pp / 0.15 : pp > 0.85 ? (1 - pp) / 0.15 : 0.9;
            }

            // Phase 4: Fissures (0.3 → 0.9)
            if (progress > 0.3 && progress < 0.9) {
                const cp = (progress - 0.3) / 0.6;
                cracks.clear();
                const crackAlpha = cp < 0.2 ? cp / 0.2 : cp > 0.7 ? (1 - cp) / 0.3 : 1;
                cracks.alpha = crackAlpha;
                for (const path of crackPaths) {
                    const visibleSegments = Math.ceil(path.length * cp);
                    if (visibleSegments > 0) {
                        cracks.moveTo(0, 0);
                        for (let s = 0; s < visibleSegments; s++) {
                            cracks.lineTo(path[s].x, path[s].y);
                        }
                        cracks.stroke({ color: 0x606060, width: 1.5, alpha: 0.8 });
                    }
                }
            } else if (progress >= 0.9) {
                cracks.alpha = Math.max(0, cracks.alpha - 0.1);
            }

            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    /**
     * Medusa Gaze — oeil mystique qui s'ouvre au-dessus de Medusa,
     * émet un rayon vers la cible, puis se referme.
     * Style Magic Arena / Hearthstone.
     * @param {number} srcX - centre X de Medusa
     * @param {number} srcY - centre Y de Medusa
     * @param {number} tgtX - centre X de la cible
     * @param {number} tgtY - centre Y de la cible
     */
    createMedusaGazeEffect(srcX, srcY, tgtX, tgtY) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        this.container.addChild(effectContainer);

        const duration = 1800;
        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration,
        };
        this.activeEffects.push(effect);

        // --- Géométrie ---
        const eyeX = srcX;
        const eyeY = srcY - 65;
        const eyeW = 54;
        const eyeH = 24;
        const irisR = 13;

        const dx = tgtX - eyeX;
        const dy = tgtY - eyeY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const perpX = -dy / dist;
        const perpY = dx / dist;

        // --- Easing ---
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        const easeInQuart = t => t * t * t * t;

        // --- Couleurs violet ---
        const C = {
            irisOuter: 0x4a1a6a, irisMid: 0x7030a0, irisInner: 0xb060e0, irisHot: 0xd0a0ff,
            vein: 0xc060ff,      outline: 0x9040d0, outlineGlow: 0xd0a0ff,
            pupil: 0x08001a,     pupilEdge: 0x8040c0,
            highlight: 0xe8d0ff, beamCore: 0xb060e0, beamMid: 0x8040c0, beamWide: 0x6030a0,
            particle: [0xc060ff, 0xa050d0, 0xd080ff, 0x8040c0, 0xe0a0ff],
        };

        // ============ GRAPHIQUES ============
        const beamGfx = new PIXI.Graphics();
        effectContainer.addChild(beamGfx);
        const eyeGfx = new PIXI.Graphics();
        effectContainer.addChild(eyeGfx);

        // ============ PARTICULES ============
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];

        // Particules le long du rayon
        const beamParticles = [];
        for (let i = 0; i < 20; i++) {
            const gfx = new PIXI.Graphics();
            gfx.circle(0, 0, 1 + Math.random() * 2.5);
            gfx.fill({ color: pick(C.particle), alpha: 0.7 });
            gfx.alpha = 0;
            effectContainer.addChild(gfx);
            beamParticles.push({
                gfx, offset: Math.random(), speed: 0.5 + Math.random() * 1.5,
                lateral: (Math.random() - 0.5) * 14, phase: Math.random() * Math.PI * 2,
            });
        }

        // Helper : dessiner la forme amande
        const drawAlmond = (g, x, y, w, h) => {
            g.moveTo(x - w, y);
            g.bezierCurveTo(x - w * 0.5, y - h, x + w * 0.5, y - h, x + w, y);
            g.bezierCurveTo(x + w * 0.5, y + h, x - w * 0.5, y + h, x - w, y);
        };

        // ============ BOUCLE D'ANIMATION ============
        const animate = () => {
            if (effect.finished) return;
            const now = performance.now();
            const progress = (now - effect.startTime) / duration;
            if (progress >= 1) { effect.finished = true; return; }

            // --- Ouverture / fermeture ---
            let finalOpenness = Math.min(progress / 0.22, 1);
            finalOpenness = easeOutCubic(finalOpenness);
            if (progress > 0.7) {
                finalOpenness *= 1 - easeInQuart((progress - 0.7) / 0.3);
            }

            const pulse = 1 + Math.sin(now * 0.006) * 0.06;
            const currentH = eyeH * finalOpenness;

            // ====== L'OEIL ======
            eyeGfx.clear();

            if (currentH > 0.5) {
                // --- Fond sombre de l'oeil ---
                drawAlmond(eyeGfx, eyeX, eyeY, eyeW, currentH);
                eyeGfx.fill({ color: 0x0a0012, alpha: 0.95 });

                // --- Iris (3 couches concentriques) ---
                const irisPulse = 1 + Math.sin(now * 0.007) * 0.1;
                const iScale = Math.min(finalOpenness * 1.4, 1) * irisPulse;
                const ir = irisR * iScale;

                eyeGfx.circle(eyeX, eyeY, ir);
                eyeGfx.fill({ color: C.irisOuter, alpha: 0.95 });
                eyeGfx.circle(eyeX, eyeY, ir * 0.72);
                eyeGfx.fill({ color: C.irisMid, alpha: 0.9 });
                eyeGfx.circle(eyeX, eyeY, ir * 0.48);
                eyeGfx.fill({ color: C.irisInner, alpha: 0.55 });

                // --- Veines de l'iris (lignes rotatives) ---
                const nVeins = 10;
                const rot = now * 0.0008;
                for (let v = 0; v < nVeins; v++) {
                    const va = rot + (v / nVeins) * Math.PI * 2;
                    const vLen = ir * (0.6 + Math.sin(now * 0.003 + v * 1.7) * 0.25);
                    const hRatio = currentH / eyeH;
                    eyeGfx.moveTo(eyeX, eyeY);
                    eyeGfx.lineTo(
                        eyeX + Math.cos(va) * vLen,
                        eyeY + Math.sin(va) * vLen * hRatio
                    );
                    eyeGfx.stroke({ color: C.vein, width: 1, alpha: 0.35 });
                }

                // --- Glow autour de l'iris ---
                eyeGfx.circle(eyeX, eyeY, ir * 1.1);
                eyeGfx.stroke({ color: C.irisHot, width: 1.5, alpha: finalOpenness * 0.3 });

                // --- Pupille fendue (serpent) ---
                const pScale = Math.min(finalOpenness * 1.6, 1);
                const pW = 2.8 * pScale;
                const pH = ir * 0.88 * pScale;
                eyeGfx.ellipse(eyeX, eyeY, pW, pH);
                eyeGfx.fill({ color: C.pupil, alpha: 0.96 });
                eyeGfx.ellipse(eyeX, eyeY, pW + 1.2, pH + 0.6);
                eyeGfx.stroke({ color: C.pupilEdge, width: 0.8, alpha: 0.45 });

                // --- Reflets spéculaires ---
                eyeGfx.circle(eyeX - ir * 0.28, eyeY - ir * 0.22, 2.2 * pScale);
                eyeGfx.fill({ color: C.highlight, alpha: 0.55 * finalOpenness });
                eyeGfx.circle(eyeX + ir * 0.18, eyeY + ir * 0.18, 1.2 * pScale);
                eyeGfx.fill({ color: 0xffffff, alpha: 0.3 * finalOpenness });

                // --- Double contour lumineux ---
                drawAlmond(eyeGfx, eyeX, eyeY, eyeW, currentH);
                eyeGfx.stroke({ color: C.outline, width: 2.5, alpha: 0.85 });
                drawAlmond(eyeGfx, eyeX, eyeY, eyeW + 2, currentH + 1);
                eyeGfx.stroke({ color: C.outlineGlow, width: 1.2, alpha: 0.35 });
            }

            // ====== TENTACULES D'ÉNERGIE (0.16 → 0.82) ======
            beamGfx.clear();
            if (progress > 0.16 && progress < 0.82) {
                const bp = (progress - 0.16) / 0.66;
                const beamLen = Math.min(bp * 2.2, 1);
                let bAlpha = 1;
                if (bp < 0.1) bAlpha = bp / 0.1;
                else if (bp > 0.78) bAlpha = (1 - bp) / 0.22;

                // 3 tentacules sinusoïdaux
                const tendrils = [
                    { freq: 2.5, amp: 6,  w: 3.5, a: 0.55, color: C.beamCore, phOff: 0 },
                    { freq: 4,   amp: 10, w: 2.2, a: 0.3,  color: C.beamMid,  phOff: Math.PI * 0.7 },
                    { freq: 5.5, amp: 14, w: 1.5, a: 0.18, color: C.beamWide, phOff: Math.PI * 1.4 },
                ];
                const segs = 40;

                for (const td of tendrils) {
                    const phaseAnim = td.phOff + now * 0.003;
                    let started = false;
                    for (let s = 0; s < segs; s++) {
                        const t0 = s / segs;
                        const t1 = (s + 1) / segs;
                        if (t0 > beamLen) break;
                        const tEnd = Math.min(t1, beamLen);
                        const wave0 = Math.sin(t0 * td.freq * Math.PI + phaseAnim) * td.amp * t0;
                        const wave1 = Math.sin(tEnd * td.freq * Math.PI + phaseAnim) * td.amp * tEnd;
                        const x0 = eyeX + dx * t0 + perpX * wave0;
                        const y0 = eyeY + dy * t0 + perpY * wave0;
                        const x1 = eyeX + dx * tEnd + perpX * wave1;
                        const y1 = eyeY + dy * tEnd + perpY * wave1;
                        if (!started) { beamGfx.moveTo(x0, y0); started = true; }
                        beamGfx.lineTo(x1, y1);
                    }
                    if (started) {
                        beamGfx.stroke({ color: td.color, width: td.w * pulse, alpha: td.a * bAlpha });
                    }
                }

                // Coeur lumineux droit
                const cEndX = eyeX + dx * beamLen;
                const cEndY = eyeY + dy * beamLen;
                beamGfx.moveTo(eyeX, eyeY);
                beamGfx.lineTo(cEndX, cEndY);
                beamGfx.stroke({ color: C.irisHot, width: 1.2, alpha: 0.25 * bAlpha });

                // Particules du rayon
                for (const p of beamParticles) {
                    const t = (p.offset + now * 0.0008 * p.speed) % 1;
                    if (t > beamLen) { p.gfx.alpha = 0; continue; }
                    const wave = Math.sin(t * 4 * Math.PI + now * 0.003 + p.phase) * p.lateral * t;
                    p.gfx.position.set(
                        eyeX + dx * t + perpX * wave,
                        eyeY + dy * t + perpY * wave
                    );
                    p.gfx.alpha = bAlpha * (0.25 + Math.sin(now * 0.007 + p.phase) * 0.25);
                    p.gfx.scale.set(0.6 + Math.sin(now * 0.005 + p.phase) * 0.4);
                }
            } else {
                for (const p of beamParticles) p.gfx.alpha = 0;
            }

            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    // ==================== TRAP SUMMON (Piège à gobelin — invocation magique) ====================

    createTrapSummonEffect(x, y, w, h) {
        if (!this.initialized) return;
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const duration = 2800;
        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration,
        };

        const maxR = Math.max(w, h) * 0.7;

        // --- Glow de fond (halo doux) ---
        const glowBg = new PIXI.Graphics();
        glowBg.circle(0, 0, maxR * 1.5);
        glowBg.fill({ color: 0x7a5af0, alpha: 0.15 });
        glowBg.alpha = 0;
        effectContainer.addChild(glowBg);

        // --- Portail rotatif (3 anneaux concentriques) ---
        const portalRings = [];
        for (let i = 0; i < 3; i++) {
            const ring = new PIXI.Graphics();
            ring.alpha = 0;
            effectContainer.addChild(ring);
            portalRings.push({ gfx: ring, offset: i * (Math.PI * 2 / 3), baseR: maxR * (0.7 + i * 0.2) });
        }

        // --- Energy lines (6 lignes convergentes) ---
        const energyGfx = new PIXI.Graphics();
        effectContainer.addChild(energyGfx);

        // --- 12 particules convergentes (violet/bleu) ---
        const particles = [];
        for (let i = 0; i < 12; i++) {
            const gfx = new PIXI.Graphics();
            const size = 1.5 + Math.random() * 2.5;
            gfx.circle(0, 0, size);
            const colors = [0xb090ff, 0x60a0ff, 0x9a7aff, 0xc0a0ff];
            gfx.fill({ color: colors[i % colors.length], alpha: 0.9 });
            gfx.alpha = 0;
            const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const dist = maxR * (1.2 + Math.random() * 0.6);
            particles.push({
                gfx, angle, dist,
                startX: Math.cos(angle) * dist,
                startY: Math.sin(angle) * dist,
                speed: 0.8 + Math.random() * 0.4,
                drag: 0.94 + Math.random() * 0.03,
            });
            effectContainer.addChild(gfx);
        }

        // --- Flash central ---
        const flash = new PIXI.Graphics();
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // --- Sparks d'apparition (burst au moment du flash) ---
        const sparks = [];
        let sparksCreated = false;

        // --- Shimmer doré (particules finales) ---
        const shimmerContainer = new PIXI.Container();
        effectContainer.addChild(shimmerContainer);

        const portalRotation = { angle: 0 };

        const animate = () => {
            if (effect.finished) return;
            const now = performance.now();
            const elapsed = now - effect.startTime;
            const t = elapsed / duration; // 0 → 1 sur 2800ms
            if (t >= 1) { effect.finished = true; return; }

            const tMs = elapsed; // temps en ms

            // === Phase 0: 0-400ms — Energy gathering ===
            if (tMs < 400) {
                const p = tMs / 400;
                glowBg.alpha = p * 0.4;

                // Particules convergent lentement
                for (const part of particles) {
                    const conv = p * 0.15 * part.speed;
                    const ease = 1 - Math.pow(1 - conv, 3);
                    part.gfx.position.set(part.startX * (1 - ease), part.startY * (1 - ease));
                    part.gfx.alpha = Math.min(p * 2, 0.6);
                    part.gfx.scale.set(0.3 + p * 0.4);
                }

                // Portail commence à apparaître
                portalRotation.angle += 0.02;
                for (let i = 0; i < portalRings.length; i++) {
                    const r = portalRings[i];
                    const radius = r.baseR * (0.3 + p * 0.3);
                    const arcLen = Math.PI * 2 * p * 0.3;
                    r.gfx.clear();
                    r.gfx.arc(0, 0, radius, r.offset + portalRotation.angle, r.offset + portalRotation.angle + arcLen);
                    r.gfx.stroke({ color: 0x7a5af0, width: 2, alpha: p * 0.5 });
                    r.gfx.alpha = 1;
                }
            }

            // === Phase 1: 400-800ms — Portal opens ===
            else if (tMs < 800) {
                const p = (tMs - 400) / 400;
                glowBg.alpha = 0.4 + p * 0.4;

                // Particules convergent plus fort
                for (const part of particles) {
                    const conv = (0.15 + p * 0.55) * part.speed;
                    const ease = 1 - Math.pow(1 - Math.min(conv, 1), 3);
                    part.gfx.position.set(part.startX * (1 - ease), part.startY * (1 - ease));
                    part.gfx.alpha = 0.6 + p * 0.3;
                    part.gfx.scale.set(0.7 + p * 0.3);
                }

                // Portail grandit et tourne
                portalRotation.angle += 0.04;
                for (let i = 0; i < portalRings.length; i++) {
                    const r = portalRings[i];
                    const radius = r.baseR * (0.6 + p * 0.4);
                    const arcLen = Math.PI * 2 * (0.3 + p * 0.7);
                    r.gfx.clear();
                    r.gfx.arc(0, 0, radius, r.offset + portalRotation.angle * (1 + i * 0.3), r.offset + portalRotation.angle * (1 + i * 0.3) + arcLen);
                    r.gfx.stroke({ color: i === 0 ? 0x7a5af0 : (i === 1 ? 0xb090ff : 0xffffff), width: 3 - i, alpha: (0.5 + p * 0.4) * (1 - i * 0.15) });
                    r.gfx.alpha = 1;
                }

                // Energy lines convergentes
                energyGfx.clear();
                for (let i = 0; i < 6; i++) {
                    const a = portalRotation.angle * 3 + i * Math.PI / 3;
                    const len = maxR * 2.5 * (1 - p * 0.3);
                    energyGfx.moveTo(Math.cos(a) * len, Math.sin(a) * len);
                    energyGfx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
                    energyGfx.stroke({ color: 0x9a7aff, width: 1 + p, alpha: 0.3 * p });
                }
            }

            // === Phase 2: 800-1000ms — Flash & card materializes ===
            else if (tMs < 1000) {
                const p = (tMs - 800) / 200;

                // Flash blanc éclatant
                if (!sparksCreated) {
                    sparksCreated = true;
                    for (let i = 0; i < 30; i++) {
                        const gfx = new PIXI.Graphics();
                        const size = 1 + Math.random() * 3;
                        const colors = [0xffffff, 0xffd700, 0xc0a0ff];
                        gfx.star(0, 0, 4, size, size * 0.4);
                        gfx.fill({ color: colors[Math.floor(Math.random() * 3)], alpha: 1 });
                        const angle = Math.random() * Math.PI * 2;
                        const speed = 2 + Math.random() * 5;
                        sparks.push({
                            gfx, angle, speed,
                            x: 0, y: 0,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            life: 0.5 + Math.random() * 0.5,
                            maxLife: 0.5 + Math.random() * 0.5,
                            gravity: 0.3 + Math.random() * 0.3,
                            rotSpeed: (Math.random() - 0.5) * 5,
                        });
                        effectContainer.addChild(gfx);
                    }
                }

                const flashAlpha = 0.7 * (1 - p);
                const flashScale = 30 + p * 20;
                flash.clear();
                flash.circle(0, 0, flashScale);
                flash.fill({ color: 0xFFFFFF, alpha: flashAlpha * 0.5 });
                flash.circle(0, 0, flashScale * 0.6);
                flash.fill({ color: 0x7a5af0, alpha: flashAlpha * 0.3 });
                flash.alpha = 1;

                glowBg.alpha = 0.8 - p * 0.3;

                // Portail se réduit
                for (let i = 0; i < portalRings.length; i++) {
                    const r = portalRings[i];
                    r.gfx.alpha = 1 - p * 0.5;
                }
                energyGfx.alpha = 1 - p;

                // Particules disparaissent
                for (const part of particles) {
                    part.gfx.alpha = Math.max(0, 0.9 - p * 2);
                }
            }

            // === Phase 3: 1000-1500ms — Card settles, sparks fly ===
            else if (tMs < 1500) {
                const p = (tMs - 1000) / 500;

                flash.alpha = 0;
                glowBg.alpha = 0.5 * (1 - p);
                energyGfx.alpha = 0;

                // Portail disparaît
                for (const r of portalRings) {
                    r.gfx.alpha = Math.max(0, 0.5 * (1 - p * 2));
                }

                // Particules convergentes disparues
                for (const part of particles) {
                    part.gfx.alpha = 0;
                }
            }

            // === Phase 4: 1500-2800ms — Idle shimmer ===
            else {
                const p = (tMs - 1500) / 1300;

                glowBg.alpha = (0.1 + Math.sin(tMs * 0.004) * 0.05) * (1 - p);
                for (const r of portalRings) r.gfx.alpha = 0;
                energyGfx.alpha = 0;
                flash.alpha = 0;
                for (const part of particles) part.gfx.alpha = 0;

                // Shimmer doré sur les bords (rare)
                if (Math.random() < 0.15 * (1 - p)) {
                    const edge = Math.floor(Math.random() * 4);
                    let px, py;
                    const hw = w / 2, hh = h / 2;
                    if (edge === 0) { px = -hw + Math.random() * w; py = -hh; }
                    else if (edge === 1) { px = hw; py = -hh + Math.random() * h; }
                    else if (edge === 2) { px = -hw + Math.random() * w; py = hh; }
                    else { px = -hw; py = -hh + Math.random() * h; }
                    const sg = new PIXI.Graphics();
                    sg.circle(0, 0, 1 + Math.random() * 1.5);
                    sg.fill({ color: 0xffd700, alpha: 0.5 });
                    sg.position.set(px, py);
                    shimmerContainer.addChild(sg);
                    const startTime = now;
                    const shimmerLife = 600 + Math.random() * 400;
                    const vy = -(0.3 + Math.random() * 0.3);
                    const shimmerTick = () => {
                        const age = performance.now() - startTime;
                        if (age > shimmerLife || effect.finished) { sg.destroy(); return; }
                        sg.y += vy;
                        sg.alpha = 0.5 * (1 - age / shimmerLife);
                        requestAnimationFrame(shimmerTick);
                    };
                    requestAnimationFrame(shimmerTick);
                }
            }

            // === Update sparks (all phases after creation) ===
            for (let i = sparks.length - 1; i >= 0; i--) {
                const s = sparks[i];
                const dt = 1 / 60;
                s.life -= dt;
                if (s.life <= 0) {
                    s.gfx.destroy();
                    sparks.splice(i, 1);
                    continue;
                }
                s.vx *= 0.95;
                s.vy *= 0.95;
                s.vy += s.gravity * dt;
                s.x += s.vx;
                s.y += s.vy;
                s.gfx.position.set(s.x, s.y);
                s.gfx.rotation += s.rotSpeed * dt;
                s.gfx.alpha = Math.max(0, s.life / s.maxLife);
            }

            requestAnimationFrame(animate);
        };

        this.activeEffects.push(effect);
        requestAnimationFrame(animate);
    }

    // ==================== CAMOUFLAGE (FUMÉE PERSISTANTE) ====================

    // Classe Noise interne pour la fumée organique
    _initCamoNoise() {
        if (this._camoNoiseA) return;
        class Noise {
            constructor(seed) {
                this.perm = new Uint8Array(512);
                const p = new Uint8Array(256);
                for (let i = 0; i < 256; i++) p[i] = i;
                for (let i = 255; i > 0; i--) {
                    const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
                    const j = Math.floor((x - Math.floor(x)) * (i + 1));
                    [p[i], p[j]] = [p[j], p[i]];
                }
                for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
            }
            noise2D(x, y) {
                const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
                const xf = x - Math.floor(x), yf = y - Math.floor(y);
                const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
                const a = this.perm[X] + Y, b = this.perm[X + 1] + Y;
                const grad = (h, gx, gy) => { const g = h & 3; return (g===0?gx+gy:g===1?-gx+gy:g===2?gx-gy:-gx-gy); };
                const lerp = (a2, b2, t) => a2 + t * (b2 - a2);
                return lerp(
                    lerp(grad(this.perm[a], xf, yf), grad(this.perm[b], xf-1, yf), u),
                    lerp(grad(this.perm[a+1], xf, yf-1), grad(this.perm[b+1], xf-1, yf-1), u), v
                );
            }
            fbm(x, y, oct = 4) {
                let val = 0, amp = 0.5, freq = 1;
                for (let i = 0; i < oct; i++) { val += amp * this.noise2D(x*freq, y*freq); amp *= 0.5; freq *= 2.1; }
                return val;
            }
        }
        this._camoNoiseA = new Noise(42);
        this._camoNoiseB = new Noise(137);
    }

    // Texture de fumée radiale douce (canvas → PixiJS texture)
    _makeSmokeTexture(size, softness) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        g.addColorStop(0, `rgba(255,255,255,${softness})`);
        g.addColorStop(0.35, `rgba(255,255,255,${softness * 0.55})`);
        g.addColorStop(0.65, `rgba(255,255,255,${softness * 0.15})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        return PIXI.Texture.from(c);
    }

    registerCamouflage(slotKey, element) {
        if (!this.initialized) return;
        this._initCamoNoise();

        // Si existe déjà, mettre à jour l'élément DOM
        if (this.activeCamouflages.has(slotKey)) {
            const existing = this.activeCamouflages.get(slotKey);
            existing.element = element;
            // Re-attacher le dark overlay DOM si l'élément a changé
            if (existing.domOverlay && existing.domOverlay.parentElement !== element) {
                existing.domOverlay.remove();
                element.appendChild(existing.domOverlay);
            }
            return;
        }

        const container = new PIXI.Container();
        this.shieldLayer.addChild(container);

        // Textures fumée (3 tailles)
        const smokeTexS = this._makeSmokeTexture(32, 0.6);
        const smokeTexM = this._makeSmokeTexture(64, 0.5);
        const smokeTexL = this._makeSmokeTexture(96, 0.35);
        const smokeTex = [smokeTexS, smokeTexM, smokeTexL];

        // Dark overlay en DOM (enfant de la carte — suit naturellement la perspective du board)
        const domOverlay = document.createElement('div');
        domOverlay.className = 'camo-dark-overlay';
        domOverlay.style.cssText = `
            position: absolute; inset: 0; border-radius: inherit;
            background: rgba(8, 12, 18, 0.45); pointer-events: none; z-index: 5;
        `;
        element.appendChild(domOverlay);

        // Masque rectangulaire pour la fumée (dimensions mises à jour dans updateCamouflages)
        const smokeMask = new PIXI.Graphics();
        container.addChild(smokeMask);

        // Conteneur de fumée masqué
        const smokeContainer = new PIXI.Container();
        smokeContainer.mask = smokeMask;
        container.addChild(smokeContainer);

        // Créer les particules de fumée
        const particles = [];
        const baseTime = Math.random() * 100; // Décalage aléatoire pour que chaque carte ait un motif différent

        // Couche 1 : Grand brouillard lent en fond (réduit pour petites cartes)
        for (let i = 0; i < 8; i++) {
            const s = new PIXI.Sprite(smokeTexL);
            s.anchor.set(0.5);
            s.blendMode = 'screen';
            smokeContainer.addChild(s);
            particles.push({
                sprite: s, baseScale: 0.6 + Math.random() * 0.5,
                maxAlpha: 0.04 + Math.random() * 0.06,
                life: Math.random(), maxLife: 4 + Math.random() * 4,
                riseSpeed: 3 + Math.random() * 6, drift: 10 + Math.random() * 15,
                rotSpeed: (Math.random() - 0.5) * 0.008,
                nox: Math.random() * 200, noy: Math.random() * 200,
                fadeIn: 0.12 + Math.random() * 0.12, fadeOut: 0.6 + Math.random() * 0.2,
                ox: 0, oy: 0
            });
        }

        // Couche 2 : Fumée moyenne
        for (let i = 0; i < 20; i++) {
            const s = new PIXI.Sprite(smokeTex[Math.floor(Math.random() * 3)]);
            s.anchor.set(0.5);
            s.blendMode = 'screen';
            smokeContainer.addChild(s);
            particles.push({
                sprite: s, baseScale: 0.3 + Math.random() * 0.5,
                maxAlpha: 0.06 + Math.random() * 0.1,
                life: Math.random(), maxLife: 3 + Math.random() * 4,
                riseSpeed: 5 + Math.random() * 10, drift: 6 + Math.random() * 12,
                rotSpeed: (Math.random() - 0.5) * 0.01,
                nox: Math.random() * 200, noy: Math.random() * 200,
                fadeIn: 0.12 + Math.random() * 0.12, fadeOut: 0.6 + Math.random() * 0.2,
                ox: 0, oy: 0
            });
        }

        // Couche 3 : Petits filets denses
        for (let i = 0; i < 12; i++) {
            const s = new PIXI.Sprite(smokeTexS);
            s.anchor.set(0.5);
            s.blendMode = 'screen';
            smokeContainer.addChild(s);
            particles.push({
                sprite: s, baseScale: 0.2 + Math.random() * 0.3,
                maxAlpha: 0.08 + Math.random() * 0.14,
                life: Math.random(), maxLife: 2 + Math.random() * 2.5,
                riseSpeed: 8 + Math.random() * 12, drift: 4 + Math.random() * 8,
                rotSpeed: (Math.random() - 0.5) * 0.015,
                nox: Math.random() * 200, noy: Math.random() * 200,
                fadeIn: 0.12 + Math.random() * 0.12, fadeOut: 0.6 + Math.random() * 0.2,
                ox: 0, oy: 0
            });
        }

        this.activeCamouflages.set(slotKey, {
            container, element, startTime: performance.now(),
            particles, domOverlay, smokeMask, smokeContainer, baseTime,
            lastW: 0, lastH: 0
        });
    }

    removeCamouflage(slotKey) {
        const camo = this.activeCamouflages.get(slotKey);
        if (!camo) return;
        // Retirer le dark overlay DOM
        if (camo.domOverlay) camo.domOverlay.remove();
        camo.container.parent?.removeChild(camo.container);
        camo.container.destroy({ children: true });
        this.activeCamouflages.delete(slotKey);
    }

    syncCamouflages(activeSlotKeys) {
        for (const slotKey of this.activeCamouflages.keys()) {
            if (!activeSlotKeys.has(slotKey)) {
                this.removeCamouflage(slotKey);
            }
        }
    }

    updateCamouflages() {
        if (this.activeCamouflages.size === 0) return;
        const now = performance.now();
        const nA = this._camoNoiseA;
        const nB = this._camoNoiseB;

        for (const [slotKey, camo] of this.activeCamouflages) {
            const { container, element, particles, domOverlay, smokeMask, baseTime } = camo;

            if (!element || !document.contains(element)) {
                container.visible = false;
                if (domOverlay) domOverlay.style.display = 'none';
                continue;
            }
            container.visible = true;
            if (domOverlay) domOverlay.style.display = '';

            const rect = element.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const hw = rect.width / 2;
            const hh = rect.height / 2;
            const inset = 4; // retrait pour la fumée PixiJS (compense la perspective du board)

            container.position.set(cx, cy);

            // Reconstruire le smoke mask si les dimensions changent
            if (Math.abs(rect.width - camo.lastW) > 2 || Math.abs(rect.height - camo.lastH) > 2) {
                camo.lastW = rect.width;
                camo.lastH = rect.height;

                smokeMask.clear();
                smokeMask.roundRect(-hw + inset, -hh + inset, rect.width - inset * 2, rect.height - inset * 2, 4);
                smokeMask.fill({ color: 0xffffff });
            }

            // Temps écoulé
            const elapsed = (now - camo.startTime) / 1000 + baseTime;

            // Mettre à jour chaque particule
            for (const p of particles) {
                p.life += 0.016; // ~60fps
                const t = p.life / p.maxLife;

                if (t >= 1) {
                    // Reset
                    p.life = 0;
                    p.ox = (Math.random() - 0.5) * rect.width * 0.9;
                    p.oy = (Math.random() - 0.5) * rect.height * 0.8 + rect.height * 0.08;
                    p.sprite.rotation = Math.random() * Math.PI * 2;
                    p.sprite.alpha = 0;
                    continue;
                }

                // Init position if first frame
                if (p.ox === 0 && p.oy === 0) {
                    p.ox = (Math.random() - 0.5) * rect.width * 0.9;
                    p.oy = (Math.random() - 0.5) * rect.height * 0.8 + rect.height * 0.08;
                }

                // Noise-driven drift
                const nx = nA.fbm(p.nox + elapsed * 0.12, p.noy, 3);
                const ny = nB.fbm(p.nox, p.noy + elapsed * 0.12, 3);

                p.sprite.x = p.ox + nx * p.drift;
                p.sprite.y = p.oy + ny * p.drift * 0.6 - t * p.riseSpeed;

                // Alpha envelope
                let a;
                if (t < p.fadeIn) a = t / p.fadeIn;
                else if (t > p.fadeOut) a = 1 - (t - p.fadeOut) / (1 - p.fadeOut);
                else a = 1;
                p.sprite.alpha = a * p.maxAlpha;

                // Scale
                const pulse = 1 + Math.sin(elapsed * 0.7 + p.nox) * 0.06;
                p.sprite.scale.set(p.baseScale * (1 + t * 0.4) * pulse);

                p.sprite.rotation += p.rotSpeed;
            }
        }
    }

    // ==================== EFFET DE POISON (Gouttes toxiques) ====================

    /**
     * Animation de poison : cloaques toxiques qui grossissent, pulsent, enflent et éclatent.
     * @param {number} x - Centre X de la carte
     * @param {number} y - Centre Y de la carte
     * @param {number} damage - Nombre de dégâts de poison
     * @param {number} cardW - Largeur de la carte
     * @param {number} cardH - Hauteur de la carte
     */
    createPoisonDripEffect(x, y, damage, cardW = 90, cardH = 120) {
        if (!this.initialized) return;

        const effectContainer = new PIXI.Container();
        this.container.addChild(effectContainer);

        const duration = 1600;
        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration,
        };
        this.activeEffects.push(effect);

        const rand = (a, b) => Math.random() * (b - a) + a;
        const randInt = (a, b) => Math.floor(rand(a, b + 1));
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
        const easeInQuad = t => t * t;

        // ═══════ MASQUE (limiter l'effet à la zone de la carte) ═══════
        const cardLeft = x - cardW / 2;
        const cardTop = y - cardH / 2;
        const mask = new PIXI.Graphics();
        mask.roundRect(cardLeft, cardTop, cardW, cardH, 8);
        mask.fill({ color: 0xffffff });
        effectContainer.addChild(mask);
        const blobContainer = new PIXI.Container();
        blobContainer.mask = mask;
        effectContainer.addChild(blobContainer);

        // ═══════ PALETTE POISON ═══════
        function pickOuter() { return [0x30a855, 0x28994a, 0x35b050, 0x2a8f40, 0x3dbb58][randInt(0, 4)]; }
        function pickInner() { return [0x45cc65, 0x50dd70, 0x3bbf55][randInt(0, 2)]; }
        function pickCore()  { return [0x70ee88, 0x80ff95, 0x65e87a][randInt(0, 2)]; }
        const C_YELLOW   = 0xccdd22;
        const C_YELLOW_W = 0xddee44;
        const C_HL       = 0xccffe0;
        const C_HL_WARM  = 0xddffaa;

        // ═══════ BLOB GENERATION ═══════
        function blobPoints(cx, cy, baseR, irregularity, n) {
            const offsets = [];
            for (let i = 0; i < n; i++) offsets.push(rand(-irregularity, irregularity));
            const pts = [];
            for (let i = 0; i <= n; i++) {
                const idx = i % n;
                const angle = (Math.PI * 2 / n) * i;
                const prev = offsets[(idx - 1 + n) % n];
                const curr = offsets[idx];
                const next = offsets[(idx + 1) % n];
                const r = baseR + prev * 0.25 + curr * 0.5 + next * 0.25;
                pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
            }
            return pts;
        }

        function drawBlobFill(g, points, color, alpha) {
            if (alpha <= 0.001 || points.length < 3) return;
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length - 1; i++) {
                const curr = points[i], next = points[i + 1];
                g.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
            }
            g.closePath();
            g.fill({ color, alpha });
        }

        // ═══════ BLISTER FACTORY ═══════
        const margin = cardW * 0.1;
        function makeBlister() {
            const cx = rand(cardLeft + margin, cardLeft + cardW - margin);
            const cy = rand(cardTop + margin, cardTop + cardH - margin);
            const maxSize = rand(cardW * 0.06, cardW * 0.18);
            return {
                cx, cy, maxSize,
                blobPts: blobPoints(0, 0, maxSize, maxSize * 0.25, 16),
                innerPts: blobPoints(0, 0, maxSize * 0.7, maxSize * 0.15, 12),
                corePts: blobPoints(0, 0, maxSize * 0.35, maxSize * 0.1, 10),
                growStart: rand(0, 0.2),
                growDur: rand(0.2, 0.4),
                pulsePhase: rand(0, Math.PI * 2),
                pulseSpeed: rand(3, 6),
                pulseAmp: rand(0.02, 0.05),
                outerColor: pickOuter(),
                innerColor: pickInner(),
                coreColor: pickCore(),
                yellowAmount: rand(0, 1),
                hlAngle: rand(-1.2, -0.3),
                phase: 'growing',
                swellStart: 0,
                swellProgress: 0,
                popParticles: [],
                popSplats: [],
                popRingAlpha: 0,
                popRingSize: 0,
                alpha: 0,
            };
        }

        // ═══════ CREATE BLISTERS ═══════
        const blisters = [];
        const bigCount = 5 + Math.min(damage * 2, 6);
        for (let i = 0; i < bigCount; i++) blisters.push(makeBlister());
        const smallCount = 3 + Math.min(damage, 4);
        for (let i = 0; i < smallCount; i++) {
            const b = makeBlister();
            b.maxSize = rand(cardW * 0.03, cardW * 0.07);
            b.blobPts = blobPoints(0, 0, b.maxSize, b.maxSize * 0.2, 12);
            b.innerPts = blobPoints(0, 0, b.maxSize * 0.6, b.maxSize * 0.12, 10);
            b.corePts = blobPoints(0, 0, b.maxSize * 0.3, b.maxSize * 0.08, 8);
            b.growStart = rand(0.05, 0.3);
            blisters.push(b);
        }

        // Compute timing for each blister
        blisters.forEach(b => {
            b.growEnd = b.growStart + b.growDur;
            b.swellStart = b.growEnd + rand(0.08, 0.2);
            b.popAt = b.swellStart + rand(0.08, 0.18);
            if (b.popAt > 0.85) {
                const shift = b.popAt - 0.85;
                b.growStart -= shift; b.growEnd -= shift;
                b.swellStart -= shift; b.popAt -= shift;
            }
        });

        // ═══════ DRAW FUNCTIONS ═══════
        function drawBlister(g, b, time, scale) {
            if (b.phase === 'popped') return;
            const s = scale;
            if (s <= 0.01) return;

            const pulse = 1 + Math.sin(time * b.pulseSpeed + b.pulsePhase) * b.pulseAmp;
            const swell = b.phase === 'swelling' ? 1 + (b.swellProgress || 0) * 0.2 : 1;
            const sz = s * pulse * swell;
            const a = b.alpha;
            const yw = b.yellowAmount;

            // Ombre douce
            g.circle(b.cx, b.cy + 2, b.maxSize * sz * 1.05);
            g.fill({ color: 0x000000, alpha: a * 0.04 });

            // Couche externe
            const outer = b.blobPts.map(p => ({ x: b.cx + p.x * sz, y: b.cy + p.y * sz }));
            drawBlobFill(g, outer, b.outerColor, a * 0.08);
            if (yw > 0.3) drawBlobFill(g, outer, C_YELLOW, a * 0.03 * yw);

            // Couche interne
            const inner = b.innerPts.map(p => ({ x: b.cx + p.x * sz, y: b.cy + p.y * sz }));
            drawBlobFill(g, inner, b.innerColor, a * 0.07);
            if (yw > 0.2) drawBlobFill(g, inner, C_YELLOW, a * 0.025 * yw);

            // Noyau
            const core = b.corePts.map(p => ({ x: b.cx + p.x * sz, y: b.cy + p.y * sz }));
            drawBlobFill(g, core, b.coreColor, a * 0.06);
            if (yw > 0.5) drawBlobFill(g, core, C_YELLOW_W, a * 0.04 * yw);

            // Reflet spéculaire
            const hlX = b.cx + Math.cos(b.hlAngle) * b.maxSize * sz * 0.25;
            const hlY = b.cy + Math.sin(b.hlAngle) * b.maxSize * sz * 0.25;
            const hlR = b.maxSize * sz * 0.17;
            g.circle(hlX, hlY, hlR * 1.8);
            g.fill({ color: yw > 0.5 ? C_HL_WARM : C_HL, alpha: a * 0.06 });
            g.circle(hlX, hlY, hlR);
            g.fill({ color: 0xffffff, alpha: a * 0.14 });
            g.circle(hlX, hlY, hlR * 0.35);
            g.fill({ color: 0xffffff, alpha: a * 0.22 });

            // Reflet secondaire
            const hl2X = b.cx + Math.cos(b.hlAngle + Math.PI + 0.6) * b.maxSize * sz * 0.45;
            const hl2Y = b.cy + Math.sin(b.hlAngle + Math.PI + 0.6) * b.maxSize * sz * 0.45;
            g.circle(hl2X, hl2Y, b.maxSize * sz * 0.05);
            g.fill({ color: 0xffffff, alpha: a * 0.12 });

            // Pulsation d'enflure
            if (b.phase === 'swelling') {
                const throb = Math.sin(time * 14 + b.pulsePhase) * 0.5 + 0.5;
                g.circle(b.cx, b.cy, b.maxSize * sz * 0.4);
                g.fill({ color: yw > 0.5 ? C_YELLOW_W : C_HL, alpha: a * 0.025 * throb });
            }
        }

        function triggerPop(b) {
            b.phase = 'popped';
            b.popRingAlpha = 0.35;
            b.popRingSize = b.maxSize * 0.5;
            const yw = b.yellowAmount;

            const numDrops = Math.max(4, Math.floor(b.maxSize * 0.6));
            for (let i = 0; i < numDrops; i++) {
                const angle = rand(0, Math.PI * 2);
                const speed = rand(1, 4) * (b.maxSize / 20);
                const isYellowDrop = yw > 0.3 && Math.random() < yw * 0.5;
                b.popParticles.push({
                    x: b.cx + Math.cos(angle) * b.maxSize * 0.2,
                    y: b.cy + Math.sin(angle) * b.maxSize * 0.2,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: rand(1, Math.max(2, b.maxSize * 0.12)),
                    alpha: rand(0.15, 0.35),
                    color: isYellowDrop
                        ? [C_YELLOW, C_YELLOW_W][randInt(0, 1)]
                        : [b.outerColor, b.innerColor, b.coreColor][randInt(0, 2)],
                    drag: rand(0.94, 0.98),
                    gravity: rand(0.02, 0.06),
                });
            }

            const numSplats = randInt(2, 4);
            for (let i = 0; i < numSplats; i++) {
                const angle = rand(0, Math.PI * 2);
                const dist = rand(b.maxSize * 0.3, b.maxSize * 1.2);
                const sz = rand(4, b.maxSize * 0.35);
                const isYellow = yw > 0.4 && Math.random() < yw * 0.4;
                b.popSplats.push({
                    x: b.cx + Math.cos(angle) * dist,
                    y: b.cy + Math.sin(angle) * dist,
                    size: sz, scale: 0, targetScale: 1,
                    points: blobPoints(0, 0, sz, sz * 0.3, 8),
                    alpha: rand(0.05, 0.12),
                    color: isYellow ? C_YELLOW : [b.outerColor, b.innerColor][randInt(0, 1)],
                });
            }
        }

        function drawBlisterPop(g, b, gf) {
            if (b.popRingAlpha > 0.003) {
                g.circle(b.cx, b.cy, b.popRingSize);
                g.fill({ color: b.innerColor, alpha: b.popRingAlpha * 0.05 * gf });
            }
            b.popSplats.forEach(s => {
                if (s.alpha <= 0) return;
                const pts = s.points.map(p => ({ x: s.x + p.x * s.scale, y: s.y + p.y * s.scale }));
                drawBlobFill(g, pts, s.color, s.alpha * gf);
            });
            b.popParticles.forEach(p => {
                if (p.alpha <= 0) return;
                g.circle(p.x - p.vx * 1.5, p.y - p.vy * 1.5, p.size * 0.35);
                g.fill({ color: p.color, alpha: p.alpha * 0.12 * gf });
                g.circle(p.x, p.y, p.size);
                g.fill({ color: p.color, alpha: p.alpha * 0.35 * gf });
                g.circle(p.x, p.y, p.size * 0.25);
                g.fill({ color: 0xffffff, alpha: p.alpha * 0.1 * gf });
            });
        }

        // ═══════ NOMBRE DE DÉGÂTS POISON ═══════
        const dmgText = new PIXI.Text({
            text: `-${damage}`,
            style: {
                fontFamily: 'Arial Black, Arial',
                fontSize: 52,
                fontWeight: 'bold',
                fill: 0x2ecc71,
                stroke: { color: 0x0a2a0a, width: 6 },
                dropShadow: { color: 0x000000, blur: 4, angle: Math.PI / 4, distance: 3 },
            }
        });
        dmgText.anchor.set(0.5);
        dmgText.position.set(x, y);
        dmgText.alpha = 0;
        dmgText.scale.set(0.3);
        effectContainer.addChild(dmgText);

        const dmgGlow = new PIXI.Graphics();
        dmgGlow.circle(0, 0, 35);
        dmgGlow.fill({ color: 0x2ecc71, alpha: 0.4 });
        dmgGlow.position.set(x, y);
        dmgGlow.alpha = 0;
        effectContainer.addChild(dmgGlow);

        // ═══════ BOUCLE D'ANIMATION ═══════
        let elapsedSec = 0;
        const DUR_SEC = duration / 1000;

        const animate = () => {
            if (effect.finished) return;
            const now = performance.now();
            const elapsed = now - effect.startTime;
            elapsedSec = elapsed / 1000;
            const t = Math.min(elapsed / duration, 1);
            const gf = t > 0.82 ? easeInOutSine((1 - t) / 0.18) : 1;

            const g = new PIXI.Graphics();

            blisters.forEach(b => {
                if (b.phase === 'popped') {
                    b.popRingSize += 1.5;
                    b.popRingAlpha *= 0.93;
                    b.popParticles.forEach(p => {
                        p.x += p.vx; p.y += p.vy;
                        p.vy += p.gravity; p.vx *= p.drag; p.vy *= p.drag;
                        p.alpha -= 0.008;
                    });
                    b.popSplats.forEach(s => {
                        s.scale += (s.targetScale - s.scale) * 0.15;
                        s.alpha -= 0.0015;
                    });
                    drawBlisterPop(g, b, gf);
                    return;
                }

                if (t >= b.growStart && t < b.growEnd) {
                    b.phase = 'growing';
                    const growT = easeOutCubic((t - b.growStart) / b.growDur);
                    b.currentSize = growT;
                    b.alpha = Math.min(growT * 1.5, 1) * 0.85;
                    drawBlister(g, b, elapsedSec, b.currentSize);
                } else if (t >= b.growEnd && t < b.swellStart) {
                    b.phase = 'pulsing';
                    b.currentSize = 1;
                    b.alpha = 0.85;
                    drawBlister(g, b, elapsedSec, 1);
                } else if (t >= b.swellStart && t < b.popAt) {
                    b.phase = 'swelling';
                    b.swellProgress = easeInQuad((t - b.swellStart) / (b.popAt - b.swellStart));
                    b.currentSize = 1;
                    b.alpha = 0.85;
                    b.pulseAmp = 0.05 + b.swellProgress * 0.08;
                    b.pulseSpeed = 6 + b.swellProgress * 12;
                    drawBlister(g, b, elapsedSec, 1);
                } else if (t >= b.popAt && b.phase !== 'popped') {
                    triggerPop(b);
                    drawBlisterPop(g, b, gf);
                }
            });

            blobContainer.addChild(g);
            while (blobContainer.children.length > 2) blobContainer.removeChild(blobContainer.children[0]).destroy();

            // ── Nombre de dégâts (0.3 → 1) ──
            if (t >= 0.3) {
                const dmgT = (t - 0.3) / 0.7;
                if (dmgT < 0.15) {
                    const p = easeOutCubic(dmgT / 0.15);
                    dmgText.scale.set(0.3 + p * 0.9);
                    dmgText.alpha = p;
                    dmgGlow.alpha = p * 0.4;
                } else if (dmgT < 0.55) {
                    dmgText.alpha = 1;
                    const pulse = 1 + Math.sin((dmgT - 0.15) * Math.PI * 4) * 0.05;
                    dmgText.scale.set(1.2 * pulse);
                    dmgGlow.alpha = 0.4;
                } else {
                    const fadeT = (dmgT - 0.55) / 0.45;
                    dmgText.y = y - fadeT * 50;
                    dmgText.alpha = 1 - fadeT;
                    dmgGlow.alpha = (1 - fadeT) * 0.4;
                    dmgGlow.y = y - fadeT * 50;
                    dmgText.scale.set(1.2 - fadeT * 0.3);
                }
            }

            if (t >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        this.screenShake(3, 100);
        return effect;
    }

    /**
     * Animation d'entrave : traînées rouges verticales tombant sur la carte + nombre "-X" qui s'envole.
     * @param {number} x - Centre X de la carte
     * @param {number} y - Centre Y de la carte
     * @param {number} amount - Nombre de marqueurs entrave appliqués
     * @param {number} cardW - Largeur de la carte
     * @param {number} cardH - Hauteur de la carte
     */
    createEntraveEffect(x, y, amount, cardW = 90, cardH = 120) {
        if (!this.initialized) return;

        const effectContainer = new PIXI.Container();
        this.container.addChild(effectContainer);

        const duration = 1400;
        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration,
        };
        this.activeEffects.push(effect);

        const rand = (a, b) => Math.random() * (b - a) + a;
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

        const STREAK_COLOR = 0xcc2222;
        const cardLeft = x - cardW / 2;
        const cardTop = y - cardH / 2;

        // ═══════ MASQUE ═══════
        const mask = new PIXI.Graphics();
        mask.roundRect(cardLeft, cardTop, cardW, cardH, 8);
        mask.fill({ color: 0xffffff });
        effectContainer.addChild(mask);
        const streakContainer = new PIXI.Container();
        streakContainer.mask = mask;
        effectContainer.addChild(streakContainer);

        // ═══════ STREAKS ═══════
        const streaks = [];
        const margin = cardW * 0.05;
        const leftEdge = cardLeft + margin;
        const usableWidth = cardW - margin * 2;

        // ~14 streaks répartis sur la largeur
        const mainCount = 14;
        for (let i = 0; i < mainCount; i++) {
            const baseX = leftEdge + (i / (mainCount - 1)) * usableWidth;
            streaks.push({
                x: baseX + rand(-3, 3),
                y: cardTop - 20 + rand(-25, 25),
                vy: 50 + rand(0, 80),
                accel: 100 + rand(0, 160),
                length: 25 + rand(0, 40),
                thickness: 1.2 + rand(0, 1.8),
                maxLife: 0.7 + rand(0, 0.5),
                delay: rand(0, 0.15),
                baseAlpha: 0.4 + rand(0, 0.25),
                glowSize: 4 + rand(0, 5),
                fadeInEnd: 0.06 + rand(0, 0.06),
                fadeOutStart: 0.35 + rand(0, 0.15),
                life: 0,
                active: false,
                gfx: new PIXI.Graphics(),
            });
        }
        // ~6 streaks supplémentaires décalés
        for (let i = 0; i < 6; i++) {
            streaks.push({
                x: leftEdge + rand(0, usableWidth),
                y: cardTop - 30 + rand(0, 30),
                vy: 40 + rand(0, 60),
                accel: 80 + rand(0, 120),
                length: 18 + rand(0, 28),
                thickness: 0.8 + rand(0, 1.2),
                maxLife: 0.8 + rand(0, 0.4),
                delay: 0.15 + rand(0, 0.25),
                baseAlpha: 0.3 + rand(0, 0.2),
                glowSize: 3 + rand(0, 4),
                fadeInEnd: 0.08 + rand(0, 0.06),
                fadeOutStart: 0.4 + rand(0, 0.15),
                life: 0,
                active: false,
                gfx: new PIXI.Graphics(),
            });
        }
        for (const s of streaks) {
            streakContainer.addChild(s.gfx);
        }

        // ═══════ NOMBRE "-X" QUI S'ENVOLE ═══════
        const flyText = new PIXI.Text({
            text: `-${amount}`,
            style: {
                fontFamily: 'Georgia, serif',
                fontSize: 36,
                fontWeight: 'bold',
                fill: 0xe74c3c,
                stroke: { color: 0x000000, width: 4 },
                dropShadow: { alpha: 0.6, color: 0xff0000, blur: 12, distance: 0 },
            }
        });
        flyText.anchor.set(0.5);
        flyText.x = cardLeft + 25;
        flyText.y = y + cardH * 0.25;
        flyText.alpha = 0;
        flyText.scale.set(0.3);
        effectContainer.addChild(flyText);

        // ═══════ BOUCLE D'ANIMATION ═══════
        const animate = () => {
            if (effect.finished) return;
            const now = performance.now();
            const elapsed = now - effect.startTime;
            const dt = 1 / 60;
            const t = Math.min(elapsed / duration, 1);

            // ── Streaks ──
            for (const s of streaks) {
                if (s.delay > 0) { s.delay -= dt; continue; }
                if (!s.active) s.active = true;
                s.life += dt;
                const st = s.life / s.maxLife;
                if (st >= 1) { s.gfx.visible = false; continue; }

                s.vy += s.accel * dt;
                s.y += s.vy * dt;

                let alpha;
                if (st < s.fadeInEnd) alpha = (st / s.fadeInEnd) ** 2;
                else if (st > s.fadeOutStart) { const fo = (st - s.fadeOutStart) / (1 - s.fadeOutStart); alpha = 1 - fo * fo; }
                else alpha = 1;
                alpha *= s.baseAlpha;

                const lenMul = st < 0.15 ? st / 0.15 : 1;
                const curLen = s.length * lenMul;

                s.gfx.clear();

                // Glow externe
                const glowW = s.thickness + s.glowSize;
                s.gfx.rect(s.x - glowW / 2, s.y, glowW, curLen);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha * 0.12 });

                // Glow moyen
                const midW = s.thickness + s.glowSize * 0.3;
                s.gfx.rect(s.x - midW / 2, s.y, midW, curLen);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha * 0.25 });

                // Core fin en haut
                s.gfx.rect(s.x - s.thickness * 0.3, s.y, s.thickness * 0.6, curLen * 0.5);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha * 0.9 });

                // Core épais en bas
                s.gfx.rect(s.x - s.thickness * 0.5, s.y + curLen * 0.35, s.thickness, curLen * 0.65);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha });
            }

            // ── Fly-off number ──
            const flyT = elapsed / 1000;
            if (flyT < 0.15) {
                flyText.alpha = 1;
                flyText.scale.set(0.3 + (flyT / 0.15) * 0.9);
            } else if (flyT < 0.25) {
                flyText.scale.set(1.2 - ((flyT - 0.15) / 0.1) * 0.2);
            } else {
                flyText.scale.set(1.0);
            }
            flyText.y -= 35 * dt;
            if (flyT > 0.7) flyText.alpha = Math.max(0, flyText.alpha - dt * 2.5);

            if (t >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        return effect;
    }

    // ==================== BUFF EFFECT (ARMES MAGIQUES) ====================
    /**
     * Animation de buff : traînées bleu marine montant depuis le bas de la carte + nombre "+X/+X" qui s'envole.
     * Miroir de l'animation d'entrave : flèches vers le HAUT, couleur bleu marine.
     * @param {number} x - Centre X de la carte
     * @param {number} y - Centre Y de la carte
     * @param {number} atkBuff - Bonus ATK
     * @param {number} hpBuff - Bonus HP
     * @param {number} cardW - Largeur de la carte
     * @param {number} cardH - Hauteur de la carte
     */
    createBuffEffect(x, y, atkBuff = 1, hpBuff = 1, cardW = 90, cardH = 120) {
        if (!this.initialized) return;

        const effectContainer = new PIXI.Container();
        this.container.addChild(effectContainer);

        const duration = 1400;
        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration,
        };
        this.activeEffects.push(effect);

        const rand = (a, b) => Math.random() * (b - a) + a;

        const isDebuff = atkBuff < 0 || hpBuff < 0;
        const STREAK_COLOR = isDebuff ? 0x6b0d0d : 0x0d2f6b;
        const cardLeft = x - cardW / 2;
        const cardTop = y - cardH / 2;
        const cardBottom = y + cardH / 2;

        // ═══════ MASQUE ═══════
        const mask = new PIXI.Graphics();
        mask.roundRect(cardLeft, cardTop, cardW, cardH, 8);
        mask.fill({ color: 0xffffff });
        effectContainer.addChild(mask);
        const streakContainer = new PIXI.Container();
        streakContainer.mask = mask;
        effectContainer.addChild(streakContainer);

        // ═══════ STREAKS (vers le HAUT) ═══════
        const streaks = [];
        const margin = cardW * 0.05;
        const leftEdge = cardLeft + margin;
        const usableWidth = cardW - margin * 2;

        // ~14 streaks répartis sur la largeur
        const mainCount = 14;
        for (let i = 0; i < mainCount; i++) {
            const baseX = leftEdge + (i / (mainCount - 1)) * usableWidth;
            streaks.push({
                x: baseX + rand(-3, 3),
                y: cardBottom + 20 + rand(-25, 25),
                vy: -(50 + rand(0, 80)),
                accel: -(100 + rand(0, 160)),
                length: 25 + rand(0, 40),
                thickness: 1.2 + rand(0, 1.8),
                maxLife: 0.7 + rand(0, 0.5),
                delay: rand(0, 0.15),
                baseAlpha: 0.4 + rand(0, 0.25),
                glowSize: 4 + rand(0, 5),
                fadeInEnd: 0.06 + rand(0, 0.06),
                fadeOutStart: 0.35 + rand(0, 0.15),
                life: 0,
                active: false,
                gfx: new PIXI.Graphics(),
            });
        }
        // ~6 streaks supplémentaires décalés
        for (let i = 0; i < 6; i++) {
            streaks.push({
                x: leftEdge + rand(0, usableWidth),
                y: cardBottom + 30 + rand(-30, 0),
                vy: -(40 + rand(0, 60)),
                accel: -(80 + rand(0, 120)),
                length: 18 + rand(0, 28),
                thickness: 0.8 + rand(0, 1.2),
                maxLife: 0.8 + rand(0, 0.4),
                delay: 0.15 + rand(0, 0.25),
                baseAlpha: 0.3 + rand(0, 0.2),
                glowSize: 3 + rand(0, 4),
                fadeInEnd: 0.08 + rand(0, 0.06),
                fadeOutStart: 0.4 + rand(0, 0.15),
                life: 0,
                active: false,
                gfx: new PIXI.Graphics(),
            });
        }
        for (const s of streaks) {
            streakContainer.addChild(s.gfx);
        }

        // ═══════ NOMBRE "+X/+X" OU "-X/-X" QUI S'ENVOLE ═══════
        const atkStr = atkBuff >= 0 ? `+${atkBuff}` : `${atkBuff}`;
        const hpStr = hpBuff >= 0 ? `+${hpBuff}` : `${hpBuff}`;
        const buffStr = `${atkStr}/${hpStr}`;
        const textColor = isDebuff ? 0xd94a4a : 0x4a90d9;
        const shadowColor = isDebuff ? 0xdb1a1a : 0x1a56db;
        const flyText = new PIXI.Text({
            text: buffStr,
            style: {
                fontFamily: 'Georgia, serif',
                fontSize: 36,
                fontWeight: 'bold',
                fill: textColor,
                stroke: { color: 0x000000, width: 4 },
                dropShadow: { alpha: 0.6, color: shadowColor, blur: 12, distance: 0 },
            }
        });
        flyText.anchor.set(0.5);
        flyText.x = x;
        flyText.y = y + cardH * 0.15;
        flyText.alpha = 0;
        flyText.scale.set(0.3);
        effectContainer.addChild(flyText);

        // ═══════ BOUCLE D'ANIMATION ═══════
        const animate = () => {
            if (effect.finished) return;
            const now = performance.now();
            const elapsed = now - effect.startTime;
            const dt = 1 / 60;
            const t = Math.min(elapsed / duration, 1);

            // ── Streaks (vers le haut) ──
            for (const s of streaks) {
                if (s.delay > 0) { s.delay -= dt; continue; }
                if (!s.active) s.active = true;
                s.life += dt;
                const st = s.life / s.maxLife;
                if (st >= 1) { s.gfx.visible = false; continue; }

                s.vy += s.accel * dt;
                s.y += s.vy * dt;

                let alpha;
                if (st < s.fadeInEnd) alpha = (st / s.fadeInEnd) ** 2;
                else if (st > s.fadeOutStart) { const fo = (st - s.fadeOutStart) / (1 - s.fadeOutStart); alpha = 1 - fo * fo; }
                else alpha = 1;
                alpha *= s.baseAlpha;

                const lenMul = st < 0.15 ? st / 0.15 : 1;
                const curLen = s.length * lenMul;

                s.gfx.clear();

                // Glow externe
                const glowW = s.thickness + s.glowSize;
                s.gfx.rect(s.x - glowW / 2, s.y - curLen, glowW, curLen);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha * 0.12 });

                // Glow moyen
                const midW = s.thickness + s.glowSize * 0.3;
                s.gfx.rect(s.x - midW / 2, s.y - curLen, midW, curLen);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha * 0.25 });

                // Core fin en bas (pointe)
                s.gfx.rect(s.x - s.thickness * 0.3, s.y - curLen * 0.5, s.thickness * 0.6, curLen * 0.5);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha * 0.9 });

                // Core épais en haut (tête)
                s.gfx.rect(s.x - s.thickness * 0.5, s.y - curLen, s.thickness, curLen * 0.65);
                s.gfx.fill({ color: STREAK_COLOR, alpha: alpha });
            }

            // ── Fly-off number (monte vers le haut) ──
            const flyT = elapsed / 1000;
            if (flyT < 0.15) {
                flyText.alpha = 1;
                flyText.scale.set(0.3 + (flyT / 0.15) * 0.9);
            } else if (flyT < 0.25) {
                flyText.scale.set(1.2 - ((flyT - 0.15) / 0.1) * 0.2);
            } else {
                flyText.scale.set(1.0);
            }
            flyText.y -= 35 * dt;
            if (flyT > 0.7) flyText.alpha = Math.max(0, flyText.alpha - dt * 2.5);

            if (t >= 1) {
                effect.finished = true;
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        return effect;
    }

    // ==================== SEARCH SPELL (ARCANE DRAW) ====================

    createSearchSpellEffect(x, y, cardW = 90, cardH = 120) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1200,
        };

        const GOLD = 0xFFD700;
        const BLUE = 0x4488FF;
        const CYAN = 0x66CCFF;
        const WHITE = 0xFFFFFF;

        // --- OUTER ARCANE CIRCLE (rotates clockwise) ---
        const outerCircle = new PIXI.Graphics();
        outerCircle.alpha = 0;
        effectContainer.addChild(outerCircle);

        // --- INNER ARCANE CIRCLE (rotates counter-clockwise) ---
        const innerCircle = new PIXI.Graphics();
        innerCircle.alpha = 0;
        effectContainer.addChild(innerCircle);

        // Draw arcane circle segments (dashes with gaps)
        function drawArcaneRing(gfx, radius, segments, dashRatio, color, width) {
            const anglePerSeg = (Math.PI * 2) / segments;
            const dashAngle = anglePerSeg * dashRatio;
            for (let i = 0; i < segments; i++) {
                const startAngle = i * anglePerSeg;
                const steps = 12;
                for (let s = 0; s < steps; s++) {
                    const a1 = startAngle + (s / steps) * dashAngle;
                    const a2 = startAngle + ((s + 1) / steps) * dashAngle;
                    gfx.moveTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
                    gfx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
                }
                gfx.stroke({ color, width, alpha: 0.8 });
            }
        }

        const outerRadius = cardW * 0.52;
        const innerRadius = cardW * 0.35;
        drawArcaneRing(outerCircle, outerRadius, 8, 0.65, GOLD, 1.8);
        drawArcaneRing(innerCircle, innerRadius, 6, 0.55, CYAN, 1.2);

        // --- RUNE SIGILS orbiting ---
        const runeChars = ['◇', '△', '○', '☆', '◈', '▽'];
        const runes = [];
        for (let i = 0; i < 6; i++) {
            const text = new PIXI.Text({
                text: runeChars[i],
                style: {
                    fontFamily: 'Georgia, serif',
                    fontSize: 12,
                    fill: GOLD,
                    stroke: { color: 0x000000, width: 2 },
                }
            });
            text.anchor.set(0.5);
            text.alpha = 0;
            effectContainer.addChild(text);
            runes.push({
                gfx: text,
                baseAngle: (i / 6) * Math.PI * 2,
                radius: outerRadius * 0.85,
                riseSpeed: 15 + Math.random() * 10,
            });
        }

        // --- SPIRAL PARTICLES (golden sparkles rising) ---
        const particles = [];
        for (let i = 0; i < 24; i++) {
            const g = new PIXI.Graphics();
            const size = 1 + Math.random() * 2;
            g.circle(0, 0, size);
            g.fill({ color: i % 3 === 0 ? GOLD : (i % 3 === 1 ? CYAN : WHITE) });
            g.alpha = 0;
            effectContainer.addChild(g);
            particles.push({
                gfx: g,
                angle: Math.random() * Math.PI * 2,
                radius: 5 + Math.random() * cardW * 0.4,
                speed: 1.5 + Math.random() * 2,
                riseSpeed: 40 + Math.random() * 60,
                startY: (Math.random() - 0.3) * cardH * 0.4,
                delay: Math.random() * 0.3,
                life: 0.4 + Math.random() * 0.4,
            });
        }

        // --- LIGHT BEAM (vertical, centered) ---
        const beam = new PIXI.Graphics();
        beam.alpha = 0;
        effectContainer.addChild(beam);

        // --- CENTER GLOW ---
        const glow = new PIXI.Graphics();
        glow.alpha = 0;
        effectContainer.addChild(glow);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const t = Math.min(elapsed / effect.duration, 1);

            // ===== ARCANE CIRCLES (0 → 0.8) =====
            if (t < 0.8) {
                const ct = t / 0.8;
                const circleAlpha = ct < 0.12 ? ct / 0.12 : (ct > 0.7 ? (1 - ct) / 0.3 : 1);

                outerCircle.alpha = circleAlpha * 0.7;
                outerCircle.rotation = t * Math.PI * 1.5;
                outerCircle.scale.set(0.85 + ct * 0.15);

                innerCircle.alpha = circleAlpha * 0.6;
                innerCircle.rotation = -t * Math.PI * 2.2;
                innerCircle.scale.set(0.9 + ct * 0.1);
            } else {
                outerCircle.alpha = 0;
                innerCircle.alpha = 0;
            }

            // ===== RUNES (0.05 → 0.75) =====
            for (let i = 0; i < runes.length; i++) {
                const r = runes[i];
                const runeStart = 0.05 + i * 0.03;
                const rt = (t - runeStart) / 0.65;
                if (rt < 0 || rt > 1) { r.gfx.alpha = 0; continue; }
                r.gfx.alpha = rt < 0.15 ? rt / 0.15 : (rt > 0.7 ? (1 - rt) / 0.3 : 0.75);
                const angle = r.baseAngle + t * Math.PI * 1.8;
                const currentRadius = r.radius * (1 - rt * 0.3);
                r.gfx.x = Math.cos(angle) * currentRadius;
                r.gfx.y = Math.sin(angle) * currentRadius - rt * r.riseSpeed;
                r.gfx.scale.set(0.8 + Math.sin(rt * Math.PI) * 0.4);
            }

            // ===== SPIRAL PARTICLES (0.1 → 0.9) =====
            for (const p of particles) {
                const pt = (t - p.delay) / p.life;
                if (pt < 0 || pt > 1) { p.gfx.alpha = 0; continue; }
                p.gfx.alpha = pt < 0.15 ? pt / 0.15 : (pt > 0.7 ? (1 - pt) / 0.3 : 0.7);
                const angle = p.angle + pt * Math.PI * 3 * p.speed;
                const shrinkRadius = p.radius * (1 - pt * 0.5);
                p.gfx.x = Math.cos(angle) * shrinkRadius;
                p.gfx.y = p.startY - pt * p.riseSpeed;
                p.gfx.scale.set(1 - pt * 0.5);
            }

            // ===== LIGHT BEAM (0.3 → 0.85) =====
            if (t > 0.3 && t < 0.85) {
                const bt = (t - 0.3) / 0.55;
                beam.clear();
                const beamW = cardW * 0.06;
                const beamH = cardH * 0.9;
                // Outer glow
                beam.rect(-beamW * 2, -beamH * 0.6, beamW * 4, beamH);
                beam.fill({ color: BLUE, alpha: 0.06 });
                // Mid glow
                beam.rect(-beamW, -beamH * 0.6, beamW * 2, beamH);
                beam.fill({ color: CYAN, alpha: 0.1 });
                // Core
                beam.rect(-beamW * 0.3, -beamH * 0.6, beamW * 0.6, beamH);
                beam.fill({ color: WHITE, alpha: 0.2 });
                beam.alpha = bt < 0.15 ? bt / 0.15 : (bt > 0.75 ? (1 - bt) / 0.25 : 1);
            } else {
                beam.alpha = 0;
            }

            // ===== CENTER GLOW (0.2 → 0.7) =====
            if (t > 0.2 && t < 0.7) {
                const gt = (t - 0.2) / 0.5;
                glow.clear();
                const pulse = 1 + Math.sin(gt * Math.PI * 6) * 0.15;
                const r = cardW * 0.18 * pulse;
                glow.circle(0, 0, r * 1.8);
                glow.fill({ color: GOLD, alpha: 0.06 });
                glow.circle(0, 0, r);
                glow.fill({ color: GOLD, alpha: 0.12 });
                glow.circle(0, 0, r * 0.4);
                glow.fill({ color: WHITE, alpha: 0.15 });
                glow.alpha = gt < 0.15 ? gt / 0.15 : (gt > 0.8 ? (1 - gt) / 0.2 : 1);
            } else {
                glow.alpha = 0;
            }

            if (t >= 1) {
                effect.finished = true;
                effectContainer.destroy({ children: true });
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        return effect;
    }

    // ==================== DESTROY (ANNIHILATION SOMBRE) ====================

    createDestroyEffect(x, y, cardW = 90, cardH = 120) {
        const effectContainer = new PIXI.Container();
        effectContainer.position.set(x, y);
        this.container.addChild(effectContainer);

        const effect = {
            container: effectContainer,
            finished: false,
            startTime: performance.now(),
            duration: 1500,
        };

        const PURPLE = 0x9B30FF;
        const DARK_PURPLE = 0x4B0082;
        const CRIMSON = 0xCC1144;
        const WHITE = 0xFFFFFF;

        // --- VORTEX PARTICLES spiraling inward ---
        const vortexParticles = [];
        for (let i = 0; i < 28; i++) {
            const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.3;
            const g = new PIXI.Graphics();
            const r = 1.5 + Math.random() * 2.5;
            g.circle(0, 0, r);
            g.fill({ color: i % 3 === 0 ? CRIMSON : PURPLE });
            g.alpha = 0;
            effectContainer.addChild(g);
            vortexParticles.push({
                gfx: g, startAngle: angle,
                startDist: cardW * 0.6 + Math.random() * cardW * 0.4,
                rotSpeed: 2.5 + Math.random() * 2,
                delay: Math.random() * 0.15,
            });
        }

        // --- CLOSING RING ---
        const ring = new PIXI.Graphics();
        ring.alpha = 0;
        effectContainer.addChild(ring);

        // --- DARK OVERLAY (builds up on card) ---
        const darkOverlay = new PIXI.Graphics();
        darkOverlay.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 6);
        darkOverlay.fill({ color: 0x0a000a });
        darkOverlay.alpha = 0;
        effectContainer.addChild(darkOverlay);

        // --- CRACK LINES from center ---
        const NUM_CRACKS = 7;
        const crackData = [];
        for (let i = 0; i < NUM_CRACKS; i++) {
            const angle = (i / NUM_CRACKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const len = cardW * 0.35 + Math.random() * cardW * 0.25;
            const g = new PIXI.Graphics();
            effectContainer.addChild(g);
            const branches = [];
            const nb = 1 + Math.floor(Math.random() * 2);
            for (let b = 0; b < nb; b++) {
                branches.push({
                    start: 0.25 + Math.random() * 0.5,
                    angle: angle + (Math.random() - 0.5) * 1.4,
                    length: 8 + Math.random() * 18,
                });
            }
            crackData.push({ gfx: g, angle, length: len, branches });
        }

        // --- FLASH ---
        const flash = new PIXI.Graphics();
        flash.roundRect(-cardW / 2 - 5, -cardH / 2 - 5, cardW + 10, cardH + 10, 8);
        flash.fill({ color: WHITE });
        flash.alpha = 0;
        effectContainer.addChild(flash);

        // --- SHATTER SHARDS ---
        const shards = [];
        for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const g = new PIXI.Graphics();
            const s = 3 + Math.random() * 7;
            // Triangle shard
            g.moveTo(0, -s);
            g.lineTo(s * 0.7, s * 0.5);
            g.lineTo(-s * 0.5, s * 0.3);
            g.closePath();
            g.fill({ color: i % 3 === 0 ? 0x333344 : DARK_PURPLE });
            g.alpha = 0;
            g.rotation = Math.random() * Math.PI * 2;
            effectContainer.addChild(g);
            shards.push({
                gfx: g, angle,
                speed: 100 + Math.random() * 160,
                rotSpeed: (Math.random() - 0.5) * 12,
                ox: (Math.random() - 0.5) * cardW * 0.3,
                oy: (Math.random() - 0.5) * cardH * 0.3,
            });
        }

        // --- INNER GLOW PULSE (purple halo) ---
        const innerGlow = new PIXI.Graphics();
        innerGlow.alpha = 0;
        effectContainer.addChild(innerGlow);

        const animate = () => {
            const elapsed = performance.now() - effect.startTime;
            const t = Math.min(elapsed / effect.duration, 1);

            // ===== VORTEX (0 → 0.45): particles spiral inward =====
            for (const p of vortexParticles) {
                const pt = Math.max(0, (t - p.delay) / 0.42);
                if (pt <= 0 || pt > 1) { p.gfx.alpha = 0; continue; }
                const ease = pt * pt * pt; // cubic ease-in — accelerate inward
                const dist = p.startDist * (1 - ease);
                const angle = p.startAngle + pt * Math.PI * 4 * p.rotSpeed;
                p.gfx.x = Math.cos(angle) * dist;
                p.gfx.y = Math.sin(angle) * dist;
                p.gfx.alpha = pt < 0.1 ? pt / 0.1 : (pt > 0.85 ? (1 - pt) / 0.15 : 0.85);
                p.gfx.scale.set(1.2 - ease * 0.8);
            }

            // ===== CLOSING RING (0.08 → 0.48) =====
            if (t > 0.08 && t < 0.48) {
                const rt = (t - 0.08) / 0.4;
                const radius = (cardW * 0.55) * (1 - rt * rt * 0.85);
                ring.clear();
                ring.circle(0, 0, radius);
                ring.stroke({ color: PURPLE, width: 2 + rt * 4, alpha: 0.5 });
                ring.circle(0, 0, radius * 0.65);
                ring.stroke({ color: CRIMSON, width: 1.5 + rt * 2, alpha: 0.35 });
                ring.alpha = rt < 0.15 ? rt / 0.15 : (rt > 0.8 ? (1 - rt) / 0.2 : 1);
            } else {
                ring.alpha = 0;
            }

            // ===== DARK OVERLAY (0.15 → 0.55 builds, 0.55 → 0.75 fades) =====
            if (t > 0.15 && t < 0.75) {
                const dt = (t - 0.15) / 0.4;
                darkOverlay.alpha = t < 0.55 ? Math.min(0.65, dt * 0.65) : 0.65 * (1 - (t - 0.55) / 0.2);
            } else {
                darkOverlay.alpha = 0;
            }

            // ===== INNER GLOW (0.25 → 0.55) =====
            if (t > 0.25 && t < 0.55) {
                const gt = (t - 0.25) / 0.3;
                innerGlow.clear();
                const gr = cardW * 0.2 + gt * cardW * 0.15;
                innerGlow.circle(0, 0, gr);
                innerGlow.fill({ color: PURPLE, alpha: 0.2 + gt * 0.15 });
                innerGlow.circle(0, 0, gr * 0.5);
                innerGlow.fill({ color: WHITE, alpha: 0.08 + gt * 0.08 });
                innerGlow.alpha = gt < 0.15 ? gt / 0.15 : (gt > 0.8 ? (1 - gt) / 0.2 : 1);
            } else {
                innerGlow.alpha = 0;
            }

            // ===== CRACKS (0.28 → 0.65) =====
            if (t > 0.28 && t < 0.65) {
                const ct = Math.min(1, (t - 0.28) / 0.25);
                const fadeAlpha = t > 0.55 ? (0.65 - t) / 0.1 : 1;
                for (const c of crackData) {
                    c.gfx.clear();
                    const len = c.length * ct;
                    const ex = Math.cos(c.angle) * len;
                    const ey = Math.sin(c.angle) * len;

                    // Outer glow
                    c.gfx.moveTo(0, 0); c.gfx.lineTo(ex, ey);
                    c.gfx.stroke({ color: WHITE, width: 5, alpha: 0.15 * fadeAlpha });
                    // Core
                    c.gfx.moveTo(0, 0); c.gfx.lineTo(ex, ey);
                    c.gfx.stroke({ color: PURPLE, width: 2.5, alpha: 0.85 * fadeAlpha });
                    // Bright center
                    c.gfx.moveTo(0, 0); c.gfx.lineTo(ex * 0.5, ey * 0.5);
                    c.gfx.stroke({ color: WHITE, width: 1.5, alpha: 0.5 * fadeAlpha });

                    // Branches
                    if (ct > 0.35) {
                        const bp = (ct - 0.35) / 0.65;
                        for (const br of c.branches) {
                            const bx = Math.cos(c.angle) * c.length * br.start;
                            const by = Math.sin(c.angle) * c.length * br.start;
                            const bex = bx + Math.cos(br.angle) * br.length * bp;
                            const bey = by + Math.sin(br.angle) * br.length * bp;
                            c.gfx.moveTo(bx, by); c.gfx.lineTo(bex, bey);
                            c.gfx.stroke({ color: PURPLE, width: 1.5, alpha: 0.6 * fadeAlpha });
                        }
                    }
                }
            } else {
                for (const c of crackData) c.gfx.alpha = 0;
            }

            // ===== FLASH (0.42 → 0.58) =====
            if (t > 0.42 && t < 0.58) {
                const ft = (t - 0.42) / 0.16;
                flash.alpha = ft < 0.25 ? (ft / 0.25) * 0.85 : 0.85 * (1 - (ft - 0.25) / 0.75);
            } else {
                flash.alpha = 0;
            }

            // ===== SHARDS (0.5 → 1.0): fragments burst outward =====
            if (t > 0.5) {
                const sht = (t - 0.5) / 0.5;
                for (const s of shards) {
                    s.gfx.alpha = sht < 0.08 ? sht / 0.08 : Math.max(0, 1 - (sht - 0.15) / 0.55);
                    const dist = sht * sht * s.speed * 0.012;
                    s.gfx.x = s.ox + Math.cos(s.angle) * dist * cardW;
                    s.gfx.y = s.oy + Math.sin(s.angle) * dist * cardH;
                    s.gfx.rotation += s.rotSpeed * 0.016;
                }
            }

            if (t >= 1) {
                effect.finished = true;
                effectContainer.destroy({ children: true });
            } else {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
        return effect;
    }
}

// Instance globale (GameVFX est le nom principal, CombatVFX est un alias rétrocompat)
const GameVFX = new GameVFXSystem();
GameVFX.getActiveCount = function() {
    return this.activeEffects.length + this.activeShields.size + this.activeCamouflages.size;
};
const CombatVFX = GameVFX;

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
        SleepAnimations.init().catch(() => {});
    }, 1000);
});
