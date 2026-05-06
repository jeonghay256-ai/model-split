import { getDh29Preset } from './preset-manager.js';
import { escapeHtml, getContext, notifyInfo } from './utils.js';

export const MODULE_NAME = 'aux_model_split';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    auxProfileName: '',
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

export function renderSettings() {
    const settings = getSettings();
    const preset = getDh29Preset();
    const container = findSettingsContainer();
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
            <span>보조 모델 프로필 이름</span>
            <input id="aux-split-profile" class="text_pole" type="text" value="${escapeHtml(settings.auxProfileName)}" placeholder="예: aux-fast">
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

    bindInput(root, '#aux-split-profile', 'input', (event) => {
        settings.auxProfileName = event.target.value.trim();
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
