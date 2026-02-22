// ==================== PLATEAU DE JEU ====================
// Construction du battlefield, slots, ciblage, highlights

// Cache DOM pour les slots (évite querySelectorAll répétitifs)
const _slotCache = {};
const _trapSlotCache = {};

function getSlot(owner, row, col) {
    const key = `${owner}-${row}-${col}`;
    return _slotCache[key] || null;
}

function getTrapSlot(owner, row) {
    const key = `${owner}-${row}`;
    return _trapSlotCache[key] || null;
}

function buildBattlefield() {
    const bf = document.getElementById('battlefield');
    bf.innerHTML = '<div class="global-spell-zone" id="global-spell-zone"></div>';

    const myField = document.createElement('div');
    myField.className = 'field-side';
    for (let row = 0; row < 4; row++) {
        myField.appendChild(makeSlot('me', row, 0));
        myField.appendChild(makeSlot('me', row, 1));
    }
    bf.appendChild(myField);

    const trapCenter = document.createElement('div');
    trapCenter.className = 'trap-center';

    const myTraps = document.createElement('div');
    myTraps.className = 'trap-col';
    for (let i = 0; i < 4; i++) myTraps.appendChild(makeTrapSlot('me', i));

    const oppTraps = document.createElement('div');
    oppTraps.className = 'trap-col';
    for (let i = 0; i < 4; i++) oppTraps.appendChild(makeTrapSlot('opp', i));

    trapCenter.appendChild(myTraps);
    trapCenter.appendChild(oppTraps);
    bf.appendChild(trapCenter);

    const oppField = document.createElement('div');
    oppField.className = 'field-side';
    for (let row = 0; row < 4; row++) {
        oppField.appendChild(makeSlot('opp', row, 1));
        oppField.appendChild(makeSlot('opp', row, 0));
    }
    bf.appendChild(oppField);

    // Setup global spell zone handlers
    const globalZone = document.getElementById('global-spell-zone');
    globalZone.ondragover = (e) => {
        e.preventDefault();
        if (globalZone.classList.contains('active')) {
            globalZone.classList.add('drag-over');
        }
    };
    globalZone.ondragleave = () => {
        globalZone.classList.remove('drag-over');
    };
    globalZone.ondrop = (e) => {
        e.preventDefault();
        globalZone.classList.remove('drag-over');

        // Les sorts 'hero' ne passent plus par ici, ils ciblent les héros directement
        if (dragged && dragged.type === 'spell' && ['global', 'all'].includes(dragged.pattern)) {
            if (dragged.tooExpensive) {
                dragged.triedToDrop = true;
            } else {
                commitSpell(dragged, 'global', 0, -1, -1, dragged.idx);
                handCardRemovedIndex = dragged.idx;
                socket.emit('castGlobalSpell', { handIndex: dragged.idx });
            }
        }
        clearSel();
    };
}

function makeSlot(owner, row, col) {
    const el = document.createElement('div');
    const suffix = owner === 'me' ? '1' : '2';
    const label = SLOT_NAMES[row][col] + suffix;

    el.className = `card-slot ${owner}-slot`;
    el.dataset.owner = owner;
    el.dataset.row = row;
    el.dataset.col = col;
    el.innerHTML = `<span class="slot-label">${label}</span>`;
    // Synchroniser l'animation de bordure rotative
    el.style.setProperty('--anim-offset', `${(performance.now() / 1000) % 6}s`);

    // Enregistrer dans le cache DOM
    _slotCache[`${owner}-${row}-${col}`] = el;

    el.onclick = () => clickSlot(owner, row, col);

    // Prévisualisation du sort croix au survol
    el.onmouseenter = () => {
        if (selected && selected.fromHand && selected.type === 'spell' && selected.pattern === 'cross') {
            if (el.classList.contains('valid-target')) {
                previewCrossTargets(owner, row, col);
            }
        }
    };
    el.onmouseleave = () => {
        document.querySelectorAll('.card-slot.cross-target').forEach(s => {
            const card = s.querySelector('.card');
            if (card) card.classList.remove('spell-hover-target');
            s.classList.remove('cross-target');
        });
    };

    el.ondragover = (e) => {
        e.preventDefault();
        if (el.classList.contains('valid-target') || el.classList.contains('moveable')) {
            el.classList.add('drag-over');
        }
        // Prévisualisation croix au drag
        if (dragged && dragged.type === 'spell' && dragged.pattern === 'cross' && el.classList.contains('valid-target')) {
            previewCrossTargets(owner, row, col);
        }
    };
    el.ondragleave = () => {
        el.classList.remove('drag-over');
        document.querySelectorAll('.card-slot.cross-target').forEach(s => {
            const card = s.querySelector('.card');
            if (card) card.classList.remove('spell-hover-target');
            s.classList.remove('cross-target');
        });
    };
    el.ondrop = (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');

        // Drop from field (redeploy)
        if (draggedFromField) {
            if (el.classList.contains('moveable')) {
                socket.emit('moveCard', {
                    fromRow: draggedFromField.row,
                    fromCol: draggedFromField.col,
                    toRow: parseInt(el.dataset.row),
                    toCol: parseInt(el.dataset.col)
                });
            }
            clearSel();
            return;
        }

        // Drop from hand
        if (el.classList.contains('valid-target')) {
            dropOnSlot(owner, row, col);
        }
    };
    return el;
}

