const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

// Import game modules
const { CardDB, CardByIdMap, HERO_NAMES, HEROES, resetCardForGraveyard, addToGraveyard, createDeck, createPlayerState, createGameState } = require('./game/cards');
const {
    CANONICAL_COMBAT_SLOT_PHASES,
    createCombatCycleId,
    markDeathResolvedInCycle,
    markOnDeathResolvedInCycle,
    markPoisonDeathResolvedInCycle
} = require('./game/combat-canonical');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, perMessageDeflate: true });

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const VIS_TRACE_DIR = path.join(__dirname, '_tmp', 'vis-trace');

function ensureVisTraceDir() {
    try {
        fs.mkdirSync(VIS_TRACE_DIR, { recursive: true });
        return true;
    } catch (_) {
        return false;
    }
}

function sanitizeFilePart(value, fallback = 'unknown') {
    const raw = String(value || fallback);
    const clean = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return clean.length > 60 ? clean.slice(0, 60) : (clean || fallback);
}

app.post('/api/vis-trace/upload', (req, res) => {
    try {
        if (!ensureVisTraceDir()) {
            return res.status(500).json({ ok: false, error: 'vis_trace_dir_unavailable' });
        }

        const body = req.body || {};
        const lines = Array.isArray(body.lines) ? body.lines : [];
        if (!lines.length) {
            return res.status(400).json({ ok: false, error: 'empty_lines' });
        }

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const roomCode = sanitizeFilePart(body.roomCode, 'room_unknown');
        const playerNum = Number.isFinite(Number(body.playerNum)) ? Number(body.playerNum) : 0;
        const turn = Number.isFinite(Number(body.turn)) ? Number(body.turn) : 0;
        const reason = sanitizeFilePart(body.reason, 'manual');
        const sessionId = sanitizeFilePart(body.sessionId, 'session');

        const fileName = `vistrace-${ts}-room-${roomCode}-p${playerNum}-t${turn}-${reason}-${sessionId}.log`;
        const filePath = path.join(VIS_TRACE_DIR, fileName);

        const header = {
            savedAt: Date.now(),
            roomCode: body.roomCode || null,
            playerNum,
            turn,
            phase: body.phase || null,
            reason: body.reason || null,
            sessionId: body.sessionId || null,
            lineCount: lines.length
        };
        const payload = `# ${JSON.stringify(header)}\n${lines.join('\n')}\n`;
        fs.writeFileSync(filePath, payload, 'utf8');

        return res.json({
            ok: true,
            file: fileName,
            lineCount: lines.length
        });
    } catch (e) {
        return res.status(500).json({
            ok: false,
            error: 'vis_trace_write_failed',
            message: String(e && e.message ? e.message : e)
        });
    }
});

// ==================== RESOLUTION V2 ====================
const RESOLUTION_V2 = true; // Nouveau systÃƒÂ¨me de rÃƒÂ©solution simplifiÃƒÂ©

// ==================== GAME STATE ====================
const rooms = new Map();
const playerRooms = new Map();
const TURN_TIME = 90;
// Refonte "client-paced":
// - OFF par defaut (legacy stable)
// - ON si BATAILLE_CLIENT_PACED=1 (le serveur ne pace plus la resolution via sleep)
const CLIENT_PACED_RESOLUTION = process.env.BATAILLE_CLIENT_PACED === '1';
// Pacing de resolution cote serveur:
// - par defaut: legacy (sleep complet, stable visuellement)
// - BATAILLE_SERVER_PACING=0 => mode accelere (sleep cappe)
const SERVER_PACING_ENABLED = process.env.BATAILLE_SERVER_PACING !== '0';
const _SERVER_SLEEP_CAP_RAW = Number(process.env.BATAILLE_SERVER_SLEEP_CAP_MS || 120);
const SERVER_SLEEP_CAP_MS = Number.isFinite(_SERVER_SLEEP_CAP_RAW)
    ? Math.max(0, _SERVER_SLEEP_CAP_RAW)
    : 120;

// ==================== PERF PROFILING ====================
// Perf logging enabled by default; set BATAILLE_PERF=0 to disable.
const PERF_ENABLED = process.env.BATAILLE_PERF !== '0';
const PERF_DIR = path.join(__dirname, '_tmp');
const PERF_LOG_FILE = path.join(PERF_DIR, `perf-${Date.now()}.ndjson`);
const _STATE_EMIT_COALESCE_RAW = Number(process.env.BATAILLE_STATE_COALESCE_MS || 80);
const STATE_EMIT_COALESCE_MS = Number.isFinite(_STATE_EMIT_COALESCE_RAW)
    ? Math.max(20, _STATE_EMIT_COALESCE_RAW)
    : 80;

function perfWrite(event, data) {
    if (!PERF_ENABLED) return;
    try {
        fs.appendFileSync(
            PERF_LOG_FILE,
            JSON.stringify({ ts: Date.now(), event, ...data }) + '\n',
            'utf8'
        );
    } catch (_) {}
}

if (PERF_ENABLED) {
    try {
        fs.mkdirSync(PERF_DIR, { recursive: true });
        perfWrite('sessionStart', { pid: process.pid });
        console.log(`[PERF] Profiling actif -> ${PERF_LOG_FILE}`);
    } catch (_) {}
}
console.log(
    `[PACE] serverResolutionPacing=${SERVER_PACING_ENABLED ? 'legacy' : `capped(${SERVER_SLEEP_CAP_MS}ms)`}`
);
console.log(
    `[MODE] clientPacedResolution=${CLIENT_PACED_RESOLUTION ? 'ON' : 'OFF'}`
);

function ensureRoomPerf(room) {
    if (!PERF_ENABLED || !room) return null;
    if (!room._perf) {
        room._perf = {
            createdAt: Date.now(),
            turns: new Map(),
            finalizedTurns: new Set()
        };
    }
    return room._perf;
}

function ensureTurnPerf(room, turn) {
    if (!PERF_ENABLED) return null;
    const rp = ensureRoomPerf(room);
    if (!rp) return null;
    if (!rp.turns.has(turn)) {
        rp.turns.set(turn, {
            turn,
            startedAt: Date.now(),
            stateEmitCount: 0,
            stateEmitBytes: 0,
            stateEmitSerializeMs: 0,
            stateEmitByPlayer: {
                1: { count: 0, bytes: 0 },
                2: { count: 0, bytes: 0 }
            },
            animationCount: 0,
            animationByType: {},
            resolutionLogCount: 0,
            resolutionStartAt: null,
            resolutionMs: null,
            clientLastByPlayer: { 1: null, 2: null }
        });
    }
    return rp.turns.get(turn);
}

function perfMarkTurnStart(room, turn) {
    const tp = ensureTurnPerf(room, turn);
    if (tp && !tp.startedAt) tp.startedAt = Date.now();
}

function perfMarkResolutionStart(room) {
    if (!PERF_ENABLED || !room) return;
    const turn = room.gameState?.turn || 0;
    const tp = ensureTurnPerf(room, turn);
    if (tp && !tp.resolutionStartAt) tp.resolutionStartAt = Date.now();
}

function perfRecordStateEmit(room, playerNum, bytes, serializeMs) {
    if (!PERF_ENABLED || !room) return;
    const turn = room.gameState?.turn || 0;
    const tp = ensureTurnPerf(room, turn);
    if (!tp) return;
    tp.stateEmitCount++;
    tp.stateEmitBytes += bytes;
    tp.stateEmitSerializeMs += serializeMs;
    if (tp.stateEmitByPlayer[playerNum]) {
        tp.stateEmitByPlayer[playerNum].count++;
        tp.stateEmitByPlayer[playerNum].bytes += bytes;
    }
}

function perfRecordAnimation(room, type) {
    if (!PERF_ENABLED || !room) return;
    const turn = room.gameState?.turn || 0;
    const tp = ensureTurnPerf(room, turn);
    if (!tp) return;
    tp.animationCount++;
    tp.animationByType[type] = (tp.animationByType[type] || 0) + 1;
}

function perfRecordResolutionLog(room) {
    if (!PERF_ENABLED || !room) return;
    const turn = room.gameState?.turn || 0;
    const tp = ensureTurnPerf(room, turn);
    if (tp) tp.resolutionLogCount++;
}

function perfRecordClient(room, playerNum, payload) {
    if (!PERF_ENABLED || !room || !payload || typeof payload !== 'object') return;
    const turn = Number(payload.turn || room.gameState?.turn || 0);
    if (!Number.isFinite(turn) || turn <= 0) return;
    const tp = ensureTurnPerf(room, turn);
    if (!tp) return;
    tp.clientLastByPlayer[playerNum] = {
        at: Date.now(),
        gsuCount: Number(payload.gsuCount || 0),
        gsuAvgMs: Number(payload.gsuAvgMs || 0),
        gsuMaxMs: Number(payload.gsuMaxMs || 0),
        gsuOver16Count: Number(payload.gsuOver16Count || 0),
        gsuOver33Count: Number(payload.gsuOver33Count || 0),
        gsuOver50Count: Number(payload.gsuOver50Count || 0),
        renderCount: Number(payload.renderCount || 0),
        renderAvgMs: Number(payload.renderAvgMs || 0),
        renderMaxMs: Number(payload.renderMaxMs || 0),
        renderOver16Count: Number(payload.renderOver16Count || 0),
        renderOver33Count: Number(payload.renderOver33Count || 0),
        renderOver50Count: Number(payload.renderOver50Count || 0),
        animQueueMax: Number(payload.animQueueMax || 0),
        animQueueAvg: Number(payload.animQueueAvg || 0),
        animQueueOver10Count: Number(payload.animQueueOver10Count || 0),
        animQueueOver20Count: Number(payload.animQueueOver20Count || 0),
        animQueueOver40Count: Number(payload.animQueueOver40Count || 0),
        resolutionLogCount: Number(payload.resolutionLogCount || 0),
        fpsMin: Number(payload.fpsMin || 0),
        fpsAvg: Number(payload.fpsAvg || 0),
        frameDeltaMaxMs: Number(payload.frameDeltaMaxMs || 0),
        frameJank20Count: Number(payload.frameJank20Count || 0),
        frameJank33Count: Number(payload.frameJank33Count || 0),
        frameJank50Count: Number(payload.frameJank50Count || 0),
        frameJank100Count: Number(payload.frameJank100Count || 0),
        longTaskCount: Number(payload.longTaskCount || 0),
        longTaskMaxMs: Number(payload.longTaskMaxMs || 0),
        animQueueWaitCount: Number(payload.animQueueWaitCount || 0),
        animQueueWaitAvgMs: Number(payload.animQueueWaitAvgMs || 0),
        animQueueWaitMaxMs: Number(payload.animQueueWaitMaxMs || 0),
        animStepCount: Number(payload.animStepCount || 0),
        animStepAvgMs: Number(payload.animStepAvgMs || 0),
        animStepMaxMs: Number(payload.animStepMaxMs || 0),
        animStepOver16Count: Number(payload.animStepOver16Count || 0),
        animStepOver33Count: Number(payload.animStepOver33Count || 0),
        animStepOver50Count: Number(payload.animStepOver50Count || 0),
        animItemsProcessed: Number(payload.animItemsProcessed || 0),
        animBatchMax: Number(payload.animBatchMax || 0),
        memUsedMB: Number(payload.memUsedMB || 0)
    };
}

function perfFinalizeTurn(room, turn, reason) {
    if (!PERF_ENABLED || !room) return;
    const rp = ensureRoomPerf(room);
    if (!rp || rp.finalizedTurns.has(turn)) return;
    const tp = rp.turns.get(turn);
    if (!tp) return;
    if (tp.resolutionStartAt && tp.resolutionMs === null) {
        tp.resolutionMs = Date.now() - tp.resolutionStartAt;
    }
    rp.finalizedTurns.add(turn);
    perfWrite('turnSummary', {
        room: room.code,
        turn,
        reason,
        stateEmitCount: tp.stateEmitCount,
        stateEmitBytes: tp.stateEmitBytes,
        stateEmitSerializeMs: Number(tp.stateEmitSerializeMs.toFixed(2)),
        stateEmitByPlayer: tp.stateEmitByPlayer,
        animationCount: tp.animationCount,
        animationByType: tp.animationByType,
        resolutionLogCount: tp.resolutionLogCount,
        resolutionMs: tp.resolutionMs,
        client: tp.clientLastByPlayer
    });
}

// Timing des animations (en ms) pour la rÃƒÂ©solution par paires
const ANIM_TIMING = {
    move: 700,
    summon: 550,
    spell: 1000,
    trapPlace: 900,
    combat: 800,
    margin: 200,       // marge de sÃƒÂ©curitÃƒÂ© entre paires
    phaseIntro: 600,   // temps d'affichage du nom de phase
};

// ==================== COMBAT PIPELINE (CANONIQUE) ====================
const COMBAT_PHASE_TRACE = process.env.BATAILLE_PHASE_TRACE === '1';
const COMBAT_PHASES = CANONICAL_COMBAT_SLOT_PHASES;
const COMBAT_PHASE_INDEX = Object.freeze(
    COMBAT_PHASES.reduce((acc, phase, idx) => {
        acc[phase] = idx;
        return acc;
    }, {})
);

function createCombatPhaseTracker(log, row, col) {
    let lastPhaseIdx = -1;
    return function enterCombatPhase(phase, meta = '') {
        const idx = COMBAT_PHASE_INDEX[phase];
        if (idx === undefined) return;
        if (idx < lastPhaseIdx) {
            log(
                `[PHASE][WARN] slot=${row},${col} phase-regression from=${COMBAT_PHASES[lastPhaseIdx]} to=${phase} ${meta}`,
                'error'
            );
        } else if (idx > lastPhaseIdx) {
            lastPhaseIdx = idx;
        }
        if (COMBAT_PHASE_TRACE) {
            log(
                `[PHASE] slot=${row},${col} phase=${phase}${meta ? ` ${meta}` : ''}`,
                'action'
            );
        }
    };
}

function markCombatPhase(log, row, col, phase, meta = '') {
    if (!COMBAT_PHASE_TRACE) return;
    log(`[PHASE] slot=${row},${col} phase=${phase}${meta ? ` ${meta}` : ''}`, 'action');
}

// GÃƒÂ©nÃƒÂ©rer un code de room unique
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

// Nettoyage d'une room aprÃƒÂ¨s gameOver (libÃƒÂ©rer mÃƒÂ©moire, timer, playerRooms)
function cleanupRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    perfWrite('roomCleanup', { room: roomCode });
    if (room.timer) clearInterval(room.timer);
    if (room._stateFlushTimer) clearTimeout(room._stateFlushTimer);
    room._stateFlushTimer = null;
    room._stateFlushPending = false;
    room._stateFlushExtra = null;
    room._lastStatePayloadByPlayer = null;
    if (room._graveyardSigCache) delete room._graveyardSigCache;
    // Nettoyer les entrÃƒÂ©es playerRooms pointant vers cette room
    for (const [socketId, info] of playerRooms) {
        if (info.code === roomCode) playerRooms.delete(socketId);
    }
    rooms.delete(roomCode);
}

// Ãƒâ€°mettre gameOver et programmer le nettoyage de la room aprÃƒÂ¨s 30s
function emitGameOver(room, data) {
    flushQueuedState(room);
    perfFinalizeTurn(room, room.gameState.turn, 'game_over');
    io.to(room.code).emit('gameOver', data);
    const code = room.code;
    setTimeout(() => cleanupRoom(code), 30000);
}

function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
}

function getGraveyardSig(graveyard) {
    if (!Array.isArray(graveyard) || graveyard.length === 0) return '0';
    return `${graveyard.length}:${graveyard.map(c => c?.uid || c?.id || '?').join('|')}`;
}

function resetPlayerForNewTurn(player) {
    player.ready = false;
    player.inDeployPhase = false;
    player.pendingActions = [];
    player.pendingSacrificeSlots = [];
    player.spellsCastThisTurn = 0;
    player.heroAttackedThisTurn = false;
    player.erebethHealedThisTurn = false;

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
    // Figer l'ÃƒÂ©tat revealed de la main pour l'adversaire (ne change pas pendant le planning)
    player.confirmedOppHand = player.hand.map(c => c.revealedToOpponent ? c : null);
}

function getPublicGameState(room, forPlayer) {
    const state = room.gameState;
    const opponent = forPlayer === 1 ? 2 : 1;
    const me = state.players[forPlayer];
    const opp = state.players[opponent];
    
    const isPlanning = state.phase === 'planning';
    const isRevealing = state.revealing;

    // Pour l'adversaire : pendant le planning Ã¢â€ â€™ confirmedField, pendant la rÃƒÂ©vÃƒÂ©lation Ã¢â€ â€™ revealField, sinon Ã¢â€ â€™ field rÃƒÂ©el
    let oppField = opp.field;
    let oppTraps = opp.traps;
    if (isPlanning && opp.confirmedField) {
        oppField = opp.confirmedField;
        oppTraps = opp.confirmedTraps;
    } else if (isRevealing && opp.revealField) {
        oppField = opp.revealField;
        oppTraps = opp.revealTraps;
    }

    // Recalculer poisonX dynamique Ã  chaque Ã©mission de state
    const patchPoison = (card, graveyardLen, source) => {
        if (!card) return card;
        const basePoisonRaw = Number(card.basePoisonX ?? card.poisonX ?? 1);
        const basePoisonX = Number.isFinite(basePoisonRaw) ? Math.max(0, Math.floor(basePoisonRaw)) : 1;
        if (card.basePoisonX === undefined) card.basePoisonX = basePoisonX;

        if (card.poisonPerGraveyard) {
            const stepRaw = Number(card.poisonPerGraveyard);
            const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.floor(stepRaw) : 1;
            card.poisonX = basePoisonX + Math.floor(graveyardLen / step);
        } else if (card.poisonEqualsTotalPoisonInPlay) {
            card.poisonX = basePoisonX + cachedPoisonCounters;
        }
        return card;
    };
    const patchField = (field, graveyardLen, source) => field.map(row => row.map(card => patchPoison(card, graveyardLen, source)));
    const patchHandCard = (card, graveyardLen, graveyardCreatureCount, source) => {
        if (!card) return card;
        patchPoison(card, graveyardLen, source);

        if (card.atkPerGraveyard) {
            const baseAtkRaw = Number(card.baseAtk ?? card.atk ?? 0);
            const baseAtk = Number.isFinite(baseAtkRaw) ? Math.floor(baseAtkRaw) : 0;
            if (card.baseAtk === undefined) card.baseAtk = baseAtk;
            card.atk = baseAtk + Math.max(0, graveyardCreatureCount);
        } else if (card.atkPerPoisonInPlay) {
            card.atk = Math.max(0, cachedPoisonCounters);
        }
        return card;
    };

    const cachedPoisonCounters = countTotalPoisonCounters(room);
    const meGraveyardLen = me.graveyard.length;
    const oppGraveyardLen = opp.graveyard.length;
    const meGraveyardCreatureCount = me.graveyard.reduce((n, g) => n + (g?.type === 'creature' ? 1 : 0), 0);

    // N'envoyer les tableaux complets de cimetiere que s'ils ont change
    // pour ce receveur (sinon, le client conserve le precedent).
    if (!room._graveyardSigCache) room._graveyardSigCache = { 1: {}, 2: {} };
    if (!room._graveyardSigCache[forPlayer]) room._graveyardSigCache[forPlayer] = {};
    const gyCache = room._graveyardSigCache[forPlayer];
    const meGraveyardSig = getGraveyardSig(me.graveyard);
    const oppGraveyardSig = getGraveyardSig(opp.graveyard);
    const includeMeGraveyard = gyCache.me !== meGraveyardSig;
    const includeOppGraveyard = gyCache.opp !== oppGraveyardSig;
    gyCache.me = meGraveyardSig;
    gyCache.opp = oppGraveyardSig;

    // Patch main
    for (const card of me.hand) patchHandCard(card, meGraveyardLen, meGraveyardCreatureCount, 'HAND');

    // Patch terrain Ã¢â‚¬â€ on crÃƒÂ©e toujours une copie mappÃƒÂ©e pour garantir les bonnes valeurs
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
        features: {
            clientPacedResolution: CLIENT_PACED_RESOLUTION
        },
        me: {
            hp: me.hp,
            energy: me.energy,
            maxEnergy: me.maxEnergy,
            hand: me.hand,
            deckCount: me.deck.length,
            field: meField,
            traps: me.traps,
            trapCards: me.trapCards, // Cartes piÃƒÂ¨ges pour l'affichage hover
            graveyard: includeMeGraveyard ? me.graveyard : undefined,
            graveyardCount: me.graveyard.length,
            ready: me.ready,
            inDeployPhase: me.inDeployPhase,
            heroName: me.heroName,
            hero: me.hero,
            spellsCastThisTurn: me.spellsCastThisTurn || 0,
            spellBoost: getSpellBoost(room, forPlayer),
            totalPoisonCounters: cachedPoisonCounters,
            pendingSacrificeSlots: me.pendingSacrificeSlots || []
        },
        opponent: {
            hp: opp.hp,
            energy: opp.energy,
            maxEnergy: opp.maxEnergy,
            handCount: isPlanning && opp.confirmedHandCount !== undefined
                ? opp.confirmedHandCount
                : opp.hand.length + (opp.handCountBonus || 0),
            oppHand: (() => {
                if (isPlanning && opp.confirmedHandCount !== undefined) {
                    return opp.confirmedOppHand || Array(opp.confirmedHandCount).fill(null);
                }
                const baseHand = opp.hand.map(c => c.revealedToOpponent ? c : null);
                const bonusCards = opp.handBonusCards || Array(opp.handCountBonus || 0).fill(null);
                if (bonusCards.length > 0 && opp.preResolutionHandLen !== undefined) {
                    // Interleaver les sorts en attente ÃƒÂ  leur position originale (avant les tokens ajoutÃƒÂ©s)
                    const insertIdx = Math.min(opp.preResolutionHandLen, baseHand.length);
                    return [...baseHand.slice(0, insertIdx), ...bonusCards, ...baseHand.slice(insertIdx)];
                }
                return [...baseHand, ...bonusCards];
            })(),
            deckCount: opp.deck.length,
            field: oppField,
            traps: oppTraps,
            graveyard: includeOppGraveyard ? opp.graveyard : undefined,
            graveyardCount: opp.graveyard.length,
            ready: opp.ready,
            heroName: opp.heroName,
            hero: opp.hero
        }
    };
}

function emitStateToPlayer(room, playerNum, extra) {
    const socketId = room.players[playerNum];
    if (socketId) {
        const t0 = PERF_ENABLED ? performance.now() : 0;
        const state = getPublicGameState(room, playerNum);
        if (extra) Object.assign(state, extra);
        const dedupeDuringResolution = room.gameState?.phase === 'resolution' && !extra;
        const needsSerialized = PERF_ENABLED || dedupeDuringResolution;
        let serialized = null;
        if (needsSerialized) {
            serialized = JSON.stringify(state);
        }

        if (dedupeDuringResolution) {
            if (!room._lastStatePayloadByPlayer) {
                room._lastStatePayloadByPlayer = { 1: null, 2: null };
            }
            if (room._lastStatePayloadByPlayer[playerNum] === serialized) {
                return;
            }
            room._lastStatePayloadByPlayer[playerNum] = serialized;
        } else if (room._lastStatePayloadByPlayer) {
            room._lastStatePayloadByPlayer[playerNum] = null;
        }

        if (PERF_ENABLED) {
            const bytes = Buffer.byteLength(serialized, 'utf8');
            const dt = performance.now() - t0;
            perfRecordStateEmit(room, playerNum, bytes, dt);
        }
        io.to(socketId).emit('gameStateUpdate', state);
    }
}

function _emitStateToBothImmediate(room, extra) {
    emitStateToPlayer(room, 1, extra);
    emitStateToPlayer(room, 2, extra);
}

function flushQueuedState(room) {
    if (!room) return;
    const hasPending = !!room._stateFlushPending;
    const pendingExtra = room._stateFlushExtra || null;
    room._stateFlushPending = false;
    room._stateFlushExtra = null;
    if (room._stateFlushTimer) {
        clearTimeout(room._stateFlushTimer);
        room._stateFlushTimer = null;
    }
    if (!hasPending && !pendingExtra) return;
    _emitStateToBothImmediate(room, pendingExtra || undefined);
}

function scheduleQueuedStateFlush(room) {
    if (!room || room._stateFlushTimer) return;
    room._stateFlushTimer = setTimeout(() => {
        room._stateFlushTimer = null;
        if (!rooms.has(room.code)) return;
        flushQueuedState(room);
    }, STATE_EMIT_COALESCE_MS);
}

function emitStateToBoth(room, extra) {
    if (!room) return;
    const isResolution = room.gameState?.phase === 'resolution';
    if (!isResolution) {
        flushQueuedState(room);
        _emitStateToBothImmediate(room, extra);
        return;
    }

    // Pendant la resolution: coalescer les updates sans metadata additionnelle.
    if (!extra) {
        room._stateFlushPending = true;
        scheduleQueuedStateFlush(room);
        return;
    }

    // Si un update coalesce attend, on le flush avant l'update urgent.
    flushQueuedState(room);
    _emitStateToBothImmediate(room, extra);
}

// Retirer une carte de confirmedOppHand (par uid si revealed, sinon un null)
function removeFromConfirmedHand(player, card) {
    if (!player.confirmedOppHand) return;
    if (card && card.uid) {
        const idx = player.confirmedOppHand.findIndex(c => c && c.uid === card.uid);
        if (idx !== -1) { player.confirmedOppHand.splice(idx, 1); return; }
    }
    // Carte cachÃƒÂ©e : retirer le premier null
    const nullIdx = player.confirmedOppHand.indexOf(null);
    if (nullIdx !== -1) player.confirmedOppHand.splice(nullIdx, 1);
}

function removeHandBonus(player, card) {
    player.handCountBonus = Math.max(0, (player.handCountBonus || 0) - 1);
    if (player.handBonusCards && player.handBonusCards.length > 0) {
        // Si la carte est revealed, retirer l'entrÃƒÂ©e correspondante par uid
        if (card && card.uid && card.revealedToOpponent) {
            const idx = player.handBonusCards.findIndex(c => c && c.uid === card.uid);
            if (idx !== -1) { player.handBonusCards.splice(idx, 1); return; }
        }
        // Sinon retirer le premier null (carte cachÃƒÂ©e)
        const nullIdx = player.handBonusCards.indexOf(null);
        if (nullIdx !== -1) player.handBonusCards.splice(nullIdx, 1);
        else player.handBonusCards.pop(); // fallback
    }
}

function emitAnimation(room, type, data) {
    perfRecordAnimation(room, type);
    io.to(room.code).emit('animation', { type, ...data });
}

function addPoisonCounters(card, amount, meta = {}) {
    if (!card) return 0;
    const incNum = Number(amount);
    if (!Number.isFinite(incNum) || incNum <= 0) return 0;
    const inc = Math.floor(incNum);
    if (inc <= 0) return 0;
    const before = Number(card.poisonCounters) || 0;
    const after = before + inc;
    card.poisonCounters = after;
    const audit = {
        source: meta.source || 'unknown',
        turn: meta.turn ?? null,
        row: meta.row ?? null,
        col: meta.col ?? null,
        sourcePlayer: meta.sourcePlayer ?? null,
        byCard: meta.byCard || null,
        byUid: meta.byUid || null,
        added: inc,
        before,
        after,
        at: Date.now()
    };
    card._lastPoisonAudit = audit;
    if (!Array.isArray(card._poisonAuditTrail)) card._poisonAuditTrail = [];
    card._poisonAuditTrail.push(audit);
    if (card._poisonAuditTrail.length > 6) card._poisonAuditTrail.shift();
    return inc;
}

function emitResolutionLog(room, msg, type) {
    perfRecordResolutionLog(room);
    io.to(room.code).emit('resolutionLog', { msg, type });
}

function isRadjawakDebugCard(card) {
    return !!(card && typeof card.name === 'string' && card.name.toLowerCase().includes('radjawak'));
}

function formatRadjawakDebugCard(card) {
    if (!card) return 'none';
    const hp = card.currentHp ?? card.hp ?? '?';
    const maxHp = card.hp ?? '?';
    const atk = card.atk ?? '?';
    return `${card.name}[uid=${card.uid || '-'} atk=${atk} hp=${hp}/${maxHp}]`;
}

function rowContainsRadjawak(room, row) {
    for (let p = 1; p <= 2; p++) {
        for (let c = 0; c < 2; c++) {
            const card = room.gameState.players[p].field[row]?.[c];
            if (isRadjawakDebugCard(card)) return true;
        }
    }
    return false;
}

async function applySlotRegeneration(room, row, col, log, sleep) {
    const regenBatch = [];
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const card = room.gameState.players[playerNum].field[row][col];
        if (!card || card.currentHp <= 0) continue;
        if (!card.abilities?.includes('regeneration')) continue;
        if (card.isBuilding) continue;
        const regenAmount = Math.max(0, card.regenerationX || 1);
        if (regenAmount <= 0) continue;
        const oldHp = card.currentHp;
        card.currentHp = Math.min(card.hp, oldHp + regenAmount);
        const healed = card.currentHp - oldHp;
        if (healed <= 0) continue;
        regenBatch.push({ type: 'regen', player: playerNum, row, col, amount: healed });
        log(`[REGEN] ${card.name} +${healed} HP (${oldHp} -> ${card.currentHp})`, 'heal');
    }

    if (regenBatch.length === 0) return;
    emitAnimationBatch(room, regenBatch);
    emitStateToBoth(room);
    await sleep(900);
}

async function processEndOfCombatForSlot(room, row, col, log, sleep, checkVictory) {
    let hasEffects = false;
    for (let p = 1; p <= 2; p++) {
        const card = room.gameState.players[p].field[row][col];
        if (!card || card.currentHp <= 0 || !card.endOfCombat || !card._attackedThisCombat || card._endOfCombatResolved) continue;
        hasEffects = true;
    }
    if (!hasEffects) return false;

    await sleep(300);

    let resolvedAny = false;
    for (let p = 1; p <= 2; p++) {
        const card = room.gameState.players[p].field[row][col];
        const resolved = await resolveEndOfCombatForCard(room, card, p, row, col, log, sleep);
        if (resolved) resolvedAny = true;
    }

    if (resolvedAny) {
        await resolveSpectreReanimates(room, log, sleep);
    }

    const winner = checkVictory();
    return winner !== null;
}

async function applySlotPoisonDamage(room, row, col, attackedSlots, log, sleep, checkVictory) {
    const poisonEffects = [];
    const poisonPowerCandidates = [];
    const sameSlotTickKey = `${room.gameState.turn}:${row}:${col}`;

    if (!Array.isArray(attackedSlots) || attackedSlots.length === 0) {
        return { gameEnded: false, poisonPowerCandidates };
    }

    for (const slot of attackedSlots) {
        const playerNum = Number(slot?.playerNum);
        const slotRow = Number(slot?.row);
        const slotCol = Number(slot?.col);
        if (playerNum !== 1 && playerNum !== 2) continue;
        if (slotRow !== row || slotCol !== col) continue;

        const card = room.gameState.players[playerNum].field[slotRow][slotCol];
        if (!card || card.currentHp <= 0) continue;
        const poisonCountersNum = Number(card.poisonCounters);
        if (!Number.isFinite(poisonCountersNum) || poisonCountersNum <= 0) {
            log(
                `[POISON-TICK-DBG] skip-invalid-counters card=${card.name} uid=${card.uid || '-'} slot=${slotRow},${slotCol} raw=${card.poisonCounters}`,
                'action'
            );
            continue;
        }
        if (card._skipPoisonTickKey === sameSlotTickKey) {
            delete card._skipPoisonTickKey;
            continue;
        }
        if (card.isBuilding || (card.abilities && card.abilities.includes('antitoxin'))) continue;

        const damage = Math.max(0, Math.floor(poisonCountersNum));
        if (damage <= 0) continue;
        const currentHpNum = Number(card.currentHp);
        if (!Number.isFinite(currentHpNum)) {
            log(
                `[POISON-TICK-DBG] invalid-currentHp-reset card=${card.name} uid=${card.uid || '-'} slot=${slotRow},${slotCol} rawCurrentHp=${card.currentHp} hp=${card.hp}`,
                'action'
            );
            card.currentHp = Number.isFinite(Number(card.hp)) ? Number(card.hp) : 0;
        }
        const poisonAudit = card._lastPoisonAudit || null;
        log(
            `[POISON-TICK-DBG] card=${card.name} uid=${card.uid || '-'} slot=${slotRow},${slotCol} counters=${card.poisonCounters} dmg=${damage} lastSource=${poisonAudit?.source || 'unknown'} lastTurn=${poisonAudit?.turn ?? 'n/a'} lastBy=${poisonAudit?.byCard || '-'} lastAdded=${poisonAudit?.added ?? 'n/a'}`,
            'action'
        );
        card.currentHp -= damage;
        log(`[POISON] ${card.name} subit ${damage} degat(s) de poison! (${Math.max(0, card.currentHp)}/${card.hp})`, 'damage');
        poisonEffects.push({
            type: 'poisonDamage',
            player: playerNum,
            row: slotRow,
            col: slotCol,
            amount: damage,
            source: 'combat.poisonTick',
            poisonCounters: card.poisonCounters,
            cardName: card.name,
            cardUid: card.uid || null,
            lastPoisonSource: poisonAudit?.source || null,
            lastPoisonTurn: poisonAudit?.turn ?? null,
            lastPoisonByCard: poisonAudit?.byCard || null,
            lastPoisonAdded: poisonAudit?.added ?? null
        });

        if (card.currentHp <= 0) {
            card._killedByPoisonTick = true;
        } else if (card.abilities?.includes('power')) {
            poisonPowerCandidates.push({
                playerNum,
                row: slotRow,
                col: slotCol,
                uid: card.uid,
                cardName: card.name,
                bonus: card.powerX || 1
            });
        }
    }

    if (poisonEffects.length === 0) {
        return { gameEnded: false, poisonPowerCandidates };
    }

    emitAnimationBatch(room, poisonEffects);
    emitStateToBoth(room);
    await sleep(1400);

    const winner = checkVictory();
    return { gameEnded: winner !== null, poisonPowerCandidates };
}

