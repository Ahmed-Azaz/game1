// UI system - HUD, stat screen, run summary, and settings
import * as game from './game.js';
import { player } from './player.js';
import { upgradeSystem } from './upgrades.js';
import { perks, PERK_STATS } from './perks.js';
import * as audio from './audio.js';
import { saveSystem, persistGameSettings } from './save.js';
import { SKILLS, SKILL_ORDER, skillRegistry } from './skills.js';

// main.js drives the HUD and overlays through this object, so every entry point
// it calls has to be exposed here.
export const ui = {
    init() {
        setUpEventListeners();
        initOnboardingWizard();
        buildSkillRail();
        refreshTitleBest();
    },
    tickHUD,
    syncSkillRail,
    selectSkill,
    beginRun,
    closeStatScreen,
    continueFromStatScreen: closeStatScreenAndResume,
    closeSettings
};

let statScreenMode = 'manual';
let activeTab = 'stats';
// Perks unlocked since the player last looked, so the reward is never silent
let pendingUnlocks = [];
// Short-lived message shown when an action is refused, e.g. spending a point on
// a stat that is already capped
let statNotice = '';
let statNoticeTimer = null;
// Opening from the pause menu has to stop the run exactly once, not on every
// re-render of the screen
let gameplayStoppedForScreen = false;

// One description of every upgradeable stat, shared by the Stats and Perks tabs
// so the two views can never drift apart.
const STAT_ROWS = [
    { key: 'hp', label: 'HP', format: 'hp' },
    { key: 'hpRegen', label: 'HP Regen', format: 'hpRegen' },
    { key: 'moveSpeed', label: 'Move Speed', format: 'moveSpeed' },
    { key: 'attackPower', label: 'Attack Power', format: 'attackPower' },
    { key: 'attackSpeed', label: 'Attack Speed', format: 'attackSpeed' },
    { key: 'attackRange', label: 'Attack Range', format: 'attackRange' },
    { key: 'criticalChance', label: 'Critical Chance', format: 'criticalChance' },
    { key: 'criticalDamage', label: 'Critical Damage', format: 'criticalDamage' },
    { key: 'multishot', label: 'Multishot', format: 'multishot' }
];

// Every skill's upgradeable parts, read from the registry so a new skill only
// has to describe its parts there. All of these live on the Skills tab and are
// bought with ability points, so they never touch the character stat ladder.
//
// format names line up with the formatter in renderUpgradeRow. Echo's parts are
// resolved from the registry like the rest, which is what keeps the Echo Shift
// card and its parts from being written out twice.
const SKILL_PART_ROWS = {
    echo_shift: [
        { key: 'echoPower', label: 'Echo Power', format: 'echoPower' },
        { key: 'echoDuration', label: 'Echo Duration', format: 'echoDuration' },
        { key: 'echoCooldown', label: 'Echo Cooldown', format: 'echoCooldown' }
    ],
    time_dilation: [
        { key: 'tdPower', label: 'Dilation Power', format: 'tdPower' },
        { key: 'tdDuration', label: 'Duration', format: 'tdDuration' },
        { key: 'tdCooldown', label: 'Cooldown', format: 'tdCooldown' },
        { key: 'tdSlowCap', label: 'Slow Cap', format: 'tdSlowCap' }
    ],
    phase_dash: [
        { key: 'pdDistance', label: 'Dash Distance', format: 'pdDistance' },
        { key: 'pdIFrames', label: 'Invulnerability', format: 'pdIFrames' },
        { key: 'pdCooldown', label: 'Cooldown', format: 'pdCooldown' },
        { key: 'pdChargedDash', label: 'Charged Dash', format: 'pdChargedDash' }
    ],
    void_nova: [
        { key: 'vnRadius', label: 'Nova Radius', format: 'vnRadius' },
        { key: 'vnForce', label: 'Nova Force', format: 'vnForce' },
        { key: 'vnCooldown', label: 'Cooldown', format: 'vnCooldown' },
        { key: 'vnGravityWell', label: 'Gravity Well', format: 'vnGravityWell' }
    ]
};

