const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Import game modules
const { CardDB, HERO_NAMES, HEROES, resetCardForGraveyard, addToGraveyard, createDeck, createPlayerState, createGameState } = require('./game/cards');

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
    player.confirmedHandCount = player.hand.length;
    // Figer l'état revealed de la main pour l'adversaire (ne change pas pendant le planning)
    player.confirmedOppHand = player.hand.map(c => c.revealedToOpponent ? c : null);
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

    // Recalculer poisonX (poisonPerGraveyard) à chaque émission de state
    const patchPoison = (card, graveyardLen, source) => {
        if (!card || !card.poisonPerGraveyard) return card;
        const basePoisonX = card.basePoisonX ?? card.poisonX ?? 1;
        if (card.basePoisonX === undefined) card.basePoisonX = basePoisonX;
        card.poisonX = basePoisonX + Math.floor(graveyardLen / card.poisonPerGraveyard);
        return card;
    };
    const patchField = (field, graveyardLen, source) => field.map(row => row.map(card => patchPoison(card, graveyardLen, source)));

    const meGraveyardLen = me.graveyard.length;
    const oppGraveyardLen = opp.graveyard.length;

    // Patch main
    for (const card of me.hand) patchPoison(card, meGraveyardLen, 'HAND');

    // Patch terrain — on crée toujours une copie mappée pour garantir les bonnes valeurs
    let meField = patchField(me.field, meGraveyardLen, 'ME_FIELD');
    if (isRevealing) {
        meField = meField.map(row => row.map(card =>
            card && card.ownerAtk !== undefined ? { ...card, atk: card.ownerAtk } : card
        ));
    }

    // Patch le terrain adverse aussi
    if (oppField === opp.field) {
        oppField = patchField(opp.field, oppGraveyardLen, 'OPP_FIELD');
    } else {
        oppField = patchField(oppField, oppGraveyardLen, 'OPP_FIELD_CLONE');
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
            field: meField,
            traps: me.traps,
            trapCards: me.trapCards, // Cartes pièges pour l'affichage hover
            graveyard: me.graveyard,
            graveyardCount: me.graveyard.length,
            ready: me.ready,
            inDeployPhase: me.inDeployPhase,
            heroName: me.heroName,
            hero: me.hero,
            spellsCastThisTurn: me.spellsCastThisTurn || 0,
            spellBoost: getSpellBoost(room, forPlayer),
            totalPoisonCounters: countTotalPoisonCounters(room)
        },
        opponent: {
            hp: opp.hp,
            energy: opp.energy,
            maxEnergy: opp.maxEnergy,
            handCount: isPlanning && opp.confirmedHandCount !== undefined
                ? opp.confirmedHandCount
                : opp.hand.length + (opp.handCountBonus || 0),
            oppHand: isPlanning && opp.confirmedHandCount !== undefined
                ? (opp.confirmedOppHand || Array(opp.confirmedHandCount).fill(null))
                : [...opp.hand.map(c => c.revealedToOpponent ? c : null), ...(opp.handBonusCards || Array(opp.handCountBonus || 0).fill(null))],
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

// Retirer une carte de confirmedOppHand (par uid si revealed, sinon un null)
function removeFromConfirmedHand(player, card) {
    if (!player.confirmedOppHand) return;
    if (card && card.uid) {
        const idx = player.confirmedOppHand.findIndex(c => c && c.uid === card.uid);
        if (idx !== -1) { player.confirmedOppHand.splice(idx, 1); return; }
    }
    // Carte cachée : retirer le premier null
    const nullIdx = player.confirmedOppHand.indexOf(null);
    if (nullIdx !== -1) player.confirmedOppHand.splice(nullIdx, 1);
}

function removeHandBonus(player, card) {
    player.handCountBonus = Math.max(0, (player.handCountBonus || 0) - 1);
    if (player.handBonusCards && player.handBonusCards.length > 0) {
        // Si la carte est revealed, retirer l'entrée correspondante par uid
        if (card && card.uid && card.revealedToOpponent) {
            const idx = player.handBonusCards.findIndex(c => c && c.uid === card.uid);
            if (idx !== -1) { player.handBonusCards.splice(idx, 1); return; }
        }
        // Sinon retirer le premier null (carte cachée)
        const nullIdx = player.handBonusCards.indexOf(null);
        if (nullIdx !== -1) player.handBonusCards.splice(nullIdx, 1);
        else player.handBonusCards.pop(); // fallback
    }
}

function emitAnimation(room, type, data) {
    io.to(room.code).emit('animation', { type, ...data });
}

/**
 * Applique des dégâts à une créature avec gestion de la Protection.
 * Retourne les dégâts réellement infligés (0 si bloqué par protection).
 */
function applyCreatureDamage(card, damage, room, log, ownerPlayer, row, col, sourceCreature) {
    if (card.hasProtection && damage > 0) {
        card.hasProtection = false;
        log(`🛡️ ${card.name} : Protection absorbe ${damage} dégâts!`, 'buff');
        emitAnimation(room, 'shield', { player: ownerPlayer, row: row, col: col });
        return 0;
    }
    // Spectral : divise les dégâts de combat par 2 (arrondi inférieur)
    if (sourceCreature && card.abilities && card.abilities.includes('spectral') && damage > 0) {
        const originalDamage = damage;
        damage = Math.floor(damage / 2);
        log(`👻 Spectral : ${card.name} réduit ${originalDamage} → ${damage} dégâts`, 'buff');
    }
    const hpBefore = card.currentHp;
    card.currentHp -= damage;
    card.damagedThisTurn = true;
    // Log lifelink-related creatures
    if (card.abilities && card.abilities.includes('lifelink')) {
    }
    // Lethal (toucher mortel) : si la source a 'lethal' et inflige des dégâts, la cible meurt
    if (sourceCreature && damage > 0 && card.currentHp > 0) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('lethal')) {
            log(`💀 Toucher mortel : ${srcCard.name} tue ${card.name}!`, 'damage');
            card.currentHp = 0;
        }
    }
    // Poison : si la source a 'poison' et inflige des dégâts de combat, ajouter des compteurs poison
    if (sourceCreature && damage > 0 && card.currentHp > 0) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('poison')) {
            const poisonAmount = srcCard.poisonX || 1;
            card.poisonCounters = (card.poisonCounters || 0) + poisonAmount;
            log(`☠️ Poison : ${srcCard.name} inflige ${poisonAmount} compteur(s) poison à ${card.name} (total: ${card.poisonCounters})`, 'damage');
        }
    }
    // Entrave : si la source a 'entrave' et inflige des dégâts de combat, ajouter des marqueurs entrave
    if (sourceCreature && damage > 0 && card.currentHp > 0) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('entrave')) {
            const entraveAmount = srcCard.entraveX || 1;
            card.entraveCounters = (card.entraveCounters || 0) + entraveAmount;
            log(`🕸️ Entrave : ${srcCard.name} inflige ${entraveAmount} marqueur(s) Entrave à ${card.name} (total: ${card.entraveCounters})`, 'damage');
            emitAnimation(room, 'entrave', { player: ownerPlayer, row, col, amount: entraveAmount });
        }
    }
    // Lifelink : accumuler le soin fixe (lifelinkX) pour le héros
    if (sourceCreature && damage > 0) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('lifelink') && srcCard.lifelinkX) {
            srcCard.pendingLifelinkHeal = (srcCard.pendingLifelinkHeal || 0) + srcCard.lifelinkX;
        }
        // Lifedrain : soin fixe (lifedrainX) au lieu des dégâts infligés
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('lifedrain') && srcCard.lifedrainX) {
            srcCard.pendingLifelinkHeal = (srcCard.pendingLifelinkHeal || 0) + srcCard.lifedrainX;
        }
    }
    // Track which creature killed this one (for onDeath.damageKiller)
    if (sourceCreature && card.currentHp <= 0) {
        card.killedBy = sourceCreature;
    }
    return damage;
}

// Lifelink : accumuler le soin fixe (lifelinkX) pour le héros
function accumulateLifelink(attackerCard, damageDealt) {
    if (!attackerCard || damageDealt <= 0) return;
    if (attackerCard.abilities && attackerCard.abilities.includes('lifelink') && attackerCard.lifelinkX) {
        attackerCard.pendingLifelinkHeal = (attackerCard.pendingLifelinkHeal || 0) + attackerCard.lifelinkX;
    }
    // Lifedrain : soin fixe au lieu des dégâts infligés
    if (attackerCard.abilities && attackerCard.abilities.includes('lifedrain') && attackerCard.lifedrainX) {
        attackerCard.pendingLifelinkHeal = (attackerCard.pendingLifelinkHeal || 0) + attackerCard.lifedrainX;
    }
}

// Applique tous les soins Lifelink en attente sur le terrain (après un échange complet)
// Async : attend que le client ait eu le temps d'afficher les dégâts avant de soigner
async function applyPendingLifelinkHeals(room, log) {
    // Vérifier s'il y a des heals en attente avant d'ajouter un délai
    let hasPending = false;
    for (let p = 1; p <= 2 && !hasPending; p++) {
        for (let r = 0; r < 4 && !hasPending; r++) {
            for (let c = 0; c < 2 && !hasPending; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.pendingLifelinkHeal && card.currentHp > 0) hasPending = true;
            }
        }
    }

    if (!hasPending) {
        return;
    }

    // Attendre que les animations de dégâts se terminent côté client
    // pour que le joueur VOIE les HP réduits avant le soin
    await new Promise(r => setTimeout(r, 800));

    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (!card) continue;
                if (card.pendingLifelinkHeal) {
                }
                if (!card.pendingLifelinkHeal) continue;
                const healAmount = card.pendingLifelinkHeal;
                delete card.pendingLifelinkHeal;
                if (card.currentHp <= 0) {
                    continue;
                }
                // Lifelink : soigne le héros ; Lifedrain : soigne la créature
                const isLifelink = card.abilities && card.abilities.includes('lifelink');
                if (isLifelink) {
                    const hero = room.gameState.players[p];
                    const oldHeroHp = hero.hp;
                    hero.hp = Math.min(20, oldHeroHp + healAmount);
                    const healed = hero.hp - oldHeroHp;
                    if (healed > 0) {
                        log(`🩸 Lien vital : ${card.name} soigne ${hero.heroName} de ${healed} PV (${oldHeroHp} → ${hero.hp})`, 'buff');
                        emitAnimation(room, 'lifesteal', { player: p, row: r, col: c, amount: healed, heroHeal: true });
                    }
                } else {
                    const maxHp = card.hp;
                    const oldHp = card.currentHp;
                    card.currentHp = Math.min(maxHp, oldHp + healAmount);
                    const healed = card.currentHp - oldHp;
                    if (healed > 0) {
                        log(`🩸 Drain de vie : ${card.name} se soigne de ${healed} PV (${oldHp} → ${card.currentHp})`, 'buff');
                        emitAnimation(room, 'lifesteal', { player: p, row: r, col: c, amount: healed });
                    }
                }
            }
        }
    }
    // Émettre l'état après le soin pour que le client voit les HP soignés
    emitStateToBoth(room);
}

// Applique les soins "healOnEnemyPoisonDeath" pour les créatures alliées quand un ennemi meurt du poison
async function applyHealOnEnemyPoisonDeath(room, poisonDeaths, log) {
    let anyHeal = false;
    for (const d of poisonDeaths) {
        // Le propriétaire de la Reine toxique est l'adversaire de la créature morte
        const ownerNum = d.player === 1 ? 2 : 1;
        const ownerField = room.gameState.players[ownerNum].field;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const ally = ownerField[r][c];
                if (ally && ally.currentHp > 0 && ally.healOnEnemyPoisonDeath) {
                    const healAmount = ally.healOnEnemyPoisonDeath;
                    const oldHp = ally.currentHp;
                    ally.currentHp = Math.min(ally.hp, oldHp + healAmount);
                    const healed = ally.currentHp - oldHp;
                    if (healed > 0) {
                        log(`🕷️ ${ally.name} se soigne de ${healed} PV (mort poison de ${d.card.name})`, 'buff');
                        emitAnimation(room, 'healOnDeath', { player: ownerNum, row: r, col: c, amount: healed });
                        anyHeal = true;
                    }
                }
            }
        }
    }
    if (anyHeal) {
        emitStateToBoth(room);
        await new Promise(r => setTimeout(r, 800));
    }
}

// Legacy wrapper — maintenu pour les appels existants qui ne sont pas liés au poison
async function applyPendingHealOnDeath(room, log) {
    // Plus utilisé (l'ancien healOnAnyDeath a été remplacé par healOnEnemyPoisonDeath)
}

// Calcule les dégâts effectifs après spectral (sans les appliquer)
function getEffectiveCombatDamage(card, damage) {
    if (card.hasProtection) return 0;
    if (card.abilities && card.abilities.includes('spectral') && damage > 0) {
        return Math.floor(damage / 2);
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
                canAttack: !!(template.abilities && (template.abilities.includes('haste') || template.abilities.includes('superhaste'))),
                turnsOnField: 0,
                movedThisTurn: false,
            };
            if (newCard.abilities.includes('protection')) newCard.hasProtection = true;
            if (newCard.abilities.includes('camouflage')) newCard.hasCamouflage = true;
            if (newCard.abilities.includes('untargetable')) newCard.hasUntargetable = true;
            newCard.summonOrder = card.summonOrder || 0;
            player.field[row][col] = newCard;
            // Synchroniser revealField si en phase de révélation
            if (player.revealField) player.revealField[row][col] = newCard;
            log(`🔄 ${card.name} se transforme en ${newCard.name}!`, 'special');
            recalcDynamicAtk(room);
            return { transformed: true, newCard };
        } else {
        }
    }

    // Dissipation : la créature disparaît du jeu sans aller au cimetière
    if (!card.abilities?.includes('dissipation')) {
        addToGraveyard(player, card);
    }
    player.field[row][col] = null;
    // Synchroniser revealField si en phase de révélation
    if (player.revealField) player.revealField[row][col] = null;

    // Soif de sang : les créatures ennemies avec bloodthirst gagnent +X ATK permanent
    const enemyPlayerNum = playerNum === 1 ? 2 : 1;
    const enemyPlayer = room.gameState.players[enemyPlayerNum];
    for (let r = 0; r < enemyPlayer.field.length; r++) {
        for (let c = 0; c < enemyPlayer.field[r].length; c++) {
            const ally = enemyPlayer.field[r][c];
            if (ally && ally.currentHp > 0 && ally.abilities?.includes('bloodthirst')) {
                const amount = ally.bloodthirstAmount || 1;
                ally.bloodthirstStacks = (ally.bloodthirstStacks || 0) + amount;
            }
        }
    }

    // onAdjacentAllyDeath : buff les créatures alliées adjacentes au mort (ex: Mère des damnés)
    const neighbors = [[row - 1, col], [row + 1, col], [row, col === 0 ? 1 : 0]];
    for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= 4 || nc < 0 || nc >= 2) continue;
        const neighbor = player.field[nr][nc];
        if (neighbor && neighbor.currentHp > 0 && neighbor.onAdjacentAllyDeath) {
            const atkGain = neighbor.onAdjacentAllyDeath.atk || 0;
            const hpGain = neighbor.onAdjacentAllyDeath.hp || 0;
            // Sauvegarder les stats de base AVANT le buff (pour affichage boosted en vert)
            if (neighbor.baseAtk === undefined) neighbor.baseAtk = neighbor.atk;
            if (neighbor.baseHp === undefined) neighbor.baseHp = neighbor.hp;
            if (atkGain > 0) {
                neighbor.buffCounters = (neighbor.buffCounters || 0) + atkGain;
            }
            if (hpGain > 0) {
                neighbor.hp += hpGain;
                neighbor.currentHp += hpGain;
            }
            log(`  👩 ${neighbor.name} gagne +${atkGain}/+${hpGain} (mort de ${card.name})`, 'buff');
            emitAnimation(room, 'buffApply', { player: playerNum, row: nr, col: nc, atkBuff: atkGain, hpBuff: hpGain });
        }
    }

    recalcDynamicAtk(room);
    return { transformed: false, newCard: null };
}

/**
 * Recalcule l'ATK des créatures avec atkPerAllyType (ex: Lance gobelin).
 * Compte les créatures vivantes du type allié sur le terrain du joueur,
 * et met à jour card.atk = baseAtk + count (+ tempAtkBoost éventuel).
 */
function recalcDynamicAtk(room, excludeSlots) {
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        const excluded = excludeSlots && excludeSlots[p] ? [...excludeSlots[p]] : [];
        // Compter les créatures vivantes par type (en excluant les slots pas encore révélés)
        const typeCounts = {};
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                if (excludeSlots && excludeSlots[p] && excludeSlots[p].has(`${r},${c}`)) {
                    const skippedCard = player.field[r][c];
                    continue;
                }
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.creatureType) {
                    typeCounts[card.creatureType] = (typeCounts[card.creatureType] || 0) + 1;
                }
            }
        }
        // Calculer les bonus d'Amélioration (enhance) par slot
        const enhanceBonus = {};
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                if (excludeSlots && excludeSlots[p] && excludeSlots[p].has(`${r},${c}`)) continue;
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.abilities?.includes('enhance')) {
                    const amount = card.enhanceAmount || 1;
                    // Buff les 3 voisins orthogonaux (haut, bas, même rangée autre colonne)
                    const neighbors = [[r - 1, c], [r + 1, c], [r, c === 0 ? 1 : 0]];
                    for (const [nr, nc] of neighbors) {
                        if (nr >= 0 && nr < player.field.length) {
                            const key = `${nr},${nc}`;
                            enhanceBonus[key] = (enhanceBonus[key] || 0) + amount;
                        }
                    }
                }
            }
        }

        // Mettre à jour l'ATK des créatures avec bonus dynamique
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                const card = player.field[r][c];
                if (!card || card.currentHp <= 0) continue;
                const enhance = enhanceBonus[`${r},${c}`] || 0;
                const base = card.baseAtk ?? card.atk;
                const bt = card.bloodthirstStacks || 0;
                const pw = card.powerStacks || 0;
                const sas = card.sacrificeAtkStacks || 0;

                // Bonus atkPerAdjacent : +X par créature vivante adjacente
                let adjBonus = 0;
                if (card.atkPerAdjacent) {
                    const neighbors = [[r - 1, c], [r + 1, c], [r, c === 0 ? 1 : 0]];
                    for (const [nr, nc] of neighbors) {
                        if (nr >= 0 && nr < player.field.length) {
                            if (excludeSlots && excludeSlots[p] && excludeSlots[p].has(`${nr},${nc}`)) continue;
                            const neighbor = player.field[nr][nc];
                            if (neighbor && neighbor.currentHp > 0) adjBonus += card.atkPerAdjacent;
                        }
                    }
                }

                // Bonus atkPerGraveyard : +1 par créature dans le cimetière du joueur
                let graveyardBonus = 0;
                if (card.atkPerGraveyard) {
                    graveyardBonus = player.graveyard.filter(g => g.type === 'creature').length;
                }

                // Poison dynamique (poisonPerGraveyard) : +1 Poison par tranche de X cartes au cimetière
                if (card.poisonPerGraveyard) {
                    const basePoisonX = card.basePoisonX ?? card.poisonX ?? 1;
                    if (card.basePoisonX === undefined) card.basePoisonX = basePoisonX;
                    const graveyardCount = player.graveyard.length;
                    card.poisonX = basePoisonX + Math.floor(graveyardCount / card.poisonPerGraveyard);
                }

                // Bonus buffCounters (Armes magiques) : +1 ATK par marqueur
                const bc = card.buffCounters || 0;

                // atkPerPoisonInPlay : ATK = nombre total de marqueurs poison en jeu
                if (card.atkPerPoisonInPlay) {
                    const entraveMalus = card.entraveCounters || 0;
                    card.atk = Math.max(0, countTotalPoisonCounters(room) + bc - entraveMalus);
                    continue;
                }

                // Malus Entrave : -1 ATK par marqueur Entrave
                const entraveMalus = card.entraveCounters || 0;

                const sab = card.spellAtkBuff || 0;
                if (card.atkPerAllyType) {
                    const count = typeCounts[card.atkPerAllyType] || 0;
                    card.atk = Math.max(0, base + count + sab + (card.tempAtkBoost || 0) + enhance + bt + pw + sas + adjBonus + graveyardBonus + bc - entraveMalus);
                } else if (graveyardBonus > 0 || entraveMalus > 0 || pw > 0 || bc !== 0 || sab > 0 || sas > 0) {
                    card.atk = Math.max(0, base + sab + (card.tempAtkBoost || 0) + enhance + bt + pw + sas + adjBonus + graveyardBonus + bc - entraveMalus);
                } else if (adjBonus > 0 || enhance > 0 || bt > 0 || card.atk !== base + (card.tempAtkBoost || 0)) {
                    card.atk = base + (card.tempAtkBoost || 0) + enhance + bt + adjBonus;
                }
            }
        }
    }

}

// Calcule le bonus de dégâts de sorts pour un joueur (Sort renforcé)
function getSpellBoost(room, playerNum) {
    const player = room.gameState.players[playerNum];
    let boost = 0;
    for (let r = 0; r < player.field.length; r++) {
        for (let c = 0; c < player.field[r].length; c++) {
            const card = player.field[r][c];
            if (card && card.currentHp > 0 && card.abilities?.includes('spellBoost')) {
                boost += (card.spellBoostAmount || 1);
            }
        }
    }
    return boost;
}

// Compte le nombre total de marqueurs poison sur toutes les créatures en jeu (les 2 joueurs)
function countTotalPoisonCounters(room) {
    let total = 0;
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.poisonCounters > 0) {
                    total += card.poisonCounters;
                }
            }
        }
    }
    return total;
}

