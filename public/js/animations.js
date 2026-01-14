/**
 * Système d'animation PixiJS 8.x pour Bataille des Héros
 * Animations style Hearthstone / Magic Arena
 */

// Variables globales
let pixiApp = null;
let pixiReady = false;

// Configuration
const ANIM_CONFIG = {
    cardWidth: 90,
    cardHeight: 130,
    drawDuration: 600,
    glowColor: 0xffd700,
    cardBackColor: 0x4a3728,
    cardBorderColor: 0x8b7355
};

/**
 * Initialise PixiJS 8.x (syntaxe async)
 */
async function initPixiApp() {
    if (pixiReady) return;
    
    try {
        if (typeof PIXI === 'undefined') {
            console.error('❌ PIXI non chargé');
            return;
        }
        
        // PixiJS 8.x - Création async
        pixiApp = new PIXI.Application();
        
        await pixiApp.init({
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true
        });
        
        // Configurer le canvas
        const canvas = pixiApp.canvas;
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '9999';
        
        document.body.appendChild(canvas);
        
        // Redimensionnement
        window.addEventListener('resize', () => {
            if (pixiApp && pixiApp.renderer) {
                pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
            }
        });
        
        pixiReady = true;
        console.log('🎮 PixiJS initialisé');
        
    } catch (e) {
        console.error('❌ Erreur PixiJS:', e);
    }
}

/**
 * Crée une carte graphique (syntaxe PixiJS 8.x)
 */
