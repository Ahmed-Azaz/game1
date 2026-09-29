// Enemy system - 7 original enemy types with AI and behaviors
import { player } from './player.js';
import * as game from './game.js';
import * as audio from './audio.js';
import { spawnBurst } from './visual-effects.js';

// Enemy types data
const enemyTemplates = {
    drifter: {
        name: 'Drifter',
        color: '#6c5ce7',
        hp: 20,
        speed: 30,
        damage: 3,
        xp: 15,
        size: 16,
        description: 'Basic enemy - slow, low HP'
    },
    charger: {
        name: 'Charger',
        color: '#ff6b35',
        hp: 35,
        speed: 50,
        damage: 5,
        xp: 25,
        size: 20,
        description: 'Faster enemy - periodically rushes player'
    },
    shardling: {
        name: 'Shardling',
        color: '#78ff9b',
        hp: 10,
        speed: 40,
        damage: 1,
        xp: 10,
        size: 12,
        description: 'Fragile enemy - appears in groups'
    },
    null_beast: {
        name: 'Null Beast',
        color: '#50e3c2',
        hp: 80,
        speed: 20,
        damage: 8,
        xp: 60,
        size: 32,
        description: 'Slow enemy - high HP'
    },
    echo_hunter: {
        name: 'Echo Hunter',
        color: '#00d4ff',
        hp: 40,
        speed: 45,
        damage: 5,
        xp: 35,
        size: 24,
        description: 'Reactes to player\'s Echo - avoids echo paths'
    },
    rift_warden: {
        name: 'Rift Warden',
        color: '#ae81ff',
        hp: 150,
        speed: 35,
        damage: 12,
        xp: 100,
        size: 40,
        description: 'Elite enemy - summons minions'
    },
    rift_core: {
        name: 'Rift Core',
        color: '#ff6b35',
        hp: 500,
        speed: 25,
        damage: 20,
        xp: 300,
        size: 50,
        description: 'Boss enemy - 3 phases with attack patterns'
    }
};

// Active enemies array
let activeEnemies = [];
let enemyIdCounter = 0;

export function create(type) {
    const template = enemyTemplates[type];
    if (!template) {
        // Fallback to drifter
        return create('drifter');
    }
    
    const enemy = {
        id: enemyIdCounter++,
        type,
        template,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        hp: template.hp,
        maxHP: template.hp,
        damage: template.damage,
        xp: template.xp,
        size: template.size,
        color: template.color,
        aiState: 'approach', // approach, rush, flee, summon
        timeSinceAction: 0
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
        const playerRadius = 15;
        if (distToPlayer < enemy.size + playerRadius) {
            const now = performance.now() / 1000;
            if (now - (enemy.lastDamageTime || 0) > 0.5) {
                player.takeDamage(enemy.damage);
                enemy.lastDamageTime = now;
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
            spawnBurst(enemy.x, enemy.y, enemy.color, enemy.type === 'rift_warden' || enemy.type === 'rift_core' ? 24 : 14);
            game.addXP(enemy.xp);
            game.addEnemiesDefeated();
            game.addDamageDealt(enemy.damage * 0.1); // Credit damage
            
            // Sound
            audio.play('enemy_death');
            
            // Drop fragments chance
            if (Math.random() < 0.8) {
                // Fragment handled by XP system
            }
            
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
            enemy.vx = nx * enemy.template.speed;
            enemy.vy = ny * enemy.template.speed;
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
                enemy.vx = nx * enemy.template.speed;
                enemy.vy = ny * enemy.template.speed;
                if (enemy.timeSinceAction > 3.0) { // rush every 3 seconds
                    enemy.aiState = 'rush_windup';
                    enemy.timeSinceAction = 0;
                }
            }
            break;
            
        case 'shardling':
            // Approach in groups - slight wandering
            enemy.vx = nx * enemy.template.speed * (0.5 + Math.random() * 0.5);
            enemy.vy = ny * enemy.template.speed * (0.5 + Math.random() * 0.5);
            // Occasionally change direction
            if (Math.random() < 0.01) {
                enemy.vx = (Math.random() - 0.5) * enemy.template.speed * 2;
                enemy.vy = (Math.random() - 0.5) * enemy.template.speed * 2;
            }
            break;
            
        case 'null_beast':
            // Slow approach, but stays closer to player
            enemy.vx = nx * enemy.template.speed;
            enemy.vy = ny * enemy.template.speed;
            // Don't stray too far
            if (distance > 400) {
                // Push toward center
                enemy.vx = -nx * 50;
                enemy.vy = -ny * 50;
            }
            break;
            
        case 'echo_hunter':
            // Detect echo path and avoid it
            // Simple version: flee from player at medium range
            if (distance > 150 && distance < 400) {
                // Flee from player
                enemy.vx = -nx * enemy.template.speed * 1.5;
                enemy.vy = -ny * enemy.template.speed * 1.5;
            } else {
                // Normal approach
                enemy.vx = nx * enemy.template.speed;
                enemy.vy = ny * enemy.template.speed;
            }
            // Check if echo is active and adjust
            if (game && game.echoShift && game.echoShift.isActive) {
                // Additional avoidance behavior
                const echoPath = game.echoShift.path;
                if (echoPath && echoPath.length > 10) {
                    // Simple: slow down near echo path
                    if (distance < 300) {
                        enemy.vx *= 0.9;
                        enemy.vy *= 0.9;
                    }
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
            enemy.vx = nx * enemy.template.speed;
            enemy.vy = ny * enemy.template.speed;
            break;
            
        case 'rift_core':
            // Boss: complex AI handled in game.js boss encounters
            enemy.vx = nx * enemy.template.speed * 0.5;
            enemy.vy = ny * enemy.template.speed * 0.5;
            break;
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
