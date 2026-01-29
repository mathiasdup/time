// =============================================
// Effets des pièges
// =============================================
// Les différents effets que peuvent avoir les pièges

/**
 * Types d'effets de pièges
 */
const TRAP_EFFECTS = {
    DAMAGE: 'damage',  // Inflige des dégâts
    STUN: 'stun'       // Paralyse (ne peut plus attaquer ce tour)
};

/**
 * Vérifie si un piège inflige des dégâts
 * @param {Object} trap - Le piège
 * @returns {boolean}
 */
function hasDamage(trap) {
    return trap && trap.damage !== undefined && trap.damage > 0;
}

/**
 * Obtient les dégâts du piège
 * @param {Object} trap - Le piège
 * @returns {number}
 */
function getDamage(trap) {
    return trap && trap.damage ? trap.damage : 0;
}

/**
 * Vérifie si un piège a l'effet paralysie
 * @param {Object} trap - Le piège
 * @returns {boolean}
 */
function hasStunEffect(trap) {
    return trap && trap.effect === 'stun';
}

/**
 * Applique l'effet paralysie à une créature
 * @param {Object} creature - La créature à paralyser
 * @param {Function} log - Fonction de log
 */
function applyStun(creature, log) {
    if (!creature) return;

    creature.canAttack = false;

    if (log) {
        log(`💫 ${creature.name} est paralysé!`, 'trap');
    }
}

/**
 * Trouve le premier attaquant sur une rangée
 * @param {Object} attackerState - État du joueur attaquant
 * @param {number} row - Ligne
 * @returns {Array<{card: Object, col: number}>}
 */
function findAttackersOnRow(attackerState, row) {
    const attackers = [];

    for (let col = 0; col < 2; col++) {
        const card = attackerState.field[row][col];
        if (card && card.canAttack) {
            attackers.push({ card, col });
        }
    }

    return attackers;
}

/**
 * Vérifie si un piège doit se déclencher
 * @param {Object} trap - Le piège
 * @param {Array} attackers - Liste des attaquants potentiels
 * @returns {boolean}
 */
function shouldTrigger(trap, attackers) {
    return trap !== null && attackers.length > 0;
}

module.exports = {
    TRAP_EFFECTS,
    hasDamage,
    getDamage,
    hasStunEffect,
    applyStun,
    findAttackersOnRow,
    shouldTrigger
};
