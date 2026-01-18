// ==================== SYSTÈME DE COMBAT ====================
// Toute la logique de combat centralisée et propre

const { addToGraveyard } = require('./cards');

// Noms des slots pour le log
const SLOT_NAMES = [
    ['A1', 'A2'],
    ['B1', 'B2'],
    ['C1', 'C2'],
    ['D1', 'D2']
];

// ==================== RECHERCHE DE CIBLE ====================

/**
 * Trouve la cible pour un attaquant
 * @param {Object} attacker - La carte attaquante
 * @param {Object} enemyFront - Créature ennemie en col 1 (front)
 * @param {Object} enemyBack - Créature ennemie en col 0 (back)
 * @param {number} enemyPlayer - Numéro du joueur ennemi
 * @param {number} row - Ligne d'attaque
 * @returns {Object|null} - Cible trouvée ou null
 */
function findTarget(attacker, enemyFront, enemyBack, enemyPlayer, row) {
    const isShooter = attacker.abilities?.includes('shooter');
    const isFlying = attacker.abilities?.includes('fly');

    // Tireur : peut cibler n'importe qui (front d'abord, puis back)
    if (isShooter) {
        if (enemyFront && !enemyFront.abilities?.includes('intangible')) {
            return { card: enemyFront, player: enemyPlayer, row, col: 1, isHero: false };
        }
        if (enemyBack && !enemyBack.abilities?.includes('intangible')) {
            return { card: enemyBack, player: enemyPlayer, row, col: 0, isHero: false };
        }
        // Pas de créature, attaque le héros
        return { card: null, player: enemyPlayer, row, col: -1, isHero: true };
    }

    // Volant : peut cibler n'importe qui (front d'abord, puis back)
    if (isFlying) {
        if (enemyFront && !enemyFront.abilities?.includes('intangible')) {
            return { card: enemyFront, player: enemyPlayer, row, col: 1, isHero: false };
        }
        if (enemyBack && !enemyBack.abilities?.includes('intangible')) {
            return { card: enemyBack, player: enemyPlayer, row, col: 0, isHero: false };
        }
        // Pas de créature, attaque le héros
        return { card: null, player: enemyPlayer, row, col: -1, isHero: true };
    }

    // Mêlée : doit attaquer le front d'abord
    if (enemyFront && !enemyFront.abilities?.includes('intangible')) {
        return { card: enemyFront, player: enemyPlayer, row, col: 1, isHero: false };
    }
    // Si pas de front, attaque le back
    if (enemyBack && !enemyBack.abilities?.includes('intangible')) {
        return { card: enemyBack, player: enemyPlayer, row, col: 0, isHero: false };
    }
    // Pas de créature, attaque le héros
    return { card: null, player: enemyPlayer, row, col: -1, isHero: true };
}

// ==================== COLLECTE DES ATTAQUES ====================

/**
 * Collecte toutes les attaques possibles pour cette phase de combat
 */
function collectAllAttacks(gameState) {
    const p1State = gameState.players[1];
    const p2State = gameState.players[2];
    const allAttacks = [];

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
            // Joueur 1
            const p1Card = p1State.field[row][col];
            if (p1Card && p1Card.canAttack && p1Card.currentHp > 0 && !p1Card.hasIntercepted) {
                const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row);
                if (target) {
                    allAttacks.push(createAttackData(p1Card, 1, row, col, target));
                }
            }

            // Joueur 2
            const p2Card = p2State.field[row][col];
            if (p2Card && p2Card.canAttack && p2Card.currentHp > 0 && !p2Card.hasIntercepted) {
                const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row);
                if (target) {
                    allAttacks.push(createAttackData(p2Card, 2, row, col, target));
                }
            }
        }
    }

    return allAttacks;
}

/**
 * Crée un objet d'attaque standardisé
 */
