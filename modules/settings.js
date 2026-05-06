import {
    DEFAULT_AUX_SYSTEM_PROMPT,
    DEFAULT_AUX_USER_PROMPT_TEMPLATE,
    DEFAULT_MAIN_BLOCKER_PROMPT,
    getDh29Preset,
} from './preset-manager.js';
import { debugLog, escapeHtml, getContext, notifyInfo } from './utils.js';

export const MODULE_NAME = 'aux_model_split';
const LOCAL_STORAGE_KEY = `${MODULE_NAME}_settings_backup`;

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    auxProfileName: '',
    auxProfileId: '',
    auxMaxTokens: 600,
    outputTagName: '상태창',
    footerTagName: '메뉴',
    omitFooterWhenTagName: 'd-0',
    appendFooterTag: true,
    mainBlockerPrompt: DEFAULT_MAIN_BLOCKER_PROMPT,
    auxSystemPrompt: DEFAULT_AUX_SYSTEM_PROMPT,
    auxUserPromptTemplate: DEFAULT_AUX_USER_PROMPT_TEMPLATE,
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
    const backup = readSettingsBackup();
    context.extensionSettings[MODULE_NAME] = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...existing,
        ...backup,
    };

    return context.extensionSettings[MODULE_NAME];
}

export function initSettings() {
    const settings = getSettings();
    const preset = getDh29Preset(settings);
    settings.outputTagName ||= preset.tagName;
    settings.footerTagName ||= preset.footerTagName;
    settings.omitFooterWhenTagName ||= preset.omitFooterWhenTagName;
    settings.appendFooterTag ??= true;
    settings.mainBlockerPrompt ||= DEFAULT_MAIN_BLOCKER_PROMPT;
    settings.auxSystemPrompt ||= DEFAULT_AUX_SYSTEM_PROMPT;
    settings.auxUserPromptTemplate ||= DEFAULT_AUX_USER_PROMPT_TEMPLATE;
    saveSettings();
}

function readSettingsBackup() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
    } catch (error) {
        console.warn('[AuxSplit] Failed to read settings backup', error);
        return {};
    }
}

function writeSettingsBackup(settings) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn('[AuxSplit] Failed to write settings backup', error);
    }
}

function saveSettings({ immediate = false } = {}) {
    const context = getContext();
    const settings = context?.extensionSettings?.[MODULE_NAME];
    if (settings) {
        writeSettingsBackup(settings);
    }

    const saveNow = context?.saveSettings
        ?? globalThis.saveSettings;
    const saveDebounced = context?.saveSettingsDebounced
        ?? globalThis.saveSettingsDebounced
        ?? saveNow;

    if (immediate && typeof saveNow === 'function') {
        saveNow();
        return;
    }

    saveDebounced?.();
}

function bindInput(root, selector, eventName, handler) {
    root.querySelector(selector)?.addEventListener(eventName, handler);
}

