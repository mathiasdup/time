// =============================================
// Effets des sorts
// =============================================
// Logique des différents effets que peuvent avoir les sorts

/**
 * Types d'effets de sorts
 */
const SPELL_EFFECTS = {
    DAMAGE: 'damage',   // Inflige des dégâts
    HEAL: 'heal',       // Soigne
    DRAW: 'draw',       // Pioche des cartes
    MANA: 'mana',       // Gagne du mana
    BUFF: 'buff',       // Améliore une créature
    DEBUFF: 'debuff'    // Affaiblit une créature
};

/**
 * Applique un effet de pioche
 * @param {Object} player - État du joueur
 * @param {number} amount - Nombre de cartes à piocher
 * @param {Function} addToGraveyard - Fonction pour ajouter au cimetière
 * @returns {{ drawnCards: Array, burnedCards: Array }}
 */
function applyDrawEffect(player, amount, addToGraveyard) {
    const drawnCards = [];
    const burnedCards = [];

    for (let i = 0; i < amount; i++) {
        if (player.deck.length > 0) {
            const card = player.deck.pop();
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
            }
            if (player.hand.length < 9) {
                player.hand.push(card);
                drawnCards.push(card);
            } else {
                addToGraveyard(player, card);
                burnedCards.push(card);
            }
        }
    }

    return { drawnCards, burnedCards };
}

/**
 * Applique un effet de gain de mana
 * @param {Object} player - État du joueur
 * @param {Function} addToGraveyard - Fonction pour ajouter au cimetière
 * @returns {{ gainedMana: boolean, drewCard: boolean, burnedCard: Object|null }}
 */
function applyManaEffect(player, addToGraveyard) {
    if (player.maxEnergy < 10) {
        player.maxEnergy++;
        player.energy++;
        return { gainedMana: true, drewCard: false, burnedCard: null };
    } else if (player.deck.length > 0) {
        const card = player.deck.pop();
        if (card.type === 'creature') {
            card.currentHp = card.hp;
            card.canAttack = false;
        }
        if (player.hand.length < 9) {
            player.hand.push(card);
            return { gainedMana: false, drewCard: true, burnedCard: null, card };
        } else {
            addToGraveyard(player, card);
            return { gainedMana: false, drewCard: false, burnedCard: card };
        }
    }
    return { gainedMana: false, drewCard: false, burnedCard: null };
}

/**
 * Applique un effet de soin à un héros
 * @param {Object} hero - État du héros (player)
 * @param {number} amount - Montant de soin
 * @param {number} maxHp - HP maximum (défaut: 20)
 * @returns {number} - Montant réellement soigné
 */
function applyHealToHero(hero, amount, maxHp = 20) {
    const oldHp = hero.hp;
    hero.hp = Math.min(maxHp, hero.hp + amount);
    return hero.hp - oldHp;
}

/**
 * Applique un effet de soin à une créature
 * @param {Object} creature - La créature
 * @param {number} amount - Montant de soin
 * @returns {number} - Montant réellement soigné
 */
function applyHealToCreature(creature, amount) {
    if (!creature) return 0;
    const oldHp = creature.currentHp;
    const maxHp = creature.hp; // HP max de base
    creature.currentHp = Math.min(maxHp, creature.currentHp + amount);
    return creature.currentHp - oldHp;
}

module.exports = {
    SPELL_EFFECTS,
    applyDrawEffect,
    applyManaEffect,
    applyHealToHero,
    applyHealToCreature
};
