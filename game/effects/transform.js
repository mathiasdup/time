// =============================================
// Effet: Transform (Transformation)
// =============================================
// Logique de transformation des créatures (ex: Petit Os -> Pile d'os)

/**
 * Crée une carte transformée à partir de l'original
 * @param {Object} originalCard - Carte originale
 * @param {string} targetCardId - ID de la carte cible
 * @param {number} ownerPlayer - Joueur propriétaire
 * @param {Object} CardDB - Base de données des cartes
 * @returns {Object|null}
 */
function createTransformedCard(originalCard, targetCardId, ownerPlayer, CardDB) {
    const targetTemplate = CardDB.creatures.find(c => c.id === targetCardId);
    if (!targetTemplate) return null;

    return {
        ...targetTemplate,
        uid: `${Date.now()}-transform-${Math.random()}`,
        currentHp: targetTemplate.hp,
        baseAtk: targetTemplate.atk,
        baseHp: targetTemplate.hp,
        canAttack: false,
        turnsOnField: 0,
        movedThisTurn: false,
        // Garder trace de l'original pour les transformations inverses
        originalCard: originalCard ? { id: originalCard.id, name: originalCard.name } : null
    };
}

/**
 * Vérifie si une carte peut se retransformer (ex: Pile d'os -> Petit Os)
 * @param {Object} card - La carte
 * @returns {boolean}
 */
function canRetransform(card) {
    return card && card.transformsInto !== undefined;
}

/**
 * Obtient l'ID de retransformation
 * @param {Object} card - La carte
 * @returns {string|null}
 */
function getRetransformTargetId(card) {
    if (!canRetransform(card)) return null;
    return card.transformsInto;
}

/**
 * Trouve toutes les cartes qui doivent se retransformer sur le terrain
 * @param {Object} player - État du joueur
 * @returns {Array<{row: number, col: number, card: Object}>}
 */
function findCardsToRetransform(player) {
    const cards = [];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const card = player.field[r][c];
            if (card && canRetransform(card)) {
                cards.push({ row: r, col: c, card });
            }
        }
    }
    return cards;
}

/**
 * Traite les retransformations pour un joueur (ex: Pile d'os -> Petit Os)
 * @param {Object} player - État du joueur
 * @param {number} playerNum - Numéro du joueur
 * @param {Object} CardDB - Base de données des cartes
 * @param {Function} log - Fonction de log
 * @returns {Array<{row: number, col: number, fromCard: Object, toCard: Object}>}
 */
function processRetransformations(player, playerNum, CardDB, log) {
    const transformations = [];
    const cardsToTransform = findCardsToRetransform(player);

    for (const { row, col, card } of cardsToTransform) {
        const targetId = getRetransformTargetId(card);
        const newCard = createTransformedCard(card, targetId, playerNum, CardDB);

        if (newCard) {
            player.field[row][col] = newCard;
            transformations.push({
                row,
                col,
                fromCard: card,
                toCard: newCard
            });

            if (log) {
                log(`🔄 ${card.name} se transforme en ${newCard.name}!`, 'special');
            }
        }
    }

    return transformations;
}

module.exports = {
    createTransformedCard,
    canRetransform,
    getRetransformTargetId,
    findCardsToRetransform,
    processRetransformations
};
