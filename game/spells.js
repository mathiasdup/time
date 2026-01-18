// ==================== SYSTÈME DE SORTS ====================
// Gestion de l'application des sorts

const { addToGraveyard } = require('./cards');
const { processOnDeathAbility } = require('./abilities');

// Noms des slots pour le log
const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

// ==================== APPLICATION DES SORTS ====================

/**
 * Applique un sort
 * @param {Object} room - La room de jeu
 * @param {Object} action - L'action de sort {playerNum, spell, targetPlayer, row, col, heroName}
 * @param {Object} helpers - Fonctions utilitaires
 */
async function applySpell(room, action, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, emitAnimationBatch, io, getCrossTargets } = helpers;
    const playerNum = action.playerNum;
    const player = room.gameState.players[playerNum];
    const opponent = room.gameState.players[playerNum === 1 ? 2 : 1];
    const spell = action.spell;

    // Animation du sort
    emitAnimation(room, 'spell', {
        caster: playerNum,
        targetPlayer: action.targetPlayer,
        row: action.row,
        col: action.col,
        spell: spell
    });
    await sleep(600);

    // Router vers le bon handler selon le pattern du sort
    switch (spell.pattern) {
        case 'global':
            await applyGlobalSpell(room, action, player, spell, helpers);
            break;
        case 'all':
            await applyAllCreaturesSpell(room, action, spell, helpers);
            break;
        case 'hero':
            await applyHeroSpell(room, action, spell, helpers);
            break;
        case 'cross':
            await applyCrossSpell(room, action, player, opponent, spell, helpers);
            break;
        default:
            await applySingleTargetSpell(room, action, player, opponent, spell, helpers);
            break;
    }
}

// ==================== SORTS GLOBAUX ====================

async function applyGlobalSpell(room, action, player, spell, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth } = helpers;
    const playerNum = action.playerNum;

    if (spell.effect === 'draw') {
        await drawCards(room, player, playerNum, spell.amount, action.heroName, spell.name, helpers);
    } else if (spell.effect === 'mana') {
        await gainMana(room, player, playerNum, action.heroName, spell.name, helpers);
    }
}

// ==================== SORT SUR TOUTES LES CRÉATURES ====================

async function applyAllCreaturesSpell(room, action, spell, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, emitAnimationBatch, io } = helpers;

    log(`🌋 ${action.heroName}: ${spell.name} - ${spell.damage} dégâts à toutes les créatures!`, 'damage');

    // Phase 1: Collecter toutes les cibles et envoyer les animations
    const spellAnimations = [];
    for (let p = 1; p <= 2; p++) {
        const targetPlayer = room.gameState.players[p];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const target = targetPlayer.field[r][c];
                if (target) {
                    spellAnimations.push({ type: 'spellDamage', player: p, row: r, col: c, amount: spell.damage });
                }
            }
        }
    }
    if (spellAnimations.length > 0) {
        emitAnimationBatch(room, spellAnimations);
    }

    await sleep(800);

    // Phase 2: Appliquer les dégâts et collecter les morts
    const deaths = [];
    for (let p = 1; p <= 2; p++) {
        const targetPlayer = room.gameState.players[p];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const target = targetPlayer.field[r][c];
                if (target) {
                    target.currentHp -= spell.damage;

                    if (target.currentHp > 0 && target.abilities?.includes('power')) {
                        target.atk += 1;
                    }

                    if (target.currentHp <= 0) {
                        deaths.push({ player: targetPlayer, p, r, c, target });
                    }
                }
            }
        }
    }

    // Phase 3: Gérer les morts
    await handleDeaths(room, deaths, helpers);
    emitStateToBoth(room);
}

// ==================== SORT SUR UN HÉROS ====================

async function applyHeroSpell(room, action, spell, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, io } = helpers;
    const targetHero = room.gameState.players[action.targetPlayer];
    const targetName = targetHero.heroName;

    if (spell.damage) {
        targetHero.hp -= spell.damage;
        log(`👊 ${action.heroName}: ${spell.name} → ${targetName} (-${spell.damage})`, 'damage');
        emitAnimation(room, 'heroHit', { defender: action.targetPlayer, damage: spell.damage });
        io.to(room.code).emit('directDamage', { defender: action.targetPlayer, damage: spell.damage });
    } else if (spell.effect === 'draw') {
        await drawCards(room, targetHero, action.targetPlayer, spell.amount, action.heroName, spell.name, helpers, targetName);
    } else if (spell.effect === 'mana') {
        await gainMana(room, targetHero, action.targetPlayer, action.heroName, spell.name, helpers, targetName);
    } else if (spell.heal) {
        const oldHp = targetHero.hp;
        targetHero.hp = Math.min(20, targetHero.hp + spell.heal);
        const healed = targetHero.hp - oldHp;
        if (healed > 0) {
            log(`💚 ${action.heroName}: ${spell.name} → ${targetName} (+${healed} PV)`, 'heal');
        }
    }
}

