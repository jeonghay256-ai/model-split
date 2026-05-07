// 5d: JSONPatch 정상화.
// repair → 배열 형식 검증 → opPolicy 기반 op 필터.
// Q3=A: delta op 는 passthrough (mvu 가 처리).
// Q4=A: RFC 6902 형식 검증 안 함. JSON.parse 성공 + 배열이면 통과.

import { repairJSON } from './json-repair.js';

const DEFAULT_ACCEPTED_OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test', 'delta'];

/**
 * @returns {{ ok: boolean, normalized: string, opsCount: number, errors: string[], repaired: boolean }}
 */
export function normalizeJsonPatch(rawText, opPolicy) {
    if (typeof rawText !== 'string') {
        return { ok: false, normalized: '[]', opsCount: 0, errors: ['input is not a string'], repaired: false };
    }
    const trimmed = rawText.trim();
    if (!trimmed) {
        return { ok: true, normalized: '[]', opsCount: 0, errors: [], repaired: false };
    }

    // 직접 파싱
    let parsed = null;
    let repaired = false;
    try {
        parsed = JSON.parse(trimmed);
    } catch (e) {
        // repair 시도
        parsed = repairJSON(trimmed);
        if (parsed !== null && parsed !== undefined) {
            repaired = true;
        }
    }

    if (parsed === null || parsed === undefined) {
        return { ok: false, normalized: '[]', opsCount: 0, errors: ['JSON parse failed'], repaired: false };
    }

    if (!Array.isArray(parsed)) {
        return { ok: false, normalized: '[]', opsCount: 0, errors: ['JSONPatch must be an array'], repaired };
    }

    const accepted = (opPolicy && Array.isArray(opPolicy.acceptedOps))
        ? opPolicy.acceptedOps
        : DEFAULT_ACCEPTED_OPS;
    const passthrough = !opPolicy || opPolicy.passthrough !== false;

    const filtered = [];
    const errors = [];

    parsed.forEach((op, i) => {
        if (!op || typeof op !== 'object' || Array.isArray(op)) {
            errors.push(`ops[${i}] is not an object`);
            return;
        }
        const opName = op.op;
        if (typeof opName !== 'string' || !opName.trim()) {
            errors.push(`ops[${i}].op missing or not a string`);
            return;
        }
        if (!accepted.includes(opName)) {
            if (passthrough) {
                filtered.push(op);
            } else {
                errors.push(`ops[${i}].op '${opName}' not in acceptedOps`);
            }
            return;
        }
        filtered.push(op);
    });

    // 배열로 파싱된 이상, errors 가 있어도 filtered 에 통과 op 가 있으면 ok=true.
    // 빈 배열 + errors 없으면 OK (보조가 정상적으로 [] 출력한 케이스).
    const ok = errors.length === 0 || filtered.length > 0;

    return {
        ok,
        normalized: JSON.stringify(filtered),
        opsCount: filtered.length,
        errors,
        repaired,
    };
}
