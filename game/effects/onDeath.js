// =============================================
// Effet: onDeath (À la mort)
// =============================================
// Effets qui se déclenchent quand une créature meurt

/**
 * Types d'effets onDeath
 */
const ON_DEATH_TYPES = {
    DAMAGE_HERO: 'damageHero',     // Inflige des dégâts au héros adverse
    DAMAGE_KILLER: 'damageKiller', // Inflige des dégâts à la créature qui l'a tuée
    TRANSFORM_INTO: 'transformInto', // Se transforme en une autre créature
    SUMMON: 'summon',              // Invoque une créature
    DRAW: 'draw'                   // Fait piocher des cartes
};

/**
 * Vérifie si une carte a un effet onDeath
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasOnDeathEffect(card) {
    return card && card.onDeath !== undefined;
}

/**
 * Vérifie si une carte se transforme à la mort
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasTransformOnDeath(card) {
    return card && card.onDeath && card.onDeath.transformInto !== undefined;
}

/**
 * Obtient l'ID de la carte en laquelle se transformer
 * @param {Object} card - La carte
 * @returns {string|null}
 */
function getTransformTargetId(card) {
    if (!hasTransformOnDeath(card)) return null;
    return card.onDeath.transformInto;
}

/**
 * Vérifie si une carte inflige des dégâts au héros à sa mort
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasDamageHeroOnDeath(card) {
    return card && card.onDeath && card.onDeath.damageHero !== undefined;
}

/**
 * Obtient les dégâts infligés au héros à la mort
 * @param {Object} card - La carte
 * @returns {number}
 */
function getDamageHeroAmount(card) {
    if (!hasDamageHeroOnDeath(card)) return 0;
    return card.onDeath.damageHero;
}

/**
 * Vérifie si une carte inflige des dégâts à son tueur à sa mort
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasDamageKillerOnDeath(card) {
    return card && card.onDeath && card.onDeath.damageKiller !== undefined;
}

/**
 * Obtient les dégâts infligés au tueur à la mort
 * @param {Object} card - La carte
 * @returns {number}
 */
function getDamageKillerAmount(card) {
    if (!hasDamageKillerOnDeath(card)) return 0;
    return card.onDeath.damageKiller;
}

/**
 * Traite l'effet damageHero à la mort
 * @param {Object} card - La carte morte
 * @param {number} ownerPlayer - Joueur propriétaire
 * @param {Object} gameState - État du jeu
 * @param {Function} log - Fonction de log
 * @returns {{ damage: number, targetPlayer: number }|null}
 */
function processDamageHeroOnDeath(card, ownerPlayer, gameState, log) {
    if (!hasDamageHeroOnDeath(card)) return null;

    const damage = card.onDeath.damageHero;
    const enemyPlayer = ownerPlayer === 1 ? 2 : 1;

    gameState.players[enemyPlayer].hp -= damage;

    if (log) {
        log(`💀 ${card.name} - Capacité de mort: ${damage} dégâts au héros adverse!`, 'damage');
    }

    return { damage, targetPlayer: enemyPlayer };
}

module.exports = {
    ON_DEATH_TYPES,
    hasOnDeathEffect,
    hasTransformOnDeath,
    getTransformTargetId,
    hasDamageHeroOnDeath,
    getDamageHeroAmount,
    processDamageHeroOnDeath,
    hasDamageKillerOnDeath,
    getDamageKillerAmount
};
