// Player entity - movement, stats, and Echo Shift mechanic
import * as audio from './audio.js';
import * as game from './game.js';
import { perks } from './perks.js';
import { spawnHit, triggerScreenShake } from './visual-effects.js';

export const player = {
    // Half of the old 15, matching the enemy scale. This one number is the whole
    // hitbox: enemy contact, projectile hits and fragment pickup all read it.
    radius: 7.5,
    // Position and physics - initialized in game start
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    
    // Stats
    hp: 100,
    maxHP: 100,
    moveSpeed: 180, // pixels per second (base, modified by stats)
    attackPower: 10, // Base damage
    attackSpeed: 1.0, // Attacks per second
    attackRange: 150, // Pixels
    criticalChance: 5, // Percent
    criticalDamage: 150, // Percent
    echoPower: 1.0, // Echo damage multiplier
    echoDuration: 3.0, // Seconds
    echoCooldown: 15.0, // Seconds
    multishot: 1, // Enemies hit per volley
    hpRegen: 0,
    hurtFlashUntil: 0,
    invulnUntil: 0,
    
    // Perk bookkeeping
    stonewallUsed: false, // Stonewall, once per wave
    secondsSinceDamage: 0, // Slipstream clean-play timer
    regenDelay: 0, // Regen hold-off after taking a hit
    killSpeedTimer: 0, // Momentum window left
    killStacks: 0, // Momentum stacks
    secondWindTimer: 0,
    attackCounter: 0, // Double Tap cadence
    hitStreak: 0, // Flurry charge progress
    flurryCharges: 0, // Flurry attacks that skip the cooldown

    // Movement state
    isMoving: false,
    moveDirection: { x: 0, y: 0 }, // -1, 0, or 1
    
    // Echo Shift
    movementHistory: [], // Recent {x, y} records on the run clock
    lastMoveTime: -Infinity,
    
    // Auto-attack
    lastAttackTime: -Infinity,
    
    reset() {
        // Start in the center of the play area
        this.x = 480; // canvasWidth/2
        this.y = 270; // canvasHeight/2
        this.hp = this.maxHP;
        this.vx = 0;
        this.vy = 0;
        this.movementHistory = [];
        this.lastMoveTime = -Infinity;
        this.lastAttackTime = -Infinity;
        this.stonewallUsed = false;
        this.secondsSinceDamage = 0;
        this.regenDelay = 0;
        this.killSpeedTimer = 0;
        this.killStacks = 0;
        this.secondWindTimer = 0;
        this.attackCounter = 0;
        this.hitStreak = 0;
        this.flurryCharges = 0;
        // No facing to remember yet, so a fresh dash falls back to a neutral
        // direction instead of last run's
        this.lastMoveX = 0;
        this.lastMoveY = 0;
    },
    
    update(deltaTime, keysDown, joystickVector) {
        // Calculate intended movement from keys
        let dx = 0;
        let dy = 0;
        
        if (keysDown) {
            if (keysDown.has('w') || keysDown.has('arrowup')) dy -= 1;
            if (keysDown.has('s') || keysDown.has('arrowdown')) dy += 1;
            if (keysDown.has('a') || keysDown.has('arrowleft')) dx -= 1;
            if (keysDown.has('d') || keysDown.has('arrowright')) dx += 1;
        }

        if (joystickVector && (joystickVector.x !== 0 || joystickVector.y !== 0)) {
            dx = joystickVector.x;
            dy = joystickVector.y;
        }

        // Shorten anything past the rim rather than every diagonal. Keyboard input
        // is digital, so its diagonals land over 1 and get renormalized here and
        // move at the same speed as a straight line. The stick is analog and
        // reports a magnitude at or below 1, so it passes through untouched: the
        // old any-diagonal normalization made a gentle push on a diagonal run at
        // full speed while the same push straight ahead crawled, which is what
        // made the stick feel unresponsive.
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 1) {
            dx /= length;
            dy /= length;
        }

        this.vx = dx * this.effectiveMoveSpeed();
        this.vy = dy * this.effectiveMoveSpeed();
        
        if (dx !== 0) this.moveDirection.x = Math.sign(dx);
        if (dy !== 0) this.moveDirection.y = Math.sign(dy);
        this.isMoving = dx !== 0 || dy !== 0;

        // Remembered so a dash with no input held still goes the way the player
        // was last walking, instead of snapping to an arbitrary direction
        if (dx !== 0 || dy !== 0) {
            this.lastMoveX = Math.sign(dx);
            this.lastMoveY = Math.sign(dy);
        }

        // Apply movement
        // Clamp position within arena (50px margin)
        const margin = 65;
        this.x = Math.max(margin, Math.min(game.canvasWidth - margin, this.x + this.vx * deltaTime));
        this.y = Math.max(margin, Math.min(game.canvasHeight - margin, this.y + this.vy * deltaTime));
        
        // HP Regeneration
        //
        // Regeneration holds off briefly after taking a hit, so a player being
        // worn down cannot out-heal the damage they are receiving. Bleedout
        // removes that hold-off for players who overcommit to regen.
        const regenDelayed = this.regenDelay > 0 && !perks.has('bleedout');
        if (this.regenDelay > 0) {
            this.regenDelay = Math.max(0, this.regenDelay - deltaTime);
        }
        if (this.hp < this.maxHP && this.hp > 0 && this.hpRegen > 0 && !regenDelayed) {
            this.hp = Math.min(this.maxHP, this.hp + this.hpRegen * deltaTime);
        }

        this.updatePerkTimers(deltaTime);
        
        // Record movement history for Echo Shift (run clock, so pausing does
        // not age the trail out)
        const now = game.getRunTime();
        if (this.isMoving && now - this.lastMoveTime > 0.1) {
            this.movementHistory.push({ x: this.x, y: this.y, timestamp: now });
            // Keep only ~5 seconds of history
            if (this.movementHistory.length > 300) {
                this.movementHistory.shift();
            }
            this.lastMoveTime = now;
        }
    },
    
    // Effective speed after the two move speed perks stack on top of the stat
    effectiveMoveSpeed() {
        let speed = this.moveSpeed;
        // Slipstream: staying clean pays off
        if (perks.has('slipstream') && this.secondsSinceDamage >= SLIPSTREAM_AFTER) {
            speed *= 1 + SLIPSTREAM_BONUS;
        }
        // Momentum: kills build a burst that collapses if the killing stops
        if (this.killStacks > 0) {
            speed *= 1 + MOMENTUM_PER_STACK * this.killStacks;
        }
        // Time Dilation's Slow Cap. Applied last so it is a flat tax on the final
        // speed rather than something the perk bonuses above can scale past,
        // which is what makes the cap read as a cap.
        const slow = game.getPlayerSlowFraction ? game.getPlayerSlowFraction() : 0;
        if (slow > 0) speed *= (1 - slow);
        return speed;
    },

    // Timers that only exist because a perk reads them.
    updatePerkTimers(deltaTime) {
        this.secondsSinceDamage += deltaTime;

        if (this.killStacks > 0) {
            this.killSpeedTimer -= deltaTime;
            if (this.killSpeedTimer <= 0) {
                this.killStacks = 0;
                this.killSpeedTimer = 0;
            }
        }

        if (perks.has('secondWind')) {
            this.secondWindTimer += deltaTime;
            if (this.secondWindTimer >= SECOND_WIND_PERIOD) {
                this.secondWindTimer = 0;
                if (this.hp > 0 && this.hp < this.maxHP * SECOND_WIND_TRIGGER) {
                    this.hp = Math.min(this.maxHP, Math.max(this.hp, this.maxHP * SECOND_WIND_RESTORE));
                    game.updateUIStats();
                }
            }
        }
    },

    // Momentum feeds off kills, wherever the kill came from
    onKill() {
        if (!perks.has('momentum')) return;
        this.killStacks = Math.min(MOMENTUM_MAX_STACKS, this.killStacks + 1);
        this.killSpeedTimer = MOMENTUM_WINDOW;
    },

    getMovementPath() {
        // Return a copy of the movement history for Echo Shift
        // Filter to last 5 seconds of run time
        const cutoff = game.getRunTime() - 5;
        return this.movementHistory.filter((record) => record.timestamp >= cutoff);
    },
    
    activateEchoShift() {
        // Have main.js call game.activateEchoShift()
        // This is just the player method
        const result = game.activateEchoShift();
        if (result) {
            // Echo activated successfully
            // Play sound already handled in game.js
        }
        return result;
    },
    
    takeDamage(amount, source = 'contact') {
        const now = performance.now() / 1000;
        if (now < this.invulnUntil) return;

// Juggernaut, previous version, kept for reference. Contact immunity above half
// HP was strong enough to delete an entire threat type, so it was replaced by a
// damage cap. Restore the block below to get it back.
// if (source === 'contact' && perks.has('juggernaut') && this.hp > this.maxHP * JUGGERNAUT_THRESHOLD) {
//     return;
// }

let incoming = amount;

// Juggernaut: a single contact hit can never take more than a slice of your
    // max HP, so a big HP pool turns "deleted by the pack" into "grounded down".
    // Contact still hurts, which keeps positioning meaningful.
    //
    // Deliberately does NOT cover 'ranged'. Enemy projectiles (drifter bolts,
    // echo hunter bolts, warden lance, every rift core pattern) all report
    // 'ranged' so that Juggernaut cannot turn a big HP pool into blanket
    // immunity against everything that crosses the arena. Standing behind your
    // Echo wall is the intended answer to those; a HP pool is not.
    if (source === 'contact' && perks.has('juggernaut')) {
        incoming = Math.min(incoming, this.maxHP * JUGGERNAUT_CONTACT_CAP);
    }

    // Aegis: half of every projectile hit while healthy. Gated on the same
    // contact/ranged split as Juggernaut above so the two never overlap - a body
    // costs the 15% cap, a projectile costs half. The HP gate is a hard cliff
    // on purpose: under half HP you are on your own, which is what makes
    // holding that line a thing to play around. It also means Aegis cannot
    // rescue a swing it would have killed you from, so it is a damage soak
    // rather than a second chance.
    if (source !== 'contact' && perks.has('aegis') && this.hp > this.maxHP * AEGIS_HP_FLOOR) {
        incoming *= 0.5;
    }

        // Stonewall: the first lethal hit of a wave is survived
        if (this.hp - incoming <= 0 && perks.has('stonewall') && !this.stonewallUsed) {
            this.stonewallUsed = true;
            incoming = Math.max(0, this.hp - 1);
            triggerScreenShake(9, 0.3);
            audio.play('player_damage');
        }

        this.hp -= incoming;
        if (this.hp < 0) this.hp = 0;
        this.hurtFlashUntil = now + 0.2;
        this.invulnUntil = now + 0.45;
        this.secondsSinceDamage = 0;
        this.regenDelay = perks.has('bleedout') ? 0 : REGEN_HOLD_OFF;
        // Reflex: a hit during a dilation cuts it short. Read before the rest of
        // the function so the perk never fires on a hit that was fully ignored.
        if (incoming > 0 && perks.has('reflex')) {
            game.onDilationInterrupted();
        }
        triggerScreenShake(5, 0.14);
        
        // Play pain sound
        audio.play('player_damage');
        
        // UI update
        game.updateUIStats();
        
        // Check if dead
        if (this.hp <= 0) {
            game.checkGameOverState();
        }
    },
    
    heal(amount) {
        this.hp += amount;
        if (this.hp > this.maxHP) this.hp = this.maxHP;
    },
    
    // Auto-attack: one volley hits up to `multishot` enemies at once, each shot
    // rolling its own crit. Spare shots land on the nearest target so a thin
    // arena never turns an upgrade into wasted damage.
    autoAttack(enemyList) {
        const now = performance.now() / 1000;

        // Echo Storm: a live replay is the reward for a short cooldown
        const rateMultiplier = (game.echoShift && game.echoShift.isActive && perks.has('echoStorm')) ? 2 : 1;
        // Flurry charges ignore the cooldown entirely
        const usingFlurry = this.flurryCharges > 0;
        if (!usingFlurry && now - this.lastAttackTime < 1 / (this.attackSpeed * rateMultiplier)) return;

        const targets = [];
        const rangeSquared = this.attackRange * this.attackRange;
        const inRangeIds = new Set();

        for (const enemy of enemyList) {
            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const distanceSquared = dx * dx + dy * dy;

            if (distanceSquared < rangeSquared) {
                targets.push({ enemy, distanceSquared });
                inRangeIds.add(enemy.id);
            }
        }

        if (!targets.length) return;

        // Nearest first, so a volley always spends itself on the closest threats
        targets.sort((a, b) => a.distanceSquared - b.distanceSquared);

        const shots = Math.max(1, Math.round(this.multishot));
        const inRange = targets.map((t) => t.enemy);
        const hitTargets = inRange.slice(0, shots);
        // Fewer enemies in range than shots: the extra shots stack on the nearest
        for (let i = hitTargets.length; i < shots; i++) hitTargets.push(inRange[0]);

        // Double Tap: every 4th swing throws a second round
        this.attackCounter++;
        if (perks.has('doubleTap') && this.attackCounter % DOUBLE_TAP_EVERY === 0) {
            hitTargets.push(inRange[0]);
        }

        const alreadyHit = new Set();
        let shotIndex = 0;
        for (const enemy of hitTargets) {
            this.fireVolleyShot(enemy, shotIndex++, 1, enemyList, inRangeIds, alreadyHit);
        }

        // Bounce: the 3rd shot of the volley ricochets into someone not hit yet
        if (perks.has('bounce') && shots >= BOUNCE_SHOT_INDEX + 1) {
            const spare = inRange.find((enemy) => !alreadyHit.has(enemy.id));
            if (spare) this.fireVolleyShot(spare, 0, BOUNCE_FRACTION, enemyList, inRangeIds, alreadyHit);
        }

        this.lastAttackTime = now;
        if (usingFlurry) this.flurryCharges--;

        // Flurry charges itself from a clean run of swings
        this.hitStreak++;
        if (perks.has('flurry') && this.hitStreak >= FLURRY_STREAK) {
            this.hitStreak = 0;
            this.flurryCharges = FLURRY_CHARGES;
        }
    },

    // One shot at one enemy. Pierce fans the shot out along its own line, so a
    // single aimed round can clear a column of bodies.
    fireVolleyShot(enemy, shotIndex, scale, enemyList, inRangeIds, alreadyHit) {
        const { damage, critical } = this.calculateDamage(this.attackPower);
        // Every enemy a shot touches is recorded, so Pierce does not re-hit one
        // and Bounce can only pick a genuinely untouched target
        const shoot = (target) => {
            alreadyHit.add(target.id);
            this.applyShotDamage(target, shotIndex, damage * scale, critical);
        };

        shoot(enemy);

        if (perks.has('pierce')) {
            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            if (Math.hypot(dx, dy) > 0.01) {
                const dirX = dx / Math.hypot(dx, dy);
                const dirY = dy / Math.hypot(dx, dy);
                // The shot keeps travelling to the edge of the attack range, so
                // whatever stands behind the target is still on the line
                for (const other of enemyList) {
                    if (other === enemy || other.hp <= 0) continue;
                    if (alreadyHit.has(other.id) || !inRangeIds.has(other.id)) continue;
                    const ox = other.x - this.x;
                    const oy = other.y - this.y;
                    const along = ox * dirX + oy * dirY;
                    if (along <= 0 || along > this.attackRange) continue;
                    const perpendicular = Math.abs(ox * -dirY + oy * dirX);
                    if (perpendicular < other.size + PIERCE_WIDTH) shoot(other);
                }
            }
        }
    },

    // Turns a rolled shot into actual damage, then applies the perks that read
    // the target's state (Executioner) or the shot's position in the volley
    // (Storm). `damage` is already the crit-adjusted number from calculateDamage.
    applyShotDamage(enemy, shotIndex, damage, critical) {
        // Storm: every shot past the first hits harder
        if (perks.has('storm') && shotIndex > 0) damage *= 1 + STORM_PER_EXTRA_SHOT;

        // Executioner: finish anything already hurt
        if (perks.has('executioner') && enemy.hp > 0 && enemy.hp / enemy.maxHP < EXECUTIONER_THRESHOLD) {
            damage *= 2;
        }

        const dealt = game.damageEnemy(enemy, damage, { critical, source: 'attack' });
        spawnHit(enemy.x, enemy.y, enemy.color, dealt, critical);
        game.addDamageDealt(dealt);
        audio.play('hit');

        // Bloodthirst: crits are the sustain
        if (critical && perks.has('bloodthirst')) {
            this.heal(BLOODTHIRST_HEAL);
            game.updateUIStats();
        }

        return dealt;
    },
    
    // Returns the crit flag with the damage so the caller never has to infer
    // it from the numbers (a crit at exactly 100% would look like a normal hit).
    calculateDamage(attackPower) {
        const critical = Math.random() * 100 < this.criticalChance;
        // Weak Spot makes the crits themselves meaner, not just more frequent
        let critPercent = this.criticalDamage + (critical && perks.has('weakSpot') ? WEAK_SPOT_CRIT_BONUS : 0);
        // Deep Freeze: the dilated world is the trade. The player's own attacks
        // fire on the slowed cadence too, but hit harder for it, so the perk is a
        // real exchange rather than a flat bonus.
        let base = attackPower;
        if (game.getWorldTimeScale && game.getWorldTimeScale() < 1 && perks.has('deepFreeze')) {
            base *= DEEP_FREEZE_DAMAGE_BONUS;
        }
        return {
            damage: critical ? base * (critPercent / 100) : base,
            critical
        };
    }
};

