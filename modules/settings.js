import { getDh29Preset } from './preset-manager.js';
import { debugLog, escapeHtml, getContext, notifyInfo } from './utils.js';

export const MODULE_NAME = 'aux_model_split';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    auxProfileName: '',
    auxProfileId: '',
    auxMaxTokens: 600,
    contextTurns: 3,
    silentFallback: true,
    debug: false,
    lastAuxOutput: '',
});

export function getSettings() {
    const context = getContext();
    if (!context?.extensionSettings) {
        return structuredClone(DEFAULT_SETTINGS);
    }

    const existing = context.extensionSettings[MODULE_NAME] ?? {};
    context.extensionSettings[MODULE_NAME] = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...existing,
    };

    return context.extensionSettings[MODULE_NAME];
}

export function initSettings() {
    getSettings();
}

function saveSettings() {
    getContext()?.saveSettingsDebounced?.();
}

function bindInput(root, selector, eventName, handler) {
    root.querySelector(selector)?.addEventListener(eventName, handler);
}

function findSettingsContainer() {
    return document.querySelector('#extensions_settings')
        ?? document.querySelector('#extensions_settings2')
        ?? document.querySelector('#extension_settings')
        ?? document.body;
}

function getConnectionProfiles() {
    const context = getContext();
    const profiles = context?.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) {
        return [];
    }

    return profiles.filter(Boolean);
}

function getSelectedProfileId(settings, profiles) {
    if (settings.auxProfileId && profiles.some((profile) => profile.id === settings.auxProfileId)) {
        return settings.auxProfileId;
    }

    const byName = profiles.find((profile) => profile.name === settings.auxProfileName);
    if (byName?.id) {
        settings.auxProfileId = byName.id;
        settings.auxProfileName = byName.name;
        saveSettings();
        return byName.id;
    }

    return '';
}

function renderProfileOptions(settings) {
    const profiles = getConnectionProfiles();
    const selectedId = getSelectedProfileId(settings, profiles);
    const options = [
        `<option value="">Connection Profile 선택</option>`,
        ...profiles.map((profile) => {
            const labelParts = [profile.name || profile.id];
            if (profile.api) {
                labelParts.push(profile.api);
            }
            if (profile.model) {
                labelParts.push(profile.model);
            }

            return `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedId ? 'selected' : ''}>${escapeHtml(labelParts.join(' · '))}</option>`;
        }),
    ];

    return options.join('');
}

function getSelectedProfileSummary(settings, profiles) {
    const selected = profiles.find((profile) => profile.id === settings.auxProfileId)
        ?? profiles.find((profile) => profile.name === settings.auxProfileName);

    if (!selected) {
        return settings.auxProfileName || '(none)';
    }

    return `${selected.name || selected.id} (${selected.id || 'no id'})`;
}

export function renderSettings() {
    const settings = getSettings();
    const preset = getDh29Preset();
    const container = findSettingsContainer();
    const profiles = getConnectionProfiles();
    debugLog(settings, `Connection profiles count: ${profiles.length}`);
    debugLog(settings, `Selected aux profile: ${getSelectedProfileSummary(settings, profiles)}`);
    let root = document.querySelector('#aux-model-split-settings');

    if (!root) {
        root = document.createElement('div');
        root.id = 'aux-model-split-settings';
        root.className = 'aux-split-settings';
        container.appendChild(root);
    }

    root.innerHTML = `
        <div class="aux-split-header">
            <h3>Aux Model Split</h3>
            <span>DH-29 MVP</span>
        </div>

        <label class="checkbox_label aux-split-row">
            <input id="aux-split-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
            <span>활성화</span>
        </label>

        <label class="aux-split-field">
            <span>보조 Connection Profile</span>
            ${profiles.length
                ? `<select id="aux-split-profile" class="text_pole">${renderProfileOptions(settings)}</select>`
                : `<input id="aux-split-profile-name" class="text_pole" type="text" value="${escapeHtml(settings.auxProfileName)}" placeholder="수동 프로필 이름 입력">`
            }
            <small class="aux-split-help">${profiles.length ? '저장된 ST Connection Profile을 직접 호출합니다.' : 'Connection Profile이 없습니다. ST API Connections에서 프로필을 먼저 저장하세요.'}</small>
        </label>

        <label class="aux-split-field">
            <span>보조 응답 토큰</span>
            <input id="aux-split-max-tokens" class="text_pole" type="number" min="100" max="4000" step="50" value="${Number(settings.auxMaxTokens) || 600}">
        </label>

        <label class="aux-split-field">
            <span>최근 컨텍스트 턴 수</span>
            <input id="aux-split-context-turns" class="text_pole" type="number" min="0" max="20" step="1" value="${Number(settings.contextTurns) || 0}">
        </label>

        <label class="checkbox_label aux-split-row">
            <input id="aux-split-silent" type="checkbox" ${settings.silentFallback ? 'checked' : ''}>
            <span>실패 시 메인 응답 유지</span>
        </label>

        <label class="checkbox_label aux-split-row">
            <input id="aux-split-debug" type="checkbox" ${settings.debug ? 'checked' : ''}>
            <span>디버그 로그</span>
        </label>

        <div class="aux-split-preset">
            <b>현재 프리셋</b>
            <code>${escapeHtml(preset.name)}</code>
            <small>분리 태그: &lt;${escapeHtml(preset.tagName)}&gt;</small>
        </div>

        <div class="aux-split-actions">
            <button id="aux-split-show-last" type="button" class="menu_button">마지막 보조 응답 보기</button>
        </div>
    `;

    bindInput(root, '#aux-split-enabled', 'change', (event) => {
        settings.enabled = Boolean(event.target.checked);
        saveSettings();
    });

    if (profiles.length) {
        bindInput(root, '#aux-split-profile', 'change', (event) => {
            const profileId = event.target.value;
            const profile = getConnectionProfiles().find((item) => item.id === profileId);
            settings.auxProfileId = profile?.id ?? '';
            settings.auxProfileName = profile?.name ?? '';
            debugLog(settings, `Selected aux profile changed: ${profile?.name || '(none)'} (${profile?.id || 'no id'})`);
            saveSettings();
        });
    } else {
        bindInput(root, '#aux-split-profile-name', 'input', (event) => {
            settings.auxProfileId = '';
            settings.auxProfileName = event.target.value.trim();
            debugLog(settings, `Manual aux profile name changed: ${settings.auxProfileName || '(empty)'}`);
            saveSettings();
        });
    }

    bindInput(root, '#aux-split-max-tokens', 'input', (event) => {
        settings.auxMaxTokens = Math.max(100, Math.min(4000, Number(event.target.value) || 600));
        saveSettings();
    });

    bindInput(root, '#aux-split-context-turns', 'input', (event) => {
        settings.contextTurns = Math.max(0, Math.min(20, Number(event.target.value) || 0));
        saveSettings();
    });

    bindInput(root, '#aux-split-silent', 'change', (event) => {
        settings.silentFallback = Boolean(event.target.checked);
        saveSettings();
    });

    bindInput(root, '#aux-split-debug', 'change', (event) => {
        settings.debug = Boolean(event.target.checked);
        saveSettings();
    });

    bindInput(root, '#aux-split-show-last', 'click', () => {
        const output = settings.lastAuxOutput || '아직 저장된 보조 응답이 없습니다.';
        notifyInfo(output);
    });
}
