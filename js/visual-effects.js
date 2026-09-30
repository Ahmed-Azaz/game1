const particles = [];
const damageLabels = [];
const bursts = [];
let particleLimit = 240;
let screenShakeEnabled = true;
let screenShakeUntil = 0;
let screenShakeStart = 0;
let screenShakeDuration = 0.12;
let screenShakeIntensity = 0;

export function setParticleQuality(quality) {
    if (quality === 'low') particleLimit = 120;
    else if (quality === 'high') particleLimit = 320;
    else particleLimit = 240;
}

export function setScreenShakeEnabled(enabled) {
    screenShakeEnabled = !!enabled;
}

export function triggerScreenShake(intensity = 4, duration = 0.12) {
    if (!screenShakeEnabled) return;
    screenShakeIntensity = intensity;
    screenShakeDuration = Math.max(0.01, duration);
    screenShakeStart = performance.now() / 1000;
    screenShakeUntil = screenShakeStart + screenShakeDuration;
}

export function getScreenShakeOffset(t) {
    if (!screenShakeEnabled || t >= screenShakeUntil) return { x: 0, y: 0 };
    // Ramp up then decay, scaled to the real duration of this shake
    const elapsed = t - screenShakeStart;
    const falloff = 1 - elapsed / screenShakeDuration;
    const amp = screenShakeIntensity * falloff;
    return {
        x: (Math.random() - 0.5) * amp * 2,
        y: (Math.random() - 0.5) * amp * 2
    };
}

export function spawnHit(x, y, color, amount, critical = false) {
    spawnBurst(x, y, color, 5);
    damageLabels.push({ x, y, text: critical ? `${Math.round(amount)}!` : `${Math.round(amount)}`, color: critical ? '#ffe2a8' : '#d9f7ff', born: performance.now() / 1000, life: .8 });
}

export function spawnBurst(x, y, color, count = 12) {
    const now = performance.now() / 1000;
    for (let i = 0; i < count && particles.length < particleLimit; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 35 + Math.random() * 90;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, born: now, life: .25 + Math.random() * .35, size: 1.5 + Math.random() * 2.2 });
    }
    bursts.push({ x, y, color, born: now, life: .32 });
}

export function update(deltaTime) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * deltaTime;
        p.y += p.vy * deltaTime;
        p.vx *= Math.max(0, 1 - deltaTime * 2.8);
        p.vy *= Math.max(0, 1 - deltaTime * 2.8);
        if (performance.now() / 1000 - p.born >= p.life) particles.splice(i, 1);
    }
    const now = performance.now() / 1000;
    for (let i = damageLabels.length - 1; i >= 0; i--) if (now - damageLabels[i].born >= damageLabels[i].life) damageLabels.splice(i, 1);
    for (let i = bursts.length - 1; i >= 0; i--) if (now - bursts[i].born >= bursts[i].life) bursts.splice(i, 1);
}

export function render(ctx, now = performance.now() / 1000) {
    ctx.save();
    for (const b of bursts) {
        const age = (now - b.born) / b.life;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2 * (1 - age) + .5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 5 + age * 24, 0, Math.PI * 2);
        ctx.stroke();
    }
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, 1 - (now - p.born) / p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = '600 13px Segoe UI, sans-serif';
    for (const label of damageLabels) {
        const age = (now - label.born) / label.life;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = label.color;
        ctx.fillText(label.text, label.x, label.y - age * 22);
    }
    ctx.restore();
}

export function clear() { particles.length = 0; damageLabels.length = 0; bursts.length = 0; }
