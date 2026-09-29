// UI system - HUD, stat screen, run summary, and settings
import * as game from './game.js';
import { upgradeSystem } from './upgrades.js';
import * as audio from './audio.js';

export const ui = {
    init() {
        // Set up event listeners
        setUpEventListeners();
    }
};

function setUpEventListeners() {
    // Stat point buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('stat-plus')) {
            const statKey = e.target.dataset.stat;
            upgradeSystem.addPoint(statKey);
            game.applyPlayerStats();
            renderStatScreen();
        }
        
        // Skip tutorial
        if (e.target.classList.contains('skip-tutorial')) {
            document.getElementById('onboarding').style.display = 'none';
            localStorage.setItem('echoRift_onboardingCompleted', 'true');
            game.restartRun();
        }
        
        // Pause menu
        if (e.target.id === 'resume-btn') {
            // Hide the menu first so the UI always responds,
            // even if the optional SDK callback fails
            document.getElementById('pause-menu').style.display = 'none';
            game.gameplayStart();
        }
        if (e.target.id === 'stats-btn') {
            document.getElementById('game-over').style.display = 'none';
            renderStatScreen();
            const statScreen = document.getElementById('stat-screen');
            if (statScreen) statScreen.style.display = 'block';
        }
        if (e.target.id === 'settings-btn') {
            toggleSettings();
        }
        if (e.target.id === 'restart-btn') {
            game.restartRun();
        }
        if (e.target.id === 'quit-btn') {
            quitToTitle();
        }
        if (e.target.id === 'restart-btn2') {
            game.restartRun();
        }
        if (e.target.id === 'main-menu-btn') {
            quitToTitle();
        }
        if (e.target.id === 'close-settings-btn') {
            document.getElementById('settings-panel').style.display = 'none';
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
            game.saveGameSettings({ ...game.loadGameSettings(), masterVolume: value });
        });
    }
    if (sfxVol) {
        sfxVol.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            audio.setSFXVolume(value);
            game.saveGameSettings({ ...game.loadGameSettings(), sfxVolume: value });
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Number keys 1-12 for quick stat allocation while stat screen is open
        const statScreen = document.getElementById('stat-screen');
        if (statScreen && statScreen.style.display === 'block') {
            const num = parseInt(e.key);
            if (num >= 1 && num <= 12) {
                const keys = ['hp', 'hpRegen', 'moveSpeed', 'attackPower', 'attackSpeed', 'attackRange', 'criticalChance', 'criticalDamage', 'echoPower', 'echoDuration', 'echoCooldown', 'fragmentMagnet'];
                if (keys[num - 1]) {
                    upgradeSystem.addPoint(keys[num - 1]);
                    game.applyPlayerStats();
                    renderStatScreen();
                }
            }
        }
    });
}

