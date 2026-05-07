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

function isLegacySimplePreset(preset) {
    const outputs = Array.isArray(preset?.outputs) ? preset.outputs : [];
    if (outputs.length === 0 || outputs.length > 2) {
        return false;
    }

    const blockCount = outputs.filter(o => o?.type === 'block').length;
    const markerCount = outputs.filter(o => o?.type === 'marker').length;
    const nestedCount = outputs.filter(o => o?.type === 'nested').length;
    return blockCount === 1 && markerCount <= 1 && nestedCount === 0;
}

function formatOutputPosition(position) {
    if (position === 'prepend') return '상단';
    if (position === 'append') return '하단';
    return position || '(none)';
}

function renderOutputsList(preset) {
    const outputs = Array.isArray(preset?.outputs) ? preset.outputs : [];
    if (outputs.length === 0) {
        return '<div class="aux-split-empty">이 프리셋에는 출력 항목이 없습니다.</div>';
    }

    return outputs.map((output, index) => {
        const enabledText = output?.enabled === false ? '비활성' : '활성';
        const enabledClass = output?.enabled === false ? 'is-disabled' : 'is-enabled';
        const tagName = output?.tagName ? `<${output.tagName}>` : '(no tag)';
        const template = output?.outputTemplate || '';
        const hasTemplate = output?.type === 'nested' || output?.responseMode === 'json+template';

        return `
            <article class="aux-split-output-card ${enabledClass}">
                <div class="aux-split-output-head">
                    <b>${escapeHtml(output?.label || output?.id || `output ${index + 1}`)}</b>
                    <span>${escapeHtml(enabledText)}</span>
                </div>
                <div class="aux-split-output-grid">
                    <span>ID</span><code>${escapeHtml(output?.id || '')}</code>
                    <span>태그</span><code>${escapeHtml(tagName)}</code>
                    <span>타입</span><code>${escapeHtml(output?.type || '')}</code>
                    <span>위치</span><code>${escapeHtml(formatOutputPosition(output?.position))}</code>
                    <span>모드</span><code>${escapeHtml(output?.responseMode || 'raw')}</code>
                    <span>생략 조건</span><code>${escapeHtml(output?.omitWhenTagPresent || '(none)')}</code>
                </div>
                ${hasTemplate ? `<details class="aux-split-output-template">
                    <summary>템플릿 보기</summary>
                    <pre>${escapeHtml(template)}</pre>
                </details>` : ''}
            </article>
        `;
    }).join('');
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

export function renderSettings() {
    const settings = getSettings();
    const preset = getActivePreset(settings);
    const showLegacyFields = isLegacySimplePreset(preset);
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
            <span>Preset Manager</span>
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
            <small class="aux-split-help">${profiles.length ? '활성 프리셋에 저장된 ST Connection Profile을 직접 호출합니다.' : 'Connection Profile이 없습니다. ST API Connections에서 프로필을 먼저 저장하세요.'}</small>
        </label>

        <label class="aux-split-field">
            <span>보조 응답 토큰</span>
            <input id="aux-split-max-tokens" class="text_pole" type="number" min="100" max="32000" step="50" value="${Number(settings.auxMaxTokens) || 600}">
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
            <b>활성 프리셋</b>
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

        <section class="aux-split-outputs">
            <div class="aux-split-section-title">
                <b>출력 항목</b>
                <small>${showLegacyFields ? '단순 프리셋은 아래 호환 필드로 빠르게 수정할 수 있습니다.' : '다중 출력 프리셋은 outputs[] 구조로 합성됩니다.'}</small>
            </div>
            <div class="aux-split-output-list">
                ${renderOutputsList(preset)}
            </div>
        </section>

        <div class="aux-split-editor">
            ${showLegacyFields ? `
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
            ` : `
                <div class="aux-split-notice">
                    이 프리셋은 여러 출력 항목을 사용합니다. 태그 구조는 위 출력 항목 목록을 기준으로 처리됩니다.
                </div>
            `}

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

    window.addEventListener('beforeunload', () => saveSettings({ immediate: true }), { once: true });
}
