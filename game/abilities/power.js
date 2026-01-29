// =============================================
// Capacité: Power (Puissance)
// =============================================
// Quand cette créature subit des dégâts et survit, elle gagne +X ATK.
// X est défini par powerX sur la carte (défaut: 1 si non spécifié).
// S'applique à TOUS les types de dégâts: combat, sorts, cleave, trample, etc.
// Le bonus est appliqué à la fin du tour de combat.

/**
 * Vérifie si une créature a la capacité Power
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasPower(creature) {
    return creature && creature.abilities && creature.abilities.includes('power');
}

/**
 * Obtient la valeur X de Power (combien d'ATK gagné par dégât subi)
 * @param {Object} creature - La créature avec Power
 * @returns {number} - La valeur de powerX (défaut: 1)
 */
function getPowerValue(creature) {
    if (!creature) return 1;
    return creature.powerX !== undefined ? creature.powerX : 1;
}

/**
 * Vérifie si la créature peut gagner un bonus de Power
 * (elle doit avoir Power, avoir survécu aux dégâts)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function canGainPowerBonus(creature) {
    return hasPower(creature) && creature.currentHp > 0;
}

/**
 * Ajoute un bonus de Power en attente à une créature
 * Le bonus sera appliqué à la fin du combat
 * @param {Object} creature - La créature qui gagne le bonus
 * @param {number} amount - Montant du bonus (défaut: 1)
 */
function addPendingPowerBonus(creature, amount = 1) {
    if (!creature) return;
    creature.pendingPowerBonus = (creature.pendingPowerBonus || 0) + amount;
}

/**
 * Applique les bonus de Power en attente à une créature
 * @param {Object} creature - La créature
 * @param {Function} log - Fonction de log (optionnel)
 * @returns {number} - Montant du bonus appliqué
 */
function applyPendingPowerBonus(creature, log) {
    if (!creature || !creature.pendingPowerBonus) return 0;

    const bonus = creature.pendingPowerBonus;
    creature.atk += bonus;
    delete creature.pendingPowerBonus;

    if (log) {
        log(`⚡ ${creature.name} gagne +${bonus} ATK (Power)!`, 'buff');
    }

    return bonus;
}

/**
 * Vérifie et ajoute le bonus Power si applicable
 * (Fonction helper qui combine les vérifications)
 * Utilise automatiquement powerX de la créature si défini
 * @param {Object} creature - La créature qui a reçu des dégâts
 */
function checkAndAddPowerBonus(creature) {
    if (canGainPowerBonus(creature)) {
        const powerValue = getPowerValue(creature);
        addPendingPowerBonus(creature, powerValue);
    }
}

module.exports = {
    hasPower,
    getPowerValue,
    canGainPowerBonus,
    addPendingPowerBonus,
    applyPendingPowerBonus,
    checkAndAddPowerBonus
};
