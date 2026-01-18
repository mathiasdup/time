// ==================== SYSTÈME DE PIÈGES ====================
// Gestion des pièges et de leur déclenchement

const { addToGraveyard } = require('./cards');

// ==================== DÉCLENCHEMENT DES PIÈGES ====================

/**
 * Traite les pièges pour une rangée donnée avant le combat
 * @param {Object} room - La room de jeu
 * @param {number} row - La rangée à traiter (0-3)
 * @param {Object} helpers - Fonctions utilitaires {log, sleep, emitAnimation, emitStateToBoth, findTarget}
 */
async function processTrapsForRow(room, row, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, findTarget } = helpers;

    for (let attackerPlayer = 1; attackerPlayer <= 2; attackerPlayer++) {
        const defenderPlayer = attackerPlayer === 1 ? 2 : 1;
        const defenderState = room.gameState.players[defenderPlayer];
        const trap = defenderState.traps[row];

        if (!trap) continue;

        // Trouver les créatures qui vont attaquer sur cette rangée
        const attackerState = room.gameState.players[attackerPlayer];
        const attackers = [];

        for (let col = 0; col < 2; col++) {
            const card = attackerState.field[row][col];
            if (card && card.canAttack) {
                // Vérifier que cette créature va bien attaquer dans la direction du piège
                const target = findTarget(card,
                    defenderState.field[row][1],
                    defenderState.field[row][0],
                    defenderPlayer,
                    row);

                // Le piège se déclenche si la créature attaque (même le héros)
                if (target) {
                    attackers.push({ card, col });
                }
            }
        }

        // Déclencher le piège sur le premier attaquant trouvé
        if (attackers.length > 0) {
            const firstAttacker = attackers[0];

            emitAnimation(room, 'trapTrigger', { player: defenderPlayer, row: row, trap: trap });
            await sleep(700);

            log(`🪤 Piège "${trap.name}" déclenché sur ${firstAttacker.card.name}!`, 'trap');

            // Appliquer les dégâts du piège
            if (trap.damage) {
                firstAttacker.card.currentHp -= trap.damage;
                emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: firstAttacker.col, amount: trap.damage });
                await sleep(500);
            }

            // Effet de paralysie
            if (trap.effect === 'stun') {
                log(`  💫 ${firstAttacker.card.name} est paralysé!`, 'trap');
                firstAttacker.card.canAttack = false;
            }

            // Mettre le piège au cimetière
            addToGraveyard(defenderState, trap);
            defenderState.traps[row] = null;

            emitStateToBoth(room);
            await sleep(500);

            // Vérifier si la créature meurt du piège
            if (firstAttacker.card.currentHp <= 0) {
                const deadCard = firstAttacker.card;
                addToGraveyard(attackerState, deadCard);
                attackerState.field[row][firstAttacker.col] = null;
                log(`  ☠️ ${deadCard.name} détruit par le piège!`, 'damage');
                emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: firstAttacker.col });
                emitStateToBoth(room);
                await sleep(600);

                // Capacité onDeath (via helpers pour éviter dépendance circulaire)
                if (helpers.processOnDeathAbility) {
                    await helpers.processOnDeathAbility(room, deadCard, attackerPlayer, log, sleep);
                }
            }
        }
    }
}

/**
 * Traite tous les pièges pour toutes les rangées
 */
async function processAllTraps(room, helpers) {
    for (let row = 0; row < 4; row++) {
        await processTrapsForRow(room, row, helpers);
    }
}

/**
 * Vérifie si un piège est présent sur une rangée pour un joueur
 */
function hasTrapOnRow(player, row) {
    return player.traps[row] !== null;
}

/**
 * Place un piège sur une rangée
 */
function placeTrap(player, row, trap) {
    if (player.traps[row] === null) {
        player.traps[row] = trap;
        player.trapCards[row] = trap; // Pour l'affichage
        return true;
    }
    return false;
}

/**
 * Retire un piège d'une rangée
 */
function removeTrap(player, row) {
    const trap = player.traps[row];
    player.traps[row] = null;
    player.trapCards[row] = null;
    return trap;
}

// ==================== EXPORTS ====================

module.exports = {
    processTrapsForRow,
    processAllTraps,
    hasTrapOnRow,
    placeTrap,
    removeTrap
};
