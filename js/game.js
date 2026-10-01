// Core game state, loop, spawn management, and difficulty scaling
import * as enemies from './enemies.js';
import * as projectiles from './projectiles.js';
import { player } from './player.js';
import { upgradeSystem } from './upgrades.js';
import { perks } from './perks.js';
import * as audio from './audio.js';
import { crazyGames } from './crazygames.js';
import { saveSystem } from './save.js';
import { clear as clearVisualEffects, spawnHit, setParticleQuality, setScreenShakeEnabled, spawnBurst, triggerScreenShake } from './visual-effects.js';
import * as quality from './render-quality.js';
import * as fragments from './fragments.js';
import { SKILLS, SKILL_ORDER, skillRegistry } from './skills.js';

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
    
    // Game settings. Render quality is applied before anything else, because it
    // is the one setting that changes how the very first frame is drawn.
    const settings = loadGameSettings();
    if (settings.particleQuality) setParticleQuality(settings.particleQuality);
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
    killsThisWave = 0;
    maxEnemiesPerWave = 5;
    spawnTimer = 0;
    secondsSinceStart = 0;
    pendingSpawns = 0;
    bossWaveActive = false;
    runEnded = false;
    enemies.setWave(1);
    
    // Echo Shift
    // All four skills start ready on a fresh run. Perks, not unlocks, are the
    // progression here, so there is nothing to gate behind a level.
    skillRegistry.clearAll();

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
        headY: 0,
        sweepComplete: false, // the fast draw is done and the line is standing
        powerScale: 1, // Twin Echo replays at half power
        queued: false, // Quick Recall / Twin Echo follow-up replay
        queuedPowerScale: 1
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
let killsThisWave = 0;
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

// Wave pacing: a wave ends once the player has killed everything it committed
// to, so the only thing standing between the player and the next wave is their
// own clear speed. A wave's opening burst (4-8 enemies, one every 0.5s) already
// puts a floor under the spacing, so WAVE_MIN_SECONDS only has to be a safety
// net against a zero-length wave, and WAVE_MAX_SECONDS is the anti-stall backstop.
const WAVE_MIN_SECONDS = 1;
const WAVE_MAX_SECONDS = 30;

// Gap between the enemies a wave trickles in. It sets how continuously the arena
// stays occupied: at a slow drip a player who kills instantly spends the gap
// staring at an empty screen.
const SPAWN_INTERVAL = 0.7;

// Total enemies one wave may spawn, on top of its opening burst. A wave's
// difficulty comes mostly from the wave multipliers, so the body count only has
// to be big enough to fill the screen.
function waveSpawnBudget() {
    return maxEnemiesPerWave * 2;
}

