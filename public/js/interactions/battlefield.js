// =============================================
// Interactions: Construction du terrain
// =============================================
// Construction des slots et gestion des événements

const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

/**
 * Construit le terrain de jeu
 */
function buildBattlefield() {
    const bf = document.getElementById('battlefield');
    bf.innerHTML = '<div class="global-spell-zone" id="global-spell-zone"></div>';

    // Mon terrain
    const myField = document.createElement('div');
    myField.className = 'field-side';
    for (let row = 0; row < 4; row++) {
        myField.appendChild(makeSlot('me', row, 0));
        myField.appendChild(makeSlot('me', row, 1));
    }
    bf.appendChild(myField);

    // Zone de pièges
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

    // Terrain adverse
    const oppField = document.createElement('div');
    oppField.className = 'field-side';
    for (let row = 0; row < 4; row++) {
        oppField.appendChild(makeSlot('opp', row, 1));
        oppField.appendChild(makeSlot('opp', row, 0));
    }
    bf.appendChild(oppField);
}

/**
 * Crée un slot de carte
 */
function makeSlot(owner, row, col) {
    const el = document.createElement('div');
    const suffix = owner === 'me' ? '1' : '2';
    const label = SLOT_NAMES[row][col] + suffix;

    el.className = `card-slot ${owner}-slot`;
    el.dataset.owner = owner;
    el.dataset.row = row;
    el.dataset.col = col;
    el.innerHTML = `<span class="slot-label">${label}</span>`;

    el.onclick = () => clickSlot(owner, row, col);

    // Prévisualisation sort croix (pour le système de clic)
    el.onmouseenter = () => {
        if (selected && selected.fromHand && selected.type === 'spell' && selected.pattern === 'cross') {
            if (el.classList.contains('valid-target')) {
                previewCrossTargets(owner, row, col);
            }
        }
    };
    el.onmouseleave = () => {
        document.querySelectorAll('.card-slot.cross-target').forEach(s => s.classList.remove('cross-target'));
    };

    return el;
}

/**
 * Crée un slot de piège
 */
function makeTrapSlot(owner, row) {
    const el = document.createElement('div');
    el.className = 'trap-slot';
    el.dataset.owner = owner;
    el.dataset.row = row;

    el.onclick = () => clickTrap(owner, row);
    return el;
}
