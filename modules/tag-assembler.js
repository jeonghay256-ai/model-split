function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasTagBlock(text, tagName) {
    if (typeof text !== 'string') {
        return false;
    }

    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'i');
    return pattern.test(text);
}

export function extractTagBlock(text, tagName) {
    if (typeof text !== 'string') {
        throw new Error('Aux response is empty.');
    }

    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'i');
    const match = text.match(pattern);

    if (!match?.[0]) {
        throw new Error(`Aux response did not contain <${tagName}> block.`);
    }

    return match[0].trim();
}

export function removeTagBlock(text, tagName) {
    if (typeof text !== 'string') {
        return {
            text: '',
            removed: null,
        };
    }

    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'i');
    const match = text.match(pattern);

    if (!match?.[0]) {
        return {
            text,
            removed: null,
        };
    }

    return {
        text: text.replace(pattern, '').trimStart(),
        removed: match[0].trim(),
    };
}

export function hasMarkerTag(text, tagName) {
    if (typeof text !== 'string' || !tagName) {
        return false;
    }

    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i');
    return pattern.test(text);
}

export function extractMarkerTag(text, tagName) {
    if (typeof text !== 'string' || !tagName) {
        return '';
    }

    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i');
    const match = text.match(pattern);
    return match?.[0]?.trim() ?? '';
}

export function removeMarkerTag(text, tagName) {
    if (typeof text !== 'string') {
        return {
            text: '',
            removed: null,
        };
    }

    if (!tagName) {
        return {
            text,
            removed: null,
        };
    }

    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i');
    const match = text.match(pattern);

    if (!match?.[0]) {
        return {
            text,
            removed: null,
        };
    }

    return {
        text: text.replace(pattern, '').trimEnd(),
        removed: match[0].trim(),
    };
}

export function composeMessageWithStatus(mainMessage, statusBlock, footerMarker = '') {
    const body = String(mainMessage ?? '').trimStart();
    const status = String(statusBlock ?? '').trim();
    const footer = String(footerMarker ?? '').trim();

    const parts = [];
    if (status) {
        parts.push(status);
    }

    if (body) {
        parts.push(body.trim());
    }

    if (footer) {
        parts.push(footer);
    }

    return parts.join('\n\n');
}

// ============================================================================
// 5c 신규: outputs[] 다중 처리 — 출력 타입(block/marker/nested) + position
// ============================================================================

function extractBlockResult(text, tagName) {
    if (typeof text !== 'string' || !tagName) {
        return { ok: false, content: '', fullMatch: '', error: 'not_found' };
    }
    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i');
    const match = text.match(pattern);
    if (!match) {
        return { ok: false, content: '', fullMatch: '', error: 'not_found' };
    }
    return { ok: true, content: match[2].trim(), fullMatch: match[0], error: null };
}

