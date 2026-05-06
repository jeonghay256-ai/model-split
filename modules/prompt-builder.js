import { applyTemplate } from './preset-manager.js';

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

export function buildAuxPrompt({ mainResponse, context, settings, preset }) {
    const charName = getCharacterName(context);
    const userName = getUserName(context);
    const recentContext = formatRecentContext(context, settings.contextTurns) || '(none)';
    const variables = {
        mainResponse,
        recentContext,
        charName,
        userName,
        tagName: preset.tagName,
        footerTagName: preset.footerTagName || '',
    };
    const systemPrompt = applyTemplate(preset.auxSystemPrompt, variables);
    const userPrompt = applyTemplate(preset.auxUserPromptTemplate, variables);

    return { systemPrompt, userPrompt };
}
