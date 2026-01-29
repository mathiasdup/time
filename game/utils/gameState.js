// =============================================
// Gestion de l'état du jeu
// =============================================

/**
 * Réinitialise un joueur pour un nouveau tour
 * @param {Object} player - État du joueur
 */
function resetPlayerForNewTurn(player) {
    player.ready = false;
    player.inDeployPhase = false;
    player.pendingActions = [];
    player.spellsCastThisTurn = 0;
    player.heroAttackedThisTurn = false;
}

/**
 * Crée l'état public du jeu visible par un joueur
 * (cache les informations de l'adversaire comme les cartes en main)
 * @param {Object} room - La room
 * @param {number} forPlayer - Numéro du joueur (1 ou 2)
 * @returns {Object}
 */
function getPublicGameState(room, forPlayer) {
    const gs = room.gameState;
    const me = gs.players[forPlayer];
    const oppNum = forPlayer === 1 ? 2 : 1;
    const opp = gs.players[oppNum];
    const isPlanning = gs.phase === 'planning';

    return {
        phase: gs.phase,
        turn: gs.turn,
        turnTime: room.turnTime,
        activePlayer: gs.activePlayer,
        me: {
            hp: me.hp,
            energy: me.energy,
            maxEnergy: me.maxEnergy,
            hand: me.hand,
            deckCount: me.deck.length,
            field: me.field,
            graveyard: me.graveyard,
            traps: me.traps,
            trapCards: me.trapCards,
            hero: me.hero,
            heroName: me.heroName,
            ready: me.ready,
            inDeployPhase: me.inDeployPhase,
            mulliganDone: me.mulliganDone
        },
        opp: {
            hp: opp.hp,
            energy: opp.energy,
            maxEnergy: opp.maxEnergy,
            handCount: opp.hand.length,
            deckCount: opp.deck.length,
            field: opp.field,
            graveyard: opp.graveyard,
            traps: isPlanning && opp.confirmedTraps ? opp.confirmedTraps : opp.traps,
            trapCards: isPlanning && opp.confirmedTrapCards ? opp.confirmedTrapCards : opp.trapCards,
            hero: opp.hero,
            heroName: opp.heroName,
            ready: opp.ready,
            mulliganDone: opp.mulliganDone
        },
        globalSpells: gs.globalSpells || []
    };
}

/**
 * Démarre un nouveau tour
 * @param {Object} room - La room
 */
function startNewTurn(room) {
    const gs = room.gameState;
    gs.turn++;
    gs.phase = 'planning';

    for (let p = 1; p <= 2; p++) {
        const player = gs.players[p];
        resetPlayerForNewTurn(player);

        // Augmenter le mana max (jusqu'à 10)
        if (player.maxEnergy < 10) player.maxEnergy++;
        player.energy = player.maxEnergy;

        // Activer canAttack pour toutes les créatures
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const card = player.field[r][c];
                if (card) {
                    card.canAttack = true;
                }
            }
        }
    }
}

module.exports = {
    resetPlayerForNewTurn,
    getPublicGameState,
    startNewTurn
};
