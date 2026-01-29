// =============================================
// Système de bouclier Protection - Design Carapace Cristal 3D
// =============================================
// Version OPTIMISÉE pour les performances
// Même look, moins d'effets gourmands

// Timestamp de création pour synchroniser les animations
let shieldCreationTime = Date.now();

// ==================== CRÉATION DU BOUCLIER ====================

/**
 * Crée un élément bouclier carapace cristal 3D (version optimisée)
 * @param {boolean} withAnimation - Si true, joue l'animation de déploiement
 * @returns {HTMLElement} L'élément bouclier container
 */
function createShieldElement(withAnimation = false) {
    const container = document.createElement('div');

    if (!withAnimation) {
        container.className = 'shield-container active no-transition';
        const elapsed = (Date.now() - shieldCreationTime) % 6000;
        container.style.animationDelay = `-${elapsed}ms`;
    } else {
        container.className = 'shield-container';
    }

    // Structure simplifiée - moins de couches SVG, pas de filtres lourds
    container.innerHTML = `
        <div class="shield-3d">
            <div class="shield-glow"></div>

            <!-- SVG principal du bouclier -->
            <svg class="shield-svg shield-main" viewBox="0 0 200 250">
                <defs>
                    <!-- Forme du bouclier -->
                    <path id="shieldPath" d="
                        M 100 8
                        C 140 8, 170 20, 185 35
                        Q 195 45, 195 60
                        L 195 130
                        Q 195 160, 175 185
                        Q 150 215, 100 242
                        Q 50 215, 25 185
                        Q 5 160, 5 130
                        L 5 60
                        Q 5 45, 15 35
                        C 30 20, 60 8, 100 8
                        Z
                    "/>

                    <clipPath id="shieldClip">
                        <use href="#shieldPath"/>
                    </clipPath>

                    <!-- Gradient bordure GRIS MÉTALLIQUE -->
                    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#ffffff"/>
                        <stop offset="15%" style="stop-color:#d8dce3"/>
                        <stop offset="40%" style="stop-color:#a8aeb8"/>
                        <stop offset="60%" style="stop-color:#8a9199"/>
                        <stop offset="80%" style="stop-color:#cdd2da"/>
                        <stop offset="100%" style="stop-color:#b5bcc5"/>
                    </linearGradient>

                    <!-- Reflet haut -->
                    <linearGradient id="topReflect" x1="50%" y1="0%" x2="50%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(255,255,255,0.5)"/>
                        <stop offset="50%" style="stop-color:rgba(255,255,255,0.15)"/>
                        <stop offset="100%" style="stop-color:rgba(255,255,255,0)"/>
                    </linearGradient>

                    <!-- Hexagone -->
                    <polygon id="hexBig" points="18,0 36,10.5 36,31.5 18,42 0,31.5 0,10.5"/>

                    <!-- Gradients hexagones simplifiés -->
                    <linearGradient id="hexCenter" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(255,255,255,0.2)"/>
                        <stop offset="100%" style="stop-color:rgba(180,200,230,0.08)"/>
                    </linearGradient>

                    <linearGradient id="hexTop" x1="50%" y1="100%" x2="50%" y2="0%">
                        <stop offset="0%" style="stop-color:rgba(200,220,250,0.08)"/>
                        <stop offset="100%" style="stop-color:rgba(255,255,255,0.25)"/>
                    </linearGradient>

                    <linearGradient id="hexBottom" x1="50%" y1="0%" x2="50%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(180,200,230,0.06)"/>
                        <stop offset="100%" style="stop-color:rgba(80,100,140,0.08)"/>
                    </linearGradient>

                    <linearGradient id="hexSide" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(220,235,255,0.12)"/>
                        <stop offset="100%" style="stop-color:rgba(150,180,220,0.06)"/>
                    </linearGradient>

                    <!-- Ligne simple -->
                    <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(255,255,255,0.3)"/>
                        <stop offset="100%" style="stop-color:rgba(100,130,180,0.2)"/>
                    </linearGradient>

                    <!-- Hexagone lumineux cyan -->
                    <radialGradient id="hexGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" style="stop-color:rgba(0,220,255,0.35)"/>
                        <stop offset="100%" style="stop-color:rgba(0,180,220,0)"/>
                    </radialGradient>

                    <!-- Pattern bordure runique simplifié (1 seul drop-shadow) -->
                    <pattern id="borderPattern" x="0" y="0" width="70" height="25" patternUnits="userSpaceOnUse">
                        <g style="filter: drop-shadow(0 0 3px rgba(0,220,255,0.8));">
                            <animate attributeName="opacity" values="0.1;0.9;0.1" dur="8s" repeatCount="indefinite"/>
                            <path d="M 12 5 L 18 12 L 12 19 L 6 12 Z" fill="none" stroke="rgba(0,220,255,0.9)" stroke-width="1"/>
                            <circle cx="12" cy="12" r="1.5" fill="rgba(0,220,255,0.9)"/>
                        </g>
                        <g style="filter: drop-shadow(0 0 3px rgba(0,220,255,0.8));">
                            <animate attributeName="opacity" values="0.1;0.9;0.1" dur="8s" repeatCount="indefinite" begin="2.6s"/>
                            <line x1="40" y1="5" x2="40" y2="19" stroke="rgba(0,220,255,0.9)" stroke-width="1"/>
                            <line x1="33" y1="12" x2="47" y2="12" stroke="rgba(0,220,255,0.9)" stroke-width="1"/>
                        </g>
                        <g style="filter: drop-shadow(0 0 3px rgba(0,220,255,0.8));">
                            <animate attributeName="opacity" values="0.1;0.9;0.1" dur="8s" repeatCount="indefinite" begin="5.2s"/>
                            <path d="M 62 5 L 68 19 L 56 19 Z" fill="none" stroke="rgba(0,220,255,0.9)" stroke-width="1"/>
                        </g>
                    </pattern>

                    <!-- Clip pour bordure -->
                    <clipPath id="borderClip">
                        <path d="
                            M 100 4 C 142 4, 174 17, 189 32 Q 199 42, 199 58 L 199 132
                            Q 199 164, 178 189 Q 152 219, 100 247 Q 48 219, 22 189
                            Q 1 164, 1 132 L 1 58 Q 1 42, 11 32 C 26 17, 58 4, 100 4 Z
                            M 100 13 C 135 13, 163 25, 177 39 Q 186 48, 187 61 L 187 131
                            Q 187 159, 169 182 Q 145 210, 100 237 Q 55 210, 31 182
                            Q 13 159, 13 131 L 13 61 Q 13 48, 23 39 C 37 25, 65 13, 100 13 Z
                        " fill-rule="evenodd"/>
                    </clipPath>

                    <!-- Gradient iridescent statique (pas d'animation) -->
                    <linearGradient id="iridescentBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(255,150,200,0.3)"/>
                        <stop offset="33%" style="stop-color:rgba(150,200,255,0.25)"/>
                        <stop offset="66%" style="stop-color:rgba(150,255,200,0.25)"/>
                        <stop offset="100%" style="stop-color:rgba(200,150,255,0.3)"/>
                    </linearGradient>
                </defs>

                <!-- Fond semi-transparent -->
                <use href="#shieldPath" fill="rgba(180,210,255,0.04)"/>

                <!-- HEXAGONES - réduit à ~25 hexagones au lieu de 50+ -->
                <g clip-path="url(#shieldClip)">
                    <!-- Rangées principales seulement -->
                    <use href="#hexBig" x="64" y="-8" fill="url(#hexTop)" stroke="url(#lineGrad)" stroke-width="0.8"/>
                    <use href="#hexBig" x="100" y="-8" fill="url(#hexTop)" stroke="url(#lineGrad)" stroke-width="0.8"/>

                    <use href="#hexBig" x="46" y="23" fill="url(#hexTop)" stroke="url(#lineGrad)" stroke-width="0.8"/>
                    <use href="#hexBig" x="82" y="23" fill="url(#hexTop)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="118" y="23" fill="url(#hexTop)" stroke="url(#lineGrad)" stroke-width="0.8"/>

                    <use href="#hexBig" x="28" y="54" fill="url(#hexSide)" stroke="url(#lineGrad)" stroke-width="0.8"/>
                    <use href="#hexBig" x="64" y="54" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="100" y="54" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="136" y="54" fill="url(#hexSide)" stroke="url(#lineGrad)" stroke-width="0.8"/>

                    <use href="#hexBig" x="46" y="85" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="82" y="85" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="118" y="85" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>

                    <use href="#hexBig" x="28" y="116" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="64" y="116" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="100" y="116" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="136" y="116" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>

                    <use href="#hexBig" x="46" y="147" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="82" y="147" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>
                    <use href="#hexBig" x="118" y="147" fill="url(#hexCenter)" stroke="url(#lineGrad)" stroke-width="1"/>

                    <use href="#hexBig" x="64" y="178" fill="url(#hexBottom)" stroke="url(#lineGrad)" stroke-width="0.8"/>
                    <use href="#hexBig" x="100" y="178" fill="url(#hexBottom)" stroke="url(#lineGrad)" stroke-width="0.8"/>

                    <use href="#hexBig" x="82" y="209" fill="url(#hexBottom)" stroke="url(#lineGrad)" stroke-width="0.8"/>

                    <!-- Seulement 3 hexagones lumineux animés au lieu de 11 -->
                    <use href="#hexBig" x="82" y="85" fill="url(#hexGlow)" stroke="rgba(0,220,255,0.4)" stroke-width="1">
                        <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="0s"/>
                    </use>
                    <use href="#hexBig" x="64" y="116" fill="url(#hexGlow)" stroke="rgba(0,220,255,0.4)" stroke-width="1">
                        <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="2.5s"/>
                    </use>
                    <use href="#hexBig" x="100" y="116" fill="url(#hexGlow)" stroke="rgba(0,220,255,0.4)" stroke-width="1">
                        <animate attributeName="opacity" values="0;0.6;0" dur="8s" repeatCount="indefinite" begin="5s"/>
                    </use>

                    <!-- Effet de bombé central -->
                    <ellipse cx="100" cy="100" rx="45" ry="35" fill="rgba(255,255,255,0.05)"/>
                </g>

                <!-- Bordure métallique -->
                <use href="#shieldPath" fill="none" stroke="url(#borderGrad)" stroke-width="6"/>

                <!-- Gravures runiques sur bordure -->
                <g clip-path="url(#borderClip)">
                    <use href="#shieldPath" fill="none" stroke="url(#borderPattern)" stroke-width="9"/>
                </g>

                <!-- Reflets simplifiés -->
                <ellipse cx="100" cy="45" rx="50" ry="22" fill="url(#topReflect)" opacity="0.6"/>

                <!-- Reflet iridescent statique -->
                <path d="M 100 12 C 65 12, 40 22, 26 34 Q 16 43, 14 55 L 14 85"
                    fill="none" stroke="url(#iridescentBorder)" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
            </svg>

            <!-- Reflet animé (shine) -->
            <svg class="shield-svg shield-shine" viewBox="0 0 200 250">
                <defs>
                    <clipPath id="shieldClip2">
                        <path d="M 100 8 C 140 8, 170 20, 185 35 Q 195 45, 195 60 L 195 130
                            Q 195 160, 175 185 Q 150 215, 100 242 Q 50 215, 25 185
                            Q 5 160, 5 130 L 5 60 Q 5 45, 15 35 C 30 20, 60 8, 100 8 Z"/>
                    </clipPath>
                    <linearGradient id="shineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:rgba(255,255,255,0)"/>
                        <stop offset="45%" style="stop-color:rgba(255,255,255,0.15)"/>
                        <stop offset="55%" style="stop-color:rgba(255,255,255,0.15)"/>
                        <stop offset="100%" style="stop-color:rgba(255,255,255,0)"/>
                    </linearGradient>
                </defs>
                <g clip-path="url(#shieldClip2)">
                    <rect x="-50" y="-20" width="35" height="300" fill="url(#shineGrad)" transform="rotate(18)">
                        <animate attributeName="x" values="-50;220;220;-50" dur="6s" repeatCount="indefinite" keyTimes="0;0.35;0.5;1"/>
                        <animate attributeName="opacity" values="0;1;1;0;0" dur="6s" repeatCount="indefinite" keyTimes="0;0.05;0.35;0.4;1"/>
                    </rect>
                </g>
            </svg>

            <!-- Runes simplifiées (sans drop-shadow individuel) -->
            <svg class="shield-svg shield-runes" viewBox="0 0 200 250">
                <g fill="rgba(180,210,255,0.5)">
                    <text x="45" y="70" font-size="12">
                        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4s" repeatCount="indefinite"/>ᚠ
                    </text>
                    <text x="145" y="70" font-size="12">
                        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4s" repeatCount="indefinite" begin="1s"/>ᚢ
                    </text>
                    <text x="50" y="180" font-size="12">
                        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4s" repeatCount="indefinite" begin="2s"/>ᚦ
                    </text>
                    <text x="140" y="180" font-size="12">
                        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4s" repeatCount="indefinite" begin="3s"/>ᚨ
                    </text>
                </g>
            </svg>

            <!-- 2 particules au lieu de 4 -->
            <div class="particles">
                <div class="particle"></div>
                <div class="particle"></div>
            </div>
        </div>
    `;

    return container;
}

