/**
 * Animation de pioche style Magic Arena
 * Simple et propre - pas de glow, pas d'effets superflus
 */

let pixiApp = null;
let pixiReady = false;

// Dimensions des cartes (basées sur le CSS réel)
const CARD_SIZES = {
    me: { width: 100, height: 135 },
    opp: { width: 86, height: 116 }
};

/**
 * Initialise PixiJS 8.x
 */
async function initPixiApp() {
    if (pixiReady) return;
    
    try {
        if (typeof PIXI === 'undefined') return;
        
        pixiApp = new PIXI.Application();
        await pixiApp.init({
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true
        });
        
        const canvas = pixiApp.canvas;
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(canvas);
        
        window.addEventListener('resize', () => {
            pixiApp?.renderer?.resize(window.innerWidth, window.innerHeight);
        });
        
        pixiReady = true;
        console.log('🎮 PixiJS prêt');
    } catch (e) {
        console.error('PixiJS error:', e);
    }
}

/**
 * Crée le dos d'une carte (pour l'adversaire)
 */
function createCardBack(width, height) {
    const container = new PIXI.Container();
    
    // Fond
    const bg = new PIXI.Graphics();
    bg.roundRect(0, 0, width, height, 6);
    bg.fill({ color: 0x3a2a1a });
    bg.roundRect(0, 0, width, height, 6);
    bg.stroke({ width: 3, color: 0x8b7355 });
    container.addChild(bg);
    
    // Motif intérieur
    const inner = new PIXI.Graphics();
    inner.roundRect(8, 8, width - 16, height - 16, 4);
    inner.stroke({ width: 2, color: 0x5a4a3a, alpha: 0.6 });
    container.addChild(inner);
    
    // Symbole central
    const symbol = new PIXI.Text({
        text: '⚔',
        style: { fontSize: Math.min(width, height) * 0.35, fill: 0x6a5a4a }
    });
    symbol.anchor.set(0.5);
    symbol.x = width / 2;
    symbol.y = height / 2;
    container.addChild(symbol);
    
    return container;
}

/**
 * Crée la face d'une carte (pour le joueur)
 */
function createCardFace(card, width, height) {
    const container = new PIXI.Container();
    
    // Couleur selon le type
    const colors = {
        creature: 0x2a3a2a,
        spell: 0x2a2a4a,
        trap: 0x4a2a2a
    };
    const bgColor = colors[card?.type] || 0x2a2a2a;
    
    // Fond
    const bg = new PIXI.Graphics();
    bg.roundRect(0, 0, width, height, 6);
    bg.fill({ color: bgColor });
    bg.roundRect(0, 0, width, height, 6);
    bg.stroke({ width: 2, color: 0x888888 });
    container.addChild(bg);
    
    // Coût mana (coin supérieur gauche)
    if (card?.cost !== undefined) {
        const costBg = new PIXI.Graphics();
        costBg.circle(14, 14, 12);
        costBg.fill({ color: 0x3498db });
        container.addChild(costBg);
        
        const costText = new PIXI.Text({
            text: String(card.cost),
            style: { fontSize: 14, fill: 0xffffff, fontWeight: 'bold' }
        });
        costText.anchor.set(0.5);
        costText.x = 14;
        costText.y = 14;
        container.addChild(costText);
    }
    
    // Icône
    if (card?.icon) {
        const icon = new PIXI.Text({
            text: card.icon,
            style: { fontSize: 28, fill: 0xffffff }
        });
        icon.anchor.set(0.5);
        icon.x = width / 2;
        icon.y = height * 0.4;
        container.addChild(icon);
    }
    
    // Nom
    if (card?.name) {
        const name = new PIXI.Text({
            text: card.name,
            style: { 
                fontSize: 10, 
                fill: 0xffffff, 
                fontWeight: 'bold',
                wordWrap: true,
                wordWrapWidth: width - 10,
                align: 'center'
            }
        });
        name.anchor.set(0.5);
        name.x = width / 2;
        name.y = height * 0.7;
        container.addChild(name);
    }
    
    // Stats (créatures)
    if (card?.type === 'creature') {
        // ATK
        const atkBg = new PIXI.Graphics();
        atkBg.circle(14, height - 14, 12);
        atkBg.fill({ color: 0xe67e22 });
        container.addChild(atkBg);
        
        const atkText = new PIXI.Text({
            text: String(card.atk),
            style: { fontSize: 12, fill: 0xffffff, fontWeight: 'bold' }
        });
        atkText.anchor.set(0.5);
        atkText.x = 14;
        atkText.y = height - 14;
        container.addChild(atkText);
        
        // HP
        const hpBg = new PIXI.Graphics();
        hpBg.circle(width - 14, height - 14, 12);
        hpBg.fill({ color: 0xe74c3c });
        container.addChild(hpBg);
        
        const hpText = new PIXI.Text({
            text: String(card.hp),
            style: { fontSize: 12, fill: 0xffffff, fontWeight: 'bold' }
        });
        hpText.anchor.set(0.5);
        hpText.x = width - 14;
        hpText.y = height - 14;
        container.addChild(hpText);
    }
    
    return container;
}

