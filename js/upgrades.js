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
        multishot: { base: 1, points: 0, increment: 1, cost: 3 },

        // Skill parts for Time Dilation
        tdPower: { base: 0.35, points: 0, increment: -0.01, min: 0.15, max: 0.5 },
        tdDuration: { base: 3.0, points: 0, percentPerPoint: 0.10 },
        tdCooldown: { base: 20.0, points: 0, increment: -1.0, min: 4.0 },
        tdSlowCap: { base: 0.15, points: 0, increment: 0.04, min: 0, max: 0.4 },

        // Skill parts for Phase Dash
        pdDistance: { base: 90, points: 0, percentPerPoint: 0.05, round: 'ceil', min: 60, max: 260 },
        pdIFrames: { base: 0.35, points: 0, increment: 0.03, min: 0.2, max: 0.8 },
        pdCooldown: { base: 6.0, points: 0, increment: -0.25, min: 2.0 },
        pdChargedDash: { base: 0, points: 0, increment: 0.2, min: 0, max: 1.0 },

        // Skill parts for Void Nova
        vnRadius: { base: 90, points: 0, percentPerPoint: 0.08, round: 'ceil', min: 40, max: 140 },
        vnForce: { base: 1.0, points: 0, percentPerPoint: 0.1 },
        vnCooldown: { base: 12.0, points: 0, increment: -0.75, min: 3.0 },
        // 0.2 per point so the inversion at halfway (5 points) and the cap at 1.0
        // (5 more) are both a real spend rather than two clicks
        vnGravityWell: { base: 0, points: 0, increment: 0.2, min: 0, max: 1.0 },
    },

    // Stats that belong to a skill rather than to the character, and are bought
    // with ability points. They stay in `stats` so perks and the resolved stat
    // block keep working unchanged; only the currency they spend is different.
    skillStats: ['echoPower', 'echoDuration', 'echoCooldown', 'tdPower', 'tdDuration', 'tdCooldown', 'tdSlowCap', 'pdDistance', 'pdIFrames', 'pdCooldown', 'pdChargedDash', 'vnRadius', 'vnForce', 'vnCooldown', 'vnGravityWell'],

    isSkillStat(statKey) {
        return this.skillStats.indexOf(statKey) !== -1;
    },

    // Stat points a single point of this stat costs. Multishot is 3, everything
    // else is the default 1.
    statCost(statKey) {
        const def = this.stats[statKey];
        return (def && def.cost) || 1;
    },
    
    // Level-up awards +3 stat points (from Level 2 onwards)
    levelUpPoints: 3,

    // ...and a separate +3 ability points for the skill stats. Two currencies
    // keep a player from having to choose between a stat and the skill they use
    // every few seconds, and it leaves room to give a skill its own economy.
    levelUpAbilityPoints: 3,
    
    // Current stat points available
    availablePoints: 0,

    // Current ability points available, spent only in the Skills tab
    availableAbilityPoints: 0,
    
    // Stats are per-run: a run always starts from base values, and only
    // lifetime records (time, level, kills) survive a reload.
    init() {
        this.reset();
    },
    
    reset() {
        this.availablePoints = 0;
        this.availableAbilityPoints = 0;
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

    getAvailableAbilityPoints() {
        return this.availableAbilityPoints;
    },
    
    addStatPoints(amount) {
        this.availablePoints = Math.max(0, this.availablePoints + amount);
        return this.availablePoints;
    },

    addAbilityPoints(amount) {
        this.availableAbilityPoints = Math.max(0, this.availableAbilityPoints + amount);
        return this.availableAbilityPoints;
    },

    // The pool a stat spends from. Skill stats are paid for in ability points,
    // everything else in stat points.
    pointsFor(statKey) {
        return this.isSkillStat(statKey) ? this.availableAbilityPoints : this.availablePoints;
    },
    
    spendStatPoint(statKey) {
        return this.addPoint(statKey);
    },
    
    canSpendPoint(statKey) {
        if (!this.stats[statKey]) return false;
        if (this.isMaxed(statKey)) return false;
        return this.pointsFor(statKey) >= this.statCost(statKey);
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
        // A zero-based part (Charged Dash, Gravity Well, Slow Cap) starts sitting
        // on its own floor, so the floor only counts as reached once a point has
        // actually been spent on it. Otherwise the row would read MAX before the
        // player had bought anything.
        if (def.min !== undefined && current <= def.min && def.points > 0) return true;
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
        const isSkill = this.isSkillStat(statKey);
        if (this.pointsFor(statKey) < cost) return false;
        
        this.stats[statKey].points += 1;
        if (isSkill) this.availableAbilityPoints -= cost;
        else this.availablePoints -= cost;
        
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

export function getAvailableAbilityPoints() {
    return upgradeSystem.availableAbilityPoints;
}

export function trySpendPoint(statKey) {
    return upgradeSystem.spendStatPoint(statKey);
}