function extractMarkerResult(text, tagName) {
    if (typeof text !== 'string' || !tagName) {
        return { ok: false, content: '', fullMatch: '', error: 'not_found' };
    }
    const escaped = escapeRegExp(tagName);
    // marker 는 closing tag 가 없는 단독 태그. 단 동명의 block (`<tag>...</tag>`) 이 있으면
    // 그건 별개의 block 출력으로 보고 marker 매치는 스킵 (동일 tagName 충돌 방지).
    const blockPattern = new RegExp(`<${escaped}(\\s[^>]*)?>[\\s\\S]*?</${escaped}>`, 'i');
    if (blockPattern.test(text)) {
        return { ok: false, content: '', fullMatch: '', error: 'shadowed_by_block' };
    }
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>`, 'i');
    const match = text.match(pattern);
    if (!match) {
        return { ok: false, content: '', fullMatch: '', error: 'not_found' };
    }
    return { ok: true, content: '', fullMatch: match[0], error: null };
}

/**
 * 단일 output 추출. 5c: nested 는 outer block 만. inner 처리는 5d.
 * @returns {{ ok: boolean, content: string, fullMatch: string, error: string|null }}
 */
export function extractByOutput(text, output) {
    if (!output || !output.tagName) {
        return { ok: false, content: '', fullMatch: '', error: 'unsupported_type' };
    }
    if (output.type === 'block') return extractBlockResult(text, output.tagName);
    if (output.type === 'marker') return extractMarkerResult(text, output.tagName);
    if (output.type === 'nested') {
        // 5c: outer block 까지만 추출. 'json+template' 의 inner 처리는 5d.
        return extractBlockResult(text, output.tagName);
    }
    return { ok: false, content: '', fullMatch: '', error: 'unsupported_type' };
}

/**
 * 보조 응답에서 outputs 를 모두 추출.
 * @returns {Record<string, ExtractResult>} outputId 키 dict
 */
export function extractAllOutputs(rawResponse, outputs) {
    const result = {};
    if (!Array.isArray(outputs)) return result;
    for (const o of outputs) {
        if (!o || !o.id) continue;
        result[o.id] = extractByOutput(rawResponse, o);
    }
    return result;
}

/**
 * Phase 7 신규: 닫는 태그 없는 incomplete block 검출 + 제거.
 * Q1=B 변형 알고리즘:
 *   1) 여는 태그 갯수 > 닫는 태그 갯수면 마지막 여는 태그가 incomplete
 *   2) 종점 = 다음 enabled output 의 여는 태그 위치 (가장 가까운 것)
 *   3) 못 찾으면 → 라인 끝 (\n)
 *   4) 라인 끝도 없으면 → 메시지 끝
 *   5) 안전 한계 200자
 *
 * @param {string} text
 * @param {object} output  block 타입만 적용. marker / nested 는 무관.
 * @param {Array<object>} allOutputs  종점 결정에 사용할 다른 outputs
 * @param {object} options { maxStripLen=200 }
 * @returns {{ stripped: string, removedSnippet: string }|null}
 */
function stripIncompleteBlock(text, output, allOutputs, options = {}) {
    if (typeof text !== 'string' || !text) return null;
    if (!output || !output.tagName) return null;
    // type='block' 또는 'nested' 만. nested 도 outer block 형태(e.g. <UpdateVariable>...</UpdateVariable>) 이라 동일 처리.
    // marker 는 닫는 태그가 없는 게 정상이므로 incomplete 검사 자체 비대상.
    if (output.type !== 'block' && output.type !== 'nested') return null;

    const escaped = escapeRegExp(output.tagName);
    const openPattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>`, 'gi');
    const closePattern = new RegExp(`</${escaped}>`, 'gi');

    const opens = [];
    let m;
    while ((m = openPattern.exec(text)) !== null) {
        opens.push({ index: m.index, length: m[0].length });
        if (m.index === openPattern.lastIndex) openPattern.lastIndex += 1;
    }
    const closes = [];
    while ((m = closePattern.exec(text)) !== null) {
        closes.push({ index: m.index });
        if (m.index === closePattern.lastIndex) closePattern.lastIndex += 1;
    }

    if (opens.length <= closes.length) return null;  // 짝 맞춤 — incomplete 없음

    // incomplete = 가장 마지막 여는 태그 (짝 안 맞는 것)
    const incomplete = opens[opens.length - 1];
    const start = incomplete.index;
    const afterOpen = start + incomplete.length;

    // 종점 결정 (Q1=B 변형) — Phase 7 fix: 여는 태그 직후의 newline 을 skip 해서 본문 라인까지 잡음.
    let endPos = -1;

    // (1) 다음 enabled output 의 여는 태그 (가장 가까운 것)
    for (const other of (allOutputs || [])) {
        if (!other || other === output || !other.enabled || !other.tagName) continue;
        const otherEsc = escapeRegExp(other.tagName);
        const otherPat = new RegExp(`<${otherEsc}(?:\\s[^>]*)?>`, 'i');
        const sliced = text.slice(afterOpen);
        const om = sliced.match(otherPat);
        if (om && typeof om.index === 'number') {
            const otherPos = afterOpen + om.index;
            if (endPos === -1 || otherPos < endPos) endPos = otherPos;
        }
    }

    // (2) 못 찾으면 라인 끝.
    //     Phase 7 fix: 여는 태그 직후의 newline 들을 skip 해서 본문 라인 시작 위치 (bodyStart) 부터 검색.
    //     이렇게 안 하면 `<상태창>\nDay: D-` 같은 multi-line incomplete 에서 첫 \n 이 즉시 종점이 되어 여는 태그만 제거됨.
    if (endPos === -1) {
        let bodyStart = afterOpen;
        while (bodyStart < text.length && text[bodyStart] === '\n') {
            bodyStart += 1;
        }
        const lineEnd = text.indexOf('\n', bodyStart);
        endPos = (lineEnd >= 0) ? lineEnd : text.length;
    }

    // (3) 안전 한계 200자
    const maxStripLen = Number.isInteger(options?.maxStripLen) ? options.maxStripLen : 200;
    if (endPos - start > maxStripLen) {
        endPos = start + maxStripLen;
    }

    const removedSnippet = text.slice(start, endPos);
    const stripped = text.slice(0, start) + text.slice(endPos);
    return { stripped, removedSnippet };
}

