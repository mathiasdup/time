// =============================================
// Index des capacités - SOURCE UNIQUE DE VÉRITÉ
// =============================================
// Ce fichier est LA RÉFÉRENCE pour toutes les capacités du jeu.
// Quand tu ajoutes une capacité existante à une carte, tout fonctionne automatiquement.
//
// COMMENT AJOUTER UNE CARTE AVEC DES CAPACITÉS EXISTANTES:
// --------------------------------------------------------
// 1. Dans game/cards.js, ajoute ta carte avec abilities: ['nom1', 'nom2']
// 2. C'est tout! La logique combat (game/combat.js) gère automatiquement:
//    - Protection: absorbe le premier coup
//    - Power: +ATK quand survit aux dégâts (utilise powerX pour valeur custom)
//    - Cleave: dégâts adjacents (utilise cleaveX pour valeur custom)
//    - Trample: dégâts excédentaires passent derrière
//    - Fly/Shooter: ciblage et interactions
//    - Intangible: attaque directement le héros
//    - Haste: peut attaquer immédiatement
//    - Immovable: ne peut pas être déplacé
//
// PROPRIÉTÉS SPÉCIALES OPTIONNELLES:
// ----------------------------------
// - powerX: number    → Bonus ATK par dégât (défaut: 1)
// - cleaveX: number   → Dégâts cleave si différent de ATK
// - onHeroHit: 'draw' → Pioche une carte quand attaque le héros
// - onDeath: { transformInto: 'card_id' } → Se transforme à la mort
//
// =============================================

const protection = require('./protection');
const cleave = require('./cleave');
const trample = require('./trample');
const power = require('./power');
const fly = require('./fly');
const shooter = require('./shooter');
const intangible = require('./intangible');
const haste = require('./haste');
const immovable = require('./immovable');
const regeneration = require('./regeneration');

// Mapping des noms de capacités vers leurs modules
const ABILITIES = {
    protection,
    cleave,
    trample,
    power,
    fly,
    shooter,
    intangible,
    haste,
    immovable,
    regeneration
};

// =============================================
// DÉFINITION COMPLÈTE DES CAPACITÉS
// =============================================
// Chaque capacité a: id, nom français, icône, description courte/longue
// Cette structure est utilisée par le serveur ET le client

