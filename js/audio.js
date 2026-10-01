// Audio system - Web Audio API generated sounds
// All sounds are procedurally generated, no external files needed

export let audioContext = null;
let userMuted = false;
let platformMuted = false;
const isMuted = () => userMuted || platformMuted;
let masterVolume = 0.7;
let sfxVolume = 0.7;
let bgmNodes = null;
let bgmPlaying = false;

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
            case 'time_dilation':
                // Descending sweep: the sound of the world dropping into syrup
                frequency = 660;
                duration = 0.5;
                type = 'triangle';
                oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(140, audioContext.currentTime + duration);
                gainNode.gain.setValueAtTime(sfxVolume * masterVolume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
                return; // Handled separately
            case 'phase_dash':
                // Short upward blip: quick enough to read as a dodge
                frequency = 420;
                duration = 0.12;
                type = 'sawtooth';
                break;
            case 'void_nova':
                // Low thump with a short tail, so it reads as heavy and close
                frequency = 160;
                duration = 0.35;
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
                oscillator.type = type;
                oscillator.frequency.setValueAtTime(110, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + duration);
                gainNode.gain.setValueAtTime(sfxVolume * masterVolume * 0.5, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
                return;
            case 'wave':
                frequency = 330;
                duration = 0.35;
                type = 'triangle';
                oscillator.type = type;
                oscillator.frequency.setValueAtTime(330, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(660, audioContext.currentTime + duration);
                gainNode.gain.setValueAtTime(sfxVolume * masterVolume * 0.45, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
                return;
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
    updateBGMVolume();
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
        if (isMuted()) {
            audioContext.suspend();
            stopBGM();
        } else {
            audioContext.resume().catch(() => {});
        }
    }
}

export function startBGM() {
    if (isMuted() || bgmPlaying) return;
    if (!audioContext && !initAudioContext()) return;
    stopBGM();
    try {
        const osc1 = audioContext.createOscillator();
        const osc2 = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.value = 55;
        osc2.frequency.value = 110;
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        gain.gain.value = masterVolume * 0.08;
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(audioContext.destination);
        osc1.start();
        osc2.start();
        bgmNodes = { osc1, osc2, gain };
        bgmPlaying = true;
    } catch { /* ignore */ }
}

export function stopBGM() {
    if (!bgmNodes) return;
    try {
        bgmNodes.osc1.stop();
        bgmNodes.osc2.stop();
    } catch { /* ignore */ }
    bgmNodes = null;
    bgmPlaying = false;
}

export function updateBGMVolume() {
    if (bgmNodes?.gain) bgmNodes.gain.gain.value = masterVolume * 0.08;
}

// Audio context creation is deferred until a user gesture.