async function resolveCombatDeathsAndPostEffects(room, postCombatEffects, log, sleep, checkVictory, options = {}) {
    const includePostCombatEffects = options.includePostCombatEffects !== false;
    const includePoisonDeathEffects = options.includePoisonDeathEffects !== false;
    const cycleId = options.cycleId || null;
    const deaths = [];
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.currentHp <= 0) {
                    if (cycleId && !markDeathResolvedInCycle(card, cycleId)) continue;
                    deaths.push({ player: p, row: r, col: c, card });
                }
            }
        }
    }

    const normalDeaths = [];
    const poisonDeaths = [];
    if (deaths.length > 0) {
        const deathAnims = [];
        for (const d of deaths) {
            const diedFromPoison = !!d.card._killedByPoisonTick;
            delete d.card._killedByPoisonTick;
            const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
            if (result.transformed) {
                deathAnims.push({ type: 'deathTransform', player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
            } else {
                deathAnims.push({ type: 'death', player: d.player, row: d.row, col: d.col, card: d.card });
                normalDeaths.push(d);
                if (diedFromPoison) poisonDeaths.push(d);
            }
        }
        if (deathAnims.length > 0) emitAnimationBatch(room, deathAnims);
        emitStateToBoth(room);
        await sleep(1100);
        await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
    }

    const combinedEffects = [];
    if (includePostCombatEffects && Array.isArray(postCombatEffects) && postCombatEffects.length > 0) {
        combinedEffects.push(...postCombatEffects);
    }
    if (normalDeaths.length > 0) {
        const onDeathDeaths = cycleId
            ? normalDeaths.filter((d) => markOnDeathResolvedInCycle(d.card, cycleId))
            : normalDeaths;
        const onDeathEffects = collectOnDeathEffects(onDeathDeaths);
        if (onDeathEffects.length > 0) combinedEffects.push(...onDeathEffects);
    }

    if (combinedEffects.length > 0) {
        await resolvePostCombatEffects(room, combinedEffects, log, sleep);
    }
    if (includePoisonDeathEffects && poisonDeaths.length > 0) {
        const poisonCandidates = cycleId
            ? poisonDeaths.filter((d) => markPoisonDeathResolvedInCycle(d.card, cycleId))
            : poisonDeaths;
        if (poisonCandidates.length > 0) {
            await processOnPoisonDeathEffects(room, poisonCandidates, log, sleep);
        }
    }

    await applyPendingHealOnDeath(room, log);
    recalcDynamicAtk(room);
    emitStateToBoth(room);

    const winner = checkVictory();
    return winner !== null;
}

async function applyPoisonPowerBonuses(room, poisonPowerCandidates, log, sleep, checkVictory) {
    if (!Array.isArray(poisonPowerCandidates) || poisonPowerCandidates.length === 0) {
        return false;
    }

    const poisonPowerBuffs = [];
    for (const pb of poisonPowerCandidates) {
        const liveCard = room.gameState.players[pb.playerNum]?.field?.[pb.row]?.[pb.col];
        if (!liveCard || liveCard.currentHp <= 0) continue;
        if (pb.uid && liveCard.uid !== pb.uid) continue;
        const bonus = pb.bonus || 1;
        liveCard.powerStacks = (liveCard.powerStacks || 0) + bonus;
        poisonPowerBuffs.push({ playerNum: pb.playerNum, row: pb.row, col: pb.col, bonus, cardName: liveCard.name });
    }

    if (poisonPowerBuffs.length > 0) {
        const buffBatch = [];
        for (const pb of poisonPowerBuffs) {
            const card = room.gameState.players[pb.playerNum]?.field?.[pb.row]?.[pb.col];
            const fromAtk = card ? (card.atk || 0) : 0;
            log(`[POWER] ${pb.cardName} +${pb.bonus} ATK (poison -> power)`, 'buff');
            buffBatch.push({ type: 'powerBuff', player: pb.playerNum, row: pb.row, col: pb.col, amount: pb.bonus, fromAtk });
        }
        emitAnimationBatch(room, buffBatch);
    }

    recalcDynamicAtk(room);
    if (poisonPowerBuffs.length > 0) {
        emitStateToBoth(room);
        await sleep(1100);
    }

    const winner = checkVictory();
    return winner !== null;
}

/**
 * Applique des dÃƒÂ©gÃƒÂ¢ts ÃƒÂ  une crÃƒÂ©ature avec gestion de la Protection.
 * Retourne les dÃƒÂ©gÃƒÂ¢ts rÃƒÂ©ellement infligÃƒÂ©s (0 si bloquÃƒÂ© par protection).
 */
function applyCreatureDamage(card, damage, room, log, ownerPlayer, row, col, sourceCreature, sourcePlayer) {
    const sourceCardSnapshot = sourceCreature
        ? room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col]
        : null;
    const radjDbg = isRadjawakDebugCard(card) || isRadjawakDebugCard(sourceCardSnapshot);
    if (radjDbg) {
        log(
            `[RADJ-DBG] dmg-start target=${formatRadjawakDebugCard(card)} source=${formatRadjawakDebugCard(sourceCardSnapshot)} in=${damage} owner=${ownerPlayer} slot=${row},${col} srcPos=${sourceCreature ? `${sourceCreature.player}:${sourceCreature.row},${sourceCreature.col}` : 'none'}`,
            'action'
        );
    }

    if (card.hasProtection && damage > 0) {
        card.hasProtection = false;
        log(`Ã°Å¸â€ºÂ¡Ã¯Â¸Â ${card.name} : Protection absorbe ${damage} dÃƒÂ©gÃƒÂ¢ts!`, 'buff');
        if (radjDbg) {
            log(`[RADJ-DBG] dmg-end protection target=${formatRadjawakDebugCard(card)} applied=0`, 'action');
        }
        emitAnimation(room, 'shield', { player: ownerPlayer, row: row, col: col });
        return 0;
    }
    // Spectral : divise les dÃƒÂ©gÃƒÂ¢ts de combat par 2 (arrondi infÃƒÂ©rieur)
    if (sourceCreature && card.abilities && card.abilities.includes('spectral') && damage > 0) {
        const originalDamage = damage;
        damage = Math.floor(damage / 2);
        log(`Ã°Å¸â€˜Â» Spectral : ${card.name} rÃƒÂ©duit ${originalDamage} Ã¢â€ â€™ ${damage} dÃƒÂ©gÃƒÂ¢ts`, 'buff');
    }
    const hpBefore = card.currentHp;
    card.currentHp -= damage;
    card.damagedThisTurn = true;
    // Log lifelink-related creatures
    if (card.abilities && card.abilities.includes('lifelink')) {
    }
    // Lethal (toucher mortel) : si la source a 'lethal' et inflige des dÃƒÂ©gÃƒÂ¢ts, la cible meurt
    // Les bÃƒÂ¢timents sont immunisÃƒÂ©s au toucher mortel (ils subissent les dÃƒÂ©gÃƒÂ¢ts normaux)
    if (sourceCreature && damage > 0 && card.currentHp > 0 && !card.isBuilding) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('lethal')) {
            log(`Ã°Å¸â€™â‚¬ Toucher mortel : ${srcCard.name} tue ${card.name}!`, 'damage');
            card.currentHp = 0;
            if (radjDbg) {
                log(`[RADJ-DBG] lethal-applied source=${formatRadjawakDebugCard(srcCard)} targetNow=${formatRadjawakDebugCard(card)}`, 'action');
            }
        }
    }
    // Poison : si la source a 'poison' et inflige des dÃƒÂ©gÃƒÂ¢ts de combat, ajouter des compteurs poison
    if (sourceCreature && damage > 0 && card.currentHp > 0) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('poison')) {
            const poisonAmountRaw = Number(srcCard.poisonX);
            const poisonAmount = Number.isFinite(poisonAmountRaw) ? Math.max(0, Math.floor(poisonAmountRaw)) : 1;
            if (poisonAmount > 0) {
                addPoisonCounters(card, poisonAmount, {
                    source: 'combat.onHit.poison',
                    turn: room.gameState.turn,
                    row,
                    col,
                    sourcePlayer: sourceCreature.player,
                    byCard: srcCard.name || null,
                    byUid: srcCard.uid || null
                });
                log(`Ã¢ËœÂ Ã¯Â¸Â Poison : ${srcCard.name} inflige ${poisonAmount} compteur(s) poison ÃƒÂ  ${card.name} (total: ${card.poisonCounters})`, 'damage');
            }
        }
    }
    // Entrave : si la source a 'entrave' et inflige des dÃƒÂ©gÃƒÂ¢ts de combat, ajouter des marqueurs entrave
    if (sourceCreature && damage > 0 && card.currentHp > 0 && !card.isBuilding) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('entrave')) {
            const entraveAmount = srcCard.entraveX || 1;
            card.entraveCounters = (card.entraveCounters || 0) + entraveAmount;
            log(`Ã°Å¸â€¢Â¸Ã¯Â¸Â Entrave : ${srcCard.name} inflige ${entraveAmount} marqueur(s) Entrave ÃƒÂ  ${card.name} (total: ${card.entraveCounters})`, 'damage');
            emitAnimation(room, 'entrave', { player: ownerPlayer, row, col, amount: entraveAmount });
        }
    }
    // Lifelink : accumuler le soin fixe (lifelinkX) pour le hÃƒÂ©ros
    if (sourceCreature && damage > 0) {
        const srcCard = room.gameState.players[sourceCreature.player]?.field[sourceCreature.row]?.[sourceCreature.col];
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('lifelink') && srcCard.lifelinkX) {
            srcCard.pendingLifelinkHeal = (srcCard.pendingLifelinkHeal || 0) + srcCard.lifelinkX;
        }
        // Lifedrain : soin fixe (lifedrainX) au lieu des dÃƒÂ©gÃƒÂ¢ts infligÃƒÂ©s
        if (srcCard && srcCard.abilities && srcCard.abilities.includes('lifedrain') && srcCard.lifedrainX) {
            srcCard.pendingLifelinkHeal = (srcCard.pendingLifelinkHeal || 0) + srcCard.lifedrainX;
        }
    }
    // Track which creature killed this one (for onDeath.damageKiller)
    if (sourceCreature && card.currentHp <= 0) {
        card.killedBy = sourceCreature;
    }
    // onEnemyDamage: poisonRow Ã¢â‚¬â€ Porteur de peste
    const effectiveSourcePlayer = sourceCreature?.player ?? sourcePlayer;
    if (RESOLUTION_V2 && damage > 0 && card.currentHp > 0 && card.onEnemyDamage?.poisonRow
        && effectiveSourcePlayer !== undefined && effectiveSourcePlayer !== ownerPlayer) {
        const poisonAmt = card.onEnemyDamage.poisonRow;
        for (let p = 1; p <= 2; p++) {
            for (let cc = 0; cc < 2; cc++) {
                const target = room.gameState.players[p].field[row][cc];
                if (!target || target.currentHp <= 0) continue;
                if (target.uid === card.uid) continue;
                if (target.isBuilding) continue;
                if (target.abilities?.includes('antitoxin')) continue;
                addPoisonCounters(target, poisonAmt, {
                    source: 'combat.onEnemyDamage.poisonRow',
                    turn: room.gameState.turn,
                    row,
                    col: cc,
                    sourcePlayer: ownerPlayer,
                    byCard: card.name || null,
                    byUid: card.uid || null
                });
            }
        }
        log(`Ã¢ËœÂ Ã¯Â¸Â ${card.name} empoisonne la ligne! (+${poisonAmt} poison)`, 'poison');
    }
    if (radjDbg) {
        const applied = hpBefore - card.currentHp;
        log(
            `[RADJ-DBG] dmg-end target=${formatRadjawakDebugCard(card)} source=${formatRadjawakDebugCard(sourceCardSnapshot)} hpBefore=${hpBefore} hpAfter=${card.currentHp} requested=${damage} applied=${applied}`,
            'action'
        );
    }
    return damage;
}

// Lifelink : accumuler le soin fixe (lifelinkX) pour le hÃƒÂ©ros
function accumulateLifelink(attackerCard, damageDealt) {
    if (!attackerCard || damageDealt <= 0) return;
    if (attackerCard.abilities && attackerCard.abilities.includes('lifelink') && attackerCard.lifelinkX) {
        attackerCard.pendingLifelinkHeal = (attackerCard.pendingLifelinkHeal || 0) + attackerCard.lifelinkX;
    }
    // Lifedrain : soin fixe au lieu des dÃƒÂ©gÃƒÂ¢ts infligÃƒÂ©s
    if (attackerCard.abilities && attackerCard.abilities.includes('lifedrain') && attackerCard.lifedrainX) {
        attackerCard.pendingLifelinkHeal = (attackerCard.pendingLifelinkHeal || 0) + attackerCard.lifedrainX;
    }
}

// Applique tous les soins Lifelink en attente sur le terrain (aprÃƒÂ¨s un ÃƒÂ©change complet)
// Async : attend que le client ait eu le temps d'afficher les dÃƒÂ©gÃƒÂ¢ts avant de soigner
async function applyPendingLifelinkHeals(room, log) {
    // VÃƒÂ©rifier s'il y a des heals en attente avant d'ajouter un dÃƒÂ©lai
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

    // Attendre que les animations de dÃƒÂ©gÃƒÂ¢ts se terminent cÃƒÂ´tÃƒÂ© client
    // pour que le joueur VOIE les HP rÃƒÂ©duits avant le soin
    await new Promise(r => setTimeout(r, 800));

    let emittedAny = false;
    const lifestealBatch = [];
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
                // Lifelink : soigne le hÃƒÂ©ros ; Lifedrain : soigne la crÃƒÂ©ature
                const isLifelink = card.abilities && card.abilities.includes('lifelink');
                if (isLifelink) {
                    const hero = room.gameState.players[p];
                    const oldHeroHp = hero.hp;
                    hero.hp = Math.min(20, oldHeroHp + healAmount);
                    const healed = hero.hp - oldHeroHp;
                    if (healed > 0) {
                        log(`Ã°Å¸Â©Â¸ Lien vital : ${card.name} soigne ${hero.heroName} de ${healed} PV (${oldHeroHp} Ã¢â€ â€™ ${hero.hp})`, 'buff');
                        lifestealBatch.push({ type: 'lifesteal', player: p, row: r, col: c, amount: healed, heroHeal: true });
                        emittedAny = true;
                    }
                } else {
                    const maxHp = card.hp;
                    const oldHp = card.currentHp;
                    card.currentHp = Math.min(maxHp, oldHp + healAmount);
                    const healed = card.currentHp - oldHp;
                    if (healed > 0) {
                        log(`Ã°Å¸Â©Â¸ Drain de vie : ${card.name} se soigne de ${healed} PV (${oldHp} Ã¢â€ â€™ ${card.currentHp})`, 'buff');
                        lifestealBatch.push({ type: 'lifesteal', player: p, row: r, col: c, amount: healed });
                        emittedAny = true;
                    }
                }
            }
        }
    }
    // Ãƒâ€°mettre l'ÃƒÂ©tat aprÃƒÂ¨s le soin pour que le client voit les HP soignÃƒÂ©s
    if (emittedAny) {
        if (lifestealBatch.length > 0) emitAnimationBatch(room, lifestealBatch);
        emitStateToBoth(room);
        await new Promise(r => setTimeout(r, 900));
    }
}

// Applique les soins "healOnEnemyPoisonDeath" pour les crÃƒÂ©atures alliÃƒÂ©es quand un ennemi meurt du poison
async function applyHealOnEnemyPoisonDeath(room, poisonDeaths, log) {
    let anyHeal = false;
    for (const d of poisonDeaths) {
        // Le propriÃƒÂ©taire de la Reine toxique est l'adversaire de la crÃƒÂ©ature morte
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
                        log(`Ã°Å¸â€¢Â·Ã¯Â¸Â ${ally.name} se soigne de ${healed} PV (mort poison de ${d.card.name})`, 'buff');
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

// Legacy wrapper Ã¢â‚¬â€ maintenu pour les appels existants qui ne sont pas liÃƒÂ©s au poison
async function applyPendingHealOnDeath(room, log) {
    const pending = Array.isArray(room._pendingHeroHeals) ? room._pendingHeroHeals : [];
    if (pending.length === 0) return;
    room._pendingHeroHeals = [];

    const heroHealBatch = [];
    for (const evt of pending) {
        if (!evt || (evt.player !== 1 && evt.player !== 2)) continue;
        const amount = Number.isFinite(evt.amount) ? evt.amount : 0;
        heroHealBatch.push({ type: 'heroHeal', player: evt.player, amount });
        if (log) {
            log(
                `[EREBETH-DBG] flush heroHeal player=${evt.player} amount=${amount} source=${evt.source || 'unknown'} card=${evt.cardName || '-'}`,
                'heal'
            );
        }
    }

    if (heroHealBatch.length === 0) return;
    emitAnimationBatch(room, heroHealBatch);
    emitStateToBoth(room);
    await new Promise(r => setTimeout(r, 900));
    // Plus utilisÃƒÂ© (l'ancien healOnAnyDeath a ÃƒÂ©tÃƒÂ© remplacÃƒÂ© par healOnEnemyPoisonDeath)
}

// Calcule les dÃƒÂ©gÃƒÂ¢ts effectifs aprÃƒÂ¨s spectral (sans les appliquer)
function getEffectiveCombatDamage(card, damage) {
    if (card.hasProtection) return 0;
    if (card.abilities && card.abilities.includes('spectral') && damage > 0) {
        return Math.floor(damage / 2);
    }
    return damage;
}

/**
 * GÃƒÂ¨re la mort d'une crÃƒÂ©ature : transformation (onDeath.transformInto) ou cimetiÃƒÂ¨re.
 * Retourne { transformed: boolean, newCard: Card|null }
 */
function handleCreatureDeath(room, card, playerNum, row, col, log) {
    const player = room.gameState.players[playerNum];

    if (card.onDeath && card.onDeath.transformInto) {
        const template = CardByIdMap.get(card.onDeath.transformInto);
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
            // Synchroniser revealField si en phase de rÃƒÂ©vÃƒÂ©lation
            if (player.revealField) player.revealField[row][col] = newCard;
            log(`Ã°Å¸â€â€ž ${card.name} se transforme en ${newCard.name}!`, 'special');
            recalcDynamicAtk(room);
            return { transformed: true, newCard };
        } else {
        }
    }

    // Dissipation : la crÃƒÂ©ature disparaÃƒÂ®t du jeu sans aller au cimetiÃƒÂ¨re
    // Spectre rÃƒÂ©current : prÃƒÂ©-calculer avant addToGraveyard pour ÃƒÂ©viter un scan aprÃƒÂ¨s ajout
    const hasSpectreInGrave = !card.abilities?.includes('dissipation') && player.graveyard.some(c => c.graveyardTrigger === 'reanimateOnAllyDeath');
    if (!card.abilities?.includes('dissipation')) {
        addToGraveyard(player, card);
        // Spectre rÃƒÂ©current : tracker le slot de mort pour rÃƒÂ©animation depuis le cimetiÃƒÂ¨re
        if (hasSpectreInGrave) {
            if (!room._pendingSpectreDeaths) room._pendingSpectreDeaths = [];
            room._pendingSpectreDeaths.push({ playerNum, row, col });
        }
    }
    player.field[row][col] = null;
    // Synchroniser revealField si en phase de rÃƒÂ©vÃƒÂ©lation
    if (player.revealField) player.revealField[row][col] = null;

    // V2 : Erebeth Ã¢â‚¬â€ soigne 1 PV quand une crÃƒÂ©ature alliÃƒÂ©e va au cimetiÃƒÂ¨re (1 fois/tour)
    if (RESOLUTION_V2 && player.hero?.id === 'erebeth' && !player.erebethHealedThisTurn && !card.abilities?.includes('dissipation')) {
        const oldHp = player.hp;
        player.hp = Math.min(20, player.hp + 1);
        const healed = player.hp - oldHp;
        player.erebethHealedThisTurn = true;
        const emitLog = (msg, type) => emitResolutionLog(room, msg, type);
        emitLog(`${player.heroName} (Erebeth) : +${healed} PV (creature au cimetiere)`, 'heal');
        emitLog(`[EREBETH-DBG] grave-heal player=${playerNum} oldHp=${oldHp} newHp=${player.hp} healed=${healed} card=${card.name} uid=${card.uid || '-'} dissipation=${!!card.abilities?.includes('dissipation')}`, 'heal');
        // DiffÃƒÂ©rer l'ÃƒÂ©mission pour que heroHeal arrive APRÃƒË†S l'animation death/deathTransform
        // ÃƒÂ©mise par l'appelant (qui est synchrone aprÃƒÂ¨s le retour de handleCreatureDeath)
        if (!Array.isArray(room._pendingHeroHeals)) room._pendingHeroHeals = [];
        room._pendingHeroHeals.push({
            player: playerNum,
            amount: healed,
            source: 'erebeth_grave',
            cardName: card.name,
            cardUid: card.uid || null
        });
    }

    // Soif de sang : les crÃƒÂ©atures ennemies avec bloodthirst gagnent +X ATK permanent
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

    // onAdjacentAllyDeath : buff les crÃƒÂ©atures alliÃƒÂ©es adjacentes au mort (ex: MÃƒÂ¨re des damnÃƒÂ©s)
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
            log(`  Ã°Å¸â€˜Â© ${neighbor.name} gagne +${atkGain}/+${hpGain} (mort de ${card.name})`, 'buff');
            emitAnimation(room, 'buffApply', { player: playerNum, row: nr, col: nc, atkBuff: atkGain, hpBuff: hpGain });
        }
    }

    recalcDynamicAtk(room);
    return { transformed: false, newCard: null };
}

/**
 * Recalcule l'ATK des crÃƒÂ©atures avec atkPerAllyType (ex: Lance gobelin).
 * Compte les crÃƒÂ©atures vivantes du type alliÃƒÂ© sur le terrain du joueur,
 * et met ÃƒÂ  jour card.atk = baseAtk + count (+ tempAtkBoost ÃƒÂ©ventuel).
 */
function recalcDynamicAtk(room, excludeSlots) {
    // V2 : Zdejebel aura Ã¢â‚¬â€ compter combien de joueurs ont Zdejebel
    let zdjebelCount = 0;
    const totalPoisonInPlay = countTotalPoisonCounters(room);
    if (RESOLUTION_V2) {
        for (let p = 1; p <= 2; p++) {
            if (room.gameState.players[p].hero?.id === 'zdejebel') zdjebelCount++;
        }
    }

    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        const opponentNum = p === 1 ? 2 : 1;
        const opponent = room.gameState.players[opponentNum];
        const excluded = excludeSlots && excludeSlots[p] ? [...excludeSlots[p]] : [];
        // Passive aura (ex: Roi des Cendres): poisoned enemies get ATK malus.
        // Unique passives do not stack; non-unique values stack.
        let enemyPoisonedAtkDebuff = 0;
        for (let r = 0; r < opponent.field.length; r++) {
            for (let c = 0; c < opponent.field[r].length; c++) {
                if (excludeSlots && excludeSlots[opponentNum] && excludeSlots[opponentNum].has(`${r},${c}`)) continue;
                const auraCard = opponent.field[r][c];
                if (!auraCard || auraCard.currentHp <= 0 || auraCard.isBuilding) continue;
                const debuff = auraCard.enemyPoisonedAtkDebuff || 0;
                if (debuff <= 0) continue;
                if (auraCard.uniquePassive) enemyPoisonedAtkDebuff = Math.max(enemyPoisonedAtkDebuff, debuff);
                else enemyPoisonedAtkDebuff += debuff;
            }
        }
        // Cache du nombre de crÃƒÂ©atures au cimetiÃƒÂ¨re (ÃƒÂ©vite filter() par carte)
        const graveyardCreatureCount = player.graveyard.reduce((n, g) => n + (g.type === 'creature' ? 1 : 0), 0);
        // Compter les crÃƒÂ©atures vivantes par type (en excluant les slots pas encore rÃƒÂ©vÃƒÂ©lÃƒÂ©s)
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
        // Calculer les bonus d'AmÃƒÂ©lioration (enhance) par slot
        const enhanceBonus = {};
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                if (excludeSlots && excludeSlots[p] && excludeSlots[p].has(`${r},${c}`)) continue;
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.abilities?.includes('enhance')) {
                    const amount = card.enhanceAmount || 1;
                    // Buff les 3 voisins orthogonaux (haut, bas, mÃƒÂªme rangÃƒÂ©e autre colonne)
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

        // Mettre ÃƒÂ  jour l'ATK des crÃƒÂ©atures avec bonus dynamique
        for (let r = 0; r < player.field.length; r++) {
            for (let c = 0; c < player.field[r].length; c++) {
                const card = player.field[r][c];
                if (!card || card.currentHp <= 0) continue;
                if (card.isBuilding) continue;
                const enhance = enhanceBonus[`${r},${c}`] || 0;
                const base = card.baseAtk ?? card.atk;
                const bt = card.bloodthirstStacks || 0;
                const pw = card.powerStacks || 0;
                const sas = card.sacrificeAtkStacks || 0;

                // Bonus atkPerAdjacent : +X par crÃƒÂ©ature vivante adjacente
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

                // Bonus atkPerGraveyard : +1 par crÃƒÂ©ature dans le cimetiÃƒÂ¨re du joueur
                let graveyardBonus = 0;
                if (card.atkPerGraveyard) {
                    graveyardBonus = graveyardCreatureCount;
                }

                // Poison dynamique (poisonPerGraveyard / poisonEqualsTotalPoisonInPlay)
                if (card.poisonPerGraveyard || card.poisonEqualsTotalPoisonInPlay) {
                    const basePoisonRaw = Number(card.basePoisonX ?? card.poisonX ?? 1);
                    const basePoisonX = Number.isFinite(basePoisonRaw) ? Math.max(0, Math.floor(basePoisonRaw)) : 1;
                    if (card.basePoisonX === undefined) card.basePoisonX = basePoisonX;
                    if (card.poisonPerGraveyard) {
                        const stepRaw = Number(card.poisonPerGraveyard);
                        const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.floor(stepRaw) : 1;
                        const graveyardCount = player.graveyard.length;
                        card.poisonX = basePoisonX + Math.floor(graveyardCount / step);
                    } else if (card.poisonEqualsTotalPoisonInPlay) {
                        card.poisonX = basePoisonX + totalPoisonInPlay;
                    }
                }

                // Bonus buffCounters (Armes magiques) : +1 ATK par marqueur
                const bc = card.buffCounters || 0;
                const poisonedAuraMalus = (enemyPoisonedAtkDebuff > 0 && (card.poisonCounters || 0) > 0) ? enemyPoisonedAtkDebuff : 0;

                // atkPerPoisonInPlay : ATK = nombre total de marqueurs poison en jeu
                if (card.atkPerPoisonInPlay) {
                    const entraveMalus = card.entraveCounters || 0;
                    card.atk = totalPoisonInPlay + bc - entraveMalus - poisonedAuraMalus;
                    continue;
                }

                // Malus Entrave : -1 ATK par marqueur Entrave
                const entraveMalus = card.entraveCounters || 0;

                const sab = card.spellAtkBuff || 0;
                // V2 : Zdejebel aura Ã¢â‚¬â€ +1 ATK par Zdejebel si baseAtk === 1
                const zdj = (zdjebelCount > 0 && base === 1) ? zdjebelCount : 0;

                if (card.atkPerAllyType) {
                    const count = typeCounts[card.atkPerAllyType] || 0;
                    card.atk = base + count + sab + (card.tempAtkBoost || 0) + enhance + bt + pw + sas + adjBonus + graveyardBonus + bc + zdj - entraveMalus - poisonedAuraMalus;
                } else if (graveyardBonus > 0 || entraveMalus > 0 || poisonedAuraMalus > 0 || pw > 0 || bc !== 0 || sab > 0 || sas > 0 || zdj > 0) {
                    card.atk = base + sab + (card.tempAtkBoost || 0) + enhance + bt + pw + sas + adjBonus + graveyardBonus + bc + zdj - entraveMalus - poisonedAuraMalus;
                } else if (adjBonus > 0 || enhance > 0 || bt > 0 || card.atk !== base + (card.tempAtkBoost || 0)) {
                    card.atk = base + (card.tempAtkBoost || 0) + enhance + bt + adjBonus - poisonedAuraMalus;
                }
                // Synchroniser ownerAtk pendant la phase de rÃƒÂ©vÃƒÂ©lation
                if (card.ownerAtk !== undefined) card.ownerAtk = card.atk;
            }
        }
    }

}

// Calcule le bonus de dÃƒÂ©gÃƒÂ¢ts de sorts pour un joueur (Sort renforcÃƒÂ©)
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

// Compte le nombre total de marqueurs poison sur toutes les crÃƒÂ©atures en jeu (les 2 joueurs)
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

