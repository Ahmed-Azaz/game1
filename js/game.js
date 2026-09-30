// Core game state, loop, spawn management, and difficulty scaling
import * as enemies from './enemies.js';
import { player } from './player.js';
import { upgradeSystem } from './upgrades.js';
import * as audio from './audio.js';
import { crazyGames } from './crazygames.js';
import { saveSystem } from './save.js';
import { clear as clearVisualEffects, spawnHit, setParticleQuality, setScreenShakeEnabled } from './visual-effects.js';
import * as fragments from './fragments.js';

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
        secondsSinceStart: 0,
        isPaused: false,
        statAllocationOpen: false
    };
    
    // Initialize the player before input is accepted; otherwise the first update
    // clamps the default (0, 0) position to the arena corner.
    player.reset();

    applyPlayerStats({ fullHeal: true });
    
    // Wave system
    currentWave = 1;
    lastWaveTime = 0;
    enemiesThisWave = 0;
    maxEnemiesPerWave = 5;
    spawnTimer = 0;
    secondsSinceStart = 0;
    pendingSpawns = 0;
    bossWaveActive = false;
    runEnded = false;
    enemies.setWave(1);
    
    // Echo Shift
    echoShift = {
        isActive: false,
        path: [], // Frozen path replayed as a damage trail
        startTime: 0, // Run-clock stamp of the activation
        elapsed: 0, // Seconds replayed so far (drives the sweep)
        duration: 3.0, // Base echo duration in seconds
        cooldown: 15.0, // Base cooldown in seconds
        lastUsed: -999, // Run-clock stamp of the last use (negative = ready)
        damagedEnemies: null,
        replayProgress: 0,
        replaySegmentIndex: 0,
        replaySegmentT: 0,
        headX: 0,
        headY: 0
    };
    
    loadGame();
    fragments.resetAll();

    // UI updates
    updateLevelDisplay();
    updateXPBar();
    updateUIStats();
}

// Game loop - called from main.js
let currentWave = 1;
let lastWaveTime = 0;
let enemiesThisWave = 0;
let maxEnemiesPerWave = 5;
let spawnTimer = 0;
let secondsSinceStart = 0;
let pendingSpawns = 0;
let bossWaveActive = false;
let runEnded = false;

export function getCurrentWave() {
    return currentWave;
}

// Run clock: advances only while unpaused, so echo cooldowns, replays and the
// movement trail all share one pausable timeline.
export function getRunTime() {
    return secondsSinceStart;
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
}

function placeEnemyAtEdge(enemy) {
    if (Math.random() < 0.5) {
        enemy.x = Math.random() * canvasWidth;
        enemy.y = Math.random() < 0.5 ? -enemy.size : canvasHeight + enemy.size;
    } else {
        enemy.x = Math.random() < 0.5 ? -enemy.size : canvasWidth + enemy.size;
        enemy.y = Math.random() * canvasHeight;
    }
}

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
    
    // Queued wave-opening spawns (drip-fed instead of setTimeout, so they cannot
    // leak into a restarted or finished run)
    if (pendingSpawns > 0) {
        spawnTimer += deltaTime;
        if (spawnTimer >= 0.5) {
            spawnEnemy();
            pendingSpawns--;
            spawnTimer = 0;
        }
    }
    
    // Update existing enemies
    enemies.updateAll(deltaTime);
    fragments.updateAll(deltaTime);
    
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
    bossWaveActive = currentWave % 10 === 0;
    spawnTimer = 0;
    enemies.setWave(currentWave);

    if (bossWaveActive) {
        pendingSpawns = 0;
        spawnBoss();
        audio.play('boss_warning');
    } else {
        pendingSpawns = Math.min(3 + currentWave % 4, 8);
    }
    
    showWaveNotice(bossWaveActive ? `BOSS — Wave ${currentWave}` : `Wave ${currentWave}`, bossWaveActive);
    audio.play('wave');
}

function showWaveNotice(text, isBoss) {
    const container = document.getElementById('wave-notice-container');
    if (!container) return;
    const notice = document.createElement('div');
    notice.className = isBoss ? 'wave-notice boss' : 'wave-notice';
    notice.textContent = text;
    container.appendChild(notice);
    setTimeout(() => notice.remove(), 3200);
}

function spawnBoss() {
    const boss = enemies.create('rift_core');
    placeEnemyAtEdge(boss);
    enemiesThisWave++;
}

