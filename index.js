import { callAuxModel, resetAuxCallState } from './modules/aux-caller.js';
import { buildAuxPrompt } from './modules/prompt-builder.js';
import { getDh29Preset } from './modules/preset-manager.js';
import { composeMessageWithStatus, extractTagBlock, hasTagBlock, removeTagBlock } from './modules/tag-assembler.js';
import { getSettings, initSettings, renderSettings } from './modules/settings.js';
import { debugLog, getContext, notifyError, notifyWarning, setLastCallMetadata } from './modules/utils.js';
import { injectStatusBlocker } from './modules/interceptor.js';

const MODULE_NAME = 'aux_model_split';

globalThis.auxModelSplitInterceptor = async function auxModelSplitInterceptor(chat, contextSize, abort, type) {
    try {
        const settings = getSettings();
        if (!settings.enabled) {
            return;
        }

        const preset = getDh29Preset(settings);
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

async function handleMessageReceived(eventData) {
    const settings = getSettings();
    if (!settings.enabled) {
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

    const preset = getDh29Preset(settings);
    const mainBeforeCompose = message.mes;
    const mainHadBlockedTag = hasTagBlock(mainBeforeCompose, preset.tagName);
    const strippedMain = removeTagBlock(mainBeforeCompose, preset.tagName);
    if (mainHadBlockedTag) {
        debugLog(settings, 'Main response already contains status tag; will replace it if aux succeeds');
    }

    try {
        const prompts = buildAuxPrompt({
            mainResponse: strippedMain.text,
            context,
            settings,
            preset,
        });

        debugLog(settings, 'Aux call starting');
        const raw = await callAuxModel(prompts, settings);
        const statusBlock = extractTagBlock(raw, preset.tagName);

        message.mes = composeMessageWithStatus(strippedMain.text, statusBlock);
        settings.lastAuxOutput = raw;
        context?.saveSettingsDebounced?.();
        await setLastCallMetadata({
            input: {
                ...prompts,
                mainResponse: mainBeforeCompose,
                strippedMainResponse: strippedMain.text,
            },
            output: raw,
            error: null,
            skipped: false,
            messageId,
            mainBeforeCompose,
            mainHadBlockedTag,
            removedMainStatusBlock: strippedMain.removed,
            auxStatusBlock: statusBlock,
            replacementMode: mainHadBlockedTag ? 'replace_main_status' : 'prepend_aux_status',
            finalMessagePreview: message.mes.slice(0, 1000),
        });

        debugLog(settings, `Status tag composed; mode=${mainHadBlockedTag ? 'replace' : 'prepend'}, messageId=${messageId}, statusLength=${statusBlock.length}`);
    } catch (error) {
        console.error('[AuxSplit] Aux processing failed', error);
        await setLastCallMetadata({
            input: null,
            output: null,
            error: String(error?.message ?? error),
            skipped: false,
            messageId,
            mainBeforeCompose,
            mainHadBlockedTag,
            removedMainStatusBlock: null,
            auxStatusBlock: null,
            replacementMode: 'fallback_original_main',
            finalMessagePreview: mainBeforeCompose.slice(0, 1000),
        });

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
            debugLog(getSettings(), 'Chat changed; aux state reset');
        });
    }
}

let initialized = false;

function init() {
    if (initialized) {
        return;
    }

    initialized = true;
    initSettings();
    renderSettings();
    registerEvents();
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
