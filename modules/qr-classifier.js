const DEFAULT_UTILITY_TAGS = Object.freeze([
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
    'world',
    '임무확인',
    '우주정거장',
    '엔딩',
    'd-0',
]);

const DEFAULT_RP_HINT_TAGS = Object.freeze([
    'CASTE_EVAL',
]);

const DEFAULT_QR_PROMPT_PATTERNS = Object.freeze([
    '\\[System Note:',
    '\\*\\*--- Element \\d+:',
    '\\*\\*Variable Initialization:',
    '\\*\\*STRUCTURE:\\*\\*',
    'Output the following:',
    'Generate the formatted',
]);

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTag(text, tagName) {
    if (!tagName) return false;
    const escaped = escapeRegex(tagName);
    return new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i').test(text);
}

function hasAnyTag(text, tags) {
    return tags.find(tag => hasTag(text, tag)) || '';
}

function compilePatterns(patterns) {
    return patterns
        .map((pattern) => {
            try {
                return new RegExp(pattern, 'i');
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

export function getQrHandlingConfig(preset) {
    const cfg = preset?.qrHandling && typeof preset.qrHandling === 'object'
        ? preset.qrHandling
        : {};

    return {
        enabled: cfg.enabled !== false,
        delayMs: Math.max(0, Number(cfg.delayMs ?? cfg.postprocessDelayMs ?? 1800) || 0),
        utilityTags: [
            ...DEFAULT_UTILITY_TAGS,
            ...toArray(cfg.utilityTags),
            ...toArray(cfg.skipTags),
        ],
        rpHintTags: [
            ...DEFAULT_RP_HINT_TAGS,
            ...toArray(cfg.rpHintTags),
            ...toArray(cfg.processTags),
        ],
        promptSkipPatterns: [
            ...DEFAULT_QR_PROMPT_PATTERNS,
            ...toArray(cfg.promptSkipPatterns),
        ],
    };
}

export function looksLikeSlashGeneratedPrompt(chat, preset) {
    const text = Array.isArray(chat)
        ? chat.map(message => String(message?.mes ?? '')).join('\n\n')
        : '';
    if (!text) return false;

    const cfg = getQrHandlingConfig(preset);
    return compilePatterns(cfg.promptSkipPatterns).some(pattern => pattern.test(text));
}

export function classifyReceivedMessage(message, preset) {
    const text = String(message?.mes ?? '');
    const cfg = getQrHandlingConfig(preset);
    const result = {
        action: 'process',
        reason: 'normal-message',
        delayMs: 0,
        utilityTag: '',
        rpHintTag: '',
    };

    if (!cfg.enabled || !text) {
        return result;
    }

    const rpHintTag = hasAnyTag(text, cfg.rpHintTags);
    const utilityTag = hasAnyTag(text, cfg.utilityTags);

    if (rpHintTag) {
        return {
            action: 'process',
            reason: `rp-qr-tag:${rpHintTag}`,
            delayMs: cfg.delayMs,
            utilityTag: '',
            rpHintTag,
        };
    }

    if (utilityTag) {
        return {
            action: 'skip',
            reason: `utility-tag:${utilityTag}`,
            delayMs: 0,
            utilityTag,
            rpHintTag: '',
        };
    }

    if (/<JSONPatch\b[\s\S]*?<\/JSONPatch>/i.test(text)
        || /<CurrentStats\b[\s\S]*?<\/CurrentStats>/i.test(text)
        || /<choices\b[\s\S]*?<\/choices>/i.test(text)) {
        return {
            action: 'process',
            reason: 'rp-qr-structured-output',
            delayMs: cfg.delayMs,
            utilityTag: '',
            rpHintTag: '',
        };
    }

    return result;
}