// Perks are offered for every stat, including the skill ones. Kept as its own
// list because the Perks tab has always shown the echo stats between Critical
// Damage and Multishot, and moving them to Skills must not reshuffle that tab.
// Every stat that carries perk tiers, in the same order as the perks screen.
// Each skill's own parts sit together so a player reading a skill's milestones
// sees them under that skill rather than scattered across the screen.
const PERK_ROWS = [
    ...STAT_ROWS.slice(0, 7),
    ...SKILL_PART_ROWS.echo_shift,
    ...SKILL_PART_ROWS.time_dilation,
    ...SKILL_PART_ROWS.phase_dash,
    ...SKILL_PART_ROWS.void_nova,
    ...STAT_ROWS.slice(7)
].filter((row) => PERK_STATS.includes(row.key));

// Number keys buy a point in the matching stat, in screen order
const QUICK_KEY_STATS = STAT_ROWS.map((stat) => stat.key);

const UPGRADE_TABS = [
    { id: 'stats', label: 'Stats' },
    { id: 'perks', label: 'Perks' },
    { id: 'skills', label: 'Skills' }
];

export function tickHUD() {
    if (!game.gameState) return;
    updateHUD();
    // The rail and the single indicator are driven from the same tick, so a
    // cooldown that expires while paused cannot be left showing stale time
    syncSkillRail();
}

export function openLevelUpStatScreen() {
    statScreenMode = 'levelUp';
    renderStatScreen();
}
export function beginRun() {
    document.getElementById('onboarding').style.display = 'none';
    // Defensive: an overlay left visible would keep the input layer on the title state
    const title = document.getElementById('title-screen');
    if (title) title.style.display = 'none';
    saveSystem.saveData.onboardingCompleted = true;
    saveSystem.save();
    // A fresh run: this also shows the Wave 1 banner and reports gameplay to the portal
    game.restartRun();
}

export function closeStatScreen() {
    const container = document.getElementById('stat-screen-container');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    statScreenMode = 'manual';
    activeTab = 'stats';
    pendingUnlocks = [];
    clearStatNotice();
    gameplayStoppedForScreen = false;
}

function refreshTitleBest() {
    const el = document.getElementById('title-best');
    if (!el) return;
    const best = saveSystem.saveData.bestTime || 0;
    el.textContent = best > 0
        ? `Best Run: ${game.formatTime(best)} · Lv. ${saveSystem.saveData.highestLevel || 1}`
        : 'Best Run: —';
}

function initOnboardingWizard() {
    const screens = document.querySelectorAll('#onboarding .onboarding-screen');
    screens.forEach((screen, index) => {
        screen.style.display = index === 0 ? 'block' : 'none';
    });
    const stepLabel = document.getElementById('onboarding-step');
    if (stepLabel) stepLabel.textContent = `1 / ${screens.length}`;
}

