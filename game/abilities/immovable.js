// =============================================
// Capacité: Immovable (Immobile)
// =============================================
// Cette créature ne peut pas être déplacée.
// Utilisé principalement pour les tokens comme "Pile d'os".

/**
 * Vérifie si une créature a la capacité Immovable
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasImmovable(creature) {
    return creature && creature.abilities && creature.abilities.includes('immovable');
}

/**
 * Vérifie si une créature est immobile
 * (alias de hasImmovable pour compatibilité)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function isImmovable(creature) {
    return hasImmovable(creature);
}

/**
 * Vérifie si une créature peut être déplacée
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function canBeMoved(creature) {
    if (!creature) return false;
    return !hasImmovable(creature);
}

/**
 * Vérifie si un déplacement est valide pour cette créature
 * @param {Object} creature - La créature à déplacer
 * @param {number} fromRow - Ligne de départ
 * @param {number} toRow - Ligne d'arrivée
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateMove(creature, fromRow, toRow) {
    if (!creature) {
        return { valid: false, reason: 'no creature' };
    }

    if (hasImmovable(creature)) {
        return { valid: false, reason: 'creature is immovable' };
    }

    // Vérifier les restrictions de déplacement standard
    // (une ligne à la fois, avant/arrière uniquement)
    const diff = Math.abs(toRow - fromRow);
    if (diff !== 1) {
        return { valid: false, reason: 'can only move one row at a time' };
    }

    return { valid: true };
}

module.exports = {
    hasImmovable,
    isImmovable,
    canBeMoved,
    validateMove
};
