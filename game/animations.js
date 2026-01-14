/**
 * Système d'animation PixiJS pour Bataille des Héros
 * Animations style Hearthstone / Magic Arena
 * Compatible PixiJS 7.x - Approche synchrone
 */

// Variables globales
let pixiApp = null;
let pixiReady = false;

// Configuration
const ANIM_CONFIG = {
    cardWidth: 90,
    cardHeight: 130,
    drawDuration: 800,
    glowColor: 0xffd700,
    cardBackColor: 0x4a3728,
    cardBorderColor: 0x8b7355
};

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    initPixiApp();
});

/**
 * Initialise PixiJS de manière synchrone (comme l'exemple qui fonctionne)
 */
function initPixiApp() {
    if (pixiReady) return;
    
    try {
        if (typeof PIXI === 'undefined') {
            console.error('❌ PixiJS non chargé');
            return;
        }
        
        // Création synchrone comme dans l'exemple
        pixiApp = new PIXI.Application({
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true
        });
        
        // Configurer le canvas
        pixiApp.view.style.position = 'fixed';
        pixiApp.view.style.top = '0';
        pixiApp.view.style.left = '0';
        pixiApp.view.style.width = '100%';
        pixiApp.view.style.height = '100%';
        pixiApp.view.style.pointerEvents = 'none';
        pixiApp.view.style.zIndex = '9999';
        
        // Ajouter au body
        document.body.appendChild(pixiApp.view);
        
        // Redimensionnement
        window.addEventListener('resize', () => {
            if (pixiApp && pixiApp.renderer) {
                pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
            }
        });
        
        pixiReady = true;
        console.log('🎮 PixiJS initialisé avec succès');
        
    } catch (e) {
        console.error('❌ Erreur initialisation PixiJS:', e);
    }
}

/**
 * Crée une carte graphique pour l'animation
 */
function createAnimCard(card, showBack = true) {
    const container = new PIXI.Container();
    
    // Ombre
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.4);
    shadow.drawRoundedRect(5, 5, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
    shadow.endFill();
    container.addChild(shadow);
    
    // Fond de carte
    const cardBg = new PIXI.Graphics();
    
    if (showBack) {
        // Dos de carte
        cardBg.beginFill(ANIM_CONFIG.cardBackColor);
        cardBg.drawRoundedRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        cardBg.endFill();
        cardBg.lineStyle(3, ANIM_CONFIG.cardBorderColor);
        cardBg.drawRoundedRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        
        // Motif central
        const pattern = new PIXI.Graphics();
        pattern.lineStyle(2, 0x5a4738, 0.6);
        pattern.drawRoundedRect(12, 12, ANIM_CONFIG.cardWidth - 24, ANIM_CONFIG.cardHeight - 24, 4);
        container.addChild(pattern);
        
        // Icône dos de carte
        const backIcon = new PIXI.Text('🎴', {
            fontSize: 32,
            fill: 0xffffff
        });
        backIcon.anchor.set(0.5);
        backIcon.x = ANIM_CONFIG.cardWidth / 2;
        backIcon.y = ANIM_CONFIG.cardHeight / 2;
        container.addChild(backIcon);
    } else {
        // Face de carte
        const bgColor = card?.type === 'spell' ? 0x4a3a6a : 
                       card?.type === 'trap' ? 0x6a3a3a : 0x3a5a3a;
        cardBg.beginFill(bgColor);
        cardBg.drawRoundedRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        cardBg.endFill();
        cardBg.lineStyle(3, 0xcccccc);
        cardBg.drawRoundedRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        
        // Icône
        if (card?.icon) {
            const icon = new PIXI.Text(card.icon, {
                fontSize: 28,
                fill: 0xffffff
            });
            icon.anchor.set(0.5);
            icon.x = ANIM_CONFIG.cardWidth / 2;
            icon.y = ANIM_CONFIG.cardHeight / 2 - 20;
            container.addChild(icon);
        }
        
        // Nom
        if (card?.name) {
            const name = new PIXI.Text(card.name, {
                fontSize: 11,
                fill: 0xffffff,
                fontWeight: 'bold',
                wordWrap: true,
                wordWrapWidth: ANIM_CONFIG.cardWidth - 10,
                align: 'center'
            });
            name.anchor.set(0.5);
            name.x = ANIM_CONFIG.cardWidth / 2;
            name.y = ANIM_CONFIG.cardHeight - 30;
            container.addChild(name);
        }
        
        // Stats pour créatures
        if (card?.type === 'creature' && card.atk !== undefined) {
            const stats = new PIXI.Text(`⚔${card.atk} ❤${card.hp}`, {
                fontSize: 12,
                fill: 0xffffff,
                fontWeight: 'bold'
            });
            stats.anchor.set(0.5);
            stats.x = ANIM_CONFIG.cardWidth / 2;
            stats.y = ANIM_CONFIG.cardHeight - 12;
            container.addChild(stats);
        }
    }
    container.addChildAt(cardBg, 0);
    
    // Pivot au centre
    container.pivot.set(ANIM_CONFIG.cardWidth / 2, ANIM_CONFIG.cardHeight / 2);
    
    return container;
}