// Trouve la première créature ennemie "en face" d'une position (même rangée, colonne intérieure d'abord)
// Ignore les créatures pétrifiées
function getFacingCreature(room, playerNum, row) {
    const enemyNum = playerNum === 1 ? 2 : 1;
    const enemy = room.gameState.players[enemyNum];
    // Colonne intérieure (proche du centre) en premier : col 1 pour les deux joueurs
    // Board visuel : C1(col0) D1(col1) | centre | D2(col1) C2(col0)
    const colOrder = [1, 0];
    for (const col of colOrder) {
        const card = enemy.field[row][col];
        if (card && card.currentHp > 0 && !card.petrified) {
            return { card, row, col, playerNum: enemyNum };
        }
    }
    return null;
}

// Calcule les créatures bloquées par Mélodie et met à jour les gaze trackers
function processMelodyEffects(room) {
    // Reset melody locks et gaze markers
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                const card = player.field[r][c];
                if (card) {
                    card.melodyLocked = false;
                    card.medusaGazeMarker = 0;
                }
            }
        }
    }
    // Apply melody from all creatures with melody ability
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.abilities?.includes('melody')) {
                    const facing = getFacingCreature(room, p, r);
                    if (facing) {
                        facing.card.melodyLocked = true;
                        // Marquer le gaze counter pour l'affichage client
                        if (card.medusaGazeUid === facing.card.uid && card.medusaGazeTurns >= 1) {
                            facing.card.medusaGazeMarker = card.medusaGazeTurns;
                        }
                    }
                }
            }
        }
    }
}

// Traite les effets Mélodie + Pétrification pour UNE ligne donnée (appelé juste avant le combat de cette ligne)
async function processMelodyForRow(room, row, log, sleep) {
    let hadEffect = false;
    let hadPetrify = false;
    let hadGazeAnim = false;

    // Nettoyer les effets melody de la phase de planning pour cette row
    // (le mouvement a pu changer qui fait face à qui)
    let hadClear = false;
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (let c = 0; c < 2; c++) {
            const card = player.field[row][c];
            if (card && (card.melodyLocked || card.medusaGazeMarker > 0)) {
                card.melodyLocked = false;
                card.medusaGazeMarker = 0;
                hadClear = true;
            }
        }
    }

    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (let c = 0; c < 2; c++) {
            const card = player.field[row][c];
            if (!card || card.currentHp <= 0 || !card.abilities?.includes('melody')) continue;

            const facing = getFacingCreature(room, p, row);
            if (!facing) {
                card.medusaGazeUid = null;
                card.medusaGazeTurns = 0;
                continue;
            }

            // Appliquer le visuel melody (terni + pastille) + bloquer l'attaque ce tour
            facing.card.melodyLocked = true;
            facing.card.canAttack = false;
            hadEffect = true;

            // Incrémenter le gaze tracker
            if (card.medusaGazeUid && facing.card.uid === card.medusaGazeUid) {
                card.medusaGazeTurns = (card.medusaGazeTurns || 0) + 1;
            } else {
                card.medusaGazeUid = facing.card.uid;
                card.medusaGazeTurns = 1;
            }

            if (card.medusaGazeTurns >= 2) {
                // Pétrification directe — pas de pastille "2", on passe direct à l'effet
                facing.card.medusaGazeMarker = 0;
                const target = facing.card;
                const heroName = room.gameState.players[p].heroName || `Joueur ${p}`;
                target.petrified = true;
                target.melodyLocked = false;
                target.atk = 0;
                target.baseAtk = 0;
                target.spellAtkBuff = 0;
                target.currentHp = 10;
                target.hp = 10;
                target.baseHp = 10;
                target.abilities = [];
                target.hasProtection = false;
                target.canAttack = false;
                target.petrifiedDescription = 'Pétrifié — ne peut ni attaquer ni bloquer.';

                emitStateToBoth(room);

                emitAnimation(room, 'petrify', {
                    player: facing.playerNum,
                    row: facing.row,
                    col: facing.col,
                    cardName: target.name
                });
                log(`  🪨 ${heroName}: ${card.name} pétrifie ${target.name} !`, 'special');
                await sleep(1500);

                card.medusaGazeUid = null;
                card.medusaGazeTurns = 0;
                hadPetrify = true;
            } else {
                // Marquer le gaze counter pour l'affichage client (seulement si pas de pétrification)
                facing.card.medusaGazeMarker = card.medusaGazeTurns;
                // Animation oeil de Medusa → rayon vers la cible
                emitAnimation(room, 'melodyGaze', {
                    srcPlayer: p,
                    srcRow: row,
                    srcCol: c,
                    tgtPlayer: facing.playerNum,
                    tgtRow: facing.row,
                    tgtCol: facing.col,
                    cardName: card.name,
                    targetName: facing.card.name,
                });
                hadGazeAnim = true;
            }
        }
    }

    // Envoyer le state + attendre l'animation gaze si on a eu des effets melody sans pétrification
    if (hadEffect && !hadPetrify) {
        emitStateToBoth(room);
        await sleep(hadGazeAnim ? 1500 : 400);
    } else if (hadClear && !hadEffect) {
        // Medusa a bougé : les effets melody ont été nettoyés, montrer le retour à la normale avant le combat
        emitStateToBoth(room);
        await sleep(500);
    }
}

// Buff les créatures avec onAllySacrifice quand une créature alliée est sacrifiée
// Erebeth : quand le joueur sacrifie une créature, l'adversaire perd 1 PV et le joueur gagne 1 PV par sacrifice
function applyErebethSacrifice(room, playerNum, sacrificeCount, log) {
    const player = room.gameState.players[playerNum];
    if (!player.hero || player.hero.id !== 'erebeth') return;
    const opponentNum = playerNum === 1 ? 2 : 1;
    const opponent = room.gameState.players[opponentNum];
    const drain = sacrificeCount;
    opponent.hp -= drain;
    const oldHp = player.hp;
    player.hp = Math.min(20, player.hp + drain);
    const healed = player.hp - oldHp;
    log(`  💀 ${player.heroName} (Erebeth) : -${drain} PV à ${opponent.heroName}${healed > 0 ? `, +${healed} PV régénérés` : ''}`, 'special');
    emitAnimation(room, 'heroHit', { defender: opponentNum, damage: drain });
    if (healed > 0) emitAnimation(room, 'heroHeal', { player: playerNum, amount: healed });
}

function applyOnAllySacrifice(room, playerNum, sacrificeCount, log) {
    const player = room.gameState.players[playerNum];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const card = player.field[r][c];
            if (card && card.currentHp > 0 && card.onAllySacrifice) {
                const atkGain = (card.onAllySacrifice.atkBuff || 0) * sacrificeCount;
                const hpGain = (card.onAllySacrifice.hpBuff || 0) * sacrificeCount;
                card.hp += hpGain;
                card.currentHp += hpGain;
                // Ne PAS toucher baseHp/baseAtk → le client affiche les stats en vert (boosted)
                card.sacrificeAtkStacks = (card.sacrificeAtkStacks || 0) + atkGain;
                card.atk += atkGain;
                log(`  🧛 ${card.name} gagne +${atkGain} ATK / +${hpGain} HP (sacrifice)`, 'buff');
                emitAnimation(room, 'buffApply', { player: playerNum, row: r, col: c, atkBuff: atkGain, hpBuff: hpGain });
            }
        }
    }
}

// Traite les capacités onSummon d'une créature qui vient d'entrer en jeu
// deferredDestructions : tableau où empiler les destructions (résolues après tous les onSummon)
async function processOnSummonAbility(room, card, playerNum, row, col, log, sleep, deferredDestructions = null) {
    if (!card.onSummon && !card.sacrifice) return;
    const player = room.gameState.players[playerNum];
    const heroName = room.gameState.players[playerNum].heroName || `Joueur ${playerNum}`;

    // Sacrifice : sacrifier X créatures adjacentes pouvant attaquer (ordre horaire)
    if (card.sacrifice) {
        const targets = getAdjacentSacrificeTargets(player.field, row, col);
        const toSacrifice = targets.slice(0, card.sacrifice);

        // Petit délai avant le sacrifice pour séparer visuellement de l'invocation
        await sleep(600);

        const sacrificedCards = [];
        for (const target of toSacrifice) {
            const sacrificed = player.field[target.row][target.col];
            if (!sacrificed) continue;
            log(`  💀 ${heroName}: ${card.name} sacrifie ${sacrificed.name}`, 'damage');

            // D'abord résoudre la mort pour savoir si la créature se transforme
            const result = handleCreatureDeath(room, sacrificed, playerNum, target.row, target.col, log);
            sacrificedCards.push({ card: sacrificed, player: playerNum, row: target.row, col: target.col });

            if (result.transformed) {
                // Créature avec onDeath.transformInto (ex: Little Bone → Pile d'os, Gobelin Jumeau → Faux Jumeaux)
                // Envoyer blood slash + deathTransform (flip dans le slot)
                emitAnimation(room, 'sacrifice', { player: playerNum, row: target.row, col: target.col, card: sacrificed, noFlyToGrave: true });
                emitAnimation(room, 'deathTransform', { player: playerNum, row: target.row, col: target.col, fromCard: sacrificed, toCard: result.newCard });
                // Synchroniser revealField avec la nouvelle carte
                if (player.revealField) {
                    player.revealField[target.row][target.col] = result.newCard;
                }
                emitStateToBoth(room);
                await sleep(1600); // 500ms VFX slash + 600ms flip + marge
            } else {
                // Mort normale : blood slash + fly-to-graveyard
                emitAnimation(room, 'sacrifice', { player: playerNum, row: target.row, col: target.col, card: sacrificed });
                await sleep(20); // Laisser le client recevoir l'animation et bloquer le slot
                // Mettre aussi à jour revealField si revealing est actif
                if (player.revealField) {
                    player.revealField[target.row][target.col] = null;
                }
                emitStateToBoth(room);
                await sleep(1600); // 500ms VFX slash + 900ms fly-to-graveyard + marge
            }
        }
        // Buff onAllySacrifice (ex: Vampire sordide) + Erebeth
        if (sacrificedCards.length > 0) {
            applyOnAllySacrifice(room, playerNum, sacrificedCards.length, log);
            applyErebethSacrifice(room, playerNum, sacrificedCards.length, log);
        }
        // Effets onSacrifice des créatures sacrifiées (ex: Zobombie)
        for (const sc of sacrificedCards) {
            if (sc.card.onSacrifice && sc.card.onSacrifice.damageOpponent) {
                const opNum = sc.player === 1 ? 2 : 1;
                const dmg = sc.card.onSacrifice.damageOpponent;
                room.gameState.players[opNum].hp -= dmg;
                log(`  💥 ${sc.card.name} inflige ${dmg} dégât(s) à ${room.gameState.players[opNum].heroName} (sacrifice)`, 'damage');
                emitAnimation(room, 'heroHit', { defender: opNum, damage: dmg });
            }
        }
        // Bonus du sacrificateur basé sur l'ATK des créatures sacrifiées (Zealot of the elder)
        if (card.sacrificeBonus && sacrificedCards.length > 0) {
            const totalAtk = sacrificedCards.reduce((sum, sc) => sum + (sc.card.atk || 0), 0);
            if (totalAtk > 0) {
                if (card.sacrificeBonus.healPerAtk) {
                    const oldHp = player.hp;
                    player.hp = Math.min(20, player.hp + totalAtk);
                    const healed = player.hp - oldHp;
                    if (healed > 0) {
                        log(`  💚 ${heroName}: ${card.name} → +${healed} PV (sacrifice)`, 'heal');
                        emitAnimation(room, 'heroHeal', { player: playerNum, amount: healed });
                    }
                }
                if (card.sacrificeBonus.absorbStats) {
                    let totalAtkGain = 0, totalHpGain = 0;
                    for (const sc of sacrificedCards) {
                        const atkGain = sc.card.baseAtk || sc.card.atk || 0;
                        const hpGain = sc.card.baseHp || sc.card.hp || 0;
                        if (atkGain > 0 || hpGain > 0) {
                            // Utiliser sacrificeAtkStacks pour que recalcDynamicAtk garde le buff
                            // Ne PAS toucher baseAtk/baseHp → le client affiche les stats en vert (boosted)
                            card.sacrificeAtkStacks = (card.sacrificeAtkStacks || 0) + atkGain;
                            card.atk += atkGain;
                            card.hp += hpGain;
                            card.currentHp += hpGain;
                            totalAtkGain += atkGain;
                            totalHpGain += hpGain;
                            log(`  🪱 ${heroName}: ${card.name} absorbe +${atkGain}/+${hpGain} de ${sc.card.name} → ${card.atk}/${card.currentHp}`, 'buff');
                        }
                    }
                    if (totalAtkGain > 0 || totalHpGain > 0) {
                        emitAnimation(room, 'buffApply', { player: playerNum, row, col, atkBuff: totalAtkGain, hpBuff: totalHpGain });
                    }
                    recalcDynamicAtk(room);
                    await sleep(800);
                    emitStateToBoth(room);
                    await sleep(600);
                }
                if (card.sacrificeBonus.drawPerAtk) {
                    emitStateToBoth(room);
                    await sleep(600);
                    await drawCards(room, playerNum, totalAtk, log, sleep, `${heroName}: ${card.name} (sacrifice)`);
                }
                if (card.sacrificeBonus.damageFacing) {
                    const facing = getFacingCreature(room, playerNum, row);
                    if (facing && facing.card && totalAtk > 0) {
                        const actualDmg = applyCreatureDamage(facing.card, totalAtk, room, log, facing.playerNum, facing.row, facing.col, { player: playerNum, row, col, uid: card.uid });
                        if (actualDmg > 0) {
                            log(`  🎭 ${heroName}: ${card.name} inflige ${actualDmg} dégât(s) à ${facing.card.name} (ATK sacrifiée)`, 'damage');
                            emitAnimation(room, 'damage', { player: facing.playerNum, row: facing.row, col: facing.col, amount: actualDmg });
                            await sleep(800);
                            // Si la créature en face est morte, la retirer du terrain
                            if (facing.card.currentHp <= 0) {
                                const result = handleCreatureDeath(room, facing.card, facing.playerNum, facing.row, facing.col, log);
                                if (result.transformed) {
                                    emitAnimation(room, 'deathTransform', { player: facing.playerNum, row: facing.row, col: facing.col, fromCard: facing.card, toCard: result.newCard });
                                } else {
                                    emitAnimation(room, 'death', { player: facing.playerNum, row: facing.row, col: facing.col, card: facing.card });
                                }
                            }
                            emitStateToBoth(room);
                            await sleep(600);
                        }
                    }
                }
            }
        }
        // Déclencher les effets onDeath des créatures sacrifiées (destroyAll, etc.)
        for (const sc of sacrificedCards) {
            await processOnDeathAbility(room, sc.card, sc.player, sc.row, sc.col, log, sleep);
        }
        await applyPendingHealOnDeath(room, log);
        recalcDynamicAtk(room);
        emitStateToBoth(room);
    }

    // searchSpell : chercher le premier sort dans le deck et l'ajouter à la main
    if (card.onSummon && card.onSummon.searchSpell) {
        const spellIndex = player.deck.findIndex(c => c.type === 'spell');
        if (spellIndex !== -1) {
            const [spellCard] = player.deck.splice(spellIndex, 1);
            // VFX arcane sur la créature qui cherche
            emitAnimation(room, 'searchSpell', { player: playerNum, row, col });
            await sleep(800);
            if (player.hand.length < 9) {
                player.hand.push(spellCard);
                const handIdx = player.hand.length - 1;
                log(`  🔍 ${heroName}: ${card.name} trouve ${spellCard.name} dans le deck`, 'action');
                emitAnimation(room, 'draw', { cards: [{ player: playerNum, card: spellCard, handIndex: handIdx }] });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1000);
            } else {
                addToGraveyard(player, spellCard);
                log(`  🔍 ${heroName}: ${card.name} trouve ${spellCard.name}, mais main pleine → cimetière`, 'damage');
                emitAnimation(room, 'burn', { player: playerNum, card: spellCard });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1200);
            }
        }
    }

    // millFirstCreature : met la première créature du deck au cimetière (Fossoyeur méthodique)
    if (card.onSummon && card.onSummon.millFirstCreature) {
        const creatureIndex = player.deck.findIndex(c => c.type === 'creature');
        if (creatureIndex !== -1) {
            const [milled] = player.deck.splice(creatureIndex, 1);
            addToGraveyard(player, milled);
            log(`  🪦 ${heroName}: ${card.name} → ${milled.name} va au cimetière`, 'action');
            emitAnimation(room, 'burn', { player: playerNum, card: milled });
            await sleep(20);
            emitStateToBoth(room);
            await sleep(1200);
        }
    }

    // destroyFacing : détruire la créature en face à l'invocation
    if (card.onSummon && card.onSummon.destroyFacing) {
        const facing = getFacingCreature(room, playerNum, row);
        if (facing && facing.card) {
            const heroName = room.gameState.players[playerNum].heroName || `Joueur ${playerNum}`;
            log(`💀 ${heroName}: ${card.name} détruit ${facing.card.name}!`, 'damage');
            emitAnimation(room, 'destroy', { player: facing.playerNum, row: facing.row, col: facing.col });
            await sleep(1200);

            if (deferredDestructions) {
                // Mode différé : empiler la destruction, elle sera résolue après tous les onSummon
                deferredDestructions.push({
                    card: facing.card,
                    playerNum: facing.playerNum,
                    row: facing.row,
                    col: facing.col,
                    source: card.name,
                });
            } else {
                // Mode immédiat (appel hors Phase 2, ex: futur effet)
                const result = handleCreatureDeath(room, facing.card, facing.playerNum, facing.row, facing.col, log);
                if (result.transformed) {
                    emitAnimation(room, 'deathTransform', { player: facing.playerNum, row: facing.row, col: facing.col, fromCard: facing.card, toCard: result.newCard });
                } else {
                    emitAnimation(room, 'death', { player: facing.playerNum, row: facing.row, col: facing.col, card: facing.card });
                    await processOnDeathAbility(room, facing.card, facing.playerNum, facing.row, facing.col, log, sleep);
                }
                await applyPendingHealOnDeath(room, log);
                recalcDynamicAtk(room);
                emitStateToBoth(room);
                await sleep(800);
            }
        }
    }

    // selfPoison : s'infliger des compteurs poison à l'invocation
    if (card.onSummon && card.onSummon.selfPoison) {
        const amount = card.onSummon.selfPoison;
        card.poisonCounters = (card.poisonCounters || 0) + amount;
        log(`☠️ ${card.name} s'inflige ${amount} marqueur(s) poison (total: ${card.poisonCounters})`, 'damage');
        emitAnimation(room, 'poisonApply', { player: playerNum, row, col, amount });
        recalcDynamicAtk(room);
        emitStateToBoth(room);
        await sleep(800);
    }

    // graveyardReturnAtk1 : renvoyer les créatures avec 1 ATK du cimetière en main (une par une)
    if (card.onSummon && card.onSummon.graveyardReturnAtk1) {
        // Collecter les indices des cartes éligibles d'abord
        const toReturn = [];
        for (let i = 0; i < player.graveyard.length; i++) {
            const gc = player.graveyard[i];
            if (gc.type === 'creature' && gc.atk === 1) {
                toReturn.push(i);
            }
        }
        // Traiter une par une (indices décroissants pour splice safe)
        let anyReturned = false;
        for (let j = toReturn.length - 1; j >= 0; j--) {
            if (player.hand.length >= 9) break;
            const idx = toReturn[j];
            const gc = player.graveyard.splice(idx, 1)[0];
            gc.revealedToOpponent = true;
            player.hand.push(gc);
            log(`  🪦 ${heroName}: ${card.name} → ${gc.name} revient du cimetière en main!`, 'special');
            emitAnimation(room, 'graveyardReturn', { player: playerNum, card: gc });
            emitStateToBoth(room);
            await sleep(900);
            anyReturned = true;
        }
        if (anyReturned) {
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
    }
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

// Collecter les effets onDeath d'une liste de créatures mortes → tableau d'effets génériques
function collectOnDeathEffects(normalDeaths) {
    const effects = [];
    for (const d of normalDeaths) {
        if (!d.card.onDeath) continue;
        if (d.card.onDeath.damageHero) {
            const enemyPlayer = d.player === 1 ? 2 : 1;
            effects.push({ type: 'heroDamage', targetPlayer: enemyPlayer, damage: d.card.onDeath.damageHero, source: d.card.name });
        }
        if (d.card.onDeath.damageKiller && d.card.killedBy) {
            const ki = d.card.killedBy;
            effects.push({ type: 'creatureDamage', targetPlayer: ki.player, targetRow: ki.row, targetCol: ki.col, targetUid: ki.uid, damage: d.card.onDeath.damageKiller, source: d.card.name });
        }
        if (d.card.onDeath.damageRow && d.row !== undefined) {
            effects.push({ type: 'rowDamage', sourcePlayer: d.player, sourceCol: d.col, row: d.row, damage: d.card.onDeath.damageRow, source: d.card.name });
        }
        if (d.card.onDeath.destroyAll) {
            effects.push({ type: 'destroyAll', sourcePlayer: d.player, source: d.card.name });
        }
        if (d.card.onDeath.poisonRow && d.row !== undefined) {
            effects.push({ type: 'poisonRow', sourcePlayer: d.player, row: d.row, poisonAmount: d.card.onDeath.poisonRow, source: d.card.name });
        }
        if (d.card.onDeath.poisonExplosion && d.card.poisonCounters > 0) {
            effects.push({ type: 'poisonExplosion', sourcePlayer: d.player, damage: d.card.poisonCounters, source: d.card.name });
        }
    }
    return effects;
}

// Résoudre TOUS les effets post-combat EN SIMULTANÉ (onDeath + onHeroHit + futurs effets)
async function resolvePostCombatEffects(room, effects, log, sleep) {
    if (effects.length === 0) return;

    let maxSleepTime = 0;
    const killerHitResults = [];
    const rowDamageResults = [];
    const allDrawnCards = [];
    const allBurnedCards = [];

    // 1. Appliquer TOUS les changements d'état et émettre TOUTES les animations
    for (const effect of effects) {
        switch (effect.type) {
            case 'heroDamage': {
                room.gameState.players[effect.targetPlayer].hp -= effect.damage;
                log(`💀 ${effect.source} - Capacité de mort: ${effect.damage} dégâts au héros adverse!`, 'damage');
                emitAnimation(room, 'onDeathDamage', {
                    source: effect.source,
                    targetPlayer: effect.targetPlayer,
                    damage: effect.damage
                });
                maxSleepTime = Math.max(maxSleepTime, 800);
                break;
            }
            case 'creatureDamage': {
                const killerCard = room.gameState.players[effect.targetPlayer].field[effect.targetRow][effect.targetCol];
                if (killerCard && killerCard.uid === effect.targetUid && killerCard.currentHp > 0) {
                    const actualDmg = applyCreatureDamage(killerCard, effect.damage, room, log, effect.targetPlayer, effect.targetRow, effect.targetCol);
                    log(`🔥 ${effect.source} inflige ${effect.damage} blessure à ${killerCard.name}!`, 'damage');
                    emitAnimation(room, 'onDeathDamage', {
                        source: effect.source,
                        targetPlayer: effect.targetPlayer,
                        targetRow: effect.targetRow,
                        targetCol: effect.targetCol,
                        damage: effect.damage
                    });
                    killerHitResults.push({ killerCard, actualDmg, killerInfo: { player: effect.targetPlayer, row: effect.targetRow, col: effect.targetCol } });
                    maxSleepTime = Math.max(maxSleepTime, 800);
                }
                break;
            }
            case 'draw': {
                const player = room.gameState.players[effect.player];
                for (let i = 0; i < effect.count; i++) {
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
                        allDrawnCards.push({ player: effect.player, card, handIndex: player.hand.length - 1 });
                    } else {
                        // NE PAS ajouter au cimetière maintenant — différer à la phase burn
                        allBurnedCards.push({ player: effect.player, card });
                    }
                }
                log(`  🎴 ${effect.source} - pioche ${effect.count} carte(s)`, 'action');
                break;
            }
            case 'rowDamage': {
                // Touche toute la ligne (les 2 joueurs), sauf les volants et le slot source
                for (let p = 1; p <= 2; p++) {
                    const field = room.gameState.players[p].field;
                    for (let c = 0; c < 2; c++) {
                        // Ne pas toucher le slot où se trouvait le démon (il est déjà mort)
                        if (p === effect.sourcePlayer && c === effect.sourceCol) continue;
                        const target = field[effect.row][c];
                        if (target && target.currentHp > 0 && target.combatType !== 'fly') {
                            const actualDmg = applyCreatureDamage(target, effect.damage, room, log, p, effect.row, c);
                            log(`💥 ${effect.source} inflige ${effect.damage} dégâts à ${target.name}!`, 'damage');
                            emitAnimation(room, 'onDeathDamage', {
                                source: effect.source,
                                targetPlayer: p,
                                targetRow: effect.row,
                                targetCol: c,
                                damage: effect.damage
                            });
                            rowDamageResults.push({ card: target, actualDmg, info: { player: p, row: effect.row, col: c } });
                            maxSleepTime = Math.max(maxSleepTime, 800);
                        }
                    }
                }
                break;
            }
            case 'destroyAll': {
                // Destruction totale : détruire directement toutes les créatures (pas des dégâts)
                log(`💥 ${effect.source} — Destruction totale : toutes les créatures sont détruites!`, 'damage');
                // Log état du terrain AVANT destruction
                const fieldBefore = [];
                for (let p = 1; p <= 2; p++) {
                    for (let r = 0; r < room.gameState.players[p].field.length; r++) {
                        for (let c = 0; c < room.gameState.players[p].field[r].length; c++) {
                            const t = room.gameState.players[p].field[r][c];
                            if (t) fieldBefore.push(`P${p}R${r}C${c}:${t.name}(uid=${t.uid})`);
                        }
                    }
                }
                const destroyDeaths = [];
                const destroyAnims = [];
                for (let p = 1; p <= 2; p++) {
                    for (let r = 0; r < room.gameState.players[p].field.length; r++) {
                        for (let c = 0; c < room.gameState.players[p].field[r].length; c++) {
                            const target = room.gameState.players[p].field[r][c];
                            if (target) {
                                const result = handleCreatureDeath(room, target, p, r, c, log);
                                if (result.transformed) {
                                    destroyAnims.push({ type: 'deathTransform', player: p, row: r, col: c, fromCard: target, toCard: result.newCard });
                                } else {
                                    destroyAnims.push({ type: 'death', player: p, row: r, col: c, card: target });
                                    destroyDeaths.push({ card: target, player: p, row: r, col: c });
                                }
                            }
                        }
                    }
                }

                // Log état du terrain APRÈS destruction
                const fieldAfter = [];
                for (let p = 1; p <= 2; p++) {
                    for (let r = 0; r < room.gameState.players[p].field.length; r++) {
                        for (let c = 0; c < room.gameState.players[p].field[r].length; c++) {
                            const t = room.gameState.players[p].field[r][c];
                            if (t) fieldAfter.push(`P${p}R${r}C${c}:${t.name}(uid=${t.uid})`);
                        }
                    }
                }
                // Émettre toutes les animations de mort en même temps
                if (destroyAnims.length > 0) {
                    emitAnimationBatch(room, destroyAnims);
                }
                emitStateToBoth(room);
                await sleep(1100);
                // Déclencher les effets onDeath des créatures détruites (récursif)
                const destroyEffects = collectOnDeathEffects(destroyDeaths);
                if (destroyEffects.length > 0) {
                    await resolvePostCombatEffects(room, destroyEffects, log, sleep);
                }
                await applyPendingHealOnDeath(room, log);
                break;
            }
            case 'poisonRow': {
                // Poison Row : applique des compteurs poison aux créatures adverses sur la même ligne
                const enemyPlayerNum = effect.sourcePlayer === 1 ? 2 : 1;
                const enemyField = room.gameState.players[enemyPlayerNum].field;
                for (let c = 0; c < 2; c++) {
                    const target = enemyField[effect.row][c];
                    if (target && target.currentHp > 0) {
                        target.poisonCounters = (target.poisonCounters || 0) + effect.poisonAmount;
                        log(`☠️ ${effect.source} empoisonne ${target.name} (+${effect.poisonAmount} compteur poison, total: ${target.poisonCounters})`, 'damage');
                        emitAnimation(room, 'poisonApply', {
                            player: enemyPlayerNum,
                            row: effect.row,
                            col: c,
                            amount: effect.poisonAmount
                        });
                    }
                }
                maxSleepTime = Math.max(maxSleepTime, 800);
                break;
            }
            case 'poisonExplosion': {
                // Pustule vivante : inflige des dégâts égaux aux compteurs poison à toutes les créatures ennemies
                const enemyNum = effect.sourcePlayer === 1 ? 2 : 1;
                const enemyField = room.gameState.players[enemyNum].field;
                const explosionResults = [];
                log(`💥 ${effect.source} explose et inflige ${effect.damage} dégâts à toutes les créatures ennemies!`, 'damage');
                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 2; c++) {
                        const target = enemyField[r][c];
                        if (target && target.currentHp > 0) {
                            const actualDmg = applyCreatureDamage(target, effect.damage, room, log, enemyNum, r, c);
                            emitAnimation(room, 'onDeathDamage', {
                                source: effect.source,
                                targetPlayer: enemyNum,
                                targetRow: r,
                                targetCol: c,
                                damage: effect.damage
                            });
                            explosionResults.push({ card: target, actualDmg, info: { player: enemyNum, row: r, col: c } });
                        }
                    }
                }
                // Gérer les morts causées par l'explosion
                const explosionDeaths = [];
                for (const res of explosionResults) {
                    if (res.card.currentHp <= 0) {
                        const result = handleCreatureDeath(room, res.card, res.info.player, res.info.row, res.info.col, log);
                        if (!result.transformed) {
                            explosionDeaths.push({ card: res.card, player: res.info.player, row: res.info.row, col: res.info.col });
                        }
                    }
                }
                if (explosionDeaths.length > 0) {
                    const explosionEffects = collectOnDeathEffects(explosionDeaths);
                    if (explosionEffects.length > 0) {
                        await resolvePostCombatEffects(room, explosionEffects, log, sleep);
                    }
                }
                maxSleepTime = Math.max(maxSleepTime, 800);
                break;
            }
            // Futurs effets : buff, etc.
        }
    }

    // 2. Émettre l'animation de pioche si nécessaire
    if (allDrawnCards.length > 0) {
        emitAnimation(room, 'draw', { cards: allDrawnCards });
        maxSleepTime = Math.max(maxSleepTime, 1400);
    }

    if (allBurnedCards.length > 0) {
    }

    // 3. State immédiat (pour que le client ait les cartes en main, HP à jour, etc.)
    await sleep(20);
    emitStateToBoth(room);

    // 4. Attendre la fin de la plus longue animation
    if (maxSleepTime > 0) {
        await sleep(maxSleepTime);
    }

    // 5. Power bonuses pour les cibles des creatureDamage
    for (const kh of killerHitResults) {
        if (kh.actualDmg > 0 && kh.killerCard.currentHp > 0 && kh.killerCard.abilities && kh.killerCard.abilities.includes('power')) {
            const powerBonus = kh.killerCard.powerX || 1;
            kh.killerCard.powerStacks = (kh.killerCard.powerStacks || 0) + powerBonus;
            log(`💪 ${kh.killerCard.name} gagne +${powerBonus} ATK!`, 'buff');
        }
    }

    if (killerHitResults.length > 0 || rowDamageResults.length > 0) {
        emitStateToBoth(room);
    }

    // 6. Burns (cartes brûlées car main pleine) — ajouter au cimetière MAINTENANT
    for (const burned of allBurnedCards) {
        addToGraveyard(room.gameState.players[burned.player], burned.card);
        log(`  📦 Main pleine, ${burned.card.name} va au cimetière`, 'damage');
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(1200);
    }

    // 7. Morts secondaires (creatureDamage + rowDamage + destroyAll)
    const secondaryDeaths = [];

    // Scan global : toutes les créatures à 0 HP (couvre destroyAll + dégâts divers)
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < room.gameState.players[p].field.length; r++) {
            for (let c = 0; c < room.gameState.players[p].field[r].length; c++) {
                const target = room.gameState.players[p].field[r][c];
                if (target) {
                }
                if (target && target.currentHp <= 0) {
                    const result = handleCreatureDeath(room, target, p, r, c, log);
                    if (result.transformed) {
                        emitAnimation(room, 'deathTransform', { player: p, row: r, col: c, fromCard: target, toCard: result.newCard });
                    } else {
                        log(`☠️ ${target.name} détruit!`, 'damage');
                        emitAnimation(room, 'death', { player: p, row: r, col: c, card: target });
                        secondaryDeaths.push({ player: p, row: r, col: c, card: target });
                    }
                }
            }
        }
    }
    // Morts spécifiques aux killerHitResults (skip si déjà traitées par le scan global)
    for (const kh of killerHitResults) {
        if (kh.killerCard.currentHp <= 0 && room.gameState.players[kh.killerInfo.player].field[kh.killerInfo.row][kh.killerInfo.col] === kh.killerCard) {
            const result = handleCreatureDeath(room, kh.killerCard, kh.killerInfo.player, kh.killerInfo.row, kh.killerInfo.col, log);
            if (result.transformed) {
                emitAnimation(room, 'deathTransform', { player: kh.killerInfo.player, row: kh.killerInfo.row, col: kh.killerInfo.col, fromCard: kh.killerCard, toCard: result.newCard });
            } else {
                log(`☠️ ${kh.killerCard.name} détruit!`, 'damage');
                emitAnimation(room, 'death', { player: kh.killerInfo.player, row: kh.killerInfo.row, col: kh.killerInfo.col, card: kh.killerCard });
                secondaryDeaths.push({ player: kh.killerInfo.player, row: kh.killerInfo.row, col: kh.killerInfo.col, card: kh.killerCard });
            }
        }
    }
    for (const rd of rowDamageResults) {
        if (rd.card.currentHp <= 0 && room.gameState.players[rd.info.player].field[rd.info.row][rd.info.col] === rd.card) {
            const result = handleCreatureDeath(room, rd.card, rd.info.player, rd.info.row, rd.info.col, log);
            if (result.transformed) {
                emitAnimation(room, 'deathTransform', { player: rd.info.player, row: rd.info.row, col: rd.info.col, fromCard: rd.card, toCard: result.newCard });
            } else {
                log(`☠️ ${rd.card.name} détruit par l'explosion!`, 'damage');
                emitAnimation(room, 'death', { player: rd.info.player, row: rd.info.row, col: rd.info.col, card: rd.card });
                secondaryDeaths.push({ player: rd.info.player, row: rd.info.row, col: rd.info.col, card: rd.card });
            }
        }
    }

    if (secondaryDeaths.length > 0) {
        emitStateToBoth(room);
        await sleep(1100);
        // Récursif : les morts secondaires peuvent aussi avoir des effets
        const secondaryEffects = collectOnDeathEffects(secondaryDeaths);
        await resolvePostCombatEffects(room, secondaryEffects, log, sleep);
        await applyPendingHealOnDeath(room, log);
    }
}