// Trouve la premiÃƒÂ¨re crÃƒÂ©ature ennemie "en face" d'une position (mÃƒÂªme rangÃƒÂ©e, colonne intÃƒÂ©rieure d'abord)
// Ignore les crÃƒÂ©atures pÃƒÂ©trifiÃƒÂ©es
function getFacingCreature(room, playerNum, row) {
    const enemyNum = playerNum === 1 ? 2 : 1;
    const enemy = room.gameState.players[enemyNum];
    // Colonne intÃƒÂ©rieure (proche du centre) en premier : col 1 pour les deux joueurs
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

// Calcule les crÃƒÂ©atures bloquÃƒÂ©es par MÃƒÂ©lodie et met ÃƒÂ  jour les gaze trackers
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

// Traite les effets MÃƒÂ©lodie + PÃƒÂ©trification pour UNE ligne donnÃƒÂ©e (appelÃƒÂ© juste avant le combat de cette ligne)
async function processMelodyForRow(room, row, log, sleep) {
    let hadEffect = false;
    let hadPetrify = false;
    let hadGazeAnim = false;

    // Nettoyer les effets melody de la phase de planning pour cette row
    // (le mouvement a pu changer qui fait face ÃƒÂ  qui)
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

            // IncrÃƒÂ©menter le gaze tracker (bÃƒÂ¢timents immunisÃƒÂ©s ÃƒÂ  la pÃƒÂ©trification)
            if (facing.card.isBuilding) {
                card.medusaGazeUid = null;
                card.medusaGazeTurns = 0;
            } else if (card.medusaGazeUid && facing.card.uid === card.medusaGazeUid) {
                card.medusaGazeTurns = (card.medusaGazeTurns || 0) + 1;
            } else {
                card.medusaGazeUid = facing.card.uid;
                card.medusaGazeTurns = 1;
            }

            if (card.medusaGazeTurns >= 2) {
                // PÃƒÂ©trification directe Ã¢â‚¬â€ pas de pastille "2", on passe direct ÃƒÂ  l'effet
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
                target.petrifiedDescription = 'PÃƒÂ©trifiÃƒÂ© Ã¢â‚¬â€ ne peut ni attaquer ni bloquer.';

                emitStateToBoth(room);

                emitAnimation(room, 'petrify', {
                    player: facing.playerNum,
                    row: facing.row,
                    col: facing.col,
                    cardName: target.name
                });
                log(`  Ã°Å¸ÂªÂ¨ ${heroName}: ${card.name} pÃƒÂ©trifie ${target.name} !`, 'special');
                await sleep(1500);

                card.medusaGazeUid = null;
                card.medusaGazeTurns = 0;
                hadPetrify = true;
            } else {
                // Marquer le gaze counter pour l'affichage client (seulement si pas de pÃƒÂ©trification)
                facing.card.medusaGazeMarker = card.medusaGazeTurns;
                // Animation oeil de Medusa Ã¢â€ â€™ rayon vers la cible
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

    // Envoyer le state + attendre l'animation gaze si on a eu des effets melody sans pÃƒÂ©trification
    if (hadEffect && !hadPetrify) {
        emitStateToBoth(room);
        await sleep(hadGazeAnim ? 1500 : 400);
    } else if (hadClear && !hadEffect) {
        // Medusa a bougÃƒÂ© : les effets melody ont ÃƒÂ©tÃƒÂ© nettoyÃƒÂ©s, montrer le retour ÃƒÂ  la normale avant le combat
        emitStateToBoth(room);
        await sleep(500);
    }
}

// Buff les crÃƒÂ©atures avec onAllySacrifice quand une crÃƒÂ©ature alliÃƒÂ©e est sacrifiÃƒÂ©e
// Erebeth : quand le joueur sacrifie une crÃƒÂ©ature, l'adversaire perd 1 PV et le joueur gagne 1 PV par sacrifice
function applyErebethSacrifice(room, playerNum, sacrificeCount, log) {
    if (RESOLUTION_V2) return; // V2 : remplacÃƒÂ© par heal on ally death
    const player = room.gameState.players[playerNum];
    if (!player.hero || player.hero.id !== 'erebeth') return;
    const opponentNum = playerNum === 1 ? 2 : 1;
    const opponent = room.gameState.players[opponentNum];
    const drain = sacrificeCount;
    opponent.hp -= drain;
    const oldHp = player.hp;
    player.hp = Math.min(20, player.hp + drain);
    const healed = player.hp - oldHp;
    log(`  Ã°Å¸â€™â‚¬ ${player.heroName} (Erebeth) : -${drain} PV ÃƒÂ  ${opponent.heroName}${healed > 0 ? `, +${healed} PV rÃƒÂ©gÃƒÂ©nÃƒÂ©rÃƒÂ©s` : ''}`, 'special');
    emitAnimation(room, 'heroHit', { defender: opponentNum, damage: drain });
    emitAnimation(room, 'heroHeal', { player: playerNum, amount: healed });
    log(`[EREBETH-DBG] sacrifice-heal player=${playerNum} drain=${drain} oldHp=${oldHp} newHp=${player.hp} healed=${healed} emittedHeroHeal=true`, 'heal');
}

function applyOnAllySacrifice(room, playerNum, sacrificeCount, log) {
    if (RESOLUTION_V2) return; // V2 : sacrifice dÃƒÂ©sactivÃƒÂ©
    const player = room.gameState.players[playerNum];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const card = player.field[r][c];
            if (card && card.currentHp > 0 && card.onAllySacrifice) {
                const atkGain = (card.onAllySacrifice.atkBuff || 0) * sacrificeCount;
                const hpGain = (card.onAllySacrifice.hpBuff || 0) * sacrificeCount;
                card.hp += hpGain;
                card.currentHp += hpGain;
                // Ne PAS toucher baseHp/baseAtk Ã¢â€ â€™ le client affiche les stats en vert (boosted)
                card.sacrificeAtkStacks = (card.sacrificeAtkStacks || 0) + atkGain;
                card.atk += atkGain;
                // Synchroniser ownerAtk si on est en phase de rÃƒÂ©vÃƒÂ©lation
                if (card.ownerAtk !== undefined) card.ownerAtk = card.atk;
                log(`  Ã°Å¸Â§â€º ${card.name} gagne +${atkGain} ATK / +${hpGain} HP (sacrifice)`, 'buff');
                emitAnimation(room, 'buffApply', { player: playerNum, row: r, col: c, atkBuff: atkGain, hpBuff: hpGain });
            }
        }
    }
}

// Buff les crÃƒÂ©atures avec onAnySacrifice quand n'importe quelle crÃƒÂ©ature est sacrifiÃƒÂ©e
// Utilise buffCounters (marqueurs +1/+1) comme Armes magiques
function applyOnAnySacrifice(room, sacrificeCount, log) {
    if (sacrificeCount <= 0) return;
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card && card.currentHp > 0 && card.onAnySacrifice) {
                    const gain = (card.onAnySacrifice.atkBuff || 0) * sacrificeCount;
                    card.buffCounters = (card.buffCounters || 0) + gain;
                    card.hp += gain;
                    card.currentHp += gain;
                    log(`  Ã°Å¸Â§â€º ${card.name} gagne +${gain}/+${gain} marqueurs (sacrifice)`, 'buff');
                    emitAnimation(room, 'buffApply', { player: p, row: r, col: c, atkBuff: gain, hpBuff: gain });
                }
            }
        }
    }
}

// Traite les capacitÃƒÂ©s onSummon d'une crÃƒÂ©ature qui vient d'entrer en jeu
// deferredDestructions : tableau oÃƒÂ¹ empiler les destructions (rÃƒÂ©solues aprÃƒÂ¨s tous les onSummon)
async function processOnSummonAbility(room, card, playerNum, row, col, log, sleep, deferredDestructions = null) {
    if (RESOLUTION_V2) return; // V2 : tous les effets onSummon et sacrifice dÃƒÂ©sactivÃƒÂ©s
    if (!card.onSummon && !card.sacrifice) return;
    const player = room.gameState.players[playerNum];
    const heroName = room.gameState.players[playerNum].heroName || `Joueur ${playerNum}`;

    // Sacrifice : sacrifier X crÃƒÂ©atures adjacentes pouvant attaquer (ordre horaire)
    if (card.sacrifice) {
        const targets = getAdjacentSacrificeTargets(player.field, row, col);
        // Si les cibles de sacrifice ont ÃƒÂ©tÃƒÂ© tuÃƒÂ©es (ex: effet de dÃƒÂ©but de tour), la crÃƒÂ©ature meurt
        if (targets.length < card.sacrifice) {
            log(`  Ã°Å¸â€™â‚¬ ${heroName}: ${card.name} ne peut plus sacrifier (cibles insuffisantes) Ã¢â€ â€™ meurt`, 'damage');
            player.field[row][col] = null;
            addToGraveyard(player, card);
            if (player.revealField) player.revealField[row][col] = null;
            emitAnimation(room, 'death', { player: playerNum, row, col, card });
            emitStateToBoth(room);
            await sleep(1200);
            return;
        }
        const toSacrifice = targets.slice(0, card.sacrifice);

        // Petit dÃƒÂ©lai avant le sacrifice pour sÃƒÂ©parer visuellement de l'invocation
        await sleep(600);

        const sacrificedCards = [];
        for (const target of toSacrifice) {
            const sacrificed = player.field[target.row][target.col];
            if (!sacrificed) continue;
            log(`  Ã°Å¸â€™â‚¬ ${heroName}: ${card.name} sacrifie ${sacrificed.name}`, 'damage');

            // D'abord rÃƒÂ©soudre la mort pour savoir si la crÃƒÂ©ature se transforme
            const result = handleCreatureDeath(room, sacrificed, playerNum, target.row, target.col, log);
            sacrificedCards.push({ card: sacrificed, player: playerNum, row: target.row, col: target.col });

            if (result.transformed) {
                // CrÃƒÂ©ature avec onDeath.transformInto (ex: Little Bone Ã¢â€ â€™ Pile d'os, Gobelin Jumeau Ã¢â€ â€™ Faux Jumeaux)
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
                // Mettre aussi ÃƒÂ  jour revealField si revealing est actif
                if (player.revealField) {
                    player.revealField[target.row][target.col] = null;
                }
                emitStateToBoth(room);
                await sleep(1600); // 500ms VFX slash + 900ms fly-to-graveyard + marge
            }
        }
        // Buff onAnySacrifice (ex: Vampire sordide) + Erebeth
        if (sacrificedCards.length > 0) {
            applyOnAllySacrifice(room, playerNum, sacrificedCards.length, log);
            applyOnAnySacrifice(room, sacrificedCards.length, log);
            applyErebethSacrifice(room, playerNum, sacrificedCards.length, log);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
            await sleep(800);
        }
        // Effets onSacrifice des crÃƒÂ©atures sacrifiÃƒÂ©es (ex: Zobombie)
        for (const sc of sacrificedCards) {
            if (sc.card.onSacrifice && sc.card.onSacrifice.damageOpponent) {
                const opNum = sc.player === 1 ? 2 : 1;
                const dmg = sc.card.onSacrifice.damageOpponent;
                room.gameState.players[opNum].hp -= dmg;
                log(`  Ã°Å¸â€™Â¥ ${sc.card.name} inflige ${dmg} dÃƒÂ©gÃƒÂ¢t(s) ÃƒÂ  ${room.gameState.players[opNum].heroName} (sacrifice)`, 'damage');
                emitAnimation(room, 'heroHit', { defender: opNum, damage: dmg });
            }
        }
        // Bonus du sacrificateur basÃƒÂ© sur l'ATK des crÃƒÂ©atures sacrifiÃƒÂ©es (Zealot of the elder)
        if (card.sacrificeBonus && sacrificedCards.length > 0) {
            const totalAtk = sacrificedCards.reduce((sum, sc) => sum + (sc.card.atk || 0), 0);
            if (totalAtk > 0) {
                if (card.sacrificeBonus.healPerAtk) {
                    const oldHp = player.hp;
                    player.hp = Math.min(20, player.hp + totalAtk);
                    const healed = player.hp - oldHp;
                    if (healed > 0) {
                        log(`  Ã°Å¸â€™Å¡ ${heroName}: ${card.name} Ã¢â€ â€™ +${healed} PV (sacrifice)`, 'heal');
                        emitAnimation(room, 'heroHeal', { player: playerNum, amount: healed });
                    }
                }
                if (card.sacrificeBonus.absorbStats) {
                    let totalAtkGain = 0, totalHpGain = 0;
                    for (const sc of sacrificedCards) {
                        const rawAtkGain = sc.card.baseAtk || sc.card.atk || 0;
                        const rawHpGain = sc.card.baseHp || sc.card.hp || 0;
                        const atkGain = Number.isFinite(Number(rawAtkGain)) ? Number(rawAtkGain) : 0;
                        const hpGain = Number.isFinite(Number(rawHpGain)) ? Number(rawHpGain) : 0;
                        if (atkGain > 0 || hpGain > 0) {
                            const preAtk = card.atk;
                            const preHp = card.hp;
                            const preCurrentHp = card.currentHp;
                            // Utiliser sacrificeAtkStacks pour que recalcDynamicAtk garde le buff
                            // Ne PAS toucher baseAtk/baseHp Ã¢â€ â€™ le client affiche les stats en vert (boosted)
                            card.sacrificeAtkStacks = (card.sacrificeAtkStacks || 0) + atkGain;
                            card.atk += atkGain;
                            card.hp += hpGain;
                            card.currentHp += hpGain;
                            const postAtk = card.atk;
                            const postHp = card.hp;
                            const postCurrentHp = card.currentHp;
                            const invalidPre =
                                !Number.isFinite(Number(preAtk)) ||
                                !Number.isFinite(Number(preHp)) ||
                                !Number.isFinite(Number(preCurrentHp));
                            const invalidPost =
                                !Number.isFinite(Number(postAtk)) ||
                                !Number.isFinite(Number(postHp)) ||
                                !Number.isFinite(Number(postCurrentHp));
                            totalAtkGain += atkGain;
                            totalHpGain += hpGain;
                            log(
                                `[ABSORB-DBG] source=sacrificeBonus.absorbStats absorber=${card.name} absorberUid=${card.uid || '-'} victim=${sc.card?.name || '-'} victimUid=${sc.card?.uid || '-'} rawGain=${rawAtkGain}/${rawHpGain} gain=${atkGain}/${hpGain} pre=${preAtk}/${preCurrentHp} max=${preHp} post=${postAtk}/${postCurrentHp} max=${postHp} invalidPre=${invalidPre} invalidPost=${invalidPost}`,
                                invalidPre || invalidPost ? 'error' : 'buff'
                            );
                            log(`  Ã°Å¸ÂªÂ± ${heroName}: ${card.name} absorbe +${atkGain}/+${hpGain} de ${sc.card.name} Ã¢â€ â€™ ${card.atk}/${card.currentHp}`, 'buff');
                        }
                    }
                    if (totalAtkGain > 0 || totalHpGain > 0) {
                        emitAnimation(room, 'buffApply', {
                            player: playerNum,
                            row,
                            col,
                            atkBuff: totalAtkGain,
                            hpBuff: totalHpGain,
                            source: 'sacrificeBonus.absorbStats',
                            absorberName: card.name,
                            absorberUid: card.uid || null
                        });
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
                            log(`  Ã°Å¸Å½Â­ ${heroName}: ${card.name} inflige ${actualDmg} dÃƒÂ©gÃƒÂ¢t(s) ÃƒÂ  ${facing.card.name} (ATK sacrifiÃƒÂ©e)`, 'damage');
                            emitAnimation(room, 'damage', { player: facing.playerNum, row: facing.row, col: facing.col, amount: actualDmg });
                            await sleep(800);
                            // Si la crÃƒÂ©ature en face est morte, la retirer du terrain
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
        // DÃƒÂ©clencher les effets onDeath des crÃƒÂ©atures sacrifiÃƒÂ©es (destroyAll, etc.)
        for (const sc of sacrificedCards) {
            await processOnDeathAbility(room, sc.card, sc.player, sc.row, sc.col, log, sleep);
        }
        await applyPendingHealOnDeath(room, log);
        recalcDynamicAtk(room);
        emitStateToBoth(room);
    }

    // searchSpell : chercher le premier sort dans le deck et l'ajouter ÃƒÂ  la main
    if (card.onSummon && card.onSummon.searchSpell) {
        const spellIndex = player.deck.findIndex(c => c.type === 'spell');
        if (spellIndex !== -1) {
            const [spellCard] = player.deck.splice(spellIndex, 1);
            // VFX arcane sur la crÃƒÂ©ature qui cherche
            emitAnimation(room, 'searchSpell', { player: playerNum, row, col });
            await sleep(800);
            if (player.hand.length < 9) {
                player.hand.push(spellCard);
                const handIdx = player.hand.length - 1;
                log(`  Ã°Å¸â€Â ${heroName}: ${card.name} trouve ${spellCard.name} dans le deck`, 'action');
                emitAnimation(room, 'draw', { cards: [{ player: playerNum, card: spellCard, handIndex: handIdx }] });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1000);
            } else {
                addToGraveyard(player, spellCard);
                log(`  Ã°Å¸â€Â ${heroName}: ${card.name} trouve ${spellCard.name}, mais main pleine Ã¢â€ â€™ cimetiÃƒÂ¨re`, 'damage');
                emitAnimation(room, 'burn', { player: playerNum, card: spellCard });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1200);
            }
        }
    }

    // millFirstCreature : met la premiÃƒÂ¨re crÃƒÂ©ature du deck au cimetiÃƒÂ¨re (Fossoyeur mÃƒÂ©thodique)
    if (card.onSummon && card.onSummon.millFirstCreature) {
        const creatureIndex = player.deck.findIndex(c => c.type === 'creature');
        if (creatureIndex !== -1) {
            const [milled] = player.deck.splice(creatureIndex, 1);
            addToGraveyard(player, milled);
            log(`  Ã°Å¸ÂªÂ¦ ${heroName}: ${card.name} Ã¢â€ â€™ ${milled.name} va au cimetiÃƒÂ¨re`, 'action');
            emitAnimation(room, 'burn', { player: playerNum, card: milled });
            await sleep(20);
            emitStateToBoth(room);
            await sleep(1200);
            if (milled.type === 'creature') await syncMillWatchers(room, playerNum, 1, log, sleep);
        }
    }

    // destroyFacing : dÃƒÂ©truire la crÃƒÂ©ature en face ÃƒÂ  l'invocation
    if (card.onSummon && card.onSummon.destroyFacing) {
        const facing = getFacingCreature(room, playerNum, row);
        if (facing && facing.card) {
            const heroName = room.gameState.players[playerNum].heroName || `Joueur ${playerNum}`;
            log(`Ã°Å¸â€™â‚¬ ${heroName}: ${card.name} dÃƒÂ©truit ${facing.card.name}!`, 'damage');
            emitAnimation(room, 'destroy', { player: facing.playerNum, row: facing.row, col: facing.col });
            await sleep(1200);

            if (deferredDestructions) {
                // Mode diffÃƒÂ©rÃƒÂ© : empiler la destruction, elle sera rÃƒÂ©solue aprÃƒÂ¨s tous les onSummon
                deferredDestructions.push({
                    card: facing.card,
                    playerNum: facing.playerNum,
                    row: facing.row,
                    col: facing.col,
                    source: card.name,
                });
            } else {
                // Mode immÃƒÂ©diat (appel hors Phase 2, ex: futur effet)
                const result = handleCreatureDeath(room, facing.card, facing.playerNum, facing.row, facing.col, log);
                if (result.transformed) {
                    emitAnimation(room, 'deathTransform', { player: facing.playerNum, row: facing.row, col: facing.col, fromCard: facing.card, toCard: result.newCard });
                } else {
                    emitAnimation(room, 'death', { player: facing.playerNum, row: facing.row, col: facing.col, card: facing.card });
                }
                emitStateToBoth(room);
                await sleep(1100);
                if (!result.transformed) {
                    await processOnDeathAbility(room, facing.card, facing.playerNum, facing.row, facing.col, log, sleep);
                }
                await applyPendingHealOnDeath(room, log);
                recalcDynamicAtk(room);
                emitStateToBoth(room);
                await sleep(600);
            }
        }
    }

    // selfPoison : s'infliger des compteurs poison ÃƒÂ  l'invocation
    if (card.onSummon && card.onSummon.selfPoison) {
        const amount = card.onSummon.selfPoison;
        addPoisonCounters(card, amount, {
            source: 'summon.selfPoison',
            turn: room.gameState.turn,
            row,
            col,
            sourcePlayer: playerNum,
            byCard: card.name || null,
            byUid: card.uid || null
        });
        log(`Ã¢ËœÂ Ã¯Â¸Â ${card.name} s'inflige ${amount} marqueur(s) poison (total: ${card.poisonCounters})`, 'damage');
        emitAnimation(room, 'poisonApply', { player: playerNum, row, col, amount });
        recalcDynamicAtk(room);
        emitStateToBoth(room);
        await sleep(800);
    }

    // graveyardReturnAtk1 : renvoyer les crÃƒÂ©atures avec 1 ATK du cimetiÃƒÂ¨re en main (une par une)
    if (card.onSummon && card.onSummon.graveyardReturnAtk1) {
        // Collecter les indices des cartes ÃƒÂ©ligibles d'abord
        const toReturn = [];
        for (let i = 0; i < player.graveyard.length; i++) {
            const gc = player.graveyard[i];
            if (gc.type === 'creature' && gc.atk === 1) {
                toReturn.push(i);
            }
        }
        // Traiter une par une (indices dÃƒÂ©croissants pour splice safe)
        let anyReturned = false;
        for (let j = toReturn.length - 1; j >= 0; j--) {
            if (player.hand.length >= 9) break;
            const idx = toReturn[j];
            const gc = player.graveyard.splice(idx, 1)[0];
            gc.revealedToOpponent = true;
            player.hand.push(gc);
            log(`  Ã°Å¸ÂªÂ¦ ${heroName}: ${card.name} Ã¢â€ â€™ ${gc.name} revient du cimetiÃƒÂ¨re en main!`, 'special');
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
 * @param {number} playerNum - NumÃƒÂ©ro du joueur (1 ou 2)
 * @param {number} count - Nombre de cartes ÃƒÂ  piocher
 * @param {Function} log - Fonction de log
 * @param {Function} sleep - Fonction sleep async
 * @param {string} source - Source de la pioche (pour le log)
 * @returns {Promise<{drawn: number, burned: number}>} Nombre de cartes piochÃƒÂ©es/brÃƒÂ»lÃƒÂ©es
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
        log(`  Ã°Å¸Å½Â´ ${source} - pioche ${drawnCards.length} carte(s)`, 'action');
        emitAnimation(room, 'draw', { cards: drawnCards });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(1400);
    }

    for (const burned of burnedCards) {
        log(`  Ã°Å¸â€œÂ¦ Main pleine, ${burned.card.name} va au cimetiÃƒÂ¨re`, 'damage');
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

// Collecter les effets onDeath d'une liste de crÃƒÂ©atures mortes Ã¢â€ â€™ tableau d'effets gÃƒÂ©nÃƒÂ©riques
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
        if (d.card.onDeath.poisonAll) {
            effects.push({
                type: 'poisonAll',
                sourcePlayer: d.player,
                poisonAmount: d.card.onDeath.poisonAll,
                source: d.card.name,
                sourceUid: d.card.uid || null
            });
        }
        if (d.card.onDeath.summonIfPoisoned && d.row !== undefined && d.col !== undefined) {
            const poisonCounters = Number(d.card.poisonCounters) || 0;
            if (poisonCounters > 0) {
                effects.push({
                    type: 'summonIfPoisoned',
                    player: d.player,
                    row: d.row,
                    col: d.col,
                    summonId: d.card.onDeath.summonIfPoisoned,
                    source: d.card.name,
                    sourceUid: d.card.uid || null
                });
            }
        }
        if (d.card.onDeath.poisonExplosion && d.card.poisonCounters > 0) {
            effects.push({ type: 'poisonExplosion', sourcePlayer: d.player, damage: d.card.poisonCounters, source: d.card.name });
        }
        if (d.card.onDeath.millFirstCreature) {
            effects.push({ type: 'millFirstCreature', player: d.player, source: d.card.name });
        }
        if (d.card.onDeath.reanimateMeleeCost2OrLessBottom && d.row !== undefined && d.col !== undefined) {
            effects.push({ type: 'reanimateMeleeCost2OrLessBottom', player: d.player, row: d.row, col: d.col, source: d.card.name });
        }
        if (d.card.onDeath.healHero) {
            effects.push({ type: 'heroHeal', player: d.player, amount: d.card.onDeath.healHero, source: d.card.name });
        }
    }
    return effects;
}

// DÃ©clenche immÃ©diatement les capacitÃ©s "quand ... va au cimetiÃ¨re"
// juste aprÃ¨s les animations de mort, avant d'autres phases globales.
async function resolveImmediateWhenTriggersAfterDeaths(room, log, sleep) {
    await syncGraveyardWatchers(room, log, sleep);
    await resolveSpectreReanimates(room, log, sleep);
}

// RÃƒÂ©soudre TOUS les effets post-combat EN SIMULTANÃƒâ€° (onDeath + onHeroHit + futurs effets)
async function resolvePostCombatEffects(room, effects, log, sleep) {
    if (effects.length === 0) return;

    let maxSleepTime = 0;
    const killerHitResults = [];
    const rowDamageResults = [];
    const allDrawnCards = [];
    const allBurnedCards = [];

    // 1. Appliquer TOUS les changements d'ÃƒÂ©tat et ÃƒÂ©mettre TOUTES les animations
    for (const effect of effects) {
        switch (effect.type) {
            case 'heroHeal': {
                const hero = room.gameState.players[effect.player];
                hero.hp = Math.min(hero.hp + effect.amount, hero.maxHp || 30);
                log(`Ã°Å¸â€™Å¡ ${effect.source} - CapacitÃƒÂ© de mort: soigne ${effect.amount} PV ÃƒÂ  votre hÃƒÂ©ros!`, 'heal');
                maxSleepTime = Math.max(maxSleepTime, 800);
                break;
            }
            case 'heroDamage': {
                room.gameState.players[effect.targetPlayer].hp -= effect.damage;
                log(`Ã°Å¸â€™â‚¬ ${effect.source} - CapacitÃƒÂ© de mort: ${effect.damage} dÃƒÂ©gÃƒÂ¢ts au hÃƒÂ©ros adverse!`, 'damage');
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
                    const actualDmg = applyCreatureDamage(killerCard, effect.damage, room, log, effect.targetPlayer, effect.targetRow, effect.targetCol, undefined, effect.sourcePlayer);
                    log(`Ã°Å¸â€Â¥ ${effect.source} inflige ${effect.damage} blessure ÃƒÂ  ${killerCard.name}!`, 'damage');
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
                        // NE PAS ajouter au cimetiÃƒÂ¨re maintenant Ã¢â‚¬â€ diffÃƒÂ©rer ÃƒÂ  la phase burn
                        allBurnedCards.push({ player: effect.player, card });
                    }
                }
                log(`  Ã°Å¸Å½Â´ ${effect.source} - pioche ${effect.count} carte(s)`, 'action');
                break;
            }
            case 'rowDamage': {
                // Touche toute la ligne (les 2 joueurs), sauf les volants et le slot source
                for (let p = 1; p <= 2; p++) {
                    const field = room.gameState.players[p].field;
                    for (let c = 0; c < 2; c++) {
                        // Ne pas toucher le slot oÃƒÂ¹ se trouvait le dÃƒÂ©mon (il est dÃƒÂ©jÃƒÂ  mort)
                        if (p === effect.sourcePlayer && c === effect.sourceCol) continue;
                        const target = field[effect.row][c];
                        if (target && target.currentHp > 0 && target.combatType !== 'fly') {
                            const actualDmg = applyCreatureDamage(target, effect.damage, room, log, p, effect.row, c, undefined, effect.sourcePlayer);
                            log(`Ã°Å¸â€™Â¥ ${effect.source} inflige ${effect.damage} dÃƒÂ©gÃƒÂ¢ts ÃƒÂ  ${target.name}!`, 'damage');
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
                // Destruction totale : dÃƒÂ©truire directement toutes les crÃƒÂ©atures (pas des dÃƒÂ©gÃƒÂ¢ts)
                log(`Ã°Å¸â€™Â¥ ${effect.source} Ã¢â‚¬â€ Destruction totale : toutes les crÃƒÂ©atures sont dÃƒÂ©truites!`, 'damage');
                // Log ÃƒÂ©tat du terrain AVANT destruction
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

                // Log ÃƒÂ©tat du terrain APRÃƒË†S destruction
                const fieldAfter = [];
                for (let p = 1; p <= 2; p++) {
                    for (let r = 0; r < room.gameState.players[p].field.length; r++) {
                        for (let c = 0; c < room.gameState.players[p].field[r].length; c++) {
                            const t = room.gameState.players[p].field[r][c];
                            if (t) fieldAfter.push(`P${p}R${r}C${c}:${t.name}(uid=${t.uid})`);
                        }
                    }
                }
                // Ãƒâ€°mettre toutes les animations de mort en mÃƒÂªme temps
                if (destroyAnims.length > 0) {
                    emitAnimationBatch(room, destroyAnims);
                }
                emitStateToBoth(room);
                await sleep(1100);
                await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
                // DÃƒÂ©clencher les effets onDeath des crÃƒÂ©atures dÃƒÂ©truites (rÃƒÂ©cursif)
                const destroyEffects = collectOnDeathEffects(destroyDeaths);
                if (destroyEffects.length > 0) {
                    await resolvePostCombatEffects(room, destroyEffects, log, sleep);
                }
                await applyPendingHealOnDeath(room, log);
                break;
            }
            case 'poisonRow': {
                // Poison Row : applique des compteurs poison aux crÃƒÂ©atures adverses sur la mÃƒÂªme ligne
                const enemyPlayerNum = effect.sourcePlayer === 1 ? 2 : 1;
                const enemyField = room.gameState.players[enemyPlayerNum].field;
                for (let c = 0; c < 2; c++) {
                    const target = enemyField[effect.row][c];
                    if (target && target.currentHp > 0) {
                        addPoisonCounters(target, effect.poisonAmount, {
                            source: 'onDeath.poisonRow',
                            turn: room.gameState.turn,
                            row: effect.row,
                            col: c,
                            sourcePlayer: effect.sourcePlayer,
                            byCard: effect.source || null,
                            byUid: null
                        });
                        log(`Ã¢ËœÂ Ã¯Â¸Â ${effect.source} empoisonne ${target.name} (+${effect.poisonAmount} compteur poison, total: ${target.poisonCounters})`, 'damage');
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
            case 'poisonAll': {
                const poisonAnims = [];
                for (let p = 1; p <= 2; p++) {
                    for (let r = 0; r < 4; r++) {
                        for (let c = 0; c < 2; c++) {
                            const target = room.gameState.players[p].field[r][c];
                            if (!target || target.currentHp <= 0) continue;
                            if (target.abilities?.includes('antitoxin')) continue;
                            addPoisonCounters(target, effect.poisonAmount, {
                                source: 'onDeath.poisonAll',
                                turn: room.gameState.turn,
                                row: r,
                                col: c,
                                sourcePlayer: effect.sourcePlayer,
                                byCard: effect.source || null,
                                byUid: effect.sourceUid || null
                            });
                            poisonAnims.push({
                                type: 'poisonApply',
                                player: p,
                                row: r,
                                col: c,
                                amount: effect.poisonAmount
                            });
                        }
                    }
                }
                if (poisonAnims.length > 0) {
                    log(`☠️ ${effect.source} empoisonne toutes les créatures (+${effect.poisonAmount} poison)`, 'damage');
                    emitAnimationBatch(room, poisonAnims);
                }
                maxSleepTime = Math.max(maxSleepTime, 800);
                break;
            }
            case 'poisonExplosion': {
                // Pustule vivante : inflige des dÃƒÂ©gÃƒÂ¢ts ÃƒÂ©gaux aux compteurs poison ÃƒÂ  toutes les crÃƒÂ©atures ennemies
                const enemyNum = effect.sourcePlayer === 1 ? 2 : 1;
                const enemyField = room.gameState.players[enemyNum].field;
                const explosionResults = [];
                log(`Ã°Å¸â€™Â¥ ${effect.source} explose et inflige ${effect.damage} dÃƒÂ©gÃƒÂ¢ts ÃƒÂ  toutes les crÃƒÂ©atures ennemies!`, 'damage');
                for (let r = 0; r < 4; r++) {
                    for (let c = 0; c < 2; c++) {
                        const target = enemyField[r][c];
                        if (target && target.currentHp > 0) {
                            const actualDmg = applyCreatureDamage(target, effect.damage, room, log, enemyNum, r, c, undefined, effect.sourcePlayer);
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
                // GÃƒÂ©rer les morts causÃƒÂ©es par l'explosion
                const explosionDeaths = [];
                const explosionDeathAnims = [];
                for (const res of explosionResults) {
                    if (res.card.currentHp <= 0) {
                        const result = handleCreatureDeath(room, res.card, res.info.player, res.info.row, res.info.col, log);
                        if (result.transformed) {
                            explosionDeathAnims.push({
                                type: 'deathTransform',
                                player: res.info.player,
                                row: res.info.row,
                                col: res.info.col,
                                fromCard: res.card,
                                toCard: result.newCard
                            });
                        } else {
                            explosionDeathAnims.push({
                                type: 'death',
                                player: res.info.player,
                                row: res.info.row,
                                col: res.info.col,
                                card: res.card
                            });
                            explosionDeaths.push({ card: res.card, player: res.info.player, row: res.info.row, col: res.info.col });
                        }
                    }
                }
                if (explosionDeathAnims.length > 0) {
                    emitAnimationBatch(room, explosionDeathAnims);
                    emitStateToBoth(room);
                    await sleep(1100);
                    await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
                }
                if (explosionDeaths.length > 0) {
                    const explosionEffects = collectOnDeathEffects(explosionDeaths);
                    if (explosionEffects.length > 0) {
                        await resolvePostCombatEffects(room, explosionEffects, log, sleep);
                    }
                    await applyPendingHealOnDeath(room, log);
                }
                maxSleepTime = Math.max(maxSleepTime, 800);
                break;
            }
            case 'millFirstCreature': {
                const player = room.gameState.players[effect.player];
                const creatureIndex = player.deck.findIndex(c => c.type === 'creature');
                if (creatureIndex !== -1) {
                    const [milled] = player.deck.splice(creatureIndex, 1);
                    addToGraveyard(player, milled);
                    log(`  Ã°Å¸ÂªÂ¦ ${effect.source} Ã¢â€ â€™ ${milled.name} va au cimetiÃƒÂ¨re`, 'action');
                    emitAnimation(room, 'burn', { player: effect.player, card: milled });
                    await sleep(20);
                    emitStateToBoth(room);
                    await sleep(1200);
                    await syncMillWatchers(room, effect.player, 1, log, sleep);
                    recalcDynamicAtk(room);
                    emitStateToBoth(room);
                }
                break;
            }
            case 'reanimateMeleeCost2OrLessBottom': {
                const player = room.gameState.players[effect.player];
                if (!player || player.field[effect.row][effect.col]) break;

                // "Plus basse position" du cimetiÃƒÂ¨re => on parcourt depuis la fin.
                let creatureIdx = -1;
                for (let i = player.graveyard.length - 1; i >= 0; i--) {
                    const gc = player.graveyard[i];
                    if (!gc || gc.type !== 'creature') continue;
                    if (gc.combatType !== 'melee') continue;
                    if ((gc.cost ?? 0) > 2) continue;
                    creatureIdx = i;
                    break;
                }

                if (creatureIdx === -1) {
                    log(`  Ã¢Å¡Â°Ã¯Â¸Â ${effect.source} : aucune crÃƒÂ©ature de mÃƒÂªlÃƒÂ©e (coÃƒÂ»t Ã¢â€°Â¤2) ÃƒÂ  rÃƒÂ©animer`, 'info');
                    break;
                }

                const creature = player.graveyard.splice(creatureIdx, 1)[0];
                const baseCard = CardByIdMap.get(creature.id);
                const template = baseCard || creature;
                const placed = {
                    ...template,
                    abilities: [...(template.abilities || [])],
                    uid: creature.uid || `${Date.now()}-onDeathReanimate-${Math.random()}`,
                    currentHp: template.hp,
                    baseAtk: template.atk,
                    baseHp: template.hp,
                    canAttack: !!(template.abilities && (template.abilities.includes('haste') || template.abilities.includes('superhaste'))),
                    turnsOnField: 0,
                    movedThisTurn: false
                };
                if (placed.abilities.includes('protection')) placed.hasProtection = true;
                if (placed.abilities.includes('camouflage')) placed.hasCamouflage = true;
                if (placed.abilities.includes('untargetable')) placed.hasUntargetable = true;
                placed.summonOrder = ++room.gameState.summonCounter;
                player.field[effect.row][effect.col] = placed;

                log(`  Ã°Å¸ÂªÂ¦ ${effect.source} : ${placed.name} est rÃƒÂ©animÃƒÂ© sur son emplacement`, 'special');
                emitAnimation(room, 'reanimate', { player: effect.player, row: effect.row, col: effect.col, card: placed });
                recalcDynamicAtk(room);
                maxSleepTime = Math.max(maxSleepTime, 1200);
                break;
            }
            case 'summonIfPoisoned': {
                const player = room.gameState.players[effect.player];
                if (!player) break;
                if (effect.row === undefined || effect.col === undefined) break;
                if (player.field[effect.row][effect.col]) break;

                const template = CardByIdMap.get(effect.summonId);
                if (!template) break;

                const summoned = {
                    ...template,
                    abilities: [...(template.abilities || [])],
                    uid: `${Date.now()}-onDeathSummon-${Math.random()}`,
                    currentHp: template.hp,
                    baseAtk: template.atk,
                    baseHp: template.hp,
                    canAttack: !!(template.abilities && (template.abilities.includes('haste') || template.abilities.includes('superhaste'))),
                    turnsOnField: 0,
                    movedThisTurn: false
                };
                if (summoned.abilities.includes('protection')) summoned.hasProtection = true;
                if (summoned.abilities.includes('camouflage')) summoned.hasCamouflage = true;
                if (summoned.abilities.includes('untargetable')) summoned.hasUntargetable = true;
                summoned.summonOrder = ++room.gameState.summonCounter;

                player.field[effect.row][effect.col] = summoned;
                if (player.revealField) player.revealField[effect.row][effect.col] = summoned;

                log(`  ☠️ ${effect.source} invoque ${summoned.name} sur son emplacement (mort empoisonnée)`, 'special');
                emitAnimation(room, 'trapSummon', { player: effect.player, row: effect.row, col: effect.col, card: summoned });
                recalcDynamicAtk(room);
                maxSleepTime = Math.max(maxSleepTime, 1200);
                break;
            }
        }
    }

    // 2. Ãƒâ€°mettre l'animation de pioche si nÃƒÂ©cessaire
    if (allDrawnCards.length > 0) {
        emitAnimation(room, 'draw', { cards: allDrawnCards });
        maxSleepTime = Math.max(maxSleepTime, 1400);
    }

    if (allBurnedCards.length > 0) {
    }

    // 3. State immÃƒÂ©diat (pour que le client ait les cartes en main, HP ÃƒÂ  jour, etc.)
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
            log(`Ã°Å¸â€™Âª ${kh.killerCard.name} gagne +${powerBonus} ATK!`, 'buff');
        }
    }

    if (killerHitResults.length > 0 || rowDamageResults.length > 0) {
        emitStateToBoth(room);
    }

    // 6. Burns (cartes brÃƒÂ»lÃƒÂ©es car main pleine) Ã¢â‚¬â€ ajouter au cimetiÃƒÂ¨re MAINTENANT
    for (const burned of allBurnedCards) {
        addToGraveyard(room.gameState.players[burned.player], burned.card);
        log(`  Ã°Å¸â€œÂ¦ Main pleine, ${burned.card.name} va au cimetiÃƒÂ¨re`, 'damage');
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
        await sleep(20);
        emitStateToBoth(room);
        await sleep(1200);
    }

    // 7. Morts secondaires (creatureDamage + rowDamage + destroyAll)
    const secondaryDeaths = [];

    // Scan global : toutes les crÃƒÂ©atures ÃƒÂ  0 HP (couvre destroyAll + dÃƒÂ©gÃƒÂ¢ts divers)
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
                        log(`Ã¢ËœÂ Ã¯Â¸Â ${target.name} dÃƒÂ©truit!`, 'damage');
                        emitAnimation(room, 'death', { player: p, row: r, col: c, card: target });
                        secondaryDeaths.push({ player: p, row: r, col: c, card: target });
                    }
                }
            }
        }
    }
    // Morts spÃƒÂ©cifiques aux killerHitResults (skip si dÃƒÂ©jÃƒÂ  traitÃƒÂ©es par le scan global)
    for (const kh of killerHitResults) {
        if (kh.killerCard.currentHp <= 0 && room.gameState.players[kh.killerInfo.player].field[kh.killerInfo.row][kh.killerInfo.col] === kh.killerCard) {
            const result = handleCreatureDeath(room, kh.killerCard, kh.killerInfo.player, kh.killerInfo.row, kh.killerInfo.col, log);
            if (result.transformed) {
                emitAnimation(room, 'deathTransform', { player: kh.killerInfo.player, row: kh.killerInfo.row, col: kh.killerInfo.col, fromCard: kh.killerCard, toCard: result.newCard });
            } else {
                log(`Ã¢ËœÂ Ã¯Â¸Â ${kh.killerCard.name} dÃƒÂ©truit!`, 'damage');
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
                log(`Ã¢ËœÂ Ã¯Â¸Â ${rd.card.name} dÃƒÂ©truit par l'explosion!`, 'damage');
                emitAnimation(room, 'death', { player: rd.info.player, row: rd.info.row, col: rd.info.col, card: rd.card });
                secondaryDeaths.push({ player: rd.info.player, row: rd.info.row, col: rd.info.col, card: rd.card });
            }
        }
    }

    if (secondaryDeaths.length > 0) {
        emitStateToBoth(room);
        await sleep(1100);
        await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
        // RÃƒÂ©cursif : les morts secondaires peuvent aussi avoir des effets
        const secondaryEffects = collectOnDeathEffects(secondaryDeaths);
        await resolvePostCombatEffects(room, secondaryEffects, log, sleep);
        await applyPendingHealOnDeath(room, log);
    }
}

// Wrapper pour les appels existants (traps, spells) avec une seule carte morte
async function processOnDeathAbility(room, card, ownerPlayer, row, col, log, sleep) {
    await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
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
            // DÃƒÂ©lai de grÃƒÂ¢ce (500ms) pour laisser les derniÃƒÂ¨res actions en transit arriver
            // avant de forcer la transition vers la rÃƒÂ©solution
            setTimeout(() => {
                if (room.gameState.phase !== 'planning') return; // DÃƒÂ©jÃƒÂ  rÃƒÂ©solu par checkBothReady
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

async function processBuildingActiveAbility(room, card, playerNum, row, col, log, sleep) {
    // Animation d'activation du bÃƒÂ¢timent (rituel arcanique)
    // selfPoison inclus pour que le handler client joue le nuage poison APRÃƒË†S le VFX dorÃƒÂ©
    emitAnimation(room, 'buildingActivate', {
        player: playerNum, row, col,
        selfPoison: card.activeAbility === 'selfPoison'
    });
    await sleep(900);

    if (card.activeAbility === 'selfPoison') {
        addPoisonCounters(card, 1, {
            source: 'building.selfPoison',
            turn: room.gameState.turn,
            row,
            col,
            sourcePlayer: playerNum,
            byCard: card.name || null,
            byUid: card.uid || null
        });
        log(`Ã¢ËœÂ Ã¯Â¸Â ${card.name} accumule du poison (${card.poisonCounters} marqueurs)`, 'action');
        // Le nuage poison est jouÃƒÂ© par le handler buildingActivate cÃƒÂ´tÃƒÂ© client (via selfPoison: true)
        // Plus besoin de emitAnimationBatch ici Ã¢â‚¬â€ le VFX est inclus dans l'animation queueÃƒÂ©e
        await sleep(800);
    }
    else if (card.activeAbility === 'poisonAll') {
        const poisonAnims = [];
        const sameRowDelayKey = `${room.gameState.turn}:${row}`;
        for (let p = 1; p <= 2; p++) {
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = room.gameState.players[p].field[r][c];
                    if (!target || target.currentHp <= 0) continue;
                    if (target.abilities?.includes('antitoxin')) continue;
                    addPoisonCounters(target, 1, {
                        source: 'building.poisonAll',
                        turn: room.gameState.turn,
                        row: r,
                        col: c,
                        sourcePlayer: playerNum,
                        byCard: card.name || null,
                        byUid: card.uid || null
                    });
                    // If this slot already resolved this row, delay poison tick to avoid retroactive damage.
                    if (r === row && c < col) {
                        target._skipPoisonTickKey = sameRowDelayKey;
                    }
                    poisonAnims.push({ type: 'poisonApply', player: p, row: r, col: c, amount: 1 });
                }
            }
        }
        if (poisonAnims.length > 0) {
            log(`Ã¢ËœÂ Ã¯Â¸Â ${card.name} empoisonne toutes les crÃƒÂ©atures! (+1 poison)`, 'poison');
            emitAnimationBatch(room, poisonAnims);
            await sleep(800);
        }
    }

    // Synchroniser l'ÃƒÂ©tat pour que les compteurs soient visibles avant le prochain bÃƒÂ¢timent/combat
    emitStateToBoth(room);
}

function canCreatureAttack(card) {
    return card && card.canAttack && !card.abilities?.includes('wall') && card.atk > 0;
}

function isSacrificeTarget(card) {
    if (!card || card.type !== 'creature') return false;
    if (card.petrified) return false;
    if (card.movedThisTurn) return false;
    if (card.abilities?.includes('unsacrificable')) return false;
    return !!card.canAttack;
}

function getAdjacentSacrificeTargets(field, row, col, excludeSlots) {
    const neighbors = [[row-1,col],[row,col+1],[row+1,col],[row,col-1]];
    const targets = [];
    for (const [r,c] of neighbors) {
        if (r < 0 || r >= 4 || c < 0 || c >= 2) continue;
        if (excludeSlots && excludeSlots.some(s => s.row === r && s.col === c)) continue;
        if (isSacrificeTarget(field[r][c])) targets.push({ row: r, col: c, card: field[r][c] });
    }
    return targets;
}

// V2 : Effets onPoisonDeath extraits pour rÃƒÂ©utilisation
async function processOnPoisonDeathEffects(room, normalDeaths, log, sleep) {
    if (!normalDeaths || normalDeaths.length === 0) return;

    // poisonAllEnemies : accumuler le poison de toutes les morts
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
                addPoisonCounters(target, totalPoison, {
                    source: 'onDeath.poisonExplosion',
                    turn: room.gameState.turn,
                    row: r,
                    col: c,
                    sourcePlayer: null,
                    byCard: poisonSources.join(' + ') || null,
                    byUid: null
                });
                log(`Ã¢ËœÂ Ã¯Â¸Â ${poisonSources.join(' + ')} empoisonne ${target.name} (+${totalPoison} compteur poison, total: ${target.poisonCounters})`, 'damage');
                poisonApplyAnims.push({ type: 'poisonApply', player: enemyNum, row: r, col: c, amount: totalPoison });
            }
        }
        if (poisonApplyAnims.length > 0) {
            emitAnimationBatch(room, poisonApplyAnims);
            emitStateToBoth(room);
            await sleep(1000);
        }
    }

    // drawOnEnemyPoisonDeath
    const drawByPlayer = {};
    for (const d of normalDeaths) {
        const ownerNum = d.player === 1 ? 2 : 1;
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

    // buffOnEnemyPoisonDeath (Serpent d'ÃƒÂ©meraude)
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
                    log(`Ã°Å¸â€™Âª ${ally.name} gagne +${count}/+${count} (${count} mort(s) poison)`, 'buff');
                    if (ally.trampleAtBuffCounters && ally.buffCounters >= ally.trampleAtBuffCounters && !ally.abilities.includes('trample')) {
                        ally.abilities.push('trample');
                        ally.addedAbilities = ally.addedAbilities || [];
                        ally.addedAbilities.push('trample');
                        log(`Ã°Å¸Â¦Â¶ ${ally.name} acquiert PiÃƒÂ©tinement! (${ally.buffCounters} marqueurs +1/+1)`, 'buff');
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
        await sleep(800);
    }

    await applyHealOnEnemyPoisonDeath(room, normalDeaths, log);
}

// Ver des tombes : sync les watchers de cimetiÃƒÂ¨re et buff si des crÃƒÂ©atures alliÃƒÂ©es sont arrivÃƒÂ©es
async function syncGraveyardWatchers(room, log, sleep) {
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        const currentCount = player.graveyard.filter(c => c.type === 'creature').length;
        const lastCount = player._lastGraveyardCreatureCount || 0;
        const diff = currentCount - lastCount;

        if (diff > 0) {
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const card = player.field[r][c];
                    // Pile d'Os Ã¢â€ â€™ Petit Os : transformation quand une crÃƒÂ©ature alliÃƒÂ©e va au cimetiÃƒÂ¨re
                    if (card && card.onAllyCreatureToGraveyardTransform && card.currentHp > 0) {
                        const template = CardByIdMap.get(card.onAllyCreatureToGraveyardTransform);
                        if (template) {
                            const newCard = {
                                ...template,
                                abilities: [...(template.abilities || [])],
                                uid: `${Date.now()}-gravTransform-${Math.random()}`,
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
                            const fromCard = { ...card };
                            player.field[r][c] = newCard;
                            log(`  Ã°Å¸â€â€ž ${fromCard.name} se transforme en ${newCard.name} !`, 'info');
                            emitAnimation(room, 'deathTransform', {
                                player: p, row: r, col: c,
                                fromCard, toCard: newCard
                            });
                            recalcDynamicAtk(room);
                            emitStateToBoth(room);
                            await sleep(800);
                        }
                    }
                }
            }
        }

        player._lastGraveyardCreatureCount = currentCount;
    }
}