export function update(deltaTime) {
    if (!gameState || gameState.isPaused) return;
    
    secondsSinceStart += deltaTime;
    gameState.secondsSinceStart = secondsSinceStart;

    // Time Dilation bends the world clock, not the run clock. Cooldowns, waves
    // and the Echo replay all read secondsSinceStart and must keep running at
    // real speed, otherwise slowing the world would also hand back free
    // cooldown and let a wave drag on forever.
    const worldDelta = deltaTime * getWorldTimeScale();
    
    // Wave system - ends on a kill quota, floored and capped so it can neither
    // chain nor drag
    const waveElapsed = secondsSinceStart - lastWaveTime;
    if (waveElapsed >= WAVE_MAX_SECONDS || (waveElapsed >= WAVE_MIN_SECONDS && isWaveQuotaMet())) {
        startNewWave();
        lastWaveTime = secondsSinceStart;
    }
    
    // Spawn enemies during wave. The budget has to fit inside WAVE_MAX_SECONDS at
    // one enemy per SPAWN_INTERVAL, otherwise the drip is still delivering when
    // the cap fires, no wave can ever end on a clear, and the pacing rule
    // silently degrades back into the fixed timer it replaced.
    //
    // The drip is demand driven rather than purely clock driven: a player who
    // kills faster than the timer feeds would otherwise be left staring at an
    // empty screen waiting for the next spawn.
    if (currentWave > 0 && enemiesThisWave < waveSpawnBudget()
        && enemies.getActiveEnemies().length < Math.ceil(maxEnemiesPerWave / 3)) {
        spawnTimer += deltaTime;
        if (spawnTimer >= SPAWN_INTERVAL) {
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
    
    // Everything that lives in the world runs on the dilated clock. The player
    // is updated by main.js on the raw delta, so moving and dodging stay
    // responsive while the threats being dodged are in slow motion.
    enemies.updateAll(worldDelta);
    projectiles.updateAll(worldDelta);
    fragments.updateAll(worldDelta);
    
    // Player auto-attack nearest enemy in range
    player.autoAttack(enemies.getActiveEnemies());
    
    // Skill state. Runs on the raw delta, not the dilated one: cooldowns and
    // the dilation window itself are the player's, not the world's.
    updateSkills(deltaTime);

    // Update echo shift
    updateEchoShift(deltaTime);
    
    // Mark perk: anything standing in your range is lit up and takes more
    // damage from every source, the Echo included
    markEnemiesInRange();

    // Check for level up
    checkLevelUp();
    
    // Check game over
    checkGameOverState();
}

// ============================================================================
// Additional skills
//
// Each skill owns its own state, resolved from its upgradeable parts. The three
// new ones live here rather than in their own modules because they all need the
// same three things game.js already holds: the player, the enemy list and the
// visual effects. skills.js stays a pure registry so it never has to import
// back into this file.
// ============================================================================

// --- Time Dilation ---------------------------------------------------------
const timeDilation = {
    active: false,
    // Counts down on the WORLD clock, so a deep dilation does not also extend
    // the skill's own life
    remaining: 0,
    duration: 0,
    timeScale: 1,
    slowCap: 0
};

// The floor the dilation part can push the world down to
const TD_MIN_SCALE = 0.15;
// Fades rather than snapping: a full-frame speed change reads as a glitch, and
// an instant slow also teleports fast projectiles past the player's hitbox
const TD_FADE_IN = 0.1;
const TD_FADE_OUT = 0.18;

// --- Phase Dash ------------------------------------------------------------
const dash = {
    active: false,
    remaining: 0,
    total: 0,
    dx: 0,
    dy: 0,
    charged: false,
    // Charge accumulates while the trigger is held and fires on release
    charging: false,
    charge: 0,
    chargeTime: 0
};

const DASH_CHARGE_SECONDS = 0.5;
// What the Charged Dash part buys: a longer, piercing dash
const DASH_CHARGED_MULTIPLIER = 2.0;

// --- Void Nova -------------------------------------------------------------
const nova = {
    // Expansion ring, for rendering only. The damage is resolved once on
    // activation, so this is never a second hit.
    ring: null
};

// --- shared helpers --------------------------------------------------------

// The arena margin the player is clamped to inside player.js. A dash that runs
// a body past the wall would leave it outside the arena, so it is clamped to the
// same box rather than using a looser one.
const PLAYER_ARENA_MARGIN = 65;

// Axis is explicit rather than inferred from the value: the arena is wider than
// it is tall, and a value that happens to match player.x would silently get
// clamped to the wrong edge.
function clampToArena(pos, halfSize, axis) {
    const lo = PLAYER_ARENA_MARGIN + halfSize;
    const hi = (axis === 'y' ? canvasHeight : canvasWidth) - PLAYER_ARENA_MARGIN - halfSize;
    return Math.max(lo, Math.min(hi, pos));
}

export function getWorldTimeScale() {
    return timeDilation.active ? timeDilation.timeScale : 1;
}

// True while the player's own speed is being eaten by the slow cap
export function isPlayerSlowed() {
    return timeDilation.active && timeDilation.slowCap > 0;
}

// The dilation state itself, for the renderer and for tests that need to tell
// "still ramping" apart from "already fading back out"
export function getTimeDilation() {
    return timeDilation;
}

export function getPlayerSlowFraction() {
    return isPlayerSlowed() ? timeDilation.slowCap : 0;
}

// --- Time Dilation ---------------------------------------------------------
// Solves the world's speed for this activation. Higher power slows the world
// further, but the same purchase raises the cap on how much of the player's own
// speed is lost, so a deep dilation is paid for with mobility rather than being
// a free "do everything again" button.
export function activateTimeDilation() {
    if (!skillRegistry.isReady('time_dilation')) return false;

    const stats = upgradeSystem.getStats();
    const targetScale = Math.max(TD_MIN_SCALE, stats.tdPower);
    const duration = stats.tdDuration;
    const cap = Math.max(0, Math.min(0.6, stats.tdSlowCap));

    timeDilation.active = true;
    timeDilation.duration = duration;
    timeDilation.remaining = duration;
    timeDilation.slowCap = cap;
    // Start from the previous frame's scale so a re-trigger mid-fade eases out
    // of where it was instead of jumping
    timeDilation.timeScale = timeDilation.timeScale;
    timeDilation._targetScale = targetScale;
    timeDilation._fade = 0;

    skillRegistry.startCooldown('time_dilation', stats.tdCooldown);
    audio.play('time_dilation');
    spawnBurst(player.x, player.y, SKILLS.time_dilation.color, 14);
    return true;
}

function updateTimeDilation(deltaTime) {
    if (!timeDilation.active) return;

    timeDilation.remaining -= deltaTime;

    // Reflex: taking a hit while dilated cuts the slow short and refunds part of
    // the cooldown. It ends the active effect rather than the fade, so the world
    // still eases back up instead of snapping.
    if (timeDilation.remaining <= 0) {
        timeDilation._fadeOut = true;
        timeDilation.remaining = 0;
    }

    const target = timeDilation._fadeOut ? 1 : timeDilation._targetScale;
    const rate = timeDilation._fadeOut ? 1 / TD_FADE_OUT : 1 / TD_FADE_IN;
    if (timeDilation.timeScale < target) {
        timeDilation.timeScale = Math.min(target, timeDilation.timeScale + rate * deltaTime);
    } else if (timeDilation.timeScale > target) {
        timeDilation.timeScale = Math.max(target, timeDilation.timeScale - rate * deltaTime);
    }

    if (timeDilation._fadeOut && timeDilation.timeScale >= 1) {
        timeDilation.active = false;
        timeDilation.timeScale = 1;
        timeDilation.slowCap = 0;
        timeDilation._fadeOut = false;
    }
}

// Reflex, called from the damage path when the hit lands during a dilation
export function onDilationInterrupted() {
    if (!timeDilation.active) return;
    timeDilation._fadeOut = true;
    timeDilation.remaining = 0;
    const stats = upgradeSystem.getStats();
    skillRegistry.refundCooldown('time_dilation', stats.tdCooldown * 0.5);
}

// --- Phase Dash ------------------------------------------------------------
export function activatePhaseDash(charged = false) {
    if (!skillRegistry.isReady('phase_dash')) return false;

    const stats = upgradeSystem.getStats();
    const charge = charged ? 1 : 0;
    const distance = stats.pdDistance;

    // Dash the way the player is holding, or the way they were last moving, so
    // a tap with no input still goes somewhere sensible.
    let dx = 0;
    let dy = 0;
    if (player.isMoving) {
        dx = player.moveDirection.x;
        dy = player.moveDirection.y;
    } else if (player.lastMoveX || player.lastMoveY) {
        dx = player.lastMoveX;
        dy = player.lastMoveY;
    } else {
        dx = 1;
        dy = 0;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    dash.active = true;
    dash.charged = charged;
    dash.total = charged ? 0.18 : 0.1;
    dash.remaining = dash.total;
    dash.dx = dx;
    dash.dy = dy;
    dash._travelled = 0;
    dash._distance = distance;
    dash._fromX = player.x;
    dash._fromY = player.y;
    dash._hit = new Set();

    // i-frames cover the whole dash, not just the first frame, so a dash into a
    // body still ends safe
    player.invulnUntil = Math.max(player.invulnUntil, performance.now() / 1000 + stats.pdIFrames);

// Charged Dash travels further for every point invested. The scaling is
// measured off the part's base ladder rather than a floating factor.
const chargedExtra = charged ? 1 + (stats.pdChargedDash) * (DASH_CHARGED_MULTIPLIER - 1) : 1;
dash._distance = distance * (charged ? chargedExtra : 1);

    skillRegistry.startCooldown('phase_dash', stats.pdCooldown);
    audio.play('phase_dash');
    return true;
}

// Charge is tracked on press and released on let-go. The cooldown only starts
// when the dash actually fires, so a tap that is never released cannot leave the
// player locked out of the skill.
export function beginDashCharge() {
    if (!skillRegistry.isReady('phase_dash')) return false;
    dash.charging = true;
    dash.charge = 0;
    dash.chargeTime = 0;
    return true;
}

export function releaseDashCharge() {
    if (!dash.charging) return false;
    dash.charging = false;
    const charged = dash.charge >= 1;
    dash.charge = 0;
    return activatePhaseDash(charged);
}

export function isDashCharging() {
    return dash.charging;
}

// Cancelling the charge mid-hold leaves it ready: no cooldown, no dash fired
export function cancelDashCharge() {
    dash.charging = false;
    dash.charge = 0;
    dash.chargeTime = 0;
}

function updatePhaseDash(deltaTime) {
    if (dash.charging) {
        dash.chargeTime += deltaTime;
        dash.charge = Math.min(1, dash.chargeTime / DASH_CHARGE_SECONDS);
    }
    if (!dash.active) return;

    dash.remaining -= deltaTime;

    // Move along the dash line at a constant speed, then clamp to the arena so
    // the player can never be left outside the playfield.
    // Spend only what is left of the dash distance this frame, so the last
    // partial step cannot overshoot the promised range.
    const step = Math.min((dash._distance / dash.total) * deltaTime, dash._distance - dash._travelled);
    dash._travelled += step;
    player.x = clampToArena(player.x + dash.dx * step, player.radius, 'x');
    player.y = clampToArena(player.y + dash.dy * step, player.radius, 'y');

    resolveDashPassThrough();

    if (dash.remaining <= 0) {
        dash.active = false;
        spawnBurst(player.x, player.y, SKILLS.phase_dash.color, dash.charged ? 10 : 5);
        // Untouchable: the dash ends with a shove, so landing inside a pack
        // pushes it off instead of just relocating the player into it
        if (perks.has('untouchable')) {
            endDashPush();
        }
    }
}

// What the dash does to anything it passes through. Each enemy can only be hit
// once per dash, tracked by id so a long dash does not re-hit the same body on
// consecutive frames.
function resolveDashPassThrough() {
    const damaging = dash.charged && perks.has('phaseCharged');
    const refunding = perks.has('slipstreamDash');
    const activeEnemies = enemies.getActiveEnemies();

    for (const enemy of activeEnemies) {
        if (enemy.hp <= 0 || dash._hit.has(enemy.id)) continue;
        const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        if (dist > enemy.size + player.radius) continue;

        dash._hit.add(enemy.id);

        if (damaging) {
            const damage = player.attackPower;
            damageEnemy(enemy, damage, { source: 'dash' });
            spawnHit(enemy.x, enemy.y, SKILLS.phase_dash.color, damage, false);
            audio.play('hit');
        }
        if (refunding) {
            // Half the cooldown back per body, so diving through a swarm is how
            // this perk is actually paid out. Uses the registry's refund so it
            // shortens the remaining time rather than re-arming the cooldown.
            const stats = upgradeSystem.getStats();
            skillRegistry.refundCooldown('phase_dash', stats.pdCooldown * 0.5);
        }
    }
}

// Untouchable: a shove on landing. Pushes the pack off the player so the dash
// ends somewhere survivable rather than relocating them inside the swarm.
function endDashPush() {
    const stats = upgradeSystem.getStats();
    const radius = stats.vnRadius * 0.6;
    for (const enemy of enemies.getActiveEnemies()) {
        if (enemy.hp <= 0) continue;
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius + enemy.size || dist < 0.01) continue;
        const shove = 200;
        enemy.x += (dx / dist) * shove * 0.02;
        enemy.y += (dy / dist) * shove * 0.02;
        enemy.stunUntil = Math.max(enemy.stunUntil, performance.now() / 1000 + 0.2);
    }
}

// --- Void Nova -------------------------------------------------------------
// Shared by the nova and its inverted Gravity Well form: same reach, same hit,
// opposite direction of travel.
export function activateVoidNova() {
    if (!skillRegistry.isReady('void_nova')) return false;

    const stats = upgradeSystem.getStats();
    // Event Horizon: the nova reaches further while the player holds still, so
    // standing your ground in a swarm is the build's payoff
    const still = !player.isMoving;
    const radius = stats.vnRadius * (perks.has('eventHorizon') && still ? 1.2 : 1);
    const force = stats.vnForce;
    // Gravity Well is a 0..1 part: above halfway it inverts the push into a pull
    const well = stats.vnGravityWell;
    const pulling = well >= 0.5;
    const shockwave = perks.has('shockwave');

    const activeEnemies = enemies.getActiveEnemies();
    const damage = player.attackPower * force;

    for (const enemy of activeEnemies) {
        if (enemy.hp <= 0) continue;
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const dist = Math.hypot(dx, dy);
        // The body itself is the edge, so a big enemy is not "in" the nova while
        // its centre is still outside it
        if (dist > radius + enemy.size) continue;

        let nx = 0;
        let ny = 0;
        if (dist > 0.01) {
            nx = dx / dist;
            ny = dy / dist;
            // Falls off toward the rim so the nova has a soft edge rather than a
            // hard wall of displacement
            const falloff = 1 - Math.min(1, dist / Math.max(1, radius));
            const shove = force * 260 * (0.35 + 0.65 * falloff);
            const dir = pulling ? -1 : 1;
            enemy.x += nx * shove * dir * 0.02;
            enemy.y += ny * shove * dir * 0.02;
            // A shove also interrupts: the pack arrives staggered instead of
            // landing on the player all at once. Shockwave extends that to the
            // long windups (the Rift Warden's lance), which is the whole point.
            enemy.stunUntil = Math.max(
                enemy.stunUntil,
                performance.now() / 1000 + (shockwave ? 0.6 : 0.25)
            );
        }

        if (damage > 0) {
            // Singularity: anything the well dragged inward is softer
            const bonus = pulling && perks.has('singularity') ? 1.4 : 1;
            damageEnemy(enemy, damage * bonus, { source: 'nova' });
            spawnHit(enemy.x, enemy.y, SKILLS.void_nova.color, damage * bonus, false);
            audio.play('hit');
        }
    }

    nova.ring = {
        x: player.x,
        y: player.y,
        radius: 0,
        target: radius,
        life: 0.4,
        elapsed: 0,
        pulling
    };

    skillRegistry.startCooldown('void_nova', stats.vnCooldown);
    audio.play('void_nova');
    triggerScreenShake(7, 0.2);
    return true;
}

function updateVoidNova(deltaTime) {
    if (!nova.ring) return;
    nova.ring.elapsed += deltaTime;
    if (nova.ring.elapsed >= nova.ring.life) {
        nova.ring = null;
        return;
    }
    // Ease outward so the blast reads as a shockwave rather than a growing circle
    const t = nova.ring.elapsed / nova.ring.life;
    nova.ring.radius = nova.ring.target * (1 - Math.pow(1 - t, 3));
}

// --- shared ----------------------------------------------------------------

// Cooldowns tick on the run clock so they freeze while the stat screen or the
// pause menu is up, exactly like the Echo replay.
export function updateSkills(deltaTime) {
    skillRegistry.update(deltaTime);
    updateTimeDilation(deltaTime);
    updatePhaseDash(deltaTime);
    updateVoidNova(deltaTime);
}

// One entry point for the activation key: it routes to whatever is equipped, so
// the player only ever has one button to remember.
export function activateEquippedSkill() {
    switch (skillRegistry.getEquippedId()) {
        case 'time_dilation':
            return activateTimeDilation();
        case 'phase_dash':
            return activatePhaseDash(false);
        case 'void_nova':
            return activateVoidNova();
        case 'echo_shift':
        default:
            return activateEchoShift();
    }
}

export function getNovaRing() {
    return nova.ring;
}

export function isDashActive() {
    return dash.active;
}

export function getDashCharge() {
    return dash.charge;
}

// Cleared on every run restart so a dash mid-flight or a dilation mid-window
// cannot leak into the next run
export function resetSkills() {
    timeDilation.active = false;
    timeDilation.remaining = 0;
    timeDilation.duration = 0;
    timeDilation.timeScale = 1;
    timeDilation.slowCap = 0;
    timeDilation._targetScale = 1;
    timeDilation._fadeOut = false;

    dash.active = false;
    dash.remaining = 0;
    dash.charging = false;
    dash.charge = 0;
    dash.chargeTime = 0;

    nova.ring = null;
    skillRegistry.clearAll();
}

// A wave is cleared when the player has killed as many enemies as the wave has
// committed to. Using the wave's own spawn count as the quota is what makes this
// robust: the target can never exceed what is actually on the field, and any
// kill counts, so an enemy the player can never reach (one faster than them, or
// one left over from an earlier wave) delays nothing. Requiring the opening
// burst to be spent stops the quota from being met while more are still queued.
export function isWaveQuotaMet() {
    if (pendingSpawns > 0) return false;
    return killsThisWave >= Math.max(1, enemiesThisWave);
}

// True when nothing is left on the field: no live enemies and no queued drip
// spawns still waiting to appear.
export function isWaveCleared() {
    return pendingSpawns === 0 && enemies.getActiveEnemies().length === 0;
}

export function getPendingSpawns() {
    return pendingSpawns;
}

// An enemy culled for wandering too far off still held a slot in its wave's
// quota. Handing the slot back is what keeps the quota reachable when the player
// kites: without it the wave waits out the cap on an enemy that no longer exists.
export function releaseWaveEnemySlot() {
    if (enemiesThisWave > 0) enemiesThisWave--;
}

export function startNewWave() {
    currentWave++;
    maxEnemiesPerWave = Math.min(5 + Math.floor(currentWave / 3), 15); // Scale up to 15
    enemiesThisWave = 0;
    killsThisWave = 0;
    bossWaveActive = currentWave % 10 === 0;
    spawnTimer = 0;
    // Stonewall is once per wave, so it has to come back with the wave
    player.stonewallUsed = false;
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
        upgradeSystem.addAbilityPoints(upgradeSystem.levelUpAbilityPoints);
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
    killsThisWave += amount;
    updateUIStats();
}

// ---------------------------------------------------------------------------
// Perk support: one place that applies damage and reacts to kills, so every
// perk effect flows through the same pipeline instead of being scattered across
// the attack, echo and enemy code.
// ---------------------------------------------------------------------------

const perkUnlockQueue = [];

// Newly unlocked perks are queued here so the UI can celebrate each one
// exactly once, no matter which code path spent the point.
export function consumePerkUnlocks() {
    const queued = perkUnlockQueue.slice();
    perkUnlockQueue.length = 0;
    return queued;
}

// Central damage entry point. Returns the damage actually dealt (after the
// Mark multipliers) so callers can display the real number.
export function damageEnemy(enemy, amount, options = {}) {
    if (!enemy || enemy.hp <= 0 || amount <= 0) return 0;

    const now = performance.now() / 1000;
    let damage = amount;

    // Mark / Lingering Mark. The stronger mark wins rather than the two
    // stacking, so committing to both ranges and echo duration is not secretly
    // the strongest build in the game.
    let markBonus = 0;
    if (enemy.markedRangeUntil > now) markBonus = Math.max(markBonus, MARK_RANGE_BONUS);
    if (enemy.markedEchoUntil > now) markBonus = Math.max(markBonus, MARK_ECHO_BONUS);
    if (markBonus > 0) damage *= 1 + markBonus;

    enemy.hp -= damage;
    enemy.hitFlashUntil = now + 0.12;

    // Deep Cut: a critical hit drags the target's pace out of the fight
    if (options.critical && perks.has('deepCut')) {
        enemy.slowUntil = now + DEEP_CUT_SLOW_SECONDS;
    }

    if (enemy.hp <= 0) handleEnemyKilled(enemy, options);
    return damage;
}

const MARK_RANGE_BONUS = 0.20;
const MARK_ECHO_BONUS = 0.25;
const DEEP_CUT_SLOW_SECONDS = 2;

// Perk reactions to a kill. Guarded so a single kill can never fire twice, no
// matter how many sources land on it in the same frame.
function handleEnemyKilled(enemy, options = {}) {
    if (enemy.perkKillHandled) return;
    enemy.perkKillHandled = true;

    // Momentum: every kill feeds the speed meter
    player.onKill();

    if (options.critical && perks.has('chainCrit')) chainCritFrom(enemy);
    if (perks.has('shatter')) shatterFrom(enemy);
}

// Shatter: the corpse pays out its own remaining durability to everything
// standing next to it.
function shatterFrom(dead) {
    const radius = SHATTER_RADIUS;
    const radiusSquared = radius * radius;
    const damage = dead.maxHP * SHATTER_FRACTION;
    for (const enemy of enemies.getActiveEnemies()) {
        if (enemy === dead || enemy.hp <= 0) continue;
        const dx = enemy.x - dead.x;
        const dy = enemy.y - dead.y;
        if (dx * dx + dy * dy > radiusSquared) continue;
        damageEnemy(enemy, damage, { source: 'shatter' });
        spawnHit(enemy.x, enemy.y, '#ffb648', damage, false);
    }
}

const SHATTER_RADIUS = 80;
const SHATTER_FRACTION = 0.4;

// Chain Crit: the killing blow arcs to the two nearest survivors
function chainCritFrom(dead) {
    const targets = enemies.getActiveEnemies()
        .filter((enemy) => enemy !== dead && enemy.hp > 0)
        .map((enemy) => ({
            enemy,
            distanceSquared: (enemy.x - player.x) ** 2 + (enemy.y - player.y) ** 2
        }))
        .sort((a, b) => a.distanceSquared - b.distanceSquared)
        .slice(0, 2);

    const damage = player.attackPower * CHAIN_CRIT_FRACTION;
    for (const target of targets) {
        damageEnemy(target.enemy, damage, { source: 'chain' });
        spawnHit(target.enemy.x, target.enemy.y, '#ffe66d', damage, true);
    }
}

const CHAIN_CRIT_FRACTION = 0.5;

// Mark: refreshes every frame, so the flag lapses the moment an enemy steps
// out of range
export function markEnemiesInRange() {
    if (!perks.has('mark')) return;
    const now = performance.now() / 1000;
    const rangeSquared = player.attackRange * player.attackRange;
    for (const enemy of enemies.getActiveEnemies()) {
        if (enemy.hp <= 0) continue;
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        if (dx * dx + dy * dy <= rangeSquared) {
            enemy.markedRangeUntil = now + 0.1;
        }
    }
}

// Which enemies the player can currently see marked, for rendering
export function isMarked(enemy, now = performance.now() / 1000) {
    return enemy.markedRangeUntil > now || enemy.markedEchoUntil > now;
}

export function loadGameSettings() {
    return saveSystem.saveData?.settings
        ? { ...saveSystem.saveData.settings }
        : {
            masterVolume: 0.7,
            sfxVolume: 0.7,
            // A phone gets the cheapest tier unless the player picks otherwise:
            // this is the one default worth choosing for them
            particleQuality: quality.defaultSetting(),
            screenShake: true,
            // Default layout, matching save.js: movement on the right thumb
            swapTouchSides: false
        };
}

export function saveGameSettings(settings) {
    saveSystem.updateSettings(settings);
}

// Mobile layout: the default puts movement under the right thumb and SHIFT under
// the left. Swapping puts them the other way round. Only the side changes, so the
// whole layout is one class on the touch overlay.
export function applyTouchLayout(swapped) {
    const controls = document.getElementById('touch-controls');
    if (!controls) return;
    controls.classList.toggle('swapped', !!swapped);
}

export function applyGameSettings(settings) {
    if (!settings) return;
    if (settings.swapTouchSides !== undefined) {
        applyTouchLayout(settings.swapTouchSides);
    }
    if (settings.masterVolume !== undefined) {
        audio.setMasterVolume(settings.masterVolume);
    }
    if (settings.sfxVolume !== undefined) {
        audio.setSFXVolume(settings.sfxVolume);
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
    killsThisWave = 0;
    maxEnemiesPerWave = 5;
    spawnTimer = 0;
    pendingSpawns = 0;
    clearVisualEffects();
    // A new run starts at the player's chosen quality, not at whatever the
    // previous run's frame times left it at
    quality.resetAdaptive();
    fragments.resetAll();
    projectiles.reset();
    // Cooldowns, a live dilation and a dash in flight are all per-run
    resetSkills();
    bossWaveActive = false;
    runEnded = false;
    gameState.statAllocationOpen = false;
    enemies.setWave(1);
    
    player.reset();
    upgradeSystem.reset();
    perks.reset();
    perkUnlockQueue.length = 0;
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
    echoShift.queued = false;
    echoShift.queuedPowerScale = 1;
    echoShift.powerScale = 1;
    
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
    if (path.length < 2 || echoShift.elapsed >= echoShift.duration) {
        finishEchoShift();
        return;
    }

    // The head races across the whole path in a fraction of a second, so the
    // line is standing almost immediately instead of trickling in. What is left
    // of the Echo's life the finished line holds its ground as a barrier.
    const sweepProgress = Math.min(1, echoShift.elapsed / ECHO_SWEEP_SECONDS);
    echoShift.replayProgress = sweepProgress;
    echoShift.sweepComplete = sweepProgress >= 1;

    const maxIndex = path.length - 1;
    const floatIndex = Math.min(maxIndex, sweepProgress * maxIndex);
    const segIndex = Math.min(maxIndex - 1, Math.floor(floatIndex));
    const segT = floatIndex - segIndex;
    const a = path[segIndex];
    const b = path[segIndex + 1];
    echoShift.replaySegmentIndex = segIndex;
    echoShift.replaySegmentT = segT;
    echoShift.headX = a.x + (b.x - a.x) * segT;
    echoShift.headY = a.y + (b.y - a.y) * segT;

    if (!echoShift.damagedEnemies) echoShift.damagedEnemies = new Set();

    const echoDamage = player.attackPower * player.echoPower * (echoShift.powerScale || 1);
    const activeEnemies = enemies.getActiveEnemies();
    const trailRadius = 25;
    // Resonance: the barrier bites hardest once the Echo is on its way out
    const finishing = perks.has('resonance')
        && (echoShift.elapsed / Math.max(0.001, echoShift.duration)) >= RESONANCE_FINISH_AT;
    const now = performance.now() / 1000;
    const wallReached = echoShift.elapsed >= ECHO_SWEEP_SECONDS;

    for (const enemy of activeEnemies) {
        if (enemy.hp <= 0) continue;

        // Impact: the sweeping head hits each enemy once as it goes past
        if (!echoShift.damagedEnemies.has(enemy.id)) {
            const dist = distPointToSegment(enemy.x, enemy.y, a.x, a.y, b.x, b.y);
            if (dist < enemy.size + trailRadius) {
                const damage = finishing ? echoDamage * 2 : echoDamage;
                damageEnemy(enemy, damage, { source: 'echo' });
                spawnHit(enemy.x, enemy.y, '#58e8f4', damage, false);
                addEchoDamage(damage);
                echoShift.damagedEnemies.add(enemy.id);
                // Lingering Mark: the Echo brands everything it touches
                if (perks.has('lingeringMark')) {
                    enemy.markedEchoUntil = now + LINGERING_MARK_SECONDS;
                }
                audio.play('hit');
            }
        }

        // Burn: anything resting against the finished line keeps taking damage
        // for as long as the barrier is up
        if (wallReached) {
            const wallDist = distanceToPath(enemy.x, enemy.y, path);
            if (wallDist < enemy.size + ECHO_WALL_HALF_WIDTH) {
                const burn = echoDamage * ECHO_BURN_PER_SECOND * deltaTime * (finishing ? 2 : 1);
                damageEnemy(enemy, burn, { source: 'echo' });
                addEchoDamage(burn);
                // Lingering Mark keeps refreshing while it cooks
                if (perks.has('lingeringMark')) {
                    enemy.markedEchoUntil = now + LINGERING_MARK_SECONDS;
                }
            }
        }
    }
}

const RESONANCE_FINISH_AT = 0.75;
const LINGERING_MARK_SECONDS = 4;
// The replay head covers the whole path this fast, so the barrier is up almost
// immediately no matter how long the run was
const ECHO_SWEEP_SECONDS = 0.35;
const ECHO_WALL_HALF_WIDTH = 10;
// Damage per second, as a share of one full Echo hit, while an enemy is pressed
// against the standing line
const ECHO_BURN_PER_SECOND = 0.9;

// Shortest distance from a point to the whole replay path, used for the
// barrier contact test
function distanceToPath(px, py, path) {
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const d = distPointToSegment(px, py, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y);
        if (d < best) best = d;
    }
    return best;
}

// Closest point on a segment, for pushing enemies off the barrier
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: x1, y: y1 };
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * dx, y: y1 + t * dy };
}

