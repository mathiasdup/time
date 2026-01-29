// =============================================
// Capacité: Regeneration (Régénération)
// =============================================
// À la fin du tour, cette créature regagne X PV.
// Elle ne peut pas dépasser son maximum de PV actuel.
// X est défini par regenerationX sur la carte (défaut: 1 si non spécifié).

/**
 * Vérifie si une créature a la capacité Regeneration
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasRegeneration(creature) {
    return creature && creature.abilities && creature.abilities.includes('regeneration');
}

/**
 * Obtient la valeur X de Regeneration (combien de PV régénérés)
 * @param {Object} creature - La créature avec Regeneration
 * @returns {number} - La valeur de regenerationX (défaut: 1)
 */
function getRegenerationValue(creature) {
    if (!creature) return 1;
    return creature.regenerationX !== undefined ? creature.regenerationX : 1;
}

/**
 * Obtient le maximum de PV actuel de la créature
 * (peut être différent du HP de base si buffé par un sort)
 * @param {Object} creature - La créature
 * @returns {number}
 */
function getMaxHp(creature) {
    if (!creature) return 0;
    // Si la créature a un maxHp défini (par un buff), utiliser celui-là
    // Sinon utiliser le hp de base
    return creature.maxHp !== undefined ? creature.maxHp : creature.hp;
}

/**
 * Applique la régénération à une créature
 * @param {Object} creature - La créature à régénérer
 * @param {Function} log - Fonction de log (optionnel)
 * @returns {number} - Montant effectivement régénéré
 */
function applyRegeneration(creature, log) {
    if (!hasRegeneration(creature)) return 0;
    if (!creature || creature.currentHp <= 0) return 0; // Pas de regen si mort

    const regenValue = getRegenerationValue(creature);
    const maxHp = getMaxHp(creature);
    const oldHp = creature.currentHp;

    // Calculer les nouveaux PV sans dépasser le max
    creature.currentHp = Math.min(creature.currentHp + regenValue, maxHp);
    const actualRegen = creature.currentHp - oldHp;

    if (actualRegen > 0 && log) {
        log(`💚 ${creature.name} régénère +${actualRegen} PV (${creature.currentHp}/${maxHp})`, 'heal');
    }

    return actualRegen;
}

/**
 * Applique la régénération à toutes les créatures du jeu
 * @param {Object} gameState - État du jeu
 * @param {Function} log - Fonction de log
 * @returns {Array} - Liste des créatures qui ont régénéré [{player, row, col, creature, amount}]
 */
function applyAllRegeneration(gameState, log) {
    const regenerated = [];

    for (let p = 1; p <= 2; p++) {
        const player = gameState.players[p];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && hasRegeneration(card) && card.currentHp > 0) {
                    const amount = applyRegeneration(card, log);
                    if (amount > 0) {
                        regenerated.push({
                            player: p,
                            row: r,
                            col: c,
                            creature: card,
                            amount: amount
                        });
                    }
                }
            }
        }
    }

    return regenerated;
}

module.exports = {
    hasRegeneration,
    getRegenerationValue,
    getMaxHp,
    applyRegeneration,
    applyAllRegeneration
};
