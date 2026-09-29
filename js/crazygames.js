// Optional CrazyGames SDK v3 integration. The game remains playable without the portal.
import { setPlatformMuted } from './audio.js';

export const crazyGames = {
    isAvailable: false,
    sdkReady: false,
    gameplayActive: false,
    async init() {
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            const sdk = window.CrazyGames?.SDK;
            if (!sdk || typeof sdk.init !== 'function') return;
            try {
                await sdk.init();
                this.isAvailable = this.sdkReady = true;
                const game = sdk.game;
                setPlatformMuted(!!game?.settings?.muteAudio);
                game?.addSettingsChangeListener?.((settings) => {
                    if (settings && 'muteAudio' in settings) setPlatformMuted(settings.muteAudio);
                });
                this.syncGameplayState();
            } catch (error) {
                this.isAvailable = this.sdkReady = false;
                console.warn('CrazyGames SDK unavailable; continuing without portal features.', error);
            }
        })();
        return this.initPromise;
    },
    syncGameplayState() {
        if (!this.sdkReady) return;
        try {
            const method = this.gameplayActive ? 'gameplayStart' : 'gameplayStop';
            window.CrazyGames?.SDK?.game?.[method]?.();
        } catch { /* Optional platform integration must not block play. */ }
    },
    gameplayStart() { this.gameplayActive = true; this.syncGameplayState(); },
    gameplayStop() { this.gameplayActive = false; this.syncGameplayState(); }
};

window.CrazyGamesIntegration = crazyGames;