// The barrier only exists once the sweep has finished, so everything that wants
// to interact with the wall (projectiles, phasing bodies) has to ask this rather
// than reading echoShift directly.
export function isEchoWallUp() {
    return !!echoShift.isActive && !!echoShift.path && echoShift.path.length >= 2
        && echoShift.elapsed >= ECHO_SWEEP_SECONDS;
}

// Is a point inside the standing wall? `padding` covers the projectile or body
// radius, so callers test their own edge against the line.
export function isInsideEchoWall(px, py, padding = 0) {
    if (!isEchoWallUp()) return false;
    return distanceToPath(px, py, echoShift.path) < padding + ECHO_WALL_HALF_WIDTH;
}

// The standing Echo line is a wall: enemies stop at it and burn against it.
// Called from the enemy movement step, after a body has moved.
export function applyEchoBarrier(enemy) {
    if (!echoShift.isActive || !echoShift.path || echoShift.path.length < 2) return false;
    if (echoShift.elapsed < ECHO_SWEEP_SECONDS) return false; // still being drawn

    const path = echoShift.path;
    const reach = enemy.size + ECHO_WALL_HALF_WIDTH;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const cp = closestPointOnSegment(enemy.x, enemy.y, a.x, a.y, b.x, b.y);
        const dx = enemy.x - cp.x;
        const dy = enemy.y - cp.y;
        const d = Math.hypot(dx, dy);
        if (d >= reach) continue;
        if (d < 0.0001) {
            // Dead centre on the line: shove straight back along the wall normal
            const nx = -(b.y - a.y);
            const ny = b.x - a.x;
            const nl = Math.hypot(nx, ny) || 1;
            enemy.x = cp.x + (nx / nl) * reach;
            enemy.y = cp.y + (ny / nl) * reach;
            continue;
        }
        const nx = dx / d;
        const ny = dy / d;
        enemy.x = cp.x + nx * reach;
        enemy.y = cp.y + ny * reach;
        // Cancel only the component driving into the wall, so bodies slide
        // along it instead of sticking
        const into = enemy.vx * nx + enemy.vy * ny;
        if (into < 0) {
            enemy.vx -= nx * into;
            enemy.vy -= ny * into;
        }
        return true;
    }
    return false;
}

