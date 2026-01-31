// ==================== CARD DATABASE - 40 CARTES ====================
// NOTE: Tous les coûts sont à 0 pour les tests (sauf cartes arenaStyle)
const CardDB = {
    creatures: [
        // === CRÉATURES AVEC IMAGES ===
        {
            id: 'little_bone',
            name: 'Petit Os, le futé',
            atk: 1,
            hp: 1,
            cost: 1,
            abilities: [],
            type: 'creature',
            image: 'black/little_bone.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'undead',
            combatType: 'melee',
            edition: 4,
            onDeath: { transformInto: 'bone_pile' },
            description: 'Si cette créature devait aller au cimetière, transformez-la en Pile d\'os. Au début de votre prochaine étape de révélation, remplacez Pile d\'os par Petit Os, le futé.'
        },
        {
            id: 'bone_pile',
            name: 'Pile d\'os',
            atk: 0,
            hp: 1,
            cost: 0,
            abilities: ['immovable'],
            type: 'creature',
            image: 'black/pile.jpg',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'undead',
            combatType: 'melee',
            edition: 4,
            isToken: true,
            transformsInto: 'little_bone',
            description: 'Au début de la prochaine étape de révélation de son propriétaire, se transforme en Petit Os, le futé.'
        },
        {
            id: 'pyromane_novice',
            name: 'Pyromane novice',
            atk: 2,
            hp: 1,
            cost: 1,
            abilities: ['haste'],
            type: 'creature',
            image: 'red/pyromane_novice.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'human',
            combatType: 'melee',
            edition: 1
        },
        {
            id: 'gobelin_incendiaire',
            name: 'Gobelin incendiaire',
            atk: 2,
            hp: 2,
            cost: 1,
            abilities: [],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'goblin',
            combatType: 'melee',
            edition: 1,
            onDeath: { damageHero: 1 }
        },
        {
            id: 'imp_des_enfers',
            name: 'Imp des enfers',
            atk: 2,
            hp: 1,
            cost: 1,
            abilities: ['fly'],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'demon',
            combatType: 'fly',
            edition: 1
        },
        {
            id: 'torche_vivante',
            name: 'Torche vivante',
            atk: 2,
            hp: 1,
            cost: 1,
            abilities: [],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'elemental',
            combatType: 'melee',
            edition: 1,
            onDeath: { damageKiller: 1 },
            description: 'Quand Torche vivante meurt, elle inflige 1 blessure à la créature responsable de sa mort.'
        },
        {
            id: 'salamandre_braise',
            name: 'Salamandre de braise',
            atk: 1,
            hp: 2,
            cost: 1,
            abilities: ['haste'],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'elemental',
            combatType: 'melee',
            edition: 2,
            onHeroAttack: { atkBoost: 1 },
            description: 'Célérité. Quand cette créature attaque le héros adverse, elle gagne +1 ATK jusqu\'à la fin de la phase de combat.'
        },
        { id: 'storm_guard', name: 'Garde Tempête', atk: 3, hp: 1, cost: 0, abilities: ['fly'], type: 'creature', image: 'white/oiseau.png', combatType: 'fly', arenaStyle: true, faction: 'white', creatureType: 'beast', edition: 1 },
        { id: 'skeleton_archer', name: 'Archer Squelette', atk: 4, hp: 1, cost: 0, abilities: ['shooter'], type: 'creature', image: 'green/squelette-archer.jpg', combatType: 'shooter', arenaStyle: true, faction: 'green', onHeroHit: 'draw', creatureType: 'undead', edition: 1 },
        { id: 'forest_guardian', name: 'Gardien de Forêt', atk: 3, hp: 3, cost: 0, abilities: ['protection'], type: 'creature', image: 'green/dryade.png', combatType: 'melee', arenaStyle: true, faction: 'green', creatureType: 'spirit', edition: 2 },
        { id: 'crackling_dragon', name: 'Dragon Crépitant', atk: 6, hp: 3, cost: 0, abilities: ['fly', 'cleave', 'trample'], cleaveX: 3, type: 'creature', image: 'red/dragon-crepitant.jpg', combatType: 'fly', arenaStyle: true, faction: 'red', creatureType: 'dragon', edition: 4, onDeath: { damageHero: 3 } },
        { id: 'radiant_dragon', name: 'Dragon d\'Éclat', atk: 6, hp: 6, cost: 0, abilities: ['fly'], type: 'creature', image: 'blue/dragon-glace.png', combatType: 'fly', arenaStyle: true, faction: 'blue', creatureType: 'dragon', edition: 3, onDamagedThisTurn: 'draw', description: 'À la fin du tour, si le Dragon d\'Éclat a subi des blessures ce tour-ci, piochez une carte.' },
        { id: 'sea_serpent', name: 'Serpent de mer', atk: 1, hp: 5, cost: 0, abilities: ['intangible', 'power'], powerX: 2, type: 'creature', image: 'blue/serpentdemer.png', combatType: 'melee', arenaStyle: true, faction: 'blue', creatureType: 'serpent', edition: 3 },
        { id: 'radjawak', name: 'Radjawak', atk: 4, hp: 6, cost: 0, abilities: ['power', 'trample'], powerX: 2, type: 'creature', image: 'green/radjawak.png', combatType: 'melee', arenaStyle: true, faction: 'green', creatureType: 'beast', edition: 3 },
        {
            id: 'colossal_kraken',
            name: 'Kraken Colossal',
            atk: 11,
            hp: 11,
            cost: 0,
            abilities: ['trample', 'regeneration'],
            regenerationX: 3,
            type: 'creature',
            image: 'blue/krakencolossal.png',
            combatType: 'melee',
            arenaStyle: true,
            faction: 'blue',
            creatureType: 'monstrosity',
            edition: 4,
            requiresGraveyardCreatures: 5,
            description: 'Vous ne pouvez invoquer le Kraken colossal que si vous avez au moins 5 créatures dans votre cimetière.'
        }
    ],
    spells: [
        { id: 'plan_douteux', name: 'Plan douteux', cost: 0, type: 'spell', offensive: true, pattern: 'single', targetEmptySlot: true, image: 'black/plandouteux.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature sur cet emplacement. Ce sort ne peut cibler qu\'un emplacement vide.', effect: 'destroy' },
        { id: 'tir_compresse', name: 'Tir compressé', cost: 0, type: 'spell', offensive: true, pattern: 'single', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 3, rarity: 'rare', description: 'Inflige 3 blessures à la créature sur cet emplacement. Si Tir compressé tue la cible, vous piochez une carte.', onKill: { draw: 1 } },
        { id: 'croix_de_feu', name: 'Croix de feu', cost: 0, type: 'spell', offensive: true, pattern: 'cross', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, rarity: 'uncommon', description: 'Inflige 2 blessures à la créature sur cet emplacement et 2 blessures à toutes les créatures adjacentes.' }
    ],
    traps: [
        { id: 'troubeant', name: 'Trou béant', damage: 5, cost: 0, type: 'trap', image: 'neutral/troubeant.png', arenaStyle: true, faction: 'neutral', edition: 1, description: 'Inflige 5 dégâts à la première créature adverse qui attaque sur la ligne.' },
        { id: 'trappe_secrete', name: 'Trappe secrète', damage: 3, cost: 0, type: 'trap', pattern: 'line', image: 'unknown/trap.png', arenaStyle: true, faction: 'neutral', edition: 2, description: 'Inflige 3 blessures à toutes les créatures adverses sur cette ligne.' },
        { id: 'voyage_inattendu', name: 'Voyage inattendu', cost: 0, type: 'trap', effect: 'bounce', image: 'unknown/trap.png', arenaStyle: true, faction: 'neutral', edition: 2, rarity: 'uncommon', description: 'Renvoyez la créature dans la main de son propriétaire.' }
    ]
};

