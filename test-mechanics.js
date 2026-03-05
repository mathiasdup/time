/**
 * test-mechanics.js — Tests automatises pour les mecaniques de Bataille
 * Usage: node test-mechanics.js
 *
 * Teste la logique serveur sans navigateur ni socket.
 * Chaque test cree un etat de jeu artificiel, execute une mecanique, et verifie le resultat.
 */

const {
    rooms,
    addPoisonCounters,
    applyCreatureDamage,
    handleCreatureDeath,
    collectOnDeathEffects,
    resolvePostCombatEffects,
    processOnDeathAbility,
    recalcDynamicAtk,
    applySlotPoisonDamage,
    processTrapsForRow,
    findTarget,
    deepClone,
    countTotalPoisonCounters,
    resolveEndOfCombatForCard,
    canCreatureAttack,
    getCreatureRiposte,
    resolveCombatDeathsAndPostEffects,
    emitStateToBoth,
    processCombatSlotV2,
    processOnPoisonDeathEffects,
    drawCards,
    applySlotRegeneration,
    applySpell,
    syncMillWatchers,
    addToGraveyard
} = require('./server');

const { CardDB, CardByIdMap, createPlayerState, createGameState, createDeck } = require('./game/cards');

// ==================== TEST HELPERS ====================

let passCount = 0;
let failCount = 0;
let currentTest = '';

function assert(condition, msg) {
    if (!condition) {
        console.log(`  FAIL: ${msg}`);
        failCount++;
    } else {
        passCount++;
    }
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        console.log(`  FAIL: ${msg} — expected ${expected}, got ${actual}`);
        failCount++;
    } else {
        passCount++;
    }
}

function test(name, fn) {
    currentTest = name;
    console.log(`\n[TEST] ${name}`);
    try {
        fn();
        console.log(`  OK`);
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
        console.log(`  ${e.stack.split('\n').slice(1, 3).join('\n  ')}`);
        failCount++;
    }
}

async function testAsync(name, fn) {
    currentTest = name;
    console.log(`\n[TEST] ${name}`);
    try {
        await fn();
        console.log(`  OK`);
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
        console.log(`  ${e.stack.split('\n').slice(1, 3).join('\n  ')}`);
        failCount++;
    }
}

function makeCard(overrides = {}) {
    const base = {
        id: 'test_creature',
        name: overrides.name || 'Test Creature',
        atk: 2, riposte: 1, hp: 4, currentHp: 4,
        cost: 2, abilities: [], type: 'creature',
        faction: 'black', creatureType: 'undead', combatType: 'melee',
        image: 'black/test.png',
        uid: `test-${Date.now()}-${Math.random()}`,
        canAttack: true, turnsOnField: 1, movedThisTurn: false,
        summonOrder: 1, poisonCounters: 0, buffCounters: 0, damagedThisTurn: false
    };
    const card = { ...base, ...overrides };
    if (card.currentHp === undefined || (overrides.hp && !('currentHp' in overrides))) {
        card.currentHp = card.hp;
    }
    return card;
}

function makeRoom() {
    const gs = createGameState();
    gs.phase = 'resolution';
    gs.turn = 1;
    for (let p = 1; p <= 2; p++) {
        gs.players[p].field = Array(4).fill(null).map(() => Array(2).fill(null));
        gs.players[p].traps = [null, null, null, null];
        gs.players[p].trapCards = [null, null, null, null];
        gs.players[p].graveyard = [];
        gs.players[p].hand = [];
        gs.players[p].deck = [];
        gs.players[p].hp = 20;
        gs.players[p].energy = 10;
        gs.players[p].maxEnergy = 10;
        gs.players[p].pendingActions = [];
        gs.players[p].heroName = 'TestHero';
        gs.players[p].hero = { id: 'test_hero', name: 'TestHero' };
    }
    const room = {
        code: 'TEST' + Math.random().toString(36).substring(2, 6).toUpperCase(),
        players: { 1: null, 2: null },
        gameState: gs,
        _stateVersion: 0,
        _lastStatePayloadByPlayer: { 1: null, 2: null }
    };
    rooms.set(room.code, room);
    return room;
}

function cleanupRoom(room) { rooms.delete(room.code); }

const noopLog = (msg, type) => {};
const noopSleep = (ms) => Promise.resolve();

// ==================== TESTS: addPoisonCounters ====================

test('addPoisonCounters — base case', () => {
    const card = makeCard();
    const added = addPoisonCounters(card, 3, { source: 'test' });
    assertEqual(card.poisonCounters, 3, 'poisonCounters should be 3');
    assertEqual(added, 3, 'return value should be 3');
});

test('addPoisonCounters — stacking', () => {
    const card = makeCard();
    addPoisonCounters(card, 2, { source: 'test' });
    addPoisonCounters(card, 3, { source: 'test' });
    assertEqual(card.poisonCounters, 5, 'poisonCounters should stack to 5');
});

test('addPoisonCounters — buildings immune', () => {
    const card = makeCard({ isBuilding: true });
    assertEqual(addPoisonCounters(card, 5, { source: 'test' }), 0, 'return 0 for buildings');
    assertEqual(card.poisonCounters, 0, 'buildings should be immune');
});

test('addPoisonCounters — invalid amounts', () => {
    const card = makeCard();
    assertEqual(addPoisonCounters(card, 0), 0, 'zero amount');
    assertEqual(addPoisonCounters(card, -5), 0, 'negative amount');
    assertEqual(addPoisonCounters(card, NaN), 0, 'NaN amount');
    assertEqual(card.poisonCounters, 0, 'no poison applied');
});

test('addPoisonCounters — Nuage toxique amplifier aura', () => {
    const room = makeRoom();
    room.gameState.players[1].field[0][0] = makeCard({ aura: 'poisonAmplifier' });
    const target = makeCard({ name: 'Victim' });
    room.gameState.players[2].field[1][1] = target;
    const added = addPoisonCounters(target, 2, { source: 'test' }, room);
    assertEqual(added, 3, 'should add 2 + 1 amplifier = 3');
    assertEqual(target.poisonCounters, 3, 'poisonCounters should be 3');
    cleanupRoom(room);
});

test('addPoisonCounters — multiple Nuage toxique stacks', () => {
    const room = makeRoom();
    room.gameState.players[1].field[0][0] = makeCard({ aura: 'poisonAmplifier' });
    room.gameState.players[2].field[1][0] = makeCard({ aura: 'poisonAmplifier' });
    const target = makeCard({ name: 'Victim' });
    room.gameState.players[2].field[2][1] = target;
    assertEqual(addPoisonCounters(target, 1, { source: 'test' }, room), 3, 'should add 1 + 2 amplifiers = 3');
    cleanupRoom(room);
});

test('addPoisonCounters — poisonFeedsSelf gains buff counters', () => {
    const room = makeRoom();
    const card = makeCard({ name: 'Serpent', hp: 5, currentHp: 5, atk: 3, riposte: 2, poisonFeedsSelf: true });
    room.gameState.players[1].field[0][1] = card;
    addPoisonCounters(card, 2, { source: 'test' }, room);
    assertEqual(card.poisonCounters, 2, 'poison applied');
    assertEqual(card.buffCounters, 2, 'buff counters gained');
    assertEqual(card.hp, 7, 'hp increased by 2');
    assertEqual(card.currentHp, 7, 'currentHp increased by 2');
    assertEqual(card.riposte, 4, 'riposte increased by 2');
    cleanupRoom(room);
});

