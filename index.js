import { callAuxModel, resetAuxCallState } from './modules/aux-caller.js';
import { buildAuxPrompt } from './modules/prompt-builder.js';
import { getDh29Preset } from './modules/preset-manager.js';
import { composeMessageWithStatus, extractTagBlock, hasTagBlock } from './modules/tag-assembler.js';
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

        const preset = getDh29Preset();
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

    const preset = getDh29Preset();
    if (hasTagBlock(message.mes, preset.tagName)) {
        debugLog(settings, 'Main response already contains status tag; aux call skipped');
        await setLastCallMetadata({
            input: null,
            output: null,
            error: null,
            skipped: true,
            skipReason: 'main_had_blocked_tag',
            messageId,
            mainBeforeCompose: message.mes,
            mainHadBlockedTag: true,
            auxStatusBlock: null,
            finalMessagePreview: message.mes.slice(0, 1000),
        });
        return;
    }

    try {
        const mainBeforeCompose = message.mes;
        const prompts = buildAuxPrompt({
            mainResponse: mainBeforeCompose,
            context,
            settings,
            preset,
        });

        debugLog(settings, 'Aux call starting');
        const raw = await callAuxModel(prompts, settings);
        const statusBlock = extractTagBlock(raw, preset.tagName);

        message.mes = composeMessageWithStatus(mainBeforeCompose, statusBlock);
        settings.lastAuxOutput = raw;
        context?.saveSettingsDebounced?.();
        await setLastCallMetadata({
            input: {
                ...prompts,
                mainResponse: mainBeforeCompose,
            },
            output: raw,
            error: null,
            skipped: false,
            messageId,
            mainBeforeCompose,
            mainHadBlockedTag: false,
            auxStatusBlock: statusBlock,
            finalMessagePreview: message.mes.slice(0, 1000),
        });

        debugLog(settings, `Status tag prepended; messageId=${messageId}, statusLength=${statusBlock.length}`);
    } catch (error) {
        console.error('[AuxSplit] Aux processing failed', error);
        await setLastCallMetadata({
            input: null,
            output: null,
            error: String(error?.message ?? error),
            skipped: false,
            messageId,
            mainBeforeCompose: message?.mes ?? '',
            mainHadBlockedTag: hasTagBlock(message?.mes ?? '', preset.tagName),
            auxStatusBlock: null,
            finalMessagePreview: message?.mes?.slice?.(0, 1000) ?? '',
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
