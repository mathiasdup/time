// =============================================
// Capacité: Cleave (Clivant)
// =============================================
// Quand cette créature attaque, elle inflige également des dégâts
// aux créatures adjacentes (au-dessus et en-dessous) de la cible.
// Utilise cleaveX si défini, sinon utilise l'attaque de la créature.

/**
 * Vérifie si une créature a la capacité Cleave
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasCleave(creature) {
    return creature && creature.abilities && creature.abilities.includes('cleave');
}

/**
 * Obtient les dégâts de Cleave
 * @param {Object} creature - La créature avec Cleave
 * @returns {number} - Les dégâts de cleave (cleaveX ou atk)
 */
function getCleaveDamage(creature) {
    return creature.cleaveX || creature.atk;
}

/**
 * Obtient les lignes adjacentes valides pour le Cleave
 * @param {number} targetRow - Ligne de la cible principale
 * @returns {number[]} - Lignes adjacentes valides (0-3)
 */
function getAdjacentRows(targetRow) {
    return [targetRow - 1, targetRow + 1].filter(r => r >= 0 && r < 4);
}

/**
 * Vérifie si une créature peut être touchée par Cleave
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} target - La cible potentielle du cleave
 * @returns {boolean}
 */
function canCleaveTarget(attacker, target) {
    if (!target) return false;

    // Note: Les intangibles PEUVENT être touchés par le cleave
    // (contrairement aux attaques normales où ils sont ignorés)

    // Les créatures volantes ne peuvent être touchées que par volants ou tireurs
    if (target.abilities.includes('fly')) {
        const attackerIsFlying = attacker.abilities.includes('fly');
        const attackerIsShooter = attacker.abilities.includes('shooter');
        if (!attackerIsFlying && !attackerIsShooter) return false;
    }

    return true;
}

/**
 * Applique les dégâts de Cleave aux créatures adjacentes
 * Note: Cette fonction est un helper, l'application réelle des dégâts
 * se fait dans server.js pour gérer les animations et la synchronisation
 *
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} targetOwner - L'état du joueur ciblé
 * @param {number} targetRow - Ligne de la cible principale
 * @param {number} targetCol - Colonne de la cible
 * @param {Function} log - Fonction de log
 * @param {Function} emitAnimation - Fonction pour émettre les animations
 * @param {Object} room - Room socket.io
 * @param {number} targetPlayer - Numéro du joueur ciblé
 * @returns {Array<{row: number, col: number, target: Object, damage: number}>} - Cibles touchées
 */
function applyCleave(attacker, targetOwner, targetRow, targetCol, log, emitAnimation, room, targetPlayer) {
    if (!hasCleave(attacker)) return [];

    const cleaveTargets = [];
    const damage = getCleaveDamage(attacker);
    const adjacentRows = getAdjacentRows(targetRow);

    for (const adjRow of adjacentRows) {
        const adjTarget = targetOwner.field[adjRow][targetCol];

        if (canCleaveTarget(attacker, adjTarget)) {
            adjTarget.currentHp -= damage;
            adjTarget.damagedThisTurn = true;
            log(`⛏️ Clivant ${damage}: ${attacker.name} → ${adjTarget.name} (-${damage})`, 'damage');
            emitAnimation(room, 'damage', { player: targetPlayer, row: adjRow, col: targetCol, amount: damage });

            // Power: gagner +1 ATK si survit aux dégâts
            if (adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + 1;
            }

            cleaveTargets.push({ row: adjRow, col: targetCol, target: adjTarget, damage: damage });
        }
    }

    return cleaveTargets;
}

module.exports = {
    hasCleave,
    getCleaveDamage,
    getAdjacentRows,
    canCleaveTarget,
    applyCleave
};
