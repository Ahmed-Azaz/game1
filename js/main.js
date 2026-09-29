// Main entry point - game bootstrap and state management
import { initGame, update as gameUpdate, echoShift } from './game.js';
import { player } from './player.js';
import { resetAll as resetEnemies, getActiveEnemies } from './enemies.js';
import { ui } from './ui.js';
import { saveSystem } from './save.js';
import { initAudioContext } from './audio.js';
import * as visualEffects from './visual-effects.js';
import { crazyGames } from './crazygames.js';

// Game state
let gameState = 'onboarding'; // onboarding, playing, paused, game-over
let lastTimestamp = 0;
let deltaTime = 0;


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
    } else if (visible('onboarding')) {
        gameState = 'onboarding';
    } else if (visible('stat-screen') || visible('pause-menu')) {
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
    }
    
    render();
    
    requestAnimationFrame(gameLoop);
}

// Original procedural neon arena renderer.
function render(){
 const c=document.getElementById('game-canvas');if(!c)return;const x=c.getContext('2d');if(!x)return;const w=c.width,h=c.height,t=performance.now()/1000,es=getActiveEnemies(),ax=38,ay=34,aw=w-76,ah=h-68;
 const g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,'#080b19');g.addColorStop(.5,'#11152d');g.addColorStop(1,'#080b18');x.fillStyle=g;x.fillRect(0,0,w,h);
 const glow=x.createRadialGradient(w*.52,h*.48,10,w*.52,h*.48,w*.65);glow.addColorStop(0,'rgba(45,50,110,.14)');glow.addColorStop(1,'rgba(5,7,18,0)');x.fillStyle=glow;x.fillRect(0,0,w,h);
 for(let i=0;i<82;i++){x.fillStyle=`rgba(164,197,255,${.2+(Math.sin(t*1.5+i*8)+1)*.18})`;x.fillRect(i*137.51%w,i*79.17%h,i%9===0?2:1,i%9===0?2:1)}
 x.save();x.beginPath();x.rect(ax,ay,aw,ah);x.clip();x.strokeStyle='rgba(69,142,211,.09)';x.lineWidth=1;for(let a=ax;a<ax+aw;a+=32){x.beginPath();x.moveTo(a,ay);x.lineTo(a,ay+ah);x.stroke()}for(let a=ay;a<ay+ah;a+=32){x.beginPath();x.moveTo(ax,a);x.lineTo(ax+aw,a);x.stroke()}x.restore();
 x.strokeStyle='rgba(100,166,230,.17)';x.strokeRect(ax,ay,aw,ah);x.strokeStyle='rgba(83,217,255,.48)';x.lineWidth=2;[[ax,ay,1,1],[ax+aw,ay,-1,1],[ax,ay+ah,1,-1],[ax+aw,ay+ah,-1,-1]].forEach(([a,b,d,e])=>{x.beginPath();x.moveTo(a+d*18,b);x.lineTo(a,b);x.lineTo(a,b+e*18);x.stroke()});
 if(echoShift?.isActive&&echoShift.path.length>1){const p=echoShift.path;x.save();x.lineCap='round';x.beginPath();x.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)x.lineTo(p[i].x,p[i].y);x.shadowColor='#36eaff';x.shadowBlur=14;x.strokeStyle='rgba(31,221,255,.24)';x.lineWidth=15;x.stroke();x.shadowBlur=6;x.strokeStyle='rgba(79,222,235,.76)';x.lineWidth=3;x.stroke();x.shadowBlur=0;x.strokeStyle='rgba(210,239,242,.75)';x.lineWidth=1;x.stroke();for(let i=0;i<p.length;i+=5){x.fillStyle='#80f5ff';x.beginPath();x.arc(p[i].x,p[i].y,2+Math.sin(t*8+i),0,Math.PI*2);x.fill()}x.restore()}
 for(const e of es){const r=e.size*(.92+Math.sin(t*3+e.id)*.08),n=e.type==='shardling'?4:(e.type==='rift_warden'||e.type==='rift_core'?8:6);x.save();x.translate(e.x,e.y);x.rotate(t*(e.type==='charger'?1.2:.25)+e.id);x.shadowColor=e.color;x.shadowBlur=e.type==='rift_warden'?14:8;x.fillStyle=`${e.color}30`;x.strokeStyle=e.color;x.lineWidth=2;x.beginPath();for(let i=0;i<n;i++){const a=i*Math.PI*2/n,rr=r*(i%2===0?1:.77),px=Math.cos(a)*rr,py=Math.sin(a)*rr;i?x.lineTo(px,py):x.moveTo(px,py)}x.closePath();x.fill();x.stroke();if(e.hitFlashUntil>t){x.globalAlpha=.78;x.fillStyle='#e9ffff';x.fill();x.globalAlpha=1}x.shadowBlur=0;x.fillStyle=e.color;x.beginPath();x.arc(0,0,Math.max(3,r*.23),0,Math.PI*2);x.fill();x.restore();if(e.hp<e.maxHP||e.type==='rift_warden'||e.type==='rift_core'){const bw=Math.max(30,r*2),q=Math.max(0,e.hp/e.maxHP);x.fillStyle='#050914';x.fillRect(e.x-bw/2,e.y-r-12,bw,4);x.fillStyle=q<.3?'#ff8b87':'#70f4d1';x.fillRect(e.x-bw/2,e.y-r-12,bw*q,4)}}
 x.save();x.beginPath();x.arc(player.x,player.y,player.attackRange,0,Math.PI*2);x.fillStyle='rgba(143,126,255,.035)';x.fill();x.setLineDash([7,7]);x.lineWidth=2;x.strokeStyle='rgba(178,157,220,.42)';x.shadowColor='#a98aff';x.shadowBlur=6;x.stroke();x.setLineDash([]);x.shadowBlur=0;x.lineWidth=1;x.strokeStyle='rgba(225,213,255,.25)';x.beginPath();x.arc(player.x,player.y,player.attackRange-4,0,Math.PI*2);x.stroke();x.restore();
 const target=es.reduce((best,e)=>Math.hypot(e.x-player.x,e.y-player.y)<player.attackRange&&(!best||Math.hypot(e.x-player.x,e.y-player.y)<Math.hypot(best.x-player.x,best.y-player.y))?e:best,null);if(target&&t-player.lastAttackTime<.13){x.save();x.globalAlpha=1-(t-player.lastAttackTime)/.13;x.shadowColor='#81f7ff';x.shadowBlur=18;x.strokeStyle='#acffff';x.lineWidth=2;x.beginPath();x.moveTo(player.x,player.y);x.lineTo(target.x,target.y);x.stroke();x.restore()}
 x.save();x.translate(player.x,player.y+Math.sin(t*4));const pg=x.createRadialGradient(0,0,2,0,0,36);pg.addColorStop(0,'rgba(56,155,170,.22)');pg.addColorStop(1,'rgba(71,205,220,0)');x.fillStyle=pg;x.beginPath();x.arc(0,0,36,0,Math.PI*2);x.fill();x.rotate(t*.55);x.strokeStyle='rgba(106,195,205,.42)';x.lineWidth=1.4;x.beginPath();x.ellipse(0,0,23,9,.35,0,Math.PI*2);x.stroke();x.rotate(-t*1.1);x.strokeStyle='rgba(150,125,200,.4)';x.beginPath();x.ellipse(0,0,22,8,-.48,0,Math.PI*2);x.stroke();x.shadowColor='#34c4d2';x.shadowBlur=6;x.fillStyle='#31aebb';x.strokeStyle='#8ec6ca';x.lineWidth=1.5;x.beginPath();x.moveTo(0,-15);x.lineTo(11,-5);x.lineTo(8,10);x.lineTo(0,15);x.lineTo(-8,10);x.lineTo(-11,-5);x.closePath();x.fill();x.stroke();x.shadowBlur=0;x.fillStyle='#b9d9dc';x.beginPath();x.arc(0,0,4.5,0,Math.PI*2);x.fill();x.restore();
 visualEffects.render(x, t);
 const hp=Math.max(0,player.hp/player.maxHP),bw=42;x.fillStyle='rgba(3,7,17,.9)';x.fillRect(player.x-bw/2-2,player.y-31,bw+4,5);x.fillStyle=hp>.3?'#72f4d1':'#ff8278';x.fillRect(player.x-bw/2,player.y-30,bw*hp,3)
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
    }
});
document.addEventListener('pointerdown', () => initAudioContext(), { passive: true });

function handleOnboardingInput(key) {
    if (key === ' ' || key === 'Enter') {
        document.getElementById('onboarding').style.display = 'none';
        localStorage.setItem('echoRift_onboardingCompleted', 'true');
        gameState = 'playing';
        crazyGames.gameplayStart();
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
        crazyGames.gameplayStart();
    } else {
        pauseMenu.style.display = 'block';
        keysDown.clear();
        joystickVector.x = joystickVector.y = 0;
        gameState = 'paused';
        crazyGames.gameplayStop();
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
