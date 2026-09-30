// Upgrade/stat system - 12 RPG stats with meaningful effects.
// Most offensive and survival stats scale by a percentage of their base value
// per point spent, so early and late points stay equally meaningful.
export const upgradeSystem = {
    stats: {
        // 1. HP - Maximum health
        hp: { base: 10, points: 0, percentPerPoint: 0.08, integer: true },

        // 2. HP Regeneration - HP/sec when not taking damage
        hpRegen: { base: 1, points: 0, percentPerPoint: 0.10 },

        // 3. Move Speed - Pixels per second
        moveSpeed: { base: 180, points: 0, percentPerPoint: 0.05, round: 'floor' },

        // 4. Attack Power - Base damage
        attackPower: { base: 10, points: 0, percentPerPoint: 0.10 },

        // 5. Attack Speed - Attacks per second
        attackSpeed: { base: 1.0, points: 0, percentPerPoint: 0.12 },

        // 6. Attack Range - Pixels to target
        attackRange: { base: 150, points: 0, increment: 10 },

        // 7. Critical Chance - Percent
        criticalChance: { base: 5, points: 0, percentPerPoint: 0.15, min: 0, max: 25 },

        // 8. Critical Damage - Percent multiplier
        criticalDamage: { base: 150, points: 0, percentPerPoint: 0.03, min: 100, max: 300 },

        // 9. Echo Power - Echo damage multiplier
        echoPower: { base: 1.0, points: 0, percentPerPoint: 0.25, min: 0.5 },

        // 10. Echo Duration - Seconds echo lasts
        echoDuration: { base: 3.0, points: 0, percentPerPoint: 0.10, min: 1.0 },

        // 11. Echo Cooldown - Seconds before echo reuse
        echoCooldown: { base: 15.0, points: 0, increment: -1.0, min: 2.0 },

        // 12. Fragment Magnet Range - Pixels to attract fragments
        fragmentMagnet: { base: 150, points: 0, increment: 30 }
    },
    
    // Level-up awards +3 stat points (from Level 2 onwards)
    levelUpPoints: 3,
    
    // Current stat points available
    availablePoints: 0,
    
    // Stats are per-run: a run always starts from base values, and only
    // lifetime records (time, level, kills) survive a reload.
    init() {
        this.reset();
    },
    
    reset() {
        this.availablePoints = 0;
        for (const key of Object.keys(this.stats)) {
            this.stats[key].points = 0;
        }
        this.recalculateAllStats();
    },
    
    // One place decides how a stat grows, so the stat screen and the player
    // always read the same numbers.
    resolveStat(def) {
        const percent = def.percentPerPoint || 0;
        let value = def.base * (1 + def.points * percent) + (def.increment || 0) * def.points;

        if (def.integer) {
            value = Math.round(value);
        } else if (def.round === 'floor') {
            value = Math.floor(value);
        } else {
            // Trims float noise from repeated multiplications
            value = Math.round(value * 100) / 100;
        }

        if (def.min !== undefined) value = Math.max(def.min, value);
        if (def.max !== undefined) value = Math.min(def.max, value);
        return value;
    },

    recalculateAllStats() {
        const playerStats = {};
        for (const key of Object.keys(this.stats)) {
            const def = this.stats[key];
            def.current = this.resolveStat(def);
            playerStats[key] = def.current;
        }
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
        return this.addPoint(statKey);
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
        
        if (this.onPointSpent) this.onPointSpent(statKey);
        
        return true;
    }
};

// Initialize from base values when the module loads
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