test('addPoisonCounters — poisonFeedsSelf + amplifier combo', () => {
    const room = makeRoom();
    room.gameState.players[2].field[0][0] = makeCard({ aura: 'poisonAmplifier' });
    const card = makeCard({ name: 'Serpent', hp: 5, currentHp: 5, atk: 3, riposte: 2, poisonFeedsSelf: true });
    room.gameState.players[1].field[0][1] = card;
    addPoisonCounters(card, 2, { source: 'test' }, room);
    assertEqual(card.poisonCounters, 3, 'poison with amplifier');
    assertEqual(card.buffCounters, 3, 'buff from total including amplifier');
    assertEqual(card.hp, 8, 'hp +3');
    assertEqual(card.currentHp, 8, 'currentHp +3');
    cleanupRoom(room);
});

// ==================== TESTS: Poison Tick ====================

testAsync('Poison tick — basic damage', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 6, currentHp: 6 }); card.poisonCounters = 3;
    room.gameState.players[1].field[0][1] = card;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(card.currentHp, 3, 'should take 3 poison damage');
    cleanupRoom(room);
});

testAsync('Poison tick — antitoxin immune', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 6, currentHp: 6, abilities: ['antitoxin'] }); card.poisonCounters = 3;
    room.gameState.players[1].field[0][1] = card;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(card.currentHp, 6, 'antitoxin should block poison damage');
    cleanupRoom(room);
});

testAsync('Poison tick — building immune', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 6, currentHp: 6, isBuilding: true }); card.poisonCounters = 3;
    room.gameState.players[1].field[0][1] = card;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(card.currentHp, 6, 'building should block poison damage');
    cleanupRoom(room);
});

testAsync('Poison tick — poisonHealsAllies aura', async () => {
    const room = makeRoom();
    room.gameState.players[1].field[1][0] = makeCard({ aura: 'poisonHealsAllies' });
    const card = makeCard({ hp: 8, currentHp: 4 }); card.poisonCounters = 3;
    room.gameState.players[1].field[0][1] = card;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(card.currentHp, 7, 'should heal 3 instead of damage');
    cleanupRoom(room);
});

testAsync('Poison tick — poisonHealsAllies does NOT heal enemies', async () => {
    const room = makeRoom();
    room.gameState.players[1].field[1][0] = makeCard({ aura: 'poisonHealsAllies' });
    const enemy = makeCard({ hp: 8, currentHp: 5 }); enemy.poisonCounters = 2;
    room.gameState.players[2].field[0][1] = enemy;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(enemy.currentHp, 3, 'enemy should take damage not healed');
    cleanupRoom(room);
});

testAsync('Poison tick — poisonFeedsSelf heals', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 8, currentHp: 4, poisonFeedsSelf: true }); card.poisonCounters = 3;
    room.gameState.players[1].field[0][1] = card;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(card.currentHp, 7, 'poisonFeedsSelf should heal');
    cleanupRoom(room);
});

testAsync('Poison tick — Roi du poison doubles enemy damage', async () => {
    const room = makeRoom();
    room.gameState.players[1].field[2][1] = makeCard({ poisonDamageMultiplier: 2 });
    const enemy = makeCard({ hp: 10, currentHp: 10 }); enemy.poisonCounters = 3;
    room.gameState.players[2].field[0][1] = enemy;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(enemy.currentHp, 4, 'should take 3*2=6 damage');
    cleanupRoom(room);
});

testAsync('Poison tick — Roi du poison does NOT double own creatures', async () => {
    const room = makeRoom();
    room.gameState.players[1].field[2][1] = makeCard({ poisonDamageMultiplier: 2 });
    const ally = makeCard({ hp: 10, currentHp: 10 }); ally.poisonCounters = 3;
    room.gameState.players[1].field[0][1] = ally;
    await applySlotPoisonDamage(room, 0, 1, [], noopLog, noopSleep, () => null);
    assertEqual(ally.currentHp, 7, 'own creatures normal 3 damage');
    cleanupRoom(room);
});

// ==================== TESTS: applyCreatureDamage ====================

test('applyCreatureDamage — basic damage', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 5 });
    room.gameState.players[1].field[0][1] = card;
    assertEqual(applyCreatureDamage(card, 3, room, noopLog, 1, 0, 1), 3, 'return 3');
    assertEqual(card.currentHp, 2, 'should take 3 damage');
    cleanupRoom(room);
});

test('applyCreatureDamage — protection blocks first hit', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 5, abilities: ['protection'], hasProtection: true });
    room.gameState.players[1].field[0][1] = card;
    assertEqual(applyCreatureDamage(card, 3, room, noopLog, 1, 0, 1), 0, 'return 0');
    assertEqual(card.currentHp, 5, 'protection blocks');
    assertEqual(card.hasProtection, false, 'protection consumed');
    cleanupRoom(room);
});

test('applyCreatureDamage — spectral halves damage', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10, abilities: ['spectral'] });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ name: 'Attacker' });
    const dmg = applyCreatureDamage(card, 6, room, noopLog, 1, 0, 1, source, 2);
    assertEqual(card.currentHp, 7, 'spectral halves 6 to 3');
    assertEqual(dmg, 3, 'return halved damage');
    cleanupRoom(room);
});

test('applyCreatureDamage — spectral rounds down', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10, abilities: ['spectral'] });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({});
    applyCreatureDamage(card, 5, room, noopLog, 1, 0, 1, source, 2);
    assertEqual(card.currentHp, 8, 'spectral halves 5 to 2 (floor)');
    cleanupRoom(room);
});

test('applyCreatureDamage — lethal kills instantly', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 100, currentHp: 100 });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ abilities: ['lethal'] });
    room.gameState.players[2].field[0][0] = source;
    applyCreatureDamage(card, 1, room, noopLog, 1, 0, 1, { player: 2, row: 0, col: 0 }, 2);
    assertEqual(card.currentHp, 0, 'lethal kills regardless of HP');
    cleanupRoom(room);
});

test('applyCreatureDamage — lethal does not kill buildings', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10, isBuilding: true });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ abilities: ['lethal'] });
    room.gameState.players[2].field[0][0] = source;
    applyCreatureDamage(card, 1, room, noopLog, 1, 0, 1, { player: 2, row: 0, col: 0 }, 2);
    assertEqual(card.currentHp, 9, 'lethal should not instakill buildings');
    cleanupRoom(room);
});

test('applyCreatureDamage — lethal blocked by protection', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10, abilities: ['protection'], hasProtection: true });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ abilities: ['lethal'] });
    room.gameState.players[2].field[0][0] = source;
    applyCreatureDamage(card, 1, room, noopLog, 1, 0, 1, { player: 2, row: 0, col: 0 }, 2);
    assertEqual(card.currentHp, 10, 'protection blocks lethal');
    cleanupRoom(room);
});

test('applyCreatureDamage — poison on hit applies counters', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10 });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ abilities: ['poison'], poisonX: 3 });
    room.gameState.players[2].field[0][0] = source;
    applyCreatureDamage(card, 2, room, noopLog, 1, 0, 1, { player: 2, row: 0, col: 0 }, 2);
    assertEqual(card.currentHp, 8, 'should take 2 damage');
    assert(card.poisonCounters >= 3, 'should have at least 3 poison counters');
    cleanupRoom(room);
});

test('applyCreatureDamage — poison blocked by protection (0 dmg)', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10, abilities: ['protection'], hasProtection: true });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ abilities: ['poison'], poisonX: 3 });
    room.gameState.players[2].field[0][0] = source;
    applyCreatureDamage(card, 2, room, noopLog, 1, 0, 1, { player: 2, row: 0, col: 0 }, 2);
    assertEqual(card.poisonCounters, 0, 'protection blocks so no poison');
    cleanupRoom(room);
});

test('applyCreatureDamage — entrave on hit', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 10, currentHp: 10 });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ abilities: ['entrave'], entraveX: 2 });
    room.gameState.players[2].field[0][0] = source;
    applyCreatureDamage(card, 1, room, noopLog, 1, 0, 1, { player: 2, row: 0, col: 0 }, 2);
    assertEqual(card.entraveCounters, 2, 'should have 2 entrave counters');
    cleanupRoom(room);
});

