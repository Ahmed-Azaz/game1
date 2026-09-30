// UI system - HUD, stat screen, run summary, and settings
import * as game from './game.js';
import { player } from './player.js';
import { upgradeSystem } from './upgrades.js';
import * as audio from './audio.js';
import { saveSystem, persistGameSettings } from './save.js';

// main.js drives the HUD and overlays through this object, so every entry point
// it calls has to be exposed here.
export const ui = {
    init() {
        setUpEventListeners();
        initOnboardingWizard();
        refreshTitleBest();
    },
    tickHUD,
    beginRun,
    closeStatScreen,
    continueFromStatScreen: closeStatScreenAndResume,
    closeSettings
};

let statScreenMode = 'manual';

export function tickHUD() {
    if (!game.gameState) return;
    updateHUD();
}

export function openLevelUpStatScreen() {
    statScreenMode = 'levelUp';
    renderStatScreen();
}

export function beginRun() {
    document.getElementById('onboarding').style.display = 'none';
    // Defensive: an overlay left visible would keep the input layer on the title state
    const title = document.getElementById('title-screen');
    if (title) title.style.display = 'none';
    saveSystem.saveData.onboardingCompleted = true;
    saveSystem.save();
    // A fresh run: this also shows the Wave 1 banner and reports gameplay to the portal
    game.restartRun();
}

export function closeStatScreen() {
    const container = document.getElementById('stat-screen-container');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    statScreenMode = 'manual';
}

function refreshTitleBest() {
    const el = document.getElementById('title-best');
    if (!el) return;
    const best = saveSystem.saveData.bestTime || 0;
    el.textContent = best > 0
        ? `Best Run: ${game.formatTime(best)} · Lv. ${saveSystem.saveData.highestLevel || 1}`
        : 'Best Run: —';
}

function initOnboardingWizard() {
    const screens = document.querySelectorAll('#onboarding .onboarding-screen');
    screens.forEach((screen, index) => {
        screen.style.display = index === 0 ? 'block' : 'none';
    });
    const stepLabel = document.getElementById('onboarding-step');
    if (stepLabel) stepLabel.textContent = `1 / ${screens.length}`;
}

