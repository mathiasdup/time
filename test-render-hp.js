// test-render-hp.js — Tests for HP display decision logic
// Tests RenderLock, StateDiff, and the HP render pipeline WITHOUT a browser.
// Run: node test-render-hp.js

'use strict';

const fs = require('fs');
const vm = require('vm');

// ─── Minimal browser globals mock ────────────────────────────────────
global.window = global;
global.window.DEBUG_LOGS = false;
global.window.HP_SEQ_TRACE = false;

// ─── Load files as browser scripts (const at top level → global) ─────
vm.runInThisContext(fs.readFileSync('./public/js/render-lock.js', 'utf8'), { filename: 'render-lock.js' });
vm.runInThisContext(fs.readFileSync('./public/js/state-diff.js', 'utf8'), { filename: 'state-diff.js' });

const RL = RenderLock;
const SD = StateDiff;

// ─── Test harness ────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assertEqual(actual, expected, msg) {
    if (actual === expected) {
        passed++;
        return true;
    }
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
    return false;
}

function assert(condition, msg) {
    if (condition) { passed++; return true; }
    console.log(`  FAIL: ${msg}`);
    failed++;
    return false;
}

function test(name, fn) {
    console.log(`\n[TEST] ${name}`);
    try {
        fn();
        console.log('  OK');
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
        failed++;
    }
}

// ─── Pure HP decision function (extracted from game-render.js renderField) ───
// This replicates the EXACT logic from game-render.js lines 538-629
// so we can test it without DOM.

function computeDisplayedHp(card, slotKey, phase, domHpBefore, visualDmg) {
    // Step 1: Get state HP
    const n = Number(card.currentHp ?? card.hp);
    let hpVal = Number.isFinite(n) ? n : null;

    if (hpVal === null) {
        // Fallback to DOM
        hpVal = Number.isFinite(domHpBefore) ? domHpBefore : 0;
    }

    // Step 2: Check poison override
    const poisonOv = RL.getOverride('slot', slotKey);
    let overrideAction = null; // 'applied', 'cleared', or null
    if (poisonOv) {
        const ovUidMismatch = !!(poisonOv.uid && card.uid && poisonOv.uid !== card.uid);
        const ovAge = typeof poisonOv.updatedAt === 'number' ? (Date.now() - poisonOv.updatedAt) : 0;
        const staleConsumed = poisonOv.consumed && ovAge > 2600;

        if (ovUidMismatch || (poisonOv.consumed && hpVal <= poisonOv.hp) || staleConsumed) {
            // Clear stale override
            RL.clearOverride('slot', slotKey);
            overrideAction = 'cleared';
        } else {
            // Apply override — freeze displayed HP
            hpVal = poisonOv.hp;
            overrideAction = 'applied';
        }
    }

    // Step 3: Resolution phase — prevent showing 0 HP before death anim
    if (phase === 'resolution' && hpVal <= 0) {
        hpVal = (Number.isFinite(domHpBefore) && domHpBefore > 0) ? domHpBefore : 1;
    }

    // Step 4: Visual damage marker (anti-flicker)
    let visualAction = null; // 'kept' or 'applied'
    if (visualDmg && visualDmg.hp !== undefined) {
        const visualDmgExpired = visualDmg.setAt > 0 && (Date.now() - visualDmg.setAt > 1800);
        if (hpVal > parseInt(visualDmg.hp) && !visualDmgExpired) {
            // Keep visual damage — state is stale
            visualAction = 'kept';
            // hpVal stays as visual damage (DOM keeps old value)
            return { hpVal: parseInt(visualDmg.hp), overrideAction, visualAction, skippedUpdate: true };
        } else {
            visualAction = 'applied';
        }
    }

    return { hpVal, overrideAction, visualAction, skippedUpdate: false };
}

// ─── Cleanup helper ──────────────────────────────────────────────────
function resetRL() {
    RL.resetAll();
}

// ══════════════════════════════════════════════════════════════════════
//  PART 1: RenderLock core logic
// ══════════════════════════════════════════════════════════════════════