/**
 * 메인 응답에서 outputs 의 태그를 모두 제거 (인터셉터 실패 시 메인이 출력해 버린 차단 태그 청소).
 *
 * Phase 7 보강: 짝맞춤 strip 후에도 닫는 태그 없는 incomplete block 이 남아있으면 추가 제거.
 *
 * @returns {{ text: string, removed: Array, incompleteRemoved: Array }}
 */
export function stripOutputsFromMain(mainText, outputs) {
    let stripped = String(mainText ?? '');
    const removed = [];
    const incompleteRemoved = [];

    if (!Array.isArray(outputs)) {
        return { text: stripped, removed, incompleteRemoved };
    }

    // 1단계: 짝맞춤 정규식으로 정상 block 제거 (5c 그대로)
    for (const o of outputs) {
        if (!o || !o.enabled) continue;
        const r = extractByOutput(stripped, o);
        if (r.ok && r.fullMatch) {
            stripped = stripped.replace(r.fullMatch, '');
            removed.push({ id: o.id, fullMatch: r.fullMatch });
        }
    }

    // 2단계: Phase 7 — 닫는 태그 없는 incomplete block 제거.
    //   type='block' 또는 'nested' 만. marker 는 닫는 태그 없는 게 정상이므로 호출 자체 스킵 (이중 안전장치).
    for (const o of outputs) {
        if (!o || !o.enabled) continue;
        if (o.type !== 'block' && o.type !== 'nested') continue;
        const result = stripIncompleteBlock(stripped, o, outputs);
        if (result) {
            stripped = result.stripped;
            incompleteRemoved.push({ id: o.id, fullMatch: result.removedSnippet });
        }
    }

    return {
        text: stripped.replace(/\n{3,}/g, '\n\n').trim(),
        removed,
        incompleteRemoved,
    };
}

// 5d: outputTemplate 안의 <Tag>{{key}}</Tag> 패턴 추출 → inner slot map.
function parseInnerSlots(outputTemplate) {
    if (typeof outputTemplate !== 'string' || !outputTemplate) return [];
    const slots = [];
    const re = /<(\w+)(?:\s[^>]*)?>\{\{(\w+)\}\}<\/\1>/g;
    let m;
    while ((m = re.exec(outputTemplate)) !== null) {
        slots.push({ tagName: m[1], placeholder: m[2] });
    }
    return slots;
}

function isJsonPatchSlot(slot) {
    const ph = String(slot.placeholder || '').toLowerCase();
    const tn = String(slot.tagName || '').toLowerCase();
    return ph === 'patch'
        || ph === 'jsonpatch'
        || ph === 'json_patch'
        || tn === 'jsonpatch'
        || tn === 'json_patch';
}

function extractInnerByTag(outerInnerContent, innerTagName) {
    if (typeof outerInnerContent !== 'string' || !innerTagName) return null;
    const escaped = escapeRegExp(innerTagName);
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i');
    const match = outerInnerContent.match(pattern);
    return match ? match[2].trim() : null;
}

/**
 * 5d: nested + json+template 분기.
 * outputTemplate 의 placeholder 마다 응답 outer 안의 동명 inner tag 본문 추출 → 치환.
 * JSONPatch 류 placeholder 는 normalizeJsonPatch 적용.
 *
 * @param extractResult tag-assembler.extractByOutput 결과 (outer 추출됨)
 * @param output preset.outputs[] 의 single output
 * @param helpers { normalizeJsonPatch, opPolicy }
 * @returns {{ assembled: string, allFilled: boolean, repaired: boolean, missingSlots: string[] }}
 */
