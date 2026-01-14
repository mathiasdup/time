/**
 * Système d'animation PixiJS pour Bataille des Héros
 * Animations style Hearthstone / Magic Arena
 * Compatible PixiJS 7.x
 */

const GameAnimations = (function() {
    let app = null;
    let isInitialized = false;
    let initPromise = null;
    
    // Configuration
    const CONFIG = {
        cardWidth: 90,
        cardHeight: 130,
        drawDuration: 800,
        glowColor: 0xffd700,
        cardBackColor: 0x4a3728,
        cardBorderColor: 0x8b7355
    };
    
    /**
     * Initialise PixiJS
     */
    async function init() {
        if (isInitialized) return;
        if (initPromise) return initPromise;
        
        initPromise = (async () => {
            try {
                const canvas = document.getElementById('animation-canvas');
                if (!canvas) {
                    console.warn('Canvas d\'animation non trouvé');
                    return;
                }
                
                if (typeof PIXI === 'undefined') {
                    console.error('PixiJS non chargé');
                    return;
                }
                
                // PixiJS 7.x
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
                    if (app && app.renderer) {
                        app.renderer.resize(window.innerWidth, window.innerHeight);
                    }
                });
                
                isInitialized = true;
                console.log('🎮 PixiJS initialisé pour les animations');
            } catch (e) {
                console.error('Erreur initialisation PixiJS:', e);
            }
        })();
        
        return initPromise;
    }
    
    /**
     * Crée une carte graphique pour l'animation (syntaxe PixiJS 7.x)
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
            cardBg.lineStyle(3, CONFIG.cardBorderColor);
            cardBg.beginFill(CONFIG.cardBackColor);
            cardBg.drawRoundedRect(0, 0, CONFIG.cardWidth, CONFIG.cardHeight, 8);
            cardBg.endFill();
            
            // Icône dos de carte
            const backIcon = new PIXI.Text('🎴', {
                fontSize: 36,
                fill: 0xffffff
            });
            backIcon.anchor.set(0.5);
            backIcon.x = CONFIG.cardWidth / 2;
            backIcon.y = CONFIG.cardHeight / 2;
            container.addChild(backIcon);
        } else {
            // Face de carte
            const bgColor = card?.type === 'spell' ? 0x4a3a6a : 
                           card?.type === 'trap' ? 0x6a3a3a : 0x3a4a3a;
            cardBg.lineStyle(3, 0xaaaaaa);
            cardBg.beginFill(bgColor);
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
                    wordWrapWidth: CONFIG.cardWidth - 10,
                    align: 'center'
                });
                name.anchor.set(0.5);
                name.x = CONFIG.cardWidth / 2;
                name.y = CONFIG.cardHeight - 25;
                container.addChild(name);
            }
            
            // Stats pour créatures
            if (card?.type === 'creature' && card.atk !== undefined) {
                const stats = new PIXI.Text(`⚔${card.atk}  ❤${card.hp}`, {
                    fontSize: 12,
                    fill: 0xffffff
                });
                stats.anchor.set(0.5);
                stats.x = CONFIG.cardWidth / 2;
                stats.y = CONFIG.cardHeight - 10;
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
    function createGlow(container, color = CONFIG.glowColor) {
        const glow = new PIXI.Graphics();
        glow.beginFill(color, 0.4);
        glow.drawRoundedRect(-15, -15, CONFIG.cardWidth + 30, CONFIG.cardHeight + 30, 12);
        glow.endFill();
        
        container.addChildAt(glow, 0);
        return glow;
    }
    
    /**
     * Easing functions
     */
    const Easing = {
        easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
        easeOutBack: (t) => {
            const c1 = 1.70158;
            const c3 = c1 + 1;
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
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
     */
    async function animateDraw(card, owner, handIndex = 0) {
        await init();
        
        if (!app || !app.stage) {
            console.warn('PixiJS non prêt pour animation');
            return;
        }
        
        return new Promise((resolve) => {
            // Position du deck
            const deckPos = getDOMPosition(`#${owner}-deck-stack`);
            
            // Position d'arrivée dans la main
            let handPos;
            if (owner === 'me') {
                handPos = { 
                    x: window.innerWidth / 2 + (handIndex - 4) * 85, 
                    y: window.innerHeight - 100 
                };
            } else {
                handPos = { 
                    x: window.innerWidth / 2 + (handIndex - 4) * 50, 
                    y: 100 
                };
            }
            
            if (!deckPos) {
                console.warn('Position du deck non trouvée pour', owner);
                resolve();
                return;
            }
            
            console.log('🎴 Animation pioche:', owner, card?.name || 'carte');
            
            // Créer la carte (dos d'abord)
            const cardContainer = createCardGraphic(card, true);
            cardContainer.x = deckPos.x;
            cardContainer.y = deckPos.y;
            cardContainer.scale.set(0.7);
            cardContainer.alpha = 0;
            
            // Ajouter le glow
            const glow = createGlow(cardContainer, CONFIG.glowColor);
            glow.alpha = 0;
            
            app.stage.addChild(cardContainer);
            
            // Point de contrôle pour la courbe (arc vers le centre)
            const controlPoint = {
                x: (deckPos.x + handPos.x) / 2,
                y: Math.min(deckPos.y, handPos.y) - 80
            };
            
            // Animation avec requestAnimationFrame
            const startTime = performance.now();
            const duration = CONFIG.drawDuration;
            let hasFlipped = false;
            
            function animate() {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Easing
                const easedProgress = Easing.easeOutCubic(progress);
                
                // Position sur la courbe de Bézier
                const pos = bezierQuadratic(easedProgress, deckPos, controlPoint, handPos);
                cardContainer.x = pos.x;
                cardContainer.y = pos.y;
                
                // Apparition rapide
                cardContainer.alpha = Math.min(progress * 3, 1);
                
                // Scale avec effet "pop"
                const scaleProgress = Easing.easeOutBack(Math.min(progress * 1.2, 1));
                const baseScale = owner === 'me' ? 1.0 : 0.6;
                cardContainer.scale.set(0.5 + scaleProgress * (baseScale - 0.5));
                
                // Rotation légère pendant le mouvement
                cardContainer.rotation = Math.sin(progress * Math.PI) * 0.15;
                
                // Glow qui pulse
                glow.alpha = Math.sin(progress * Math.PI) * 0.7;
                
                // Flip à mi-parcours pour révéler la carte (seulement pour le joueur)
                if (owner === 'me' && progress > 0.5 && !hasFlipped && card) {
                    hasFlipped = true;
                    cardContainer.removeChildren();
                    const faceCard = createCardGraphic(card, false);
                    while (faceCard.children.length > 0) {
                        cardContainer.addChild(faceCard.children[0]);
                    }
                    createGlow(cardContainer, CONFIG.glowColor);
                }
                
                // Continuer ou terminer
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Fade out rapide
                    const fadeStart = performance.now();
                    function fadeOut() {
                        const fadeProgress = (performance.now() - fadeStart) / 250;
                        cardContainer.alpha = 1 - fadeProgress;
                        
                        if (fadeProgress < 1) {
                            requestAnimationFrame(fadeOut);
                        } else {
                            app.stage.removeChild(cardContainer);
                            resolve();
                        }
                    }
                    fadeOut();
                }
            }
            
            animate();
        });
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
        clear,
        get isReady() { return isInitialized; }
    };
})();

// Auto-init quand le DOM est prêt
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Chargement GameAnimations...');
    GameAnimations.init().then(() => {
        console.log('✅ GameAnimations prêt');
    });
});