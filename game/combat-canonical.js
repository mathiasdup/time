const CANONICAL_COMBAT_SLOT_PHASES = Object.freeze([
    'pre_hit',
    'hit_attacker',
    'on_hit_attacker',
    'riposte',
    'on_hit_riposte',
    'return_to_slot',
    'death_detect_pre',
    'grave_animations_pre',
    'power_primary',
    'life_abilities',
    'end_of_combat',
    'post_end_of_combat',
    'poison_tick',
    'death_detect_post',
    'grave_animations_post',
    'regeneration',
    'power_secondary'
]);

function createCombatCycleId(room, row, col) {
    if (!room || !room.gameState) {
        return `cycle:0:${row}:${col}:${Date.now()}`;
    }
    room.gameState._combatCycleSeq = (room.gameState._combatCycleSeq || 0) + 1;
    const turn = room.gameState.turn || 0;
    return `cycle:${turn}:${row}:${col}:${room.gameState._combatCycleSeq}`;
}

function _markOncePerCycle(card, cycleId, key) {
    if (!card || !cycleId) return true;
    if (card[key] === cycleId) return false;
    card[key] = cycleId;
    return true;
}

function markDeathResolvedInCycle(card, cycleId) {
    return _markOncePerCycle(card, cycleId, '_deathResolvedCycleId');
}

function markOnDeathResolvedInCycle(card, cycleId) {
    return _markOncePerCycle(card, cycleId, '_onDeathResolvedCycleId');
}

function markPoisonDeathResolvedInCycle(card, cycleId) {
    return _markOncePerCycle(card, cycleId, '_poisonDeathResolvedCycleId');
}

function validateCanonicalPhaseSequence(phases) {
    if (!Array.isArray(phases)) {
        return { ok: false, reason: 'not_array', index: -1 };
    }
    const indexByPhase = new Map();
    for (let i = 0; i < CANONICAL_COMBAT_SLOT_PHASES.length; i += 1) {
        indexByPhase.set(CANONICAL_COMBAT_SLOT_PHASES[i], i);
    }
    let lastIdx = -1;
    for (let i = 0; i < phases.length; i += 1) {
        const phase = phases[i];
        if (!indexByPhase.has(phase)) {
            return { ok: false, reason: 'unknown_phase', index: i, phase };
        }
        const idx = indexByPhase.get(phase);
        if (idx < lastIdx) {
            return {
                ok: false,
                reason: 'out_of_order',
                index: i,
                phase,
                previousPhase: CANONICAL_COMBAT_SLOT_PHASES[lastIdx]
            };
        }
        lastIdx = idx;
    }
    return { ok: true };
}

module.exports = {
    CANONICAL_COMBAT_SLOT_PHASES,
    createCombatCycleId,
    markDeathResolvedInCycle,
    markOnDeathResolvedInCycle,
    markPoisonDeathResolvedInCycle,
    validateCanonicalPhaseSequence
};