function createAttackData(attacker, attackerPlayer, row, col, target) {
    return {
        attacker,
        attackerPlayer,
        attackerRow: row,
        attackerCol: col,
        target: target.card,
        targetPlayer: target.player,
        targetRow: target.row,
        targetCol: target.col,
        targetIsHero: target.isHero,
        hasInitiative: attacker.abilities?.includes('initiative') || false,
        hasTrample: attacker.abilities?.includes('trample') || false,
        isShooter: attacker.abilities?.includes('shooter') || false,
        isFlying: attacker.abilities?.includes('fly') || false,
        slotOrder: row * 2 + col
    };
}

/**
 * Trie les attaques : initiative d'abord, puis par ordre de slot
 */
function sortAttacksByPriority(attacks) {
    return attacks.sort((a, b) => {
        // Initiative a la priorité absolue
        if (a.hasInitiative && !b.hasInitiative) return -1;
        if (!a.hasInitiative && b.hasInitiative) return 1;
        // Sinon, par ordre de slot (A, B, C, D...)
        return a.slotOrder - b.slotOrder;
    });
}

// ==================== EXÉCUTION DU COMBAT ====================

/**
 * Exécute une attaque unique
 */
async function executeAttack(room, atk, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth } = helpers;
    const gameState = room.gameState;

    // Vérifier si l'attaquant est encore en vie
    const attackerCard = gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
    if (!attackerCard || attackerCard.currentHp <= 0) return { skip: true };

    // Vérifier/mettre à jour la cible
    if (!atk.targetIsHero) {
        const targetCard = gameState.players[atk.targetPlayer].field[atk.targetRow]?.[atk.targetCol];
        if (!targetCard || targetCard.currentHp <= 0) {
            // La cible est morte, chercher une nouvelle cible
            const enemyState = gameState.players[atk.targetPlayer];
            const newTarget = findTarget(attackerCard, enemyState.field[atk.attackerRow][1], enemyState.field[atk.attackerRow][0], atk.targetPlayer, atk.attackerRow);
            if (!newTarget) return { skip: true };
            atk.target = newTarget.card;
            atk.targetRow = newTarget.row;
            atk.targetCol = newTarget.col;
            atk.targetIsHero = newTarget.isHero;
        }
    }

    const damage = attackerCard.atk;
    const slotName = SLOT_NAMES[atk.attackerRow][atk.attackerCol];

    if (atk.targetIsHero) {
        return await executeHeroAttack(room, atk, attackerCard, damage, slotName, helpers);
    } else {
        return await executeCreatureAttack(room, atk, attackerCard, damage, slotName, helpers);
    }
}

/**
 * Attaque contre le héros
 */
async function executeHeroAttack(room, atk, attackerCard, damage, slotName, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, io } = helpers;
    const targetPlayer = room.gameState.players[atk.targetPlayer];

    emitAnimation(room, 'attack', {
        combatType: atk.isShooter ? 'shooter' : 'solo',
        attacker: atk.attackerPlayer,
        row: atk.attackerRow,
        col: atk.attackerCol,
        targetPlayer: atk.targetPlayer,
        targetRow: atk.attackerRow,
        targetCol: -1,
        damage: damage,
        isFlying: atk.isFlying,
        isShooter: atk.isShooter
    });
    await sleep(800);

    targetPlayer.hp -= damage;
    targetPlayer.heroAttackedThisTurn = true;
    log(`⚔️ ${attackerCard.name} [${slotName}] → ${targetPlayer.heroName} (-${damage})${atk.hasInitiative ? ' [Init]' : ''}`, 'damage');
    io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: damage });

    // Capacité onHeroHit
    if (attackerCard.onHeroHit === 'draw') {
        const attackerOwner = room.gameState.players[atk.attackerPlayer];
        if (attackerOwner.deck.length > 0) {
            const drawnCard = attackerOwner.deck.shift();
            if (attackerOwner.hand.length < 10) {
                attackerOwner.hand.push(drawnCard);
                log(`  🎴 ${attackerCard.name} pioche ${drawnCard.name}`, 'action');
                emitAnimation(room, 'draw', { cards: [{ player: atk.attackerPlayer, card: drawnCard, handIndex: attackerOwner.hand.length - 1 }] });
            } else {
                addToGraveyard(attackerOwner, drawnCard);
                log(`  📦 Main pleine, ${drawnCard.name} au cimetière`, 'damage');
            }
        }
    }

    return { heroKilled: targetPlayer.hp <= 0 };
}