test('applyCreatureDamage — killedBy tracks killer', () => {
    const room = makeRoom();
    const card = makeCard({ hp: 3, currentHp: 3 });
    room.gameState.players[1].field[0][1] = card;
    const source = makeCard({ uid: 'killer-123' });
    room.gameState.players[2].field[0][0] = source;
    const srcRef = { player: 2, row: 0, col: 0, uid: source.uid };
    applyCreatureDamage(card, 5, room, noopLog, 1, 0, 1, srcRef, 2);
    assert(card.killedBy, 'should track killer');
    assertEqual(card.killedBy.uid, source.uid, 'killer uid match');
    cleanupRoom(room);
});

// ==================== TESTS: getCreatureRiposte & canCreatureAttack ====================

test('getCreatureRiposte — returns riposte', () => {
    assertEqual(getCreatureRiposte(makeCard({ riposte: 3 })), 3, 'riposte 3');
    assertEqual(getCreatureRiposte(makeCard({ riposte: 0 })), 0, 'riposte 0');
});

test('canCreatureAttack — normal', () => {
    assertEqual(canCreatureAttack(makeCard({ canAttack: true })), true, 'can attack');
    assertEqual(canCreatureAttack(makeCard({ canAttack: false })), false, 'cannot attack');
});

test('canCreatureAttack — wall cannot attack', () => {
    assertEqual(canCreatureAttack(makeCard({ canAttack: true, abilities: ['wall'] })), false, 'wall blocked');
});

test('canCreatureAttack — petrified does not block canCreatureAttack', () => {
    // Note: petrified is checked separately in combat logic (processCombatSlotV2),
    // not in canCreatureAttack which only checks canAttack, wall, and atk > 0
    assertEqual(canCreatureAttack(makeCard({ canAttack: true, petrified: true })), true, 'petrified not checked by canCreatureAttack');
});

// ==================== TESTS: countTotalPoisonCounters ====================

test('countTotalPoisonCounters', () => {
    const room = makeRoom();
    room.gameState.players[1].field[0][1] = makeCard({ poisonCounters: 3 });
    room.gameState.players[2].field[1][0] = makeCard({ poisonCounters: 5 });
    room.gameState.players[1].field[2][1] = makeCard({ poisonCounters: 0 });
    assertEqual(countTotalPoisonCounters(room), 8, 'total 3+5=8');
    cleanupRoom(room);
});

// ==================== TESTS: recalcDynamicAtk ====================

test('recalcDynamicAtk — buffCounters add ATK', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 2, baseAtk: 2 }); card.buffCounters = 3;
    room.gameState.players[1].field[0][1] = card;
    recalcDynamicAtk(room);
    assertEqual(card.atk, 5, 'base 2 + 3 buff = 5');
    cleanupRoom(room);
});

test('recalcDynamicAtk — bloodthirstStacks add ATK', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 2, baseAtk: 2, abilities: ['bloodthirst'] }); card.bloodthirstStacks = 2;
    room.gameState.players[1].field[0][1] = card;
    recalcDynamicAtk(room);
    assertEqual(card.atk, 4, 'base 2 + 2 bloodthirst = 4');
    cleanupRoom(room);
});

test('recalcDynamicAtk — powerStacks add ATK', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 3, baseAtk: 3, abilities: ['power'] }); card.powerStacks = 4;
    room.gameState.players[1].field[0][1] = card;
    recalcDynamicAtk(room);
    assertEqual(card.atk, 7, 'base 3 + 4 power = 7');
    cleanupRoom(room);
});

test('recalcDynamicAtk — enhance gives adjacent +X ATK', () => {
    const room = makeRoom();
    room.gameState.players[1].field[1][0] = makeCard({ atk: 1, baseAtk: 1, abilities: ['enhance'], enhanceAmount: 2 });
    const neighbor = makeCard({ atk: 3, baseAtk: 3 });
    room.gameState.players[1].field[1][1] = neighbor;
    const far = makeCard({ atk: 3, baseAtk: 3 });
    room.gameState.players[1].field[3][1] = far;
    recalcDynamicAtk(room);
    assertEqual(neighbor.atk, 5, 'adjacent +2 enhance');
    assertEqual(far.atk, 3, 'non-adjacent stays base');
    cleanupRoom(room);
});

test('recalcDynamicAtk — atkPerAdjacent', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 1, baseAtk: 1, atkPerAdjacent: 1 });
    room.gameState.players[1].field[1][1] = card;
    room.gameState.players[1].field[0][1] = makeCard({});
    room.gameState.players[1].field[1][0] = makeCard({});
    recalcDynamicAtk(room);
    assertEqual(card.atk, 3, '1 + 2 adjacent = 3');
    cleanupRoom(room);
});

test('recalcDynamicAtk — atkPerGraveyard', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 1, baseAtk: 1, atkPerGraveyard: 1 });
    room.gameState.players[1].field[0][1] = card;
    room.gameState.players[1].graveyard = [makeCard({ type: 'creature' }), makeCard({ type: 'creature' }), makeCard({ type: 'creature' })];
    recalcDynamicAtk(room);
    assertEqual(card.atk, 4, '1 + 3 graveyard = 4');
    cleanupRoom(room);
});

test('recalcDynamicAtk — entrave reduces ATK', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 5, baseAtk: 5 }); card.entraveCounters = 2;
    room.gameState.players[1].field[0][1] = card;
    recalcDynamicAtk(room);
    assertEqual(card.atk, 3, '5 - 2 entrave = 3');
    cleanupRoom(room);
});

test('recalcDynamicAtk — ATK can go negative with entrave', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 1, baseAtk: 1 }); card.entraveCounters = 5;
    room.gameState.players[1].field[0][1] = card;
    recalcDynamicAtk(room);
    assertEqual(card.atk, -4, 'base 1 - 5 entrave = -4');
    cleanupRoom(room);
});

// ==================== TESTS: handleCreatureDeath ====================

test('handleCreatureDeath — normal death to graveyard', () => {
    const room = makeRoom();
    const card = makeCard({ currentHp: 0 }); room.gameState.players[1].field[0][1] = card;
    handleCreatureDeath(room, card, 1, 0, 1, noopLog);
    assertEqual(room.gameState.players[1].field[0][1], null, 'slot null');
    assertEqual(room.gameState.players[1].graveyard.length, 1, 'graveyard has 1');
    cleanupRoom(room);
});

test('handleCreatureDeath — transform', () => {
    const room = makeRoom();
    const card = makeCard({ currentHp: 0, onDeath: { transformInto: 'bone_pile' } });
    room.gameState.players[1].field[0][1] = card;
    const result = handleCreatureDeath(room, card, 1, 0, 1, noopLog);
    assert(result.transformed, 'should transform');
    assertEqual(room.gameState.players[1].field[0][1].id, 'bone_pile', 'bone pile');
    assertEqual(room.gameState.players[1].graveyard.length, 0, 'graveyard empty');
    cleanupRoom(room);
});

test('handleCreatureDeath — dissipation no graveyard', () => {
    const room = makeRoom();
    const card = makeCard({ currentHp: 0, abilities: ['dissipation'] });
    room.gameState.players[1].field[0][1] = card;
    handleCreatureDeath(room, card, 1, 0, 1, noopLog);
    assertEqual(room.gameState.players[1].graveyard.length, 0, 'dissipation no graveyard');
    cleanupRoom(room);
});

test('handleCreatureDeath — retains poisonCounters', () => {
    const room = makeRoom();
    const card = makeCard({ currentHp: 0, poisonCounters: 7, onDeath: { absorbAdjacentPoisonThenDamageHero: true } });
    room.gameState.players[1].field[0][1] = card;
    handleCreatureDeath(room, card, 1, 0, 1, noopLog);
    assertEqual(card.poisonCounters, 7, 'retains poison after death');
    cleanupRoom(room);
});