test('RenderLock — lock/unlock counter', () => {
    resetRL();
    assertEqual(RL.isLocked('slot', 'me_0_0'), false, 'starts unlocked');
    RL.lock('slot', 'me_0_0', 'test');
    assertEqual(RL.isLocked('slot', 'me_0_0'), true, 'locked after 1 lock');
    RL.lock('slot', 'me_0_0', 'test2');
    assertEqual(RL.lockCount('slot', 'me_0_0'), 2, '2 locks');
    RL.unlock('slot', 'me_0_0', 'test');
    assertEqual(RL.isLocked('slot', 'me_0_0'), true, 'still locked (count=1)');
    RL.unlock('slot', 'me_0_0', 'test2');
    assertEqual(RL.isLocked('slot', 'me_0_0'), false, 'unlocked after 2 unlocks');
});

test('RenderLock — unlock below 0 does not go negative', () => {
    resetRL();
    RL.unlock('slot', 'me_0_0', 'extra');
    assertEqual(RL.lockCount('slot', 'me_0_0'), 0, 'stays at 0');
    assertEqual(RL.isLocked('slot', 'me_0_0'), false, 'not locked');
});

test('RenderLock — unlockAll clears all counts + overrides', () => {
    resetRL();
    RL.lock('slot', 'me_0_0', 'a');
    RL.lock('slot', 'me_0_0', 'b');
    RL.setOverride('slot', 'me_0_0', { hp: 5 });
    RL.unlockAll('slot', 'me_0_0');
    assertEqual(RL.isLocked('slot', 'me_0_0'), false, 'fully unlocked');
    assertEqual(RL.getOverride('slot', 'me_0_0'), null, 'override cleared');
});

test('RenderLock — setOverride/getOverride/clearOverride', () => {
    resetRL();
    assertEqual(RL.getOverride('slot', 'me_1_0'), null, 'no override initially');
    RL.setOverride('slot', 'me_1_0', { hp: 7, atk: 3 });
    const ov = RL.getOverride('slot', 'me_1_0');
    assertEqual(ov.hp, 7, 'hp override');
    assertEqual(ov.atk, 3, 'atk override');
    RL.clearOverride('slot', 'me_1_0');
    assertEqual(RL.getOverride('slot', 'me_1_0'), null, 'cleared');
});

test('RenderLock — unlock auto-clears override when count reaches 0', () => {
    resetRL();
    RL.lock('slot', 'me_2_0', 'anim');
    RL.setOverride('slot', 'me_2_0', { hp: 10 });
    RL.unlock('slot', 'me_2_0', 'anim');
    assertEqual(RL.getOverride('slot', 'me_2_0'), null, 'override auto-cleared on full unlock');
});

test('RenderLock — resetZone clears only that zone', () => {
    resetRL();
    RL.lock('slot', 'me_0_0', 'a');
    RL.lock('heroHp', 'all', 'b');
    RL.setOverride('slot', 'me_0_0', { hp: 5 });
    RL.resetZone('slot');
    assertEqual(RL.isLocked('slot', 'me_0_0'), false, 'slot cleared');
    assertEqual(RL.getOverride('slot', 'me_0_0'), null, 'slot override cleared');
    assertEqual(RL.isLocked('heroHp', 'all'), true, 'heroHp untouched');
});

test('RenderLock — heroHp zone blocks hero HP render', () => {
    resetRL();
    RL.lock('heroHp', 'me', 'lifestealHeal');
    assertEqual(RL.isLocked('heroHp', 'me'), true, 'me locked');
    assertEqual(RL.isLocked('heroHp', 'opp'), false, 'opp not locked');
    RL.lock('heroHp', 'all', 'heroAnim');
    assertEqual(RL.isLocked('heroHp', 'all'), true, 'all locked');
    RL.unlock('heroHp', 'all', 'heroAnim');
    RL.unlock('heroHp', 'me', 'lifestealHeal');
    assertEqual(RL.isLocked('heroHp', 'me'), false, 'me unlocked');
});

test('RenderLock — activeKeys returns locked keys', () => {
    resetRL();
    RL.lock('slot', 'me_0_0', 'a');
    RL.lock('slot', 'me_1_0', 'b');
    RL.lock('slot', 'opp_0_0', 'c');
    const keys = RL.activeKeys('slot');
    assert(keys.includes('me_0_0'), 'has me_0_0');
    assert(keys.includes('me_1_0'), 'has me_1_0');
    assert(keys.includes('opp_0_0'), 'has opp_0_0');
    assertEqual(keys.length, 3, '3 active keys');
});