function finishEchoShift() {
    // Never Fade: the replay spends its last breath on everything it branded
    if (perks.has('neverFade')) {
        const now = performance.now() / 1000;
        const damage = player.attackPower * player.echoPower * (echoShift.powerScale || 1) * NEVER_FADE_FRACTION;
        for (const enemy of enemies.getActiveEnemies()) {
            if (enemy.hp <= 0 || enemy.markedEchoUntil <= now) continue;
            damageEnemy(enemy, damage, { source: 'echo' });
            spawnHit(enemy.x, enemy.y, '#58e8f4', damage, false);
            addEchoDamage(damage);
        }
    }

    // Twin Echo / Quick Recall: run the follow-up replay straight away instead
    // of sitting idle until the cooldown expires. The flag is consumed here so
    // one activation can never queue an endless chain of replays.
    if (echoShift.queued) {
        const queuedPower = echoShift.queuedPowerScale;
        echoShift.queued = false;
        echoShift.queuedPowerScale = 1;
        if (startEchoReplay(queuedPower)) return;
    }

    echoShift.isActive = false;
    echoShift.damagedEnemies = null;
    echoShift.elapsed = 0;
    echoShift.replayProgress = 0;
    echoShift.replaySegmentIndex = 0;
    echoShift.replaySegmentT = 0;
    echoShift.queued = false;
    echoShift.powerScale = 1;
}