// ==================== SORT EN CROIX ====================

async function applyCrossSpell(room, action, player, opponent, spell, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, emitAnimationBatch, io, getCrossTargets } = helpers;
    const playerNum = action.playerNum;

    const adjacentTargets = getCrossTargets(action.targetPlayer, action.row, action.col);
    const allTargets = [
        { row: action.row, col: action.col, player: action.targetPlayer },
        ...adjacentTargets
    ];

    log(`✝️ ${action.heroName}: ${spell.name} en croix sur ${SLOT_NAMES[action.row][action.col]}!`, 'damage');

    io.to(room.code).emit('spellHighlight', { targets: allTargets, type: 'damage' });

    // Phase 1: Envoyer toutes les animations
    const spellAnimations = [];
    for (const t of allTargets) {
        const targetField = t.player === playerNum ? player.field : opponent.field;
        const target = targetField[t.row]?.[t.col];
        if (target) {
            spellAnimations.push({ type: 'spellDamage', player: t.player, row: t.row, col: t.col, amount: spell.damage });
        }
    }
    if (spellAnimations.length > 0) {
        emitAnimationBatch(room, spellAnimations);
    }

    await sleep(800);

    // Phase 2: Appliquer les dégâts
    const deaths = [];
    for (const t of allTargets) {
        const targetField = t.player === playerNum ? player.field : opponent.field;
        const target = targetField[t.row]?.[t.col];

        if (target) {
            target.currentHp -= spell.damage;
            log(`  🔥 ${target.name} (-${spell.damage})`, 'damage');

            if (target.currentHp > 0 && target.abilities?.includes('power')) {
                target.atk += 1;
            }

            if (target.currentHp <= 0) {
                const targetOwner = t.player === playerNum ? player : opponent;
                deaths.push({ owner: targetOwner, field: targetField, t, target, p: t.player, r: t.row, c: t.col });
            }
        }
    }

    await handleDeaths(room, deaths, helpers);
    emitStateToBoth(room);
}

// ==================== SORT CIBLÉ SIMPLE ====================