export function spawnEnemy() {
    if (enemiesThisWave >= maxEnemiesPerWave) return;
    if (bossWaveActive && enemies.getActiveEnemies().some((e) => e.type === 'rift_core')) {
        return;
    }

    let type;
    if (currentWave % 10 === 0 && !enemies.getActiveEnemies().some((e) => e.type === 'rift_core')) {
        spawnBoss();
        return;
    }
    if (currentWave % 5 === 0 && currentWave % 10 !== 0) {
        type = 'rift_warden';
    } else if (currentWave >= 4 && Math.random() < 0.12) {
        type = 'echo_hunter';
    } else if (currentWave >= 3 && Math.random() < 0.28) {
        type = 'null_beast';
    } else if (currentWave >= 2) {
        const types = ['drifter', 'charger', 'shardling'];
        type = types[Math.floor(Math.random() * types.length)];
    } else {
        type = 'drifter';
    }

    if (type === 'shardling') {
        spawnShardlingPack();
        return;
    }

    const enemy = enemies.create(type);
    placeEnemyAtEdge(enemy);
    enemiesThisWave++;
}

function spawnShardlingPack() {
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        if (enemiesThisWave >= maxEnemiesPerWave) break;
        const enemy = enemies.create('shardling');
        placeEnemyAtEdge(enemy);
        enemy.x += (Math.random() - 0.5) * 40;
        enemy.y += (Math.random() - 0.5) * 40;
        enemiesThisWave++;
    }
}

export function checkLevelUp() {
    if (gameState.xp >= gameState.xpRequired) {
        levelUp();
    }
}

export function levelUp() {
    let leveled = false;
    while (gameState.xp >= gameState.xpRequired) {
        gameState.xp -= gameState.xpRequired;
        gameState.level++;
        gameState.highestLevel = Math.max(gameState.highestLevel, gameState.level);
        gameState.xpRequired = Math.floor(gameState.xpRequired * 1.5);
        
        upgradeSystem.addStatPoints(upgradeSystem.levelUpPoints);
        gameState.statPoints = upgradeSystem.getAvailablePoints();
        applyPlayerStats({ healOnLevelUp: true });
        audio.play('level-up');
        leveled = true;
    }
    
    updateLevelDisplay();
    updateXPBar();
    saveGame();

    if (leveled && !gameState.statAllocationOpen) {
        openStatAllocation();
    }
}

export function openStatAllocation() {
    gameState.isPaused = true;
    gameState.statAllocationOpen = true;
    crazyGames.gameplayStop();
    import('./ui.js').then((ui) => ui.openLevelUpStatScreen());
}

export function closeStatAllocation() {
    gameState.statAllocationOpen = false;
    gameState.isPaused = false;
    crazyGames.gameplayStart();
}

export function checkGameOverState() {
    // Check if player HP <= 0
    if (player.hp <= 0) {
        endRun();
    }
}

export function endRun() {
    if (runEnded) return; // Death can be detected from several places in one frame
    runEnded = true;
    gameState.isPaused = true;
    gameState.statAllocationOpen = false;
    
    // Update best stats
    const survivalTime = getRunTime().toFixed(0);
    gameState.bestSurvivalTime = Math.max(gameState.bestSurvivalTime, parseInt(survivalTime));
    
    // Call CrazyGames gameplay stop
    crazyGames.gameplayStop();
    
    // Save best stats before rendering, so the summary shows the record just set
    saveGame();
    
    // Show game over UI
    showGameOverScreen();
}

export function addXP(amount) {
    gameState.xp += amount;
    
    // Update UI
    updateXPBar();
    
    // Check level up immediately
    checkLevelUp();
    
    // Sound
    audio.play('fragment');
}

export function addFragmentCollected(amount = 1) {
    gameState.fragmentsCollected += amount;
    updateUIStats();
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
    return saveSystem.saveData?.settings
        ? { ...saveSystem.saveData.settings }
        : { masterVolume: 0.7, sfxVolume: 0.7, particleQuality: 'medium', screenShake: true };
}

export function saveGameSettings(settings) {
    saveSystem.updateSettings(settings);
}

