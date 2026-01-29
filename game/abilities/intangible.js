// =============================================
// Capacité: Intangible
// =============================================
// Cette créature est intangible et ne peut pas être ciblée par les attaques normales.
// Elle ne bloque pas non plus les attaques vers les créatures derrière.
//
// IMPORTANT: Les intangibles PEUVENT être touchés par:
// - Les effets de zone (cleave, piétinement)
// - Les sorts qui ciblent une zone

/**
 * Vérifie si une créature a la capacité Intangible
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasIntangible(creature) {
    return creature && creature.abilities && creature.abilities.includes('intangible');
}

/**
 * Vérifie si une créature est intangible
 * (alias de hasIntangible pour compatibilité)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function isIntangible(creature) {
    return hasIntangible(creature);
}

/**
 * Vérifie si une créature peut être touchée par une attaque
 * @param {Object} target - La cible potentielle
 * @returns {boolean}
 */
function canBeTargeted(target) {
    if (!target) return false;
    return !hasIntangible(target);
}

/**
 * Vérifie si une créature bloque le passage vers la ligne arrière
 * (Les créatures intangibles ne bloquent pas)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function blocksBackLine(creature) {
    if (!creature) return false;
    return !hasIntangible(creature);
}

/**
 * Filtre les cibles valides en excluant les intangibles
 * @param {Array} targets - Tableau de créatures
 * @returns {Array} - Créatures qui peuvent être ciblées
 */
function filterTargetable(targets) {
    return targets.filter(t => canBeTargeted(t));
}

module.exports = {
    hasIntangible,
    isIntangible,
    canBeTargeted,
    blocksBackLine,
    filterTargetable
};
