import { callAuxModel, resetAuxCallState } from './modules/aux-caller.js';
import { buildAuxPrompt, buildRetryAppendix } from './modules/prompt-builder.js';
import * as PresetMgr from './modules/preset-manager.js';
const { getActivePreset, getEnabledOutputs } = PresetMgr;
import {
    buildOutputContent,
    buildOutputContentDetailed,
    composeMessageFromParts,
    extractAllOutputs,
    stripOutputsFromMain,
} from './modules/tag-assembler.js';
import { getSettings, initSettings, registerSettingsMenuButton, renderSettings } from './modules/settings.js';
import { debugLog, getContext, notifyError, notifyWarning, setLastCallMetadata } from './modules/utils.js';
import { injectStatusBlocker } from './modules/interceptor.js';
import { evaluateSuppression, diagnoseSuppression } from './modules/suppression.js';
import { normalizeJsonPatch } from './modules/jsonpatch-handler.js';
import { getRepairCount, resetRepairCount } from './modules/json-repair.js';
import { diagnoseTavernHelper } from './modules/tavern-helper-adapter.js';

const MODULE_NAME = 'aux_model_split';
const AUX_SPLIT_UPDATE_COMPLETE_EVENT = 'aux_split_update_complete';

let baselineChatLength = 0;
let baselineMessageSignatures = new Map();
let processedMessageKeys = new Set();

globalThis.auxModelSplitInterceptor = async function auxModelSplitInterceptor(chat, contextSize, abort, type) {
    try {
        const settings = getSettings();
        if (!settings.enabled) {
            return;
        }

        const preset = getActivePreset(settings);
        const enabledOutputs = getEnabledOutputs(preset);
        if (enabledOutputs.length === 0) {
            debugLog(settings, 'Interceptor skipped: no enabled outputs');
            return;
        }

        injectStatusBlocker(chat, type, preset, settings);
    } catch (error) {
        console.error('[AuxSplit] Interceptor failed', error);
    }
};

function shouldSkipReceivedMessage(message) {
    if (!message || message.is_user || message.is_system) {
        return true;
    }

    if (typeof message.mes !== 'string' || !message.mes.trim()) {
        return true;
    }

    return false;
}

function looksLikeSlashGeneratedUtilityMessage(message, preset) {
    const text = String(message?.mes ?? '');
    if (!text) return false;

    const utilityTags = [
        'CASTE_EVAL',
        'Button',
        'NOTICE_BOARD',
        'FB',
        'USER_POST',
        'POLL_BOARD',
        'USER_POLL',
        'STREAM_BOARD',
        'USER_STREAM',
        'RK_AB',
        'RK_GD',
        'TALENT_BOARD',
        'USER_TALENT',
        'TALENT_ACCEPTED',
        'MENTEE_LIST',
        'MENTOR_MATCH',
        'MENTEE_APP',
        'MENTOR_REPORT',
        'EDEN_LIFE',
        'USER_EDENLIFE_POST',
        'EDEN_LIFE_PROFILE',
        'EDEN_RADIO',
        'SV_VIEW',
        'SV_WRITE',
        'PHONE_UI',
        'APP_NOTIF',
        'character_profile',
        'world',
    ];

    const hasUtilityTag = utilityTags.some((tag) => {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i').test(text);
    });
    if (hasUtilityTag) return true;

    const enabledOutputs = getEnabledOutputs(preset);
    const hasAuxManagedOutput = enabledOutputs.some((output) => {
        if (!output?.tagName) return false;
        const escaped = String(output.tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i').test(text);
    });
    const hasJsonPatch = /<JSONPatch\b[\s\S]*?<\/JSONPatch>/i.test(text);
    const hasCurrentStats = /<CurrentStats\b[\s\S]*?<\/CurrentStats>/i.test(text);
    const hasGeneratedMenu = /<choices\b[\s\S]*?<\/choices>/i.test(text);

    // QR / slash-generated setup messages often arrive already containing
    // several structured blocks. Let QR, regex, and MVU consume them untouched.
    return hasAuxManagedOutput && (hasJsonPatch || hasCurrentStats || hasGeneratedMenu);
}

function markExistingMessagesAsHandled(context = getContext()) {
    const chat = context?.chat;
    baselineChatLength = Array.isArray(chat) ? chat.length : 0;
    baselineMessageSignatures = new Map();
    processedMessageKeys = new Set();
    if (!Array.isArray(chat)) {
        return;
    }

    chat.forEach((message, index) => {
        baselineMessageSignatures.set(index, getMessageSignature(message));
    });
}

function getMessageSignature(message) {
    if (!message) {
        return '';
    }

    return [
        message.send_date ?? '',
        message.name ?? '',
        message.is_user ? 'user' : 'assistant',
        message.is_system ? 'system' : '',
        message.mes ?? '',
    ].join('\n');
}

function getMessageProcessKey(messageId, message) {
    return [
        messageId,
        message?.send_date ?? '',
        message?.name ?? '',
    ].join(':');
}

function isExistingLoadedMessage(messageId, message) {
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= baselineChatLength) {
        return false;
    }

    return baselineMessageSignatures.get(messageId) === getMessageSignature(message);
}

