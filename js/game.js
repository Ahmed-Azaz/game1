// Core game state, loop, spawn management, and difficulty scaling
import * as enemies from './enemies.js';
import { player } from './player.js';
import { upgradeSystem } from './upgrades.js';
import * as audio from './audio.js';
import { crazyGames } from './crazygames.js';
import { saveSystem } from './save.js';
import { clear as clearVisualEffects } from './visual-effects.js';
import { spawnHit } from './visual-effects.js';

// Shared mutable state (read by ui.js/enemies.js/player.js via namespace import)
export let gameState = null;
export let echoShift = null;
export let canvasWidth = 960;
export let canvasHeight = 540;

export function initGame() {
    // Sync canvas dimensions
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
    }
    
    // Game settings
    const settings = loadGameSettings();
    applyGameSettings(settings);
    
    // Initial game state
    gameState = {
        level: 1,
        xp: 0,
        xpRequired: 100, // Level 1 -> 2: 100 XP
        statPoints: 0,
        highestLevel: saveSystem.saveData.highestLevel || 1,
        bestSurvivalTime: saveSystem.saveData.bestTime || 0,
        enemiesDefeated: 0,
        fragmentsCollected: 0,
        damageDealt: 0,
        echoDamageDealt: 0,
        statPointsSpent: 0,
        runStartTime: 0,
        timePaused: 0,
        secondsSinceStart: 0,
        isPaused: false
    };
    
    // Initialize the player before input is accepted; otherwise the first update
    // clamps the default (0, 0) position to the arena corner.
    player.reset();

    // Player stats (from upgrade system)
    applyPlayerStats();
    
    // Wave system
    currentWave = 1;
    lastWaveTime = 0;
    enemiesThisWave = 0;
    maxEnemiesPerWave = 5;
    spawnTimer = 0;
    secondsSinceStart = 0;
    
    // Echo Shift
    echoShift = {
        isActive: false,
        path: [], // Circular buffer of position records
        startTime: 0,
        duration: 3.0, // Base echo duration in seconds
        cooldown: 15.0, // Base cooldown in seconds
        lastUsed: -999 // Time since last use (negative = ready)
    };
    
    // UI updates
    updateLevelDisplay();
    updateXPBar();
}

// Game loop - called from main.js
let currentWave = 1;
let lastWaveTime = 0;
let enemiesThisWave = 0;
let maxEnemiesPerWave = 5;
let spawnTimer = 0;
let secondsSinceStart = 0;

export function update(deltaTime) {
    if (!gameState || gameState.isPaused) return;
    
    secondsSinceStart += deltaTime;
    gameState.secondsSinceStart = secondsSinceStart;
    
    // Wave system - every 30 seconds a new wave
    if (secondsSinceStart - lastWaveTime >= 30) {
        startNewWave();
        lastWaveTime = secondsSinceStart;
    }
    
    // Spawn enemies during wave
    if (currentWave > 0 && enemiesThisWave < maxEnemiesPerWave * 3) {
        spawnTimer += deltaTime;
        if (spawnTimer >= 2) { // Spawn every 2 seconds
            spawnEnemy();
            spawnTimer = 0;
        }
    }
    
    // Update existing enemies
    enemies.updateAll(deltaTime);
    
    // Player auto-attack nearest enemy in range
    player.autoAttack(enemies.getActiveEnemies());
    
    // Update echo shift
    updateEchoShift(deltaTime);
    
    // Check for level up
    checkLevelUp();
    
    // Check game over
    checkGameOverState();
}

export function startNewWave() {
    currentWave++;
    maxEnemiesPerWave = Math.min(5 + Math.floor(currentWave / 3), 15); // Scale up to 15
    enemiesThisWave = 0;
    
    // Spawn initial enemies
    for (let i = 0; i < Math.min(3 + currentWave % 4, 8); i++) {
        setTimeout(spawnEnemy, i * 500);
    }
    
    // UI update
    const container = document.getElementById('wave-notice-container');
    if (container) {
        const notice = document.createElement('div');
        notice.className = 'wave-notice';
        notice.textContent = `Wave ${currentWave}`;
        container.appendChild(notice);
        setTimeout(() => notice.remove(), 3000);
    }
    
    // Sound
    audio.play('wave');
}

