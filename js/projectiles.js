// Enemy projectiles.
//
// One pooled list shared by every enemy type, so ranged behaviour costs the
// same no matter who is shooting. Every projectile here reports damage as
// 'ranged', which is deliberately NOT covered by Juggernaut's contact cap:
// positioning still saves you, but a projectile that reaches across the arena
// does not get the same discount a body bump does.
import { player } from './player.js';
import * as game from './game.js';
import * as audio from './audio.js';
import { spawnBurst } from './visual-effects.js';

const ARENA_MARGIN = 30;

let projectiles = [];
let beams = [];
let nextId = 1;

// Hard ceiling on bolts alive at once. Every emitter on its own is tuned to be
// reasonable, and the screen-filling problem was only ever the sum of them: a
// crowd of drifters plus a phase-3 core could put well over a hundred up at
// once. Capping at spawn makes on-screen density a deliberate property of the
// game rather than an accident of how many enemies happened to be alive.
//
// Deliberate telegraphs are exempt and always spawn. The core beam and the
// charger shockwave are the patterns the player is meant to read and answer, and
// silently dropping one because the screen is busy would punish them for a fight
// that is going badly.
const MAX_LIVE_BOLTS = 64;

function liveBoltCount() {
    let n = 0;
    for (let i = 0; i < projectiles.length; i++) {
        if (projectiles[i].alive) n++;
    }
    return n;
}

// Makes room for a telegraph that must not be dropped: retires the oldest live
// bolt. Oldest-first is the right victim, since it is the one closest to leaving
// on its own anyway.
function releaseOldest() {
    let oldest = null;
    for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        if (!p.alive) continue;
        if (!oldest || p.id < oldest.id) oldest = p;
    }
    if (oldest) oldest.alive = false;
}

// Reuse dead slots: waves spawn these in bursts and the arena churns through
// hundreds per run.
function takeSlot() {
    for (let i = 0; i < projectiles.length; i++) {
        if (!projectiles[i].alive) return projectiles[i];
    }
    const slot = { alive: false };
    projectiles.push(slot);
    return slot;
}

// opts: x, y, angle, speed, damage, radius, life, color, size, homing (rad/s),
//       pierce, blockedByEchoWall (default true), kind, telegraph
export function spawn(opts) {
    // Telegraphs bypass the ceiling, see MAX_LIVE_BOLTS
    if (opts.telegraph || opts.kind === 'shockwave') {
        if (liveBoltCount() >= MAX_LIVE_BOLTS) releaseOldest(opts.kind === 'shockwave');
    } else if (liveBoltCount() >= MAX_LIVE_BOLTS) {
        return null;
    }
    const p = takeSlot();
    p.id = nextId++;
    p.alive = true;
    p.kind = opts.kind || 'bolt';
    p.x = opts.x;
    p.y = opts.y;
    p.angle = opts.angle;
    p.vx = Math.cos(opts.angle) * opts.speed;
    p.vy = Math.sin(opts.angle) * opts.speed;
    p.speed = opts.speed;
    p.damage = opts.damage;
    p.radius = opts.radius ?? 5;
    p.life = opts.life ?? 3;
    p.age = 0;
    p.color = opts.color || '#ff6b6b';
    p.size = opts.size ?? 6;
    p.homing = opts.homing ?? 0;
    p.pierce = opts.pierce ?? false;
    p.blockedByEchoWall = opts.blockedByEchoWall !== false;
    p.hasHit = false;
    // Expanding ring left behind by a charger, drawn and collided as a band
    p.maxRadius = opts.maxRadius ?? 0;
    p.radiusGrow = opts.radiusGrow ?? 0;
    return p;
}

// A rotating beam: a segment from (x, y) out to `length`, sweeping by
// `sweepRate` rad/s. Charges for `chargeTime` before it can hurt anyone, so the
// pattern is dodgeable instead of a coin flip.
export function spawnBeam(opts) {
    beams.push({
        id: nextId++,
        x: opts.x,
        y: opts.y,
        angle: opts.angle,
        sweepRate: opts.sweepRate ?? 0,
        length: opts.length ?? 900,
        width: opts.width ?? 18,
        damage: opts.damage,
        life: opts.life ?? 3,
        age: 0,
        chargeTime: opts.chargeTime ?? 0.6,
        color: opts.color || '#ae81ff',
        hasHit: false
    });
}

