// =============================================
// Index du rendu
// =============================================
// Point d'entrée pour le système de rendu

// Ce fichier sert de documentation pour l'organisation du rendu.
// Les fichiers de rendu sont chargés directement dans game.html :
//
// - makeCard.js : Création des éléments de carte
//   * createHexagonPath(cx, cy, radius, cornerRadius)
//   * makeCard(card, inHand, discountedCost)
//   * makeArenaCard(el, card, inHand, ...)
//   * makeFullArtCard(el, card, inHand, ...)
//   * makeImageCard(el, card, ...)
//   * makeClassicCard(el, card, ...)
//   * Variable: MANA_HEX_INNER
//
// - field.js : Rendu du terrain de jeu
//   * renderField(owner, field)
//   * addStaticShield(cardEl, owner, r, c)
//   * renderTraps()
//   * renderHand(hand, energy)
//   * renderOppHand(count)
//
// - ui.js : Rendu de l'interface utilisateur
//   * render() - Fonction principale
//   * updateDeckDisplay(owner, deckCount)
//   * updateGraveDisplay(owner, graveyard)
//   * updateGraveTopCard(owner, graveyard)
//   * updateTimerDisplay(t)
//   * showPhaseMessage(text, type)
//   * hidePhaseMessage()
//   * updatePhaseDisplay()
//   * log(msg, type)
//   * showCardShowcase(card)