/**
 * Attaque contre une créature avec riposte
 */
async function executeCreatureAttack(room, atk, attackerCard, damage, slotName, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth } = helpers;
    const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];

    if (!targetCard || targetCard.currentHp <= 0) return { skip: true };

    emitAnimation(room, 'attack', {
        combatType: atk.isShooter ? 'shooter' : 'solo',
        attacker: atk.attackerPlayer,
        row: atk.attackerRow,
        col: atk.attackerCol,
        targetPlayer: atk.targetPlayer,
        targetRow: atk.targetRow,
        targetCol: atk.targetCol,
        damage: damage,
        isFlying: atk.isFlying,
        isShooter: atk.isShooter
    });
    await sleep(800);

    targetCard.currentHp -= damage;
    log(`⚔️ ${attackerCard.name} [${slotName}] → ${targetCard.name} (-${damage})${atk.hasInitiative ? ' [Init]' : ''}`, 'damage');

    // Power sur la cible si elle survit
    if (targetCard.currentHp > 0 && targetCard.abilities?.includes('power')) {
        targetCard.atk += 1;
        log(`  💪 ${targetCard.name} +1 ATK`, 'buff');
    }

    // Piétinement
    if (atk.hasTrample && targetCard.currentHp < 0) {
        await applyTrampleDamage(room, atk, helpers);
    }

    // Clivant
    if (attackerCard.abilities?.includes('cleave')) {
        await applyCleaveeDamage(room, atk, attackerCard, helpers);
    }

    // RIPOSTE: la cible riposte TOUJOURS sauf si:
    // - L'attaquant est un tireur (pas de riposte contre les tirs)
    // - L'attaquant a initiative ET la cible est morte
    const targetDied = targetCard.currentHp <= 0;
    const initiativeBlocksRiposte = atk.hasInitiative && targetDied;
    const targetCanRiposte = !atk.isShooter && !initiativeBlocksRiposte;

    if (targetCanRiposte) {
        const riposteDmg = targetCard.atk;
        attackerCard.currentHp -= riposteDmg;
        log(`  ↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${riposteDmg})`, 'damage');
        emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: riposteDmg });

        if (attackerCard.currentHp > 0 && attackerCard.abilities?.includes('power')) {
            attackerCard.atk += 1;
            log(`  💪 ${attackerCard.name} +1 ATK`, 'buff');
        }
    }

    return {};
}

/**
 * Applique les dégâts de piétinement
 */
