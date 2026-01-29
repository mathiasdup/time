// =============================================
// Capacité: Haste (Célérité)
// =============================================
// Cette créature peut attaquer dès le tour où elle est invoquée.
// Normalement, les créatures doivent attendre un tour avant de pouvoir attaquer.

/**
 * Vérifie si une créature a la capacité Haste
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasHaste(creature) {
    return creature && creature.abilities && creature.abilities.includes('haste');
}

/**
 * Détermine si une créature peut attaquer ce tour
 * (prend en compte Haste et l'état canAttack)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function canAttackThisTurn(creature) {
    if (!creature) return false;
    if (creature.currentHp <= 0) return false;
    if (creature.atk <= 0) return false;
    return creature.canAttack === true;
}

/**
 * Initialise l'état d'attaque d'une créature nouvellement invoquée
 * @param {Object} creature - La créature invoquée
 * @returns {boolean} - True si la créature peut attaquer immédiatement
 */
function initializeCanAttack(creature) {
    if (!creature) return false;

    // Avec Haste, peut attaquer immédiatement
    if (hasHaste(creature)) {
        creature.canAttack = true;
        return true;
    }

    // Sans Haste, doit attendre le prochain tour
    creature.canAttack = false;
    return false;
}

/**
 * Active la capacité d'attaque pour le nouveau tour
 * (appelé au début du tour pour toutes les créatures)
 * @param {Object} creature - La créature
 */
function enableAttackForNewTurn(creature) {
    if (creature) {
        creature.canAttack = true;
    }
}

/**
 * Désactive la capacité d'attaque après une attaque
 * @param {Object} creature - La créature qui a attaqué
 */
function disableAttackAfterUse(creature) {
    if (creature) {
        creature.canAttack = false;
    }
}

module.exports = {
    hasHaste,
    canAttackThisTurn,
    initializeCanAttack,
    enableAttackForNewTurn,
    disableAttackAfterUse
};