// Update HUD display
function updateHUD() {
    // Level
    document.getElementById('level-display').textContent = `Lv. ${game.gameState.level}`;
    
    // XP
    const percent = game.gameState.xp / game.gameState.xpRequired;
    const xpBar = document.getElementById('xp-bar-fill');
    xpBar.style.width = Math.min(percent * 100, 100) + '%';
    document.getElementById('xp-text').textContent = `${Math.floor(game.gameState.xp)} / ${game.gameState.xpRequired} XP`;
    
    // Echo Shift indicator
    updateEchoShiftIndicator();
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
        { key: 'fragmentMagnet', label: 'Fragment Magnet', format: 'fragmentMagnet' }
    ];
    
    statKeys.forEach((stat, index) => {
        const current = stats[stat.key];
        const base = upgradeSystem.stats[stat.key].base;
        const points = upgradeSystem.stats[stat.key].points;
        const bonus = calculateBonus(stat.key, points);
        
        let formatText = current;
        if (stat.format === 'hpRegen') {
            formatText = `${current} HP/sec`;
        } else if (stat.format === 'moveSpeed') {
            formatText = `${current} px/s`;
        } else if (stat.format === 'attackSpeed') {
            formatText = `${current.toFixed(1)}/sec`;
        } else if (stat.format === 'criticalChance') {
            formatText = `${current.toFixed(1)}%`;
        } else if (stat.format === 'criticalDamage') {
            formatText = `${current.toFixed(1)}%`;
        } else if (stat.format === 'echoPower') {
            formatText = `${current.toFixed(1)}x`;
        } else if (stat.format === 'echoDuration') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'echoCooldown') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'fragmentMagnet') {
            formatText = `${current} px`;
        }
        
        const isDisabled = availablePoints <= 0;
        
        html += `
            <div class="stat-row">
                <span class="stat-name">${stat.label}</span>
                <span class="stat-value">${formatText}</span>
                <span class="stat-base">Base: ${base}</span>
                <span class="stat-bonus">Bonus: ${bonus}</span>
                <button class="stat-plus ${isDisabled ? 'disabled' : ''}" data-stat="${stat.key}" ${isDisabled ? 'disabled' : ''}>+</button>
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
    
    // Add click listeners for continue button
    document.getElementById('continue-btn').addEventListener('click', () => {
        container.style.display = 'none';
        container.innerHTML = '';
        if (game.gameState && game.gameState.isPaused && document.getElementById('game-over').style.display !== 'block') {
            // Resume gameplay
            game.gameplayStart();
        }
    });
}

function calculateBonus(statKey, points) {
    const stat = upgradeSystem.stats[statKey];
    if (stat.points === 0) return '0%';
    
    if (statKey === 'moveSpeed') {
        const percent = stat.points * stat.percentPerPoint * 100;
        return `+${percent.toFixed(0)}%`;
    } else if (statKey === 'criticalChance') {
        const percent = stat.points * stat.increment * 100;
        return `+${percent.toFixed(1)}%`;
    } else if (statKey === 'criticalDamage') {
        const percent = stat.points * stat.increment;
        return `+${percent.toFixed(1)}%`;
    } else if (statKey === 'echoPower') {
        const value = stat.points * stat.increment;
        return `+${value.toFixed(1)}`;
    } else if (statKey === 'echoDuration') {
        const value = stat.points * stat.increment;
        return `+${value.toFixed(1)}s`;
    } else if (statKey === 'echoCooldown') {
        const value = Math.abs(stat.points * stat.increment);
        return `-${value.toFixed(1)}s`;
    } else if (statKey === 'fragmentMagnet') {
        const value = stat.points * stat.increment;
        return `+${value} px`;
    }
    return '0';
}

// Update Echo Shift indicator
function updateEchoShiftIndicator() {
    const indicator = document.getElementById('echo-shift-indicator');
    const cooldownText = document.getElementById('echo-shift-cooldown');
    const shiftText = document.getElementById('echo-shift-text');
    
    if (!indicator) return;
    
    const lastUsed = game.echoShift ? game.echoShift.lastUsed : 0;
    const cooldown = game.echoShift ? game.echoShift.cooldown : 15.0;
    const currentTime = performance.now() / 1000;
    const timeSinceUsed = currentTime - lastUsed;
    const remainingCooldown = Math.max(0, cooldown - timeSinceUsed);
    
    if (game.gameState.isPaused || document.getElementById('game-over').style.display === 'block') {
        indicator.style.display = 'none';
        return;
    }
    
    indicator.style.display = 'block';
    
    if (remainingCooldown > 0.5) {
        cooldownText.textContent = remainingCooldown.toFixed(1) + 's';
        shiftText.textContent = 'ECHO SHIFT: ' + remainingCooldown.toFixed(1) + 's';
    } else {
        cooldownText.textContent = 'READY';
        shiftText.textContent = 'ECHO SHIFT: READY';
        
        // Hide after a moment if ready
        setTimeout(() => {
            indicator.style.display = 'none';
        }, 1000);
    }
}

// Show game over screen
function showGameOverScreen() {
    const survivalSeconds = Math.floor((game.gameState.secondsSinceStart - game.gameState.timePaused) || 0);
    const minutes = Math.floor(survivalSeconds / 60);
    const secs = survivalSeconds % 60;
    
    const gameOverContainer = document.getElementById('game-over');
    if (!gameOverContainer) return;

    // Update text content of existing spans
    document.getElementById('survival-time').textContent = `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    document.getElementById('enemies-defeated').textContent = game.gameState.enemiesDefeated;
    document.getElementById('fragments-collected').textContent = game.gameState.fragmentsCollected;
    document.getElementById('level-reached').textContent = game.gameState.level;

    const finalStats = document.getElementById('final-stats');
    if (finalStats) {
        document.getElementById('damage-dealt').textContent = Math.floor(game.gameState.damageDealt);
        document.getElementById('echo-damage').textContent = Math.floor(game.gameState.echoDamageDealt);
        document.getElementById('stat-points-spent').textContent = game.gameState.statPointsSpent;
        finalStats.style.display = 'block';
    }

    gameOverContainer.style.display = 'block';
    // Event listeners are already on the buttons in index.html and setupEventListeners
}

function quitToTitle() {
    document.getElementById('onboarding').style.display = 'block';
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('pause-menu').style.display = 'none';
    const statScreen = document.getElementById('stat-screen-container');
    if (statScreen) {
        statScreen.style.display = 'none';
        statScreen.innerHTML = '';
    }
    // Reset some state (gameState is a read-only namespace binding - mutate instead of reassign)
    if (game.gameState) {
        Object.assign(game.gameState, {
            level: 1,
            xp: 0,
            xpRequired: 100,
            statPoints: 0,
            highestLevel: 1,
            bestSurvivalTime: 0,
            enemiesDefeated: 0,
            fragmentsCollected: 0,
            damageDealt: 0,
            echoDamageDealt: 0,
            statPointsSpent: 0,
            runStartTime: 0,
            timePaused: 0,
            secondsSinceStart: 0,
            isPaused: false
        });
    }
}

// Settings panel
function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }
}