async function applySingleTargetSpell(room, action, player, opponent, spell, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, io } = helpers;
    const playerNum = action.playerNum;

    // Ciblage d'un héros
    if (action.row === -1) {
        const targetHero = room.gameState.players[action.targetPlayer];
        const targetName = targetHero.heroName;

        io.to(room.code).emit('heroHighlight', { player: action.targetPlayer, type: spell.offensive ? 'damage' : 'heal' });

        if (spell.heal) {
            const oldHp = targetHero.hp;
            targetHero.hp = Math.min(20, targetHero.hp + spell.heal);
            const healed = targetHero.hp - oldHp;
            if (healed > 0) {
                log(`💚 ${action.heroName}: ${spell.name} → ${targetName} (+${healed} PV)`, 'heal');
            }
        }
        return;
    }

    // Ciblage d'une créature
    const targetField = action.targetPlayer === playerNum ? player.field : opponent.field;
    const target = targetField[action.row]?.[action.col];

    io.to(room.code).emit('spellHighlight', {
        targets: [{ row: action.row, col: action.col, player: action.targetPlayer }],
        type: spell.offensive ? 'damage' : 'heal'
    });

    if (target) {
        // Dégâts
        if (spell.offensive && spell.damage) {
            emitAnimation(room, 'spellDamage', { player: action.targetPlayer, row: action.row, col: action.col, amount: spell.damage });
            await sleep(800);

            target.currentHp -= spell.damage;
            log(`🔥 ${action.heroName}: ${spell.name} → ${target.name} (-${spell.damage})`, 'damage');

            if (target.currentHp > 0 && target.abilities?.includes('power')) {
                target.atk += 1;
            }

            if (target.currentHp <= 0) {
                const targetOwner = action.targetPlayer === playerNum ? player : opponent;
                addToGraveyard(targetOwner, target);
                targetField[action.row][action.col] = null;
                log(`☠️ ${target.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col });
                await sleep(600);
                await processOnDeathAbility(room, target, action.targetPlayer, log, sleep, io);
            }

            emitStateToBoth(room);
        }

        // Soin
        if (!spell.offensive && spell.heal) {
            const oldHp = target.currentHp;
            target.currentHp = Math.min(target.hp, target.currentHp + spell.heal);
            const healed = target.currentHp - oldHp;
            if (healed > 0) {
                if (!target.appliedEffects) target.appliedEffects = [];
                target.appliedEffects.push({
                    name: spell.name,
                    icon: spell.icon,
                    description: `+${healed} ❤️ restauré`
                });
                log(`💚 ${action.heroName}: ${spell.name} → ${target.name} (+${healed} PV)`, 'heal');
                emitAnimation(room, 'heal', { player: action.targetPlayer, row: action.row, col: action.col, amount: healed });
            }
        }

        // Buff
        if (!spell.offensive && spell.buff) {
            target.atk += spell.buff.atk;
            target.hp += spell.buff.hp;
            target.currentHp += spell.buff.hp;
            if (!target.appliedEffects) target.appliedEffects = [];
            target.appliedEffects.push({
                name: spell.name,
                icon: spell.icon,
                description: `+${spell.buff.atk} ⚔️ / +${spell.buff.hp} ❤️`
            });
            log(`💪 ${action.heroName}: ${spell.name} → ${target.name} (+${spell.buff.atk} ATK, +${spell.buff.hp} PV)`, 'buff');
            emitAnimation(room, 'buff', { player: action.targetPlayer, row: action.row, col: action.col, buff: spell.buff });
        }
    }
}

// ==================== UTILITAIRES ====================

/**
 * Pioche des cartes pour un joueur
 */
async function drawCards(room, player, playerNum, amount, casterName, spellName, helpers, targetName = null) {
    const { log, sleep, emitAnimation, emitStateToBoth } = helpers;

    const drawnCards = [];
    const burnedCards = [];

    for (let i = 0; i < amount; i++) {
        if (player.deck.length > 0) {
            const card = player.deck.pop();
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
            }
            if (player.hand.length < 9) {
                player.hand.push(card);
                drawnCards.push({ player: playerNum, card: card, handIndex: player.hand.length - 1 });
            } else {
                addToGraveyard(player, card);
                burnedCards.push({ player: playerNum, card: card });
            }
        }
    }

    if (drawnCards.length > 0) {
        const targetStr = targetName ? ` → ${targetName}` : '';
        log(`📜 ${casterName}: ${spellName}${targetStr} - pioche ${drawnCards.length} carte(s)`, 'action');
        emitAnimation(room, 'draw', { cards: drawnCards });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(400 * drawnCards.length);
    }

    for (const burned of burnedCards) {
        log(`📦 Main pleine, ${burned.card.name} va au cimetière`, 'damage');
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
        await sleep(1200);
    }
}

/**
 * Fait gagner un cristal de mana ou pioche si max
 */
async function gainMana(room, player, playerNum, casterName, spellName, helpers, targetName = null) {
    const { log, sleep, emitAnimation, emitStateToBoth } = helpers;
    const targetStr = targetName ? ` → ${targetName}` : '';

    if (player.maxEnergy < 10) {
        player.maxEnergy++;
        player.energy++;
        log(`💎 ${casterName}: ${spellName}${targetStr} - gagne un cristal de mana (${player.maxEnergy}/10)`, 'action');
    } else if (player.deck.length > 0) {
        const card = player.deck.pop();
        if (card.type === 'creature') {
            card.currentHp = card.hp;
            card.canAttack = false;
        }
        if (player.hand.length < 9) {
            player.hand.push(card);
            log(`💎 ${casterName}: ${spellName}${targetStr} - mana max, pioche une carte`, 'action');
            emitAnimation(room, 'draw', { cards: [{ player: playerNum, card: card, handIndex: player.hand.length - 1 }] });
            await sleep(20);
            emitStateToBoth(room);
            await sleep(400);
        } else {
            addToGraveyard(player, card);
            log(`📦 Main pleine, ${card.name} va au cimetière`, 'damage');
            emitAnimation(room, 'burn', { player: playerNum, card: card });
            await sleep(1200);
        }
    }
}

/**
 * Gère les créatures mortes après un sort
 */
async function handleDeaths(room, deaths, helpers) {
    const { log, sleep, emitAnimation, emitStateToBoth, io } = helpers;

    if (deaths.length === 0) return;

    // Bloquer les slots
    const slotsToBlock = deaths.map(d => ({ player: d.p, row: d.r, col: d.c }));
    io.to(room.code).emit('blockSlots', slotsToBlock);

    for (const d of deaths) {
        const owner = d.player || d.owner;
        addToGraveyard(owner, d.target);

        if (d.field) {
            d.field[d.r || d.t.row][d.c || d.t.col] = null;
        } else {
            owner.field[d.r][d.c] = null;
        }

        log(`  ☠️ ${d.target.name} détruit!`, 'damage');
        emitAnimation(room, 'death', { player: d.p, row: d.r || d.t?.row, col: d.c || d.t?.col });
    }

    emitStateToBoth(room);
    await sleep(600);
    io.to(room.code).emit('unblockSlots', slotsToBlock);

    // Capacités onDeath
    for (const d of deaths) {
        await processOnDeathAbility(room, d.target, d.p, log, sleep, io);
    }
}

// ==================== EXPORTS ====================

module.exports = {
    SLOT_NAMES,
    applySpell,
    drawCards,
    gainMana,
    handleDeaths
};