/**
 * Easing
 */
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/**
 * Animation de pioche
 */
async function animateCardDraw(card, owner, handIndex) {
    if (!pixiReady || !pixiApp) {
        await initPixiApp();
        if (!pixiReady) return;
    }
    
    const size = CARD_SIZES[owner];
    
    // Position de départ (deck)
    const deckEl = document.querySelector(`#${owner}-deck-stack`);
    if (!deckEl) return;
    const deckRect = deckEl.getBoundingClientRect();
    const startPos = {
        x: deckRect.left + deckRect.width / 2,
        y: deckRect.top + deckRect.height / 2
    };
    
    // Position d'arrivée (dernière carte de la main)
    const handSelector = owner === 'me' ? '#my-hand' : '#opp-hand';
    const handEl = document.querySelector(handSelector);
    if (!handEl) return;
    
    const cardSelector = owner === 'me' ? '.card' : '.opp-card-back';
    const handCards = handEl.querySelectorAll(cardSelector);
    const targetCard = handCards[handCards.length - 1];
    
    let endPos;
    if (targetCard) {
        const rect = targetCard.getBoundingClientRect();
        endPos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        // Cacher la carte réelle pendant l'animation
        targetCard.style.opacity = '0';
    } else {
        const handRect = handEl.getBoundingClientRect();
        endPos = {
            x: handRect.left + handRect.width / 2,
            y: handRect.top + handRect.height / 2
        };
    }
    
    // Créer la carte animée
    const cardSprite = owner === 'me' 
        ? createCardFace(card, size.width, size.height)
        : createCardBack(size.width, size.height);
    
    cardSprite.pivot.set(size.width / 2, size.height / 2);
    cardSprite.x = startPos.x;
    cardSprite.y = startPos.y;
    cardSprite.scale.set(0.8);
    cardSprite.alpha = 0;
    
    pixiApp.stage.addChild(cardSprite);
    
    // Animation
    const duration = 500; // ms
    const startTime = performance.now();
    
    // Point de contrôle pour la courbe (légère courbe vers le haut)
    const controlY = Math.min(startPos.y, endPos.y) - 50;
    
    const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        
        // Position (courbe de Bézier simple)
        const t = eased;
        cardSprite.x = (1 - t) * (1 - t) * startPos.x + 2 * (1 - t) * t * ((startPos.x + endPos.x) / 2) + t * t * endPos.x;
        cardSprite.y = (1 - t) * (1 - t) * startPos.y + 2 * (1 - t) * t * controlY + t * t * endPos.y;
        
        // Alpha et scale
        cardSprite.alpha = Math.min(progress * 3, 1);
        cardSprite.scale.set(0.8 + eased * 0.2);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Révéler la vraie carte
            if (targetCard) {
                targetCard.style.transition = 'opacity 0.1s';
                targetCard.style.opacity = '1';
            }
            
            // Supprimer l'animation
            setTimeout(() => {
                pixiApp.stage.removeChild(cardSprite);
                cardSprite.destroy({ children: true });
            }, 100);
        }
    };
    
    requestAnimationFrame(animate);
}

/**
 * API publique
 */
const GameAnimations = {
    init: async () => await initPixiApp(),
    animateDraw: async (card, owner, handIndex = 0) => await animateCardDraw(card, owner, handIndex),
    clear: () => pixiApp?.stage?.removeChildren(),
    get isReady() { return pixiReady; }
};

// Auto-init
document.addEventListener('DOMContentLoaded', () => initPixiApp());