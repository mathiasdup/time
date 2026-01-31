const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Import game modules
const { CardDB, HERO_NAMES, resetCardForGraveyard, addToGraveyard, createDeck, createPlayerState, createGameState } = require('./game/cards');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// ==================== GAME STATE ====================
const rooms = new Map();
const playerRooms = new Map();
const TURN_TIME = 90;

// Timing des animations (en ms) pour la résolution par paires
const ANIM_TIMING = {
    move: 700,
    summon: 550,
    spell: 1000,
    trapPlace: 900,
    combat: 800,
    margin: 200,       // marge de sécurité entre paires
    phaseIntro: 600,   // temps d'affichage du nom de phase
};

// Générer un code de room unique
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
}

function resetPlayerForNewTurn(player) {
    player.ready = false;
    player.inDeployPhase = false;
    player.pendingActions = [];
    player.spellsCastThisTurn = 0;
    player.heroAttackedThisTurn = false;

    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            if (player.field[r][c]) {
                player.field[r][c].movedThisTurn = false;
            }
        }
    }

    player.confirmedField = deepClone(player.field);
    player.confirmedTraps = deepClone(player.traps);
}

function getPublicGameState(room, forPlayer) {
    const state = room.gameState;
    const opponent = forPlayer === 1 ? 2 : 1;
    const me = state.players[forPlayer];
    const opp = state.players[opponent];
    
    const isPlanning = state.phase === 'planning';
    const isRevealing = state.revealing;

    // Pour l'adversaire : pendant le planning → confirmedField, pendant la révélation → revealField, sinon → field réel
    let oppField = opp.field;
    let oppTraps = opp.traps;
    if (isPlanning && opp.confirmedField) {
        oppField = opp.confirmedField;
        oppTraps = opp.confirmedTraps;
    } else if (isRevealing && opp.revealField) {
        oppField = opp.revealField;
        oppTraps = opp.revealTraps;
    }

    return {
        turn: state.turn,
        phase: state.phase,
        timeLeft: state.timeLeft,
        myPlayer: forPlayer,
        me: {
            hp: me.hp,
            energy: me.energy,
            maxEnergy: me.maxEnergy,
            hand: me.hand,
            deckCount: me.deck.length,
            field: me.field,
            traps: me.traps,
            trapCards: me.trapCards, // Cartes pièges pour l'affichage hover
            graveyard: me.graveyard,
            graveyardCount: me.graveyard.length,
            ready: me.ready,
            inDeployPhase: me.inDeployPhase,
            heroName: me.heroName,
            hero: me.hero,
            spellsCastThisTurn: me.spellsCastThisTurn || 0
        },
        opponent: {
            hp: opp.hp,
            energy: opp.maxEnergy,
            maxEnergy: opp.maxEnergy,
            handCount: opp.hand.length,
            deckCount: opp.deck.length,
            field: oppField,
            traps: oppTraps,
            graveyard: opp.graveyard,
            graveyardCount: opp.graveyard.length,
            ready: opp.ready,
            heroName: opp.heroName,
            hero: opp.hero
        }
    };
}

function emitStateToPlayer(room, playerNum) {
    const socketId = room.players[playerNum];
    if (socketId) {
        io.to(socketId).emit('gameStateUpdate', getPublicGameState(room, playerNum));
    }
}

function emitStateToBoth(room) {
    emitStateToPlayer(room, 1);
    emitStateToPlayer(room, 2);
}

function emitAnimation(room, type, data) {
    io.to(room.code).emit('animation', { type, ...data });
}

/**
 * Applique des dégâts à une créature avec gestion de la Protection.
 * Retourne les dégâts réellement infligés (0 si bloqué par protection).
 */
function applyCreatureDamage(card, damage, room, log, ownerPlayer, row, col, sourceCreature) {
    if (card.hasProtection) {
        card.hasProtection = false;
        log(`🛡️ ${card.name} : Protection absorbe ${damage} dégâts!`, 'buff');
        emitAnimation(room, 'shield', { player: ownerPlayer, row: row, col: col });
        return 0;
    }
    card.currentHp -= damage;
    card.damagedThisTurn = true;
    // Track which creature killed this one (for onDeath.damageKiller)
    if (sourceCreature && card.currentHp <= 0) {
        card.killedBy = sourceCreature;
    }
    return damage;
}

/**
 * Gère la mort d'une créature : transformation (onDeath.transformInto) ou cimetière.
 * Retourne { transformed: boolean, newCard: Card|null }
 */
function handleCreatureDeath(room, card, playerNum, row, col, log) {
    const player = room.gameState.players[playerNum];

    if (card.onDeath && card.onDeath.transformInto) {
        const template = CardDB.creatures.find(c => c.id === card.onDeath.transformInto);
        if (template) {
            const newCard = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: `${Date.now()}-transform-${Math.random()}`,
                currentHp: template.hp,
                baseAtk: template.atk,
                baseHp: template.hp,
                canAttack: false,
                turnsOnField: 0,
                movedThisTurn: false,
            };
            if (newCard.abilities.includes('protection')) newCard.hasProtection = true;
            player.field[row][col] = newCard;
            log(`🔄 ${card.name} se transforme en ${newCard.name}!`, 'special');
            return { transformed: true, newCard };
        }
    }

    addToGraveyard(player, card);
    player.field[row][col] = null;
    return { transformed: false, newCard: null };
}

/**
 * Pioche count cartes pour un joueur avec gestion main pleine + animations.
 * @param {Object} room - La room
 * @param {number} playerNum - Numéro du joueur (1 ou 2)
 * @param {number} count - Nombre de cartes à piocher
 * @param {Function} log - Fonction de log
 * @param {Function} sleep - Fonction sleep async
 * @param {string} source - Source de la pioche (pour le log)
 * @returns {Promise<{drawn: number, burned: number}>} Nombre de cartes piochées/brûlées
 */
