// Rendering budget for the whole game.
//
// Canvas2D has no cost model, so nothing here is expensive on its own: a single
// shadowBlur is fine with three enemies on screen and ruinous with sixty, and a
// phone GPU pays for every one of them. Late waves are exactly when the frame
// budget disappears, so the expensive effects are switched off as the load
// rises rather than left on and hoped about.
//
// Two inputs decide the level. The settings dropdown sets the ceiling, so the
// player can force it low. The frame timer sets the floor, so a machine that is
// struggling gets relief even at 'high'. Adaptive is deliberately one-way with
// hysteresis: stepping back up immediately would oscillate and look worse than
// simply staying reduced.

const LEVELS = ['low', 'medium', 'high'];

// What each level is allowed to spend
const TIER = [
    // low: flat fills, no blur anywhere, no dashed rings
    { particles: 120, stars: 30, labels: 14, telegraph: false, auraRings: false },
    // medium: the current look
    { particles: 240, stars: 82, labels: 26, telegraph: true, auraRings: true },
    // high: everything
    { particles: 320, stars: 82, labels: 40, telegraph: true, auraRings: true }
];

// Frames at or above this smoothed cost are treated as a struggling frame
const SLOW_FRAME_MS = 22;   // under ~45fps

// Recovery is judged against a held 60fps, not against a theoretical best.
// This has to sit just above 16.7ms: a machine sitting exactly on 60fps is
// healthy and must climb back, and a threshold below that would leave every
// 60fps device stranded in the deadzone with no way back up.
const FAST_FRAME_MS = 17.5;

// Consecutive samples needed before acting. Dropping fast and recovering slowly
// keeps a single spike from tanking the visuals and stops the level flapping
const SLOW_STREAK_TO_DROP = 45;
const FAST_STREAK_TO_RISE = 300;

let settingLevel = 1;
let effective = 1;
let smoothedFrameMs = 16.7;
let slowStreak = 0;
let fastStreak = 0;

// Coarse pointer means a phone or tablet, where the glow is the first thing
// that has to go. Guarded because matchMedia is absent outside a browser.
export function defaultSetting() {
    try {
        if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'low';
    } catch (err) {
        // Treat an unavailable query as a desktop
    }
    return 'medium';
}

function toLevel(name) {
    const idx = LEVELS.indexOf(name);
    return idx === -1 ? 1 : idx;
}

// The player's choice. It caps the adaptive level but never raises the
// adaptive level on its own.
export function setSetting(name) {
    settingLevel = toLevel(name);
    // A lower cap has to take effect immediately; a higher one does not, because
    // that would undo relief the frame timer just asked for
    if (effective > settingLevel) effective = settingLevel;
    slowStreak = 0;
    fastStreak = 0;
}

// Current effective level, 0 = low, 1 = medium, 2 = high
export function level() {
    return effective;
}

// For effects that are worth keeping on a phone: the player, the Echo wall, the
// boss beams. These are a handful of draws, not one per entity.
export function importantGlow() {
    return effective >= 1;
}

// Per-entity glow. Every enemy body and every projectile uses this, so this is
// the multiplier that decides whether late waves are cheap.
export function entityGlow() {
    return effective >= 2;
}

export function particles() {
    return TIER[effective].particles;
}

export function stars() {
    return TIER[effective].stars;
}

export function damageLabels() {
    return TIER[effective].labels;
}

// Dashed rings and long telegraph lines are stroke-heavy and read as noise once
// the screen is busy, so they are the first thing a struggling frame loses.
export function telegraphs() {
    return TIER[effective].telegraph;
}

export function auraRings() {
    return TIER[effective].auraRings;
}

// Called once per frame with the real frame cost
export function sampleFrame(dtMs) {
    // A tab switch or a GC pause reports an enormous delta that says nothing
    // about the renderer, so it is ignored rather than acted on
    if (!(dtMs > 0) || dtMs > 500) return;

    smoothedFrameMs += (dtMs - smoothedFrameMs) * 0.1;

    if (smoothedFrameMs >= SLOW_FRAME_MS) {
        slowStreak++;
        fastStreak = 0;
    } else if (smoothedFrameMs <= FAST_FRAME_MS) {
        fastStreak++;
        slowStreak = 0;
    } else {
        slowStreak = 0;
        fastStreak = 0;
    }

    if (slowStreak >= SLOW_STREAK_TO_DROP && effective > 0) {
        effective--;
        slowStreak = 0;
        fastStreak = 0;
    } else if (fastStreak >= FAST_STREAK_TO_RISE && effective < settingLevel) {
        effective++;
        slowStreak = 0;
        fastStreak = 0;
    }
}

// A new run starts from the player's chosen level rather than from wherever the
// previous run's frame times left it
export function resetAdaptive() {
    effective = settingLevel;
    smoothedFrameMs = 16.7;
    slowStreak = 0;
    fastStreak = 0;
}