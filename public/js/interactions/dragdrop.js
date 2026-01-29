// =============================================
// Interactions: Drag & Drop
// =============================================
// Gestion du drag & drop des cartes

/**
 * Obtient les emplacements valides pour une carte
 * @param {Object} card - La carte
 * @returns {Array} Liste des emplacements valides
 */
function getValidSlots(card) {
    const valid = [];
    if (!card || !state) return valid;

    if (card.type === 'creature') {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 2; col++) {
                if (canPlaceAt(card, col) && !state.me.field[row][col]) {
                    valid.push({ row, col });
                }
            }
        }
    } else if (card.type === 'trap') {
        for (let row = 0; row < 4; row++) {
            if (!state.me.traps[row]) valid.push({ trap: true, row });
        }
    } else if (card.type === 'spell') {
        if (card.pattern === 'global' || card.pattern === 'all') {
            valid.push({ global: true });
        } else if (card.pattern === 'hero') {
            if (card.targetEnemy) {
                valid.push({ hero: true, owner: 'opp' });
            } else if (card.targetSelf) {
                valid.push({ hero: true, owner: 'me' });
            } else {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
            }
        } else if (card.targetEmptySlot) {
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    if (!state.opponent.field[row][col]) {
                        valid.push({ owner: 'opp', row, col });
                    }
                }
            }
        } else {
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    valid.push({ owner: 'me', row, col });
                    valid.push({ owner: 'opp', row, col });
                }
            }
            if (card.canTargetHero) {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
            }
        }
    }
    return valid;
}

/**
 * Vérifie si une créature peut être placée sur une colonne
 */
function canPlaceAt(card, col) {
    if (!card || card.type !== 'creature') return false;
    const shooter = card.abilities?.includes('shooter');
    const fly = card.abilities?.includes('fly');
    if (fly) return true;
    if (shooter) return col === 0;
    return col === 1;
}

/**
 * Surligne les emplacements valides
 */
function highlightValidSlots(card, forceShow = false) {
    clearHighlights();
    if (!card) return;
    if (card.cost > state.me.energy && !forceShow && !dragged) return;

    const valid = getValidSlots(card);
    valid.forEach(v => {
        if (v.global) {
            const zone = document.querySelector('.global-spell-zone');
            if (zone) zone.classList.add('active');
        } else if (v.hero) {
            const heroId = v.owner === 'me' ? 'hero-me' : 'hero-opp';
            const hero = document.getElementById(heroId);
            if (hero) hero.classList.add('hero-targetable');
        } else if (v.trap) {
            const slot = document.querySelector(`.trap-slot[data-owner="me"][data-row="${v.row}"]`);
            if (slot) slot.classList.add('valid-target');
        } else {
            const owner = v.owner || 'me';
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${v.row}"][data-col="${v.col}"]`);
            if (slot) slot.classList.add('valid-target');
        }
    });
}

/**
 * Surligne les cibles de déplacement
 */
function highlightMoveTargets(fromRow, fromCol, card) {
    clearHighlights();
    const isFlying = card.abilities?.includes('fly');

    // Déplacements verticaux
    [fromRow - 1, fromRow + 1].forEach(toRow => {
        if (toRow < 0 || toRow > 3) return;
        if (state.me.field[toRow][fromCol]) return;
        const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${toRow}"][data-col="${fromCol}"]`);
        if (slot) slot.classList.add('moveable');
    });

    // Déplacements horizontaux (volants uniquement)
    if (isFlying) {
        const toCol = fromCol === 0 ? 1 : 0;
        if (!state.me.field[fromRow][toCol]) {
            const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${fromRow}"][data-col="${toCol}"]`);
            if (slot) slot.classList.add('moveable');
        }
    }
}

/**
 * Efface tous les surlignages
 */
function clearHighlights() {
    document.querySelectorAll('.card-slot, .trap-slot').forEach(s => {
        s.classList.remove('valid-target', 'drag-over', 'moveable', 'cross-target');
    });
    document.querySelectorAll('.hero-card').forEach(h => {
        h.classList.remove('hero-targetable', 'hero-drag-over');
    });
    const zone = document.querySelector('.global-spell-zone');
    if (zone) zone.classList.remove('active');
}

/**
 * Prévisualise les cibles du sort croix
 */
function previewCrossTargets(targetOwner, row, col) {
    document.querySelectorAll('.card-slot.cross-target').forEach(s => s.classList.remove('cross-target'));

    const targetPlayer = targetOwner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
    const adjacents = getCrossTargetsClient(targetPlayer, row, col);

    adjacents.forEach(t => {
        const owner = t.player === myNum ? 'me' : 'opp';
        const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${t.row}"][data-col="${t.col}"]`);
        if (slot) slot.classList.add('cross-target');
    });
}

/**
 * Obtient les cibles adjacentes pour un sort croix
 */
function getCrossTargetsClient(targetPlayer, row, col) {
    const targets = [];
    if (row > 0) targets.push({ row: row - 1, col, player: targetPlayer });
    if (row < 3) targets.push({ row: row + 1, col, player: targetPlayer });
    if (col > 0) targets.push({ row, col: col - 1, player: targetPlayer });
    if (col < 1) targets.push({ row, col: col + 1, player: targetPlayer });
    return targets;
}