test('handleCreatureDeath — bloodthirst grants enemy bonus', () => {
    const room = makeRoom();
    room.gameState.players[1].field[0][1] = makeCard({ currentHp: 0 });
    const bt = makeCard({ abilities: ['bloodthirst'], bloodthirstAmount: 2 });
    room.gameState.players[2].field[1][1] = bt;
    handleCreatureDeath(room, room.gameState.players[1].field[0][1], 1, 0, 1, noopLog);
    assertEqual(bt.bloodthirstStacks, 2, 'bloodthirst +2');
    cleanupRoom(room);
});

test('handleCreatureDeath — onAdjacentAllyDeath buffs neighbor', () => {
    const room = makeRoom();
    const dying = makeCard({ currentHp: 0 }); room.gameState.players[1].field[1][1] = dying;
    const mother = makeCard({ hp: 5, currentHp: 5, riposte: 1, onAdjacentAllyDeath: { atk: 1, hp: 2, riposte: 1 } });
    room.gameState.players[1].field[0][1] = mother;
    handleCreatureDeath(room, dying, 1, 1, 1, noopLog);
    assertEqual(mother.buffCounters, 1, '+1 buff counter');
    assertEqual(mother.currentHp, 7, '+2 HP');
    assertEqual(mother.riposte, 2, '+1 riposte');
    cleanupRoom(room);
});

test('handleCreatureDeath — onAdjacentAllyDeath NOT for non-adjacent', () => {
    const room = makeRoom();
    room.gameState.players[1].field[0][1] = makeCard({ currentHp: 0 });
    const mother = makeCard({ hp: 5, currentHp: 5, onAdjacentAllyDeath: { atk: 1, hp: 2, riposte: 0 } });
    room.gameState.players[1].field[3][0] = mother;
    handleCreatureDeath(room, room.gameState.players[1].field[0][1], 1, 0, 1, noopLog);
    assertEqual(mother.currentHp, 5, 'not adjacent, no buff');
    cleanupRoom(room);
});

// ==================== TESTS: collectOnDeathEffects (all types) ====================

test('collectOnDeathEffects — poisonAdjacent + drawCards', () => {
    const card = makeCard({ onDeath: { poisonAdjacent: 2, drawCards: 1 } });
    const eff = collectOnDeathEffects([{ card, player: 1, row: 1, col: 1 }]);
    assert(eff.find(e => e.type === 'poisonAdjacent'), 'poisonAdjacent');
    assert(eff.find(e => e.type === 'drawCards'), 'drawCards');
});

test('collectOnDeathEffects — absorbAdjacentPoisonThenDamageHero with poison', () => {
    const card = makeCard({ poisonCounters: 5, onDeath: { absorbAdjacentPoisonThenDamageHero: true } });
    const eff = collectOnDeathEffects([{ card, player: 1, row: 2, col: 1 }]);
    const a = eff.find(e => e.type === 'absorbAdjacentPoisonThenDamageHero');
    assert(a, 'effect exists');
    assertEqual(a.poisonCounters, 5, '5 poison');
});

test('collectOnDeathEffects — absorbAdjacentPoisonThenDamageHero without poison', () => {
    const card = makeCard({ poisonCounters: 0, onDeath: { absorbAdjacentPoisonThenDamageHero: true } });
    const eff = collectOnDeathEffects([{ card, player: 1, row: 2, col: 1 }]);
    assertEqual(eff.find(e => e.type === 'absorbAdjacentPoisonThenDamageHero').poisonCounters, 0, '0 poison');
});

test('collectOnDeathEffects — poisonExplosion', () => {
    const card = makeCard({ poisonCounters: 4, onDeath: { poisonExplosion: true } });
    assertEqual(collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'poisonExplosion').damage, 4, 'dmg=counters');
});

test('collectOnDeathEffects — heroDamage', () => {
    const card = makeCard({ onDeath: { damageHero: 3 } });
    const d = collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'heroDamage');
    assertEqual(d.targetPlayer, 2, 'targets enemy');
    assertEqual(d.damage, 3, 'damage 3');
});

test('collectOnDeathEffects — damageKiller', () => {
    const card = makeCard({ onDeath: { damageKiller: 3 } });
    card.killedBy = { player: 2, row: 0, col: 1, uid: 'k1' };
    const d = collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'creatureDamage');
    assert(d, 'creatureDamage exists');
    assertEqual(d.targetUid, 'k1', 'targets killer');
});

test('collectOnDeathEffects — damageKiller requires killedBy', () => {
    const card = makeCard({ onDeath: { damageKiller: 3 } });
    assert(!collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'creatureDamage'), 'no effect without killedBy');
});

test('collectOnDeathEffects — damageRow', () => {
    const card = makeCard({ onDeath: { damageRow: 2 } });
    const d = collectOnDeathEffects([{ card, player: 1, row: 2, col: 1 }]).find(e => e.type === 'rowDamage');
    assertEqual(d.row, 2, 'row 2');
    assertEqual(d.damage, 2, 'damage 2');
});

test('collectOnDeathEffects — destroyAll', () => {
    const card = makeCard({ onDeath: { destroyAll: true } });
    assert(collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'destroyAll'), 'destroyAll');
});

test('collectOnDeathEffects — poisonAll', () => {
    const card = makeCard({ onDeath: { poisonAll: 2 } });
    assertEqual(collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'poisonAll').poisonAmount, 2, 'amount 2');
});

test('collectOnDeathEffects — poisonRow', () => {
    const card = makeCard({ onDeath: { poisonRow: 1 } });
    assertEqual(collectOnDeathEffects([{ card, player: 1, row: 3, col: 0 }]).find(e => e.type === 'poisonRow').row, 3, 'row 3');
});

test('collectOnDeathEffects — summonIfPoisoned triggers with poison', () => {
    const card = makeCard({ poisonCounters: 2, onDeath: { summonIfPoisoned: 'bone_pile' } });
    assert(collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'summonIfPoisoned'), 'triggers');
});

test('collectOnDeathEffects — summonIfPoisoned NOT without poison', () => {
    const card = makeCard({ poisonCounters: 0, onDeath: { summonIfPoisoned: 'bone_pile' } });
    assert(!collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]).find(e => e.type === 'summonIfPoisoned'), 'no trigger');
});

test('collectOnDeathEffects — millFirstCreature', () => {
    assert(collectOnDeathEffects([{ card: makeCard({ onDeath: { millFirstCreature: true } }), player: 1, row: 0, col: 1 }]).find(e => e.type === 'millFirstCreature'), 'exists');
});

test('collectOnDeathEffects — healHero', () => {
    const d = collectOnDeathEffects([{ card: makeCard({ onDeath: { healHero: 3 } }), player: 1, row: 0, col: 1 }]).find(e => e.type === 'heroHeal');
    assertEqual(d.amount, 3, 'heal 3');
    assertEqual(d.player, 1, 'heals own hero');
});

test('collectOnDeathEffects — returnGraveCost1ToHand', () => {
    assert(collectOnDeathEffects([{ card: makeCard({ onDeath: { returnGraveCost1ToHand: true } }), player: 1, row: 0, col: 1 }]).find(e => e.type === 'returnGraveCost1ToHand'), 'exists');
});

test('collectOnDeathEffects — discardHandAndRedraw', () => {
    assert(collectOnDeathEffects([{ card: makeCard({ onDeath: { discardHandAndRedraw: true } }), player: 1, row: 0, col: 1 }]).find(e => e.type === 'discardHandAndRedraw'), 'exists');
});