// Ver des tombes : buff +1/+1 par crÃƒÂ©ature mise au cimetiÃƒÂ¨re depuis le deck (mill)
async function syncMillWatchers(room, playerNum, milledCreatureCount, log, sleep) {
    if (milledCreatureCount <= 0) return;
    const player = room.gameState.players[playerNum];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const card = player.field[r][c];
            if (card && card.onAllyMillToGraveyard && card.currentHp > 0) {
                card.buffCounters = (card.buffCounters || 0) + milledCreatureCount;
                card.atk += milledCreatureCount;
                card.hp += milledCreatureCount;
                card.currentHp += milledCreatureCount;
                log(`  Ã°Å¸â€™Âª ${card.name} gagne +${milledCreatureCount}/+${milledCreatureCount} ! (${card.atk}/${card.currentHp})`, 'buff');
                emitAnimation(room, 'buffApply', { player: playerNum, row: r, col: c, atkBuff: milledCreatureCount, hpBuff: milledCreatureCount });
                recalcDynamicAtk(room);
                emitStateToBoth(room);
                await sleep(600);
            }
        }
    }
}

// Spectre rÃƒÂ©current : rÃƒÂ©soudre les rÃƒÂ©animations en attente depuis le cimetiÃƒÂ¨re
const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
async function resolveSpectreReanimates(room, log, sleep) {
    if (!room._pendingSpectreDeaths || room._pendingSpectreDeaths.length === 0) return;

    // Grouper par joueur
    const byPlayer = {};
    for (const d of room._pendingSpectreDeaths) {
        if (!byPlayer[d.playerNum]) byPlayer[d.playerNum] = [];
        byPlayer[d.playerNum].push(d);
    }
    room._pendingSpectreDeaths = [];

    for (const [playerNumStr, deathSlots] of Object.entries(byPlayer)) {
        const playerNum = parseInt(playerNumStr);
        const player = room.gameState.players[playerNum];

        // Chercher un spectre dans le cimetiÃƒÂ¨re
        const spectreIdx = player.graveyard.findIndex(c => c.graveyardTrigger === 'reanimateOnAllyDeath');
        if (spectreIdx === -1) continue;

        // Trier les slots de mort par prioritÃƒÂ© (AÃ¢â€ â€™BÃ¢â€ â€™CÃ¢â€ â€™DÃ¢â€ â€™EÃ¢â€ â€™FÃ¢â€ â€™GÃ¢â€ â€™H)
        deathSlots.sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

        // Trouver le premier slot vide parmi les slots de mort
        let targetSlot = null;
        for (const s of deathSlots) {
            if (!player.field[s.row][s.col]) {
                targetSlot = s;
                break;
            }
        }
        if (!targetSlot) continue;

        // Attendre 250ms aprÃƒÂ¨s l'animation de mort
        await sleep(250);

        // Retirer le spectre du cimetiÃƒÂ¨re
        const spectre = player.graveyard[spectreIdx];
        player.graveyard.splice(spectreIdx, 1);

        // RÃƒÂ©animer avec stats fraÃƒÂ®ches
        const template = CardByIdMap.get(spectre.id) || spectre;
        const reanimated = {
            ...template,
            abilities: [...(template.abilities || [])],
            uid: `${Date.now()}-spectreReanim-${Math.random()}`,
            currentHp: template.hp,
            baseAtk: template.atk,
            baseHp: template.hp,
            canAttack: false,
            turnsOnField: 0,
            movedThisTurn: false
        };
        delete reanimated.poisonCounters;
        delete reanimated.entraveCounters;
        reanimated.summonOrder = ++room.gameState.summonCounter;
        player.field[targetSlot.row][targetSlot.col] = reanimated;

        const slotName = slotNames[targetSlot.row]?.[targetSlot.col] || '?';
        log(`Ã°Å¸â€˜Â» ${spectre.name} se rÃƒÂ©anime depuis le cimetiÃƒÂ¨re en ${slotName}!`, 'action');
        recalcDynamicAtk(room);
        emitAnimation(room, 'reanimate', { player: playerNum, row: targetSlot.row, col: targetSlot.col, card: reanimated });
        emitStateToBoth(room);
        await sleep(900);
    }
}

