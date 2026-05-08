import { getTavernHelperVariableTables } from './tavern-helper-adapter.js';

function safeString(value) {
    if (value === null || value === undefined || value === '') return 'Unknown';
    if (typeof value === 'string') return value.trim() || 'Unknown';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function normalizeKey(key) {
    return String(key ?? '').trim().toLowerCase();
}

function setKnownValue(target, key, value, source, priority) {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) return;

    const existing = target.get(normalizeKey(cleanKey));
    if (existing && existing.priority > priority) return;

    target.set(normalizeKey(cleanKey), {
        key: cleanKey,
        value,
        source,
        priority,
    });
}

function collectFromObject(target, object, fields, source, priority) {
    if (!object || typeof object !== 'object') return;
    for (const field of fields) {
        const direct = object[field];
        if (direct !== undefined) {
            setKnownValue(target, field, direct, source, priority);
            continue;
        }

        const lowerField = normalizeKey(field);
        const matchingKey = Object.keys(object).find(key => normalizeKey(key) === lowerField);
        if (matchingKey) {
            setKnownValue(target, field, object[matchingKey], source, priority);
        }
    }
}

function collectFromPossibleStores(target, context, fields, activeRole) {
    const cm = context?.chatMetadata;
    collectFromObject(target, cm?.variables, fields, 'chatMetadata.variables', 400);
    collectFromObject(target, cm?.stat_data, fields, 'chatMetadata.stat_data', 400);
    collectFromObject(target, cm?.variables?.stat_data, fields, 'chatMetadata.variables.stat_data', 400);

    const chat = Array.isArray(context?.chat) ? context.chat.slice(0, Math.max(0, context.chat.length - 1)) : [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) continue;
        collectFromObject(target, message.extra?.mvu_variables, fields, 'message.extra.mvu_variables', 400);
        collectFromObject(target, message.extra?.stat_data, fields, 'message.extra.stat_data', 400);
        break;
    }

    if (activeRole) {
        setKnownValue(target, 'role', activeRole, 'activeRole', 450);
        setKnownValue(target, 'Role', activeRole, 'activeRole', 450);
    }
}

function extractLatestTag(text, tagName) {
    if (!text || !tagName) return '';
    const escaped = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<${escaped}(\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
    let match = null;
    let latest = '';
    while ((match = pattern.exec(String(text))) !== null) {
        latest = match[2] || '';
    }
    return latest.trim();
}

function getRecentAssistantTexts(context) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    return chat
        .slice(0, Math.max(0, chat.length - 1))
        .filter(message => message && !message.is_user && !message.is_system && typeof message.mes === 'string')
        .map(message => message.mes);
}

function findLatestTagInChat(context, tagName) {
    const texts = getRecentAssistantTexts(context);
    for (let i = texts.length - 1; i >= 0; i--) {
        const content = extractLatestTag(texts[i], tagName);
        if (content) return content;
    }
    return '';
}

function collectKeyValueLines(target, text, fields, source, priority) {
    if (!text) return;
    const fieldMap = new Map(fields.map(field => [normalizeKey(field), field]));

    const candidates = String(text)
        .split(/\r?\n|\|/)
        .map(line => line.trim())
        .filter(Boolean);

    for (const line of candidates) {
        const match = line.match(/^([^:=|]+?)\s*(?:=|:)\s*(.+)$/);
        if (!match) continue;
        const key = match[1].trim();
        const field = fieldMap.get(normalizeKey(key)) || key;
        if (!fieldMap.has(normalizeKey(field)) && !['role', 'lang'].includes(normalizeKey(field))) continue;
        setKnownValue(target, field, match[2].trim(), source, priority);
    }
}

