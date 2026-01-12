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
            heroName: me.heroName
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
            heroName: opp.heroName
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
    
    // Fonction pour vérifier la victoire
    const checkVictory = () => {
        const p1hp = room.gameState.players[1].hp;
        const p2hp = room.gameState.players[2].hp;
        if (p1hp <= 0 || p2hp <= 0) {
            return p1hp <= 0 ? 2 : 1;
        }
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
    
    // Collecter les slots qui vont recevoir des créatures
    const summonSlots = allActions.places.map(a => ({ player: a.playerNum, row: a.row, col: a.col }));
    
    if (summonSlots.length > 0) {
        io.to(room.code).emit('blockSlots', summonSlots);
        await sleep(50);
    }
    
    // 1. PHASE DE RÉVÉLATION DES DÉPLACEMENTS
    if (allActions.moves.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: '↔️ Révélation des déplacements', type: 'revelation' });
        log('↔️ Phase de révélation des déplacements', 'phase');
        await sleep(600);
        
        for (const action of allActions.moves) {
            log(`  ↔️ ${action.heroName}: ${action.card.name} ${slotNames[action.fromRow][action.fromCol]} → ${slotNames[action.toRow][action.toCol]}`, 'action');
            emitAnimation(room, 'move', { 
                player: action.playerNum, 
                fromRow: action.fromRow, 
                fromCol: action.fromCol, 
                toRow: action.toRow, 
                toCol: action.toCol,
                card: action.card
            });
            await sleep(100);
            emitStateToBoth(room);
            await sleep(700);
        }
    }
    
    // 2. PHASE DE RÉVÉLATION DES NOUVELLES CRÉATURES
    if (allActions.places.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: '🎴 Révélation des invocations', type: 'revelation' });
        log('🎴 Phase de révélation des invocations', 'phase');
        await sleep(600);
        
        for (const action of allActions.places) {
            log(`  🎴 ${action.heroName}: ${action.card.name} en ${slotNames[action.row][action.col]}`, 'action');
            emitAnimation(room, 'summon', { player: action.playerNum, row: action.row, col: action.col, card: action.card, animateForOpponent: true });
            await sleep(100);
            emitStateToBoth(room);
            await sleep(700);
        }
    }
    
    // Pièges posés (révélés silencieusement)
    if (allActions.traps.length > 0) {
        for (const action of allActions.traps) {
            log(`  🪤 ${action.heroName}: Piège en rangée ${action.row + 1}`, 'action');
            emitAnimation(room, 'trapPlace', { player: action.playerNum, row: action.row });
            await sleep(400);
        }
        emitStateToBoth(room);
    }
    
    // 3. PHASE DES SORTS DÉFENSIFS (sur soi)
    if (allActions.spellsDefensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: '💚 Sorts défensifs', type: 'protection' });
        log('💚 Phase des sorts défensifs', 'phase');
        await sleep(600);
        
        for (const action of allActions.spellsDefensive) {
            await applySpell(room, action, log, sleep);
        }
    }
    
    // 4. PHASE DES SORTS OFFENSIFS (sur l'adversaire)
    if (allActions.spellsOffensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: '🔥 Sorts offensifs', type: 'attack' });
        log('🔥 Phase des sorts offensifs', 'phase');
        await sleep(600);
        
        for (const action of allActions.spellsOffensive) {
            await applySpell(room, action, log, sleep);
            
            // Vérifier victoire après chaque sort offensif
            const winner = checkVictory();
            if (winner) {
                await sleep(800);
                log(`🏆 ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                io.to(room.code).emit('gameOver', { winner });
                return;
            }
        }
    }
    
    emitStateToBoth(room);
    await sleep(300);
    
    // 5. PHASE DE COMBAT - seulement s'il y a des créatures ou des pièges
    if (hasCreaturesOnField() || hasTraps()) {
        io.to(room.code).emit('phaseMessage', { text: '⚔️ Phase de combat', type: 'combat' });
        log('⚔️ Phase de combat', 'phase');
        await sleep(800);
        
        // D'abord résoudre tous les pièges par rangée
        for (let row = 0; row < 4; row++) {
            await processTrapsForRow(room, row, log, sleep);
        }
        
        const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
        
        // Combat SLOT PAR SLOT : A, B, C, D, E, F, G, H
        // A=row0/col0, B=row0/col1, C=row1/col0, D=row1/col1, etc.
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 2; col++) {
                const gameEnded = await processCombatSlotV2(room, row, col, log, sleep, checkVictory, slotNames);
                
                if (gameEnded) {
                    const winner = checkVictory();
                    if (winner) {
                        await sleep(800);
                        log(`🏆 ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                        io.to(room.code).emit('gameOver', { winner });
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
    
    // Vérifier victoire finale
    const finalWinner = checkVictory();
    if (finalWinner) {
        await sleep(800);
        log(`🏆 ${room.gameState.players[finalWinner].heroName} GAGNE!`, 'phase');
        io.to(room.code).emit('gameOver', { winner: finalWinner });
        return;
    }
    
    // 6. PIOCHE
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        if (player.deck.length > 0) {
            const card = player.deck.pop();
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
            }
            
            if (player.hand.length >= 9) {
                addToGraveyard(player, card);
                log(`📦 ${player.heroName} a la main pleine, la carte va au cimetière`, 'damage');
            } else {
                player.hand.push(card);
            }
        }
    }
    log('📦 Les joueurs piochent une carte', 'action');
    emitStateToBoth(room);
    await sleep(800);
    
    await sleep(500);
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
            
            if (trap.damage) {
                firstAttacker.card.currentHp -= trap.damage;
                emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: firstAttacker.col, amount: trap.damage });
                await sleep(500);
            }
            
            const wasStunned = trap.effect === 'stun';
            if (wasStunned) {
                log(`  💫 ${firstAttacker.card.name} est paralysé!`, 'trap');
                firstAttacker.card.canAttack = false; // Ne peut plus attaquer ce tour
            }
            
            // Mettre le piège au cimetière
            addToGraveyard(defenderState, trap);
            defenderState.traps[row] = null;
            
            emitStateToBoth(room);
            await sleep(500);
            
            // Vérifier si la créature meurt du piège
            if (firstAttacker.card.currentHp <= 0) {
                addToGraveyard(attackerState, firstAttacker.card);
                attackerState.field[row][firstAttacker.col] = null;
                log(`  ☠️ ${firstAttacker.card.name} détruit par le piège!`, 'damage');
                emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: firstAttacker.col });
                emitStateToBoth(room);
                await sleep(600);
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
    await sleep(600);
    
    // SORTS GLOBAUX (sans ciblage)
    if (spell.pattern === 'global') {
        if (spell.effect === 'draw') {
            // Pioche X cartes
            let drawn = 0;
            for (let i = 0; i < spell.amount; i++) {
                if (player.deck.length > 0 && player.hand.length < 9) {
                    const card = player.deck.pop();
                    if (card.type === 'creature') {
                        card.currentHp = card.hp;
                        card.canAttack = false;
                        card.turnsOnField = 0;
                        card.movedThisTurn = false;
                    }
                    player.hand.push(card);
                    drawn++;
                }
            }
            log(`  📜 ${action.heroName}: ${spell.name} - pioche ${drawn} carte(s)`, 'action');
        } else if (spell.effect === 'mana') {
            // Gagne un cristal mana (ou pioche si déjà 10)
            if (player.maxEnergy < 10) {
                player.maxEnergy++;
                player.energy++;
                log(`  💎 ${action.heroName}: ${spell.name} - gagne un cristal de mana (${player.maxEnergy}/10)`, 'action');
            } else if (player.deck.length > 0 && player.hand.length < 9) {
                const card = player.deck.pop();
                if (card.type === 'creature') {
                    card.currentHp = card.hp;
                    card.canAttack = false;
                }
                player.hand.push(card);
                log(`  💎 ${action.heroName}: ${spell.name} - mana max, pioche une carte`, 'action');
            }
        }
    }
    // SORT QUI TOUCHE TOUTES LES CRÉATURES
    else if (spell.pattern === 'all') {
        log(`  🌋 ${action.heroName}: ${spell.name} - ${spell.damage} dégâts à toutes les créatures!`, 'damage');
        
        for (let p = 1; p <= 2; p++) {
            const targetPlayer = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = targetPlayer.field[r][c];
                    if (target) {
                        target.currentHp -= spell.damage;
                        emitAnimation(room, 'damage', { player: p, row: r, col: c, amount: spell.damage });
                        
                        if (target.currentHp > 0 && target.abilities.includes('power')) {
                            target.atk += 1;
                        }
                        
                        if (target.currentHp <= 0) {
                            addToGraveyard(targetPlayer, target);
                            targetPlayer.field[r][c] = null;
                            log(`    ☠️ ${target.name} détruit!`, 'damage');
                            emitAnimation(room, 'death', { player: p, row: r, col: c });
                        }
                    }
                }
            }
        }
        await sleep(400);
    }
    // SORT SUR LE HÉROS ADVERSE
    else if (spell.pattern === 'hero') {
        opponent.hp -= spell.damage;
        log(`  👊 ${action.heroName}: ${spell.name} → ${opponent.heroName} (-${spell.damage})`, 'damage');
        emitAnimation(room, 'heroHit', { defender: playerNum === 1 ? 2 : 1, damage: spell.damage });
        io.to(room.code).emit('directDamage', { defender: playerNum === 1 ? 2 : 1, damage: spell.damage });
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
        
        for (const t of allTargets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];
            
            if (target) {
                target.currentHp -= spell.damage;
                log(`    🔥 ${target.name} (-${spell.damage})`, 'damage');
                emitAnimation(room, 'damage', { player: t.player, row: t.row, col: t.col, amount: spell.damage });
                
                if (target.currentHp > 0 && target.abilities.includes('power')) {
                    target.atk += 1;
                }
                
                if (target.currentHp <= 0) {
                    const targetOwner = t.player === playerNum ? player : opponent;
                    addToGraveyard(targetOwner, target);
                    targetField[t.row][t.col] = null;
                    log(`    ☠️ ${target.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: t.player, row: t.row, col: t.col });
                }
            }
        }
        await sleep(400);
    }
    // SORT CIBLÉ SIMPLE
    else {
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
                target.currentHp -= spell.damage;
                log(`  🔥 ${action.heroName}: ${spell.name} → ${target.name} (-${spell.damage})`, 'damage');
                emitAnimation(room, 'damage', { player: action.targetPlayer, row: action.row, col: action.col, amount: spell.damage });
                
                if (target.currentHp > 0 && target.abilities.includes('power')) {
                    target.atk += 1;
                }
                
                if (target.currentHp <= 0) {
                    const targetOwner = action.targetPlayer === playerNum ? player : opponent;
                    addToGraveyard(targetOwner, target);
                    targetField[action.row][action.col] = null;
                    log(`  ☠️ ${target.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col });
                }
            }
            // Soin
            if (!spell.offensive && spell.heal) {
                const oldHp = target.currentHp;
                target.currentHp = Math.min(target.hp, target.currentHp + spell.heal);
                const healed = target.currentHp - oldHp;
                if (healed > 0) {
                    log(`  💚 ${action.heroName}: ${spell.name} → ${target.name} (+${healed} PV)`, 'heal');
                    emitAnimation(room, 'heal', { player: action.targetPlayer, row: action.row, col: action.col, amount: healed });
                }
            }
            // Buff (+ATK/+HP)
            if (!spell.offensive && spell.buff) {
                target.atk += spell.buff.atk;
                target.hp += spell.buff.hp;
                target.currentHp += spell.buff.hp;
                log(`  💪 ${action.heroName}: ${spell.name} → ${target.name} (+${spell.buff.atk}/+${spell.buff.hp})`, 'action');
                emitAnimation(room, 'buff', { player: action.targetPlayer, row: action.row, col: action.col, atk: spell.buff.atk, hp: spell.buff.hp });
            }
        } else {
            log(`  💨 ${action.heroName}: ${spell.name} n'a rien touché`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        }
    }
    
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
// - Initiative: attaque en premier, si cible meurt pas de riposte/contre-attaque
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
        const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row);
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
                hasInitiative: p1Card.abilities.includes('initiative'),
                hasTrample: p1Card.abilities.includes('trample')
            });
        }
    }
    
    // Créature du joueur 2 à ce slot
    if (p2Card && p2Card.canAttack) {
        const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row);
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
                hasInitiative: p2Card.abilities.includes('initiative'),
                hasTrample: p2Card.abilities.includes('trample')
            });
        }
    }
    
    if (attacks.length === 0) return false;
    
    // Animer les attaques
    for (const atk of attacks) {
        emitAnimation(room, 'attack', {
            attacker: atk.attackerPlayer,
            row: atk.attackerRow,
            col: atk.attackerCol,
            targetPlayer: atk.targetPlayer,
            targetRow: atk.targetRow,
            targetCol: atk.targetIsHero ? -1 : atk.targetCol,
            isFlying: atk.attacker.abilities.includes('fly'),
            isShooter: atk.attacker.abilities.includes('shooter')
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
            const bothHaveInitiative = atk1.hasInitiative && atk2.hasInitiative;
            const oneHasInitiative = atk1.hasInitiative !== atk2.hasInitiative;
            
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
                if (trampleTarget && trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                    trampleTarget = null;
                }
                
                if (trampleTarget && !trampleTarget.abilities.includes('intangible')) {
                    trampleTarget.currentHp -= excessDamage;
                    log(`🦏 Piétinement: ${attacker.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
                    emitAnimation(room, 'damage', { player: atkData.targetPlayer, row: atkData.targetRow, col: trampleCol, amount: excessDamage });
                    
                    if (trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
                        trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + 1;
                    }
                } else if (excessDamage > 0) {
                    targetOwner.hp -= excessDamage;
                    log(`🦏 Piétinement: ${attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
                    emitAnimation(room, 'heroHit', { defender: atkData.targetPlayer, damage: excessDamage });
                    io.to(room.code).emit('directDamage', { defender: atkData.targetPlayer, damage: excessDamage });
                }
            };
            
            if (bothHaveInitiative || !oneHasInitiative) {
                // Dégâts SIMULTANÉS - les deux s'infligent des dégâts en même temps
                const dmg1to2 = atk1.attacker.atk;
                const dmg2to1 = atk2.attacker.atk;
                
                atk2.attacker.currentHp -= dmg1to2;
                atk1.attacker.currentHp -= dmg2to1;
                
                log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${dmg1to2} / -${dmg2to1})`, 'damage');
                emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: dmg1to2 });
                emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: dmg2to1 });
                
                // Power bonus (stocké pour après)
                if (atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                    atk1.attacker.pendingPowerBonus = (atk1.attacker.pendingPowerBonus || 0) + 1;
                }
                if (atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                    atk2.attacker.pendingPowerBonus = (atk2.attacker.pendingPowerBonus || 0) + 1;
                }
                
                // Piétinement - s'applique même si l'attaquant meurt car il a attaqué
                await applyTrample(atk1.attacker, atk2.attacker, atk1);
                await applyTrample(atk2.attacker, atk1.attacker, atk2);
                
            } else {
                // Une seule a initiative - elle attaque en premier
                const first = atk1.hasInitiative ? atk1 : atk2;
                const second = atk1.hasInitiative ? atk2 : atk1;
                
                // Premier attaque
                const dmgFirst = first.attacker.atk;
                second.attacker.currentHp -= dmgFirst;
                log(`⚔️ ${first.attacker.name} → ${second.attacker.name} (-${dmgFirst}) [Initiative]`, 'damage');
                emitAnimation(room, 'damage', { player: second.attackerPlayer, row: second.attackerRow, col: second.attackerCol, amount: dmgFirst });
                
                if (second.attacker.currentHp > 0 && second.attacker.abilities.includes('power')) {
                    second.attacker.pendingPowerBonus = (second.attacker.pendingPowerBonus || 0) + 1;
                }
                
                // Piétinement du premier (même si le second va riposter et le tuer)
                await applyTrample(first.attacker, second.attacker, first);
                
                // Second riposte seulement s'il survit
                if (second.attacker.currentHp > 0) {
                    const dmgSecond = second.attacker.atk;
                    first.attacker.currentHp -= dmgSecond;
                    log(`↩️ ${second.attacker.name} contre-attaque → ${first.attacker.name} (-${dmgSecond})`, 'damage');
                    emitAnimation(room, 'damage', { player: first.attackerPlayer, row: first.attackerRow, col: first.attackerCol, amount: dmgSecond });
                    
                    if (first.attacker.currentHp > 0 && first.attacker.abilities.includes('power')) {
                        first.attacker.pendingPowerBonus = (first.attacker.pendingPowerBonus || 0) + 1;
                    }
                }
            }
            
            // Appliquer les bonus Power
            applyPendingPowerBonuses(room, log);
            
            emitStateToBoth(room);
            await sleep(400);
            
            // Vérifier les morts (inclure les slots derrière pour le piétinement)
            const slotsToCheck = [[row, col]];
            if (atk1.targetCol === 1) slotsToCheck.push([atk1.targetRow, 0]);
            if (atk2.targetCol === 1) slotsToCheck.push([atk2.targetRow, 0]);
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
    const bothHaveInitiative = attacks.length === 2 && attacks[0].hasInitiative && attacks[1].hasInitiative;
    if (bothHaveInitiative) {
        attacks.forEach(a => a.hasInitiative = false);
    }
    attacks.sort((a, b) => (b.hasInitiative ? 1 : 0) - (a.hasInitiative ? 1 : 0));
    
    for (const atk of attacks) {
        const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
        if (!attackerCard || attackerCard.currentHp <= 0) continue;
        
        if (atk.targetIsHero) {
            room.gameState.players[atk.targetPlayer].hp -= attackerCard.atk;
            log(`⚔️ ${attackerCard.name} → ${room.gameState.players[atk.targetPlayer].heroName} (-${attackerCard.atk})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
            io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });
            
            if (room.gameState.players[atk.targetPlayer].hp <= 0) {
                return true;
            }
        } else if (atk.target) {
            const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
            if (!targetCard) continue;
            
            const damage = attackerCard.atk;
            targetCard.currentHp -= damage;
            log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${damage})`, 'damage');
            emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: damage });
            
            if (targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                targetCard.pendingPowerBonus = (targetCard.pendingPowerBonus || 0) + 1;
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
                if (trampleTarget && trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                    trampleTarget = null;
                }
                
                if (trampleTarget && !trampleTarget.abilities.includes('intangible')) {
                    trampleTarget.currentHp -= excessDamage;
                    log(`🦏 Piétinement: ${attackerCard.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: trampleCol, amount: excessDamage });
                    
                    if (trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
                        trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + 1;
                    }
                } else if (excessDamage > 0) {
                    targetOwner.hp -= excessDamage;
                    log(`🦏 Piétinement: ${attackerCard.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
                    emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: excessDamage });
                    io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: excessDamage });
                    
                    if (targetOwner.hp <= 0) return true;
                }
            }
            
            // RIPOSTE: seulement si la cible NE PEUT PAS attaquer ce tour
            // Les tireurs ne reçoivent JAMAIS de riposte (attaque à distance)
            // La riposte est SIMULTANÉE (même si la cible meurt) SAUF si l'attaquant a INITIATIVE (et pas la cible)
            const targetCanAttack = targetCard.canAttack;
            const targetDied = targetCard.currentHp <= 0;
            const attackerIsShooter = attackerCard.abilities.includes('shooter');
            const attackerHasInitiative = attackerCard.abilities.includes('initiative');
            const targetHasInitiative = targetCard.abilities.includes('initiative');
            
            // Initiative effective : seulement si l'attaquant a initiative ET la cible ne l'a pas
            const effectiveInitiative = attackerHasInitiative && !targetHasInitiative;
            
            // Riposte si :
            // - La cible ne peut pas attaquer
            // - L'attaquant n'est pas un tireur
            // - ET (l'attaquant n'a pas initiative effective OU la cible survit)
            if (!targetCanAttack && !attackerIsShooter && (!effectiveInitiative || !targetDied)) {
                const riposteDamage = targetCard.atk;
                attackerCard.currentHp -= riposteDamage;
                log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${riposteDamage})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: riposteDamage });
                
                if (attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                    attackerCard.pendingPowerBonus = (attackerCard.pendingPowerBonus || 0) + 1;
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
    for (const [r, c] of slotsToCheck) {
        for (let p = 1; p <= 2; p++) {
            const card = room.gameState.players[p].field[r][c];
            if (card && card.currentHp <= 0) {
                addToGraveyard(room.gameState.players[p], card);
                room.gameState.players[p].field[r][c] = null;
                log(`☠️ ${card.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: p, row: r, col: c });
            }
        }
    }
    emitStateToBoth(room);
    await sleep(300);
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
        const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row);
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
                hasInitiative: p1Card.abilities.includes('initiative'),
                hasTrample: p1Card.abilities.includes('trample'),
                isShooter: p1Card.abilities.includes('shooter'),
                isFlying: p1Card.abilities.includes('fly')
            });
        }
    }
    
    if (p2Card && p2Card.canAttack && p2Card.currentHp > 0) {
        const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row);
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
                hasInitiative: p2Card.abilities.includes('initiative'),
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
    
    // Animer les attaques
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
    await sleep(400);
    
    if (mutualCombat) {
        // Combat mutuel - les deux créatures peuvent attaquer et se ciblent
        const atk1 = attacks[0];
        const atk2 = attacks[1];
        
        const bothInit = atk1.hasInitiative && atk2.hasInitiative;
        const neitherInit = !atk1.hasInitiative && !atk2.hasInitiative;
        
        if (bothInit || neitherInit) {
            // Dégâts simultanés
            const dmg1 = atk1.attacker.atk;
            const dmg2 = atk2.attacker.atk;
            
            atk2.attacker.currentHp -= dmg1;
            atk1.attacker.currentHp -= dmg2;
            
            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${dmg1} / -${dmg2})`, 'damage');
            emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: dmg1 });
            emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: dmg2 });
            
            // Power
            if (atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                atk1.attacker.atk += 1;
                log(`💪 ${atk1.attacker.name} gagne +1 ATK!`, 'buff');
            }
            if (atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                atk2.attacker.atk += 1;
                log(`💪 ${atk2.attacker.name} gagne +1 ATK!`, 'buff');
            }
        } else {
            // Une a initiative, l'autre non
            const first = atk1.hasInitiative ? atk1 : atk2;
            const second = atk1.hasInitiative ? atk2 : atk1;
            
            const dmgFirst = first.attacker.atk;
            second.attacker.currentHp -= dmgFirst;
            log(`⚔️ ${first.attacker.name} → ${second.attacker.name} (-${dmgFirst}) [Initiative]`, 'damage');
            emitAnimation(room, 'damage', { player: second.attackerPlayer, row: second.attackerRow, col: second.attackerCol, amount: dmgFirst });
            
            if (second.attacker.currentHp > 0) {
                if (second.attacker.abilities.includes('power')) {
                    second.attacker.atk += 1;
                    log(`💪 ${second.attacker.name} gagne +1 ATK!`, 'buff');
                }
                // Second contre-attaque
                const dmgSecond = second.attacker.atk;
                first.attacker.currentHp -= dmgSecond;
                log(`↩️ ${second.attacker.name} → ${first.attacker.name} (-${dmgSecond})`, 'damage');
                emitAnimation(room, 'damage', { player: first.attackerPlayer, row: first.attackerRow, col: first.attackerCol, amount: dmgSecond });
                
                if (first.attacker.currentHp > 0 && first.attacker.abilities.includes('power')) {
                    first.attacker.atk += 1;
                    log(`💪 ${first.attacker.name} gagne +1 ATK!`, 'buff');
                }
            }
        }
    } else {
        // Pas de combat mutuel - traiter chaque attaque séparément
        for (const atk of attacks) {
            // Vérifier si l'attaquant est encore en vie
            const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
            if (!attackerCard || attackerCard.currentHp <= 0) continue;
            
            if (atk.targetIsHero) {
                // Attaque le héros
                const targetPlayer = room.gameState.players[atk.targetPlayer];
                targetPlayer.hp -= attackerCard.atk;
                log(`⚔️ ${attackerCard.name} → ${targetPlayer.heroName} (-${attackerCard.atk})`, 'damage');
                emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
                io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });
                
                if (targetPlayer.hp <= 0) {
                    emitStateToBoth(room);
                    return true;
                }
            } else {
                // Attaque une créature
                const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
                if (!targetCard || targetCard.currentHp <= 0) continue;
                
                const damage = attackerCard.atk;
                targetCard.currentHp -= damage;
                log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${damage})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: damage });
                
                // Power pour la cible
                if (targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                    targetCard.atk += 1;
                    log(`💪 ${targetCard.name} gagne +1 ATK!`, 'buff');
                }
                
                // RIPOSTE - seulement si:
                // - La cible ne peut PAS attaquer ce tour
                // - L'attaquant N'EST PAS un tireur (le tireur ne reçoit jamais de riposte)
                // - La cible survit OU l'attaquant n'a pas initiative effective
                const targetCanAttack = targetCard.canAttack;
                const targetDied = targetCard.currentHp <= 0;
                const attackerHasInitiative = attackerCard.abilities.includes('initiative');
                const targetHasInitiative = targetCard.abilities?.includes('initiative') || false;
                const effectiveInitiative = attackerHasInitiative && !targetHasInitiative;
                
                // PAS DE RIPOSTE si tireur
                if (!targetCanAttack && !atk.isShooter && (!effectiveInitiative || !targetDied)) {
                    const riposteDmg = targetCard.atk;
                    attackerCard.currentHp -= riposteDmg;
                    log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${riposteDmg})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: riposteDmg });
                    
                    if (attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                        attackerCard.atk += 1;
                        log(`💪 ${attackerCard.name} gagne +1 ATK!`, 'buff');
                    }
                }
            }
        }
    }
    
    emitStateToBoth(room);
    await sleep(300);
    
    // Retirer les créatures mortes DE TOUT LE TERRAIN (pas seulement ce slot)
    let anyDeath = false;
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.currentHp <= 0) {
                    addToGraveyard(room.gameState.players[p], card);
                    room.gameState.players[p].field[r][c] = null;
                    log(`☠️ ${card.name} détruit!`, 'damage');
                    emitAnimation(room, 'death', { player: p, row: r, col: c });
                    anyDeath = true;
                }
            }
        }
    }
    
    if (anyDeath) {
        emitStateToBoth(room);
        await sleep(300);
    }
    
    return false;
}

// Traiter le combat pour une rangée entière
// Détecte les combats mutuels même entre slots différents (ex: volante col1 vs tireur col0)
async function processCombatRow(room, row, log, sleep, checkVictory) {
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    const rowNames = ['A', 'B', 'C', 'D'];
    
    // Collecter TOUTES les attaques de cette rangée
    const attacks = [];
    
    // Parcourir les 2 colonnes pour chaque joueur
    for (let col = 0; col < 2; col++) {
        // Créature du joueur 1
        const p1Card = p1State.field[row][col];
        if (p1Card && p1Card.canAttack) {
            const target = findTarget(p1Card, p2State.field[row][1], p2State.field[row][0], 2, row);
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
                    hasInitiative: p1Card.abilities.includes('initiative'),
                    hasTrample: p1Card.abilities.includes('trample'),
                    isShooter: p1Card.abilities.includes('shooter'),
                    isFlying: p1Card.abilities.includes('fly'),
                    processed: false
                });
            }
        }
        
        // Créature du joueur 2
        const p2Card = p2State.field[row][col];
        if (p2Card && p2Card.canAttack) {
            const target = findTarget(p2Card, p1State.field[row][1], p1State.field[row][0], 1, row);
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
                    hasInitiative: p2Card.abilities.includes('initiative'),
                    hasTrample: p2Card.abilities.includes('trample'),
                    isShooter: p2Card.abilities.includes('shooter'),
                    isFlying: p2Card.abilities.includes('fly'),
                    processed: false
                });
            }
        }
    }
    
    if (attacks.length === 0) return false;
    
    // Animer toutes les attaques de cette rangée
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
    
    // Identifier les combats mutuels (A attaque B et B attaque A)
    const mutualPairs = [];
    for (let i = 0; i < attacks.length; i++) {
        if (attacks[i].processed || attacks[i].targetIsHero) continue;
        
        for (let j = i + 1; j < attacks.length; j++) {
            if (attacks[j].processed || attacks[j].targetIsHero) continue;
            
            const atk1 = attacks[i];
            const atk2 = attacks[j];
            
            // Vérifier si elles se ciblent mutuellement
            const atk1TargetsAtk2 = atk1.targetPlayer === atk2.attackerPlayer && 
                                   atk1.targetRow === atk2.attackerRow && 
                                   atk1.targetCol === atk2.attackerCol;
            const atk2TargetsAtk1 = atk2.targetPlayer === atk1.attackerPlayer && 
                                   atk2.targetRow === atk1.attackerRow && 
                                   atk2.targetCol === atk1.attackerCol;
            
            if (atk1TargetsAtk2 && atk2TargetsAtk1) {
                mutualPairs.push([atk1, atk2]);
                atk1.processed = true;
                atk2.processed = true;
            }
        }
    }
    
    // Traiter les combats mutuels
    for (const [atk1, atk2] of mutualPairs) {
        const bothHaveInitiative = atk1.hasInitiative && atk2.hasInitiative;
        const oneHasInitiative = atk1.hasInitiative !== atk2.hasInitiative;
        
        if (bothHaveInitiative || !oneHasInitiative) {
            // Dégâts SIMULTANÉS
            const dmg1to2 = atk1.attacker.atk;
            const dmg2to1 = atk2.attacker.atk;
            
            atk2.attacker.currentHp -= dmg1to2;
            atk1.attacker.currentHp -= dmg2to1;
            
            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${dmg1to2} / -${dmg2to1})`, 'damage');
            emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: dmg1to2 });
            emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: dmg2to1 });
            
            // Power bonus
            if (atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                atk1.attacker.pendingPowerBonus = (atk1.attacker.pendingPowerBonus || 0) + 1;
            }
            if (atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                atk2.attacker.pendingPowerBonus = (atk2.attacker.pendingPowerBonus || 0) + 1;
            }
            
            // Piétinement pour les deux
            await applyTrampleDamage(room, atk1, log, sleep);
            await applyTrampleDamage(room, atk2, log, sleep);
            
        } else {
            // Une seule a initiative - elle attaque en premier
            const first = atk1.hasInitiative ? atk1 : atk2;
            const second = atk1.hasInitiative ? atk2 : atk1;
            
            const dmgFirst = first.attacker.atk;
            second.attacker.currentHp -= dmgFirst;
            log(`⚔️ ${first.attacker.name} → ${second.attacker.name} (-${dmgFirst}) [Initiative]`, 'damage');
            emitAnimation(room, 'damage', { player: second.attackerPlayer, row: second.attackerRow, col: second.attackerCol, amount: dmgFirst });
            
            if (second.attacker.currentHp > 0 && second.attacker.abilities.includes('power')) {
                second.attacker.pendingPowerBonus = (second.attacker.pendingPowerBonus || 0) + 1;
            }
            
            // Piétinement du premier
            await applyTrampleDamage(room, first, log, sleep);
            
            // Second contre-attaque seulement s'il survit
            if (second.attacker.currentHp > 0) {
                const dmgSecond = second.attacker.atk;
                first.attacker.currentHp -= dmgSecond;
                log(`↩️ ${second.attacker.name} contre-attaque → ${first.attacker.name} (-${dmgSecond})`, 'damage');
                emitAnimation(room, 'damage', { player: first.attackerPlayer, row: first.attackerRow, col: first.attackerCol, amount: dmgSecond });
                
                if (first.attacker.currentHp > 0 && first.attacker.abilities.includes('power')) {
                    first.attacker.pendingPowerBonus = (first.attacker.pendingPowerBonus || 0) + 1;
                }
            }
        }
    }
    
    // Traiter les attaques non-mutuelles (restantes)
    for (const atk of attacks) {
        if (atk.processed) continue;
        atk.processed = true;
        
        // Vérifier si l'attaquant est encore vivant
        const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
        if (!attackerCard || attackerCard.currentHp <= 0) continue;
        
        if (atk.targetIsHero) {
            room.gameState.players[atk.targetPlayer].hp -= attackerCard.atk;
            log(`⚔️ ${attackerCard.name} → ${room.gameState.players[atk.targetPlayer].heroName} (-${attackerCard.atk})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
            io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });
            
            if (room.gameState.players[atk.targetPlayer].hp <= 0) {
                applyPendingPowerBonuses(room, log);
                emitStateToBoth(room);
                return true;
            }
        } else {
            const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
            if (!targetCard) continue;
            
            const damage = attackerCard.atk;
            targetCard.currentHp -= damage;
            log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${damage})`, 'damage');
            emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: damage });
            
            if (targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                targetCard.pendingPowerBonus = (targetCard.pendingPowerBonus || 0) + 1;
            }
            
            // Piétinement
            await applyTrampleDamage(room, atk, log, sleep);
            
            // RIPOSTE: seulement si cible ne peut pas attaquer ET attaquant n'est pas tireur
            const targetCanAttack = targetCard.canAttack;
            const targetDied = targetCard.currentHp <= 0;
            const attackerHasInitiative = attackerCard.abilities.includes('initiative');
            const targetHasInitiative = targetCard.abilities?.includes('initiative');
            const effectiveInitiative = attackerHasInitiative && !targetHasInitiative;
            
            // Pas de riposte si:
            // - La cible peut attaquer (elle attaquera/a attaqué dans son propre tour)
            // - L'attaquant est un tireur (attaque à distance)
            // - L'attaquant a initiative effective et a tué la cible
            if (!targetCanAttack && !atk.isShooter && (!effectiveInitiative || !targetDied)) {
                const riposteDamage = targetCard.atk;
                attackerCard.currentHp -= riposteDamage;
                log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${riposteDamage})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: riposteDamage });
                
                if (attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                    attackerCard.pendingPowerBonus = (attackerCard.pendingPowerBonus || 0) + 1;
                }
            }
        }
    }
    
    // Appliquer les bonus Power
    applyPendingPowerBonuses(room, log);
    
    emitStateToBoth(room);
    await sleep(400);
    
    // Vérifier et retirer les créatures mortes
    const slotsToCheck = [];
    for (const atk of attacks) {
        slotsToCheck.push([atk.attackerRow, atk.attackerCol]);
        if (!atk.targetIsHero) {
            slotsToCheck.push([atk.targetRow, atk.targetCol]);
        }
    }
    await checkAndRemoveDeadCreatures(room, slotsToCheck, log, sleep);
    
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
    if (trampleTarget && trampleTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
        trampleTarget = null;
    }
    
    if (trampleTarget && !trampleTarget.abilities.includes('intangible')) {
        trampleTarget.currentHp -= excessDamage;
        log(`🦏 Piétinement: ${atk.attacker.name} → ${trampleTarget.name} (-${excessDamage})`, 'damage');
        emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: trampleCol, amount: excessDamage });
        
        if (trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
            trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + 1;
        }
    } else if (excessDamage > 0 && !trampleTarget) {
        targetOwner.hp -= excessDamage;
        log(`🦏 Piétinement: ${atk.attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
        emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: excessDamage });
        io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: excessDamage });
    }
}

// Trouver la cible d'une créature
function findTarget(attacker, enemyFront, enemyBack, enemyPlayer, row) {
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
    
    // CAS 1: Créature VOLANTE
    // - Attaque directement DERRIÈRE (col 0) si c'est un tireur ou volant
    // - Sinon attaque le héros directement
    // - Ne bloque PAS les créatures normales
    if (isFlying) {
        // Volant regarde d'abord derrière (back = col 0)
        if (effectiveBack && (backIsFlying || backIsShooter)) {
            return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }
        // Puis devant si c'est un volant ou tireur
        if (effectiveFront && (frontIsFlying || frontIsShooter)) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
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
        
        const { handIndex, targetPlayer, row, col } = data;
        if (handIndex < 0 || handIndex >= player.hand.length) return;
        
        const spell = player.hand[handIndex];
        if (!spell || spell.type !== 'spell' || spell.cost > player.energy) return;
        if (row < 0 || row > 3 || col < 0 || col > 1) return;
        
        player.energy -= spell.cost;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;
        
        player.pendingActions.push({ type: 'spell', spell: deepClone(spell), targetPlayer, row, col });
        
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
        if (!spell || spell.type !== 'spell' || spell.cost > player.energy) return;
        
        // Vérifier que c'est un sort global (global, all, hero)
        if (!['global', 'all', 'hero'].includes(spell.pattern)) return;
        
        player.energy -= spell.cost;
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
