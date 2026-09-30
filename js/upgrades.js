// Upgrade/stat system - 12 RPG stats with meaningful effects.
// Percentage stats multiply their CURRENT value on every point spent, so the
// 20th point is worth as much as the 1st instead of adding a flat number.
export const upgradeSystem = {
    stats: {
        // 1. HP - Maximum health
        hp: { base: 100, points: 0, percentPerPoint: 0.15, round: 'ceil' },

        // 2. HP Regeneration - HP/sec when not taking damage
        hpRegen: { base: 1, points: 0, percentPerPoint: 0.10 },

        // 3. Move Speed - Pixels per second
        moveSpeed: { base: 180, points: 0, percentPerPoint: 0.05, round: 'floor' },

        // 4. Attack Power - Base damage
        attackPower: { base: 10, points: 0, percentPerPoint: 0.10, round: 'ceil' },

        // 5. Attack Speed - Attacks per second
        attackSpeed: { base: 1.0, points: 0, percentPerPoint: 0.12 },

// 6. Attack Range - Pixels to target
// Capped at 300 (15 points). Uncapped, a long enough ladder trivialises enemy
// spacing and lets you hit the whole arena from the spawn point.
attackRange: { base: 150, points: 0, increment: 10, min: 0, max: 300 },

        // 7. Critical Chance - Percent
        criticalChance: { base: 5, points: 0, percentPerPoint: 0.15, round: 'ceil', min: 0, max: 25 },

        // 8. Critical Damage - Percent multiplier
        criticalDamage: { base: 150, points: 0, percentPerPoint: 0.03, round: 'ceil', min: 100, max: 300 },

        // 9. Echo Power - Echo damage multiplier
        echoPower: { base: 1.0, points: 0, percentPerPoint: 0.25 },

        // 10. Echo Duration - Seconds echo lasts
        echoDuration: { base: 3.0, points: 0, percentPerPoint: 0.10 },

        // 11. Echo Cooldown - Seconds before echo reuse
        echoCooldown: { base: 15.0, points: 0, increment: -1.0, min: 2.0 },

        // 12. Multishot - Enemies hit by a single attack volley. Expensive
        // because one point multiplies everything the player does per swing.
        multishot: { base: 1, points: 0, increment: 1, cost: 3 }
    },

    // Stat points a single point of this stat costs. Multishot is 3, everything
    // else is the default 1.
    statCost(statKey) {
        const def = this.stats[statKey];
        return (def && def.cost) || 1;
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
    
    // Grows the CURRENT value by one point. Percentages multiply what the stat
    // already is (10 -> 11 -> 13 for 10%), and ceil keeps a small fractional
    // gain such as 11 * 1.1 = 12.1 visible instead of rounding it away.
    growOnce(def, value) {
        const EPSILON = 1e-9; // keeps 10 * 1.1 = 11.000000000000002 at 11
        let next;
        if (def.percentPerPoint) {
            const grown = value * (1 + def.percentPerPoint);
            if (def.round === 'ceil') next = Math.ceil(grown - EPSILON);
            else if (def.round === 'floor') next = Math.floor(grown);
            else next = Math.round(grown * 100) / 100;
        } else {
            next = value + (def.increment || 0);
        }
        if (def.min !== undefined) next = Math.max(def.min, next);
        if (def.max !== undefined) next = Math.min(def.max, next);
        return next;
    },

    // The growth path only depends on base and rate, so it is built once and
    // reused instead of recomputed on every stat screen render.
    resolveStat(def) {
        const rate = def.percentPerPoint || 0;
        if (def._pathBase !== def.base || def._pathRate !== rate || def._pathIncrement !== def.increment) {
            def._pathBase = def.base;
            def._pathRate = rate;
            def._pathIncrement = def.increment;
            def._path = [def.base];
        }
        while (def._path.length <= def.points) {
            def._path.push(this.growOnce(def, def._path[def._path.length - 1]));
        }
        return def._path[def.points];
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
        if (!this.stats[statKey]) return false;
        if (this.isMaxed(statKey)) return false;
        return this.availablePoints >= this.statCost(statKey);
    },

    // True when another point cannot move this stat at all, because the ladder
    // has reached the stat's own ceiling or floor: Critical Chance caps at 25%,
    // Critical Damage at 300%, Echo Cooldown bottoms out at 2s. Spending into a
    // capped stat used to burn points for nothing, so the UI and the hotkeys
    // both check this first.
    isMaxed(statKey) {
        const def = this.stats[statKey];
        if (!def) return false;
        const current = this.resolveStat(def);
        if (def.max !== undefined && current >= def.max) return true;
        if (def.min !== undefined && current <= def.min) return true;
        return false;
    },

    // Every stat currently at its ceiling, for the "no points left to spend
    // here" messaging.
    getMaxedStats() {
        return Object.keys(this.stats).filter((key) => this.isMaxed(key));
    },

    // For adding points (from level up or UI)
    addPoint(statKey) {
        if (!this.stats[statKey]) return false;
        if (this.isMaxed(statKey)) return false;

        const cost = this.statCost(statKey);
        if (this.availablePoints < cost) return false;
        
        this.stats[statKey].points += 1;
        this.availablePoints -= cost;
        
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
