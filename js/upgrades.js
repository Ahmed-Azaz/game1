// Upgrade/stat system - 12 RPG stats with meaningful effects
export const upgradeSystem = {
    // Stat base values (will be modified by points)
    stats: {
        // 1. HP - Maximum health
        hp: { base: 10, points: 0, increment: 1 },
        
        // 2. HP Regeneration - HP/sec when not taking damage
        hpRegen: { base: 0, points: 0, increment: 1 },
        
        // 3. Move Speed - Pixels per second
        moveSpeed: { base: 180, points: 0, increment: 7, percentPerPoint: 0.05 },
        
        // 4. Attack Power - Base damage
        attackPower: { base: 10, points: 0, increment: 1 },
        
        // 5. Attack Speed - Attacks per second
        attackSpeed: { base: 1.0, points: 0, increment: 0.15 },
        
        // 6. Attack Range - Pixels to target
        attackRange: { base: 50, points: 0, increment: 5 },
        
        // 7. Critical Chance - Percent
        criticalChance: { base: 5, points: 0, increment: 0.75 },
        
        // 8. Critical Damage - Percent multiplier
        criticalDamage: { base: 150, points: 0, increment: 5 },
        
        // 9. Echo Power - Echo damage multiplier
        echoPower: { base: 1.0, points: 0, increment: 0.5 },
        
        // 10. Echo Duration - Seconds echo lasts
        echoDuration: { base: 3.0, points: 0, increment: 0.5 },
        
        // 11. Echo Cooldown - Seconds before echo reuse
        echoCooldown: { base: 15.0, points: 0, increment: -1.0, min: 2.0 },
        
        // 12. Fragment Magnet Range - Pixels to attract fragments
        fragmentMagnet: { base: 150, points: 0, increment: 30 }
    },
    
    // Level-up awards +3 stat points (from Level 2 onwards)
    levelUpPoints: 3,
    
    // Current stat points available
    availablePoints: 0,
    
    init() {
        // Load saved points if any
        const saved = localStorage.getItem('echoRift_stats');
        if (saved) {
            const data = JSON.parse(saved);
            this.availablePoints = data.availablePoints || 0;
            // Apply saved points to stats
            for (const key of Object.keys(this.stats)) {
                if (data.stats && data.stats[key] !== undefined) {
                    this.stats[key].points = Math.max(0, data.stats[key].points || 0);
                }
            }
        }
        this.recalculateAllStats();
    },
    
    reset() {
        this.availablePoints = 0;
        for (const key of Object.keys(this.stats)) {
            this.stats[key].points = 0;
        }
        this.recalculateAllStats();
        try {
            localStorage.removeItem('echoRift_stats');
        } catch (e) {}
    },
    
    recalculateAllStats() {
        // Recalculate all current values from base + points
        const playerStats = {};
        
        // 1. HP: Base + (points * increment)
        this.stats.hp.current = this.stats.hp.base + (this.stats.hp.points * this.stats.hp.increment);
        
        // 2. HP Regeneration: Base + (points * increment)
        this.stats.hpRegen.current = this.stats.hpRegen.base + (this.stats.hpRegen.points * this.stats.hpRegen.increment);
        
        // 3. Move Speed: Base * (1 + points * 5%) - matches example: 180 * 1.15 = 207
        this.stats.moveSpeed.current = Math.floor(this.stats.moveSpeed.base * (1 + this.stats.moveSpeed.points * this.stats.moveSpeed.percentPerPoint));
        
        // 4. Attack Power: Base + (points * increment)
        this.stats.attackPower.current = this.stats.attackPower.base + (this.stats.attackPower.points * this.stats.attackPower.increment);
        
        // 5. Attack Speed: Base + (points * increment)
        this.stats.attackSpeed.current = this.stats.attackSpeed.base + (this.stats.attackSpeed.points * this.stats.attackSpeed.increment);
        
        // 6. Attack Range: Base + (points * increment)
        this.stats.attackRange.current = this.stats.attackRange.base + (this.stats.attackRange.points * this.stats.attackRange.increment);
        
        // 7. Critical Chance: Base% + (points * increment)%
        this.stats.criticalChance.current = Math.max(0, Math.min(25, this.stats.criticalChance.base + (this.stats.criticalChance.points * this.stats.criticalChance.increment)));
        
        // 8. Critical Damage: Base% + (points * increment)%
        this.stats.criticalDamage.current = Math.max(100, Math.min(300, this.stats.criticalDamage.base + (this.stats.criticalDamage.points * this.stats.criticalDamage.increment)));
        
        // 9. Echo Power: Base + (points * increment)
        this.stats.echoPower.current = Math.max(0.5, this.stats.echoPower.base + (this.stats.echoPower.points * this.stats.echoPower.increment));
        
        // 10. Echo Duration: Base + (points * increment) seconds
        this.stats.echoDuration.current = Math.max(1.0, this.stats.echoDuration.base + (this.stats.echoDuration.points * this.stats.echoDuration.increment));
        
        // 11. Echo Cooldown: Base - (points * increment) seconds, min 2.0
        this.stats.echoCooldown.current = Math.max(this.stats.echoCooldown.min, this.stats.echoCooldown.base + (this.stats.echoCooldown.points * this.stats.echoCooldown.increment));
        
        // 12. Fragment Magnet: Base + (points * increment) pixels
        this.stats.fragmentMagnet.current = this.stats.fragmentMagnet.base + (this.stats.fragmentMagnet.points * this.stats.fragmentMagnet.increment);
        
        // Update available points (every level up from Level 2 gives +3)
        // This is managed in game.js level up logic
        
        // Build flat snapshot of current values
        playerStats.hp = this.stats.hp.current;
        playerStats.hpRegen = this.stats.hpRegen.current;
        playerStats.moveSpeed = this.stats.moveSpeed.current;
        playerStats.attackPower = this.stats.attackPower.current;
        playerStats.attackSpeed = this.stats.attackSpeed.current;
        playerStats.attackRange = this.stats.attackRange.current;
        playerStats.criticalChance = this.stats.criticalChance.current;
        playerStats.criticalDamage = this.stats.criticalDamage.current;
        playerStats.echoPower = this.stats.echoPower.current;
        playerStats.echoDuration = this.stats.echoDuration.current;
        playerStats.echoCooldown = this.stats.echoCooldown.current;
        playerStats.fragmentMagnet = this.stats.fragmentMagnet.current;
        
        return playerStats;
    },
    
    getStats() {
        return this.recalculateAllStats();
    },
    
    getAvailablePoints() {
        return this.availablePoints;
    },
    
    addStatPoints(amount) {
        this.availablePoints = Math.max(0, this.availablePoints + amount);
        return this.availablePoints;
    },
    
    spendStatPoint(statKey) {
        if (this.availablePoints <= 0) return false;
        if (!this.stats[statKey]) return false;
        
        // Spend a point
        this.stats[statKey].points += 1;
        this.availablePoints -= 1;
        
        // Recalculate stats
        this.recalculateAllStats();
        saveStats();
        
        import('./game.js').then(game => {
            if (game.gameState) game.gameState.statPointsSpent++;
        });
        
        return true;
    },
    
    canSpendPoint(statKey) {
        if (this.availablePoints <= 0) return false;
        if (!this.stats[statKey]) return false;
        return true;
    },
    
    // For adding points (from level up or UI)
    addPoint(statKey) {
        if (this.availablePoints <= 0) return false;
        if (!this.stats[statKey]) return false;
        
        this.stats[statKey].points += 1;
        this.availablePoints -= 1;
        
        this.recalculateAllStats();
        saveStats();
        
        import('./game.js').then(game => {
            if (game.gameState) game.gameState.statPointsSpent++;
        });
        
        return true;
    },
    
    save() {
        try {
            localStorage.setItem('echoRift_stats', JSON.stringify({
                availablePoints: this.availablePoints,
                stats: this.stats
            }));
        } catch (e) {
            // Save failed - continue normally
        }
    }
};

function saveStats() {
    try {
        upgradeSystem.save();
    } catch (e) {
        // Save failed - continue normally
    }
}

// Initialize on load
upgradeSystem.init();

// Export for use by other modules
export function getStats() {
    return upgradeSystem.recalculateAllStats();
}

export function getAvailablePoints() {
    return upgradeSystem.availablePoints;
}

export function trySpendPoint(statKey) {
    return upgradeSystem.spendStatPoint(statKey);
}