const HERO_NAMES = ['Aldric', 'Lyra', 'Theron', 'Seraphine', 'Kael', 'Mira', 'Draven', 'Elena'];

// Définition des héros avec capacités
const HEROES = {
    hyrule: {
        id: 'hyrule',
        name: 'Hyrule, prophète ultime',
        image: 'green/hero_hyrule.jpg',
        titleColor: '#184d26ba', // Vert
        faction: 'green',
        edition: 3,
        ability: 'Le deuxième sort que vous lancez chaque tour coûte 1 mana de moins.'
    },
    zdejebel: {
        id: 'zdejebel',
        name: 'Zdejebel, fille de satan',
        image: 'red/hero_zdejebel.jpg',
        titleColor: '#4d1823ba', // Rouge
        faction: 'red',
        edition: 3,
        ability: 'Fin du tour : si le héros adverse a été attaqué, il subit 1 blessure.'
    }
};

// Sélectionner un héros aléatoire
function getRandomHero() {
    const heroKeys = Object.keys(HEROES);
    const randomKey = heroKeys[Math.floor(Math.random() * heroKeys.length)];
    return { ...HEROES[randomKey] };
}

// Réinitialiser une carte à ses stats de base
function resetCardForGraveyard(card) {
    if (!card) return null;
    const baseCard = CardDB.creatures.find(c => c.id === card.id) ||
                     CardDB.spells.find(c => c.id === card.id) ||
                     CardDB.traps.find(c => c.id === card.id);
    const reset = baseCard ? { ...baseCard } : { ...card };
    if (reset.abilities && reset.abilities.includes('protection')) {
        reset.hasProtection = true;
    }
    return reset;
}

