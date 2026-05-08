import {
    DEFAULT_AUX_SYSTEM_PROMPT,
    DEFAULT_AUX_USER_PROMPT_TEMPLATE,
    DEFAULT_MAIN_BLOCKER_PROMPT,
    migrateLegacySettingsToPresets,
    syncFlatFieldsToActivePreset,
    ensureBuiltinPresetsLoaded,
} from './preset-manager.js';
import * as PresetMgr from './preset-manager.js';
import { debugLog, escapeHtml, getContext, notifyError, notifyInfo, notifyWarning } from './utils.js';

const { getActivePreset } = PresetMgr;

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
    // 5a 신규: 새 데이터 모델 슬롯. initSettings 의 마이그레이션이 schemaVersion 을 2 로 끌어올리고 presets[0] 를 채운다.
    schemaVersion: 0,
    activePresetIndex: 0,
    presets: [],
    // 5b 신규: 기본 프리셋(dh-29, eden-univ) 1회 자동 로드 추적.
    builtinPresetsImported: false,
    // 5d 신규: variableSets Role 강제 override (디버그용, 빈 문자열이면 자동 결정)
    activeRoleOverride: '',
    // Phase 6 신규: Import 시 가져온 프리셋을 즉시 활성화할지
    importActivateImmediately: false,
    activePromptSectionIndex: 0,
    activeSettingsTab: 'basic',
});

export function getSettings() {
    const context = getContext();
    if (!context?.extensionSettings) {
        return structuredClone(DEFAULT_SETTINGS);
    }

    let settings = context.extensionSettings[MODULE_NAME];
    const isFreshObject = !settings || typeof settings !== 'object' || Array.isArray(settings);

    if (isFreshObject) {
        // 첫 호출: backup + 기본값으로 한 번만 빌드. 이후 같은 reference 유지.
        const backup = readSettingsBackup();
        settings = {
            ...structuredClone(DEFAULT_SETTINGS),
            ...backup,
        };
        context.extensionSettings[MODULE_NAME] = settings;
    } else {
        // 후속 호출: 누락 필드만 채우고 기존 reference 보존.
        // 새 객체를 매번 만들면 비동기 코드가 stale reference 를 잡게 되어
        // ensureBuiltinPresetsLoaded 같은 비동기 변경이 손실된다.
        const defaults = structuredClone(DEFAULT_SETTINGS);
        for (const key of Object.keys(defaults)) {
            if (!Object.hasOwn(settings, key)) {
                settings[key] = defaults[key];
            }
        }
    }

    return settings;
}

function getExtensionFolderPath() {
    try {
        // settings.js -> ../  = aux-model-split 확장 폴더 root
        const url = new URL('..', import.meta.url);
        return url.href.replace(/\/$/, '');
    } catch (error) {
        console.warn('[AuxSplit] getExtensionFolderPath fallback', error);
        return 'scripts/extensions/third-party/aux-model-split';
    }
}

export function initSettings() {
    const settings = getSettings();
    settings.outputTagName ||= '상태창';
    settings.footerTagName ||= '메뉴';
    settings.omitFooterWhenTagName ||= 'd-0';
    settings.appendFooterTag ??= true;
    settings.mainBlockerPrompt ||= DEFAULT_MAIN_BLOCKER_PROMPT;
    settings.auxSystemPrompt ||= DEFAULT_AUX_SYSTEM_PROMPT;
    settings.auxUserPromptTemplate ||= DEFAULT_AUX_USER_PROMPT_TEMPLATE;
    migrateLegacySettingsToPresets(settings);
    saveSettings();

    // 5b: 기본 프리셋(dh-29, eden-univ) 1회 자동 로드. fire-and-forget.
    const folderPath = getExtensionFolderPath();
    void ensureBuiltinPresetsLoaded(settings, folderPath).then((added) => {
        if (added) {
            saveSettings({ immediate: true });
            console.log('[AuxSplit] Builtin presets loaded');
        }
    }).catch((error) => {
        console.warn('[AuxSplit] Builtin preset load failed', error);
    });
}

