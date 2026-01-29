// =============================================
// Interactions: Héros
// =============================================
// Setup des héros et interactions

/**
 * Configure les héros au début de la partie
 */
function setupHeroes() {
    document.getElementById('me-name').textContent = state.me.heroName;
    document.getElementById('opp-name').textContent = state.opponent.heroName;

    const meHero = state.me.hero;
    const oppHero = state.opponent.hero;

    const meHeroInner = document.getElementById('me-hero-inner');
    const oppHeroInner = document.getElementById('opp-hero-inner');

    if (meHero && meHero.image) {
        meHeroInner.style.backgroundImage = `url('/cards/${meHero.image}')`;
        document.getElementById('me-hero-title').textContent = meHero.name;
        document.getElementById('me-hero-title').style.background = meHero.titleColor;
    }

    if (oppHero && oppHero.image) {
        oppHeroInner.style.backgroundImage = `url('/cards/${oppHero.image}')`;
        document.getElementById('opp-hero-title').textContent = oppHero.name;
        document.getElementById('opp-hero-title').style.background = oppHero.titleColor;
    }

    window.heroData = { me: meHero, opp: oppHero };

    const heroMe = document.getElementById('hero-me');
    const heroOpp = document.getElementById('hero-opp');

    const handleHeroClick = (heroEl, owner) => {
        return (e) => {
            e.stopPropagation();

            // Sort ciblant héros
            if (selected && selected.fromHand && selected.type === 'spell') {
                const canTarget = selected.pattern === 'hero' || selected.canTargetHero;
                if (canTarget && canPlay() && selected.cost <= state.me.energy) {
                    const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);
                    socket.emit('castSpell', {
                        idx: selected.idx,
                        targetPlayer: targetPlayer,
                        row: -1,
                        col: -1
                    });
                    clearSel();
                    return;
                }
            }

            // Afficher détail
            const hero = owner === 'me' ? window.heroData.me : window.heroData.opp;
            const hp = owner === 'me' ? state?.me?.hp : state?.opponent?.hp;
            showHeroDetail(hero, hp);
        };
    };

    if (heroMe) {
        heroMe.onmouseenter = () => showHeroPreview(window.heroData.me, state?.me?.hp);
        heroMe.onmouseleave = hideCardPreview;
        heroMe.onclick = handleHeroClick(heroMe, 'me');
    }

    if (heroOpp) {
        heroOpp.onmouseenter = () => showHeroPreview(window.heroData.opp, state?.opponent?.hp);
        heroOpp.onmouseleave = hideCardPreview;
        heroOpp.onclick = handleHeroClick(heroOpp, 'opp');
    }

    setupHeroDragDrop(heroMe, 'me');
    setupHeroDragDrop(heroOpp, 'opp');
}

/**
 * Configure le drag & drop sur un héros
 */
function setupHeroDragDrop(heroEl, owner) {
    const canTargetThisHero = (spell) => {
        if (!spell || spell.type !== 'spell') return false;
        if (spell.pattern === 'hero') {
            if (spell.targetEnemy && owner === 'me') return false;
            if (spell.targetSelf && owner === 'opp') return false;
            return true;
        }
        if (spell.canTargetHero) return true;
        return false;
    };

    heroEl.ondragover = (e) => {
        e.preventDefault();
        if (!dragged || !canTargetThisHero(dragged)) return;
        heroEl.classList.add('hero-drag-over');
    };

    heroEl.ondragleave = () => {
        heroEl.classList.remove('hero-drag-over');
    };

    heroEl.ondrop = (e) => {
        e.preventDefault();
        heroEl.classList.remove('hero-drag-over');

        if (!dragged || !canTargetThisHero(dragged)) return;
        if (!canPlay()) return;
        if (dragged.cost > state.me.energy) {
            dragged.triedToDrop = true;
            return;
        }

        const targetPlayer = owner === 'me' ? myNum : (myNum === 1 ? 2 : 1);

        socket.emit('castSpell', {
            idx: dragged.idx,
            targetPlayer: targetPlayer,
            row: -1,
            col: -1
        });

        clearSel();
        dragged = null;
    };
}

/**
 * Vérifie si le joueur a des créatures sur le terrain
 */
function hasCreaturesOnMyField() {
    if (!state || !state.me || !state.me.field) return false;
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            if (state.me.field[r][c]) return true;
        }
    }
    return false;
}