function makeTrapSlot(owner, row) {
    const el = document.createElement('div');
    el.className = 'trap-slot';
    el.dataset.owner = owner;
    el.dataset.row = row;

    // Enregistrer dans le cache DOM
    _trapSlotCache[`${owner}-${row}`] = el;

    el.onclick = () => clickTrap(owner, row);
    el.ondragover = (e) => {
        e.preventDefault();
        if (el.classList.contains('valid-target')) el.classList.add('drag-over');
    };
    el.ondragleave = () => el.classList.remove('drag-over');
    el.ondrop = (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (el.classList.contains('valid-target')) dropOnTrap(owner, row);
    };
    return el;
}

function canPlaceAt(card, col) {
    if (!card || card.type !== 'creature') return false;
    const shooter = card.abilities?.includes('shooter');
    const fly = card.abilities?.includes('fly');
    if (fly) return true;
    if (shooter) return col === 0;
    return col === 1;
}

function getProvocationPrioritySlots(card) {
    if (!card || card.type !== 'creature' || !state) return [];
    if (card.isBuilding) return [];
    if (card.abilities?.includes('fly')) return [];

    const preferredCol = card.abilities?.includes('shooter') ? 0 : 1;
    const forced = [];
    for (let row = 0; row < 4; row++) {
        const oppFront = state.opponent?.field?.[row]?.[1];
        const oppBack = state.opponent?.field?.[row]?.[0];
        const hasProvocation =
            !!(oppFront && oppFront.currentHp > 0 && oppFront.abilities?.includes('provocation')) ||
            !!(oppBack && oppBack.currentHp > 0 && oppBack.abilities?.includes('provocation'));
        if (!hasProvocation) continue;

        const occupied =
            !!state.me.field[row][preferredCol] ||
            committedReanimationSlots.some(s => s.row === row && s.col === preferredCol);
        if (!occupied) forced.push({ row, col: preferredCol });
    }
    return forced;
}

function respectsProvocationPriority(card, row, col) {
    const forced = getProvocationPrioritySlots(card);
    if (forced.length === 0) return true;
    return forced.some(s => s.row === row && s.col === col);
}

