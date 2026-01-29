// =============================================
// Index des animations
// =============================================
// Point d'entrée pour les animations du jeu

// Ce fichier sert de documentation pour l'organisation des animations.
// Les fichiers d'animation sont chargés directement dans game.html :
//
// - queue.js : Système de file d'attente d'animations
//   * queueAnimation(type, data)
//   * processAnimationQueue()
//   * executeAnimationAsync(type, data)
//   * resetAnimationStates()
//   * Variables: animationQueue, isAnimating, animatingSlots
//
// - combat.js : Animations de combat (PixiJS handlers)
//   * handlePixiAttack(data)
//   * handlePixiDamage(data)
//   * handlePixiHeroHit(data)
//   * handlePixiSpellDamage(data)
//   * handleOnDeathDamage(data)
//   * Fallbacks: animateAttackFallback, animateDamageFallback, animateHeroHitFallback
//
// - effects.js : Animations d'effets spéciaux
//   * animateDeath(data)
//   * animateZdejebelDamage(data)
//   * animateDeathTransform(data)
//   * animateBoneRevive(data)
//   * animateRadiantDragonDraw(data)
//   * animateBuff(data)
//   * animateSpell(data)
//   * animateSpellMiss(data)
//   * animateHeal(data)
//   * animateTrap(data)
//   * showDamageNumber(element, damage)
//
// - shield.js : Animations de bouclier Protection
//   * animateShieldDeploy(data)
//   * animateShieldBreak(data)
//   * Variable: shieldAnimationPlayed (Set)
//
// - discard.js : Animations de défausse et burn
//   * animateDiscard(data)
//   * animateBurn(data)
//   * animateDisintegration(cardEl, owner)
//   * createCardElementForAnimation(card)
//
// Les animations de move et summon sont dans des fichiers séparés :
// - move-animation.js
// - summon-animation.js
