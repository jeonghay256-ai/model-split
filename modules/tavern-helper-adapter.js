const VARIABLE_TYPES = Object.freeze(['chat', 'message', 'character', 'global']);

function getTavernHelper() {
    return globalThis.TavernHelper ?? null;
}

function getEjsTemplate() {
    return globalThis.EjsTemplate ?? getTavernHelper()?.EjsTemplate ?? null;
}

function getFunctionNames(object) {
    if (!object || typeof object !== 'object') return [];
    const names = new Set();
    let cursor = object;
    while (cursor && cursor !== Object.prototype) {
        for (const key of Object.getOwnPropertyNames(cursor)) {
            try {
                if (typeof object[key] === 'function') {
                    names.add(key);
                }
            } catch {
                // Some host objects can throw on property access.
            }
        }
        cursor = Object.getPrototypeOf(cursor);
    }
    return Array.from(names).sort();
}

function getVariablesFunction() {
    const helper = getTavernHelper();
    if (typeof helper?.getVariables === 'function') {
        return helper.getVariables.bind(helper);
    }
    if (typeof globalThis.getVariables === 'function') {
        return globalThis.getVariables.bind(globalThis);
    }
    return null;
}

function tryGetVariables(option) {
    const getVariables = getVariablesFunction();
    if (!getVariables) {
        return { ok: false, value: null, error: 'getVariables is not available' };
    }

    try {
        const value = getVariables(option);
        return { ok: true, value, error: null };
    } catch (error) {
        return { ok: false, value: null, error: String(error?.message ?? error) };
    }
}

function summarizeValue(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (depth >= 2) {
        return Array.isArray(value) ? `[array:${value.length}]` : `{object:${Object.keys(value).length}}`;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 20).map(item => summarizeValue(item, depth + 1));
    }

    const result = {};
    for (const key of Object.keys(value).slice(0, 80)) {
        result[key] = summarizeValue(value[key], depth + 1);
    }
    return result;
}

export function isTavernHelperAvailable() {
    return !!getTavernHelper() || typeof globalThis.getVariables === 'function';
}

export function isEjsTemplateAvailable() {
    return typeof getEjsTemplate()?.evalTemplate === 'function';
}

export async function evalEjsTemplate(template) {
    const ejsTemplate = getEjsTemplate();
    if (typeof ejsTemplate?.evalTemplate !== 'function') {
        throw new Error('EjsTemplate.evalTemplate is not available');
    }
    return await ejsTemplate.evalTemplate(String(template ?? ''));
}

export function getTavernHelperVariableTables() {
    const tables = {};
    for (const type of VARIABLE_TYPES) {
        const option = type === 'message'
            ? { type, message_id: 'latest' }
            : { type };
        const result = tryGetVariables(option);
        if (result.ok && result.value && typeof result.value === 'object') {
            tables[type] = result.value;
        }
    }
    return tables;
}

export function diagnoseTavernHelper() {
    const helper = getTavernHelper();
    const ejsTemplate = getEjsTemplate();
    const getVariables = getVariablesFunction();
    const variableResults = {};

    for (const type of VARIABLE_TYPES) {
        const option = type === 'message'
            ? { type, message_id: 'latest' }
            : { type };
        const result = tryGetVariables(option);
        variableResults[type] = {
            ok: result.ok,
            error: result.error,
            keys: result.value && typeof result.value === 'object' ? Object.keys(result.value) : [],
            preview: summarizeValue(result.value),
        };
    }

    return {
        tavernHelperAvailable: !!helper,
        getVariablesAvailable: typeof getVariables === 'function',
        ejsTemplateAvailable: !!ejsTemplate,
        tavernHelperFunctions: getFunctionNames(helper),
        ejsTemplateFunctions: getFunctionNames(ejsTemplate),
        variables: variableResults,
    };
}
