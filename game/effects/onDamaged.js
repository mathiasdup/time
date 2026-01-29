// =============================================
// Effet: onDamagedThisTurn (Quand subit des dégâts)
// =============================================
// Effets qui se déclenchent quand une créature subit des dégâts pendant le tour

/**
 * Types d'effets onDamagedThisTurn
 */
const ON_DAMAGED_TYPES = {
    DRAW: 'draw' // Fait piocher une carte en fin de tour
};

/**
 * Vérifie si une carte a un effet onDamagedThisTurn
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasOnDamagedEffect(card) {
    return card && card.onDamagedThisTurn !== undefined;
}

/**
 * Vérifie si une carte fait piocher quand elle subit des dégâts
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function hasDrawOnDamaged(card) {
    return card && card.onDamagedThisTurn === 'draw';
}

/**
 * Vérifie si une carte a subi des dégâts ce tour
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function wasDamagedThisTurn(card) {
    return card && card.damagedThisTurn === true;
}

/**
 * Réinitialise le flag de dégâts subis
 * @param {Object} card - La carte
 */
function resetDamagedFlag(card) {
    if (card) {
        card.damagedThisTurn = false;
    }
}

/**
 * Vérifie si l'effet doit se déclencher
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function shouldTriggerOnDamaged(card) {
    return hasDrawOnDamaged(card) && wasDamagedThisTurn(card);
}

/**
 * Traite l'effet de pioche quand une créature a subi des dégâts
 * @param {Object} card - La carte qui a subi des dégâts
 * @param {Object} player - État du joueur propriétaire
 * @param {Function} addToGraveyard - Fonction pour ajouter au cimetière
 * @param {Function} log - Fonction de log
 * @returns {{ drewCard: boolean, card?: Object, burned?: boolean }|null}
 */
function processDrawOnDamaged(card, player, addToGraveyard, log) {
    if (!shouldTriggerOnDamaged(card)) return null;

    if (player.deck.length > 0) {
        const drawnCard = player.deck.pop();
        if (drawnCard.type === 'creature') {
            drawnCard.currentHp = drawnCard.hp;
            drawnCard.canAttack = false;
        }

        if (player.hand.length < 9) {
            player.hand.push(drawnCard);
            if (log) {
                log(`📜 ${card.name} a subi des dégâts, pioche une carte!`, 'action');
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
    ON_DAMAGED_TYPES,
    hasOnDamagedEffect,
    hasDrawOnDamaged,
    wasDamagedThisTurn,
    resetDamagedFlag,
    shouldTriggerOnDamaged,
    processDrawOnDamaged
};