const ABILITY_DATA = {
    protection: {
        id: 'protection',
        name: 'Protection',
        icon: '🛡️',
        shortDesc: 'Absorbe le premier coup.',
        longDesc: 'La prochaine fois que cette créature devrait subir des dégâts, elle les ignore complètement. La Protection est ensuite consommée.',
        // Pas affiché dans le texte de la carte (géré visuellement)
        showInText: false,
        // Géré automatiquement par applyDamageToCreature
        auto: true
    },
    cleave: {
        id: 'cleave',
        name: 'Clivant',
        icon: '⛏️',
        shortDesc: 'Dégâts aux créatures adjacentes.',
        longDesc: 'Quand cette créature attaque, elle inflige aussi des dégâts aux créatures sur les lignes adjacentes à la cible (même colonne).',
        showInText: true,
        // Affichage spécial: "Clivant X" si cleaveX défini
        formatText: (card) => card.cleaveX ? `Clivant ${card.cleaveX}` : 'Clivant',
        auto: true
    },
    trample: {
        id: 'trample',
        name: 'Piétinement',
        icon: '🦏',
        shortDesc: 'Dégâts excédentaires au héros.',
        longDesc: 'Quand cette créature tue sa cible, les dégâts excédentaires sont infligés à la créature derrière ou directement au héros adverse.',
        showInText: true,
        auto: true
    },
    power: {
        id: 'power',
        name: 'Puissance',
        icon: '⚡',
        shortDesc: '+ATK quand survit aux dégâts.',
        longDesc: 'Chaque fois que cette créature subit des dégâts et survit, elle gagne +X ATK de façon permanente (X = powerX, défaut 1).',
        showInText: true,
        // Affichage spécial: "Puissance X"
        formatText: (card) => `Puissance ${card.powerX !== undefined ? card.powerX : 1}`,
        auto: true
    },
    fly: {
        id: 'fly',
        name: 'Vol',
        icon: '🦅',
        shortDesc: 'Volant.',
        longDesc: 'Cette créature vole. Elle ne peut être touchée que par les créatures volantes et les tireurs. Elle peut attaquer les tireurs et autres volants.',
        // Affiché comme "type de combat", pas dans le texte
        showInText: false,
        showAsCombatType: true,
        auto: true
    },
    shooter: {
        id: 'shooter',
        name: 'Tireur',
        icon: '🏹',
        shortDesc: 'Attaque à distance.',
        longDesc: 'Cette créature attaque à distance. Elle peut toucher les créatures volantes et ne subit pas de riposte.',
        showInText: false,
        showAsCombatType: true,
        auto: true
    },
    intangible: {
        id: 'intangible',
        name: 'Intangible',
        icon: '👻',
        shortDesc: 'Ne peut pas être ciblé.',
        longDesc: 'Cette créature est immatérielle. Elle ne peut pas être ciblée par les attaques normales et attaque toujours directement le héros adverse. Elle peut cependant être touchée par les effets de zone (cleave, piétinement).',
        showInText: true,
        auto: true
    },
    haste: {
        id: 'haste',
        name: 'Célérité',
        icon: '💨',
        shortDesc: 'Attaque immédiatement.',
        longDesc: 'Cette créature peut attaquer dès le tour où elle est invoquée, sans attendre le tour suivant.',
        showInText: true,
        auto: true
    },
    immovable: {
        id: 'immovable',
        name: 'Inamovible',
        icon: '🪨',
        shortDesc: 'Ne peut pas être déplacé.',
        longDesc: 'Cette créature ne peut pas être déplacée une fois posée sur le terrain.',
        showInText: true,
        auto: true
    },
    regeneration: {
        id: 'regeneration',
        name: 'Régénération',
        icon: '💚',
        shortDesc: 'Regagne des PV en fin de tour.',
        longDesc: 'À la fin de chaque tour, cette créature regagne X PV. Elle ne peut pas dépasser son maximum de PV actuel.',
        showInText: true,
        // Affichage spécial: "Régénération X"
        formatText: (card) => `Régénération ${card.regenerationX !== undefined ? card.regenerationX : 1}`,
        auto: true
    }
};

// Liste des noms de capacités supportées (pour validation)
const ABILITY_NAMES = Object.keys(ABILITY_DATA);

// Versions simplifiées pour compatibilité descendante
const ABILITY_DESCRIPTIONS = {};
const ABILITY_ICONS = {};
const ABILITY_FRENCH_NAMES = {};

for (const [key, data] of Object.entries(ABILITY_DATA)) {
    ABILITY_DESCRIPTIONS[key] = data.shortDesc;
    ABILITY_ICONS[key] = data.icon;
    ABILITY_FRENCH_NAMES[key] = data.name;
}

/**
 * Vérifie si une créature a une capacité spécifique
 * @param {Object} creature - La créature à vérifier
 * @param {string} abilityName - Nom de la capacité (en minuscules)
 * @returns {boolean}
 */
function hasAbility(creature, abilityName) {
    if (!creature || !creature.abilities) return false;
    return creature.abilities.some(a => a.toLowerCase() === abilityName.toLowerCase());
}

/**
 * Obtient toutes les capacités d'une créature
 * @param {Object} creature - La créature
 * @returns {string[]} - Liste des capacités
 */
function getAbilities(creature) {
    if (!creature || !creature.abilities) return [];
    return [...creature.abilities];
}

/**
 * Obtient les données complètes d'une capacité
 * @param {string} abilityName - Nom de la capacité
 * @returns {Object|null}
 */