/**
 * Crée un effet de glow
 */
function createAnimGlow(color = ANIM_CONFIG.glowColor) {
    const glow = new PIXI.Graphics();
    glow.beginFill(color, 0.5);
    glow.drawRoundedRect(-15, -15, ANIM_CONFIG.cardWidth + 30, ANIM_CONFIG.cardHeight + 30, 14);
    glow.endFill();
    glow.filters = [new PIXI.filters.BlurFilter(12)];
    return glow;
}

/**
 * Easing functions
 */
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Courbe de Bézier quadratique
 */
function bezierQuad(t, p0, p1, p2) {
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
    const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
    return { x, y };
}

/**
 * Obtient la position d'un élément DOM
 */
function getElementPos(selector) {
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
function animateCardDraw(card, owner, handIndex) {
    if (!pixiReady || !pixiApp) {
        console.warn('⚠️ PixiJS non prêt');
        initPixiApp();
        if (!pixiReady) return;
    }
    
    // Position du deck
    const deckPos = getElementPos(`#${owner}-deck-stack`);
    
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
        console.warn('⚠️ Position du deck non trouvée pour', owner);
        return;
    }
    
    console.log('🎴 Animation pioche:', owner, card?.name || 'carte');
    
    // Container principal
    const mainContainer = new PIXI.Container();
    mainContainer.x = deckPos.x;
    mainContainer.y = deckPos.y;
    pixiApp.stage.addChild(mainContainer);
    
    // Glow derrière la carte
    const glow = createAnimGlow(ANIM_CONFIG.glowColor);
    glow.alpha = 0;
    mainContainer.addChild(glow);
    
    // Créer la carte (dos d'abord)
    let cardSprite = createAnimCard(card, true);
    mainContainer.addChild(cardSprite);
    
    // État initial
    mainContainer.scale.set(0.7);
    mainContainer.alpha = 0;
    
    // Point de contrôle pour la courbe
    const controlPoint = {
        x: (deckPos.x + handPos.x) / 2,
        y: Math.min(deckPos.y, handPos.y) - 100
    };
    
    // Variables d'animation
    let startTime = performance.now();
    let hasFlipped = false;
    
    // Animation avec ticker (comme dans l'exemple)
    const tickerCallback = (delta) => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / ANIM_CONFIG.drawDuration, 1);
        
        // Easing
        const easedProgress = easeOutCubic(progress);
        
        // Position sur la courbe de Bézier
        const pos = bezierQuad(easedProgress, deckPos, controlPoint, handPos);
        mainContainer.x = pos.x;
        mainContainer.y = pos.y;
        
        // Apparition rapide
        mainContainer.alpha = Math.min(progress * 4, 1);
        
        // Scale avec effet "pop"
        const scaleProgress = easeOutBack(Math.min(progress * 1.3, 1));
        const baseScale = owner === 'me' ? 1.0 : 0.6;
        mainContainer.scale.set(0.5 + scaleProgress * (baseScale - 0.5));
        
        // Rotation légère
        mainContainer.rotation = Math.sin(progress * Math.PI) * 0.12;
        
        // Glow qui pulse
        glow.alpha = Math.sin(progress * Math.PI) * 0.8;
        
        // Flip à mi-parcours pour révéler la carte (seulement pour le joueur)
        if (owner === 'me' && progress > 0.5 && !hasFlipped && card) {
            hasFlipped = true;
            mainContainer.removeChild(cardSprite);
            cardSprite = createAnimCard(card, false);
            mainContainer.addChild(cardSprite);
        }
        
        // Fin de l'animation
        if (progress >= 1) {
            // Fade out
            let fadeStart = performance.now();
            
            const fadeCallback = (delta) => {
                const fadeProgress = (performance.now() - fadeStart) / 300;
                mainContainer.alpha = 1 - fadeProgress;
                
                if (fadeProgress >= 1) {
                    pixiApp.ticker.remove(fadeCallback);
                    pixiApp.stage.removeChild(mainContainer);
                    mainContainer.destroy({ children: true });
                }
            };
            
            pixiApp.ticker.remove(tickerCallback);
            pixiApp.ticker.add(fadeCallback);
        }
    };
    
    pixiApp.ticker.add(tickerCallback);
}

/**
 * API publique GameAnimations
 */
const GameAnimations = {
    init: function() {
        initPixiApp();
        return Promise.resolve();
    },
    
    animateDraw: function(card, owner, handIndex = 0) {
        animateCardDraw(card, owner, handIndex);
        return Promise.resolve();
    },
    
    clear: function() {
        if (pixiApp && pixiApp.stage) {
            pixiApp.stage.removeChildren();
        }
    },
    
    get isReady() {
        return pixiReady;
    }
};