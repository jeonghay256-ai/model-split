import { debugLog } from './utils.js';

const SKIPPED_TYPES = new Set(['quiet', 'impersonate']);

export function injectStatusBlocker(chat, type, preset, settings) {
    if (SKIPPED_TYPES.has(type)) {
        debugLog(settings, `Interceptor skipped for generation type: ${type}`);
        return;
    }

    if (!Array.isArray(chat) || chat.length === 0) {
        debugLog(settings, 'Interceptor skipped: empty chat');
        return;
    }

    const systemNote = {
        is_user: false,
        is_system: true,
        name: 'Aux Model Split',
        send_date: Date.now(),
        mes: preset.blockerText
            .replaceAll('{{tagName}}', preset.tagName)
            .replaceAll('{{footerTagName}}', preset.footerTagName || '')
            .replaceAll('{{omitFooterWhenTagName}}', preset.omitFooterWhenTagName || ''),
    };

    const insertAt = Math.max(0, chat.length - 1);
    chat.splice(insertAt, 0, systemNote);
    debugLog(settings, `Status blocker injected for <${preset.tagName}>`);
}