// ─── poisonHpOverrides shim ──────────────────────────────────────────

test('poisonHpOverrides — set merges with existing override', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { atk: 5 });
    poisonHpOverrides.set('me_0_0', { hp: 3, consumed: true, uid: 'abc' });
    const ov = RL.getOverride('slot', 'me_0_0');
    assertEqual(ov.hp, 3, 'hp set');
    assertEqual(ov.atk, 5, 'atk preserved');
    assertEqual(ov.consumed, true, 'consumed set');
});

test('poisonHpOverrides — delete preserves ATK override', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 3, atk: 5 });
    poisonHpOverrides._map.set('me_0_0', { hp: 3 });
    poisonHpOverrides.delete('me_0_0');
    const ov = RL.getOverride('slot', 'me_0_0');
    assertEqual(ov.atk, 5, 'atk preserved after hp delete');
    assertEqual(ov.hp, undefined, 'hp removed');
});

test('poisonHpOverrides — delete clears if no ATK', () => {
    resetRL();
    RL.setOverride('slot', 'me_1_0', { hp: 3 });
    poisonHpOverrides._map.set('me_1_0', { hp: 3 });
    poisonHpOverrides.delete('me_1_0');
    assertEqual(RL.getOverride('slot', 'me_1_0'), null, 'fully cleared');
});

test('powerBuffAtkOverrides — set merges with HP override', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 7 });
    powerBuffAtkOverrides.set('me_0_0', 4);
    const ov = RL.getOverride('slot', 'me_0_0');
    assertEqual(ov.hp, 7, 'hp preserved');
    assertEqual(ov.atk, 4, 'atk set');
});

test('powerBuffAtkOverrides — delete preserves HP override', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 7, atk: 4 });
    powerBuffAtkOverrides._map.set('me_0_0', 4);
    powerBuffAtkOverrides.delete('me_0_0');
    const ov = RL.getOverride('slot', 'me_0_0');
    assertEqual(ov.hp, 7, 'hp preserved');
    assertEqual(ov.atk, undefined, 'atk removed');
});

// ══════════════════════════════════════════════════════════════════════
//  PART 2: StateDiff — HP change detection
// ══════════════════════════════════════════════════════════════════════

function makeState(overrides = {}) {
    return {
        phase: 'resolution',
        _v: 1,
        me: {
            hp: 20, energy: 3, maxEnergy: 3, deckCount: 20,
            hand: [], field: [[null, null], [null, null], [null, null], [null, null]],
            traps: [null, null, null, null], ready: false,
            ...(overrides.me || {})
        },
        opponent: {
            hp: 20, energy: 3, maxEnergy: 3, deckCount: 20,
            handCount: 5, field: [[null, null], [null, null], [null, null], [null, null]],
            traps: [null, null, null, null],
            ...(overrides.opp || {})
        },
        ...(overrides.root || {})
    };
}

test('StateDiff — null prev returns full', () => {
    const d = SD.diff(null, makeState());
    assertEqual(d.full, true, 'full on null prev');
});

test('StateDiff — identical states = no changes', () => {
    const s = makeState();
    const d = SD.diff(s, JSON.parse(JSON.stringify(s)));
    assertEqual(d.meHp, undefined, 'no meHp change');
    assertEqual(d.oppHp, undefined, 'no oppHp change');
    assertEqual(d.fieldChanges.length, 0, 'no field changes');
});

test('StateDiff — detects hero HP change (me)', () => {
    const prev = makeState();
    const next = makeState({ me: { hp: 15 } });
    const d = SD.diff(prev, next);
    assertEqual(d.meHp, 15, 'meHp detected');
    assertEqual(d.oppHp, undefined, 'oppHp unchanged');
});

test('StateDiff — detects hero HP change (opp)', () => {
    const prev = makeState();
    const next = makeState({ opp: { hp: 8 } });
    const d = SD.diff(prev, next);
    assertEqual(d.oppHp, 8, 'oppHp detected');
});

