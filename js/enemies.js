// Enemy system - 7 original enemy types with AI and behaviors
import { player } from './player.js';
import * as game from './game.js';
import * as audio from './audio.js';
import { spawnBurst, triggerScreenShake } from './visual-effects.js';
import { spawnOrb } from './fragments.js';

// Enemy types data
const enemyTemplates = {
    drifter: {
        name: 'Drifter',
        color: '#6c5ce7',
        hp: 20,
        speed: 30,
        damage: 3,
        xp: 45,
        size: 16,
        description: 'Basic enemy - slow, low HP'
    },
    charger: {
        name: 'Charger',
        color: '#ff6b35',
        hp: 35,
        speed: 50,
        damage: 5,
        xp: 75,
        size: 20,
        description: 'Faster enemy - periodically rushes player'
    },
    shardling: {
        name: 'Shardling',
        color: '#78ff9b',
        hp: 10,
        speed: 300,
        damage: 1,
        xp: 30,
        size: 12,
        description: 'Fragile enemy - appears in groups'
    },
    null_beast: {
        name: 'Null Beast',
        color: '#50e3c2',
        hp: 80,
        speed: 20,
        damage: 8,
        xp: 180,
        size: 32,
        description: 'Slow enemy - high HP'
    },
    echo_hunter: {
        name: 'Echo Hunter',
        color: '#00d4ff',
        hp: 40,
        speed: 45,
        damage: 5,
        xp: 105,
        size: 24,
        description: 'Reactes to player\'s Echo - avoids echo paths'
    },
    rift_warden: {
        name: 'Rift Warden',
        color: '#ae81ff',
        hp: 150,
        speed: 35,
        damage: 12,
        xp: 300,
        size: 40,
        description: 'Elite enemy - summons minions'
    },
    rift_core: {
        name: 'Rift Core',
        color: '#ff6b35',
        hp: 500,
        speed: 25,
        damage: 20,
        xp: 900,
        size: 50,
        description: 'Boss enemy - 3 phases with attack patterns'
    }
};

// Active enemies array
let activeEnemies = [];
let enemyIdCounter = 0;
let currentWave = 1;

// Enemy types that are bosses or elites scale more gently than fodder.
const BOSS_TYPES = new Set(['rift_core', 'rift_warden']);

// Wave scaling: without this, waves only add bodies and the game plateaus once
// the player has a few attack-power points.
function waveScaling(wave, type) {
    const boss = BOSS_TYPES.has(type);
    const steps = Math.max(0, wave - 1);
    return {
        hp: 1 + steps * (boss ? 0.14 : 0.20),
        damage: 1 + steps * 0.055,
        speed: Math.min(1.35, 1 + steps * 0.018),
        xp: 1 + steps * 0.06
    };
}

export function setWave(wave) {
    currentWave = Math.max(1, wave || 1);
}

export function getWave() {
    return currentWave;
}

export function create(type) {
    const template = enemyTemplates[type];
    if (!template) {
        // Fallback to drifter
        return create('drifter');
    }
    
    const scale = waveScaling(currentWave, type);
    const hp = Math.round(template.hp * scale.hp);
    
    const enemy = {
        id: enemyIdCounter++,
        type,
        template,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        hp,
        maxHP: hp,
        damage: template.damage * scale.damage,
        xp: Math.round(template.xp * scale.xp),
        size: template.size,
        color: template.color,
        baseSpeed: template.speed * scale.speed,
        aiState: 'approach', // approach, rush_windup, rushing, flee, summon
        timeSinceAction: Math.random() * 2,
        lastDamageTime: -Infinity
    };
    
    activeEnemies.push(enemy);
    return enemy;
}

export function resetAll() {
    activeEnemies = [];
    enemyIdCounter = 0;
}

