// 5d: JSON 자동 보정.
// rpg-companion-sillytavern 의 jsonRepair 패턴 차용 + 단순화.
// 4 단계 fix: trailing comma / single quotes / unquoted keys / missing closing bracket.

let _repairCount = 0;

export function getRepairCount() {
    return _repairCount;
}

export function resetRepairCount() {
    _repairCount = 0;
}

function tryParse(candidate) {
    try {
        return { ok: true, value: JSON.parse(candidate) };
    } catch (e) {
        return { ok: false, value: null };
    }
}

function fixTrailingCommas(text) {
    return text.replace(/,(\s*[}\]])/g, '$1');
}

function fixSingleQuotes(text) {
    // 단순 치환: 'string' → "string". 값 안에 이미 " 가 있으면 깨질 수 있으나 빈도 낮음.
    return text.replace(/'([^'\\]*)'/g, '"$1"');
}

function fixUnquotedKeys(text) {
    // {key: 또는 ,key:  →  {"key": 또는 ,"key":
    return text.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
}

function fixMissingClosingBrackets(text) {
    let candidate = text;
    let opens = (candidate.match(/[\[{]/g) || []).length;
    let closes = (candidate.match(/[\]}]/g) || []).length;
    let safety = 16;
    while (opens > closes && safety > 0) {
        safety -= 1;
        // 마지막 open bracket 종류 기준
        let lastOpen = null;
        for (let i = candidate.length - 1; i >= 0; i--) {
            if (candidate[i] === '[' || candidate[i] === '{') {
                lastOpen = candidate[i];
                break;
            }
        }
        if (lastOpen === '[') candidate += ']';
        else if (lastOpen === '{') candidate += '}';
        else break;
        closes += 1;
    }
    return candidate;
}

/**
 * JSON 자동 보정 시도. 각 단계마다 parse 시도. 성공 시 _repairCount 증가.
 * @returns {any|null} 파싱된 값 또는 null (모든 단계 실패)
 */
export function repairJSON(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    // 0. raw parse
    let r = tryParse(trimmed);
    if (r.ok) return r.value;

    // 1. trailing comma
    let candidate = fixTrailingCommas(trimmed);
    r = tryParse(candidate);
    if (r.ok) { _repairCount += 1; return r.value; }

    // 2. single quotes
    candidate = fixSingleQuotes(candidate);
    r = tryParse(candidate);
    if (r.ok) { _repairCount += 1; return r.value; }

    // 3. unquoted keys
    candidate = fixUnquotedKeys(candidate);
    r = tryParse(candidate);
    if (r.ok) { _repairCount += 1; return r.value; }

    // 4. missing closing brackets
    candidate = fixMissingClosingBrackets(candidate);
    r = tryParse(candidate);
    if (r.ok) { _repairCount += 1; return r.value; }

    return null;
}