async function drawCards(room, playerNum, count, log, sleep, source) {
    const player = room.gameState.players[playerNum];
    const drawnCards = [];
    const burnedCards = [];

    for (let i = 0; i < count; i++) {
        if (player.deck.length === 0) break;
        const card = player.deck.shift();
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

    if (drawnCards.length > 0) {
        log(`  🎴 ${source} - pioche ${drawnCards.length} carte(s)`, 'action');
        emitAnimation(room, 'draw', { cards: drawnCards });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(1400);
    }

    for (const burned of burnedCards) {
        log(`  📦 Main pleine, ${burned.card.name} va au cimetière`, 'damage');
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(1200);
    }

    return { drawn: drawnCards.length, burned: burnedCards.length };
}

function emitAnimationBatch(room, animations) {
    io.to(room.code).emit('animationBatch', animations);
}

// Traite les capacités onDeath d'une carte qui meurt
async function processOnDeathAbility(room, card, ownerPlayer, log, sleep) {
    if (!card.onDeath) return;

    // Capacité: infliger des dégâts au héros adverse
    if (card.onDeath.damageHero) {
        const damage = card.onDeath.damageHero;
        const enemyPlayer = ownerPlayer === 1 ? 2 : 1;
        room.gameState.players[enemyPlayer].hp -= damage;
        log(`💀 ${card.name} - Capacité de mort: ${damage} dégâts au héros adverse!`, 'damage');
        emitAnimation(room, 'onDeathDamage', {
            source: card.name,
            targetPlayer: enemyPlayer,
            damage: damage
        });
        await sleep(800);
        emitStateToBoth(room);
    }

    // Capacité: infliger des dégâts à la créature responsable de la mort
    if (card.onDeath.damageKiller && card.killedBy) {
        const killerInfo = card.killedBy;
        const killerCard = room.gameState.players[killerInfo.player].field[killerInfo.row][killerInfo.col];
        // Vérifier que le tueur est toujours là (même uid) et vivant
        if (killerCard && killerCard.uid === killerInfo.uid && killerCard.currentHp > 0) {
            const dmg = card.onDeath.damageKiller;
            applyCreatureDamage(killerCard, dmg, room, log, killerInfo.player, killerInfo.row, killerInfo.col);
            log(`🔥 ${card.name} inflige ${dmg} blessure à ${killerCard.name}!`, 'damage');
            emitAnimation(room, 'onDeathDamage', {
                source: card.name,
                targetPlayer: killerInfo.player,
                targetRow: killerInfo.row,
                targetCol: killerInfo.col,
                damage: dmg
            });
            await sleep(800);
            emitStateToBoth(room);

            // Si le tueur meurt aussi de cette blessure
            if (killerCard.currentHp <= 0) {
                const result = handleCreatureDeath(room, killerCard, killerInfo.player, killerInfo.row, killerInfo.col, log);
                if (result.transformed) {
                    emitAnimation(room, 'deathTransform', { player: killerInfo.player, row: killerInfo.row, col: killerInfo.col, fromCard: killerCard, toCard: result.newCard });
                } else {
                    log(`☠️ ${killerCard.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: killerInfo.player, row: killerInfo.row, col: killerInfo.col, card: killerCard });
                }
                emitStateToBoth(room);
                await sleep(1100);
                if (!result.transformed) {
                    await processOnDeathAbility(room, killerCard, killerInfo.player, log, sleep);
                }
            }
        }
    }
}

function startTurnTimer(room) {
    if (room.timer) clearInterval(room.timer);
    
    room.timer = setInterval(() => {
        room.gameState.timeLeft--;
        io.to(room.code).emit('timerUpdate', room.gameState.timeLeft);
        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            room.gameState.players[1].ready = true;
            room.gameState.players[2].ready = true;
            startResolution(room);
        }
    }, 1000);
}

function checkBothReady(room) {
    if (room.gameState.players[1].ready && room.gameState.players[2].ready) {
        startResolution(room);
    }
}

// Get adjacent cells for cross pattern (same side only)
function getCrossTargets(targetPlayer, row, col) {
    const targets = [];
    // Up
    if (row > 0) targets.push({ row: row - 1, col, player: targetPlayer });
    // Down
    if (row < 3) targets.push({ row: row + 1, col, player: targetPlayer });
    // Left (col 0)
    if (col > 0) targets.push({ row, col: col - 1, player: targetPlayer });
    // Right (col 1)
    if (col < 1) targets.push({ row, col: col + 1, player: targetPlayer });
    return targets;
}

async function startResolution(room) {
    if (room.timer) clearInterval(room.timer);
    room.gameState.phase = 'resolution';
    
    io.to(room.code).emit('phaseChange', 'resolution');
    
    const log = (msg, type) => io.to(room.code).emit('resolutionLog', { msg, type });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    
    // Fonction pour vérifier la victoire (retourne 1 ou 2 pour un gagnant, 0 pour draw, null si pas fini)
    const checkVictory = () => {
        const p1hp = room.gameState.players[1].hp;
        const p2hp = room.gameState.players[2].hp;
        if (p1hp <= 0 && p2hp <= 0) {
            return 0; // Draw
        }
        if (p1hp <= 0) return 2;
        if (p2hp <= 0) return 1;
        return null;
    };
    
    // Collecter toutes les actions par type
    const allActions = { moves: [], places: [], spellsDefensive: [], spellsOffensive: [], traps: [] };
    
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        const actions = player.pendingActions || [];
        
        for (const action of actions) {
            action.playerNum = p;
            action.heroName = player.heroName;
            
            if (action.type === 'move') allActions.moves.push(action);
            else if (action.type === 'place') allActions.places.push(action);
            else if (action.type === 'trap') allActions.traps.push(action);
            else if (action.type === 'spell') {
                const isDefensive = action.targetPlayer === p || 
                                   action.spell.pattern === 'global' && !action.spell.damage;
                if (isDefensive) {
                    allActions.spellsDefensive.push(action);
                } else {
                    allActions.spellsOffensive.push(action);
                }
            }
        }
    }
    
    // Vérifier s'il y a des créatures sur le terrain
    const hasCreaturesOnField = () => {
        for (let p = 1; p <= 2; p++) {
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    if (room.gameState.players[p].field[r][c]) return true;
                }
            }
        }
        return false;
    };
    
    const hasTraps = () => {
        for (let p = 1; p <= 2; p++) {
            for (let r = 0; r < 4; r++) {
                if (room.gameState.players[p].traps[r]) return true;
            }
        }
        return false;
    };
    
    // Vérifier si quelque chose va se passer
    const hasAnyAction = allActions.moves.length > 0 || 
                        allActions.places.length > 0 || 
                        allActions.spellsDefensive.length > 0 || 
                        allActions.spellsOffensive.length > 0 ||
                        allActions.traps.length > 0 ||
                        hasCreaturesOnField() ||
                        hasTraps();
    
    if (hasAnyAction) {
        log(`⚔️ RÉSOLUTION DU TOUR ${room.gameState.turn}`, 'phase');
        await sleep(800);
    }

    // PRÉPARER LA RÉVÉLATION PROGRESSIVE :
    // Créer un "revealField" par joueur = ce que l'adversaire voit de ce joueur.
    // Initialement c'est le confirmedField (état pré-tour), puis on y ajoute
    // les cartes paire par paire. Le field réel n'est PAS modifié.
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        // Partir du snapshot du tour précédent (avant les actions de ce tour)
        player.revealField = deepClone(player.confirmedField || player.field);
        player.revealTraps = deepClone(player.confirmedTraps || player.traps);
    }

    // Activer le mode révélation (getPublicGameState utilisera revealField pour l'adversaire)
    room.gameState.revealing = true;

    // Envoyer l'état initial de révélation (adversaire = snapshot pré-tour)
    emitStateToBoth(room);
    await sleep(100);

    // Reset damagedThisTurn pour toutes les créatures
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) card.damagedThisTurn = false;
            }
        }
    }

    // PHASE 0 : EFFETS DE DÉBUT DE TOUR (transformations Pile d'Os → Petit Os, etc.)
    {
        let anyTransform = false;
        const transformAnimations = [];

        for (let p = 1; p <= 2; p++) {
            const player = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const card = player.field[r][c];
                    if (card && card.transformsInto) {
                        const template = CardDB.creatures.find(cr => cr.id === card.transformsInto);
                        if (template) {
                            const newCard = {
                                ...template,
                                abilities: [...(template.abilities || [])],
                                uid: `${Date.now()}-retransform-${Math.random()}`,
                                currentHp: template.hp,
                                baseAtk: template.atk,
                                baseHp: template.hp,
                                canAttack: false,
                                turnsOnField: 0,
                                movedThisTurn: false,
                            };
                            if (newCard.abilities.includes('protection')) newCard.hasProtection = true;

                            transformAnimations.push({
                                player: p, row: r, col: c,
                                fromCard: { ...card }, toCard: newCard
                            });
                            player.field[r][c] = newCard;
                            anyTransform = true;
                        }
                    }
                }
            }
        }

        if (anyTransform) {
            io.to(room.code).emit('phaseMessage', { text: 'Effets de début de tour', type: 'revelation' });
            log('🔄 Effets de début de tour', 'phase');
            await sleep(ANIM_TIMING.phaseIntro);

            for (const t of transformAnimations) {
                emitAnimation(room, 'startOfTurnTransform', {
                    player: t.player, row: t.row, col: t.col,
                    fromCard: t.fromCard, toCard: t.toCard
                });
            }
            // Mettre à jour revealField aussi
            for (const t of transformAnimations) {
                const p = room.gameState.players[t.player];
                if (p.revealField) p.revealField[t.row][t.col] = p.field[t.row][t.col];
            }
            emitStateToBoth(room);
            await sleep(1200);
        }
    }

    // 1. PHASE DE DÉPLACEMENTS (par paires)
    if (allActions.moves.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Déplacements', type: 'revelation' });
        log('↔️ Phase de déplacements', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        // Regrouper les déplacements par joueur
        const movesP1 = allActions.moves.filter(a => a.playerNum === 1);
        const movesP2 = allActions.moves.filter(a => a.playerNum === 2);
        const nbPairesMoves = Math.max(movesP1.length, movesP2.length);

        for (let i = 0; i < nbPairesMoves; i++) {
            // Envoyer les animations AVANT le state update
            if (movesP1[i]) {
                const a = movesP1[i];
                log(`  ↔️ ${a.heroName}: ${a.card.name} ${slotNames[a.fromRow][a.fromCol]} → ${slotNames[a.toRow][a.toCol]}`, 'action');
                emitAnimation(room, 'move', {
                    player: a.playerNum,
                    fromRow: a.fromRow, fromCol: a.fromCol,
                    toRow: a.toRow, toCol: a.toCol,
                    card: a.card
                });
            }
            if (movesP2[i]) {
                const a = movesP2[i];
                log(`  ↔️ ${a.heroName}: ${a.card.name} ${slotNames[a.fromRow][a.fromCol]} → ${slotNames[a.toRow][a.toCol]}`, 'action');
                emitAnimation(room, 'move', {
                    player: a.playerNum,
                    fromRow: a.fromRow, fromCol: a.fromCol,
                    toRow: a.toRow, toCol: a.toCol,
                    card: a.card
                });
            }
            // Délai pour laisser le client démarrer l'animation et bloquer les slots
            await sleep(50);
            // Maintenant mettre à jour revealField et envoyer le state
            if (movesP1[i]) {
                const a = movesP1[i];
                const rf1 = room.gameState.players[a.playerNum].revealField;
                rf1[a.toRow][a.toCol] = rf1[a.fromRow][a.fromCol];
                rf1[a.fromRow][a.fromCol] = null;
            }
            if (movesP2[i]) {
                const a = movesP2[i];
                const rf2 = room.gameState.players[a.playerNum].revealField;
                rf2[a.toRow][a.toCol] = rf2[a.fromRow][a.fromCol];
                rf2[a.fromRow][a.fromCol] = null;
            }
            emitStateToBoth(room);
            await sleep(ANIM_TIMING.move + ANIM_TIMING.margin);
        }
    }

    // 2. PHASE DE RÉVÉLATION DES NOUVELLES CRÉATURES (par paires)
    if (allActions.places.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Créatures', type: 'revelation' });
        log('🎴 Phase de révélation - Créatures', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        // Regrouper les placements par joueur
        const placesP1 = allActions.places.filter(a => a.playerNum === 1);
        const placesP2 = allActions.places.filter(a => a.playerNum === 2);
        const nbPairesCreatures = Math.max(placesP1.length, placesP2.length);

        for (let i = 0; i < nbPairesCreatures; i++) {
            // Envoyer les animations AVANT le state update
            if (placesP1[i]) {
                const a = placesP1[i];
                log(`  🎴 ${a.heroName}: ${a.card.name} en ${slotNames[a.row][a.col]}`, 'action');
                emitAnimation(room, 'summon', {
                    player: a.playerNum,
                    row: a.row,
                    col: a.col,
                    card: a.card
                });
            }
            if (placesP2[i]) {
                const a = placesP2[i];
                log(`  🎴 ${a.heroName}: ${a.card.name} en ${slotNames[a.row][a.col]}`, 'action');
                emitAnimation(room, 'summon', {
                    player: a.playerNum,
                    row: a.row,
                    col: a.col,
                    card: a.card
                });
            }
            // Délai pour laisser le client démarrer l'animation et bloquer les slots
            await sleep(50);
            // Maintenant mettre à jour revealField et envoyer le state
            if (placesP1[i]) {
                const a = placesP1[i];
                room.gameState.players[a.playerNum].revealField[a.row][a.col] = room.gameState.players[a.playerNum].field[a.row][a.col];
            }
            if (placesP2[i]) {
                const a = placesP2[i];
                room.gameState.players[a.playerNum].revealField[a.row][a.col] = room.gameState.players[a.playerNum].field[a.row][a.col];
            }
            emitStateToBoth(room);
            await sleep(ANIM_TIMING.summon + ANIM_TIMING.margin);
        }
    }

    // 3. PHASE DE RÉVÉLATION DES PIÈGES (séquentiels)
    if (allActions.traps.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Pièges', type: 'revelation' });
        log('🪤 Phase de révélation - Pièges', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.traps) {
            log(`  🪤 ${action.heroName}: Piège en rangée ${action.row + 1}`, 'action');
            // Ajouter le piège au revealTraps AVANT l'animation pour que le client le voie
            room.gameState.players[action.playerNum].revealTraps[action.row] = room.gameState.players[action.playerNum].traps[action.row];
            emitStateToBoth(room);
            emitAnimation(room, 'trapPlace', { player: action.playerNum, row: action.row });
            await sleep(ANIM_TIMING.trapPlace + ANIM_TIMING.margin);
        }
    }
    
    // Fin de la révélation progressive — revenir au field réel pour toutes les phases suivantes
    room.gameState.revealing = false;
    for (let p = 1; p <= 2; p++) {
        delete room.gameState.players[p].revealField;
        delete room.gameState.players[p].revealTraps;
    }

    // 4. PHASE DES SORTS DÉFENSIFS (séquentiels, un par un)
    if (allActions.spellsDefensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort défensif', type: 'protection' });
        log('💚 Phase des sorts défensifs', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.spellsDefensive) {
            await applySpell(room, action, log, sleep);
        }
    }

    // 5. PHASE DES SORTS OFFENSIFS (séquentiels, un par un)
    if (allActions.spellsOffensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort offensif', type: 'attack' });
        log('🔥 Phase des sorts offensifs', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);
        
        for (const action of allActions.spellsOffensive) {
            await applySpell(room, action, log, sleep);
            
            // Vérifier victoire après chaque sort offensif
            const winner = checkVictory();
            if (winner !== null) {
                await sleep(800);
                if (winner === 0) {
                    log(`🤝 Match nul! Les deux héros sont tombés!`, 'phase');
                    io.to(room.code).emit('gameOver', { winner: 0, draw: true });
                } else {
                    log(`🏆 ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                    io.to(room.code).emit('gameOver', { winner });
                }
                return;
            }
        }
    }
    
    emitStateToBoth(room);
    await sleep(300);
    
    // 6. PHASE DE COMBAT - pièges puis attaques LIGNE PAR LIGNE
    if (hasCreaturesOnField() || hasTraps()) {
        io.to(room.code).emit('phaseMessage', { text: 'Combat', type: 'combat' });
        log('⚔️ Combat', 'phase');
        await sleep(800);

        const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

        // Combat LIGNE PAR LIGNE : pour chaque ligne, pièges d'abord puis slots
        for (let row = 0; row < 4; row++) {
            // D'abord les pièges de cette ligne
            await processTrapsForRow(room, row, log, sleep);

            // Puis le combat des slots de cette ligne
            for (let col = 0; col < 2; col++) {
                const gameEnded = await processCombatSlotV2(room, row, col, log, sleep, checkVictory, slotNames);

                if (gameEnded) {
                    const winner = checkVictory();
                    if (winner !== null) {
                        await sleep(800);
                        if (winner === 0) {
                            log(`🤝 Match nul! Les deux héros sont tombés!`, 'phase');
                            io.to(room.code).emit('gameOver', { winner: 0, draw: true });
                        } else {
                            log(`🏆 ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                            io.to(room.code).emit('gameOver', { winner });
                        }
                        return;
                    }
                }
            }
        }
    }
    
    // Mettre à jour les créatures pour le prochain tour
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) {
                    card.turnsOnField++;
                    card.canAttack = true;
                    card.movedThisTurn = false;
                }
            }
        }
    }
    
    // EFFETS DE FIN DE TOUR (onDamagedThisTurn: draw) — collecter les piochées bonus
    const bonusDraws = { 1: 0, 2: 0 };
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.onDamagedThisTurn === 'draw' && card.damagedThisTurn) {
                    log(`🐉 ${card.name} a subi des blessures ce tour — pioche supplémentaire!`, 'special');
                    bonusDraws[p]++;
                }
            }
        }
    }

    // Vérifier victoire finale
    const finalWinner = checkVictory();
    if (finalWinner) {
        await sleep(800);
        log(`🏆 ${room.gameState.players[finalWinner].heroName} GAGNE!`, 'phase');
        io.to(room.code).emit('gameOver', { winner: finalWinner });
        return;
    }
    
    // 7. PIOCHE
    // Vérifier d'abord si les deux joueurs peuvent piocher
    const player1CanDraw = room.gameState.players[1].deck.length > 0;
    const player2CanDraw = room.gameState.players[2].deck.length > 0;
    
    if (!player1CanDraw && !player2CanDraw) {
        // Les deux joueurs ne peuvent pas piocher = DRAW
        log(`💀 Les deux joueurs n'ont plus de cartes dans leur deck!`, 'damage');
        log(`🤝 Match nul par épuisement simultané!`, 'phase');
        io.to(room.code).emit('gameOver', { winner: 0, draw: true });
        return;
    } else if (!player1CanDraw) {
        log(`💀 ${room.gameState.players[1].heroName} n'a plus de cartes dans son deck!`, 'damage');
        log(`🏆 ${room.gameState.players[2].heroName} GAGNE par épuisement du deck!`, 'phase');
        io.to(room.code).emit('gameOver', { winner: 2 });
        return;
    } else if (!player2CanDraw) {
        log(`💀 ${room.gameState.players[2].heroName} n'a plus de cartes dans son deck!`, 'damage');
        log(`🏆 ${room.gameState.players[1].heroName} GAGNE par épuisement du deck!`, 'phase');
        io.to(room.code).emit('gameOver', { winner: 1 });
        return;
    }
    
    // 7b. PHASE DE PIOCHE
    io.to(room.code).emit('phaseMessage', { text: 'Pioche', type: 'draw' });
    log('🎴 Pioche', 'phase');
    await sleep(800);

    // Les deux joueurs piochent 1 carte normale
    const drawnCards = [];
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        if (player.deck.length === 0) continue;
        const card = player.deck.shift();
        if (card.type === 'creature') {
            card.currentHp = card.hp;
            card.canAttack = false;
            card.turnsOnField = 0;
            card.movedThisTurn = false;
        }

        if (player.hand.length >= 9) {
            addToGraveyard(player, card);
            log(`📦 ${player.heroName} a la main pleine, la carte va au cimetière`, 'damage');
            drawnCards.push({ player: p, card: card, burned: true });
        } else {
            player.hand.push(card);
            drawnCards.push({ player: p, card: card, handIndex: player.hand.length - 1 });
        }
    }

    // Séparer les cartes piochées normalement et les cartes brûlées
    const normalDraws = drawnCards.filter(d => !d.burned);
    const burnedCards = drawnCards.filter(d => d.burned);

    // Animation de pioche normale AVANT état
    if (normalDraws.length > 0) {
        emitAnimation(room, 'draw', { cards: normalDraws });
    }

    // Animation de burn AVANT état (le client bloque le render du cimetière dès réception)
    for (const burned of burnedCards) {
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
    }

    await sleep(20); // Laisser les events arriver avant l'état

    // État (le render va créer les cartes cachées, le cimetière est bloqué pour les burns)
    emitStateToBoth(room);
    log('📦 Les joueurs piochent une carte', 'action');

    // Attendre la plus longue animation (pioche ~1400ms, burn ~1550ms)
    const drawDelay = normalDraws.length > 0 ? 1400 : 0;
    const burnDelay = burnedCards.length > 0 ? 1600 : 0;
    await sleep(Math.max(drawDelay, burnDelay, 500));

    // 8. EFFETS DE FIN DE TOUR
    io.to(room.code).emit('phaseMessage', { text: 'Effet de fin de tour', type: 'endturn' });
    log('✨ Effet de fin de tour', 'phase');
    await sleep(800);

    // Piochées bonus (Dragon d'Éclat blessé, etc.)
    for (let p = 1; p <= 2; p++) {
        for (let i = 0; i < (bonusDraws[p] || 0); i++) {
            await drawCards(room, p, 1, log, sleep, `${room.gameState.players[p].heroName} (effet de créature)`);
        }
    }

    // Capacité Zdejebel: fin du tour, si le héros adverse a été attaqué, il subit 1 blessure
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        const opponent = room.gameState.players[playerNum === 1 ? 2 : 1];

        console.log(`[Zdejebel Check] Player ${playerNum} hero:`, player.hero?.id, 'opponent.heroAttackedThisTurn:', opponent.heroAttackedThisTurn);

        if (player.hero && player.hero.id === 'zdejebel' && opponent.heroAttackedThisTurn) {
            opponent.hp -= 1;
            log(`😈 ${player.heroName}: capacité Zdejebel - ${opponent.heroName} subit 1 blessure!`, 'damage');
            emitAnimation(room, 'zdejebel', { targetPlayer: playerNum === 1 ? 2 : 1, damage: 1 });
            await sleep(800);
            emitStateToBoth(room);

            // Vérifier si le héros est mort
            if (opponent.hp <= 0) {
                log(`🏆 ${player.heroName} GAGNE grâce à Zdejebel!`, 'phase');
                io.to(room.code).emit('gameOver', { winner: playerNum });
                return;
            }
        }
    }

    // Régénération: soigner les créatures avec l'ability regeneration
    let anyRegen = false;
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.abilities.includes('regeneration') && card.currentHp < card.hp) {
                    const regenAmount = card.regenerationX || 1;
                    const oldHp = card.currentHp;
                    card.currentHp = Math.min(card.hp, card.currentHp + regenAmount);
                    const healed = card.currentHp - oldHp;
                    if (healed > 0) {
                        log(`💚 ${card.name} régénère +${healed} PV! (${card.currentHp}/${card.hp})`, 'heal');
                        emitAnimation(room, 'heal', { player: playerNum, row: r, col: c, amount: healed });
                        anyRegen = true;
                    }
                }
            }
        }
    }
    if (anyRegen) {
        emitStateToBoth(room);
        await sleep(600);
    }

    startNewTurn(room);
}

// Résoudre les pièges pour une rangée (avant le combat)
async function processTrapsForRow(room, row, log, sleep) {
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
                    row,
                    col);
                
                // Le piège se déclenche si la créature attaque (même le héros)
                if (target) {
                    attackers.push({ card, col });
                }
            }
        }
        
        // Déclencher le piège sur le premier attaquant trouvé
        if (attackers.length > 0) {
            emitAnimation(room, 'trapTrigger', { player: defenderPlayer, row: row, trap: trap });
            await sleep(2200);

            if (trap.pattern === 'line') {
                // === PIÈGE DE LIGNE : blesse toutes les créatures adverses sur la ligne ===
                log(`🪤 Piège "${trap.name}" déclenché sur la ligne ${row + 1}!`, 'trap');

                const lineTargets = [];
                for (let col = 0; col < 2; col++) {
                    const card = attackerState.field[row][col];
                    if (card) {
                        lineTargets.push({ card, col });
                    }
                }

                if (trap.damage) {
                    for (const t of lineTargets) {
                        const actualDmg = applyCreatureDamage(t.card, trap.damage, room, log, attackerPlayer, row, t.col);
                        if (actualDmg > 0) {
                            emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: t.col, amount: trap.damage });
                            log(`  🔥 ${t.card.name} subit ${trap.damage} dégâts du piège!`, 'damage');
                            if (t.card.currentHp > 0 && t.card.abilities.includes('power')) {
                                const powerBonus = t.card.powerX || 1;
                                t.card.atk += powerBonus;
                                log(`💪 ${t.card.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                        }
                    }
                    await sleep(500);
                }

                // Mettre le piège au cimetière
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);

                // Vérifier les morts
                const trapLineNormalDeaths = [];
                for (const t of lineTargets) {
                    if (t.card.currentHp <= 0) {
                        const result = handleCreatureDeath(room, t.card, attackerPlayer, row, t.col, log);
                        if (result.transformed) {
                            emitAnimation(room, 'deathTransform', { player: attackerPlayer, row: row, col: t.col, fromCard: t.card, toCard: result.newCard });
                        } else {
                            log(`  ☠️ ${t.card.name} détruit par le piège!`, 'damage');
                            emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: t.col, card: t.card });
                            trapLineNormalDeaths.push(t);
                        }
                    }
                }
                const anyDead = lineTargets.some(t => t.card.currentHp <= 0);
                if (anyDead) {
                    emitStateToBoth(room);
                    await sleep(1100);
                    for (const t of trapLineNormalDeaths) {
                        await processOnDeathAbility(room, t.card, attackerPlayer, log, sleep);
                    }
                }
            } else if (trap.effect === 'bounce') {
                // === PIÈGE BOUNCE : renvoie la créature dans la main ===
                const firstAttacker = attackers[0];

                log(`🪤 Piège "${trap.name}" déclenché sur ${firstAttacker.card.name}!`, 'trap');

                // Réinitialiser la carte à ses stats de base
                const bouncedCard = resetCardForGraveyard(firstAttacker.card);
                if (bouncedCard.type === 'creature') {
                    bouncedCard.currentHp = bouncedCard.hp;
                    bouncedCard.baseAtk = bouncedCard.atk;
                    bouncedCard.baseHp = bouncedCard.hp;
                    bouncedCard.canAttack = false;
                    bouncedCard.turnsOnField = 0;
                    bouncedCard.movedThisTurn = false;
                    bouncedCard.uid = `${Date.now()}-bounce-${Math.random()}`;
                }

                // Retirer du terrain
                attackerState.field[row][firstAttacker.col] = null;

                // Remettre en main (si main pleine, va au cimetière)
                if (attackerState.hand.length < 10) {
                    attackerState.hand.push(bouncedCard);
                    log(`  🌀 ${bouncedCard.name} renvoyé dans la main!`, 'action');
                } else {
                    addToGraveyard(attackerState, bouncedCard);
                    log(`  🌀 ${bouncedCard.name} renvoyé mais main pleine → cimetière!`, 'action');
                }

                // Mettre le piège au cimetière
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);
            } else {
                // === PIÈGE STANDARD : blesse le premier attaquant ===
                const firstAttacker = attackers[0];

                log(`🪤 Piège "${trap.name}" déclenché sur ${firstAttacker.card.name}!`, 'trap');

                if (trap.damage) {
                    const actualDmg = applyCreatureDamage(firstAttacker.card, trap.damage, room, log, attackerPlayer, row, firstAttacker.col);
                    if (actualDmg > 0) {
                        emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: firstAttacker.col, amount: trap.damage });
                    }
                    await sleep(500);
                    if (actualDmg > 0 && firstAttacker.card.currentHp > 0 && firstAttacker.card.abilities.includes('power')) {
                        const powerBonus = firstAttacker.card.powerX || 1;
                        firstAttacker.card.atk += powerBonus;
                        log(`💪 ${firstAttacker.card.name} gagne +${powerBonus} ATK!`, 'buff');
                    }
                }

                const wasStunned = trap.effect === 'stun';
                if (wasStunned) {
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
                    const result = handleCreatureDeath(room, deadCard, attackerPlayer, row, firstAttacker.col, log);
                    if (result.transformed) {
                        emitAnimation(room, 'deathTransform', { player: attackerPlayer, row: row, col: firstAttacker.col, fromCard: deadCard, toCard: result.newCard });
                    } else {
                        log(`  ☠️ ${deadCard.name} détruit par le piège!`, 'damage');
                        emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: firstAttacker.col, card: deadCard });
                    }
                    emitStateToBoth(room);
                    await sleep(1100);
                    if (!result.transformed) {
                        await processOnDeathAbility(room, deadCard, attackerPlayer, log, sleep);
                    }
                }
            }
        }
    }
}

// Fonction séparée pour appliquer les sorts
async function applySpell(room, action, log, sleep) {
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
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
    await sleep(2100);
    
    // SORTS GLOBAUX (sans ciblage)
    if (spell.pattern === 'global') {
        if (spell.effect === 'draw') {
            await drawCards(room, playerNum, spell.amount, log, sleep, `${action.heroName}: ${spell.name}`);
        } else if (spell.effect === 'mana') {
            // Gagne un cristal mana (ou pioche si déjà 10)
            if (player.maxEnergy < 10) {
                player.maxEnergy++;
                player.energy++;
                log(`  💎 ${action.heroName}: ${spell.name} - gagne un cristal de mana (${player.maxEnergy}/10)`, 'action');
            } else if (player.deck.length > 0) {
                await drawCards(room, playerNum, 1, log, sleep, `${action.heroName}: ${spell.name} - mana max`);
            }
        }
    }
    // SORT QUI TOUCHE TOUTES LES CRÉATURES
    else if (spell.pattern === 'all') {
        log(`  🌋 ${action.heroName}: ${spell.name} - ${spell.damage} dégâts à toutes les créatures!`, 'damage');

        // Phase 1: Collecter toutes les cibles et envoyer les animations de dégâts EN BATCH
        const deaths = [];
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

        // Phase 2: Attendre que toutes les animations de dégâts se terminent
        await sleep(800);

        // Phase 3: Appliquer les dégâts et collecter les morts
        for (let p = 1; p <= 2; p++) {
            const targetPlayer = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = targetPlayer.field[r][c];
                    if (target) {
                        const actualDmg = applyCreatureDamage(target, spell.damage, room, log, p, r, c);

                        if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                            target.atk += (target.powerX || 1);
                        }

                        if (target.currentHp <= 0) {
                            deaths.push({ player: targetPlayer, p, r, c, target });
                        }
                    }
                }
            }
        }

        // Phase 4: Envoyer toutes les animations de mort EN MÊME TEMPS
        if (deaths.length > 0) {
            // Bloquer les slots des cartes qui vont mourir pour que render() ne les efface pas
            const slotsToBlock = deaths.map(d => ({ player: d.p, row: d.r, col: d.c }));
            io.to(room.code).emit('blockSlots', slotsToBlock);

            const normalDeaths = [];
            for (const d of deaths) {
                const result = handleCreatureDeath(room, d.target, d.p, d.r, d.c, log);
                if (result.transformed) {
                    emitAnimation(room, 'deathTransform', { player: d.p, row: d.r, col: d.c, fromCard: d.target, toCard: result.newCard });
                } else {
                    log(`    ☠️ ${d.target.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: d.p, row: d.r, col: d.c, card: d.target });
                    normalDeaths.push(d);
                }
            }

            // Envoyer l'état maintenant (les slots bloqués ne seront pas touchés par render)
            emitStateToBoth(room);

            // Attendre que toutes les animations de mort se terminent
            await sleep(1100);

            // Débloquer les slots
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            // Capacités onDeath (seulement pour les morts normales)
            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.target, d.p, log, sleep);
            }
        }

        emitStateToBoth(room);
    }
    // SORT SUR UN HÉROS (peut être allié ou adverse selon targetPlayer)
    else if (spell.pattern === 'hero') {
        const targetHero = room.gameState.players[action.targetPlayer];
        const targetName = targetHero.heroName;
        
        if (spell.damage) {
            // Dégâts au héros ciblé
            targetHero.hp -= spell.damage;
            log(`  👊 ${action.heroName}: ${spell.name} → ${targetName} (-${spell.damage})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: action.targetPlayer, damage: spell.damage });
            io.to(room.code).emit('directDamage', { defender: action.targetPlayer, damage: spell.damage });
        } else if (spell.effect === 'draw') {
            await drawCards(room, action.targetPlayer, spell.amount, log, sleep, `${action.heroName}: ${spell.name} → ${targetName}`);
        } else if (spell.effect === 'mana') {
            // Le héros ciblé gagne un mana
            if (targetHero.maxEnergy < 10) {
                targetHero.maxEnergy++;
                targetHero.energy++;
                log(`  💎 ${action.heroName}: ${spell.name} → ${targetName} gagne un cristal de mana (${targetHero.maxEnergy}/10)`, 'action');
            } else if (targetHero.deck.length > 0) {
                await drawCards(room, action.targetPlayer, 1, log, sleep, `${action.heroName}: ${spell.name} → ${targetName} mana max`);
            }
        } else if (spell.heal) {
            // Soin au héros ciblé
            const oldHp = targetHero.hp;
            targetHero.hp = Math.min(20, targetHero.hp + spell.heal);
            const healed = targetHero.hp - oldHp;
            if (healed > 0) {
                log(`  💚 ${action.heroName}: ${spell.name} → ${targetName} (+${healed} PV)`, 'heal');
            }
        }
    }
    // SORT EN CROIX
    else if (spell.pattern === 'cross') {
        const adjacentTargets = getCrossTargets(action.targetPlayer, action.row, action.col);
        const allTargets = [
            { row: action.row, col: action.col, player: action.targetPlayer },
            ...adjacentTargets
        ];

        log(`  ✝️ ${action.heroName}: ${spell.name} en croix sur ${slotNames[action.row][action.col]}!`, 'damage');

        // Highlight les zones touchées
        io.to(room.code).emit('spellHighlight', { targets: allTargets, type: 'damage' });

        // Phase 1: Envoyer toutes les animations de dégâts EN BATCH
        const spellAnimations = [];
        for (const t of allTargets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];
            if (target) {
                spellAnimations.push({ type: 'spellDamage', player: t.player, row: t.row, col: t.col, amount: spell.damage });
            }
        }
        if (spellAnimations.length > 0) {
            emitAnimationBatch(room, spellAnimations);
        }

        // Phase 2: Attendre les animations
        await sleep(800);

        // Phase 3: Appliquer les dégâts et collecter les morts
        const deaths = [];
        for (const t of allTargets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];

            if (target) {
                const actualDmg = applyCreatureDamage(target, spell.damage, room, log, t.player, t.row, t.col);
                if (actualDmg > 0) {
                    log(`    🔥 ${target.name} (-${spell.damage})`, 'damage');
                }

                if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                    target.atk += (target.powerX || 1);
                }

                if (target.currentHp <= 0) {
                    const targetOwner = t.player === playerNum ? player : opponent;
                    deaths.push({ owner: targetOwner, field: targetField, t, target });
                }
            }
        }

        // Phase 4: Envoyer toutes les morts EN MÊME TEMPS
        if (deaths.length > 0) {
            // Bloquer les slots des cartes qui vont mourir pour que render() ne les efface pas
            const slotsToBlock = deaths.map(d => ({ player: d.t.player, row: d.t.row, col: d.t.col }));
            io.to(room.code).emit('blockSlots', slotsToBlock);

            const normalDeaths = [];
            for (const d of deaths) {
                const result = handleCreatureDeath(room, d.target, d.t.player, d.t.row, d.t.col, log);
                if (result.transformed) {
                    emitAnimation(room, 'deathTransform', { player: d.t.player, row: d.t.row, col: d.t.col, fromCard: d.target, toCard: result.newCard });
                } else {
                    log(`    ☠️ ${d.target.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: d.t.player, row: d.t.row, col: d.t.col, card: d.target });
                    normalDeaths.push(d);
                }
            }

            // Envoyer l'état maintenant (les slots bloqués ne seront pas touchés par render)
            emitStateToBoth(room);

            // Attendre que toutes les animations de mort se terminent
            await sleep(1100);

            // Débloquer les slots
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            // Capacités onDeath (seulement pour les morts normales)
            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.target, d.t.player, log, sleep);
            }
        }

        emitStateToBoth(room);
    }
    // SORT CIBLÉ SIMPLE
    else {
        // Vérifier si on cible un héros (row = -1)
        if (action.row === -1) {
            const targetHero = room.gameState.players[action.targetPlayer];
            const targetName = targetHero.heroName;
            
            // Highlight le héros
            io.to(room.code).emit('heroHighlight', { player: action.targetPlayer, type: spell.offensive ? 'damage' : 'heal' });
            
            if (spell.heal) {
                // Soin au héros
                const oldHp = targetHero.hp;
                targetHero.hp = Math.min(20, targetHero.hp + spell.heal);
                const healed = targetHero.hp - oldHp;
                if (healed > 0) {
                    log(`  💚 ${action.heroName}: ${spell.name} → ${targetName} (+${healed} PV)`, 'heal');
                }
            }
        } else {
            const targetField = action.targetPlayer === playerNum ? player.field : opponent.field;
            const target = targetField[action.row][action.col];
            
            // Highlight la zone touchée
            io.to(room.code).emit('spellHighlight', { 
                targets: [{ row: action.row, col: action.col, player: action.targetPlayer }], 
                type: spell.offensive ? 'damage' : 'heal' 
            });
            
            if (target) {
                // Dégâts
                if (spell.offensive && spell.damage) {
                    // Animation de flammes pour les dégâts de sort
                    emitAnimation(room, 'spellDamage', { player: action.targetPlayer, row: action.row, col: action.col, amount: spell.damage });
                    await sleep(800);

                    const actualDmg = applyCreatureDamage(target, spell.damage, room, log, action.targetPlayer, action.row, action.col);
                    if (actualDmg > 0) {
                        log(`  🔥 ${action.heroName}: ${spell.name} → ${target.name} (-${spell.damage})`, 'damage');
                    }

                    if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                        target.atk += (target.powerX || 1);
                    }

                    if (target.currentHp <= 0) {
                        const result = handleCreatureDeath(room, target, action.targetPlayer, action.row, action.col, log);
                        if (result.transformed) {
                            emitAnimation(room, 'deathTransform', { player: action.targetPlayer, row: action.row, col: action.col, fromCard: target, toCard: result.newCard });
                        } else {
                            log(`  ☠️ ${target.name} détruit!`, 'damage');
                            emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col, card: target });
                        }
                        await sleep(1100);
                        if (!result.transformed) {
                            // Capacité onDeath
                            await processOnDeathAbility(room, target, action.targetPlayer, log, sleep);
                        }

                        // Effet onKill du sort (ex: piocher une carte)
                        if (spell.onKill) {
                            if (spell.onKill.draw && player.deck.length > 0) {
                                await drawCards(room, playerNum, spell.onKill.draw, log, sleep, `${action.heroName}: ${spell.name} (onKill)`);
                            }
                        }
                    }

                    emitStateToBoth(room);
                }
                // Soin
                if (!spell.offensive && spell.heal) {
                    const oldHp = target.currentHp;
                    target.currentHp = Math.min(target.hp, target.currentHp + spell.heal);
                    const healed = target.currentHp - oldHp;
                    if (healed > 0) {
                        // Stocker l'effet appliqué sur la carte
                        if (!target.appliedEffects) target.appliedEffects = [];
                        target.appliedEffects.push({
                            name: spell.name,
                            icon: spell.icon,
                            description: `+${healed} ❤️ restauré`
                        });
                        log(`  💚 ${action.heroName}: ${spell.name} → ${target.name} (+${healed} PV)`, 'heal');
                        emitAnimation(room, 'heal', { player: action.targetPlayer, row: action.row, col: action.col, amount: healed });
                    }
                }
                // Buff (+ATK/+HP)
                if (!spell.offensive && spell.buff) {
                    target.atk += spell.buff.atk;
                    target.hp += spell.buff.hp;
                    target.currentHp += spell.buff.hp;
                    // Stocker l'effet appliqué sur la carte
                    if (!target.appliedEffects) target.appliedEffects = [];
                    target.appliedEffects.push({
                        name: spell.name,
                        icon: spell.icon,
                        description: spell.description || `+${spell.buff.atk} ⚔️ +${spell.buff.hp} ❤️`
                    });
                    log(`  💪 ${action.heroName}: ${spell.name} → ${target.name} (+${spell.buff.atk}/+${spell.buff.hp})`, 'action');
                    emitAnimation(room, 'buff', { player: action.targetPlayer, row: action.row, col: action.col, atk: spell.buff.atk, hp: spell.buff.hp });
                }
            } else {
                log(`  💨 ${action.heroName}: ${spell.name} n'a rien touché`, 'action');
                emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
            }
        }
    }
    
    // Mettre le sort au cimetière après utilisation
    addToGraveyard(player, spell);
    
    emitStateToBoth(room);
    await sleep(600);
}

