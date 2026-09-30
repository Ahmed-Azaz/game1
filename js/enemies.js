// Enemy system - 7 enemy types with AI and behaviours
import { player } from './player.js';
import * as game from './game.js';
import * as audio from './audio.js';
import * as projectiles from './projectiles.js';
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
        description: 'Orbits at range and commits when you stand still'
    },
    charger: {
        name: 'Charger',
        color: '#ff6b35',
        hp: 35,
        speed: 50,
        damage: 5,
        xp: 75,
        size: 20,
        description: 'Rushes on a locked line, stunned by walls, ends in a shockwave'
    },
    shardling: {
        name: 'Shardling',
        color: '#78ff9b',
        hp: 10,
        speed: 200,
        damage: 1,
        xp: 30,
        size: 12,
        description: 'Fragile swarm - bursts into shards when killed'
    },
    null_beast: {
        name: 'Null Beast',
        color: '#50e3c2',
        hp: 80,
        speed: 20,
        damage: 8,
        xp: 180,
        size: 32,
        description: 'Drags you in with a gravity well and lobs homing orbs'
    },
    echo_hunter: {
        name: 'Echo Hunter',
        color: '#00d4ff',
        hp: 40,
        speed: 45,
        damage: 5,
        xp: 105,
        size: 24,
        description: 'Phases through Echo walls and shoots bolts they erase',
        // The one body the wall cannot stop, so its counter-play stays honest
        phasesThroughEcho: true
    },
    rift_warden: {
        name: 'Rift Warden',
        color: '#ae81ff',
        hp: 150,
        speed: 35,
        damage: 12,
        xp: 300,
        size: 40,
        description: 'Elite - caps its minions and fires a charged Rift Lance'
    },
    rift_core: {
        name: 'Rift Core',
        color: '#ff6b35',
        hp: 500,
        speed: 25,
        damage: 20,
        xp: 900,
        size: 50,
        description: 'Boss - radial bursts, sweeping beam, spiral barrage'
    }
};

// Active enemies array
let activeEnemies = [];
let enemyIdCounter = 0;
let currentWave = 1;

// Deep Cut slow multiplier
const DEEP_CUT_SLOW = 0.6;

// Enemy types that are bosses or elites scale more gently than fodder.
const BOSS_TYPES = new Set(['rift_core', 'rift_warden']);

// Bodies push each other apart so a pack surrounds you instead of collapsing
// into one overlapping blob
const SEPARATION_FORCE = 1.6;

// Arena clamp, shared with the charger wall-stun check
const ARENA_MARGIN = 50;

// Drifter: the ring it tries to hold, and the speed it needs to match
const DRIFTER_ORBIT_RADIUS = 110;
const DRIFTER_ORBIT_SPEED = 1.1;
// Waves before drifters start throwing bolts at all
const DRIFTER_BOLT_WAVE = 6;

// Charger: rush tuning. The direction is locked at windup START so the
// telegraph on screen is the line it will actually take.
const CHARGER_RUSH_WINDUP = 0.5;
const CHARGER_RUSH_TIME = 1.0;
const CHARGER_RUSH_SPEED = 200;
const CHARGER_RUSH_COOLDOWN = 3.0;
const CHARGER_WALL_STUN = 1.0;
const CHARGER_SHOCKWAVE_RADIUS = 90;

// Shardling death burst
const SHARDLING_BURST_COUNT = 3;
const SHARDLING_BURST_SPEED = 90;
const SHARDLING_BURST_LIFE = 1.2;

// Null Beast gravity well: how far it reaches and how hard it pulls
const NULL_WELL_RADIUS = 260;
const NULL_WELL_PULL = 34;

// Rift Warden: it stops summoning at this many live minions
const WARDEN_MINION_CAP = 6;
const WARDEN_SUMMON_EVERY = 10;
const WARDEN_LANCE_EVERY = 6;
const WARDEN_LANCE_CHARGE = 1.0;

// Rift Core phase timings
const CORE_BURST_EVERY = 3.5;
const CORE_ORB_EVERY = 4.0;
const CORE_SPIRAL_EVERY = 0.18;