// Wrapper pour les appels existants (traps, spells) avec une seule carte morte
async function processOnDeathAbility(room, card, ownerPlayer, row, col, log, sleep) {
    const effects = collectOnDeathEffects([{ card, player: ownerPlayer, row, col }]);
    await resolvePostCombatEffects(room, effects, log, sleep);
}

function startTurnTimer(room) {
    if (room.timer) clearInterval(room.timer);
    
    room.timer = setInterval(() => {
        room.gameState.timeLeft--;
        io.to(room.code).emit('timerUpdate', room.gameState.timeLeft);
        if (room.gameState.timeLeft <= 0) {
            clearInterval(room.timer);
            // Délai de grâce (500ms) pour laisser les dernières actions en transit arriver
            // avant de forcer la transition vers la résolution
            setTimeout(() => {
                if (room.gameState.phase !== 'planning') return; // Déjà résolu par checkBothReady
                room.gameState.players[1].ready = true;
                room.gameState.players[2].ready = true;
                startResolution(room);
            }, 500);
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

function canCreatureAttack(card) {
    return card && card.canAttack && !card.abilities?.includes('wall') && card.atk > 0;
}

function isSacrificeTarget(card) {
    if (!card || card.type !== 'creature') return false;
    if (card.petrified) return false;
    if (card.movedThisTurn) return false;
    return !!card.canAttack;
}

function getAdjacentSacrificeTargets(field, row, col) {
    const neighbors = [[row-1,col],[row,col+1],[row+1,col],[row,col-1]];
    const targets = [];
    for (const [r,c] of neighbors) {
        if (r < 0 || r >= 4 || c < 0 || c >= 2) continue;
        if (isSacrificeTarget(field[r][c])) targets.push({ row: r, col: c, card: field[r][c] });
    }
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

    // Sorts par joueur pour interleaving par vitesse
    const spellsByPlayer = { defensive: { 1: [], 2: [] }, offensive: { 1: [], 2: [] } };

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
                const isDefensive = action.spell.offensive === false ||
                                   action.targetPlayer === p ||
                                   action.spell.pattern === 'global' && !action.spell.damage;
                if (isDefensive) {
                    spellsByPlayer.defensive[p].push(action);
                } else {
                    spellsByPlayer.offensive[p].push(action);
                }
            }
        }
    }

    // Interleave les sorts : le joueur le plus rapide (1er sort) commence, puis alternance
    function interleaveSpells(spellsP1, spellsP2) {
        if (spellsP1.length === 0) return spellsP2;
        if (spellsP2.length === 0) return spellsP1;

        // Comparer le timestamp du 1er sort de chaque joueur
        const t1 = spellsP1[0].timestamp || 0;
        const t2 = spellsP2[0].timestamp || 0;
        const first = t1 <= t2 ? spellsP1 : spellsP2;
        const second = t1 <= t2 ? spellsP2 : spellsP1;

        const result = [];
        const maxLen = Math.max(first.length, second.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < first.length) result.push(first[i]);
            if (i < second.length) result.push(second[i]);
        }
        return result;
    }

    allActions.spellsDefensive = interleaveSpells(spellsByPlayer.defensive[1], spellsByPlayer.defensive[2]);
    allActions.spellsOffensive = interleaveSpells(spellsByPlayer.offensive[1], spellsByPlayer.offensive[2]);
    
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
        // Bonus de cartes fantômes : l'adversaire voit la main pleine tant que
        // les actions ne sont pas révélées (décrementé au fur et à mesure)
        const actions = player.pendingActions || [];
        const bonusActions = actions.filter(a =>
            a.type === 'place' || a.type === 'spell' || a.type === 'trap'
        );
        // handBonusCards : tableau de cartes fantômes (null pour cachées, card data pour revealed)
        player.handBonusCards = bonusActions.map(a => {
            const card = a.card || a.spell;
            return (card && card.revealedToOpponent) ? card : null;
        });
        player.handCountBonus = bonusActions.length;
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
                            if (newCard.abilities.includes('camouflage')) newCard.hasCamouflage = true;
                            if (newCard.abilities.includes('untargetable')) newCard.hasUntargetable = true;
                            newCard.summonOrder = card.summonOrder || 0;

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

        // Collecter aussi les effets startOfTurn (selfPoison, etc.)
        const startOfTurnEffects = [];
        for (let p = 1; p <= 2; p++) {
            const player = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const card = player.field[r][c];
                    const effectiveTurns = card?.preMoveturnsOnField ?? card?.turnsOnField ?? 0;
                    // Position d'origine (avant déplacement) pour les effets positionnels
                    const effectRow = card?.preMoveRow ?? r;
                    const effectCol = card?.preMoveCol ?? c;
                    if (card && card.currentHp > 0 && effectiveTurns > 0 && card.startOfTurn) {
                        if (card.startOfTurn.selfPoison) {
                            startOfTurnEffects.push({ type: 'selfPoison', player: p, row: effectRow, col: effectCol, card, amount: card.startOfTurn.selfPoison });
                        }
                        if (card.startOfTurn.heroDrain) {
                            startOfTurnEffects.push({ type: 'heroDrain', player: p, card, amount: card.startOfTurn.heroDrain });
                        }
                        if (card.startOfTurn.spawnAdjacent) {
                            startOfTurnEffects.push({ type: 'spawnAdjacent', player: p, row: effectRow, col: effectCol, card, spawnId: card.startOfTurn.spawnAdjacent });
                        }
                        if (card.startOfTurn.poisonAll) {
                            startOfTurnEffects.push({ type: 'poisonAll', player: p, row: effectRow, col: effectCol, card, amount: card.startOfTurn.poisonAll });
                        }
                        if (card.startOfTurn.poisonRow) {
                            startOfTurnEffects.push({ type: 'poisonRow', player: p, row: effectRow, col: effectCol, card, amount: card.startOfTurn.poisonRow });
                        }
                        if (card.startOfTurn.millAndBuff) {
                            startOfTurnEffects.push({ type: 'millAndBuff', player: p, row: effectRow, col: effectCol, card });
                        }
                    }
                }
            }
        }

        const hasStartEffects = anyTransform || startOfTurnEffects.length > 0;

        if (hasStartEffects) {
            io.to(room.code).emit('phaseMessage', { text: 'Effets de début de tour', type: 'revelation' });
            log('🔄 Effets de début de tour', 'phase');
            await sleep(ANIM_TIMING.phaseIntro);

            // Transformations
            for (const t of transformAnimations) {
                emitAnimation(room, 'startOfTurnTransform', {
                    player: t.player, row: t.row, col: t.col,
                    fromCard: t.fromCard, toCard: t.toCard
                });
            }
            for (const t of transformAnimations) {
                const p = room.gameState.players[t.player];
                if (p.revealField) p.revealField[t.row][t.col] = p.field[t.row][t.col];
            }
            if (anyTransform) {
                emitStateToBoth(room);
                await sleep(1200);
            }

            // startOfTurn selfPoison
            const poisonEffectsSOT = startOfTurnEffects.filter(e => e.type === 'selfPoison');
            for (const eff of poisonEffectsSOT) {
                eff.card.poisonCounters = (eff.card.poisonCounters || 0) + eff.amount;
                log(`☠️ ${eff.card.name} reçoit ${eff.amount} marqueur(s) poison (total: ${eff.card.poisonCounters})`, 'damage');
                emitAnimation(room, 'poisonApply', { player: eff.player, row: eff.row, col: eff.col, amount: eff.amount });
            }
            if (poisonEffectsSOT.length > 0) {
                recalcDynamicAtk(room);
                emitStateToBoth(room);
                await sleep(800);
            }

            // startOfTurn heroDrain (Démon Suprême)
            const drainEffectsSOT = startOfTurnEffects.filter(e => e.type === 'heroDrain');
            for (const eff of drainEffectsSOT) {
                const owner = room.gameState.players[eff.player];
                const opponentNum = eff.player === 1 ? 2 : 1;
                const opponent = room.gameState.players[opponentNum];
                opponent.hp -= eff.amount;
                const oldHp = owner.hp;
                owner.hp = Math.min(20, owner.hp + eff.amount);
                const healed = owner.hp - oldHp;
                log(`  💀 ${eff.card.name} : -${eff.amount} PV à ${opponent.heroName}${healed > 0 ? `, +${healed} PV à ${owner.heroName}` : ''}`, 'damage');
                emitAnimation(room, 'heroHit', { defender: opponentNum, damage: eff.amount });
                if (healed > 0) {
                    emitAnimation(room, 'heroHeal', { player: eff.player, amount: healed });
                }
            }
            if (drainEffectsSOT.length > 0) {
                emitStateToBoth(room);
                await sleep(800);
            }

            // startOfTurn spawnAdjacent (Mère des damnés)
            const spawnEffectsSOT = startOfTurnEffects.filter(e => e.type === 'spawnAdjacent');
            for (const eff of spawnEffectsSOT) {
                const player = room.gameState.players[eff.player];
                const template = CardDB.creatures.find(c => c.id === eff.spawnId);
                if (!template) continue;
                // Cases adjacentes en sens horaire, filtrées à col 1 (mêlée) et vides
                const neighbors = [[eff.row-1, eff.col],[eff.row, eff.col+1],[eff.row+1, eff.col],[eff.row, eff.col-1]];
                let targetSlot = null;
                for (const [r, c] of neighbors) {
                    if (r < 0 || r >= 4 || c !== 1) continue;
                    if (!player.field[r][c]) {
                        targetSlot = { row: r, col: c };
                        break;
                    }
                }
                if (targetSlot) {
                    const summoned = {
                        ...template,
                        abilities: [...(template.abilities || [])],
                        uid: `${Date.now()}-spawn-${eff.row}-${Math.random()}`,
                        currentHp: template.hp,
                        baseAtk: template.atk,
                        baseHp: template.hp,
                        canAttack: false,
                        turnsOnField: 0,
                        movedThisTurn: false
                    };
                    summoned.summonOrder = ++room.gameState.summonCounter;
                    player.field[targetSlot.row][targetSlot.col] = summoned;
                    log(`  👶 ${eff.card.name} invoque un ${template.name} en ${slotNames[targetSlot.row][targetSlot.col]}`, 'action');
                    recalcDynamicAtk(room);
                    emitAnimation(room, 'trapSummon', { player: eff.player, row: targetSlot.row, col: targetSlot.col, card: summoned });
                    await sleep(1600);
                    emitStateToBoth(room);
                }
            }

            // startOfTurn poisonAll (Rosalia démonicus)
            const poisonAllEffectsSOT = startOfTurnEffects.filter(e => e.type === 'poisonAll');
            if (poisonAllEffectsSOT.length > 0) {
                const poisonAnims = [];
                for (const eff of poisonAllEffectsSOT) {
                    // Appliquer le poison à TOUTES les créatures des deux joueurs (field réel + revealField)
                    for (let p = 1; p <= 2; p++) {
                        const targetPlayer = room.gameState.players[p];
                        const rf = targetPlayer.revealField;
                        for (let r = 0; r < 4; r++) {
                            for (let c = 0; c < 2; c++) {
                                const target = targetPlayer.field[r][c];
                                if (target && target.currentHp > 0) {
                                    target.poisonCounters = (target.poisonCounters || 0) + eff.amount;
                                    log(`☠️ ${eff.card.name} empoisonne ${target.name} (+${eff.amount} compteur poison, total: ${target.poisonCounters})`, 'damage');
                                }
                                // Aussi appliquer sur revealField (deepClone séparé, positions peuvent différer)
                                const rfTarget = rf?.[r]?.[c];
                                if (rfTarget && rfTarget.currentHp > 0) {
                                    rfTarget.poisonCounters = (rfTarget.poisonCounters || 0) + eff.amount;
                                    // Animation basée sur la position revealField (ce que le client voit)
                                    poisonAnims.push({ type: 'poisonApply', player: p, row: r, col: c, amount: eff.amount });
                                }
                            }
                        }
                    }
                }
                if (poisonAnims.length > 0) {
                    emitAnimationBatch(room, poisonAnims);
                }
                recalcDynamicAtk(room);
                emitStateToBoth(room);
                await sleep(800);
            }

            // startOfTurn poisonRow (Porteur de peste)
            const poisonRowEffectsSOT = startOfTurnEffects.filter(e => e.type === 'poisonRow');
            if (poisonRowEffectsSOT.length > 0) {
                const poisonAnims = [];
                for (const eff of poisonRowEffectsSOT) {
                    // Appliquer le poison à toutes les créatures sur la même ligne (2 joueurs), sauf la source
                    for (let p = 1; p <= 2; p++) {
                        const targetPlayer = room.gameState.players[p];
                        const rf = targetPlayer.revealField;
                        for (let c = 0; c < 2; c++) {
                            // Ne pas empoisonner la source elle-même
                            if (p === eff.player && c === eff.col) continue;
                            const target = targetPlayer.field[eff.row][c];
                            if (target && target.currentHp > 0) {
                                if (target.abilities && target.abilities.includes('antitoxin')) {
                                    log(`🛡️ ${target.name} est insensible au poison (Anti-toxine)`, 'info');
                                } else {
                                    target.poisonCounters = (target.poisonCounters || 0) + eff.amount;
                                    log(`☠️ ${eff.card.name} empoisonne ${target.name} (+${eff.amount} compteur poison, total: ${target.poisonCounters})`, 'damage');
                                }
                            }
                            const rfTarget = rf?.[eff.row]?.[c];
                            if (rfTarget && rfTarget.currentHp > 0 && !(rfTarget.abilities && rfTarget.abilities.includes('antitoxin'))) {
                                rfTarget.poisonCounters = (rfTarget.poisonCounters || 0) + eff.amount;
                                poisonAnims.push({ type: 'poisonApply', player: p, row: eff.row, col: c, amount: eff.amount });
                            }
                        }
                    }
                }
                if (poisonAnims.length > 0) {
                    emitAnimationBatch(room, poisonAnims);
                }
                recalcDynamicAtk(room);
                emitStateToBoth(room);
                await sleep(800);
            }
        }

        // startOfTurn millAndBuff (Ver des tombes)
        const millAndBuffEffectsSOT = startOfTurnEffects.filter(e => e.type === 'millAndBuff');
        if (millAndBuffEffectsSOT.length > 0) {
            for (const eff of millAndBuffEffectsSOT) {
                const player = room.gameState.players[eff.player];
                const card = eff.card;
                if (player.deck.length > 0 && card.currentHp > 0) {
                    const milled = player.deck.shift();
                    addToGraveyard(player, milled);
                    log(`  🪱 ${card.name} : ${milled.name} va au cimetière`, 'action');
                    emitAnimation(room, 'burn', { player: eff.player, card: milled });
                    await sleep(20);
                    emitStateToBoth(room);
                    await sleep(1200);
                    if (milled.type === 'creature') {
                        card.buffCounters = (card.buffCounters || 0) + 1;
                        card.atk += 1;
                        card.hp += 1;
                        card.currentHp += 1;
                        log(`  💪 ${card.name} gagne +1/+1 ! (${card.atk}/${card.currentHp})`, 'buff');
                        recalcDynamicAtk(room);
                        emitStateToBoth(room);
                        await sleep(600);
                    }
                }
            }
        }
    }

    // Nettoyer preMoveturnsOnField après la Phase 0
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) {
                    delete card.preMoveturnsOnField;
                    delete card.preMoveRow;
                    delete card.preMoveCol;
                }
            }
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
                // La carte est déjà à toRow/toCol dans le field réel (move exécuté pendant la planification)
                const currentCard1 = room.gameState.players[a.playerNum].field[a.toRow][a.toCol] || a.card;
                log(`  ↔️ ${a.heroName}: ${a.card.name} ${slotNames[a.fromRow][a.fromCol]} → ${slotNames[a.toRow][a.toCol]}`, 'action');
                emitAnimation(room, 'move', {
                    player: a.playerNum,
                    fromRow: a.fromRow, fromCol: a.fromCol,
                    toRow: a.toRow, toCol: a.toCol,
                    card: currentCard1
                });
            }
            if (movesP2[i]) {
                const a = movesP2[i];
                const currentCard2 = room.gameState.players[a.playerNum].field[a.toRow][a.toCol] || a.card;
                log(`  ↔️ ${a.heroName}: ${a.card.name} ${slotNames[a.fromRow][a.fromCol]} → ${slotNames[a.toRow][a.toCol]}`, 'action');
                emitAnimation(room, 'move', {
                    player: a.playerNum,
                    fromRow: a.fromRow, fromCol: a.fromCol,
                    toRow: a.toRow, toCol: a.toCol,
                    card: currentCard2
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
                // Synchroniser canAttack/turnsOnField depuis le field réel (move = canAttack false sauf superhaste)
                const realCard1 = room.gameState.players[a.playerNum].field[a.toRow][a.toCol];
                if (rf1[a.toRow][a.toCol] && realCard1) {
                    rf1[a.toRow][a.toCol].canAttack = realCard1.canAttack;
                    rf1[a.toRow][a.toCol].turnsOnField = realCard1.turnsOnField;
                }
            }
            if (movesP2[i]) {
                const a = movesP2[i];
                const rf2 = room.gameState.players[a.playerNum].revealField;
                rf2[a.toRow][a.toCol] = rf2[a.fromRow][a.fromCol];
                rf2[a.fromRow][a.fromCol] = null;
                const realCard2 = room.gameState.players[a.playerNum].field[a.toRow][a.toCol];
                if (rf2[a.toRow][a.toCol] && realCard2) {
                    rf2[a.toRow][a.toCol].canAttack = realCard2.canAttack;
                    rf2[a.toRow][a.toCol].turnsOnField = realCard2.turnsOnField;
                }
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

        // ATK dynamique : exclure les créatures pas encore révélées du comptage
        const unrevealed = { 1: new Set(), 2: new Set() };
        for (const action of allActions.places) {
            unrevealed[action.playerNum].add(`${action.row},${action.col}`);
        }
        // Sauvegarder l'ATK complète pour la vue du propriétaire (avant exclusions)
        // Le joueur connaît déjà ses propres créatures, pas besoin de les voir "reset"
        for (let p = 1; p <= 2; p++) {
            const pl = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const card = pl.field[r][c];
                    if (card) card.ownerAtk = card.atk;
                }
            }
        }
        recalcDynamicAtk(room, unrevealed);
        emitStateToBoth(room);

        for (let i = 0; i < nbPairesCreatures; i++) {
            // Envoyer les animations AVANT le state update (ATK pas encore recalculée pour cette paire)
            if (placesP1[i]) {
                const a = placesP1[i];
                // Synchroniser le card data de l'animation avec l'ATK actuelle du field
                const fieldCard = room.gameState.players[a.playerNum].field[a.row][a.col];
                if (fieldCard) a.card.atk = fieldCard.atk;
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
                const fieldCard = room.gameState.players[a.playerNum].field[a.row][a.col];
                if (fieldCard) a.card.atk = fieldCard.atk;
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
            // Mettre à jour revealField et envoyer le state (ATK inchangée pendant l'animation)
            if (placesP1[i]) {
                const a = placesP1[i];
                room.gameState.players[a.playerNum].revealField[a.row][a.col] = room.gameState.players[a.playerNum].field[a.row][a.col];
                removeHandBonus(room.gameState.players[a.playerNum], a.card);
                removeFromConfirmedHand(room.gameState.players[a.playerNum], a.card);
            }
            if (placesP2[i]) {
                const a = placesP2[i];
                room.gameState.players[a.playerNum].revealField[a.row][a.col] = room.gameState.players[a.playerNum].field[a.row][a.col];
                removeHandBonus(room.gameState.players[a.playerNum], a.card);
                removeFromConfirmedHand(room.gameState.players[a.playerNum], a.card);
            }
            emitStateToBoth(room);
            // Attendre la fin de l'animation
            await sleep(ANIM_TIMING.summon + ANIM_TIMING.margin);

            // Animation terminée : maintenant compter ces créatures pour l'ATK dynamique
            if (placesP1[i]) {
                const a = placesP1[i];
                unrevealed[a.playerNum].delete(`${a.row},${a.col}`);
            }
            if (placesP2[i]) {
                const a = placesP2[i];
                unrevealed[a.playerNum].delete(`${a.row},${a.col}`);
            }
            recalcDynamicAtk(room, unrevealed);
            emitStateToBoth(room);
        }

        // Traiter les capacités onSummon APRÈS toutes les révélations de créatures
        // Les destructions/dégâts offensifs sont différés et résolus après tous les onSummon
        const allPlaces = [...placesP1, ...placesP2];
        const deferredDestructions = [];
        for (const place of allPlaces) {
            const fieldCard = room.gameState.players[place.playerNum].field[place.row][place.col];
            if (fieldCard && (fieldCard.onSummon || fieldCard.sacrifice)) {
                await processOnSummonAbility(room, fieldCard, place.playerNum, place.row, place.col, log, sleep, deferredDestructions);
            }
        }

        // Résoudre toutes les destructions différées en même temps
        if (deferredDestructions.length > 0) {
            const deathAnims = [];
            const normalDeaths = [];
            for (const d of deferredDestructions) {
                const target = room.gameState.players[d.playerNum].field[d.row][d.col];
                if (!target || target.currentHp <= 0) continue; // Déjà mort (doublon ou sacrifice antérieur)
                const result = handleCreatureDeath(room, target, d.playerNum, d.row, d.col, log);
                if (result.transformed) {
                    deathAnims.push({ type: 'deathTransform', player: d.playerNum, row: d.row, col: d.col, fromCard: target, toCard: result.newCard });
                } else {
                    deathAnims.push({ type: 'death', player: d.playerNum, row: d.row, col: d.col, card: target });
                    normalDeaths.push({ card: target, player: d.playerNum, row: d.row, col: d.col });
                }
            }
            if (deathAnims.length > 0) {
                emitAnimationBatch(room, deathAnims);
            }
            emitStateToBoth(room);
            await sleep(1100);

            // Effets onDeath des créatures détruites
            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.card, d.player, d.row, d.col, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
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
            removeHandBonus(room.gameState.players[action.playerNum], null);
            removeFromConfirmedHand(room.gameState.players[action.playerNum], null);
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
        // Nettoyer ownerAtk (utilisé pendant la révélation pour stabiliser la vue du propriétaire)
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) delete card.ownerAtk;
            }
        }
    }

    // 4. PHASE DES SORTS DÉFENSIFS (séquentiels, un par un)
    if (allActions.spellsDefensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort défensif', type: 'protection' });
        log('💚 Phase des sorts défensifs', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.spellsDefensive) {
            removeHandBonus(room.gameState.players[action.playerNum], action.spell);
            removeFromConfirmedHand(room.gameState.players[action.playerNum], action.spell);
            emitStateToBoth(room);
            await applySpell(room, action, log, sleep);
        }
    }

    // 5. PHASE DES SORTS OFFENSIFS (séquentiels, un par un)
    if (allActions.spellsOffensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort offensif', type: 'attack' });
        log('🔥 Phase des sorts offensifs', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.spellsOffensive) {
            removeHandBonus(room.gameState.players[action.playerNum], action.spell);
            removeFromConfirmedHand(room.gameState.players[action.playerNum], action.spell);
            emitStateToBoth(room);
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
    
    // Nettoyage du bonus de main fantôme (toutes les cartes jouées ont été révélées)
    for (let p = 1; p <= 2; p++) {
        delete room.gameState.players[p].handCountBonus;
        delete room.gameState.players[p].handBonusCards;
        delete room.gameState.players[p].confirmedOppHand;
    }

    emitStateToBoth(room);
    await sleep(300);

    // 6. PHASE DE COMBAT - pièges puis attaques LIGNE PAR LIGNE (mélodie + pétrification intégrées par ligne)
    if (hasCreaturesOnField() || hasTraps()) {
        io.to(room.code).emit('phaseMessage', { text: 'Combat', type: 'combat' });
        log('⚔️ Combat', 'phase');
        await sleep(800);

        const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

        // Combat LIGNE PAR LIGNE : mélodie/pétrification puis pièges puis attaques
        for (let row = 0; row < 4; row++) {
            // Mélodie + Pétrification pour cette ligne (avant les attaques de cette ligne)
            await processMelodyForRow(room, row, log, sleep);
            for (let col = 0; col < 2; col++) {
                // Pièges déclenchés par les attaquants de cette colonne
                await processTrapsForRow(room, row, col, log, sleep);

                // Puis le combat de ce slot
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
                    card.canAttack = !card.petrified;
                    card.movedThisTurn = false;
                    // Camouflage se dissipe au début du prochain tour
                    if (card.hasCamouflage) card.hasCamouflage = false;
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
                    emitAnimation(room, 'radiantDragonDraw', { player: p, row: r, col: c });
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
    // Vérifier s'il y a des effets à jouer avant d'afficher le message
    const hasBonusDraws = (bonusDraws[1] || 0) > 0 || (bonusDraws[2] || 0) > 0;

    // Collecter les effets Zdejebel
    const zdjebelEffects = [];
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        const opponent = room.gameState.players[playerNum === 1 ? 2 : 1];
        if (player.hero && player.hero.id === 'zdejebel' && opponent.heroAttackedThisTurn) {
            zdjebelEffects.push({ playerNum, player, opponent });
        }
    }

    // Collecter les effets selfDamage (Guerrière solitaire, etc.)
    const selfDamageEffects = [];
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.endOfTurn && card.endOfTurn.selfDamage) {
                    selfDamageEffects.push({ playerNum, player, card, damage: card.endOfTurn.selfDamage });
                }
            }
        }
    }



    // Collecter les effets selfSacrifice (Possédé éphémère)
    const selfSacrificeEffects = [];
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.endOfTurn && card.endOfTurn.selfSacrifice) {
                    selfSacrificeEffects.push({ playerNum, player, card, row: r, col: c });
                }
            }
        }
    }

    // Collecter les créatures empoisonnées (compteurs poison)
    const poisonEffects = [];
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.poisonCounters && card.poisonCounters > 0 && card.currentHp > 0) {
                    poisonEffects.push({ playerNum, player, card, row: r, col: c, damage: card.poisonCounters });
                }
            }
        }
    }

    // Vérifier régénération
    let hasRegen = false;
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.abilities.includes('regeneration') && card.currentHp < card.hp) {
                    hasRegen = true;
                    break;
                }
            }
            if (hasRegen) break;
        }
        if (hasRegen) break;
    }

    // Afficher le message seulement s'il y a des effets
    if (hasBonusDraws || zdjebelEffects.length > 0 || selfDamageEffects.length > 0 || poisonEffects.length > 0 || hasRegen || selfSacrificeEffects.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Effet de fin de tour', type: 'endturn' });
        log('✨ Effet de fin de tour', 'phase');
        await sleep(800);
    }

    // Piochées bonus (Dragon d'Éclat blessé, etc.)
    for (let p = 1; p <= 2; p++) {
        for (let i = 0; i < (bonusDraws[p] || 0); i++) {
            await drawCards(room, p, 1, log, sleep, `${room.gameState.players[p].heroName} (effet de créature)`);
        }
    }

    // selfSacrifice : créatures qui se sacrifient en fin de tour (Possédé éphémère)
    if (selfSacrificeEffects.length > 0) {
        for (const { playerNum, player, card, row, col } of selfSacrificeEffects) {
            // Vérifier que la créature est toujours sur le terrain
            if (player.field[row][col] !== card) continue;
            log(`  💀 ${card.name} se sacrifie!`, 'damage');
            const result = handleCreatureDeath(room, card, playerNum, row, col, log);
            if (result.transformed) {
                emitAnimation(room, 'sacrifice', { player: playerNum, row, col, card, noFlyToGrave: true });
                emitAnimation(room, 'deathTransform', { player: playerNum, row, col, fromCard: card, toCard: result.newCard });
            } else {
                emitAnimation(room, 'sacrifice', { player: playerNum, row, col, card });
            }
            // Buff onAllySacrifice (Vampire sordide, etc.)
            applyOnAllySacrifice(room, playerNum, 1, log);
            applyErebethSacrifice(room, playerNum, 1, log);
        }
        recalcDynamicAtk(room);
        emitStateToBoth(room);
        await sleep(1600);
    }

    // selfDamage : créatures qui infligent des dégâts à leur propre héros en fin de tour
    if (selfDamageEffects.length > 0) {
        const selfDmgAnims = [];
        for (const { playerNum, player, card, damage } of selfDamageEffects) {
            player.hp -= damage;
            log(`🩸 ${card.name} inflige ${damage} dégât(s) à ${player.heroName}!`, 'damage');
            selfDmgAnims.push({ type: 'zdejebel', targetPlayer: playerNum, damage });
        }
        emitAnimationBatch(room, selfDmgAnims);
        await sleep(800);
        emitStateToBoth(room);

        // Vérifier si un héros est mort
        for (const { playerNum, player } of selfDamageEffects) {
            if (player.hp <= 0) {
                const winnerNum = playerNum === 1 ? 2 : 1;
                log(`🏆 ${room.gameState.players[winnerNum].heroName} GAGNE — ${player.heroName} s'est autodétruit!`, 'phase');
                io.to(room.code).emit('gameOver', { winner: winnerNum });
                return;
            }
        }
    }

    if (zdjebelEffects.length > 0) {
        // Appliquer tous les dégâts et émettre toutes les animations simultanément
        for (const { playerNum, player, opponent } of zdjebelEffects) {
            opponent.hp -= 1;
            log(`😈 ${player.heroName}: capacité Zdejebel - ${opponent.heroName} subit 1 blessure!`, 'damage');
        }
        // Émettre en batch pour que le client les joue en parallèle
        const zdjebelAnims = zdjebelEffects.map(({ playerNum }) => ({
            type: 'zdejebel', targetPlayer: playerNum === 1 ? 2 : 1, damage: 1
        }));
        emitAnimationBatch(room, zdjebelAnims);
        await sleep(800);
        emitStateToBoth(room);

        // Vérifier si un héros est mort
        for (const { playerNum, opponent } of zdjebelEffects) {
            if (opponent.hp <= 0) {
                // Si les deux meurent en même temps, le joueur 1 gagne (arbitraire)
                log(`🏆 ${room.gameState.players[playerNum].heroName} GAGNE grâce à Zdejebel!`, 'phase');
                io.to(room.code).emit('gameOver', { winner: playerNum });
                return;
            }
        }
    }

    // Poison : les créatures empoisonnées perdent X PV (X = nombre de compteurs poison)
    if (poisonEffects.length > 0) {
        const poisonAnims = [];
        const poisonDeaths = [];
        for (const { playerNum, player, card, row, col, damage } of poisonEffects) {
            if (card.abilities && card.abilities.includes('antitoxin')) {
                log(`🛡️ ${card.name} est immunisé aux dégâts de poison (Antitoxine)`, 'info');
                continue;
            }
            card.currentHp -= damage;
            log(`☠️ Poison : ${card.name} subit ${damage} dégât(s) de poison! (${Math.max(0, card.currentHp)}/${card.hp})`, 'damage');
            poisonAnims.push({ type: 'poisonDamage', player: playerNum, row, col, amount: damage });
            if (card.currentHp <= 0) {
                poisonDeaths.push({ card, player: playerNum, row, col });
            } else if (card.abilities?.includes('power')) {
                const powerBonus = card.powerX || 1;
                card.powerStacks = (card.powerStacks || 0) + powerBonus;
                log(`💪 ${card.name} gagne +${powerBonus} ATK! (poison → puissance)`, 'buff');
            }
        }
        emitAnimationBatch(room, poisonAnims);
        await sleep(1400);

        // Recalculer l'ATK (power déclenché par le poison)
        recalcDynamicAtk(room);

        // Gérer les morts par poison
        if (poisonDeaths.length > 0) {
            const deathAnims = [];
            const normalDeaths = [];
            for (const d of poisonDeaths) {
                const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
                if (result.transformed) {
                    deathAnims.push({ type: 'deathTransform', player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
                } else {
                    deathAnims.push({ type: 'death', player: d.player, row: d.row, col: d.col, card: d.card });
                    normalDeaths.push(d);
                }
            }
            if (deathAnims.length > 0) {
                emitAnimationBatch(room, deathAnims);
            }
            emitStateToBoth(room);
            await sleep(1100);
            // Effets onDeath des créatures mortes par poison
            const deathEffects = collectOnDeathEffects(normalDeaths);
            if (deathEffects.length > 0) {
                await resolvePostCombatEffects(room, deathEffects, log, sleep);
            }
            // Effets onPoisonDeath : accumuler le poison de toutes les morts avant d'émettre
            {
                // Accumuler le poison total par cible (clé: "playerNum-row-col")
                const poisonAccum = {};
                const poisonSources = [];
                for (const d of normalDeaths) {
                    if (d.card.onPoisonDeath && d.card.onPoisonDeath.poisonAllEnemies) {
                        const poisonAmount = d.card.onPoisonDeath.poisonAllEnemies;
                        const enemyNum = d.player === 1 ? 2 : 1;
                        const enemyField = room.gameState.players[enemyNum].field;
                        for (let r = 0; r < enemyField.length; r++) {
                            for (let c = 0; c < enemyField[r].length; c++) {
                                const target = enemyField[r][c];
                                if (target && target.currentHp > 0) {
                                    const key = `${enemyNum}-${r}-${c}`;
                                    poisonAccum[key] = (poisonAccum[key] || 0) + poisonAmount;
                                }
                            }
                        }
                        poisonSources.push(d.card.name);
                    }
                }
                if (Object.keys(poisonAccum).length > 0) {
                    const poisonApplyAnims = [];
                    for (const [key, totalPoison] of Object.entries(poisonAccum)) {
                        const [enemyNum, r, c] = key.split('-').map(Number);
                        const target = room.gameState.players[enemyNum].field[r][c];
                        if (target && target.currentHp > 0) {
                            target.poisonCounters = (target.poisonCounters || 0) + totalPoison;
                            log(`☠️ ${poisonSources.join(' + ')} empoisonne ${target.name} (+${totalPoison} compteur poison, total: ${target.poisonCounters})`, 'damage');
                            poisonApplyAnims.push({ type: 'poisonApply', player: enemyNum, row: r, col: c, amount: totalPoison });
                        }
                    }
                    if (poisonApplyAnims.length > 0) {
                        emitAnimationBatch(room, poisonApplyAnims);
                        emitStateToBoth(room);
                        await sleep(1000);
                    }
                }
            }
            // drawOnEnemyPoisonDeath : piocher quand une créature adverse meurt du poison
            const drawByPlayer = {};
            for (const d of normalDeaths) {
                const ownerNum = d.player === 1 ? 2 : 1; // Le propriétaire de la Chasseresse est l'adversaire de la créature morte
                const ownerField = room.gameState.players[ownerNum].field;
                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 2; c++) {
                        const ally = ownerField[r][c];
                        if (ally && ally.currentHp > 0 && ally.drawOnEnemyPoisonDeath) {
                            drawByPlayer[ownerNum] = (drawByPlayer[ownerNum] || 0) + ally.drawOnEnemyPoisonDeath;
                        }
                    }
                }
            }
            for (const [pNum, count] of Object.entries(drawByPlayer)) {
                await drawCards(room, parseInt(pNum), count, log, sleep, 'Poison kill draw');
                emitStateToBoth(room);
                await sleep(600);
            }

            // buffOnEnemyPoisonDeath (Serpent d'émeraude) : +N/+N accumulé par morts poison
            {
                // Compter les morts ennemies par joueur allié
                const deathCountByAlly = {};
                for (const d of normalDeaths) {
                    const allyNum = d.player === 1 ? 2 : 1;
                    deathCountByAlly[allyNum] = (deathCountByAlly[allyNum] || 0) + 1;
                }
                let anyBuff = false;
                for (const [allyNum, count] of Object.entries(deathCountByAlly)) {
                    const allyField = room.gameState.players[parseInt(allyNum)].field;
                    for (let r = 0; r < 4; r++) {
                        for (let c = 0; c < 2; c++) {
                            const ally = allyField[r][c];
                            if (ally && ally.currentHp > 0 && ally.buffOnEnemyPoisonDeath) {
                                if (ally.baseAtk === undefined) ally.baseAtk = ally.atk;
                                if (ally.baseHp === undefined) ally.baseHp = ally.hp;
                                ally.buffCounters = (ally.buffCounters || 0) + count;
                                ally.hp += count;
                                ally.currentHp += count;
                                log(`💪 ${ally.name} gagne +${count}/+${count} (${count} mort(s) poison)`, 'buff');
                                // Piétinement conditionnel (trampleAtBuffCounters)
                                if (ally.trampleAtBuffCounters && ally.buffCounters >= ally.trampleAtBuffCounters && !ally.abilities.includes('trample')) {
                                    ally.abilities.push('trample');
                                    ally.addedAbilities = ally.addedAbilities || [];
                                    ally.addedAbilities.push('trample');
                                    log(`🦶 ${ally.name} acquiert Piétinement! (${ally.buffCounters} marqueurs +1/+1)`, 'buff');
                                }
                                emitAnimation(room, 'buffApply', { player: parseInt(allyNum), row: r, col: c, atkBuff: count, hpBuff: count });
                                anyBuff = true;
                            }
                        }
                    }
                }
                if (anyBuff) {
                    recalcDynamicAtk(room);
                    emitStateToBoth(room);
                    await new Promise(r => setTimeout(r, 800));
                }
            }

            await applyHealOnEnemyPoisonDeath(room, normalDeaths, log);
            await applyPendingHealOnDeath(room, log);
            recalcDynamicAtk(room);
        } else {
            emitStateToBoth(room);
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
                        emitAnimation(room, 'regen', { player: playerNum, row: r, col: c, amount: healed });
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

    // Retirer les boosts temporaires d'ATK (Salamandre de braise)
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.tempAtkBoost) {
                    card.atk -= card.tempAtkBoost;
                    delete card.tempAtkBoost;
                }
            }
        }
    }
    emitStateToBoth(room);

    // Retour du cimetière : cartes avec graveyardReturn qui reviennent en main (une par une)
    let anyGraveyardReturn = false;
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        const graveyard = player.graveyard;
        for (let i = graveyard.length - 1; i >= 0; i--) {
            const card = graveyard[i];
            if (card.graveyardReturn) {
                const minCreatures = card.graveyardReturn.minCreatures || 0;
                const creatureCount = graveyard.filter(g => g.type === 'creature').length;
                if (creatureCount >= minCreatures && player.hand.length < 10) {
                    graveyard.splice(i, 1);
                    card.revealedToOpponent = true;
                    player.hand.push(card);
                    log(`🪦 ${card.name} revient du cimetière dans la main de ${player.heroName}! (${creatureCount} créatures au cimetière)`, 'action');
                    emitAnimation(room, 'graveyardReturn', { player: playerNum, card });
                    emitStateToBoth(room);
                    await sleep(900);
                    anyGraveyardReturn = true;
                }
            }
        }
    }
    if (!anyGraveyardReturn) emitStateToBoth(room);

    startNewTurn(room);
}