async function applyTrampleDamage(room, atk, helpers) {
    const { log, emitAnimation, io } = helpers;
    const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
    const excessDamage = Math.abs(targetCard.currentHp);

    if (excessDamage > 0) {
        // Vérifier s'il y a une créature derrière (col 0 si cible était en col 1)
        if (atk.targetCol === 1) {
            const creatureBehind = room.gameState.players[atk.targetPlayer].field[atk.targetRow][0];
            if (creatureBehind && !creatureBehind.abilities?.includes('intangible')) {
                creatureBehind.currentHp -= excessDamage;
                log(`  🦏 Piétinement → ${creatureBehind.name} (-${excessDamage})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: 0, amount: excessDamage });
                return;
            }
        }

        // Pas de créature derrière (ou cible était en col 0), dégâts au héros
        room.gameState.players[atk.targetPlayer].hp -= excessDamage;
        log(`  🦏 Piétinement → Héros (-${excessDamage})`, 'damage');
        io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: excessDamage });
    }
}

/**
 * Applique les dégâts de clivant aux créatures adjacentes
 */
async function applyCleaveeDamage(room, atk, attackerCard, helpers) {
    const { log, emitAnimation } = helpers;
    const cleaveX = attackerCard.cleaveX || attackerCard.atk;
    const targetOwner = room.gameState.players[atk.targetPlayer];
    const adjacentRows = [atk.targetRow - 1, atk.targetRow + 1].filter(r => r >= 0 && r < 4);

    for (const adjRow of adjacentRows) {
        const adjTarget = targetOwner.field[adjRow]?.[atk.targetCol];
        if (adjTarget && !adjTarget.abilities?.includes('intangible')) {
            adjTarget.currentHp -= cleaveX;
            log(`  ⛏️ Clivant → ${adjTarget.name} (-${cleaveX})`, 'damage');
            emitAnimation(room, 'damage', { player: atk.targetPlayer, row: adjRow, col: atk.targetCol, amount: cleaveX });
        }
    }
}

// ==================== INTERCEPTIONS VOLANTES ====================

/**
 * Détecte les interceptions entre créatures volantes
 */
function detectFlyingInterceptions(gameState) {
    const p1State = gameState.players[1];
    const p2State = gameState.players[2];
    const interceptions = [];

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
            const p1Card = p1State.field[row][col];
            const p2Card = p2State.field[row][col];

            // Vérifier si les deux sont des volants qui peuvent attaquer
            if (p1Card && p2Card &&
                p1Card.canAttack && p2Card.canAttack &&
                p1Card.abilities?.includes('fly') && p2Card.abilities?.includes('fly') &&
                p1Card.currentHp > 0 && p2Card.currentHp > 0) {

                interceptions.push({
                    row, col,
                    p1: { card: p1Card, player: 1, row, col },
                    p2: { card: p2Card, player: 2, row, col }
                });
            }
        }
    }

    return interceptions;
}

/**
 * Traite toutes les interceptions volantes
 */
async function processFlyingInterceptions(room, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, io, processOnDeathAbility } = helpers;
    const gameState = room.gameState;
    const interceptions = detectFlyingInterceptions(gameState);

    if (interceptions.length === 0) return;

    log(`🦅 ${interceptions.length} interception(s) de volants`, 'action');

    // Bloquer TOUS les slots impliqués au début
    const allSlotsToBlock = [];
    for (const inter of interceptions) {
        allSlotsToBlock.push({ player: 1, row: inter.row, col: inter.col });
        allSlotsToBlock.push({ player: 2, row: inter.row, col: inter.col });
    }
    io.to(room.code).emit('blockSlots', allSlotsToBlock);

    // Traiter chaque interception séquentiellement
    for (let i = 0; i < interceptions.length; i++) {
        const inter = interceptions[i];
        const { p1, p2 } = inter;
        const card1 = gameState.players[1].field[p1.row][p1.col];
        const card2 = gameState.players[2].field[p2.row][p2.col];

        if (!card1 || !card2 || card1.currentHp <= 0 || card2.currentHp <= 0) continue;

        const slotName = SLOT_NAMES[inter.row][inter.col];
        const dmg1 = card1.atk;
        const dmg2 = card2.atk;

        // Marquer comme ayant intercepté
        card1.hasIntercepted = true;
        card2.hasIntercepted = true;

        // Vérifier l'initiative
        const p1HasInit = card1.abilities?.includes('initiative');
        const p2HasInit = card2.abilities?.includes('initiative');

        if (p1HasInit !== p2HasInit) {
            // Un seul a initiative - combat séquentiel
            const first = p1HasInit ? { card: card1, dmg: dmg1, player: 1, other: card2 } : { card: card2, dmg: dmg2, player: 2, other: card1 };
            const second = p1HasInit ? { card: card2, dmg: dmg2, player: 2, other: card1 } : { card: card1, dmg: dmg1, player: 1, other: card2 };

            // Premier attaque
            emitAnimation(room, 'attack', {
                combatType: 'flying_intercept',
                attacker: first.player,
                row: inter.row,
                col: inter.col,
                targetPlayer: second.player,
                targetRow: inter.row,
                targetCol: inter.col,
                damage: first.dmg,
                pairIndex: i
            });
            await sleep(800);

            second.card.currentHp -= first.dmg;
            log(`⚔️ [${slotName}] ${first.card.name} → ${second.card.name} (-${first.dmg}) [Init]`, 'damage');

            // Riposte si le second survit
            if (second.card.currentHp > 0) {
                if (second.card.abilities?.includes('power')) {
                    second.card.atk += 1;
                    log(`  💪 ${second.card.name} +1 ATK`, 'buff');
                }

                emitAnimation(room, 'attack', {
                    combatType: 'flying_intercept',
                    attacker: second.player,
                    row: inter.row,
                    col: inter.col,
                    targetPlayer: first.player,
                    targetRow: inter.row,
                    targetCol: inter.col,
                    damage: second.dmg,
                    pairIndex: i
                });
                await sleep(800);

                first.card.currentHp -= second.dmg;
                log(`  ↩️ ${second.card.name} riposte → ${first.card.name} (-${second.dmg})`, 'damage');

                if (first.card.currentHp > 0 && first.card.abilities?.includes('power')) {
                    first.card.atk += 1;
                    log(`  💪 ${first.card.name} +1 ATK`, 'buff');
                }
            }
        } else {
            // Combat simultané (les deux ont initiative ou aucun)
            emitAnimation(room, 'attack', {
                combatType: 'mutual_flying',
                attacker1: { owner: 1, row: inter.row, col: inter.col },
                attacker2: { owner: 2, row: inter.row, col: inter.col },
                damage1: dmg1,
                damage2: dmg2,
                pairIndex: i
            });
            await sleep(1000);

            card1.currentHp -= dmg2;
            card2.currentHp -= dmg1;
            log(`🦅 [${slotName}] ${card1.name} ↔ ${card2.name} (-${dmg2} / -${dmg1})`, 'damage');

            if (card1.currentHp > 0 && card1.abilities?.includes('power')) {
                card1.atk += 1;
                log(`  💪 ${card1.name} +1 ATK`, 'buff');
            }
            if (card2.currentHp > 0 && card2.abilities?.includes('power')) {
                card2.atk += 1;
                log(`  💪 ${card2.name} +1 ATK`, 'buff');
            }
        }

        // Piétinement si applicable
        if (card1.abilities?.includes('trample') && card2.currentHp < 0) {
            const excess = Math.abs(card2.currentHp);
            const behindCreature = gameState.players[2].field[inter.row][0];
            if (inter.col === 1 && behindCreature && !behindCreature.abilities?.includes('intangible')) {
                behindCreature.currentHp -= excess;
                log(`  🦏 Piétinement → ${behindCreature.name} (-${excess})`, 'damage');
            } else {
                gameState.players[2].hp -= excess;
                log(`  🦏 Piétinement → Héros (-${excess})`, 'damage');
                io.to(room.code).emit('directDamage', { defender: 2, damage: excess });
            }
        }
        if (card2.abilities?.includes('trample') && card1.currentHp < 0) {
            const excess = Math.abs(card1.currentHp);
            const behindCreature = gameState.players[1].field[inter.row][0];
            if (inter.col === 1 && behindCreature && !behindCreature.abilities?.includes('intangible')) {
                behindCreature.currentHp -= excess;
                log(`  🦏 Piétinement → ${behindCreature.name} (-${excess})`, 'damage');
            } else {
                gameState.players[1].hp -= excess;
                log(`  🦏 Piétinement → Héros (-${excess})`, 'damage');
                io.to(room.code).emit('directDamage', { defender: 1, damage: excess });
            }
        }

        // Nettoyer les morts de cette interception
        inter.deadCards = [];
        if (card1.currentHp <= 0) {
            addToGraveyard(gameState.players[1], card1);
            gameState.players[1].field[p1.row][p1.col] = null;
            log(`☠️ ${card1.name} détruit!`, 'damage');
            emitAnimation(room, 'death', { player: 1, row: p1.row, col: p1.col });
            inter.deadCards.push({ card: card1, player: 1, row: p1.row, col: p1.col });
        }
        if (card2.currentHp <= 0) {
            addToGraveyard(gameState.players[2], card2);
            gameState.players[2].field[p2.row][p2.col] = null;
            log(`☠️ ${card2.name} détruit!`, 'damage');
            emitAnimation(room, 'death', { player: 2, row: p2.row, col: p2.col });
            inter.deadCards.push({ card: card2, player: 2, row: p2.row, col: p2.col });
        }

        await sleep(800);
    }

    // Débloquer tous les slots
    io.to(room.code).emit('unblockSlots', allSlotsToBlock);
    emitStateToBoth(room);
    await sleep(300);

    // Traiter les capacités onDeath
    for (const inter of interceptions) {
        if (inter.deadCards) {
            for (const d of inter.deadCards) {
                await processOnDeathAbility(room, d.card, d.player, log, sleep);
            }
        }
    }
}

// ==================== COMBAT PRINCIPAL ====================

/**
 * Traite tout le combat d'un tour
 */
async function processAllCombat(room, helpers) {
    const { log, sleep, emitStateToBoth, io } = helpers;
    const gameState = room.gameState;

    // 1. Collecter toutes les attaques
    const allAttacks = collectAllAttacks(gameState);
    if (allAttacks.length === 0) return false;

    // 2. Trier par priorité (initiative d'abord)
    sortAttacksByPriority(allAttacks);
    log(`⚔️ ${allAttacks.length} attaques (${allAttacks.filter(a => a.hasInitiative).length} avec initiative)`, 'action');

    // 3. Bloquer les slots
    const blockedSlots = blockCombatSlots(io, room, allAttacks);

    // 4. Exécuter les attaques
    for (const atk of allAttacks) {
        const result = await executeAttack(room, atk, helpers);

        if (result.heroKilled) {
            unblockCombatSlots(io, room, blockedSlots);
            emitStateToBoth(room);
            return true;
        }

        if (!result.skip) {
            emitStateToBoth(room);
            await sleep(300);
        }
    }

    // 5. Nettoyer les créatures mortes
    await cleanupDeadCreatures(room, helpers);

    // 6. Débloquer les slots
    unblockCombatSlots(io, room, blockedSlots);

    return false;
}

/**
 * Nettoie les créatures mortes après le combat
 */
async function cleanupDeadCreatures(room, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, processOnDeathAbility } = helpers;
    const deaths = [];

    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.currentHp <= 0) {
                    deaths.push({ player: p, row: r, col: c, card });
                }
            }
        }
    }

    if (deaths.length > 0) {
        for (const d of deaths) {
            addToGraveyard(room.gameState.players[d.player], d.card);
            room.gameState.players[d.player].field[d.row][d.col] = null;
            log(`☠️ ${d.card.name} détruit!`, 'damage');
            emitAnimation(room, 'death', { player: d.player, row: d.row, col: d.col });
        }
        await sleep(600);
        emitStateToBoth(room);

        // Capacités onDeath
        for (const d of deaths) {
            await processOnDeathAbility(room, d.card, d.player, log, sleep);
        }
    }
}

// ==================== HELPERS ====================

function blockCombatSlots(io, room, attacks) {
    const slotsToBlock = [];
    for (const atk of attacks) {
        slotsToBlock.push({ player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol });
        if (!atk.targetIsHero) {
            slotsToBlock.push({ player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol });
        }
    }
    if (slotsToBlock.length > 0) {
        io.to(room.code).emit('blockSlots', slotsToBlock);
    }
    return slotsToBlock;
}

function unblockCombatSlots(io, room, slotsToBlock) {
    if (slotsToBlock.length > 0) {
        io.to(room.code).emit('unblockSlots', slotsToBlock);
    }
}

// ==================== EXPORTS ====================

module.exports = {
    SLOT_NAMES,
    findTarget,
    collectAllAttacks,
    sortAttacksByPriority,
    executeAttack,
    applyTrampleDamage,
    applyCleaveeDamage,
    detectFlyingInterceptions,
    processFlyingInterceptions,
    processAllCombat,
    cleanupDeadCreatures,
    blockCombatSlots,
    unblockCombatSlots
};