// Echo Hunter fires into your Echo on purpose: the bolts exist to be erased
const HUNTER_BOLT_EVERY = 3.2;

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
        aiState: 'approach', // approach, rush_windup, rushing, stunned, summon
        timeSinceAction: Math.random() * 2,
        lastDamageTime: -Infinity,
        // Perk state, all timestamp based so they lapse on their own
        markedRangeUntil: 0,
        markedEchoUntil: 0,
        slowUntil: 0,
        perkKillHandled: false,
        // Abilities, all driven off one timer per enemy
        abilityTimer: Math.random() * 2,
        orbitDir: Math.random() < 0.5 ? -1 : 1,
        insideEchoWall: false,
        blockedByEcho: false,
        stunUntil: 0,
        isMinion: false,
        phasesThroughEcho: !!template.phasesThroughEcho
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

        // Deep Cut: a slowed enemy keeps the reduced pace the AI gave it, so the
        // slow survives the type's own speed maths
        if (enemy.slowUntil > performance.now() / 1000) {
            enemy.vx *= DEEP_CUT_SLOW;
            enemy.vy *= DEEP_CUT_SLOW;
        }

        // Packs spread instead of stacking into a single body
        applySeparation(enemy);

        // Move enemy
        enemy.x += enemy.vx * deltaTime;
        enemy.y += enemy.vy * deltaTime;

        // The standing Echo line is solid: bodies stop here instead of walking
        // through it, and slide along the wall rather than sticking to it.
        // An Echo Hunter is the exception: it phases through, slower.
        if (enemy.phasesThroughEcho) {
            enemy.insideEchoWall = game.isInsideEchoWall(enemy.x, enemy.y, enemy.size);
            enemy.blockedByEcho = false;
        } else {
            enemy.insideEchoWall = false;
            enemy.blockedByEcho = game.applyEchoBarrier(enemy);
        }

        // Contact damage
        const distToPlayer = Math.hypot(player.x - enemy.x, player.y - enemy.y);
        const playerRadius = player.radius || 15;
        if (distToPlayer < enemy.size + playerRadius) {
            const now = performance.now() / 1000;
            if (now - enemy.lastDamageTime > 0.5) {
                player.takeDamage(enemy.damage, 'contact');
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
        const atWall = enemy.x <= ARENA_MARGIN + 1 || enemy.x >= game.canvasWidth - ARENA_MARGIN - 1
            || enemy.y <= ARENA_MARGIN + 1 || enemy.y >= game.canvasHeight - ARENA_MARGIN - 1;
        enemy.x = Math.max(ARENA_MARGIN, Math.min(game.canvasWidth - ARENA_MARGIN, enemy.x));
        enemy.y = Math.max(ARENA_MARGIN, Math.min(game.canvasHeight - ARENA_MARGIN, enemy.y));

        // A charger that slams into the arena wall is stunned, giving the player
        // a real punish window instead of a free hit. The wall slam is also
        // what produces the shockwave, so a wall-stunned charger still threatens
        // the area it stopped in.
        if (enemy.aiState === 'rushing' && atWall) {
            enemy.aiState = 'stunned';
            enemy.stunUntil = performance.now() / 1000 + CHARGER_WALL_STUN;
            enemy.vx = 0;
            enemy.vy = 0;
            spawnShockwave(enemy);
        }

        // Check if out of screen (despawn)
        if (isOffScreen(enemy)) {
            game.releaseWaveEnemySlot();
            activeEnemies.splice(i, 1);
        }
    }

    // Gravity wells act on the player after every body has moved, so the pull
    // is consistent no matter which enemy applied it
    applyGravityWells(deltaTime);

    // Remove enemies with 0 HP
    for (let i = activeEnemies.length - 1; i >= 0; i--) {
        if (activeEnemies[i].hp <= 0) {
            const enemy = activeEnemies[i];
            const isBoss = enemy.type === 'rift_warden' || enemy.type === 'rift_core';
            spawnBurst(enemy.x, enemy.y, enemy.color, isBoss ? 24 : 14);
            if (enemy.type === 'shardling') spawnShardBurst(enemy);
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

// Push apart from anything too close, weighted by how much the bodies overlap
function applySeparation(enemy) {
    let pushX = 0;
    let pushY = 0;
    for (let i = 0; i < activeEnemies.length; i++) {
        const other = activeEnemies[i];
        if (other === enemy || other.hp <= 0) continue;
        const dx = enemy.x - other.x;
        const dy = enemy.y - other.y;
        const minDist = enemy.size + other.size;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist || distSq < 0.0001) continue;
        const dist = Math.sqrt(distSq);
        const overlap = (minDist - dist) / minDist;
        pushX += (dx / dist) * overlap;
        pushY += (dy / dist) * overlap;
    }
    if (pushX === 0 && pushY === 0) return;
    const force = SEPARATION_FORCE * enemy.baseSpeed;
    enemy.vx += pushX * force;
    enemy.vy += pushY * force;
}

// Null Beasts drag the player in, so the tank is a positional threat instead of
// a slow body you simply walk around. Nudges position directly, the same way the
// contact shove does.
function applyGravityWells(deltaTime) {
    for (const enemy of activeEnemies) {
        if (enemy.hp <= 0 || enemy.type !== 'null_beast') continue;
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1 || dist > NULL_WELL_RADIUS) continue;
        // Falls off toward the edge of its reach so the pull never yanks you in
        const strength = (1 - dist / NULL_WELL_RADIUS) * NULL_WELL_PULL * deltaTime;
        player.x += (dx / dist) * strength;
        player.y += (dy / dist) * strength;
    }
}

// Shardlings leave shards behind, so dying next to one is still a trade
function spawnShardBurst(enemy) {
    for (let i = 0; i < SHARDLING_BURST_COUNT; i++) {
        const angle = (i / SHARDLING_BURST_COUNT) * Math.PI * 2 + Math.random() * 0.6;
        projectiles.spawn({
            x: enemy.x,
            y: enemy.y,
            angle,
            speed: SHARDLING_BURST_SPEED,
            damage: enemy.damage,
            radius: 4,
            life: SHARDLING_BURST_LIFE,
            color: enemy.color,
            size: 4
        });
    }
}

function updateEnemyAI(enemy, deltaTime) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Normalize
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : 0;

    // One timer for every off-cycle ability, so nothing can starve
    enemy.abilityTimer -= deltaTime;
    // Accumulated simulated time, not performance.now(): abilities that read a
    // clock have to behave the same at 30fps and 144fps
    enemy.aiClock = (enemy.aiClock || 0) + deltaTime;

    // Different AI behaviors based on enemy type
    switch (enemy.type) {
        case 'drifter':
            updateDrifter(enemy, deltaTime, nx, ny, distance);
            break;

        case 'charger':
            updateCharger(enemy, deltaTime, nx, ny, distance);
            break;

        case 'shardling':
            updateShardling(enemy, deltaTime, nx, ny);
            break;

        case 'null_beast':
            updateNullBeast(enemy, deltaTime, nx, ny, distance);
            break;

        case 'echo_hunter':
            updateEchoHunter(enemy, deltaTime, nx, ny, distance);
            break;

        case 'rift_warden':
            updateRiftWarden(enemy, deltaTime, nx, ny);
            break;

        case 'rift_core':
            updateRiftCoreBoss(enemy, deltaTime, nx, ny, distance);
            break;
    }

    // Phasing through the Echo wall costs speed, so it is an escape hatch rather
    // than a free pass
    if (enemy.insideEchoWall) {
        enemy.vx *= 0.4;
        enemy.vy *= 0.4;
    }
}

