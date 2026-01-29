// =============================================
// Patterns de sorts
// =============================================
// Les différents patterns déterminent comment un sort affecte le terrain

/**
 * Types de patterns disponibles
 */
const SPELL_PATTERNS = {
    SINGLE: 'single',   // Cible unique (créature ou héros)
    CROSS: 'cross',     // Cible + adjacents (croix)
    ALL: 'all',         // Toutes les créatures du terrain
    GLOBAL: 'global',   // Effet global (pioche, mana, etc.)
    HERO: 'hero',       // Cible un héros uniquement
    LINE: 'line'        // Toute une ligne
};

/**
 * Obtient les cibles adjacentes pour un pattern en croix
 * (même côté uniquement - haut, bas, gauche, droite)
 * @param {number} targetPlayer - Joueur ciblé
 * @param {number} row - Ligne de la cible centrale
 * @param {number} col - Colonne de la cible centrale
 * @returns {Array<{row: number, col: number, player: number}>}
 */
function getCrossTargets(targetPlayer, row, col) {
    const targets = [];
    // Haut
    if (row > 0) targets.push({ row: row - 1, col, player: targetPlayer });
    // Bas
    if (row < 3) targets.push({ row: row + 1, col, player: targetPlayer });
    // Gauche (col 0)
    if (col > 0) targets.push({ row, col: col - 1, player: targetPlayer });
    // Droite (col 1)
    if (col < 1) targets.push({ row, col: col + 1, player: targetPlayer });

    return targets;
}

/**
 * Obtient toutes les cibles pour un pattern en croix (centre + adjacents)
 * @param {number} targetPlayer - Joueur ciblé
 * @param {number} row - Ligne de la cible centrale
 * @param {number} col - Colonne de la cible centrale
 * @returns {Array<{row: number, col: number, player: number}>}
 */
function getAllCrossTargets(targetPlayer, row, col) {
    const adjacentTargets = getCrossTargets(targetPlayer, row, col);
    return [
        { row, col, player: targetPlayer },
        ...adjacentTargets
    ];
}

/**
 * Obtient toutes les positions du terrain (pour pattern 'all')
 * @returns {Array<{player: number, row: number, col: number}>}
 */
function getAllFieldPositions() {
    const positions = [];
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                positions.push({ player: p, row: r, col: c });
            }
        }
    }
    return positions;
}

/**
 * Obtient les positions d'une ligne entière
 * @param {number} targetPlayer - Joueur ciblé
 * @param {number} row - Ligne
 * @returns {Array<{row: number, col: number, player: number}>}
 */
function getLineTargets(targetPlayer, row) {
    return [
        { row, col: 0, player: targetPlayer },
        { row, col: 1, player: targetPlayer }
    ];
}

/**
 * Détermine si un sort est offensif ou défensif
 * @param {Object} spell - Le sort
 * @param {number} casterPlayer - Joueur qui lance le sort
 * @param {number} targetPlayer - Joueur ciblé
 * @returns {boolean} - true si défensif
 */
function isDefensiveSpell(spell, casterPlayer, targetPlayer) {
    // Défensif si on cible soi-même ou si c'est un buff global sans dégâts
    return targetPlayer === casterPlayer ||
           (spell.pattern === 'global' && !spell.damage);
}

module.exports = {
    SPELL_PATTERNS,
    getCrossTargets,
    getAllCrossTargets,
    getAllFieldPositions,
    getLineTargets,
    isDefensiveSpell
};