/**
 * Ajoute un bouclier à une carte
 */
function addShieldToCard(cardEl, withAnimation = false) {
    if (!cardEl) return;
    if (cardEl.querySelector('.shield-container')) return;

    const shield = createShieldElement(withAnimation);
    cardEl.style.position = 'relative';
    cardEl.style.overflow = 'visible';
    cardEl.appendChild(shield);

    if (withAnimation) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                shield.classList.add('active');
            });
        });
    }
}

/**
 * Retire le bouclier d'une carte
 */
function removeShieldFromCard(cardEl) {
    const shield = cardEl?.querySelector('.shield-container');
    if (shield) shield.remove();
}

// ==================== DESTRUCTION DU BOUCLIER ====================

async function breakShield(owner, row, col) {
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
    const card = slot?.querySelector('.card');
    const shield = card?.querySelector('.shield-container');

    if (!shield) return;

    shield.classList.add('breaking');
    createShieldFragments(card);
    await new Promise(resolve => setTimeout(resolve, 600));
    shield.remove();
}

/**
 * Fragments simplifiés pour la destruction
 */
function createShieldFragments(cardEl) {
    const rect = cardEl.getBoundingClientRect();
    const container = document.createElement('div');
    container.className = 'shield-fragments-container';
    container.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        pointer-events: none;
        z-index: 3000;
    `;

    // Flash simplifié
    const flash = document.createElement('div');
    flash.className = 'shield-break-flash';
    container.appendChild(flash);

    // Moins de fragments (10 au lieu de 18)
    for (let i = 0; i < 10; i++) {
        const fragment = document.createElement('div');
        fragment.className = 'shield-hex-shard';

        const x = 20 + Math.random() * 60;
        const y = 15 + Math.random() * 70;
        const angle = Math.random() * 360;
        const dist = 60 + Math.random() * 100;
        const size = 8 + Math.random() * 10;

        const angleRad = angle * Math.PI / 180;
        fragment.style.cssText = `
            position: absolute;
            left: ${x}%;
            top: ${y}%;
            width: ${size}px;
            height: ${size}px;
            --end-x: ${Math.cos(angleRad) * dist}px;
            --end-y: ${Math.sin(angleRad) * dist}px;
            --rotation: ${(Math.random() - 0.5) * 540}deg;
            animation: hexShardFly 0.6s ease-out forwards;
            animation-delay: ${i * 0.02}s;
        `;
        container.appendChild(fragment);
    }

    // Moins de particules (12 au lieu de 25)
    for (let i = 0; i < 12; i++) {
        const particle = document.createElement('div');
        particle.className = 'shield-light-particle';

        const startX = 30 + Math.random() * 40;
        const startY = 25 + Math.random() * 50;
        const angle = Math.random() * Math.PI * 2;
        const distance = 40 + Math.random() * 80;

        particle.style.cssText = `
            position: absolute;
            left: ${startX}%;
            top: ${startY}%;
            --end-x: ${Math.cos(angle) * distance}px;
            --end-y: ${Math.sin(angle) * distance}px;
            animation: lightParticleFly 0.5s ease-out forwards;
            animation-delay: ${Math.random() * 0.1}s;
        `;
        container.appendChild(particle);
    }

    document.body.appendChild(container);
    setTimeout(() => container.remove(), 1000);
}

// ==================== API GLOBALE ====================

window.ShieldEffect = {
    createShield: (cardKey, withAnimation = true) => {
        const [owner, row, col] = cardKey.split('-');
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        const card = slot?.querySelector('.card');
        if (card) addShieldToCard(card, withAnimation);
    },

    breakShield: async (cardKey) => {
        const [owner, row, col] = cardKey.split('-');
        await breakShield(owner, parseInt(row), parseInt(col));
    },

    removeByCardKey: (cardKey) => {
        const [owner, row, col] = cardKey.split('-');
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        const card = slot?.querySelector('.card');
        if (card) removeShieldFromCard(card);
    },

    cleanup: () => {
        document.querySelectorAll('.shield-container').forEach(s => s.remove());
        document.querySelectorAll('.shield-fragments-container').forEach(c => c.remove());
    },

    hasShield: (cardKey) => {
        const [owner, row, col] = cardKey.split('-');
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${row}"][data-col="${col}"]`);
        return slot?.querySelector('.card .shield-container') !== null;
    }
};