// Drifter: holds a ring around the player instead of walking straight in, and
// commits to a real approach whenever the player stops moving, so camping is
// still punished.
function updateDrifter(enemy, deltaTime, nx, ny, distance) {
    const playerSpeed = Math.hypot(player.vx, player.vy);
    const committed = distance < 80 || playerSpeed < 25;

    if (committed) {
        enemy.vx = nx * enemy.baseSpeed;
        enemy.vy = ny * enemy.baseSpeed;
    } else if (distance > DRIFTER_ORBIT_RADIUS + 40) {
        // Close the gap to the ring first
        enemy.vx = nx * enemy.baseSpeed;
        enemy.vy = ny * enemy.baseSpeed;
    } else {
        // Strafe around the player, drifting gently inward
        const tangentX = -ny * enemy.orbitDir;
        const tangentY = nx * enemy.orbitDir;
        const inward = distance > DRIFTER_ORBIT_RADIUS ? 0.35 : -0.25;
        enemy.vx = (tangentX * DRIFTER_ORBIT_SPEED + nx * inward) * enemy.baseSpeed;
        enemy.vy = (tangentY * DRIFTER_ORBIT_SPEED + ny * inward) * enemy.baseSpeed;
    }

    // From wave 6 the cheapest enemy in the game starts throwing
    if (currentWave >= DRIFTER_BOLT_WAVE && enemy.abilityTimer <= 0
        && distance > 140 && distance < 460) {
        enemy.abilityTimer = 3.5;
        projectiles.spawn({
            x: enemy.x,
            y: enemy.y,
            angle: Math.atan2(ny, nx),
            speed: 130,
            damage: enemy.damage * 0.6,
            radius: 5,
            life: 3,
            color: enemy.color,
            size: 5
        });
    }
}

