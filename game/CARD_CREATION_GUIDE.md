# Guide de Création de Cartes

Ce guide explique comment ajouter une nouvelle carte au jeu. **Tout est automatique** si tu utilises les capacités et propriétés existantes.

## Créer une Carte Créature

Dans `game/cards.js`, ajoute ta carte dans le tableau `CardDB`:

```javascript
{
    id: 'unique_id',           // ID unique (snake_case)
    name: 'Nom Affiché',       // Nom français
    atk: 3,                    // Points d'attaque
    hp: 4,                     // Points de vie
    cost: 0,                   // Coût en énergie (toujours 0 actuellement)
    type: 'creature',          // Type de carte
    image: 'faction/image.png', // Chemin de l'image (dans public/cards/)
    faction: 'green',          // Faction: green, red, blue, black, white
    edition: 3,                // Rareté: 1=common, 2=uncommon, 3=rare, 4=mythic
    creatureType: 'beast',     // Type: beast, dragon, human, undead, spirit, etc.
    abilities: ['power', 'trample']  // Capacités (voir liste ci-dessous)
}
```

## Capacités Disponibles (abilities)

Toutes ces capacités fonctionnent **automatiquement** une fois ajoutées:

| Capacité | Description | Propriété optionnelle |
|----------|-------------|----------------------|
| `protection` | Absorbe le premier coup | - |
| `fly` | Volant - touché uniquement par volants/tireurs | - |
| `shooter` | Tireur - attaque à distance, pas de riposte | - |
| `haste` | Célérité - peut attaquer immédiatement | - |
| `power` | Puissance - +ATK quand survit aux dégâts | `powerX: 2` |
| `trample` | Piétinement - dégâts excédentaires au héros | - |
| `cleave` | Clivant - dégâts aux lignes adjacentes | `cleaveX: 3` |
| `intangible` | Intangible - attaque directement le héros | - |
| `immovable` | Inamovible - ne peut pas être déplacé | - |

### Exemples

```javascript
// Créature avec Puissance 2
{ abilities: ['power'], powerX: 2 }  // Gagne +2 ATK par dégât subi

// Créature avec Clivant 3
{ abilities: ['cleave'], cleaveX: 3 }  // Inflige 3 dégâts aux adjacents

// Créature volante avec célérité
{ abilities: ['fly', 'haste'] }
```

## Propriétés Spéciales

### onHeroHit - Effet quand attaque le héros

```javascript
{ onHeroHit: 'draw' }  // Pioche une carte quand attaque le héros adverse
```

### onDeath - Effet à la mort

```javascript
// Inflige des dégâts au héros adverse à la mort
{ onDeath: { damageHero: 2 } }

// Se transforme en une autre carte à la mort
{ onDeath: { transformInto: 'autre_carte_id' } }
```

### description - Texte personnalisé

```javascript
{ description: 'Texte spécial affiché sur la carte' }
```

## Checklist Nouvelle Carte

1. **Ajouter la carte dans `game/cards.js`**
   - ID unique
   - Nom, stats (atk, hp, cost)
   - Image (placer dans `public/cards/faction/`)
   - Faction et édition
   - Abilities (utiliser les noms anglais)

2. **C'est tout!** Les systèmes suivants gèrent le reste automatiquement:
   - Combat: `game/combat.js` - gère Protection, Power, Cleave, Trample, etc.
   - Ciblage: `findTargetV2` - gère Fly, Shooter, Intangible
   - Affichage: `AbilityUtils` - traduit et formate les capacités
   - Animations: déjà connectées pour tous les effets

## Exemple Complet

```javascript
{
    id: 'phoenix_rebirth',
    name: 'Phoenix Renaissant',
    atk: 3,
    hp: 2,
    cost: 0,
    type: 'creature',
    image: 'red/phoenix.png',
    faction: 'red',
    edition: 4,  // mythic
    creatureType: 'spirit',
    abilities: ['fly', 'haste'],
    onDeath: { transformInto: 'phoenix_egg' }  // Se transforme en oeuf à la mort
}
```

## Structure des Fichiers

```
game/
├── cards.js              # Définitions des cartes (MODIFIER ICI)
├── abilities/
│   └── index.js          # Source unique des capacités
├── combat.js             # Logique de combat (automatique)
└── CARD_CREATION_GUIDE.md  # Ce fichier

public/
├── cards/                # Images des cartes
│   ├── green/
│   ├── red/
│   ├── blue/
│   ├── black/
│   └── white/
└── js/
    └── abilities-data.js # Données pour le client (auto-synchronisé)
```

## Notes Importantes

- **Pas besoin de modifier server.js** pour une nouvelle carte avec des capacités existantes
- **Pas besoin de modifier game.js** pour l'affichage
- Les animations sont automatiquement connectées
- La traduction des capacités est gérée par `AbilityUtils`
- Les interactions entre capacités (fly + shooter, etc.) sont gérées par le système de combat