test('collectOnDeathEffects — reanimateMeleeCost2OrLessBottom', () => {
    assert(collectOnDeathEffects([{ card: makeCard({ onDeath: { reanimateMeleeCost2OrLessBottom: true } }), player: 1, row: 0, col: 1 }]).find(e => e.type === 'reanimateMeleeCost2OrLessBottom'), 'exists');
});

test('collectOnDeathEffects — bloodPactCost', () => {
    const d = collectOnDeathEffects([{ card: makeCard({ bloodPactCost: 3 }), player: 1, row: 0, col: 1 }]).find(e => e.type === 'bloodPactDamage');
    assertEqual(d.damage, 3, 'damage 3');
    assertEqual(d.player, 1, 'own player');
});

test('collectOnDeathEffects — multiple deaths', () => {
    const c1 = makeCard({ onDeath: { damageHero: 2 } });
    const c2 = makeCard({ onDeath: { healHero: 3 } });
    const eff = collectOnDeathEffects([{ card: c1, player: 1, row: 0, col: 1 }, { card: c2, player: 2, row: 1, col: 0 }]);
    assert(eff.find(e => e.type === 'heroDamage'), 'heroDamage');
    assert(eff.find(e => e.type === 'heroHeal'), 'heroHeal');
});

// ==================== TESTS: resolvePostCombatEffects ====================