function setUpEventListeners() {
    // Continue is delegated so it survives the container being re-rendered
    document.getElementById('stat-screen-container').addEventListener('click', (e) => {
        if (e.target.id === 'continue-btn') {
            closeStatScreenAndResume();
        }
    });

    // Stat point buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('stat-plus') && !e.target.disabled) {
            if (upgradeSystem.addPoint(e.target.dataset.stat)) {
                game.applyPlayerStats();
                audio.play('stat-upgrade');
                renderStatScreen();
            }
        }
        
        // Skip tutorial
        if (e.target.classList.contains('skip-tutorial') || e.target.id === 'onboarding-skip-all') {
            beginRun();
        }
        if (e.target.id === 'onboarding-next') {
            advanceOnboarding(1);
        }
        if (e.target.id === 'title-play-btn') {
            document.getElementById('title-screen').style.display = 'none';
            openOnboarding();
        }
        if (e.target.id === 'title-howto-btn') {
            document.getElementById('title-screen').style.display = 'none';
            openOnboarding();
        }
        
        // Pause menu
        if (e.target.id === 'resume-btn') {
            // Hide the menu first so the UI always responds,
            // even if the optional SDK callback fails
            document.getElementById('pause-menu').style.display = 'none';
            game.gameplayStart();
        }
        if (e.target.id === 'stats-btn') {
            document.getElementById('pause-menu').style.display = 'none';
            statScreenMode = 'paused';
            renderStatScreen();
        }
        if (e.target.id === 'settings-btn') {
            settingsOpenedFromPause = true;
            openSettings();
        }
        if (e.target.id === 'restart-btn' || e.target.id === 'restart-btn2') {
            closeStatScreen();
            game.restartRun();
        }
        if (e.target.id === 'quit-btn' || e.target.id === 'main-menu-btn') {
            closeStatScreen();
            quitToTitle();
        }
        if (e.target.id === 'close-settings-btn') {
            closeSettings();
        }
    });

    // Volume settings listeners
    const masterVol = document.getElementById('master-vol');
    const sfxVol = document.getElementById('sfx-vol');
    if (masterVol) {
        const settings = game.loadGameSettings();
        masterVol.value = settings.masterVolume;
        if (sfxVol) sfxVol.value = settings.sfxVolume;
        game.applyGameSettings(settings);
        masterVol.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            audio.setMasterVolume(value);
            persistGameSettings({ masterVolume: value });
        });
    }
    if (sfxVol) {
        sfxVol.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            audio.setSFXVolume(value);
            persistGameSettings({ sfxVolume: value });
        });
    }
    const particleQuality = document.getElementById('particle-quality');
    const screenShake = document.getElementById('screen-shake');
    const settings = game.loadGameSettings();
    if (particleQuality) {
        particleQuality.value = settings.particleQuality || 'medium';
        particleQuality.addEventListener('change', (e) => {
            persistGameSettings({ particleQuality: e.target.value });
            game.applyGameSettings(game.loadGameSettings());
        });
    }
    if (screenShake) {
        screenShake.checked = settings.screenShake !== false;
        screenShake.addEventListener('change', (e) => {
            persistGameSettings({ screenShake: e.target.checked });
            game.applyGameSettings(game.loadGameSettings());
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Number keys 1-12 for quick stat allocation while stat screen is open
        const statScreen = document.getElementById('stat-screen-container');
        if (statScreen && statScreen.style.display === 'block') {
            const num = parseInt(e.key);
            if (num >= 1 && num <= 12) {
                const keys = ['hp', 'hpRegen', 'moveSpeed', 'attackPower', 'attackSpeed', 'attackRange', 'criticalChance', 'criticalDamage', 'echoPower', 'echoDuration', 'echoCooldown', 'multishot'];
                if (keys[num - 1] && upgradeSystem.addPoint(keys[num - 1])) {
                    game.applyPlayerStats();
                    audio.play('stat-upgrade');
                    renderStatScreen();
                }
            }
        }
    });
}

function openOnboarding() {
    const onboarding = document.getElementById('onboarding');
    const wizard = document.getElementById('onboarding-wizard');
    if (wizard) wizard.style.display = 'flex';
    if (onboarding) onboarding.style.display = 'flex';
    initOnboardingWizard();
}

function advanceOnboarding(delta) {
    const screens = [...document.querySelectorAll('#onboarding .onboarding-screen')];
    let current = screens.findIndex((s) => s.style.display !== 'none');
    if (current < 0) current = 0;
    const next = current + delta;
    if (next >= screens.length) {
        beginRun();
        return;
    }
    screens.forEach((s, i) => { s.style.display = i === next ? 'block' : 'none'; });
    const stepLabel = document.getElementById('onboarding-step');
    if (stepLabel) stepLabel.textContent = `${next + 1} / ${screens.length}`;
}

function updateHUD() {
    const state = game.gameState;

    // Level
    setText('level-display', `Lv. ${state.level}`);

    // Health
    const hpRatio = player.maxHP > 0 ? Math.max(0, player.hp / player.maxHP) : 0;
    const hpFill = document.getElementById('hp-bar-fill');
    if (hpFill) {
        hpFill.style.width = Math.min(hpRatio * 100, 100) + '%';
        hpFill.classList.toggle('low', hpRatio <= 0.34);
    }
    setText('hp-text', `${Math.ceil(Math.max(0, player.hp))} / ${player.maxHP} HP`);

    // XP
    const percent = state.xp / state.xpRequired;
    const xpBar = document.getElementById('xp-bar-fill');
    if (xpBar) xpBar.style.width = Math.min(percent * 100, 100) + '%';
    setText('xp-text', `${Math.floor(state.xp)} / ${state.xpRequired} XP`);

    // Run readouts
    setText('wave-display', `Wave ${game.getCurrentWave()}`);
    setText('time-display', game.formatTime(game.getRunTime()));
    setText('best-display', `Best ${game.formatTime(saveSystem.saveData.bestTime || 0)}`);

    // Echo Shift indicator
    updateEchoShiftIndicator();
}

