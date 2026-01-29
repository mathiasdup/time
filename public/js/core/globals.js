// =============================================
// Variables globales du jeu
// =============================================
// Variables partagées entre tous les modules

// Socket et état du jeu
let socket, myNum = 0, state = null;

// Sélection et drag & drop
let selected = null, dragged = null, draggedFromField = null;

// Timer
let currentTimer = 90;

// Mulligan
let mulliganDone = false;

// Animations
let combatAnimReady = false;

// Set pour tracker les cartes dont l'animation de bouclier a été jouée
// Clé: "owner_row_col_cardId" pour identifier de manière unique chaque carte
const shieldAnimationPlayed = new Set();

// Noms des slots pour l'affichage
const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

// File d'attente d'animations
const animationQueue = [];
let isAnimating = false;
let currentProcessorId = 0;

// Système de HP différés pour zdejebel
let pendingHpUpdate = null;
let zdejebelAnimationInProgress = false;

// Délais des animations
const ANIMATION_DELAYS = {
    attack: 600,
    damage: 500,
    death: 600,
    heroHit: 200,
    discard: 800,
    burn: 1000,
    move: 100,
    summon: 100,
    default: 300
};

// États d'animation pour les slots
let animatingSlots = new Set();
let blockedSlots = new Set();

// Snapshot des déplacements
let moveAnimationSnapshot = new Map();

// NOTE: blockOppFieldRender, hiddenCards, pendingMoveAnimations et moveBlockTimeout ont été supprimés
// Le nouveau système filtre les cartes adverses côté serveur pendant le planning

// Preview de carte
let previewEl = null;

// Zoom de carte
let zoomCardData = null;

// Messages de phase
let phaseMessageTimeout = null;
let phaseMessageFadeTimeout = null;

// Timer mulligan
let mulliganTimer = null;

// Descriptions des capacités
const ABILITY_DESCRIPTIONS = {
    fly: 'Vol: Ne peut être bloquée que par d\'autres créatures volantes ou des tireurs.',
    shooter: 'Tireur: Attaque à distance. Ne peut pas être placé en première ligne.',
    haste: 'Célérité: Peut attaquer dès son arrivée en jeu.',
    trample: 'Piétinement: Les dégâts excédentaires sont infligés au héros adverse.',
    power: 'Puissance: Gagne +1 ATK à chaque fois qu\'elle subit des dégâts.',
    intangible: 'Intangible: Ne peut pas être ciblée ni bloquée.',
    cleave: 'Clivant: Inflige également des dégâts aux créatures adjacentes.',
    protection: 'Protection: Le premier dégât subi est annulé.',
    immovable: 'Immobile: Ne peut pas être déplacée.'
};
