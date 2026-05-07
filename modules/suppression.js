// 5c: 보조 호출 / 인터셉터 스킵 컨텍스트 감지.
// 5d 갱신: IMPERSONATION_PATTERNS 12종 정규식 추가 (rpg-companion suppression 패턴 차용).
//   chatMetadata.script_injects.instruct 본문에만 적용. 일반 chat 메시지 본문은 검사 안 함.

import { getContext } from './utils.js';

const HARD_SKIP_TYPES = new Set(['quiet', 'impersonate']);

const IMPERSONATION_PATTERNS = [
    { id: 'first-perspective', re: /write in first person perspective from/i },
    { id: 'second-perspective', re: /write in second person perspective from/i },
    { id: 'third-perspective', re: /write in third person perspective from/i },
    { id: 'you-yours', re: /using you\/yours for/i },
    { id: 'third-person-pronouns', re: /third-person pronouns for/i },
    { id: 'impersonate-word', re: /\bimpersonat(e|ion)?\b/i },
    { id: 'assume-role', re: /assume the role of/i },
    { id: 'play-role', re: /play the role of/i },
    { id: 'impersonate-command', re: /\/impersonate\b.*\bawait=true\b/i },
    { id: 'generic-first', re: /\bfirst person\b/i },
    { id: 'generic-second', re: /\bsecond person\b/i },
    { id: 'generic-third', re: /\bthird person\b/i },
];

function getInstructText(context) {
    const instruct = context?.chatMetadata?.script_injects?.instruct;
    if (!instruct) return '';
    if (typeof instruct === 'object') {
        return String(instruct.value ?? instruct ?? '');
    }
    return String(instruct);
}

function matchImpersonationPattern(text) {
    if (typeof text !== 'string' || !text) return null;
    for (const pat of IMPERSONATION_PATTERNS) {
        if (pat.re.test(text)) {
            return pat.id;
        }
    }
    return null;
}

/**
 * 보조 호출을 스킵해야 하는지 판정.
 * @param {string|undefined} type ST 의 generation type ('quiet' / 'impersonate' / etc).
 *                                MESSAGE_RECEIVED 단계에서는 undefined.
 */
export function evaluateSuppression(type) {
    if (typeof type === 'string' && HARD_SKIP_TYPES.has(type)) {
        return { suppress: true, reason: `hard-skip:${type}`, matchedPattern: null };
    }

    const context = getContext();
    const instructText = getInstructText(context);

    if (instructText) {
        const matched = matchImpersonationPattern(instructText);
        if (matched) {
            return { suppress: true, reason: `impersonation-pattern:${matched}`, matchedPattern: matched };
        }
        return { suppress: true, reason: 'guided-instruct', matchedPattern: null };
    }

    return { suppress: false, reason: null, matchedPattern: null };
}

/**
 * 5d 디버그용. 현재 chatMetadata 기준 evaluateSuppression 결과 + 진단 데이터.
 */
export function diagnoseSuppression() {
    const context = getContext();
    const instructText = getInstructText(context);
    const matched = matchImpersonationPattern(instructText);
    return {
        instructPresent: !!instructText,
        instructLength: instructText.length,
        matchedPattern: matched,
        result: evaluateSuppression(undefined),
        patternsCount: IMPERSONATION_PATTERNS.length,
    };
}
