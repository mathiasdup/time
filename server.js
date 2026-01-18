// ==================== BATAILLE DES HÉROS - SERVER ====================
// Serveur propre et modulaire

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Import des modules de jeu
const {
    createGameState,
    findTarget, processAllCombat, processFlyingInterceptions,
    processOnDeathAbility
} = require('./game');
const { processTrapsForRow } = require('./game/traps');
const { applySpell } = require('./game/spells');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// ==================== ÉTAT DU JEU ====================
const rooms = new Map();
const playerRooms = new Map();
const TURN_TIME = 90;

// ==================== UTILITAIRES ====================

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

// ==================== ENVOI D'ÉTAT ====================

function getPublicGameState(room, forPlayer) {
    const state = room.gameState;
    const opponent = forPlayer === 1 ? 2 : 1;
    const me = state.players[forPlayer];
    const opp = state.players[opponent];
    const isPlanning = state.phase === 'planning';

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
            trapCards: me.trapCards,
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
            field: isPlanning && opp.confirmedField ? opp.confirmedField : opp.field,
            traps: isPlanning && opp.confirmedTraps ? opp.confirmedTraps : opp.traps,
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

function emitAnimationBatch(room, animations) {
    io.to(room.code).emit('animationBatch', animations);
}

// ==================== GESTION DU TOUR ====================

function startTurnTimer(room) {
    if (room.timer) clearInterval(room.timer);
    room.gameState.timeLeft = TURN_TIME;

    room.timer = setInterval(() => {
        room.gameState.timeLeft--;
        io.to(room.code).emit('timeUpdate', room.gameState.timeLeft);

        if (room.gameState.timeLeft <= 0) {
            // Forcer ready pour les deux joueurs
            room.gameState.players[1].ready = true;
            room.gameState.players[2].ready = true;
            checkBothReady(room);
        }
    }, 1000);
}

function checkBothReady(room) {
    if (room.gameState.players[1].ready && room.gameState.players[2].ready) {
        if (room.timer) clearInterval(room.timer);
        startResolution(room);
    }
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

    emitStateToBoth(room);
    io.to(room.code).emit('newTurn', {
        turn: room.gameState.turn,
        maxEnergy: room.gameState.players[1].maxEnergy
    });
    startTurnTimer(room);
}

// ==================== CIBLES CROIX ====================

function getCrossTargets(targetPlayer, row, col) {
    const targets = [];
    const adjacent = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of adjacent) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < 4 && nc >= 0 && nc < 2) {
            targets.push({ row: nr, col: nc, player: targetPlayer });
        }
    }
    return targets;
}

// ==================== HELPERS POUR LES MODULES ====================

function createHelpers(room) {
    const logs = [];
    const log = (msg, type) => {
        logs.push({ msg, type });
        console.log(`[${room.code}] ${msg}`);
    };
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    return {
        log,
        sleep,
        emitAnimation: (r, type, data) => emitAnimation(r, type, data),
        emitStateToBoth: (r) => emitStateToBoth(r),
        emitAnimationBatch: (r, anims) => emitAnimationBatch(r, anims),
        io,
        findTarget,
        getCrossTargets,
        processOnDeathAbility: async (r, card, player) => {
            await processOnDeathAbility(r, card, player, log, sleep, io);
        },
        getLogs: () => logs
    };
}

// ==================== RÉSOLUTION DU TOUR ====================

async function startResolution(room) {
    room.gameState.phase = 'resolution';
    emitStateToBoth(room);
    io.to(room.code).emit('phaseChange', 'resolution');

    const helpers = createHelpers(room);
    helpers.log('=== RÉSOLUTION ===', 'system');

    // 1. Piocher une carte par joueur
    await drawPhase(room, helpers);

    // 2. Activer les créatures
    activateCreatures(room);

    // 3. Appliquer les actions (sorts)
    await applyAllActions(room, helpers);

    // 4. Vérifier victoire après les sorts
    if (checkVictory(room)) return;

    // 5. Pièges
    for (let row = 0; row < 4; row++) {
        await processTrapsForRow(room, row, helpers);
    }

    // 6. Interceptions volantes
    await processFlyingInterceptions(room, helpers);
    if (checkVictory(room)) return;

    // 7. Combat principal
    const heroKilled = await processAllCombat(room, helpers);
    if (heroKilled || checkVictory(room)) return;

    // 8. Zdejebel (blessure de fin de tour)
    await processZdejebelAbility(room, helpers);
    if (checkVictory(room)) return;

    // 9. Nouveau tour
    startNewTurn(room);
}