// Charger: the rush line is locked when the windup starts, so what the telegraph
// shows is what it commits to. Slamming a wall stuns it, and ending the rush
// leaves a shockwave that reaches you from outside body range.
function updateCharger(enemy, deltaTime, nx, ny, distance) {
    const now = performance.now() / 1000;

    if (enemy.aiState === 'stunned') {
        enemy.vx = 0;
        enemy.vy = 0;
        if (now >= enemy.stunUntil) {
            enemy.aiState = 'approach';
            enemy.timeSinceAction = 0;
        }
        return;
    }

    enemy.timeSinceAction += deltaTime;

    if (enemy.aiState === 'rush_windup') {
        enemy.vx = 0;
        enemy.vy = 0;
        if (enemy.timeSinceAction > CHARGER_RUSH_WINDUP) {
            enemy.aiState = 'rushing';
            enemy.timeSinceAction = 0;
        }
        return;
    }

    if (enemy.aiState === 'rushing') {
        enemy.vx = enemy.rushDx * CHARGER_RUSH_SPEED;
        enemy.vy = enemy.rushDy * CHARGER_RUSH_SPEED;
        if (enemy.timeSinceAction > CHARGER_RUSH_TIME) {
            enemy.aiState = 'approach';
            enemy.timeSinceAction = 0;
            spawnShockwave(enemy);
        }
        return;
    }

    enemy.vx = nx * enemy.baseSpeed;
    enemy.vy = ny * enemy.baseSpeed;
    if (enemy.timeSinceAction > CHARGER_RUSH_COOLDOWN) {
        enemy.aiState = 'rush_windup';
        enemy.timeSinceAction = 0;
        // Lock the line now, not when the rush begins: the telegraph has to be
        // the line it actually takes, otherwise the windup cannot be read
        enemy.rushDx = nx;
        enemy.rushDy = ny;
    }
}

function spawnShockwave(enemy) {
    projectiles.spawn({
        kind: 'shockwave',
        x: enemy.x,
        y: enemy.y,
        angle: 0,
        speed: 0,
        damage: enemy.damage,
        radius: 8,
        radiusGrow: 190,
        maxRadius: CHARGER_SHOCKWAVE_RADIUS,
        life: 1,
        color: enemy.color,
        size: 6
    });
    triggerScreenShake(3, 0.12);
}

