// ==================== GAME MODULE INDEX ====================
// Export centralisé de tous les modules du jeu

const cards = require('./cards');
const combat = require('./combat');
const abilities = require('./abilities');
const traps = require('./traps');
const spells = require('./spells');

module.exports = {
    // Cards
    CardDB: cards.CardDB,
    HERO_NAMES: cards.HERO_NAMES,
    HEROES: cards.HEROES,
    getRandomHero: cards.getRandomHero,
    resetCardForGraveyard: cards.resetCardForGraveyard,
    addToGraveyard: cards.addToGraveyard,
    createDeck: cards.createDeck,
    createPlayerState: cards.createPlayerState,
    createGameState: cards.createGameState,

    // Combat
    SLOT_NAMES: combat.SLOT_NAMES,
    findTarget: combat.findTarget,
    collectAllAttacks: combat.collectAllAttacks,
    sortAttacksByPriority: combat.sortAttacksByPriority,
    executeAttack: combat.executeAttack,
    applyTrampleDamage: combat.applyTrampleDamage,
    applyCleaveeDamage: combat.applyCleaveeDamage,
    detectFlyingInterceptions: combat.detectFlyingInterceptions,
    processFlyingInterceptions: combat.processFlyingInterceptions,
    processAllCombat: combat.processAllCombat,
    cleanupDeadCreatures: combat.cleanupDeadCreatures,
    blockCombatSlots: combat.blockCombatSlots,
    unblockCombatSlots: combat.unblockCombatSlots,

    // Abilities
    ABILITIES: abilities.ABILITIES,
    hasAbility: abilities.hasAbility,
    getAbilitiesText: abilities.getAbilitiesText,
    getAbilitiesIcons: abilities.getAbilitiesIcons,
    applyPowerBonus: abilities.applyPowerBonus,
    canAttackThisTurn: abilities.canAttackThisTurn,
    updateCanAttack: abilities.updateCanAttack,
    processOnDeathAbility: abilities.processOnDeathAbility,
    processOnHeroHitAbility: abilities.processOnHeroHitAbility,
    canPlaceAt: abilities.canPlaceAt,

    // Traps
    processTrapsForRow: traps.processTrapsForRow,
    processAllTraps: traps.processAllTraps,
    hasTrapOnRow: traps.hasTrapOnRow,
    placeTrap: traps.placeTrap,
    removeTrap: traps.removeTrap,

    // Spells
    applySpell: spells.applySpell,
    drawCards: spells.drawCards,
    gainMana: spells.gainMana,
    handleDeaths: spells.handleDeaths
};
