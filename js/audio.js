// Audio system - Web Audio API generated sounds
// All sounds are procedurally generated, no external files needed

export let audioContext = null;
let userMuted = false;
let platformMuted = false;
const isMuted = () => userMuted || platformMuted;
let masterVolume = 0.7;
let sfxVolume = 0.7;

// Check if CrazyGames SDK wants audio muted
// Initialize audio context (must be resumed by user gesture)
export function initAudioContext() {
    if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        try { audioContext = new AudioContextClass(); } catch { return null; }
    }
    
    // Resume context if suspended
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
    
    // Apply SDK mute if needed
    if (isMuted()) {
        audioContext.suspend();
    }
    return audioContext;
}

// Play a sound by name
export function play(name) {
    if (isMuted()) return;
    
    try {
        if (!audioContext && !initAudioContext()) return;
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Set parameters based on sound type
        let frequency, duration, type;
        
        switch (name) {
            case 'hit':
                frequency = 880;
                duration = 0.15;
                type = 'sine';
                break;
            case 'enemy_death':
                frequency = 220;
                duration = 0.4;
                type = 'sawtooth';
                break;
            case 'fragment':
                frequency = 523;
                duration = 0.2;
                type = 'sine';
                break;
            case 'level-up':
                frequency = 440;
                duration = 0.5;
                type = 'triangle';
                break;
            case 'stat-upgrade':
                frequency = 659;
                duration = 0.2;
                type = 'sine';
                break;
            case 'echo_shift':
                frequency = 294;
                duration = 0.3;
                type = 'sine';
                // Add whoosh effect
                oscillator.frequency.setValueAtTime(294, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + duration);
                gainNode.gain.setValueAtTime(sfxVolume * masterVolume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
                return; // Handled separately
            case 'player_damage':
                frequency = 330;
                duration = 0.1;
                type = 'sine';
                break;
            case 'boss_warning':
                frequency = 110;
                duration = 1.0;
                type = 'sine';
                // Rising frequency
                break;
            default:
                return;
        }
        
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        gainNode.gain.value = sfxVolume * masterVolume;
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
        // Audio error - continue without sound
    }
}

// Set volumes
export function setMasterVolume(volume) {
    masterVolume = Math.max(0, Math.min(1, volume));
    // Apply to audio context if possible
}

export function setSFXVolume(volume) {
    sfxVolume = Math.max(0, Math.min(1, volume));
}

export function setMuted(muted) {
    userMuted = !!muted;
    if (audioContext) {
        if (isMuted()) {
            audioContext.suspend();
        } else {
            audioContext.resume().catch(() => {});
        }
    }
}

export function setPlatformMuted(muted) {
    platformMuted = !!muted;
    if (audioContext) {
        if (isMuted()) audioContext.suspend();
        else audioContext.resume().catch(() => {});
    }
}

// Audio context creation is deferred until a user gesture.
