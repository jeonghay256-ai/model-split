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
    const recentContext = formatRecentContext(context, settings.contextTurns);

    const systemPrompt = [
        `You generate only the DH-29 status block for ${charName}.`,
        `Return exactly one <${preset.tagName}>...</${preset.tagName}> block.`,
        'Do not include roleplay prose, markdown fences, explanations, JSON, or image tags.',
        'Use this exact field order: Day, 기분, 생각, 위치, 행동.',
        '기분 must be one of: 보통, 미소, 분노, 슬픔, 눈물, 짜증, 한심, 동요, 기쁨.',
        'If the story implies character sacrifice or missing data, use 데이터 없음 for 기분 and 생각.',
    ].join('\n');

    const userPrompt = [
        `Character: ${charName}`,
        `User: ${userName}`,
        '',
        'Recent context:',
        recentContext || '(none)',
        '',
        'Main response without status block:',
        mainResponse,
        '',
        `Now output only the <${preset.tagName}> block in this shape:`,
        `<${preset.tagName}>`,
        'Day: D-15',
        '기분: 보통',
        '생각: 시스템 최적화 분석 중.',
        '위치: 제어실',
        '행동: 모니터 확인',
        `</${preset.tagName}>`,
    ].join('\n');

    return { systemPrompt, userPrompt };
}