// V2 : RÃƒÂ©solution des sorts par vitesse puis timestamp
async function resolveSpellsV2(room, spellsByPlayer, log, sleep, checkVictory, revealedOriginals = { 1: [], 2: [] }) {
    const allSpells = [...spellsByPlayer[1], ...spellsByPlayer[2]];
    if (allSpells.length === 0) return false;

    io.to(room.code).emit('phaseMessage', { text: 'Sorts', type: 'spell' });
    log('Ã¢Å“Â¨ Sorts', 'phase');
    await sleep(ANIM_TIMING.phaseIntro);

    // Trier : vitesse DESC, puis timestamp ASC (le plus rapide et le plus tÃƒÂ´t d'abord)
    allSpells.sort((a, b) => {
        const speedDiff = (b.spell.spellSpeed || 1) - (a.spell.spellSpeed || 1);
        if (speedDiff !== 0) return speedDiff;
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    // RÃƒÂ©solution sÃƒÂ©quentielle Ã¢â‚¬â€ chaque sort passe par le flux solo complet
    for (const spell of allSpells) {
        const p = room.gameState.players[spell.playerNum];
        // Calculer la position visuelle du sort dans la main adverse
        // Utiliser la position originale reconstruite, ajustÃƒÂ©e pour les rÃƒÂ©vÃƒÂ©lations prÃƒÂ©cÃƒÂ©dentes
        let visualHandIndex = -1;
        if (spell.originalHandIndexReconstructed !== undefined) {
            visualHandIndex = spell.originalHandIndexReconstructed;
            for (const r of revealedOriginals[spell.playerNum]) {
                if (r < spell.originalHandIndexReconstructed) visualHandIndex--;
            }
            revealedOriginals[spell.playerNum].push(spell.originalHandIndexReconstructed);
        }
        removeHandBonus(p, spell.spell);
        removeFromConfirmedHand(p, spell.spell);
        emitStateToBoth(room);
        await applySpell(room, spell, log, sleep, { visualHandIndex });

        // Ver des tombes : sync aprÃƒÂ¨s chaque sort
        await syncGraveyardWatchers(room, log, sleep);
        // Spectre rÃƒÂ©current : rÃƒÂ©animation depuis le cimetiÃƒÂ¨re
        await resolveSpectreReanimates(room, log, sleep);

        const winner = checkVictory();
        if (winner !== null) {
            await sleep(800);
            if (winner === 0) {
                log(`Ã°Å¸Â¤Â Match nul! Les deux hÃƒÂ©ros sont tombÃƒÂ©s!`, 'phase');
                emitGameOver(room, { winner: 0, draw: true });
            } else {
                log(`Ã°Å¸Ââ€  ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                emitGameOver(room, { winner });
            }
            return true;
        }
    }
    return false;
}

async function startResolution(room) {
    if (room.timer) clearInterval(room.timer);
    room.gameState.phase = 'resolution';
    perfMarkTurnStart(room, room.gameState.turn);
    perfMarkResolutionStart(room);
    
    io.to(room.code).emit('phaseChange', 'resolution');
    
    const log = (msg, type) => emitResolutionLog(room, msg, type);
    const sleep = (ms) => {
        if (CLIENT_PACED_RESOLUTION) return Promise.resolve();
        const requested = Number(ms || 0);
        const waitMs = SERVER_PACING_ENABLED ? requested : Math.min(requested, SERVER_SLEEP_CAP_MS);
        if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
        return new Promise(r => setTimeout(r, waitMs));
    };
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    
    // Fonction pour vÃƒÂ©rifier la victoire (retourne 1 ou 2 pour un gagnant, 0 pour draw, null si pas fini)
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

    // V2 : sorts par joueur pour rÃƒÂ©solution par vitesse
    const spellsByPlayerV2 = { 1: [], 2: [] };
    // V1 : sorts par joueur pour interleaving offensif/dÃƒÂ©fensif
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
                if (RESOLUTION_V2) {
                    spellsByPlayerV2[p].push(action);
                } else {
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
    }

    if (!RESOLUTION_V2) {
    // Interleave les sorts : le joueur le plus rapide (1er sort) commence, puis alternance
    function interleaveSpells(spellsP1, spellsP2) {
        if (spellsP1.length === 0) return spellsP2;
        if (spellsP2.length === 0) return spellsP1;

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
    }
    
    // VÃƒÂ©rifier s'il y a des crÃƒÂ©atures sur le terrain
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
    
    // VÃƒÂ©rifier si quelque chose va se passer
    const hasAnyAction = allActions.moves.length > 0 || 
                        allActions.places.length > 0 || 
                        allActions.spellsDefensive.length > 0 || 
                        allActions.spellsOffensive.length > 0 ||
                        allActions.traps.length > 0 ||
                        hasCreaturesOnField() ||
                        hasTraps();
    
    if (hasAnyAction) {
        log(`Ã¢Å¡â€Ã¯Â¸Â RÃƒâ€°SOLUTION DU TOUR ${room.gameState.turn}`, 'phase');
        await sleep(800);
    }

    // PRÃƒâ€°PARER LA RÃƒâ€°VÃƒâ€°LATION PROGRESSIVE :
    // CrÃƒÂ©er un "revealField" par joueur = ce que l'adversaire voit de ce joueur.
    // Initialement c'est le confirmedField (ÃƒÂ©tat prÃƒÂ©-tour), puis on y ajoute
    // les cartes paire par paire. Le field rÃƒÂ©el n'est PAS modifiÃƒÂ©.
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        // Partir du snapshot du tour prÃƒÂ©cÃƒÂ©dent (avant les actions de ce tour)
        player.revealField = deepClone(player.confirmedField || player.field);
        player.revealTraps = deepClone(player.confirmedTraps || player.traps);
        // Bonus de cartes fantÃƒÂ´mes : l'adversaire voit la main pleine tant que
        // les actions ne sont pas rÃƒÂ©vÃƒÂ©lÃƒÂ©es (dÃƒÂ©crementÃƒÂ© au fur et ÃƒÂ  mesure)
        const actions = player.pendingActions || [];
        const bonusActions = actions.filter(a =>
            a.type === 'place' || a.type === 'spell' || a.type === 'trap'
        );
        // handBonusCards : tableau de cartes fantÃƒÂ´mes (null pour cachÃƒÂ©es, card data pour revealed)
        player.handBonusCards = bonusActions.map(a => {
            const card = a.card || a.spell;
            return (card && card.revealedToOpponent) ? card : null;
        });
        player.handCountBonus = bonusActions.length;
        // Retenir la taille de la main AVANT ajout de tokens (pour interleaver les bonus ÃƒÂ  la bonne position)
        player.preResolutionHandLen = player.hand.length;

        // Reconstruire les index originaux (avant les retraits successifs de la planning phase)
        // Chaque handIndex est relatif ÃƒÂ  la main au moment du retrait ; on compense les retraits prÃƒÂ©cÃƒÂ©dents
        const removedOriginals = [];
        for (const action of actions) {
            let rawIndex = -1;
            if (action.type === 'place') rawIndex = action.handIndex;
            else if (action.type === 'spell') rawIndex = action.originalHandIndex;
            else if (action.type === 'trap') rawIndex = action.handIndex;
            if (rawIndex === undefined || rawIndex < 0) continue;

            let originalIdx = rawIndex;
            for (const prev of removedOriginals) {
                if (prev <= originalIdx) originalIdx++;
            }
            action.originalHandIndexReconstructed = originalIdx;
            removedOriginals.push(originalIdx);
            removedOriginals.sort((a, b) => a - b);
        }
    }

    // Initialiser le snapshot des cimetiÃƒÂ¨res pour syncGraveyardWatchers (Ver des tombes)
    for (let p = 1; p <= 2; p++) {
        room.gameState.players[p]._lastGraveyardCreatureCount = room.gameState.players[p].graveyard.filter(c => c.type === 'creature').length;
    }

    // Activer le mode rÃƒÂ©vÃƒÂ©lation (getPublicGameState utilisera revealField pour l'adversaire)
    room.gameState.revealing = true;

    // Envoyer l'ÃƒÂ©tat initial de rÃƒÂ©vÃƒÂ©lation (adversaire = snapshot prÃƒÂ©-tour)
    emitStateToBoth(room);
    await sleep(100);

    // Reset damagedThisTurn pour toutes les crÃƒÂ©atures
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) card.damagedThisTurn = false;
            }
        }
    }

    // Ver des tombes : sync aprÃƒÂ¨s rÃƒÂ©solution des sorts
    await syncGraveyardWatchers(room, log, sleep);
    // Spectre rÃƒÂ©current : rÃƒÂ©animation depuis le cimetiÃƒÂ¨re
    await resolveSpectreReanimates(room, log, sleep);

    // 1. PHASE DE DÃƒâ€°PLACEMENTS (par paires)
    if (allActions.moves.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Déplacements', type: 'revelation' });
        log('Ã¢â€ â€Ã¯Â¸Â Phase de dÃƒÂ©placements', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        // Regrouper les dÃƒÂ©placements par joueur
        const movesP1 = allActions.moves.filter(a => a.playerNum === 1);
        const movesP2 = allActions.moves.filter(a => a.playerNum === 2);
        const nbPairesMoves = Math.max(movesP1.length, movesP2.length);

        for (let i = 0; i < nbPairesMoves; i++) {
            // Envoyer les animations AVANT le state update
            if (movesP1[i]) {
                const a = movesP1[i];
                // La carte est dÃƒÂ©jÃƒÂ  ÃƒÂ  toRow/toCol dans le field rÃƒÂ©el (move exÃƒÂ©cutÃƒÂ© pendant la planification)
                const currentCard1 = room.gameState.players[a.playerNum].field[a.toRow][a.toCol] || a.card;
                log(`  Ã¢â€ â€Ã¯Â¸Â ${a.heroName}: ${a.card.name} ${slotNames[a.fromRow][a.fromCol]} Ã¢â€ â€™ ${slotNames[a.toRow][a.toCol]}`, 'action');
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
                log(`  Ã¢â€ â€Ã¯Â¸Â ${a.heroName}: ${a.card.name} ${slotNames[a.fromRow][a.fromCol]} Ã¢â€ â€™ ${slotNames[a.toRow][a.toCol]}`, 'action');
                emitAnimation(room, 'move', {
                    player: a.playerNum,
                    fromRow: a.fromRow, fromCol: a.fromCol,
                    toRow: a.toRow, toCol: a.toCol,
                    card: currentCard2
                });
            }
            // DÃƒÂ©lai pour laisser le client dÃƒÂ©marrer l'animation et bloquer les slots
            await sleep(50);
            // Maintenant mettre ÃƒÂ  jour revealField et envoyer le state
            if (movesP1[i]) {
                const a = movesP1[i];
                const rf1 = room.gameState.players[a.playerNum].revealField;
                rf1[a.fromRow][a.fromCol] = null;
                // Utiliser la carte rÃƒÂ©elle pour synchroniser tous les ÃƒÂ©tats (buffCounters, poisonCounters, etc.)
                rf1[a.toRow][a.toCol] = room.gameState.players[a.playerNum].field[a.toRow][a.toCol];
            }
            if (movesP2[i]) {
                const a = movesP2[i];
                const rf2 = room.gameState.players[a.playerNum].revealField;
                rf2[a.fromRow][a.fromCol] = null;
                // Utiliser la carte rÃƒÂ©elle pour synchroniser tous les ÃƒÂ©tats (buffCounters, poisonCounters, etc.)
                rf2[a.toRow][a.toCol] = room.gameState.players[a.playerNum].field[a.toRow][a.toCol];
            }
            emitStateToBoth(room);
            await sleep(ANIM_TIMING.move + ANIM_TIMING.margin);
        }
    }

    // Tracker les positions originales rÃƒÂ©vÃƒÂ©lÃƒÂ©es par joueur (crÃƒÂ©atures Ã¢â€ â€™ piÃƒÂ¨ges Ã¢â€ â€™ sorts)
    const revealedOriginals = { 1: [], 2: [] };

    // 2. PHASE DE RÃƒâ€°VÃƒâ€°LATION DES NOUVELLES CRÃƒâ€°ATURES (par paires)
    if (allActions.places.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Créatures', type: 'revelation' });
        log('Ã°Å¸Å½Â´ Phase de rÃƒÂ©vÃƒÂ©lation - CrÃƒÂ©atures', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        // Regrouper les placements par joueur
        const placesP1 = allActions.places.filter(a => a.playerNum === 1);
        const placesP2 = allActions.places.filter(a => a.playerNum === 2);
        const nbPairesCreatures = Math.max(placesP1.length, placesP2.length);

        // ATK dynamique : exclure les crÃƒÂ©atures pas encore rÃƒÂ©vÃƒÂ©lÃƒÂ©es du comptage
        const unrevealed = { 1: new Set(), 2: new Set() };
        for (const action of allActions.places) {
            unrevealed[action.playerNum].add(`${action.row},${action.col}`);
        }
        // Sauvegarder l'ATK complÃƒÂ¨te pour la vue du propriÃƒÂ©taire (avant exclusions)
        // Le joueur connaÃƒÂ®t dÃƒÂ©jÃƒÂ  ses propres crÃƒÂ©atures, pas besoin de les voir "reset"
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
        // Bloquer les slots d'invocation Ã¢â‚¬â€ inclus dans le state pour atomicitÃƒÂ©
        // (ÃƒÂ©vite la race condition si gameStateUpdate arrive avant blockSlots)
        const summonSlots = allActions.places.map(a => ({ player: a.playerNum, row: a.row, col: a.col }));
        emitStateToBoth(room, summonSlots.length > 0 ? { _blockSlots: summonSlots } : undefined);

        for (let i = 0; i < nbPairesCreatures; i++) {
            // Envoyer les animations AVANT le state update (ATK pas encore recalculÃƒÂ©e pour cette paire)
            if (placesP1[i]) {
                const a = placesP1[i];
                // Synchroniser le card data de l'animation avec l'ATK actuelle du field
                const fieldCard = room.gameState.players[a.playerNum].field[a.row][a.col];
                if (fieldCard) a.card.atk = fieldCard.atk;
                log(`  Ã°Å¸Å½Â´ ${a.heroName}: ${a.card.name} en ${slotNames[a.row][a.col]}`, 'action');
                // Calculer la position visuelle dans la main adverse (ajustÃƒÂ©e pour les rÃƒÂ©vÃƒÂ©lations prÃƒÂ©cÃƒÂ©dentes)
                let visualHandIndex = -1;
                if (a.originalHandIndexReconstructed !== undefined) {
                    visualHandIndex = a.originalHandIndexReconstructed;
                    for (const r of revealedOriginals[a.playerNum]) {
                        if (r < a.originalHandIndexReconstructed) visualHandIndex--;
                    }
                    revealedOriginals[a.playerNum].push(a.originalHandIndexReconstructed);
                }

                emitAnimation(room, 'summon', {
                    player: a.playerNum,
                    row: a.row,
                    col: a.col,
                    card: a.card,
                    visualHandIndex
                });
            }
            if (placesP2[i]) {
                const a = placesP2[i];
                const fieldCard = room.gameState.players[a.playerNum].field[a.row][a.col];
                if (fieldCard) a.card.atk = fieldCard.atk;
                log(`  Ã°Å¸Å½Â´ ${a.heroName}: ${a.card.name} en ${slotNames[a.row][a.col]}`, 'action');
                let visualHandIndex = -1;
                if (a.originalHandIndexReconstructed !== undefined) {
                    visualHandIndex = a.originalHandIndexReconstructed;
                    for (const r of revealedOriginals[a.playerNum]) {
                        if (r < a.originalHandIndexReconstructed) visualHandIndex--;
                    }
                    revealedOriginals[a.playerNum].push(a.originalHandIndexReconstructed);
                }

                emitAnimation(room, 'summon', {
                    player: a.playerNum,
                    row: a.row,
                    col: a.col,
                    card: a.card,
                    visualHandIndex
                });
            }
            // DÃƒÂ©lai pour laisser le client dÃƒÂ©marrer l'animation et bloquer les slots
            await sleep(50);
            // Mettre ÃƒÂ  jour revealField et envoyer le state (ATK inchangÃƒÂ©e pendant l'animation)
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

            // Animation terminÃƒÂ©e : maintenant compter ces crÃƒÂ©atures pour l'ATK dynamique
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

        // Traiter les capacitÃƒÂ©s onSummon APRÃƒË†S toutes les rÃƒÂ©vÃƒÂ©lations de crÃƒÂ©atures
        // Les destructions/dÃƒÂ©gÃƒÂ¢ts offensifs sont diffÃƒÂ©rÃƒÂ©s et rÃƒÂ©solus aprÃƒÂ¨s tous les onSummon
        const allPlaces = [...placesP1, ...placesP2];
        const deferredDestructions = [];
        for (const place of allPlaces) {
            const fieldCard = room.gameState.players[place.playerNum].field[place.row][place.col];
            if (fieldCard && (fieldCard.onSummon || fieldCard.sacrifice)) {
                await processOnSummonAbility(room, fieldCard, place.playerNum, place.row, place.col, log, sleep, deferredDestructions);
            }
        }

        // RÃƒÂ©soudre toutes les destructions diffÃƒÂ©rÃƒÂ©es en mÃƒÂªme temps
        if (deferredDestructions.length > 0) {
            const deathAnims = [];
            const normalDeaths = [];
            for (const d of deferredDestructions) {
                const target = room.gameState.players[d.playerNum].field[d.row][d.col];
                if (!target || target.currentHp <= 0) continue; // DÃƒÂ©jÃƒÂ  mort (doublon ou sacrifice antÃƒÂ©rieur)
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

            // Effets onDeath des crÃƒÂ©atures dÃƒÂ©truites
            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.card, d.player, d.row, d.col, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
    }

    // 3. PHASE DE RÃƒâ€°VÃƒâ€°LATION DES PIÃƒË†GES (sÃƒÂ©quentiels)
    if (allActions.traps.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Pièges', type: 'revelation' });
        log('Ã°Å¸ÂªÂ¤ Phase de rÃƒÂ©vÃƒÂ©lation - PiÃƒÂ¨ges', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.traps) {
            log(`  Ã°Å¸ÂªÂ¤ ${action.heroName}: PiÃƒÂ¨ge en rangÃƒÂ©e ${action.row + 1}`, 'action');
            // Ajouter le piÃƒÂ¨ge au revealTraps AVANT l'animation pour que le client le voie
            room.gameState.players[action.playerNum].revealTraps[action.row] = room.gameState.players[action.playerNum].traps[action.row];
            removeHandBonus(room.gameState.players[action.playerNum], null);
            removeFromConfirmedHand(room.gameState.players[action.playerNum], null);
            // Calculer visualHandIndex pour l'animation (mÃƒÂªme logique que sorts)
            let visualHandIndex = -1;
            if (action.originalHandIndexReconstructed !== undefined) {
                visualHandIndex = action.originalHandIndexReconstructed;
                for (const r of revealedOriginals[action.playerNum]) {
                    if (r < action.originalHandIndexReconstructed) visualHandIndex--;
                }
                revealedOriginals[action.playerNum].push(action.originalHandIndexReconstructed);
            }
            emitStateToBoth(room);
            emitAnimation(room, 'trapPlace', { player: action.playerNum, row: action.row, visualHandIndex });
            await sleep(ANIM_TIMING.trapPlace + ANIM_TIMING.margin);
        }
    }
    
    // Fin de la rÃƒÂ©vÃƒÂ©lation progressive Ã¢â‚¬â€ revenir au field rÃƒÂ©el pour toutes les phases suivantes
    room.gameState.revealing = false;
    for (let p = 1; p <= 2; p++) {
        delete room.gameState.players[p].revealField;
        delete room.gameState.players[p].revealTraps;
        // Nettoyer ownerAtk (utilisÃƒÂ© pendant la rÃƒÂ©vÃƒÂ©lation pour stabiliser la vue du propriÃƒÂ©taire)
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) delete card.ownerAtk;
            }
        }
    }

    // 4. PHASE DES SORTS
    if (RESOLUTION_V2) {
        // V2 : rÃƒÂ©solution par vitesse avec sorts simultanÃƒÂ©s
        const gameEnded = await resolveSpellsV2(room, spellsByPlayerV2, log, sleep, checkVictory, revealedOriginals);
        if (gameEnded) return;
    } else {
    // V1 : sorts dÃƒÂ©fensifs puis offensifs
    if (allActions.spellsDefensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort défensif', type: 'protection' });
        log('Ã°Å¸â€™Å¡ Phase des sorts dÃƒÂ©fensifs', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.spellsDefensive) {
            removeHandBonus(room.gameState.players[action.playerNum], action.spell);
            removeFromConfirmedHand(room.gameState.players[action.playerNum], action.spell);
            emitStateToBoth(room);
            await applySpell(room, action, log, sleep);
        }
    }

    if (allActions.spellsOffensive.length > 0) {
        io.to(room.code).emit('phaseMessage', { text: 'Sort offensif', type: 'attack' });
        log('Ã°Å¸â€Â¥ Phase des sorts offensifs', 'phase');
        await sleep(ANIM_TIMING.phaseIntro);

        for (const action of allActions.spellsOffensive) {
            removeHandBonus(room.gameState.players[action.playerNum], action.spell);
            removeFromConfirmedHand(room.gameState.players[action.playerNum], action.spell);
            emitStateToBoth(room);
            await applySpell(room, action, log, sleep);

            const winner = checkVictory();
            if (winner !== null) {
                await sleep(800);
                if (winner === 0) {
                    log(`Ã°Å¸Â¤Â Match nul! Les deux hÃƒÂ©ros sont tombÃƒÂ©s!`, 'phase');
                    emitGameOver(room, { winner: 0, draw: true });
                } else {
                    log(`Ã°Å¸Ââ€  ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                    emitGameOver(room, { winner });
                }
                return;
            }
        }
    }
    } // fin V1 sorts
    
    // Nettoyage du bonus de main fantÃƒÂ´me (toutes les cartes jouÃƒÂ©es ont ÃƒÂ©tÃƒÂ© rÃƒÂ©vÃƒÂ©lÃƒÂ©es)
    for (let p = 1; p <= 2; p++) {
        delete room.gameState.players[p].handCountBonus;
        delete room.gameState.players[p].handBonusCards;
        delete room.gameState.players[p].preResolutionHandLen;
        delete room.gameState.players[p].confirmedOppHand;
    }

    emitStateToBoth(room);
    await sleep(300);

    // 6. PHASE DE COMBAT - piÃƒÂ¨ges puis attaques LIGNE PAR LIGNE (mÃƒÂ©lodie + pÃƒÂ©trification intÃƒÂ©grÃƒÂ©es par ligne)
    if (hasCreaturesOnField() || hasTraps()) {
        io.to(room.code).emit('phaseMessage', { text: 'Combat', type: 'combat' });
        log('Ã¢Å¡â€Ã¯Â¸Â Combat', 'phase');
        await sleep(800);

        const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

        // Combat LIGNE PAR LIGNE : piÃƒÂ¨ges puis attaques
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 2; col++) {

                // PiÃƒÂ¨ges dÃƒÂ©clenchÃƒÂ©s par les attaquants de cette colonne (AVANT le glow violet)
                await processTrapsForRow(room, row, col, log, sleep);

                // Signaler le glow violet pour cette colonne (aprÃƒÂ¨s les piÃƒÂ¨ges, juste avant le combat)
                const colActiveSlots = [];
                for (let p = 1; p <= 2; p++) {
                    const card = room.gameState.players[p].field[row][col];
                    if (!card || card.currentHp <= 0) continue;
                    if (card.isBuilding && card.canAttack && card.activeAbility) {
                        colActiveSlots.push({ player: p, col });
                        continue;
                    }
                    if (canCreatureAttack(card)) {
                        const enemyP = p === 1 ? 2 : 1;
                        const enemyField = room.gameState.players[enemyP].field;
                        const target = findTarget(card, enemyField[row][1], enemyField[row][0], enemyP, row, col);
                        if (target) {
                            colActiveSlots.push({ player: p, col });
                        }
                    }
                }
                if (colActiveSlots.length > 0) {
                    emitAnimation(room, 'combatRowStart', { row, activeSlots: colActiveSlots });
                }

                // Puis le combat de ce slot
                let gameEnded = await processCombatSlotV2(room, row, col, log, sleep, checkVictory, slotNames);

                if (gameEnded) {
                    const winner = checkVictory();
                    if (winner !== null) {
                        await sleep(800);
                        if (winner === 0) {
                            log(`Ã°Å¸Â¤Â Match nul! Les deux hÃƒÂ©ros sont tombÃƒÂ©s!`, 'phase');
                            emitGameOver(room, { winner: 0, draw: true });
                        } else {
                            log(`Ã°Å¸Ââ€  ${room.gameState.players[winner].heroName} GAGNE!`, 'phase');
                            emitGameOver(room, { winner });
                        }
                        return;
                    }
                }
            }

            // Nettoyer le flag _attackedThisCombat pour cette ligne
            for (let p = 1; p <= 2; p++) {
                for (let c = 0; c < 2; c++) {
                    const card = room.gameState.players[p].field[row][c];
                    if (card) {
                        delete card._attackedThisCombat;
                        delete card._spawnAdjMeleeDone;
                        delete card._endOfCombatResolved;
                    }
                }
            }

            // Ver des tombes : sync aprÃƒÂ¨s chaque ligne de combat
            await syncGraveyardWatchers(room, log, sleep);
            // Spectre rÃƒÂ©current : rÃƒÂ©animation depuis le cimetiÃƒÂ¨re
            await resolveSpectreReanimates(room, log, sleep);
        }

        // Fin de la phase de combat Ã¢â‚¬â€ retirer les glows violet
        emitAnimation(room, 'combatEnd', {});
        await sleep(1000); // Laisser les derniÃƒÂ¨res animations de combat se terminer
    }

    // Mettre ÃƒÂ  jour les crÃƒÂ©atures pour le prochain tour
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card) {
                    card.turnsOnField++;
                    card.canAttack = !card.petrified;
                    card.movedThisTurn = false;
                    // Camouflage se dissipe au dÃƒÂ©but du prochain tour
                    if (card.hasCamouflage) card.hasCamouflage = false;
                }
            }
        }
    }
    
    // VÃƒÂ©rifier victoire finale
    const finalWinner = checkVictory();
    if (finalWinner) {
        await sleep(800);
        log(`Ã°Å¸Ââ€  ${room.gameState.players[finalWinner].heroName} GAGNE!`, 'phase');
        emitGameOver(room, { winner: finalWinner });
        return;
    }
    
    // 7. PIOCHE
    // VÃƒÂ©rifier d'abord si les deux joueurs peuvent piocher
    const player1CanDraw = room.gameState.players[1].deck.length > 0;
    const player2CanDraw = room.gameState.players[2].deck.length > 0;
    
    if (!player1CanDraw && !player2CanDraw) {
        // Les deux joueurs ne peuvent pas piocher = DRAW
        log(`Ã°Å¸â€™â‚¬ Les deux joueurs n'ont plus de cartes dans leur deck!`, 'damage');
        log(`Ã°Å¸Â¤Â Match nul par ÃƒÂ©puisement simultanÃƒÂ©!`, 'phase');
        emitGameOver(room, { winner: 0, draw: true });
        return;
    } else if (!player1CanDraw) {
        log(`Ã°Å¸â€™â‚¬ ${room.gameState.players[1].heroName} n'a plus de cartes dans son deck!`, 'damage');
        log(`Ã°Å¸Ââ€  ${room.gameState.players[2].heroName} GAGNE par ÃƒÂ©puisement du deck!`, 'phase');
        emitGameOver(room, { winner: 2 });
        return;
    } else if (!player2CanDraw) {
        log(`Ã°Å¸â€™â‚¬ ${room.gameState.players[2].heroName} n'a plus de cartes dans son deck!`, 'damage');
        log(`Ã°Å¸Ââ€  ${room.gameState.players[1].heroName} GAGNE par ÃƒÂ©puisement du deck!`, 'phase');
        emitGameOver(room, { winner: 1 });
        return;
    }
    
    // 7b. PHASE DE PIOCHE
    io.to(room.code).emit('phaseMessage', { text: 'Pioche', type: 'draw' });
    log('Ã°Å¸Å½Â´ Pioche', 'phase');
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
            log(`Ã°Å¸â€œÂ¦ ${player.heroName} a la main pleine, la carte va au cimetiÃƒÂ¨re`, 'damage');
            drawnCards.push({ player: p, card: card, burned: true });
        } else {
            player.hand.push(card);
            drawnCards.push({ player: p, card: card, handIndex: player.hand.length - 1 });
        }
    }

    // SÃƒÂ©parer les cartes piochÃƒÂ©es normalement et les cartes brÃƒÂ»lÃƒÂ©es
    const normalDraws = drawnCards.filter(d => !d.burned);
    const burnedCards = drawnCards.filter(d => d.burned);

    // Animation de pioche normale AVANT ÃƒÂ©tat
    if (normalDraws.length > 0) {
        emitAnimation(room, 'draw', { cards: normalDraws });
    }

    // Animation de burn AVANT ÃƒÂ©tat (le client bloque le render du cimetiÃƒÂ¨re dÃƒÂ¨s rÃƒÂ©ception)
    for (const burned of burnedCards) {
        emitAnimation(room, 'burn', { player: burned.player, card: burned.card });
    }

    await sleep(20); // Laisser les events arriver avant l'ÃƒÂ©tat

    // Ãƒâ€°tat (le render va crÃƒÂ©er les cartes cachÃƒÂ©es, le cimetiÃƒÂ¨re est bloquÃƒÂ© pour les burns)
    emitStateToBoth(room);
    log('Ã°Å¸â€œÂ¦ Les joueurs piochent une carte', 'action');

    // Attendre la plus longue animation (pioche ~1400ms, burn ~1550ms)
    const drawDelay = normalDraws.length > 0 ? 1400 : 0;
    const burnDelay = burnedCards.length > 0 ? 1600 : 0;
    await sleep(Math.max(drawDelay, burnDelay, 500));

    // Ver des tombes : sync aprÃƒÂ¨s la pioche (burns de main pleine)
    await syncGraveyardWatchers(room, log, sleep);
    // Spectre rÃƒÂ©current : rÃƒÂ©animation depuis le cimetiÃƒÂ¨re
    await resolveSpectreReanimates(room, log, sleep);

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

    // Retour du cimetiÃƒÂ¨re : cartes avec graveyardReturn qui reviennent en main (une par une)
    let anyGraveyardReturn = false;
    for (let playerNum = 1; playerNum <= 2; playerNum++) {
        const player = room.gameState.players[playerNum];
        const graveyard = player.graveyard;
        let creatureCount = graveyard.filter(g => g.type === 'creature').length;
        for (let i = graveyard.length - 1; i >= 0; i--) {
            const card = graveyard[i];
            if (card.graveyardReturn) {
                const minCreatures = card.graveyardReturn.minCreatures || 0;
                if (creatureCount >= minCreatures && player.hand.length < 10) {
                    graveyard.splice(i, 1);
                    if (card.type === 'creature') creatureCount--;
                    card.revealedToOpponent = true;
                    player.hand.push(card);
                    log(`Ã°Å¸ÂªÂ¦ ${card.name} revient du cimetiÃƒÂ¨re dans la main de ${player.heroName}! (${creatureCount} crÃƒÂ©atures au cimetiÃƒÂ¨re)`, 'action');
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

// RÃƒÂ©soudre les piÃƒÂ¨ges pour une rangÃƒÂ©e, dÃƒÂ©clenchÃƒÂ©s par les attaquants d'une colonne spÃƒÂ©cifique
async function processTrapsForRow(room, row, triggerCol, log, sleep) {
    for (let attackerPlayer = 1; attackerPlayer <= 2; attackerPlayer++) {
        const defenderPlayer = attackerPlayer === 1 ? 2 : 1;
        const defenderState = room.gameState.players[defenderPlayer];
        const trap = defenderState.traps[row];

        if (!trap) continue;

        // VÃƒÂ©rifier si la crÃƒÂ©ature de cette colonne va attaquer dans la direction du piÃƒÂ¨ge
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
        
        // DÃƒÂ©clencher le piÃƒÂ¨ge sur le premier attaquant trouvÃƒÂ©
        if (attackers.length > 0) {

            // === PIÃƒË†GE MELEE ONLY : ne se dÃƒÂ©clenche que si l'attaquant est mÃƒÂªlÃƒÂ©e ===
            if (trap.meleeOnly) {
                const firstCard = attackers[0].card;
                const isMelee = !firstCard.abilities?.includes('shooter') && !firstCard.abilities?.includes('fly');
                if (!isMelee) continue; // Tireur/volant Ã¢â€ â€™ le piÃƒÂ¨ge ne se dÃƒÂ©clenche pas
            }

            const trapPreviewTargets = trap.pattern === 'line'
                ? [0, 1]
                    .filter((col) => !!attackerState.field[row][col])
                    .map((col) => ({ player: attackerPlayer, row, col }))
                : (attackers[0]
                    ? [{ player: attackerPlayer, row, col: attackers[0].col }]
                    : []);

            // === PIÃƒË†GE SUMMON : condition spÃƒÂ©ciale Ã¢â‚¬â€ le slot adjacent (col 1) doit ÃƒÂªtre vide ===
            if (trap.effect === 'summon') {
                const adjCol = 1; // colonne intÃƒÂ©rieure (B/D/F/H)
                if (defenderState.field[row][adjCol]) {
                    // Slot adjacent occupÃƒÂ© Ã¢â€ â€™ le piÃƒÂ¨ge ne se dÃƒÂ©clenche PAS, reste en place
                    continue;
                }

                emitAnimation(room, 'trapTrigger', {
                    player: defenderPlayer,
                    row: row,
                    trap: trap,
                    triggerCol,
                    attackerPlayer,
                    targets: trapPreviewTargets
                });
                await sleep(2200);

                const template = CardByIdMap.get(trap.summonId);
                if (template) {
                    log(`Ã°Å¸ÂªÂ¤ PiÃƒÂ¨ge "${trap.name}" dÃƒÂ©clenchÃƒÂ©! Un ${template.name} apparaÃƒÂ®t!`, 'trap');

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

                // Mettre le piÃƒÂ¨ge au cimetiÃƒÂ¨re
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);
                continue;
            }

            emitAnimation(room, 'trapTrigger', {
                player: defenderPlayer,
                row: row,
                trap: trap,
                triggerCol,
                attackerPlayer,
                targets: trapPreviewTargets
            });
            await sleep(2200);

            if (trap.pattern === 'line') {
                // === PIÃƒË†GE DE LIGNE : blesse toutes les crÃƒÂ©atures adverses sur la ligne ===
                log(`Ã°Å¸ÂªÂ¤ PiÃƒÂ¨ge "${trap.name}" dÃƒÂ©clenchÃƒÂ© sur la ligne ${row + 1}!`, 'trap');

                const lineTargets = [];
                for (let col = 0; col < 2; col++) {
                    const card = attackerState.field[row][col];
                    if (card) {
                        lineTargets.push({ card, col });
                    }
                }

                if (trap.damage) {
                    for (const t of lineTargets) {
                        const actualDmg = applyCreatureDamage(t.card, trap.damage, room, log, attackerPlayer, row, t.col, undefined, defenderPlayer);
                        if (actualDmg > 0) {
                            emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: t.col, amount: trap.damage });
                            log(`  Ã°Å¸â€Â¥ ${t.card.name} subit ${trap.damage} dÃƒÂ©gÃƒÂ¢ts du piÃƒÂ¨ge!`, 'damage');
                            if (t.card.currentHp > 0 && t.card.abilities.includes('power')) {
                                const powerBonus = t.card.powerX || 1;
                                t.card.powerStacks = (t.card.powerStacks || 0) + powerBonus;
                                log(`Ã°Å¸â€™Âª ${t.card.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                        }
                    }
                    await sleep(500);
                }

                // Mettre le piÃƒÂ¨ge au cimetiÃƒÂ¨re
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);

                // VÃƒÂ©rifier les morts
                const trapLineNormalDeaths = [];
                for (const t of lineTargets) {
                    if (t.card.currentHp <= 0) {
                        const result = handleCreatureDeath(room, t.card, attackerPlayer, row, t.col, log);
                        if (result.transformed) {
                            emitAnimation(room, 'deathTransform', { player: attackerPlayer, row: row, col: t.col, fromCard: t.card, toCard: result.newCard });
                        } else {
                            log(`  Ã¢ËœÂ Ã¯Â¸Â ${t.card.name} dÃƒÂ©truit par le piÃƒÂ¨ge!`, 'damage');
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
                // === PIÃƒË†GE BOUNCE : renvoie la crÃƒÂ©ature dans la main ===
                const firstAttacker = attackers[0];

                log(`Ã°Å¸ÂªÂ¤ PiÃƒÂ¨ge "${trap.name}" dÃƒÂ©clenchÃƒÂ© sur ${firstAttacker.card.name}!`, 'trap');

                // DÃƒÂ©terminer la destination AVANT l'animation
                const handFull = attackerState.hand.length >= 9;

                // Animation de bounce AVANT de retirer du terrain
                emitAnimation(room, 'bounce', {
                    player: attackerPlayer, row: row, col: firstAttacker.col,
                    card: firstAttacker.card,
                    toGraveyard: handFull
                });
                await sleep(800);

                // RÃƒÂ©initialiser la carte ÃƒÂ  ses stats de base
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

                // Remettre en main (si main pleine, va au cimetiÃƒÂ¨re)
                if (!handFull) {
                    bouncedCard.revealedToOpponent = true;
                    attackerState.hand.push(bouncedCard);
                    log(`  Ã°Å¸Å’â‚¬ ${bouncedCard.name} renvoyÃƒÂ© dans la main!`, 'action');
                } else {
                    addToGraveyard(attackerState, bouncedCard);
                    log(`  Ã°Å¸Å’â‚¬ ${bouncedCard.name} renvoyÃƒÂ© mais main pleine Ã¢â€ â€™ cimetiÃƒÂ¨re!`, 'action');
                }

                // Mettre le piÃƒÂ¨ge au cimetiÃƒÂ¨re
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);
            } else {
                // === PIÃƒË†GE STANDARD : blesse le premier attaquant ===
                const firstAttacker = attackers[0];

                log(`Ã°Å¸ÂªÂ¤ PiÃƒÂ¨ge "${trap.name}" dÃƒÂ©clenchÃƒÂ© sur ${firstAttacker.card.name}!`, 'trap');

                if (trap.damage) {
                    const actualDmg = applyCreatureDamage(firstAttacker.card, trap.damage, room, log, attackerPlayer, row, firstAttacker.col, undefined, defenderPlayer);
                    if (actualDmg > 0) {
                        emitAnimation(room, 'damage', { player: attackerPlayer, row: row, col: firstAttacker.col, amount: trap.damage });
                    }
                    await sleep(500);
                    if (actualDmg > 0 && firstAttacker.card.currentHp > 0 && firstAttacker.card.abilities.includes('power')) {
                        const powerBonus = firstAttacker.card.powerX || 1;
                        firstAttacker.card.powerStacks = (firstAttacker.card.powerStacks || 0) + powerBonus;
                        log(`Ã°Å¸â€™Âª ${firstAttacker.card.name} gagne +${powerBonus} ATK!`, 'buff');
                    }
                }

                const wasStunned = trap.effect === 'stun';
                if (wasStunned) {
                    log(`  Ã°Å¸â€™Â« ${firstAttacker.card.name} est paralysÃƒÂ©!`, 'trap');
                    firstAttacker.card.canAttack = false;
                }

                // Mettre le piÃƒÂ¨ge au cimetiÃƒÂ¨re
                addToGraveyard(defenderState, trap);
                defenderState.traps[row] = null;

                emitStateToBoth(room);
                await sleep(500);

                // VÃƒÂ©rifier si la crÃƒÂ©ature meurt du piÃƒÂ¨ge
                if (firstAttacker.card.currentHp <= 0) {
                    const deadCard = firstAttacker.card;
                    const result = handleCreatureDeath(room, deadCard, attackerPlayer, row, firstAttacker.col, log);
                    if (result.transformed) {
                        emitAnimation(room, 'deathTransform', { player: attackerPlayer, row: row, col: firstAttacker.col, fromCard: deadCard, toCard: result.newCard });
                    } else {
                        log(`  Ã¢ËœÂ Ã¯Â¸Â ${deadCard.name} dÃƒÂ©truit par le piÃƒÂ¨ge!`, 'damage');
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

// Fonction sÃƒÂ©parÃƒÂ©e pour appliquer les sorts
async function applySpell(room, action, log, sleep, options = {}) {
    const slotNames = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];
    const playerNum = action.playerNum;
    const player = room.gameState.players[playerNum];
    const opponent = room.gameState.players[playerNum === 1 ? 2 : 1];
    const spell = action.spell;
    let spellReturned = false;
    let spellAddedToGraveyard = false;

    if (!options.skipReveal) {
        // Animation du sort (mode normal Ã¢â‚¬â€ solo)
        emitAnimation(room, 'spell', {
            caster: playerNum,
            targetPlayer: action.targetPlayer,
            row: action.row,
            col: action.col,
            spell: spell,
            visualHandIndex: options.visualHandIndex
        });
        await sleep(2100);
    }

    if (!options.skipGraveyard) {
        // Mettre le sort au cimetiÃƒÂ¨re MAINTENANT (aprÃƒÂ¨s l'animation, avant les effets/morts)
        // pour que les crÃƒÂ©atures tuÃƒÂ©es atterrissent PAR-DESSUS le sort dans le cimetiÃƒÂ¨re
        addToGraveyard(player, spell);
        spellAddedToGraveyard = true;
    }

    // SORTS GLOBAUX (sans ciblage)
    if (spell.pattern === 'global') {
        if (spell.effect === 'draw') {
            await drawCards(room, playerNum, spell.amount, log, sleep, `${action.heroName}: ${spell.name}`);
        } else if (spell.effect === 'mana') {
            // Gagne un cristal mana (ou pioche si dÃƒÂ©jÃƒÂ  10)
            if (player.maxEnergy < 10) {
                player.maxEnergy++;
                player.energy++;
                log(`  Ã°Å¸â€™Å½ ${action.heroName}: ${spell.name} - gagne un cristal de mana (${player.maxEnergy}/10)`, 'action');
            } else if (player.deck.length > 0) {
                await drawCards(room, playerNum, 1, log, sleep, `${action.heroName}: ${spell.name} - mana max`);
            }
        } else if (spell.effect === 'summonZombieWall') {
            // Mur de zombie : invoque un zombie dans chaque emplacement mÃƒÂªlÃƒÂ©e vide (col 1, rows 0-3)
            const template = CardByIdMap.get(spell.summonId);
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
                        log(`  Ã°Å¸Â§Å¸ ${action.heroName}: ${spell.name} Ã¢â€ â€™ Zombie invoquÃƒÂ© en row ${r}`, 'action');
                    }
                }
                recalcDynamicAtk(room);
                if (summonAnims.length > 0) {
                    emitAnimationBatch(room, summonAnims);
                    await sleep(1600);
                }
                emitStateToBoth(room);
            }
        } else if (spell.effect === 'addTokensToHand') {
            // Invoquer les damnÃƒÂ©s : ajouter des tokens dans la main
            const template = CardByIdMap.get(spell.tokenId);
            if (template) {
                const count = spell.tokenCount || 1;
                const addedCards = [];
                for (let i = 0; i < count; i++) {
                    if (player.hand.length >= 9) break;
                    const token = {
                        ...template,
                        abilities: [...(template.abilities || [])],
                        uid: `${Date.now()}-token-${i}-${Math.random()}`,
                        currentHp: template.hp,
                        baseAtk: template.atk,
                        baseHp: template.hp,
                        canAttack: false,
                        turnsOnField: 0,
                        movedThisTurn: false,
                        revealedToOpponent: true
                    };
                    player.hand.push(token);
                    addedCards.push({ player: playerNum, card: token, handIndex: player.hand.length - 1, isToken: true });
                }
                if (addedCards.length > 0) {
                    log(`  Ã°Å¸Å½Â´ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${addedCards.length} ${template.name}(s) ajoutÃƒÂ©(s) en main`, 'action');
                    emitAnimation(room, 'draw', { cards: addedCards });
                    await sleep(1400);
                }
                emitStateToBoth(room);
            }
        }
    }
    else if (spell.pattern === 'all' && spell.effect === 'sacrificeLastAndDamage') {
        // Cruel destin : chaque joueur sacrifie sa derniÃƒÂ¨re crÃƒÂ©ature jouÃƒÂ©e + perd X PV
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

        // Animer et rÃƒÂ©soudre les sacrifices
        if (deaths.length > 0) {
            const slotsToBlock = deaths.map(d => ({ player: d.player, row: d.row, col: d.col }));
            io.to(room.code).emit('blockSlots', slotsToBlock);

            const normalDeaths = [];
            for (const d of deaths) {
                log(`  Ã°Å¸â€™â‚¬ ${spell.name}: ${d.card.name} de ${room.gameState.players[d.player].heroName} est sacrifiÃƒÂ©!`, 'damage');
                const result = handleCreatureDeath(room, d.card, d.player, d.row, d.col, log);
                if (result.transformed) {
                    emitAnimation(room, 'sacrifice', { player: d.player, row: d.row, col: d.col, card: d.card, noFlyToGrave: true });
                    emitAnimation(room, 'deathTransform', { player: d.player, row: d.row, col: d.col, fromCard: d.card, toCard: result.newCard });
                } else {
                    emitAnimation(room, 'sacrifice', { player: d.player, row: d.row, col: d.col, card: d.card });
                    normalDeaths.push(d);
                }
            }

            // Buff onAnySacrifice (ex: Vampire sordide) + onAllySacrifice + Erebeth
            const totalDeaths = deaths.length;
            if (totalDeaths > 0) applyOnAnySacrifice(room, totalDeaths, log);
            for (let p = 1; p <= 2; p++) {
                const count = deaths.filter(d => d.player === p).length;
                if (count > 0) {
                    applyOnAllySacrifice(room, p, count, log);
                    applyErebethSacrifice(room, p, count, log);
                }
            }

            // Effets onSacrifice des crÃƒÂ©atures sacrifiÃƒÂ©es (ex: Zobombie)
            for (const d of deaths) {
                if (d.card.onSacrifice && d.card.onSacrifice.damageOpponent) {
                    const opNum = d.player === 1 ? 2 : 1;
                    const dmg = d.card.onSacrifice.damageOpponent;
                    room.gameState.players[opNum].hp -= dmg;
                    log(`  Ã°Å¸â€™Â¥ ${d.card.name} inflige ${dmg} dÃƒÂ©gÃƒÂ¢t(s) ÃƒÂ  ${room.gameState.players[opNum].heroName} (sacrifice)`, 'damage');
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

        recalcDynamicAtk(room);
        emitStateToBoth(room);
    }
    else if (spell.pattern === 'all' && spell.effect === 'buffAll') {
        const atkBuff = spell.buffAtk || 0;
        const hpBuff = spell.buffHp || 0;
        const player = room.gameState.players[playerNum];
        log(`  Ã¢Å“Â¨ ${action.heroName}: ${spell.name} - +${atkBuff} ATK / +${hpBuff} HP ÃƒÂ  toutes vos crÃƒÂ©atures!`, 'buff');

        const buffAnims = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const target = player.field[r][c];
                if (target && target.currentHp > 0 && !target.isBuilding) {
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
    // RETOUR DU CIMETIÃƒË†RE EN MAIN (Mon prÃƒÂ©cieux)
    else if (spell.pattern === 'all' && spell.effect === 'graveyardToHand') {
        const player = room.gameState.players[playerNum];

        // Chercher la crÃƒÂ©ature dans le cimetiÃƒÂ¨re (index + fallback uid)
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
            log(`  Ã°Å¸â€™Â¨ ${action.heroName}: ${spell.name} ÃƒÂ©choue (cible invalide ou main pleine)`, 'action');
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            creature.revealedToOpponent = true;
            player.hand.push(creature);
            log(`  Ã°Å¸ÂªÂ¦ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${creature.name} revient du cimetiÃƒÂ¨re en main!`, 'special');
            emitAnimation(room, 'graveyardReturn', { player: playerNum, card: creature });
            await sleep(900);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
    }
    // POISON TOUTES LES CRÃƒâ€°ATURES ADVERSES (Contamination de l'eau)
    else if (spell.pattern === 'all' && spell.effect === 'triggerPoison') {
        // Brume toxique : toutes les crÃƒÂ©atures empoisonnÃƒÂ©es subissent leurs dÃƒÂ©gÃƒÂ¢ts de poison immÃƒÂ©diatement
        const poisonDmgAnims = [];
        const poisonDeaths = [];
        for (let p = 1; p <= 2; p++) {
            const pState = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = pState.field[r][c];
                    if (target && target.currentHp > 0 && target.poisonCounters && target.poisonCounters > 0) {
                        if (target.isBuilding || (target.abilities && target.abilities.includes('antitoxin'))) {
                            log(`  Ã°Å¸â€ºÂ¡Ã¯Â¸Â ${target.name} est immunisÃƒÂ© aux dÃƒÂ©gÃƒÂ¢ts de poison`, 'info');
                            continue;
                        }
                        const dmg = target.poisonCounters;
                        target.currentHp -= dmg;
                        log(`  Ã¢ËœÂ Ã¯Â¸Â ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} subit ${dmg} dÃƒÂ©gÃƒÂ¢t(s) de poison!`, 'damage');
                        poisonDmgAnims.push({
                            type: 'poisonDamage',
                            player: p,
                            row: r,
                            col: c,
                            amount: dmg,
                            source: 'spell.triggerPoison',
                            poisonCounters: target.poisonCounters,
                            cardName: target.name,
                            cardUid: target.uid || null
                        });
                        if (target.currentHp <= 0) {
                            poisonDeaths.push({ card: target, player: p, row: r, col: c });
                        } else if (target.abilities?.includes('power')) {
                            const powerBonus = target.powerX || 1;
                            target.powerStacks = (target.powerStacks || 0) + powerBonus;
                            log(`  Ã°Å¸â€™Âª ${target.name} gagne +${powerBonus} ATK! (poison Ã¢â€ â€™ puissance)`, 'buff');
                            emitPowerBuffAnim(room, p, r, c, powerBonus);
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
        // GÃƒÂ©rer les morts par poison
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
            await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
            const deathEffects = collectOnDeathEffects(normalDeaths);
            if (deathEffects.length > 0) {
                await resolvePostCombatEffects(room, deathEffects, log, sleep);
            }
            // Effets onPoisonDeath : accumuler le poison de toutes les morts avant d'ÃƒÂ©mettre
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
                            addPoisonCounters(target, totalPoison, {
                                source: 'onDeath.poisonExplosion',
                                turn: room.gameState.turn,
                                row: r,
                                col: c,
                                sourcePlayer: null,
                                byCard: poisonSources.join(' + ') || null,
                                byUid: null
                            });
                            log(`Ã¢ËœÂ Ã¯Â¸Â ${poisonSources.join(' + ')} empoisonne ${target.name} (+${totalPoison} compteur poison, total: ${target.poisonCounters})`, 'damage');
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
            // buffOnEnemyPoisonDeath (Serpent d'ÃƒÂ©meraude) : +N/+N accumulÃƒÂ© par morts poison
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
                                log(`Ã°Å¸â€™Âª ${ally.name} gagne +${count}/+${count} (${count} mort(s) poison)`, 'buff');
                                // PiÃƒÂ©tinement conditionnel (trampleAtBuffCounters)
                                if (ally.trampleAtBuffCounters && ally.buffCounters >= ally.trampleAtBuffCounters && !ally.abilities.includes('trample')) {
                                    ally.abilities.push('trample');
                                    ally.addedAbilities = ally.addedAbilities || [];
                                    ally.addedAbilities.push('trample');
                                    log(`Ã°Å¸Â¦Â¶ ${ally.name} acquiert PiÃƒÂ©tinement! (${ally.buffCounters} marqueurs +1/+1)`, 'buff');
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
                    addPoisonCounters(target, amount, {
                        source: 'spell.poisonAllEnemies',
                        turn: room.gameState.turn,
                        row: r,
                        col: c,
                        sourcePlayer: playerNum,
                        byCard: spell.name || null,
                        byUid: null
                    });
                    poisonAnims.push({ type: 'poisonApply', player: opponentNum, row: r, col: c, amount });
                    log(`  Ã¢ËœÂ Ã¯Â¸Â ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} reÃƒÂ§oit ${amount} marqueur(s) poison`, 'damage');
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
        // Cri d'outre tombe : -ATK -HP ÃƒÂ  toutes les crÃƒÂ©atures
        const atkDebuff = spell.atkDebuff || 0;
        const hpDebuff = spell.hpDebuff || 0;
        log(`  Ã°Å¸â€™â‚¬ ${action.heroName}: ${spell.name} Ã¢â€ â€™ -${atkDebuff} ATK / -${hpDebuff} HP ÃƒÂ  toutes les crÃƒÂ©atures!`, 'damage');

        const debuffAnims = [];
        const deaths = [];
        for (let p = 1; p <= 2; p++) {
            const targetPlayer = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = targetPlayer.field[r][c];
                    if (target && target.currentHp > 0 && !target.isBuilding) {
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
                    log(`    Ã¢ËœÂ Ã¯Â¸Â ${d.target.name} dÃƒÂ©truit!`, 'damage');
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
    // SORT QUI TOUCHE TOUTES LES CRÃƒâ€°ATURES
    else if (spell.pattern === 'all') {
        const spellBoost = getSpellBoost(room, playerNum);
        const totalDamage = spell.damage + spellBoost;
        log(`  Ã°Å¸Å’â€¹ ${action.heroName}: ${spell.name} - ${totalDamage} dÃƒÂ©gÃƒÂ¢ts ÃƒÂ  toutes les crÃƒÂ©atures!${spellBoost > 0 ? ` (+${spellBoost} sort renforcÃƒÂ©)` : ''}`, 'damage');

        // Phase 1: Collecter toutes les cibles et envoyer les animations de dÃƒÂ©gÃƒÂ¢ts EN BATCH
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

        // Phase 2: Attendre que toutes les animations de dÃƒÂ©gÃƒÂ¢ts se terminent
        await sleep(800);

        // Phase 3: Appliquer les dÃƒÂ©gÃƒÂ¢ts et collecter les morts
        for (let p = 1; p <= 2; p++) {
            const targetPlayer = room.gameState.players[p];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = targetPlayer.field[r][c];
                    if (target) {
                        const actualDmg = applyCreatureDamage(target, totalDamage, room, log, p, r, c, undefined, playerNum);

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

        // Phase 4: Envoyer toutes les animations de mort EN MÃƒÅ ME TEMPS
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
                    log(`    Ã¢ËœÂ Ã¯Â¸Â ${d.target.name} dÃƒÂ©truit!`, 'damage');
                    emitAnimation(room, 'death', { player: d.p, row: d.r, col: d.c, card: d.target });
                    normalDeaths.push(d);
                }
            }

            // Envoyer l'ÃƒÂ©tat maintenant (les slots bloquÃƒÂ©s ne seront pas touchÃƒÂ©s par render)
            emitStateToBoth(room);

            // Attendre que toutes les animations de mort se terminent
            await sleep(1100);

            // DÃƒÂ©bloquer les slots
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            // CapacitÃƒÂ©s onDeath (seulement pour les morts normales)
            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.target, d.p, d.r, d.c, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }

        emitStateToBoth(room);
    }
    // SORT SUR UN HÃƒâ€°ROS (peut ÃƒÂªtre alliÃƒÂ© ou adverse selon targetPlayer)
    else if (spell.pattern === 'hero') {
        const targetHero = room.gameState.players[action.targetPlayer];
        const targetName = targetHero.heroName;
        
        if (spell.damage) {
            // DÃƒÂ©gÃƒÂ¢ts au hÃƒÂ©ros ciblÃƒÂ©
            const spellBoost = getSpellBoost(room, playerNum);
            const totalDamage = spell.damage + spellBoost;
            targetHero.hp -= totalDamage;
            log(`  Ã°Å¸â€˜Å  ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName} (-${totalDamage})${spellBoost > 0 ? ` (+${spellBoost} sort renforcÃƒÂ©)` : ''}`, 'damage');
            emitAnimation(room, 'heroHit', { defender: action.targetPlayer, damage: totalDamage, spellId: spell.id });
        } else if (spell.effect === 'draw') {
            await drawCards(room, action.targetPlayer, spell.amount, log, sleep, `${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName}`);
        } else if (spell.effect === 'mana') {
            // Le hÃƒÂ©ros ciblÃƒÂ© gagne un mana
            if (targetHero.maxEnergy < 10) {
                targetHero.maxEnergy++;
                targetHero.energy++;
                log(`  Ã°Å¸â€™Å½ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName} gagne un cristal de mana (${targetHero.maxEnergy}/10)`, 'action');
            } else if (targetHero.deck.length > 0) {
                await drawCards(room, action.targetPlayer, 1, log, sleep, `${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName} mana max`);
            }
        } else if (spell.effect === 'selfDamageAndDraw') {
            if (spell.selfDamage) {
                targetHero.hp -= spell.selfDamage;
                log(`  Ã°Å¸Â©Â¸ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName} (-${spell.selfDamage} PV)`, 'damage');
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
                log(`  Ã°Å¸ÂªÂ¦ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${card.name} va au cimetiÃƒÂ¨re`, 'action');
                emitAnimation(room, 'burn', { player: action.targetPlayer, card });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1200);
            }
            const milledCreatures = milledCards.filter(c => c.type === 'creature').length;
            if (milledCreatures > 0) await syncMillWatchers(room, action.targetPlayer, milledCreatures, log, sleep);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        } else if (spell.effect === 'millHighestCostCreature') {
            // Pacte sombre : met la crÃƒÂ©ature avec le coÃƒÂ»t le plus ÃƒÂ©levÃƒÂ© du deck au cimetiÃƒÂ¨re
            const creatures = targetHero.deck.filter(c => c.type === 'creature');
            if (creatures.length > 0) {
                const maxCost = Math.max(...creatures.map(c => c.cost));
                const candidates = creatures.filter(c => c.cost === maxCost);
                const chosen = candidates[Math.floor(Math.random() * candidates.length)];
                const idx = targetHero.deck.indexOf(chosen);
                targetHero.deck.splice(idx, 1);
                addToGraveyard(targetHero, chosen);
                log(`  Ã°Å¸ÂªÂ¦ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${chosen.name} (coÃƒÂ»t ${maxCost}) va au cimetiÃƒÂ¨re`, 'action');
                emitAnimation(room, 'burn', { player: action.targetPlayer, card: chosen });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(1200);
                await syncMillWatchers(room, action.targetPlayer, 1, log, sleep);
                recalcDynamicAtk(room);
                emitStateToBoth(room);
            } else {
                log(`  Ã°Å¸â€™Â¨ ${action.heroName}: ${spell.name} Ã¢â€ â€™ aucune crÃƒÂ©ature dans la bibliothÃƒÂ¨que`, 'action');
            }
        } else if (spell.heal) {
            // Soin au hÃƒÂ©ros ciblÃƒÂ©
            const oldHp = targetHero.hp;
            targetHero.hp = Math.min(20, targetHero.hp + spell.heal);
            const healed = targetHero.hp - oldHp;
            if (healed > 0) {
                log(`  Ã°Å¸â€™Å¡ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName} (+${healed} PV)`, 'heal');
            }
        } else if (spell.effect === 'addTokensToHand') {
            // Invoquer les damnÃƒÂ©s : ajouter des tokens dans la main du lanceur
            const template = CardByIdMap.get(spell.tokenId);
            if (template) {
                const count = spell.tokenCount || 1;
                const addedCards = [];
                for (let i = 0; i < count; i++) {
                    if (player.hand.length >= 9) break;
                    const token = {
                        ...template,
                        abilities: [...(template.abilities || [])],
                        uid: `${Date.now()}-token-${i}-${Math.random()}`,
                        currentHp: template.hp,
                        baseAtk: template.atk,
                        baseHp: template.hp,
                        canAttack: false,
                        turnsOnField: 0,
                        movedThisTurn: false,
                        revealedToOpponent: true
                    };
                    player.hand.push(token);
                    addedCards.push({ player: playerNum, card: token, handIndex: player.hand.length - 1, isToken: true });
                }
                if (addedCards.length > 0) {
                    log(`  Ã°Å¸Å½Â´ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${addedCards.length} ${template.name}(s) ajoutÃƒÂ©(s) en main`, 'action');
                    emitAnimation(room, 'draw', { cards: addedCards });
                    await sleep(1400);
                }
                emitStateToBoth(room);
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
        log(`  Ã¢Å“ÂÃ¯Â¸Â ${action.heroName}: ${spell.name} en croix sur ${slotNames[action.row][action.col]}!${spellBoost > 0 ? ` (+${spellBoost} sort renforcÃƒÂ©)` : ''}`, 'damage');

        // Highlight les zones touchÃƒÂ©es
        io.to(room.code).emit('spellHighlight', { targets: allTargets, type: 'damage', pattern: 'cross' });

        // Phase 1: Envoyer toutes les animations de dÃƒÂ©gÃƒÂ¢ts EN BATCH
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

        // Phase 3: Appliquer les dÃƒÂ©gÃƒÂ¢ts et collecter les morts
        const deaths = [];
        for (const t of allTargets) {
            const targetField = t.player === playerNum ? player.field : opponent.field;
            const target = targetField[t.row][t.col];

            if (target) {
                const actualDmg = applyCreatureDamage(target, totalDamage, room, log, t.player, t.row, t.col, undefined, playerNum);
                if (actualDmg > 0) {
                    log(`    Ã°Å¸â€Â¥ ${target.name} (-${totalDamage})`, 'damage');
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

        // Phase 4: Envoyer toutes les morts EN MÃƒÅ ME TEMPS
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
                    log(`    Ã¢ËœÂ Ã¯Â¸Â ${d.target.name} dÃƒÂ©truit!`, 'damage');
                    emitAnimation(room, 'death', { player: d.t.player, row: d.t.row, col: d.t.col, card: d.target });
                    normalDeaths.push(d);
                }
            }

            // Envoyer l'ÃƒÂ©tat maintenant (les slots bloquÃƒÂ©s ne seront pas touchÃƒÂ©s par render)
            emitStateToBoth(room);

            // Attendre que toutes les animations de mort se terminent
            await sleep(1100);

            // DÃƒÂ©bloquer les slots
            io.to(room.code).emit('unblockSlots', slotsToBlock);

            // CapacitÃƒÂ©s onDeath (seulement pour les morts normales)
            for (const d of normalDeaths) {
                await processOnDeathAbility(room, d.target, d.t.player, d.t.row, d.t.col, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }

        emitStateToBoth(room);
    }
    // RÃƒâ€°ANIMATION : placer une crÃƒÂ©ature du cimetiÃƒÂ¨re sur le terrain
    else if (spell.effect === 'reanimate') {
        // Chercher la crÃƒÂ©ature dans le cimetiÃƒÂ¨re (index + fallback uid)
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
            log(`  Ã°Å¸â€™Â¨ ${action.heroName}: ${spell.name} ÃƒÂ©choue (cible invalide)`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            const baseCard = CardByIdMap.get(creature.id);
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

            // onReanimate : buffs spÃƒÂ©ciaux ÃƒÂ  la rÃƒÂ©animation (ex: Blaireau contaminÃƒÂ©)
            if (placed.onReanimate) {
                const reanBuff = placed.onReanimate;
                if (reanBuff.atkBuff) placed.buffCounters = (placed.buffCounters || 0) + reanBuff.atkBuff;
                if (reanBuff.hpBuff) { placed.hp += reanBuff.hpBuff; placed.currentHp += reanBuff.hpBuff; }
                if (reanBuff.addAbility && !placed.abilities.includes(reanBuff.addAbility)) {
                    placed.abilities.push(reanBuff.addAbility);
                    placed.addedAbilities = placed.addedAbilities || [];
                    placed.addedAbilities.push(reanBuff.addAbility);
                }
                log(`  Ã¢Å“Â¨ ${placed.name} gagne +${reanBuff.atkBuff || 0}/+${reanBuff.hpBuff || 0} et ${reanBuff.addAbility || ''} (rÃƒÂ©animation)!`, 'buff');
                recalcDynamicAtk(room);
            }

            log(`  Ã°Å¸ÂªÂ¦ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${placed.name} revient du cimetiÃƒÂ¨re!`, 'special');

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
    else if (spell.effect === 'reanimateWeakened') {
        // RÃƒÂ©animation dÃƒÂ©fectueuse : rÃƒÂ©anime une crÃƒÂ©ature avec currentHp = 1
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
            log(`  Ã°Å¸â€™Â¨ ${action.heroName}: ${spell.name} ÃƒÂ©choue (cible invalide)`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            const baseCard = CardByIdMap.get(creature.id);
            const template = baseCard || creature;

            const placed = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: creature.uid || `${Date.now()}-reanimateWeak-${Math.random()}`,
                currentHp: 1,
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

            // onReanimate : buffs spÃƒÂ©ciaux (ex: Blaireau contaminÃƒÂ© +2/+2)
            if (placed.onReanimate) {
                const reanBuff = placed.onReanimate;
                if (reanBuff.atkBuff) placed.buffCounters = (placed.buffCounters || 0) + reanBuff.atkBuff;
                if (reanBuff.hpBuff) { placed.hp += reanBuff.hpBuff; placed.currentHp += reanBuff.hpBuff; }
                if (reanBuff.addAbility && !placed.abilities.includes(reanBuff.addAbility)) {
                    placed.abilities.push(reanBuff.addAbility);
                    placed.addedAbilities = placed.addedAbilities || [];
                    placed.addedAbilities.push(reanBuff.addAbility);
                }
                log(`  Ã¢Å“Â¨ ${placed.name} gagne +${reanBuff.atkBuff || 0}/+${reanBuff.hpBuff || 0} et ${reanBuff.addAbility || ''} (rÃƒÂ©animation)!`, 'buff');
                recalcDynamicAtk(room);
            }

            log(`  Ã°Å¸ÂªÂ¦ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${placed.name} revient du cimetiÃƒÂ¨re avec 1 PV!`, 'special');

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
    else if (spell.effect === 'reanimateSacrifice') {
        // Cycle ÃƒÂ©ternel : rÃƒÂ©anime avec onSurvive Ã¢â€ â€™ sacrifice (fin du combat)
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
            log(`  Ã°Å¸â€™Â¨ ${action.heroName}: ${spell.name} ÃƒÂ©choue (cible invalide)`, 'action');
            emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
        } else {
            const creature = player.graveyard.splice(creatureIdx, 1)[0];
            const baseCard = CardByIdMap.get(creature.id);
            const template = baseCard || creature;

            const placed = {
                ...template,
                abilities: [...(template.abilities || [])],
                uid: creature.uid || `${Date.now()}-reanimateSacrifice-${Math.random()}`,
                currentHp: template.hp,
                baseAtk: template.atk,
                baseHp: template.hp,
                canAttack: true,
                turnsOnField: 0,
                movedThisTurn: false
            };
            // Ajouter cÃƒÂ©lÃƒÂ©ritÃƒÂ© si pas dÃƒÂ©jÃƒÂ  prÃƒÂ©sente
            if (!placed.abilities.includes('haste') && !placed.abilities.includes('superhaste')) {
                placed.abilities.push('haste');
                placed.addedAbilities = placed.addedAbilities || [];
                placed.addedAbilities.push('haste');
            }
            // Marquer pour sacrifice en fin de combat (onSurvive)
            // IMPORTANT: crÃƒÂ©er un nouvel objet pour ne pas muter le template partagÃƒÂ©
            placed.endOfCombat = { ...(placed.endOfCombat || {}), selfSacrifice: true };
            if (placed.abilities.includes('protection')) placed.hasProtection = true;
            if (placed.abilities.includes('camouflage')) placed.hasCamouflage = true;
            if (placed.abilities.includes('untargetable')) placed.hasUntargetable = true;
            placed.summonOrder = ++room.gameState.summonCounter;

            player.field[action.row][action.col] = placed;

            // onReanimate : buffs spÃƒÂ©ciaux ÃƒÂ  la rÃƒÂ©animation (ex: Blaireau contaminÃƒÂ©)
            if (placed.onReanimate) {
                const reanBuff = placed.onReanimate;
                if (reanBuff.atkBuff) placed.buffCounters = (placed.buffCounters || 0) + reanBuff.atkBuff;
                if (reanBuff.hpBuff) { placed.hp += reanBuff.hpBuff; placed.currentHp += reanBuff.hpBuff; }
                if (reanBuff.addAbility && !placed.abilities.includes(reanBuff.addAbility)) {
                    placed.abilities.push(reanBuff.addAbility);
                    placed.addedAbilities = placed.addedAbilities || [];
                    placed.addedAbilities.push(reanBuff.addAbility);
                }
                log(`  Ã¢Å“Â¨ ${placed.name} gagne +${reanBuff.atkBuff || 0}/+${reanBuff.hpBuff || 0} et ${reanBuff.addAbility || ''} (rÃƒÂ©animation)!`, 'buff');
                recalcDynamicAtk(room);
            }

            log(`  Ã°Å¸â€â€ž ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${placed.name} revient du cimetiÃƒÂ¨re avec CÃƒÂ©lÃƒÂ©ritÃƒÂ© (sacrifice en fin de combat)!`, 'special');
            log(`[EOC-SAC-DBG] reanimateSacrifice:placed card=${placed.name} uid=${placed.uid} p=${playerNum} row=${action.row} col=${action.col} canAttack=${placed.canAttack} endOfCombat=${JSON.stringify(placed.endOfCombat || {})}`, 'action');

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
    // SORT CIBLÃƒâ€° SIMPLE
    else {
        // VÃƒÂ©rifier si on cible un hÃƒÂ©ros (row = -1)
        if (action.row === -1) {
            const targetHero = room.gameState.players[action.targetPlayer];
            const targetName = targetHero.heroName;
            
            // Highlight le hÃƒÂ©ros
            io.to(room.code).emit('heroHighlight', { player: action.targetPlayer, type: spell.offensive ? 'damage' : 'heal' });
            
            if (spell.heal) {
                // Soin au hÃƒÂ©ros
                const oldHp = targetHero.hp;
                targetHero.hp = Math.min(20, targetHero.hp + spell.heal);
                const healed = targetHero.hp - oldHp;
                if (healed > 0) {
                    log(`  Ã°Å¸â€™Å¡ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${targetName} (+${healed} PV)`, 'heal');
                }
            }
        } else {
            const targetField = action.targetPlayer === playerNum ? player.field : opponent.field;
            const target = targetField[action.row][action.col];
            
            // Highlight la zone touchÃƒÂ©e
            io.to(room.code).emit('spellHighlight', { 
                targets: [{ row: action.row, col: action.col, player: action.targetPlayer }], 
                type: spell.offensive ? 'damage' : 'heal' 
            });
            
            if (target) {
                // Destruction directe (ex: Plan douteux)
                if (spell.effect === 'destroy') {
                    log(`  Ã°Å¸â€™â‚¬ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} dÃƒÂ©truit!`, 'damage');
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
                // Destruction si empoisonnÃƒÂ© (Expurger le poison)
                else if (spell.effect === 'destroyIfPoisoned') {
                    if (target.poisonCounters && target.poisonCounters > 0) {
                        log(`  Ã°Å¸â€™â‚¬ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} dÃƒÂ©truit! (${target.poisonCounters} marqueur(s) poison)`, 'damage');
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
                    } else {
                        log(`  Ã¢ÂÅ’ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} n'a aucun marqueur poison`, 'info');
                        emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
                    }
                    emitStateToBoth(room);
                }
                // DÃƒÂ©gÃƒÂ¢ts
                else if (spell.offensive && spell.damage && !(spell.excludeBuildings && target.isBuilding)) {
                    const spellBoost = getSpellBoost(room, playerNum);
                    const totalDamage = spell.damage + spellBoost;
                    // Animation de flammes pour les dÃƒÂ©gÃƒÂ¢ts de sort
                    emitAnimation(room, 'spellDamage', { player: action.targetPlayer, row: action.row, col: action.col, amount: totalDamage });
                    await sleep(800);

                    const actualDmg = applyCreatureDamage(target, totalDamage, room, log, action.targetPlayer, action.row, action.col, undefined, playerNum);
                    if (actualDmg > 0) {
                        log(`  Ã°Å¸â€Â¥ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} (-${totalDamage})${spellBoost > 0 ? ` (+${spellBoost} sort renforcÃƒÂ©)` : ''}`, 'damage');
                    }

                    if (actualDmg > 0 && target.currentHp > 0 && target.abilities.includes('power')) {
                        target.powerStacks = (target.powerStacks || 0) + (target.powerX || 1);
                    }

                    if (target.currentHp <= 0) {
                        const result = handleCreatureDeath(room, target, action.targetPlayer, action.row, action.col, log);
                        if (result.transformed) {
                            emitAnimation(room, 'deathTransform', { player: action.targetPlayer, row: action.row, col: action.col, fromCard: target, toCard: result.newCard });
                        } else {
                            log(`  Ã¢ËœÂ Ã¯Â¸Â ${target.name} dÃƒÂ©truit!`, 'damage');
                            emitAnimation(room, 'death', { player: action.targetPlayer, row: action.row, col: action.col, card: target });
                        }
                        await sleep(1100);
                        if (!result.transformed) {
                            // CapacitÃƒÂ© onDeath
                            await processOnDeathAbility(room, target, action.targetPlayer, action.row, action.col, log, sleep);
                        }

                        // Effet onKill du sort (ex: piocher une carte, soigner le hÃƒÂ©ros)
                        if (spell.onKill) {
                            if (spell.onKill.draw && player.deck.length > 0) {
                                await drawCards(room, playerNum, spell.onKill.draw, log, sleep, `${action.heroName}: ${spell.name} (onKill)`);
                            }
                            if (spell.onKill.healHero) {
                                const oldHp = player.hp;
                                player.hp = Math.min(20, player.hp + spell.onKill.healHero);
                                const healed = player.hp - oldHp;
                                if (healed > 0) {
                                    log(`  Ã°Å¸â€™Å¡ ${action.heroName}: ${spell.name} Ã¢â€ â€™ +${healed} PV (drain)`, 'heal');
                                    emitAnimation(room, 'heroHeal', { player: playerNum, amount: healed });
                                }
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
                        // Stocker l'effet appliquÃƒÂ© sur la carte
                        if (!target.appliedEffects) target.appliedEffects = [];
                        if (target.appliedEffects.length < 20) target.appliedEffects.push({
                            name: spell.name,
                            icon: spell.icon,
                            description: `+${healed} Ã¢ÂÂ¤Ã¯Â¸Â restaurÃƒÂ©`
                        });
                        log(`  Ã°Å¸â€™Å¡ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} (+${healed} PV)`, 'heal');
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
                    // Stocker l'effet appliquÃƒÂ© sur la carte
                    if (!target.appliedEffects) target.appliedEffects = [];
                    if (target.appliedEffects.length < 20) target.appliedEffects.push({
                        name: spell.name,
                        icon: spell.icon,
                        description: spell.description || `+${spell.buff.atk} Ã¢Å¡â€Ã¯Â¸Â +${spell.buff.hp} Ã¢ÂÂ¤Ã¯Â¸Â`
                    });
                    log(`  Ã°Å¸â€™Âª ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} (+${spell.buff.atk}/+${spell.buff.hp})`, 'action');
                    emitAnimation(room, 'buff', { player: action.targetPlayer, row: action.row, col: action.col, atk: spell.buff.atk, hp: spell.buff.hp });
                }
                // Buff ATK seul (ex: AltÃƒÂ©ration musculaire)
                if (!spell.offensive && spell.effect === 'atkBuff' && spell.atkBuff) {
                    target.atk += spell.atkBuff;
                    target.spellAtkBuff = (target.spellAtkBuff || 0) + spell.atkBuff;
                    if (!target.appliedEffects) target.appliedEffects = [];
                    if (target.appliedEffects.length < 20) target.appliedEffects.push({
                        name: spell.name,
                        description: `+${spell.atkBuff} Ã¢Å¡â€Ã¯Â¸Â`
                    });
                    log(`  Ã°Å¸â€™Âª ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} (+${spell.atkBuff} ATK)`, 'action');
                    emitAnimation(room, 'buff', { player: action.targetPlayer, row: action.row, col: action.col, atk: spell.atkBuff, hp: 0 });
                    await sleep(800);
                }
                // Sacrifice + pioche (Pacte bÃƒÂ©nÃƒÂ©fique)
                if (spell.effect === 'sacrificeAndDraw' && !target.isBuilding) {
                    log(`  Ã°Å¸â€™â‚¬ ${action.heroName}: ${spell.name} Ã¢â€ â€™ ${target.name} sacrifiÃƒÂ©!`, 'damage');
                    const result = handleCreatureDeath(room, target, action.targetPlayer, action.row, action.col, log);
                    if (result.transformed) {
                        emitAnimation(room, 'deathTransform', { player: action.targetPlayer, row: action.row, col: action.col, fromCard: target, toCard: result.newCard });
                    } else {
                        emitAnimation(room, 'sacrifice', { player: action.targetPlayer, row: action.row, col: action.col, card: target });
                    }
                    emitStateToBoth(room);
                    await sleep(1100);
                    if (!result.transformed) {
                        await processOnDeathAbility(room, target, action.targetPlayer, action.row, action.col, log, sleep);
                    }
                    // Trigger onAnySacrifice (Vampire sordide)
                    applyOnAnySacrifice(room, 1, log);
                    recalcDynamicAtk(room);
                    emitStateToBoth(room);
                    await sleep(600);
                    // Pioche
                    if (spell.drawAmount) {
                        await drawCards(room, playerNum, spell.drawAmount, log, sleep, `${action.heroName}: ${spell.name}`);
                    }
                    emitStateToBoth(room);
                }
            } else {
                if (spell.returnOnMiss) {
                    log(`  Ã°Å¸â€â€ž ${action.heroName}: ${spell.name} n'a rien touchÃƒÂ©, retourne dans la main!`, 'action');
                    spellReturned = true;
                } else {
                    log(`  Ã°Å¸â€™Â¨ ${action.heroName}: ${spell.name} n'a rien touchÃƒÂ©`, 'action');
                }
                emitAnimation(room, 'spellMiss', { targetPlayer: action.targetPlayer, row: action.row, col: action.col });
            }
        }
    }

    // Retourner le sort en main si spellReturned (returnOnMiss)
    if (spellReturned) {
        // Le sort a ÃƒÂ©tÃƒÂ© ajoutÃƒÂ© au cimetiÃƒÂ¨re (ici ou par le caller pour sorts pairÃƒÂ©s) Ã¢â‚¬â€ le retirer
        const spellUid = spell.uid || spell.id;
        const idx = player.graveyard.findIndex(c => (c.uid || c.id) === spellUid);
        if (idx !== -1) player.graveyard.splice(idx, 1);
        await sleep(300);
        spell.revealedToOpponent = true;
        // Sort retournÃƒÂ© Ã¢â€ â€™ va ÃƒÂ  la fin de la main (aprÃƒÂ¨s les tokens ajoutÃƒÂ©s pendant la rÃƒÂ©solution)
        player.hand.push(spell);
        emitAnimation(room, 'spellReturnToHand', { player: playerNum, card: spell, handIndex: player.hand.length - 1 });
    }

    emitStateToBoth(room);
    await sleep(600);
}

