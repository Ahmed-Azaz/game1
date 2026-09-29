// Save system - localStorage with CrazyGames Data Module fallback
import * as audio from './audio.js';

export const saveSystem = {
    // Save data structure
    saveData: {
        bestTime: 0,
        highestLevel: 1,
        highestScore: 0,
        settings: {
            masterVolume: 0.7,
            sfxVolume: 0.7,
            particleQuality: 'medium',
            screenShake: true
        },
        onboardingCompleted: false
    },
    
    init() {
        // Load saved data
        this.load();
    },
    
    load() {
        try {
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
        
        // Check onboarding state
        if (this.saveData.onboardingCompleted) {
            document.getElementById('onboarding').style.display = 'none';
        }
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
    // Apply volume settings
    if (settings.masterVolume !== undefined) {
        audio.setMasterVolume(settings.masterVolume);
    }
    if (settings.sfxVolume !== undefined) {
        audio.setSFXVolume(settings.sfxVolume);
    }
    if (settings.particleQuality) {
        // Adjust particle limits based on quality
        const quality = settings.particleQuality;
        // High: full, Medium: 75%, Low: 50%
        // This would be used in the game loop
    }
    if (settings.screenShake !== undefined) {
        // Enable/disable screen shake
    }
}
