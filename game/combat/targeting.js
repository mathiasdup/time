// =============================================
// Combat: Ciblage
// =============================================
// Logique pour déterminer quelle cible une créature va attaquer

/**
 * Types de cibles possibles
 */
const TARGET_TYPES = {
    CREATURE: 'creature',
    HERO: 'hero',
    NONE: 'none'
};

/**
 * Trouve la cible d'une créature
 *
 * Règles de ciblage:
 * - Intangible: attaque toujours le héros directement
 * - Volant: attaque volants/tireurs, sinon héros
 * - Tireur: peut attaquer n'importe quelle créature
 * - Normal: attaque créatures au sol, ignore les volantes
 *
 * @param {Object} attacker - Créature qui attaque
 * @param {Object|null} enemyFront - Créature en front (col 1)
 * @param {Object|null} enemyBack - Créature en back (col 0)
 * @param {number} enemyPlayer - Numéro du joueur adverse
 * @param {number} row - Ligne de combat
 * @param {number} attackerCol - Colonne de l'attaquant (0 ou 1)
 * @returns {{ card: Object|null, col: number, row: number, player: number, isHero: boolean }}
 */
function findTarget(attacker, enemyFront, enemyBack, enemyPlayer, row, attackerCol = 1) {
    const isFlying = attacker.abilities.includes('fly');
    const isShooter = attacker.abilities.includes('shooter');
    const isIntangible = attacker.abilities.includes('intangible');

    // CAS 0: Créature INTANGIBLE - attaque toujours le héros directement
    if (isIntangible) {
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }

    // Ignorer les créatures intangibles lors de la recherche de cibles
    const frontIsIntangible = enemyFront && enemyFront.abilities.includes('intangible');
    const backIsIntangible = enemyBack && enemyBack.abilities.includes('intangible');
    const effectiveFront = frontIsIntangible ? null : enemyFront;
    const effectiveBack = backIsIntangible ? null : enemyBack;

    const frontIsFlying = effectiveFront && effectiveFront.abilities.includes('fly');
    const backIsFlying = effectiveBack && effectiveBack.abilities.includes('fly');
    const frontIsShooter = effectiveFront && effectiveFront.abilities.includes('shooter');
    const backIsShooter = effectiveBack && effectiveBack.abilities.includes('shooter');

    // Vérifier si les créatures ennemies peuvent attaquer (pour l'interception)
    const frontCanAttack = effectiveFront && effectiveFront.canAttack;
    const backCanAttack = effectiveBack && effectiveBack.canAttack;

    // CAS 1: Créature VOLANTE
    if (isFlying) {
        // Interception symétrique (même colonne) - UNIQUEMENT avec d'autres VOLANTS
        if (attackerCol === 0) {
            // Volant en back (col 0) -> vérifie back ennemi
            if (effectiveBack && backIsFlying && backCanAttack) {
                return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
            }
        } else {
            // Volant en front (col 1) -> vérifie front ennemi
            if (effectiveFront && frontIsFlying && frontCanAttack) {
                return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
            }
        }

        // Pas d'interception -> attaque première cible valide (volant OU tireur)
        if (effectiveFront && (frontIsFlying || frontIsShooter)) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (effectiveBack && (backIsFlying || backIsShooter)) {
            return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }

        // Sinon attaque le héros
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }

    // CAS 2: Créature TIREUR
    if (isShooter) {
        if (effectiveFront) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (effectiveBack) {
            return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }

    // CAS 3: Créature NORMALE
    // N'est PAS bloquée par les créatures volantes
    if (effectiveFront && !frontIsFlying) {
        return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
    }
    if (effectiveBack && !backIsFlying) {
        return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
    }

    // Que des volants ou rien -> attaque héros
    return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
}

/**
 * Obtient le type de combat d'une créature
 * @param {Object} creature - La créature
 * @returns {'flying'|'shooter'|'melee'}
 */
function getAttackerType(creature) {
    if (!creature || !creature.abilities) return 'melee';
    if (creature.abilities.includes('fly')) return 'flying';
    if (creature.abilities.includes('shooter')) return 'shooter';
    return 'melee';
}

/**
 * Vérifie si deux créatures vont se croiser (combat mutuel)
 * @param {Object} atk1 - Première attaque
 * @param {Object} atk2 - Deuxième attaque
 * @returns {boolean}
 */
function isMutualCombat(atk1, atk2) {
    // Combat mutuel si chacun cible l'autre
    return atk1.targetCard === atk2.attacker && atk2.targetCard === atk1.attacker;
}

module.exports = {
    TARGET_TYPES,
    findTarget,
    getAttackerType,
    isMutualCombat
};
