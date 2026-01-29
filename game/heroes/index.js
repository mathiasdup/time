// =============================================
// Index des héros
// =============================================

const hyrule = require('./hyrule');
const zdejebel = require('./zdejebel');

/**
 * Liste de tous les héros disponibles
 */
const HEROES = {
    hyrule: hyrule.HERO_DATA,
    zdejebel: zdejebel.HERO_DATA
};

/**
 * Sélectionne un héros aléatoire
 * @returns {Object} - Données du héros
 */
function getRandomHero() {
    const heroKeys = Object.keys(HEROES);
    const randomKey = heroKeys[Math.floor(Math.random() * heroKeys.length)];
    return { ...HEROES[randomKey] };
}

/**
 * Obtient un héros par son ID
 * @param {string} heroId - ID du héros
 * @returns {Object|null}
 */
function getHeroById(heroId) {
    return HEROES[heroId] ? { ...HEROES[heroId] } : null;
}

/**
 * Liste des IDs de tous les héros
 * @returns {string[]}
 */
function getAllHeroIds() {
    return Object.keys(HEROES);
}

module.exports = {
    HEROES,
    getRandomHero,
    getHeroById,
    getAllHeroIds,

    // Modules individuels
    hyrule,
    zdejebel
};