function assembleNestedTemplate(extractResult, output, helpers) {
    const template = output.outputTemplate || '';
    const slots = parseInnerSlots(template);

    if (slots.length === 0) {
        return { assembled: extractResult.fullMatch, allFilled: true, repaired: false, missingSlots: [] };
    }

    let assembled = template.replaceAll('{{tagName}}', output.tagName);
    let allFilled = true;
    let repaired = false;
    const missingSlots = [];

    for (const slot of slots) {
        const innerContent = extractInnerByTag(extractResult.content, slot.tagName);

        if (innerContent === null) {
            // inner 누락 → placeholder 빈 문자열
            assembled = assembled.split(`{{${slot.placeholder}}}`).join('');
            allFilled = false;
            missingSlots.push(slot.placeholder);
            continue;
        }

        let value = innerContent;
        if (isJsonPatchSlot(slot) && helpers?.normalizeJsonPatch) {
            const r = helpers.normalizeJsonPatch(innerContent, helpers.opPolicy);
            if (r.ok) {
                value = r.normalized;
                if (r.repaired) repaired = true;
            } else {
                // repair 실패 → 빈 배열 fallback
                value = '[]';
                allFilled = false;
                missingSlots.push(`${slot.placeholder}(parse_failed)`);
            }
        }

        assembled = assembled.split(`{{${slot.placeholder}}}`).join(value);
    }

    return { assembled, allFilled, repaired, missingSlots };
}

/**
 * 단일 output 의 추출 결과 → 최종 메시지에 들어갈 text.
 *
 * 5d: responseMode='json+template' + type='nested' 일 때 inner 태그 추출 + placeholder 치환.
 * 그 외엔 raw fullMatch 그대로.
 *
 * @param extractResult
 * @param output
 * @param options { preset, normalizeJsonPatch, getJsonPatchOpPolicy } 선택. 내부에서 lazy require.
 */
export function buildOutputContent(extractResult, output, options = {}) {
    if (!extractResult || !extractResult.ok) return '';

    if (output?.type === 'nested' && output?.responseMode === 'json+template') {
        const helpers = {
            normalizeJsonPatch: options.normalizeJsonPatch,
            opPolicy: options.opPolicy,
        };
        const result = assembleNestedTemplate(extractResult, output, helpers);
        return result.assembled;
    }

    return extractResult.fullMatch;
}

/**
 * 5d 디버그용: nested+json+template 의 조립 상세 결과 (assembled 외 메타 포함).
 * simulateAuxResponse / lastCall 메타데이터에 사용.
 */
export function buildOutputContentDetailed(extractResult, output, options = {}) {
    if (!extractResult || !extractResult.ok) {
        return { assembled: '', allFilled: false, repaired: false, missingSlots: [] };
    }

    if (output?.type === 'nested' && output?.responseMode === 'json+template') {
        const helpers = {
            normalizeJsonPatch: options.normalizeJsonPatch,
            opPolicy: options.opPolicy,
        };
        return assembleNestedTemplate(extractResult, output, helpers);
    }

    return { assembled: extractResult.fullMatch, allFilled: true, repaired: false, missingSlots: [] };
}

/**
 * parts 를 메시지로 합성. position(prepend/append) 별로 분류 후 \n\n 분리자.
 * @param {string} mainBody 차단 태그가 제거된 메인 응답
 * @param {Array<{id, content, position, output}>} parts
 */
export function composeMessageFromParts(mainBody, parts) {
    const list = Array.isArray(parts) ? parts : [];
    const prepend = list.filter(p => p && p.output?.position === 'prepend' && p.content);
    const append = list.filter(p => p && p.output?.position === 'append' && p.content);

    const segments = [];
    for (const p of prepend) segments.push(p.content);
    const body = String(mainBody ?? '').trim();
    if (body) segments.push(body);
    for (const p of append) segments.push(p.content);
    return segments.filter(s => s).join('\n\n');
}
