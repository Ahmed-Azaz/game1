// Collectible XP orbs — fixed pickup radius, no stat attached
import { player } from './player.js';
import * as game from './game.js';

const MAGNET_RANGE = 150;
const orbs = [];
const MAX_ORBS = 160;
let collectCount = 0;

// XP sits in gold on a hard diamond, deliberately nothing like an enemy shot:
// projectiles are coloured circles with a motion streak and a glow, and late
// waves fill the screen with them. Gold is the one hue no enemy uses, the
// silhouette survives a crowded screen where a colour read would not, and no
// glow keeps a cluster of orbs from blooming into one bright mass.
const ORB_COLOR = '#ffc247';
const ORB_GLOW = 'rgba(255, 194, 71, 0.35)';

// Brief burst left where an orb was taken, so a pickup is confirmed by something
// other than the player's own HP bar moving.
const PICKUP_FLASH_TIME = 0.28;
const flashes = [];

export function resetAll() {
    orbs.length = 0;
    flashes.length = 0;
    collectCount = 0;
}

export function getCollected() {
    return collectCount;
}

export function spawnOrb(x, y, xpValue = 10) {
    // Oldest orbs are dropped first so a long run cannot grow the array forever
    if (orbs.length >= MAX_ORBS) orbs.shift();
    orbs.push({
        x,
        y,
        xp: xpValue,
        size: 6,
        born: performance.now() / 1000
    });
}

export function updateAll(deltaTime) {
    for (let i = orbs.length - 1; i >= 0; i--) {
        const orb = orbs[i];
        const dx = player.x - orb.x;
        const dy = player.y - orb.y;
        const dist = Math.hypot(dx, dy);

        if (dist < MAGNET_RANGE) {
            const pull = dist < 28 ? 420 : 180;
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : 0;
            orb.x += nx * pull * deltaTime;
            orb.y += ny * pull * deltaTime;
        }

        if (dist < (player.radius || 15) + orb.size) {
            collectCount++;
            game.addFragmentCollected();
            game.addXP(orb.xp);
            flashes.push({ x: orb.x, y: orb.y, born: performance.now() / 1000 });
            orbs.splice(i, 1);
        }
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
        if (performance.now() / 1000 - flashes[i].born >= PICKUP_FLASH_TIME) flashes.splice(i, 1);
    }
}

// A rhombus, drawn on its corner so the silhouette is unmistakable next to a
// circle. Pointed top and bottom rather than a rotated square, because a
// square could be mistaken for a shardling body.
function traceDiamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.72, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.72, y);
    ctx.closePath();
}

export function render(ctx, t) {
    for (const orb of orbs) {
        const pulse = 1 + Math.sin(t * 6 + orb.x) * 0.15;
        const r = orb.size * pulse;
        ctx.save();
        ctx.fillStyle = ORB_COLOR;
        traceDiamond(ctx, orb.x, orb.y, r);
        ctx.fill();
        // A darker facet down one side gives the gem a read at a glance without
        // spending a glow to do it
        ctx.fillStyle = ORB_GLOW;
        ctx.beginPath();
        ctx.moveTo(orb.x, orb.y - r);
        ctx.lineTo(orb.x + r * 0.72, orb.y);
        ctx.lineTo(orb.x, orb.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Expanding ring left behind by a collected orb
    for (const flash of flashes) {
        const age = (performance.now() / 1000 - flash.born) / PICKUP_FLASH_TIME;
        if (age >= 1) continue;
        ctx.save();
        ctx.globalAlpha = (1 - age) * 0.8;
        ctx.strokeStyle = ORB_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(flash.x, flash.y, 6 + age * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

export function getOrbs() {
    return orbs;
}
