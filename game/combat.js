// =============================================
// Module Combat - Gestion centralisée des dégâts
// =============================================
// Ce module centralise TOUTE la logique de dégâts du jeu.
// Il est utilisé par server.js pour éviter la duplication de code.

const { hasPower, getPowerValue, addPendingPowerBonus, applyPendingPowerBonus } = require('./abilities/power');
const { hasProtection, hasProtectionAbility, activateProtection } = require('./abilities/protection');
const { hasTrample, getExcessDamage, findTrampleTarget, canTrampleTarget } = require('./abilities/trample');
const { hasCleave, getCleaveDamage, getAdjacentRows, canCleaveTarget } = require('./abilities/cleave');
// Note: getAdjacentRows est utilisé par server.js pour le cleave mutuel
const { hasFly, getCombatType, canHitFlying } = require('./abilities/fly');
const { hasShooter } = require('./abilities/shooter');
const { hasIntangible, blocksBackLine } = require('./abilities/intangible');
const { hasHaste, initializeCanAttack } = require('./abilities/haste');
const { hasImmovable, canBeMoved } = require('./abilities/immovable');

/**
 * Fonction centralisée pour TOUS les dégâts infligés aux créatures
 * Gère automatiquement: Protection, Power, damagedThisTurn
 *
 * @param {Object} creature - La créature qui reçoit les dégâts
 * @param {number} damage - Montant de dégâts
 * @param {Object} options - Options supplémentaires
 * @param {Object} options.room - Room socket.io (optionnel)
 * @param {number} options.ownerPlayer - Numéro du joueur (1 ou 2)
 * @param {number} options.row - Ligne de la créature
 * @param {number} options.col - Colonne de la créature
 * @param {Function} options.log - Fonction de log
 * @param {Function} options.emitAnimation - Fonction pour émettre les animations
 * @param {string} options.source - Source des dégâts ('attack', 'spell', 'trap', 'cleave', 'trample')
 * @param {Object} options.attacker - Créature attaquante (pour onDeath.damageKiller)
 * @param {number} options.attackerPlayer - Joueur de l'attaquant
 * @param {number} options.attackerRow - Ligne de l'attaquant
 * @param {number} options.attackerCol - Colonne de l'attaquant
 * @returns {{ blocked: boolean, damage: number, died: boolean }}
 */
function applyDamageToCreature(creature, damage, options = {}) {
    const { room, ownerPlayer, row, col, log, emitAnimation, source = 'attack', attacker, attackerPlayer, attackerRow, attackerCol } = options;

    if (!creature || damage <= 0) {
        return { blocked: false, damage: 0, died: false };
    }

    // Vérifier si la créature a Protection active
    if (hasProtection(creature)) {
        // Protection absorbe les dégâts
        creature.hasProtection = false;

        // Retirer 'Protection' des abilities pour l'affichage
        const protIndex = creature.abilities?.findIndex(a => a.toLowerCase() === 'protection');
        if (protIndex > -1) {
            creature.abilities.splice(protIndex, 1);
        }

        if (log) {
            log(`🛡️ ${creature.name}: Protection absorbe les dégâts!`, 'special');
        }

        // Émettre l'animation de bris du bouclier
        if (room && emitAnimation) {
            emitAnimation(room, 'shieldBreak', { player: ownerPlayer, row, col });
        }

        return { blocked: true, damage: 0, died: false };
    }

    // Appliquer les dégâts normalement
    creature.currentHp -= damage;

    // Marquer que la créature a subi des dégâts ce tour (pour onDamagedThisTurn)
    creature.damagedThisTurn = true;

    // Power: Si la créature survit et a Power, elle gagne +X ATK
    if (creature.currentHp > 0 && hasPower(creature)) {
        const powerValue = getPowerValue(creature);
        addPendingPowerBonus(creature, powerValue);
    }

    const died = creature.currentHp <= 0;

    // Si la créature meurt et qu'on a un attaquant, stocker l'info pour onDeath.damageKiller
    if (died && attacker && attackerPlayer !== undefined) {
        creature._killer = {
            card: attacker,
            player: attackerPlayer,
            row: attackerRow,
            col: attackerCol
        };
    }

    return { blocked: false, damage, died };
}

/**
 * Applique les dégâts de Cleave aux créatures adjacentes
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} targetOwner - État du joueur ciblé
 * @param {number} targetRow - Ligne de la cible principale
 * @param {number} targetCol - Colonne de la cible
 * @param {Object} options - Options (room, targetPlayer, log, emitAnimation)
 * @returns {Array<{row: number, col: number, target: Object, damage: number, blocked: boolean}>}
 */
function applyCleaveToAdjacent(attacker, targetOwner, targetRow, targetCol, options = {}) {
    const { room, targetPlayer, log, emitAnimation } = options;

    if (!hasCleave(attacker)) return [];

    const results = [];
    const damage = getCleaveDamage(attacker);
    const adjacentRows = getAdjacentRows(targetRow);

    for (const adjRow of adjacentRows) {
        const adjTarget = targetOwner.field[adjRow][targetCol];

        if (canCleaveTarget(attacker, adjTarget)) {
            const result = applyDamageToCreature(adjTarget, damage, {
                room,
                ownerPlayer: targetPlayer,
                row: adjRow,
                col: targetCol,
                log,
                emitAnimation,
                source: 'cleave'
            });

            if (!result.blocked && log) {
                log(`⛏️ Cleave: ${attacker.name} → ${adjTarget.name} (-${damage})`, 'damage');
            }

            if (emitAnimation && !result.blocked) {
                emitAnimation(room, 'damage', {
                    player: targetPlayer,
                    row: adjRow,
                    col: targetCol,
                    amount: damage
                });
            }

            results.push({
                row: adjRow,
                col: targetCol,
                target: adjTarget,
                damage,
                blocked: result.blocked,
                died: result.died
            });
        }
    }

    return results;
}