// Ãƒâ€°mettre l'animation visuelle de buff Power (+X ATK)
function emitPowerBuffAnim(room, playerNum, row, col, bonus) {
    const card = room.gameState.players[playerNum].field[row][col];
    // card.atk est l'ATK d'avant recalcDynamicAtk (powerStacks dÃƒÂ©jÃƒÂ  incrÃƒÂ©mentÃƒÂ© mais atk pas encore recalculÃƒÂ©)
    const fromAtk = card ? card.atk : 0;
    emitAnimation(room, 'powerBuff', { player: playerNum, row, col, amount: bonus, fromAtk });
}

// Appliquer les bonus Power en attente Ã¢â‚¬â€ retourne le nombre de buffs ÃƒÂ©mis
function applyPendingPowerBonuses(room, log) {
    let count = 0;
    const powerBuffBatch = [];
    for (let p = 1; p <= 2; p++) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = room.gameState.players[p].field[r][c];
                if (card && card.pendingPowerBonus > 0 && card.currentHp > 0) {
                    const bonus = card.pendingPowerBonus;
                    const fromAtk = card.atk || 0;
                    card.powerStacks = (card.powerStacks || 0) + bonus;
                    log(`Ã°Å¸â€™Âª ${card.name} gagne +${bonus} ATK!`, 'action');
                    powerBuffBatch.push({ type: 'powerBuff', player: p, row: r, col: c, amount: bonus, fromAtk });
                    card.pendingPowerBonus = 0;
                    count++;
                }
            }
        }
    }
    if (powerBuffBatch.length > 0) {
        emitAnimationBatch(room, powerBuffBatch);
    }
    return count;
}