testAsync('resolvePostCombatEffects — heroDamage', async () => {
    const room = makeRoom();
    await resolvePostCombatEffects(room, [{ type: 'heroDamage', targetPlayer: 2, damage: 5, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 15, '-5 HP');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — heroHeal capped at 20', async () => {
    const room = makeRoom();
    room.gameState.players[1].hp = 18;
    await resolvePostCombatEffects(room, [{ type: 'heroHeal', player: 1, amount: 5, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[1].hp, 20, 'capped at 20');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — bloodPactDamage hits own hero', async () => {
    const room = makeRoom();
    await resolvePostCombatEffects(room, [{ type: 'bloodPactDamage', player: 1, damage: 3, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[1].hp, 17, '-3 own hero');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — creatureDamage hits killer', async () => {
    const room = makeRoom();
    const killer = makeCard({ hp: 8, currentHp: 8, uid: 'k1' });
    room.gameState.players[2].field[0][1] = killer;
    await resolvePostCombatEffects(room, [{ type: 'creatureDamage', targetPlayer: 2, targetRow: 0, targetCol: 1, targetUid: 'k1', damage: 3, source: 'X' }], noopLog, noopSleep);
    assertEqual(killer.currentHp, 5, '-3 to killer');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — creatureDamage misses wrong uid', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 8, currentHp: 8, uid: 'other' });
    room.gameState.players[2].field[0][1] = card;
    await resolvePostCombatEffects(room, [{ type: 'creatureDamage', targetPlayer: 2, targetRow: 0, targetCol: 1, targetUid: 'k1', damage: 3, source: 'X' }], noopLog, noopSleep);
    assertEqual(card.currentHp, 8, 'no damage wrong uid');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — rowDamage hits row, skips source & flyers', async () => {
    const room = makeRoom();
    const sameSlot = makeCard({ hp: 5, currentHp: 5 });
    room.gameState.players[1].field[2][1] = sameSlot;
    const ally = makeCard({ hp: 5, currentHp: 5 });
    room.gameState.players[1].field[2][0] = ally;
    const enemy = makeCard({ hp: 5, currentHp: 5 });
    room.gameState.players[2].field[2][1] = enemy;
    const flyer = makeCard({ hp: 5, currentHp: 5, combatType: 'fly' });
    room.gameState.players[2].field[2][0] = flyer;
    await resolvePostCombatEffects(room, [{ type: 'rowDamage', sourcePlayer: 1, sourceCol: 1, row: 2, damage: 2, source: 'X' }], noopLog, noopSleep);
    assertEqual(sameSlot.currentHp, 5, 'source slot skipped');
    assertEqual(ally.currentHp, 3, 'ally hit');
    assertEqual(enemy.currentHp, 3, 'enemy hit');
    assertEqual(flyer.currentHp, 5, 'flyer immune');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — draw', async () => {
    const room = makeRoom();
    room.gameState.players[1].deck = [makeCard({ type: 'creature', hp: 2 }), makeCard({ type: 'creature', hp: 3 })];
    room.gameState.players[1].hand = [];
    await resolvePostCombatEffects(room, [{ type: 'draw', player: 1, count: 2, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[1].hand.length, 2, 'drew 2');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — draw full hand burns', async () => {
    const room = makeRoom();
    room.gameState.players[1].deck = [makeCard({ type: 'creature', hp: 1 })];
    room.gameState.players[1].hand = Array(9).fill(null).map(() => makeCard({}));
    await resolvePostCombatEffects(room, [{ type: 'draw', player: 1, count: 1, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[1].hand.length, 9, 'hand stays 9');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — absorbAdjacentPoisonThenDamageHero (no adjacent)', async () => {
    const room = makeRoom();
    await resolvePostCombatEffects(room, [{ type: 'absorbAdjacentPoisonThenDamageHero', sourcePlayer: 1, row: 2, col: 1, poisonCounters: 5, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 15, '-5 from own poison');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — absorbAdjacentPoisonThenDamageHero with adjacent', async () => {
    const room = makeRoom();
    const adj = makeCard({ hp: 5, currentHp: 5 }); adj.poisonCounters = 3;
    room.gameState.players[1].field[1][1] = adj;
    await resolvePostCombatEffects(room, [{ type: 'absorbAdjacentPoisonThenDamageHero', sourcePlayer: 1, row: 2, col: 1, poisonCounters: 5, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 12, '-8 (5+3)');
    assertEqual(adj.poisonCounters, 0, 'absorbed');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — absorbAdjacentPoisonThenDamageHero crosses to enemy', async () => {
    const room = makeRoom();
    const ef = makeCard({ hp: 5, currentHp: 5 }); ef.poisonCounters = 4;
    room.gameState.players[2].field[2][1] = ef;
    await resolvePostCombatEffects(room, [{ type: 'absorbAdjacentPoisonThenDamageHero', sourcePlayer: 1, row: 2, col: 1, poisonCounters: 2, source: 'X' }], noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 14, '-6 (2+4)');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — poisonAdjacent (Spores all 4 dirs)', async () => {
    const room = makeRoom();
    const above = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[1].field[0][1] = above;
    const below = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[1].field[2][1] = below;
    const behind = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[1].field[1][0] = behind;
    const ef = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[1][1] = ef;
    await resolvePostCombatEffects(room, [{ type: 'poisonAdjacent', sourcePlayer: 1, row: 1, col: 1, poisonAmount: 2, source: 'Spores' }], noopLog, noopSleep);
    assert(above.poisonCounters >= 2, 'above');
    assert(below.poisonCounters >= 2, 'below');
    assert(behind.poisonCounters >= 2, 'behind');
    assert(ef.poisonCounters >= 2, 'enemy front cross');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — poisonAdjacent back row does NOT cross', async () => {
    const room = makeRoom();
    const own = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[1].field[1][1] = own;
    const enemy = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[1][1] = enemy;
    await resolvePostCombatEffects(room, [{ type: 'poisonAdjacent', sourcePlayer: 1, row: 1, col: 0, poisonAmount: 2, source: 'X' }], noopLog, noopSleep);
    assert(own.poisonCounters >= 2, 'own front hit');
    assertEqual(enemy.poisonCounters, 0, 'enemy NOT hit from back');
    cleanupRoom(room);
});

testAsync('resolvePostCombatEffects — multiple deaths batch', async () => {
    const room = makeRoom();
    const eff = collectOnDeathEffects([
        { card: makeCard({ onDeath: { damageHero: 3 } }), player: 1, row: 0, col: 1 },
        { card: makeCard({ onDeath: { damageHero: 2 } }), player: 1, row: 1, col: 1 }
    ]);
    await resolvePostCombatEffects(room, eff, noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 15, '3+2=5 total');
    cleanupRoom(room);
});

// ==================== TESTS: resolveEndOfCombatForCard ====================

testAsync('resolveEndOfCombatForCard — absorbPoison', async () => {
    const room = makeRoom();
    const avatar = makeCard({ hp: 7, currentHp: 7, atk: 7, riposte: 7, endOfCombat: { absorbPoison: true }, _attackedThisCombat: true });
    room.gameState.players[1].field[0][1] = avatar;
    const ally = makeCard({ hp: 4, currentHp: 3, poisonCounters: 2 }); room.gameState.players[1].field[1][1] = ally;
    const enemy = makeCard({ hp: 5, currentHp: 4, poisonCounters: 3 }); room.gameState.players[2].field[0][1] = enemy;
    await resolveEndOfCombatForCard(room, avatar, 1, 0, 1, noopLog, noopSleep);
    assertEqual(ally.poisonCounters, 0, 'ally cleared');
    assertEqual(enemy.poisonCounters, 0, 'enemy cleared');
    assertEqual(avatar.buffCounters, 5, '5 buff');
    assertEqual(avatar.hp, 12, 'hp 7+5');
    assertEqual(avatar.currentHp, 12, 'currentHp 7+5');
    assertEqual(avatar.riposte, 12, 'riposte 7+5');
    cleanupRoom(room);
});

testAsync('resolveEndOfCombatForCard — damageAllEnemies', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 5, endOfCombat: { damageAllEnemies: 2 }, _attackedThisCombat: true });
    room.gameState.players[1].field[0][1] = card;
    const e1 = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[0][1] = e1;
    const e2 = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[1][1] = e2;
    await resolveEndOfCombatForCard(room, card, 1, 0, 1, noopLog, noopSleep);
    assertEqual(e1.currentHp, 3, 'e1 -2');
    assertEqual(e2.currentHp, 3, 'e2 -2');
    cleanupRoom(room);
});

testAsync('resolveEndOfCombatForCard — selfMill', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 5, endOfCombat: { selfMill: 2 }, _attackedThisCombat: true });
    room.gameState.players[1].field[0][1] = card;
    room.gameState.players[1].deck = [makeCard({ type: 'creature' }), makeCard({ type: 'creature' }), makeCard({ type: 'creature' })];
    await resolveEndOfCombatForCard(room, card, 1, 0, 1, noopLog, noopSleep);
    assertEqual(room.gameState.players[1].deck.length, 1, 'deck -2');
    assertEqual(room.gameState.players[1].graveyard.length, 2, 'graveyard +2');
    cleanupRoom(room);
});

testAsync('resolveEndOfCombatForCard — requires _attackedThisCombat', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 5, endOfCombat: { damageAllEnemies: 5 } });
    room.gameState.players[1].field[0][1] = card;
    const e = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[0][1] = e;
    await resolveEndOfCombatForCard(room, card, 1, 0, 1, noopLog, noopSleep);
    assertEqual(e.currentHp, 5, 'no trigger without _attackedThisCombat');
    cleanupRoom(room);
});

testAsync('resolveEndOfCombatForCard — dead card does not trigger', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 0, endOfCombat: { damageAllEnemies: 5 }, _attackedThisCombat: true });
    room.gameState.players[1].field[0][1] = card;
    const e = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[0][1] = e;
    await resolveEndOfCombatForCard(room, card, 1, 0, 1, noopLog, noopSleep);
    assertEqual(e.currentHp, 5, 'dead card no trigger');
    cleanupRoom(room);
});

// ==================== TESTS: findTarget ====================

test('findTarget — front attacks enemy front', () => {
    const t = findTarget(makeCard({}), makeCard({ name: 'EF' }), null, 2, 0, 1);
    assertEqual(t.card.name, 'EF', 'targets enemy front');
});

test('findTarget — no enemy attacks hero', () => {
    const t = findTarget(makeCard({}), null, null, 2, 0, 1);
    assert(t.isHero, 'attacks hero');
});

test('findTarget — flying targets flyer interception', () => {
    const t = findTarget(makeCard({ abilities: ['fly'], canAttack: true }), makeCard({ abilities: ['fly'], canAttack: true }), null, 2, 0, 1);
    assert(!t.isHero, 'targets creature');
});

test('findTarget — flying passes over ground to hero', () => {
    const t = findTarget(makeCard({ abilities: ['fly'] }), makeCard({}), null, 2, 0, 1);
    assert(t.isHero, 'passes ground');
});

test('findTarget — flying can hit shooters', () => {
    const t = findTarget(makeCard({ abilities: ['fly'] }), makeCard({ abilities: ['shooter'], canAttack: true }), null, 2, 0, 1);
    assert(!t.isHero, 'hits shooter');
});

test('findTarget — shooter targets any', () => {
    const t = findTarget(makeCard({ abilities: ['shooter'] }), makeCard({}), null, 2, 0, 0);
    assert(!t.isHero, 'targets creature');
});

test('findTarget — shooter targets back if no front', () => {
    const t = findTarget(makeCard({ abilities: ['shooter'] }), null, makeCard({ name: 'Back' }), 2, 0, 0);
    assertEqual(t.card.name, 'Back', 'targets back');
    assertEqual(t.col, 0, 'col 0');
});

test('findTarget — intangible always hero', () => {
    const t = findTarget(makeCard({ abilities: ['intangible'] }), makeCard({}), makeCard({}), 2, 0, 1);
    assert(t.isHero, 'intangible -> hero');
});

test('findTarget — camouflage hides creature', () => {
    const t = findTarget(makeCard({}), makeCard({ hasCamouflage: true }), null, 2, 0, 1);
    assert(t.isHero, 'camouflage hides');
});

test('findTarget — petrified hides creature', () => {
    const t = findTarget(makeCard({}), makeCard({ petrified: true }), null, 2, 0, 1);
    assert(t.isHero, 'petrified hides');
});

test('findTarget — melee passes flyers to hero', () => {
    const t = findTarget(makeCard({}), makeCard({ abilities: ['fly'] }), null, 2, 0, 1);
    assert(t.isHero, 'melee ignores flyers');
});

test('findTarget — melee attacks back if front is flying', () => {
    const t = findTarget(makeCard({}), makeCard({ abilities: ['fly'] }), makeCard({ name: 'GB' }), 2, 0, 1);
    assertEqual(t.card.name, 'GB', 'hits ground back');
    assertEqual(t.col, 0, 'col 0');
});

// ==================== TESTS: Regeneration ====================

testAsync('applySlotRegeneration — heals damaged', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 8, currentHp: 5, abilities: ['regeneration'], regenerationX: 2 });
    room.gameState.players[1].field[0][1] = card;
    await applySlotRegeneration(room, 0, 1, noopLog, noopSleep);
    assertEqual(card.currentHp, 7, '+2 regen');
    cleanupRoom(room);
});

testAsync('applySlotRegeneration — does not overheal', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 4, abilities: ['regeneration'], regenerationX: 3 });
    room.gameState.players[1].field[0][1] = card;
    await applySlotRegeneration(room, 0, 1, noopLog, noopSleep);
    assertEqual(card.currentHp, 5, 'capped at max HP');
    cleanupRoom(room);
});

testAsync('applySlotRegeneration — dead no regen', async () => {
    const room = makeRoom();
    const card = makeCard({ hp: 5, currentHp: 0, abilities: ['regeneration'], regenerationX: 3 });
    room.gameState.players[1].field[0][1] = card;
    await applySlotRegeneration(room, 0, 1, noopLog, noopSleep);
    assertEqual(card.currentHp, 0, 'dead no regen');
    cleanupRoom(room);
});

