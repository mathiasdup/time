// =============================================
// Index du réseau
// =============================================
// Point d'entrée pour la communication réseau

// Ce fichier sert de documentation pour l'organisation du réseau.
// Les fichiers réseau sont chargés directement dans game.html :
//
// - socket.js : Gestion des sockets
//   * initSocket()
//   * handleAnimation(data)
//   * handleAnimationBatch(animations)
//   * Événements écoutés:
//     - gameStart
//     - gameStateUpdate
//     - timerUpdate
//     - phaseChange
//     - phaseMessage
//     - playerReady
//     - newTurn
//     - resolutionLog
//     - directDamage
//     - animation
//     - animationBatch
//     - blockSlots
//     - unblockSlots
//     - hideCards
//     - revealCard
//     - spellHighlight
//     - gameOver
//     - playerDisconnected
//
// - lobby.js : Gestion du lobby
//   * createRoom()
//   * joinRoom()
