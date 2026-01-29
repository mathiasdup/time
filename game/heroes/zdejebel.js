// =============================================
// Héros: Zdejebel, fille de satan
// =============================================
// Faction: Rouge
// Capacité: Fin du tour : si le héros adverse a été attaqué, il subit 1 blessure.

const HERO_DATA = {
    id: 'zdejebel',
    name: 'Zdejebel, fille de satan',
    image: 'red/hero_zdejebel.jpg',
    titleColor: '#4d1823ba', // Rouge
    faction: 'red',
    edition: 3,
    ability: 'Fin du tour : si le héros adverse a été attaqué, il subit 1 blessure.'
};

/**
 * Vérifie si le joueur a le héros Zdejebel
 * @param {Object} player - État du joueur
 * @returns {boolean}
 */
function hasZdejebel(player) {
    return player && player.hero && player.hero.id === 'zdejebel';
}

/**
 * Vérifie si l'effet de Zdejebel doit se déclencher
 * @param {Object} owner - Joueur qui possède Zdejebel
 * @param {Object} opponent - Joueur adverse
 * @returns {boolean}
 */
function shouldTrigger(owner, opponent) {
    return hasZdejebel(owner) && opponent.heroAttackedThisTurn === true;
}

/**
 * Applique l'effet de Zdejebel (1 dégât au héros adverse)
 * @param {Object} opponent - Joueur adverse
 * @param {Function} log - Fonction de log
 * @returns {boolean} - true si l'effet a été appliqué
 */
function applyEffect(opponent, log) {
    opponent.hp -= 1;
    if (log) {
        log(`🔥 Zdejebel: Le héros adverse subit 1 blessure supplémentaire!`, 'damage');
    }
    return true;
}

/**
 * Vérifie et applique l'effet de Zdejebel en fin de tour
 * @param {Object} owner - Joueur qui possède Zdejebel
 * @param {Object} opponent - Joueur adverse
 * @param {Function} log - Fonction de log
 * @param {Function} emitAnimation - Fonction pour émettre l'animation
 * @param {Object} room - Room socket.io
 * @param {number} opponentNum - Numéro du joueur adverse
 * @returns {boolean} - true si l'effet a été déclenché
 */
function checkAndApply(owner, opponent, log, emitAnimation, room, opponentNum) {
    if (!shouldTrigger(owner, opponent)) {
        return false;
    }

    applyEffect(opponent, log);

    if (emitAnimation && room) {
        emitAnimation(room, 'zdejebel', { target: opponentNum });
    }

    return true;
}

module.exports = {
    HERO_DATA,
    hasZdejebel,
    shouldTrigger,
    applyEffect,
    checkAndApply
};
