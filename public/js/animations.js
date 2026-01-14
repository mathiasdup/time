/**
 * Système d'animation PixiJS 8.x pour Bataille des Héros
 * Animations style Hearthstone / Magic Arena
 */

console.log('📜 animations.js chargé');

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

/**
 * Initialise PixiJS 8.x (syntaxe async)
 */
async function initPixiApp() {
    console.log('🔧 initPixiApp() appelé');
    
    if (pixiReady) {
        console.log('⚠️ PixiJS déjà initialisé');
        return;
    }
    
    try {
        if (typeof PIXI === 'undefined') {
            console.error('❌ PIXI est undefined !');
            return;
        }
        
        console.log('✅ PIXI existe, version:', PIXI.VERSION);
        
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
        
        console.log('✅ PIXI.Application initialisée');
        console.log('✅ pixiApp.canvas:', pixiApp.canvas);
        console.log('✅ pixiApp.stage:', pixiApp.stage);
        
        // Configurer le canvas (PixiJS 8 utilise .canvas au lieu de .view)
        const canvas = pixiApp.canvas;
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '9999';
        
        // Ajouter au body
        document.body.appendChild(canvas);
        console.log('✅ Canvas ajouté au body');
        
        // Redimensionnement
        window.addEventListener('resize', () => {
            if (pixiApp && pixiApp.renderer) {
                pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
            }
        });
        
        pixiReady = true;
        console.log('🎮 PixiJS 8 initialisé avec succès !');
        
    } catch (e) {
        console.error('❌ Erreur initialisation PixiJS:', e);
        console.error(e.stack);
    }
}

/**
 * Crée une carte graphique (syntaxe PixiJS 8.x)
 */
function createAnimCard(card, showBack = true) {
    console.log('🃏 createAnimCard() - showBack:', showBack, 'card:', card?.name);
    
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
    }
    
    container.addChildAt(cardBg, 0);
    container.pivot.set(ANIM_CONFIG.cardWidth / 2, ANIM_CONFIG.cardHeight / 2);
    
    console.log('🃏 Carte créée');
    return container;
}

/**
 * Crée un effet de glow (syntaxe PixiJS 8.x)
 */
function createAnimGlow(color = ANIM_CONFIG.glowColor) {
    const glow = new PIXI.Graphics();
    glow.roundRect(-15, -15, ANIM_CONFIG.cardWidth + 30, ANIM_CONFIG.cardHeight + 30, 14);
    glow.fill({ color: color, alpha: 0.5 });
    
    // PixiJS 8 - BlurFilter
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

// Bézier
function bezierQuad(t, p0, p1, p2) {
    return {
        x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
        y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
    };
}

// Position DOM
function getElementPos(selector) {
    const el = document.querySelector(selector);
    if (!el) {
        console.warn('⚠️ Element non trouvé:', selector);
        return null;
    }
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Animation de pioche
 */
async function animateCardDraw(card, owner, handIndex) {
    console.log('🎬 animateCardDraw() appelé:', owner, card?.name, 'index:', handIndex);
    console.log('🎬 pixiReady:', pixiReady, 'pixiApp:', !!pixiApp);
    
    if (!pixiReady || !pixiApp) {
        console.warn('⚠️ PixiJS non prêt, tentative d\'init...');
        await initPixiApp();
        if (!pixiReady) {
            console.error('❌ Impossible d\'initialiser PixiJS');
            return;
        }
    }
    
    // Position du deck
    const deckSelector = `#${owner}-deck-stack`;
    console.log('🔍 Recherche deck:', deckSelector);
    const deckPos = getElementPos(deckSelector);
    
    if (!deckPos) {
        console.error('❌ Position du deck non trouvée pour:', owner);
        return;
    }
    
    console.log('📍 Position deck:', deckPos);
    
    // Position d'arrivée
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
    
    console.log('📍 Position main:', handPos);
    console.log('🚀 Démarrage animation...');
    
    // Container principal
    const mainContainer = new PIXI.Container();
    mainContainer.x = deckPos.x;
    mainContainer.y = deckPos.y;
    pixiApp.stage.addChild(mainContainer);
    
    console.log('✅ Container ajouté au stage, enfants:', pixiApp.stage.children.length);
    
    // Glow
    const glow = createAnimGlow();
    glow.alpha = 0;
    mainContainer.addChild(glow);
    
    // Carte
    let cardSprite = createAnimCard(card, true);
    mainContainer.addChild(cardSprite);
    
    // État initial
    mainContainer.scale.set(0.7);
    mainContainer.alpha = 0;
    
    // Point de contrôle
    const controlPoint = {
        x: (deckPos.x + handPos.x) / 2,
        y: Math.min(deckPos.y, handPos.y) - 100
    };
    
    // Animation
    let startTime = performance.now();
    let hasFlipped = false;
    let frameCount = 0;
    
    const tickerCallback = (ticker) => {
        frameCount++;
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / ANIM_CONFIG.drawDuration, 1);
        
        if (frameCount <= 3) {
            console.log(`🎞️ Frame ${frameCount}: progress=${progress.toFixed(2)}`);
        }
        
        // Position
        const easedProgress = easeOutCubic(progress);
        const pos = bezierQuad(easedProgress, deckPos, controlPoint, handPos);
        mainContainer.x = pos.x;
        mainContainer.y = pos.y;
        
        // Alpha
        mainContainer.alpha = Math.min(progress * 4, 1);
        
        // Scale
        const scaleProgress = easeOutBack(Math.min(progress * 1.3, 1));
        const baseScale = owner === 'me' ? 1.0 : 0.6;
        mainContainer.scale.set(0.5 + scaleProgress * (baseScale - 0.5));
        
        // Rotation
        mainContainer.rotation = Math.sin(progress * Math.PI) * 0.12;
        
        // Glow
        glow.alpha = Math.sin(progress * Math.PI) * 0.8;
        
        // Flip
        if (owner === 'me' && progress > 0.5 && !hasFlipped && card) {
            hasFlipped = true;
            console.log('🔄 Flip de la carte');
            mainContainer.removeChild(cardSprite);
            cardSprite = createAnimCard(card, false);
            mainContainer.addChild(cardSprite);
        }
        
        // Fin
        if (progress >= 1) {
            console.log('✅ Animation terminée, démarrage fade out');
            let fadeStart = performance.now();
            
            const fadeCallback = (ticker) => {
                const fadeProgress = (performance.now() - fadeStart) / 300;
                mainContainer.alpha = 1 - fadeProgress;
                
                if (fadeProgress >= 1) {
                    console.log('✅ Fade out terminé, nettoyage');
                    pixiApp.ticker.remove(fadeCallback);
                    pixiApp.stage.removeChild(mainContainer);
                    mainContainer.destroy({ children: true });
                }
            };
            
            pixiApp.ticker.remove(tickerCallback);
            pixiApp.ticker.add(fadeCallback);
        }
    };
    
    console.log('▶️ Ajout du ticker');
    pixiApp.ticker.add(tickerCallback);
}

/**
 * API publique
 */
const GameAnimations = {
    init: async function() {
        console.log('🔧 GameAnimations.init() appelé');
        await initPixiApp();
    },
    
    animateDraw: async function(card, owner, handIndex = 0) {
        console.log('🎬 GameAnimations.animateDraw() appelé');
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
    console.log('📄 DOMContentLoaded - init GameAnimations');
    await initPixiApp();
});

console.log('📜 animations.js fin de chargement');