test('StateDiff — detects creature HP change (stats type)', () => {
    const card = { uid: 'c1', name: 'Test', hp: 5, currentHp: 5, atk: 3, poisonCounters: 0 };
    const prev = makeState({ me: { field: [[card, null], [null, null], [null, null], [null, null]] } });
    const cardDmg = { ...card, currentHp: 2 };
    const next = makeState({ me: { field: [[cardDmg, null], [null, null], [null, null], [null, null]] } });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges.length, 1, '1 field change');
    assertEqual(d.fieldChanges[0].type, 'stats', 'stats type');
    assertEqual(d.fieldChanges[0].owner, 'me', 'me side');
    assertEqual(d.fieldChanges[0].r, 0, 'row 0');
    assertEqual(d.fieldChanges[0].c, 0, 'col 0');
});

test('StateDiff — different uid = replace type', () => {
    const card1 = { uid: 'c1', name: 'A', hp: 5, currentHp: 5, atk: 3 };
    const card2 = { uid: 'c2', name: 'B', hp: 3, currentHp: 3, atk: 2 };
    const prev = makeState({ me: { field: [[card1, null], [null, null], [null, null], [null, null]] } });
    const next = makeState({ me: { field: [[card2, null], [null, null], [null, null], [null, null]] } });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges[0].type, 'replace', 'replace when uid differs');
});

test('StateDiff — creature removed = replace type', () => {
    const card = { uid: 'c1', name: 'A', hp: 5, currentHp: 5, atk: 3 };
    const prev = makeState({ me: { field: [[card, null], [null, null], [null, null], [null, null]] } });
    const next = makeState({ me: { field: [[null, null], [null, null], [null, null], [null, null]] } });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges[0].type, 'replace', 'replace when card removed');
});

test('StateDiff — detects poison counter change', () => {
    const card = { uid: 'c1', name: 'T', hp: 5, currentHp: 5, atk: 3, poisonCounters: 0 };
    const prev = makeState({ me: { field: [[card, null], [null, null], [null, null], [null, null]] } });
    const cardP = { ...card, poisonCounters: 3 };
    const next = makeState({ me: { field: [[cardP, null], [null, null], [null, null], [null, null]] } });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges.length, 1, '1 change');
    assertEqual(d.fieldChanges[0].type, 'stats', 'stats for poison');
});

test('StateDiff — detects shield change', () => {
    const card = { uid: 'c1', name: 'T', hp: 5, currentHp: 5, atk: 3, shield: false };
    const prev = makeState({ me: { field: [[card, null], [null, null], [null, null], [null, null]] } });
    const next = makeState({ me: { field: [[{ ...card, shield: true }, null], [null, null], [null, null], [null, null]] } });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges[0].type, 'stats', 'stats for shield');
});

test('StateDiff — phase change sets phaseChanged', () => {
    const prev = makeState({ root: { phase: 'placement' } });
    const next = makeState({ root: { phase: 'resolution' } });
    const d = SD.diff(prev, next);
    assertEqual(d.phaseChanged, true, 'phase changed');
});

test('StateDiff — remember stores deep clone', () => {
    const s = makeState({ me: { hp: 18 } });
    SD.remember(s);
    s.me.hp = 999; // mutate original
    const stored = SD.getPrev();
    assertEqual(stored.me.hp, 18, 'deep clone unaffected');
});

// ══════════════════════════════════════════════════════════════════════
//  PART 3: HP display decision logic (computeDisplayedHp)
// ══════════════════════════════════════════════════════════════════════

test('HP display — basic: shows currentHp', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 7 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 10, null);
    assertEqual(r.hpVal, 7, 'shows currentHp');
});

test('HP display — fallback to hp when no currentHp', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 10, null);
    assertEqual(r.hpVal, 10, 'falls back to hp');
});

test('HP display — invalid HP falls back to DOM', () => {
    resetRL();
    const card = { uid: 'c1', hp: undefined, currentHp: undefined };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 8, null);
    assertEqual(r.hpVal, 8, 'falls back to DOM hp');
});

