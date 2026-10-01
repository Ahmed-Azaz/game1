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
// Time Dilation Power works the same way: points make the world slower, and the
// milestone is measured against how much slower, not how much faster.
const INVERSE_STATS = new Set(['echoCooldown', 'tdPower']);

// Display order of the perk groups, matching the stat screen.
export const PERK_STATS = [
    'hp', 'hpRegen', 'moveSpeed', 'attackPower', 'attackSpeed', 'attackRange',
    'criticalChance', 'criticalDamage', 'echoPower', 'echoDuration',
    'echoCooldown', 'tdPower', 'pdDistance', 'pdIFrames', 'pdChargedDash',
    'vnGravityWell', 'vnForce', 'vnRadius', 'multishot'
];

export const PERKS = [
// HP
    // Aegis leads the HP ladder on purpose: it costs about ten points against
    // Stonewall's forty, so the first HP milestone arrives early and teaches
    // the contact/projectile split that Juggernaut later formalises.
    { id: 'aegis', stat: 'hp', tier: 1, threshold: 150, name: 'Aegis',
      description: 'While you are above half HP, projectile damage is halved. Contact hits are not covered.' },
    { id: 'stonewall', stat: 'hp', tier: 2, threshold: 600, name: 'Stonewall',
      description: 'A hit that would kill you leaves you at 1 HP instead. Once per wave.' },
    { id: 'juggernaut', stat: 'hp', tier: 3, threshold: 2500, name: 'Juggernaut',
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
// The whole ladder is 15 points (150 -> 300), i.e. a 100% bonus is the hard
// ceiling, so the tiers sit at 6 and 12 points. The old 80/160 pair put tier 2
// at 390 range, which the cap makes impossible.
{ id: 'pierce', stat: 'attackRange', tier: 1, threshold: 40, name: 'Pierce',
      description: 'Shots pass through and hit everything lined up in their path.' },
    { id: 'mark', stat: 'attackRange', tier: 2, threshold: 80, name: 'Mark',
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

    // Time Dilation
    // Power is an inverse stat: spending points lowers the world's speed, so its
    // "bonus" is the reduction, same treatment as echoCooldown.
    // Thresholds are the percentage of world speed removed (base 0.35). Tier 1
    // lands near 5 points and tier 2 near 10, both short of the 0.15 floor,
    // which keeps the second tier a real commitment rather than an inevitability.
    { id: 'deepFreeze', stat: 'tdPower', tier: 1, threshold: 14, name: 'Deep Freeze',
      description: 'While the world is dilated your own attacks also slow, but deal +30% damage.' },
    { id: 'reflex', stat: 'tdPower', tier: 2, threshold: 29, name: 'Reflex',
      description: 'Taking a hit while dilated ends the slow early and refunds half its cooldown.' },

    // Phase Dash
    { id: 'phaseEcho', stat: 'pdDistance', tier: 1, threshold: 40, name: 'Phase Echo',
      description: 'Dashing leaves a burning afterimage along the line you crossed.' },
    { id: 'slipstreamDash', stat: 'pdDistance', tier: 2, threshold: 90, name: 'Slipstream',
      description: 'Each enemy you dash through refunds 50% of the dash cooldown.' },

    { id: 'untouchable', stat: 'pdIFrames', tier: 1, threshold: 60, name: 'Untouchable',
      description: 'Your dash ends with a small nova that pushes enemies away.' },
    { id: 'phaseCharged', stat: 'pdChargedDash', tier: 1, threshold: 50, name: 'Heavy Phase',
      description: 'A charged dash deals damage to everything it passes through.' },

    // Void Nova
    { id: 'singularity', stat: 'vnGravityWell', tier: 1, threshold: 100, name: 'Singularity',
      description: 'Enemies dragged in by the Gravity Well take +40% damage.' },
    { id: 'shockwave', stat: 'vnForce', tier: 1, threshold: 60, name: 'Shockwave',
      description: 'The nova interrupts enemy windups, cancelling charged attacks.' },
    { id: 'eventHorizon', stat: 'vnRadius', tier: 1, threshold: 60, name: 'Event Horizon',
      description: 'The nova radius grows 20% while you are standing still.' },

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
        // Parts that start at zero (Charged Dash, Gravity Well, Slow Cap) cannot
        // be measured against a base of zero, so they are measured against the
        // rest of their own ladder instead. A perk on one of these is then read
        // as "how far up this part have you pushed it", which is what the player
        // is actually buying.
        if (def.base === 0) {
            const span = (def.max || 0) - (def.min || 0);
            if (span <= 0) return 0;
            return ((current - (def.min || 0)) / span) * 100;
        }
        if (INVERSE_STATS.has(statKey)) {
            return ((def.base - current) / def.base) * 100;
        }
        return ((current - def.base) / def.base) * 100;
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