export function spawnEnemy() {
    if (enemiesThisWave >= maxEnemiesPerWave) return;
    
    // Determine enemy type based on wave
    let type;
    if (currentWave % 5 === 0) {
        type = 'rift_warden'; // Elite every 5 waves
    } else if (currentWave >= 3 && Math.random() < 0.3) {
        type = 'null_beast'; // High HP enemy
    } else if (currentWave >= 2) {
        // Pick random basic type
        const types = ['drifter', 'charger', 'shardling'];
        type = types[Math.floor(Math.random() * types.length)];
    } else {
        type = 'drifter'; // Basic enemy early on
    }
    
    const enemy = enemies.create(type);
    
    // Spawn from edges
    if (Math.random() < 0.5) {
        // Top or bottom
        enemy.x = Math.random() * canvasWidth;
        enemy.y = Math.random() < 0.5 ? -enemy.size : canvasHeight + enemy.size;
    } else {
        // Left or right
        enemy.x = Math.random() < 0.5 ? -enemy.size : canvasWidth + enemy.size;
        enemy.y = Math.random() * canvasHeight;
    }
    
    enemiesThisWave++;
}

export function checkLevelUp() {
    if (gameState.xp >= gameState.xpRequired) {
        levelUp();
    }
}

export function levelUp() {
    while (gameState.xp >= gameState.xpRequired) {
        gameState.xp -= gameState.xpRequired;
        gameState.level++;
        gameState.highestLevel = Math.max(gameState.highestLevel, gameState.level);
        gameState.xpRequired = Math.floor(gameState.xpRequired * 1.5);
        
        // Award stat points (from Level 2 onwards)
        upgradeSystem.addStatPoints(upgradeSystem.levelUpPoints);
        gameState.statPoints = upgradeSystem.getAvailablePoints();
        
        audio.play('level-up');
    }
    
    updateLevelDisplay();
    updateXPBar();
    saveGame();
}

export function checkGameOverState() {
    // Check if player HP <= 0
    if (player.hp <= 0) {
        endRun();
    }
}

export function endRun() {
    gameState.isPaused = true;
    
    // Update best stats
    const survivalTime = (secondsSinceStart - gameState.timePaused).toFixed(0);
    gameState.bestSurvivalTime = Math.max(gameState.bestSurvivalTime, parseInt(survivalTime));
    
    // Show game over UI
    showGameOverScreen();
    
    // Call CrazyGames gameplay stop
    crazyGames.gameplayStop();
    
    // Save best stats
    saveGame();
}

export function addXP(amount) {
    gameState.xp += amount;
    gameState.fragmentsCollected += Math.floor(amount / 10); // Fragments are ~10 XP each
    
    // Update UI
    updateXPBar();
    
    // Check level up immediately
    checkLevelUp();
    
    // Sound
    audio.play('fragment');
}

export function addEchoDamage(amount) {
    gameState.echoDamageDealt += amount;
    updateUIStats();
}

export function addDamageDealt(amount) {
    gameState.damageDealt += amount;
    updateUIStats();
}

export function addEnemiesDefeated(amount = 1) {
    gameState.enemiesDefeated += amount;
    updateUIStats();
}

export function loadGameSettings() {
    try {
        const saved = localStorage.getItem('echoRift_settings');
        return saved ? { masterVolume: 0.7, sfxVolume: 0.7, particleQuality: 'medium', screenShake: true, ...JSON.parse(saved) } : { masterVolume: 0.7, sfxVolume: 0.7, particleQuality: 'medium', screenShake: true };
    } catch {
        return { masterVolume: 0.7, sfxVolume: 0.7, particleQuality: 'medium', screenShake: true };
    }
}

export function saveGameSettings(settings) {
    try {
        localStorage.setItem('echoRift_settings', JSON.stringify(settings));
    } catch (e) {
        // Save failed - continue normally
    }
}

export function applyGameSettings(settings) {
    if (!settings) return;
    // Apply volume, particle quality, etc.
    if (settings.masterVolume !== undefined) {
        audio.setMasterVolume(settings.masterVolume);
    }
    if (settings.sfxVolume !== undefined) {
        audio.setSFXVolume(settings.sfxVolume);
    }
    if (settings.particleQuality) {
        // Adjust particle limits
    }
    if (settings.screenShake) {
        // Enable screen shake
    }
}