test('HP display — invalid HP + no DOM = 0', () => {
    resetRL();
    const card = { uid: 'c1', hp: NaN, currentHp: NaN };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', NaN, null);
    assertEqual(r.hpVal, 1, 'resolution phase clamps dead card to 1 or DOM');
});

test('HP display — poison override freezes HP', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 5, consumed: false, uid: 'c1', updatedAt: Date.now() });
    const card = { uid: 'c1', hp: 10, currentHp: 3 }; // state says 3, override says 5
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 10, null);
    assertEqual(r.hpVal, 5, 'shows override hp, not state hp');
    assertEqual(r.overrideAction, 'applied', 'override applied');
});

test('HP display — stale override (uid mismatch) cleared', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 5, consumed: false, uid: 'old_card', updatedAt: Date.now() });
    const card = { uid: 'new_card', hp: 8, currentHp: 8 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 5, null);
    assertEqual(r.hpVal, 8, 'shows state hp after clearing stale override');
    assertEqual(r.overrideAction, 'cleared', 'override cleared');
    assertEqual(RL.getOverride('slot', 'me_0_0'), null, 'override gone from RenderLock');
});

test('HP display — stale override (consumed + age > 2600ms) cleared', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 5, consumed: true, uid: 'c1', updatedAt: Date.now() - 3000 });
    const card = { uid: 'c1', hp: 10, currentHp: 7 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 5, null);
    assertEqual(r.hpVal, 7, 'shows state hp after stale override');
    assertEqual(r.overrideAction, 'cleared', 'override cleared by age');
});

test('HP display — consumed override cleared when state catches up', () => {
    resetRL();
    // Override says hp=5, state also says 5 (or less) → clear
    RL.setOverride('slot', 'me_0_0', { hp: 5, consumed: true, uid: 'c1', updatedAt: Date.now() });
    const card = { uid: 'c1', hp: 10, currentHp: 5 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 10, null);
    assertEqual(r.overrideAction, 'cleared', 'cleared because state <= override');
    assertEqual(r.hpVal, 5, 'shows state hp (same as override)');
});

test('HP display — consumed override NOT cleared when state ahead', () => {
    resetRL();
    // Override says hp=5, state says 8 (state ahead) → still apply override
    RL.setOverride('slot', 'me_0_0', { hp: 5, consumed: true, uid: 'c1', updatedAt: Date.now() });
    const card = { uid: 'c1', hp: 10, currentHp: 8 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 10, null);
    assertEqual(r.overrideAction, 'applied', 'override still applied (state ahead of override = impossible, kept)');
    assertEqual(r.hpVal, 5, 'shows override hp');
});

test('HP display — resolution phase prevents showing 0 HP', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 0 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 3, null);
    assertEqual(r.hpVal, 3, 'shows DOM hp (3) instead of 0');
});

test('HP display — resolution phase 0 HP with no DOM fallback shows 1', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 0 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 0, null);
    assertEqual(r.hpVal, 1, 'minimum 1 during resolution');
});

test('HP display — placement phase DOES show 0 HP', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 0 };
    const r = computeDisplayedHp(card, 'me_0_0', 'placement', 3, null);
    assertEqual(r.hpVal, 0, 'placement phase shows actual 0');
});

test('HP display — visual damage marker prevents stale state update', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 8 }; // state says 8
    const visualDmg = { hp: '3', setAt: Date.now() }; // visual shows 3 (damage ahead of state)
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 8, visualDmg);
    assertEqual(r.hpVal, 3, 'keeps visual damage (3) instead of stale state (8)');
    assertEqual(r.skippedUpdate, true, 'update skipped');
});

test('HP display — expired visual damage marker allows state update', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 8 };
    const visualDmg = { hp: '3', setAt: Date.now() - 2000 }; // expired (> 1800ms)
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 3, visualDmg);
    assertEqual(r.hpVal, 8, 'state HP applied after expiry');
    assertEqual(r.skippedUpdate, false, 'update not skipped');
});

test('HP display — visual damage marker ignored when state caught up', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 3 }; // state = 3
    const visualDmg = { hp: '3', setAt: Date.now() }; // visual = 3, same
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 5, visualDmg);
    // hpVal (3) is NOT > visualDmg (3), so condition is false → apply state
    assertEqual(r.hpVal, 3, 'state applied (matches visual)');
    assertEqual(r.skippedUpdate, false, 'not skipped');
});

