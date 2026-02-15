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
            combatType: 'melee', creatureType: 'demon', faction: 'black', edition: 1,
            image: 'black/demon_superieur.png', arenaStyle: true, sacrifice: 1
        },
        { id: 'escamoteur_ruelles', name: 'Escamoteur des ruelles', atk: 3, hp: 2, cost: 0, type: 'creature', abilities: ['camouflage'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/escamoteur_des_ruelles.png', arenaStyle: true },
        { id: 'assassin_cour', name: 'Assassin de la cour', atk: 2, hp: 1, cost: 0, type: 'creature', abilities: ['camouflage', 'lethal'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 4, image: 'black/assassin_de_la_cour.png', arenaStyle: true },
        { id: 'eternel', name: "L'éternel", atk: 0, hp: 5, cost: 0, type: 'creature', abilities: ['immovable', 'wall'], combatType: 'melee', creatureType: 'demon', faction: 'red', edition: 4, image: 'red/leternel.png', arenaStyle: true, onDeath: { destroyAll: true }, description: 'Quand L\'éternel meurt, détruisez toutes les créatures sur le plateau.' },
        { id: 'guerriere_solitaire', name: 'Guerrière solitaire', atk: 4, hp: 4, cost: 0, type: 'creature', abilities: ['trample'], combatType: 'melee', creatureType: 'human', faction: 'red', edition: 2, image: 'red/guerriere_solitaire.png', arenaStyle: true, endOfTurn: { selfDamage: 1 }, description: 'À la fin du tour, la Guerrière solitaire inflige 1 dégât à votre héros.' },
        { id: 'esprit_furieux', name: 'Esprit furieux', atk: 3, hp: 8, cost: 0, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'spirit', faction: 'red', edition: 3, image: 'red/esprit_furieux.png', arenaStyle: true, manaCap: 3, description: 'Tant que l\'Esprit furieux est en jeu, vous ne pouvez produire que 3 mana maximum.' },
        { id: 'liche_affaiblie', name: 'Liche affaiblie', atk: 2, hp: 2, cost: 0, type: 'creature', abilities: ['spectral'], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 1, image: 'black/liche_affaiblie.png', arenaStyle: true },
        { id: 'zombie_delabre', name: 'Zombie délabré', atk: 1, hp: 4, cost: 0, type: 'creature', abilities: ['poison'], poisonX: 1, combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 2, image: 'black/zombie_delabre.png', arenaStyle: true, onDeath: { poisonRow: 1 }, description: 'Quand le Zombie délabré meurt, il inflige 1 compteur poison à chaque créature adverse de sa ligne.' },
        { id: 'chevalier_pavois', name: 'Chevalier au pavois', atk: 3, hp: 5, cost: 0, type: 'creature', abilities: ['untargetable'], combatType: 'melee', creatureType: 'human', faction: 'white', edition: 2, image: 'white/chevalier_au_pavois.png', arenaStyle: true, description: 'Inciblable : cette créature ne peut pas être ciblée par les sorts.' },
        { id: 'cavalier_pegase', name: 'Cavalier de pégase', atk: 5, hp: 2, cost: 5, type: 'creature', abilities: ['fly', 'protection', 'trample'], combatType: 'fly', creatureType: 'human', faction: 'red', edition: 4, image: 'red/cavalier_de_pegase.png', arenaStyle: true, spellMagnet: true, description: 'Les sorts offensifs ciblés de l\'adversaire doivent cibler cette créature si possible.' },
        { id: 'dragon_squelette', name: 'Dragon squelette', atk: 0, hp: 7, cost: 0, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'undead', faction: 'black', edition: 3, image: 'black/dragon_squelette.png', arenaStyle: true, atkPerGraveyard: true, description: 'Pour chaque créature dans votre cimetière, le Dragon squelette gagne +1 ATK.' },
        { id: 'araignee_tireuse', name: 'Araignée tireuse', atk: 2, hp: 5, cost: 0, type: 'creature', abilities: ['shooter', 'entrave'], entraveX: 1, combatType: 'shooter', creatureType: 'spider', faction: 'black', edition: 1, image: 'black/araignee_tireuse.png', arenaStyle: true },
        { id: 'protecteur_divin', name: 'Protecteur divin', atk: 3, hp: 4, cost: 0, type: 'creature', abilities: ['lifelink'], lifelinkX: 2, combatType: 'melee', creatureType: 'undead', faction: 'white', edition: 2, image: 'white/protecteur_divin.png', arenaStyle: true },
        {
            id: 'banshee_sauvage',
            name: 'Banshee sauvage',
            atk: 2,
            hp: 2,
            cost: 0,
            abilities: ['fly', 'spectral'],
            type: 'creature',
            image: 'black/banshee_sauvage.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'spirit',
            combatType: 'fly',
            edition: 4,
            onSummon: { destroyFacing: true },
            description: 'Quand la Banshee sauvage entre en jeu, détruisez la créature en face.'
        },
        {
            id: 'matrone_arachnide',
            name: 'Matrone arachnide',
            atk: 0,
            hp: 6,
            cost: 0,
            abilities: ['poison', 'regeneration'],
            poisonX: 1,
            regenerationX: 2,
            type: 'creature',
            image: 'black/matronne_arachnide.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'spider',
            combatType: 'melee',
            edition: 2,
            startOfTurn: { selfPoison: 1 },
            atkPerPoisonInPlay: true,
            description: 'Début du tour : la Matrone arachnide reçoit 1 marqueur poison. Son attaque est égale au nombre de marqueurs poison en jeu.'
        },
        {
            id: 'momie_pourrie',
            name: 'Momie pourrie',
            atk: 2,
            hp: 3,
            cost: 0,
            abilities: [],
            type: 'creature',
            image: 'black/momie_pourrie.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'undead',
            combatType: 'melee',
            edition: 1,
            onSummon: { selfPoison: 1 },
            onPoisonDeath: { poisonAllEnemies: 1 },
            description: 'Quand la Momie pourrie entre en jeu, mettez-lui 1 marqueur poison. Si elle meurt du poison, elle met 1 marqueur poison sur toutes les créatures ennemies.'
        },
        {
            id: 'reine_toxique',
            name: 'Reine toxique',
            atk: 2,
            hp: 7,
            cost: 10,
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
            id: 'roi_des_rats',
            name: 'Roi des rats',
            atk: 2,
            hp: 6,
            cost: 0,
            abilities: ['poison'],
            poisonX: 1,
            type: 'creature',
            image: 'black/roi_des_rats.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'beast',
            combatType: 'melee',
            edition: 2,
            poisonPerGraveyard: 6,
            description: 'Pour chaque 6 cartes dans votre cimetière, Roi des rats gagne Poison +1.'
        },
        {
            id: 'chasseresse_masquee',
            name: 'Chasseresse masquée',
            atk: 2,
            hp: 1,
            cost: 0,
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
            id: 'goule_tenace',
            name: 'Goule tenace',
            atk: 3,
            hp: 3,
            cost: 0,
            abilities: ['lifedrain'],
            lifedrainX: 2,
            type: 'creature',
            image: 'black/goule_tenace.png',
            arenaStyle: true,
            faction: 'black',
            creatureType: 'undead',
            combatType: 'melee',
            edition: 3,
            graveyardReturn: { minCreatures: 5 },
            description: 'À la fin du tour, si la Goule tenace est dans votre cimetière et que vous avez 5 créatures ou plus au cimetière, renvoyez-la dans votre main.'
        },
        { id: 'vampire_sordide', name: 'Vampire sordide', atk: 1, hp: 1, cost: 0, type: 'creature', abilities: ['fly'], combatType: 'fly', creatureType: 'undead', faction: 'black', edition: 1, image: 'black/vampire_sordide.png', arenaStyle: true, onAllySacrifice: { atkBuff: 2, hpBuff: 2 }, description: 'Pour chaque créature alliée sacrifiée, le Vampire sordide gagne +2 ATK et +2 HP.' },
        { id: 'excavateur_stratege', name: 'Excavateur stratège', atk: 2, hp: 1, cost: 0, type: 'creature', abilities: ['shooter'], combatType: 'shooter', creatureType: 'human', faction: 'black', edition: 3, image: 'black/excavateur_stratege.png', arenaStyle: true, onSummon: { graveyardReturnAtk1: true }, description: 'Quand l\'Excavateur stratège arrive en jeu, renvoyez toutes les créatures avec 1 ATK de votre cimetière dans votre main (jusqu\'à remplir votre main).' },
        { id: 'zobombie', name: 'Zobombie', atk: 1, hp: 1, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 1, image: 'black/zobombie.png', arenaStyle: true, onSacrifice: { damageOpponent: 1 }, description: 'Si le Zobombie est sacrifié, il inflige 1 dégât au héros adverse.' },
        { id: 'behemoth_fantomatique', name: 'Béhémoth fantomatique', atk: 8, hp: 4, cost: 0, type: 'creature', abilities: ['spectral'], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 2, image: 'black/behemoth_fantomatique.png', arenaStyle: true },
        { id: 'demon_supreme', name: 'Démon Suprême', atk: 6, hp: 6, cost: 0, type: 'creature', abilities: ['trample'], combatType: 'fly', creatureType: 'demon', faction: 'black', edition: 4, image: 'black/demon_supreme.png', arenaStyle: true, sacrifice: 2, startOfTurn: { heroDrain: 1 }, description: 'Début du tour : infligez 1 dégât au héros adverse et soignez 1 PV à votre héros.' },
        { id: 'paria_abysses', name: 'Paria des abysses', atk: 0, hp: 2, cost: 0, type: 'creature', abilities: ['wall', 'immovable'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/paria_des_abysses.png', arenaStyle: true, onDeath: { transformInto: 'zombie_paria' }, description: 'Quand le Paria des abysses meurt, il se transforme en Zombie.' },
        { id: 'zombie_paria', name: 'Zombie', atk: 2, hp: 2, cost: 1, type: 'creature', abilities: ['dissipation'], combatType: 'melee', creatureType: 'undead', faction: 'black', edition: 1, image: 'black/zombie.png', arenaStyle: true, isToken: true },
        { id: 'zealot_elder', name: 'Zealot of the elder', atk: 2, hp: 1, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 3, image: 'black/zealot_of_the_elder.png', arenaStyle: true, sacrifice: 1, sacrificeBonus: { healPerAtk: true, drawPerAtk: true }, description: 'Quand vous sacrifiez une créature pour invoquer le Zealot, votre héros gagne X PV et vous piochez X cartes, X étant la force de la créature sacrifiée.' },
        { id: 'blaireau_contamine', name: 'Blaireau contaminé', atk: 5, hp: 4, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'beast', faction: 'black', edition: 2, image: 'black/blaireau_contamine.png', arenaStyle: true, onReanimate: { atkBuff: 2, hpBuff: 2, addAbility: 'trample' }, description: 'Quand le Blaireau contaminé est réanimé, il gagne +2/+2 et Piétinement.' },
        { id: 'ver_des_tombes', name: 'Ver des tombes', atk: 1, hp: 1, cost: 1, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'parasite', faction: 'black', edition: 2, image: 'black/ver_des_tombes.png', arenaStyle: true, startOfTurn: { millAndBuff: true }, description: 'Début de tour : mettez la carte du dessus de votre deck au cimetière. Si c\'est une créature, le Ver gagne +1/+1.' },
        { id: 'nourrisseur_chair', name: 'Nourrisseur de chair', atk: 1, hp: 1, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'parasite', faction: 'black', edition: 3, image: 'black/nourriseur_de_chair.png', arenaStyle: true, sacrifice: 1, sacrificeBonus: { absorbStats: true }, description: 'Gagne les stats de base de la créature sacrifiée.' },
        { id: 'boucher_abysses', name: 'Boucher des abysses', atk: 3, hp: 2, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 3, image: 'black/boucher_des_abysses.png', arenaStyle: true, onAdjacentAllyDeath: { atk: 1, hp: 1 }, description: 'Quand une créature alliée adjacente meurt, gagne +1/+1 permanent.' },
        { id: 'marionnettiste_sanglant', name: 'Marionnettiste sanglant', atk: 2, hp: 4, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 3, image: 'black/marionnettiste_sanglant.png', arenaStyle: true, sacrifice: 1, sacrificeBonus: { damageFacing: true }, description: 'Inflige l\'ATK de la créature sacrifiée en dégâts à la première créature en face.' },
        { id: 'possede_ephemere', name: 'Possédé éphémère', atk: 3, hp: 3, cost: 0, type: 'creature', abilities: ['haste'], combatType: 'melee', creatureType: 'spirit', faction: 'black', edition: 3, image: 'black/possede_ephemere.png', arenaStyle: true, endOfTurn: { selfSacrifice: true }, description: 'Fin de tour : le Possédé éphémère se sacrifie.' },
        { id: 'fossoyeur_methodique', name: 'Fossoyeur méthodique', atk: 2, hp: 2, cost: 0, type: 'creature', abilities: [], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 1, image: 'black/fossoyeur_methodique.png', arenaStyle: true, onSummon: { millFirstCreature: true }, description: 'Quand le Fossoyeur entre en jeu, mettez la première carte de créature du dessus de votre bibliothèque au cimetière.' },
        { id: 'rosalia_demonicus', name: 'Rosalia démonicus', atk: 0, hp: 4, cost: 2, type: 'creature', abilities: ['immovable', 'antitoxin'], combatType: 'melee', creatureType: 'plant', faction: 'black', edition: 2, image: 'black/rosalia_demonicus.png', arenaStyle: true, startOfTurn: { poisonAll: 1 }, description: 'Au début du tour, inflige 1 Poison à toutes les créatures.' },
        { id: 'pustule_vivante', name: 'Pustule vivante', atk: 0, hp: 3, cost: 2, type: 'creature', abilities: ['immovable', 'wall'], combatType: 'melee', creatureType: 'parasite', faction: 'black', edition: 2, image: 'black/pustule_vivante.png', arenaStyle: true, startOfTurn: { selfPoison: 1 }, onDeath: { poisonExplosion: true }, description: 'Début de tour : gagne 1 compteur poison. Quand elle meurt, inflige des dégâts égaux à ses marqueurs poison à toutes les créatures ennemies.' },
        { id: 'serpent_emeraude', name: 'Serpent d\'émeraude', atk: 2, hp: 2, cost: 2, type: 'creature', abilities: ['antitoxin'], combatType: 'melee', creatureType: 'serpent', faction: 'black', edition: 3, image: 'black/serpent_demeraude.png', arenaStyle: true, buffOnEnemyPoisonDeath: true, trampleAtBuffCounters: 3, description: 'Quand une créature ennemie meurt du poison, le Serpent d\'émeraude gagne +1/+1. Acquiert Piétinement avec 3 marqueurs +1/+1 ou plus.' },
        { id: 'porteur_de_peste', name: 'Porteur de peste', atk: 1, hp: 5, cost: 0, type: 'creature', abilities: ['antitoxin'], combatType: 'melee', creatureType: 'human', faction: 'black', edition: 3, image: 'black/porteur_peste.png', arenaStyle: true, startOfTurn: { poisonRow: 1 }, description: 'Début de tour : inflige 1 marqueur poison à toutes les autres créatures sur la même ligne.' }
    ],
    spells: [
        { id: 'plan_douteux', name: 'Plan douteux', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'single', targetEmptySlot: true, image: 'black/plan_douteux.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature sur cet emplacement. Ce sort ne peut cibler qu\'un emplacement vide.', effect: 'destroy' },
        { id: 'tir_compresse', name: 'Tir compressé', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'single', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 3, rarity: 'rare', description: 'Inflige 3 blessures à la créature sur cet emplacement. Si Tir compressé tue la cible, vous piochez une carte.', onKill: { draw: 1 } },
        { id: 'croix_de_feu', name: 'Croix de feu', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'cross', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, rarity: 'uncommon', description: 'Inflige 2 blessures à la créature sur cet emplacement et 2 blessures à toutes les créatures adjacentes.' },
        { id: 'blast', name: 'Blast', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'single', damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 2, returnOnMiss: true, description: 'Inflige 2 blessures à la créature ciblée. Si Blast ne touche pas de créature, il retourne dans votre main.' },
        { id: 'coup_de_poing', name: 'Coup de poing', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'hero', targetEnemy: true, damage: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'Inflige 2 dégâts au héros adverse.' },
        { id: 'tremblement_de_terre', name: 'Tremblement de terre', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'all', damage: 3, image: 'unknown/spell.png', arenaStyle: true, faction: 'green', edition: 3, description: 'Inflige 3 dégâts à toutes les créatures.' },
        { id: 'vitesse_superieure', name: 'Vitesse supérieure', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'hero', effect: 'draw', amount: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'Le joueur ciblé pioche deux cartes.' },
        { id: 'reanimation', name: 'Réanimation', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'self', effect: 'reanimate', image: 'black/reanimation.png', arenaStyle: true, faction: 'black', edition: 2, targetSelfEmptySlot: true, requiresGraveyardCreature: true, description: 'Placez une créature de votre cimetière sur cet emplacement vide.' },
        { id: 'alteration_musculaire', name: 'Altération musculaire', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'single', targetSelfCreature: true, effect: 'atkBuff', atkBuff: 2, image: 'unknown/spell.png', arenaStyle: true, faction: 'red', edition: 1, description: 'La créature alliée ciblée gagne +2 ATK.' },
        { id: 'armes_magiques', name: 'Armes magiques', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'all', effect: 'buffAll', buffAtk: 1, buffHp: 1, image: 'white/armes_magiques.png', arenaStyle: true, faction: 'white', edition: 2, description: 'Mettez un marqueur +1 ATK / +1 HP sur toutes vos créatures.' },
        { id: 'besoins', name: 'Besoins', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, effect: 'selfDamageAndDraw', selfDamage: 2, drawAmount: 2, image: 'black/besoins.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Perdez 2 PV, piochez 2 cartes.' },
        { id: 'cruel_destin', name: 'Cruel destin', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'all', effect: 'sacrificeLastAndDamage', heroDamage: 2, image: 'black/cruel_destin.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Chaque joueur sacrifie la dernière créature qu\'il a jouée. Chaque joueur perd 2 PV.' },
        { id: 'coup_de_poignard', name: 'Coup de poignard', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'single', effect: 'destroy', image: 'black/coup_de_poignard.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Détruit la créature ciblée.' },
        { id: 'ensevelissement', name: 'Ensevelissement', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, effect: 'mill', millCount: 4, image: 'black/ensevelissement.png', arenaStyle: true, faction: 'black', edition: 1, description: 'Mettez les 4 cartes du dessus de votre bibliothèque dans votre cimetière.' },
        { id: 'mon_precieux', name: 'Mon précieux', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'all', effect: 'graveyardToHand', requiresGraveyardCreature: true, image: 'black/mon_precieux.png', arenaStyle: true, faction: 'black', edition: 1, description: 'Renvoyez une carte de créature de votre cimetière dans votre main.' },
        { id: 'pacte_sombre', name: 'Pacte sombre', cost: 0, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'hero', targetSelf: true, effect: 'millHighestCostCreature', image: 'black/pacte_sombre.png', arenaStyle: true, faction: 'black', edition: 1, description: 'Mettez la carte de créature avec le coût le plus élevé de votre bibliothèque dans votre cimetière.' },
        { id: 'contamination_eau', name: 'Contamination de l\'eau', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'all', effect: 'poisonAllEnemies', poisonAmount: 1, image: 'black/contamination_de_leau.png', arenaStyle: true, faction: 'black', edition: 3, description: 'Toutes les créatures adverses reçoivent un marqueur poison.' },
        { id: 'mur_de_zombie', name: 'Mur de zombie', cost: 4, type: 'spell', offensive: false, spellType: 'défensif', pattern: 'global', effect: 'summonZombieWall', summonId: 'zombie_paria', image: 'black/mur_de_zombie.png', arenaStyle: true, faction: 'black', edition: 4, description: 'Invoque un Zombie 2/2 dans chaque emplacement de mêlée vide.' },
        { id: 'brume_toxique', name: 'Brume toxique', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'all', effect: 'triggerPoison', image: 'black/brume_toxique.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Toutes les créatures empoisonnées subissent immédiatement leurs dégâts de poison.' },
        { id: 'cycle_eternel', name: 'Cycle éternel', cost: 0, type: 'spell', offensive: false, spellType: 'defensif', pattern: 'self', effect: 'reanimateHaste', image: 'black/cycle_eternel.png', arenaStyle: true, faction: 'black', edition: 3, targetSelfEmptySlot: true, requiresGraveyardCreature: true, description: 'Réanime une créature et lui confère Célérité. Sacrifiez la créature à la fin du tour.' },
        { id: 'cri_outre_tombe', name: 'Cri d\'outre tombe', cost: 0, type: 'spell', offensive: true, spellType: 'offensif', pattern: 'all', effect: 'debuffAll', atkDebuff: 2, hpDebuff: 2, image: 'black/cri_doutre_tombe.png', arenaStyle: true, faction: 'black', edition: 2, description: 'Toutes les créatures gagnent -2 ATK et -2 HP.' }
    ],
    traps: [
        { id: 'troubeant', name: 'Trou béant', damage: 5, cost: 0, type: 'trap', image: 'neutral/troubeant.png', arenaStyle: true, faction: 'neutral', edition: 1, description: 'Inflige 5 dégâts à la première créature adverse qui attaque sur la ligne.' },
        { id: 'trappe_secrete', name: 'Trappe secrète', damage: 3, cost: 0, type: 'trap', pattern: 'line', image: 'neutral/trappe_secrete.png', arenaStyle: true, faction: 'neutral', edition: 2, description: 'Inflige 3 blessures à toutes les créatures adverses sur cette ligne.' },
        { id: 'voyage_inattendu', name: 'Voyage inattendu', cost: 0, type: 'trap', effect: 'bounce', image: 'neutral/voyage_inattendu.png', arenaStyle: true, faction: 'neutral', edition: 2, rarity: 'uncommon', description: 'Renvoyez la créature dans la main de son propriétaire.' },
        { id: 'piege_a_gobelin', name: 'Piège à gobelin', cost: 0, type: 'trap', effect: 'summon', summonId: 'gobelin_jumele', image: 'neutral/piege_a_gobelin.png', arenaStyle: true, faction: 'neutral', edition: 3, description: 'Invoque un Gobelin jumelé sur l\'emplacement adjacent. Ne se déclenche que si cet emplacement est vide.' }
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
    },
    erebeth: {
        id: 'erebeth',
        name: 'Erebeth, ange de la mort',
        image: 'black/Erebeth_ange_de_la_mort.png',
        titleColor: '#2a1a3dba', // Noir/violet
        faction: 'black',
        edition: 3,
        ability: 'Quand vous sacrifiez une créature, l\'adversaire perd 1 PV et vous régénérez 1 PV.'
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
        summonCounter: 0,
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
