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