// Shardling: swarm cohesion instead of per-frame randomness. The wander used to
// re-roll every frame, so it jittered three times harder at 30fps than 144fps.
// The speed wobble now reads accumulated simulation time, which makes it
// identical at any frame rate.
function updateShardling(enemy, deltaTime, nx, ny) {
    let cohX = 0;
    let cohY = 0;
    for (const other of activeEnemies) {
        if (other === enemy || other.hp <= 0 || other.type !== 'shardling') continue;
        const dx = enemy.x - other.x;
        const dy = enemy.y - other.y;
        const d = Math.hypot(dx, dy);
        if (d < 160 && d > 0.01) {
            cohX += (dx / d) * (1 - d / 160);
            cohY += (dy / d) * (1 - d / 160);
        }
    }

    const speedJitter = 0.75 + 0.25 * Math.sin(enemy.aiClock * 4.5 + enemy.id);
    // Assigned directly rather than eased toward: the jitter is a slow sine, so
    // the target barely changes between frames, and an easing limit would make
    // the swarm converge faster at low frame rates than at high ones.
    enemy.vx = nx * enemy.baseSpeed * speedJitter + cohX * enemy.baseSpeed * 0.5;
    enemy.vy = ny * enemy.baseSpeed * speedJitter + cohY * enemy.baseSpeed * 0.5;
}

// Null Beast: closes hard when it has fallen behind (the old code pushed it
// AWAY when it was too far, despite the comment saying the opposite), drags the
// player in with its well, and lobs a slow homing orb.
function updateNullBeast(enemy, deltaTime, nx, ny, distance) {
    const catchUp = distance > 400 ? 1.6 : 1;
    enemy.vx = nx * enemy.baseSpeed * catchUp;
    enemy.vy = ny * enemy.baseSpeed * catchUp;

    if (enemy.abilityTimer <= 0 && distance > 120 && distance < 420) {
        enemy.abilityTimer = 5;
        projectiles.spawn({
            x: enemy.x,
            y: enemy.y,
            angle: Math.atan2(player.y - enemy.y, player.x - enemy.x),
            speed: 90,
            damage: enemy.damage * 0.6,
            radius: 7,
            life: 5,
            homing: 1.6,
            color: enemy.color,
            size: 8
        });
    }
}

// Echo Hunter: keeps its mid-range flee and its dodge of the drawing trail, but
// now that the trail is a wall it can also phase through it. Its bolts are the
// ones the wall erases, which is what makes the wall worth standing behind.
function updateEchoHunter(enemy, deltaTime, nx, ny, distance) {
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

    if (enemy.abilityTimer <= 0 && distance > 120 && distance < 420) {
        enemy.abilityTimer = HUNTER_BOLT_EVERY;
        projectiles.spawn({
            x: enemy.x,
            y: enemy.y,
            angle: Math.atan2(player.y - enemy.y, player.x - enemy.x),
            speed: 170,
            damage: enemy.damage * 0.8,
            radius: 5,
            life: 3,
            color: enemy.color,
            size: 5
        });
    }
}

// Rift Warden: summons stop at a live cap instead of growing forever, the roster
// widens with the wave, and a charged lance gives it reach beyond body range.
function updateRiftWarden(enemy, deltaTime, nx, ny) {
    enemy.vx = nx * enemy.baseSpeed;
    enemy.vy = ny * enemy.baseSpeed;

    enemy.timeSinceAction += deltaTime;
    if (enemy.timeSinceAction > WARDEN_SUMMON_EVERY && liveMinions() < WARDEN_MINION_CAP) {
        enemy.timeSinceAction = 0;
        summonMinions(enemy);
    }

    // Lance: charge, then fire along the locked line
    if (enemy.lanceState === 'charging') {
        enemy.vx *= 0.4;
        enemy.vy *= 0.4;
        enemy.lanceCharge -= deltaTime;
        if (enemy.lanceCharge <= 0) {
            enemy.lanceState = 'firing';
            enemy.lanceCharge = 0;
            enemy.timeSinceAction = 0;
            projectiles.spawn({
                x: enemy.x,
                y: enemy.y,
                angle: enemy.lanceAngle,
                speed: 260,
                damage: enemy.damage * 0.85,
                radius: 6,
                life: 2.5,
                pierce: true,
                color: enemy.color,
                size: 8
            });
        }
        return;
    }
    if (enemy.lanceState === 'firing') {
        enemy.vx *= 0.5;
        enemy.vy *= 0.5;
        enemy.timeSinceAction += deltaTime;
        if (enemy.timeSinceAction > 1.4) {
            enemy.lanceState = 'idle';
            enemy.timeSinceAction = 0;
        }
        return;
    }
    if (enemy.abilityTimer <= 0) {
        enemy.abilityTimer = WARDEN_LANCE_EVERY;
        enemy.lanceState = 'charging';
        enemy.lanceCharge = WARDEN_LANCE_CHARGE;
        enemy.lanceAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    }
}