const NEVER_FADE_FRACTION = 0.5;
const TWIN_ECHO_FRACTION = 0.5;

// Shared replay setup, used by the first activation and by any queued one.
function startEchoReplay(powerScale = 1) {
    echoShift.isActive = true;
    echoShift.path = player.getMovementPath();
    if (echoShift.path.length < 2) {
        echoShift.isActive = false;
        echoShift.queued = false;
        echoShift.powerScale = 1;
        return false;
    }
    echoShift.elapsed = 0;
    echoShift.replayProgress = 0;
    echoShift.sweepComplete = false;
    echoShift.damagedEnemies = new Set();
    echoShift.powerScale = powerScale;
    echoShift.queued = false;
    echoShift.queuedPowerScale = 1;
    return true;
}

export function activateEchoShift() {
    const now = getRunTime();

    // Quick Recall: one extra Echo can be readied mid-replay, at full power
    if (echoShift.isActive && perks.has('quickRecall') && !echoShift.queued) {
        echoShift.queued = true;
        echoShift.queuedPowerScale = 1;
        audio.play('echo_shift');
        return true;
    }

    if (echoShift.lastUsed + echoShift.cooldown > now) {
        // Not ready yet
        return false;
    }

    // Freeze current path and activate echo
    echoShift.startTime = now;
    if (!startEchoReplay(1)) {
        // No trail to replay: do not activate and do not burn the cooldown
        return false;
    }
    // Twin Echo rides along with every activation, so the second replay costs
    // nothing extra to queue and comes back at half power
    if (perks.has('twinEcho')) {
        echoShift.queued = true;
        echoShift.queuedPowerScale = TWIN_ECHO_FRACTION;
    }
    echoShift.lastUsed = now;
    // The registry owns the visible cooldown for the shared indicator; the
    // echoShift.lastUsed clock above stays for the replay logic.
    skillRegistry.startCooldown('echo_shift', echoShift.cooldown);
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
    player.multishot = stats.multishot;

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

    // Perks are a pure function of the resolved stats, so recomputing here
    // keeps them in lockstep with the ladder no matter who spent the point.
    const newlyUnlocked = perks.refresh();
    for (const perk of newlyUnlocked) perkUnlockQueue.push(perk);
    if (newlyUnlocked.length) audio.play('stat-upgrade');
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
