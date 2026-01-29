// =============================================
// Héros: Hyrule, prophète ultime
// =============================================
// Faction: Vert
// Capacité: Le deuxième sort que vous lancez chaque tour coûte 1 mana de moins.

const HERO_DATA = {
    id: 'hyrule',
    name: 'Hyrule, prophète ultime',
    image: 'green/hero_hyrule.jpg',
    titleColor: '#184d26ba', // Vert
    faction: 'green',
    edition: 3,
    ability: 'Le deuxième sort que vous lancez chaque tour coûte 1 mana de moins.'
};

/**
 * Calcule le coût d'un sort avec la réduction Hyrule
 * @param {Object} spell - Le sort à lancer
 * @param {number} spellsCastThisTurn - Nombre de sorts déjà lancés ce tour
 * @returns {number} - Coût après réduction
 */
function getSpellCost(spell, spellsCastThisTurn) {
    if (!spell) return 0;

    // Le deuxième sort coûte 1 de moins
    if (spellsCastThisTurn === 1) {
        return Math.max(0, spell.cost - 1);
    }

    return spell.cost;
}

/**
 * Vérifie si le joueur a le héros Hyrule
 * @param {Object} player - État du joueur
 * @returns {boolean}
 */
function hasHyrule(player) {
    return player && player.hero && player.hero.id === 'hyrule';
}

/**
 * Applique la réduction de coût si applicable
 * @param {Object} player - État du joueur
 * @param {Object} spell - Le sort
 * @returns {number} - Coût final
 */
function applyHyruleDiscount(player, spell) {
    if (!hasHyrule(player)) return spell.cost;
    return getSpellCost(spell, player.spellsCastThisTurn || 0);
}

module.exports = {
    HERO_DATA,
    getSpellCost,
    hasHyrule,
    applyHyruleDiscount
};
