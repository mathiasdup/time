// =============================================
// Animation de défausse professionnelle (PixiJS)
// =============================================
// Quand la main est pleine, la carte tente d'aller vers la main,
// est rejetée, puis vole vers le cimetière avec des effets visuels

class DiscardVFX {
    constructor() {
        this.app = null;
        this.container = null;
        this.initialized = false;
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
                autoDensity: true
            });

            this.app.canvas.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 9999;
            `;

            this.container = new PIXI.Container();
            this.app.stage.addChild(this.container);

            this.initialized = true;
            console.log('[DiscardVFX] Initialized');
        } catch (e) {
            console.error('[DiscardVFX] Init error:', e);
        }
    }

    show() {
        if (this.app?.canvas && !this.app.canvas.parentNode) {
            document.body.appendChild(this.app.canvas);
        }
    }

    hide() {
        if (this.app?.canvas?.parentNode) {
            this.app.canvas.parentNode.removeChild(this.app.canvas);
        }
    }

    /**
     * Animation de défausse complète style Magic Arena
     * La carte tente d'aller vers la main, est rejetée, puis va au cimetière
     */
    async animateFullHandDiscard(cardRect, handRect, graveyardRect, owner, cardData) {
        await this.init();
        this.show();

        return new Promise((resolve) => {
            const effectContainer = new PIXI.Container();
            this.container.addChild(effectContainer);

            const startX = cardRect.left + cardRect.width / 2;
            const startY = cardRect.top + cardRect.height / 2;
            const handX = handRect.left + handRect.width / 2;
            const handY = handRect.top + handRect.height / 2;
            const graveX = graveyardRect.left + graveyardRect.width / 2;
            const graveY = graveyardRect.top + graveyardRect.height / 2;

            // Créer la représentation de la carte
            const cardSprite = this.createCardVisual(cardRect.width, cardRect.height, cardData);
            cardSprite.position.set(startX, startY);
            cardSprite.pivot.set(cardRect.width / 2, cardRect.height / 2);
            effectContainer.addChild(cardSprite);

            // Particules de traînée
            const trailParticles = [];

            // Texte "MAIN PLEINE" qui apparaît
            const warningText = new PIXI.Text({
                text: 'MAIN PLEINE',
                style: {
                    fontFamily: 'Cinzel, serif',
                    fontSize: 32,
                    fontWeight: 'bold',
                    fill: 0xff4444,
                    stroke: { color: 0x000000, width: 4 },
                    dropShadow: {
                        color: 0xff0000,
                        blur: 10,
                        distance: 0
                    }
                }
            });
            warningText.anchor.set(0.5);
            warningText.position.set(handX, handY - 80);
            warningText.alpha = 0;
            warningText.scale.set(0.5);
            effectContainer.addChild(warningText);

            // Icône X de rejet
            const rejectIcon = this.createRejectIcon();
            rejectIcon.position.set(handX, handY);
            rejectIcon.alpha = 0;
            rejectIcon.scale.set(0);
            effectContainer.addChild(rejectIcon);

            // Aura de blocage autour de la main
            const blockAura = this.createBlockAura(handRect.width + 40, handRect.height + 40);
            blockAura.position.set(handX, handY);
            blockAura.alpha = 0;
            effectContainer.addChild(blockAura);

            // Timeline de l'animation
            const duration = 2200; // Durée totale
            const startTime = performance.now();

            // Phases:
            // 0-400ms: La carte se déplace vers la main avec anticipation
            // 400-700ms: Rejet - la carte rebondit, texte et icône X apparaissent
            // 700-1200ms: Pause dramatique avec shake
            // 1200-2000ms: Vol vers le cimetière avec traînée
            // 2000-2200ms: Impact au cimetière

            const phase1End = 400;   // Vers la main
            const phase2End = 700;   // Rejet
            const phase3End = 1200;  // Pause
            const phase4End = 2000;  // Vol vers cimetière
            const phase5End = 2200;  // Impact

            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                if (elapsed < phase1End) {
                    // Phase 1: Vers la main avec anticipation
                    const t = elapsed / phase1End;
                    const eased = this.easeOutCubic(t);

                    // Position avec légère courbe vers le haut
                    const midY = Math.min(startY, handY) - 50;
                    const currentX = startX + (handX - startX) * eased;
                    const currentY = this.quadraticBezier(startY, midY, handY, eased);

                    cardSprite.position.set(currentX, currentY);
                    cardSprite.scale.set(1 + 0.1 * Math.sin(t * Math.PI)); // Léger grossissement
                    cardSprite.rotation = 0.05 * Math.sin(t * Math.PI * 2); // Légère oscillation

                    // Traînée dorée pendant le mouvement
                    if (Math.random() < 0.3) {
                        this.addTrailParticle(effectContainer, trailParticles, currentX, currentY, 0xffd700, 0.7);
                    }

                } else if (elapsed < phase2End) {
                    // Phase 2: Rejet avec rebond
                    const t = (elapsed - phase1End) / (phase2End - phase1End);

                    // Rebond vers l'arrière
                    const bounceX = handX + (startX - handX) * 0.3 * this.easeOutBack(t);
                    const bounceY = handY - 30 * Math.sin(t * Math.PI);

                    cardSprite.position.set(bounceX, bounceY);
                    cardSprite.rotation = -0.2 * Math.sin(t * Math.PI); // Rotation de rejet
                    cardSprite.scale.set(1 - 0.1 * t); // Léger rétrécissement

                    // Flash rouge sur la carte
                    cardSprite.tint = this.lerpColor(0xffffff, 0xff6666, Math.sin(t * Math.PI));

                    // Aura de blocage apparaît
                    blockAura.alpha = this.easeOutCubic(t) * 0.8;

                    // Icône X apparaît
                    rejectIcon.alpha = this.easeOutCubic(t);
                    rejectIcon.scale.set(this.easeOutBack(t) * 1.5);

                    // Texte warning apparaît
                    warningText.alpha = this.easeOutCubic(t);
                    warningText.scale.set(0.5 + 0.5 * this.easeOutBack(t));

                    // Particules rouges d'impact
                    if (t < 0.3 && Math.random() < 0.5) {
                        this.addImpactParticle(effectContainer, trailParticles, handX, handY);
                    }

                } else if (elapsed < phase3End) {
                    // Phase 3: Pause dramatique avec shake
                    const t = (elapsed - phase2End) / (phase3End - phase2End);

                    const shakeIntensity = 3 * (1 - t);
                    const shakeX = (Math.random() - 0.5) * shakeIntensity;
                    const shakeY = (Math.random() - 0.5) * shakeIntensity;

                    const baseX = handX + (startX - handX) * 0.3;
                    cardSprite.position.set(baseX + shakeX, handY - 30 + shakeY);

                    // Fade out progressif des éléments de rejet
                    const fadeOut = 1 - this.easeInCubic(t);
                    blockAura.alpha = 0.8 * fadeOut;
                    rejectIcon.alpha = fadeOut;
                    warningText.alpha = fadeOut;

                    // Retour à la couleur normale
                    cardSprite.tint = 0xffffff;

                } else if (elapsed < phase4End) {
                    // Phase 4: Vol vers le cimetière
                    const t = (elapsed - phase3End) / (phase4End - phase3End);
                    const eased = this.easeInOutCubic(t);

                    const baseX = handX + (startX - handX) * 0.3;

                    // Courbe de Bézier vers le cimetière
                    const controlX = (baseX + graveX) / 2 + (owner === 'me' ? 100 : -100);
                    const controlY = Math.min(handY, graveY) - 150;

                    const currentX = this.quadraticBezierPoint(baseX, controlX, graveX, eased);
                    const currentY = this.quadraticBezierPoint(handY - 30, controlY, graveY, eased);

                    cardSprite.position.set(currentX, currentY);
                    cardSprite.scale.set(1 - 0.5 * eased); // Rétrécissement progressif
                    cardSprite.rotation = (owner === 'me' ? 1 : -1) * Math.PI * 0.5 * eased; // Rotation vers le cimetière
                    cardSprite.alpha = 1 - 0.3 * eased;

                    // Effet de vitesse/luminosité
                    const brightness = 1 + 0.5 * Math.sin(t * Math.PI);
                    cardSprite.tint = this.lerpColor(0xffffff, 0xaaddff, brightness - 1);

                    // Traînée bleue/violette
                    if (Math.random() < 0.6) {
                        const trailColor = Math.random() < 0.5 ? 0x8866ff : 0x44aaff;
                        this.addTrailParticle(effectContainer, trailParticles, currentX, currentY, trailColor, 0.9);
                    }

                    // Cacher les éléments de rejet
                    blockAura.alpha = 0;
                    rejectIcon.alpha = 0;
                    warningText.alpha = 0;

                } else {
                    // Phase 5: Impact au cimetière
                    const t = (elapsed - phase4End) / (phase5End - phase4End);

                    cardSprite.position.set(graveX, graveY);
                    cardSprite.scale.set(0.5 * (1 - this.easeInCubic(t)));
                    cardSprite.alpha = 1 - this.easeInCubic(t);

                    // Explosion de particules au cimetière
                    if (t < 0.3 && Math.random() < 0.8) {
                        this.addGraveyardImpactParticle(effectContainer, trailParticles, graveX, graveY);
                    }
                }

                // Update des particules de traînée
                this.updateTrailParticles(trailParticles);

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Cleanup
                    setTimeout(() => {
                        effectContainer.destroy({ children: true });
                        this.hide();
                        resolve();
                    }, 100);
                }
            };

            requestAnimationFrame(animate);
        });
    }

    /**
     * Crée un visuel de carte simplifié pour l'animation
     */
    createCardVisual(width, height, cardData) {
        const container = new PIXI.Container();

        // Fond de carte
        const bg = new PIXI.Graphics();
        bg.roundRect(0, 0, width, height, 8);
        bg.fill({ color: 0x1a1a2e });
        bg.stroke({ width: 2, color: 0x4a4a6a });
        container.addChild(bg);

        // Si on a des données de carte, afficher l'image
        if (cardData && cardData.image) {
            // Charger et afficher l'image (async)
            PIXI.Assets.load(`/cards/${cardData.image}`).then(texture => {
                const sprite = new PIXI.Sprite(texture);
                sprite.width = width - 4;
                sprite.height = height - 4;
                sprite.position.set(2, 2);

                // Masque arrondi
                const mask = new PIXI.Graphics();
                mask.roundRect(2, 2, width - 4, height - 4, 6);
                mask.fill({ color: 0xffffff });
                sprite.mask = mask;
                container.addChild(mask);
                container.addChildAt(sprite, 1);
            }).catch(() => {
                // Fallback: gradient coloré
                this.addFallbackGradient(container, width, height);
            });
        } else {
            this.addFallbackGradient(container, width, height);
        }

        // Bordure brillante
        const border = new PIXI.Graphics();
        border.roundRect(0, 0, width, height, 8);
        border.stroke({ width: 3, color: 0xffd700 });
        container.addChild(border);

        return container;
    }

    addFallbackGradient(container, width, height) {
        const gradient = new PIXI.Graphics();
        gradient.roundRect(4, 4, width - 8, height - 8, 4);
        gradient.fill({ color: 0x2a2a4e });
        container.addChild(gradient);
    }

    /**
     * Crée l'icône X de rejet
     */
    createRejectIcon() {
        const container = new PIXI.Container();

        // Cercle rouge
        const circle = new PIXI.Graphics();
        circle.circle(0, 0, 40);
        circle.fill({ color: 0xff3333, alpha: 0.9 });
        circle.stroke({ width: 4, color: 0xffffff });
        container.addChild(circle);

        // X
        const x = new PIXI.Graphics();
        x.moveTo(-15, -15);
        x.lineTo(15, 15);
        x.moveTo(15, -15);
        x.lineTo(-15, 15);
        x.stroke({ width: 6, color: 0xffffff });
        container.addChild(x);

        return container;
    }

    /**
     * Crée l'aura de blocage
     */
    createBlockAura(width, height) {
        const container = new PIXI.Container();

        // Plusieurs couches de glow
        for (let i = 3; i >= 0; i--) {
            const aura = new PIXI.Graphics();
            const expansion = i * 8;
            aura.roundRect(-width/2 - expansion, -height/2 - expansion, width + expansion*2, height + expansion*2, 12 + i*2);
            aura.stroke({ width: 3 - i*0.5, color: 0xff4444, alpha: 0.3 - i*0.05 });
            container.addChild(aura);
        }

        return container;
    }

    /**
     * Ajoute une particule de traînée
     */
    addTrailParticle(container, particles, x, y, color, intensity) {
        const particle = new PIXI.Graphics();
        const size = 4 + Math.random() * 6;
        particle.circle(0, 0, size);
        particle.fill({ color: color, alpha: intensity });
        particle.position.set(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20);

        container.addChild(particle);
        particles.push({
            graphic: particle,
            life: 1,
            decay: 0.03 + Math.random() * 0.02,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2
        });
    }

    /**
     * Ajoute une particule d'impact (rejet)
     */
    addImpactParticle(container, particles, x, y) {
        const particle = new PIXI.Graphics();
        const size = 6 + Math.random() * 8;
        particle.circle(0, 0, size);
        particle.fill({ color: 0xff4444, alpha: 0.9 });
        particle.position.set(x, y);

        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 5;

        container.addChild(particle);
        particles.push({
            graphic: particle,
            life: 1,
            decay: 0.04,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed
        });
    }

    /**
     * Ajoute une particule d'impact au cimetière
     */
    addGraveyardImpactParticle(container, particles, x, y) {
        const particle = new PIXI.Graphics();
        const size = 5 + Math.random() * 10;

        // Couleur violette/bleue mystique
        const colors = [0x8866ff, 0x44aaff, 0xaa44ff, 0x6644ff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        particle.circle(0, 0, size);
        particle.fill({ color: color, alpha: 0.9 });
        particle.position.set(x, y);

        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 8;

        container.addChild(particle);
        particles.push({
            graphic: particle,
            life: 1,
            decay: 0.025,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2 // Légère montée
        });
    }

    /**
     * Met à jour les particules de traînée
     */
    updateTrailParticles(particles) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= p.decay;
            p.graphic.alpha = p.life;
            p.graphic.scale.set(p.life);
            p.graphic.position.x += p.vx;
            p.graphic.position.y += p.vy;
            p.vy += 0.1; // Gravité légère

            if (p.life <= 0) {
                p.graphic.destroy();
                particles.splice(i, 1);
            }
        }
    }

    // Fonctions d'easing
    easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    easeInCubic(t) { return t * t * t; }
    easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    easeOutBack(t) { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

    // Interpolation de couleur
    lerpColor(c1, c2, t) {
        const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
        const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return (r << 16) | (g << 8) | b;
    }

    // Bézier quadratique
    quadraticBezier(p0, p1, p2, t) {
        return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
    }

    quadraticBezierPoint(p0, p1, p2, t) {
        return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
    }

    /**
     * Animation de burn - Style désintégration élégante
     * La carte monte au centre, se désintègre en particules qui spiralent vers le cimetière
     * Durée totale: ~1.4 secondes
     */
    async animateBurnFromDeck(deckRect, handRect, graveyardRect, owner, cardData) {
        await this.init();
        this.show();

        return new Promise((resolve) => {
            const effectContainer = new PIXI.Container();
            this.container.addChild(effectContainer);

            const startX = deckRect.left + deckRect.width / 2;
            const startY = deckRect.top + deckRect.height / 2;
            const graveX = graveyardRect.left + graveyardRect.width / 2;
            const graveY = graveyardRect.top + graveyardRect.height / 2;
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;

            const cardWidth = 110;
            const cardHeight = 154;

            // Carte principale
            const cardSprite = this.createCardVisual(cardWidth, cardHeight, cardData);
            cardSprite.position.set(startX, startY);
            cardSprite.pivot.set(cardWidth / 2, cardHeight / 2);
            cardSprite.alpha = 0;
            cardSprite.scale.set(0.5);
            effectContainer.addChild(cardSprite);

            // Particules de désintégration
            const particles = [];
            let particlesSpawned = false;

            // Durée: 1s total
            const duration = 1000;
            const startTime = performance.now();

            // Phases:
            // 0-180ms: Montée rapide au centre
            // 180-350ms: Pause + flash
            // 350-1000ms: Désintégration vers cimetière

            const phase1End = 180;
            const phase2End = 350;

            const animate = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                if (elapsed < phase1End) {
                    // Phase 1: Montée au centre
                    const t = elapsed / phase1End;
                    const eased = this.easeOutQuart(t);

                    cardSprite.position.set(
                        startX + (centerX - startX) * eased,
                        startY + (centerY - startY) * eased
                    );
                    cardSprite.alpha = Math.min(1, t * 2);
                    cardSprite.scale.set(0.5 + 0.7 * eased);

                } else if (elapsed < phase2End) {
                    // Phase 2: Pause au centre avec léger flash
                    const t = (elapsed - phase1End) / (phase2End - phase1End);

                    cardSprite.position.set(centerX, centerY);
                    cardSprite.scale.set(1.2);
                    cardSprite.alpha = 1;

                    // Flash blanc subtil
                    const flashIntensity = Math.sin(t * Math.PI);
                    cardSprite.tint = this.lerpColor(0xffffff, 0xffeedd, flashIntensity * 0.3);

                } else {
                    // Phase 3: Désintégration
                    const t = (elapsed - phase2End) / (duration - phase2End);
                    const eased = this.easeInQuart(t);

                    // Spawn des particules une seule fois au début de la désintégration
                    if (!particlesSpawned) {
                        particlesSpawned = true;
                        this.spawnDisintegrationParticles(effectContainer, particles, centerX, centerY, cardWidth, cardHeight, graveX, graveY);
                    }

                    // Carte disparaît rapidement
                    cardSprite.alpha = Math.max(0, 1 - t * 3);
                    cardSprite.scale.set(1.2 * (1 - eased * 0.3));

                    // Légère distorsion
                    if (t < 0.3) {
                        cardSprite.tint = this.lerpColor(0xffffff, 0xffaa66, t * 2);
                    }
                }

                // Update particules
                this.updateDisintegrationParticles(particles, graveX, graveY, progress);

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Cleanup après un court délai pour laisser les particules finir
                    setTimeout(() => {
                        effectContainer.destroy({ children: true });
                        this.hide();
                        resolve();
                    }, 50);
                }
            };

            requestAnimationFrame(animate);
        });
    }

    /**
     * Crée les particules de désintégration
     */
    spawnDisintegrationParticles(container, particles, cx, cy, width, height, targetX, targetY) {
        const count = 60; // Nombre de particules
        const colors = [0xffcc66, 0xffaa44, 0xff8833, 0xffdd88, 0xffffff];

        for (let i = 0; i < count; i++) {
            const particle = new PIXI.Graphics();

            // Position initiale dans la zone de la carte
            const offsetX = (Math.random() - 0.5) * width;
            const offsetY = (Math.random() - 0.5) * height;
            const x = cx + offsetX;
            const y = cy + offsetY;

            // Taille variable
            const size = 2 + Math.random() * 5;
            const color = colors[Math.floor(Math.random() * colors.length)];

            particle.circle(0, 0, size);
            particle.fill({ color: color });
            particle.position.set(x, y);
            particle.alpha = 0;

            container.addChild(particle);

            // Propriétés de la particule
            const angle = Math.atan2(targetY - y, targetX - x);
            const distance = Math.sqrt((targetX - x) ** 2 + (targetY - y) ** 2);

            particles.push({
                graphic: particle,
                startX: x,
                startY: y,
                targetX: targetX,
                targetY: targetY,
                angle: angle,
                distance: distance,
                delay: Math.random() * 0.2, // Délai de départ
                speed: 0.6 + Math.random() * 0.4,
                spiral: (Math.random() - 0.5) * 2, // Amplitude spirale
                size: size
            });
        }
    }

    /**
     * Met à jour les particules de désintégration
     */
    updateDisintegrationParticles(particles, targetX, targetY, globalProgress) {
        for (const p of particles) {
            // Calculer la progression locale de cette particule
            const localProgress = Math.max(0, Math.min(1, (globalProgress - 0.35 - p.delay) / (0.65 * p.speed)));

            if (localProgress <= 0) {
                p.graphic.alpha = 0;
                continue;
            }

            const eased = this.easeInOutCubic(localProgress);

            // Mouvement en spirale vers la cible
            const spiralAngle = p.angle + p.spiral * Math.sin(localProgress * Math.PI * 2);
            const currentDistance = p.distance * (1 - eased);

            const x = targetX - Math.cos(spiralAngle) * currentDistance;
            const y = targetY - Math.sin(spiralAngle) * currentDistance;

            p.graphic.position.set(x, y);

            // Alpha: apparaît puis disparaît
            if (localProgress < 0.2) {
                p.graphic.alpha = localProgress * 5;
            } else if (localProgress > 0.7) {
                p.graphic.alpha = (1 - localProgress) * 3.33;
            } else {
                p.graphic.alpha = 1;
            }

            // Rétrécit vers la fin
            const scale = localProgress > 0.6 ? (1 - localProgress) * 2.5 : 1;
            p.graphic.scale.set(scale);
        }
    }

    easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
    easeInQuart(t) { return t * t * t * t; }
}

// Instance globale
window.discardVFX = new DiscardVFX();
