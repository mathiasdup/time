/**
 * Card Renderer avec PixiJS
 * Style Hearthstone : image plein fond + icônes de stats
 */

const CardRenderer = {
    cache: new Map(),
    textureCache: {},
    isReady: false,
    app: null,

    CARD_WIDTH: 200,
    CARD_HEIGHT: 280,

    async init() {
        if (this.isReady) return this;

        try {
            this.app = new PIXI.Application();
            await this.app.init({
                width: this.CARD_WIDTH,
                height: this.CARD_HEIGHT,
                backgroundAlpha: 0,
                antialias: true,
                resolution: 2,
                autoDensity: true
            });

            // Précharger les icônes (optionnel - ne bloque pas si absent)
            try {
                this.textureCache.mana = await PIXI.Assets.load('/css/mana.png');
            } catch (e) { console.warn('[CardRenderer] mana.png not found'); }
            try {
                this.textureCache.damage = await PIXI.Assets.load('/css/damage.png');
            } catch (e) { console.warn('[CardRenderer] damage.png not found'); }
            try {
                this.textureCache.health = await PIXI.Assets.load('/css/health.png');
            } catch (e) { console.warn('[CardRenderer] health.png not found'); }

            this.isReady = true;
            console.log('[CardRenderer] Prêt');
        } catch (e) {
            console.error('[CardRenderer] Erreur init:', e);
            this.isReady = false;
        }

        return this;
    },

    async renderCard(card) {
        if (!this.isReady) {
            await this.init();
            if (!this.isReady) return null;
        }

        const hp = card.currentHp ?? card.hp;
        const cacheKey = `${card.id}_${hp}_${card.atk}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;

        // Nettoyer
        this.app.stage.removeChildren();
        const container = new PIXI.Container();
        this.app.stage.addChild(container);

        // 1. Fond noir de secours
        const bg = new PIXI.Graphics();
        bg.roundRect(0, 0, W, H, 10);
        bg.fill({ color: 0x1a1a2e });
        container.addChild(bg);

        // 2. Image de fond
        if (card.image) {
            try {
                const texture = await PIXI.Assets.load(`/cards/${card.image}`);
                const sprite = new PIXI.Sprite(texture);

                const scaleX = W / texture.width;
                const scaleY = H / texture.height;
                const scale = Math.max(scaleX, scaleY);

                sprite.scale.set(scale);
                sprite.x = (W - texture.width * scale) / 2;
                sprite.y = (H - texture.height * scale) / 2;

                // Masque arrondi
                const mask = new PIXI.Graphics();
                mask.roundRect(0, 0, W, H, 10);
                mask.fill({ color: 0xffffff });
                container.addChild(mask);
                sprite.mask = mask;
                container.addChild(sprite);
            } catch (e) {
                console.warn('[CardRenderer] Image error:', e);
            }
        }

        // 3. Bordure
        const border = new PIXI.Graphics();
        border.roundRect(0, 0, W, H, 10);
        border.stroke({ color: 0x333333, width: 3 });
        container.addChild(border);

        // 4. Bandeau du nom (58%)
        const bannerY = H * 0.58;
        const nameBg = new PIXI.Graphics();
        nameBg.roundRect(8, bannerY - 2, W - 16, 28, 6);
        nameBg.fill({ color: 0x000000, alpha: 0.75 });
        container.addChild(nameBg);

        const nameStyle = new PIXI.TextStyle({
            fontFamily: 'Georgia, serif',
            fontSize: 14,
            fontWeight: 'bold',
            fill: 0xffffff
        });
        const nameText = new PIXI.Text({ text: card.name, style: nameStyle });
        nameText.anchor.set(0.5);
        nameText.x = W / 2;
        nameText.y = bannerY + 12;
        container.addChild(nameText);

        // 5. Zone type + capacités (68%)
        const zoneY = H * 0.68;
        const textBg = new PIXI.Graphics();
        textBg.roundRect(8, zoneY, W - 16, 38, 4);
        textBg.fill({ color: 0x000000, alpha: 0.6 });
        container.addChild(textBg);

        // Type
        let typeStr = 'Créature - Mêlée';
        if (card.abilities?.includes('shooter')) typeStr = 'Créature - Tireur';
        else if (card.abilities?.includes('fly')) typeStr = 'Créature - Volant';

        const typeStyle = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 9,
            fill: 0xaaaaaa
        });
        const typeText = new PIXI.Text({ text: typeStr, style: typeStyle });
        typeText.anchor.set(0.5, 0);
        typeText.x = W / 2;
        typeText.y = zoneY + 4;
        container.addChild(typeText);

        // Capacités
        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité',
            intangible: 'Intangible', trample: 'Piétinement',
            initiative: 'Initiative', power: 'Puissance', cleave: 'Clivant'
        };
        const abilities = (card.abilities || []).map(a => abilityNames[a] || a).join(', ');

        if (abilities) {
            const abStyle = new PIXI.TextStyle({
                fontFamily: 'Arial',
                fontSize: 11,
                fontWeight: 'bold',
                fill: 0xffd700
            });
            const abText = new PIXI.Text({ text: abilities, style: abStyle });
            abText.anchor.set(0.5, 0);
            abText.x = W / 2;
            abText.y = zoneY + 18;
            container.addChild(abText);
        }

        // 6. MANA (haut gauche)
        const manaSize = 50;
        if (this.textureCache.mana) {
            const manaSprite = new PIXI.Sprite(this.textureCache.mana);
            manaSprite.width = manaSize;
            manaSprite.height = manaSize;
            manaSprite.x = -5;
            manaSprite.y = -5;
            container.addChild(manaSprite);

            const manaStyle = new PIXI.TextStyle({
                fontFamily: 'Arial Black',
                fontSize: 22,
                fontWeight: 'bold',
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 5 }
            });
            const manaText = new PIXI.Text({ text: card.cost.toString(), style: manaStyle });
            manaText.anchor.set(0.5);
            manaText.x = manaSize / 2 - 5;
            manaText.y = manaSize / 2 - 5;
            container.addChild(manaText);
        }

        // 7. ATK (bas gauche)
        const statSize = 55;
        if (this.textureCache.damage) {
            const atkSprite = new PIXI.Sprite(this.textureCache.damage);
            atkSprite.width = statSize;
            atkSprite.height = statSize;
            atkSprite.x = -8;
            atkSprite.y = H - statSize + 8;
            container.addChild(atkSprite);

            const atkStyle = new PIXI.TextStyle({
                fontFamily: 'Arial Black',
                fontSize: 24,
                fontWeight: 'bold',
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 5 }
            });
            const atkText = new PIXI.Text({ text: card.atk.toString(), style: atkStyle });
            atkText.anchor.set(0.5);
            atkText.x = statSize / 2 - 8;
            atkText.y = H - statSize / 2 + 8;
            container.addChild(atkText);
        }

        // 8. HP (bas droite)
        if (this.textureCache.health) {
            const hpSprite = new PIXI.Sprite(this.textureCache.health);
            hpSprite.width = statSize;
            hpSprite.height = statSize;
            hpSprite.x = W - statSize + 8;
            hpSprite.y = H - statSize + 8;
            container.addChild(hpSprite);

            const hpColor = hp < card.hp ? 0xff6b6b : 0xffffff;
            const hpStyle = new PIXI.TextStyle({
                fontFamily: 'Arial Black',
                fontSize: 24,
                fontWeight: 'bold',
                fill: hpColor,
                stroke: { color: 0x000000, width: 5 }
            });
            const hpText = new PIXI.Text({ text: hp.toString(), style: hpStyle });
            hpText.anchor.set(0.5);
            hpText.x = W - statSize / 2 + 8;
            hpText.y = H - statSize / 2 + 8;
            container.addChild(hpText);
        }

        // Render
        this.app.renderer.render(this.app.stage);

        try {
            const dataUrl = await this.app.renderer.extract.base64(this.app.stage);
            this.cache.set(cacheKey, dataUrl);
            console.log('[CardRenderer] Carte générée:', card.name);
            return dataUrl;
        } catch (e) {
            console.error('[CardRenderer] Extract error:', e);
            return null;
        }
    },

    clearCache() {
        this.cache.clear();
    }
};

window.CardRenderer = CardRenderer;