// ==================== TESTS: Trap effects ====================

testAsync('Trap — standard damage', async () => {
    const room = makeRoom();
    room.gameState.players[2].traps[0] = { name: 'T', type: 'trap', damage: 3, uid: 't1' };
    const a = makeCard({ hp: 6, currentHp: 6, canAttack: true }); room.gameState.players[1].field[0][1] = a;
    room.gameState.players[2].field[0][1] = makeCard({});
    await processTrapsForRow(room, 0, 1, noopLog, noopSleep);
    assertEqual(a.currentHp, 3, '-3 trap dmg');
    assertEqual(room.gameState.players[2].traps[0], null, 'consumed');
    cleanupRoom(room);
});

testAsync('Trap — stun disables attack', async () => {
    const room = makeRoom();
    room.gameState.players[2].traps[0] = { name: 'T', type: 'trap', damage: 1, effect: 'stun', uid: 't2' };
    const a = makeCard({ hp: 10, currentHp: 10, canAttack: true }); room.gameState.players[1].field[0][1] = a;
    room.gameState.players[2].field[0][1] = makeCard({});
    await processTrapsForRow(room, 0, 1, noopLog, noopSleep);
    assertEqual(a.canAttack, false, 'stunned');
    cleanupRoom(room);
});

testAsync('Trap — line damage hits whole row', async () => {
    const room = makeRoom();
    room.gameState.players[2].traps[0] = { name: 'T', type: 'trap', damage: 2, pattern: 'line', uid: 't3' };
    const front = makeCard({ hp: 6, currentHp: 6, canAttack: true }); room.gameState.players[1].field[0][1] = front;
    const back = makeCard({ hp: 6, currentHp: 6 }); room.gameState.players[1].field[0][0] = back;
    room.gameState.players[2].field[0][1] = makeCard({});
    await processTrapsForRow(room, 0, 1, noopLog, noopSleep);
    assertEqual(front.currentHp, 4, 'front -2');
    assertEqual(back.currentHp, 4, 'back -2');
    cleanupRoom(room);
});

testAsync('Trap — poisonLine poisons all on row', async () => {
    const room = makeRoom();
    room.gameState.players[2].traps[0] = { name: 'T', type: 'trap', pattern: 'line', effect: 'poisonLine', poisonAmount: 3, uid: 't4' };
    const a = makeCard({ hp: 10, currentHp: 10, canAttack: true }); room.gameState.players[1].field[0][1] = a;
    const b = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[1].field[0][0] = b;
    const d = makeCard({ hp: 5, currentHp: 5 }); room.gameState.players[2].field[0][1] = d;
    await processTrapsForRow(room, 0, 1, noopLog, noopSleep);
    assert(a.poisonCounters >= 3, 'attacker poisoned');
    assert(b.poisonCounters >= 3, 'ally poisoned');
    assert(d.poisonCounters >= 3, 'defender poisoned');
    assertEqual(room.gameState.players[2].traps[0], null, 'consumed');
    cleanupRoom(room);
});

testAsync('Trap — meleeOnly does NOT trigger on flyer', async () => {
    const room = makeRoom();
    room.gameState.players[2].traps[0] = { name: 'T', type: 'trap', damage: 5, meleeOnly: true, uid: 't5' };
    const flyer = makeCard({ hp: 10, currentHp: 10, canAttack: true, abilities: ['fly'] }); room.gameState.players[1].field[0][1] = flyer;
    room.gameState.players[2].field[0][1] = makeCard({ abilities: ['fly'], canAttack: true });
    await processTrapsForRow(room, 0, 1, noopLog, noopSleep);
    assertEqual(flyer.currentHp, 10, 'flyer not hit');
    assert(room.gameState.players[2].traps[0] !== null, 'trap NOT consumed');
    cleanupRoom(room);
});

testAsync('Trap kill triggers onDeath (Immondice)', async () => {
    const room = makeRoom();
    const imm = makeCard({ name: 'Immondice', hp: 6, currentHp: 6, poisonCounters: 5, onDeath: { absorbAdjacentPoisonThenDamageHero: true }, canAttack: true });
    room.gameState.players[1].field[0][1] = imm;
    room.gameState.players[2].traps[0] = { name: 'T', type: 'trap', damage: 10, uid: 't6' };
    room.gameState.players[2].field[0][1] = makeCard({});
    await processTrapsForRow(room, 0, 1, noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 15, '-5 from Immondice onDeath');
    cleanupRoom(room);
});

// ==================== TESTS: drawCards ====================

testAsync('drawCards — basic', async () => {
    const room = makeRoom();
    room.gameState.players[1].deck = [makeCard({ type: 'creature', hp: 2 }), makeCard({ type: 'creature', hp: 3 })];
    room.gameState.players[1].hand = [];
    await drawCards(room, 1, 2, noopLog, noopSleep, 'test');
    assertEqual(room.gameState.players[1].hand.length, 2, 'drew 2');
    assertEqual(room.gameState.players[1].deck.length, 0, 'deck empty');
    cleanupRoom(room);
});

testAsync('drawCards — limited by deck', async () => {
    const room = makeRoom();
    room.gameState.players[1].deck = [makeCard({ type: 'creature', hp: 2 })];
    room.gameState.players[1].hand = [];
    await drawCards(room, 1, 5, noopLog, noopSleep, 'test');
    assertEqual(room.gameState.players[1].hand.length, 1, 'only 1 available');
    cleanupRoom(room);
});

// ==================== TESTS: processOnPoisonDeathEffects ====================

testAsync('processOnPoisonDeathEffects — drawOnEnemyPoisonDeath', async () => {
    const room = makeRoom();
    room.gameState.players[2].field[1][1] = makeCard({ drawOnEnemyPoisonDeath: 1 });
    room.gameState.players[2].deck = [makeCard({ type: 'creature', hp: 2 })];
    room.gameState.players[2].hand = [];
    const dead = makeCard({ currentHp: 0, poisonCounters: 2, _killedByPoisonTick: true });
    await processOnPoisonDeathEffects(room, [{ card: dead, player: 1, row: 0, col: 1 }], noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hand.length, 1, 'drew 1 on poison death');
    cleanupRoom(room);
});

// ==================== TESTS: Spell effects via applySpell ====================

testAsync('applySpell — draw spell', async () => {
    const room = makeRoom();
    room.gameState.players[1].deck = [makeCard({ type: 'creature', hp: 2 }), makeCard({ type: 'creature', hp: 3 })];
    room.gameState.players[1].hand = [];
    room.gameState.players[1].graveyard = [];
    await applySpell(room, { playerNum: 1, heroName: 'H', spell: { name: 'S', type: 'spell', pattern: 'global', effect: 'draw', amount: 2, uid: 's1' } }, noopLog, noopSleep, { skipReveal: true });
    assertEqual(room.gameState.players[1].hand.length, 2, 'drew 2');
    cleanupRoom(room);
});

testAsync('applySpell — destroy kills target', async () => {
    const room = makeRoom();
    room.gameState.players[2].field[1][1] = makeCard({ hp: 10, currentHp: 10 });
    room.gameState.players[1].graveyard = [];
    await applySpell(room, { playerNum: 1, heroName: 'H', spell: { name: 'S', type: 'spell', pattern: 'single', effect: 'destroy', uid: 's2' }, targetPlayer: 2, row: 1, col: 1 }, noopLog, noopSleep, { skipReveal: true });
    assertEqual(room.gameState.players[2].field[1][1], null, 'destroyed');
    cleanupRoom(room);
});

// ==================== TESTS: Card DB validation ====================