// Ajouter une carte au cimetière
function addToGraveyard(player, card) {
    const resetCard = resetCardForGraveyard(card);
    if (resetCard) {
        console.log(`[addToGraveyard] ${resetCard.name}: arenaStyle=${resetCard.arenaStyle}, image=${resetCard.image}, faction=${resetCard.faction}`);
        player.graveyard.push(resetCard);
    }
}

// Pool de créatures pour la main de départ (tests)
function getCreaturesPool() {
    return CardDB.creatures.filter(c => !c.isToken);
}

// Créer un deck de 40 cartes
function createDeck() {
    const deck = [];

    // Première carte = Pyromane novice (pour les tests)
    const testCard = CardDB.creatures.find(c => c.id === 'pyromane_novice');
    if (testCard) {
        const card = {
            ...testCard,
            abilities: [...(testCard.abilities || [])],
            uid: `${Date.now()}-${Math.random()}-0`
        };
        card.currentHp = card.hp;
        card.baseAtk = card.atk;
        card.baseHp = card.hp;
        card.canAttack = false;
        card.turnsOnField = 0;
        card.movedThisTurn = false;
        if (card.abilities && card.abilities.includes('protection')) card.hasProtection = true;
        deck.push(card);
    }

    // Les 6 cartes suivantes (main de départ)
    const creaturesPool = getCreaturesPool();
    for (let i = 1; i < 7; i++) {
        const template = creaturesPool[Math.floor(Math.random() * creaturesPool.length)];
        const card = {
            ...template,
            abilities: [...(template.abilities || [])],
            uid: `${Date.now()}-${Math.random()}-${i}`
        };
        card.currentHp = card.hp;
        card.baseAtk = card.atk;
        card.baseHp = card.hp;
        card.canAttack = false;
        card.turnsOnField = 0;
        card.movedThisTurn = false;
        if (card.abilities && card.abilities.includes('protection')) card.hasProtection = true;
        deck.push(card);
    }

    // Le reste du deck (33 cartes) = normal
    for (let i = 7; i < 40; i++) {
        const r = Math.random();
        let pool = r < 0.65 ? CardDB.creatures : r < 0.88 ? CardDB.spells : CardDB.traps;
        const template = pool[Math.floor(Math.random() * pool.length)];
        const card = {
            ...template,
            abilities: [...(template.abilities || [])], // Copie profonde des abilities
            uid: `${Date.now()}-${Math.random()}-${i}`
        };
        if (card.type === 'creature') {
            card.currentHp = card.hp;
            card.baseAtk = card.atk;
            card.baseHp = card.hp;
            card.canAttack = false;
            card.turnsOnField = 0;
            card.movedThisTurn = false;
            if (card.abilities && card.abilities.includes('protection')) card.hasProtection = true;
        }
        deck.push(card);
    }

    // Mélanger seulement les cartes après la main (index 7+)
    const hand = deck.slice(0, 7);
    const rest = deck.slice(7).sort(() => Math.random() - 0.5);
    return [...hand, ...rest];
}

