export function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

export function debugLog(settings, ...args) {
    if (settings?.debug) {
        console.log('[AuxSplit]', ...args);
    }
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function notifyError(message) {
    globalThis.toastr?.error?.(message) ?? console.error('[AuxSplit]', message);
}

export function notifyWarning(message) {
    globalThis.toastr?.warning?.(message) ?? console.warn('[AuxSplit]', message);
}

export function notifyInfo(message) {
    if (globalThis.toastr?.info) {
        globalThis.toastr.info(`<pre>${escapeHtml(message)}</pre>`, 'Aux Model Split', {
            escapeHtml: false,
            timeOut: 0,
            extendedTimeOut: 0,
            closeButton: true,
        });
        return;
    }

    console.info('[AuxSplit]', message);
}

export async function setLastCallMetadata(lastCall) {
    const context = getContext();
    if (!context?.chatMetadata) {
        return;
    }

    context.chatMetadata.aux_model_split = {
        lastCall: {
            timestamp: new Date().toISOString(),
            ...lastCall,
        },
    };

    await context.saveMetadata?.();
}

export async function runSlashCommand(command) {
    const context = getContext();
    const executor = context?.executeSlashCommandsWithOptions
        ?? context?.executeSlashCommands
        ?? globalThis.executeSlashCommandsWithOptions;

    if (typeof executor !== 'function') {
        throw new Error('Slash command executor is not available.');
    }

    try {
        return await executor(command, {
            handleExecutionErrors: true,
            suppressOutput: true,
        });
    } catch (error) {
        return await executor(command);
    }
}
