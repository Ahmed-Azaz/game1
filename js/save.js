// Save system - localStorage with CrazyGames Data Module fallback
import * as audio from './audio.js';

export const saveSystem = {
    // Save data structure
    saveData: {
        bestTime: 0,
        highestLevel: 1,
        highestScore: 0,
        bestEnemies: 0,
        settings: {
            masterVolume: 0.7,
            sfxVolume: 0.7,
            particleQuality: 'medium',
            screenShake: true,
            // Left-handed layout: movement on the right thumb, Shift on the left
            reverseTouchControls: false
        },
        onboardingCompleted: false
    },
    
    init() {
        // Load saved data
        this.load();
    },
    
    load() {
        try {
            // Stat points are per-run now; drop any leftover key from older builds
            localStorage.removeItem('echoRift_stats');
            const legacySettings = localStorage.getItem('echoRift_settings');
            if (legacySettings) {
                try {
                    const parsed = JSON.parse(legacySettings);
                    this.saveData.settings = { ...this.saveData.settings, ...parsed };
                    localStorage.removeItem('echoRift_settings');
                } catch { /* ignore */ }
            }
            const saved = localStorage.getItem('echoRift_save');
            if (saved) {
                const data = JSON.parse(saved);
                // Merge with defaults
                this.saveData = { ...this.saveData, ...data, settings: { ...this.saveData.settings, ...(data.settings || {}) } };
            }
        } catch (e) {
            // Corrupted save - start fresh
            this.saveData = {
                bestTime: 0,
                highestLevel: 1,
                highestScore: 0,
                bestEnemies: 0,
                settings: {
                    masterVolume: 0.7,
                    sfxVolume: 0.7,
                    particleQuality: 'medium',
                    screenShake: true
                },
                onboardingCompleted: false
            };
        }
        
        // Apply settings
        if (this.saveData.settings) {
            uiSettingsApply(this.saveData.settings);
        }
        
        const title = document.getElementById('title-screen');
        const onboarding = document.getElementById('onboarding');
        if (title) title.style.display = 'flex';
        if (onboarding) onboarding.style.display = 'none';
    },
    
    save() {
        try {
            localStorage.setItem('echoRift_save', JSON.stringify(this.saveData));
        } catch (e) {
            // Save failed - continue normally, never block gameplay
            //console.error('Save failed:', e);
        }
    },
    
    // Settings
    updateSettings(settings) {
        this.saveData.settings = { ...this.saveData.settings, ...settings };
        this.save();
    }
};

function uiSettingsApply(settings) {
    if (settings.masterVolume !== undefined) {
        audio.setMasterVolume(settings.masterVolume);
    }
    if (settings.sfxVolume !== undefined) {
        audio.setSFXVolume(settings.sfxVolume);
    }
    if (settings.particleQuality) {
        import('./visual-effects.js').then((fx) => fx.setParticleQuality(settings.particleQuality));
    }
    if (settings.screenShake !== undefined) {
        import('./visual-effects.js').then((fx) => fx.setScreenShakeEnabled(settings.screenShake));
    }
    if (settings.reverseTouchControls !== undefined) {
        // The layout is a class on the touch overlay, so it applies directly
        // rather than through a module that has to be imported first
        document.getElementById('touch-controls')?.classList.toggle('mirrored', !!settings.reverseTouchControls);
    }
}

export function getGameSettings() {
    return { ...saveSystem.saveData.settings };
}

export function persistGameSettings(partial) {
    saveSystem.updateSettings(partial);
    uiSettingsApply(saveSystem.saveData.settings);
}