function isGreetingMessage(messageId, message) {
    return messageId === 0 && message && !message.is_user && !message.is_system;
}

function emitUpdateComplete(context, payload, settings) {
    const eventSource = context?.eventSource;
    if (!eventSource?.emit) return;
    try {
        eventSource.emit(AUX_SPLIT_UPDATE_COMPLETE_EVENT, payload);
        debugLog(settings, `Emitted ${AUX_SPLIT_UPDATE_COMPLETE_EVENT}: success=${payload?.success}`);
    } catch (emitError) {
        console.warn('[AuxSplit] event emit failed', emitError);
    }
}

async function handleMessageReceived(eventData) {
    const settings = getSettings();
    if (!settings.enabled) {
        return;
    }

    // 5c: suppression (MESSAGE_RECEIVED 단계에서는 type 모름. instruct injection 만 검사)
    const suppression = evaluateSuppression(undefined);
    if (suppression.suppress) {
        debugLog(settings, `Aux call suppressed: ${suppression.reason}`);
        return;
    }

    const context = getContext();
    const chat = context?.chat;
    const messageId = typeof eventData === 'number'
        ? eventData
        : eventData?.messageId ?? eventData?.id ?? (Array.isArray(chat) ? chat.length - 1 : -1);
    const message = Array.isArray(chat) ? chat[messageId] : null;

    if (shouldSkipReceivedMessage(message)) {
        debugLog(settings, 'MESSAGE_RECEIVED skipped: not a normal character message');
        return;
    }

    if (isGreetingMessage(messageId, message)) {
        debugLog(settings, 'MESSAGE_RECEIVED skipped: greeting message');
        return;
    }

    if (isExistingLoadedMessage(messageId, message)) {
        debugLog(settings, `MESSAGE_RECEIVED skipped: existing loaded message, messageId=${messageId}, baseline=${baselineChatLength}`);
        return;
    }

    const processKey = getMessageProcessKey(messageId, message);
    if (processedMessageKeys.has(processKey)) {
        debugLog(settings, `MESSAGE_RECEIVED skipped: already processed, messageId=${messageId}`);
        return;
    }

    const preset = getActivePreset(settings);
    const enabledOutputs = getEnabledOutputs(preset);
    if (enabledOutputs.length === 0) {
        debugLog(settings, 'Aux call skipped: no enabled outputs');
        return;
    }

    if (looksLikeSlashGeneratedUtilityMessage(message, preset)) {
        debugLog(settings, 'MESSAGE_RECEIVED skipped: slash/QR utility message');
        return;
    }

    const mainBefore = message.mes;

    // 메인이 차단 태그를 출력했는지 검사 (인터셉터 실패 보호) → 제거 후 보조 결과로 교체
    const mainStrip = stripOutputsFromMain(mainBefore, enabledOutputs);
    const strippedMain = mainStrip.text;
    if (mainStrip.removed.length > 0) {
        debugLog(settings, `Main output had ${mainStrip.removed.length} blocked tag(s); will replace with aux output`);
    }

    let promptsForLog = null;
    let raw1 = null;
    let raw2 = null;
    let perOutputFinal = null;
    let failedOutputsAfterFirst = [];
    let failedOutputsAfterRetry = [];

    try {
        // 1차 호출
        processedMessageKeys.add(processKey);
        const prompts = await buildAuxPrompt({ mainResponse: strippedMain, context, settings, preset });
        promptsForLog = prompts;

        debugLog(settings, 'Aux call (1st) starting');
        raw1 = await callAuxModel(prompts, settings);
        let perOutput = extractAllOutputs(raw1, enabledOutputs);
        failedOutputsAfterFirst = enabledOutputs.filter(o => !perOutput[o.id]?.ok);
        debugLog(settings, `Aux 1st: ${enabledOutputs.length - failedOutputsAfterFirst.length}/${enabledOutputs.length} ok`);

        // 부분 재시도 (실패한 outputs 만 1회)
        if (failedOutputsAfterFirst.length > 0) {
            try {
                const retryAppendix = buildRetryAppendix({
                    failedOutputs: failedOutputsAfterFirst,
                    perOutputResults: perOutput,
                });
                const retryPrompts = {
                    ...prompts,
                    userPrompt: prompts.userPrompt + '\n\n' + retryAppendix,
                };
                debugLog(settings, 'Aux call (retry) starting');
                raw2 = await callAuxModel(retryPrompts, settings);
                const perOutput2 = extractAllOutputs(raw2, failedOutputsAfterFirst);
                for (const o of failedOutputsAfterFirst) {
                    if (perOutput2[o.id]?.ok) {
                        perOutput[o.id] = perOutput2[o.id];
                    }
                }
                failedOutputsAfterRetry = failedOutputsAfterFirst.filter(o => !perOutput[o.id]?.ok);
                debugLog(settings, `Aux retry: ${failedOutputsAfterFirst.length - failedOutputsAfterRetry.length}/${failedOutputsAfterFirst.length} recovered`);
            } catch (retryError) {
                console.warn('[AuxSplit] Retry call failed', retryError);
                failedOutputsAfterRetry = failedOutputsAfterFirst.slice();
            }
        }

        perOutputFinal = perOutput;

        // parts 구성: 1차 + retry 통합한 perOutput 에서 ok 인 것만
        const parts = [];
        for (const o of enabledOutputs) {
            const r = perOutput[o.id];
            if (!r || !r.ok) continue;
            // omitWhenTagPresent: raw1/raw2 중 하나에 그 마커가 있으면 이 output skip
            if (o.omitWhenTagPresent) {
                const sources = [raw1, raw2].filter(s => typeof s === 'string');
                const escaped = String(o.omitWhenTagPresent).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const omitPattern = new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i');
                if (sources.some(s => omitPattern.test(s))) {
                    debugLog(settings, `Output ${o.id} omitted: <${o.omitWhenTagPresent}> present`);
                    continue;
                }
            }
            const content = buildOutputContent(r, o, {
                preset,
                normalizeJsonPatch,
                opPolicy: PresetMgr.getJsonPatchOpPolicy(preset),
            });
            if (content) parts.push({ id: o.id, content, position: o.position, output: o });
        }

        // Q2=B: 1차 + retry 모두 끝난 후에만 message.mes 갱신
        message.mes = composeMessageFromParts(strippedMain, parts);

        settings.lastAuxOutput = raw2 || raw1;
        context?.saveSettingsDebounced?.();

        await setLastCallMetadata({
            input: {
                ...prompts,
                mainResponse: mainBefore,
                strippedMainResponse: strippedMain,
            },
            output: raw1,
            retryOutput: raw2,
            failedOutputsAfterFirst: failedOutputsAfterFirst.map(o => o.id),
            failedOutputsAfterRetry: failedOutputsAfterRetry.map(o => o.id),
            perOutput: Object.fromEntries(
                Object.entries(perOutputFinal).map(([k, v]) => [k, { ok: v.ok, error: v.error }])
            ),
            error: null,
            skipped: false,
            messageId,
            mainBeforeCompose: mainBefore,
            removedFromMain: mainStrip.removed,
            incompleteRemovedFromMain: mainStrip.incompleteRemoved ?? [],
            replacementMode: failedOutputsAfterRetry.length === 0 ? 'success' : 'partial',
            appliedOutputs: parts.map(p => p.id),
            finalMessagePreview: message.mes.slice(0, 1000),
        });

        emitUpdateComplete(context, {
            messageId,
            success: failedOutputsAfterRetry.length === 0,
            appliedOutputs: parts.map(p => p.id),
            failedOutputs: failedOutputsAfterRetry.map(o => o.id),
        }, settings);

        debugLog(settings, `Composed; applied=${parts.length}, failed=${failedOutputsAfterRetry.length}, messageId=${messageId}`);

    } catch (error) {
        console.error('[AuxSplit] Aux processing failed', error);

        // ★ 5c 안전장치: mainStrip 결과가 아니라 mainBefore 원본으로 명시 복원
        if (message && typeof message.mes === 'string') {
            message.mes = mainBefore;
        }

        await setLastCallMetadata({
            input: promptsForLog,
            output: raw1,
            retryOutput: raw2,
            failedOutputsAfterFirst: failedOutputsAfterFirst.map(o => o.id),
            failedOutputsAfterRetry: failedOutputsAfterRetry.map(o => o.id),
            perOutput: perOutputFinal
                ? Object.fromEntries(Object.entries(perOutputFinal).map(([k, v]) => [k, { ok: v.ok, error: v.error }]))
                : null,
            error: String(error?.message ?? error),
            skipped: false,
            messageId,
            mainBeforeCompose: mainBefore,
            removedFromMain: mainStrip.removed,
            incompleteRemovedFromMain: mainStrip.incompleteRemoved ?? [],
            replacementMode: 'fallback_original_main',
            finalMessagePreview: mainBefore.slice(0, 1000),
        });

        emitUpdateComplete(context, {
            messageId,
            success: false,
            error: String(error?.message ?? error),
        }, settings);

        if (!settings.silentFallback) {
            notifyError('Aux Model Split: 보조 모델 호출에 실패했습니다. 메인 응답은 유지됩니다.');
        }
    }
}

