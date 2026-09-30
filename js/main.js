// Main entry point - game bootstrap and state management
import { initGame, update as gameUpdate, echoShift, getRunTime, gameplayStart, gameplayStop, isMarked } from './game.js';
import { player } from './player.js';
import { resetAll as resetEnemies, getActiveEnemies } from './enemies.js';
import { ui } from './ui.js';
import { saveSystem } from './save.js';
import { initAudioContext } from './audio.js';
import * as visualEffects from './visual-effects.js';
import * as fragments from './fragments.js';
import { crazyGames } from './crazygames.js';

// Game state
let gameState = 'title'; // title, onboarding, playing, paused, game-over
let lastTimestamp = 0;
let deltaTime = 0;
let hudTickAccumulator = 0;


export const keysDown = new Set();
export const joystickVector = { x: 0, y: 0 };
const MOVEMENT_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

// Initialize game systems
function init() {
    // Initialize optional portal integration; its failure never blocks startup.
    void crazyGames.init();
    
    // Initialize game systems
    saveSystem.init();
    ui.init();
    resetEnemies();
    initGame();
    
    // Pause button (mouse alternative to Escape) - delegated so it survives DOM rewrites
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'pause-button' && gameState === 'playing') {
            togglePause();
        }
    });
    
    // Touch controls check
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        const tc = document.getElementById('touch-controls');
        if (tc) tc.style.display = 'block';
        setupTouchControls();
    }
    
    // Start game loop
    lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
}

// Mirror DOM overlays into gameState each frame so UI buttons,
// keyboard shortcuts, and the loop always agree on what is showing.
function syncStateFromDOM() {
    const visible = (id) => {
        const el = document.getElementById(id);
        return el && el.style.display !== 'none';
    };
    
    if (visible('game-over')) {
        gameState = 'game-over';
    } else if (visible('title-screen')) {
        gameState = 'title';
    } else if (visible('onboarding')) {
        gameState = 'onboarding';
    } else if (visible('settings-panel')) {
        gameState = 'settings';
    } else if (visible('stat-screen-container')) {
        // Checked before the pause menu so a stat screen always wins
        gameState = 'stat-screen';
    } else if (visible('pause-menu')) {
        gameState = 'paused';
    } else {
        gameState = 'playing';
    }
    
    // Show pause button only during gameplay
    const pauseButton = document.getElementById('pause-button');
    if (pauseButton) {
        pauseButton.style.display = gameState === 'playing' ? 'block' : 'none';
    }
}

// Game loop
function gameLoop(timestamp) {
    deltaTime = Math.min(Math.max((timestamp - lastTimestamp) / 1000, 0), 0.1); // seconds, clamped
    lastTimestamp = timestamp;
    
    syncStateFromDOM();
    
    // Update game systems
    if (gameState === 'playing') {
        player.update(deltaTime, keysDown, joystickVector);
        visualEffects.update(deltaTime);
        gameUpdate(deltaTime);
        hudTickAccumulator += deltaTime;
        if (hudTickAccumulator >= 0.1) {
            ui.tickHUD();
            hudTickAccumulator %= 0.1;
        }
    } else {
        // Held movement keys must not leak across pause, death, or menus
        keysDown.clear();
        joystickVector.x = joystickVector.y = 0;
    }
    
    render();
    
    requestAnimationFrame(gameLoop);
}

// Original procedural neon arena renderer.
function render() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = performance.now() / 1000;
    const enemies = getActiveEnemies();
    const shake = visualEffects.getScreenShakeOffset(t);

    ctx.save();
    ctx.translate(shake.x, shake.y);
    drawArena(ctx, canvas.width, canvas.height, t);
    fragments.render(ctx, t);
    drawEchoTrail(ctx, t);
    for (const enemy of enemies) drawEnemy(ctx, enemy, t);
    drawPlayerAura(ctx, t);
    drawAttackLine(ctx, enemies, t);
    drawPlayer(ctx, t);
    drawEchoCooldownRing(ctx, t);
    drawPlayerHealthBar(ctx);
    visualEffects.render(ctx, t);
    if (shake.x || shake.y) drawHurtVignette(ctx, canvas.width, canvas.height);
    ctx.restore();
}

