// =============================================
// Index principal du module Game
// =============================================
// Point d'entrée pour tous les modules du jeu

// Modules principaux
const cards = require('./cards');
const abilities = require('./abilities');
const combat = require('./combat');
const spells = require('./spells');
const heroes = require('./heroes');
const effects = require('./effects');
const traps = require('./traps');
const utils = require('./utils');

module.exports = {
    // Cards
    cards,
    CardDB: cards.CardDB,
    HERO_NAMES: cards.HERO_NAMES,

    // Abilities
    abilities,

    // Combat
    combat,

    // Spells
    spells,

    // Heroes
    heroes,

    // Effects
    effects,

    // Traps
    traps,

    // Utils
    utils
};