export function reset() {
    projectiles = [];
    beams = [];
    nextId = 1;
}

export function getActive() {
    return projectiles;
}

export function getActiveBeams() {
    return beams;
}

export function count() {
    let n = 0;
    for (const p of projectiles) if (p.alive) n++;
    return n;
}

function kill(p) {
    p.alive = false;
}

// Blast on death so a blocked shot reads as "the line ate it" instead of
// silently vanishing.
function pop(p) {
    spawnBurst(p.x, p.y, p.color, 5);
}

export function updateAll(deltaTime) {
    const playerRadius = player.radius || 15;

    for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        if (!p.alive) continue;

        p.age += deltaTime;
        if (p.age >= p.life) {
            kill(p);
            continue;
        }

        // Homing tracks the player's live position
        if (p.homing > 0) {
            const want = Math.atan2(player.y - p.y, player.x - p.x);
            let diff = want - p.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const maxTurn = p.homing * deltaTime;
            p.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
            p.vx = Math.cos(p.angle) * p.speed;
            p.vy = Math.sin(p.angle) * p.speed;
        }

        p.x += p.vx * deltaTime;
        p.y += p.vy * deltaTime;

        if (p.radiusGrow > 0) {
            p.radius += p.radiusGrow * deltaTime;
            if (p.radius >= p.maxRadius) {
                kill(p);
                continue;
            }
        }

        // The standing Echo line eats projectiles: the wall is a shield, not
        // just a wall for bodies
        if (p.blockedByEchoWall && !p.hasHit
            && game.isInsideEchoWall(p.x, p.y, p.radius)) {
            pop(p);
            audio.play('hit');
            kill(p);
            continue;
        }

        if (p.x < ARENA_MARGIN || p.x > game.canvasWidth - ARENA_MARGIN
            || p.y < ARENA_MARGIN || p.y > game.canvasHeight - ARENA_MARGIN) {
            kill(p);
            continue;
        }

        // A shockwave only hurts on the frame its ring sweeps over you; a bolt
        // is a point test
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (!p.hasHit && dist < p.radius + playerRadius) {
            p.hasHit = true;
            player.takeDamage(p.damage, 'ranged');
            if (!p.pierce) {
                kill(p);
                continue;
            }
        }
    }

    // Beams
    for (let i = beams.length - 1; i >= 0; i--) {
        const beam = beams[i];
        beam.age += deltaTime;
        if (beam.age >= beam.life) {
            beams.splice(i, 1);
            continue;
        }
        if (beam.chargeTime > 0) {
            // Still charging: drawn as a thin guide line, deals nothing
            continue;
        }
        beam.angle += beam.sweepRate * deltaTime;
        if (beam.hasHit) continue;
        const ex = beam.x + Math.cos(beam.angle) * beam.length;
        const ey = beam.y + Math.sin(beam.angle) * beam.length;
        const d = distanceToSegment(player.x, player.y, beam.x, beam.y, ex, ey);
        if (d < beam.width / 2 + playerRadius) {
            beam.hasHit = true;
            player.takeDamage(beam.damage, 'ranged');
        }
    }
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function render(ctx, t) {
    for (const p of projectiles) {
        if (!p.alive) continue;
        if (p.kind === 'shockwave') {
            // Expanding band, fading as it dies
            const fade = Math.max(0, 1 - p.radius / (p.maxRadius || 1));
            ctx.save();
            ctx.strokeStyle = p.color;
            ctx.globalAlpha = 0.35 + fade * 0.5;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            continue;
        }

        ctx.save();
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        // Streak along the travel direction so slow shots still read as moving
        const tail = p.speed * 0.03;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(p.angle) * tail, p.y - Math.sin(p.angle) * tail);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.7;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    for (const beam of beams) {
        const charging = beam.chargeTime > 0;
        ctx.save();
        ctx.strokeStyle = beam.color;
        ctx.lineCap = 'round';
        if (charging) {
            // Telegraph: thin and dashed, so the sweep can be read before it hurts
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 8]);
        } else {
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = beam.width;
            ctx.shadowColor = beam.color;
            ctx.shadowBlur = 18;
        }
        const ex = beam.x + Math.cos(beam.angle) * beam.length;
        const ey = beam.y + Math.sin(beam.angle) * beam.length;
        ctx.beginPath();
        ctx.moveTo(beam.x, beam.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.restore();
    }
}