const hudCache = new Map();
function setText(id, value) {
    if (hudCache.get(id) === value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    hudCache.set(id, value);
}

// Render the stat screen
function renderStatScreen() {
    const container = document.getElementById('stat-screen-container');
    if (!container) return;
    
    const stats = upgradeSystem.getStats();
    const availablePoints = upgradeSystem.getAvailablePoints();
    
    let html = `
        <div id="stat-screen" class="screen" style="display: block;">
            <div class="screen-overlay"></div>
            <div class="stat-window">
                <h2>STAT SCREEN</h2>
                <div class="player-info">
                    Level ${game.gameState.level}<br>
                    XP: ${Math.floor(game.gameState.xp)} / ${game.gameState.xpRequired}
                </div>
                
                <div class="stats-grid">
    `;
    
    // Render all 12 stats
    const statKeys = [
        { key: 'hp', label: 'HP', format: 'hp' },
        { key: 'hpRegen', label: 'HP Regen', format: 'hpRegen' },
        { key: 'moveSpeed', label: 'Move Speed', format: 'moveSpeed' },
        { key: 'attackPower', label: 'Attack Power', format: 'attackPower' },
        { key: 'attackSpeed', label: 'Attack Speed', format: 'attackSpeed' },
        { key: 'attackRange', label: 'Attack Range', format: 'attackRange' },
        { key: 'criticalChance', label: 'Critical Chance', format: 'criticalChance' },
        { key: 'criticalDamage', label: 'Critical Damage', format: 'criticalDamage' },
        { key: 'echoPower', label: 'Echo Power', format: 'echoPower' },
        { key: 'echoDuration', label: 'Echo Duration', format: 'echoDuration' },
        { key: 'echoCooldown', label: 'Echo Cooldown', format: 'echoCooldown' },
        { key: 'multishot', label: 'Multishot', format: 'multishot' }
    ];
    
    statKeys.forEach((stat, index) => {
        const current = stats[stat.key];
        const def = upgradeSystem.stats[stat.key];
        const base = def.base;
        const points = def.points;
        const bonus = calculateBonus(stat.key, current, base);

        let formatText = current;
        if (stat.format === 'hpRegen') {
            formatText = `${current} HP/sec`;
        } else if (stat.format === 'moveSpeed') {
            formatText = `${current} px/s`;
        } else if (stat.format === 'attackSpeed') {
            formatText = `${current.toFixed(2)}/sec`;
        } else if (stat.format === 'attackPower') {
            formatText = `${current} dmg`;
        } else if (stat.format === 'criticalChance') {
            formatText = `${current.toFixed(1)}%`;
        } else if (stat.format === 'criticalDamage') {
            formatText = `${current.toFixed(0)}%`;
        } else if (stat.format === 'echoPower') {
            formatText = `${current.toFixed(2)}x`;
        } else if (stat.format === 'echoDuration') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'echoCooldown') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'multishot') {
            formatText = `${current} shot${current === 1 ? '' : 's'}`;
        }
        
        // A stat can cost more than one point, so the button has to compare the
        // balance against this stat's cost rather than against zero.
        const cost = upgradeSystem.statCost(stat.key);
        const isDisabled = availablePoints < cost;
        // Tells the player what a single point is worth now, so percentage
        // scaling stays readable instead of looking like a flat bonus.
        const perPoint = def.percentPerPoint
            ? `+${trim(def.percentPerPoint * 100)}%`
            : `${trim(def.increment)}`;
        const hint = cost > 1 ? `${perPoint}, costs ${cost} points` : perPoint;

        html += `
            <div class="stat-row">
                <span class="stat-name">${stat.label}</span>
                <span class="stat-value">${formatText}</span>
                <span class="stat-base">Base: ${base}</span>
                <span class="stat-bonus">Bonus: ${bonus}</span>
                <button class="stat-plus ${isDisabled ? 'disabled' : ''}" data-stat="${stat.key}" title="Per point: ${hint}" ${isDisabled ? 'disabled' : ''}>${cost > 1 ? `+${cost}` : '+'}</button>
            </div>
        `;
    });
    
    html += `
                </div>
                <div class="stat-points">
                    Available Stat Points: ${availablePoints}<br>
                    <button id="continue-btn">Continue</button>
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
    container.style.display = 'block';
    
    // Opening the stat screen from the pause menu must stop the run too, so the
    // portal is told gameplay ended while the player is allocating points.
    if (statScreenMode === 'paused') game.gameplayStop();
}

function closeStatScreenAndResume() {
    const mode = statScreenMode;
    closeStatScreen();
    if (mode === 'levelUp') {
        game.closeStatAllocation();
    } else {
        // Opened from the pause menu: gameplayStop() paused the run, so resume
        game.gameplayStart();
    }
}

// Bonus text for the stat screen. Percentage stats report how far the value
// has grown from base; flat stats report the raw amount added.
function calculateBonus(statKey, current, base) {
    const stat = upgradeSystem.stats[statKey];
    if (stat.points === 0) return stat.percentPerPoint ? '0%' : '0';

    if (stat.percentPerPoint) {
        const percent = ((current - base) / base) * 100;
        return `+${trim(percent)}%`;
    }
    if (statKey === 'echoCooldown') {
        return `-${trim(Math.abs(current - base))}s`;
    }
    if (statKey === 'multishot') {
        return `+${trim(current - base)} shot${current - base === 1 ? '' : 's'}`;
    }
    return `+${trim(current - base)}`;
}

function trim(value) {
    return String(Math.round(value * 100) / 100);
}

// Update Echo Shift indicator
function updateEchoShiftIndicator() {
    const indicator = document.getElementById('echo-shift-indicator');
    const cooldownText = document.getElementById('echo-shift-cooldown');
    const shiftText = document.getElementById('echo-shift-text');
    
    if (!indicator) return;
    
    const lastUsed = game.echoShift ? game.echoShift.lastUsed : 0;
    const cooldown = game.echoShift ? game.echoShift.cooldown : 15.0;
    const timeSinceUsed = game.getRunTime() - lastUsed;
    const remainingCooldown = Math.max(0, cooldown - timeSinceUsed);
    
    if (!game.echoShift || game.gameState.isPaused || game.gameState.statAllocationOpen
        || document.getElementById('game-over').style.display === 'block'
        || document.getElementById('onboarding').style.display !== 'none') {
        indicator.style.display = 'none';
        return;
    }
    
    indicator.style.display = 'block';
    
    if (remainingCooldown > 0.05) {
        cooldownText.textContent = remainingCooldown.toFixed(1) + 's';
        shiftText.textContent = 'ECHO SHIFT: ' + remainingCooldown.toFixed(1) + 's';
    } else {
        cooldownText.textContent = 'READY';
        shiftText.textContent = 'ECHO SHIFT: READY';
    }
}

function quitToTitle() {
    game.gameplayStop();
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('pause-menu').style.display = 'none';
    document.getElementById('settings-panel').style.display = 'none';
    closeStatScreen();
    const title = document.getElementById('title-screen');
    const wizard = document.getElementById('onboarding-wizard');
    if (title) title.style.display = 'flex';
    if (wizard) wizard.style.display = 'none';
    document.getElementById('onboarding').style.display = 'none';
    if (game.gameState) {
        game.gameState.isPaused = true;
        game.gameState.statAllocationOpen = false;
        // Records live in the save, not in the abandoned run
        game.gameState.highestLevel = saveSystem.saveData.highestLevel || 1;
        game.gameState.bestSurvivalTime = saveSystem.saveData.bestTime || 0;
    }
    refreshTitleBest();
}

// Settings panel
let settingsOpenedFromPause = false;

export function openSettings() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'flex';
}

export function closeSettings() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'none';
    // Return to the pause menu instead of dropping the player into a paused run
    if (settingsOpenedFromPause) {
        settingsOpenedFromPause = false;
        document.getElementById('pause-menu').style.display = 'block';
    }
}