export function updateAll(deltaTime) {
    // Update all active enemies
    for (let i = activeEnemies.length - 1; i >= 0; i--) {
        const enemy = activeEnemies[i];
        
        // AI behavior
        updateEnemyAI(enemy, deltaTime);
        
        // Move enemy
        enemy.x += enemy.vx * deltaTime;
        enemy.y += enemy.vy * deltaTime;
        
        // Contact damage
        const distToPlayer = Math.hypot(player.x - enemy.x, player.y - enemy.y);
        const playerRadius = player.radius || 15;
        if (distToPlayer < enemy.size + playerRadius) {
            const now = performance.now() / 1000;
            if (now - enemy.lastDamageTime > 0.5) {
                player.takeDamage(enemy.damage);
                enemy.lastDamageTime = now;
                // Small shove so the player is never pinned inside a body
                if (distToPlayer > 0.01) {
                    const shove = 60;
                    enemy.x -= ((player.x - enemy.x) / distToPlayer) * shove;
                    enemy.y -= ((player.y - enemy.y) / distToPlayer) * shove;
                }
            }
        }
        
        // Keep within arena
        const margin = 50;
        enemy.x = Math.max(margin, Math.min(game.canvasWidth - margin, enemy.x));
        enemy.y = Math.max(margin, Math.min(game.canvasHeight - margin, enemy.y));
        
        // Check if out of screen (despawn)
        if (isOffScreen(enemy)) {
            activeEnemies.splice(i, 1);
        }
    }
    
    // Remove enemies with 0 HP
    for (let i = activeEnemies.length - 1; i >= 0; i--) {
        if (activeEnemies[i].hp <= 0) {
            const enemy = activeEnemies[i];
            const isBoss = enemy.type === 'rift_warden' || enemy.type === 'rift_core';
            spawnBurst(enemy.x, enemy.y, enemy.color, isBoss ? 24 : 14);
            if (isBoss) triggerScreenShake(8, 0.25);
            game.addEnemiesDefeated();
            spawnOrb(enemy.x, enemy.y, enemy.xp);
            if (Math.random() < 0.35) {
                spawnOrb(enemy.x + (Math.random() - 0.5) * 24, enemy.y + (Math.random() - 0.5) * 24, Math.max(5, Math.floor(enemy.xp * 0.5)));
            }
            audio.play('enemy_death');
            
            activeEnemies.splice(i, 1);
        }
    }
}

function updateEnemyAI(enemy, deltaTime) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Normalize
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : 0;
    
    // Different AI behaviors based on enemy type
    switch (enemy.type) {
        case 'drifter':
            // Simple approach
            enemy.vx = nx * enemy.baseSpeed;
            enemy.vy = ny * enemy.baseSpeed;
            break;
            
        case 'charger':
            // Approach normally, but periodically rush
            if (enemy.aiState === 'rush_windup') {
                enemy.timeSinceAction += deltaTime;
                enemy.vx = 0;
                enemy.vy = 0;
                if (enemy.timeSinceAction > 0.5) {
                    enemy.aiState = 'rushing';
                    enemy.timeSinceAction = 0;
                    // Lock direction
                    enemy.rushDx = nx;
                    enemy.rushDy = ny;
                }
            } else if (enemy.aiState === 'rushing') {
                enemy.timeSinceAction += deltaTime;
                const rushSpeed = 200;
                enemy.vx = enemy.rushDx * rushSpeed;
                enemy.vy = enemy.rushDy * rushSpeed;
                if (enemy.timeSinceAction > 1.0) { // rush for 1s
                    enemy.aiState = 'approach';
                    enemy.timeSinceAction = 0;
                }
            } else {
                enemy.timeSinceAction += deltaTime;
                enemy.vx = nx * enemy.baseSpeed;
                enemy.vy = ny * enemy.baseSpeed;
                if (enemy.timeSinceAction > 3.0) { // rush every 3 seconds
                    enemy.aiState = 'rush_windup';
                    enemy.timeSinceAction = 0;
                }
            }
            break;
            
        case 'shardling':
            // Approach in groups - slight wandering
            enemy.vx = nx * enemy.baseSpeed * (0.5 + Math.random() * 0.5);
            enemy.vy = ny * enemy.baseSpeed * (0.5 + Math.random() * 0.5);
            // Occasionally change direction
            if (Math.random() < 0.01) {
                enemy.vx = (Math.random() - 0.5) * enemy.baseSpeed * 2;
                enemy.vy = (Math.random() - 0.5) * enemy.baseSpeed * 2;
            }
            break;
            
        case 'null_beast':
            // Slow approach, but stays closer to player
            enemy.vx = nx * enemy.baseSpeed;
            enemy.vy = ny * enemy.baseSpeed;
            // Don't stray too far
            if (distance > 400) {
                // Push toward center
                enemy.vx = -nx * 50;
                enemy.vy = -ny * 50;
            }
            break;
            
        case 'echo_hunter':
            // Flees the player at mid range and actively dodges the live echo trail
            if (distance > 150 && distance < 400) {
                // Flee from player
                enemy.vx = -nx * enemy.baseSpeed * 1.5;
                enemy.vy = -ny * enemy.baseSpeed * 1.5;
            } else {
                // Normal approach
                enemy.vx = nx * enemy.baseSpeed;
                enemy.vy = ny * enemy.baseSpeed;
            }
            if (game.echoShift?.isActive) {
                const dodge = dodgeVectorFromEcho(enemy);
                if (dodge) {
                    enemy.vx += dodge.x * enemy.baseSpeed * 1.8;
                    enemy.vy += dodge.y * enemy.baseSpeed * 1.8;
                }
            }
            break;
            
        case 'rift_warden':
            // Elite: approach + summon minions every 10 seconds
            enemy.timeSinceAction += deltaTime;
            if (enemy.timeSinceAction > 10) {
                // Summon a drifter minion
                const minion = create('drifter');
                minion.x = enemy.x + (Math.random() - 0.5) * 100;
                minion.y = enemy.y + (Math.random() - 0.5) * 100;
                enemy.timeSinceAction = 0;
            }
            // Approach player
            enemy.vx = nx * enemy.baseSpeed;
            enemy.vy = ny * enemy.baseSpeed;
            break;
            
        case 'rift_core':
            updateRiftCoreBoss(enemy, deltaTime, nx, ny, distance);
            break;
    }
}

