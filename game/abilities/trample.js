// =============================================
// Capacité: Trample (Piétinement)
// =============================================
// Quand cette créature tue sa cible, les dégâts excédentaires
// sont infligés à la créature derrière (back) ou au héros adverse.
//
// Règle: Front (col 1) → Back (col 0) → Héros
// Si on attaque le front et qu'il meurt, les dégâts vont au back
// Si on attaque le back ou s'il n'y a pas de créature au back, ça va au héros

/**
 * Vérifie si une créature a la capacité Trample
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasTrample(creature) {
    return creature && creature.abilities && creature.abilities.includes('trample');
}

/**
 * Calcule les dégâts excédentaires après avoir tué une cible
 * @param {Object} target - La cible tuée
 * @returns {number} - Dégâts excédentaires (0 si cible pas morte)
 */
function getExcessDamage(target) {
    if (!target || target.currentHp >= 0) return 0;
    return Math.abs(target.currentHp);
}

/**
 * Trouve la créature derrière la cible (ligne arrière)
 * @param {Object} targetOwner - L'état du joueur ciblé
 * @param {number} targetRow - Ligne de la cible
 * @param {number} targetCol - Colonne de la cible
 * @returns {{ target: Object|null, col: number }} - Créature derrière et sa colonne
 */
function findTrampleTarget(targetOwner, targetRow, targetCol) {
    // La créature derrière est en col 0 si on était sur col 1
    if (targetCol === 1) {
        return {
            target: targetOwner.field[targetRow][0],
            col: 0
        };
    }
    // Si on est déjà en col 0, pas de créature derrière
    return { target: null, col: -1 };
}

/**
 * Vérifie si l'attaquant peut toucher la cible du piétinement
 * (gestion des interactions fly/shooter)
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} trampleTarget - La cible potentielle du piétinement
 * @returns {boolean}
 */
function canTrampleTarget(attacker, trampleTarget) {
    if (!trampleTarget) return false;

    // Note: Les intangibles PEUVENT être touchés par le piétinement
    // (contrairement aux attaques normales où ils sont ignorés)

    const attackerIsFlying = attacker.abilities.includes('fly');
    const attackerIsShooter = attacker.abilities.includes('shooter');

    // Un volant ne peut pas toucher une créature normale avec le piétinement
    if (attackerIsFlying && !attackerIsShooter) {
        const trampleTargetIsFlying = trampleTarget.abilities.includes('fly');
        const trampleTargetIsShooter = trampleTarget.abilities.includes('shooter');
        if (!trampleTargetIsFlying && !trampleTargetIsShooter) {
            return false;
        }
    }

    // Un non-volant/non-tireur ne peut pas toucher un volant
    if (trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
        return false;
    }

    return true;
}

/**
 * Applique les dégâts de piétinement
 * Note: L'application réelle se fait dans server.js via applyDamageToCreature
 * Cette fonction est conservée pour référence mais n'est plus utilisée directement
 *
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} target - La cible principale (doit être morte)
 * @param {Object} targetOwner - L'état du joueur ciblé
 * @param {number} targetRow - Ligne de la cible
 * @param {number} targetCol - Colonne de la cible
 * @param {Function} applyDamageToCreature - Fonction centralisée de dégâts
 * @param {Function} log - Fonction de log
 * @param {Function} emitAnimation - Fonction pour émettre les animations
 * @param {Object} room - Room socket.io
 * @param {number} targetPlayer - Numéro du joueur ciblé
 * @param {Object} io - Socket.io instance (pour emit directDamage)
 * @returns {{ type: 'creature'|'hero'|null, damage: number, target?: Object, blocked?: boolean }}
 */
function applyTrample(attacker, target, targetOwner, targetRow, targetCol, applyDamageToCreature, log, emitAnimation, room, targetPlayer, io) {
    if (!hasTrample(attacker)) return { type: null, damage: 0 };

    const excessDamage = getExcessDamage(target);
    if (excessDamage === 0) return { type: null, damage: 0 };

    const { target: trampleTarget, col: trampleCol } = findTrampleTarget(targetOwner, targetRow, targetCol);

    if (canTrampleTarget(attacker, trampleTarget)) {
        // Dégâts à la créature derrière via la fonction centralisée
        // (gère automatiquement Protection, Power, damagedThisTurn)
        const result = applyDamageToCreature(trampleTarget, excessDamage, room, targetPlayer, targetRow, trampleCol, log, 'trample');

        if (!result.blocked) {
            log(`🦏 Piétinement: ${attacker.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
            emitAnimation(room, 'damage', { player: targetPlayer, row: targetRow, col: trampleCol, amount: excessDamage });
        }

        return { type: 'creature', damage: excessDamage, target: trampleTarget, blocked: result.blocked };
    } else if (excessDamage > 0) {
        // Dégâts au héros
        targetOwner.hp -= excessDamage;
        targetOwner.heroAttackedThisTurn = true;
        log(`🦏 Piétinement: ${attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
        emitAnimation(room, 'heroHit', { defender: targetPlayer, damage: excessDamage });
        io.to(room.code).emit('directDamage', { defender: targetPlayer, damage: excessDamage });

        return { type: 'hero', damage: excessDamage };
    }

    return { type: null, damage: 0 };
}

module.exports = {
    hasTrample,
    getExcessDamage,
    findTrampleTarget,
    canTrampleTarget,
    applyTrample
};