export function updateLevelDisplay() {
    document.getElementById('level-display').textContent = `Lv. ${gameState.level}`;
    document.getElementById('xp-text').textContent = `${gameState.xp} / ${gameState.xpRequired} XP`;
}

export function updateXPBar() {
    const percent = gameState.xp / gameState.xpRequired;
    const bar = document.getElementById('xp-bar-fill');
    bar.style.width = Math.min(percent * 100, 100) + '%';
}

export function updateUIStats() {
    document.getElementById('enemies-defeated').textContent = gameState.enemiesDefeated;
    document.getElementById('fragments-collected').textContent = gameState.fragmentsCollected;
    document.getElementById('damage-dealt').textContent = gameState.damageDealt;
    document.getElementById('echo-damage').textContent = gameState.echoDamageDealt;
}

export function showGameOverScreen() {
    document.getElementById('game-over').style.display = 'block';
    document.getElementById('pause-menu').style.display = 'none';
    document.getElementById('onboarding').style.display = 'none';
    
    // Fill in run summary
    document.getElementById('survival-time').textContent = Math.floor((secondsSinceStart - gameState.timePaused) / 60) + ':' + ('0' + ((secondsSinceStart - gameState.timePaused) % 60)).slice(-2);
    document.getElementById('enemies-defeated').textContent = gameState.enemiesDefeated;
    document.getElementById('fragments-collected').textContent = gameState.fragmentsCollected;
    document.getElementById('level-reached').textContent = gameState.level;
    document.getElementById('damage-dealt').textContent = gameState.damageDealt;
    document.getElementById('echo-damage').textContent = gameState.echoDamageDealt;
    document.getElementById('stat-points-spent').textContent = gameState.statPointsSpent;
    
    // Show final stats
    document.getElementById('final-stats').style.display = 'block';
    document.getElementById('run-summary').style.display = 'block';
}

export function restartRun() {
    // Reset game state
    gameState.level = 1;
    gameState.xp = 0;
    gameState.xpRequired = 100;
    gameState.statPoints = 0;
    gameState.enemiesDefeated = 0;
    gameState.fragmentsCollected = 0;
    gameState.damageDealt = 0;
    gameState.echoDamageDealt = 0;
    gameState.statPointsSpent = 0;
    gameState.highestLevel = saveSystem.saveData.highestLevel || 1;
    gameState.bestSurvivalTime = saveSystem.saveData.bestTime || 0;
    gameState.timePaused = 0;
    gameState.isPaused = false;
    secondsSinceStart = 0;
    currentWave = 1;
    lastWaveTime = 0;
    enemiesThisWave = 0;
    maxEnemiesPerWave = 5;
    spawnTimer = 0;
    clearVisualEffects();
    
    // Reset player
    player.reset();
    
    // Reset upgrades for a completely fresh run
    upgradeSystem.reset();
    applyPlayerStats();
    
    // Reset enemies
    enemies.resetAll();
    
    // Reset echo shift
    echoShift.path = [];
    echoShift.isActive = false;
    echoShift.lastUsed = -999;
    echoShift.duration = player.echoDuration;
    echoShift.cooldown = player.echoCooldown;
    
    // Hide UI
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('pause-menu').style.display = 'none';
    
    // Show onboarding for first run
    const onboarding = document.getElementById('onboarding');
    const hasCompletedOnboarding = localStorage.getItem('echoRift_onboardingCompleted');
    if (!hasCompletedOnboarding) {
        onboarding.style.display = 'block';
    } else {
        // Start gameplay immediately
        gameplayStart();
    }
    
    // Update display
    updateLevelDisplay();
    updateXPBar();
    
}

export function gameplayStart() {
    if (!gameState) return;
    // Always unpause - the resume button must work even if a previous
    // run ended in the paused state
    gameState.isPaused = false;
    crazyGames.gameplayStart();
}

export function gameplayStop() {
    if (!gameState) return;
    gameState.isPaused = true;
    crazyGames.gameplayStop();
}

