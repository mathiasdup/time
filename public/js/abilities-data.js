// =============================================
// DONNÉES DES CAPACITÉS - GÉNÉRÉ AUTOMATIQUEMENT
// =============================================
// Ce fichier est la source unique des données de capacités côté client.
// Il est synchronisé avec game/abilities/index.js côté serveur.
//
// NE PAS MODIFIER MANUELLEMENT - Modifier game/abilities/index.js à la place
// =============================================

window.ABILITY_DATA = {
    protection: {
        id: 'protection',
        name: 'Protection',
        icon: '🛡️',
        shortDesc: 'Absorbe le premier coup.',
        longDesc: 'La prochaine fois que cette créature devrait subir des dégâts, elle les ignore complètement. La Protection est ensuite consommée.',
        showInText: false,
        showAsCombatType: false
    },
    cleave: {
        id: 'cleave',
        name: 'Clivant',
        icon: '⛏️',
        shortDesc: 'Dégâts aux créatures adjacentes.',
        longDesc: 'Quand cette créature attaque, elle inflige aussi des dégâts aux créatures sur les lignes adjacentes à la cible (même colonne).',
        showInText: true,
        showAsCombatType: false
    },
    trample: {
        id: 'trample',
        name: 'Piétinement',
        icon: '🦏',
        shortDesc: 'Dégâts excédentaires au héros.',
        longDesc: 'Quand cette créature tue sa cible, les dégâts excédentaires sont infligés à la créature derrière ou directement au héros adverse.',
        showInText: true,
        showAsCombatType: false
    },
    power: {
        id: 'power',
        name: 'Puissance',
        icon: '⚡',
        shortDesc: '+ATK quand survit aux dégâts.',
        longDesc: 'Chaque fois que cette créature subit des dégâts et survit, elle gagne +X ATK de façon permanente (X = powerX, défaut 1).',
        showInText: true,
        showAsCombatType: false,
        hasValue: true,
        valueField: 'powerX',
        defaultValue: 1
    },
    fly: {
        id: 'fly',
        name: 'Vol',
        icon: '🦅',
        shortDesc: 'Volant.',
        longDesc: 'Cette créature vole. Elle ne peut être touchée que par les créatures volantes et les tireurs. Elle peut attaquer les tireurs et autres volants.',
        showInText: false,
        showAsCombatType: true
    },
    shooter: {
        id: 'shooter',
        name: 'Tireur',
        icon: '🏹',
        shortDesc: 'Attaque à distance.',
        longDesc: 'Cette créature attaque à distance. Elle peut toucher les créatures volantes et ne subit pas de riposte.',
        showInText: false,
        showAsCombatType: true
    },
    intangible: {
        id: 'intangible',
        name: 'Intangible',
        icon: '👻',
        shortDesc: 'Ne peut pas être ciblé.',
        longDesc: 'Cette créature est immatérielle. Elle ne peut pas être ciblée par les attaques normales et attaque toujours directement le héros adverse. Elle peut cependant être touchée par les effets de zone (cleave, piétinement).',
        showInText: true,
        showAsCombatType: false
    },
    haste: {
        id: 'haste',
        name: 'Célérité',
        icon: '💨',
        shortDesc: 'Attaque immédiatement.',
        longDesc: 'Cette créature peut attaquer dès le tour où elle est invoquée, sans attendre le tour suivant.',
        showInText: true,
        showAsCombatType: false
    },
    immovable: {
        id: 'immovable',
        name: 'Inamovible',
        icon: '🪨',
        shortDesc: 'Ne peut pas être déplacé.',
        longDesc: 'Cette créature ne peut pas être déplacée une fois posée sur le terrain.',
        showInText: true,
        showAsCombatType: false
    },
    regeneration: {
        id: 'regeneration',
        name: 'Régénération',
        icon: '💚',
        shortDesc: 'Regagne des PV en fin de tour.',
        longDesc: 'À la fin de chaque tour, cette créature regagne X PV. Elle ne peut pas dépasser son maximum de PV actuel.',
        showInText: true,
        showAsCombatType: false,
        hasValue: true,
        valueField: 'regenerationX',
        defaultValue: 1
    }
};

// =============================================
// FONCTIONS UTILITAIRES POUR LES CAPACITÉS
// =============================================

window.AbilityUtils = {
    /**
     * Obtient les données d'une capacité
     * @param {string} abilityName - Nom de la capacité (anglais)
     * @returns {Object|null}
     */
    getData(abilityName) {
        return window.ABILITY_DATA[abilityName.toLowerCase()] || null;
    },

    /**
     * Obtient le nom français d'une capacité
     * @param {string} abilityName
     * @returns {string}
     */
    getFrenchName(abilityName) {
        const data = this.getData(abilityName);
        return data ? data.name : abilityName;
    },

    /**
     * Obtient l'icône d'une capacité
     * @param {string} abilityName
     * @returns {string}
     */
    getIcon(abilityName) {
        const data = this.getData(abilityName);
        return data ? data.icon : '❓';
    },

    /**
     * Formate le texte d'affichage d'une capacité pour une carte
     * Gère les cas spéciaux: "Puissance 2", "Clivant 3"
     * @param {string} abilityName
     * @param {Object} card
     * @returns {string}
     */
    formatText(abilityName, card) {
        const data = this.getData(abilityName);
        if (!data) return abilityName;

        // Capacités avec valeur variable
        if (data.hasValue && data.valueField) {
            const value = card[data.valueField] !== undefined ? card[data.valueField] : data.defaultValue;
            return `${data.name} ${value}`;
        }

        // Cas spécial cleave avec cleaveX
        if (abilityName === 'cleave' && card.cleaveX) {
            return `Clivant ${card.cleaveX}`;
        }

        return data.name;
    },

    /**
     * Filtre les capacités à afficher dans le texte de la carte
     * @param {string[]} abilities
     * @returns {string[]}
     */
    filterForDisplay(abilities) {
        if (!abilities) return [];
        return abilities.filter(a => {
            const data = this.getData(a);
            return data && data.showInText;
        });
    },

    /**
     * Génère le texte complet des capacités pour une carte
     * @param {Object} card
     * @returns {string}
     */
    getAbilitiesText(card) {
        if (!card || !card.abilities) return '';

        const displayAbilities = this.filterForDisplay(card.abilities);
        return displayAbilities
            .map(a => this.formatText(a, card))
            .join(', ');
    },

    /**
     * Obtient la description longue pour le tooltip/preview
     * @param {string} abilityName
     * @returns {string}
     */
    getLongDescription(abilityName) {
        const data = this.getData(abilityName);
        return data ? data.longDesc : 'Capacité inconnue';
    },

    /**
     * Vérifie si une capacité est affichée comme type de combat (fly/shooter)
     * @param {string} abilityName
     * @returns {boolean}
     */
    isCombatType(abilityName) {
        const data = this.getData(abilityName);
        return data ? data.showAsCombatType : false;
    }
};

console.log('[AbilityUtils] Données des capacités chargées:', Object.keys(window.ABILITY_DATA).length, 'capacités');
