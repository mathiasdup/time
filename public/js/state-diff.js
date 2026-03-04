// state-diff.js — Client-side state diffing for surgical renders
// Compares previous vs current game state and returns a diff descriptor.
// Used by renderDelta() to avoid full DOM reconstruction.

const StateDiff = (() => {
    let _prev = null;
    let _prevV = 0;

    function diff(prev, next) {
        if (!prev || !next) return { full: true };

        const d = { full: false };
        const pm = prev.me, nm = next.me;
        const po = prev.opponent, no_ = next.opponent;

        // Phase change → full render
        if (prev.phase !== next.phase) {
            d.phaseChanged = true;
        }

        // Hero HP
        if (pm && nm && pm.hp !== nm.hp) d.meHp = nm.hp;
        if (po && no_ && po.hp !== no_.hp) d.oppHp = no_.hp;

        // Mana
        if (pm && nm && (pm.energy !== nm.energy || pm.maxEnergy !== nm.maxEnergy)) {
            d.meMana = { energy: nm.energy, max: nm.maxEnergy };
        }
        if (po && no_ && (po.energy !== no_.energy || po.maxEnergy !== no_.maxEnergy)) {
            d.oppMana = { energy: no_.energy, max: no_.maxEnergy };
        }

        // Deck counts
        if (pm && nm && pm.deckCount !== nm.deckCount) d.meDeckCount = nm.deckCount;
        if (po && no_ && po.deckCount !== no_.deckCount) d.oppDeckCount = no_.deckCount;

        // Graveyard (server only includes graveyard array when it changed)
        if (nm && nm.graveyard !== undefined) d.meGraveyard = true;
        if (no_ && no_.graveyard !== undefined) d.oppGraveyard = true;

        // Field: compare slot by slot
        d.fieldChanges = [];
        const sides = [
            { stateKey: 'me', owner: 'me' },
            { stateKey: 'opponent', owner: 'opp' }
        ];
        for (const { stateKey, owner } of sides) {
            const pf = prev[stateKey]?.field;
            const nf = next[stateKey]?.field;
            if (!pf || !nf) continue;
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const pc = pf[r]?.[c];
                    const nc = nf[r]?.[c];
                    if (!pc && !nc) continue;
                    if (!pc || !nc || pc.uid !== nc.uid) {
                        d.fieldChanges.push({ owner, r, c, type: 'replace' });
                    } else if (pc.currentHp !== nc.currentHp || pc.hp !== nc.hp || pc.atk !== nc.atk ||
                               pc.poisonCounters !== nc.poisonCounters || pc.shield !== nc.shield ||
                               pc.camouflage !== nc.camouflage || pc.entpierre !== nc.entpierre) {
                        d.fieldChanges.push({ owner, r, c, type: 'stats' });
                    }
                }
            }
        }

        // Hand changes
        const prevHandUids = pm?.hand ? pm.hand.map(c => c?.uid) : [];
        const nextHandUids = nm?.hand ? nm.hand.map(c => c?.uid) : [];
        d.meHandChanged = prevHandUids.length !== nextHandUids.length ||
                          prevHandUids.some((u, i) => u !== nextHandUids[i]);
        d.oppHandChanged = (po?.handCount !== no_?.handCount);

        // Traps
        const _trapSig = (traps) => {
            if (!traps) return '';
            return traps.map(t => t ? (t.uid || t.id || '?') : '_').join(',');
        };
        d.meTrapsChanged = _trapSig(pm?.traps) !== _trapSig(nm?.traps);
        d.oppTrapsChanged = _trapSig(po?.traps) !== _trapSig(no_?.traps);

        // Ready state
        if (pm?.ready !== nm?.ready) d.meReadyChanged = true;

        return d;
    }

    function remember(s) {
        // Deep clone to avoid state mutation issues
        try {
            _prev = JSON.parse(JSON.stringify(s));
        } catch (e) {
            _prev = null;
        }
        _prevV = s?._v || 0;
    }

    function getPrev() { return _prev; }
    function getPrevVersion() { return _prevV; }

    return { diff, remember, getPrev, getPrevVersion };
})();