async function applyAction(room, playerNum, action, log, sleep) {
    // Fonction legacy - non utilisée dans la nouvelle résolution
}

// Combat pour un slot spécifique
// Règles:
// - Si les deux créatures PEUVENT attaquer et se ciblent mutuellement → dégâts SIMULTANÉS
// - Si une seule peut attaquer → elle attaque, l'autre RIPOSTE (si survit et conditions remplies)
async function processCombatSlot(room, row, col, log, sleep) {
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    
    const p1Card = p1State.field[row][col];
    const p2Card = p2State.field[row][col];
    
    // Collecter les attaques de ce slot
    const attacks = [];
    
    // Créature du joueur 1 à ce slot
    if (p1Card && p1Card.canAttack) {
        const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row, col);
        if (target) {
            attacks.push({
                attacker: p1Card,
                attackerPlayer: 1,
                attackerRow: row,
                attackerCol: col,
                target: target.card,
                targetPlayer: 2,
                targetRow: target.row !== undefined ? target.row : row,
                targetCol: target.col,
                targetIsHero: target.isHero,
                hasTrample: p1Card.abilities.includes('trample')
            });
        }
    }

    // Créature du joueur 2 à ce slot
    if (p2Card && p2Card.canAttack) {
        const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row, col);
        if (target) {
            attacks.push({
                attacker: p2Card,
                attackerPlayer: 2,
                attackerRow: row,
                attackerCol: col,
                target: target.card,
                targetPlayer: 1,
                targetRow: target.row !== undefined ? target.row : row,
                targetCol: target.col,
                targetIsHero: target.isHero,
                hasTrample: p2Card.abilities.includes('trample')
            });
        }
    }
    
    if (attacks.length === 0) return false;
    
    // Détecter le combat mutuel AVANT d'animer
    let isMutualCombat = false;
    if (attacks.length === 2 && !attacks[0].targetIsHero && !attacks[1].targetIsHero) {
        const atk1 = attacks[0];
        const atk2 = attacks[1];
        const atk1TargetsAtk2 = atk1.targetPlayer === atk2.attackerPlayer && 
                               atk1.targetRow === atk2.attackerRow && 
                               atk1.targetCol === atk2.attackerCol;
        const atk2TargetsAtk1 = atk2.targetPlayer === atk1.attackerPlayer && 
                               atk2.targetRow === atk1.attackerRow && 
                               atk2.targetCol === atk1.attackerCol;
        isMutualCombat = atk1TargetsAtk2 && atk2TargetsAtk1;
    }
    
    // Animer les attaques avec l'info de combat mutuel
    for (const atk of attacks) {
        emitAnimation(room, 'attack', {
            attacker: atk.attackerPlayer,
            row: atk.attackerRow,
            col: atk.attackerCol,
            targetPlayer: atk.targetPlayer,
            targetRow: atk.targetRow,
            targetCol: atk.targetIsHero ? -1 : atk.targetCol,
            isFlying: atk.attacker.abilities.includes('fly'),
            isShooter: atk.attacker.abilities.includes('shooter'),
            isMutual: isMutualCombat
        });
    }
    await sleep(500);
    
    // CAS 1: Les deux créatures peuvent attaquer et se ciblent mutuellement
    if (attacks.length === 2 && !attacks[0].targetIsHero && !attacks[1].targetIsHero) {
        const atk1 = attacks[0];
        const atk2 = attacks[1];
        
        // Vérifier si elles se ciblent mutuellement (par position, pas par référence d'objet!)
        const atk1TargetsAtk2 = atk1.targetPlayer === atk2.attackerPlayer && 
                               atk1.targetRow === atk2.attackerRow && 
                               atk1.targetCol === atk2.attackerCol;
        const atk2TargetsAtk1 = atk2.targetPlayer === atk1.attackerPlayer && 
                               atk2.targetRow === atk1.attackerRow && 
                               atk2.targetCol === atk1.attackerCol;
        const mutualCombat = atk1TargetsAtk2 && atk2TargetsAtk1;
        
        if (mutualCombat) {
            // Helper pour appliquer le clivant
            const applyCleave = (attacker, atkData) => {
                if (!attacker.abilities.includes('cleave')) return [];
                const cleaveTargets = [];
                const targetOwner = room.gameState.players[atkData.targetPlayer];
                const adjacentRows = [atkData.targetRow - 1, atkData.targetRow + 1].filter(r => r >= 0 && r < 4);
                const damage = attacker.cleaveX || attacker.atk; // Utiliser cleaveX si défini, sinon atk

                for (const adjRow of adjacentRows) {
                    const adjTarget = targetOwner.field[adjRow][atkData.targetCol];
                    if (adjTarget) {
                        const attackerIsFlying = attacker.abilities.includes('fly');
                        const attackerIsShooter = attacker.abilities.includes('shooter');
                        if (adjTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                            continue;
                        }

                        const actualCDmg = applyCreatureDamage(adjTarget, damage, room, log, atkData.targetPlayer, adjRow, atkData.targetCol, { player: atkData.attackerPlayer, row: atkData.attackerRow, col: atkData.attackerCol, uid: attacker.uid });
                        if (actualCDmg > 0) {
                            log(`⛏️ Clivant ${damage}: ${attacker.name} → ${adjTarget.name} (-${damage})`, 'damage');
                            emitAnimation(room, 'damage', { player: atkData.targetPlayer, row: adjRow, col: atkData.targetCol, amount: damage });
                        }

                        if (actualCDmg > 0 && adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                            adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + (adjTarget.powerX || 1);
                        }

                        cleaveTargets.push({ row: adjRow, col: atkData.targetCol });
                    }
                }
                return cleaveTargets;
            };

            // Helper pour appliquer le piétinement
            const applyTrample = async (attacker, target, atkData) => {
                if (!atkData.hasTrample || target.currentHp >= 0) return;
                
                const excessDamage = Math.abs(target.currentHp);
                const targetOwner = room.gameState.players[atkData.targetPlayer];
                
                // Chercher la créature derrière (col 0 si on était sur col 1)
                let trampleTarget = null;
                let trampleCol = -1;
                if (atkData.targetCol === 1) {
                    trampleTarget = targetOwner.field[atkData.targetRow][0];
                    trampleCol = 0;
                }
                
                // Vérifier si la créature derrière peut être touchée
                const attackerIsFlying = attacker.abilities.includes('fly');
                const attackerIsShooter = attacker.abilities.includes('shooter');

                // Un volant ne peut pas toucher une créature normale avec le piétinement
                if (trampleTarget && attackerIsFlying && !attackerIsShooter) {
                    const trampleTargetIsFlying = trampleTarget.abilities.includes('fly');
                    const trampleTargetIsShooter = trampleTarget.abilities.includes('shooter');
                    if (!trampleTargetIsFlying && !trampleTargetIsShooter) {
                        trampleTarget = null;
                    }
                }

                // Un non-volant/non-tireur ne peut pas toucher un volant
                if (trampleTarget && trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                    trampleTarget = null;
                }

                if (trampleTarget) {
                    const actualTrDmg = applyCreatureDamage(trampleTarget, excessDamage, room, log, atkData.targetPlayer, atkData.targetRow, trampleCol, { player: atkData.attackerPlayer, row: atkData.attackerRow, col: atkData.attackerCol, uid: attacker.uid });
                    if (actualTrDmg > 0) {
                        log(`🦏 Piétinement: ${attacker.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
                        emitAnimation(room, 'damage', { player: atkData.targetPlayer, row: atkData.targetRow, col: trampleCol, amount: excessDamage });
                    }

                    if (actualTrDmg > 0 && trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
                        trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + (trampleTarget.powerX || 1);
                    }
                } else if (excessDamage > 0) {
                    targetOwner.hp -= excessDamage;
                    targetOwner.heroAttackedThisTurn = true;
                    log(`🦏 Piétinement: ${attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
                    emitAnimation(room, 'heroHit', { defender: atkData.targetPlayer, damage: excessDamage });
                    io.to(room.code).emit('directDamage', { defender: atkData.targetPlayer, damage: excessDamage });
                }
            };

            // Dégâts SIMULTANÉS - les deux s'infligent des dégâts en même temps
            const dmg1to2 = atk1.attacker.atk;
            const dmg2to1 = atk2.attacker.atk;

            const actualDmg1to2 = applyCreatureDamage(atk2.attacker, dmg1to2, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualDmg2to1 = applyCreatureDamage(atk1.attacker, dmg2to1, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });

            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${actualDmg1to2} / -${actualDmg2to1})`, 'damage');
            if (actualDmg1to2 > 0) emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: dmg1to2 });
            if (actualDmg2to1 > 0) emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: dmg2to1 });

            // Power bonus (stocké pour après)
            if (actualDmg2to1 > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                atk1.attacker.pendingPowerBonus = (atk1.attacker.pendingPowerBonus || 0) + (atk1.attacker.powerX || 1);
            }
            if (actualDmg1to2 > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                atk2.attacker.pendingPowerBonus = (atk2.attacker.pendingPowerBonus || 0) + (atk2.attacker.powerX || 1);
            }

            // Clivant - en combat mutuel, ne se déclenche que si la cible est un tireur (immobile)
            if (atk2.attacker.abilities.includes('shooter')) {
                atk1.cleaveTargets = applyCleave(atk1.attacker, atk1);
            }
            if (atk1.attacker.abilities.includes('shooter')) {
                atk2.cleaveTargets = applyCleave(atk2.attacker, atk2);
            }

            // Piétinement en combat mutuel - seulement si la cible est un tireur
            if (atk2.attacker.abilities.includes('shooter')) {
                await applyTrample(atk1.attacker, atk2.attacker, atk1);
            }
            if (atk1.attacker.abilities.includes('shooter')) {
                await applyTrample(atk2.attacker, atk1.attacker, atk2);
            }
            
            // Appliquer les bonus Power
            applyPendingPowerBonuses(room, log);
            
            emitStateToBoth(room);
            await sleep(400);
            
            // Vérifier les morts (inclure les slots derrière pour le piétinement et clivant)
            const slotsToCheck = [[row, col]];
            if (atk1.targetCol === 1) slotsToCheck.push([atk1.targetRow, 0]);
            if (atk2.targetCol === 1) slotsToCheck.push([atk2.targetRow, 0]);
            // Ajouter les cibles du clivant
            if (atk1.cleaveTargets) {
                for (const ct of atk1.cleaveTargets) slotsToCheck.push([ct.row, ct.col]);
            }
            if (atk2.cleaveTargets) {
                for (const ct of atk2.cleaveTargets) slotsToCheck.push([ct.row, ct.col]);
            }
            await checkAndRemoveDeadCreatures(room, slotsToCheck, log, sleep);
            
            // Vérifier victoire après piétinement
            const p1hp = room.gameState.players[1].hp;
            const p2hp = room.gameState.players[2].hp;
            if (p1hp <= 0 || p2hp <= 0) {
                return true;
            }
            
            return false;
        }
    }
    
    // CAS 2: Attaques non-mutuelles ou attaques sur héros - traitement séquentiel
    
    for (const atk of attacks) {
        const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
        if (!attackerCard || attackerCard.currentHp <= 0) continue;

        if (atk.targetIsHero) {
            room.gameState.players[atk.targetPlayer].hp -= attackerCard.atk;
            room.gameState.players[atk.targetPlayer].heroAttackedThisTurn = true;
            log(`⚔️ ${attackerCard.name} → ${room.gameState.players[atk.targetPlayer].heroName} (-${attackerCard.atk})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
            io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });

            // Capacité spéciale: bonus ATK quand attaque un héros (Salamandre de braise)
            if (attackerCard.onHeroAttack && attackerCard.onHeroAttack.atkBoost) {
                const boost = attackerCard.onHeroAttack.atkBoost;
                attackerCard.atk += boost;
                log(`🔥 ${attackerCard.name} gagne +${boost} ATK!`, 'buff');
                emitAnimation(room, 'atkBoost', {
                    player: atk.attackerPlayer,
                    row: atk.attackerRow,
                    col: atk.attackerCol,
                    boost: boost
                });
                await sleep(500);
            }

            // Capacité spéciale: piocher une carte quand attaque un héros
            if (attackerCard.onHeroHit === 'draw') {
                await drawCards(room, atk.attackerPlayer, 1, log, sleep, `${attackerCard.name} (onHeroHit)`);
            }

            if (room.gameState.players[atk.targetPlayer].hp <= 0) {
                return true;
            }
        } else if (atk.target) {
            const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
            if (!targetCard) continue;

            const damage = attackerCard.atk;
            const actualMainDmg = applyCreatureDamage(targetCard, damage, room, log, atk.targetPlayer, atk.targetRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
            if (actualMainDmg > 0) {
                log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${damage})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: damage });
            }

            if (actualMainDmg > 0 && targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                targetCard.pendingPowerBonus = (targetCard.pendingPowerBonus || 0) + (targetCard.powerX || 1);
            }

            // Clivant - inflige les dégâts aux créatures sur les lignes adjacentes (même colonne)
            if (attackerCard.abilities.includes('cleave')) {
                const targetOwner = room.gameState.players[atk.targetPlayer];
                const adjacentRows = [atk.targetRow - 1, atk.targetRow + 1].filter(r => r >= 0 && r < 4);
                const cleaveDamage = attackerCard.cleaveX || attackerCard.atk; // Utiliser cleaveX si défini

                for (const adjRow of adjacentRows) {
                    const adjTarget = targetOwner.field[adjRow][atk.targetCol];
                    if (adjTarget) {
                        // Vérifier si on peut toucher une cible volante
                        const attackerIsFlying = attackerCard.abilities.includes('fly');
                        const attackerIsShooter = attackerCard.abilities.includes('shooter');
                        if (adjTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                            continue; // Ne peut pas toucher une créature volante
                        }

                        const actualCleaveDmg = applyCreatureDamage(adjTarget, cleaveDamage, room, log, atk.targetPlayer, adjRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
                        if (actualCleaveDmg > 0) {
                            log(`⛏️ Clivant ${cleaveDamage}: ${attackerCard.name} → ${adjTarget.name} (-${cleaveDamage})`, 'damage');
                            emitAnimation(room, 'damage', { player: atk.targetPlayer, row: adjRow, col: atk.targetCol, amount: cleaveDamage });
                        }

                        // Les cibles adjacentes ne ripostent PAS mais peuvent gagner Power
                        if (actualCleaveDmg > 0 && adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                            adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + (adjTarget.powerX || 1);
                        }

                        // Stocker pour vérifier les morts plus tard
                        atk.cleaveTargets = atk.cleaveTargets || [];
                        atk.cleaveTargets.push({ row: adjRow, col: atk.targetCol });
                    }
                }
            }

            // Piétinement
            if (atk.hasTrample && targetCard.currentHp < 0) {
                const excessDamage = Math.abs(targetCard.currentHp);
                const targetOwner = room.gameState.players[atk.targetPlayer];

                let trampleTarget = null;
                let trampleCol = -1;
                if (atk.targetCol === 1) {
                    trampleTarget = targetOwner.field[atk.targetRow][0];
                    trampleCol = 0;
                }

                const attackerIsFlying = attackerCard.abilities.includes('fly');
                const attackerIsShooter = attackerCard.abilities.includes('shooter');

                // Un volant ne peut pas toucher une créature normale avec le piétinement
                if (trampleTarget && attackerIsFlying && !attackerIsShooter) {
                    const trampleTargetIsFlying = trampleTarget.abilities.includes('fly');
                    const trampleTargetIsShooter = trampleTarget.abilities.includes('shooter');
                    if (!trampleTargetIsFlying && !trampleTargetIsShooter) {
                        trampleTarget = null;
                    }
                }

                // Un non-volant/non-tireur ne peut pas toucher un volant
                if (trampleTarget && trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                    trampleTarget = null;
                }

                if (trampleTarget) {
                    const actualTrampleDmg = applyCreatureDamage(trampleTarget, excessDamage, room, log, atk.targetPlayer, atk.targetRow, trampleCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
                    if (actualTrampleDmg > 0) {
                        log(`🦏 Piétinement: ${attackerCard.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
                        emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: trampleCol, amount: excessDamage });
                    }

                    if (actualTrampleDmg > 0 && trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
                        trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + (trampleTarget.powerX || 1);
                    }
                } else if (excessDamage > 0) {
                    targetOwner.hp -= excessDamage;
                    targetOwner.heroAttackedThisTurn = true;
                    log(`🦏 Piétinement: ${attackerCard.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
                    emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: excessDamage });
                    io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: excessDamage });

                    if (targetOwner.hp <= 0) return true;
                }
            }

            // RIPOSTE: seulement si la cible NE PEUT PAS attaquer ce tour
            // Les tireurs ne reçoivent JAMAIS de riposte (attaque à distance)
            const targetCanAttack = targetCard.canAttack;
            const attackerIsShooter = attackerCard.abilities.includes('shooter');

            // Riposte si la cible ne peut pas attaquer et l'attaquant n'est pas un tireur
            if (!targetCanAttack && !attackerIsShooter) {
                const riposteDamage = targetCard.atk;
                const actualRiposteDmg = applyCreatureDamage(attackerCard, riposteDamage, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid });
                if (actualRiposteDmg > 0) {
                    log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${riposteDamage})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: riposteDamage });
                }

                if (actualRiposteDmg > 0 && attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                    attackerCard.pendingPowerBonus = (attackerCard.pendingPowerBonus || 0) + (attackerCard.powerX || 1);
                }
            }
        }
    }

    // Appliquer les bonus Power
    applyPendingPowerBonuses(room, log);
    
    emitStateToBoth(room);
    await sleep(400);
    
    // Vérifier les morts
    const slotsToCheck = [[row, col]];
    for (const atk of attacks) {
        if (!atk.targetIsHero) {
            slotsToCheck.push([atk.targetRow, atk.targetCol]);
            if (atk.hasTrample && atk.targetCol === 1) {
                slotsToCheck.push([atk.targetRow, 0]);
            }
            // Ajouter les cibles du clivant
            if (atk.cleaveTargets) {
                for (const ct of atk.cleaveTargets) {
                    slotsToCheck.push([ct.row, ct.col]);
                }
            }
        }
    }
    await checkAndRemoveDeadCreatures(room, slotsToCheck, log, sleep);

    return false;
}