// ==================== PHASES DE RÉSOLUTION ====================

async function drawPhase(room, helpers) {
    const { log, sleep, emitAnimation } = helpers;
    const drawAnimations = [];

    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        if (player.deck.length > 0 && player.hand.length < 9) {
            const card = player.deck.shift();
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
            }
            player.hand.push(card);
            drawAnimations.push({ player: p, card, handIndex: player.hand.length - 1 });
            log(`🎴 ${player.heroName} pioche ${card.name}`, 'action');
        }
    }

    if (drawAnimations.length > 0) {
        emitAnimation(room, 'draw', { cards: drawAnimations });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(800);
    }
}

function activateCreatures(room) {
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) {
                    card.turnsOnField++;
                    card.hasIntercepted = false;
                    // Activer si pas déjà actif
                    if (!card.canAttack && card.turnsOnField > 0) {
                        card.canAttack = true;
                    }
                }
            }
        }
    }
}

async function applyAllActions(room, helpers) {
    const { sleep } = helpers;

    // Collecter toutes les actions des deux joueurs
    const allActions = [];
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (const action of player.pendingActions) {
            if (action.type === 'spell') {
                allActions.push({ ...action, playerNum: p, heroName: player.heroName });
            }
        }
        player.pendingActions = [];
    }

    // Appliquer les sorts dans l'ordre
    for (const action of allActions) {
        await applySpell(room, action, helpers);
        await sleep(300);
    }
}

async function processZdejebelAbility(room, helpers) {
    const { log, sleep, io } = helpers;

    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        if (player.hero?.id === 'zdejebel') {
            const opponent = room.gameState.players[p === 1 ? 2 : 1];
            if (opponent.heroAttackedThisTurn) {
                opponent.hp -= 1;
                log(`🩸 Zdejebel inflige 1 blessure au héros adverse!`, 'damage');
                emitAnimation(room, 'slash', { defender: p === 1 ? 2 : 1, damage: 1 });
                io.to(room.code).emit('directDamage', { defender: p === 1 ? 2 : 1, damage: 1 });
                await sleep(600);
            }
        }
    }
}

function checkVictory(room) {
    const p1Hp = room.gameState.players[1].hp;
    const p2Hp = room.gameState.players[2].hp;

    if (p1Hp <= 0 || p2Hp <= 0) {
        let winner = null;
        if (p1Hp <= 0 && p2Hp <= 0) {
            winner = 0; // Égalité
        } else if (p1Hp <= 0) {
            winner = 2;
        } else {
            winner = 1;
        }

        if (room.timer) clearInterval(room.timer);
        room.gameState.phase = 'gameover';
        io.to(room.code).emit('gameOver', { winner });
        return true;
    }
    return false;
}

// ==================== VALIDATION PLACEMENT ====================

function canPlaceCardAt(card, col) {
    const isShooter = card.abilities?.includes('shooter');
    const isFlying = card.abilities?.includes('fly');
    if (isFlying) return true;
    if (isShooter) return col === 0;
    return col === 1;
}