function getValidSlots(card) {
    const valid = [];
    if (!card || !state) return valid;

    if (card.type === 'creature') {
        // Vérifier les conditions d'invocation spéciales (ex: Kraken Colossal)
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) return valid;
        }
        if (false && card.sacrifice) { // V2 : sacrifice désactivé
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    if (!state.me.field[row][col] && canPlaceAt(card, col)
                        && !committedReanimationSlots.some(s => s.row === row && s.col === col)) {
                        if (countAdjacentSacrificeTargets('me', row, col) >= card.sacrifice) {
                            valid.push({ row, col });
                        }
                    }
                }
            }
        } else {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 2; col++) {
                if (canPlaceAt(card, col) && !state.me.field[row][col]
                    && !committedReanimationSlots.some(s => s.row === row && s.col === col)) {
                    if (!respectsProvocationPriority(card, row, col)) continue;
                    valid.push({ row, col });
                }
            }
        }
        }
    } else if (card.type === 'trap') {
        for (let row = 0; row < 4; row++) {
            if (!state.me.traps[row]) valid.push({ trap: true, row });
        }
    } else if (card.type === 'spell') {
        // Sorts globaux
        if (card.pattern === 'global' || card.pattern === 'all') {
            valid.push({ global: true });
        }
        // Sorts qui ciblent un héros
        else if (card.pattern === 'hero') {
            // targetEnemy + targetSelf = les deux héros (ex: Ensevelissement)
            // targetEnemy seul = seulement héros adverse (ex: Frappe directe)
            // targetSelf seul = seulement notre héros (ex: Cristal de mana)
            // aucun = les deux héros (ex: Inspiration)
            if (card.targetEnemy && card.targetSelf) {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
            } else if (card.targetEnemy) {
                valid.push({ hero: true, owner: 'opp' });
            } else if (card.targetSelf) {
                valid.push({ hero: true, owner: 'me' });
            } else {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
            }
        }
        // Sorts qui ciblent un slot vide ennemi (ex: Plan douteux)
        else if (card.targetEmptySlot) {
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    if (!state.opponent.field[row][col]) {
                        valid.push({ owner: 'opp', row, col });
                    }
                }
            }
        }
        // Sort ciblant un slot vide allié (ex: Réanimation)
        // Ne proposer que les slots où au moins 1 créature du cimetière peut être placée
        else if (card.targetSelfEmptySlot) {
            const availableCreatures = (state.me.graveyard || []).filter(c =>
                c.type === 'creature' && !committedGraveyardUids.includes(c.uid || c.id)
            );
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    if (!state.me.field[row][col]
                        && !committedReanimationSlots.some(s => s.row === row && s.col === col)) {
                        if (availableCreatures.some(c => canPlaceAt(c, col) && respectsProvocationPriority(c, row, col))) {
                            valid.push({ owner: 'me', row, col });
                        }
                    }
                }
            }
        }
        // Sort ciblant une créature alliée (ex: Altération musculaire)
        else if (card.targetSelfCreature) {
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    const target = state.me.field[row][col];
                    if (target && !(card.excludeBuildings && target.isBuilding)) {
                        valid.push({ owner: 'me', row, col });
                    }
                }
            }
        }
        // Sorts ciblés normaux
        else {
            // Sorts offensifs → uniquement les slots ennemis (exclure camouflés/inciblables)
            if (card.offensive) {
                // Spell Magnet : vérifier si l'adversaire a une créature qui attire les sorts
                const magnetSlots = [];
                for (let row = 0; row < 4; row++) {
                    for (let col = 0; col < 2; col++) {
                        const target = state.opponent.field[row][col];
                        if (target && target.spellMagnet && !target.hasCamouflage && !target.hasUntargetable) {
                            magnetSlots.push({ owner: 'opp', row, col });
                        }
                    }
                }
                if (magnetSlots.length > 0) {
                    valid.push(...magnetSlots);
                } else {
                    for (let row = 0; row < 4; row++) {
                        for (let col = 0; col < 2; col++) {
                            const target = state.opponent.field[row][col];
                            if (target && (target.hasCamouflage || target.hasUntargetable)) continue;
                            valid.push({ owner: 'opp', row, col });
                        }
                    }
                }
            } else {
                // Sorts non-offensifs → toutes les cases créatures
                for (let row = 0; row < 4; row++) {
                    for (let col = 0; col < 2; col++) {
                        valid.push({ owner: 'me', row, col });
                        valid.push({ owner: 'opp', row, col });
                    }
                }
            }
            // Si le sort peut aussi cibler les héros
            if (card.canTargetHero) {
                valid.push({ hero: true, owner: 'me' });
                valid.push({ hero: true, owner: 'opp' });
            }
        }
    }
    return valid;
}

function highlightValidSlots(card, forceShow = false) {
    clearHighlights();
    if (!card) return;
    // Si la carte est trop chère et qu'on ne force pas l'affichage, ne pas highlight
    // Mais si on drag, on veut montrer où ça irait (forceShow via le drag)
    if (card.cost > state.me.energy && !forceShow && !dragged) return;

    const valid = getValidSlots(card);
    valid.forEach(v => {
        if (v.global) {
            // Activer la zone globale
            const zone = document.querySelector('.global-spell-zone');
            if (zone) zone.classList.add('active');
        } else if (v.hero) {
            // Highlight le héros ciblable
            const heroId = v.owner === 'me' ? 'hero-me' : 'hero-opp';
            const hero = document.getElementById(heroId);
            if (hero) hero.classList.add('hero-targetable');
        } else if (v.trap) {
            const slot = getTrapSlot('me', v.row);
            if (slot) slot.classList.add('valid-target');
        } else {
            const owner = v.owner || 'me';
            const slot = getSlot(owner, v.row, v.col);
            if (slot) {
                slot.classList.add('valid-target');
                const cardEl = slot.querySelector('.card');
                if (cardEl) cardEl.classList.add('spell-targetable');
            }
        }
    });
}