// Traiter le combat pour un slot spÃƒÂ©cifique (row, col)
// Les deux joueurs ont une crÃƒÂ©ature ÃƒÂ  cette position qui peuvent attaquer
async function processCombatSlotV2(room, row, col, log, sleep, checkVictory, slotNames) {
    const p1State = room.gameState.players[1];
    const p2State = room.gameState.players[2];
    const slotName = slotNames[row][col];
    
    const p1Card = p1State.field[row][col];
    const p2Card = p2State.field[row][col];
    
    // CapacitÃƒÂ©s actives des bÃƒÂ¢timents (avant le combat normal)
    if (p1Card && p1Card.isBuilding && p1Card.currentHp > 0 && p1Card.canAttack && p1Card.activeAbility) {
        await processBuildingActiveAbility(room, p1Card, 1, row, col, log, sleep);
    }
    if (p2Card && p2Card.isBuilding && p2Card.currentHp > 0 && p2Card.canAttack && p2Card.activeAbility) {
        await processBuildingActiveAbility(room, p2Card, 2, row, col, log, sleep);
    }

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
    const enterPhase = createCombatPhaseTracker(log, row, col);
    enterPhase('pre_hit', `attacks=${attacks.length}`);

    for (const atk of attacks) {
        if (isRadjawakDebugCard(atk.attacker) || isRadjawakDebugCard(atk.target)) {
            log(
                `[RADJ-DBG] attack-plan slot=${slotName} attackerP=${atk.attackerPlayer} attacker=${formatRadjawakDebugCard(atk.attacker)} targetP=${atk.targetPlayer} target=${atk.targetIsHero ? 'hero' : formatRadjawakDebugCard(atk.target)} targetPos=${atk.targetRow},${atk.targetCol} isShooter=${!!atk.isShooter} isFlying=${!!atk.isFlying}`,
                'action'
            );
        }
    }

    // Marquer les crÃƒÂ©atures qui attaquent (pour endOfCombat/onSurvive)
    for (const atk of attacks) {
        atk.attacker._attackedThisCombat = true;
    }
    const attackedSlots = [];
    const attackedSlotSet = new Set();
    for (const atk of attacks) {
        const key = `${atk.attackerPlayer}:${atk.attackerRow}:${atk.attackerCol}`;
        if (attackedSlotSet.has(key)) continue;
        attackedSlotSet.add(key);
        attackedSlots.push({ playerNum: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol });
    }

    // Effets post-combat ÃƒÂ  rÃƒÂ©soudre simultanÃƒÂ©ment (onDeath + onHeroHit + futurs)
    const postCombatEffects = [];
    const combatCycleId = createCombatCycleId(room, row, col);

    // VÃƒÂ©rifier si combat mutuel (les deux s'attaquent l'une l'autre)
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
    
    // DÃƒÂ©terminer le type de combat et ÃƒÂ©mettre l'animation appropriÃƒÂ©e
    if (mutualCombat) {
        const atk1 = attacks[0];
        const atk2 = attacks[1];
        enterPhase('hit_attacker', 'mutual');
        
        const bothShooters = atk1.isShooter && atk2.isShooter;
        const shooterVsFlyer = (atk1.isShooter && !atk2.isShooter) || (!atk1.isShooter && atk2.isShooter);
        
        const dmg1 = Math.max(0, atk1.attacker.atk);
        const dmg2 = Math.max(0, atk2.attacker.atk);

        if (shooterVsFlyer) {
            // Tireur vs non-tireur (volant ou mÃƒÂªlÃƒÂ©e)
            const shooter = atk1.isShooter ? atk1 : atk2;
            const other = atk1.isShooter ? atk2 : atk1;
            const shooterDmg = Math.max(0, shooter.attacker.atk);
            const otherDmg = Math.max(0, other.attacker.atk);

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

            // DÃƒÂ©gÃƒÂ¢ts simultanÃƒÂ©s
            const actualShooterDmg = applyCreatureDamage(other.attacker, shooterDmg, room, log, other.attackerPlayer, other.attackerRow, other.attackerCol, { player: shooter.attackerPlayer, row: shooter.attackerRow, col: shooter.attackerCol, uid: shooter.attacker.uid });
            const actualOtherDmg = applyCreatureDamage(shooter.attacker, otherDmg, room, log, shooter.attackerPlayer, shooter.attackerRow, shooter.attackerCol, { player: other.attackerPlayer, row: other.attackerRow, col: other.attackerCol, uid: other.attacker.uid });
            enterPhase('on_hit_attacker', 'mutual');
            enterPhase('riposte', 'mutual-simultaneous');
            enterPhase('on_hit_riposte', 'mutual-simultaneous');

            log(`Ã¢Å¡â€Ã¯Â¸Â ${shooter.attacker.name} Ã¢â€ â€ ${other.attacker.name} (-${actualShooterDmg} / -${actualOtherDmg})`, 'damage');

            if (actualOtherDmg > 0 && shooter.attacker.currentHp > 0 && shooter.attacker.abilities.includes('power')) {
                const powerBonus = shooter.attacker.powerX || 1;
                shooter.attacker.powerStacks = (shooter.attacker.powerStacks || 0) + powerBonus;
                log(`Ã°Å¸â€™Âª ${shooter.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
                emitPowerBuffAnim(room, shooter.attackerPlayer, shooter.attackerRow, shooter.attackerCol, powerBonus);
            }
            if (actualShooterDmg > 0 && other.attacker.currentHp > 0 && other.attacker.abilities.includes('power')) {
                const powerBonus = other.attacker.powerX || 1;
                other.attacker.powerStacks = (other.attacker.powerStacks || 0) + powerBonus;
                log(`Ã°Å¸â€™Âª ${other.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
                emitPowerBuffAnim(room, other.attackerPlayer, other.attackerRow, other.attackerCol, powerBonus);
            }
        } else if (bothShooters) {
            // Deux tireurs - projectiles croisÃƒÂ©s simultanÃƒÂ©s
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

            // DÃƒÂ©gÃƒÂ¢ts simultanÃƒÂ©s
            const actualD1bs = applyCreatureDamage(atk2.attacker, dmg1, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualD2bs = applyCreatureDamage(atk1.attacker, dmg2, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });
            enterPhase('on_hit_attacker', 'mutual');
            enterPhase('riposte', 'mutual-simultaneous');
            enterPhase('on_hit_riposte', 'mutual-simultaneous');

            log(`Ã¢Å¡â€Ã¯Â¸Â ${atk1.attacker.name} Ã¢â€ â€ ${atk2.attacker.name} (-${actualD1bs} / -${actualD2bs})`, 'damage');

            if (actualD2bs > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                const powerBonus = atk1.attacker.powerX || 1;
                atk1.attacker.powerStacks = (atk1.attacker.powerStacks || 0) + powerBonus;
                log(`Ã°Å¸â€™Âª ${atk1.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
                emitPowerBuffAnim(room, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, powerBonus);
            }
            if (actualD1bs > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                const powerBonus = atk2.attacker.powerX || 1;
                atk2.attacker.powerStacks = (atk2.attacker.powerStacks || 0) + powerBonus;
                log(`Ã°Å¸â€™Âª ${atk2.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
                emitPowerBuffAnim(room, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, powerBonus);
            }
        } else {
            // Combat mÃƒÂªlÃƒÂ©e mutuel - combat simultanÃƒÂ©
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
            await sleep(830);

            // DÃƒÂ©gÃƒÂ¢ts simultanÃƒÂ©s
            const actualD1mm = applyCreatureDamage(atk2.attacker, dmg1, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: atk1.attacker.uid });
            const actualD2mm = applyCreatureDamage(atk1.attacker, dmg2, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: atk2.attacker.uid });
            enterPhase('on_hit_attacker', 'mutual');
            enterPhase('riposte', 'mutual-simultaneous');
            enterPhase('on_hit_riposte', 'mutual-simultaneous');

            log(`Ã¢Å¡â€Ã¯Â¸Â ${atk1.attacker.name} Ã¢â€ â€ ${atk2.attacker.name} (-${actualD1mm} / -${actualD2mm})`, 'damage');

            // Power
            if (actualD2mm > 0 && atk1.attacker.currentHp > 0 && atk1.attacker.abilities.includes('power')) {
                const powerBonus = atk1.attacker.powerX || 1;
                atk1.attacker.powerStacks = (atk1.attacker.powerStacks || 0) + powerBonus;
                log(`Ã°Å¸â€™Âª ${atk1.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
                emitPowerBuffAnim(room, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, powerBonus);
            }
            if (actualD1mm > 0 && atk2.attacker.currentHp > 0 && atk2.attacker.abilities.includes('power')) {
                const powerBonus = atk2.attacker.powerX || 1;
                atk2.attacker.powerStacks = (atk2.attacker.powerStacks || 0) + powerBonus;
                log(`Ã°Å¸â€™Âª ${atk2.attacker.name} gagne +${powerBonus} ATK!`, 'buff');
                emitPowerBuffAnim(room, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, powerBonus);
            }
        }

        // Clivant en combat mutuel - seulement si la cible est un tireur
        if (atk2.isShooter) {
            applyCleaveV2(room, atk1.attacker, atk1, log);
        }
        if (atk1.isShooter) {
            applyCleaveV2(room, atk2.attacker, atk2, log);
        }

        // PiÃƒÂ©tinement en combat mutuel - seulement si la cible est un tireur
        if (atk2.isShooter) {
            await applyTrampleDamage(room, atk1, log, sleep);
        }
        if (atk1.isShooter) {
            await applyTrampleDamage(room, atk2, log, sleep);
        }

        // Le pipeline unique (power/life/endOfCombat/poison/morts/regen) est appliquÃƒÂ© en sortie.
    } else {
        // Pas de combat mutuel - traiter les attaques

        // CAS SPÃƒâ€°CIAL : 2 attaques qui peuvent se faire en parallÃƒÂ¨le
        let processedParallel = false;
        if (attacks.length === 2) {
            const atk1 = attacks[0];
            const atk2 = attacks[1];

            const attackerCard1 = room.gameState.players[atk1.attackerPlayer].field[atk1.attackerRow][atk1.attackerCol];
            const attackerCard2 = room.gameState.players[atk2.attackerPlayer].field[atk2.attackerRow][atk2.attackerCol];

                if (attackerCard1 && attackerCard1.currentHp > 0 && attackerCard2 && attackerCard2.currentHp > 0) {
                    const damage1 = Math.max(0, attackerCard1.atk);
                    const damage2 = Math.max(0, attackerCard2.atk);

                    enterPhase('hit_attacker', 'parallel');
                    // Ãƒâ€°mettre une animation parallÃƒÂ¨le
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
                    await sleep(800); // Attendre les animations parallÃƒÂ¨les

                    // Appliquer les dÃƒÂ©gÃƒÂ¢ts pour atk1
                    if (atk1.targetIsHero) {
                        const targetPlayer1 = room.gameState.players[atk1.targetPlayer];
                        targetPlayer1.hp -= damage1;
                        log(`Ã¢Å¡â€Ã¯Â¸Â ${attackerCard1.name} Ã¢â€ â€™ ${targetPlayer1.heroName} (-${damage1})`, 'damage');
                        emitAnimation(room, 'heroHit', { defender: atk1.targetPlayer, damage: damage1, skipVfx: true });
                        accumulateLifelink(attackerCard1, damage1);

                        // Collecter onHeroAttack (sera résolu avec les autres effets post-combat)
                        if (attackerCard1.onHeroAttack && attackerCard1.onHeroAttack.millFirstCreature) {
                            postCombatEffects.push({ type: 'millFirstCreature', player: atk1.attackerPlayer, source: `${attackerCard1.name} (onHeroAttack)` });
                        }

                        // Collecter onHeroHit (sera rÃƒÂ©solu avec les autres effets post-combat)
                        if (attackerCard1.onHeroHit === 'draw') {
                            postCombatEffects.push({ type: 'draw', player: atk1.attackerPlayer, count: 1, source: `${attackerCard1.name} (onHeroHit)` });
                        }
                    } else {
                        const targetCard1 = room.gameState.players[atk1.targetPlayer].field[atk1.targetRow][atk1.targetCol];
                        if (targetCard1) {
                            const actualDmg1p = applyCreatureDamage(targetCard1, damage1, room, log, atk1.targetPlayer, atk1.targetRow, atk1.targetCol, { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, uid: attackerCard1.uid });
                            if (actualDmg1p > 0) log(`Ã¢Å¡â€Ã¯Â¸Â ${attackerCard1.name} Ã¢â€ â€™ ${targetCard1.name} (-${actualDmg1p})`, 'damage');
                            if (actualDmg1p > 0 && targetCard1.currentHp > 0 && targetCard1.abilities.includes('power')) {
                                const powerBonus = targetCard1.powerX || 1;
                                targetCard1.powerStacks = (targetCard1.powerStacks || 0) + powerBonus;
                                log(`Ã°Å¸â€™Âª ${targetCard1.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                            if (!atk1.isShooter && targetCard1.atk > 0) {
                                const riposteDmg = targetCard1.atk;
                                const actualRip1 = applyCreatureDamage(attackerCard1, riposteDmg, room, log, atk1.attackerPlayer, atk1.attackerRow, atk1.attackerCol, { player: atk1.targetPlayer, row: atk1.targetRow, col: atk1.targetCol, uid: targetCard1.uid, isRiposte: true });
                                if (actualRip1 > 0) {
                                    log(`Ã¢â€ Â©Ã¯Â¸Â ${targetCard1.name} riposte Ã¢â€ â€™ ${attackerCard1.name} (-${actualRip1})`, 'damage');
                                    emitAnimation(room, 'damage', { player: atk1.attackerPlayer, row: atk1.attackerRow, col: atk1.attackerCol, amount: actualRip1 });
                                }
                                if (actualRip1 > 0 && attackerCard1.currentHp > 0 && attackerCard1.abilities.includes('power')) {
                                    const powerBonus = attackerCard1.powerX || 1;
                                    attackerCard1.powerStacks = (attackerCard1.powerStacks || 0) + powerBonus;
                                    log(`Ã°Å¸â€™Âª ${attackerCard1.name} gagne +${powerBonus} ATK!`, 'buff');
                                }
                            }
                            applyCleaveV2(room, attackerCard1, atk1, log);
                            await applyTrampleDamage(room, atk1, log, sleep);
                        }
                    }

                    // Appliquer les dÃƒÂ©gÃƒÂ¢ts pour atk2
                    if (atk2.targetIsHero) {
                        const targetPlayer2 = room.gameState.players[atk2.targetPlayer];
                        targetPlayer2.hp -= damage2;
                        log(`Ã¢Å¡â€Ã¯Â¸Â ${attackerCard2.name} Ã¢â€ â€™ ${targetPlayer2.heroName} (-${damage2})`, 'damage');
                        emitAnimation(room, 'heroHit', { defender: atk2.targetPlayer, damage: damage2, skipVfx: true });
                        accumulateLifelink(attackerCard2, damage2);

                        // Collecter onHeroAttack (sera résolu avec les autres effets post-combat)
                        if (attackerCard2.onHeroAttack && attackerCard2.onHeroAttack.millFirstCreature) {
                            postCombatEffects.push({ type: 'millFirstCreature', player: atk2.attackerPlayer, source: `${attackerCard2.name} (onHeroAttack)` });
                        }

                        // Collecter onHeroHit (sera rÃƒÂ©solu avec les autres effets post-combat)
                        if (attackerCard2.onHeroHit === 'draw') {
                            postCombatEffects.push({ type: 'draw', player: atk2.attackerPlayer, count: 1, source: `${attackerCard2.name} (onHeroHit)` });
                        }
                    } else {
                        const targetCard2 = room.gameState.players[atk2.targetPlayer].field[atk2.targetRow][atk2.targetCol];
                        if (targetCard2) {
                            const actualDmg2p = applyCreatureDamage(targetCard2, damage2, room, log, atk2.targetPlayer, atk2.targetRow, atk2.targetCol, { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, uid: attackerCard2.uid });
                            if (actualDmg2p > 0) log(`Ã¢Å¡â€Ã¯Â¸Â ${attackerCard2.name} Ã¢â€ â€™ ${targetCard2.name} (-${actualDmg2p})`, 'damage');
                            if (actualDmg2p > 0 && targetCard2.currentHp > 0 && targetCard2.abilities.includes('power')) {
                                const powerBonus = targetCard2.powerX || 1;
                                targetCard2.powerStacks = (targetCard2.powerStacks || 0) + powerBonus;
                                log(`Ã°Å¸â€™Âª ${targetCard2.name} gagne +${powerBonus} ATK!`, 'buff');
                            }
                            if (!atk2.isShooter && targetCard2.atk > 0) {
                                const riposteDmg = targetCard2.atk;
                                const actualRip2 = applyCreatureDamage(attackerCard2, riposteDmg, room, log, atk2.attackerPlayer, atk2.attackerRow, atk2.attackerCol, { player: atk2.targetPlayer, row: atk2.targetRow, col: atk2.targetCol, uid: targetCard2.uid, isRiposte: true });
                                if (actualRip2 > 0) {
                                    log(`Ã¢â€ Â©Ã¯Â¸Â ${targetCard2.name} riposte Ã¢â€ â€™ ${attackerCard2.name} (-${actualRip2})`, 'damage');
                                    emitAnimation(room, 'damage', { player: atk2.attackerPlayer, row: atk2.attackerRow, col: atk2.attackerCol, amount: actualRip2 });
                                }
                                if (actualRip2 > 0 && attackerCard2.currentHp > 0 && attackerCard2.abilities.includes('power')) {
                                    const powerBonus = attackerCard2.powerX || 1;
                                    attackerCard2.powerStacks = (attackerCard2.powerStacks || 0) + powerBonus;
                                    log(`Ã°Å¸â€™Âª ${attackerCard2.name} gagne +${powerBonus} ATK!`, 'buff');
                                }
                            }
                            applyCleaveV2(room, attackerCard2, atk2, log);
                            await applyTrampleDamage(room, atk2, log, sleep);
                        }
                    }

                    enterPhase('on_hit_attacker', 'parallel');
                    enterPhase('riposte', 'parallel-conditional');
                    enterPhase('on_hit_riposte', 'parallel-conditional');

                    // VÃƒÂ©rifier victoire hÃƒÂ©ros avant la suite de la pipeline.
                    if (room.gameState.players[1].hp <= 0 || room.gameState.players[2].hp <= 0) {
                        emitStateToBoth(room);
                        return true;
                    }
                    processedParallel = true;
                }
        }

        // Traitement sÃƒÂ©quentiel standard (1 attaque)
        if (!processedParallel) for (const atk of attacks) {
            // VÃƒÂ©rifier si l'attaquant est encore en vie
            const attackerCard = room.gameState.players[atk.attackerPlayer].field[atk.attackerRow][atk.attackerCol];
            if (!attackerCard || attackerCard.currentHp <= 0) continue;
            if (atk.targetIsHero) {
                enterPhase('hit_attacker', 'hero');
                // Attaque le hÃƒÂ©ros
                const targetPlayer = room.gameState.players[atk.targetPlayer];

                // Boost ATK avant l'attaque si cible = hÃƒÂ©ros (Salamandre de braise)
                if (attackerCard.onHeroAttack && attackerCard.onHeroAttack.atkBoost) {
                    const boost = attackerCard.onHeroAttack.atkBoost;
                    attackerCard.atk += boost;
                    attackerCard.tempAtkBoost = (attackerCard.tempAtkBoost || 0) + boost;
                    log(`Ã°Å¸â€Â¥ ${attackerCard.name} gagne +${boost} ATK!`, 'buff');
                    emitAnimation(room, 'atkBoost', {
                        player: atk.attackerPlayer,
                        row: atk.attackerRow,
                        col: atk.attackerCol,
                        boost: boost
                    });
                    emitStateToBoth(room);
                    await sleep(800);
                }

                // Collecter onHeroAttack (sera résolu avec les autres effets post-combat)
                if (attackerCard.onHeroAttack && attackerCard.onHeroAttack.millFirstCreature) {
                    postCombatEffects.push({ type: 'millFirstCreature', player: atk.attackerPlayer, source: `${attackerCard.name} (onHeroAttack)` });
                }

                const damage = Math.max(0, attackerCard.atk);

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
                log(`Ã¢Å¡â€Ã¯Â¸Â ${attackerCard.name} Ã¢â€ â€™ ${targetPlayer.heroName} (-${damage})`, 'damage');
                emitAnimation(room, 'heroHit', { defender: atk.targetPlayer, damage: damage, skipVfx: true });
                accumulateLifelink(attackerCard, damage);
                enterPhase('on_hit_attacker', 'hero');

                // Collecter onHeroHit (sera rÃƒÂ©solu avec les autres effets post-combat)
                if (attackerCard.onHeroHit === 'draw') {
                    postCombatEffects.push({ type: 'draw', player: atk.attackerPlayer, count: 1, source: `${attackerCard.name} (onHeroHit)` });
                }

                if (targetPlayer.hp <= 0) {
                    emitStateToBoth(room);
                    return true;
                }
            } else {
                // Attaque une crÃƒÂ©ature
                enterPhase('hit_attacker', 'creature');
                const targetCard = room.gameState.players[atk.targetPlayer].field[atk.targetRow][atk.targetCol];
                if (!targetCard || targetCard.currentHp <= 0) continue;

                const damage = Math.max(0, attackerCard.atk);

                // PrÃƒÂ©-calculer la riposte pour l'intÃƒÂ©grer dans l'animation
                const hasRiposte = !atk.isShooter && targetCard.atk > 0;
                const ripostePreview = hasRiposte ? getEffectiveCombatDamage(attackerCard, targetCard.atk) : undefined;

                // Animation d'attaque avec dÃƒÂ©gÃƒÂ¢ts + riposte intÃƒÂ©grÃƒÂ©s
                emitAnimation(room, 'attack', {
                    combatType: atk.isShooter ? 'shooter' : 'solo',
                    attacker: atk.attackerPlayer,
                    row: atk.attackerRow,
                    col: atk.attackerCol,
                    targetPlayer: atk.targetPlayer,
                    targetRow: atk.targetRow,
                    targetCol: atk.targetCol,
                    damage: getEffectiveCombatDamage(targetCard, damage),
                    riposteDamage: ripostePreview,
                    isFlying: atk.isFlying,
                    isShooter: atk.isShooter
                });
                await sleep(hasRiposte ? 2100 : 1250); // DurÃƒÂ©e rÃƒÂ©elle : solo 1200ms, riposte 2050ms

                const actualSeqDmg = applyCreatureDamage(targetCard, damage, room, log, atk.targetPlayer, atk.targetRow, atk.targetCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: attackerCard.uid });
                enterPhase('on_hit_attacker', 'creature');
                if (actualSeqDmg > 0) {
                    log(`Ã¢Å¡â€Ã¯Â¸Â ${attackerCard.name} Ã¢â€ â€™ ${targetCard.name} (-${actualSeqDmg})`, 'damage');
                }

                // Power pour la cible
                if (actualSeqDmg > 0 && targetCard.currentHp > 0 && targetCard.abilities.includes('power')) {
                    const powerBonus = targetCard.powerX || 1;
                    targetCard.powerStacks = (targetCard.powerStacks || 0) + powerBonus;
                    log(`Ã°Å¸â€™Âª ${targetCard.name} gagne +${powerBonus} ATK!`, 'buff');
                    emitPowerBuffAnim(room, atk.targetPlayer, atk.targetRow, atk.targetCol, powerBonus);
                }

                // RIPOSTE - toutes les crÃƒÂ©atures ripostent sauf si l'attaquant est un tireur ou la cible n'a pas d'ATK
                if (!atk.isShooter && targetCard.atk > 0) {
                    enterPhase('riposte');
                    const riposteDmg = targetCard.atk;
                    const actualSeqRip = applyCreatureDamage(attackerCard, riposteDmg, room, log, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, { player: atk.targetPlayer, row: atk.targetRow, col: atk.targetCol, uid: targetCard.uid, isRiposte: true });
                    enterPhase('on_hit_riposte');
                    if (actualSeqRip > 0) {
                        log(`Ã¢â€ Â©Ã¯Â¸Â ${targetCard.name} riposte Ã¢â€ â€™ ${attackerCard.name} (-${actualSeqRip})`, 'damage');
                    }

                    if (actualSeqRip > 0 && attackerCard.currentHp > 0 && attackerCard.abilities.includes('power')) {
                        const powerBonus = attackerCard.powerX || 1;
                        attackerCard.powerStacks = (attackerCard.powerStacks || 0) + powerBonus;
                        log(`Ã°Å¸â€™Âª ${attackerCard.name} gagne +${powerBonus} ATK!`, 'buff');
                        emitPowerBuffAnim(room, atk.attackerPlayer, atk.attackerRow, atk.attackerCol, powerBonus);
                    }
                }

                // Clivant (attaque unilatÃƒÂ©rale)
                applyCleaveV2(room, attackerCard, atk, log);
                // PiÃƒÂ©tinement (attaque unilatÃƒÂ©rale)
                await applyTrampleDamage(room, atk, log, sleep);
            }
        }
    }

    // PIPELINE UNIQUE DU SLOT (ordre canonique)
    // return_to_slot
    // -> death pass #1 (detect + grave/triggers/healOnDeath)
    // -> power #1 -> life abilities -> endOfCombat -> postEndOfCombat
    // -> poison tick
    // -> death pass #2 (detect + grave/triggers/healOnDeath)
    // -> regeneration -> power #2
    enterPhase('return_to_slot');

    enterPhase('death_detect_pre');
    enterPhase('grave_animations_pre');
    const firstDeathsEnded = await resolveCombatDeathsAndPostEffects(room, postCombatEffects, log, sleep, checkVictory, {
        includePostCombatEffects: true,
        includePoisonDeathEffects: false,
        cycleId: combatCycleId
    });
    if (firstDeathsEnded) return true;

    enterPhase('power_primary');
    applyPendingPowerBonuses(room, log);
    recalcDynamicAtk(room);
    emitStateToBoth(room);

    enterPhase('life_abilities');
    await applyPendingLifelinkHeals(room, log);

    enterPhase('end_of_combat');
    const endOfCombatEnded = await processEndOfCombatForSlot(room, row, col, log, sleep, checkVictory);
    if (endOfCombatEnded) return true;

    // postEndOfCombat: les effets endOfCombat sont resolus dans resolveEndOfCombatForCard
    // (self-sacrifice, absorptions, spawns, etc.) avant le tick poison.
    enterPhase('post_end_of_combat');

    enterPhase('poison_tick');
    const poisonResult = await applySlotPoisonDamage(room, row, col, attackedSlots, log, sleep, checkVictory);
    if (poisonResult.gameEnded) return true;

    enterPhase('death_detect_post');
    enterPhase('grave_animations_post');
    const secondDeathsEnded = await resolveCombatDeathsAndPostEffects(room, [], log, sleep, checkVictory, {
        includePostCombatEffects: false,
        includePoisonDeathEffects: true,
        cycleId: combatCycleId
    });
    if (secondDeathsEnded) return true;

    enterPhase('regeneration');
    await applySlotRegeneration(room, row, col, log, sleep);
    if (checkVictory() !== null) return true;

    enterPhase('power_secondary');
    const poisonPowerEnded = await applyPoisonPowerBonuses(room, poisonResult.poisonPowerCandidates, log, sleep, checkVictory);
    if (poisonPowerEnded) return true;

    // Nettoyage des marqueurs temporaires de poison sur les survivants.
    for (let p = 1; p <= 2; p++) {
        const card = room.gameState.players[p].field[row][col];
        if (card) delete card._killedByPoisonTick;
    }

    return checkVictory() !== null;
}

// RÃƒÂ©solution endOfCombat d'une crÃƒÂ©ature unique.
// Retourne true si au moins un effet a ÃƒÂ©tÃƒÂ© rÃƒÂ©solu.
async function resolveEndOfCombatForCard(room, card, playerNum, row, col, log, sleep) {
    if (!card || card.currentHp <= 0 || !card.endOfCombat || !card._attackedThisCombat) return false;
    if (card._endOfCombatResolved) return false;

    const player = room.gameState.players[playerNum];
    if (player.field[row][col] !== card) return false;

    card._endOfCombatResolved = true;
    const isStillInSlot = () => player.field[row][col] === card;
    let resolvedAny = false;

    // selfSacrifice (PossÃƒÂ©dÃƒÂ© ÃƒÂ©phÃƒÂ©mÃƒÂ¨re)
    if (false && card.endOfCombat.selfSacrifice) {
        resolvedAny = true;
        log(`[EOC-SAC-DBG] selfSacrifice:start card=${card.name} uid=${card.uid || '-'} p=${playerNum} row=${row} col=${col} hp=${card.currentHp}/${card.hp}`, 'action');
        log(`  Ã°Å¸â€™â‚¬ ${card.name} se sacrifie! (fin de combat)`, 'damage');
        const result = handleCreatureDeath(room, card, playerNum, row, col, log);
        if (result.transformed) {
            emitAnimation(room, 'sacrifice', { player: playerNum, row, col, card, noFlyToGrave: true });
            emitAnimation(room, 'deathTransform', { player: playerNum, row, col, fromCard: card, toCard: result.newCard });
            log(`[EOC-SAC-DBG] selfSacrifice:transform card=${card.name} uid=${card.uid || '-'} to=${result.newCard?.name || '-'}`, 'action');
        } else {
            emitAnimation(room, 'sacrifice', { player: playerNum, row, col, card });
            log(`[EOC-SAC-DBG] selfSacrifice:death card=${card.name} uid=${card.uid || '-'} emitted=sacrifice`, 'action');
            // RÃƒÂ©soudre les effets onDeath du sacrifiÃƒÂ©
            const onDeathEffects = collectOnDeathEffects([{ card, player: playerNum, row, col }]);
            if (onDeathEffects.length > 0) {
                await resolvePostCombatEffects(room, onDeathEffects, log, sleep);
            }
        }
        emitStateToBoth(room);
        await sleep(800);
    }

    // absorbAdjacent (Nourrisseur de chair)
    if (card.endOfCombat.absorbAdjacent && card.currentHp > 0 && isStillInSlot()) {
        // Chercher une crÃƒÂ©ature alliÃƒÂ©e adjacente ÃƒÂ  dÃƒÂ©vorer
        const neighbors = [[row - 1, col], [row + 1, col], [row, col === 0 ? 1 : 0]];
        let victim = null;
        let victimRow, victimCol;
        for (const [nr, nc] of neighbors) {
            if (nr < 0 || nr >= 4 || nc < 0 || nc >= 2) continue;
            const neighbor = player.field[nr][nc];
            if (neighbor && neighbor.currentHp > 0 && neighbor.uid !== card.uid && !neighbor.isBuilding) {
                victim = neighbor;
                victimRow = nr;
                victimCol = nc;
                break;
            }
        }
        if (victim) {
            resolvedAny = true;
            const rawAtkGain = victim.baseAtk || victim.atk || 0;
            const rawHpGain = victim.baseHp || victim.hp || 0;
            const atkGain = Number.isFinite(Number(rawAtkGain)) ? Number(rawAtkGain) : 0;
            const hpGain = Number.isFinite(Number(rawHpGain)) ? Number(rawHpGain) : 0;
            let victimDeathPayload = null;
            // Sacrifier la victime (slash + envoi au cimetiÃƒÂ¨re)
            log(`  Ã°Å¸â€™â‚¬ ${card.name} dÃƒÂ©vore ${victim.name}! (fin de combat)`, 'damage');
            const result = handleCreatureDeath(room, victim, playerNum, victimRow, victimCol, log);
            if (result.transformed) {
                emitAnimation(room, 'sacrifice', { player: playerNum, row: victimRow, col: victimCol, card: victim, noFlyToGrave: true });
                emitAnimation(room, 'deathTransform', { player: playerNum, row: victimRow, col: victimCol, fromCard: victim, toCard: result.newCard });
            } else {
                emitAnimation(room, 'sacrifice', { player: playerNum, row: victimRow, col: victimCol, card: victim });
                victimDeathPayload = { card: victim, player: playerNum, row: victimRow, col: victimCol };
            }
            emitStateToBoth(room);
            await sleep(800);
            await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
            if (victimDeathPayload) {
                const onDeathEffects = collectOnDeathEffects([victimDeathPayload]);
                if (onDeathEffects.length > 0) {
                    await resolvePostCombatEffects(room, onDeathEffects, log, sleep);
                }
                await applyPendingHealOnDeath(room, log);
            }
            // Absorber les stats de base
            if (atkGain > 0 || hpGain > 0) {
                const preAtk = card.atk;
                const preHp = card.hp;
                const preCurrentHp = card.currentHp;
                card.sacrificeAtkStacks = (card.sacrificeAtkStacks || 0) + atkGain;
                card.atk += atkGain;
                card.hp += hpGain;
                card.currentHp += hpGain;
                const postAtk = card.atk;
                const postHp = card.hp;
                const postCurrentHp = card.currentHp;
                const invalidPre =
                    !Number.isFinite(Number(preAtk)) ||
                    !Number.isFinite(Number(preHp)) ||
                    !Number.isFinite(Number(preCurrentHp));
                const invalidPost =
                    !Number.isFinite(Number(postAtk)) ||
                    !Number.isFinite(Number(postHp)) ||
                    !Number.isFinite(Number(postCurrentHp));
                log(
                    `[ABSORB-DBG] source=endOfCombat.absorbAdjacent absorber=${card.name} absorberUid=${card.uid || '-'} victim=${victim.name} victimUid=${victim.uid || '-'} rawGain=${rawAtkGain}/${rawHpGain} gain=${atkGain}/${hpGain} pre=${preAtk}/${preCurrentHp} max=${preHp} post=${postAtk}/${postCurrentHp} max=${postHp} invalidPre=${invalidPre} invalidPost=${invalidPost}`,
                    invalidPre || invalidPost ? 'error' : 'buff'
                );
                log(`  Ã°Å¸ÂªÂ± ${card.name} absorbe +${atkGain}/+${hpGain} de ${victim.name} Ã¢â€ â€™ ${card.atk}/${card.currentHp}`, 'buff');
                emitAnimation(room, 'buffApply', {
                    player: playerNum,
                    row,
                    col,
                    atkBuff: atkGain,
                    hpBuff: hpGain,
                    source: 'endOfCombat.absorbAdjacent',
                    absorberName: card.name,
                    absorberUid: card.uid || null,
                    victimName: victim.name,
                    victimUid: victim.uid || null,
                    rawAtkGain,
                    rawHpGain
                });
            }
            // Absorber les capacitÃƒÂ©s communes de la victime
            const victimAbilities = victim.abilities || [];
            const xProps = { poisonX: 'poison', cleaveX: 'cleave', lifelinkX: 'lifelink', powerX: 'power', bloodthirstAmount: 'bloodthirst', spellBoostAmount: 'spellBoost', enhanceAmount: 'enhance', regenerationX: 'regeneration', lifedrainX: 'lifedrain', entraveX: 'entrave' };
            const absorbedNames = [];
            if (!card.addedAbilities) card.addedAbilities = [];
            const abilitiesBeforeAbsorb = new Set(card.abilities);
            for (const ability of victimAbilities) {
                if (!card.abilities.includes(ability)) {
                    card.abilities.push(ability);
                    if (!card.addedAbilities.includes(ability)) {
                        card.addedAbilities.push(ability);
                    }
                    absorbedNames.push(ability);
                }
            }
            // Additionner les valeurs X (poison, cleave, lifelink, power, bloodthirst, etc.)
            for (const [xProp, abilityName] of Object.entries(xProps)) {
                if (victim[xProp]) {
                    const victimVal = victim[xProp];
                    if (abilitiesBeforeAbsorb.has(abilityName)) {
                        // Le nourrisseur avait dÃƒÂ©jÃƒÂ  l'ability avant absorption, additionner
                        const currentVal = card[xProp] || 1;
                        card[xProp] = currentVal + victimVal;
                    } else {
                        card[xProp] = victimVal;
                    }
                }
            }
            if (absorbedNames.length > 0) {
                log(`  Ã°Å¸ÂªÂ± ${card.name} absorbe les capacitÃƒÂ©s: ${absorbedNames.join(', ')}`, 'buff');
            }
            recalcDynamicAtk(room);
            emitStateToBoth(room);
            await sleep(600);
        }
    }

    // spawnAdjacentMelee (DÃƒÂ©mon SuprÃƒÂªme)
    if (card.endOfCombat.spawnAdjacentMelee && card.currentHp > 0 && isStillInSlot() && !card._spawnAdjMeleeDone) {
        const spawned = await resolveSpawnAdjacentMeleeEndOfCombat(room, card, playerNum, row, col, log, sleep);
        resolvedAny = resolvedAny || spawned;
    }

    // damageAllEnemies (Banshee sauvage) : inflige X degats a toutes les creatures ennemies
    if (card.endOfCombat.damageAllEnemies && card.currentHp > 0 && isStillInSlot()) {
        const damageAmountRaw = Number(card.endOfCombat.damageAllEnemies);
        const damageAmount = Number.isFinite(damageAmountRaw) ? Math.max(0, Math.floor(damageAmountRaw)) : 0;
        if (damageAmount > 0) {
            const enemyNum = playerNum === 1 ? 2 : 1;
            const enemyField = room.gameState.players[enemyNum].field;
            const damageAnims = [];
            let hitCount = 0;

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const target = enemyField[r][c];
                    if (!target || target.currentHp <= 0) continue;
                    const actualDmg = applyCreatureDamage(target, damageAmount, room, log, enemyNum, r, c);
                    if (actualDmg > 0) {
                        hitCount++;
                        damageAnims.push({ type: 'damage', player: enemyNum, row: r, col: c, amount: actualDmg });
                        log(`⚔️ ${card.name} inflige ${actualDmg} degat a ${target.name} (fin de combat)`, 'damage');
                    }
                }
            }

            resolvedAny = true;
            if (damageAnims.length > 0) {
                emitAnimationBatch(room, damageAnims);
                emitStateToBoth(room);
                await sleep(900);
            } else {
                emitStateToBoth(room);
            }
            if (hitCount === 0) {
                log(`ℹ️ ${card.name} n'a touche aucune creature ennemie (fin de combat)`, 'info');
            }
        }
    }

    // selfMill (Chevaucheur de l'ombre) : met X cartes du dessus du deck au cimetiÃƒÂ¨re
    if (card.endOfCombat.selfMill && card.currentHp > 0 && isStillInSlot()) {
        const millCount = card.endOfCombat.selfMill;
        const milledCards = [];
        for (let i = 0; i < millCount; i++) {
            if (player.deck.length === 0) break;
            const milled = player.deck.shift();
            addToGraveyard(player, milled);
            milledCards.push(milled);
        }
        if (milledCards.length > 0) {
            resolvedAny = true;
            for (const mc of milledCards) {
                log(`  Ã°Å¸ÂªÂ¦ ${card.name} Ã¢â€ â€™ ${mc.name} va au cimetiÃƒÂ¨re`, 'action');
                emitAnimation(room, 'burn', { player: playerNum, card: mc });
                await sleep(20);
                emitStateToBoth(room);
                await sleep(800);
            }
            const milledCreatures = milledCards.filter(mc => mc.type === 'creature').length;
            if (milledCreatures > 0) await syncMillWatchers(room, playerNum, milledCreatures, log, sleep);
            recalcDynamicAtk(room);
            emitStateToBoth(room);
        }
    }


    // selfSacrifice must resolve last, after other endOfCombat effects.
    if (card.endOfCombat.selfSacrifice && card.currentHp > 0 && isStillInSlot()) {
        resolvedAny = true;
        log(`[EOC-SAC-DBG] selfSacrifice:start card=${card.name} uid=${card.uid || '-'} p=${playerNum} row=${row} col=${col} hp=${card.currentHp}/${card.hp}`, 'action');
        log(`  [EOC] ${card.name} self-sacrifices at end of combat`, 'damage');
        const result = handleCreatureDeath(room, card, playerNum, row, col, log);
        let selfSacrificeDeathPayload = null;
        if (result.transformed) {
            emitAnimation(room, 'sacrifice', { player: playerNum, row, col, card, noFlyToGrave: true });
            emitAnimation(room, 'deathTransform', { player: playerNum, row, col, fromCard: card, toCard: result.newCard });
            log(`[EOC-SAC-DBG] selfSacrifice:transform card=${card.name} uid=${card.uid || '-'} to=${result.newCard?.name || '-'}`, 'action');
        } else {
            emitAnimation(room, 'sacrifice', { player: playerNum, row, col, card });
            log(`[EOC-SAC-DBG] selfSacrifice:death card=${card.name} uid=${card.uid || '-'} emitted=sacrifice`, 'action');
            selfSacrificeDeathPayload = { card, player: playerNum, row, col };
        }
        emitStateToBoth(room);
        await sleep(800);
        await resolveImmediateWhenTriggersAfterDeaths(room, log, sleep);
        if (selfSacrificeDeathPayload) {
            const onDeathEffects = collectOnDeathEffects([selfSacrificeDeathPayload]);
            if (onDeathEffects.length > 0) {
                await resolvePostCombatEffects(room, onDeathEffects, log, sleep);
            }
            await applyPendingHealOnDeath(room, log);
        }
    }

    return resolvedAny;
}