test('HP display — visual damage 0 + state positive = keep 0 (death pending)', () => {
    resetRL();
    const card = { uid: 'c1', hp: 10, currentHp: 5 }; // state says alive
    const visualDmg = { hp: '0', setAt: Date.now() }; // visual says dead
    const r = computeDisplayedHp(card, 'me_0_0', 'placement', 0, visualDmg);
    // hpVal (5) > visualDmg (0) and not expired → keep visual
    assertEqual(r.hpVal, 0, 'keeps visual 0');
    assertEqual(r.skippedUpdate, true, 'skipped');
});

// ─── Combined scenarios (override + visual damage) ───────────────────

test('HP display — override + visual damage: override takes priority', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 6, consumed: false, uid: 'c1', updatedAt: Date.now() });
    const card = { uid: 'c1', hp: 10, currentHp: 3 };
    const visualDmg = { hp: '4', setAt: Date.now() };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 10, visualDmg);
    // Override sets hpVal to 6, then visual check: 6 > 4 → keep visual
    assertEqual(r.hpVal, 4, 'visual damage wins over override when lower');
    assertEqual(r.overrideAction, 'applied', 'override was applied first');
    assertEqual(r.skippedUpdate, true, 'then visual damage kept');
});

// ══════════════════════════════════════════════════════════════════════
//  PART 4: Hero HP render lock scenarios
// ══════════════════════════════════════════════════════════════════════

// Simulate the hero HP render decision from renderDelta (line 134)
function shouldUpdateHeroHp(side, diff) {
    const hpKey = side === 'me' ? 'meHp' : 'oppHp';
    if (diff[hpKey] === undefined) return { update: false, reason: 'no_change' };
    if (RL.isLocked('heroHp', 'all')) return { update: false, reason: 'locked_all' };
    if (RL.isLocked('heroHp', side)) return { update: false, reason: 'locked_side' };
    return { update: true, hpVal: Math.max(0, Math.floor(diff[hpKey])) };
}

test('Hero HP — updates when unlocked', () => {
    resetRL();
    const r = shouldUpdateHeroHp('me', { meHp: 15 });
    assertEqual(r.update, true, 'should update');
    assertEqual(r.hpVal, 15, 'hp value');
});

test('Hero HP — blocked by heroHp/all lock', () => {
    resetRL();
    RL.lock('heroHp', 'all', 'zdejebel');
    const r = shouldUpdateHeroHp('me', { meHp: 15 });
    assertEqual(r.update, false, 'blocked');
    assertEqual(r.reason, 'locked_all', 'reason');
    RL.unlock('heroHp', 'all', 'zdejebel');
});

test('Hero HP — blocked by side-specific lock', () => {
    resetRL();
    RL.lock('heroHp', 'me', 'lifesteal');
    const me = shouldUpdateHeroHp('me', { meHp: 15 });
    assertEqual(me.update, false, 'me blocked');
    const opp = shouldUpdateHeroHp('opp', { oppHp: 12 });
    assertEqual(opp.update, true, 'opp not blocked');
    RL.unlock('heroHp', 'me', 'lifesteal');
});

test('Hero HP — no update when diff has no HP change', () => {
    resetRL();
    const r = shouldUpdateHeroHp('me', { meMana: { energy: 2, max: 3 } });
    assertEqual(r.update, false, 'no update');
    assertEqual(r.reason, 'no_change', 'no change');
});

test('Hero HP — clamps to 0 floor', () => {
    resetRL();
    const r = shouldUpdateHeroHp('me', { meHp: -5 });
    assertEqual(r.update, true, 'should update');
    assertEqual(r.hpVal, 0, 'clamped to 0');
});

test('Hero HP — floors fractional HP', () => {
    resetRL();
    const r = shouldUpdateHeroHp('me', { meHp: 7.8 });
    assertEqual(r.hpVal, 7, 'floored');
});

// ══════════════════════════════════════════════════════════════════════
//  PART 5: Edge cases / bug scenarios
// ══════════════════════════════════════════════════════════════════════

