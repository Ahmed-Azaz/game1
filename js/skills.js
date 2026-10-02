// Skill registry: which skill is equipped, and how much cooldown each one has
// left.
//
// Only one skill is equipped at a time and there is a single cooldown
// indicator for it, so the player never has to track four timers at once. The
// other skills keep their cooldown running while unequipped: switching back to a
// skill that is still recharging shows its own remaining time, which is the
// whole point of keeping per-skill clocks rather than one global one.
//
// This module is deliberately free of game-system imports. Each skill's
// activation lives in game.js, which already holds the player, the enemies and
// the visual effects, and importing those back here would close an import cycle
// (player.js -> game.js -> this module).
//
// Cooldowns are accumulated rather than stamped against wall time, so they are
// ticked from the game's update and therefore freeze on pause for free.
import { upgradeSystem } from './upgrades.js';

export const SKILLS = {
    echo_shift: {
        id: 'echo_shift',
        name: 'Echo Shift',
        shortName: 'ECHO',
        // Taken from the line the trail actually draws: #4fdeeb is the mid stroke
        // and #b8ffff the head. The cooldown circle uses these so the two are
        // unmistakably the same skill.
        color: '#4fdeeb',
        accent: '#b8ffff',  // Echo Shift's colour is unchanged: you named the other
        // three, and this one already matches the line it draws.
        key: 'SPACE',
        cooldownStat: 'echoCooldown',
        description: 'Freeze the path you just walked and send an echo back along it. The line snaps into place almost instantly, then stands as a solid wall that enemies cannot cross.',
        parts: [
            { stat: 'echoPower', label: 'Echo Power' },
            { stat: 'echoDuration', label: 'Echo Duration' },
            { stat: 'echoCooldown', label: 'Echo Cooldown' }
        ]
    },
    time_dilation: {
        id: 'time_dilation',
        name: 'Time Dilation',
        shortName: 'DILATE',
        // Pale cyan: reads as "the world turned to ice"
        // Amber: the dilation is warm rather than cold, so it never reads as the Echo's
        // cyan wall. accent is the pale rim on the player.
        color: '#ffb84d',
        accent: '#ffe6bd',
        key: '1',
        cooldownStat: 'tdCooldown',
        description: 'The world drops into syrup while you keep your speed. Threats slow to a crawl, which is the only way to read a Rift Lance or a gravity well in time. Pushing the world deeper costs you your own movement.',
        parts: [
            { stat: 'tdPower', label: 'Dilation Power' },
            { stat: 'tdDuration', label: 'Duration' },
            { stat: 'tdCooldown', label: 'Cooldown' },
            { stat: 'tdSlowCap', label: 'Slow Cap' }
        ]
    },
    phase_dash: {
        id: 'phase_dash',
        name: 'Phase Dash',
        shortName: 'DASH',
        // Pale silver: reads as a clean blink rather than an explosion, and stays
        // legible over a busy arena because it is the brightest of the four.
        color: '#f2f6ff',
        accent: '#ffffff',
        key: '2',
        cooldownStat: 'pdCooldown',
        description: 'Blink a short distance the way you are holding and pass through everything on the way, untouchable for a moment. Hold the button to charge it into a longer, harder dash.',
        parts: [
            { stat: 'pdDistance', label: 'Dash Distance' },
            { stat: 'pdIFrames', label: 'Invulnerability' },
            { stat: 'pdCooldown', label: 'Cooldown' },
            { stat: 'pdChargedDash', label: 'Charged Dash' }
        ]
    },
    void_nova: {
        id: 'void_nova',
        name: 'Void Nova',
        shortName: 'NOVA',
        // Purple: the deepest colour of the four, so a heavy blast reads as heavy.
        color: '#b04dff',
        accent: '#e0b3ff',
        key: '3',
        cooldownStat: 'vnCooldown',
        description: 'Blast everything around you outward and hurt whatever it touches. Buy the Gravity Well part to invert it and drag the pack into the middle instead.',
        parts: [
            { stat: 'vnRadius', label: 'Nova Radius' },
            { stat: 'vnForce', label: 'Nova Force' },
            { stat: 'vnCooldown', label: 'Cooldown' },
            { stat: 'vnGravityWell', label: 'Gravity Well' }
        ]
    }
};

// Display order for the selection rail and the Skills tab
export const SKILL_ORDER = ['echo_shift', 'time_dilation', 'phase_dash', 'void_nova'];

// Each skill reads its cooldown from its own declared stat.
const COOLDOWN_STAT = {};
for (const id of SKILL_ORDER) COOLDOWN_STAT[id] = SKILLS[id].cooldownStat;

export const skillRegistry = {
    equipped: 'echo_shift',
    _remaining: { echo_shift: 0, time_dilation: 0, phase_dash: 0, void_nova: 0 },

    getEquippedId() {
        return this.equipped;
    },

    getEquipped() {
        return SKILLS[this.equipped] || SKILLS.echo_shift;
    },

    equip(id) {
        if (!SKILLS[id]) return this.equipped;
        this.equipped = id;
        return this.equipped;
    },

    isEquipped(id) {
        return this.equipped === id;
    },

    // Ticked from the game's update so it inherits the pause behaviour
    update(deltaTime) {
        for (const id of SKILL_ORDER) {
            if (this._remaining[id] > 0) {
                this._remaining[id] = Math.max(0, this._remaining[id] - deltaTime);
            }
        }
    },

    getCooldownRemaining(id) {
        const v = this._remaining[id];
        return v === undefined ? 0 : v;
    },

    startCooldown(id, seconds) {
        if (!SKILLS[id] || !(seconds > 0)) return;
        // Re-arming never shortens a cooldown that is already running
        this._remaining[id] = Math.max(this._remaining[id] || 0, seconds);
    },

    // Shortens a running cooldown by up to `seconds`, used by the perks that
    // refund time. Clamped at zero so it can never grant a ready skill extra
    // cooldown, and it never touches a skill that is already ready.
    refundCooldown(id, seconds) {
        if (!SKILLS[id] || !(seconds > 0)) return;
        const current = this._remaining[id] || 0;
        if (current <= 0) return;
        this._remaining[id] = Math.max(0, current - seconds);
    },

    isReady(id) {
        return this.getCooldownRemaining(id) <= 0.001;
    },

    getCooldownFor(id) {
        const stat = COOLDOWN_STAT[id];
        const stats = upgradeSystem.getStats();
        return stat && stats[stat] !== undefined ? stats[stat] : 0;
    },

    clearAll() {
        for (const id of SKILL_ORDER) this._remaining[id] = 0;
    }
};