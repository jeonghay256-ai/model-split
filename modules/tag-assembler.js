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

export function composeMessageWithStatus(mainMessage, statusBlock) {
    const body = String(mainMessage ?? '').trimStart();
    const status = String(statusBlock ?? '').trim();

    if (!status) {
        return body;
    }

    if (!body) {
        return status;
    }

    return `${status}\n\n${body}`;
}