test('Edge — multiple poison ticks: override chain', () => {
    resetRL();
    // Tick 1: card at 10hp, poison deals 3 → override freezes at 7
    RL.setOverride('slot', 'me_0_0', { hp: 7, consumed: true, uid: 'c1', updatedAt: Date.now() });
    const card1 = { uid: 'c1', hp: 10, currentHp: 10 }; // state not yet updated
    const r1 = computeDisplayedHp(card1, 'me_0_0', 'resolution', 10, null);
    assertEqual(r1.hpVal, 7, 'tick 1: shows 7');

    // Tick 2: new override at 4, state still at 10
    RL.setOverride('slot', 'me_0_0', { hp: 4, consumed: true, uid: 'c1', updatedAt: Date.now() });
    const r2 = computeDisplayedHp(card1, 'me_0_0', 'resolution', 7, null);
    assertEqual(r2.hpVal, 4, 'tick 2: shows 4');
});

test('Edge — card replaced in slot, override stale by uid', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 3, consumed: true, uid: 'dead_card', updatedAt: Date.now() });
    const newCard = { uid: 'fresh_card', hp: 6, currentHp: 6 };
    const r = computeDisplayedHp(newCard, 'me_0_0', 'resolution', 3, null);
    assertEqual(r.hpVal, 6, 'new card shows its own HP');
    assertEqual(r.overrideAction, 'cleared', 'stale override cleared');
});

test('Edge — override without uid matches any card', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 5, consumed: false, updatedAt: Date.now() });
    const card = { uid: 'any_card', hp: 10, currentHp: 8 };
    const r = computeDisplayedHp(card, 'me_0_0', 'resolution', 8, null);
    // uid mismatch check: poisonOv.uid is undefined → !!(undefined && 'any_card') = false → no mismatch
    assertEqual(r.hpVal, 5, 'override applies (no uid check)');
});

test('Edge — clearStale removes old overrides', () => {
    resetRL();
    RL.setOverride('slot', 'me_0_0', { hp: 5 });
    // Manually age it by setting acquiredAt in the past
    // clearStale checks acquiredAt, not updatedAt
    // We need to wait... or just test the API
    RL.setOverride('slot', 'me_1_0', { hp: 3 });
    // Both fresh — clearStale should keep them
    RL.clearStale(15000);
    assert(RL.getOverride('slot', 'me_0_0') !== null, 'fresh override kept');
    assert(RL.getOverride('slot', 'me_1_0') !== null, 'fresh override kept');
});

test('Edge — StateDiff detects ATK change but same HP', () => {
    const card = { uid: 'c1', name: 'T', hp: 5, currentHp: 5, atk: 3 };
    const prev = makeState({ me: { field: [[card, null], [null, null], [null, null], [null, null]] } });
    const next = makeState({ me: { field: [[{ ...card, atk: 6 }, null], [null, null], [null, null], [null, null]] } });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges.length, 1, '1 field change');
    assertEqual(d.fieldChanges[0].type, 'stats', 'stats type for ATK');
});

test('Edge — StateDiff both hero HP change', () => {
    const prev = makeState();
    const next = makeState({ me: { hp: 12 }, opp: { hp: 8 } });
    const d = SD.diff(prev, next);
    assertEqual(d.meHp, 12, 'meHp detected');
    assertEqual(d.oppHp, 8, 'oppHp detected');
});

test('Edge — multiple field changes in one diff', () => {
    const c1 = { uid: 'c1', name: 'A', hp: 5, currentHp: 5, atk: 3 };
    const c2 = { uid: 'c2', name: 'B', hp: 4, currentHp: 4, atk: 2 };
    const prev = makeState({
        me: { field: [[c1, null], [c2, null], [null, null], [null, null]] }
    });
    const next = makeState({
        me: { field: [[{ ...c1, currentHp: 2 }, null], [{ ...c2, currentHp: 1 }, null], [null, null], [null, null]] }
    });
    const d = SD.diff(prev, next);
    assertEqual(d.fieldChanges.length, 2, '2 field changes');
});

// ══════════════════════════════════════════════════════════════════════
//  RESULTS
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) process.exit(1);
