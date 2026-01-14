/**
 * Système d'animation PixiJS pour Bataille des Héros
 * Animations style Hearthstone / Magic Arena
 */

const GameAnimations = (function() {
    let app = null;
    let isInitialized = false;
    
    // Configuration
    const CONFIG = {
        cardWidth: 90,
        cardHeight: 130,
        drawDuration: 600,
        glowColor: 0xffd700,
        cardBackColor: 0x4a3728,
        cardBorderColor: 0x8b7355
    };
    
    /**
     * Initialise PixiJS
     */
    function init() {
        if (isInitialized) return Promise.resolve();
        
        return new Promise((resolve) => {
            const canvas = document.getElementById('animation-canvas');
            if (!canvas) {
                console.warn('Canvas d\'animation non trouvé');
                resolve();
                return;
            }
            
            app = new PIXI.Application({
                view: canvas,
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundAlpha: 0,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true
            });
            
            // Redimensionnement
            window.addEventListener('resize', () => {
                if (app) {
                    app.renderer.resize(window.innerWidth, window.innerHeight);
                }
            });
            
            isInitialized = true;
            console.log('🎮 PixiJS initialisé pour les animations');
            resolve();
        });
    }
    
    /**
     * Crée une carte graphique pour l'animation
     */
    function createCardGraphic(card, showBack = true) {
        const container = new PIXI.Container();
        
        // Ombre
        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, 0.3);
        shadow.drawRoundedRect(4, 4, CONFIG.cardWidth, CONFIG.cardHeight, 8);
        shadow.endFill();
        container.addChild(shadow);
        
        // Fond de carte
        const cardBg = new PIXI.Graphics();
        if (showBack) {
            // Dos de carte
            cardBg.beginFill(CONFIG.cardBackColor);
            cardBg.lineStyle(3, CONFIG.cardBorderColor);
            cardBg.drawRoundedRect(0, 0, CONFIG.cardWidth, CONFIG.cardHeight, 8);
            cardBg.endFill();
            
            // Motif décoratif
            const pattern = new PIXI.Graphics();
            pattern.lineStyle(2, 0x5a4738, 0.5);
            pattern.drawRoundedRect(10, 10, CONFIG.cardWidth - 20, CONFIG.cardHeight - 20, 4);
            pattern.moveTo(CONFIG.cardWidth / 2, 20);
            pattern.lineTo(CONFIG.cardWidth / 2, CONFIG.cardHeight - 20);
            pattern.moveTo(20, CONFIG.cardHeight / 2);
            pattern.lineTo(CONFIG.cardWidth - 20, CONFIG.cardHeight / 2);
            container.addChild(pattern);
        } else {
            // Face de carte
            const bgColor = card?.type === 'spell' ? 0x4a3a6a : 
                           card?.type === 'trap' ? 0x6a3a3a : 0x3a4a3a;
            cardBg.beginFill(bgColor);
            cardBg.lineStyle(3, 0xaaaaaa);
            cardBg.drawRoundedRect(0, 0, CONFIG.cardWidth, CONFIG.cardHeight, 8);
            cardBg.endFill();
            
            // Icône
            if (card?.icon) {
                const icon = new PIXI.Text(card.icon, {
                    fontSize: 32,
                    fill: 0xffffff
                });
                icon.anchor.set(0.5);
                icon.x = CONFIG.cardWidth / 2;
                icon.y = CONFIG.cardHeight / 2 - 15;
                container.addChild(icon);
            }
            
            // Nom
            if (card?.name) {
                const name = new PIXI.Text(card.name, {
                    fontSize: 10,
                    fill: 0xffffff,
                    fontWeight: 'bold',
                    wordWrap: true,
                    wordWrapWidth: CONFIG.cardWidth - 10
                });
                name.anchor.set(0.5);
                name.x = CONFIG.cardWidth / 2;
                name.y = CONFIG.cardHeight - 25;
                container.addChild(name);
            }
            
            // Stats pour créatures
            if (card?.type === 'creature') {
                const stats = new PIXI.Text(`⚔️${card.atk}  ❤️${card.hp}`, {
                    fontSize: 11,
                    fill: 0xffffff
                });
                stats.anchor.set(0.5);
                stats.x = CONFIG.cardWidth / 2;
                stats.y = CONFIG.cardHeight - 12;
                container.addChild(stats);
            }
        }
        container.addChildAt(cardBg, 0);
        
        // Pivot au centre
        container.pivot.set(CONFIG.cardWidth / 2, CONFIG.cardHeight / 2);
        
        return container;
    }
    
    /**
     * Crée un effet de glow autour d'une carte
     */
    function createGlow(container, color = CONFIG.glowColor, intensity = 1) {
        const glow = new PIXI.Graphics();
        glow.beginFill(color, 0.3 * intensity);
        glow.drawRoundedRect(-10, -10, CONFIG.cardWidth + 20, CONFIG.cardHeight + 20, 12);
        glow.endFill();
        
        // Filtre de blur pour l'effet glow
        const blurFilter = new PIXI.BlurFilter();
        blurFilter.blur = 15;
        glow.filters = [blurFilter];
        
        container.addChildAt(glow, 0);
        return glow;
    }
    
    /**
     * Easing functions
     */
    const Easing = {
        easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
        easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
        easeOutBack: (t) => {
            const c1 = 1.70158;
            const c3 = c1 + 1;
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        },
        easeOutElastic: (t) => {
            const c4 = (2 * Math.PI) / 3;
            return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
        }
    };
    
    /**
     * Interpole une courbe de Bézier quadratique
     */
    function bezierQuadratic(t, p0, p1, p2) {
        const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        return { x, y };
    }
    
    /**
     * Obtient la position d'un élément DOM
     */
    function getDOMPosition(selector) {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }
    
    /**
     * Animation de pioche - Style Hearthstone
     * @param {Object} card - La carte piochée
     * @param {string} owner - 'me' ou 'opp'
     * @param {number} handIndex - Position dans la main
     */
    async function animateDraw(card, owner, handIndex = 0) {
        if (!isInitialized || !app) {
            await init();
            if (!app) return;
        }
        
        return new Promise((resolve) => {
            // Positions
            const deckPos = getDOMPosition(`#${owner}-deck-stack`);
            const handPos = owner === 'me' 
                ? { x: window.innerWidth / 2 + (handIndex - 3) * 95, y: window.innerHeight - 80 }
                : { x: window.innerWidth / 2 + (handIndex - 3) * 60, y: 80 };
            
            if (!deckPos) {
                resolve();
                return;
            }
            
            // Créer la carte (dos d'abord)
            const cardContainer = createCardGraphic(card, true);
            cardContainer.x = deckPos.x;
            cardContainer.y = deckPos.y;
            cardContainer.scale.set(0.8);
            cardContainer.alpha = 0;
            
            // Ajouter le glow
            const glow = createGlow(cardContainer, CONFIG.glowColor, 0);
            
            app.stage.addChild(cardContainer);
            
            // Point de contrôle pour la courbe (arc vers le haut)
            const controlPoint = {
                x: (deckPos.x + handPos.x) / 2,
                y: Math.min(deckPos.y, handPos.y) - 150
            };
            
            // Animation
            let elapsed = 0;
            const duration = CONFIG.drawDuration;
            let hasFlipped = false;
            
            const ticker = (delta) => {
                elapsed += delta * (1000 / 60);
                const progress = Math.min(elapsed / duration, 1);
                
                // Easing
                const easedProgress = Easing.easeOutCubic(progress);
                
                // Position sur la courbe de Bézier
                const pos = bezierQuadratic(easedProgress, deckPos, controlPoint, handPos);
                cardContainer.x = pos.x;
                cardContainer.y = pos.y;
                
                // Apparition rapide
                cardContainer.alpha = Math.min(progress * 4, 1);
                
                // Scale avec effet "pop"
                const scaleProgress = Easing.easeOutBack(Math.min(progress * 1.5, 1));
                const baseScale = owner === 'me' ? 1 : 0.7;
                cardContainer.scale.set(0.8 + scaleProgress * (baseScale - 0.8));
                
                // Rotation légère pendant le mouvement
                cardContainer.rotation = Math.sin(progress * Math.PI) * 0.15;
                
                // Glow qui pulse
                if (glow) {
                    glow.alpha = Math.sin(progress * Math.PI) * 0.8;
                }
                
                // Flip à mi-parcours pour révéler la carte (seulement pour le joueur)
                if (owner === 'me' && progress > 0.4 && !hasFlipped) {
                    hasFlipped = true;
                    // Recréer avec la face visible
                    cardContainer.removeChildren();
                    const faceCard = createCardGraphic(card, false);
                    // Transférer les enfants
                    while (faceCard.children.length > 0) {
                        cardContainer.addChild(faceCard.children[0]);
                    }
                    createGlow(cardContainer, CONFIG.glowColor, 0.5);
                }
                
                // Fin de l'animation
                if (progress >= 1) {
                    app.ticker.remove(ticker);
                    
                    // Fade out
                    const fadeOut = (delta) => {
                        cardContainer.alpha -= delta * 0.15;
                        if (cardContainer.alpha <= 0) {
                            app.ticker.remove(fadeOut);
                            app.stage.removeChild(cardContainer);
                            resolve();
                        }
                    };
                    app.ticker.add(fadeOut);
                }
            };
            
            app.ticker.add(ticker);
        });
    }
    
    /**
     * Animation de pioche multiple
     */
    async function animateMultipleDraw(cards, owner) {
        for (let i = 0; i < cards.length; i++) {
            await animateDraw(cards[i], owner, i);
            await sleep(100);
        }
    }
    
    /**
     * Effet de particules (pour plus tard)
     */
    function createParticles(x, y, color, count = 10) {
        if (!app) return;
        
        const particles = [];
        for (let i = 0; i < count; i++) {
            const particle = new PIXI.Graphics();
            particle.beginFill(color, 0.8);
            particle.drawCircle(0, 0, Math.random() * 4 + 2);
            particle.endFill();
            particle.x = x;
            particle.y = y;
            particle.vx = (Math.random() - 0.5) * 8;
            particle.vy = (Math.random() - 0.5) * 8 - 3;
            particle.life = 1;
            app.stage.addChild(particle);
            particles.push(particle);
        }
        
        const updateParticles = (delta) => {
            let allDead = true;
            particles.forEach(p => {
                p.x += p.vx * delta;
                p.y += p.vy * delta;
                p.vy += 0.2 * delta; // Gravité
                p.life -= 0.03 * delta;
                p.alpha = p.life;
                if (p.life > 0) allDead = false;
            });
            
            if (allDead) {
                app.ticker.remove(updateParticles);
                particles.forEach(p => app.stage.removeChild(p));
            }
        };
        
        app.ticker.add(updateParticles);
    }
    
    /**
     * Utilitaire sleep
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Nettoie toutes les animations
     */
    function clear() {
        if (app && app.stage) {
            app.stage.removeChildren();
        }
    }
    
    // API publique
    return {
        init,
        animateDraw,
        animateMultipleDraw,
        createParticles,
        clear,
        get isReady() { return isInitialized; }
    };
})();

// Auto-init quand le DOM est prêt
document.addEventListener('DOMContentLoaded', () => {
    GameAnimations.init();
});