// Appliquer les bonus Power en attente
function applyPendingPowerBonuses(room, log) {
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.pendingPowerBonus > 0 && card.currentHp > 0) {
                    card.atk += card.pendingPowerBonus;
                    log(`💪 ${card.name} gagne +${card.pendingPowerBonus} ATK!`, 'action');
                    card.pendingPowerBonus = 0;
                }
            }
        }
    }
}

// Vérifier et retirer les créatures mortes
async function checkAndRemoveDeadCreatures(room, slotsToCheck, log, sleep) {
    const deadCards = [];
    const deathAnimations = [];

    for (const [r, c] of slotsToCheck) {
        for (let p = 1; p <= 2; p++) {
            const card = room.gameState.players[p].field[r][c];
            if (card && card.currentHp <= 0) {
                const result = handleCreatureDeath(room, card, p, r, c, log);
                if (result.transformed) {
                    deathAnimations.push({ type: 'deathTransform', player: p, row: r, col: c, fromCard: card, toCard: result.newCard });
                } else {
                    deadCards.push({ card, player: p, row: r, col: c });
                    log(`☠️ ${card.name} détruit!`, 'damage');
                    deathAnimations.push({ type: 'death', player: p, row: r, col: c, card: card });
                }
            }
        }
    }

    // Émettre toutes les animations de mort en même temps
    if (deathAnimations.length > 0) {
        emitAnimationBatch(room, deathAnimations);
    }

    emitStateToBoth(room);
    await sleep(1100);

    // Capacités onDeath
    for (const d of deadCards) {
        await processOnDeathAbility(room, d.card, d.player, log, sleep);
    }
}