// endOfCombat immÃƒÂ©diat (post-slot) pour que les effets d'une crÃƒÂ©ature
// soient rÃƒÂ©solus avant le prochain combat de crÃƒÂ©ature.
async function resolveSpawnAdjacentMeleeEndOfCombat(room, card, playerNum, row, col, log, sleep) {
    const player = room.gameState.players[playerNum];
    const spawnId = card.endOfCombat?.spawnAdjacentMelee;
    if (!spawnId) return false;

    const template = CardByIdMap.get(spawnId);
    if (!template) return false;

    const candidates = [
        [row - 1, col],           // haut
        [row + 1, col],           // bas
        [row, col === 0 ? 1 : 0], // mÃƒÂªme ligne, autre colonne
    ].filter(([r, c]) => {
        if (r < 0 || r >= 4) return false;
        if (c !== 1) return false; // uniquement cases mÃƒÂªlÃƒÂ©e
        return !player.field[r][c];
    });

    // Marquer comme traitÃƒÂ© mÃƒÂªme sans case libre (ÃƒÂ©vite les doubles tentatives dans la mÃƒÂªme ligne)
    card._spawnAdjMeleeDone = true;
    if (candidates.length === 0) return false;

    const [spawnRow, spawnCol] = candidates[0];
    const spawned = {
        ...template,
        abilities: [...(template.abilities || [])],
        uid: `${Date.now()}-spawnAdjMelee-${Math.random()}`,
        currentHp: template.hp,
        baseAtk: template.atk,
        baseHp: template.hp,
        canAttack: false,
        turnsOnField: 0,
        movedThisTurn: false
    };
    if (spawned.abilities.includes('protection')) spawned.hasProtection = true;
    if (spawned.abilities.includes('camouflage')) spawned.hasCamouflage = true;
    if (spawned.abilities.includes('untargetable')) spawned.hasUntargetable = true;
    spawned.summonOrder = ++room.gameState.summonCounter;
    player.field[spawnRow][spawnCol] = spawned;
    log(`  Ã°Å¸ËœË† ${card.name} invoque ${spawned.name} en (${spawnRow},${spawnCol})!`, 'special');
    emitAnimation(room, 'trapSummon', { player: playerNum, row: spawnRow, col: spawnCol, card: spawned });
    recalcDynamicAtk(room);
    emitStateToBoth(room);
    await sleep(800);
    return true;
}

// Helper pour appliquer les dÃƒÂ©gÃƒÂ¢ts de clivant (cleave)
function applyCleaveV2(room, attackerCard, atk, log) {
    if (!attackerCard.abilities.includes('cleave')) return;

    const targetOwner = room.gameState.players[atk.targetPlayer];
    const adjacentRows = [atk.targetRow - 1, atk.targetRow + 1].filter(r => r >= 0 && r < 4);
    const cleaveDamage = attackerCard.cleaveX || Math.max(0, attackerCard.atk);

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
                log(`Ã¢â€ºÂÃ¯Â¸Â Clivant: ${attackerCard.name} Ã¢â€ â€™ ${adjTarget.name} (-${actualCDmg})`, 'damage');
                emitAnimation(room, 'damage', { player: atk.targetPlayer, row: adjRow, col: atk.targetCol, amount: actualCDmg });
            }

            if (actualCDmg > 0 && adjTarget.currentHp > 0 && adjTarget.abilities.includes('power')) {
                adjTarget.pendingPowerBonus = (adjTarget.pendingPowerBonus || 0) + (adjTarget.powerX || 1);
            }
        }
    }
}

// Helper pour appliquer les dÃƒÂ©gÃƒÂ¢ts de piÃƒÂ©tinement
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

    // Un volant ne peut pas toucher une crÃƒÂ©ature normale avec le piÃƒÂ©tinement
    // Il ne peut toucher que les volants/tireurs, sinon ÃƒÂ§a va au hÃƒÂ©ros
    if (trampleTarget && attackerIsFlying && !attackerIsShooter) {
        const trampleTargetIsFlying = trampleTarget.abilities.includes('fly');
        const trampleTargetIsShooter = trampleTarget.abilities.includes('shooter');
        if (!trampleTargetIsFlying && !trampleTargetIsShooter) {
            trampleTarget = null; // Le volant passe au-dessus, dÃƒÂ©gÃƒÂ¢ts au hÃƒÂ©ros
        }
    }

    // Le piÃƒÂ©tinement touche la crÃƒÂ©ature derriÃƒÂ¨re quelle que soit son type (y compris volante)
    
    if (trampleTarget) {
        const hpBefore = trampleTarget.currentHp;
        const actualTrDmg = applyCreatureDamage(trampleTarget, excessDamage, room, log, atk.targetPlayer, atk.targetRow, trampleCol, { player: atk.attackerPlayer, row: atk.attackerRow, col: atk.attackerCol, uid: atk.attacker.uid });
        if (actualTrDmg > 0) {
            log(`Ã°Å¸Â¦Â PiÃƒÂ©tinement: ${atk.attacker.name} Ã¢â€ â€™ ${trampleTarget.name} (-${actualTrDmg})`, 'damage');
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
        log(`Ã°Å¸Â¦Â PiÃƒÂ©tinement: ${atk.attacker.name} Ã¢â€ â€™ ${targetOwner.heroName} (-${excessDamage})`, 'damage');
        emitAnimation(room, 'trampleHeroHit', {
            defender: atk.targetPlayer, damage: excessDamage,
            attackerName: atk.attacker.name, heroName: targetOwner.heroName
        });
        accumulateLifelink(atk.attacker, excessDamage);
        await sleep(800);
    }
}

// Trouver la cible d'une crÃƒÂ©ature
function findTarget(attacker, enemyFront, enemyBack, enemyPlayer, row, attackerCol = 1) {
    const isFlying = attacker.abilities.includes('fly');
    const isShooter = attacker.abilities.includes('shooter');
    const isIntangible = attacker.abilities.includes('intangible');

    // CAS 0: CrÃƒÂ©ature INTANGIBLE - attaque toujours le hÃƒÂ©ros directement
    if (isIntangible) {
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }

    // Ignorer les crÃƒÂ©atures intangibles, pÃƒÂ©trifiÃƒÂ©es et camouflÃƒÂ©es lors de la recherche de cibles
    const frontIsIntangible = enemyFront && enemyFront.abilities?.includes('intangible');
    const backIsIntangible = enemyBack && enemyBack.abilities?.includes('intangible');
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

    // VÃƒÂ©rifier si les crÃƒÂ©atures ennemies peuvent attaquer (pour l'interception)
    const frontCanAttack = effectiveFront && canCreatureAttack(effectiveFront);
    const backCanAttack = effectiveBack && canCreatureAttack(effectiveBack);

    // CAS 1: CrÃƒÂ©ature VOLANTE
    // L'interception symÃƒÂ©trique (A1Ã¢â€ â€A2, B1Ã¢â€ â€B2) ne se produit qu'entre VOLANTS qui peuvent tous deux attaquer
    // Les tireurs ne "volent" pas vers l'ennemi, donc pas d'interception avec eux
    // Mais le volant peut quand mÃƒÂªme attaquer un tireur (premiÃƒÂ¨re cible valide)
    if (isFlying) {
        // D'abord vÃƒÂ©rifier l'interception symÃƒÂ©trique (mÃƒÂªme colonne) - UNIQUEMENT avec d'autres VOLANTS
        if (attackerCol === 0) {
            // Volant en back (col 0) -> vÃƒÂ©rifie back ennemi pour interception (seulement si volant)
            if (effectiveBack && backIsFlying && backCanAttack) {
                return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
            }
        } else {
            // Volant en front (col 1) -> vÃƒÂ©rifie front ennemi pour interception (seulement si volant)
            if (effectiveFront && frontIsFlying && frontCanAttack) {
                return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
            }
        }

        // Pas d'interception symÃƒÂ©trique -> attaque la premiÃƒÂ¨re cible valide (volant OU tireur)
        // Front d'abord (col 1), puis back (col 0)
        if (effectiveFront && (frontIsFlying || frontIsShooter)) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (effectiveBack && (backIsFlying || backIsShooter)) {
            return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }

        // Sinon attaque le hÃƒÂ©ros (passe au-dessus des normales)
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }
    
    // CAS 2: CrÃƒÂ©ature TIREUR
    // Peut attaquer n'importe quelle crÃƒÂ©ature y compris volante
    if (isShooter) {
        if (effectiveFront) {
            return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
        }
        if (effectiveBack) {
            return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
        }
        return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
    }
    
    // CAS 3: CrÃƒÂ©ature NORMALE
    // - N'est PAS bloquÃƒÂ©e par les crÃƒÂ©atures volantes
    // - Attaque front (col 1) s'il n'est pas volant
    // - Sinon attaque back (col 0) s'il n'est pas volant
    // - Sinon attaque le hÃƒÂ©ros (passe ÃƒÂ  travers les volantes)
    
    // Front non-volant existe -> attaque front
    if (effectiveFront && !frontIsFlying) {
        return { card: effectiveFront, col: 1, row: row, player: enemyPlayer, isHero: false };
    }
    // Back non-volant existe -> attaque back
    if (effectiveBack && !backIsFlying) {
        return { card: effectiveBack, col: 0, row: row, player: enemyPlayer, isHero: false };
    }
    
    // Que des volants ou rien -> attaque hÃƒÂ©ros
    return { card: null, col: -1, row: row, player: enemyPlayer, isHero: true };
}

function startNewTurn(room) {
    flushQueuedState(room);
    room._lastStatePayloadByPlayer = null;
    const previousTurn = room.gameState.turn;
    perfFinalizeTurn(room, previousTurn, 'next_turn');
    room.gameState.turn++;
    perfMarkTurnStart(room, room.gameState.turn);
    room.gameState.phase = 'planning';
    room.gameState.timeLeft = TURN_TIME;
    
    for (let p = 1; p <= 2; p++) {
        const player = room.gameState.players[p];
        player.maxEnergy = Math.min(10, player.maxEnergy + 1);
        player.energy = player.maxEnergy;

        // VÃƒÂ©rifier si le joueur a une crÃƒÂ©ature avec manaCap sur le terrain
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
    
    // Recalculer l'ATK dynamique
    recalcDynamicAtk(room);

    // Calculer les effets de MÃƒÂ©lodie pour le planning (bloque les crÃƒÂ©atures en face)
    processMelodyEffects(room);

    // Envoyer l'ÃƒÂ©tat AVANT newTurn pour que le client ait les donnÃƒÂ©es ÃƒÂ  jour
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

function getProvocationPrioritySlots(room, playerNum, card) {
    if (!card || card.type !== 'creature') return [];
    if (card.isBuilding) return [];
    if (card.abilities?.includes('fly')) return [];

    const player = room.gameState.players[playerNum];
    const oppNum = playerNum === 1 ? 2 : 1;
    const opponent = room.gameState.players[oppNum];
    if (!player || !opponent) return [];

    const preferredCol = card.abilities?.includes('shooter') ? 0 : 1;
    const forced = [];
    for (let row = 0; row < 4; row++) {
        const oppFront = opponent.field[row][1];
        const oppBack = opponent.field[row][0];
        const hasProvocation =
            !!(oppFront && oppFront.currentHp > 0 && oppFront.abilities?.includes('provocation')) ||
            !!(oppBack && oppBack.currentHp > 0 && oppBack.abilities?.includes('provocation'));
        if (!hasProvocation) continue;
        if (!player.field[row][preferredCol]) forced.push({ row, col: preferredCol });
    }
    return forced;
}

function respectsProvocationPriority(room, playerNum, card, row, col) {
    const forced = getProvocationPrioritySlots(room, playerNum, card);
    if (forced.length === 0) return true;
    return forced.some(s => s.row === row && s.col === col);
}

// ==================== SOCKET HANDLERS ====================
io.on('connection', (socket) => {
    socket.on('createRoom', (callback) => {
        const code = generateRoomCode();
        const room = { code, players: { 1: socket.id, 2: null }, gameState: createGameState(), timer: null };
        room.gameState.players[1].connected = true;
        ensureRoomPerf(room);
        perfWrite('roomCreated', { room: code });
        
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
        if (room.players[2]) { callback({ success: false, error: 'Partie complÃƒÂ¨te' }); return; }
        
        room.players[2] = socket.id;
        room.gameState.players[2].connected = true;
        playerRooms.set(socket.id, { code: room.code, playerNum: 2 });
        socket.join(room.code);
        callback({ success: true, code: room.code, playerNum: 2 });
        
        // Envoyer l'ÃƒÂ©tat en phase mulligan
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
    
    // Faire un mulligan (repiocher 5 nouvelles cartes)
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
        
        // MÃƒÂ©langer le deck
        for (let i = player.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]]; }
        
        // Piocher 5 nouvelles cartes
        player.hand = player.deck.splice(0, 5);
        
        player.mulliganDone = true;
        // Envoyer le nouvel ÃƒÂ©tat au joueur
        emitStateToPlayer(room, info.playerNum);
        
        checkMulliganComplete(room);
    });
    
    function checkMulliganComplete(room) {
        const p1Done = room.gameState.players[1].mulliganDone;
        const p2Done = room.gameState.players[2].mulliganDone;
        
        if (p1Done && p2Done) {
            // Les deux ont fait leur choix, commencer la partie
            room.gameState.phase = 'planning';
            perfMarkTurnStart(room, room.gameState.turn);
            emitStateToBoth(room);
            startTurnTimer(room);
        }
    }

    socket.on('perfClientMetrics', (payload) => {
        if (!PERF_ENABLED) return;
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room) return;
        perfRecordClient(room, info.playerNum, payload);
    });
    
    // ==================== SÃƒâ€°LECTION DU MODE ====================
    socket.on('selectMode', (mode) => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room) return;
        const player = room.gameState.players[info.playerNum];
        player.gameMode = mode; // 'normal', 'test', ou 'complete'

        // En mode normal/test, mettre tous les coÃƒÂ»ts ÃƒÂ  0 (main + deck)
        if (mode !== 'complete') {
            for (const card of player.hand) card.cost = 0;
            for (const card of player.deck) card.cost = 0;
            emitStateToPlayer(room, info.playerNum);
        }
    });

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

        // CrÃƒÂ©er la nouvelle main depuis les templates
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
            // Mode test : coÃƒÂ»t ÃƒÂ  0
            card.cost = 0;
            return card;
        });

        player.hand = newHand;
        // Remettre aussi les coÃƒÂ»ts du deck ÃƒÂ  0
        for (const c of player.deck) c.cost = 0;
        for (let i = player.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]]; }

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

        // Valider que chaque carte existe et est noire ou piÃƒÂ¨ge, max 2 exemplaires
        const cardCounts = {};
        for (const id of cardIds) {
            const template = cardMap[id];
            if (!template) {
                callback({ success: false, error: `Carte inconnue: ${id}` });
                return;
            }
            if (template.faction !== 'black' && template.type !== 'trap') {
                callback({ success: false, error: `Carte non autorisÃƒÂ©e: ${template.name}` });
                return;
            }
            cardCounts[id] = (cardCounts[id] || 0) + 1;
            if (cardCounts[id] > 2) {
                callback({ success: false, error: `Max 2 exemplaires: ${template.name}` });
                return;
            }
        }

        // CrÃƒÂ©er le deck complet
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

        // MÃƒÂ©langer (Fisher-Yates)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // Piocher 5 cartes pour la main
        player.hand = deck.splice(0, 5);
        player.deck = deck;

        // Forcer le hÃƒÂ©ros Erebeth
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
        if (row < 0 || row > 3 || col < 0 || col > 1) return;
        
        const card = player.hand[handIndex];
        if (!card || card.type !== 'creature') return;

        // Calculer le coÃƒÂ»t effectif (rÃƒÂ©duction poison pour Reine toxique)
        let effectiveCost = card.cost;
        if (card.poisonCostReduction) {
            effectiveCost = Math.max(0, card.cost - countTotalPoisonCounters(room));
        }

        if (effectiveCost > player.energy) return;
        if (player.field[row][col]) return;
        if (!canPlaceAt(card, col)) return;
        if (!respectsProvocationPriority(room, info.playerNum, card, row, col)) return;

        // VÃƒÂ©rification des conditions d'invocation spÃƒÂ©ciales
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (player.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) return;
        }
        if (!RESOLUTION_V2 && card.sacrifice) {
            const targets = getAdjacentSacrificeTargets(player.field, row, col, player.pendingSacrificeSlots);
            if (targets.length < card.sacrifice) return;
        }

        player.energy -= effectiveCost;
        const placed = {
            ...card,
            turnsOnField: 0,
            canAttack: card.isBuilding ? false : !!(card.abilities?.includes('haste') || card.abilities?.includes('superhaste')),
            currentHp: card.hp,
            movedThisTurn: false
        };
        if (card.isBuilding) placed.atk = 0;
        placed.summonOrder = ++room.gameState.summonCounter;
        player.field[row][col] = placed;
        player.hand.splice(handIndex, 1);
        player.inDeployPhase = true;

        // Si la crÃƒÂ©ature nÃƒÂ©cessite des sacrifices, marquer les cibles comme rÃƒÂ©servÃƒÂ©es
        if (!RESOLUTION_V2 && card.sacrifice) {
            const sacrificeTargets = getAdjacentSacrificeTargets(player.field, row, col, player.pendingSacrificeSlots);
            const toSacrifice = sacrificeTargets.slice(0, card.sacrifice);
            for (const t of toSacrifice) {
                player.pendingSacrificeSlots.push({ row: t.row, col: t.col });
            }
        }

        // Recalculer les ATK dynamiques (ex: Lance gobelin compte les gobelins)
        recalcDynamicAtk(room);

        const clonedCard = deepClone(placed);
        player.pendingActions.push({ type: 'place', card: clonedCard, row, col, handIndex });

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
        if (card.isBuilding) return;
        if (card.abilities?.includes('immovable')) return;
        if (card.melodyLocked || card.petrified) return;
        if (player.field[toRow][toCol]) return;

        const isFlying = card.abilities?.includes('fly');
        const isVerticalMove = (fromCol === toCol && Math.abs(toRow - fromRow) === 1);
        const isHorizontalMove = (fromRow === toRow && fromCol !== toCol);
        
        // DÃƒÂ©placement vertical: toutes les crÃƒÂ©atures
        // DÃƒÂ©placement horizontal: seulement les volants
        if (!isVerticalMove && !(isFlying && isHorizontalMove)) return;
        
        if (!canPlaceAt(card, toCol)) return;
        
        card.movedThisTurn = true;
        // RedÃƒÂ©ploiement = la crÃƒÂ©ature ne peut plus attaquer ce tour
        // CÃƒÂ©lÃƒÂ©ritÃƒÂ© permet d'attaquer au tour d'invocation, mais pas aprÃƒÂ¨s un dÃƒÂ©placement
        // SupercÃƒÂ©lÃƒÂ©ritÃƒÂ© permet toujours d'attaquer aprÃƒÂ¨s un dÃƒÂ©placement
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

        // Calculer le coÃƒÂ»t effectif (rÃƒÂ©duction Hyrule pour le 2ÃƒÂ¨me sort)
        let effectiveCost = spell.cost;
        if (player.hero && player.hero.id === 'hyrule' && player.spellsCastThisTurn === 1) {
            effectiveCost = Math.max(0, spell.cost - 1);
        }

        if (effectiveCost > player.energy) return;

        // Validation des coordonnÃƒÂ©es
        // row = -1 signifie qu'on cible un hÃƒÂ©ros
        if (row === -1) {
            // VÃƒÂ©rifier que le sort peut cibler un hÃƒÂ©ros
            if (spell.pattern !== 'hero' && !spell.canTargetHero) return;

            // VÃƒÂ©rifier les restrictions targetEnemy / targetSelf
            const isTargetingSelf = targetPlayer === info.playerNum;
            if (isTargetingSelf && !spell.targetSelf) return;
            if (!isTargetingSelf && !spell.targetEnemy) return;
        } else {
            // Sort ciblÃƒÂ© normal sur une crÃƒÂ©ature
            if (row < 0 || row > 3 || col < 0 || col > 1) return;

            // Validation camouflage/inciblable : les sorts offensifs ciblÃƒÂ©s ne peuvent pas cibler une crÃƒÂ©ature camouflÃƒÂ©e ou inciblable
            // Utiliser confirmedField (snapshot du dÃƒÂ©but de tour) car c'est ce que le joueur voit rÃƒÂ©ellement
            if (spell.offensive && targetPlayer !== info.playerNum) {
                const targetPlayerState = room.gameState.players[targetPlayer];
                const checkField = targetPlayerState.confirmedField || targetPlayerState.field;
                const target = checkField[row][col];
                if (target && (target.hasCamouflage || target.hasUntargetable)) return;

                // Spell Magnet : si l'adversaire a une crÃƒÂ©ature avec spellMagnet, le sort doit la cibler
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
            // Utiliser confirmedField (snapshot du dÃƒÂ©but de tour) car le joueur voit le snapshot
            if (spell.targetEmptySlot) {
                if (targetPlayer === info.playerNum) return; // Doit cibler l'adversaire
                const targetPlayerState = room.gameState.players[targetPlayer];
                const checkField = targetPlayerState.confirmedField || targetPlayerState.field;
                if (checkField[row][col]) return; // Le slot doit ÃƒÂªtre vide dans le snapshot
            }

            // Validation buff alliÃƒÂ© : slot alliÃƒÂ© avec crÃƒÂ©ature
            if (spell.targetSelfCreature) {
                if (targetPlayer !== info.playerNum) return;
                if (!player.field[row][col]) return;
            }

            // Validation RÃƒÂ©animation : slot vide alliÃƒÂ© + crÃƒÂ©ature au cimetiÃƒÂ¨re
            if (spell.targetSelfEmptySlot) {
                if (targetPlayer !== info.playerNum) return;
                if (player.field[row][col]) return;
                const { graveyardCreatureUid, graveyardIndex } = data;
                if (graveyardCreatureUid === undefined && graveyardIndex === undefined) return;
                let selectedCreature = null;
                if (graveyardIndex !== undefined && graveyardIndex >= 0 && graveyardIndex < player.graveyard.length) {
                    const c = player.graveyard[graveyardIndex];
                    if (c && c.type === 'creature') selectedCreature = c;
                }
                if (!selectedCreature && graveyardCreatureUid) {
                    selectedCreature = player.graveyard.find(c => c.type === 'creature' && (c.uid === graveyardCreatureUid || c.id === graveyardCreatureUid));
                }
                if (!selectedCreature) return;

                // VÃƒÂ©rifier les contraintes de placement de la crÃƒÂ©ature choisie
                const template = CardByIdMap.get(selectedCreature.id) || selectedCreature;
                if (!canPlaceAt(template, col)) return;
                if (!respectsProvocationPriority(room, info.playerNum, template, row, col)) return;
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
            originalHandIndex: handIndex,
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

        // Calculer le coÃƒÂ»t effectif (rÃƒÂ©duction Hyrule pour le 2ÃƒÂ¨me sort)
        let effectiveCost = spell.cost;
        if (player.hero && player.hero.id === 'hyrule' && player.spellsCastThisTurn === 1) {
            effectiveCost = Math.max(0, spell.cost - 1);
        }

        if (effectiveCost > player.energy) return;

        // VÃƒÂ©rifier que c'est un sort global (global, all, hero)
        if (!['global', 'all', 'hero'].includes(spell.pattern)) return;

        // Validation graveyard pour les sorts qui en ont besoin (ex: Mon prÃƒÂ©cieux)
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
            originalHandIndex: handIndex,
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
        
        player.pendingActions.push({ type: 'trap', trap: deepClone(trap), row: trapIndex, handIndex });
        
        emitStateToPlayer(room, info.playerNum);
    });
    
    socket.on('ready', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room || room.gameState.phase !== 'planning') return;
        if (room.gameState.players[info.playerNum].ready) return;
        
        room.gameState.players[info.playerNum].ready = true;
        room.gameState.players[info.playerNum].spellsCastThisTurn = 0;
        io.to(room.code).emit('playerReady', info.playerNum);
        emitStateToBoth(room);

        checkBothReady(room);
    });
    
    socket.on('surrender', () => {
        const info = playerRooms.get(socket.id);
        if (!info) return;
        const room = rooms.get(info.code);
        if (!room) return;
        
        const winner = info.playerNum === 1 ? 2 : 1;
        
        emitGameOver(room, { winner: winner, surrender: true });
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
server.listen(PORT, () => console.log(`Ã°Å¸Å½Â® Server on http://localhost:${PORT}`));



