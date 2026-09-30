// Player entity - movement, stats, and Echo Shift mechanic
import * as audio from './audio.js';
import * as game from './game.js';
import { spawnHit, triggerScreenShake } from './visual-effects.js';

export const player = {
    radius: 15,
    // Position and physics - initialized in game start
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    
    // Stats
    hp: 10,
    maxHP: 10,
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

        // Normalize diagonal movement
        if (dx !== 0 && dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;
        }

        this.vx = dx * this.moveSpeed;
        this.vy = dy * this.moveSpeed;
        
        if (dx !== 0) this.moveDirection.x = Math.sign(dx);
        if (dy !== 0) this.moveDirection.y = Math.sign(dy);
        this.isMoving = dx !== 0 || dy !== 0;

        // Apply movement
        // Clamp position within arena (50px margin)
        const margin = 65;
        this.x = Math.max(margin, Math.min(game.canvasWidth - margin, this.x + this.vx * deltaTime));
        this.y = Math.max(margin, Math.min(game.canvasHeight - margin, this.y + this.vy * deltaTime));
        
        // HP Regeneration
        if (this.hp < this.maxHP && this.hp > 0 && this.hpRegen > 0) {
            this.hp = Math.min(this.maxHP, this.hp + this.hpRegen * deltaTime);
        }
        
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
    
    takeDamage(amount) {
        const now = performance.now() / 1000;
        if (now < this.invulnUntil) return;

        this.hp -= amount;
        if (this.hp < 0) this.hp = 0;
        this.hurtFlashUntil = now + 0.2;
        this.invulnUntil = now + 0.45;
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
        if (now - this.lastAttackTime < 1 / this.attackSpeed) return;
        
        const targets = [];
        const rangeSquared = this.attackRange * this.attackRange;
        
        for (const enemy of enemyList) {
            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const distanceSquared = dx * dx + dy * dy;
            
            if (distanceSquared < rangeSquared) targets.push({ enemy, distanceSquared });
        }
        
        if (!targets.length) return;
        
        // Nearest first, so a volley always spends itself on the closest threats
        targets.sort((a, b) => a.distanceSquared - b.distanceSquared);
        
        const shots = Math.max(1, Math.round(this.multishot));
        const inRange = targets.map((t) => t.enemy);
        const hitTargets = inRange.slice(0, shots);
        // Fewer enemies in range than shots: the extra shots stack on the nearest
        for (let i = hitTargets.length; i < shots; i++) hitTargets.push(inRange[0]);
        
        for (const enemy of hitTargets) {
            // Deal damage
            const { damage, critical } = this.calculateDamage(this.attackPower);
            enemy.hp -= damage;
            enemy.hitFlashUntil = performance.now() / 1000 + 0.12;
            spawnHit(enemy.x, enemy.y, enemy.color, damage, critical);
            
            // Track damage
            game.addDamageDealt(damage);
            
            // Visual effect and sound
            audio.play('hit');
        }
        
        // Cooldown
        this.lastAttackTime = performance.now() / 1000;
    },
    
    // Returns the crit flag with the damage so the caller never has to infer
    // it from the numbers (a crit at exactly 100% would look like a normal hit).
    calculateDamage(attackPower) {
        const critical = Math.random() * 100 < this.criticalChance;
        return {
            damage: critical ? attackPower * (this.criticalDamage / 100) : attackPower,
            critical
        };
    }
};
