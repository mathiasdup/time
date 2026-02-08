// ==================== VARIABLES GLOBALES DU JEU ====================
let socket, myNum = 0, state = null;
let selected = null, dragged = null, draggedFromField = null;
let currentTimer = 90;
let mulliganDone = false;
let testModeSelection = [];
let cardCatalog = null;

const SLOT_NAMES = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']];

// Tracking pour l'animation FLIP de la main (reflow fluide quand une carte est jouée)
let handCardRemovedIndex = -1;

// Sorts engagés : sorts joués pendant la planification, visibles dans la main en grisé
let committedSpells = [];
let commitIdCounter = 0;

// Réanimation : sort en attente de sélection d'une créature au cimetière
let pendingReanimation = null;
// { card, handIndex, effectiveCost, targetPlayer, row, col }
let committedGraveyardUids = []; // UIDs des créatures du cimetière déjà engagées par Réanimation
let committedReanimationSlots = []; // Slots réservés par Réanimation {row, col}

// ==================== SYSTÈME DE FILE D'ATTENTE D'ANIMATIONS ====================
const animationQueue = [];
let isAnimating = false;
let currentProcessorId = 0; // Pour traquer le processeur actif

// Système de HP différés pour zdejebel (pour que les HP changent APRÈS l'animation)
let pendingHpUpdate = null; // { target: 'me'|'opp', oldHp: number, newHp: number }
let zdejebelAnimationInProgress = false; // Bloque render() pour les HP pendant zdejebel
const ANIMATION_DELAYS = {
    attack: 600,       // Délai après une attaque
    damage: 500,       // Délai après affichage des dégâts
    death: 200,        // Délai après une mort (le gros est dans animateDeathToGraveyard)
    heroHit: 200,      // Délai après dégâts au héros (réduit)
    discard: 800,      // Délai après défausse
    burn: 400,         // Délai après burn (pioche vers cimetière)
    spell: 200,        // Délai après animation de sort (le gros est dans animateSpellReveal)
    trapTrigger: 500,  // Délai après animation de piège (séparation entre pièges consécutifs)
    default: 300       // Délai par défaut
};
