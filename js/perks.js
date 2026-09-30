// Perk system - two tiers per stat, unlocked by overcommitting points into
// that one stat. Thresholds are bonus percent over base, which is the number
// the stat screen already shows, so the player can always see how close the
// next perk is.
//
// Milestones are deliberately steep. A level hands out 3 points, so tier 1 costs
// roughly 4 levels of single-stat focus and tier 2 roughly 8. The percentage
// numbers look huge on the compounding stats (HP, Attack Power, Echo Power) and
// that is the point: their bonuses inflate fast, so the milestone has to inflate
// faster to stay a real commitment. The flat and capped stats carry ordinary
// numbers for the same cost.
//
// Perks are derived from resolved stats, never stored: spend a point, and the
// perk unlocks (or relocks when a run resets) automatically. That keeps them
// consistent with the compounding stat ladder and avoids a second source of
// truth to save and restore.
import { upgradeSystem } from './upgrades.js';

// Echo Cooldown improves as it goes down, so its "bonus" is the reduction.
const INVERSE_STATS = new Set(['echoCooldown']);

// Display order of the perk groups, matching the stat screen.
export const PERK_STATS = [
    'hp', 'hpRegen', 'moveSpeed', 'attackPower', 'attackSpeed', 'attackRange',
    'criticalChance', 'criticalDamage', 'echoPower', 'echoDuration',
    'echoCooldown', 'multishot'
];

export const PERKS = [
    // HP
    { id: 'stonewall', stat: 'hp', tier: 1, threshold: 600, name: 'Stonewall',
      description: 'A hit that would kill you leaves you at 1 HP instead. Once per wave.' },
    { id: 'juggernaut', stat: 'hp', tier: 2, threshold: 2500, name: 'Juggernaut',
      description: 'Contact hits can never take more than 15% of your max HP.' },

    // HP Regen
    { id: 'bleedout', stat: 'hpRegen', tier: 1, threshold: 200, name: 'Bleedout',
      description: 'Regeneration keeps running even while you are being hit.' },
    { id: 'secondWind', stat: 'hpRegen', tier: 2, threshold: 900, name: 'Second Wind',
      description: 'Below 30% HP, recover to 60% HP every 20 seconds.' },

    // Move Speed
    { id: 'slipstream', stat: 'moveSpeed', tier: 1, threshold: 60, name: 'Slipstream',
      description: 'Move 25% faster after 3 seconds without taking damage.' },
    { id: 'momentum', stat: 'moveSpeed', tier: 2, threshold: 200, name: 'Momentum',
      description: 'Each kill grants +8% move speed for 2 seconds. Kills stack, up to 10.' },

    // Attack Power
    { id: 'executioner', stat: 'attackPower', tier: 1, threshold: 400, name: 'Executioner',
      description: 'Deal double damage to enemies below 25% HP.' },
    { id: 'shatter', stat: 'attackPower', tier: 2, threshold: 1200, name: 'Shatter',
      description: 'Slaying an enemy detonates it, dealing 40% of its max HP to nearby foes.' },

    // Attack Speed
    { id: 'doubleTap', stat: 'attackSpeed', tier: 1, threshold: 250, name: 'Double Tap',
      description: 'Every 4th attack fires twice.' },
    { id: 'flurry', stat: 'attackSpeed', tier: 2, threshold: 1400, name: 'Flurry',
      description: 'Land 6 attacks in a row and the next 3 ignore your attack cooldown.' },

    // Attack Range
    { id: 'pierce', stat: 'attackRange', tier: 1, threshold: 80, name: 'Pierce',
      description: 'Shots pass through and hit everything lined up in their path.' },
    { id: 'mark', stat: 'attackRange', tier: 2, threshold: 160, name: 'Mark',
      description: 'Enemies inside your range are marked and take +20% damage from all sources.' },

    // Critical Chance
    // Critical Chance caps at +400%, which it reaches in 9 points. The cap is the
    // gate here, so these two milestones cannot be spread as far apart as the
    // compounding stats allow.
    { id: 'weakSpot', stat: 'criticalChance', tier: 1, threshold: 200, name: 'Weak Spot',
      description: 'Critical hits deal +50% critical damage.' },
    { id: 'chainCrit', stat: 'criticalChance', tier: 2, threshold: 400, name: 'Chain Crit',
      description: 'A killing critical chains half your attack power to the 2 nearest enemies.' },

    // Critical Damage
    { id: 'bloodthirst', stat: 'criticalDamage', tier: 1, threshold: 60, name: 'Bloodthirst',
      description: 'Every critical hit heals you for 3 HP.' },
    { id: 'deepCut', stat: 'criticalDamage', tier: 2, threshold: 100, name: 'Deep Cut',
      description: 'Critical hits slow the target by 40% for 2 seconds.' },

    // Echo Power
    // Echo Power compounds at 25% per point, the steepest stat in the game, so its
    // milestones carry the largest numbers here
    { id: 'resonance', stat: 'echoPower', tier: 1, threshold: 1200, name: 'Resonance',
      description: 'The Echo deals double damage on its final quarter of the replay.' },
    { id: 'twinEcho', stat: 'echoPower', tier: 2, threshold: 20000, name: 'Twin Echo',
      description: 'Echo Shift immediately replays a second time at 50% power.' },

    // Echo Duration
    { id: 'lingeringMark', stat: 'echoDuration', tier: 1, threshold: 200, name: 'Lingering Mark',
      description: 'Enemies the Echo touches stay marked for 4 seconds and take +25% damage.' },
    { id: 'neverFade', stat: 'echoDuration', tier: 2, threshold: 1000, name: 'Never Fade',
      description: 'When the Echo finishes, every marked enemy detonates.' },

    // Echo Cooldown
    // Echo Cooldown floors at 2s, so +86% is the absolute ceiling; tier 2 sits just
    // under it and is reachable in 15 points, the whole stat
    { id: 'quickRecall', stat: 'echoCooldown', tier: 1, threshold: 50, name: 'Quick Recall',
      description: 'Echo Shift can be triggered again while a replay is still running.' },
    { id: 'echoStorm', stat: 'echoCooldown', tier: 2, threshold: 85, name: 'Echo Storm',
      description: 'While an Echo replay is running, your attack rate is doubled.' },

    // Multishot
    { id: 'bounce', stat: 'multishot', tier: 1, threshold: 500, name: 'Bounce',
      description: 'The 3rd shot of a volley ricochets to one more enemy for 50% damage.' },
    { id: 'storm', stat: 'multishot', tier: 2, threshold: 1100, name: 'Storm',
      description: 'Each shot after the first in a volley deals +15% damage.' }
];