function drawArena(ctx, w, h, t) {
    const ax = 38, ay = 34, aw = w - 76, ah = h - 68;

    const backdrop = ctx.createLinearGradient(0, 0, w, h);
    backdrop.addColorStop(0, '#080b19');
    backdrop.addColorStop(.5, '#11152d');
    backdrop.addColorStop(1, '#080b18');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * .52, h * .48, 10, w * .52, h * .48, w * .65);
    glow.addColorStop(0, 'rgba(45,50,110,.14)');
    glow.addColorStop(1, 'rgba(5,7,18,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 82; i++) {
        ctx.fillStyle = `rgba(164,197,255,${.2 + (Math.sin(t * 1.5 + i * 8) + 1) * .18})`;
        ctx.fillRect(i * 137.51 % w, i * 79.17 % h, i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, aw, ah);
    ctx.clip();
    ctx.strokeStyle = 'rgba(69,142,211,.09)';
    ctx.lineWidth = 1;
    for (let a = ax; a < ax + aw; a += 32) { ctx.beginPath(); ctx.moveTo(a, ay); ctx.lineTo(a, ay + ah); ctx.stroke(); }
    for (let a = ay; a < ay + ah; a += 32) { ctx.beginPath(); ctx.moveTo(ax, a); ctx.lineTo(ax + aw, a); ctx.stroke(); }
    ctx.restore();

    ctx.strokeStyle = 'rgba(100,166,230,.17)';
    ctx.strokeRect(ax, ay, aw, ah);
    ctx.strokeStyle = 'rgba(83,217,255,.48)';
    ctx.lineWidth = 2;
    for (const [cx, cy, dx, dy] of [[ax, ay, 1, 1], [ax + aw, ay, -1, 1], [ax, ay + ah, 1, -1], [ax + aw, ay + ah, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * 18, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * 18);
        ctx.stroke();
    }
}

// Only the swept part of the frozen path is drawn, so the player can read the
// damage front as it travels.
function drawEchoTrail(ctx, t) {
    if (!echoShift?.isActive || !echoShift.path || echoShift.path.length < 2) return;
    const path = echoShift.path;
    const idx = Math.min(path.length - 1, Math.floor((echoShift.replayProgress || 0) * (path.length - 1)));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i <= idx; i++) ctx.lineTo(path[i].x, path[i].y);
    if (echoShift.headX !== undefined) ctx.lineTo(echoShift.headX, echoShift.headY);

    ctx.shadowColor = '#36eaff';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(31,221,255,.24)';
    ctx.lineWidth = 15;
    ctx.stroke();
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(79,222,235,.76)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(210,239,242,.75)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#b8ffff';
    ctx.shadowColor = '#36eaff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(echoShift.headX ?? path[0].x, echoShift.headY ?? path[0].y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawEnemy(ctx, e, t) {
    const r = e.size * (.92 + Math.sin(t * 3 + e.id) * .08);
    const sides = e.type === 'shardling' ? 4 : (e.type === 'rift_warden' || e.type === 'rift_core' ? 8 : 6);
    const windingUp = e.aiState === 'rush_windup';

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(t * (e.type === 'charger' ? 1.2 : .25) + e.id);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = windingUp ? 20 : (e.type === 'rift_warden' ? 14 : 8);
    ctx.fillStyle = `${e.color}30`;
    ctx.strokeStyle = windingUp ? '#fff3d6' : e.color;
    ctx.lineWidth = windingUp ? 3 : 2;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides;
        const rr = r * (i % 2 === 0 ? 1 : .77);
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (e.hitFlashUntil > t) {
        ctx.globalAlpha = .78;
        ctx.fillStyle = '#e9ffff';
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(3, r * .23), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (e.hp < e.maxHP || e.type === 'rift_warden' || e.type === 'rift_core') {
        const bw = Math.max(30, r * 2);
        const q = Math.max(0, e.hp / e.maxHP);
        ctx.fillStyle = '#050914';
        ctx.fillRect(e.x - bw / 2, e.y - r - 12, bw, 4);
        ctx.fillStyle = q < .3 ? '#ff8b87' : '#70f4d1';
        ctx.fillRect(e.x - bw / 2, e.y - r - 12, bw * q, 4);
    }

    // Marked enemies take extra damage from everything, so the ring has to be
    // unmissable: it pulses for as long as the mark holds
    if (isMarked(e, t)) {
        ctx.save();
        ctx.strokeStyle = '#7dd7ef';
        ctx.lineWidth = 2;
        ctx.globalAlpha = .55 + Math.sin(t * 6) * .25;
        ctx.shadowColor = '#7dd7ef';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 1.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function drawPlayerAura(ctx, t) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.attackRange, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(143,126,255,.035)';
    ctx.fill();
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(178,157,220,.42)';
    ctx.shadowColor = '#a98aff';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(225,213,255,.25)';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.attackRange - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawAttackLine(ctx, enemies, t) {
    let target = null;
    let best = Infinity;
    for (const enemy of enemies) {
        const d = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        if (d < player.attackRange && d < best) { best = d; target = enemy; }
    }
    if (!target || t - player.lastAttackTime >= .13) return;

    ctx.save();
    ctx.globalAlpha = 1 - (t - player.lastAttackTime) / .13;
    ctx.shadowColor = '#81f7ff';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#acffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
}

function drawPlayer(ctx, t) {
    ctx.save();
    ctx.translate(player.x, player.y + Math.sin(t * 4));

    const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 36);
    aura.addColorStop(0, 'rgba(56,155,170,.22)');
    aura.addColorStop(1, 'rgba(71,205,220,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(t * .55);
    ctx.strokeStyle = 'rgba(106,195,205,.42)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 23, 9, .35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(-t * 1.1);
    ctx.strokeStyle = 'rgba(150,125,200,.4)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 8, -.48, 0, Math.PI * 2);
    ctx.stroke();

    // i-frame blink: the body dims while invulnerable after a hit
    if (performance.now() / 1000 < player.invulnUntil) {
        ctx.globalAlpha = 0.55;
    }
    ctx.shadowColor = '#34c4d2';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#31aebb';
    ctx.strokeStyle = '#8ec6ca';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(11, -5);
    ctx.lineTo(8, 10);
    ctx.lineTo(0, 15);
    ctx.lineTo(-8, 10);
    ctx.lineTo(-11, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // hurt flash on the core, so contact damage is readable
    if (performance.now() / 1000 < player.hurtFlashUntil) {
        ctx.fillStyle = '#ff9c9c';
    } else {
        ctx.fillStyle = '#b9d9dc';
    }
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Persistent cooldown ring, so readiness is readable without looking at the HUD.
function drawEchoCooldownRing(ctx, t) {
    if (!echoShift) return;
    const remaining = Math.max(0, echoShift.cooldown - (getRunTime() - echoShift.lastUsed));
    if (remaining <= 0) {
        const pulse = .35 + Math.sin(t * 3) * .12;
        ctx.save();
        ctx.strokeStyle = `rgba(105,239,255,${pulse})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(player.x, player.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
    }

    const ratio = Math.min(1, remaining / echoShift.cooldown);
    ctx.save();
    ctx.strokeStyle = 'rgba(120,140,190,.28)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(182,154,255,.85)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(player.x, player.y, 24, -Math.PI / 2, -Math.PI / 2 + (1 - ratio) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawPlayerHealthBar(ctx) {
    const ratio = Math.max(0, player.hp / player.maxHP);
    const bw = 42;
    ctx.fillStyle = 'rgba(3,7,17,.9)';
    ctx.fillRect(player.x - bw / 2 - 2, player.y - 31, bw + 4, 5);
    ctx.fillStyle = ratio > .3 ? '#72f4d1' : '#ff8278';
    ctx.fillRect(player.x - bw / 2, player.y - 30, bw * ratio, 3);
}

function drawHurtVignette(ctx, w, h) {
    const strength = Math.max(0, (player.hurtFlashUntil - performance.now() / 1000) / 0.2);
    if (strength <= 0) return;
    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * .3, w / 2, h / 2, h * .78);
    vignette.addColorStop(0, 'rgba(255,80,90,0)');
    vignette.addColorStop(1, `rgba(255,70,84,${.42 * strength})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
}
// Handle keyboard input
document.addEventListener('keydown', (e) => {
    const key = e.key;
    const lower = key.toLowerCase();
    
    // Prevent scrolling
    if (MOVEMENT_KEYS.includes(lower) || lower === ' ') {
        e.preventDefault();
    }
    
    // Ignore auto-repeat for non-movement keys (prevents double-toggle)
    if (e.repeat && !MOVEMENT_KEYS.includes(lower)) return;
    
    if (MOVEMENT_KEYS.includes(lower)) keysDown.add(lower);
    initAudioContext();

    syncStateFromDOM();
    
    if (gameState === 'onboarding') {
        handleOnboardingInput(key);
    } else if (gameState === 'playing') {
        handlePlayingInput(key);
    } else if (gameState === 'paused') {
        if (lower === 'escape' || lower === 'p') {
            togglePause();
        }
    } else if (gameState === 'stat-screen') {
        // Escape continues the run instead of stacking the pause menu on the stat screen
        if (lower === 'escape' || lower === 'p' || lower === 'enter') {
            ui.continueFromStatScreen();
        }
    } else if (gameState === 'settings') {
        if (lower === 'escape' || lower === 'p') {
            ui.closeSettings();
        }
    }
});

document.addEventListener('keyup', (e) => {
    const lower = e.key.toLowerCase();
    if (MOVEMENT_KEYS.includes(lower)) keysDown.delete(lower);
});

window.addEventListener('blur', () => {
    keysDown.clear();
    joystickVector.x = joystickVector.y = 0;
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        keysDown.clear();
        joystickVector.x = joystickVector.y = 0;
        // Leaving the tab ends the run for the portal's gameplay tracking
        syncStateFromDOM();
        if (gameState === 'playing') togglePause();
    }
});
document.addEventListener('pointerdown', () => initAudioContext(), { passive: true });

function handleOnboardingInput(key) {
    if (key === ' ' || key === 'Enter') {
        ui.beginRun();
    }
}

function handlePlayingInput(key) {
    if (key === ' ') {
        player.activateEchoShift();
    }
    
    if (key === 'Escape' || key === 'p' || key === 'P') {
        togglePause();
    }
}

function togglePause() {
    const pauseMenu = document.getElementById('pause-menu');
    const isPaused = pauseMenu.style.display !== 'none';
    
    if (isPaused) {
        pauseMenu.style.display = 'none';
        gameState = 'playing';
        // Resumes the run clock, BGM, and the portal timer together
        gameplayStart();
    } else {
        pauseMenu.style.display = 'block';
        keysDown.clear();
        joystickVector.x = joystickVector.y = 0;
        gameState = 'paused';
        gameplayStop();
    }
}

// Initialize on load
window.addEventListener('load', init);

function setupTouchControls() {
    const area = document.getElementById('joystick-area');
    const stick = document.getElementById('joystick-stick');
    const echoButton = document.getElementById('touch-echo-btn');
    let pointerId = null;

    const updateStick = (event) => {
        if (pointerId !== event.pointerId) return;
        const rect = area.getBoundingClientRect();
        const maxDistance = rect.width * .34;
        let dx = event.clientX - (rect.left + rect.width / 2);
        let dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy);
        if (distance > maxDistance) {
            dx = dx / distance * maxDistance;
            dy = dy / distance * maxDistance;
        }
        if (gameState !== 'playing') { joystickVector.x = joystickVector.y = 0; return; }
        joystickVector.x = dx / maxDistance;
        joystickVector.y = dy / maxDistance;
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const stopStick = (event) => {
        if (pointerId !== event.pointerId) return;
        pointerId = null;
        joystickVector.x = joystickVector.y = 0;
        stick.style.transform = 'translate(0px, 0px)';
        if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
    };

    if (area && stick) {
        area.addEventListener('pointerdown', (event) => {
            if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
            event.preventDefault();
            pointerId = event.pointerId;
            area.setPointerCapture(pointerId);
            initAudioContext();
            updateStick(event);
        });
        area.addEventListener('pointermove', updateStick);
        area.addEventListener('pointerup', stopStick);
        area.addEventListener('pointercancel', stopStick);
        area.addEventListener('lostpointercapture', stopStick);
    }
    if (echoButton) {
        echoButton.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            initAudioContext();
            if (gameState === 'playing') player.activateEchoShift();
        });
    }
}