function registerEvents() {
    const context = getContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.event_types;

    if (!eventSource || !eventTypes) {
        notifyWarning('Aux Model Split: SillyTavern event API를 찾지 못했습니다.');
        return;
    }

    eventSource.on(eventTypes.MESSAGE_RECEIVED, handleMessageReceived);

    if (eventTypes.CHAT_CHANGED) {
        eventSource.on(eventTypes.CHAT_CHANGED, () => {
            resetAuxCallState();
            markExistingMessagesAsHandled();
            debugLog(getSettings(), 'Chat changed; aux state reset');
        });
    }
}

function exposeDebugInterface() {
    const persist = (immediate = false) => {
        const ctx = getContext();
        if (immediate) {
            ctx?.saveSettings?.();
        } else {
            ctx?.saveSettingsDebounced?.();
        }
    };

    globalThis.AuxModelSplitDebug = {
        listPresets: () => PresetMgr.listPresets(getSettings()),
        getPresetByIndex: (idx) => PresetMgr.getPresetByIndex(getSettings(), idx),
        getActivePreset: () => PresetMgr.getActivePreset(getSettings()),

        addPreset: (preset) => {
            const idx = PresetMgr.addPreset(getSettings(), preset);
            persist(true);
            return idx;
        },

        deletePreset: (idx) => {
            const ok = PresetMgr.deletePreset(getSettings(), idx);
            if (ok) {
                persist(true);
                renderSettings();
            }
            return ok;
        },

        setActivePreset: (idx) => {
            const ok = PresetMgr.setActivePreset(getSettings(), idx);
            if (ok) {
                persist(true);
                renderSettings();
            }
            return ok;
        },

        clonePreset: (idx, newName) => {
            const newIdx = PresetMgr.clonePreset(getSettings(), idx, newName);
            if (newIdx >= 0) {
                persist(true);
            }
            return newIdx;
        },

        updatePreset: (idx, patcher) => {
            const ok = PresetMgr.updatePreset(getSettings(), idx, patcher);
            if (ok) {
                persist(true);
            }
            return ok;
        },

        createPreset: (template) => PresetMgr.createPreset(template),

        validatePreset: (obj) => PresetMgr.validatePreset(obj),

        exportPreset: (idx) => {
            const preset = PresetMgr.getPresetByIndex(getSettings(), idx);
            return preset ? PresetMgr.exportPresetToJSON(preset) : null;
        },

        exportAll: () => PresetMgr.exportAllPresetsToJSON(getSettings()),

        importPreset: (json) => {
            const result = PresetMgr.importPresetFromJSON(json);
            if (result.ok) {
                const idx = PresetMgr.addPreset(getSettings(), result.preset);
                persist(true);
                return { ok: true, index: idx, errors: [] };
            }
            return result;
        },

        importBundle: (json) => {
            const result = PresetMgr.importPresetsFromJSON(json);
            if (result.ok && result.presets.length > 0) {
                const indices = [];
                const settings = getSettings();
                for (const p of result.presets) {
                    indices.push(PresetMgr.addPreset(settings, p));
                }
                persist(true);
                return { ok: true, indices, errors: result.errors };
            }
            return result;
        },

        rerenderSettingsUI: () => renderSettings(),

        // 5c 신규: 임의 raw 응답을 활성 프리셋의 outputs 로 시뮬레이션 추출.
        // 5d 갱신: nested+json+template 의 buildOutputContentDetailed 결과 + repair 정보 포함.
        simulateAuxResponse: (rawText) => {
            const settings = getSettings();
            const preset = PresetMgr.getActivePreset(settings);
            const outputs = PresetMgr.getEnabledOutputs(preset);
            const perOutput = extractAllOutputs(rawText, outputs);
            const opPolicy = PresetMgr.getJsonPatchOpPolicy(preset);

            const repairBefore = getRepairCount();
            const detail = {};
            for (const o of outputs) {
                const r = perOutput[o.id];
                if (!r) continue;
                const built = buildOutputContentDetailed(r, o, { preset, normalizeJsonPatch, opPolicy });
                detail[o.id] = {
                    ok: r.ok,
                    error: r.error,
                    contentLength: typeof r.content === 'string' ? r.content.length : 0,
                    fullMatchLength: typeof r.fullMatch === 'string' ? r.fullMatch.length : 0,
                    builtLength: typeof built.assembled === 'string' ? built.assembled.length : 0,
                    builtPreview: typeof built.assembled === 'string' ? built.assembled.slice(0, 240) : '',
                    allFilled: built.allFilled,
                    repaired: built.repaired,
                    missingSlots: built.missingSlots,
                };
            }
            const repairDelta = getRepairCount() - repairBefore;

            return {
                rawLength: typeof rawText === 'string' ? rawText.length : 0,
                activeRole: PresetMgr.resolveActiveRole(settings, preset, getContext()),
                outputs: detail,
                allOk: outputs.every(o => perOutput[o.id]?.ok),
                failedOutputIds: outputs.filter(o => !perOutput[o.id]?.ok).map(o => o.id),
                repairDelta,
                repairTotal: getRepairCount(),
            };
        },

        // 5d 신규
        resolveActiveRole: () => {
            const settings = getSettings();
            const preset = PresetMgr.getActivePreset(settings);
            return PresetMgr.resolveActiveRole(settings, preset, getContext());
        },

        setActiveRoleOverride: (role) => {
            const settings = getSettings();
            settings.activeRoleOverride = typeof role === 'string' ? role : '';
            persist(true);
            return settings.activeRoleOverride;
        },

        diagnoseMvu: () => {
            const ctx = getContext();
            const cm = ctx?.chatMetadata;
            const chat = ctx?.chat;
            const result = {
                chatMetadataKeys: cm ? Object.keys(cm) : [],
                chatMetadataVariables: cm?.variables ?? null,
                ourMeta: cm?.aux_model_split ?? null,
                lastAssistant: null,
            };
            if (Array.isArray(chat)) {
                for (let i = chat.length - 1; i >= 0; i--) {
                    const m = chat[i];
                    if (!m || m.is_user || m.is_system) continue;
                    result.lastAssistant = {
                        index: i,
                        extraKeys: m.extra ? Object.keys(m.extra) : [],
                        mvu_variables: m.extra?.mvu_variables ?? null,
                    };
                    break;
                }
            }
            return result;
        },

        diagnoseCurrentVariables: async () => {
            const settings = getSettings();
            const preset = PresetMgr.getActivePreset(settings);
            const prompts = await buildAuxPrompt({
                mainResponse: '(diagnostic main response)',
                context: getContext(),
                settings,
                preset,
            });
            const activeRole = PresetMgr.resolveActiveRole(settings, preset, getContext())
                ?? prompts.currentVariables?.values?.role
                ?? null;
            return {
                activeRole,
                currentVariables: prompts.currentVariables,
                ejsPreprocess: prompts.ejsPreprocess,
                systemPromptPreview: prompts.systemPrompt.slice(0, 4000),
                userPromptPreview: prompts.userPrompt.slice(0, 2000),
            };
        },

        diagnoseTavernHelper: () => diagnoseTavernHelper(),

        testSuppression: () => diagnoseSuppression(),

        getJsonPatchRepairCount: () => getRepairCount(),
        resetJsonPatchRepairCount: () => { resetRepairCount(); return 0; },

        // Phase 7 신규: 메인 응답에서 outputs strip 시뮬레이션. 실 호출 안 함.
        //   incomplete block (닫는 태그 없음) 검출/제거 동작 검증용.
        simulateMainStrip: (mainText) => {
            const settings = getSettings();
            const preset = PresetMgr.getActivePreset(settings);
            const outputs = PresetMgr.getEnabledOutputs(preset);
            const result = stripOutputsFromMain(mainText, outputs);
            return {
                inputLength: typeof mainText === 'string' ? mainText.length : 0,
                strippedText: result.text,
                strippedLength: result.text.length,
                removedComplete: result.removed,
                removedIncomplete: result.incompleteRemoved,
            };
        },
    };
}

let initialized = false;

function init() {
    if (initialized) {
        return;
    }

    initialized = true;
    initSettings();
    markExistingMessagesAsHandled();
    renderSettings();
    registerSettingsMenuButton();
    registerEvents();
    exposeDebugInterface();
    console.log(`[AuxSplit] ${MODULE_NAME} loaded`);
}

function initWhenReady() {
    const context = getContext();
    const appReady = context?.event_types?.APP_READY;

    if (context?.eventSource && appReady) {
        context.eventSource.on(appReady, init);
        return;
    }

    if (context) {
        init();
        return;
    }

    window.setTimeout(initWhenReady, 250);
}

initWhenReady();