// Traiter le combat pour un slot spécifique (row, col)
// Les deux joueurs ont une créature à cette position qui peuvent attaquer
async function processCombatSlotV2(room, row, col, log, sleep, checkVictory, slotNames) {
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    const slotName = slotNames[row][col];
    
    const p1Card = p1State.field[row][col];
    const p2Card = p2State.field[row][col];
    
    // Collecter les attaques de ce slot
    const attacks = [];
    
    if (p1Card && p1Card.canAttack && p1Card.currentHp > 0) {
        const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row, col);
        if (target) {
            attacks.push({
                attacker: p1Card,
                attackerPlayer: 1,
                attackerRow: row,
                attackerCol: col,
                target: target.card,
                targetPlayer: target.player,
                targetRow: target.row,
                targetCol: target.col,
                targetIsHero: target.isHero,
                hasTrample: p1Card.abilities.includes('trample'),
                isShooter: p1Card.abilities.includes('shooter'),
                isFlying: p1Card.abilities.includes('fly')
            });
        }
    }

    if (p2Card && p2Card.canAttack && p2Card.currentHp > 0) {
        const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row, col);
        if (target) {
            attacks.push({
                attacker: p2Card,
                attackerPlayer: 2,
                attackerRow: row,
                attackerCol: col,
                target: target.card,
                targetPlayer: target.player,
                targetRow: target.row,
                targetCol: target.col,
                targetIsHero: target.isHero,
                hasTrample: p2Card.abilities.includes('trample'),
                isShooter: p2Card.abilities.includes('shooter'),
                isFlying: p2Card.abilities.includes('fly')
            });
        }
    }
    
    if (attacks.length === 0) return false;
    
    // Vérifier si combat mutuel (les deux s'attaquent l'une l'autre)
    let mutualCombat = false;
    if (attacks.length === 2 && !attacks[0].targetIsHero && !attacks[1].targetIsHero) {
        const atk1 = attacks[0];
        const atk2 = attacks[1];
        
        const atk1TargetsAtk2 = atk1.targetPlayer === atk2.attackerPlayer && 
                               atk1.targetRow === atk2.attackerRow && 
                               atk1.targetCol === atk2.attackerCol;
        const atk2TargetsAtk1 = atk2.targetPlayer === atk1.attackerPlayer && 
                               atk2.targetRow === atk1.attackerRow && 
                               atk2.targetCol === atk1.attackerCol;
        
        mutualCombat = atk1TargetsAtk2 && atk2TargetsAtk1;
    }
    
    // Déterminer le type de combat et émettre l'animation appropriée
    if (mutualCombat) {
        const atk1 = attacks[0];
        const atk2 = attacks[1];
        
        const bothShooters = atk1.isShooter && atk2.isShooter;
        const shooterVsFlyer = (atk1.isShooter && !atk2.isShooter) || (!atk1.isShooter && atk2.isShooter);
        
        const dmg1 = atk1.attacker.atk;
        const dmg2 = atk2.attacker.atk;
        
        if (shooterVsFlyer) {
            // Tireur vs non-tireur (volant ou mêlée)
            const shooter = atk1.isShooter ? atk1 : atk2;
            const other = atk1.isShooter ? atk2 : atk1;
            const shooterDmg = shooter.attacker.atk;
            const otherDmg = other.attacker.atk;

            emitAnimation(room, 'attack', {
                combatType: 'shooter_vs_flyer',
                attacker: shooter.attackerPlayer,
                row: shooter.attackerRow,
                col: shooter.attackerCol,
                targetPlayer: other.attackerPlayer,
                targetRow: other.attackerRow,
                targetCol: other.attackerCol,
                shooterDamage: shooterDmg,
                flyerDamage: otherDmg,
                isShooter: true
            });
            await sleep(1200);

            // Dégâts simultanés
            const actualShooterDmg = applyCreatureDamage(other.attacker, shooterDmg, room, log, other.attackerPlayer, other.attackerRow, other.attackerCol, { player: shooter.attackerPlayer, row: shooter.attackerRow, col: shooter.attackerCol, uid: shooter.attacker.uid });
            const actualOtherDmg = applyCreatureDamage(shooter.attacker, otherDmg, room, log, shooter.attackerPlayer, shooter.attackerRow, shooter.attackerCol, { player: other.attackerPlayer, row: other.attackerRow, col: other.attackerCol, uid: other.attacker.uid });

            log(`⚔️ ${shooter.attacker.name} ↔ ${other.attacker.name} (-${actualShooterDmg} / -${actualOtherDmg})`, 'damage');

            if (actualOtherDmg > 0 && shooter.attacker.currentHp > 0 && shooter.attacker.abilities.includes('power')) {
                const powerBonus = shooter.attacker.powerX || 1;
                shooter.attacker.atk += powerBonus;
                log(`💪 ${shooter.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
            if (actualShooterDmg > 0 && other.attacker.currentHp > 0 && other.attacker.abilities.includes('power')) {
                const powerBonus = other.attacker.powerX || 1;
                other.attacker.atk += powerBonus;
                log(`💪 ${other.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
        } else if (bothShooters) {
            // Deux tireurs - projectiles croisés simultanés
            emitAnimation(room, 'attack', {
                combatType: 'mutual_shooters',
                attacker1: atk1.attackerPlayer,
                row1: atk1.attackerRow,
                col1: atk1.attackerCol,
                attacker2: atk2.attackerPlayer,
                row2: atk2.attackerRow,
                col2: atk2.attackerCol,
                damage1: dmg1,
                damage2: dmg2
            });
            await sleep(800);

            // Dégâts simultanés
            const actualD1bs = applyCreatureDamage(atk2.attacker, dmg1, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualD2bs = applyCreatureDamage(atk1.attacker, dmg2, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });

            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${actualD1bs} / -${actualD2bs})`, 'damage');

            if (actualD2bs > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                const powerBonus = atk1.attacker.powerX || 1;
                atk1.attacker.atk += powerBonus;
                log(`💪 ${atk1.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
            if (actualD1bs > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                const powerBonus = atk2.attacker.powerX || 1;
                atk2.attacker.atk += powerBonus;
                log(`💪 ${atk2.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
        } else {
            // Combat mêlée mutuel - combat simultané
            emitAnimation(room, 'attack', {
                combatType: 'mutual_melee',
                attacker: atk1.attackerPlayer,
                row: atk1.attackerRow,
                col: atk1.attackerCol,
                targetPlayer: atk2.attackerPlayer,
                targetRow: atk2.attackerRow,
                targetCol: atk2.attackerCol,
                damage1: dmg1,
                damage2: dmg2,
                isMutual: true
            });
            await sleep(900);

            // Dégâts simultanés
            const actualD1mm = applyCreatureDamage(atk2.attacker, dmg1, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualD2mm = applyCreatureDamage(atk1.attacker, dmg2, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });

            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${actualD1mm} / -${actualD2mm})`, 'damage');

            // Power
            if (actualD2mm > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                const powerBonus = atk1.attacker.powerX || 1;
                atk1.attacker.atk += powerBonus;
                log(`💪 ${atk1.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
            if (actualD1mm > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                const powerBonus = atk2.attacker.powerX || 1;
                atk2.attacker.atk += powerBonus;
                log(`💪 ${atk2.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
        }

        // Piétinement en combat mutuel - seulement si la cible est un tireur
        if (atk2.isShooter) {
            await applyTrampleDamage(room, atk1, log, sleep);
        }
        if (atk1.isShooter) {
            await applyTrampleDamage(room, atk2, log, sleep);
        }
    } else {
        // Pas de combat mutuel - traiter les attaques

        // CAS SPÉCIAL : 2 attaques qui peuvent se faire en parallèle
        if (attacks.length === 2) {
            const atk1 = attacks[0];
            const atk2 = attacks[1];

            const attackerCard1 = room.gameState.players[atk1.attackerPlayer].field[atk1.attackerRow][atk1.attackerCol];
            const attackerCard2 = room.gameState.players[atk2.attackerPlayer].field[atk2.attackerRow][atk2.attackerCol];

                if (attackerCard1 && attackerCard1.currentHp > 0 && attackerCard2 && attackerCard2.currentHp > 0) {
                    const damage1 = attackerCard1.atk;
                    const damage2 = attackerCard2.atk;

                    // Émettre une animation parallèle
                    emitAnimation(room, 'attack', {
                        combatType: 'parallel_attacks',
                        attack1: {
                            attacker: atk1.attackerPlayer,
                            row: atk1.attackerRow,
                            col: atk1.attackerCol,
                            targetPlayer: atk1.targetPlayer,
                            targetRow: atk1.targetRow,
                            targetCol: atk1.targetIsHero ? -1 : atk1.targetCol,
                            damage: damage1,
                            isShooter: atk1.isShooter,
                            isFlying: atk1.isFlying
                        },
                        attack2: {
                            attacker: atk2.attackerPlayer,
                            row: atk2.attackerRow,
                            col: atk2.attackerCol,
                            targetPlayer: atk2.targetPlayer,
                            targetRow: atk2.targetRow,
                            targetCol: atk2.targetIsHero ? -1 : atk2.targetCol,
                            damage: damage2,
                            isShooter: atk2.isShooter,
                            isFlying: atk2.isFlying
                        }
                    });
                    await sleep(800); // Attendre les animations parallèles

                    // Appliquer les dégâts pour atk1
                    if (atk1.targetIsHero) {
                        const targetPlayer1 = room.gameState.players[atk1.targetPlayer];
                        targetPlayer1.hp -= damage1;
                        log(`⚔️ ${attackerCard1.name} → ${targetPlayer1.heroName} (-${damage1})`, 'damage');
                        io.to(room.code).emit('directDamage', { defender: atk1.targetPlayer, damage: damage1 });

                        // Capacité spéciale: piocher une carte quand attaque un héros
                        if (attackerCard1.onHeroHit === 'draw') {
                            await drawCards(room, atk1.attackerPlayer, 1, log, sleep, `${attackerCard1.name} (onHeroHit)`);
                        }
                    } else {
                        const targetCard1 = room.gameState.players[atk1.targetPlayer].field[atk1.targetRow][atk1.targetCol];
                        if (targetCard1) {
                            const actualDmg1p = applyCreatureDamage(targetCard1, damage1, room, log, atk1.targetPlayer, atk1.targetRow, atk1.targetCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: attackerCard1.uid });
                            if (actualDmg1p > 0) log(`⚔️ ${attackerCard1.name} → ${targetCard1.name} (-${damage1})`, 'damage');
                            if (actualDmg1p > 0 && targetCard1.currentHp > 0 && targetCard1.abilities.includes('power')) {
                                const powerBonus = targetCard1.powerX || 1;
                                targetCard1.atk += powerBonus;
                                log(`💪 ${targetCard1.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                            // Riposte pour atk1 (toutes les créatures ripostent sauf si attaquées par un tireur)
                            if (!atk1.isShooter) {
                                const riposteDmg = targetCard1.atk;
                                const actualRip1 = applyCreatureDamage(attackerCard1, riposteDmg, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk1.targetPlayer, row: atk1.targetRow, col: atk1.targetCol, uid: targetCard1.uid });
                                if (actualRip1 > 0) {
                                    log(`↩️ ${targetCard1.name} riposte → ${attackerCard1.name} (-${riposteDmg})`, 'damage');
                                    emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: riposteDmg });
                                }
                                if (actualRip1 > 0 && attackerCard1.currentHp > 0 && attackerCard1.abilities.includes('power')) {
                                    const powerBonus = attackerCard1.powerX || 1;
                                    attackerCard1.atk += powerBonus;
                                    log(`💪 ${attackerCard1.name} gagne +${powerBonus} ATK!`, 'buff');
                                }
                            }
                            // Piétinement (attaque unilatérale)
                            await applyTrampleDamage(room, atk1, log, sleep);
                        }
                    }

                    // Appliquer les dégâts pour atk2
                    if (atk2.targetIsHero) {
                        const targetPlayer2 = room.gameState.players[atk2.targetPlayer];
                        targetPlayer2.hp -= damage2;
                        log(`⚔️ ${attackerCard2.name} → ${targetPlayer2.heroName} (-${damage2})`, 'damage');
                        io.to(room.code).emit('directDamage', { defender: atk2.targetPlayer, damage: damage2 });

                        // Capacité spéciale: piocher une carte quand attaque un héros
                        if (attackerCard2.onHeroHit === 'draw') {
                            await drawCards(room, atk2.attackerPlayer, 1, log, sleep, `${attackerCard2.name} (onHeroHit)`);
                        }
                    } else {
                        const targetCard2 = room.gameState.players[atk2.targetPlayer].field[atk2.targetRow][atk2.targetCol];
                        if (targetCard2) {
                            const actualDmg2p = applyCreatureDamage(targetCard2, damage2, room, log, atk2.targetPlayer, atk2.targetRow, atk2.targetCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: attackerCard2.uid });
                            if (actualDmg2p > 0) log(`⚔️ ${attackerCard2.name} → ${targetCard2.name} (-${damage2})`, 'damage');
                            if (actualDmg2p > 0 && targetCard2.currentHp > 0 && targetCard2.abilities.includes('power')) {
                                const powerBonus = targetCard2.powerX || 1;
                                targetCard2.atk += powerBonus;
                                log(`💪 ${targetCard2.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                            // Riposte pour atk2 (toutes les créatures ripostent sauf si attaquées par un tireur)
                            if (!atk2.isShooter) {
                                const riposteDmg = targetCard2.atk;
                                const actualRip2 = applyCreatureDamage(attackerCard2, riposteDmg, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk2.targetPlayer, row: atk2.targetRow, col: atk2.targetCol, uid: targetCard2.uid });
                                if (actualRip2 > 0) {
                                    log(`↩️ ${targetCard2.name} riposte → ${attackerCard2.name} (-${riposteDmg})`, 'damage');
                                    emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: riposteDmg });
                                }
                                if (actualRip2 > 0 && attackerCard2.currentHp > 0 && attackerCard2.abilities.includes('power')) {
                                    const powerBonus = attackerCard2.powerX || 1;
                                    attackerCard2.atk += powerBonus;
                                    log(`💪 ${attackerCard2.name} gagne +${powerBonus} ATK!`, 'buff');
                                }
                            }
                            // Piétinement (attaque unilatérale)
                            await applyTrampleDamage(room, atk2, log, sleep);
                        }
                    }

                    // Vérifier victoire
                    if (room.gameState.players[1].hp <= 0 || room.gameState.players[2].hp <= 0) {
                        emitStateToBoth(room);
                        return true;
                    }

                    // Sauter le traitement séquentiel
                    emitStateToBoth(room);
                    await sleep(500);

                    // Collecter toutes les créatures mortes
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

                    // Envoyer toutes les animations de mort EN MÊME TEMPS
                    if (deaths.length > 0) {
                        const normalDeaths = [];
                        for (const d of deaths) {
                            const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
                            if (result.transformed) {
                                emitAnimation(room, 'deathTransform', { player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
                            } else {
                                log(`☠️ ${d.card.name} détruit!`, 'damage');
                                emitAnimation(room, 'death', { player: d.player, row: d.row, col: d.col, card: d.card });
                                normalDeaths.push(d);
                            }
                        }
                        await sleep(1100);
                        emitStateToBoth(room);
                        // Capacités onDeath (seulement pour les morts normales)
                        for (const d of normalDeaths) {
                            await processOnDeathAbility(room, d.card, d.player, log, sleep);
                        }
                    }
                    return false;
                }
        }

        // Traitement séquentiel standard (1 attaque)
        for (const atk of attacks) {
            // Vérifier si l'attaquant est encore en vie
            const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
            if (!attackerCard || attackerCard.currentHp <= 0) continue;

            if (atk.targetIsHero) {
                // Attaque le héros - émettre l'animation avec les dégâts
                const targetPlayer = room.gameState.players[atk.targetPlayer];
                const damage = attackerCard.atk;

                // Animation d'attaque (tireur = projectile, sinon = charge)
                emitAnimation(room, 'attack', {
                    combatType: atk.isShooter ? 'shooter' : 'solo',
                    attacker: atk.attackerPlayer,
                    row: atk.attackerRow,
                    col: atk.attackerCol,
                    targetPlayer: atk.targetPlayer,
                    targetRow: atk.targetRow,
                    targetCol: -1,
                    damage: damage,
                    isFlying: atk.isFlying,
                    isShooter: atk.isShooter
                });
                await sleep(800); // Attendre la fin de l'animation d'attaque

                targetPlayer.hp -= damage;
                targetPlayer.heroAttackedThisTurn = true;
                log(`⚔️ ${attackerCard.name} → ${targetPlayer.heroName} (-${damage})`, 'damage');
                // L'animation d'attaque affiche déjà les dégâts, pas besoin de heroHit en plus
                io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: damage });

                // Capacité spéciale: bonus ATK quand attaque un héros (Salamandre de braise)
                if (attackerCard.onHeroAttack && attackerCard.onHeroAttack.atkBoost) {
                    const boost = attackerCard.onHeroAttack.atkBoost;
                    attackerCard.atk += boost;
                    log(`🔥 ${attackerCard.name} gagne +${boost} ATK!`, 'buff');
                    emitAnimation(room, 'atkBoost', {
                        player: atk.attackerPlayer,
                        row: atk.attackerRow,
                        col: atk.attackerCol,
                        boost: boost
                    });
                    await sleep(500);
                }

                // Capacité spéciale: piocher une carte quand attaque un héros
                if (attackerCard.onHeroHit === 'draw') {
                    await drawCards(room, atk.attackerPlayer, 1, log, sleep, `${attackerCard.name} (onHeroHit)`);
                }

                if (targetPlayer.hp <= 0) {
                    emitStateToBoth(room);
                    return true;
                }
            } else {
                // Attaque une créature
                const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
                if (!targetCard || targetCard.currentHp <= 0) continue;

                const damage = attackerCard.atk;

                // Animation d'attaque avec dégâts intégrés
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
                await sleep(800); // Attendre la fin de l'animation d'attaque

                const actualSeqDmg = applyCreatureDamage(targetCard, damage, room, log, atk.targetPlayer, atk.targetRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
                if (actualSeqDmg > 0) {
                    log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${actualSeqDmg})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: actualSeqDmg });
                }

                // Power pour la cible
                if (actualSeqDmg > 0 && targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                    const powerBonus = targetCard.powerX || 1;
                    targetCard.atk += powerBonus;
                    log(`💪 ${targetCard.name} gagne +${powerBonus} ATK!`, 'buff');
                }

                // RIPOSTE - toutes les créatures ripostent sauf si l'attaquant est un tireur
                if (!atk.isShooter) {
                    const riposteDmg = targetCard.atk;
                    const actualSeqRip = applyCreatureDamage(attackerCard, riposteDmg, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid });
                    if (actualSeqRip > 0) {
                        log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${actualSeqRip})`, 'damage');
                        emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: actualSeqRip });
                    }

                    if (actualSeqRip > 0 && attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                        const powerBonus = attackerCard.powerX || 1;
                        attackerCard.atk += powerBonus;
                        log(`💪 ${attackerCard.name} gagne +${powerBonus} ATK!`, 'buff');
                    }
                }

                // Piétinement (attaque unilatérale)
                await applyTrampleDamage(room, atk, log, sleep);
            }
        }
    }
    
    emitStateToBoth(room);
    await sleep(500); // Attendre que les animations de dégâts se terminent

    // Collecter toutes les créatures mortes DE TOUT LE TERRAIN
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

    // Envoyer toutes les animations de mort EN MÊME TEMPS
    if (deaths.length > 0) {
        const normalDeaths = [];
        for (const d of deaths) {
            const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
            if (result.transformed) {
                emitAnimation(room, 'deathTransform', { player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
            } else {
                log(`☠️ ${d.card.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: d.player, row: d.row, col: d.col, card: d.card });
                normalDeaths.push(d);
            }
        }
        await sleep(1100);
        emitStateToBoth(room);
        // Capacités onDeath (seulement pour les morts normales)
        for (const d of normalDeaths) {
            await processOnDeathAbility(room, d.card, d.player, log, sleep);
        }
    }

    return false;
}

// Traiter le combat pour une rangée entière
// ORDRE: Col 0 (back) d'abord, puis Col 1 (front)
// Dans chaque colonne, on résout les combats mutuels puis les attaques unilatérales
async function processCombatRow(room, row, log, sleep, checkVictory) {
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    const rowNames = ['A', 'B', 'C', 'D'];
    const allSlotsToCheck = [];

    // Traiter colonne par colonne: d'abord col 0 (back), puis col 1 (front)
    for (let col = 0; col < 2; col++) {
        // Collecter les attaques des créatures de cette colonne
        const attacks = [];

        // Créature du joueur 1 sur cette colonne
        const p1Card = p1State.field[row][col];
        if (p1Card && p1Card.canAttack && p1Card.currentHp > 0) {
            const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row, col);
            if (target) {
                attacks.push({
                    attacker: p1Card,
                    attackerPlayer: 1,
                    attackerRow: row,
                    attackerCol: col,
                    target: target.card,
                    targetPlayer: target.player,
                    targetRow: target.row,
                    targetCol: target.col,
                    targetIsHero: target.isHero,
                    hasTrample: p1Card.abilities.includes('trample'),
                    isShooter: p1Card.abilities.includes('shooter'),
                    isFlying: p1Card.abilities.includes('fly'),
                    processed: false
                });
            }
        }

        // Créature du joueur 2 sur cette colonne
        const p2Card = p2State.field[row][col];
        if (p2Card && p2Card.canAttack && p2Card.currentHp > 0) {
            const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row, col);
            if (target) {
                attacks.push({
                    attacker: p2Card,
                    attackerPlayer: 2,
                    attackerRow: row,
                    attackerCol: col,
                    target: target.card,
                    targetPlayer: target.player,
                    targetRow: target.row,
                    targetCol: target.col,
                    targetIsHero: target.isHero,
                    hasTrample: p2Card.abilities.includes('trample'),
                    isShooter: p2Card.abilities.includes('shooter'),
                    isFlying: p2Card.abilities.includes('fly'),
                    processed: false
                });
            }
        }

        if (attacks.length === 0) continue;

        // Interception des volants (uniquement entre volants de la même colonne)
        const p1Flying = attacks.find(a => a.attackerPlayer === 1 && a.isFlying);
        const p2Flying = attacks.find(a => a.attackerPlayer === 2 && a.isFlying);

        if (p1Flying && p2Flying) {
            // Les deux volants s'interceptent ! Modifier leurs cibles
            p1Flying.target = p2Flying.attacker;
            p1Flying.targetPlayer = p2Flying.attackerPlayer;
            p1Flying.targetRow = p2Flying.attackerRow;
            p1Flying.targetCol = p2Flying.attackerCol;
            p1Flying.targetIsHero = false;
            p1Flying.intercepted = true;

            p2Flying.target = p1Flying.attacker;
            p2Flying.targetPlayer = p1Flying.attackerPlayer;
            p2Flying.targetRow = p1Flying.attackerRow;
            p2Flying.targetCol = p1Flying.attackerCol;
            p2Flying.targetIsHero = false;
            p2Flying.intercepted = true;

            log(`🦅 ${p1Flying.attacker.name} et ${p2Flying.attacker.name} s'interceptent en vol!`, 'action');
        }

        // Animer les attaques de cette colonne
        for (const atk of attacks) {
            emitAnimation(room, 'attack', {
                attacker: atk.attackerPlayer,
                row: atk.attackerRow,
                col: atk.attackerCol,
                targetPlayer: atk.targetPlayer,
                targetRow: atk.targetRow,
                targetCol: atk.targetIsHero ? -1 : atk.targetCol,
                isFlying: atk.isFlying,
                isShooter: atk.isShooter
            });
        }
        await sleep(500);

        // Identifier les combats mutuels dans cette colonne
        // Combat mutuel = les deux créatures de la même colonne se ciblent mutuellement
        let mutualPair = null;
        if (attacks.length === 2) {
            const [atk1, atk2] = attacks;
            const atk1TargetsAtk2 = atk1.targetPlayer === atk2.attackerPlayer &&
                                   atk1.targetRow === atk2.attackerRow &&
                                   atk1.targetCol === atk2.attackerCol;
            const atk2TargetsAtk1 = atk2.targetPlayer === atk1.attackerPlayer &&
                                   atk2.targetRow === atk1.attackerRow &&
                                   atk2.targetCol === atk1.attackerCol;

            if (atk1TargetsAtk2 && atk2TargetsAtk1) {
                // Vérifier si c'est tireur vs non-tireur (pas de combat mutuel)
                if (atk1.isShooter === atk2.isShooter) {
                    mutualPair = [atk1, atk2];
                    atk1.processed = true;
                    atk2.processed = true;
                }
            }
        }

        // Traiter le combat mutuel s'il y en a un
        if (mutualPair) {
            const [atk1, atk2] = mutualPair;

            // Dégâts SIMULTANÉS
            const dmg1to2 = atk1.attacker.atk;
            const dmg2to1 = atk2.attacker.atk;

            const actualMR1 = applyCreatureDamage(atk2.attacker, dmg1to2, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualMR2 = applyCreatureDamage(atk1.attacker, dmg2to1, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });

            if (actualMR1 > 0 || actualMR2 > 0) {
                log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${actualMR1} / -${actualMR2})`, 'damage');
            }
            if (actualMR1 > 0) {
                emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: actualMR1 });
            }
            if (actualMR2 > 0) {
                emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: actualMR2 });
            }

            // Power bonus
            if (actualMR2 > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                atk1.attacker.pendingPowerBonus = (atk1.attacker.pendingPowerBonus || 0) + (atk1.attacker.powerX || 1);
            }
            if (actualMR1 > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                atk2.attacker.pendingPowerBonus = (atk2.attacker.pendingPowerBonus || 0) + (atk2.attacker.powerX || 1);
            }

            // Piétinement en combat mutuel - seulement si la cible est un tireur
            if (atk2.attacker.abilities.includes('shooter')) {
                await applyTrampleDamage(room, atk1, log, sleep);
            }
            if (atk1.attacker.abilities.includes('shooter')) {
                await applyTrampleDamage(room, atk2, log, sleep);
            }
        }

        // Traiter les attaques non-mutuelles (unilatérales)
        for (const atk of attacks) {
            if (atk.processed) continue;
            atk.processed = true;

            // Vérifier si l'attaquant est encore vivant
            const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
            if (!attackerCard || attackerCard.currentHp <= 0) continue;

            if (atk.targetIsHero) {
                room.gameState.players[atk.targetPlayer].hp -= attackerCard.atk;
                room.gameState.players[atk.targetPlayer].heroAttackedThisTurn = true;
                log(`⚔️ ${attackerCard.name} → ${room.gameState.players[atk.targetPlayer].heroName} (-${attackerCard.atk})`, 'damage');
                emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
                io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });

                // Capacité spéciale: bonus ATK quand attaque un héros (Salamandre de braise)
                if (attackerCard.onHeroAttack && attackerCard.onHeroAttack.atkBoost) {
                    const boost = attackerCard.onHeroAttack.atkBoost;
                    attackerCard.atk += boost;
                    log(`🔥 ${attackerCard.name} gagne +${boost} ATK!`, 'buff');
                    emitAnimation(room, 'atkBoost', {
                        player: atk.attackerPlayer,
                        row: atk.attackerRow,
                        col: atk.attackerCol,
                        boost: boost
                    });
                    await sleep(500);
                }

                if (attackerCard.onHeroHit === 'draw') {
                    await drawCards(room, atk.attackerPlayer, 1, log, sleep, `${attackerCard.name} (onHeroHit)`);
                }

                if (room.gameState.players[atk.targetPlayer].hp <= 0) {
                    applyPendingPowerBonuses(room, log);
                    emitStateToBoth(room);
                    return true;
                }
            } else {
                const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
                if (!targetCard) continue;

                const hpBeforeThisAttack = targetCard.currentHp;
                const damage = attackerCard.atk;
                const actualUniDmg = applyCreatureDamage(targetCard, damage, room, log, atk.targetPlayer, atk.targetRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
                if (actualUniDmg > 0) {
                    log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${actualUniDmg})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: actualUniDmg });
                }

                if (actualUniDmg > 0 && targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                    targetCard.pendingPowerBonus = (targetCard.pendingPowerBonus || 0) + (targetCard.powerX || 1);
                }

                await applyTrampleDamage(room, atk, log, sleep);

                // RIPOSTE si la cible était vivante et que l'attaquant n'est pas un tireur
                const targetWasAlive = hpBeforeThisAttack > 0;

                if (targetWasAlive && !atk.isShooter) {
                    const riposteDamage = targetCard.atk;
                    const actualUniRip = applyCreatureDamage(attackerCard, riposteDamage, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid });
                    if (actualUniRip > 0) {
                        log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${actualUniRip})`, 'damage');
                        emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: actualUniRip });
                    }

                    if (actualUniRip > 0 && attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                        attackerCard.pendingPowerBonus = (attackerCard.pendingPowerBonus || 0) + (attackerCard.powerX || 1);
                    }
                }
            }
        }

        // Collecter les slots à vérifier pour les morts
        for (const atk of attacks) {
            allSlotsToCheck.push([atk.attackerRow, atk.attackerCol]);
            if (!atk.targetIsHero) {
                allSlotsToCheck.push([atk.targetRow, atk.targetCol]);
            }
        }

        // Appliquer les bonus Power après chaque colonne
        applyPendingPowerBonuses(room, log);
        emitStateToBoth(room);
        await sleep(300);

        // Retirer les créatures mortes après chaque colonne (important pour col 1 qui suit)
        await checkAndRemoveDeadCreatures(room, allSlotsToCheck, log, sleep);
    }

    // Vérifier victoire
    if (checkVictory && checkVictory()) {
        return true;
    }

    return false;
}

