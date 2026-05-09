import { debugLog } from './utils.js';
import { collectBlockedTagNames, getEnabledOutputs } from './preset-manager.js';
import { evaluateSuppression } from './suppression.js';

function looksLikeSlashGeneratedPrompt(chat) {
    const text = Array.isArray(chat)
        ? chat.map(message => String(message?.mes ?? '')).join('\n\n')
        : '';
    if (!text) return false;

    return /\[System Note:/i.test(text)
        || /\*\*--- Element \d+:/i.test(text)
        || /\*\*Variable Initialization:/i.test(text)
        || /\*\*STRUCTURE:\*\*/i.test(text)
        || /Output the following:/i.test(text)
        || /Generate the formatted/i.test(text);
}

export function injectStatusBlocker(chat, type, preset, settings) {
    const suppression = evaluateSuppression(type);
    if (suppression.suppress) {
        debugLog(settings, `Interceptor suppressed: ${suppression.reason}`);
        return;
    }

    if (!Array.isArray(chat) || chat.length === 0) {
        debugLog(settings, 'Interceptor skipped: empty chat');
        return;
    }

    if (looksLikeSlashGeneratedPrompt(chat)) {
        debugLog(settings, 'Interceptor skipped: slash/QR generated prompt');
        return;
    }

    const blockedTags = collectBlockedTagNames(preset);
    if (blockedTags.length === 0) {
        debugLog(settings, 'Interceptor skipped: no enabled outputs');
        return;
    }

    const blockedTagsList = blockedTags.map(t => `<${t}>`).join(', ');
    const blockedTagOpenList = blockedTags.map(t => `<${t}>`).join('\n');
    const enabledOutputs = getEnabledOutputs(preset);
    const firstBlock = enabledOutputs.find(o => o.type === 'block');
    const firstMarker = enabledOutputs.find(o => o.type === 'marker');

    const noteText = String(preset.blockerText ?? '')
        .replaceAll('{{blockedTagsList}}', blockedTagsList)
        .replaceAll('{{blockedTagOpenList}}', blockedTagOpenList)
        .replaceAll('{{tagName}}', firstBlock?.tagName ?? '')
        .replaceAll('{{footerTagName}}', firstMarker?.tagName ?? '')
        .replaceAll('{{omitFooterWhenTagName}}', firstMarker?.omitWhenTagPresent ?? '');

    const systemNote = {
        is_user: false,
        is_system: true,
        name: 'Aux Model Split',
        send_date: Date.now(),
        mes: noteText,
    };

    const insertAt = Math.max(0, chat.length - 1);
    chat.splice(insertAt, 0, systemNote);
    debugLog(settings, `Status blocker injected for: ${blockedTagsList}`);
}