function bindPromptTextarea(root, selector, handler) {
    const element = root.querySelector(selector);
    if (!element) {
        return;
    }

    element.addEventListener('input', handler);
    element.addEventListener('change', (event) => {
        handler(event);
        saveSettings({ immediate: true });
    });
    element.addEventListener('blur', () => saveSettings({ immediate: true }));
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
    const preset = getDh29Preset(settings);
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

        <div class="aux-split-editor">
            <label class="aux-split-field">
                <span>출력 태그명</span>
                <input id="aux-split-tag-name" class="text_pole" type="text" value="${escapeHtml(settings.outputTagName)}" placeholder="상태창">
                <small class="aux-split-help">태그 괄호 없이 이름만 입력합니다. 예: 상태창, status, choices</small>
            </label>

            <label class="aux-split-field">
                <span>하단 마커 태그명</span>
                <input id="aux-split-footer-tag-name" class="text_pole" type="text" value="${escapeHtml(settings.footerTagName)}" placeholder="메뉴">
                <small class="aux-split-help">닫는 태그가 없는 하단 마커입니다. DH-29 기본값: 메뉴</small>
            </label>

            <label class="aux-split-field">
                <span>마커 생략 조건 태그명</span>
                <input id="aux-split-omit-footer-tag-name" class="text_pole" type="text" value="${escapeHtml(settings.omitFooterWhenTagName)}" placeholder="d-0">
                <small class="aux-split-help">이 마커가 있으면 하단 마커를 붙이지 않습니다. DH-29 기본값: d-0</small>
            </label>

            <label class="checkbox_label aux-split-row">
                <input id="aux-split-append-footer" type="checkbox" ${settings.appendFooterTag ? 'checked' : ''}>
                <span>하단 마커를 최종 메시지 맨 아래에 붙이기</span>
            </label>

            <label class="aux-split-textarea-field">
                <span>메인 모델 차단 프롬프트</span>
                <textarea id="aux-split-main-blocker" class="text_pole" rows="7">${escapeHtml(settings.mainBlockerPrompt)}</textarea>
                <small class="aux-split-help">메인 모델에게 해당 구조화 출력을 만들지 말라고 알려주는 지시입니다.</small>
            </label>

            <label class="aux-split-textarea-field">
                <span>보조 출력 프롬프트</span>
                <textarea id="aux-split-system-prompt" class="text_pole" rows="14">${escapeHtml(settings.auxSystemPrompt)}</textarea>
                <small class="aux-split-help">월드인포/작노에 있던 상태창 형식 지시를 여기에 옮겨 넣으세요.</small>
            </label>

            <label class="aux-split-textarea-field">
                <span>보조 유저 프롬프트 템플릿</span>
                <textarea id="aux-split-user-template" class="text_pole" rows="10">${escapeHtml(settings.auxUserPromptTemplate)}</textarea>
                <small class="aux-split-help">사용 가능 변수: {{mainResponse}}, {{recentContext}}, {{charName}}, {{userName}}, {{tagName}}, {{footerTagName}}, {{omitFooterWhenTagName}}</small>
            </label>
        </div>

        <div class="aux-split-actions">
            <button id="aux-split-reset-prompts" type="button" class="menu_button">프롬프트 기본값 복원</button>
            <button id="aux-split-show-last" type="button" class="menu_button">마지막 보조 응답 보기</button>
        </div>
    `;

    bindInput(root, '#aux-split-enabled', 'change', (event) => {
        settings.enabled = Boolean(event.target.checked);
        saveSettings({ immediate: true });
    });

    if (profiles.length) {
        bindInput(root, '#aux-split-profile', 'change', (event) => {
            const profileId = event.target.value;
            const profile = getConnectionProfiles().find((item) => item.id === profileId);
            settings.auxProfileId = profile?.id ?? '';
            settings.auxProfileName = profile?.name ?? '';
            debugLog(settings, `Selected aux profile changed: ${profile?.name || '(none)'} (${profile?.id || 'no id'})`);
            saveSettings({ immediate: true });
        });
    } else {
        bindInput(root, '#aux-split-profile-name', 'input', (event) => {
            settings.auxProfileId = '';
            settings.auxProfileName = event.target.value.trim();
            debugLog(settings, `Manual aux profile name changed: ${settings.auxProfileName || '(empty)'}`);
            saveSettings();
        });
        bindInput(root, '#aux-split-profile-name', 'change', () => saveSettings({ immediate: true }));
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
        saveSettings({ immediate: true });
    });

    bindInput(root, '#aux-split-debug', 'change', (event) => {
        settings.debug = Boolean(event.target.checked);
        saveSettings({ immediate: true });
    });

    bindInput(root, '#aux-split-tag-name', 'input', (event) => {
        settings.outputTagName = event.target.value.trim() || '상태창';
        saveSettings();
    });

    bindInput(root, '#aux-split-footer-tag-name', 'input', (event) => {
        settings.footerTagName = event.target.value.trim();
        saveSettings();
    });

    bindInput(root, '#aux-split-omit-footer-tag-name', 'input', (event) => {
        settings.omitFooterWhenTagName = event.target.value.trim();
        saveSettings();
    });

    bindInput(root, '#aux-split-append-footer', 'change', (event) => {
        settings.appendFooterTag = Boolean(event.target.checked);
        saveSettings({ immediate: true });
    });

    bindPromptTextarea(root, '#aux-split-main-blocker', (event) => {
        settings.mainBlockerPrompt = event.target.value;
        saveSettings();
    });

    bindPromptTextarea(root, '#aux-split-system-prompt', (event) => {
        settings.auxSystemPrompt = event.target.value;
        saveSettings();
    });

    bindPromptTextarea(root, '#aux-split-user-template', (event) => {
        settings.auxUserPromptTemplate = event.target.value;
        saveSettings();
    });

    bindInput(root, '#aux-split-reset-prompts', 'click', () => {
        settings.outputTagName = '상태창';
        settings.footerTagName = '메뉴';
        settings.omitFooterWhenTagName = 'd-0';
        settings.appendFooterTag = true;
        settings.mainBlockerPrompt = DEFAULT_MAIN_BLOCKER_PROMPT;
        settings.auxSystemPrompt = DEFAULT_AUX_SYSTEM_PROMPT;
        settings.auxUserPromptTemplate = DEFAULT_AUX_USER_PROMPT_TEMPLATE;
        saveSettings({ immediate: true });
        renderSettings();
    });

    bindInput(root, '#aux-split-show-last', 'click', () => {
        const output = settings.lastAuxOutput || '아직 저장된 보조 응답이 없습니다.';
        notifyInfo(output);
    });

    window.addEventListener('beforeunload', () => saveSettings({ immediate: true }), { once: true });
}
