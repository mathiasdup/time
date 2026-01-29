// =============================================
// Initialisation du jeu
// =============================================
// Variables globales et point d'entrée

// Variables globales
let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let combatAnimReady = false;

/**
 * Initialise le système d'animation PixiJS
 */
async function initCombatAnimations() {
    if (typeof CombatAnimations !== 'undefined') {
        try {
            await CombatAnimations.init();
            combatAnimReady = true;
            console.log('✅ Combat animations ready');
        } catch (e) {
            console.warn('Combat animations init error:', e);
            combatAnimReady = true;
        }
    } else {
        console.warn('CombatAnimations not found');
        combatAnimReady = false;
    }

    if (typeof CardRenderer !== 'undefined') {
        try {
            await CardRenderer.init();
            console.log('✅ CardRenderer PixiJS ready');
        } catch (e) {
            console.warn('CardRenderer init error:', e);
        }
    }
}

/**
 * Lance la partie après le mulligan
 */
function startGame() {
    if (mulliganTimer) {
        clearInterval(mulliganTimer);
        mulliganTimer = null;
    }

    document.getElementById('mulligan-overlay').classList.add('hidden');
    document.getElementById('game-container').classList.add('active');
    buildBattlefield();
    render();
    log('🎮 Tour 1 - Partie lancée !', 'phase');
}

// Injection des gradients SVG globaux au chargement
(function injectSvgGradients() {
    const svgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgDefs.setAttribute('width', '0');
    svgDefs.setAttribute('height', '0');
    svgDefs.setAttribute('style', 'position:absolute;');
    svgDefs.innerHTML = `
        <defs>
            <!-- Gradient bordure ROUGE (8 stops) -->
            <linearGradient id="manaGradRedBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#f2a5a8"/>
                <stop offset="15%" stop-color="#eb8a8e"/>
                <stop offset="30%" stop-color="#e36f74"/>
                <stop offset="45%" stop-color="#dc5459"/>
                <stop offset="60%" stop-color="#d5444b"/>
                <stop offset="75%" stop-color="#b33a40"/>
                <stop offset="90%" stop-color="#912f34"/>
                <stop offset="100%" stop-color="#6f2428"/>
            </linearGradient>
            <!-- Gradient bordure VERTE (8 stops) -->
            <linearGradient id="manaGradGreenBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#a8d5b5"/>
                <stop offset="15%" stop-color="#8fc49e"/>
                <stop offset="30%" stop-color="#76b387"/>
                <stop offset="45%" stop-color="#5d9a70"/>
                <stop offset="60%" stop-color="#427253"/>
                <stop offset="75%" stop-color="#375f46"/>
                <stop offset="90%" stop-color="#2c4c39"/>
                <stop offset="100%" stop-color="#1e3d28"/>
            </linearGradient>
            <!-- Gradient bordure NOIRE (8 stops) -->
            <linearGradient id="manaGradBlackBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#b0b0b0"/>
                <stop offset="15%" stop-color="#9a9a9a"/>
                <stop offset="30%" stop-color="#848484"/>
                <stop offset="45%" stop-color="#6e6e6e"/>
                <stop offset="60%" stop-color="#4a4a4a"/>
                <stop offset="75%" stop-color="#3a3a3a"/>
                <stop offset="90%" stop-color="#2a2a2a"/>
                <stop offset="100%" stop-color="#1a1a1a"/>
            </linearGradient>
            <!-- Gradient bordure BLANCHE (8 stops) -->
            <linearGradient id="manaGradWhiteBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="15%" stop-color="#f5f5f5"/>
                <stop offset="30%" stop-color="#e8e8e8"/>
                <stop offset="45%" stop-color="#d9d9d9"/>
                <stop offset="60%" stop-color="#c4c4c4"/>
                <stop offset="75%" stop-color="#a8a8a8"/>
                <stop offset="90%" stop-color="#8c8c8c"/>
                <stop offset="100%" stop-color="#707070"/>
            </linearGradient>
            <!-- Gradient bordure BLEUE (8 stops) -->
            <linearGradient id="manaGradBlueBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#a8d4f2"/>
                <stop offset="15%" stop-color="#8ac4eb"/>
                <stop offset="30%" stop-color="#6cb4e4"/>
                <stop offset="45%" stop-color="#4ea4dd"/>
                <stop offset="60%" stop-color="#3090d0"/>
                <stop offset="75%" stop-color="#2578b0"/>
                <stop offset="90%" stop-color="#1a6090"/>
                <stop offset="100%" stop-color="#104870"/>
            </linearGradient>
            <!-- Gradient intérieur BLEU (5 stops) -->
            <linearGradient id="manaGradBlue" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#00d4e8"/>
                <stop offset="25%" stop-color="#13c4d5"/>
                <stop offset="50%" stop-color="#2193b0"/>
                <stop offset="75%" stop-color="#2a5298"/>
                <stop offset="100%" stop-color="#1e3c72"/>
            </linearGradient>
        </defs>
    `;
    document.body.appendChild(svgDefs);
})();

// Point d'entrée principal
document.addEventListener('DOMContentLoaded', async () => {
    await initCombatAnimations();

    initSocket();
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });

    document.getElementById('card-zoom-overlay').addEventListener('click', hideCardZoom);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.log-popup') && !e.target.closest('.log-btn')) {
            document.getElementById('log-popup').classList.remove('active');
        }
        if (!e.target.closest('.settings-popup') && !e.target.closest('.options-btn')) {
            document.getElementById('settings-popup')?.classList.remove('active');
        }
        if (!e.target.closest('.card') && !e.target.closest('.card-slot') && !e.target.closest('.trap-slot')) {
            clearSel();
        }
    });
});
