// =============================================
// Effet: onHeroHit (Quand touche le héros)
// =============================================
// Effets qui se déclenchent quand une créature inflige des dégâts au héros adverse

/**
 * Types d'effets onHeroHit
 */
const ON_HERO_HIT_TYPES = {
    DRAW: 'draw' // Fait piocher une carte
};

/**
 * Vérifie si une carte a un effet onHeroHit
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasOnHeroHitEffect(card) {
    return card && card.onHeroHit !== undefined;
}

/**
 * Vérifie si une carte fait piocher quand elle touche le héros
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasDrawOnHeroHit(card) {
    return card && card.onHeroHit === 'draw';
}

/**
 * Traite l'effet de pioche quand une créature touche le héros
 * @param {Object} card - La carte qui a touché le héros
 * @param {Object} player - État du joueur propriétaire
 * @param {Function} addToGraveyard - Fonction pour ajouter au cimetière
 * @param {Function} log - Fonction de log
 * @returns {{ drewCard: boolean, card?: Object, burned?: boolean }|null}
 */
function processDrawOnHeroHit(card, player, addToGraveyard, log) {
    if (!hasDrawOnHeroHit(card)) return null;

    if (player.deck.length > 0) {
        const drawnCard = player.deck.pop();
        if (drawnCard.type === 'creature') {
            drawnCard.currentHp = drawnCard.hp;
            drawnCard.canAttack = false;
        }

        if (player.hand.length < 9) {
            player.hand.push(drawnCard);
            if (log) {
                log(`📜 ${card.name} pioche une carte en touchant le héros!`, 'action');
            }
            return { drewCard: true, card: drawnCard, burned: false };
        } else {
            addToGraveyard(player, drawnCard);
            if (log) {
                log(`📦 Main pleine, ${drawnCard.name} va au cimetière`, 'damage');
            }
            return { drewCard: false, card: drawnCard, burned: true };
        }
    }

    return { drewCard: false };
}

module.exports = {
    ON_HERO_HIT_TYPES,
    hasOnHeroHitEffect,
    hasDrawOnHeroHit,
    processDrawOnHeroHit
};