function setUpEventListeners() {
    // Continue is delegated so it survives the container being re-rendered
    document.getElementById('stat-screen-container').addEventListener('click', (e) => {
        if (e.target.id === 'continue-btn') {
            closeStatScreenAndResume();
        }
        // Tab switching re-renders in place, so the header, points and pause
        // state stay exactly as they were
        const tab = e.target.dataset && e.target.dataset.tab;
        if (tab) {
            activeTab = tab;
            pendingUnlocks = [];
            clearStatNotice();
            renderStatScreen();
        }
    });

    // Stat point buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('stat-plus') && !e.target.disabled) {
            const statKey = e.target.dataset.stat;
            if (upgradeSystem.addPoint(statKey)) {
                game.applyPlayerStats();
                audio.play('stat-upgrade');
                renderStatScreen();
            }
        }
        
        // Skip tutorial
        if (e.target.classList.contains('skip-tutorial') || e.target.id === 'onboarding-skip-all') {
            beginRun();
        }
        if (e.target.id === 'onboarding-next') {
            advanceOnboarding(1);
        }
        if (e.target.id === 'title-play-btn') {
            document.getElementById('title-screen').style.display = 'none';
            openOnboarding();
        }
        if (e.target.id === 'title-howto-btn') {
            document.getElementById('title-screen').style.display = 'none';
            openOnboarding();
        }
        
        // Pause menu
        if (e.target.id === 'resume-btn') {
            // Hide the menu first so the UI always responds,
            // even if the optional SDK callback fails
            document.getElementById('pause-menu').style.display = 'none';
            game.gameplayStart();
        }
        if (e.target.id === 'stats-btn') {
            document.getElementById('pause-menu').style.display = 'none';
            statScreenMode = 'paused';
            renderStatScreen();
        }
        if (e.target.id === 'settings-btn') {
            settingsOpenedFromPause = true;
            openSettings();
        }
        if (e.target.id === 'restart-btn' || e.target.id === 'restart-btn2') {
            closeStatScreen();
            game.restartRun();
        }
        if (e.target.id === 'quit-btn' || e.target.id === 'main-menu-btn') {
            closeStatScreen();
            quitToTitle();
        }
        if (e.target.id === 'close-settings-btn') {
            closeSettings();
        }
    });

    // Volume settings listeners
    const masterVol = document.getElementById('master-vol');
    const sfxVol = document.getElementById('sfx-vol');
    if (masterVol) {
        const settings = game.loadGameSettings();
        masterVol.value = settings.masterVolume;
        if (sfxVol) sfxVol.value = settings.sfxVolume;
        game.applyGameSettings(settings);
        masterVol.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            audio.setMasterVolume(value);
            persistGameSettings({ masterVolume: value });
        });
    }
    if (sfxVol) {
        sfxVol.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            audio.setSFXVolume(value);
            persistGameSettings({ sfxVolume: value });
        });
    }
    const particleQuality = document.getElementById('particle-quality');
    const screenShake = document.getElementById('screen-shake');
    const swapTouch = document.getElementById('swap-touch-sides');
    const settings = game.loadGameSettings();
    if (particleQuality) {
        particleQuality.value = settings.particleQuality || 'medium';
        particleQuality.addEventListener('change', (e) => {
            persistGameSettings({ particleQuality: e.target.value });
            game.applyGameSettings(game.loadGameSettings());
        });
    }
    if (screenShake) {
        screenShake.checked = settings.screenShake !== false;
        screenShake.addEventListener('change', (e) => {
            persistGameSettings({ screenShake: e.target.checked });
            game.applyGameSettings(game.loadGameSettings());
        });
    }
    // Unchecked is the default layout, so only an explicit true opts into swapping
    if (swapTouch) {
        swapTouch.checked = settings.swapTouchSides === true;
        swapTouch.addEventListener('change', (e) => {
            persistGameSettings({ swapTouchSides: e.target.checked });
            game.applyGameSettings(game.loadGameSettings());
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Number keys 1-12 for quick stat allocation while stat screen is open
        const statScreen = document.getElementById('stat-screen-container');
        // Only on the Stats tab: on Perks or Skills those keys have no meaning,
        // and silently buying a point the player cannot see would be a trap
        if (statScreen && statScreen.style.display === 'block' && activeTab === 'stats') {
            const num = parseInt(e.key);
            if (num >= 1 && num <= QUICK_KEY_STATS.length) {
                const statKey = QUICK_KEY_STATS[num - 1];
                if (upgradeSystem.isMaxed(statKey)) {
                    showStatNotice(`${statLabel(statKey)} is already maxed out.`);
                    return;
                }
                if (upgradeSystem.addPoint(statKey)) {
                    game.applyPlayerStats();
                    audio.play('stat-upgrade');
                    renderStatScreen();
                }
            }
        }
    });
}

function openOnboarding() {
    const onboarding = document.getElementById('onboarding');
    const wizard = document.getElementById('onboarding-wizard');
    if (wizard) wizard.style.display = 'flex';
    if (onboarding) onboarding.style.display = 'flex';
    initOnboardingWizard();
}