// Steering vector pushing an enemy away from the part of the echo trail that
// has already been swept (plus the head), so hunters dodge the live damage.
function dodgeVectorFromEcho(enemy) {
    const echo = game.echoShift;
    const path = echo.path;
    if (!path || path.length < 2) return null;

    const samples = [echo.headX, echo.headY];
    for (let i = Math.max(0, echo.replaySegmentIndex - 12); i <= Math.min(path.length - 1, echo.replaySegmentIndex); i++) {
        samples.push(path[i].x, path[i].y);
    }

    let pushX = 0;
    let pushY = 0;
    let hits = 0;
    for (let i = 0; i < samples.length; i += 2) {
        const dx = enemy.x - samples[i];
        const dy = enemy.y - samples[i + 1];
        const d = Math.hypot(dx, dy);
        if (d < 70 && d > 0.01) {
            pushX += dx / d;
            pushY += dy / d;
            hits++;
        }
    }
    if (!hits) return null;
    const len = Math.hypot(pushX, pushY) || 1;
    return { x: pushX / len, y: pushY / len };
}

function updateRiftCoreBoss(enemy, deltaTime, nx, ny, distance) {
    const hpRatio = enemy.hp / enemy.maxHP;
    if (!enemy.phaseTriggered) enemy.phaseTriggered = {};
    if (hpRatio <= 0.66 && !enemy.phaseTriggered.p66) {
        enemy.phaseTriggered.p66 = true;
        audio.play('boss_warning');
        triggerScreenShake(7, 0.3);
        for (let i = 0; i < 3; i++) {
            const minion = create('drifter');
            minion.x = enemy.x + (Math.random() - 0.5) * 80;
            minion.y = enemy.y + (Math.random() - 0.5) * 80;
        }
    }
    if (hpRatio <= 0.33 && !enemy.phaseTriggered.p33) {
        enemy.phaseTriggered.p33 = true;
        audio.play('boss_warning');
        enemy.phaseSpeed = 1.45; // per-enemy, the shared template must stay clean
    }
    const speed = enemy.baseSpeed * (hpRatio < 0.33 ? (enemy.phaseSpeed || 1.2) : 0.55);
    enemy.vx = nx * speed;
    enemy.vy = ny * speed;
    if (distance < 120) {
        enemy.vx *= 0.85;
        enemy.vy *= 0.85;
    }
}

function isOffScreen(enemy) {
    // Check if enemy is far from player and not engaging
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance > 800; // Despawn if too far
}

export function getActiveEnemies() {
    return activeEnemies;
}

// Get enemy by type for stats
export function getEnemyCountByType(type) {
    let count = 0;
    for (const enemy of activeEnemies) {
        if (enemy.type === type) count++;
    }
    return count;
}