// Créer l'état initial d'un joueur
function createPlayerState() {
    const deck = createDeck();

    // DEBUG: Forcer le Kraken Colossal en première position (test cimetière)
    const krakenTemplate = CardDB.creatures.find(c => c.id === 'colossal_kraken');
    if (krakenTemplate) {
        const krakenIndex = deck.findIndex(c => c.id === 'colossal_kraken');
        if (krakenIndex >= 0) {
            deck.splice(krakenIndex, 1);
        }

        const kraken = {
            ...krakenTemplate,
            abilities: [...(krakenTemplate.abilities || [])],
            uid: `${Date.now()}-kraken-${Math.random()}`,
            currentHp: krakenTemplate.hp,
            maxHp: krakenTemplate.hp,
            baseAtk: krakenTemplate.atk,
            baseHp: krakenTemplate.hp,
            canAttack: false,
            turnsOnField: 0,
            movedThisTurn: false,
            hasProtection: (krakenTemplate.abilities || []).includes('protection')
        };
        console.log(`[createPlayerState] Created Kraken Colossal with abilities: ${JSON.stringify(kraken.abilities)}, requiresGraveyardCreatures: ${kraken.requiresGraveyardCreatures}`);
        deck.unshift(kraken);
    }

    // DEBUG: Forcer la Dryade (Protection) en deuxième position de la main
    // TOUJOURS créer une nouvelle copie depuis le template pour avoir les abilities
    const dryadeTemplate = CardDB.creatures.find(c => c.id === 'forest_guardian');
    if (dryadeTemplate) {
        // Supprimer l'éventuelle dryade existante du deck
        const dryadeIndex = deck.findIndex(c => c.id === 'forest_guardian');
        if (dryadeIndex >= 0) {
            deck.splice(dryadeIndex, 1);
        }

        // Créer une nouvelle dryade depuis le template avec copie profonde des abilities
        const dryade = {
            ...dryadeTemplate,
            abilities: [...(dryadeTemplate.abilities || [])], // Copie profonde des abilities
            uid: `${Date.now()}-dryade-${Math.random()}`,
            currentHp: dryadeTemplate.hp,
            baseAtk: dryadeTemplate.atk,
            baseHp: dryadeTemplate.hp,
            canAttack: false,
            turnsOnField: 0,
            movedThisTurn: false,
            hasProtection: (dryadeTemplate.abilities || []).includes('protection')
        };
        console.log(`[createPlayerState] Created dryade with abilities: ${JSON.stringify(dryade.abilities)}`);
        deck.unshift(dryade);
    }

    const hand = deck.splice(0, 7);
    const hero = getRandomHero();
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
        heroName: hero.name,
        hero: hero,
        mulliganDone: false,
        spellsCastThisTurn: 0,
        heroAttackedThisTurn: false
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
    HEROES,
    getRandomHero,
    resetCardForGraveyard,
    addToGraveyard,
    createDeck,
    createPlayerState,
    createGameState
};