// Every live minion across all wardens, so several wardens cannot each summon
// their way past the cap
function liveMinions() {
    let n = 0;
    for (const enemy of activeEnemies) {
        if (enemy.isMinion && enemy.hp > 0) n++;
    }
    return n;
}

function summonMinions(enemy) {
    const roster = currentWave >= 6 ? ['shardling', 'drifter', 'null_beast']
        : currentWave >= 3 ? ['shardling', 'drifter', 'drifter']
            : ['drifter'];
    // The cap has to be applied per minion, not per wave of summons, or a
    // group of three walks straight past it
    const room = Math.max(0, WARDEN_MINION_CAP - liveMinions());
    const count = Math.min(room, 2 + Math.floor(Math.random() * 2));
    for (let i = 0; i < count; i++) {
        const minion = create(roster[Math.floor(Math.random() * roster.length)]);
        minion.isMinion = true;
        minion.x = enemy.x + (Math.random() - 0.5) * 100;
        minion.y = enemy.y + (Math.random() - 0.5) * 100;
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

// Rift Core: three phases with actual attack patterns, which is what the
// template always promised. Phase 1 fans projectiles, phase 2 adds homing orbs
// and a sweeping beam, phase 3 blinks and spirals. Every projectile is 'ranged',
// so Juggernaut does not discount any of it.
function updateRiftCoreBoss(enemy, deltaTime, nx, ny, distance) {
    const hpRatio = enemy.hp / enemy.maxHP;
    if (!enemy.phaseTriggered) enemy.phaseTriggered = {};
    if (enemy.spiralAngle === undefined) {
        enemy.spiralAngle = 0;
        enemy.spiralTimer = 0;
    }

    if (hpRatio <= 0.66 && !enemy.phaseTriggered.p66) {
        enemy.phaseTriggered.p66 = true;
        enterBossPhase(enemy, 2);
        for (let i = 0; i < 3; i++) {
            const minion = create('drifter');
            minion.isMinion = true;
            minion.x = enemy.x + (Math.random() - 0.5) * 80;
            minion.y = enemy.y + (Math.random() - 0.5) * 80;
        }
    }
    if (hpRatio <= 0.33 && !enemy.phaseTriggered.p33) {
        enemy.phaseTriggered.p33 = true;
        enterBossPhase(enemy, 3);
        // Shardlings instead of drifters: the last phase punishes you for
        // standing still, because dying next to one bursts shards outward
        for (let i = 0; i < 2; i++) {
            const minion = create('shardling');
            minion.isMinion = true;
            minion.x = enemy.x + (Math.random() - 0.5) * 80;
            minion.y = enemy.y + (Math.random() - 0.5) * 80;
        }
    }

    // A blink moved the boss, so the direction computed before the phase change
    // points at empty space now: steer next frame instead
    if (enemy.blinkedThisFrame) {
        enemy.blinkedThisFrame = false;
        enemy.vx = 0;
        enemy.vy = 0;
        return;
    }

    const phase = hpRatio < 0.33 ? 3 : hpRatio < 0.66 ? 2 : 1;
    const speed = enemy.baseSpeed * (phase === 3 ? (enemy.phaseSpeed || 1.45) : phase === 2 ? 0.8 : 0.55);
    enemy.vx = nx * speed;
    enemy.vy = ny * speed;
    if (distance < 120) {
        enemy.vx *= 0.85;
        enemy.vy *= 0.85;
    }

    // Phase 1 and up: radial burst
    if (phase >= 1 && enemy.abilityTimer <= 0) {
        enemy.abilityTimer = phase === 3 ? CORE_BURST_EVERY * 0.7 : CORE_BURST_EVERY;
        fireRadialBurst(enemy, phase === 3 ? 10 : 8, 110);
    }

    // Phase 2 and up: homing orbs and a sweeping beam
    if (phase >= 2) {
        if (enemy.orbTimer === undefined) enemy.orbTimer = CORE_ORB_EVERY;
        enemy.orbTimer -= deltaTime;
        if (enemy.orbTimer <= 0) {
            enemy.orbTimer = CORE_ORB_EVERY;
            for (let i = 0; i < 3; i++) {
                projectiles.spawn({
                    x: enemy.x,
                    y: enemy.y,
                    angle: Math.atan2(player.y - enemy.y, player.x - enemy.x) + (i - 1) * 0.7,
                    speed: 80,
                    damage: enemy.damage * 0.35,
                    radius: 7,
                    life: 5,
                    homing: 1.2,
                    color: '#ffb347',
                    size: 8
                });
            }
        }
        if (enemy.beamTimer === undefined) enemy.beamTimer = CORE_BURST_EVERY;
        enemy.beamTimer -= deltaTime;
        if (enemy.beamTimer <= 0) {
            enemy.beamTimer = phase === 3 ? 4.5 : 7;
            projectiles.spawnBeam({
                x: enemy.x,
                y: enemy.y,
                angle: Math.atan2(player.y - enemy.y, player.x - enemy.x),
                sweepRate: phase === 3 ? 1.1 : 0.7,
                length: 1000,
                width: 18,
                damage: enemy.damage * 0.7,
                life: 3,
                chargeTime: 0.6,
                color: enemy.color
            });
        }
    }

    // Phase 3 only: a rotating spiral, which is the pattern that actually forces
    // you to keep moving instead of orbiting at a comfortable distance
    if (phase === 3) {
        enemy.spiralTimer -= deltaTime;
        enemy.spiralAngle += 2.2 * deltaTime;
        if (enemy.spiralTimer <= 0) {
            enemy.spiralTimer = CORE_SPIRAL_EVERY;
            for (let i = 0; i < 2; i++) {
                projectiles.spawn({
                    x: enemy.x,
                    y: enemy.y,
                    angle: enemy.spiralAngle + i * Math.PI,
                    speed: 130,
                    damage: enemy.damage * 0.25,
                    radius: 6,
                    life: 4,
                    color: '#ff8b5e',
                    size: 6
                });
            }
        }
    }
}

function fireRadialBurst(enemy, count, speed) {
    const offset = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
        projectiles.spawn({
            x: enemy.x,
            y: enemy.y,
            angle: offset + (i / count) * Math.PI * 2,
            speed,
            damage: enemy.damage * 0.35,
            radius: 7,
            life: 4,
            color: enemy.color,
            size: 7
        });
    }
}

function enterBossPhase(enemy, phase) {
    audio.play('boss_warning');
    triggerScreenShake(7, 0.3);
    enemy.phase = phase;
    enemy.phaseSpeed = phase === 3 ? 1.45 : 1.2;
    // Blink away from where the player is standing, so a phase change can never
    // drop the boss on top of them
    const angle = Math.random() * Math.PI * 2;
    const distance = 220;
    enemy.x = Math.max(ARENA_MARGIN + 20,
        Math.min(game.canvasWidth - ARENA_MARGIN - 20,
            player.x + Math.cos(angle) * distance));
    enemy.y = Math.max(ARENA_MARGIN + 20,
        Math.min(game.canvasHeight - ARENA_MARGIN - 20,
            player.y + Math.sin(angle) * distance));
    enemy.blinkedThisFrame = true;
    enemy.abilityTimer = 0;
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
