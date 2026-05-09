import { evalEjsTemplate, isEjsTemplateAvailable } from './tavern-helper-adapter.js';

function hasEjsSyntax(text) {
    return /<%[=-]?[\s\S]*?%>/.test(String(text ?? ''));
}

function stripEjsSyntax(text) {
    return String(text ?? '')
        .replace(/<%=[\s\S]*?%>/g, '')
        .replace(/<%[\s\S]*?%>/g, '');
}

export async function preprocessEjsTemplate(template, label = 'prompt') {
    const input = String(template ?? '');
    if (!hasEjsSyntax(input)) {
        return {
            text: input,
            usedEjs: false,
            ok: true,
            error: null,
            fallback: false,
        };
    }

    if (!isEjsTemplateAvailable()) {
        return {
            text: stripEjsSyntax(input),
            usedEjs: true,
            ok: false,
            error: `${label}: EjsTemplate.evalTemplate is not available`,
            fallback: true,
        };
    }

    try {
        const text = await evalEjsTemplate(input);
        return {
            text: String(text ?? ''),
            usedEjs: true,
            ok: true,
            error: null,
            fallback: false,
        };
    } catch (error) {
        return {
            text: stripEjsSyntax(input),
            usedEjs: true,
            ok: false,
            error: `${label}: ${String(error?.message ?? error)}`,
            fallback: true,
        };
    }
}

export async function preprocessPromptTemplates({ systemTemplate, userTemplate }) {
    const system = await preprocessEjsTemplate(systemTemplate, 'systemPrompt');
    const user = await preprocessEjsTemplate(userTemplate, 'userPrompt');
    return {
        systemTemplate: system.text,
        userTemplate: user.text,
        metadata: {
            system,
            user,
            usedEjs: system.usedEjs || user.usedEjs,
            ok: system.ok && user.ok,
            errors: [system.error, user.error].filter(Boolean),
            fallback: system.fallback || user.fallback,
        },
    };
}
