// ==================== CARD DATABASE - 40 CARTES ====================
const CardDB = {
    creatures: [
        // === COÛT 1 (6 créatures) ===
        { id: 'goblin', name: 'Gobelin', atk: 1, hp: 2, cost: 1, abilities: [], type: 'creature', icon: '👺' },
        { id: 'rat', name: 'Rat', atk: 2, hp: 1, cost: 1, abilities: ['haste'], type: 'creature', icon: '🐀' },
        { id: 'viper', name: 'Vipère', atk: 2, hp: 1, cost: 1, abilities: ['initiative'], type: 'creature', icon: '🐍' },
        { id: 'sprite', name: 'Lutin', atk: 1, hp: 1, cost: 1, abilities: ['fly'], type: 'creature', icon: '🧚' },
        { id: 'squire', name: 'Écuyer', atk: 1, hp: 3, cost: 1, abilities: [], type: 'creature', icon: '🛡️' },
        { id: 'wisp', name: 'Feu follet', atk: 1, hp: 1, cost: 1, abilities: ['intangible'], type: 'creature', icon: '✨' },
        
        // === COÛT 2 (6 créatures) ===
        { id: 'archer', name: 'Archer', atk: 2, hp: 2, cost: 2, abilities: ['shooter'], type: 'creature', icon: '🏹' },
        { id: 'wolf', name: 'Loup', atk: 3, hp: 2, cost: 2, abilities: ['haste'], type: 'creature', icon: '🐺' },
        { id: 'orc', name: 'Orc', atk: 2, hp: 4, cost: 2, abilities: [], type: 'creature', icon: '👹' },
        { id: 'boar', name: 'Sanglier', atk: 3, hp: 2, cost: 2, abilities: ['trample'], type: 'creature', icon: '🐗' },
        { id: 'rogue', name: 'Voleur', atk: 3, hp: 2, cost: 2, abilities: ['initiative'], type: 'creature', icon: '🗡️' },
        { id: 'bat', name: 'Chauve-souris', atk: 2, hp: 2, cost: 2, abilities: ['fly', 'haste'], type: 'creature', icon: '🦇' },
        
        // === COÛT 3 (6 créatures) ===
        { id: 'knight', name: 'Chevalier', atk: 3, hp: 4, cost: 3, abilities: [], type: 'creature', icon: '⚔️' },
        { id: 'sniper', name: 'Sniper', atk: 4, hp: 2, cost: 3, abilities: ['shooter'], type: 'creature', icon: '🎯' },
        { id: 'ghost', name: 'Spectre', atk: 2, hp: 3, cost: 3, abilities: ['intangible'], type: 'creature', icon: '👻' },
        { id: 'berserker', name: 'Berserker', atk: 4, hp: 3, cost: 3, abilities: ['haste'], type: 'creature', icon: '💀' },
        { id: 'eagle', name: 'Aigle géant', atk: 3, hp: 3, cost: 3, abilities: ['fly'], type: 'creature', icon: '🦅' },
        { id: 'barbarian', name: 'Barbare', atk: 2, hp: 5, cost: 3, abilities: ['power'], type: 'creature', icon: '🪓' },
        
        // === COÛT 4 (5 créatures) ===
        { id: 'rhino', name: 'Rhinocéros', atk: 4, hp: 4, cost: 4, abilities: ['trample'], type: 'creature', icon: '🦏' },
        { id: 'assassin', name: 'Assassin', atk: 5, hp: 2, cost: 4, abilities: ['initiative', 'haste'], type: 'creature', icon: '🥷' },
        { id: 'griffin', name: 'Griffon', atk: 4, hp: 4, cost: 4, abilities: ['fly'], type: 'creature', icon: '🦁' },
        { id: 'werewolf', name: 'Loup-garou', atk: 3, hp: 5, cost: 4, abilities: ['power', 'haste'], type: 'creature', icon: '🌕' },
        { id: 'cannon', name: 'Canon', atk: 5, hp: 3, cost: 4, abilities: ['shooter'], type: 'creature', icon: '💣' },
        
        // === COÛT 5+ (3 créatures) ===
        { id: 'dragon', name: 'Dragon', atk: 5, hp: 5, cost: 5, abilities: ['fly', 'trample'], type: 'creature', icon: '🐉' },
        { id: 'hydra', name: 'Hydre', atk: 3, hp: 7, cost: 5, abilities: ['power'], type: 'creature', icon: '🐲' },
        { id: 'titan', name: 'Titan', atk: 6, hp: 6, cost: 6, abilities: ['trample', 'power'], type: 'creature', icon: '🗿' }
    ],
    spells: [
        // === SORTS OFFENSIFS (5) ===
        { id: 'lightning', name: 'Éclair', damage: 2, cost: 1, type: 'spell', offensive: true, icon: '⚡', pattern: 'single' },
        { id: 'fireball', name: 'Boule de feu', damage: 3, cost: 2, type: 'spell', offensive: true, icon: '🔥', pattern: 'single' },
        { id: 'cross', name: 'Croix de feu', damage: 2, cost: 3, type: 'spell', offensive: true, icon: '✝️', pattern: 'cross' },
        { id: 'directhit', name: 'Frappe directe', damage: 3, cost: 2, type: 'spell', offensive: true, icon: '👊', pattern: 'hero' },
        { id: 'earthquake', name: 'Séisme', damage: 2, cost: 4, type: 'spell', offensive: true, icon: '🌋', pattern: 'all' },
        
        // === SORTS DÉFENSIFS/UTILITAIRES (4) ===
        { id: 'heal', name: 'Soin', heal: 3, cost: 1, type: 'spell', offensive: false, icon: '💚', pattern: 'single' },
        { id: 'buff', name: 'Renforcement', buff: { atk: 2, hp: 2 }, cost: 2, type: 'spell', offensive: false, icon: '💪', pattern: 'single' },
        { id: 'draw2', name: 'Inspiration', effect: 'draw', amount: 2, cost: 2, type: 'spell', offensive: false, icon: '📜', pattern: 'global' },
        { id: 'manacrystal', name: 'Cristal de mana', effect: 'mana', cost: 3, type: 'spell', offensive: false, icon: '💎', pattern: 'global' }
    ],
    traps: [
        { id: 'spike', name: 'Piques', damage: 2, cost: 1, type: 'trap', icon: '📌' },
        { id: 'fire', name: 'Feu grégeois', damage: 3, cost: 2, type: 'trap', icon: '🔥' },
        { id: 'poison', name: 'Poison', damage: 4, cost: 3, type: 'trap', icon: '☠️' },
        { id: 'net', name: 'Filet', damage: 1, cost: 1, type: 'trap', icon: '🕸️' },
        { id: 'explosive', name: 'Mine explosive', damage: 5, cost: 4, type: 'trap', icon: '💥' }
    ]
};

