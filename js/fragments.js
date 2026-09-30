// Collectible XP orbs — fixed pickup radius, no stat attached
import { player } from './player.js';
import * as game from './game.js';

const MAGNET_RANGE = 150;
const orbs = [];
const MAX_ORBS = 160;
let collectCount = 0;

export function resetAll() {
    orbs.length = 0;
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
            orbs.splice(i, 1);
        }
    }
}

export function render(ctx, t) {
    for (const orb of orbs) {
        const pulse = 1 + Math.sin(t * 6 + orb.x) * 0.15;
        ctx.save();
        ctx.shadowColor = '#69efff';
        ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(105, 239, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.size * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

export function getOrbs() {
    return orbs;
}