// Prévisualiser les cibles du sort croix au survol (centre + adjacents)
function previewCrossTargets(targetOwner, row, col) {
    // Nettoyer les anciennes prévisualisations
    document.querySelectorAll('.card-slot.cross-target').forEach(s => {
        s.classList.remove('cross-target');
        const card = s.querySelector('.card');
        if (card) card.classList.remove('spell-hover-target');
    });

    const targetPlayer = targetOwner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
    const adjacents = getCrossTargetsClient(targetPlayer, row, col);

    // Centre en orange aussi (cross-target prime sur drag-over/valid-target)
    const centerSlot = getSlot(targetOwner, row, col);
    if (centerSlot) {
        centerSlot.classList.add('cross-target');
        const centerCard = centerSlot.querySelector('.card');
        if (centerCard) centerCard.classList.add('spell-hover-target');
    }

    // Adjacents en orange + bordure orange sur les créatures présentes
    adjacents.forEach(t => {
        const owner = t.player === myNum ? 'me' : 'opp';
        const slot = getSlot(owner, t.row, t.col);
        if (slot) {
            slot.classList.add('cross-target');
            const card = slot.querySelector('.card');
            if (card) card.classList.add('spell-hover-target');
        }
    });
}

// Version client de getCrossTargets (cases adjacentes seulement, le centre est la cible principale)
function getCrossTargetsClient(targetPlayer, row, col) {
    const targets = [];
    if (row > 0) targets.push({ row: row - 1, col, player: targetPlayer });
    if (row < 3) targets.push({ row: row + 1, col, player: targetPlayer });
    if (col > 0) targets.push({ row, col: col - 1, player: targetPlayer });
    if (col < 1) targets.push({ row, col: col + 1, player: targetPlayer });
    return targets;
}

function isSacrificeTargetClient(card) {
    if (!card || card.type !== 'creature') return false;
    if (card.petrified) return false;
    if (card.movedThisTurn) return false;
    if (card.abilities?.includes('unsacrificable')) return false;
    return !!card.canAttack;
}

function countAdjacentSacrificeTargets(owner, row, col) {
    const field = (owner === 'me') ? state.me.field : state.opponent.field;
    const excludeSlots = (owner === 'me') ? (state.me.pendingSacrificeSlots || []) : [];
    const neighbors = [[row-1,col],[row,col+1],[row+1,col],[row,col-1]];
    let count = 0;
    for (const [r,c] of neighbors) {
        if (r < 0 || r >= 4 || c < 0 || c >= 2) continue;
        if (excludeSlots.some(s => s.row === r && s.col === c)) continue;
        if (isSacrificeTargetClient(field[r][c])) count++;
    }
    return count;
}

function highlightMoveTargets(fromRow, fromCol, card) {
    clearHighlights();
    if (card.isBuilding) return;
    if (card.abilities?.includes('immovable')) return;
    if (card.melodyLocked || card.petrified) return;
    const isFlying = card.abilities?.includes('fly');

    // Déplacements verticaux (toutes les créatures)
    [fromRow - 1, fromRow + 1].forEach(toRow => {
        if (toRow < 0 || toRow > 3) return;
        if (state.me.field[toRow][fromCol]) return;
        const slot = getSlot('me', toRow, fromCol);
        if (slot) slot.classList.add('moveable');
    });

    // Déplacements horizontaux (seulement les volants)
    if (isFlying) {
        const toCol = fromCol === 0 ? 1 : 0;
        if (!state.me.field[fromRow][toCol]) {
            const slot = getSlot('me', fromRow, toCol);
            if (slot) slot.classList.add('moveable');
        }
    }
}

function clearHighlights() {
    document.querySelectorAll('.card-slot, .trap-slot').forEach(s => {
        s.classList.remove('valid-target', 'drag-over', 'moveable', 'cross-target');
        const cardEl = s.querySelector('.card');
        if (cardEl) cardEl.classList.remove('spell-targetable');
    });
    // Enlever le highlight des héros
    document.querySelectorAll('.hero-card').forEach(h => {
        h.classList.remove('hero-targetable', 'hero-drag-over');
    });
    const zone = document.querySelector('.global-spell-zone');
    if (zone) zone.classList.remove('active');
}

// ==========================================