export function updateEchoShift(deltaTime) {
    if (echoShift.isActive) {
        // Replay path - visual effect drawn in UI rendering
        
        // Damage logic
        if (!echoShift.damagedEnemies) echoShift.damagedEnemies = new Set();
        const activeEnemies = enemies.getActiveEnemies();
        const echoDamage = player.attackPower * player.echoPower;
        
        // Check collisions along the path
        echoShift.path.forEach(record => {
            activeEnemies.forEach(enemy => {
                if (!echoShift.damagedEnemies.has(enemy.id)) {
                    const dist = Math.hypot(record.x - enemy.x, record.y - enemy.y);
                    if (dist < enemy.size + 25) { // 25 is approx echo trail radius
                        enemy.hp -= echoDamage;
                        enemy.hitFlashUntil = performance.now() / 1000 + 0.16;
                        spawnHit(enemy.x, enemy.y, '#58e8f4', echoDamage, false);
                        addEchoDamage(echoDamage);
                        echoShift.damagedEnemies.add(enemy.id);
                        audio.play('hit');
                    }
                }
            });
        });
        
        // Check if duration elapsed
        if (performance.now() / 1000 - echoShift.startTime >= echoShift.duration) {
            echoShift.isActive = false;
            echoShift.cooldownRemaining = echoShift.cooldown;
            echoShift.damagedEnemies = null;
        }
    } else {
        // Count down cooldown
        if (echoShift.lastUsed + echoShift.cooldown < performance.now() / 1000) {
            // Ready - could show indicator
        }
    }
}

export function activateEchoShift() {
    if (echoShift.lastUsed + echoShift.cooldown > performance.now() / 1000) {
        // Not ready yet
        return false;
    }
    
    // Freeze current path and activate echo
    echoShift.isActive = true;
    echoShift.startTime = performance.now() / 1000;
    echoShift.path = player.getMovementPath(); // Get last ~5 seconds of positions
    
    // Update cooldown
    echoShift.lastUsed = performance.now() / 1000;
    
    // Sound
    audio.play('echo_shift');
    
    // UI update
    updateEchoShiftIndicator();
    
    return true;
}

export function updateEchoShiftIndicator() {
    const indicator = document.getElementById('echo-shift-indicator');
    const cooldownText = document.getElementById('echo-shift-cooldown');
    const shiftText = document.getElementById('echo-shift-text');
    
    indicator.style.display = 'block';
    shiftText.textContent = 'ECHO SHIFT: READY'; // Will be updated
    
    // Show cooldown
    const cooldown = echoShift.cooldown - (performance.now() / 1000 - echoShift.lastUsed);
    if (cooldown > 0) {
        cooldownText.textContent = cooldown.toFixed(1) + 's';
        shiftText.textContent = 'ECHO SHIFT: ' + cooldown.toFixed(1) + 's';
    } else {
        cooldownText.textContent = '0.0s';
        shiftText.textContent = 'ECHO SHIFT: READY';
    }
    
    // Hide after cooldown expires
    setTimeout(() => {
        indicator.style.display = 'none';
    }, 2000);
}

export function applyPlayerStats() {
    // Apply stats from upgrade system to player
    const stats = upgradeSystem.getStats();
    
    player.maxHP = stats.hp;
    player.hp = stats.hp; // Full heal on new run/level
    player.moveSpeed = stats.moveSpeed;
    player.attackPower = stats.attackPower;
    player.attackSpeed = stats.attackSpeed;
    player.attackRange = stats.attackRange;
    player.criticalChance = stats.criticalChance;
    player.criticalDamage = stats.criticalDamage;
    player.echoPower = stats.echoPower;
    player.echoDuration = stats.echoDuration;
    player.echoCooldown = stats.echoCooldown;
    if (echoShift) {
        echoShift.duration = stats.echoDuration;
        echoShift.cooldown = stats.echoCooldown;
    }
    player.fragmentMagnetRange = stats.fragmentMagnet;
}

export function loadGame() {
    gameState.highestLevel = Math.max(gameState.highestLevel, saveSystem.saveData.highestLevel || 1);
    gameState.bestSurvivalTime = Math.max(gameState.bestSurvivalTime, saveSystem.saveData.bestTime || 0);
}

export function saveGame() {
    saveSystem.saveData.highestLevel = Math.max(saveSystem.saveData.highestLevel || 1, gameState.highestLevel || 1);
    saveSystem.saveData.bestTime = Math.max(saveSystem.saveData.bestTime || 0, gameState.bestSurvivalTime || 0);
    saveSystem.save();
}
