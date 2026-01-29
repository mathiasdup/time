// =============================================
// Capacité: Fly (Vol)
// =============================================
// Cette créature vole au-dessus du champ de bataille.
// Elle ne peut être touchée que par d'autres volants ou des tireurs.
// Elle ne peut toucher que d'autres volants/tireurs (sauf si elle est aussi tireur).

/**
 * Vérifie si une créature a la capacité Fly
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasFly(creature) {
    return creature && creature.abilities && creature.abilities.includes('fly');
}

/**
 * Obtient le type de combat d'une créature
 * @param {Object} creature - La créature
 * @returns {'flying'|'shooter'|'melee'}
 */
function getCombatType(creature) {
    if (!creature || !creature.abilities) return 'melee';
    if (creature.abilities.includes('fly')) return 'flying';
    if (creature.abilities.includes('shooter')) return 'shooter';
    return 'melee';
}

/**
 * Vérifie si un attaquant peut toucher une cible volante
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} target - La cible (doit être volante)
 * @returns {boolean}
 */
function canHitFlying(attacker, target) {
    if (!hasFly(target)) return true; // Pas volante = touchable

    // Seuls les volants et tireurs peuvent toucher les volants
    const attackerIsFlying = hasFly(attacker);
    const attackerIsShooter = attacker.abilities && attacker.abilities.includes('shooter');

    return attackerIsFlying || attackerIsShooter;
}

/**
 * Vérifie si un volant peut toucher une cible au sol
 * @param {Object} attacker - La créature volante qui attaque
 * @param {Object} target - La cible au sol
 * @returns {boolean}
 */
function canFlyingHitGround(attacker, target) {
    if (!hasFly(attacker)) return true; // Pas volant = peut toucher le sol

    // Un volant peut toucher une créature au sol SAUF si...
    // En fait, dans ce jeu, un volant peut toucher le sol normalement
    // La restriction est dans l'autre sens (sol ne peut pas toucher volant)

    const targetIsFlying = hasFly(target);
    const targetIsShooter = target.abilities && target.abilities.includes('shooter');

    // Un volant peut toucher:
    // - Les volants (combat aérien)
    // - Les tireurs (ils sont accessibles)
    // - Les créatures au sol (il descend pour attaquer)
    // Note: Pour le piétinement, c'est différent - voir trample.js

    return true;
}

/**
 * Vérifie si deux créatures peuvent combattre ensemble
 * (gère les interactions vol/sol/tireur)
 * @param {Object} creature1 - Première créature
 * @param {Object} creature2 - Deuxième créature
 * @returns {{ canFight: boolean, reason?: string }}
 */
function canCreaturesFight(creature1, creature2) {
    const c1Flying = hasFly(creature1);
    const c2Flying = hasFly(creature2);
    const c1Shooter = creature1.abilities && creature1.abilities.includes('shooter');
    const c2Shooter = creature2.abilities && creature2.abilities.includes('shooter');

    // Si aucun n'est volant, ils peuvent combattre
    if (!c1Flying && !c2Flying) {
        return { canFight: true };
    }

    // Si les deux sont volants, ils peuvent combattre
    if (c1Flying && c2Flying) {
        return { canFight: true };
    }

    // Un volant vs sol: le volant peut toucher le sol
    // Mais le sol ne peut toucher le volant que s'il est tireur
    if (c1Flying && !c2Flying) {
        if (!c2Shooter) {
            return { canFight: false, reason: 'ground cannot hit flying' };
        }
    }

    if (c2Flying && !c1Flying) {
        if (!c1Shooter) {
            return { canFight: false, reason: 'ground cannot hit flying' };
        }
    }

    return { canFight: true };
}

module.exports = {
    hasFly,
    getCombatType,
    canHitFlying,
    canFlyingHitGround,
    canCreaturesFight
};
