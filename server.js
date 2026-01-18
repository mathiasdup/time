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

    // CACHER LES CARTES QUI VONT ÊTRE RÉVÉLÉES (pendant les déplacements)
    // On cache les cartes adverses + les cartes locales qui remplacent un déplacement
    if (allActions.places.length > 0) {
        const movedFromSlots = allActions.moves.map(m => ({
            player: m.playerNum,
            row: m.fromRow,
            col: m.fromCol
        }));

        const cardsToHide = allActions.places.map(a => {
            const wasMovedFrom = movedFromSlots.some(m =>
                m.player === a.playerNum && m.row === a.row && m.col === a.col
            );
            return {
                player: a.playerNum,
                row: a.row,
                col: a.col,
                hideLocal: wasMovedFrom // Cacher aussi pour le joueur local si déplacement préalable
            };
        });
        io.to(room.code).emit('hideCards', cardsToHide);
        await sleep(50);
    }

    // 1. PHASE DE RÉVÉLATION (déplacements + créatures)
    if (allActions.moves.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Révélation', type: 'revelation' });
        log('↔️ Phase de révélation - Déplacements', 'phase');
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

    // 2. PHASE DE RÉVÉLATION DES NOUVELLES CRÉATURES ET PIÈGES
    const hasPlacesOrTraps = allActions.places.length > 0 || allActions.traps.length > 0;
    if (hasPlacesOrTraps) {
        // N'afficher le message que si on n'a pas déjà affiché Révélation pour les déplacements
        if (allActions.moves.length === 0) {
            io.to(room.code).emit('phaseMessage', { text: 'Révélation', type: 'revelation' });
        }
        log('🎴 Phase de révélation - Créatures', 'phase');
        await sleep(600);

        // Révéler les créatures une par une
        for (const action of allActions.places) {
            log(`  🎴 ${action.heroName}: ${action.card.name} en ${slotNames[action.row][action.col]}`, 'action');

            // Révéler la carte (retirer du cache) juste avant l'animation
            io.to(room.code).emit('revealCard', {
                player: action.playerNum,
                row: action.row,
                col: action.col
            });

            emitAnimation(room, 'summon', {
                player: action.playerNum,
                row: action.row,
                col: action.col,
                card: action.card,
                animateForOpponent: true
            });
            await sleep(100);
            emitStateToBoth(room);
            await sleep(700);
        }
        
        // Révéler les pièges
        for (const action of allActions.traps) {
            log(`  🪤 ${action.heroName}: Piège en rangée ${action.row + 1}`, 'action');
            emitAnimation(room, 'trapPlace', { player: action.playerNum, row: action.row });
            await sleep(400);
        }
        if (allActions.traps.length > 0) {
            emitStateToBoth(room);
        }
    }
    
    // 3. PHASE DES SORTS DÉFENSIFS (sur soi)
    if (allActions.spellsDefensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort défensif', type: 'protection' });
        log('💚 Phase des sorts défensifs', 'phase');
        await sleep(600);
        
        for (const action of allActions.spellsDefensive) {
            await applySpell(room, action, log, sleep);
        }
    }
    
    // 4. PHASE DES SORTS OFFENSIFS (sur l'adversaire)
    if (allActions.spellsOffensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort offensif', type: 'attack' });
        log('🔥 Phase des sorts offensifs', 'phase');
        await sleep(600);
        
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
    
    // 5. PHASE DE COMBAT - seulement s'il y a des créatures ou des pièges
    if (hasCreaturesOnField() || hasTraps()) {
        io.to(room.code).emit('phaseMessage', { text: 'Combat', type: 'combat' });
        log('⚔️ Combat', 'phase');
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
    
    // Vérifier victoire finale
    const finalWinner = checkVictory();
    if (finalWinner) {
        await sleep(800);
        log(`🏆 ${room.gameState.players[finalWinner].heroName} GAGNE!`, 'phase');
        io.to(room.code).emit('gameOver', { winner: finalWinner });
        return;
    }
    
    // 6. PIOCHE
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
    
    // 6. PHASE DE PIOCHE
    io.to(room.code).emit('phaseMessage', { text: 'Pioche', type: 'draw' });
    log('🎴 Pioche', 'phase');
    await sleep(800);

    // Les deux joueurs piochent
    const drawnCards = [];
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
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
        await sleep(20);
    }

    // État (le render va créer les cartes cachées)
    emitStateToBoth(room);
    log('📦 Les joueurs piochent une carte', 'action');

    // Attendre la fin de l'animation de pioche
    await sleep(500);

    // Animation de burn APRÈS l'état (pour que ce soit bien visible)
    for (const burned of burnedCards) {
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
        await sleep(1200); // Attendre l'animation de burn
    }

    // 7. EFFETS DE FIN DE TOUR
    io.to(room.code).emit('phaseMessage', { text: 'Effet de fin de tour', type: 'endturn' });
    log('✨ Effet de fin de tour', 'phase');
    await sleep(800);

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
                const deadCard = firstAttacker.card;
                addToGraveyard(attackerState, deadCard);
                attackerState.field[row][firstAttacker.col] = null;
                log(`  ☠️ ${deadCard.name} détruit par le piège!`, 'damage');
                emitAnimation(room, 'death', { player: attackerPlayer, row: row, col: firstAttacker.col });
                emitStateToBoth(room);
                await sleep(600);
                // Capacité onDeath
                await processOnDeathAbility(room, deadCard, attackerPlayer, log, sleep);
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
            // Pioche X cartes avec animation
            const drawnCards = [];
            const burnedCards = [];
            for (let i = 0; i < spell.amount; i++) {
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
                log(`  📜 ${action.heroName}: ${spell.name} - pioche ${drawnCards.length} carte(s)`, 'action');
                emitAnimation(room, 'draw', { cards: drawnCards });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(400 * drawnCards.length);
            }
            // Animation de burn pour les cartes qui n'ont pas pu être ajoutées
            for (const burned of burnedCards) {
                log(`  📦 Main pleine, ${burned.card.name} va au cimetière`, 'damage');
                emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
                await sleep(1200);
            }
        } else if (spell.effect === 'mana') {
            // Gagne un cristal mana (ou pioche si déjà 10)
            if (player.maxEnergy < 10) {
                player.maxEnergy++;
                player.energy++;
                log(`  💎 ${action.heroName}: ${spell.name} - gagne un cristal de mana (${player.maxEnergy}/10)`, 'action');
            } else if (player.deck.length > 0) {
                const card = player.deck.pop();
                if (card.type === 'creature') {
                    card.currentHp = card.hp;
                    card.canAttack = false;
                }
                if (player.hand.length < 9) {
                    player.hand.push(card);
                    log(`  💎 ${action.heroName}: ${spell.name} - mana max, pioche une carte`, 'action');
                    emitAnimation(room, 'draw', { cards: [{ player: playerNum, card: card, handIndex: player.hand.length - 1 }] });
                    await sleep(20);
                    emitStateToBoth(room);
                    await sleep(400);
                } else {
                    addToGraveyard(player, card);
                    log(`  📦 Main pleine, ${card.name} va au cimetière`, 'damage');
                    emitAnimation(room, 'burn', { player: playerNum, card: card });
                    await sleep(1200);
                }
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
                        target.currentHp -= spell.damage;

                        if (target.currentHp > 0 && target.abilities.includes('power')) {
                            target.atk += 1;
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

            for (const d of deaths) {
                addToGraveyard(d.player, d.target);
                d.player.field[d.r][d.c] = null;
                log(`    ☠️ ${d.target.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: d.p, row: d.r, col: d.c });
            }

            // Envoyer l'état maintenant (les slots bloqués ne seront pas touchés par render)
            emitStateToBoth(room);

            // Attendre que toutes les animations de mort se terminent
            await sleep(600);

            // Débloquer les slots
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            // Capacités onDeath
            for (const d of deaths) {
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
            // Le héros ciblé pioche avec animation
            const drawnCards = [];
            const burnedCards = [];
            for (let i = 0; i < spell.amount; i++) {
                if (targetHero.deck.length > 0) {
                    const card = targetHero.deck.pop();
                    if (card.type === 'creature') {
                        card.currentHp = card.hp;
                        card.canAttack = false;
                        card.turnsOnField = 0;
                        card.movedThisTurn = false;
                    }
                    if (targetHero.hand.length < 9) {
                        targetHero.hand.push(card);
                        drawnCards.push({ player: action.targetPlayer, card: card, handIndex: targetHero.hand.length - 1 });
                    } else {
                        addToGraveyard(targetHero, card);
                        burnedCards.push({ player: action.targetPlayer, card: card });
                    }
                }
            }
            if (drawnCards.length > 0) {
                log(`  📜 ${action.heroName}: ${spell.name} → ${targetName} pioche ${drawnCards.length} carte(s)`, 'action');
                emitAnimation(room, 'draw', { cards: drawnCards });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(400 * drawnCards.length);
            }
            // Animation de burn pour les cartes qui n'ont pas pu être ajoutées
            for (const burned of burnedCards) {
                log(`  📦 Main pleine, ${burned.card.name} va au cimetière`, 'damage');
                emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
                await sleep(1200);
            }
        } else if (spell.effect === 'mana') {
            // Le héros ciblé gagne un mana
            if (targetHero.maxEnergy < 10) {
                targetHero.maxEnergy++;
                targetHero.energy++;
                log(`  💎 ${action.heroName}: ${spell.name} → ${targetName} gagne un cristal de mana (${targetHero.maxEnergy}/10)`, 'action');
            } else if (targetHero.deck.length > 0) {
                const card = targetHero.deck.pop();
                if (card.type === 'creature') {
                    card.currentHp = card.hp;
                    card.canAttack = false;
                }
                if (targetHero.hand.length < 9) {
                    targetHero.hand.push(card);
                    log(`  💎 ${action.heroName}: ${spell.name} → ${targetName} mana max, pioche une carte`, 'action');
                    emitAnimation(room, 'draw', { cards: [{ player: action.targetPlayer, card: card, handIndex: targetHero.hand.length - 1 }] });
                    await sleep(20);
                    emitStateToBoth(room);
                    await sleep(400);
                } else {
                    addToGraveyard(targetHero, card);
                    log(`  📦 Main pleine, ${card.name} va au cimetière`, 'damage');
                    emitAnimation(room, 'burn', { player: action.targetPlayer, card: card });
                    await sleep(1200);
                }
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
                target.currentHp -= spell.damage;
                log(`    🔥 ${target.name} (-${spell.damage})`, 'damage');

                if (target.currentHp > 0 && target.abilities.includes('power')) {
                    target.atk += 1;
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

            for (const d of deaths) {
                addToGraveyard(d.owner, d.target);
                d.field[d.t.row][d.t.col] = null;
                log(`    ☠️ ${d.target.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: d.t.player, row: d.t.row, col: d.t.col });
            }

            // Envoyer l'état maintenant (les slots bloqués ne seront pas touchés par render)
            emitStateToBoth(room);

            // Attendre que toutes les animations de mort se terminent
            await sleep(600);

            // Débloquer les slots
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            // Capacités onDeath
            for (const d of deaths) {
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

                    target.currentHp -= spell.damage;
                    log(`  🔥 ${action.heroName}: ${spell.name} → ${target.name} (-${spell.damage})`, 'damage');

                    if (target.currentHp > 0 && target.abilities.includes('power')) {
                        target.atk += 1;
                    }

                    if (target.currentHp <= 0) {
                        const targetOwner = action.targetPlayer === playerNum ? player : opponent;
                        addToGraveyard(targetOwner, target);
                        targetField[action.row][action.col] = null;
                        log(`  ☠️ ${target.name} détruit!`, 'damage');
                        emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col });
                        await sleep(600);
                        // Capacité onDeath
                        await processOnDeathAbility(room, target, action.targetPlayer, log, sleep);
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
            const bothHaveInitiative = atk1.hasInitiative && atk2.hasInitiative;
            const oneHasInitiative = atk1.hasInitiative !== atk2.hasInitiative;
            
            // Helper pour appliquer le clivant
            const applyCleave = (attacker, atkData) => {
                if (!attacker.abilities.includes('cleave')) return [];
                const cleaveTargets = [];
                const targetOwner = room.gameState.players[atkData.targetPlayer];
                const adjacentRows = [atkData.targetRow - 1, atkData.targetRow + 1].filter(r => r >= 0 && r < 4);
                const damage = attacker.cleaveX || attacker.atk; // Utiliser cleaveX si défini, sinon atk

                for (const adjRow of adjacentRows) {
                    const adjTarget = targetOwner.field[adjRow][atkData.targetCol];
                    if (adjTarget && !adjTarget.abilities.includes('intangible')) {
                        const attackerIsFlying = attacker.abilities.includes('fly');
                        const attackerIsShooter = attacker.abilities.includes('shooter');
                        if (adjTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                            continue;
                        }

                        adjTarget.currentHp -= damage;
                        log(`⛏️ Clivant ${damage}: ${attacker.name} → ${adjTarget.name} (-${damage})`, 'damage');
                        emitAnimation(room, 'damage', { player: atkData.targetPlayer, row: adjRow, col: atkData.targetCol, amount: damage });

                        if (adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                            adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + 1;
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
                    targetOwner.heroAttackedThisTurn = true;
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
                
                // Clivant - s'applique même si l'attaquant meurt car il a attaqué
                atk1.cleaveTargets = applyCleave(atk1.attacker, atk1);
                atk2.cleaveTargets = applyCleave(atk2.attacker, atk2);

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
                
                // Clivant du premier
                first.cleaveTargets = applyCleave(first.attacker, first);

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
            room.gameState.players[atk.targetPlayer].heroAttackedThisTurn = true;
            log(`⚔️ ${attackerCard.name} → ${room.gameState.players[atk.targetPlayer].heroName} (-${attackerCard.atk})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
            io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });

            // Capacité spéciale: piocher une carte quand attaque un héros
            if (attackerCard.onHeroHit === 'draw') {
                const attackerOwner = room.gameState.players[atk.attackerPlayer];
                if (attackerOwner.deck.length > 0) {
                    const drawnCard = attackerOwner.deck.shift();
                    if (attackerOwner.hand.length < 10) {
                        attackerOwner.hand.push(drawnCard);
                        log(`  🎴 ${attackerCard.name} déclenche: ${attackerOwner.heroName} pioche ${drawnCard.name}`, 'action');
                        emitAnimation(room, 'draw', { cards: [{ player: atk.attackerPlayer, card: drawnCard, handIndex: attackerOwner.hand.length - 1 }] });
                    } else {
                        addToGraveyard(attackerOwner, drawnCard);
                        log(`  📦 Main pleine, ${drawnCard.name} va au cimetière`, 'damage');
                    }
                }
            }

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

            // Clivant - inflige les dégâts aux créatures sur les lignes adjacentes (même colonne)
            if (attackerCard.abilities.includes('cleave')) {
                const targetOwner = room.gameState.players[atk.targetPlayer];
                const adjacentRows = [atk.targetRow - 1, atk.targetRow + 1].filter(r => r >= 0 && r < 4);
                const cleaveDamage = attackerCard.cleaveX || attackerCard.atk; // Utiliser cleaveX si défini

                for (const adjRow of adjacentRows) {
                    const adjTarget = targetOwner.field[adjRow][atk.targetCol];
                    if (adjTarget && !adjTarget.abilities.includes('intangible')) {
                        // Vérifier si on peut toucher une cible volante
                        const attackerIsFlying = attackerCard.abilities.includes('fly');
                        const attackerIsShooter = attackerCard.abilities.includes('shooter');
                        if (adjTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                            continue; // Ne peut pas toucher une créature volante
                        }

                        adjTarget.currentHp -= cleaveDamage;
                        log(`⛏️ Clivant ${cleaveDamage}: ${attackerCard.name} → ${adjTarget.name} (-${cleaveDamage})`, 'damage');
                        emitAnimation(room, 'damage', { player: atk.targetPlayer, row: adjRow, col: atk.targetCol, amount: cleaveDamage });

                        // Les cibles adjacentes ne ripostent PAS mais peuvent gagner Power
                        if (adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                            adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + 1;
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
                    targetOwner.heroAttackedThisTurn = true;
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
    for (const [r, c] of slotsToCheck) {
        for (let p = 1; p <= 2; p++) {
            const card = room.gameState.players[p].field[r][c];
            if (card && card.currentHp <= 0) {
                deadCards.push({ card, player: p });
                addToGraveyard(room.gameState.players[p], card);
                room.gameState.players[p].field[r][c] = null;
                log(`☠️ ${card.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: p, row: r, col: c });
            }
        }
    }
    emitStateToBoth(room);
    await sleep(300);
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

            // Vérifier l'initiative
            const shooterHasInit = shooter.hasInitiative;
            const otherHasInit = other.hasInitiative;
            const oneHasInit = shooterHasInit !== otherHasInit;

            if (oneHasInit) {
                // Un seul a initiative - il attaque en premier
                const first = shooterHasInit ? shooter : other;
                const second = shooterHasInit ? other : shooter;
                const dmgFirst = first.attacker.atk;

                emitAnimation(room, 'attack', {
                    combatType: first.isShooter ? 'shooter' : 'solo',
                    attacker: first.attackerPlayer,
                    row: first.attackerRow,
                    col: first.attackerCol,
                    targetPlayer: second.attackerPlayer,
                    targetRow: second.attackerRow,
                    targetCol: second.attackerCol,
                    damage: dmgFirst,
                    isShooter: first.isShooter,
                    isFlying: first.isFlying
                });
                await sleep(800);

                second.attacker.currentHp -= dmgFirst;
                log(`⚔️ ${first.attacker.name} → ${second.attacker.name} (-${dmgFirst}) [Initiative]`, 'damage');

                if (second.attacker.currentHp > 0) {
                    if (second.attacker.abilities.includes('power')) {
                        second.attacker.atk += 1;
                        log(`💪 ${second.attacker.name} gagne +1 ATK!`, 'buff');
                    }
                    const dmgSecond = second.attacker.atk;

                    emitAnimation(room, 'attack', {
                        combatType: second.isShooter ? 'shooter' : 'solo',
                        attacker: second.attackerPlayer,
                        row: second.attackerRow,
                        col: second.attackerCol,
                        targetPlayer: first.attackerPlayer,
                        targetRow: first.attackerRow,
                        targetCol: first.attackerCol,
                        damage: dmgSecond,
                        isShooter: second.isShooter,
                        isFlying: second.isFlying
                    });
                    await sleep(800);

                    first.attacker.currentHp -= dmgSecond;
                    log(`↩️ ${second.attacker.name} → ${first.attacker.name} (-${dmgSecond})`, 'damage');

                    if (first.attacker.currentHp > 0 && first.attacker.abilities.includes('power')) {
                        first.attacker.atk += 1;
                        log(`💪 ${first.attacker.name} gagne +1 ATK!`, 'buff');
                    }
                }
            } else {
                // Les deux ont initiative OU aucun n'a initiative - combat simultané
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
                other.attacker.currentHp -= shooterDmg;
                shooter.attacker.currentHp -= otherDmg;

                log(`⚔️ ${shooter.attacker.name} ↔ ${other.attacker.name} (-${shooterDmg} / -${otherDmg})`, 'damage');

                if (shooter.attacker.currentHp > 0 && shooter.attacker.abilities.includes('power')) {
                    shooter.attacker.atk += 1;
                    log(`💪 ${shooter.attacker.name} gagne +1 ATK!`, 'buff');
                }
                if (other.attacker.currentHp > 0 && other.attacker.abilities.includes('power')) {
                    other.attacker.atk += 1;
                    log(`💪 ${other.attacker.name} gagne +1 ATK!`, 'buff');
                }
            }
        } else if (bothShooters) {
            // Deux tireurs - vérifier l'initiative
            const oneHasInit = atk1.hasInitiative !== atk2.hasInitiative;

            if (oneHasInit) {
                // Un seul a initiative - il tire en premier
                const first = atk1.hasInitiative ? atk1 : atk2;
                const second = atk1.hasInitiative ? atk2 : atk1;
                const dmgFirst = first.attacker.atk;

                emitAnimation(room, 'attack', {
                    combatType: 'shooter',
                    attacker: first.attackerPlayer,
                    row: first.attackerRow,
                    col: first.attackerCol,
                    targetPlayer: second.attackerPlayer,
                    targetRow: second.attackerRow,
                    targetCol: second.attackerCol,
                    damage: dmgFirst,
                    isShooter: true
                });
                await sleep(800);

                second.attacker.currentHp -= dmgFirst;
                log(`⚔️ ${first.attacker.name} → ${second.attacker.name} (-${dmgFirst}) [Initiative]`, 'damage');

                if (second.attacker.currentHp > 0) {
                    if (second.attacker.abilities.includes('power')) {
                        second.attacker.atk += 1;
                        log(`💪 ${second.attacker.name} gagne +1 ATK!`, 'buff');
                    }
                    const dmgSecond = second.attacker.atk;

                    emitAnimation(room, 'attack', {
                        combatType: 'shooter',
                        attacker: second.attackerPlayer,
                        row: second.attackerRow,
                        col: second.attackerCol,
                        targetPlayer: first.attackerPlayer,
                        targetRow: first.attackerRow,
                        targetCol: first.attackerCol,
                        damage: dmgSecond,
                        isShooter: true
                    });
                    await sleep(800);

                    first.attacker.currentHp -= dmgSecond;
                    log(`↩️ ${second.attacker.name} → ${first.attacker.name} (-${dmgSecond})`, 'damage');

                    if (first.attacker.currentHp > 0 && first.attacker.abilities.includes('power')) {
                        first.attacker.atk += 1;
                        log(`💪 ${first.attacker.name} gagne +1 ATK!`, 'buff');
                    }
                }
            } else {
                // Les deux ont initiative OU aucun n'a initiative - projectiles croisés simultanés
                emitAnimation(room, 'attack', {
                    combatType: 'shooter',
                    attacker: atk1.attackerPlayer,
                    row: atk1.attackerRow,
                    col: atk1.attackerCol,
                    targetPlayer: atk2.attackerPlayer,
                    targetRow: atk2.attackerRow,
                    targetCol: atk2.attackerCol,
                    damage: dmg1,
                    isShooter: true
                });
                emitAnimation(room, 'attack', {
                    combatType: 'shooter',
                    attacker: atk2.attackerPlayer,
                    row: atk2.attackerRow,
                    col: atk2.attackerCol,
                    targetPlayer: atk1.attackerPlayer,
                    targetRow: atk1.attackerRow,
                    targetCol: atk1.attackerCol,
                    damage: dmg2,
                    isShooter: true
                });
                await sleep(800);

                // Dégâts simultanés
                atk2.attacker.currentHp -= dmg1;
                atk1.attacker.currentHp -= dmg2;

                log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${dmg1} / -${dmg2})`, 'damage');

                if (atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                    atk1.attacker.atk += 1;
                    log(`💪 ${atk1.attacker.name} gagne +1 ATK!`, 'buff');
                }
                if (atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                    atk2.attacker.atk += 1;
                    log(`💪 ${atk2.attacker.name} gagne +1 ATK!`, 'buff');
                }
            }
        } else {
            // Combat mêlée mutuel - vérifier l'initiative AVANT l'animation
            const bothInit = atk1.hasInitiative && atk2.hasInitiative;
            const neitherInit = !atk1.hasInitiative && !atk2.hasInitiative;
            const oneHasInit = !bothInit && !neitherInit;

            if (oneHasInit) {
                // Une seule a initiative - animation séquentielle
                const first = atk1.hasInitiative ? atk1 : atk2;
                const second = atk1.hasInitiative ? atk2 : atk1;
                const dmgFirst = first.attacker.atk;

                // D'abord la créature avec initiative attaque
                emitAnimation(room, 'attack', {
                    combatType: 'solo',
                    attacker: first.attackerPlayer,
                    row: first.attackerRow,
                    col: first.attackerCol,
                    targetPlayer: second.attackerPlayer,
                    targetRow: second.attackerRow,
                    targetCol: second.attackerCol,
                    damage: dmgFirst,
                    isFlying: first.isFlying
                });
                await sleep(800);

                // Appliquer les dégâts
                second.attacker.currentHp -= dmgFirst;
                log(`⚔️ ${first.attacker.name} → ${second.attacker.name} (-${dmgFirst}) [Initiative]`, 'damage');

                if (second.attacker.currentHp > 0) {
                    // La cible survit - elle riposte
                    if (second.attacker.abilities.includes('power')) {
                        second.attacker.atk += 1;
                        log(`💪 ${second.attacker.name} gagne +1 ATK!`, 'buff');
                    }
                    const dmgSecond = second.attacker.atk;

                    // Animation de riposte
                    emitAnimation(room, 'attack', {
                        combatType: 'solo',
                        attacker: second.attackerPlayer,
                        row: second.attackerRow,
                        col: second.attackerCol,
                        targetPlayer: first.attackerPlayer,
                        targetRow: first.attackerRow,
                        targetCol: first.attackerCol,
                        damage: dmgSecond,
                        isFlying: second.isFlying
                    });
                    await sleep(800);

                    first.attacker.currentHp -= dmgSecond;
                    log(`↩️ ${second.attacker.name} → ${first.attacker.name} (-${dmgSecond})`, 'damage');

                    if (first.attacker.currentHp > 0 && first.attacker.abilities.includes('power')) {
                        first.attacker.atk += 1;
                        log(`💪 ${first.attacker.name} gagne +1 ATK!`, 'buff');
                    }
                }
                // Pas besoin de l'animation mutual_melee ni du sleep(900) après
            } else {
                // Les deux ont initiative OU aucune n'a initiative - combat simultané
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
                atk2.attacker.currentHp -= dmg1;
                atk1.attacker.currentHp -= dmg2;

                log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${dmg1} / -${dmg2})`, 'damage');

                // Power
                if (atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                    atk1.attacker.atk += 1;
                    log(`💪 ${atk1.attacker.name} gagne +1 ATK!`, 'buff');
                }
                if (atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                    atk2.attacker.atk += 1;
                    log(`💪 ${atk2.attacker.name} gagne +1 ATK!`, 'buff');
                }
            }
        }
    } else {
        // Pas de combat mutuel - traiter les attaques

        // CAS SPÉCIAL : 2 attaques qui peuvent se faire en parallèle
        // (pas de combat mutuel, pas d'initiative exclusive)
        if (attacks.length === 2) {
            const atk1 = attacks[0];
            const atk2 = attacks[1];

            // Vérifier si l'une a une initiative exclusive sur l'autre
            const atk1HasExclusiveInit = atk1.hasInitiative && !atk2.hasInitiative;
            const atk2HasExclusiveInit = atk2.hasInitiative && !atk1.hasInitiative;

            // Si aucune n'a d'initiative exclusive, on les fait en parallèle
            if (!atk1HasExclusiveInit && !atk2HasExclusiveInit) {
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
                            const attackerOwner1 = room.gameState.players[atk1.attackerPlayer];
                            if (attackerOwner1.deck.length > 0) {
                                const drawnCard = attackerOwner1.deck.shift();
                                if (attackerOwner1.hand.length < 10) {
                                    attackerOwner1.hand.push(drawnCard);
                                    log(`  🎴 ${attackerCard1.name} déclenche: pioche ${drawnCard.name}`, 'action');
                                    emitAnimation(room, 'draw', { cards: [{ player: atk1.attackerPlayer, card: drawnCard, handIndex: attackerOwner1.hand.length - 1 }] });
                                } else {
                                    addToGraveyard(attackerOwner1, drawnCard);
                                    log(`  📦 Main pleine, ${drawnCard.name} va au cimetière`, 'damage');
                                }
                            }
                        }
                    } else {
                        const targetCard1 = room.gameState.players[atk1.targetPlayer].field[atk1.targetRow][atk1.targetCol];
                        if (targetCard1) {
                            targetCard1.currentHp -= damage1;
                            log(`⚔️ ${attackerCard1.name} → ${targetCard1.name} (-${damage1})`, 'damage');
                            if (targetCard1.currentHp > 0 && targetCard1.abilities.includes('power')) {
                                targetCard1.atk += 1;
                                log(`💪 ${targetCard1.name} gagne +1 ATK!`, 'buff');
                            }
                            // Riposte pour atk1
                            if (!targetCard1.canAttack && !atk1.isShooter) {
                                const riposteDmg = targetCard1.atk;
                                attackerCard1.currentHp -= riposteDmg;
                                log(`↩️ ${targetCard1.name} riposte → ${attackerCard1.name} (-${riposteDmg})`, 'damage');
                                emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: riposteDmg });
                            }
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
                            const attackerOwner2 = room.gameState.players[atk2.attackerPlayer];
                            if (attackerOwner2.deck.length > 0) {
                                const drawnCard = attackerOwner2.deck.shift();
                                if (attackerOwner2.hand.length < 10) {
                                    attackerOwner2.hand.push(drawnCard);
                                    log(`  🎴 ${attackerCard2.name} déclenche: pioche ${drawnCard.name}`, 'action');
                                    emitAnimation(room, 'draw', { cards: [{ player: atk2.attackerPlayer, card: drawnCard, handIndex: attackerOwner2.hand.length - 1 }] });
                                } else {
                                    addToGraveyard(attackerOwner2, drawnCard);
                                    log(`  📦 Main pleine, ${drawnCard.name} va au cimetière`, 'damage');
                                }
                            }
                        }
                    } else {
                        const targetCard2 = room.gameState.players[atk2.targetPlayer].field[atk2.targetRow][atk2.targetCol];
                        if (targetCard2) {
                            targetCard2.currentHp -= damage2;
                            log(`⚔️ ${attackerCard2.name} → ${targetCard2.name} (-${damage2})`, 'damage');
                            if (targetCard2.currentHp > 0 && targetCard2.abilities.includes('power')) {
                                targetCard2.atk += 1;
                                log(`💪 ${targetCard2.name} gagne +1 ATK!`, 'buff');
                            }
                            // Riposte pour atk2
                            if (!targetCard2.canAttack && !atk2.isShooter) {
                                const riposteDmg = targetCard2.atk;
                                attackerCard2.currentHp -= riposteDmg;
                                log(`↩️ ${targetCard2.name} riposte → ${attackerCard2.name} (-${riposteDmg})`, 'damage');
                                emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: riposteDmg });
                            }
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
                    return false;
                }
            }
        }

        // Traitement séquentiel standard (1 attaque ou initiative exclusive)
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

                // Capacité spéciale: piocher une carte quand attaque un héros
                if (attackerCard.onHeroHit === 'draw') {
                    const attackerOwner = room.gameState.players[atk.attackerPlayer];
                    if (attackerOwner.deck.length > 0) {
                        const drawnCard = attackerOwner.deck.shift();
                        if (attackerOwner.hand.length < 10) {
                            attackerOwner.hand.push(drawnCard);
                            log(`  🎴 ${attackerCard.name} déclenche: pioche ${drawnCard.name}`, 'action');
                            emitAnimation(room, 'draw', { cards: [{ player: atk.attackerPlayer, card: drawnCard, handIndex: attackerOwner.hand.length - 1 }] });
                        } else {
                            addToGraveyard(attackerOwner, drawnCard);
                            log(`  📦 Main pleine, ${drawnCard.name} va au cimetière`, 'damage');
                        }
                    }
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

                targetCard.currentHp -= damage;
                log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${damage})`, 'damage');

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
                    // Afficher les dégâts de riposte
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
        for (const d of deaths) {
            addToGraveyard(room.gameState.players[d.player], d.card);
            room.gameState.players[d.player].field[d.row][d.col] = null;
            log(`☠️ ${d.card.name} détruit!`, 'damage');
            emitAnimation(room, 'death', { player: d.player, row: d.row, col: d.col });
        }
        await sleep(600); // Attendre l'animation de mort (une seule fois pour toutes)
        emitStateToBoth(room);
        // Capacités onDeath
        for (const d of deaths) {
            await processOnDeathAbility(room, d.card, d.player, log, sleep);
        }
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
            room.gameState.players[atk.targetPlayer].heroAttackedThisTurn = true;
            log(`⚔️ ${attackerCard.name} → ${room.gameState.players[atk.targetPlayer].heroName} (-${attackerCard.atk})`, 'damage');
            emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: attackerCard.atk });
            io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: attackerCard.atk });

            // Capacité spéciale: piocher une carte quand attaque un héros
            if (attackerCard.onHeroHit === 'draw') {
                const attackerOwner = room.gameState.players[atk.attackerPlayer];
                if (attackerOwner.deck.length > 0) {
                    const drawnCard = attackerOwner.deck.shift();
                    if (attackerOwner.hand.length < 10) {
                        attackerOwner.hand.push(drawnCard);
                        log(`  🎴 ${attackerCard.name} déclenche: pioche ${drawnCard.name}`, 'action');
                        emitAnimation(room, 'draw', { cards: [{ player: atk.attackerPlayer, card: drawnCard, handIndex: attackerOwner.hand.length - 1 }] });
                    } else {
                        addToGraveyard(attackerOwner, drawnCard);
                        log(`  📦 Main pleine, ${drawnCard.name} va au cimetière`, 'damage');
                    }
                }
            }

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
        targetOwner.heroAttackedThisTurn = true;
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
    // - Attaque d'abord DEVANT (col 1) si c'est un tireur ou volant
    // - Puis DERRIÈRE (col 0) si c'est un tireur ou volant
    // - Sinon attaque le héros directement (passe au-dessus des normales)
    if (isFlying) {
        // Volant regarde d'abord devant (front = col 1)
        if (effectiveFront && (frontIsFlying || frontIsShooter)) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        // Puis derrière si c'est un volant ou tireur
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