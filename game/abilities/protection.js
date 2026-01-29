// =============================================
// Capacité: Protection
// =============================================
// Le premier coup que subit cette créature est absorbé.
// Fonctionne contre: attaques de créatures, sorts, sorts de zone, pièges.
//
// Note: La logique d'application des dégâts est dans game/combat.js
// Ce module contient uniquement les fonctions de vérification et d'activation.

/**
 * Vérifie si une créature a la capacité Protection active
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasProtection(creature) {
    return creature && creature.hasProtection === true;
}

/**
 * Vérifie si une créature a la capacité Protection dans ses abilities
 * (peut être inactive si déjà utilisée)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasProtectionAbility(creature) {
    return creature && creature.abilities?.some(a => a.toLowerCase() === 'protection');
}

/**
 * Active la Protection sur une créature (utilisé lors de l'invocation)
 * @param {Object} creature - La créature
 */
function activateProtection(creature) {
    if (!creature) return;

    if (hasProtectionAbility(creature)) {
        creature.hasProtection = true;
    }
}

/**
 * Désactive la Protection sur une créature (quand elle absorbe un coup)
 * @param {Object} creature - La créature
 */
function consumeProtection(creature) {
    if (!creature) return;

    creature.hasProtection = false;

    // Retirer 'Protection' des abilities pour l'affichage
    const protIndex = creature.abilities?.findIndex(a => a.toLowerCase() === 'protection');
    if (protIndex > -1) {
        creature.abilities.splice(protIndex, 1);
    }
}

module.exports = {
    hasProtection,
    hasProtectionAbility,
    activateProtection,
    consumeProtection
};
