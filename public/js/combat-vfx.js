/**
 * Game VFX System - Effets visuels GPU via PixiJS 8
 * Gère les effets visuels ponctuels : particules, explosions, trails, rings
 * Le canvas overlay est transparent et superposé au DOM (pointer-events: none)
 */

class GameVFXSystem {
    constructor() {
        this.app = null;
        this.container = null;       // Effets ponctuels (explosions, impacts)
        this.shieldLayer = null;     // Couche persistante pour les boucliers
        this.initialized = false;
        this.activeEffects = [];
        this.activeShields = new Map(); // slotKey → { container, element, startTime }
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

            this.shieldLayer = new PIXI.Container();
            this.app.stage.addChild(this.shieldLayer);

            this.container = new PIXI.Container();
            this.app.stage.addChild(this.container);

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
    }

    update() {
        // Nettoyer les effets ponctuels terminés
        this.activeEffects = this.activeEffects.filter(effect => {
            if (effect.finished) {
                if (effect.container && effect.container.parent) {
                    effect.container.parent.removeChild(effect.container);
                }
                return false;
            }
            return true;
        });

        // Mettre à jour les boucliers persistants
        this.updateShields();
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
                const p = progress / 0.1;
                text.scale.set(0.3 + p * 0.9);
                text.alpha = p;
                glow.alpha = p * 0.3;
            } else if (progress < 0.5) {
                text.alpha = 1;
                const pulse = 1 + Math.sin((progress - 0.1) * Math.PI * 4) * 0.05;
                text.scale.set(1.1 * pulse);
                glow.alpha = 0.3;
            } else {
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
}

// Instance globale (GameVFX est le nom principal, CombatVFX est un alias rétrocompat)
const GameVFX = new GameVFXSystem();
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
