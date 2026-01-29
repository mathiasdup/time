// =============================================
// Orbe de Mana (Hexagone)
// =============================================
// Génération du path hexagonal pour les orbes de mana

/**
 * Crée un path hexagonal avec coins arrondis
 * @param {number} cx - Centre X
 * @param {number} cy - Centre Y
 * @param {number} radius - Rayon
 * @param {number} cornerRadius - Rayon des coins
 * @returns {string} - Path SVG
 */
function createHexagonPath(cx, cy, radius, cornerRadius) {
    const points = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 2) + (i * Math.PI / 3);
        points.push({
            x: cx + radius * Math.cos(angle),
            y: cy - radius * Math.sin(angle)
        });
    }
    let path = '';
    for (let i = 0; i < 6; i++) {
        const current = points[i];
        const next = points[(i + 1) % 6];
        const prev = points[(i + 5) % 6];
        const dx1 = current.x - prev.x;
        const dy1 = current.y - prev.y;
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const dx2 = next.x - current.x;
        const dy2 = next.y - current.y;
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const enterX = current.x - (dx1 / len1) * cornerRadius;
        const enterY = current.y - (dy1 / len1) * cornerRadius;
        const exitX = current.x + (dx2 / len2) * cornerRadius;
        const exitY = current.y + (dy2 / len2) * cornerRadius;
        if (i === 0) {
            path = `M ${enterX.toFixed(2)} ${enterY.toFixed(2)}`;
        } else {
            path += ` L ${enterX.toFixed(2)} ${enterY.toFixed(2)}`;
        }
        path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)}, ${exitX.toFixed(2)} ${exitY.toFixed(2)}`;
    }
    const firstCurrent = points[0];
    const firstPrev = points[5];
    const dx1 = firstCurrent.x - firstPrev.x;
    const dy1 = firstCurrent.y - firstPrev.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const enterX = firstCurrent.x - (dx1 / len1) * cornerRadius;
    const enterY = firstCurrent.y - (dy1 / len1) * cornerRadius;
    path += ` L ${enterX.toFixed(2)} ${enterY.toFixed(2)} Z`;
    return path;
}

// Path hexagonal avec coins arrondis
// Centre (100, 115), rayon 95, cornerRadius 12, viewBox 0 0 200 230
const MANA_HEX_INNER = createHexagonPath(100, 115, 95, 12);

/**
 * Injecte les gradients SVG globaux pour le mana
 */
function injectManaGradients() {
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
}

// Injecter au chargement
if (typeof document !== 'undefined') {
    injectManaGradients();
}