const PERK_BY_ID = new Map(PERKS.map((perk) => [perk.id, perk]));
const PERKS_BY_STAT = new Map();
for (const perk of PERKS) {
    if (!PERKS_BY_STAT.has(perk.stat)) PERKS_BY_STAT.set(perk.stat, []);
    PERKS_BY_STAT.get(perk.stat).push(perk);
}

const unlocked = new Set();

export const perks = {
    // Bonus percent over base for a stat. This is the exact number the stat
    // screen prints as "Bonus", so a perk threshold is directly comparable to
    // what the player can see.
    bonusPercent(statKey) {
        const def = upgradeSystem.stats[statKey];
        if (!def) return 0;
        const stats = upgradeSystem.getStats();
        const current = stats[statKey];
        if (INVERSE_STATS.has(statKey)) {
            return def.base === 0 ? 0 : ((def.base - current) / def.base) * 100;
        }
        return def.base === 0 ? 0 : ((current - def.base) / def.base) * 100;
    },

    isUnlocked(perkId) {
        return unlocked.has(perkId);
    },

    has(perkId) {
        return unlocked.has(perkId);
    },

    // Recomputes every perk from current stats. Returns the perks that unlocked
    // on this refresh, so the caller can celebrate them exactly once.
    refresh() {
        const fresh = [];
        for (const perk of PERKS) {
            const isNowUnlocked = perks.bonusPercent(perk.stat) >= perk.threshold;
            if (isNowUnlocked && !unlocked.has(perk.id)) {
                fresh.push(perk);
            }
            if (isNowUnlocked) unlocked.add(perk.id);
            else unlocked.delete(perk.id);
        }
        return fresh;
    },

    getUnlocked() {
        return PERKS.filter((perk) => unlocked.has(perk.id));
    },

    // Perks for one stat, tier 1 then tier 2, with live unlock state.
    getForStat(statKey) {
        return (PERKS_BY_STAT.get(statKey) || []).map((perk) => ({
            ...perk,
            unlocked: unlocked.has(perk.id)
        }));
    },

    // The cheapest perk this stat has not earned yet, for progress display.
    getNextLocked(statKey) {
        return (PERKS_BY_STAT.get(statKey) || []).find((perk) => !unlocked.has(perk.id)) || null;
    },

    byId(perkId) {
        return PERK_BY_ID.get(perkId) || null;
    },

    reset() {
        unlocked.clear();
    }
};
