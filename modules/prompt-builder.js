import {
    applyTemplate,
    getEnabledOutputs,
    resolveActiveRole,
    getActiveVariableFields,
} from './preset-manager.js';

function getCharacterName(context) {
    const characterId = context?.characterId;
    const characters = context?.characters;
    const character = Array.isArray(characters) ? characters[characterId] : null;
    return character?.name ?? context?.name2 ?? '{{char}}';
}

function getUserName(context) {
    return context?.name1 ?? context?.userName ?? '{{user}}';
}

function formatRecentContext(context, turns) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const count = Math.max(0, Number(turns) || 0) * 2;
    if (count === 0) {
        return '';
    }

    return chat
        .slice(Math.max(0, chat.length - count - 1), Math.max(0, chat.length - 1))
        .map((message) => {
            const role = message?.is_user ? getUserName(context) : (message?.name || getCharacterName(context));
            return `${role}: ${message?.mes ?? ''}`;
        })
        .join('\n\n');
}

function buildOutputsList(preset) {
    const enabledOutputs = getEnabledOutputs(preset);
    if (enabledOutputs.length === 0) return '(none)';
    return enabledOutputs.map(o => {
        const label = o.label || o.id;
        const close = (o.type === 'marker') ? '' : `...</${o.tagName}>`;
        return `- ${label} (id=${o.id}, type=${o.type}, position=${o.position}, responseMode=${o.responseMode}): <${o.tagName}>${close}`;
    }).join('\n');
}

export function buildAuxPrompt({ mainResponse, context, settings, preset }) {
    const charName = getCharacterName(context);
    const userName = getUserName(context);
    const recentContext = formatRecentContext(context, settings.contextTurns) || '(none)';

    const enabledOutputs = getEnabledOutputs(preset);
    const firstBlock = enabledOutputs.find(o => o.type === 'block');
    const firstMarker = enabledOutputs.find(o => o.type === 'marker');

    // 5d: variableSets 가 있으면 활성 Role 결정 + fields 펼치기
    const activeRole = resolveActiveRole(settings, preset, context);
    const fields = getActiveVariableFields(preset, activeRole);
    const statusFieldsList = fields.join('|');
    const statusFieldsKeyValue = fields.map(f => `${f}=...`).join('|');
    const statusFieldsLines = fields.map(f => `- ${f}: ...`).join('\n');

    const variables = {
        mainResponse,
        recentContext,
        charName,
        userName,
        // 단일 슬롯 (호환): 첫 block / 첫 marker 의 정보
        tagName: firstBlock?.tagName ?? '',
        footerTagName: firstMarker?.tagName ?? '',
        omitFooterWhenTagName: firstMarker?.omitWhenTagPresent ?? '',
        // 5c: 전체 outputs 정보 펼친 list
        outputsList: buildOutputsList(preset),
        // 5d: variableSets / Role
        activeRole: activeRole || '',
        statusFieldsList,
        statusFieldsKeyValue,
        statusFieldsLines,
    };

    const systemPrompt = applyTemplate(preset.auxSystemPrompt, variables);
    const userPrompt = applyTemplate(preset.auxUserPromptTemplate, variables);

    return { systemPrompt, userPrompt };
}

/**
 * 부분 재시도 시 user 프롬프트에 append 할 텍스트.
 * 어떤 outputs 가 어떤 사유로 실패했는지 명시.
 */
export function buildRetryAppendix({ failedOutputs, perOutputResults }) {
    const lines = ['', '[Retry context]', 'The previous response had format errors in these outputs:'];
    for (const o of failedOutputs) {
        const r = perOutputResults?.[o.id];
        const reason = r?.error || 'unknown';
        lines.push(`- <${o.tagName}> (id=${o.id}): ${reason}`);
    }
    lines.push('', 'Please regenerate exactly these blocks in the correct format. Keep all previously correct blocks unchanged in your output:');
    for (const o of failedOutputs) {
        if (o.type === 'marker') {
            lines.push(`- <${o.tagName}>`);
        } else {
            lines.push(`- <${o.tagName}>...</${o.tagName}>`);
        }
    }
    return lines.join('\n');
}