function getAbilityData(abilityName) {
    const name = abilityName.toLowerCase();
    return ABILITY_DATA[name] || null;
}

/**
 * Obtient la description d'une capacité
 * @param {string} abilityName - Nom de la capacité
 * @returns {string}
 */
function getAbilityDescription(abilityName) {
    const data = getAbilityData(abilityName);
    return data ? data.shortDesc : 'Capacité inconnue';
}

/**
 * Obtient l'icône d'une capacité
 * @param {string} abilityName - Nom de la capacité
 * @returns {string}
 */
function getAbilityIcon(abilityName) {
    const data = getAbilityData(abilityName);
    return data ? data.icon : '❓';
}

/**
 * Obtient le nom français d'une capacité
 * @param {string} abilityName - Nom de la capacité (anglais)
 * @returns {string}
 */
function getAbilityFrenchName(abilityName) {
    const data = getAbilityData(abilityName);
    return data ? data.name : abilityName;
}

/**
 * Formate le texte d'affichage d'une capacité pour une carte
 * Gère les cas spéciaux comme "Puissance 2" ou "Clivant 3"
 * @param {string} abilityName - Nom de la capacité
 * @param {Object} card - La carte (pour accéder à powerX, cleaveX, etc.)
 * @returns {string}
 */
function formatAbilityText(abilityName, card) {
    const data = getAbilityData(abilityName);
    if (!data) return abilityName;

    // Si la capacité a un format spécial (ex: Puissance X)
    if (data.formatText) {
        return data.formatText(card);
    }

    return data.name;
}

/**
 * Filtre les capacités à afficher dans le texte de la carte
 * Exclut fly/shooter (affichés comme type de combat) et protection (visuel)
 * @param {string[]} abilities - Liste des capacités
 * @returns {string[]}
 */
function filterDisplayAbilities(abilities) {
    if (!abilities) return [];
    return abilities.filter(a => {
        const data = getAbilityData(a);
        return data && data.showInText;
    });
}

/**
 * Génère le texte complet des capacités pour une carte
 * @param {Object} card - La carte
 * @returns {string} - Texte formaté (ex: "Célérité, Puissance 2, Piétinement")
 */
function getAbilitiesText(card) {
    if (!card || !card.abilities) return '';

    const displayAbilities = filterDisplayAbilities(card.abilities);
    return displayAbilities
        .map(a => formatAbilityText(a, card))
        .join(', ');
}

/**
 * Retourne les données de capacité pour le client (sans les fonctions)
 * Utilisé pour envoyer les infos au frontend
 * @returns {Object}
 */
function getClientAbilityData() {
    const clientData = {};
    for (const [key, data] of Object.entries(ABILITY_DATA)) {
        clientData[key] = {
            id: data.id,
            name: data.name,
            icon: data.icon,
            shortDesc: data.shortDesc,
            longDesc: data.longDesc,
            showInText: data.showInText,
            showAsCombatType: data.showAsCombatType || false
        };
    }
    return clientData;
}

module.exports = {
    // Modules individuels (fonctions de vérification)
    ...protection,
    ...cleave,
    ...trample,
    ...power,
    ...fly,
    ...shooter,
    ...intangible,
    ...haste,
    ...immovable,
    ...regeneration,

    // Modules groupés
    ABILITIES,

    // Données complètes des capacités (SOURCE UNIQUE)
    ABILITY_DATA,

    // Constantes (compatibilité)
    ABILITY_NAMES,
    ABILITY_DESCRIPTIONS,
    ABILITY_ICONS,
    ABILITY_FRENCH_NAMES,

    // Fonctions utilitaires
    hasAbility,
    getAbilities,
    getAbilityData,
    getAbilityDescription,
    getAbilityIcon,
    getAbilityFrenchName,
    formatAbilityText,
    filterDisplayAbilities,
    getAbilitiesText,
    getClientAbilityData
};