export function applyGameSettings(settings) {
    if (!settings) return;
    if (settings.masterVolume !== undefined) {
        audio.setMasterVolume(settings.masterVolume);
    }
    if (settings.sfxVolume !== undefined) {
        audio.setSFXVolume(settings.sfxVolume);
    }
    if (settings.particleQuality) {
        setParticleQuality(settings.particleQuality);
    }
    if (settings.screenShake !== undefined) {
        setScreenShakeEnabled(settings.screenShake);
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
    setText('enemies-defeated', gameState.enemiesDefeated);
    setText('fragments-collected', gameState.fragmentsCollected);
    setText('damage-dealt', Math.floor(gameState.damageDealt));
    setText('echo-damage', Math.floor(gameState.echoDamageDealt));
}

// The run summary spans live in the game over panel; cache them and skip
// redundant writes because this runs on every hit.
const textCache = new Map();
function setText(id, value) {
    const key = id;
    if (textCache.get(key) === value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    textCache.set(key, value);
}

export function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${total % 60 < 10 ? '0' : ''}${total % 60}`;
}

export function showGameOverScreen() {
    document.getElementById('game-over').style.display = 'block';
    document.getElementById('pause-menu').style.display = 'none';
    document.getElementById('onboarding').style.display = 'none';
    document.getElementById('settings-panel').style.display = 'none';
    
    // Fill in run summary
    const runTime = getRunTime();
    setText('survival-time', formatTime(runTime));
    setText('enemies-defeated', gameState.enemiesDefeated);
    setText('fragments-collected', gameState.fragmentsCollected);
    setText('level-reached', gameState.level);
    setText('damage-dealt', Math.floor(gameState.damageDealt));
    setText('echo-damage', Math.floor(gameState.echoDamageDealt));
    setText('stat-points-spent', gameState.statPointsSpent);
    
    // saveGame() has already run, so this reflects the record including this run
    const best = saveSystem.saveData.bestTime || gameState.bestSurvivalTime || 0;
    setText('best-survival-time', formatTime(best));
    setText('best-level', saveSystem.saveData.highestLevel || 1);
    
    document.getElementById('final-stats').style.display = 'block';
    document.getElementById('run-summary').style.display = 'block';
    audio.stopBGM();
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
    gameState.secondsSinceStart = 0;
    secondsSinceStart = 0;

    currentWave = 1;
    lastWaveTime = 0;
    enemiesThisWave = 0;
    maxEnemiesPerWave = 5;
    spawnTimer = 0;
    pendingSpawns = 0;
    clearVisualEffects();
    fragments.resetAll();
    bossWaveActive = false;
    runEnded = false;
    gameState.statAllocationOpen = false;
    enemies.setWave(1);
    
    player.reset();
    upgradeSystem.reset();
    applyPlayerStats({ fullHeal: true });
    
    enemies.resetAll();
    
    // Reset echo shift
    echoShift.path = [];
    echoShift.isActive = false;
    echoShift.lastUsed = -999;
    echoShift.duration = player.echoDuration;
    echoShift.cooldown = player.echoCooldown;
    echoShift.damagedEnemies = null;
    echoShift.replayProgress = 0;
    
    // Hide UI
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('pause-menu').style.display = 'none';
    
    // A stat screen left open from the pause menu must not survive the restart
    import('./ui.js').then((ui) => ui.closeStatScreen());
    
    // Show onboarding for first run
    if (!saveSystem.saveData.onboardingCompleted) {
        document.getElementById('onboarding').style.display = 'flex';
    } else {
        // Start gameplay immediately
        gameplayStart();
        showWaveNotice('Wave 1', false);
    }
    
    // Update display
    updateLevelDisplay();
    updateXPBar();
    updateUIStats();
}

export function gameplayStart() {
    if (!gameState) return;
    if (gameState.statAllocationOpen) return;
    gameState.isPaused = false;
    crazyGames.gameplayStart();
    audio.startBGM();
}

export function gameplayStop() {
    if (!gameState) return;
    gameState.isPaused = true;
    crazyGames.gameplayStop();
    audio.stopBGM();
}

export function updateEchoShift(deltaTime) {
    if (!echoShift.isActive) return;

    const path = echoShift.path;
    echoShift.elapsed = (echoShift.elapsed || 0) + deltaTime;
    const progress = Math.min(1, echoShift.elapsed / Math.max(0.001, echoShift.duration));
    echoShift.replayProgress = progress;

    if (path.length < 2 || progress >= 1) {
        finishEchoShift();
        return;
    }

    if (!echoShift.damagedEnemies) echoShift.damagedEnemies = new Set();

    const maxIndex = path.length - 1;
    const floatIndex = Math.min(maxIndex, progress * maxIndex);
    const segIndex = Math.min(maxIndex - 1, Math.floor(floatIndex));
    const segT = floatIndex - segIndex;
    const a = path[segIndex];
    const b = path[segIndex + 1];
    echoShift.replaySegmentIndex = segIndex;
    echoShift.replaySegmentT = segT;
    echoShift.headX = a.x + (b.x - a.x) * segT;
    echoShift.headY = a.y + (b.y - a.y) * segT;

    const echoDamage = player.attackPower * player.echoPower;
    const activeEnemies = enemies.getActiveEnemies();
    const trailRadius = 25;

    // Only the segment currently being swept can deal damage, so the trail
    // travels across the arena instead of hitting everything at once
    for (const enemy of activeEnemies) {
        if (echoShift.damagedEnemies.has(enemy.id)) continue;
        const dist = distPointToSegment(enemy.x, enemy.y, a.x, a.y, b.x, b.y);
        if (dist < enemy.size + trailRadius) {
            enemy.hp -= echoDamage;
            enemy.hitFlashUntil = performance.now() / 1000 + 0.16;
            spawnHit(enemy.x, enemy.y, '#58e8f4', echoDamage, false);
            addEchoDamage(echoDamage);
            echoShift.damagedEnemies.add(enemy.id);
            audio.play('hit');
        }
    }
}

function finishEchoShift() {
    echoShift.isActive = false;
    echoShift.damagedEnemies = null;
    echoShift.elapsed = 0;
    echoShift.replayProgress = 0;
    echoShift.replaySegmentIndex = 0;
    echoShift.replaySegmentT = 0;
}

export function activateEchoShift() {
    const now = getRunTime();
    if (echoShift.lastUsed + echoShift.cooldown > now) {
        // Not ready yet
        return false;
    }
    
    // Freeze current path and activate echo
    echoShift.isActive = true;
    echoShift.startTime = now;
    echoShift.path = player.getMovementPath();
    if (echoShift.path.length < 2) {
        // No trail to replay: do not activate and do not burn the cooldown
        echoShift.isActive = false;
        return false;
    }
    echoShift.elapsed = 0;
    echoShift.replayProgress = 0;
    echoShift.damagedEnemies = new Set();
    echoShift.lastUsed = now;
    audio.play('echo_shift');
    return true;
}

export function applyPlayerStats(options = {}) {
    const stats = upgradeSystem.getStats();
    const previousMax = player.maxHP;

    player.maxHP = stats.hp;
    player.moveSpeed = stats.moveSpeed;
    player.attackPower = stats.attackPower;
    player.attackSpeed = stats.attackSpeed;
    player.attackRange = stats.attackRange;
    player.criticalChance = stats.criticalChance;
    player.criticalDamage = stats.criticalDamage;
    player.echoPower = stats.echoPower;
    player.echoDuration = stats.echoDuration;
    player.echoCooldown = stats.echoCooldown;
    player.hpRegen = stats.hpRegen;
    player.fragmentMagnetRange = stats.fragmentMagnet;

    if (options.fullHeal || options.healOnLevelUp) {
        player.hp = stats.hp;
    } else {
        // Spending a point raises the cap; grant only the new headroom, so a
        // single click never becomes a free full heal.
        player.hp = Math.min(stats.hp, player.hp + Math.max(0, stats.hp - previousMax));
    }

    if (echoShift) {
        echoShift.duration = stats.echoDuration;
        echoShift.cooldown = stats.echoCooldown;
    }
}

// Stat points are spent through the UI, which reports back here
upgradeSystem.onPointSpent = () => {
    if (gameState) gameState.statPointsSpent++;
};

export function loadGame() {
    gameState.highestLevel = Math.max(gameState.highestLevel, saveSystem.saveData.highestLevel || 1);
    gameState.bestSurvivalTime = Math.max(gameState.bestSurvivalTime, saveSystem.saveData.bestTime || 0);
}

export function saveGame() {
    saveSystem.saveData.highestLevel = Math.max(saveSystem.saveData.highestLevel || 1, gameState.highestLevel || 1);
    saveSystem.saveData.bestTime = Math.max(saveSystem.saveData.bestTime || 0, gameState.bestSurvivalTime || 0);
    saveSystem.saveData.bestEnemies = Math.max(saveSystem.saveData.bestEnemies || 0, gameState.enemiesDefeated || 0);
    saveSystem.save();
}