// ==================== SOCKET HANDLERS ====================

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    // Création de room
    socket.on('createRoom', (callback) => {
        const code = generateRoomCode();
        const room = {
            code,
            players: { 1: socket.id, 2: null },
            gameState: createGameState(),
            timer: null
        };
        room.gameState.players[1].connected = true;
        resetPlayerForNewTurn(room.gameState.players[1]);
        resetPlayerForNewTurn(room.gameState.players[2]);

        rooms.set(code, room);
        playerRooms.set(socket.id, { code, playerNum: 1 });
        socket.join(code);
        callback({ success: true, code, playerNum: 1 });
        console.log(`Room ${code} created`);
    });

    // Rejoindre une room
    socket.on('joinRoom', (code, callback) => {
        const room = rooms.get(code.toUpperCase());
        if (!room) { callback({ success: false, error: 'Partie introuvable' }); return; }
        if (room.players[2]) { callback({ success: false, error: 'Partie complète' }); return; }

        room.players[2] = socket.id;
        room.gameState.players[2].connected = true;
        playerRooms.set(socket.id, { code: room.code, playerNum: 2 });
        socket.join(room.code);
        callback({ success: true, code: room.code, playerNum: 2 });

        io.to(room.players[1]).emit('gameStart', getPublicGameState(room, 1));
        io.to(room.players[2]).emit('gameStart', getPublicGameState(room, 2));
        console.log(`Room ${room.code} started - Mulligan phase`);
    });

    // Mulligan
    socket.on('keepHand', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'mulligan') return;

        const player = room.gameState.players[info.playerNum];
        if (player.mulliganDone) return;

        player.mulliganDone = true;
        checkMulliganComplete(room);
    });

    socket.on('mulligan', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'mulligan') return;

        const player = room.gameState.players[info.playerNum];
        if (player.mulliganDone) return;

        player.deck.push(...player.hand);
        player.hand = [];
        player.deck.sort(() => Math.random() - 0.5);
        player.hand = player.deck.splice(0, 7);
        player.mulliganDone = true;

        emitStateToPlayer(room, info.playerNum);
        checkMulliganComplete(room);
    });

    function checkMulliganComplete(room) {
        console.log(`[${room.code}] Checking mulligan: P1=${room.gameState.players[1].mulliganDone}, P2=${room.gameState.players[2].mulliganDone}`);
        if (room.gameState.players[1].mulliganDone && room.gameState.players[2].mulliganDone) {
            console.log(`[${room.code}] Mulligan complete, starting game!`);
            room.gameState.phase = 'planning';
            emitStateToBoth(room);
            startTurnTimer(room);
        }
    }

    // Placement de créature
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
        if (!canPlaceCardAt(card, col)) return;

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

    // Déplacement de créature
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
        if (player.field[toRow][toCol]) return;

        const isFlying = card.abilities?.includes('fly');
        const isVerticalMove = (fromCol === toCol && Math.abs(toRow - fromRow) === 1);
        const isHorizontalMove = (fromRow === toRow && fromCol !== toCol);

        if (!isVerticalMove && !(isFlying && isHorizontalMove)) return;
        if (!canPlaceCardAt(card, toCol)) return;

        card.movedThisTurn = true;
        if (!card.abilities?.includes('haste')) {
            card.canAttack = false;
            card.turnsOnField = 0;
        }
        player.field[toRow][toCol] = card;
        player.field[fromRow][fromCol] = null;
        player.pendingActions.push({ type: 'move', card: deepClone(card), fromRow, fromCol, toRow, toCol });

        emitStateToPlayer(room, info.playerNum);
    });

    // Lancer un sort
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

        let effectiveCost = spell.cost;
        if (player.hero?.id === 'hyrule' && player.spellsCastThisTurn === 1) {
            effectiveCost = Math.max(0, spell.cost - 1);
        }
        if (effectiveCost > player.energy) return;

        if (row === -1) {
            if (spell.pattern !== 'hero' && !spell.canTargetHero) return;
            const isTargetingSelf = targetPlayer === info.playerNum;
            if (spell.targetEnemy && isTargetingSelf) return;
            if (spell.targetSelf && !isTargetingSelf) return;
        } else {
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

    // Sort global
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

        let effectiveCost = spell.cost;
        if (player.hero?.id === 'hyrule' && player.spellsCastThisTurn === 1) {
            effectiveCost = Math.max(0, spell.cost - 1);
        }
        if (effectiveCost > player.energy) return;
        if (!['global', 'all', 'hero'].includes(spell.pattern)) return;

        player.energy -= effectiveCost;
        player.spellsCastThisTurn++;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;

        player.pendingActions.push({
            type: 'spell',
            spell: deepClone(spell),
            targetPlayer: info.playerNum === 1 ? 2 : 1,
            row: -1,
            col: -1,
            heroName: player.heroName,
            playerNum: info.playerNum
        });

        emitStateToPlayer(room, info.playerNum);
    });

    // Poser un piège
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
        player.trapCards[trapIndex] = deepClone(trap);
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        player.pendingActions.push({ type: 'trap', trap: deepClone(trap), row: trapIndex });

        emitStateToPlayer(room, info.playerNum);
    });

    // Prêt
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

    // Abandon
    socket.on('surrender', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room) return;

        const winner = info.playerNum === 1 ? 2 : 1;
        io.to(room.code).emit('gameOver', { winner, surrender: true });
    });

    // Déconnexion
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

// ==================== DÉMARRAGE ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Server on http://localhost:${PORT}`));