/**
 * Gère le drop sur un slot
 */
function dropOnSlot(owner, row, col) {
    if (!dragged || !canPlay()) return;

    if (dragged.tooExpensive) {
        dragged.triedToDrop = true;
        return;
    }

    if (dragged.type === 'spell') {
        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
        const spellCard = state.me.hand[dragged.idx];

        // Plan douteux : ne peut cibler qu'un emplacement vide adverse
        if (spellCard && spellCard.targetEmptySlot) {
            if (owner === 'me') return; // Doit cibler l'adversaire
            // Vérifier que le slot adverse est vide (dans la vue actuelle = snapshot)
            if (state.opponent.field[row][col]) return;
        }

        socket.emit('castSpell', { handIndex: dragged.idx, targetPlayer, row, col });
    } else if (dragged.type === 'creature' && owner === 'me') {
        if (canPlaceAt(dragged, col) && !state.me.field[row][col]) {
            // Animation locale optimiste - place visuellement la carte immédiatement
            placeCardLocally(dragged, row, col);
            socket.emit('placeCard', { handIndex: dragged.idx, row, col });
        }
    }
    clearSel();
}

/**
 * Place visuellement une carte sur le terrain avec animation fluide
 * Cela évite la saccade en attendant la réponse du serveur
 */
function placeCardLocally(card, row, col) {
    console.log(`[placeCardLocally] START - card=${card.name}, id=${card.id}, idx=${card.idx}, row=${row}, col=${col}`);
    const slot = document.querySelector(`.card-slot[data-owner="me"][data-row="${row}"][data-col="${col}"]`);
    if (!slot) {
        console.log(`[placeCardLocally] SLOT NOT FOUND`);
        return;
    }

    // Créer la carte avec un uid temporaire (sera remplacé par le serveur)
    const tempCard = {
        ...card,
        uid: `temp_${Date.now()}`,
        currentHp: card.hp,
        turnsOnField: 0,
        canAttack: card.abilities?.includes('haste') || false
    };
    console.log(`[placeCardLocally] tempCard created with uid=${tempCard.uid}`);

    const cardEl = makeCard(tempCard, false);
    cardEl.dataset.cardUid = tempCard.uid;
    cardEl.dataset.tempCard = 'true'; // Marqueur pour savoir que c'est temporaire
    console.log(`[placeCardLocally] cardEl created, dataset.cardId=${cardEl.dataset.cardId}, dataset.cardUid=${cardEl.dataset.cardUid}, dataset.tempCard=${cardEl.dataset.tempCard}`);

    // État visuel approprié
    if (tempCard.canAttack) {
        cardEl.classList.add('can-attack');
    } else {
        cardEl.classList.add('just-played');
    }

    // Animation de vol pour les volants
    if (card.abilities?.includes('fly')) {
        cardEl.classList.add('flying-creature');
        slot.classList.add('has-flying');
        if (typeof startFlyingAnimation === 'function') {
            startFlyingAnimation(cardEl);
        }
    }

    // Bouclier si Protection
    if (card.abilities?.includes('protection') && typeof addShieldToCard === 'function') {
        addShieldToCard(cardEl, false);
    }

    // Masquer immédiatement la carte dans la main pour éviter le flash
    const handPanel = document.getElementById('my-hand');
    const handCards = handPanel?.querySelectorAll('.card');
    console.log(`[placeCardLocally] hand has ${handCards?.length} cards, hiding index ${card.idx}`);
    if (handCards && handCards[card.idx]) {
        handCards[card.idx].style.opacity = '0';
        handCards[card.idx].style.pointerEvents = 'none';
    }

    // Animation d'apparition fluide
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.8) translateY(-10px)';
    cardEl.style.transition = 'opacity 0.15s ease-out, transform 0.2s cubic-bezier(0.34, 1.2, 0.64, 1)';

    // Nettoyer le slot (garder le label)
    const label = slot.querySelector('.slot-label');
    slot.innerHTML = '';
    if (label) slot.appendChild(label.cloneNode(true));

    slot.appendChild(cardEl);
    slot.classList.add('has-card');
    console.log(`[placeCardLocally] card added to slot, slot.children=${slot.children.length}`);

    // Déclencher l'animation
    requestAnimationFrame(() => {
        cardEl.style.opacity = '1';
        cardEl.style.transform = 'scale(1) translateY(0)';
        console.log(`[placeCardLocally] animation triggered`);
    });

    // Mettre à jour l'état local pour éviter les conflits
    if (state && state.me && state.me.field) {
        state.me.field[row][col] = tempCard;
        console.log(`[placeCardLocally] state.me.field[${row}][${col}] updated`);
    }
}

// Exposer globalement pour game.js
window.placeCardLocally = placeCardLocally;

/**
 * Gère le drop sur un slot de piège
 */
function dropOnTrap(owner, row) {
    if (!dragged || !canPlay() || owner !== 'me') return;

    if (dragged.tooExpensive) {
        dragged.triedToDrop = true;
        return;
    }

    if (dragged.type === 'trap' && !state.me.traps[row]) {
        socket.emit('placeTrap', { handIndex: dragged.idx, trapIndex: row });
    }
    clearSel();
}