window.createShieldElement = createShieldElement;
window.addShieldToCard = addShieldToCard;
window.removeShieldFromCard = removeShieldFromCard;
window.breakShield = breakShield;
window.createStaticShieldElement = createShieldElement;

// ==================== STYLES CSS OPTIMISÉS ====================

const shieldCSS = document.createElement('style');
shieldCSS.textContent = `
/* ==================== BOUCLIER CARAPACE CRISTAL 3D - OPTIMISÉ ==================== */

.shield-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0);
    width: 100px;
    height: 125px;
    z-index: 100;
    pointer-events: none;
    opacity: 0;
    transition: transform 0.4s ease-out, opacity 0.4s ease;
}

.shield-container.active {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
}

.shield-container.no-transition {
    transition: none !important;
}

.shield-container.breaking {
    animation: shieldBreak 0.5s ease-out forwards !important;
}

.shield-3d {
    position: relative;
    width: 100%;
    height: 100%;
    animation: shieldFloat 6s infinite ease-in-out;
}

@keyframes shieldFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
}

.shield-svg {
    position: absolute;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;
}

.shield-glow {
    position: absolute;
    width: 80px;
    height: 100px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(ellipse, rgba(140, 180, 255, 0.1) 0%, transparent 70%);
    animation: glowPulse 4s infinite ease-in-out;
}

@keyframes glowPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
}

/* Particules réduites */
.particles {
    position: absolute;
    width: 110px;
    height: 135px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
}

.particle {
    position: absolute;
    width: 2px;
    height: 2px;
    background: rgba(200, 225, 255, 0.8);
    border-radius: 50%;
    left: 50%;
    top: 50%;
}

.particle:nth-child(1) { animation: orb 10s linear infinite; }
.particle:nth-child(2) { animation: orb 10s linear infinite 5s; }

@keyframes orb {
    from { transform: rotate(0deg) translateX(45px); opacity: 0.5; }
    to { transform: rotate(360deg) translateX(45px); opacity: 0.5; }
}

/* Animation de destruction */
@keyframes shieldBreak {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    30% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; filter: brightness(2); }
    100% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
}

/* ==================== FRAGMENTS DE DESTRUCTION ==================== */

.shield-break-flash {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 150%;
    height: 150%;
    background: radial-gradient(circle, rgba(200, 220, 255, 0.9) 0%, transparent 60%);
    border-radius: 50%;
    animation: shieldFlash 0.35s ease-out forwards;
}

@keyframes shieldFlash {
    0% { transform: translate(-50%, -50%) scale(0.3); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
}

.shield-hex-shard {
    background: linear-gradient(135deg, rgba(180, 210, 255, 0.8), rgba(140, 180, 230, 0.6));
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}

@keyframes hexShardFly {
    0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
    100% { transform: translate(var(--end-x), calc(var(--end-y) + 50px)) rotate(var(--rotation)) scale(0.2); opacity: 0; }
}

.shield-light-particle {
    width: 3px;
    height: 3px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 50%;
}

@keyframes lightParticleFly {
    0% { transform: translate(0, 0) scale(1); opacity: 1; }
    100% { transform: translate(var(--end-x), var(--end-y)) scale(0.3); opacity: 0; }
}
`;

document.head.appendChild(shieldCSS);

console.log('[Shield] Optimized Carapace Cristal 3D shield system loaded');
