// =============================================
// Interactions: Clics
// =============================================
// Gestion des clics sur les cartes et slots

/**
 * Vérifie si le joueur peut jouer
 */
function canPlay() {
    if (!state) return false;
    if (state.phase !== 'planning') return false;
    if (state.me.ready) return false;
    return true;
}

/**
 * Sélectionne une carte en main
 */
function selectCard(i) {
    if (!canPlay()) return;
    const card = state.me.hand[i];
    if (card.cost > state.me.energy) return;

    clearSel();
    selected = { ...card, idx: i, fromHand: true };
    document.querySelectorAll('.my-hand .card')[i]?.classList.add('selected');
    highlightValidSlots(card);
}

/**
 * Clic sur une carte du terrain
 */
function clickFieldCard(row, col, card) {
    if (!canPlay()) return;
    if (state.me.inDeployPhase) return;
    if (card.movedThisTurn) return;

    clearSel();
    selected = { ...card, fromField: true, row, col };

    const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${row}"][data-col="${col}"]`);
    const cardEl = slot?.querySelector('.card');
    if (cardEl) cardEl.classList.add('field-selected');

    highlightMoveTargets(row, col, card);
}

/**
 * Clic sur un slot
 */
function clickSlot(owner, row, col) {
    if (!canPlay()) return;

    // Sort sélectionné
    if (selected && selected.fromHand && selected.type === 'spell') {
        const spellCard = state.me.hand[selected.idx];

        // Plan douteux : ne peut cibler qu'un emplacement vide adverse
        if (spellCard && spellCard.targetEmptySlot) {
            if (owner === 'me') { clearSel(); return; }
            if (state.opponent.field[row][col]) { clearSel(); return; }
        }

        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        socket.emit('castSpell', { handIndex: selected.idx, targetPlayer, row, col });
        clearSel();
        return;
    }

    if (owner !== 'me') return;

    // Créature sélectionnée
    if (selected && selected.fromHand && selected.type === 'creature') {
        if (canPlaceAt(selected, col) && !state.me.field[row][col]) {
            socket.emit('placeCard', { handIndex: selected.idx, row, col });
            clearSel();
        }
        return;
    }

    // Déplacement
    if (selected && selected.fromField) {
        const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${row}"][data-col="${col}"]`);
        if (slot && slot.classList.contains('moveable')) {
            socket.emit('moveCard', { fromRow: selected.row, fromCol: selected.col, toRow: row, toCol: col });
            clearSel();
            return;
        }
    }

    // Sélection d'une carte sur le terrain
    const card = state.me.field[row][col];
    if (card && !state.me.inDeployPhase && !card.movedThisTurn) {
        clickFieldCard(row, col, card);
    }
}

/**
 * Clic sur un slot de piège
 */
function clickTrap(owner, row) {
    if (!canPlay() || owner !== 'me') return;
    if (selected && selected.fromHand && selected.type === 'trap') {
        if (!state.me.traps[row]) {
            socket.emit('placeTrap', { handIndex: selected.idx, trapIndex: row });
            clearSel();
        }
    }
}

/**
 * Efface la sélection
 */
function clearSel() {
    selected = null;
    dragged = null;
    draggedFromField = null;
    document.querySelectorAll('.card').forEach(e => e.classList.remove('selected', 'field-selected'));
    clearHighlights();
}

/**
 * Fin de tour
 */
function endTurn() {
    if (!canPlay()) return;
    document.getElementById('end-turn-btn').classList.add('waiting');
    socket.emit('ready');
}

/**
 * Abandon
 */
function surrender() {
    socket.emit('surrender');
}