export function registerSettingsMenuButton() {
    const interval = window.setInterval(() => {
        const menu = document.querySelector('#extensionsMenu');
        if (!menu) {
            return;
        }

        if (document.querySelector('#aux-model-split-menu-button')) {
            window.clearInterval(interval);
            return;
        }

        const button = document.createElement('div');
        button.id = 'aux-model-split-menu-button';
        button.className = 'menu_button aux-split-menu-button';
        button.title = 'Aux Model Split';
        button.innerHTML = '<span class="fa-solid fa-code-branch"></span><span>Aux Model Split</span>';
        button.addEventListener('click', () => openSettingsDialog());
        menu.appendChild(button);

        const extensionsMenuButton = document.querySelector('#extensionsMenuButton');
        if (extensionsMenuButton instanceof HTMLElement) {
            extensionsMenuButton.style.display = '';
        }

        window.clearInterval(interval);
    }, 250);
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
        syncFlatFieldsToActivePreset(settings);
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

function ensureSettingsDialog() {
    let dialog = document.querySelector('#aux-model-split-dialog');
    if (dialog) {
        return dialog;
    }

    dialog = document.createElement('div');
    dialog.id = 'aux-model-split-dialog';
    dialog.className = 'aux-split-dialog';
    dialog.hidden = true;
    dialog.innerHTML = `
        <div class="aux-split-dialog-backdrop" data-aux-split-close></div>
        <section class="aux-split-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="aux-split-dialog-title">
            <div class="aux-split-dialog-header">
                <h3 id="aux-split-dialog-title">Aux Model Split</h3>
                <button id="aux-split-dialog-close" class="menu_button aux-split-icon-button" type="button" title="닫기">×</button>
            </div>
            <div id="aux-model-split-dialog-body" class="aux-split-dialog-body"></div>
        </section>
    `;

    dialog.addEventListener('click', (event) => {
        if (event.target instanceof HTMLElement && event.target.matches('[data-aux-split-close], #aux-split-dialog-close')) {
            closeSettingsDialog();
        }
    });

    document.body.appendChild(dialog);
    return dialog;
}

export function openSettingsDialog() {
    renderSettings();
    const dialog = ensureSettingsDialog();
    dialog.hidden = false;
    document.body.classList.add('aux-split-dialog-open');
}

function closeSettingsDialog() {
    const dialog = document.querySelector('#aux-model-split-dialog');
    if (dialog) {
        dialog.hidden = true;
    }

    document.body.classList.remove('aux-split-dialog-open');
}

function findSettingsContainer() {
    const dialog = ensureSettingsDialog();
    return dialog.querySelector('#aux-model-split-dialog-body') ?? document.body;
}

// ============================================================================
// Phase 6 신규 helper: 다운로드 / outputs 요약 / 날짜 / Import 라우팅
// ============================================================================

function downloadJsonFile(content, filename) {
    try {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    } catch (error) {
        console.error('[AuxSplit] downloadJsonFile failed', error);
        notifyError('파일 다운로드 실패: ' + (error?.message ?? error));
        return false;
    }
}

function formatOutputsSummary(preset) {
    const enabled = (preset?.outputs ?? []).filter(o => o && o.enabled);
    if (enabled.length === 0) return '(no enabled outputs)';
    return 'outputs: ' + enabled.map(o => o.id).join(', ');
}

function renderOutputsList(preset) {
    const outputs = Array.isArray(preset?.outputs) ? preset.outputs : [];
    if (outputs.length === 0) {
        return '<div class="aux-split-empty">이 프리셋에는 출력 항목이 없습니다.</div>';
    }

    return outputs.map((output, index) => {
        const enabledText = output?.enabled === false ? '비활성' : '활성';
        const enabledClass = output?.enabled === false ? 'is-disabled' : 'is-enabled';
        const template = output?.outputTemplate || '';
        const hasTemplate = output?.type === 'nested' || output?.responseMode === 'json+template';
        const option = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;

        return `
            <article class="aux-split-output-card ${enabledClass}">
                <div class="aux-split-output-head">
                    <input
                        class="text_pole aux-split-output-label"
                        type="text"
                        data-output-index="${index}"
                        value="${escapeHtml(output?.label || output?.id || `output ${index + 1}`)}"
                        aria-label="출력 항목 이름"
                    >
                    <div class="aux-split-output-card-actions">
                        <button
                            class="menu_button aux-split-output-toggle"
                            type="button"
                            data-output-index="${index}"
                            title="이 출력 항목 활성화/비활성화"
                        >${escapeHtml(enabledText)}</button>
                        <button
                            class="menu_button aux-split-output-clone"
                            type="button"
                            data-output-index="${index}"
                            title="이 출력 항목 복제"
                        >복제</button>
                        <button
                            class="menu_button aux-split-output-delete"
                            type="button"
                            data-output-index="${index}"
                            title="이 출력 항목 삭제"
                        >삭제</button>
                    </div>
                </div>
                <div class="aux-split-output-grid">
                    <span>ID</span><code>${escapeHtml(output?.id || '')}</code>

                    <label for="aux-split-output-tag-${index}">태그명</label>
                    <input
                        id="aux-split-output-tag-${index}"
                        class="text_pole aux-split-output-tag"
                        type="text"
                        data-output-index="${index}"
                        value="${escapeHtml(output?.tagName || '')}"
                        placeholder="상태창"
                    >

                    <label for="aux-split-output-type-${index}">타입</label>
                    <select id="aux-split-output-type-${index}" class="text_pole aux-split-output-type" data-output-index="${index}">
                        ${option('block', 'block', output?.type)}
                        ${option('marker', 'marker', output?.type)}
                        ${option('nested', 'nested', output?.type)}
                    </select>

                    <label for="aux-split-output-position-${index}">위치</label>
                    <select id="aux-split-output-position-${index}" class="text_pole aux-split-output-position" data-output-index="${index}">
                        ${option('prepend', '상단', output?.position)}
                        ${option('append', '하단', output?.position)}
                    </select>

                    <label for="aux-split-output-mode-${index}">모드</label>
                    <select id="aux-split-output-mode-${index}" class="text_pole aux-split-output-mode" data-output-index="${index}">
                        ${option('raw', 'raw', output?.responseMode || 'raw')}
                        ${option('json+template', 'json+template', output?.responseMode || 'raw')}
                    </select>

                    <label for="aux-split-output-omit-${index}">생략 조건</label>
                    <input
                        id="aux-split-output-omit-${index}"
                        class="text_pole aux-split-output-omit"
                        type="text"
                        data-output-index="${index}"
                        value="${escapeHtml(output?.omitWhenTagPresent || '')}"
                        placeholder="없으면 비워둠"
                    >
                </div>
                ${hasTemplate ? `<details class="aux-split-output-template">
                    <summary>템플릿 보기</summary>
                    <pre>${escapeHtml(template)}</pre>
                </details>` : ''}
            </article>
        `;
    }).join('');
}

function renderPromptSectionOptions(preset, activeIndex) {
    const sections = PresetMgr.ensurePromptSections(preset);
    return sections.map((section, index) => {
        const status = section.enabled === false ? 'off' : 'on';
        const order = Number(section.order) || 0;
        const label = `${section.name || `Section ${index + 1}`} [${status}] (${order})`;
        return `<option value="${index}" ${index === activeIndex ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

function getActivePromptSection(settings, preset) {
    const sections = PresetMgr.ensurePromptSections(preset);
    if (sections.length === 0) {
        return { section: null, index: -1 };
    }

    let index = Number.isInteger(settings.activePromptSectionIndex) ? settings.activePromptSectionIndex : 0;
    if (index < 0 || index >= sections.length) {
        index = 0;
        settings.activePromptSectionIndex = 0;
    }

    return { section: sections[index], index };
}

const SETTINGS_TABS = Object.freeze([
    { id: 'basic', label: '기본', icon: 'fa-sliders' },
    { id: 'api', label: 'API', icon: 'fa-plug' },
    { id: 'preset', label: '프리셋', icon: 'fa-folder-open' },
    { id: 'outputs', label: '출력', icon: 'fa-code' },
    { id: 'prompts', label: '프롬프트', icon: 'fa-pen-to-square' },
    { id: 'status', label: '상태', icon: 'fa-circle-info' },
]);

function normalizeSettingsTab(settings) {
    const tabs = SETTINGS_TABS.map((tab) => tab.id);
    if (!tabs.includes(settings.activeSettingsTab)) {
        settings.activeSettingsTab = 'basic';
    }

    return settings.activeSettingsTab;
}

function renderSettingsTabs(activeTab) {
    return SETTINGS_TABS.map((tab) => `
        <button
            type="button"
            class="menu_button aux-split-tab ${tab.id === activeTab ? 'is-active' : ''}"
            data-aux-split-tab="${escapeHtml(tab.id)}"
            aria-selected="${tab.id === activeTab ? 'true' : 'false'}"
        >
            <span class="fa-solid ${escapeHtml(tab.icon)}"></span>
            <span>${escapeHtml(tab.label)}</span>
        </button>
    `).join('');
}

function renderTabPanel(id, activeTab, content) {
    return `
        <section
            class="aux-split-tab-panel ${id === activeTab ? 'is-active' : ''}"
            data-aux-split-panel="${escapeHtml(id)}"
            ${id === activeTab ? '' : 'hidden'}
        >
            ${content}
        </section>
    `;
}

function ymdString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function sanitizeFilename(name) {
    return String(name ?? '').replace(/[^\w\-가-힣.]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'preset';
}

function handleImportText(text, settings) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return { ok: false, message: 'JSON 파싱 실패: ' + e.message };
    }

    const isBundle = parsed && parsed.format === 'aux-model-split-presets-bundle';

    if (isBundle) {
        const result = PresetMgr.importPresetsFromJSON(text);
        if (!result.ok || result.presets.length === 0) {
            return { ok: false, message: 'Bundle import 실패: ' + (result.errors?.join('; ') || 'no valid presets') };
        }
        const indices = [];
        for (const p of result.presets) {
            indices.push(PresetMgr.addPreset(settings, p));
        }
        if (settings.importActivateImmediately && indices.length > 0) {
            PresetMgr.setActivePreset(settings, indices[indices.length - 1]);
        }
        return {
            ok: true,
            message: `Bundle import 성공: ${indices.length}개 프리셋 추가${result.errors?.length ? ` (${result.errors.length}개 reject)` : ''}`,
            indices,
        };
    }

    const result = PresetMgr.importPresetFromJSON(text);
    if (!result.ok) {
        return { ok: false, message: 'Import 실패: ' + (result.errors?.join('; ') || 'unknown') };
    }
    const idx = PresetMgr.addPreset(settings, result.preset);
    if (settings.importActivateImmediately) {
        PresetMgr.setActivePreset(settings, idx);
    }
    return {
        ok: true,
        message: `Import 성공: idx=${idx}, id=${result.preset.id}`,
        indices: [idx],
    };
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

function sanitizeTagName(value) {
    return String(value ?? '')
        .trim()
        .replace(/^<\/?/, '')
        .replace(/>$/, '')
        .replace(/^\/+/, '')
        .trim();
}

function parseCsvList(value) {
    return String(value ?? '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function getOutputByIndex(settings, outputIndex) {
    const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
    return active?.outputs?.[outputIndex] ?? null;
}

function updateOutputByIndex(settings, outputIndex, patch) {
    const output = getOutputByIndex(settings, outputIndex);
    if (!output || !patch || typeof patch !== 'object') {
        return null;
    }

    Object.assign(output, patch);
    return output;
}

function getDefaultOutputTemplate(type) {
    if (type === 'marker') {
        return '<{{tagName}}>';
    }
    if (type === 'nested') {
        return '<{{tagName}}>\n<Analysis>{{analysis}}</Analysis>\n<JSONPatch>{{patch}}</JSONPatch>\n</{{tagName}}>';
    }
    return '<{{tagName}}>\n{{content}}\n</{{tagName}}>';
}

function shouldReplaceOutputTemplate(output, nextType) {
    const current = String(output?.outputTemplate ?? '').trim();
    if (!current) {
        return true;
    }

    return current === '<{{tagName}}>'
        || current === '<{{tagName}}>\n{{content}}\n</{{tagName}}>'
        || current === '<{{tagName}}>\n<Analysis>{{analysis}}</Analysis>\n<JSONPatch>{{patch}}</JSONPatch>\n</{{tagName}}>'
        || output?.type !== nextType;
}

function bindOutputText(root, selector, patcher) {
    root.querySelectorAll(selector).forEach((element) => {
        const handler = (event) => {
            const target = event.currentTarget;
            const outputIndex = Number(target?.dataset?.outputIndex);
            const output = patcher(outputIndex, target.value);
            if (!output) {
                notifyError('출력 항목을 찾을 수 없습니다.');
                return;
            }

            saveSettings({ immediate: true });
        };

        element.addEventListener('change', handler);
        element.addEventListener('blur', handler);
    });
}

function bindOutputSelect(root, selector, fieldName, settings) {
    root.querySelectorAll(selector).forEach((element) => {
        element.addEventListener('change', (event) => {
            const target = event.currentTarget;
            const outputIndex = Number(target?.dataset?.outputIndex);
            let patch = { [fieldName]: target.value };
            const currentOutput = getOutputByIndex(settings, outputIndex);
            if (fieldName === 'type' && shouldReplaceOutputTemplate(currentOutput, target.value)) {
                patch = {
                    ...patch,
                    outputTemplate: getDefaultOutputTemplate(target.value),
                    responseMode: target.value === 'nested' ? 'json+template' : 'raw',
                };
            }

            const output = updateOutputByIndex(settings, outputIndex, patch);
            if (!output) {
                notifyError('출력 항목을 찾을 수 없습니다.');
                return;
            }

            saveSettings({ immediate: true });
            renderSettings();
        });
    });
}

export function renderSettings() {
    const settings = getSettings();
    const preset = getActivePreset(settings);
    const { section: activePromptSection, index: activePromptSectionIndex } = getActivePromptSection(settings, preset);
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

    const activeTab = normalizeSettingsTab(settings);
    const basicPanel = `
        <div class="aux-split-card">
            <div class="aux-split-section-title">
                <b><span class="fa-solid fa-gear"></span> 기본 설정</b>
                <small>보조 출력 합성의 기본 동작을 정합니다.</small>
            </div>

            <label class="checkbox_label aux-split-switch-row">
                <span>
                    <b>확장 활성화</b>
                    <small>끄면 보조 출력이 최종 메시지에 합성되지 않습니다.</small>
                </span>
                <input id="aux-split-enabled" class="aux-split-switch" type="checkbox" ${settings.enabled ? 'checked' : ''}>
            </label>

            <label class="checkbox_label aux-split-switch-row">
                <span>
                    <b>실패 시 메인 응답 유지</b>
                    <small>보조 호출이 실패해도 RP 본문을 보존합니다.</small>
                </span>
                <input id="aux-split-silent" class="aux-split-switch" type="checkbox" ${settings.silentFallback ? 'checked' : ''}>
            </label>

            <label class="checkbox_label aux-split-switch-row">
                <span>
                    <b>디버그 로그</b>
                    <small>F12 콘솔에 프로필, 보조 호출, 합성 결과를 기록합니다.</small>
                </span>
                <input id="aux-split-debug" class="aux-split-switch" type="checkbox" ${settings.debug ? 'checked' : ''}>
            </label>

            <label class="aux-split-field aux-split-field-stack">
                <span>최근 컨텍스트 턴 수</span>
                <input id="aux-split-context-turns" class="text_pole" type="number" min="0" max="20" step="1" value="${Number(settings.contextTurns) || 0}">
                <small class="aux-split-help">보조모델에게 함께 보내는 최근 대화 턴 수입니다.</small>
            </label>
        </div>
    `;

    const apiPanel = `
        <div class="aux-split-card">
            <div class="aux-split-section-title">
                <b><span class="fa-solid fa-plug"></span> 보조 모델 연결</b>
                <small>활성 프리셋에 사용할 Connection Profile을 정합니다.</small>
            </div>

            <div class="aux-split-status-pill">
                <span class="fa-solid fa-plug"></span>
                <span>현재 보조 연결: <b>${escapeHtml(getSelectedProfileSummary(settings, profiles))}</b></span>
            </div>

            <label class="aux-split-field aux-split-field-stack">
                <span>보조 Connection Profile</span>
                ${profiles.length
                    ? `<select id="aux-split-profile" class="text_pole">${renderProfileOptions(settings)}</select>`
                    : `<input id="aux-split-profile-name" class="text_pole" type="text" value="${escapeHtml(settings.auxProfileName)}" placeholder="수동 프로필 이름 입력">`
                }
                <small class="aux-split-help">${profiles.length ? '활성 프리셋에 저장된 ST Connection Profile을 직접 호출합니다.' : 'Connection Profile이 없습니다. ST API Connections에서 프로필을 먼저 저장하세요.'}</small>
            </label>

            <label class="aux-split-field aux-split-field-stack">
                <span>보조 응답 토큰</span>
                <input id="aux-split-max-tokens" class="text_pole" type="number" min="100" max="32000" step="50" value="${Number(settings.auxMaxTokens) || 600}">
                <small class="aux-split-help">보조모델의 구조화 출력에 허용할 최대 토큰 수입니다.</small>
            </label>
        </div>
    `;

    const presetPanel = `
        <div class="aux-split-preset aux-split-card">
            <div class="aux-split-section-title">
                <b><span class="fa-solid fa-folder-open"></span> 활성 프리셋</b>
                <small>봇카드별 출력 규칙과 보조 모델 설정을 관리합니다.</small>
            </div>
            <select id="aux-split-preset-select" class="text_pole">
                ${PresetMgr.listPresets(settings).map((p, i) => `
                    <option value="${i}" ${i === settings.activePresetIndex ? 'selected' : ''}>${escapeHtml(p?.name || `(no-name #${i})`)}${p?.builtin ? ' [builtin]' : ''}</option>
                `).join('')}
            </select>
            <small class="aux-split-preset-summary">${escapeHtml(formatOutputsSummary(preset))}</small>

            <div class="aux-split-preset-actions">
                <button id="aux-split-save-preset" type="button" class="menu_button">현재 프리셋 저장</button>
                <button id="aux-split-new-preset" type="button" class="menu_button">새 프리셋</button>
                <button id="aux-split-clone" type="button" class="menu_button">복제</button>
                <button id="aux-split-rename" type="button" class="menu_button">이름 변경</button>
                <button id="aux-split-delete" type="button" class="menu_button">삭제</button>
            </div>

            <div class="aux-split-preset-actions">
                <button id="aux-split-export" type="button" class="menu_button">JSON 내보내기</button>
                <button id="aux-split-export-all" type="button" class="menu_button">전체 JSON 내보내기</button>
                <button id="aux-split-import-trigger" type="button" class="menu_button">JSON 가져오기</button>
                <input id="aux-split-import-file" type="file" accept="application/json,.json" style="display:none">
            </div>

            <label class="checkbox_label aux-split-row aux-split-checkbox-row">
                <input id="aux-split-import-activate" type="checkbox" ${settings.importActivateImmediately ? 'checked' : ''}>
                <span>가져온 프리셋 즉시 활성화</span>
            </label>
        </div>
    `;

    const outputsPanel = `
        <section class="aux-split-outputs aux-split-card">
            <div class="aux-split-section-title">
                <b>출력 항목</b>
                <small>보조모델 응답에서 찾을 태그와 최종 메시지에 붙일 위치를 정합니다.</small>
            </div>
            <div class="aux-split-output-toolbar">
                <button id="aux-split-add-output" type="button" class="menu_button">출력 항목 추가</button>
            </div>
            <div class="aux-split-output-list">
                ${renderOutputsList(preset)}
            </div>
            <div class="aux-split-notice">
                태그명은 괄호 없이 입력하세요. 예: 상태창, status, choices
            </div>
        </section>
    `;

    const promptsPanel = `
        <div class="aux-split-editor">
            <section class="aux-split-prompt-sections aux-split-card">
                <div class="aux-split-section-title">
                    <b>보조 출력 프롬프트 섹션</b>
                    <small>월드인포/작가노트에 있던 규칙을 여러 조각으로 나누어 관리합니다.</small>
                </div>

                <div class="aux-split-prompt-section-toolbar">
                    <select id="aux-split-prompt-section-select" class="text_pole">
                        ${renderPromptSectionOptions(preset, activePromptSectionIndex)}
                    </select>
                    <button id="aux-split-add-prompt-section" type="button" class="menu_button">섹션 추가</button>
                    <button id="aux-split-clone-prompt-section" type="button" class="menu_button">복제</button>
                    <button id="aux-split-delete-prompt-section" type="button" class="menu_button">삭제</button>
                </div>

                <div class="aux-split-prompt-section-meta aux-split-prompt-section-main-meta">
                    <label>
                        <span>섹션 이름</span>
                        <input id="aux-split-prompt-section-name" class="text_pole" type="text" value="${escapeHtml(activePromptSection?.name || '')}">
                    </label>
                    <label class="checkbox_label aux-split-row aux-split-checkbox-row">
                        <input id="aux-split-prompt-section-enabled" class="aux-split-switch" type="checkbox" ${activePromptSection?.enabled !== false ? 'checked' : ''}>
                        <span>활성화</span>
                    </label>
                </div>

                <label class="aux-split-textarea-field">
                    <span>섹션 내용</span>
                    <textarea id="aux-split-prompt-section-content" class="text_pole" rows="16">${escapeHtml(activePromptSection?.content || '')}</textarea>
                    <small class="aux-split-help">활성화된 섹션들이 조립 순서대로 합쳐져 보조모델에게 전달됩니다.</small>
                </label>

                <details class="aux-split-advanced">
                    <summary>고급 설정</summary>
                    <div class="aux-split-prompt-section-meta">
                        <label>
                            <span>조립 순서</span>
                            <input id="aux-split-prompt-section-order" class="text_pole" type="number" step="10" value="${Number(activePromptSection?.order) || 100}">
                        </label>
                        <label>
                            <span>관련 output ID</span>
                            <input id="aux-split-prompt-section-targets" class="text_pole" type="text" value="${escapeHtml((activePromptSection?.targetOutputs || []).join(', '))}" placeholder="status, choices, updateVariable">
                        </label>
                        <label>
                            <span>Role 필터</span>
                            <input id="aux-split-prompt-section-roles" class="text_pole" type="text" value="${escapeHtml((activePromptSection?.roleFilter || []).join(', '))}" placeholder="student, faculty, outsider">
                        </label>
                    </div>
                    <small class="aux-split-help">비워두면 항상 사용됩니다. Role 필터는 자연어가 아니라 student, faculty 같은 기계적 값입니다.</small>
                </details>
            </section>

            <label class="aux-split-textarea-field aux-split-card">
                <span>메인 모델 차단 프롬프트</span>
                <textarea id="aux-split-main-blocker" class="text_pole" rows="7">${escapeHtml(settings.mainBlockerPrompt)}</textarea>
                <small class="aux-split-help">메인 모델에게 구조화 출력을 만들지 말라고 알려주는 지시입니다.</small>
            </label>

            <label class="aux-split-textarea-field aux-split-card">
                <span>보조 유저 프롬프트 템플릿</span>
                <textarea id="aux-split-user-template" class="text_pole" rows="10">${escapeHtml(settings.auxUserPromptTemplate)}</textarea>
                <small class="aux-split-help">사용 가능 변수: {{mainResponse}}, {{recentContext}}, {{charName}}, {{userName}}, {{tagName}}, {{footerTagName}}, {{omitFooterWhenTagName}}</small>
            </label>

            <div class="aux-split-actions">
                <button id="aux-split-reset-prompts" type="button" class="menu_button">프롬프트 기본값 복원</button>
            </div>
        </div>
    `;

    const statusPanel = `
        <div class="aux-split-card">
            <div class="aux-split-section-title">
                <b>상태 / 디버그</b>
                <small>마지막 보조 호출 결과를 빠르게 확인합니다.</small>
            </div>
            <div class="aux-split-status-grid">
                <span>Connection Profiles</span>
                <b>${profiles.length}</b>
                <span>선택된 프로필</span>
                <b>${escapeHtml(getSelectedProfileSummary(settings, profiles))}</b>
                <span>마지막 보조 응답</span>
                <b>${settings.lastAuxOutput ? '저장됨' : '없음'}</b>
            </div>
            <div class="aux-split-actions">
                <button id="aux-split-show-last" type="button" class="menu_button">마지막 보조 응답 보기</button>
            </div>
        </div>
    `;

    root.innerHTML = `
        <div class="aux-split-header">
            <div>
                <strong>${escapeHtml(preset?.name || 'No Preset')}</strong>
                <span>${settings.enabled ? '활성화됨' : '비활성화'} · ${escapeHtml(getSelectedProfileSummary(settings, profiles))}</span>
            </div>
        </div>

        <nav class="aux-split-tabs" aria-label="Aux Model Split settings">
            ${renderSettingsTabs(activeTab)}
        </nav>

        <div class="aux-split-tab-content">
            ${renderTabPanel('basic', activeTab, basicPanel)}
            ${renderTabPanel('api', activeTab, apiPanel)}
            ${renderTabPanel('preset', activeTab, presetPanel)}
            ${renderTabPanel('outputs', activeTab, outputsPanel)}
            ${renderTabPanel('prompts', activeTab, promptsPanel)}
            ${renderTabPanel('status', activeTab, statusPanel)}
        </div>
    `;

    root.querySelectorAll('[data-aux-split-tab]').forEach((button) => {
        button.addEventListener('click', (event) => {
            const tab = event.currentTarget?.dataset?.auxSplitTab;
            if (!SETTINGS_TABS.some((item) => item.id === tab)) {
                return;
            }

            settings.activeSettingsTab = tab;
            saveSettings();
            renderSettings();
        });
    });

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
        settings.auxMaxTokens = Math.max(100, Math.min(32000, Number(event.target.value) || 600));
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

    bindPromptTextarea(root, '#aux-split-main-blocker', (event) => {
        settings.mainBlockerPrompt = event.target.value;
        saveSettings();
    });

    bindInput(root, '#aux-split-prompt-section-select', 'change', (event) => {
        settings.activePromptSectionIndex = Number(event.target.value) || 0;
        saveSettings({ immediate: true });
        renderSettings();
    });

    const updateActivePromptSection = (patch) => {
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        const sections = PresetMgr.ensurePromptSections(active);
        const index = Number.isInteger(settings.activePromptSectionIndex) ? settings.activePromptSectionIndex : 0;
        const section = sections[index];
        if (!section) {
            notifyError('프롬프트 섹션을 찾을 수 없습니다.');
            return false;
        }
        Object.assign(section, patch);
        active.auxSystemPrompt = PresetMgr.buildPromptSectionsText(active);
        settings.auxSystemPrompt = active.auxSystemPrompt;
        return true;
    };

    bindPromptTextarea(root, '#aux-split-prompt-section-content', (event) => {
        if (updateActivePromptSection({ content: event.target.value })) {
            saveSettings();
        }
    });

    bindInput(root, '#aux-split-prompt-section-name', 'change', (event) => {
        const name = event.target.value.trim() || 'Prompt Section';
        if (updateActivePromptSection({ name })) {
            saveSettings({ immediate: true });
            renderSettings();
        }
    });

    bindInput(root, '#aux-split-prompt-section-order', 'change', (event) => {
        if (updateActivePromptSection({ order: Number(event.target.value) || 100 })) {
            saveSettings({ immediate: true });
            renderSettings();
        }
    });

    bindInput(root, '#aux-split-prompt-section-enabled', 'change', (event) => {
        if (updateActivePromptSection({ enabled: Boolean(event.target.checked) })) {
            saveSettings({ immediate: true });
            renderSettings();
        }
    });

    bindInput(root, '#aux-split-prompt-section-targets', 'change', (event) => {
        if (updateActivePromptSection({ targetOutputs: parseCsvList(event.target.value) })) {
            saveSettings({ immediate: true });
            renderSettings();
        }
    });

    bindInput(root, '#aux-split-prompt-section-roles', 'change', (event) => {
        if (updateActivePromptSection({ roleFilter: parseCsvList(event.target.value) })) {
            saveSettings({ immediate: true });
            renderSettings();
        }
    });

    bindInput(root, '#aux-split-add-prompt-section', 'click', () => {
        const name = window.prompt('새 프롬프트 섹션 이름:', 'New Prompt Section');
        if (name === null) return;
        const idx = PresetMgr.addPromptSection(settings, settings.activePresetIndex, {
            name: name.trim() || 'New Prompt Section',
        });
        if (idx < 0) {
            notifyError('프롬프트 섹션 추가에 실패했습니다.');
            return;
        }
        settings.activePromptSectionIndex = idx;
        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo('프롬프트 섹션을 추가했습니다.');
    });

    bindInput(root, '#aux-split-clone-prompt-section', 'click', () => {
        const idx = PresetMgr.clonePromptSection(settings, settings.activePresetIndex, settings.activePromptSectionIndex || 0);
        if (idx < 0) {
            notifyError('프롬프트 섹션 복제에 실패했습니다.');
            return;
        }
        settings.activePromptSectionIndex = idx;
        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo('프롬프트 섹션을 복제했습니다.');
    });

    bindInput(root, '#aux-split-delete-prompt-section', 'click', () => {
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        const sections = PresetMgr.ensurePromptSections(active);
        const index = settings.activePromptSectionIndex || 0;
        const section = sections[index];
        if (!section) {
            notifyError('프롬프트 섹션을 찾을 수 없습니다.');
            return;
        }
        if (!window.confirm(`"${section.name || 'Prompt Section'}" 섹션을 삭제할까요?`)) {
            return;
        }
        const ok = PresetMgr.deletePromptSection(settings, settings.activePresetIndex, index);
        if (!ok) {
            notifyError('마지막 1개 프롬프트 섹션은 삭제할 수 없습니다.');
            return;
        }
        settings.activePromptSectionIndex = Math.max(0, Math.min(index, sections.length - 2));
        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo('프롬프트 섹션을 삭제했습니다.');
    });

    bindPromptTextarea(root, '#aux-split-user-template', (event) => {
        settings.auxUserPromptTemplate = event.target.value;
        saveSettings();
    });

    bindInput(root, '#aux-split-reset-prompts', 'click', () => {
        settings.mainBlockerPrompt = DEFAULT_MAIN_BLOCKER_PROMPT;
        settings.auxSystemPrompt = DEFAULT_AUX_SYSTEM_PROMPT;
        settings.auxUserPromptTemplate = DEFAULT_AUX_USER_PROMPT_TEMPLATE;
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        if (active) {
            active.promptSections = [
                PresetMgr.createPromptSection({
                    id: 'main',
                    name: 'Main Aux Prompt',
                    order: 100,
                    content: DEFAULT_AUX_SYSTEM_PROMPT,
                }),
            ];
            active.auxSystemPrompt = DEFAULT_AUX_SYSTEM_PROMPT;
            settings.activePromptSectionIndex = 0;
        }
        saveSettings({ immediate: true });
        renderSettings();
    });

    bindInput(root, '#aux-split-show-last', 'click', () => {
        const output = settings.lastAuxOutput || '아직 저장된 보조 응답이 없습니다.';
        notifyInfo(output);
    });

    // ========================================================================
    // Phase 6: 활성 프리셋 드롭다운 + 클론/이름변경/삭제 + JSON I/O
    // ========================================================================

    bindInput(root, '#aux-split-preset-select', 'change', (event) => {
        const idx = Number(event.target.value);
        if (!Number.isInteger(idx)) return;
        const ok = PresetMgr.setActivePreset(settings, idx);
        if (ok) {
            saveSettings({ immediate: true });
            renderSettings();
        }
    });

    bindInput(root, '#aux-split-save-preset', 'click', () => {
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        if (!active) {
            notifyError('저장 실패: 활성 프리셋을 찾을 수 없습니다.');
            return;
        }

        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo(`현재 프리셋 저장 완료: ${active.name || '(no name)'}`);
    });

    bindInput(root, '#aux-split-new-preset', 'click', () => {
        const name = window.prompt('새 프리셋 이름:', 'New Preset');
        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed) {
            notifyError('새 프리셋 생성 실패: 이름이 비어 있습니다.');
            return;
        }

        const preset = PresetMgr.createPreset();
        preset.name = trimmed;
        preset.auxProfileId = settings.auxProfileId || '';
        preset.auxProfileName = settings.auxProfileName || '';
        preset.auxMaxTokens = Math.max(100, Math.min(32000, Number(settings.auxMaxTokens) || 600));
        preset.contextTurns = Math.max(0, Number(settings.contextTurns) || 0);
        preset.silentFallback = settings.silentFallback !== false;

        const newIdx = PresetMgr.addPreset(settings, preset);
        PresetMgr.setActivePreset(settings, newIdx);
        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo(`새 프리셋 생성 완료: ${trimmed}`);
    });

    bindInput(root, '#aux-split-clone', 'click', () => {
        const activeIdx = settings.activePresetIndex;
        const newIdx = PresetMgr.clonePreset(settings, activeIdx);
        if (newIdx < 0) {
            notifyError('복제 실패: 활성 프리셋을 찾을 수 없습니다.');
            return;
        }
        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo(`프리셋 복제 완료 (idx=${newIdx})`);
    });

    bindInput(root, '#aux-split-rename', 'click', () => {
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        if (!active) {
            notifyError('이름 변경 실패: 활성 프리셋을 찾을 수 없습니다.');
            return;
        }
        const newName = window.prompt('새 프리셋 이름:', active.name || '');
        if (newName === null) return;  // 취소
        const trimmed = newName.trim();
        if (!trimmed) {
            notifyError('이름 변경 실패: 이름이 비어 있습니다.');
            return;
        }
        const ok = PresetMgr.updatePreset(settings, settings.activePresetIndex, { name: trimmed });
        if (ok) {
            saveSettings({ immediate: true });
            renderSettings();
            notifyInfo(`이름 변경 완료: ${trimmed}`);
        }
    });

    bindInput(root, '#aux-split-delete', 'click', () => {
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        if (!active) {
            notifyError('삭제 실패: 활성 프리셋을 찾을 수 없습니다.');
            return;
        }
        const confirmed = window.confirm(`정말 "${active.name}" 프리셋을 삭제하시겠습니까?`);
        if (!confirmed) return;
        const ok = PresetMgr.deletePreset(settings, settings.activePresetIndex);
        if (!ok) {
            notifyError('삭제 실패: 마지막 1개 프리셋은 삭제할 수 없습니다.');
            return;
        }
        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo('프리셋 삭제 완료');
    });

    bindInput(root, '#aux-split-export', 'click', () => {
        const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
        if (!active) {
            notifyError('내보내기 실패: 활성 프리셋을 찾을 수 없습니다.');
            return;
        }
        try {
            const json = PresetMgr.exportPresetToJSON(active);
            const filename = `${sanitizeFilename(active.id)}-${ymdString()}.json`;
            if (downloadJsonFile(json, filename)) {
                notifyInfo(`내보내기 완료: ${filename}`);
            }
        } catch (error) {
            console.error('[AuxSplit] export failed', error);
            notifyError('내보내기 실패: ' + (error?.message ?? error));
        }
    });

    bindInput(root, '#aux-split-export-all', 'click', () => {
        try {
            const json = PresetMgr.exportAllPresetsToJSON(settings);
            const filename = `aux-model-split-presets-${ymdString()}.json`;
            if (downloadJsonFile(json, filename)) {
                notifyInfo(`전체 내보내기 완료: ${filename}`);
            }
        } catch (error) {
            console.error('[AuxSplit] exportAll failed', error);
            notifyError('전체 내보내기 실패: ' + (error?.message ?? error));
        }
    });

    bindInput(root, '#aux-split-import-trigger', 'click', () => {
        const input = root.querySelector('#aux-split-import-file');
        if (input instanceof HTMLInputElement) input.click();
    });

    bindInput(root, '#aux-split-import-file', 'change', (event) => {
        const target = event.target;
        const file = target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = String(e.target?.result ?? '');
            const result = handleImportText(text, settings);
            if (result.ok) {
                saveSettings({ immediate: true });
                renderSettings();
                notifyInfo(result.message);
            } else {
                notifyError(result.message);
            }
        };
        reader.onerror = () => {
            notifyError('파일 읽기 실패: ' + (reader.error?.message ?? 'unknown'));
        };
        reader.readAsText(file);
        // 같은 파일 재선택 가능하도록 reset
        target.value = '';
    });

    bindInput(root, '#aux-split-import-activate', 'change', (event) => {
        settings.importActivateImmediately = Boolean(event.target.checked);
        saveSettings({ immediate: true });
    });

    bindOutputText(root, '.aux-split-output-label', (outputIndex, value) => {
        const label = value.trim();
        return updateOutputByIndex(settings, outputIndex, { label: label || 'Output' });
    });

    bindOutputText(root, '.aux-split-output-tag', (outputIndex, value) => {
        const tagName = sanitizeTagName(value);
        if (!tagName) {
            return null;
        }
        return updateOutputByIndex(settings, outputIndex, { tagName });
    });

    bindOutputText(root, '.aux-split-output-omit', (outputIndex, value) => (
        updateOutputByIndex(settings, outputIndex, { omitWhenTagPresent: sanitizeTagName(value) })
    ));

    bindOutputSelect(root, '.aux-split-output-type', 'type', settings);
    bindOutputSelect(root, '.aux-split-output-position', 'position', settings);
    bindOutputSelect(root, '.aux-split-output-mode', 'responseMode', settings);

    bindInput(root, '#aux-split-add-output', 'click', () => {
        const choice = window.prompt(
            '추가할 출력 항목 타입을 입력하세요:\n1 = 블록 태그\n2 = 단일 마커\n3 = Analysis + JSONPatch',
            '1',
        );
        if (choice === null) return;

        const normalized = choice.trim().toLowerCase();
        let template = 'block';
        if (['2', 'marker', '마커'].includes(normalized)) {
            template = 'marker';
        } else if (['3', 'jsonpatch', 'json', 'analysis', '변수'].includes(normalized)) {
            template = 'jsonPatch';
        } else if (!['1', 'block', '블록'].includes(normalized)) {
            notifyError('알 수 없는 출력 항목 타입입니다.');
            return;
        }

        const output = PresetMgr.createOutput(template);
        const idx = PresetMgr.addOutputToPreset(settings, settings.activePresetIndex, output);
        if (idx < 0) {
            notifyError('출력 항목 추가 실패: 활성 프리셋을 찾을 수 없습니다.');
            return;
        }

        saveSettings({ immediate: true });
        renderSettings();
        notifyInfo(`출력 항목 추가 완료: ${output.label || output.id}`);
    });

    root.querySelectorAll('.aux-split-output-toggle').forEach((button) => {
        button.addEventListener('click', (event) => {
            const target = event.currentTarget;
            const outputIndex = Number(target?.dataset?.outputIndex);
            const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
            const output = active?.outputs?.[outputIndex];
            if (!output) {
                notifyError('출력 항목을 찾을 수 없습니다.');
                return;
            }

            output.enabled = output.enabled === false;
            saveSettings({ immediate: true });
            renderSettings();
            notifyInfo(`${output.label || output.id || output.tagName || 'output'}: ${output.enabled ? '활성화' : '비활성화'}`);
        });
    });

    root.querySelectorAll('.aux-split-output-clone').forEach((button) => {
        button.addEventListener('click', (event) => {
            const target = event.currentTarget;
            const outputIndex = Number(target?.dataset?.outputIndex);
            const newIdx = PresetMgr.cloneOutput(settings, settings.activePresetIndex, outputIndex);
            if (newIdx < 0) {
                notifyError('출력 항목 복제 실패: 항목을 찾을 수 없습니다.');
                return;
            }

            saveSettings({ immediate: true });
            renderSettings();
            notifyInfo(`출력 항목 복제 완료 (idx=${newIdx})`);
        });
    });

    root.querySelectorAll('.aux-split-output-delete').forEach((button) => {
        button.addEventListener('click', (event) => {
            const target = event.currentTarget;
            const outputIndex = Number(target?.dataset?.outputIndex);
            const active = PresetMgr.getPresetByIndex(settings, settings.activePresetIndex);
            const output = active?.outputs?.[outputIndex];
            if (!output) {
                notifyError('출력 항목 삭제 실패: 항목을 찾을 수 없습니다.');
                return;
            }

            const confirmed = window.confirm(`"${output.label || output.id || output.tagName}" 출력 항목을 삭제할까요?`);
            if (!confirmed) return;

            const ok = PresetMgr.deleteOutput(settings, settings.activePresetIndex, outputIndex);
            if (!ok) {
                notifyError('출력 항목 삭제 실패: 마지막 1개 출력 항목은 삭제할 수 없습니다.');
                return;
            }

            saveSettings({ immediate: true });
            renderSettings();
            notifyInfo('출력 항목 삭제 완료');
        });
    });

    window.addEventListener('beforeunload', () => saveSettings({ immediate: true }), { once: true });
}