// Perk tuning values, kept beside the code that reads them
const SLIPSTREAM_AFTER = 3;
const SLIPSTREAM_BONUS = 0.25;
const MOMENTUM_PER_STACK = 0.08;
const MOMENTUM_MAX_STACKS = 10;
const MOMENTUM_WINDOW = 2;
const REGEN_HOLD_OFF = 1.2;
const WEAK_SPOT_CRIT_BONUS = 50;
const DEEP_FREEZE_DAMAGE_BONUS = 1.3;
const JUGGERNAUT_CONTACT_CAP = 0.15; // a contact hit takes at most 15% of max HP
const AEGIS_HP_FLOOR = 0.5; // Aegis only halves projectiles while above this share of max HP
const JUGGERNAUT_THRESHOLD = 0.5; // only used by the commented-out immunity above
const SECOND_WIND_PERIOD = 20;
const SECOND_WIND_TRIGGER = 0.3;
const SECOND_WIND_RESTORE = 0.6;
const EXECUTIONER_THRESHOLD = 0.25;
const DOUBLE_TAP_EVERY = 4;
const FLURRY_STREAK = 6;
const FLURRY_CHARGES = 3;
const PIERCE_WIDTH = 6;
const STORM_PER_EXTRA_SHOT = 0.15;
const BOUNCE_FRACTION = 0.5;
const BOUNCE_SHOT_INDEX = 2;
const BLOODTHIRST_HEAL = 3;