// Résoudre les pièges pour une rangée, déclenchés par les attaquants d'une colonne spécifique
async function processTrapsForRow(room, row, triggerCol, log, sleep) {
    for (let attackerPlayer = 1; attackerPlayer <= 2; attackerPlayer++) {
        const defenderPlayer = attackerPlayer === 1 ? 2 : 1;
        const defenderState = room.gameState.players[defenderPlayer];
        const trap = defenderState.traps[row];

        if (!trap) continue;

        // Vérifier si la créature de cette colonne va attaquer dans la direction du piège
        const attackerState = room.gameState.players[attackerPlayer];
        const attackers = [];

        const card = attackerState.field[row][triggerCol];
        if (card && canCreatureAttack(card)) {
            const target = findTarget(card,
                defenderState.field[row][1],
                defenderState.field[row][0],
                defenderPlayer,
                row,
                triggerCol);

            if (target) {
                attackers.push({ card, col: triggerCol });
            }
        }
        
        // Déclencher le piège sur le premier attaquant trouvé
        if (attackers.length > 0) {

            // === PIÈGE SUMMON : condition spéciale — le slot adjacent (col 1) doit être vide ===
            if (trap.effect === 'summon') {
                const adjCol = 1; // colonne intérieure (B/D/F/H)
                if (defenderState.field[row][adjCol]) {
                    // Slot adjacent occupé → le piège ne se déclenche PAS, reste en place
                    continue;
                }

                emitAnimation(room, 'trapTrigger', { player: defenderPlayer, row: row, trap: trap });
                await sleep(2200);

                const template = CardDB.creatures.find(c => c.id === trap.summonId);
                if (template) {
                    log(`🪤 Piège "${trap.name}" déclenché! Un ${template.name} apparaît!`, 'trap');

                    const summoned = {
                        ...template,
                        abilities: [...(template.abilities || [])],
                        uid: `${Date.now()}-trapsummon-${Math.random()}`,
                        currentHp: template.hp,
                        baseAtk: template.atk,
                        baseHp: template.hp,
                        canAttack: !!(template.abilities && (template.abilities.includes('haste') || template.abilities.includes('superhaste'))),
                        turnsOnField: 0,
                        movedThisTurn: false
                    };

                    summoned.summonOrder = ++room.gameState.summonCounter;
                    defenderState.field[row][adjCol] = summoned;
                    recalcDynamicAtk(room);

                    emitAnimation(room, 'trapSummon', {
                        player: defenderPlayer,
                        row: row,
                        col: adjCol,
                        card: summoned
                    });
                    await sleep(1600);
                }

                // Mettre le piège au cimetière
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);
                continue;
            }

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
                                t.card.powerStacks = (t.card.powerStacks || 0) + powerBonus;
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
                        await processOnDeathAbility(room, t.card, attackerPlayer, row, t.col, log, sleep);
                    }
                    await applyPendingHealOnDeath(room, log);
                }
            } else if (trap.effect === 'bounce') {
                // === PIÈGE BOUNCE : renvoie la créature dans la main ===
                const firstAttacker = attackers[0];

                log(`🪤 Piège "${trap.name}" déclenché sur ${firstAttacker.card.name}!`, 'trap');

                // Déterminer la destination AVANT l'animation
                const handFull = attackerState.hand.length >= 9;

                // Animation de bounce AVANT de retirer du terrain
                emitAnimation(room, 'bounce', {
                    player: attackerPlayer, row: row, col: firstAttacker.col,
                    card: firstAttacker.card,
                    toGraveyard: handFull
                });
                await sleep(800);

                // Réinitialiser la carte à ses stats de base
                const bouncedCard = resetCardForGraveyard(firstAttacker.card);
                if (bouncedCard.type === 'creature') {
                    bouncedCard.currentHp = bouncedCard.hp;
                    bouncedCard.baseAtk = bouncedCard.atk;
                    bouncedCard.spellAtkBuff = 0;
                    bouncedCard.baseHp = bouncedCard.hp;
                    bouncedCard.canAttack = false;
                    bouncedCard.turnsOnField = 0;
                    bouncedCard.movedThisTurn = false;
                    bouncedCard.uid = `${Date.now()}-bounce-${Math.random()}`;
                }

                // Retirer du terrain
                attackerState.field[row][firstAttacker.col] = null;
                recalcDynamicAtk(room);

                // Remettre en main (si main pleine, va au cimetière)
                if (!handFull) {
                    bouncedCard.revealedToOpponent = true;
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
                        firstAttacker.card.powerStacks = (firstAttacker.card.powerStacks || 0) + powerBonus;
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
                        await processOnDeathAbility(room, deadCard, attackerPlayer, row, firstAttacker.col, log, sleep);
                    }
                    await applyPendingHealOnDeath(room, log);
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
    let spellReturned = false;
    let spellAddedToGraveyard = false;

    // Animation du sort
    emitAnimation(room, 'spell', {
        caster: playerNum,
        targetPlayer: action.targetPlayer,
        row: action.row,
        col: action.col,
        spell: spell
    });
    await sleep(2100);

    // Mettre le sort au cimetière MAINTENANT (après l'animation, avant les effets/morts)
    // pour que les créatures tuées atterrissent PAR-DESSUS le sort dans le cimetière
    addToGraveyard(player, spell);
    spellAddedToGraveyard = true;

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
        } else if (spell.effect === 'summonZombieWall') {
            // Mur de zombie : invoque un zombie dans chaque emplacement mêlée vide (col 1, rows 0-3)
            const template = CardDB.creatures.find(c => c.id === spell.summonId);
            if (template) {
                const summonAnims = [];
                for (let r = 0; r < 4; r++) {
                    if (!player.field[r][1]) {
                        const summoned = {
                            ...template,
                            abilities: [...(template.abilities || [])],
                            uid: `${Date.now()}-zombiewall-${r}-${Math.random()}`,
                            currentHp: template.hp,
                            baseAtk: template.atk,
                            baseHp: template.hp,
                            canAttack: false,
                            turnsOnField: 0,
                            movedThisTurn: false
                        };
                        summoned.summonOrder = ++room.gameState.summonCounter;
                        player.field[r][1] = summoned;
                        summonAnims.push({ type: 'trapSummon', player: playerNum, row: r, col: 1, card: summoned });
                        log(`  🧟 ${action.heroName}: ${spell.name} → Zombie invoqué en row ${r}`, 'action');
                    }
                }
                recalcDynamicAtk(room);
                if (summonAnims.length > 0) {
                    emitAnimationBatch(room, summonAnims);
                    await sleep(1600);
                }
                emitStateToBoth(room);
            }
        }
    }
    else if (spell.pattern === 'all' && spell.effect === 'sacrificeLastAndDamage') {
        // Cruel destin : chaque joueur sacrifie sa dernière créature jouée + perd X PV
        const deaths = [];
        for (let p = 1; p <= 2; p++) {
            const pState = room.gameState.players[p];
            let lastCreature = null;
            let lastRow = -1, lastCol = -1;
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const card = pState.field[r][c];
                    if (card && card.currentHp > 0 && card.summonOrder) {
                        if (!lastCreature || card.summonOrder > lastCreature.summonOrder) {
                            lastCreature = card;
                            lastRow = r;
                            lastCol = c;
                        }
                    }
                }
            }
            if (lastCreature) {
                deaths.push({ player: p, row: lastRow, col: lastCol, card: lastCreature });
            }
        }

        // Animer et résoudre les sacrifices
        if (deaths.length > 0) {
            const slotsToBlock = deaths.map(d => ({ player: d.player, row: d.row, col: d.col }));
            io.to(room.code).emit('blockSlots', slotsToBlock);

            const normalDeaths = [];
            for (const d of deaths) {
                log(`  💀 ${spell.name}: ${d.card.name} de ${room.gameState.players[d.player].heroName} est sacrifié!`, 'damage');
                const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
                if (result.transformed) {
                    emitAnimation(room, 'deathTransform', { player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
                } else {
                    emitAnimation(room, 'death', { player: d.player, row: d.row, col: d.col, card: d.card });
                    normalDeaths.push(d);
                }
            }

            // Buff onAllySacrifice par joueur (ex: Vampire sordide) + Erebeth
            for (let p = 1; p <= 2; p++) {
                const count = deaths.filter(d => d.player === p).length;
                if (count > 0) {
                    applyOnAllySacrifice(room, p, count, log);
                    applyErebethSacrifice(room, p, count, log);
                }
            }

            // Effets onSacrifice des créatures sacrifiées (ex: Zobombie)
            for (const d of deaths) {
                if (d.card.onSacrifice && d.card.onSacrifice.damageOpponent) {
                    const opNum = d.player === 1 ? 2 : 1;
                    const dmg = d.card.onSacrifice.damageOpponent;
                    room.gameState.players[opNum].hp -= dmg;
                    log(`  💥 ${d.card.name} inflige ${dmg} dégât(s) à ${room.gameState.players[opNum].heroName} (sacrifice)`, 'damage');
                    emitAnimation(room, 'heroHit', { defender: opNum, damage: dmg });
                }
            }

            emitStateToBoth(room);
            await sleep(1100);
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.card, d.player, d.row, d.col, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }

        // Dégâts aux deux héros
        if (spell.heroDamage) {
            for (let p = 1; p <= 2; p++) {
                const pState = room.gameState.players[p];
                pState.hp -= spell.heroDamage;
                log(`  🩸 ${spell.name}: ${pState.heroName} perd ${spell.heroDamage} PV!`, 'damage');
                emitAnimation(room, 'heroHit', { defender: p, damage: spell.heroDamage });
            }
            emitStateToBoth(room);
            await sleep(600);
        }

        recalcDynamicAtk(room);
        emitStateToBoth(room);
    }
    else if (spell.pattern === 'all' && spell.effect === 'buffAll') {
        const atkBuff = spell.buffAtk || 0;
        const hpBuff = spell.buffHp || 0;
        const player = room.gameState.players[playerNum];
        log(`  ✨ ${action.heroName}: ${spell.name} - +${atkBuff} ATK / +${hpBuff} HP à toutes vos créatures!`, 'buff');

        const buffAnims = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const target = player.field[r][c];
                if (target && target.currentHp > 0) {
                    target.buffCounters = (target.buffCounters || 0) + 1;
                    if (hpBuff > 0) {
                        target.hp += hpBuff;
                        target.currentHp += hpBuff;
                    }
                    buffAnims.push({ type: 'buffApply', player: playerNum, row: r, col: c, atkBuff, hpBuff });
                }
            }
        }
        if (buffAnims.length > 0) {
            emitAnimationBatch(room, buffAnims);
        }
        recalcDynamicAtk(room);
        emitStateToBoth(room);
        await sleep(1000);
    }
    // RETOUR DU CIMETIÈRE EN MAIN (Mon précieux)
    else if (spell.pattern === 'all' && spell.effect === 'graveyardToHand') {
        const player = room.gameState.players[playerNum];

        // Chercher la créature dans le cimetière (index + fallback uid)
        let creatureIdx = -1;
        if (action.graveyardIndex !== null && action.graveyardIndex !== undefined &&
            action.graveyardIndex >= 0 && action.graveyardIndex < player.graveyard.length) {
            const candidate = player.graveyard[action.graveyardIndex];
            if (candidate && candidate.type === 'creature') {
                if (!action.graveyardCreatureUid || candidate.uid === action.graveyardCreatureUid || candidate.id === action.graveyardCreatureUid) {
                    creatureIdx = action.graveyardIndex;
                }
            }
        }
        if (creatureIdx === -1 && action.graveyardCreatureUid) {
            creatureIdx = player.graveyard.findIndex(c =>
                c.type === 'creature' && (c.uid === action.graveyardCreatureUid || c.id === action.graveyardCreatureUid)
            );
        }

        if (creatureIdx === -1 || player.hand.length >= 10) {
            log(`  💨 ${action.heroName}: ${spell.name} échoue (cible invalide ou main pleine)`, 'action');
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            creature.revealedToOpponent = true;
            player.hand.push(creature);
            log(`  🪦 ${action.heroName}: ${spell.name} → ${creature.name} revient du cimetière en main!`, 'special');
            emitAnimation(room, 'graveyardReturn', { player: playerNum, card: creature });
            await sleep(900);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
    }
    // POISON TOUTES LES CRÉATURES ADVERSES (Contamination de l'eau)
    else if (spell.pattern === 'all' && spell.effect === 'triggerPoison') {
        // Brume toxique : toutes les créatures empoisonnées subissent leurs dégâts de poison immédiatement
        const poisonDmgAnims = [];
        const poisonDeaths = [];
        for (let p = 1; p <= 2; p++) {
            const pState = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = pState.field[r][c];
                    if (target && target.currentHp > 0 && target.poisonCounters && target.poisonCounters > 0) {
                        if (target.abilities && target.abilities.includes('antitoxin')) {
                            log(`  🛡️ ${target.name} est immunisé aux dégâts de poison (Antitoxine)`, 'info');
                            continue;
                        }
                        const dmg = target.poisonCounters;
                        target.currentHp -= dmg;
                        log(`  ☠️ ${action.heroName}: ${spell.name} → ${target.name} subit ${dmg} dégât(s) de poison!`, 'damage');
                        poisonDmgAnims.push({ type: 'poisonDamage', player: p, row: r, col: c, amount: dmg });
                        if (target.currentHp <= 0) {
                            poisonDeaths.push({ card: target, player: p, row: r, col: c });
                        } else if (target.abilities?.includes('power')) {
                            const powerBonus = target.powerX || 1;
                            target.powerStacks = (target.powerStacks || 0) + powerBonus;
                            log(`  💪 ${target.name} gagne +${powerBonus} ATK! (poison → puissance)`, 'buff');
                        }
                    }
                }
            }
        }
        if (poisonDmgAnims.length > 0) {
            emitAnimationBatch(room, poisonDmgAnims);
            await sleep(1400);
        }
        recalcDynamicAtk(room);
        // Gérer les morts par poison
        if (poisonDeaths.length > 0) {
            const deathAnims = [];
            const normalDeaths = [];
            for (const d of poisonDeaths) {
                const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
                if (result.transformed) {
                    deathAnims.push({ type: 'deathTransform', player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
                } else {
                    deathAnims.push({ type: 'death', player: d.player, row: d.row, col: d.col, card: d.card });
                    normalDeaths.push(d);
                }
            }
            if (deathAnims.length > 0) {
                emitAnimationBatch(room, deathAnims);
            }
            emitStateToBoth(room);
            await sleep(1100);
            const deathEffects = collectOnDeathEffects(normalDeaths);
            if (deathEffects.length > 0) {
                await resolvePostCombatEffects(room, deathEffects, log, sleep);
            }
            // Effets onPoisonDeath : accumuler le poison de toutes les morts avant d'émettre
            {
                const poisonAccum = {};
                const poisonSources = [];
                for (const d of normalDeaths) {
                    if (d.card.onPoisonDeath && d.card.onPoisonDeath.poisonAllEnemies) {
                        const poisonAmount = d.card.onPoisonDeath.poisonAllEnemies;
                        const enemyNum = d.player === 1 ? 2 : 1;
                        const enemyField = room.gameState.players[enemyNum].field;
                        for (let r = 0; r < enemyField.length; r++) {
                            for (let c = 0; c < enemyField[r].length; c++) {
                                const target = enemyField[r][c];
                                if (target && target.currentHp > 0) {
                                    const key = `${enemyNum}-${r}-${c}`;
                                    poisonAccum[key] = (poisonAccum[key] || 0) + poisonAmount;
                                }
                            }
                        }
                        poisonSources.push(d.card.name);
                    }
                }
                if (Object.keys(poisonAccum).length > 0) {
                    const poisonApplyAnims = [];
                    for (const [key, totalPoison] of Object.entries(poisonAccum)) {
                        const [enemyNum, r, c] = key.split('-').map(Number);
                        const target = room.gameState.players[enemyNum].field[r][c];
                        if (target && target.currentHp > 0) {
                            target.poisonCounters = (target.poisonCounters || 0) + totalPoison;
                            log(`☠️ ${poisonSources.join(' + ')} empoisonne ${target.name} (+${totalPoison} compteur poison, total: ${target.poisonCounters})`, 'damage');
                            poisonApplyAnims.push({ type: 'poisonApply', player: enemyNum, row: r, col: c, amount: totalPoison });
                        }
                    }
                    if (poisonApplyAnims.length > 0) {
                        emitAnimationBatch(room, poisonApplyAnims);
                        emitStateToBoth(room);
                        await sleep(1000);
                    }
                }
            }
            // buffOnEnemyPoisonDeath (Serpent d'émeraude) : +N/+N accumulé par morts poison
            {
                const deathCountByAlly = {};
                for (const d of normalDeaths) {
                    const allyNum = d.player === 1 ? 2 : 1;
                    deathCountByAlly[allyNum] = (deathCountByAlly[allyNum] || 0) + 1;
                }
                let anyBuff = false;
                for (const [allyNum, count] of Object.entries(deathCountByAlly)) {
                    const allyField = room.gameState.players[parseInt(allyNum)].field;
                    for (let r = 0; r < 4; r++) {
                        for (let c = 0; c < 2; c++) {
                            const ally = allyField[r][c];
                            if (ally && ally.currentHp > 0 && ally.buffOnEnemyPoisonDeath) {
                                if (ally.baseAtk === undefined) ally.baseAtk = ally.atk;
                                if (ally.baseHp === undefined) ally.baseHp = ally.hp;
                                ally.buffCounters = (ally.buffCounters || 0) + count;
                                ally.hp += count;
                                ally.currentHp += count;
                                log(`💪 ${ally.name} gagne +${count}/+${count} (${count} mort(s) poison)`, 'buff');
                                // Piétinement conditionnel (trampleAtBuffCounters)
                                if (ally.trampleAtBuffCounters && ally.buffCounters >= ally.trampleAtBuffCounters && !ally.abilities.includes('trample')) {
                                    ally.abilities.push('trample');
                                    ally.addedAbilities = ally.addedAbilities || [];
                                    ally.addedAbilities.push('trample');
                                    log(`🦶 ${ally.name} acquiert Piétinement! (${ally.buffCounters} marqueurs +1/+1)`, 'buff');
                                }
                                emitAnimation(room, 'buffApply', { player: parseInt(allyNum), row: r, col: c, atkBuff: count, hpBuff: count });
                                anyBuff = true;
                            }
                        }
                    }
                }
                if (anyBuff) {
                    recalcDynamicAtk(room);
                    emitStateToBoth(room);
                    await new Promise(r => setTimeout(r, 800));
                }
            }
            recalcDynamicAtk(room);
            // healOnEnemyPoisonDeath (Reine toxique)
            await applyHealOnEnemyPoisonDeath(room, normalDeaths, log);
        } else {
            emitStateToBoth(room);
        }
    }
    else if (spell.pattern === 'all' && spell.effect === 'poisonAllEnemies') {
        const opponentNum = playerNum === 1 ? 2 : 1;
        const opponent = room.gameState.players[opponentNum];
        const amount = spell.poisonAmount || 1;
        const poisonAnims = [];
        let count = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const target = opponent.field[r][c];
                if (target && target.currentHp > 0) {
                    target.poisonCounters = (target.poisonCounters || 0) + amount;
                    poisonAnims.push({ type: 'poisonApply', player: opponentNum, row: r, col: c, amount });
                    log(`  ☠️ ${action.heroName}: ${spell.name} → ${target.name} reçoit ${amount} marqueur(s) poison`, 'damage');
                    count++;
                }
            }
        }
        if (poisonAnims.length > 0) {
            emitAnimationBatch(room, poisonAnims);
            await sleep(800);
        }
        if (count > 0) {
            recalcDynamicAtk(room);
        }
        emitStateToBoth(room);
    }
    else if (spell.pattern === 'all' && spell.effect === 'debuffAll') {
        // Cri d'outre tombe : -ATK -HP à toutes les créatures
        const atkDebuff = spell.atkDebuff || 0;
        const hpDebuff = spell.hpDebuff || 0;
        log(`  💀 ${action.heroName}: ${spell.name} → -${atkDebuff} ATK / -${hpDebuff} HP à toutes les créatures!`, 'damage');

        const debuffAnims = [];
        const deaths = [];
        for (let p = 1; p <= 2; p++) {
            const targetPlayer = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = targetPlayer.field[r][c];
                    if (target && target.currentHp > 0) {
                        target.buffCounters = (target.buffCounters || 0) - atkDebuff;
                        target.hp = Math.max(1, target.hp - hpDebuff);
                        target.currentHp -= hpDebuff;
                        debuffAnims.push({ type: 'buffApply', player: p, row: r, col: c, atkBuff: -atkDebuff, hpBuff: -hpDebuff });
                        if (target.currentHp <= 0) {
                            deaths.push({ player: targetPlayer, p, r, c, target });
                        }
                    }
                }
            }
        }
        if (debuffAnims.length > 0) {
            emitAnimationBatch(room, debuffAnims);
        }
        await sleep(800);
        recalcDynamicAtk(room);

        if (deaths.length > 0) {
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
            emitStateToBoth(room);
            await sleep(1100);
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.target, d.p, d.r, d.c, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }
        emitStateToBoth(room);
    }
    // SORT QUI TOUCHE TOUTES LES CRÉATURES
    else if (spell.pattern === 'all') {
        const spellBoost = getSpellBoost(room, playerNum);
        const totalDamage = spell.damage + spellBoost;
        log(`  🌋 ${action.heroName}: ${spell.name} - ${totalDamage} dégâts à toutes les créatures!${spellBoost > 0 ? ` (+${spellBoost} sort renforcé)` : ''}`, 'damage');

        // Phase 1: Collecter toutes les cibles et envoyer les animations de dégâts EN BATCH
        const deaths = [];
        const spellAnimations = [];
        for (let p = 1; p <= 2; p++) {
            const targetPlayer = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = targetPlayer.field[r][c];
                    if (target) {
                        spellAnimations.push({ type: 'spellDamage', player: p, row: r, col: c, amount: totalDamage });
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
                        const actualDmg = applyCreatureDamage(target, totalDamage, room, log, p, r, c);

                        if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                            target.powerStacks = (target.powerStacks || 0) + (target.powerX || 1);
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
                await processOnDeathAbility(room, d.target, d.p, d.r, d.c, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }

        emitStateToBoth(room);
    }
    // SORT SUR UN HÉROS (peut être allié ou adverse selon targetPlayer)
    else if (spell.pattern === 'hero') {
        const targetHero = room.gameState.players[action.targetPlayer];
        const targetName = targetHero.heroName;
        
        if (spell.damage) {
            // Dégâts au héros ciblé
            const spellBoost = getSpellBoost(room, playerNum);
            const totalDamage = spell.damage + spellBoost;
            targetHero.hp -= totalDamage;
            log(`  👊 ${action.heroName}: ${spell.name} → ${targetName} (-${totalDamage})${spellBoost > 0 ? ` (+${spellBoost} sort renforcé)` : ''}`, 'damage');
            emitAnimation(room, 'heroHit', { defender: action.targetPlayer, damage: totalDamage });
            io.to(room.code).emit('directDamage', { defender: action.targetPlayer, damage: totalDamage });
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
        } else if (spell.effect === 'selfDamageAndDraw') {
            if (spell.selfDamage) {
                targetHero.hp -= spell.selfDamage;
                log(`  🩸 ${action.heroName}: ${spell.name} → ${targetName} (-${spell.selfDamage} PV)`, 'damage');
                emitAnimation(room, 'heroHit', { defender: action.targetPlayer, damage: spell.selfDamage });
                emitStateToBoth(room);
                await sleep(600);
            }
            if (spell.drawAmount) {
                await drawCards(room, action.targetPlayer, spell.drawAmount, log, sleep, `${action.heroName}: ${spell.name}`);
            }
            emitStateToBoth(room);
        } else if (spell.effect === 'mill') {
            const millCount = spell.millCount || 4;
            const milledCards = [];
            for (let i = 0; i < millCount; i++) {
                if (targetHero.deck.length === 0) break;
                const card = targetHero.deck.shift();
                addToGraveyard(targetHero, card);
                milledCards.push(card);
            }
            for (const card of milledCards) {
                log(`  🪦 ${action.heroName}: ${spell.name} → ${card.name} va au cimetière`, 'action');
                emitAnimation(room, 'burn', { player: action.targetPlayer, card });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1200);
            }
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        } else if (spell.effect === 'millHighestCostCreature') {
            // Pacte sombre : met la créature avec le coût le plus élevé du deck au cimetière
            const creatures = targetHero.deck.filter(c => c.type === 'creature');
            if (creatures.length > 0) {
                const maxCost = Math.max(...creatures.map(c => c.cost));
                const candidates = creatures.filter(c => c.cost === maxCost);
                const chosen = candidates[Math.floor(Math.random() * candidates.length)];
                const idx = targetHero.deck.indexOf(chosen);
                targetHero.deck.splice(idx, 1);
                addToGraveyard(targetHero, chosen);
                log(`  🪦 ${action.heroName}: ${spell.name} → ${chosen.name} (coût ${maxCost}) va au cimetière`, 'action');
                emitAnimation(room, 'burn', { player: action.targetPlayer, card: chosen });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1200);
                recalcDynamicAtk(room);
                emitStateToBoth(room);
            } else {
                log(`  💨 ${action.heroName}: ${spell.name} → aucune créature dans la bibliothèque`, 'action');
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

        const spellBoost = getSpellBoost(room, playerNum);
        const totalDamage = spell.damage + spellBoost;
        log(`  ✝️ ${action.heroName}: ${spell.name} en croix sur ${slotNames[action.row][action.col]}!${spellBoost > 0 ? ` (+${spellBoost} sort renforcé)` : ''}`, 'damage');

        // Highlight les zones touchées
        io.to(room.code).emit('spellHighlight', { targets: allTargets, type: 'damage', pattern: 'cross' });

        // Phase 1: Envoyer toutes les animations de dégâts EN BATCH
        const spellAnimations = [];
        for (const t of allTargets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];
            if (target) {
                spellAnimations.push({ type: 'spellDamage', player: t.player, row: t.row, col: t.col, amount: totalDamage });
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
                const actualDmg = applyCreatureDamage(target, totalDamage, room, log, t.player, t.row, t.col);
                if (actualDmg > 0) {
                    log(`    🔥 ${target.name} (-${totalDamage})`, 'damage');
                }

                if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                    target.powerStacks = (target.powerStacks || 0) + (target.powerX || 1);
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
                await processOnDeathAbility(room, d.target, d.t.player, d.t.row, d.t.col, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }

        emitStateToBoth(room);
    }
    // RÉANIMATION : placer une créature du cimetière sur le terrain
    else if (spell.effect === 'reanimate') {
        // Chercher la créature dans le cimetière (index + fallback uid)
        let creatureIdx = -1;
        if (action.graveyardIndex !== null && action.graveyardIndex !== undefined &&
            action.graveyardIndex >= 0 && action.graveyardIndex < player.graveyard.length) {
            const candidate = player.graveyard[action.graveyardIndex];
            if (candidate && candidate.type === 'creature') {
                if (!action.graveyardCreatureUid || candidate.uid === action.graveyardCreatureUid || candidate.id === action.graveyardCreatureUid) {
                    creatureIdx = action.graveyardIndex;
                }
            }
        }
        if (creatureIdx === -1 && action.graveyardCreatureUid) {
            creatureIdx = player.graveyard.findIndex(c =>
                c.type === 'creature' && (c.uid === action.graveyardCreatureUid || c.id === action.graveyardCreatureUid)
            );
        }

        if (creatureIdx === -1 || player.field[action.row][action.col]) {
            log(`  💨 ${action.heroName}: ${spell.name} échoue (cible invalide)`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            const baseCard = CardDB.creatures.find(c => c.id === creature.id);
            const template = baseCard || creature;

            const placed = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: creature.uid || `${Date.now()}-reanimate-${Math.random()}`,
                currentHp: template.hp,
                baseAtk: template.atk,
                baseHp: template.hp,
                canAttack: (template.abilities && (template.abilities.includes('haste') || template.abilities.includes('superhaste'))) ? true : false,
                turnsOnField: 0,
                movedThisTurn: false
            };
            if (placed.abilities.includes('protection')) placed.hasProtection = true;
            if (placed.abilities.includes('camouflage')) placed.hasCamouflage = true;
            if (placed.abilities.includes('untargetable')) placed.hasUntargetable = true;
            placed.summonOrder = ++room.gameState.summonCounter;

            player.field[action.row][action.col] = placed;

            // onReanimate : buffs spéciaux à la réanimation (ex: Blaireau contaminé)
            if (placed.onReanimate) {
                const reanBuff = placed.onReanimate;
                if (reanBuff.atkBuff) placed.buffCounters = (placed.buffCounters || 0) + reanBuff.atkBuff;
                if (reanBuff.hpBuff) { placed.hp += reanBuff.hpBuff; placed.currentHp += reanBuff.hpBuff; }
                if (reanBuff.addAbility && !placed.abilities.includes(reanBuff.addAbility)) {
                    placed.abilities.push(reanBuff.addAbility);
                    placed.addedAbilities = placed.addedAbilities || [];
                    placed.addedAbilities.push(reanBuff.addAbility);
                }
                log(`  ✨ ${placed.name} gagne +${reanBuff.atkBuff || 0}/+${reanBuff.hpBuff || 0} et ${reanBuff.addAbility || ''} (réanimation)!`, 'buff');
                recalcDynamicAtk(room);
            }

            log(`  🪦 ${action.heroName}: ${spell.name} → ${placed.name} revient du cimetière!`, 'special');

            emitAnimation(room, 'reanimate', {
                player: playerNum,
                row: action.row,
                col: action.col,
                card: placed
            });
            await sleep(1200);

            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
    }
    else if (spell.effect === 'reanimateHaste') {
        // Cycle éternel : réanime avec célérité + sacrifice en fin de tour
        let creatureIdx = -1;
        if (action.graveyardIndex !== null && action.graveyardIndex !== undefined &&
            action.graveyardIndex >= 0 && action.graveyardIndex < player.graveyard.length) {
            const candidate = player.graveyard[action.graveyardIndex];
            if (candidate && candidate.type === 'creature') {
                if (!action.graveyardCreatureUid || candidate.uid === action.graveyardCreatureUid || candidate.id === action.graveyardCreatureUid) {
                    creatureIdx = action.graveyardIndex;
                }
            }
        }
        if (creatureIdx === -1 && action.graveyardCreatureUid) {
            creatureIdx = player.graveyard.findIndex(c =>
                c.type === 'creature' && (c.uid === action.graveyardCreatureUid || c.id === action.graveyardCreatureUid)
            );
        }

        if (creatureIdx === -1 || player.field[action.row][action.col]) {
            log(`  💨 ${action.heroName}: ${spell.name} échoue (cible invalide)`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            const baseCard = CardDB.creatures.find(c => c.id === creature.id);
            const template = baseCard || creature;

            const placed = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: creature.uid || `${Date.now()}-reanimateHaste-${Math.random()}`,
                currentHp: template.hp,
                baseAtk: template.atk,
                baseHp: template.hp,
                canAttack: true,
                turnsOnField: 0,
                movedThisTurn: false
            };
            // Ajouter célérité si pas déjà présente
            if (!placed.abilities.includes('haste') && !placed.abilities.includes('superhaste')) {
                placed.abilities.push('haste');
                placed.addedAbilities = placed.addedAbilities || [];
                placed.addedAbilities.push('haste');
            }
            // Marquer pour sacrifice en fin de tour
            if (!placed.endOfTurn) placed.endOfTurn = {};
            placed.endOfTurn.selfSacrifice = true;
            if (placed.abilities.includes('protection')) placed.hasProtection = true;
            if (placed.abilities.includes('camouflage')) placed.hasCamouflage = true;
            if (placed.abilities.includes('untargetable')) placed.hasUntargetable = true;
            placed.summonOrder = ++room.gameState.summonCounter;

            player.field[action.row][action.col] = placed;

            // onReanimate : buffs spéciaux à la réanimation (ex: Blaireau contaminé)
            if (placed.onReanimate) {
                const reanBuff = placed.onReanimate;
                if (reanBuff.atkBuff) placed.buffCounters = (placed.buffCounters || 0) + reanBuff.atkBuff;
                if (reanBuff.hpBuff) { placed.hp += reanBuff.hpBuff; placed.currentHp += reanBuff.hpBuff; }
                if (reanBuff.addAbility && !placed.abilities.includes(reanBuff.addAbility)) {
                    placed.abilities.push(reanBuff.addAbility);
                    placed.addedAbilities = placed.addedAbilities || [];
                    placed.addedAbilities.push(reanBuff.addAbility);
                }
                log(`  ✨ ${placed.name} gagne +${reanBuff.atkBuff || 0}/+${reanBuff.hpBuff || 0} et ${reanBuff.addAbility || ''} (réanimation)!`, 'buff');
                recalcDynamicAtk(room);
            }

            log(`  🔄 ${action.heroName}: ${spell.name} → ${placed.name} revient du cimetière avec Célérité!`, 'special');

            emitAnimation(room, 'reanimate', {
                player: playerNum,
                row: action.row,
                col: action.col,
                card: placed
            });
            await sleep(1200);

            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
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
                // Destruction directe (ex: Plan douteux)
                if (spell.effect === 'destroy') {
                    log(`  💀 ${action.heroName}: ${spell.name} → ${target.name} détruit!`, 'damage');
                    emitAnimation(room, 'destroy', { player: action.targetPlayer, row: action.row, col: action.col });
                    await sleep(1200);

                    const result = handleCreatureDeath(room, target, action.targetPlayer, action.row, action.col, log);
                    if (result.transformed) {
                        emitAnimation(room, 'deathTransform', { player: action.targetPlayer, row: action.row, col: action.col, fromCard: target, toCard: result.newCard });
                    } else {
                        emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col, card: target });
                    }
                    await sleep(1100);
                    if (!result.transformed) {
                        await processOnDeathAbility(room, target, action.targetPlayer, action.row, action.col, log, sleep);
                    }

                    await applyPendingHealOnDeath(room, log);
                    emitStateToBoth(room);
                }
                // Dégâts
                else if (spell.offensive && spell.damage) {
                    const spellBoost = getSpellBoost(room, playerNum);
                    const totalDamage = spell.damage + spellBoost;
                    // Animation de flammes pour les dégâts de sort
                    emitAnimation(room, 'spellDamage', { player: action.targetPlayer, row: action.row, col: action.col, amount: totalDamage });
                    await sleep(800);

                    const actualDmg = applyCreatureDamage(target, totalDamage, room, log, action.targetPlayer, action.row, action.col);
                    if (actualDmg > 0) {
                        log(`  🔥 ${action.heroName}: ${spell.name} → ${target.name} (-${totalDamage})${spellBoost > 0 ? ` (+${spellBoost} sort renforcé)` : ''}`, 'damage');
                    }

                    if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                        target.powerStacks = (target.powerStacks || 0) + (target.powerX || 1);
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
                            await processOnDeathAbility(room, target, action.targetPlayer, action.row, action.col, log, sleep);
                        }

                        // Effet onKill du sort (ex: piocher une carte)
                        if (spell.onKill) {
                            if (spell.onKill.draw && player.deck.length > 0) {
                                await drawCards(room, playerNum, spell.onKill.draw, log, sleep, `${action.heroName}: ${spell.name} (onKill)`);
                            }
                        }

                        await applyPendingHealOnDeath(room, log);
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
                    target.spellAtkBuff = (target.spellAtkBuff || 0) + spell.buff.atk;
                    target.hp += spell.buff.hp;
                    target.baseHp = (target.baseHp ?? target.hp) + spell.buff.hp;
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
                // Buff ATK seul (ex: Altération musculaire)
                if (!spell.offensive && spell.effect === 'atkBuff' && spell.atkBuff) {
                    target.atk += spell.atkBuff;
                    target.spellAtkBuff = (target.spellAtkBuff || 0) + spell.atkBuff;
                    if (!target.appliedEffects) target.appliedEffects = [];
                    target.appliedEffects.push({
                        name: spell.name,
                        description: `+${spell.atkBuff} ⚔️`
                    });
                    log(`  💪 ${action.heroName}: ${spell.name} → ${target.name} (+${spell.atkBuff} ATK)`, 'action');
                    emitAnimation(room, 'buff', { player: action.targetPlayer, row: action.row, col: action.col, atk: spell.atkBuff, hp: 0 });
                    await sleep(800);
                }
            } else {
                if (spell.returnOnMiss) {
                    log(`  🔄 ${action.heroName}: ${spell.name} n'a rien touché, retourne dans la main!`, 'action');
                    spellReturned = true;
                } else {
                    log(`  💨 ${action.heroName}: ${spell.name} n'a rien touché`, 'action');
                }
                emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
            }
        }
    }

    // Retourner le sort en main si spellReturned (returnOnMiss)
    if (spellReturned) {
        // Le sort a été ajouté au cimetière au début — le retirer
        if (spellAddedToGraveyard) {
            const spellUid = spell.uid || spell.id;
            const idx = player.graveyard.findIndex(c => (c.uid || c.id) === spellUid);
            if (idx !== -1) player.graveyard.splice(idx, 1);
        }
        await sleep(300);
        spell.revealedToOpponent = true;
        player.hand.push(spell);
        const handIndex = player.hand.length - 1;
        emitAnimation(room, 'spellReturnToHand', { player: playerNum, card: spell, handIndex });
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
async function processCombatSlot(room, row, col, log, sleep) {
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    
    const p1Card = p1State.field[row][col];
    const p2Card = p2State.field[row][col];
    
    // Collecter les attaques de ce slot
    const attacks = [];
    
    // Créature du joueur 1 à ce slot
    if (p1Card && canCreatureAttack(p1Card)) {
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
    if (p2Card && canCreatureAttack(p2Card)) {
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
    
    // Boost ATK avant l'attaque si la cible est le héros (Salamandre de braise)
    let anyHeroAtkBoost = false;
    for (const atk of attacks) {
        const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
        if (atk.targetIsHero && attackerCard && attackerCard.onHeroAttack && attackerCard.onHeroAttack.atkBoost) {
            const boost = attackerCard.onHeroAttack.atkBoost;
            attackerCard.atk += boost;
            attackerCard.tempAtkBoost = (attackerCard.tempAtkBoost || 0) + boost;
            log(`🔥 ${attackerCard.name} gagne +${boost} ATK!`, 'buff');
            emitAnimation(room, 'atkBoost', {
                player: atk.attackerPlayer,
                row: atk.attackerRow,
                col: atk.attackerCol,
                boost: boost
            });
            anyHeroAtkBoost = true;
        }
    }
    if (anyHeroAtkBoost) {
        emitStateToBoth(room);
        await sleep(800);
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
                            log(`⛏️ Clivant: ${attacker.name} → ${adjTarget.name} (-${actualCDmg})`, 'damage');
                            emitAnimation(room, 'damage', { player: atkData.targetPlayer, row: adjRow, col: atkData.targetCol, amount: actualCDmg });
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
                        log(`🦏 Piétinement: ${attacker.name} → ${trampleTarget.name} (-${actualTrDmg})`, 'damage');
                        emitAnimation(room, 'damage', { player: atkData.targetPlayer, row: atkData.targetRow, col: trampleCol, amount: actualTrDmg });
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
                    accumulateLifelink(attacker, excessDamage);
                }
            };

            // Dégâts SIMULTANÉS - les deux s'infligent des dégâts en même temps
            const dmg1to2 = atk1.attacker.atk;
            const dmg2to1 = atk2.attacker.atk;

            const actualDmg1to2 = applyCreatureDamage(atk2.attacker, dmg1to2, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualDmg2to1 = applyCreatureDamage(atk1.attacker, dmg2to1, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });

            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${actualDmg1to2} / -${actualDmg2to1})`, 'damage');
            if (actualDmg1to2 > 0) emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: actualDmg1to2 });
            if (actualDmg2to1 > 0) emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: actualDmg2to1 });

            // Power bonus (stocké pour après)
            if (actualDmg2to1 > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                atk1.attacker.pendingPowerBonus = (atk1.attacker.pendingPowerBonus || 0) + (atk1.attacker.powerX || 1);
            }
            if (actualDmg1to2 > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                atk2.attacker.pendingPowerBonus = (atk2.attacker.pendingPowerBonus || 0) + (atk2.attacker.powerX || 1);
            }

            // Clivant - en combat mutuel, se déclenche toujours
            atk1.cleaveTargets = applyCleave(atk1.attacker, atk1);
            atk2.cleaveTargets = applyCleave(atk2.attacker, atk2);

            // Piétinement en combat mutuel - seulement si la cible est un tireur
            if (atk2.attacker.abilities.includes('shooter')) {
                await applyTrample(atk1.attacker, atk2.attacker, atk1);
            }
            if (atk1.attacker.abilities.includes('shooter')) {
                await applyTrample(atk2.attacker, atk1.attacker, atk2);
            }
            
            // Appliquer bonus Power et émettre l'état (avec dégâts de riposte visibles)
            applyPendingPowerBonuses(room, log);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
            // Appliquer les soins Lifelink APRÈS émission (le client voit d'abord les dégâts)
            await applyPendingLifelinkHeals(room, log);
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
            accumulateLifelink(attackerCard, attackerCard.atk);

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
                log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${actualMainDmg})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: actualMainDmg });
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
                            log(`⛏️ Clivant: ${attackerCard.name} → ${adjTarget.name} (-${actualCleaveDmg})`, 'damage');
                            emitAnimation(room, 'damage', { player: atk.targetPlayer, row: adjRow, col: atk.targetCol, amount: actualCleaveDmg });
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
                        log(`🦏 Piétinement: ${attackerCard.name} → ${trampleTarget.name} (-${actualTrampleDmg})`, 'damage');
                        emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: trampleCol, amount: actualTrampleDmg });
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
                    accumulateLifelink(attackerCard, excessDamage);

                    if (targetOwner.hp <= 0) return true;
                }
            }

            // RIPOSTE: seulement si la cible NE PEUT PAS attaquer ce tour (wall = ne peut pas attaquer → riposte)
            // Les tireurs ne reçoivent JAMAIS de riposte (attaque à distance)
            const targetCanAttack = canCreatureAttack(targetCard);
            const attackerIsShooter = attackerCard.abilities.includes('shooter');

            // Riposte si la cible ne peut pas attaquer et l'attaquant n'est pas un tireur
            if (!targetCanAttack && !attackerIsShooter) {
                const riposteDamage = targetCard.atk;
                const actualRiposteDmg = applyCreatureDamage(attackerCard, riposteDamage, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid, isRiposte: true });
                if (actualRiposteDmg > 0) {
                    log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${actualRiposteDmg})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: actualRiposteDmg });
                }

                if (actualRiposteDmg > 0 && attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                    attackerCard.pendingPowerBonus = (attackerCard.pendingPowerBonus || 0) + (attackerCard.powerX || 1);
                }
            }
        }
    }

    // Appliquer bonus Power et émettre l'état (avec dégâts de riposte visibles)
    applyPendingPowerBonuses(room, log);
    recalcDynamicAtk(room);
    emitStateToBoth(room);
    // Appliquer les soins Lifelink APRÈS émission (le client voit d'abord les dégâts)
    await applyPendingLifelinkHeals(room, log);
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
                    card.powerStacks = (card.powerStacks || 0) + card.pendingPowerBonus;
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
        await processOnDeathAbility(room, d.card, d.player, d.row, d.col, log, sleep);
    }

    // Appliquer les soins healOnDeath APRÈS les morts (Reine toxique etc.)
    await applyPendingHealOnDeath(room, log);
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
    
    if (p1Card && canCreatureAttack(p1Card) && p1Card.currentHp > 0) {
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

    if (p2Card && canCreatureAttack(p2Card) && p2Card.currentHp > 0) {
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

    // Effets post-combat à résoudre simultanément (onDeath + onHeroHit + futurs)
    const postCombatEffects = [];

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
                shooterDamage: getEffectiveCombatDamage(other.attacker, shooterDmg),
                flyerDamage: getEffectiveCombatDamage(shooter.attacker, otherDmg),
                isShooter: true
            });
            await sleep(1200);

            // Dégâts simultanés
            const actualShooterDmg = applyCreatureDamage(other.attacker, shooterDmg, room, log, other.attackerPlayer, other.attackerRow, other.attackerCol, { player: shooter.attackerPlayer, row: shooter.attackerRow, col: shooter.attackerCol, uid: shooter.attacker.uid });
            const actualOtherDmg = applyCreatureDamage(shooter.attacker, otherDmg, room, log, shooter.attackerPlayer, shooter.attackerRow, shooter.attackerCol, { player: other.attackerPlayer, row: other.attackerRow, col: other.attackerCol, uid: other.attacker.uid });

            log(`⚔️ ${shooter.attacker.name} ↔ ${other.attacker.name} (-${actualShooterDmg} / -${actualOtherDmg})`, 'damage');

            if (actualOtherDmg > 0 && shooter.attacker.currentHp > 0 && shooter.attacker.abilities.includes('power')) {
                const powerBonus = shooter.attacker.powerX || 1;
                shooter.attacker.powerStacks = (shooter.attacker.powerStacks || 0) + powerBonus;
                log(`💪 ${shooter.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
            if (actualShooterDmg > 0 && other.attacker.currentHp > 0 && other.attacker.abilities.includes('power')) {
                const powerBonus = other.attacker.powerX || 1;
                other.attacker.powerStacks = (other.attacker.powerStacks || 0) + powerBonus;
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
                damage1: getEffectiveCombatDamage(atk2.attacker, dmg1),
                damage2: getEffectiveCombatDamage(atk1.attacker, dmg2)
            });
            await sleep(800);

            // Dégâts simultanés
            const actualD1bs = applyCreatureDamage(atk2.attacker, dmg1, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualD2bs = applyCreatureDamage(atk1.attacker, dmg2, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });

            log(`⚔️ ${atk1.attacker.name} ↔ ${atk2.attacker.name} (-${actualD1bs} / -${actualD2bs})`, 'damage');

            if (actualD2bs > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                const powerBonus = atk1.attacker.powerX || 1;
                atk1.attacker.powerStacks = (atk1.attacker.powerStacks || 0) + powerBonus;
                log(`💪 ${atk1.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
            if (actualD1bs > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                const powerBonus = atk2.attacker.powerX || 1;
                atk2.attacker.powerStacks = (atk2.attacker.powerStacks || 0) + powerBonus;
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
                damage1: getEffectiveCombatDamage(atk2.attacker, dmg1),
                damage2: getEffectiveCombatDamage(atk1.attacker, dmg2),
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
                atk1.attacker.powerStacks = (atk1.attacker.powerStacks || 0) + powerBonus;
                log(`💪 ${atk1.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
            if (actualD1mm > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                const powerBonus = atk2.attacker.powerX || 1;
                atk2.attacker.powerStacks = (atk2.attacker.powerStacks || 0) + powerBonus;
                log(`💪 ${atk2.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
            }
        }

        // Clivant en combat mutuel - seulement si la cible est un tireur
        if (atk2.isShooter) {
            applyCleaveV2(room, atk1.attacker, atk1, log);
        }
        if (atk1.isShooter) {
            applyCleaveV2(room, atk2.attacker, atk2, log);
        }

        // Piétinement en combat mutuel - seulement si la cible est un tireur
        if (atk2.isShooter) {
            await applyTrampleDamage(room, atk1, log, sleep);
        }
        if (atk1.isShooter) {
            await applyTrampleDamage(room, atk2, log, sleep);
        }

        // Appliquer bonus Power et émettre l'état (avec dégâts de riposte visibles)
        applyPendingPowerBonuses(room, log);
        recalcDynamicAtk(room);
        emitStateToBoth(room);
        // Appliquer les soins Lifelink APRÈS émission (le client voit d'abord les dégâts)
        await applyPendingLifelinkHeals(room, log);
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
                    const target1Card = !atk1.targetIsHero ? room.gameState.players[atk1.targetPlayer].field[atk1.targetRow]?.[atk1.targetCol] : null;
                    const target2Card = !atk2.targetIsHero ? room.gameState.players[atk2.targetPlayer].field[atk2.targetRow]?.[atk2.targetCol] : null;
                    emitAnimation(room, 'attack', {
                        combatType: 'parallel_attacks',
                        attack1: {
                            attacker: atk1.attackerPlayer,
                            row: atk1.attackerRow,
                            col: atk1.attackerCol,
                            targetPlayer: atk1.targetPlayer,
                            targetRow: atk1.targetRow,
                            targetCol: atk1.targetIsHero ? -1 : atk1.targetCol,
                            damage: target1Card ? getEffectiveCombatDamage(target1Card, damage1) : damage1,
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
                            damage: target2Card ? getEffectiveCombatDamage(target2Card, damage2) : damage2,
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
                        accumulateLifelink(attackerCard1, damage1);

                        // Collecter onHeroHit (sera résolu avec les autres effets post-combat)
                        if (attackerCard1.onHeroHit === 'draw') {
                            postCombatEffects.push({ type: 'draw', player: atk1.attackerPlayer, count: 1, source: `${attackerCard1.name} (onHeroHit)` });
                        }
                    } else {
                        const targetCard1 = room.gameState.players[atk1.targetPlayer].field[atk1.targetRow][atk1.targetCol];
                        if (targetCard1) {
                            const actualDmg1p = applyCreatureDamage(targetCard1, damage1, room, log, atk1.targetPlayer, atk1.targetRow, atk1.targetCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: attackerCard1.uid });
                            if (actualDmg1p > 0) log(`⚔️ ${attackerCard1.name} → ${targetCard1.name} (-${actualDmg1p})`, 'damage');
                            if (actualDmg1p > 0 && targetCard1.currentHp > 0 && targetCard1.abilities.includes('power')) {
                                const powerBonus = targetCard1.powerX || 1;
                                targetCard1.powerStacks = (targetCard1.powerStacks || 0) + powerBonus;
                                log(`💪 ${targetCard1.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                            if (!atk1.isShooter) {
                                const riposteDmg = targetCard1.atk;
                                const actualRip1 = applyCreatureDamage(attackerCard1, riposteDmg, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk1.targetPlayer, row: atk1.targetRow, col: atk1.targetCol, uid: targetCard1.uid, isRiposte: true });
                                if (actualRip1 > 0) {
                                    log(`↩️ ${targetCard1.name} riposte → ${attackerCard1.name} (-${actualRip1})`, 'damage');
                                    emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: actualRip1 });
                                }
                                if (actualRip1 > 0 && attackerCard1.currentHp > 0 && attackerCard1.abilities.includes('power')) {
                                    const powerBonus = attackerCard1.powerX || 1;
                                    attackerCard1.powerStacks = (attackerCard1.powerStacks || 0) + powerBonus;
                                    log(`💪 ${attackerCard1.name} gagne +${powerBonus} ATK!`, 'buff');
                                }
                            }
                            applyCleaveV2(room, attackerCard1, atk1, log);
                            await applyTrampleDamage(room, atk1, log, sleep);
                        }
                    }

                    // Appliquer les dégâts pour atk2
                    if (atk2.targetIsHero) {
                        const targetPlayer2 = room.gameState.players[atk2.targetPlayer];
                        targetPlayer2.hp -= damage2;
                        log(`⚔️ ${attackerCard2.name} → ${targetPlayer2.heroName} (-${damage2})`, 'damage');
                        io.to(room.code).emit('directDamage', { defender: atk2.targetPlayer, damage: damage2 });
                        accumulateLifelink(attackerCard2, damage2);

                        // Collecter onHeroHit (sera résolu avec les autres effets post-combat)
                        if (attackerCard2.onHeroHit === 'draw') {
                            postCombatEffects.push({ type: 'draw', player: atk2.attackerPlayer, count: 1, source: `${attackerCard2.name} (onHeroHit)` });
                        }
                    } else {
                        const targetCard2 = room.gameState.players[atk2.targetPlayer].field[atk2.targetRow][atk2.targetCol];
                        if (targetCard2) {
                            const actualDmg2p = applyCreatureDamage(targetCard2, damage2, room, log, atk2.targetPlayer, atk2.targetRow, atk2.targetCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: attackerCard2.uid });
                            if (actualDmg2p > 0) log(`⚔️ ${attackerCard2.name} → ${targetCard2.name} (-${actualDmg2p})`, 'damage');
                            if (actualDmg2p > 0 && targetCard2.currentHp > 0 && targetCard2.abilities.includes('power')) {
                                const powerBonus = targetCard2.powerX || 1;
                                targetCard2.powerStacks = (targetCard2.powerStacks || 0) + powerBonus;
                                log(`💪 ${targetCard2.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                            if (!atk2.isShooter) {
                                const riposteDmg = targetCard2.atk;
                                const actualRip2 = applyCreatureDamage(attackerCard2, riposteDmg, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk2.targetPlayer, row: atk2.targetRow, col: atk2.targetCol, uid: targetCard2.uid, isRiposte: true });
                                if (actualRip2 > 0) {
                                    log(`↩️ ${targetCard2.name} riposte → ${attackerCard2.name} (-${actualRip2})`, 'damage');
                                    emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: actualRip2 });
                                }
                                if (actualRip2 > 0 && attackerCard2.currentHp > 0 && attackerCard2.abilities.includes('power')) {
                                    const powerBonus = attackerCard2.powerX || 1;
                                    attackerCard2.powerStacks = (attackerCard2.powerStacks || 0) + powerBonus;
                                    log(`💪 ${attackerCard2.name} gagne +${powerBonus} ATK!`, 'buff');
                                }
                            }
                            applyCleaveV2(room, attackerCard2, atk2, log);
                            await applyTrampleDamage(room, atk2, log, sleep);
                        }
                    }

                    // Vérifier victoire
                    if (room.gameState.players[1].hp <= 0 || room.gameState.players[2].hp <= 0) {
                        emitStateToBoth(room);
                        return true;
                    }

                    // Appliquer bonus Power et émettre l'état (avec dégâts de riposte visibles)
                    applyPendingPowerBonuses(room, log);
                    recalcDynamicAtk(room);
                    emitStateToBoth(room);
                    // Appliquer les soins Lifelink APRÈS émission (le client voit d'abord les dégâts)
                    await applyPendingLifelinkHeals(room, log);
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

                    // Animations de mort simultanées
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
                        // Collecter onDeath et fusionner avec les effets onHeroHit
                        const onDeathEffects = collectOnDeathEffects(normalDeaths);
                        postCombatEffects.push(...onDeathEffects);
                    }

                    // Appliquer les soins healOnDeath APRÈS les morts
                    await applyPendingHealOnDeath(room, log);

                    // Résoudre TOUS les effets post-combat en simultané (onHeroHit + onDeath)
                    await resolvePostCombatEffects(room, postCombatEffects, log, sleep);
                    return false;
                }
        }

        // Traitement séquentiel standard (1 attaque)
        for (const atk of attacks) {
            // Vérifier si l'attaquant est encore en vie
            const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
            if (!attackerCard || attackerCard.currentHp <= 0) continue;
            if (atk.targetIsHero) {
                // Attaque le héros
                const targetPlayer = room.gameState.players[atk.targetPlayer];

                // Boost ATK avant l'attaque si cible = héros (Salamandre de braise)
                if (attackerCard.onHeroAttack && attackerCard.onHeroAttack.atkBoost) {
                    const boost = attackerCard.onHeroAttack.atkBoost;
                    attackerCard.atk += boost;
                    attackerCard.tempAtkBoost = (attackerCard.tempAtkBoost || 0) + boost;
                    log(`🔥 ${attackerCard.name} gagne +${boost} ATK!`, 'buff');
                    emitAnimation(room, 'atkBoost', {
                        player: atk.attackerPlayer,
                        row: atk.attackerRow,
                        col: atk.attackerCol,
                        boost: boost
                    });
                    emitStateToBoth(room);
                    await sleep(800);
                }

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
                await sleep(800);

                targetPlayer.hp -= damage;
                targetPlayer.heroAttackedThisTurn = true;
                log(`⚔️ ${attackerCard.name} → ${targetPlayer.heroName} (-${damage})`, 'damage');
                io.to(room.code).emit('directDamage', { defender: atk.targetPlayer, damage: damage });
                accumulateLifelink(attackerCard, damage);

                // Collecter onHeroHit (sera résolu avec les autres effets post-combat)
                if (attackerCard.onHeroHit === 'draw') {
                    postCombatEffects.push({ type: 'draw', player: atk.attackerPlayer, count: 1, source: `${attackerCard.name} (onHeroHit)` });
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
                    damage: getEffectiveCombatDamage(targetCard, damage),
                    isFlying: atk.isFlying,
                    isShooter: atk.isShooter
                });
                await sleep(800); // Attendre la fin de l'animation d'attaque

                const actualSeqDmg = applyCreatureDamage(targetCard, damage, room, log, atk.targetPlayer, atk.targetRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
                if (actualSeqDmg > 0) {
                    log(`⚔️ ${attackerCard.name} → ${targetCard.name} (-${actualSeqDmg})`, 'damage');
                    emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: actualSeqDmg, skipScratch: atk.isShooter });
                }

                // Power pour la cible
                if (actualSeqDmg > 0 && targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                    const powerBonus = targetCard.powerX || 1;
                    targetCard.powerStacks = (targetCard.powerStacks || 0) + powerBonus;
                    log(`💪 ${targetCard.name} gagne +${powerBonus} ATK!`, 'buff');
                }

                // RIPOSTE - toutes les créatures ripostent sauf si l'attaquant est un tireur
                if (!atk.isShooter) {
                    const riposteDmg = targetCard.atk;
                    const actualSeqRip = applyCreatureDamage(attackerCard, riposteDmg, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid, isRiposte: true });
                    if (actualSeqRip > 0) {
                        log(`↩️ ${targetCard.name} riposte → ${attackerCard.name} (-${actualSeqRip})`, 'damage');
                        emitAnimation(room, 'damage', { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, amount: actualSeqRip });
                    }

                    if (actualSeqRip > 0 && attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                        const powerBonus = attackerCard.powerX || 1;
                        attackerCard.powerStacks = (attackerCard.powerStacks || 0) + powerBonus;
                        log(`💪 ${attackerCard.name} gagne +${powerBonus} ATK!`, 'buff');
                    }
                }

                // Clivant (attaque unilatérale)
                applyCleaveV2(room, attackerCard, atk, log);
                // Piétinement (attaque unilatérale)
                await applyTrampleDamage(room, atk, log, sleep);
            }
        }
    }

    // Appliquer les soins Lifelink et bonus Power (cleave, etc.)
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.abilities && card.abilities.includes('lifelink')) {
                }
            }
        }
    }
    // Appliquer bonus Power et émettre l'état (avec dégâts de riposte visibles)
    applyPendingPowerBonuses(room, log);
    recalcDynamicAtk(room);
    emitStateToBoth(room);
    // Appliquer les soins Lifelink APRÈS émission (le client voit d'abord les dégâts)
    await applyPendingLifelinkHeals(room, log);
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
        // Collecter onDeath et fusionner avec les effets onHeroHit
        const onDeathEffects = collectOnDeathEffects(normalDeaths);
        postCombatEffects.push(...onDeathEffects);
    }

    // Appliquer les soins healOnDeath APRÈS les morts
    await applyPendingHealOnDeath(room, log);

    // Résoudre TOUS les effets post-combat en simultané (onHeroHit + onDeath)
    await resolvePostCombatEffects(room, postCombatEffects, log, sleep);

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
        if (p1Card && canCreatureAttack(p1Card) && p1Card.currentHp > 0) {
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
        if (p2Card && canCreatureAttack(p2Card) && p2Card.currentHp > 0) {
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

        // Boost ATK avant l'attaque si cible = héros (Salamandre de braise)
        let anyHeroAtkBoostRow = false;
        for (const atk of attacks) {
            const atkCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
            if (atk.targetIsHero && atkCard && atkCard.onHeroAttack && atkCard.onHeroAttack.atkBoost) {
                const boost = atkCard.onHeroAttack.atkBoost;
                atkCard.atk += boost;
                atkCard.tempAtkBoost = (atkCard.tempAtkBoost || 0) + boost;
                log(`🔥 ${atkCard.name} gagne +${boost} ATK!`, 'buff');
                emitAnimation(room, 'atkBoost', {
                    player: atk.attackerPlayer,
                    row: atk.attackerRow,
                    col: atk.attackerCol,
                    boost: boost
                });
                anyHeroAtkBoostRow = true;
            }
        }
        if (anyHeroAtkBoostRow) {
            emitStateToBoth(room);
            await sleep(800);
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
                accumulateLifelink(attackerCard, attackerCard.atk);

                if (attackerCard.onHeroHit === 'draw') {
                    await drawCards(room, atk.attackerPlayer, 1, log, sleep, `${attackerCard.name} (onHeroHit)`);
                }

                if (room.gameState.players[atk.targetPlayer].hp <= 0) {
                    applyPendingPowerBonuses(room, log);
                    emitStateToBoth(room);
                    await applyPendingLifelinkHeals(room, log);
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
                    emitAnimation(room, 'damage', { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, amount: actualUniDmg, skipScratch: atk.isShooter });
                }

                if (actualUniDmg > 0 && targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                    targetCard.pendingPowerBonus = (targetCard.pendingPowerBonus || 0) + (targetCard.powerX || 1);
                }

                await applyTrampleDamage(room, atk, log, sleep);

                // RIPOSTE si la cible était vivante et que l'attaquant n'est pas un tireur
                const targetWasAlive = hpBeforeThisAttack > 0;

                if (targetWasAlive && !atk.isShooter) {
                    const riposteDamage = targetCard.atk;
                    const actualUniRip = applyCreatureDamage(attackerCard, riposteDamage, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid, isRiposte: true });
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

        // Appliquer bonus Power et émettre l'état (avec dégâts de riposte visibles)
        applyPendingPowerBonuses(room, log);
        recalcDynamicAtk(room);
        emitStateToBoth(room);
        // Appliquer les soins Lifelink APRÈS émission (le client voit d'abord les dégâts)
        await applyPendingLifelinkHeals(room, log);
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

// Helper pour appliquer les dégâts de clivant (cleave)
// Touche les créatures sur les lignes adjacentes (row ±1) dans la même colonne que la cible
function applyCleaveV2(room, attackerCard, atk, log) {
    if (!attackerCard.abilities.includes('cleave')) return;

    const targetOwner = room.gameState.players[atk.targetPlayer];
    const adjacentRows = [atk.targetRow - 1, atk.targetRow + 1].filter(r => r >= 0 && r < 4);
    const cleaveDamage = attackerCard.cleaveX || attackerCard.atk;

    for (const adjRow of adjacentRows) {
        const adjTarget = targetOwner.field[adjRow][atk.targetCol];
        if (adjTarget && adjTarget.currentHp > 0) {
            const attackerIsFlying = attackerCard.abilities.includes('fly');
            const attackerIsShooter = attackerCard.abilities.includes('shooter');
            if (adjTarget.abilities.includes('fly') && !attackerIsFlying && !attackerIsShooter) {
                continue;
            }

            const actualCDmg = applyCreatureDamage(adjTarget, cleaveDamage, room, log, atk.targetPlayer, adjRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
            if (actualCDmg > 0) {
                log(`⛏️ Clivant: ${attackerCard.name} → ${adjTarget.name} (-${actualCDmg})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.targetPlayer, row: adjRow, col: atk.targetCol, amount: actualCDmg });
            }

            if (actualCDmg > 0 && adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + (adjTarget.powerX || 1);
            }
        }
    }
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

    // Le piétinement touche la créature derrière quelle que soit son type (y compris volante)
    
    if (trampleTarget) {
        const hpBefore = trampleTarget.currentHp;
        const actualTrDmg = applyCreatureDamage(trampleTarget, excessDamage, room, log, atk.targetPlayer, atk.targetRow, trampleCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: atk.attacker.uid });
        if (actualTrDmg > 0) {
            log(`🦏 Piétinement: ${atk.attacker.name} → ${trampleTarget.name} (-${actualTrDmg})`, 'damage');
            emitAnimation(room, 'trampleDamage', {
                player: atk.targetPlayer, row: atk.targetRow, col: trampleCol,
                amount: actualTrDmg, hpBefore: hpBefore, hpAfter: trampleTarget.currentHp,
                attackerName: atk.attacker.name, targetName: trampleTarget.name
            });
            await sleep(800);
        }

        if (actualTrDmg > 0 && trampleTarget.currentHp > 0 && trampleTarget.abilities.includes('power')) {
            trampleTarget.pendingPowerBonus = (trampleTarget.pendingPowerBonus || 0) + (trampleTarget.powerX || 1);
        }
    } else if (excessDamage > 0 && !trampleTarget) {
        targetOwner.hp -= excessDamage;
        targetOwner.heroAttackedThisTurn = true;
        log(`🦏 Piétinement: ${atk.attacker.name} → ${targetOwner.heroName} (-${excessDamage})`, 'damage');
        emitAnimation(room, 'trampleHeroHit', {
            defender: atk.targetPlayer, damage: excessDamage,
            attackerName: atk.attacker.name, heroName: targetOwner.heroName
        });
        accumulateLifelink(atk.attacker, excessDamage);
        await sleep(800);
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

    // Ignorer les créatures intangibles, pétrifiées et camouflées lors de la recherche de cibles
    const frontIsIntangible = enemyFront && enemyFront.abilities.includes('intangible');
    const backIsIntangible = enemyBack && enemyBack.abilities.includes('intangible');
    const frontIsPetrified = enemyFront && enemyFront.petrified;
    const backIsPetrified = enemyBack && enemyBack.petrified;
    const frontIsCamouflaged = enemyFront && enemyFront.hasCamouflage;
    const backIsCamouflaged = enemyBack && enemyBack.hasCamouflage;
    const effectiveFront = (frontIsIntangible || frontIsPetrified || frontIsCamouflaged) ? null : enemyFront;
    const effectiveBack = (backIsIntangible || backIsPetrified || backIsCamouflaged) ? null : enemyBack;

    const frontIsFlying = effectiveFront && effectiveFront.abilities.includes('fly');
    const backIsFlying = effectiveBack && effectiveBack.abilities.includes('fly');
    const frontIsShooter = effectiveFront && effectiveFront.abilities.includes('shooter');
    const backIsShooter = effectiveBack && effectiveBack.abilities.includes('shooter');

    // Vérifier si les créatures ennemies peuvent attaquer (pour l'interception)
    const frontCanAttack = effectiveFront && canCreatureAttack(effectiveFront);
    const backCanAttack = effectiveBack && canCreatureAttack(effectiveBack);

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

        // Vérifier si le joueur a une créature avec manaCap sur le terrain
        let lowestManaCap = Infinity;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.manaCap) {
                    lowestManaCap = Math.min(lowestManaCap, card.manaCap);
                }
            }
        }
        if (lowestManaCap < Infinity) {
            player.energy = Math.min(player.energy, lowestManaCap);
        }

        resetPlayerForNewTurn(player);
    }
    
    // Recalculer l'ATK dynamique (startOfTurn effects déjà appliqués dans resolvePostCombatEffects Phase 0)
    recalcDynamicAtk(room);

    // Calculer les effets de Mélodie pour le planning (bloque les créatures en face)
    processMelodyEffects(room);

    // Re-snapshot confirmedField pour inclure melodyLocked et medusaGazeMarker
    for (let p = 1; p <= 2; p++) {
        room.gameState.players[p].confirmedField = deepClone(room.gameState.players[p].field);
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
        }
    }
    
    // ==================== MODE TEST ====================
    socket.on('requestCardCatalog', (callback) => {
        const catalog = {
            creatures: CardDB.creatures,
            spells: CardDB.spells,
            traps: CardDB.traps
        };
        callback(catalog);
    });

    socket.on('setTestHand', (cardIds, callback) => {
        const info = playerRooms.get(socket.id);
        if (!info) { callback({ success: false }); return; }
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'mulligan') { callback({ success: false }); return; }

        const player = room.gameState.players[info.playerNum];
        if (player.mulliganDone) { callback({ success: false }); return; }

        if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 7) {
            callback({ success: false, error: 'Invalid card count' });
            return;
        }

        // Lookup de toutes les cartes
        const allCards = [...CardDB.creatures, ...CardDB.spells, ...CardDB.traps];
        const cardMap = {};
        allCards.forEach(c => { cardMap[c.id] = c; });

        for (const id of cardIds) {
            if (!cardMap[id]) {
                callback({ success: false, error: `Unknown card: ${id}` });
                return;
            }
        }

        // Remettre la main actuelle dans le deck
        player.deck.push(...player.hand);
        player.hand = [];

        // Créer la nouvelle main depuis les templates
        const newHand = cardIds.map((id, i) => {
            const template = cardMap[id];
            const card = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: `${Date.now()}-test-${Math.random()}-${i}`
            };
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.baseAtk = card.atk;
                card.baseHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
                if (card.abilities && card.abilities.includes('protection')) {
                    card.hasProtection = true;
                }
                if (card.abilities && card.abilities.includes('camouflage')) {
                    card.hasCamouflage = true;
                }
                if (card.abilities && card.abilities.includes('untargetable')) {
                    card.hasUntargetable = true;
                }
            }
            return card;
        });

        player.hand = newHand;
        player.deck.sort(() => Math.random() - 0.5);

        emitStateToPlayer(room, info.playerNum);
        callback({ success: true });
    });

    socket.on('setCompleteDeck', (cardIds, callback) => {
        const info = playerRooms.get(socket.id);
        if (!info) { callback({ success: false }); return; }
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'mulligan') { callback({ success: false }); return; }

        const player = room.gameState.players[info.playerNum];
        if (player.mulliganDone) { callback({ success: false }); return; }

        if (!Array.isArray(cardIds) || cardIds.length !== 40) {
            callback({ success: false, error: 'Le deck doit contenir exactement 40 cartes' });
            return;
        }

        // Lookup de toutes les cartes
        const allCards = [...CardDB.creatures, ...CardDB.spells, ...CardDB.traps];
        const cardMap = {};
        allCards.forEach(c => { cardMap[c.id] = c; });

        // Valider que chaque carte existe et est noire ou piège, max 2 exemplaires
        const cardCounts = {};
        for (const id of cardIds) {
            const template = cardMap[id];
            if (!template) {
                callback({ success: false, error: `Carte inconnue: ${id}` });
                return;
            }
            if (template.faction !== 'black' && template.type !== 'trap') {
                callback({ success: false, error: `Carte non autorisée: ${template.name}` });
                return;
            }
            cardCounts[id] = (cardCounts[id] || 0) + 1;
            if (cardCounts[id] > 2) {
                callback({ success: false, error: `Max 2 exemplaires: ${template.name}` });
                return;
            }
        }

        // Créer le deck complet
        const deck = cardIds.map((id, i) => {
            const template = cardMap[id];
            const card = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: `${Date.now()}-deck-${Math.random()}-${i}`
            };
            if (card.type === 'creature') {
                card.currentHp = card.hp;
                card.baseAtk = card.atk;
                card.baseHp = card.hp;
                card.canAttack = false;
                card.turnsOnField = 0;
                card.movedThisTurn = false;
                if (card.abilities && card.abilities.includes('protection')) card.hasProtection = true;
                if (card.abilities && card.abilities.includes('camouflage')) card.hasCamouflage = true;
                if (card.abilities && card.abilities.includes('untargetable')) card.hasUntargetable = true;
            }
            return card;
        });

        // Mélanger (Fisher-Yates)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // Piocher 7 cartes pour la main
        player.hand = deck.splice(0, 7);
        player.deck = deck;

        // Forcer le héros Erebeth
        const erebeth = { ...HEROES.erebeth };
        player.hero = erebeth;
        player.heroName = erebeth.name;

        emitStateToBoth(room);
        callback({ success: true });
    });

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
        if (!card || card.type !== 'creature') return;

        // Calculer le coût effectif (réduction poison pour Reine toxique)
        let effectiveCost = card.cost;
        if (card.poisonCostReduction) {
            effectiveCost = Math.max(0, card.cost - countTotalPoisonCounters(room));
        }

        if (effectiveCost > player.energy) return;
        if (player.field[row][col]) return;
        if (!canPlaceAt(card, col)) return;

        // Vérification des conditions d'invocation spéciales
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (player.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) return;
        }
        if (card.sacrifice) {
            const targets = getAdjacentSacrificeTargets(player.field, row, col);
            if (targets.length < card.sacrifice) return;
        }

        player.energy -= effectiveCost;
        const placed = { 
            ...card, 
            turnsOnField: 0, 
            canAttack: !!(card.abilities?.includes('haste') || card.abilities?.includes('superhaste')),
            currentHp: card.hp, 
            movedThisTurn: false 
        };
        placed.summonOrder = ++room.gameState.summonCounter;
        player.field[row][col] = placed;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;

        // Recalculer les ATK dynamiques (ex: Lance gobelin compte les gobelins)
        recalcDynamicAtk(room);

        const clonedCard = deepClone(placed);
        player.pendingActions.push({ type: 'place', card: clonedCard, row, col });

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
        if (card.melodyLocked || card.petrified) return;
        if (player.field[toRow][toCol]) return;

        const isFlying = card.abilities?.includes('fly');
        const isVerticalMove = (fromCol === toCol && Math.abs(toRow - fromRow) === 1);
        const isHorizontalMove = (fromRow === toRow && fromCol !== toCol);
        
        // Déplacement vertical: toutes les créatures
        // Déplacement horizontal: seulement les volants
        if (!isVerticalMove && !(isFlying && isHorizontalMove)) return;
        
        if (!canPlaceAt(card, toCol)) return;
        
        card.movedThisTurn = true;
        // Sauvegarder position et turnsOnField pour les effets de début de tour (Phase 0 avant déplacements)
        card.preMoveturnsOnField = card.turnsOnField;
        card.preMoveRow = fromRow;
        card.preMoveCol = fromCol;
        // Redéploiement = la créature ne peut plus attaquer ce tour
        // Célérité permet d'attaquer au tour d'invocation, mais pas après un déplacement
        // Supercélérité permet toujours d'attaquer après un déplacement
        if (!card.abilities?.includes('superhaste')) {
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

            // Validation camouflage/inciblable : les sorts offensifs ciblés ne peuvent pas cibler une créature camouflée ou inciblable
            // Utiliser confirmedField (snapshot du début de tour) car c'est ce que le joueur voit réellement
            if (spell.offensive && targetPlayer !== info.playerNum) {
                const targetPlayerState = room.gameState.players[targetPlayer];
                const checkField = targetPlayerState.confirmedField || targetPlayerState.field;
                const target = checkField[row][col];
                if (target && (target.hasCamouflage || target.hasUntargetable)) return;

                // Spell Magnet : si l'adversaire a une créature avec spellMagnet, le sort doit la cibler
                if (!spell.targetEmptySlot) {
                    const magnetSlots = [];
                    for (let r = 0; r < 4; r++) {
                        for (let c = 0; c < 2; c++) {
                            const card = checkField[r][c];
                            if (card && card.spellMagnet && card.currentHp > 0 && !card.hasCamouflage && !card.hasUntargetable) {
                                magnetSlots.push(`${r},${c}`);
                            }
                        }
                    }
                    if (magnetSlots.length > 0 && !magnetSlots.includes(`${row},${col}`)) return;
                }
            }

            // Validation pour les sorts qui ciblent un slot vide ennemi (ex: Plan douteux)
            // Utiliser confirmedField (snapshot du début de tour) car le joueur voit le snapshot
            if (spell.targetEmptySlot) {
                if (targetPlayer === info.playerNum) return; // Doit cibler l'adversaire
                const targetPlayerState = room.gameState.players[targetPlayer];
                const checkField = targetPlayerState.confirmedField || targetPlayerState.field;
                if (checkField[row][col]) return; // Le slot doit être vide dans le snapshot
            }

            // Validation buff allié : slot allié avec créature
            if (spell.targetSelfCreature) {
                if (targetPlayer !== info.playerNum) return;
                if (!player.field[row][col]) return;
            }

            // Validation Réanimation : slot vide allié + créature au cimetière
            if (spell.targetSelfEmptySlot) {
                if (targetPlayer !== info.playerNum) return;
                if (player.field[row][col]) return;
                const { graveyardCreatureUid, graveyardIndex } = data;
                if (graveyardCreatureUid === undefined && graveyardIndex === undefined) return;
                let found = false;
                if (graveyardIndex !== undefined && graveyardIndex >= 0 && graveyardIndex < player.graveyard.length) {
                    const c = player.graveyard[graveyardIndex];
                    if (c && c.type === 'creature') found = true;
                }
                if (!found && graveyardCreatureUid) {
                    found = player.graveyard.some(c => c.type === 'creature' && (c.uid === graveyardCreatureUid || c.id === graveyardCreatureUid));
                }
                if (!found) return;
            }
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
            playerNum: info.playerNum,
            graveyardCreatureUid: data.graveyardCreatureUid || null,
            graveyardIndex: data.graveyardIndex !== undefined ? data.graveyardIndex : null,
            timestamp: Date.now()
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

        // Validation graveyard pour les sorts qui en ont besoin (ex: Mon précieux)
        if (spell.requiresGraveyardCreature) {
            const { graveyardCreatureUid, graveyardIndex } = data;
            if (graveyardCreatureUid === undefined && graveyardIndex === undefined) return;
            let found = false;
            if (graveyardIndex !== undefined && graveyardIndex >= 0 && graveyardIndex < player.graveyard.length) {
                const c = player.graveyard[graveyardIndex];
                if (c && c.type === 'creature') found = true;
            }
            if (!found && graveyardCreatureUid) {
                found = player.graveyard.some(c => c.type === 'creature' && (c.uid === graveyardCreatureUid || c.id === graveyardCreatureUid));
            }
            if (!found) return;
        }

        player.energy -= effectiveCost;
        player.spellsCastThisTurn++;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;

        player.pendingActions.push({
            type: 'spell', spell: deepClone(spell),
            targetPlayer: info.playerNum === 1 ? 2 : 1,
            playerNum: info.playerNum,
            heroName: player.heroName,
            row: -1, col: -1,
            graveyardCreatureUid: data.graveyardCreatureUid || null,
            graveyardIndex: data.graveyardIndex !== undefined ? data.graveyardIndex : null,
            timestamp: Date.now()
        });

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