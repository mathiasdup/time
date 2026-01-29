// =============================================
// Index des interactions
// =============================================
// Point d'entrée pour les interactions du jeu

// Ce fichier sert de documentation pour l'organisation des interactions.
// Les fichiers d'interaction sont chargés directement dans game.html :
//
// - dragdrop.js : Gestion du drag & drop
//   * getValidSlots(card)
//   * canPlaceAt(card, col)
//   * highlightValidSlots(card, forceShow)
//   * highlightMoveTargets(fromRow, fromCol, card)
//   * clearHighlights()
//   * previewCrossTargets(targetOwner, row, col)
//   * getCrossTargetsClient(targetPlayer, row, col)
//   * dropOnSlot(owner, row, col)
//   * dropOnTrap(owner, row)
//
// - click.js : Gestion des clics
//   * canPlay()
//   * selectCard(i)
//   * clickFieldCard(row, col, card)
//   * clickSlot(owner, row, col)
//   * clickTrap(owner, row)
//   * clearSel()
//   * endTurn()
//   * surrender()
//
// - battlefield.js : Construction du terrain
//   * buildBattlefield()
//   * makeSlot(owner, row, col)
//   * makeTrapSlot(owner, row)
//   * Variable: SLOT_NAMES
//
// - heroes.js : Interactions héros
//   * setupHeroes()
//   * setupHeroDragDrop(heroEl, owner)
//   * hasCreaturesOnMyField()