function advanceOnboarding(delta) {
    const screens = [...document.querySelectorAll('#onboarding .onboarding-screen')];
    let current = screens.findIndex((s) => s.style.display !== 'none');
    if (current < 0) current = 0;
    const next = current + delta;
    if (next >= screens.length) {
        beginRun();
        return;
    }
    screens.forEach((s, i) => { s.style.display = i === next ? 'block' : 'none'; });
    const stepLabel = document.getElementById('onboarding-step');
    if (stepLabel) stepLabel.textContent = `${next + 1} / ${screens.length}`;
}

function updateHUD() {
    const state = game.gameState;

    // Level
    setText('level-display', `Lv. ${state.level}`);

    // Health
    const hpRatio = player.maxHP > 0 ? Math.max(0, player.hp / player.maxHP) : 0;
    const hpFill = document.getElementById('hp-bar-fill');
    if (hpFill) {
        hpFill.style.width = Math.min(hpRatio * 100, 100) + '%';
        hpFill.classList.toggle('low', hpRatio <= 0.34);
    }
    setText('hp-text', `${Math.ceil(Math.max(0, player.hp))} / ${player.maxHP} HP`);

    // XP
    const percent = state.xp / state.xpRequired;
    const xpBar = document.getElementById('xp-bar-fill');
    if (xpBar) xpBar.style.width = Math.min(percent * 100, 100) + '%';
    setText('xp-text', `${Math.floor(state.xp)} / ${state.xpRequired} XP`);

    // Run readouts
    setText('wave-display', `Wave ${game.getCurrentWave()}`);
    setText('time-display', game.formatTime(game.getRunTime()));
    setText('best-display', `Best ${game.formatTime(saveSystem.saveData.bestTime || 0)}`);
}