function parseJsonPatch(text) {
    const patchText = extractLatestTag(text, 'JSONPatch') || text;
    const start = patchText.indexOf('[');
    const end = patchText.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
        const parsed = JSON.parse(patchText.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function collectFromJsonPatch(target, text, fields) {
    const fieldMap = new Map(fields.map(field => [normalizeKey(field), field]));
    const patch = parseJsonPatch(text);
    for (const op of patch) {
        if (!op || typeof op !== 'object' || typeof op.path !== 'string') continue;
        const key = op.path.replace(/^\/+/, '').split('/').pop();
        const field = fieldMap.get(normalizeKey(key));
        if (!field) continue;

        if (op.op === 'replace' || op.op === 'add') {
            setKnownValue(target, field, op.value, 'latest UpdateVariable JSONPatch', 300);
        } else if (op.op === 'delta') {
            const existing = target.get(normalizeKey(field));
            const currentNumber = Number(existing?.value);
            const delta = Number(op.value);
            setKnownValue(
                target,
                field,
                Number.isFinite(currentNumber) && Number.isFinite(delta) ? currentNumber + delta : op.value,
                'latest UpdateVariable JSONPatch',
                300,
            );
        }
    }
}

function collectFromStructuredTags(target, context, fields) {
    const latestStatus = findLatestTagInChat(context, 'status');
    collectKeyValueLines(target, latestStatus, fields, 'latest status', 100);

    const latestUpdateVariable = findLatestTagInChat(context, 'UpdateVariable');
    collectFromJsonPatch(target, latestUpdateVariable, fields);

    const latestCurrentStats = findLatestTagInChat(context, 'CurrentStats');
    collectKeyValueLines(target, latestCurrentStats, fields, 'latest CurrentStats', 350);
}

function maybeGetVar(key) {
    const getvar = globalThis.getvar ?? globalThis.TavernHelper?.getvar;
    if (typeof getvar !== 'function') return undefined;
    try {
        return getvar(key);
    } catch {
        try {
            return getvar(key, { defaults: undefined });
        } catch {
            return undefined;
        }
    }
}

function collectFromGetVar(target, fields) {
    for (const field of fields) {
        const candidates = [field, field[0]?.toLowerCase() + field.slice(1), field.toLowerCase()].filter(Boolean);
        for (const key of candidates) {
            const value = maybeGetVar(key);
            if (value !== undefined && value !== null && value !== '') {
                setKnownValue(target, field, value, 'getvar', 500);
                break;
            }
        }
    }
}

function collectFromTavernHelper(target, fields) {
    const tables = getTavernHelperVariableTables();
    const priorities = {
        chat: 700,
        message: 680,
        character: 660,
        global: 640,
    };

    for (const [type, table] of Object.entries(tables)) {
        collectFromObject(target, table, fields, `TavernHelper.getVariables(${type})`, priorities[type] ?? 600);
    }
}

export function collectCurrentVariables({ context, preset, activeRole, fields = [] }) {
    const known = new Map();
    const roleKey = preset?.variableSets?.key || 'Role';
    const variableFields = Array.from(new Set([
        activeRole ? roleKey : '',
        'lang',
        ...(Array.isArray(fields) ? fields : []),
        ...(Array.isArray(preset?.variables) ? preset.variables : []),
    ].filter(Boolean)));

    if (variableFields.length === 0 && !activeRole) {
        return {
            values: {},
            sources: {},
            orderedKeys: [],
        };
    }

    collectFromTavernHelper(known, variableFields);
    collectFromStructuredTags(known, context, variableFields);
    collectFromPossibleStores(known, context, variableFields, activeRole);
    collectFromGetVar(known, variableFields);

    const orderedKeys = Array.from(new Set([
        activeRole ? 'role' : '',
        'lang',
        ...variableFields.filter(key => key !== roleKey),
    ].filter(Boolean)));
    const values = {};
    const sources = {};

    for (const key of orderedKeys) {
        const entry = known.get(normalizeKey(key));
        values[key] = entry ? entry.value : 'Unknown';
        sources[key] = entry?.source || 'default';
    }

    return { values, sources, orderedKeys };
}

export function formatCurrentVariablesBlock(currentVariables) {
    const keys = currentVariables?.orderedKeys || [];
    if (keys.length === 0) return '';

    const lines = ['Current known variables:'];
    for (const key of keys) {
        lines.push(`${key}=${safeString(currentVariables.values?.[key])}`);
    }
    return lines.join('\n');
}

export function injectCurrentVariablesIntoUserPrompt(userPrompt, currentVariablesBlock) {
    if (!currentVariablesBlock) return userPrompt;
    const prompt = String(userPrompt ?? '');
    if (prompt.includes(currentVariablesBlock)) return prompt;

    const insertion = `${currentVariablesBlock}\n\nUse Current known variables exactly for VARIABLE FIELDS.\nUse mainResponse only for free-text fields.`;
    const mainResponsePattern = /\nMain response\b/i;
    const match = mainResponsePattern.exec(prompt);
    if (match) {
        return `${prompt.slice(0, match.index)}\n\n${insertion}\n${prompt.slice(match.index)}`;
    }

    return `${prompt}\n\n${insertion}`;
}