/**
 * Applique les dégâts de Piétinement (Trample)
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} target - La cible principale (doit être morte)
 * @param {Object} targetOwner - État du joueur ciblé
 * @param {number} targetRow - Ligne de la cible
 * @param {number} targetCol - Colonne de la cible
 * @param {Object} options - Options (room, targetPlayer, log, emitAnimation, io)
 * @returns {{ type: 'creature'|'hero'|null, damage: number, target?: Object, blocked?: boolean }}
 */
function applyTrampleDamage(attacker, target, targetOwner, targetRow, targetCol, options = {}) {
    const { room, targetPlayer, log, emitAnimation, io } = options;

    if (!hasTrample(attacker)) {
        return { type: null, damage: 0 };
    }

    const excessDamage = getExcessDamage(target);
    if (excessDamage === 0) {
        return { type: null, damage: 0 };
    }

    const { target: trampleTarget, col: trampleCol } = findTrampleTarget(targetOwner, targetRow, targetCol);

    if (canTrampleTarget(attacker, trampleTarget)) {
        // Dégâts à la créature derrière
        const result = applyDamageToCreature(trampleTarget, excessDamage, {
            room,
            ownerPlayer: targetPlayer,
            row: targetRow,
            col: trampleCol,
            log,
            emitAnimation,
            source: 'trample'
        });

        if (!result.blocked && log) {
            log(`🦏 Piétinement: ${attacker.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
        }

        if (emitAnimation && !result.blocked) {
            emitAnimation(room, 'damage', {
                player: targetPlayer,
                row: targetRow,
                col: trampleCol,
                amount: excessDamage
            });
        }

        return {
            type: 'creature',
            damage: excessDamage,
            target: trampleTarget,
            blocked: result.blocked,
            died: result.died
        };
    } else if (excessDamage > 0) {
        // Dégâts au héros
        targetOwner.hp -= excessDamage;
        targetOwner.heroAttackedThisTurn = true;

        if (log) {
            log(`🦏 Piétinement: ${attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
        }

        if (emitAnimation) {
            emitAnimation(room, 'heroHit', { defender: targetPlayer, damage: excessDamage });
        }

        if (io && room) {
            io.to(room.code).emit('directDamage', { defender: targetPlayer, damage: excessDamage });
        }

        return { type: 'hero', damage: excessDamage };
    }

    return { type: null, damage: 0 };
}

/**
 * Détermine si un attaquant peut toucher une cible
 * (gère fly, shooter, intangible)
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} target - La cible potentielle
 * @returns {boolean}
 */
function canAttackTarget(attacker, target) {
    if (!attacker || !target) return false;

    // Les intangibles ne peuvent pas être ciblés directement
    if (hasIntangible(target)) return false;

    // Vérifier les interactions fly/shooter
    return canHitFlying(attacker, target);
}

/**
 * Détermine l'ordre de combat entre deux créatures
 * @param {Object} creature1 - Première créature
 * @param {Object} creature2 - Deuxième créature
 * @returns {{ first: 1|2|null, simultaneous: boolean }}
 */
function determineCombatOrder(creature1, creature2) {
    // Combat toujours simultané (initiative a été retirée du jeu)
    return { first: null, simultaneous: true };
}

/**
 * Applique les bonus Power en attente à toutes les créatures
 * @param {Object} gameState - État du jeu
 * @param {Function} log - Fonction de log
 */
function applyAllPendingPowerBonuses(gameState, log) {
    for (let p = 1; p <= 2; p++) {
        const player = gameState.players[p];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.pendingPowerBonus > 0 && card.currentHp > 0) {
                    const bonus = applyPendingPowerBonus(card, log);
                    if (bonus > 0 && log) {
                        log(`💪 ${card.name} gagne +${bonus} ATK!`, 'action');
                    }
                }
            }
        }
    }
}

/**
 * Initialise une créature nouvellement invoquée
 * @param {Object} creature - La créature
 */
function initializeCreature(creature) {
    if (!creature) return;

    // Haste
    initializeCanAttack(creature);

    // Protection
    activateProtection(creature);

    // HP courants
    if (creature.currentHp === undefined) {
        creature.currentHp = creature.hp;
    }
}

// Exports
module.exports = {
    // Fonction principale de dégâts
    applyDamageToCreature,

    // Capacités offensives
    applyCleaveToAdjacent,
    applyTrampleDamage,

    // Utilitaires de combat
    canAttackTarget,
    determineCombatOrder,
    applyAllPendingPowerBonuses,
    initializeCreature,

    // Ré-exports des modules pour accès facile
    abilities: {
        hasPower,
        getPowerValue,
        hasProtection,
        hasProtectionAbility,
        hasTrample,
        hasCleave,
        getCleaveDamage,
        getAdjacentRows,
        hasFly,
        getCombatType,
        hasShooter,
        hasIntangible,
        blocksBackLine,
        hasHaste,
        hasImmovable,
        canBeMoved
    }
};