const hudCache = new Map();
function setText(id, value) {
    if (hudCache.get(id) === value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    hudCache.set(id, value);
}

// Render the upgrade screen: one window with Stats, Perks and Skills tabs
function renderStatScreen() {
    const container = document.getElementById('stat-screen-container');
    if (!container) return;

    // Drain the queue here so perks unlocked by any path (spending a point, a
    // level up, a fresh run) get celebrated on the next paint. Always append:
    // a second unlock landing while the first is still on screen has to wait
    // its turn, not disappear behind it.
    pendingUnlocks = pendingUnlocks.concat(game.consumePerkUnlocks());

    const availablePoints = upgradeSystem.getAvailablePoints();
    const abilityPoints = upgradeSystem.getAvailableAbilityPoints();

    const html = `
        <div id="stat-screen" class="screen" style="display: block;">
            <div class="screen-overlay"></div>
            <div class="stat-window">
                <h2>UPGRADES</h2>
                <div class="player-info">
                    Level ${game.gameState.level} &middot; XP: ${Math.floor(game.gameState.xp)} / ${game.gameState.xpRequired}
                </div>
                <div class="upgrade-tabs">
                    ${UPGRADE_TABS.map((tab) => `
                        <button class="tab-btn ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>
                    `).join('')}
                </div>
                ${renderUnlockBanner()}
                ${statNotice ? `<div class="stat-notice">${statNotice}</div>` : ''}
                <div class="upgrade-panel">
                    ${renderActiveTab()}
                </div>
                <div class="stat-points">
                    ${activeTab === 'skills'
                        ? `Available Ability Points: ${abilityPoints}`
                        : `Available Stat Points: ${availablePoints}`}<br>
                    <button id="continue-btn">Continue</button>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
    container.style.display = 'block';

    // Opening the upgrade screen from the pause menu must stop the run too, so
    // the portal is told gameplay ended while the player is allocating points.
    if (statScreenMode === 'paused' && !gameplayStoppedForScreen) {
        game.gameplayStop();
        gameplayStoppedForScreen = true;
    }
}

function statLabel(statKey) {
    const row = PERK_ROWS.find((r) => r.key === statKey);
    return row ? row.label : statKey;
}

function clearStatNotice() {
    statNotice = '';
    if (statNoticeTimer) {
        clearTimeout(statNoticeTimer);
        statNoticeTimer = null;
    }
}

// Refused actions need to say so: a point that vanishes with no explanation
// reads as a bug, and a stat row that looks spendable when it is not is worse.
function showStatNotice(message) {
    statNotice = message;
    if (statNoticeTimer) clearTimeout(statNoticeTimer);
    statNoticeTimer = setTimeout(() => {
        statNotice = '';
        statNoticeTimer = null;
        if (activeTab === 'stats' || activeTab === 'skills') renderStatScreen();
    }, 1600);
    if (activeTab === 'stats' || activeTab === 'skills') renderStatScreen();
}

function renderActiveTab() {
    if (activeTab === 'perks') return renderPerksTab();
    if (activeTab === 'skills') return renderSkillsTab();
    return renderStatsTab();
}

function renderUnlockBanner() {
    if (!pendingUnlocks.length) return '';
    const rows = pendingUnlocks.map((perk) => `
        <div class="perk-banner-row">
            <span class="perk-banner-name">${perk.name}</span>
            <span class="perk-banner-desc">${perk.description}</span>
        </div>
    `).join('');
    return `
        <div class="perk-banner">
            <div class="perk-banner-title">Perk unlocked</div>
            ${rows}
        </div>
    `;
}

// One upgradeable row: current value, base, bonus and the buy button. Shared by
// the Stats and Skills tabs so a stat reads the same wherever it is bought.
function renderUpgradeRow(stat, availablePoints) {
    const stats = upgradeSystem.getStats();
    const current = stats[stat.key];
    const def = upgradeSystem.stats[stat.key];
    const base = def.base;
    const bonus = calculateBonus(stat.key, current, base);

    let formatText = current;
        if (stat.format === 'hpRegen') {
            formatText = `${current} HP/sec`;
        } else if (stat.format === 'moveSpeed') {
            formatText = `${current} px/s`;
        } else if (stat.format === 'attackSpeed') {
            formatText = `${current.toFixed(2)}/sec`;
        } else if (stat.format === 'attackPower') {
            formatText = `${current} dmg`;
        } else if (stat.format === 'criticalChance') {
            formatText = `${current.toFixed(1)}%`;
        } else if (stat.format === 'criticalDamage') {
            formatText = `${current.toFixed(0)}%`;
        } else if (stat.format === 'echoPower') {
            formatText = `${current.toFixed(2)}x`;
        } else if (stat.format === 'echoDuration') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'echoCooldown') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'multishot') {
        formatText = `${current} shot${current === 1 ? '' : 's'}`;
        // Time Dilation: power reads as a speed multiplier, the cap as a tax
        } else if (stat.format === 'tdPower') {
            formatText = `${Math.round(current * 100)}% world speed`;
        } else if (stat.format === 'tdDuration') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'tdCooldown') {
            formatText = `${current.toFixed(1)} sec`;
        } else if (stat.format === 'tdSlowCap') {
            formatText = current === 0 ? 'None' : `-${Math.round(current * 100)}% speed`;
        // Phase Dash
        } else if (stat.format === 'pdDistance') {
            formatText = `${current} px`;
        } else if (stat.format === 'pdIFrames') {
            formatText = `${current.toFixed(2)} sec`;
        } else if (stat.format === 'pdCooldown') {
            formatText = `${current.toFixed(2)} sec`;
        } else if (stat.format === 'pdChargedDash') {
            formatText = current === 0 ? 'Not yet' : `${Math.round(current * 100)}% charge power`;
        // Void Nova
        } else if (stat.format === 'vnRadius') {
            formatText = `${current} px`;
        } else if (stat.format === 'vnForce') {
            formatText = `${current.toFixed(2)}x`;
        } else if (stat.format === 'vnCooldown') {
            formatText = `${current.toFixed(2)} sec`;
        } else if (stat.format === 'vnGravityWell') {
            formatText = current === 0 ? 'Not yet' : current >= 1 ? 'Pulls inward' : `${Math.round(current * 100)}%`;
    }

    // A stat can cost more than one point, so the button has to compare the
    // balance against this stat's cost rather than against zero.
    const cost = upgradeSystem.statCost(stat.key);
    // Capped stats (Critical Chance, Critical Damage, Echo Cooldown) cannot
    // take another point, so say so instead of silently eating the click
    const maxed = upgradeSystem.isMaxed(stat.key);
    const isDisabled = maxed || availablePoints < cost;
    // Tells the player what a single point is worth now, so percentage
    // scaling stays readable instead of looking like a flat bonus.
    const perPoint = def.percentPerPoint
        ? `+${trim(def.percentPerPoint * 100)}%`
        : `${trim(def.increment)}`;
    const hint = maxed
        ? 'Already maxed out, further points have no effect'
        : `Per point: ${cost > 1 ? `${perPoint}, costs ${cost} points` : perPoint}`;
    const bonusText = maxed ? 'Maxed' : `Bonus: ${bonus}`;
    const plusText = maxed ? 'MAX' : (cost > 1 ? `+${cost}` : '+');

    return `
        <div class="stat-row ${maxed ? 'maxed' : ''}">
            <span class="stat-name">${stat.label}</span>
            <span class="stat-value">${formatText}</span>
            <span class="stat-base">Base: ${base}</span>
            <span class="stat-bonus">${bonusText}</span>
            <button class="stat-plus ${isDisabled ? 'disabled' : ''}" data-stat="${stat.key}" title="${hint}" ${isDisabled ? 'disabled' : ''}>${plusText}</button>
        </div>
    `;
}

function renderStatsTab() {
    const availablePoints = upgradeSystem.getAvailablePoints();

    let html = '<div class="stats-grid">';
    STAT_ROWS.forEach((stat) => {
        html += renderUpgradeRow(stat, availablePoints);
    });
    html += '</div>';
    return html;
}

// Perks tab. Locked perks show only their requirement: the milestone is
// advertised, the effect is not.
function renderPerksTab() {
    let html = `
        <div class="perks-intro">
            Overcommit points into a single stat to unlock its perks. Echo Shift's
            stats count toward its perks too, and are bought with Ability Points
            on the Skills tab.
        </div>
        <div class="perks-grid">
    `;

    for (const stat of PERK_ROWS) {
        const bonus = perks.bonusPercent(stat.key);
        const next = perks.getNextLocked(stat.key);
        const progress = next ? Math.max(0, Math.min(1, bonus / next.threshold)) : 1;
        const sign = stat.key === 'echoCooldown' ? '-' : '+';

        html += `
            <div class="perk-group">
                <div class="perk-group-head">
                    <span class="perk-stat-name">${stat.label}</span>
                    <span class="perk-stat-bonus">${sign}${trim(Math.abs(bonus))}%</span>
                </div>
                <div class="perk-progress"><div class="perk-progress-fill" style="width: ${(progress * 100).toFixed(1)}%"></div></div>
                ${perks.getForStat(stat.key).map((perk) => `
                    <div class="perk-slot ${perk.unlocked ? 'unlocked' : 'locked'}">
                        <span class="perk-name">${perk.unlocked ? perk.name : '???'}</span>
                        <span class="perk-desc">${perk.unlocked ? perk.description : 'Effect unknown'}</span>
                        <span class="perk-req">${perk.unlocked
                            ? 'Unlocked'
                            : `Requires ${sign}${trim(perk.threshold)}% in ${stat.label}`}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    html += '</div>';
    return html;
}

// Skills tab. Every skill is a card built from the registry, so adding a
// skill means adding its parts to SKILL_PART_ROWS and nothing else here.
function renderSkillsTab() {
    const abilityPoints = upgradeSystem.getAvailableAbilityPoints();
    const equippedId = skillRegistry.getEquippedId();

    let cards = '';
    for (const id of SKILL_ORDER) {
        const skill = SKILLS[id];
        const rows = SKILL_PART_ROWS[id] || [];
        const remaining = skillRegistry.getCooldownRemaining(id);
        const isEquipped = id === equippedId;
        const status = remaining > 0 ? `Recharging (${remaining.toFixed(1)}s)` : 'Ready';

        let statRows = '<div class="stats-grid skill-stats-grid">';
        for (const row of rows) statRows += renderUpgradeRow(row, abilityPoints);
        statRows += '</div>';

        cards += `
            <div class="skill-card ${isEquipped ? 'equipped' : ''}" data-skill="${id}"
                 style="--skill-color: ${skill.color}; --skill-accent: ${skill.accent}">
                <div class="skill-head">
                    <span class="skill-name">${skill.name}</span>
                    <span class="skill-key">${skill.key}</span>
                </div>
                <p class="skill-desc">${skill.description}</p>
                <div class="skill-stats">
                    <span class="skill-stat">Status: ${status}</span>
                    ${isEquipped ? '<span class="skill-stat skill-equipped-tag">Equipped</span>' : ''}
                </div>
                ${statRows}
            </div>
        `;
    }

    return `
        <div class="skills-intro">
            Skills fire with SPACE (or the SKILL button on mobile) and switch
            with 1-4 or by tapping the rail on the right of the arena. Each is
            upgraded with Ability Points, earned on every level up and spent only
            here. Only the equipped skill shows a cooldown bar, but the others
            keep recharging in the background.
        </div>
        <div class="skills-grid">${cards}</div>
    `;
}

// --- Skill rail and the single cooldown indicator ---------------------------

// Rebuilt once at init and only ever restyled afterwards, so switching skills
// during a run cannot churn the DOM.
function buildSkillRail() {
    const rail = document.getElementById('skill-rail');
    if (!rail) return;
    rail.innerHTML = SKILL_ORDER.map((id) => {
        const skill = SKILLS[id];
        // The chip carries the icon instead of the name. Four words stacked up
        // took more room than the fight did, and the label was only ever read
        // once; after that the shape is what gets recognised. The name stays on
        // the title attribute, so a long press or a hover still spells it out.
        return `
            <button class="skill-chip" data-skill="${id}" title="${skill.name} (${skill.key})"
                    aria-label="${skill.name}" style="--skill-color: ${skill.color}; --skill-accent: ${skill.accent}">
                <svg class="skill-chip-icon" viewBox="0 0 24 24" aria-hidden="true"
                     fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round">${skill.icon}</svg>
                <span class="skill-chip-cd"></span>
            </button>
        `;
    }).join('');

    // One delegated pair of listeners, so they survive any later innerHTML changes.
    //
    // It binds pointerdown rather than click, which is what every other touch
    // control here uses. A click is not delivered until touchend, and while the
    // joystick is holding a captured pointer the browser is free to cancel that
    // synthesis, so a tap on a chip made with the other thumb while moving just
    // vanished. Pointerdown fires the instant the finger lands, which is also
    // what the player wants mid-fight: the switch should happen on contact, not
    // when they lift off.
    //
    // pointerdown already covers mouse, touch and pen, so the click listener is
    // there only for keyboard activation. That is the one path with no pointer
    // event behind it, and it is the one case that reports detail === 0: a
    // synthesized click from a tap or a mouse carries a click count instead, so
    // it is ignored here and cannot double-switch.
    const choose = (e) => {
        const chip = e.target.closest && e.target.closest('.skill-chip');
        if (chip && chip.dataset.skill) selectSkill(chip.dataset.skill);
    };
    rail.addEventListener('pointerdown', choose);
    rail.addEventListener('click', (e) => {
        if (e.detail === 0) choose(e);
    });

    syncSkillRail();
}

export function selectSkill(id) {
    if (!SKILLS[id]) return;
    skillRegistry.equip(id);
    // Holding a dash charge and switching away must not strand the charge: the
    // next time Phase Dash is equipped, SPACE would fire a stale full-charge
    // dash the player never asked for. Imported lazily to avoid the ui/game
    // import cycle at module load.
    if (id !== 'phase_dash') {
        import('./game.js').then((g) => g.cancelDashCharge());
    }
    syncSkillRail();
    // The Skills tab marks the equipped card, so it has to follow a switch made
    // out here during a run
    if (statScreenMode !== 'manual') renderStatScreen();
}

// Repaints the rail. Cheap enough to run every HUD tick; the only writes are
// text and a class, and only when the value actually changed.
//
// There is no cooldown bar here on purpose. The cooldown circle is drawn on the
// canvas around the player, and it takes its colour from whichever skill is
// equipped, so one circle serves all four.
export function syncSkillRail() {
    const equippedId = skillRegistry.getEquippedId();
    const equipped = SKILLS[equippedId];

    const chips = document.querySelectorAll('#skill-rail .skill-chip');
    chips.forEach((chip) => {
        const id = chip.dataset.skill;
        const isEquipped = id === equippedId;
        chip.classList.toggle('equipped', isEquipped);
        // A chip that is cooling down but not equipped still says so, dimly, so
        // switching to it is an informed choice rather than a guess
        const remaining = skillRegistry.getCooldownRemaining(id);
        chip.classList.toggle('cooling', remaining > 0.001 && !isEquipped);
        const cd = chip.querySelector('.skill-chip-cd');
        if (cd) cd.textContent = remaining > 0.001 ? `${remaining.toFixed(0)}s` : '';
    });

    const touchBtn = document.getElementById('touch-skill-btn');
    // The fire button still uses the word: it is the one place the player looks
    // to confirm what the button will actually do, and there is room for it.
    if (touchBtn) {
        touchBtn.textContent = equipped.shortName;
        touchBtn.style.setProperty('--skill-color', equipped.color);
        touchBtn.style.setProperty('--skill-accent', equipped.accent);
    }
}

function closeStatScreenAndResume() {
    const mode = statScreenMode;
    closeStatScreen();
    if (mode === 'levelUp') {
        game.closeStatAllocation();
    } else {
        // Opened from the pause menu: gameplayStop() paused the run, so resume
        game.gameplayStart();
    }
}

// Bonus text for the stat screen. Percentage stats report how far the value
// has grown from base; flat stats report the raw amount added.
function calculateBonus(statKey, current, base) {
    const stat = upgradeSystem.stats[statKey];
    if (stat.points === 0) return stat.percentPerPoint ? '0%' : '0';

    if (stat.percentPerPoint) {
        const percent = ((current - base) / base) * 100;
        return `+${trim(percent)}%`;
    }
    if (statKey === 'echoCooldown') {
        return `-${trim(Math.abs(current - base))}s`;
    }
    if (statKey === 'multishot') {
        return `+${trim(current - base)} shot${current - base === 1 ? '' : 's'}`;
    }
    return `+${trim(current - base)}`;
}

function trim(value) {
    return String(Math.round(value * 100) / 100);
}

function quitToTitle() {
    game.gameplayStop();
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('pause-menu').style.display = 'none';
    document.getElementById('settings-panel').style.display = 'none';
    closeStatScreen();
    const title = document.getElementById('title-screen');
    const wizard = document.getElementById('onboarding-wizard');
    if (title) title.style.display = 'flex';
    if (wizard) wizard.style.display = 'none';
    document.getElementById('onboarding').style.display = 'none';
    if (game.gameState) {
        game.gameState.isPaused = true;
        game.gameState.statAllocationOpen = false;
        // Records live in the save, not in the abandoned run
        game.gameState.highestLevel = saveSystem.saveData.highestLevel || 1;
        game.gameState.bestSurvivalTime = saveSystem.saveData.bestTime || 0;
    }
    refreshTitleBest();
}

// Settings panel
let settingsOpenedFromPause = false;

export function openSettings() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'flex';
}

export function closeSettings() {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'none';
    // Return to the pause menu instead of dropping the player into a paused run
    if (settingsOpenedFromPause) {
        settingsOpenedFromPause = false;
        document.getElementById('pause-menu').style.display = 'block';
    }
}
