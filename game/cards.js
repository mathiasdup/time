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
            id: 'gobelin_jumele',
            name: 'Gobelin jumelé',
            atk: 2,
            hp: 1,
            cost: 0,
            abilities: [],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'goblin',
            combatType: 'melee',
            edition: 2,
            onDeath: { transformInto: 'faux_jumeau' },
            description: 'Quand Gobelin jumelé meurt, transformez-le en Faux jumeau.'
        },
        {
            id: 'faux_jumeau',
            name: 'Faux jumeau',
            atk: 2,
            hp: 1,
            cost: 0,
            abilities: ['haste'],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'goblin',
            combatType: 'melee',
            edition: 2,
            isToken: true
        },
        {
            id: 'ogre_tapageur',
            name: 'Ogre tapageur',
            atk: 4,
            hp: 2,
            cost: 0,
            abilities: ['immovable'],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'ogre',
            combatType: 'melee',
            edition: 2
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
            description: 'Quand cette créature attaque le héros adverse, elle gagne +1 ATK jusqu\'à la fin de la phase de combat.'
        },
        {
            id: 'demon_explosif',
            name: 'Démon explosif',
            atk: 1,
            hp: 1,
            cost: 0,
            abilities: [],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'demon',
            combatType: 'melee',
            edition: 3,
            onDeath: { damageRow: 3 },
            description: 'Quand cette créature meurt, elle inflige 3 dégâts à toutes les créatures mêlée et tireurs sur la ligne (alliées et adverses).'
        },
        {
            id: 'lance_gobelin',
            name: 'Lance gobelin',
            atk: 1,
            hp: 2,
            cost: 0,
            abilities: ['shooter'],
            type: 'creature',
            image: 'unknown/creature.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'goblin',
            combatType: 'shooter',
            edition: 2,
            atkPerAllyType: 'goblin',
            description: 'Son attaque augmente de +X, X étant le nombre de gobelins que vous contrôlez.'
        },
        { id: 'storm_guard', name: 'Garde Tempête', atk: 3, hp: 1, cost: 0, abilities: ['fly'], type: 'creature', image: 'white/oiseau.png', combatType: 'fly', arenaStyle: true, faction: 'white', creatureType: 'beast', edition: 1 },
        { id: 'skeleton_archer', name: 'Archer Squelette', atk: 4, hp: 1, cost: 0, abilities: ['shooter'], type: 'creature', image: 'green/squelette-archer.jpg', combatType: 'shooter', arenaStyle: true, faction: 'green', onHeroHit: 'draw', creatureType: 'undead', edition: 1 },
        { id: 'forest_guardian', name: 'Gardien de Forêt', atk: 3, hp: 3, cost: 0, abilities: ['protection'], type: 'creature', image: 'green/dryade.png', combatType: 'melee', arenaStyle: true, faction: 'green', creatureType: 'spirit', edition: 2 },
        { id: 'crackling_dragon', name: 'Dragon Crépitant', atk: 6, hp: 3, cost: 0, abilities: ['fly', 'cleave', 'trample'], cleaveX: 3, type: 'creature', image: 'red/dragon-crepitant.jpg', combatType: 'fly', arenaStyle: true, faction: 'red', creatureType: 'dragon', edition: 4, onDeath: { damageHero: 3 } },
        { id: 'drake_morose', name: 'Drake morose', atk: 4, hp: 4, cost: 0, abilities: ['fly', 'spellBoost'], spellBoostAmount: 1, type: 'creature', image: 'unknown/creature.png', combatType: 'fly', arenaStyle: true, faction: 'red', creatureType: 'dragon', edition: 4, onSummon: { searchSpell: true }, description: 'Quand Drake morose entre en jeu, cherchez un sort dans votre deck.' },
        { id: 'deformed_lancer', name: 'Lancier difforme', atk: 2, hp: 3, cost: 0, abilities: ['bloodthirst'], bloodthirstAmount: 1, type: 'creature', image: 'unknown/creature.png', combatType: 'melee', arenaStyle: true, faction: 'red', creatureType: 'human', edition: 2 },
        { id: 'warchief', name: 'Chef de guerre', atk: 2, hp: 4, cost: 0, abilities: ['enhance'], enhanceAmount: 2, type: 'creature', image: 'unknown/creature.png', combatType: 'melee', arenaStyle: true, faction: 'red', creatureType: 'goblin', edition: 3, description: 'Les créatures adjacentes gagnent +2 ATK.' },
        { id: 'wolf_master', name: 'Maître loup', atk: 1, hp: 4, cost: 0, abilities: [], type: 'creature', image: 'unknown/creature.png', combatType: 'melee', arenaStyle: true, faction: 'white', creatureType: 'human', edition: 4, atkPerAdjacent: 1, description: 'Gagne +1 ATK pour chaque créature adjacente (jusqu\'à +3).' },
        { id: 'medusa_queen', name: 'Medusa à trois têtes', atk: 3, hp: 2, cost: 0, abilities: ['shooter', 'melody'], type: 'creature', image: 'unknown/creature.png', combatType: 'shooter', arenaStyle: true, faction: 'blue', creatureType: 'monstrosity', edition: 4, description: 'Si une créature reste 2 tours en face de Medusa, elle se transforme en pierre.' },
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
        },
        {
            id: 'demon_superieur', name: 'Démon supérieur', atk: 5, hp: 5, cost: 0, type: 'creature',
            combatType: 'melee', creatureType: 'demon', faction: 'black', edition: 2,
            image: 'unknown/creature.png', arenaStyle: true, sacrifice: 1
        },
        { id: 'escamoteur_ruelles', name: 'Escamoteur des ruelles', atk: 3, hp: 2, cost: 0, type: 'creature', abilities: ['camouflage'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 2, image: 'unknown/creature.png', arenaStyle: true }
    ],
    spells: [
        { id: 'plan_douteux', name: 'Plan douteux', cost: 0, type: 'spell', offensive: true, pattern: 'single', targetEmptySlot: true, image: 'black/plandouteux.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature sur cet emplacement. Ce sort ne peut cibler qu\'un emplacement vide.', effect: 'destroy' },
        { id: 'tir_compresse', name: 'Tir compressé', cost: 0, type: 'spell', offensive: true, pattern: 'single', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 3, rarity: 'rare', description: 'Inflige 3 blessures à la créature sur cet emplacement. Si Tir compressé tue la cible, vous piochez une carte.', onKill: { draw: 1 } },
        { id: 'croix_de_feu', name: 'Croix de feu', cost: 0, type: 'spell', offensive: true, pattern: 'cross', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, rarity: 'uncommon', description: 'Inflige 2 blessures à la créature sur cet emplacement et 2 blessures à toutes les créatures adjacentes.' },
        { id: 'blast', name: 'Blast', cost: 0, type: 'spell', offensive: true, pattern: 'single', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, returnOnMiss: true, description: 'Inflige 2 blessures à la créature ciblée. Si Blast ne touche pas de créature, il retourne dans votre main.' },
        { id: 'coup_de_poing', name: 'Coup de poing', cost: 0, type: 'spell', offensive: true, pattern: 'hero', targetEnemy: true, damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'Inflige 2 dégâts au héros adverse.' },
        { id: 'tremblement_de_terre', name: 'Tremblement de terre', cost: 0, type: 'spell', offensive: true, pattern: 'all', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'green', edition: 3, description: 'Inflige 3 dégâts à toutes les créatures.' },
        { id: 'vitesse_superieure', name: 'Vitesse supérieure', cost: 0, type: 'spell', offensive: false, pattern: 'hero', effect: 'draw', amount: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'Le joueur ciblé pioche deux cartes.' },
        { id: 'reanimation', name: 'Réanimation', cost: 0, type: 'spell', offensive: false, pattern: 'self', effect: 'reanimate', image: 'unknown/spell.png', arenaStyle: true, faction: 'black', edition: 2, targetSelfEmptySlot: true, requiresGraveyardCreature: true, description: 'Placez une créature de votre cimetière sur cet emplacement vide.' },
        { id: 'alteration_musculaire', name: 'Altération musculaire', cost: 0, type: 'spell', offensive: false, pattern: 'single', targetSelfCreature: true, effect: 'atkBuff', atkBuff: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'La créature alliée ciblée gagne +2 ATK.' }
    ],
    traps: [
        { id: 'troubeant', name: 'Trou béant', damage: 5, cost: 0, type: 'trap', image: 'neutral/troubeant.png', arenaStyle: true, faction: 'neutral', edition: 1, description: 'Inflige 5 dégâts à la première créature adverse qui attaque sur la ligne.' },
        { id: 'trappe_secrete', name: 'Trappe secrète', damage: 3, cost: 0, type: 'trap', pattern: 'line', image: 'unknown/trap.png', arenaStyle: true, faction: 'neutral', edition: 2, description: 'Inflige 3 blessures à toutes les créatures adverses sur cette ligne.' },
        { id: 'voyage_inattendu', name: 'Voyage inattendu', cost: 0, type: 'trap', effect: 'bounce', image: 'unknown/trap.png', arenaStyle: true, faction: 'neutral', edition: 2, rarity: 'uncommon', description: 'Renvoyez la créature dans la main de son propriétaire.' },
        { id: 'piege_a_gobelin', name: 'Piège à gobelin', cost: 0, type: 'trap', effect: 'summon', summonId: 'gobelin_jumele', image: 'unknown/trap.png', arenaStyle: true, faction: 'neutral', edition: 3, description: 'Invoque un Gobelin jumelé sur l\'emplacement adjacent. Ne se déclenche que si cet emplacement est vide.' }
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
    if (reset.abilities && reset.abilities.includes('camouflage')) {
        reset.hasCamouflage = true;
    }
    if (card.uid) reset.uid = card.uid;
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

// Créer un deck de 40 cartes
function createDeck() {
    const deck = [];

    for (let i = 0; i < 40; i++) {
        const r = Math.random();
        let pool = r < 0.65 ? CardDB.creatures : r < 0.88 ? CardDB.spells : CardDB.traps;
        const template = pool[Math.floor(Math.random() * pool.length)];
        const card = {
            ...template,
            abilities: [...(template.abilities || [])],
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
            if (card.abilities && card.abilities.includes('camouflage')) card.hasCamouflage = true;
        }
        deck.push(card);
    }

    // Mélanger tout le deck (Fisher-Yates)
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Créer l'état initial d'un joueur
function createPlayerState() {
    const deck = createDeck();
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