function createAnimCard(card, showBack = true) {
    const container = new PIXI.Container();
    
    // Ombre
    const shadow = new PIXI.Graphics();
    shadow.roundRect(5, 5, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
    shadow.fill({ color: 0x000000, alpha: 0.4 });
    container.addChild(shadow);
    
    // Fond de carte
    const cardBg = new PIXI.Graphics();
    
    if (showBack) {
        // Dos de carte
        cardBg.roundRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        cardBg.fill({ color: ANIM_CONFIG.cardBackColor });
        cardBg.roundRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        cardBg.stroke({ width: 3, color: ANIM_CONFIG.cardBorderColor });
        
        // Icône dos de carte
        const backIcon = new PIXI.Text({
            text: '🎴',
            style: { fontSize: 32, fill: 0xffffff }
        });
        backIcon.anchor.set(0.5);
        backIcon.x = ANIM_CONFIG.cardWidth / 2;
        backIcon.y = ANIM_CONFIG.cardHeight / 2;
        container.addChild(backIcon);
    } else {
        // Face de carte
        const bgColor = card?.type === 'spell' ? 0x4a3a6a : 
                       card?.type === 'trap' ? 0x6a3a3a : 0x3a5a3a;
        cardBg.roundRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        cardBg.fill({ color: bgColor });
        cardBg.roundRect(0, 0, ANIM_CONFIG.cardWidth, ANIM_CONFIG.cardHeight, 8);
        cardBg.stroke({ width: 3, color: 0xcccccc });
        
        // Icône
        if (card?.icon) {
            const icon = new PIXI.Text({
                text: card.icon,
                style: { fontSize: 28, fill: 0xffffff }
            });
            icon.anchor.set(0.5);
            icon.x = ANIM_CONFIG.cardWidth / 2;
            icon.y = ANIM_CONFIG.cardHeight / 2 - 20;
            container.addChild(icon);
        }
        
        // Nom
        if (card?.name) {
            const name = new PIXI.Text({
                text: card.name,
                style: {
                    fontSize: 11,
                    fill: 0xffffff,
                    fontWeight: 'bold',
                    wordWrap: true,
                    wordWrapWidth: ANIM_CONFIG.cardWidth - 10,
                    align: 'center'
                }
            });
            name.anchor.set(0.5);
            name.x = ANIM_CONFIG.cardWidth / 2;
            name.y = ANIM_CONFIG.cardHeight - 30;
            container.addChild(name);
        }
        
        // Stats pour créatures
        if (card?.type === 'creature' && card.atk !== undefined) {
            const stats = new PIXI.Text({
                text: `⚔${card.atk} ❤${card.hp}`,
                style: { fontSize: 12, fill: 0xffffff, fontWeight: 'bold' }
            });
            stats.anchor.set(0.5);
            stats.x = ANIM_CONFIG.cardWidth / 2;
            stats.y = ANIM_CONFIG.cardHeight - 12;
            container.addChild(stats);
        }
    }
    
    container.addChildAt(cardBg, 0);
    container.pivot.set(ANIM_CONFIG.cardWidth / 2, ANIM_CONFIG.cardHeight / 2);
    
    return container;
}

/**
 * Crée un effet de glow
 */
function createAnimGlow(color = ANIM_CONFIG.glowColor) {
    const glow = new PIXI.Graphics();
    glow.roundRect(-15, -15, ANIM_CONFIG.cardWidth + 30, ANIM_CONFIG.cardHeight + 30, 14);
    glow.fill({ color: color, alpha: 0.5 });
    glow.filters = [new PIXI.BlurFilter({ strength: 12 })];
    return glow;
}

// Easing
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Bézier quadratique
function bezierQuad(t, p0, p1, p2) {
    return {
        x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
        y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
    };
}

/**
 * Obtient la position du centre d'un élément DOM
 */
function getElementCenter(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Animation de pioche
 */
async function animateCardDraw(card, owner, handIndex) {
    if (!pixiReady || !pixiApp) {
        await initPixiApp();
        if (!pixiReady) return;
    }
    
    // Position de départ (deck)
    const deckSelector = owner === 'me' ? '#me-deck-stack' : '#opp-deck-stack';
    const deckPos = getElementCenter(deckSelector);
    
    if (!deckPos) return;
    
    // Trouver la carte dans la main et la cacher temporairement
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const handEl = document.querySelector(handSelector);
    const cards = handEl?.querySelectorAll('.card');
    const targetCard = cards?.[cards.length - 1]; // La dernière carte ajoutée
    
    let handPos;
    
    if (targetCard) {
        // Cacher la carte pendant l'animation
        targetCard.style.opacity = '0';
        targetCard.style.transition = 'none';
        
        const rect = targetCard.getBoundingClientRect();
        handPos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    } else {
        // Fallback au centre de la main
        const handRect = handEl?.getBoundingClientRect();
        if (handRect) {
            handPos = {
                x: handRect.left + handRect.width / 2,
                y: handRect.top + handRect.height / 2
            };
        } else {
            return;
        }
    }
    
    // Container principal
    const mainContainer = new PIXI.Container();
    mainContainer.x = deckPos.x;
    mainContainer.y = deckPos.y;
    pixiApp.stage.addChild(mainContainer);
    
    // Glow
    const glow = createAnimGlow();
    glow.alpha = 0;
    mainContainer.addChild(glow);
    
    // Carte (dos pour commencer)
    let cardSprite = createAnimCard(card, true);
    mainContainer.addChild(cardSprite);
    
    // État initial
    const startScale = owner === 'me' ? 0.8 : 0.5;
    const endScale = owner === 'me' ? 1.0 : 0.5;
    mainContainer.scale.set(startScale);
    mainContainer.alpha = 0;
    
    // Point de contrôle pour la courbe (arc vers le centre)
    const controlPoint = {
        x: (deckPos.x + handPos.x) / 2,
        y: Math.min(deckPos.y, handPos.y) - 80
    };
    
    // Animation
    const startTime = performance.now();
    let hasFlipped = false;
    
    const tickerCallback = (ticker) => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / ANIM_CONFIG.drawDuration, 1);
        const easedProgress = easeOutCubic(progress);
        
        // Position sur la courbe de Bézier
        const pos = bezierQuad(easedProgress, deckPos, controlPoint, handPos);
        mainContainer.x = pos.x;
        mainContainer.y = pos.y;
        
        // Alpha (apparition rapide)
        mainContainer.alpha = Math.min(progress * 4, 1);
        
        // Scale avec effet "pop"
        const scaleProgress = easeOutBack(Math.min(progress * 1.3, 1));
        mainContainer.scale.set(startScale + scaleProgress * (endScale - startScale));
        
        // Légère rotation
        mainContainer.rotation = Math.sin(progress * Math.PI) * 0.1;
        
        // Glow qui pulse
        glow.alpha = Math.sin(progress * Math.PI) * 0.6;
        
        // Flip à mi-parcours (seulement pour le joueur, pas l'adversaire)
        if (owner === 'me' && progress > 0.5 && !hasFlipped && card) {
            hasFlipped = true;
            mainContainer.removeChild(cardSprite);
            cardSprite = createAnimCard(card, false);
            mainContainer.addChild(cardSprite);
        }
        
        // Fin de l'animation
        if (progress >= 1) {
            // Révéler la vraie carte dans la main
            if (targetCard) {
                targetCard.style.transition = 'opacity 0.15s ease';
                targetCard.style.opacity = '1';
            }
            
            // Fade out rapide de l'animation
            const fadeStart = performance.now();
            
            const fadeCallback = (ticker) => {
                const fadeProgress = (performance.now() - fadeStart) / 150;
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
 * API publique
 */
const GameAnimations = {
    init: async function() {
        await initPixiApp();
    },
    
    animateDraw: async function(card, owner, handIndex = 0) {
        await animateCardDraw(card, owner, handIndex);
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

// Auto-init
document.addEventListener('DOMContentLoaded', async () => {
    await initPixiApp();
});