const HERO_NAMES = ['Aldric', 'Lyra', 'Theron', 'Seraphine', 'Kael', 'Mira', 'Draven', 'Elena'];

// Réinitialiser une carte à ses stats de base
function resetCardForGraveyard(card) {
    if (!card) return null;
    const baseCard = CardDB.creatures.find(c => c.id === card.id) ||
                     CardDB.spells.find(c => c.id === card.id) ||
                     CardDB.traps.find(c => c.id === card.id);
    return baseCard ? { ...baseCard } : { ...card };
}

// Ajouter une carte au cimetière
function addToGraveyard(player, card) {
    const resetCard = resetCardForGraveyard(card);
    if (resetCard) player.graveyard.push(resetCard);
}

// Créer un deck de 40 cartes
function createDeck() {
    const deck = [];
    for (let i = 0; i < 40; i++) {
        const r = Math.random();
        let pool = r < 0.65 ? CardDB.creatures : r < 0.88 ? CardDB.spells : CardDB.traps;
        const card = { ...pool[Math.floor(Math.random() * pool.length)], uid: `${Date.now()}-${Math.random()}-${i}` };
        if (card.type === 'creature') {
            card.currentHp = card.hp;
            card.baseAtk = card.atk;
            card.baseHp = card.hp;
            card.canAttack = false;
            card.turnsOnField = 0;
            card.movedThisTurn = false;
        }
        deck.push(card);
    }
    return deck.sort(() => Math.random() - 0.5);
}

// Créer l'état initial d'un joueur
function createPlayerState() {
    const deck = createDeck();
    const hand = deck.splice(0, 7);
    return {
        hp: 20,
        energy: 1,
        maxEnergy: 1,
        deck,
        hand,
        field: Array(4).fill(null).map(() => Array(2).fill(null)),
        traps: [null, null, null, null],
        trapCards: [null, null, null, null],
        graveyard: [],
        ready: false,
        connected: false,
        inDeployPhase: false,
        pendingActions: [],
        confirmedField: null,
        confirmedTraps: null,
        heroName: HERO_NAMES[Math.floor(Math.random() * HERO_NAMES.length)],
        mulliganDone: false
    };
}

// Créer l'état initial du jeu
function createGameState() {
    return {
        turn: 1,
        phase: 'mulligan',
        timeLeft: 90,
        players: { 1: createPlayerState(), 2: createPlayerState() }
    };
}

module.exports = {
    CardDB,
    HERO_NAMES,
    resetCardForGraveyard,
    addToGraveyard,
    createDeck,
    createPlayerState,
    createGameState
};
