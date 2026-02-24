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
            description: 'Si cette créature devait aller au cimetière, transformez-la en Pile d\'os. Quand une créature alliée va au cimetière, Pile d\'os se transforme en Petit Os, le futé.'
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
            onAllyCreatureToGraveyardTransform: 'little_bone',
            description: 'Quand une créature alliée va au cimetière depuis le board, se transforme en Petit Os, le futé.'
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
            id: 'salamandre_de_braise',
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
            id: 'gobelin_fusee',
            name: 'Gobelin fusée',
            atk: 1,
            hp: 1,
            cost: 0,
            abilities: ['superhaste', 'fly'],
            type: 'creature',
            image: 'red/gobelin_fusee.png',
            arenaStyle: true,
            faction: 'red',
            creatureType: 'goblin',
            combatType: 'fly',
            edition: 2
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
        { id: 'drake_morose', name: 'Drake morose', atk: 4, hp: 4, cost: 0, abilities: ['fly', 'spellBoost'], spellBoostAmount: 1, type: 'creature', image: 'unknown/creature.png', combatType: 'fly', arenaStyle: true, faction: 'red', creatureType: 'dragon', edition: 4 },
        { id: 'deformed_lancer', name: 'Lancier difforme', atk: 2, hp: 3, cost: 0, abilities: ['bloodthirst'], bloodthirstAmount: 1, type: 'creature', image: 'unknown/creature.png', combatType: 'melee', arenaStyle: true, faction: 'red', creatureType: 'human', edition: 2 },
        { id: 'warchief', name: 'Chef de guerre', atk: 2, hp: 4, cost: 0, abilities: ['enhance'], enhanceAmount: 2, type: 'creature', image: 'unknown/creature.png', combatType: 'melee', arenaStyle: true, faction: 'red', creatureType: 'goblin', edition: 3, description: 'Les créatures adjacentes gagnent +2 ATK.' },
        { id: 'wolf_master', name: 'Maître loup', atk: 1, hp: 4, cost: 0, abilities: [], type: 'creature', image: 'unknown/creature.png', combatType: 'melee', arenaStyle: true, faction: 'white', creatureType: 'human', edition: 4, atkPerAdjacent: 1, description: 'Gagne +1 ATK pour chaque créature adjacente (jusqu\'à +3).' },
        { id: 'medusa_queen', name: 'Medusa à trois têtes', atk: 3, hp: 2, cost: 0, abilities: ['shooter', 'melody'], type: 'creature', image: 'unknown/creature.png', combatType: 'shooter', arenaStyle: true, faction: 'blue', creatureType: 'monstrosity', edition: 4 },
        { id: 'radiant_dragon', name: 'Dragon d\'Éclat', atk: 6, hp: 6, cost: 0, abilities: ['fly'], type: 'creature', image: 'blue/dragon-glace.png', combatType: 'fly', arenaStyle: true, faction: 'blue', creatureType: 'dragon', edition: 3 },
        { id: 'sea_serpent', name: 'Serpent de mer', atk: 1, hp: 5, cost: 0, abilities: ['intangible', 'power'], powerX: 2, type: 'creature', image: 'blue/serpentdemer.png', combatType: 'melee', arenaStyle: true, faction: 'blue', creatureType: 'serpent', edition: 3 },
        { id: 'radjawak', name: 'Radjawak', atk: 4, hp: 6, cost: 0, abilities: ['power', 'trample'], powerX: 2, type: 'creature', image: 'green/radjawak.png', combatType: 'melee', arenaStyle: true, faction: 'green', creatureType: 'beast', edition: 3 },
        {
            id: 'kraken_colossal',
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
            id: 'demon_superieur', name: 'Démon supérieur', atk: 3, hp: 3, cost: 3, type: 'creature',
            abilities: ['dissipation'], combatType: 'melee', creatureType: 'demon', faction: 'black', edition: 1,
            image: 'black/demon_superieur.png', arenaStyle: true, isToken: true
        },
        { id: 'escamoteur_ruelles', name: 'Escamoteur des ruelles', atk: 3, hp: 2, cost: 2, type: 'creature', abilities: ['camouflage'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/escamoteur_des_ruelles.png', arenaStyle: true },
        { id: 'assassin_cour', name: 'Assassin de la cour', atk: 2, hp: 1, cost: 3, type: 'creature', abilities: ['camouflage', 'lethal'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 4, image: 'black/assassin_de_la_cour.png', arenaStyle: true },
        { id: 'eternel', name: "L'éternel", atk: 0, hp: 5, cost: 0, type: 'creature', abilities: ['immovable', 'wall'], combatType: 'melee', creatureType: 'demon', faction: 'red', edition: 4, image: 'red/leternel.png', arenaStyle: true, onDeath: { destroyAll: true }, description: 'Mort : Détruisez toutes les créatures sur le terrain.' },
        { id: 'guerriere_solitaire', name: 'Guerrière solitaire', atk: 4, hp: 4, cost: 0, type: 'creature', abilities: ['trample'], combatType: 'melee', creatureType: 'human', faction: 'red', edition: 2, image: 'red/guerriere_solitaire.png', arenaStyle: true },
        { id: 'esprit_furieux', name: 'Esprit furieux', atk: 3, hp: 8, cost: 0, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'spirit', faction: 'red', edition: 3, image: 'red/esprit_furieux.png', arenaStyle: true, manaCap: 3, description: 'Tant que l\'Esprit furieux est en jeu, vous ne pouvez produire que 3 mana maximum.' },
        { id: 'liche_affaiblie', name: 'Liche affaiblie', atk: 2, hp: 2, cost: 2, type: 'creature', abilities: ['spectral'], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 1, image: 'black/liche_affaiblie.png', arenaStyle: true },
        { id: 'zombie_delabre', name: 'Zombie délabré', atk: 1, hp: 4, cost: 3, type: 'creature', abilities: ['poison'], poisonX: 1, combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 2, image: 'black/zombie_delabre.png', arenaStyle: true, onDeath: { poisonRow: 1 }, description: 'Mort : inflige 1 compteur poison à chaque créature adverse sur la ligne.' },
        { id: 'chevalier_pavois', name: 'Chevalier au pavois', atk: 3, hp: 5, cost: 0, type: 'creature', abilities: ['untargetable'], combatType: 'melee', creatureType: 'human', faction: 'white', edition: 2, image: 'white/chevalier_au_pavois.png', arenaStyle: true, description: 'Inciblable : cette créature ne peut pas être ciblée par les sorts.' },
        { id: 'cavalier_pegase', name: 'Cavalier de pégase', atk: 5, hp: 2, cost: 5, type: 'creature', abilities: ['fly', 'protection', 'trample'], combatType: 'fly', creatureType: 'human', faction: 'red', edition: 4, image: 'red/cavalier_de_pegase.png', arenaStyle: true, spellMagnet: true, description: 'Les sorts offensifs ciblés de l\'adversaire doivent cibler cette créature si possible.' },
        { id: 'dragon_squelette', name: 'Dragon squelette', atk: 0, hp: 7, cost: 6, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'undead', faction: 'black', edition: 3, image: 'black/dragon_squelette.png', arenaStyle: true, atkPerGraveyard: true, description: 'Pour chaque créature dans votre cimetière, le Dragon squelette gagne +1 ATK.' },
        { id: 'araignee_tireuse', name: 'Araignée tireuse', atk: 2, hp: 5, cost: 4, type: 'creature', abilities: ['shooter', 'entrave'], entraveX: 1, combatType: 'shooter', creatureType: 'spider', faction: 'black', edition: 1, image: 'black/araignee_tireuse.png', arenaStyle: true },
        { id: 'gueule_geante', name: 'Gueule géante', atk: 1, hp: 7, cost: 4, type: 'creature', abilities: ['provocation', 'immovable'], combatType: 'melee', creatureType: 'monstrosity', faction: 'black', edition: 2, image: 'black/gueule_geante.png', arenaStyle: true },
        { id: 'protecteur_divin', name: 'Protecteur divin', atk: 3, hp: 4, cost: 0, type: 'creature', abilities: ['lifelink'], lifelinkX: 2, combatType: 'melee', creatureType: 'undead', faction: 'white', edition: 2, image: 'white/protecteur_divin.png', arenaStyle: true },
        {
            id: 'banshee_sauvage',
            name: 'Banshee sauvage',
            atk: 2,
            hp: 2,
            cost: 3,
            abilities: ['fly', 'spectral'],
            type: 'creature',
            image: 'black/banshee_sauvage.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'spirit',
            combatType: 'fly',
            edition: 3,
            rarity: 3,
            endOfCombat: { damageAllEnemies: 1 },
            description: 'Fin du combat : inflige 1 dégât à toutes les créatures ennemies.'
        },
        {
            id: 'arcaniste_maladroit',
            name: 'Arcaniste maladroit',
            atk: 2,
            hp: 1,
            cost: 2,
            abilities: ['shooter'],
            type: 'creature',
            image: 'black/acaniste_maladroit.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'human',
            combatType: 'shooter',
            edition: 1,
            rarity: 1,
            onHeroAttack: { millFirstCreature: true },
            description: 'Quand l\'Arcaniste maladroit attaque le héros adverse, mettez la première créature du dessus de votre bibliothèque dans votre cimetière.'
        },
        {
            id: 'reine_toxique',
            name: 'Reine toxique',
            atk: 2,
            hp: 7,
            cost: 7,
            abilities: ['poison', 'antitoxin'],
            poisonX: 2,
            type: 'creature',
            image: 'black/reine_toxique.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'spider',
            combatType: 'melee',
            edition: 4,
            poisonCostReduction: true,
            healOnEnemyPoisonDeath: 2,
            description: 'Coûte 1 mana de moins pour chaque marqueur poison en jeu. Quand une créature ennemie meurt du poison, se soigne de 2.'
        },
        {
            id: 'roi_du_poison',
            name: 'Roi du poison',
            atk: 3,
            hp: 6,
            cost: 5,
            abilities: ['poison', 'antitoxin'],
            poisonX: 0,
            basePoisonX: 0,
            poisonEqualsTotalPoisonInPlay: true,
            type: 'creature',
            image: 'black/roi_du_poison.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'parasite',
            combatType: 'melee',
            edition: 4,
            description: 'Gagne Poison +1 pour chaque marqueur poison en jeu.'
        },
        {
            id: 'roi_des_cendres',
            name: 'Roi des Cendres',
            atk: 3,
            hp: 5,
            cost: 5,
            abilities: ['fly'],
            type: 'creature',
            image: 'black/roi_des_cendres.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'undead',
            combatType: 'fly',
            edition: 2,
            rarity: 2,
            uniquePassive: true,
            enemyPoisonedAtkDebuff: 1,
            description: 'Passif unique : les créatures ennemies empoisonnées ont -1 ATK.'
        },
        {
            id: 'chasseresse_masquee',
            name: 'Chasseresse masquée',
            atk: 2,
            hp: 1,
            cost: 3,
            abilities: ['shooter', 'poison', 'camouflage'],
            poisonX: 1,
            type: 'creature',
            image: 'black/chasseresse_masquee.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'human',
            combatType: 'shooter',
            edition: 3,
            drawOnEnemyPoisonDeath: 1,
            description: 'Quand une créature adverse meurt du poison, piochez une carte.'
        },
        {
            id: 'vampire_cruel',
            name: 'Vampire cruel',
            atk: 4,
            hp: 4,
            cost: 5,
            abilities: ['fly', 'lifedrain'],
            lifedrainX: 2,
            type: 'creature',
            image: 'black/vampire_cruel.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'undead',
            combatType: 'fly',
            edition: 2
        },
        { id: 'vampire_sordide', name: 'Vampire sordide', atk: 1, hp: 1, cost: 2, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'undead', faction: 'black', edition: 1, image: 'black/vampire_sordide.png', arenaStyle: true, onAnySacrifice: { atkBuff: 1, hpBuff: 1 }, description: 'Quand une créature alliée ou ennemie est sacrifiée, gagne +1/+1.' },
        { id: 'chevaucheur_de_l_ombre', name: 'Chevaucheur de l\'ombre', atk: 2, hp: 4, cost: 3, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'human', faction: 'black', edition: 2, image: 'black/chevaucheur_de_lombre.png', arenaStyle: true, endOfCombat: { selfMill: 3 }, description: 'Fin du combat : mettez les 3 cartes du dessus de votre bibliothèque dans votre cimetière.' },
        { id: 'cobra_cracheur', name: 'Cobra cracheur', atk: 1, hp: 3, cost: 3, type: 'creature', abilities: ['shooter', 'poison'], poisonX: 1, combatType: 'shooter', creatureType: 'serpent', faction: 'black', edition: 2, image: 'black/cobra_cracheur.png', arenaStyle: true },
        { id: 'nuee_de_moustique', name: 'Nuée de moustique', atk: 1, hp: 1, cost: 1, type: 'creature', abilities: ['fly', 'poison'], poisonX: 1, combatType: 'fly', creatureType: 'insect', faction: 'black', edition: 2, image: 'black/nuee_de_moustique.png', arenaStyle: true },
        { id: 'zobombie', name: 'Zobombie', atk: 2, hp: 1, cost: 1, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 1, image: 'black/zobombie.png', arenaStyle: true, onDeath: { healHero: 1 }, description: 'Mort : soigne votre héros de 1 PV.' },
        { id: 'behemoth_fantomatique', name: 'Béhémoth fantomatique', atk: 8, hp: 4, cost: 7, type: 'creature', abilities: ['spectral'], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 2, image: 'black/behemoth_fantomatique.png', arenaStyle: true },
        { id: 'demon_supreme', name: 'Démon Suprême', atk: 6, hp: 6, cost: 6, type: 'creature', abilities: ['fly', 'trample'], combatType: 'fly', creatureType: 'demon', faction: 'black', edition: 4, image: 'black/demon_supreme.png', arenaStyle: true, endOfCombat: { spawnAdjacentMelee: 'demon_superieur' }, description: 'Fin du combat : invoque un Démon supérieur sur une case mêlée adjacente vide.' },
        { id: 'paria_abysses', name: 'Paria des abysses', atk: 1, hp: 1, cost: 1, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/paria_des_abysses.png', arenaStyle: true, onDeath: { transformInto: 'zombie_paria' }, description: 'Mort : Se transforme en Zombie.' },
        { id: 'zombie_paria', name: 'Zombie', atk: 2, hp: 2, cost: 1, type: 'creature', abilities: ['dissipation'], combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 1, image: 'black/zombie.png', arenaStyle: true, isToken: true },
        { id: 'squelette_colossal', name: 'Squelette colossal', atk: 4, hp: 4, cost: 3, type: 'creature', abilities: ['dissipation', 'antitoxin'], combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 1, rarity: 1, image: 'black/squelette_colossal.png', arenaStyle: true },
        { id: 'titan_des_charniers', name: 'Titan des charniers', atk: 4, hp: 4, cost: 5, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'golem', faction: 'black', edition: 3, rarity: 3, image: 'black/titan_des_charniers.png', arenaStyle: true, onDeath: { summonIfPoisoned: 'squelette_colossal' }, description: 'Mort : si le Titan des charniers avait un marqueur poison ou plus, invoque un Squelette colossal 4/4 à sa place.' },
        { id: 'damne', name: 'Damné', atk: 1, hp: 1, cost: 1, type: 'creature', abilities: ['dissipation'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/damne.png', arenaStyle: true, isToken: true },
        { id: 'blaireau_contamine', name: 'Blaireau contaminé', atk: 5, hp: 4, cost: 4, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'beast', faction: 'black', edition: 2, image: 'black/blaireau_contamine.png', arenaStyle: true, onReanimate: { atkBuff: 2, hpBuff: 2, addAbility: 'trample' }, description: 'Quand le Blaireau contaminé est réanimé, il gagne +2/+2 et Piétinement.' },
        { id: 'ver_des_tombes', name: 'Ver des tombes', atk: 1, hp: 1, cost: 1, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'parasite', faction: 'black', edition: 2, image: 'black/ver_des_tombes.png', arenaStyle: true, onAllyMillToGraveyard: true, description: 'Quand une carte de créature est mise dans le cimetière depuis la bibliothèque, gagne +1/+1.' },
        { id: 'nourrisseur_de_chair', name: 'Nourrisseur de chair', atk: 1, hp: 1, cost: 2, type: 'creature', abilities: ['haste'], combatType: 'melee', creatureType: 'parasite', faction: 'black', edition: 3, image: 'black/nourriseur_de_chair.png', arenaStyle: true, endOfCombat: { absorbAdjacent: true }, description: 'Fin du combat : sacrifie une créature alliée adjacente, absorbe ses stats de base et ses capacités communes.' },
        { id: 'boucher_des_abysses', name: 'Boucher des abysses', atk: 3, hp: 2, cost: 2, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 3, image: 'black/boucher_des_abysses.png', arenaStyle: true, onAdjacentAllyDeath: { atk: 1, hp: 1 }, description: 'Quand une créature alliée adjacente meurt, gagne +1/+1 permanent.' },
        { id: 'possede_ephemere', name: 'Possédé éphémère', atk: 3, hp: 3, cost: 2, type: 'creature', abilities: ['haste'], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 3, image: 'black/possede_ephemere.png', arenaStyle: true, endOfCombat: { selfSacrifice: true }, description: 'Fin du combat : le Possédé éphémère se sacrifie.' },
        { id: 'pion_funeraire', name: 'Pion Funéraire', atk: 3, hp: 2, cost: 3, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 3, rarity: 3, image: 'black/pion_funeraire.png', arenaStyle: true, onDeath: { reanimateMeleeCost2OrLessBottom: true }, description: 'Mort : réanime la créature de mêlée alliée de coût 2 ou moins la plus basse dans votre cimetière sur son emplacement.' },
        { id: 'fossoyeur_methodique', name: 'Fossoyeur méthodique', atk: 2, hp: 2, cost: 1, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/fossoyeur_methodique.png', arenaStyle: true, onDeath: { millFirstCreature: true }, description: 'Quand le Fossoyeur méthodique meurt, mettez la première carte de créature du dessus de votre bibliothèque au cimetière.' },
        { id: 'rosalia_demonicus', name: 'Rosalia démonicus', hp: 3, cost: 2, type: 'creature', isBuilding: true, abilities: [], faction: 'black', edition: 2, image: 'black/rosalia_demonicus.png', arenaStyle: true, activeAbility: 'poisonAll', description: 'Active : inflige 1 marqueur poison à toutes les créatures.' },
        { id: 'pustule_vivante', name: 'Pustule vivante', hp: 2, cost: 2, type: 'creature', isBuilding: true, abilities: [], faction: 'black', edition: 2, image: 'black/pustule_vivante.png', arenaStyle: true, activeAbility: 'selfPoison', onDeath: { poisonExplosion: true }, description: 'Active : gagne 1 marqueur poison. À sa mort, inflige des dégâts égaux à ses marqueurs poison à toutes les créatures ennemies.' },
        { id: 'serpent_emeraude', name: 'Serpent d\'émeraude', atk: 2, hp: 2, cost: 2, type: 'creature', abilities: ['antitoxin'], combatType: 'melee', creatureType: 'serpent', faction: 'black', edition: 3, image: 'black/serpent_demeraude.png', arenaStyle: true, buffOnEnemyPoisonDeath: true, trampleAtBuffCounters: 3, description: 'Quand une créature ennemie meurt du poison, le Serpent d\'émeraude gagne +1/+1. Acquiert Piétinement avec 3 marqueurs +1/+1 ou plus.' },
        { id: 'porteur_de_peste', name: 'Porteur de peste', atk: 1, hp: 4, cost: 3, type: 'creature', abilities: ['antitoxin'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 3, image: 'black/porteur_peste.png', arenaStyle: true, onDeath: { poisonAll: 1 }, description: 'Quand le Porteur de peste meurt, met 1 marqueur poison à toutes les créatures.' },
        { id: 'spectre_recurrent', name: 'Spectre récurrent', atk: 2, hp: 1, cost: 2, type: 'creature', abilities: ['fly', 'dissipation'], combatType: 'fly', creatureType: 'spirit', faction: 'black', edition: 2, image: 'black/spectre_recurrent.png', arenaStyle: true, graveyardTrigger: 'reanimateOnAllyDeath', description: 'Quand une créature alliée va au cimetière, si le Spectre est dans votre cimetière, il se réanime sur l\'emplacement de la créature morte.' }
    ],
    spells: [
        { id: 'plan_douteux', name: 'Plan douteux', cost: 2, type: 'spell', spellSpeed: 3, offensive: true, spellType: 'offensif', pattern: 'single', targetEmptySlot: true, image: 'black/plan_douteux.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature sur cet emplacement. Ce sort ne peut cibler qu\'un emplacement vide.', effect: 'destroy' },
        { id: 'tir_compresse', name: 'Tir compressé', cost: 0, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'single', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 3, rarity: 'rare', description: 'Inflige 3 blessures à la créature sur cet emplacement. Si Tir compressé tue la cible, vous piochez une carte.', onKill: { draw: 1 } },
        { id: 'croix_de_feu', name: 'Croix de feu', cost: 0, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'cross', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, rarity: 'uncommon', description: 'Inflige 2 blessures à la créature sur cet emplacement et 2 blessures à toutes les créatures adjacentes.' },
        { id: 'blast', name: 'Blast', cost: 0, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'single', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, returnOnMiss: true, description: 'Inflige 2 blessures à la créature ciblée. Si Blast ne touche pas de créature, il retourne dans votre main.' },
        { id: 'coup_de_poing', name: 'Coup de poing', cost: 0, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'hero', targetEnemy: true, damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'Inflige 2 dégâts au héros adverse.' },
        { id: 'tremblement_de_terre', name: 'Tremblement de terre', cost: 0, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'all', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'green', edition: 3, description: 'Inflige 3 dégâts à toutes les créatures.' },
        { id: 'vitesse_superieure', name: 'Vitesse supérieure', cost: 0, type: 'spell', spellSpeed: 1, offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, targetEnemy: true, effect: 'draw', amount: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'Le joueur ciblé pioche deux cartes.' },
        { id: 'reanimation', name: 'Réanimation', cost: 3, type: 'spell', spellSpeed: 4, offensive: false, spellType: 'défensif', pattern: 'self', effect: 'reanimate', image: 'black/reanimation.png', arenaStyle: true, faction: 'black', edition: 2, targetSelfEmptySlot: true, requiresGraveyardCreature: true, description: 'Placez une créature de votre cimetière sur cet emplacement vide.' },
        { id: 'reanimation_defectueuse', name: 'Réanimation défectueuse', cost: 2, type: 'spell', spellSpeed: 4, offensive: false, spellType: 'défensif', pattern: 'self', effect: 'reanimateWeakened', image: 'black/reanimation_defectueuse.png', arenaStyle: true, faction: 'black', edition: 2, targetSelfEmptySlot: true, requiresGraveyardCreature: true, description: 'Réanime une créature de votre cimetière sur cet emplacement vide. La créature réanimée a ses PV mis à 1.' },
        { id: 'alteration_musculaire', name: 'Altération musculaire', cost: 0, type: 'spell', spellSpeed: 1, offensive: false, spellType: 'défensif', pattern: 'single', targetSelfCreature: true, effect: 'atkBuff', atkBuff: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'La créature alliée ciblée gagne +2 ATK.' },
        { id: 'armes_magiques', name: 'Armes magiques', cost: 0, type: 'spell', spellSpeed: 1, offensive: false, spellType: 'défensif', pattern: 'all', effect: 'buffAll', buffAtk: 1, buffHp: 1, image: 'white/armes_magiques.png', arenaStyle: true, faction: 'white', edition: 2, description: 'Mettez un marqueur +1 ATK / +1 HP sur toutes vos créatures.' },
        { id: 'besoins', name: 'Besoins', cost: 2, type: 'spell', spellSpeed: 4, offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, effect: 'selfDamageAndDraw', selfDamage: 2, drawAmount: 2, image: 'black/besoins.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Perdez 2 PV, piochez 2 cartes.' },
        { id: 'cruel_destin', name: 'Cruel destin', cost: 3, type: 'spell', spellSpeed: 2, offensive: true, spellType: 'offensif', pattern: 'all', effect: 'sacrificeLastAndDamage', image: 'black/cruel_destin.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Chaque joueur sacrifie la dernière créature qu\'il a jouée.' },
        { id: 'coup_de_poignard', name: 'Coup de poignard', cost: 4, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'single', effect: 'destroy', image: 'black/coup_de_poignard.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature ciblée.' },
        { id: 'ensevelissement', name: 'Ensevelissement', cost: 1, type: 'spell', spellSpeed: 5, offensive: false, spellType: 'hybride', pattern: 'hero', targetSelf: true, targetEnemy: true, effect: 'mill', millCount: 3, image: 'black/ensevelissement.png', arenaStyle: true, faction: 'black', edition: 1, description: 'Mettez les 3 cartes du dessus de la bibliothèque du héros ciblé dans son cimetière.' },
        { id: 'mon_precieux', name: 'Mon précieux', cost: 2, type: 'spell', spellSpeed: 4, offensive: false, spellType: 'défensif', pattern: 'all', effect: 'graveyardToHand', requiresGraveyardCreature: true, image: 'black/mon_precieux.png', arenaStyle: true, faction: 'black', edition: 1, description: 'Renvoyez une carte de créature de votre cimetière dans votre main.' },
        { id: 'pacte_sombre', name: 'Pacte sombre', cost: 1, type: 'spell', spellSpeed: 5, offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, effect: 'millHighestCostCreature', image: 'black/pacte_sombre.png', arenaStyle: true, faction: 'black', edition: 1, description: 'Mettez la carte de créature avec le coût le plus élevé de votre bibliothèque dans votre cimetière.' },
        { id: 'contamination_eau', name: 'Contamination de l\'eau', cost: 3, type: 'spell', spellSpeed: 3, offensive: true, spellType: 'offensif', pattern: 'all', effect: 'poisonAllEnemies', poisonAmount: 1, image: 'black/contamination_de_leau.png', arenaStyle: true, faction: 'black', edition: 3, description: 'Toutes les créatures adverses reçoivent un marqueur poison.' },
        { id: 'mur_de_zombie', name: 'Mur de zombie', cost: 4, type: 'spell', spellSpeed: 3, offensive: false, spellType: 'défensif', pattern: 'global', effect: 'summonZombieWall', summonId: 'zombie_paria', image: 'black/mur_de_zombie.png', arenaStyle: true, faction: 'black', edition: 4, description: 'Invoque un Zombie 2/2 dans chaque emplacement de mêlée vide.' },
        { id: 'brume_toxique', name: 'Brume toxique', cost: 2, type: 'spell', spellSpeed: 2, offensive: true, spellType: 'offensif', pattern: 'all', effect: 'triggerPoison', image: 'black/brume_toxique.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Toutes les créatures empoisonnées subissent immédiatement leurs dégâts de poison.' },
        { id: 'cycle_eternel', name: 'Cycle éternel', cost: 3, type: 'spell', spellSpeed: 2, offensive: false, spellType: 'defensif', pattern: 'self', effect: 'reanimateSacrifice', image: 'black/cycle_eternel.png', arenaStyle: true, faction: 'black', edition: 3, targetSelfEmptySlot: true, requiresGraveyardCreature: true, description: 'Réanime une créature avec Célérité. Fin du combat : sacrifier cette créature.' },
        { id: 'cri_outre_tombe', name: 'Cri d\'outre tombe', cost: 3, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'all', effect: 'debuffAll', atkDebuff: 2, hpDebuff: 2, image: 'black/cri_doutre_tombe.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Toutes les créatures gagnent -2 ATK et -2 HP.' },
        { id: 'drain_vital', name: 'Drain vital', cost: 2, type: 'spell', spellSpeed: 2, offensive: true, spellType: 'offensif', pattern: 'single', damage: 2, onKill: { healHero: 2 }, excludeBuildings: true, image: 'black/drain_vital.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Inflige 2 dégâts à une créature. Si elle meurt, soignez votre héros de 2 PV.' },
        { id: 'pacte_benefique', name: 'Pacte bénéfique', cost: 3, type: 'spell', spellSpeed: 5, offensive: false, spellType: 'défensif', pattern: 'single', targetSelfCreature: true, effect: 'sacrificeAndDraw', drawAmount: 3, excludeBuildings: true, image: 'black/pacte_benefique.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Sacrifiez une créature alliée ciblée, piochez 3 cartes.' },
        { id: 'expurger_le_poison', name: 'Expurger le poison', cost: 2, type: 'spell', spellSpeed: 1, offensive: true, spellType: 'offensif', pattern: 'single', effect: 'destroyIfPoisoned', image: 'black/expurger_poison.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature ciblée si elle possède au moins un marqueur poison.' },
        { id: 'invoquer_les_damnes', name: 'Invoquer les damnés', cost: 2, type: 'spell', spellSpeed: 4, offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, effect: 'addTokensToHand', tokenId: 'damne', tokenCount: 3, image: 'black/invoquer_les_damnes.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Ajoutez 3 Damnés dans votre main.' }
    ],
    traps: [
        { id: 'troubeant', name: 'Trou béant', damage: 6, cost: 2, type: 'trap', meleeOnly: true, image: 'neutral/troubeant.png', arenaStyle: true, faction: 'neutral', edition: 1, description: 'Inflige 6 dégâts à la première créature de mêlée adverse qui attaque sur la ligne.' },
        { id: 'trappe_secrete', name: 'Trappe secrète', damage: 3, cost: 3, type: 'trap', pattern: 'line', image: 'neutral/trappe_secrete.png', arenaStyle: true, faction: 'neutral', edition: 2, description: 'Inflige 3 blessures à toutes les créatures adverses sur cette ligne.' },
        { id: 'voyage_inattendu', name: 'Voyage inattendu', cost: 3, type: 'trap', effect: 'bounce', image: 'neutral/voyage_inattendu.png', arenaStyle: true, faction: 'neutral', edition: 2, rarity: 'uncommon', description: 'Renvoyez la créature dans la main de son propriétaire.' },
        { id: 'piege_a_gobelin', name: 'Piège à gobelin', cost: 2, type: 'trap', effect: 'summon', summonId: 'gobelin_jumele', image: 'neutral/piege_a_gobelin.png', arenaStyle: true, faction: 'neutral', edition: 3, description: 'Invoque un Gobelin jumelé sur l\'emplacement adjacent. Ne se déclenche que si cet emplacement est vide.' }
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
        ability: 'Aura passive : toutes les créatures avec 1 ATK de base gagnent +1/+0. Cumulable.'
    },
    erebeth: {
        id: 'erebeth',
        name: 'Erebeth, ange de la mort',
        image: 'black/Erebeth_ange_de_la_mort.png',
        titleColor: '#2a1a3dba', // Noir/violet
        faction: 'black',
        edition: 3,
        ability: 'Quand une créature alliée va au cimetière depuis le terrain, soignez 1 PV. Une fois par tour.'
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
    const baseCard = CardByIdMap.get(card.id);
    const reset = baseCard ? { ...baseCard } : { ...card };
    if (reset.abilities && reset.abilities.includes('protection')) {
        reset.hasProtection = true;
    }
    if (reset.abilities && reset.abilities.includes('camouflage')) {
        reset.hasCamouflage = true;
    }
    if (card.uid) reset.uid = card.uid;
    // Initialiser baseAtk/baseHp pour les créatures (nécessaire pour l'affichage boosted/reduced)
    if (reset.type === 'creature') {
        reset.baseAtk = reset.atk;
        reset.baseHp = reset.hp;
    }
    // Nettoyer les propriétés dynamiques de combat
    delete reset.poisonCounters;
    delete reset.medusaGazeMarker;
    delete reset.entraveCounters;
    delete reset.melodyLocked;
    delete reset.petrified;
    delete reset.buffCounters;
    return reset;
}

// Ajouter une carte au cimetière
function addToGraveyard(player, card) {
    const resetCard = resetCardForGraveyard(card);
    if (resetCard) {
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
    const hand = deck.splice(0, 5);
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
        summonCounter: 0,
        players: { 1: createPlayerState(), 2: createPlayerState() }
    };
}

// Lookup Map O(1) pour trouver une carte par id (au lieu de .find() en O(n))
const CardByIdMap = new Map();
CardDB.creatures.forEach(c => CardByIdMap.set(c.id, c));
CardDB.spells.forEach(c => CardByIdMap.set(c.id, c));
CardDB.traps.forEach(c => CardByIdMap.set(c.id, c));

// Guardrail: every new gameplay ability/hook must be mapped to a resolution phase.
// If a new key appears and is not mapped here, startup fails with an actionable message.
const ABILITY_RESOLUTION_CONTRACT = Object.freeze({
    commonAbilities: Object.freeze({
        antitoxin: 'pre-hit validation',
        bloodthirst: 'post-death buff window',
        camouflage: 'targeting gate',
        cleave: 'on-hit attacker',
        dissipation: 'death handling',
        enhance: 'aura recompute',
        entrave: 'on-hit marker apply',
        fly: 'targeting gate',
        haste: 'deploy readiness',
        immovable: 'board movement lock',
        intangible: 'targeting gate',
        lethal: 'on-hit attacker',
        lifedrain: 'life effects',
        lifelink: 'life effects',
        melody: 'aura recompute',
        poison: 'on-hit marker apply',
        power: 'post-hit/post-poison/post-endOfCombat buff windows',
        protection: 'pre-hit mitigation',
        provocation: 'deploy placement gate',
        regeneration: 'post-hit sustain',
        shooter: 'targeting gate',
        spectral: 'pre-hit mitigation',
        spellBoost: 'spell damage pipeline',
        superhaste: 'deploy readiness',
        trample: 'on-hit attacker',
        unsacrificable: 'sacrifice gate',
        untargetable: 'targeting gate',
        wall: 'attack eligibility gate'
    }),
    creatureHooks: Object.freeze({
        activeAbility: 'building active phase',
        buffOnEnemyPoisonDeath: 'post-poison death effects',
        drawOnEnemyPoisonDeath: 'post-poison death effects',
        endOfCombat: 'endOfCombat phase',
        graveyardTrigger: 'post-death graveyard trigger',
        healOnEnemyPoisonDeath: 'post-poison death effects',
        onAdjacentAllyDeath: 'post-death effects',
        onAllyCreatureToGraveyardTransform: 'post-death transform',
        onAllyMillToGraveyard: 'post-mill trigger',
        onAnySacrifice: 'post-sacrifice trigger',
        onDeath: 'death handling',
        onEnemyDamage: 'on-hit defender trigger',
        onHeroAttack: 'post-hit trigger',
        onHeroHit: 'post-hit trigger',
        onPoisonDeath: 'post-poison death effects',
        onReanimate: 'post-reanimate trigger'
    }),
    onDeathKeys: Object.freeze({
        damageHero: 'death handling',
        damageKiller: 'death handling',
        damageRow: 'death handling',
        destroyAll: 'death handling',
        healHero: 'death handling',
        millFirstCreature: 'death handling',
        poisonAll: 'death handling',
        poisonExplosion: 'death handling',
        poisonRow: 'death handling',
        summonIfPoisoned: 'death handling',
        reanimateMeleeCost2OrLessBottom: 'death handling',
        transformInto: 'death handling'
    }),
    endOfCombatKeys: Object.freeze({
        absorbAdjacent: 'endOfCombat',
        damageAllEnemies: 'endOfCombat',
        selfMill: 'endOfCombat',
        selfSacrifice: 'endOfCombat (last)',
        spawnAdjacentMelee: 'endOfCombat'
    }),
    activeAbilityKeys: Object.freeze({
        poisonAll: 'building active ability',
        selfPoison: 'building active ability'
    }),
    onEnemyDamageKeys: Object.freeze({
        poisonRow: 'on-hit defender trigger'
    }),
    onReanimateKeys: Object.freeze({
        addAbility: 'post-reanimate',
        atkBuff: 'post-reanimate',
        hpBuff: 'post-reanimate'
    }),
    onAnySacrificeKeys: Object.freeze({
        atkBuff: 'post-sacrifice',
        hpBuff: 'post-sacrifice'
    }),
    onAdjacentAllyDeathKeys: Object.freeze({
        atk: 'post-death',
        hp: 'post-death'
    }),
    onHeroAttackKeys: Object.freeze({
        atkBoost: 'post-hit',
        millFirstCreature: 'post-hit'
    }),
    spellEffectKeys: Object.freeze({
        addTokensToHand: 'spell resolution',
        atkBuff: 'spell resolution',
        buffAll: 'spell resolution',
        debuffAll: 'spell resolution',
        destroy: 'spell resolution',
        destroyIfPoisoned: 'spell resolution',
        draw: 'spell resolution',
        graveyardToHand: 'spell resolution',
        mill: 'spell resolution',
        millHighestCostCreature: 'spell resolution',
        poisonAllEnemies: 'spell resolution',
        reanimate: 'spell resolution',
        reanimateSacrifice: 'spell resolution',
        reanimateWeakened: 'spell resolution',
        sacrificeAndDraw: 'spell resolution',
        sacrificeLastAndDamage: 'spell resolution',
        selfDamageAndDraw: 'spell resolution',
        summonZombieWall: 'spell resolution',
        triggerPoison: 'spell resolution'
    }),
    spellHooks: Object.freeze({
        effect: 'spell resolution',
        onKill: 'post-damage',
        returnOnMiss: 'post-spell resolution'
    }),
    onKillKeys: Object.freeze({
        draw: 'post-kill trigger',
        healHero: 'post-kill trigger'
    }),
    trapEffectKeys: Object.freeze({
        bounce: 'trap resolution',
        summon: 'trap resolution'
    })
});

function validateCardAbilityResolutionContract() {
    const errors = [];
    const remind = 'Map it in ABILITY_RESOLUTION_CONTRACT with a resolution phase. If unclear, ask where it belongs in the combat pipeline before implementation.';

    const pushErr = (cardId, field, value) => {
        errors.push(`[ABILITY-CONTRACT] card=${cardId} field=${field} value=${String(value)} is not classified. ${remind}`);
    };

    const validateMappedObjectKeys = (cardId, field, obj, map) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
            if (!Object.prototype.hasOwnProperty.call(map, key)) {
                pushErr(cardId, `${field}.${key}`, key);
            }
        }
    };

    for (const card of CardDB.creatures) {
        for (const ability of (card.abilities || [])) {
            if (!Object.prototype.hasOwnProperty.call(ABILITY_RESOLUTION_CONTRACT.commonAbilities, ability)) {
                pushErr(card.id, 'abilities[]', ability);
            }
        }

        const creatureHookKeys = Object.keys(card).filter((k) =>
            k === 'activeAbility' ||
            k === 'endOfCombat' ||
            k === 'graveyardTrigger' ||
            k === 'drawOnEnemyPoisonDeath' ||
            k === 'healOnEnemyPoisonDeath' ||
            k === 'buffOnEnemyPoisonDeath' ||
            k.startsWith('on')
        );
        for (const hookKey of creatureHookKeys) {
            if (!Object.prototype.hasOwnProperty.call(ABILITY_RESOLUTION_CONTRACT.creatureHooks, hookKey)) {
                pushErr(card.id, 'creatureHook', hookKey);
            }
        }

        if (card.activeAbility && !Object.prototype.hasOwnProperty.call(ABILITY_RESOLUTION_CONTRACT.activeAbilityKeys, card.activeAbility)) {
            pushErr(card.id, 'activeAbility', card.activeAbility);
        }

        validateMappedObjectKeys(card.id, 'onDeath', card.onDeath, ABILITY_RESOLUTION_CONTRACT.onDeathKeys);
        validateMappedObjectKeys(card.id, 'endOfCombat', card.endOfCombat, ABILITY_RESOLUTION_CONTRACT.endOfCombatKeys);
        validateMappedObjectKeys(card.id, 'onEnemyDamage', card.onEnemyDamage, ABILITY_RESOLUTION_CONTRACT.onEnemyDamageKeys);
        validateMappedObjectKeys(card.id, 'onReanimate', card.onReanimate, ABILITY_RESOLUTION_CONTRACT.onReanimateKeys);
        validateMappedObjectKeys(card.id, 'onAnySacrifice', card.onAnySacrifice, ABILITY_RESOLUTION_CONTRACT.onAnySacrificeKeys);
        validateMappedObjectKeys(card.id, 'onAdjacentAllyDeath', card.onAdjacentAllyDeath, ABILITY_RESOLUTION_CONTRACT.onAdjacentAllyDeathKeys);
        validateMappedObjectKeys(card.id, 'onHeroAttack', card.onHeroAttack, ABILITY_RESOLUTION_CONTRACT.onHeroAttackKeys);
    }

    for (const card of CardDB.spells) {
        const spellHookKeys = Object.keys(card).filter((k) => k === 'effect' || k === 'onKill' || k === 'returnOnMiss');
        for (const hookKey of spellHookKeys) {
            if (!Object.prototype.hasOwnProperty.call(ABILITY_RESOLUTION_CONTRACT.spellHooks, hookKey)) {
                pushErr(card.id, 'spellHook', hookKey);
            }
        }
        if (card.effect && !Object.prototype.hasOwnProperty.call(ABILITY_RESOLUTION_CONTRACT.spellEffectKeys, card.effect)) {
            pushErr(card.id, 'effect', card.effect);
        }
        validateMappedObjectKeys(card.id, 'onKill', card.onKill, ABILITY_RESOLUTION_CONTRACT.onKillKeys);
    }

    for (const card of CardDB.traps) {
        if (card.effect && !Object.prototype.hasOwnProperty.call(ABILITY_RESOLUTION_CONTRACT.trapEffectKeys, card.effect)) {
            pushErr(card.id, 'effect', card.effect);
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `Ability resolution contract validation failed (${errors.length} issue(s)).\n${errors.join('\n')}`
        );
    }
}

validateCardAbilityResolutionContract();

module.exports = {
    CardDB,
    CardByIdMap,
    ABILITY_RESOLUTION_CONTRACT,
    validateCardAbilityResolutionContract,
    HERO_NAMES,
    HEROES,
    getRandomHero,
    resetCardForGraveyard,
    addToGraveyard,
    createDeck,
    createPlayerState,
    createGameState
};