test('All poison cards exist', () => {
    for (const id of ['spores', 'zombie_decharne', 'avatar_du_poison', 'garde_branlante', 'genie_du_sang', 'immondice_des_trefonds', 'nuage_toxique'])
        assert(CardByIdMap.get(id), `${id} exists`);
});

test('Spores onDeath', () => {
    const c = CardByIdMap.get('spores');
    if (c) { assert(c.onDeath.poisonAdjacent, 'poisonAdjacent'); assert(c.onDeath.drawCards, 'drawCards'); }
});

test('Immondice onDeath', () => {
    const c = CardByIdMap.get('immondice_des_trefonds');
    if (c) assert(c.onDeath.absorbAdjacentPoisonThenDamageHero, 'absorbAdjacentPoisonThenDamageHero');
});

test('Avatar du poison endOfCombat', () => {
    const c = CardByIdMap.get('avatar_du_poison');
    if (c) { assert(c.endOfCombat.absorbPoison, 'absorbPoison'); assert(c.abilities.includes('antitoxin'), 'antitoxin'); assert(c.abilities.includes('trample'), 'trample'); }
});

test('Nuage toxique aura', () => {
    const c = CardByIdMap.get('nuage_toxique');
    if (c) { assertEqual(c.aura, 'poisonAmplifier', 'aura'); assert(c.abilities.includes('antitoxin'), 'antitoxin'); assert(c.abilities.includes('spectral'), 'spectral'); }
});

test('Genie du sang aura', () => {
    const c = CardByIdMap.get('genie_du_sang');
    if (c) assertEqual(c.aura, 'poisonHealsAllies', 'aura');
});

test('Serpent emeraude poisonFeedsSelf', () => {
    const c = CardByIdMap.get('serpent_emeraude');
    if (c) { assert(c.poisonFeedsSelf, 'poisonFeedsSelf'); assert(c.abilities.includes('trample'), 'trample'); assert(!c.abilities.includes('antitoxin'), 'no antitoxin'); }
});

// ==================== TESTS: Complex interactions ====================

test('Poison + buffCounters on recalcDynamicAtk', () => {
    const room = makeRoom();
    const card = makeCard({ atk: 2, baseAtk: 2 }); card.poisonCounters = 3; card.buffCounters = 2;
    room.gameState.players[1].field[0][1] = card;
    recalcDynamicAtk(room);
    assertEqual(card.atk, 4, 'base 2 + 2 buff (poison no ATK effect)');
    cleanupRoom(room);
});

test('Multiple onDeath effects from single card', () => {
    const card = makeCard({ poisonCounters: 3, onDeath: { damageHero: 2, poisonExplosion: true, drawCards: 1 } });
    const eff = collectOnDeathEffects([{ card, player: 1, row: 0, col: 1 }]);
    assert(eff.find(e => e.type === 'heroDamage'), 'heroDamage');
    assert(eff.find(e => e.type === 'poisonExplosion'), 'poisonExplosion');
    assert(eff.find(e => e.type === 'drawCards'), 'drawCards');
});

testAsync('Immondice full flow: own poison + adjacent = total damage', async () => {
    const room = makeRoom();
    const a1 = makeCard({ hp: 5, currentHp: 5 }); a1.poisonCounters = 2; room.gameState.players[1].field[0][1] = a1;
    const a2 = makeCard({ hp: 5, currentHp: 5 }); a2.poisonCounters = 4; room.gameState.players[1].field[2][1] = a2;
    const imm = makeCard({ poisonCounters: 3, onDeath: { absorbAdjacentPoisonThenDamageHero: true } });
    const eff = collectOnDeathEffects([{ card: imm, player: 1, row: 1, col: 1 }]);
    await resolvePostCombatEffects(room, eff, noopLog, noopSleep);
    assertEqual(room.gameState.players[2].hp, 11, '-9 (3+2+4)');
    assertEqual(a1.poisonCounters, 0, 'absorbed');
    assertEqual(a2.poisonCounters, 0, 'absorbed');
    cleanupRoom(room);
});

test('Serpent poisonFeedsSelf stacks across multiple applications', () => {
    const room = makeRoom();
    const s = makeCard({ hp: 4, currentHp: 4, atk: 3, riposte: 2, poisonFeedsSelf: true });
    room.gameState.players[1].field[0][1] = s;
    addPoisonCounters(s, 2, { source: 'test' }, room);
    assertEqual(s.poisonCounters, 2, '2 poison'); assertEqual(s.buffCounters, 2, '2 buff'); assertEqual(s.hp, 6, 'hp +2');
    addPoisonCounters(s, 3, { source: 'test' }, room);
    assertEqual(s.poisonCounters, 5, '5 total'); assertEqual(s.buffCounters, 5, '5 buff');
    assertEqual(s.hp, 9, 'hp 4+2+3'); assertEqual(s.currentHp, 9, 'currentHp 4+2+3'); assertEqual(s.riposte, 7, 'riposte 2+2+3');
    cleanupRoom(room);
});


// ==================== TESTS: Ver des tombes + Tri selectif ====================

test('syncMillWatchers — Ver des tombes gains buff from milled creatures', async () => {
    const room = makeRoom();
    const ver = makeCard({ name: 'Ver des tombes', atk: 1, baseAtk: 1, hp: 1, currentHp: 1, riposte: 1, onAllyMillToGraveyard: true });
    room.gameState.players[1].field[0][0] = ver;
    await syncMillWatchers(room, 1, 3, noopLog, noopSleep);
    assertEqual(ver.buffCounters, 3, '3 buff counters from 3 milled creatures');
    assertEqual(ver.currentHp, 4, 'hp 1 + 3');
    assertEqual(ver.riposte, 4, 'riposte 1 + 3');
    cleanupRoom(room);
});

test('syncMillWatchers — dead Ver des tombes does NOT gain buffs', async () => {
    const room = makeRoom();
    const ver = makeCard({ name: 'Ver des tombes', atk: 1, baseAtk: 1, hp: 1, currentHp: 0, riposte: 1, onAllyMillToGraveyard: true });
    room.gameState.players[1].field[0][0] = ver;
    await syncMillWatchers(room, 1, 2, noopLog, noopSleep);
    assertEqual(ver.buffCounters || 0, 0, 'no buffs when dead');
    cleanupRoom(room);
});

test('syncMillWatchers — only affects owning player', async () => {
    const room = makeRoom();
    const ver1 = makeCard({ name: 'Ver p1', atk: 1, baseAtk: 1, hp: 1, currentHp: 1, riposte: 1, onAllyMillToGraveyard: true });
    const ver2 = makeCard({ name: 'Ver p2', atk: 1, baseAtk: 1, hp: 1, currentHp: 1, riposte: 1, onAllyMillToGraveyard: true });
    room.gameState.players[1].field[0][0] = ver1;
    room.gameState.players[2].field[0][0] = ver2;
    await syncMillWatchers(room, 1, 2, noopLog, noopSleep);
    assertEqual(ver1.buffCounters, 2, 'p1 ver buffed');
    assertEqual(ver2.buffCounters || 0, 0, 'p2 ver NOT buffed');
    cleanupRoom(room);
});

test('Tri selectif card definition exists', () => {
    const card = CardByIdMap.get('tri_selectif');
    assert(card, 'tri_selectif exists');
    assertEqual(card.effect, 'triSelectif', 'triSelectif effect');
});

test('Ver des tombes card definition exists', () => {
    const card = CardByIdMap.get('ver_des_tombes');
    assert(card, 'ver_des_tombes exists');
    assertEqual(card.onAllyMillToGraveyard, true, 'has onAllyMillToGraveyard');
});

// ==================== RUN ====================

setTimeout(() => {
    console.log('\n' + '='.repeat(50));
    console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
    console.log('='.repeat(50));
    process.exit(failCount > 0 ? 1 : 0);
}, 5000);