// Helper pour appliquer les dégâts de piétinement
async function applyTrampleDamage(room, atk, log, sleep) {
    if (!atk.hasTrample) return;
    
    const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow]?.[atk.targetCol];
    if (!targetCard || targetCard.currentHp >= 0) return;
    
    const excessDamage = Math.abs(targetCard.currentHp);
    const targetOwner = room.gameState.players[atk.targetPlayer];
    
    let trampleTarget = null;
    let trampleCol = -1;
    if (atk.targetCol === 1) {
        trampleTarget = targetOwner.field[atk.targetRow][0];
        trampleCol = 0;
    }
    
    const attackerIsFlying = atk.attacker.abilities.includes('fly');
    const attackerIsShooter = atk.isShooter;

    // Un volant ne peut pas toucher une créature normale avec le piétinement
    // Il ne peut toucher que les volants/tireurs, sinon ça va au héros
    if (trampleTarget && attackerIsFlying && !attackerIsShooter) {
        const trampleTargetIsFlying = trampleTarget.abilities.includes('fly');
        const trampleTargetIsShooter = trampleTarget.abilities.includes('shooter');
        if (!trampleTargetIsFlying && !trampleTargetIsShooter) {
            trampleTarget = null; // Le volant passe au-dessus, dégâts au héros
        }
    }

    // Inversement, un non-volant/non-tireur ne peut pas toucher un volant
    if (trampleTarget && trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
        trampleTarget = null;
    }
    
    if (trampleTarget) {
        const actualTrDmg = applyCreatureDamage(trampleTarget, excessDamage, room, log, atk.targetPlayer, atk.targetRow, trampleCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: atk.attacker.uid });
        if (actualTrDmg > 0) {
            log(`🦏 Piétinement: ${atk.attacker.name} → ${trampleTarget.name} (-${actualTrDmg})`, 'damage');
            emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: trampleCol, amount: actualTrDmg });
        }

        if (actualTrDmg > 0 && trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
            trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + (trampleTarget.powerX || 1);
        }
    } else if (excessDamage > 0 && !trampleTarget) {
        targetOwner.hp -= excessDamage;
        targetOwner.heroAttackedThisTurn = true;
        log(`🦏 Piétinement: ${atk.attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
        emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: excessDamage });
        io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: excessDamage });
    }
}

// Trouver la cible d'une créature
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
    // L'interception symétrique (A1↔A2, B1↔B2) ne se produit qu'entre VOLANTS qui peuvent tous deux attaquer
    // Les tireurs ne "volent" pas vers l'ennemi, donc pas d'interception avec eux
    // Mais le volant peut quand même attaquer un tireur (première cible valide)
    if (isFlying) {
        // D'abord vérifier l'interception symétrique (même colonne) - UNIQUEMENT avec d'autres VOLANTS
        if (attackerCol === 0) {
            // Volant en back (col 0) -> vérifie back ennemi pour interception (seulement si volant)
            if (effectiveBack && backIsFlying && backCanAttack) {
                return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
            }
        } else {
            // Volant en front (col 1) -> vérifie front ennemi pour interception (seulement si volant)
            if (effectiveFront && frontIsFlying && frontCanAttack) {
                return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
            }
        }

        // Pas d'interception symétrique -> attaque la première cible valide (volant OU tireur)
        // Front d'abord (col 1), puis back (col 0)
        if (effectiveFront && (frontIsFlying || frontIsShooter)) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (effectiveBack && (backIsFlying || backIsShooter)) {
            return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }

        // Sinon attaque le héros (passe au-dessus des normales)
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }
    
    // CAS 2: Créature TIREUR
    // Peut attaquer n'importe quelle créature y compris volante
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
    // - N'est PAS bloquée par les créatures volantes
    // - Attaque front (col 1) s'il n'est pas volant
    // - Sinon attaque back (col 0) s'il n'est pas volant
    // - Sinon attaque le héros (passe à travers les volantes)
    
    // Front non-volant existe -> attaque front
    if (effectiveFront && !frontIsFlying) {
        return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
    }
    // Back non-volant existe -> attaque back
    if (effectiveBack && !backIsFlying) {
        return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
    }
    
    // Que des volants ou rien -> attaque héros
    return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
}

async function processCombat(room, attackerPlayer, row, col, log, sleep) {
    // Cette fonction n'est plus utilisée - gardée pour compatibilité
}

function startNewTurn(room) {
    room.gameState.turn++;
    room.gameState.phase = 'planning';
    room.gameState.timeLeft = TURN_TIME;
    
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        player.maxEnergy = Math.min(10, player.maxEnergy + 1);
        player.energy = player.maxEnergy;
        resetPlayerForNewTurn(player);
    }
    
    // Envoyer l'état AVANT newTurn pour que le client ait les données à jour
    emitStateToBoth(room);
    
    io.to(room.code).emit('newTurn', { 
        turn: room.gameState.turn, 
        maxEnergy: room.gameState.players[1].maxEnergy 
    });
    
    startTurnTimer(room);
}

function canPlaceAt(card, col) {
    const shooter = card.abilities?.includes('shooter');
    const fly = card.abilities?.includes('fly');
    if (fly) return true;
    if (shooter) return col === 0;
    return col === 1;
}

// ==================== SOCKET HANDLERS ====================
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    
    socket.on('createRoom', (callback) => {
        const code = generateRoomCode();
        const room = { code, players: { 1: socket.id, 2: null }, gameState: createGameState(), timer: null };
        room.gameState.players[1].connected = true;
        
        resetPlayerForNewTurn(room.gameState.players[1]);
        resetPlayerForNewTurn(room.gameState.players[2]);
        
        rooms.set(code, room);
        playerRooms.set(socket.id, { code, playerNum: 1 });
        socket.join(code);
        callback({ success: true, code, playerNum: 1 });
        console.log(`Room ${code} created`);
    });
    
    socket.on('joinRoom', (code, callback) => {
        const room = rooms.get(code.toUpperCase());
        if (!room) { callback({ success: false, error: 'Partie introuvable' }); return; }
        if (room.players[2]) { callback({ success: false, error: 'Partie complète' }); return; }
        
        room.players[2] = socket.id;
        room.gameState.players[2].connected = true;
        playerRooms.set(socket.id, { code: room.code, playerNum: 2 });
        socket.join(room.code);
        callback({ success: true, code: room.code, playerNum: 2 });
        
        // Envoyer l'état en phase mulligan
        io.to(room.players[1]).emit('gameStart', getPublicGameState(room, 1));
        io.to(room.players[2]).emit('gameStart', getPublicGameState(room, 2));
        
        console.log(`Room ${room.code} started - Mulligan phase`);
    });
    
    // Garder la main actuelle
    socket.on('keepHand', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'mulligan') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.mulliganDone) return;
        
        player.mulliganDone = true;
        console.log(`Player ${info.playerNum} kept hand`);
        
        checkMulliganComplete(room);
    });
    
    // Faire un mulligan (repiocher 7 nouvelles cartes)
    socket.on('mulligan', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'mulligan') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.mulliganDone) return;
        
        // Remettre la main dans le deck
        player.deck.push(...player.hand);
        player.hand = [];
        
        // Mélanger le deck
        player.deck.sort(() => Math.random() - 0.5);
        
        // Piocher 7 nouvelles cartes
        player.hand = player.deck.splice(0, 7);
        
        player.mulliganDone = true;
        console.log(`Player ${info.playerNum} mulliganed`);
        
        // Envoyer le nouvel état au joueur
        emitStateToPlayer(room, info.playerNum);
        
        checkMulliganComplete(room);
    });
    
    function checkMulliganComplete(room) {
        const p1Done = room.gameState.players[1].mulliganDone;
        const p2Done = room.gameState.players[2].mulliganDone;
        
        if (p1Done && p2Done) {
            // Les deux ont fait leur choix, commencer la partie
            room.gameState.phase = 'planning';
            emitStateToBoth(room);
            startTurnTimer(room);
            console.log(`Room ${room.code} - Mulligan complete, game starting`);
        }
    }
    
    socket.on('placeCard', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { handIndex, row, col } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const card = player.hand[handIndex];
        if (!card || card.type !== 'creature' || card.cost > player.energy) return;
        if (player.field[row][col]) return;
        if (!canPlaceAt(card, col)) return;

        // Vérification des conditions d'invocation spéciales
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (player.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) return;
        }
        
        player.energy -= card.cost;
        const placed = { 
            ...card, 
            turnsOnField: 0, 
            canAttack: card.abilities?.includes('haste'), 
            currentHp: card.hp, 
            movedThisTurn: false 
        };
        player.field[row][col] = placed;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ type: 'place', card: deepClone(placed), row, col });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('moveCard', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready || player.inDeployPhase) return;
        
        const { fromRow, fromCol, toRow, toCol } = data;
        const card = player.field[fromRow][fromCol];
        if (!card || card.movedThisTurn) return;
        if (card.abilities?.includes('immovable')) return;
        if (player.field[toRow][toCol]) return;
        
        const isFlying = card.abilities?.includes('fly');
        const isVerticalMove = (fromCol === toCol && Math.abs(toRow - fromRow) === 1);
        const isHorizontalMove = (fromRow === toRow && fromCol !== toCol);
        
        // Déplacement vertical: toutes les créatures
        // Déplacement horizontal: seulement les volants
        if (!isVerticalMove && !(isFlying && isHorizontalMove)) return;
        
        if (!canPlaceAt(card, toCol)) return;
        
        card.movedThisTurn = true;
        // Redéploiement = comme si la créature venait d'être posée
        // Elle ne peut plus attaquer sauf si elle a célérité
        if (!card.abilities?.includes('haste')) {
            card.canAttack = false;
            card.turnsOnField = 0;
        }
        player.field[toRow][toCol] = card;
        player.field[fromRow][fromCol] = null;
        
        player.pendingActions.push({ type: 'move', card: deepClone(card), fromRow, fromCol, toRow, toCol });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('castSpell', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { idx, targetPlayer, row, col } = data;
        const handIndex = idx !== undefined ? idx : data.handIndex;
        
        if (handIndex === undefined || handIndex < 0 || handIndex >= player.hand.length) return;
        
        const spell = player.hand[handIndex];
        if (!spell || spell.type !== 'spell') return;

        // Calculer le coût effectif (réduction Hyrule pour le 2ème sort)
        let effectiveCost = spell.cost;
        if (player.hero && player.hero.id === 'hyrule' && player.spellsCastThisTurn === 1) {
            effectiveCost = Math.max(0, spell.cost - 1);
        }

        if (effectiveCost > player.energy) return;

        // Validation des coordonnées
        // row = -1 signifie qu'on cible un héros
        if (row === -1) {
            // Vérifier que le sort peut cibler un héros
            if (spell.pattern !== 'hero' && !spell.canTargetHero) return;

            // Vérifier les restrictions targetEnemy / targetSelf
            const isTargetingSelf = targetPlayer === info.playerNum;
            if (spell.targetEnemy && isTargetingSelf) return; // Frappe directe = adversaire seulement
            if (spell.targetSelf && !isTargetingSelf) return; // Cristal de mana = soi-même seulement
        } else {
            // Sort ciblé normal sur une créature
            if (row < 0 || row > 3 || col < 0 || col > 1) return;
        }

        player.energy -= effectiveCost;
        player.spellsCastThisTurn++;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ 
            type: 'spell', 
            spell: deepClone(spell), 
            targetPlayer, 
            row, 
            col,
            heroName: player.heroName,
            playerNum: info.playerNum
        });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    // Sorts globaux (sans ciblage - drop sur la bordure du board)
    socket.on('castGlobalSpell', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { handIndex } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const spell = player.hand[handIndex];
        if (!spell || spell.type !== 'spell') return;

        // Calculer le coût effectif (réduction Hyrule pour le 2ème sort)
        let effectiveCost = spell.cost;
        if (player.hero && player.hero.id === 'hyrule' && player.spellsCastThisTurn === 1) {
            effectiveCost = Math.max(0, spell.cost - 1);
        }

        if (effectiveCost > player.energy) return;

        // Vérifier que c'est un sort global (global, all, hero)
        if (!['global', 'all', 'hero'].includes(spell.pattern)) return;

        player.energy -= effectiveCost;
        player.spellsCastThisTurn++;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;

        player.pendingActions.push({ type: 'spell', spell: deepClone(spell), targetPlayer: info.playerNum === 1 ? 2 : 1, row: -1, col: -1 });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('placeTrap', (data) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        
        const player = room.gameState.players[info.playerNum];
        if (player.ready) return;
        
        const { handIndex, trapIndex } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const trap = player.hand[handIndex];
        if (!trap || trap.type !== 'trap' || trap.cost > player.energy) return;
        if (player.traps[trapIndex]) return;
        
        player.energy -= trap.cost;
        player.traps[trapIndex] = trap;
        player.trapCards[trapIndex] = deepClone(trap); // Stocker la carte pour l'affichage
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ type: 'trap', trap: deepClone(trap), row: trapIndex });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('ready', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        if (room.gameState.players[info.playerNum].ready) return;
        
        room.gameState.players[info.playerNum].ready = true;
        io.to(room.code).emit('playerReady', info.playerNum);
        
        checkBothReady(room);
    });
    
    socket.on('surrender', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room) return;
        
        const winner = info.playerNum === 1 ? 2 : 1;
        
        io.to(room.code).emit('gameOver', { winner: winner, surrender: true });
    });
    
    socket.on('disconnect', () => {
        const info = playerRooms.get(socket.id);
        if (info) {
            const room = rooms.get(info.code);
            if (room) {
                room.gameState.players[info.playerNum].connected = false;
                io.to(room.code).emit('playerDisconnected', info.playerNum);
                setTimeout(() => {
                    if (room && !room.gameState.players[info.playerNum].connected) {
                        if (room.timer) clearInterval(room.timer);
                        rooms.delete(info.code);
                    }
                }, 60000);
            }
            playerRooms.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Server on http://localhost:${PORT}`));