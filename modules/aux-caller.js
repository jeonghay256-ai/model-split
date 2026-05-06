import { debugLog, getContext, notifyWarning, runSlashCommand } from './utils.js';

let isAuxCallInProgress = false;

export function resetAuxCallState() {
    isAuxCallInProgress = false;
}

async function getCurrentProfileName() {
    const result = await runSlashCommand('/profile');
    if (typeof result === 'string') {
        return result.trim();
    }

    return String(result?.pipe ?? result?.value ?? result?.result ?? '').trim();
}

function quoteSlashArg(value) {
    return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

async function switchProfile(profileName) {
    if (!profileName) {
        throw new Error('Connection Profile name is empty.');
    }

    await runSlashCommand(`/profile ${quoteSlashArg(profileName)}`);
}

async function generateRaw(systemPrompt, userPrompt) {
    const context = getContext();
    const rawGenerator = context?.generateRaw ?? globalThis.generateRaw;

    if (typeof rawGenerator !== 'function') {
        throw new Error('generateRaw is not available from SillyTavern context.');
    }

    return rawGenerator({
        systemPrompt,
        prompt: userPrompt,
        prefill: '',
    });
}

export async function callAuxModel(prompts, settings) {
    if (isAuxCallInProgress) {
        throw new Error('Aux call is already in progress.');
    }

    if (!settings.auxProfileName) {
        throw new Error('Aux Connection Profile is not configured.');
    }

    isAuxCallInProgress = true;
    let savedProfile = '';

    try {
        savedProfile = await getCurrentProfileName();
        debugLog(settings, `Profile switch: ${savedProfile || '(unknown)'} -> ${settings.auxProfileName}`);

        await switchProfile(settings.auxProfileName);
        const response = await generateRaw(prompts.systemPrompt, prompts.userPrompt);

        if (typeof response !== 'string' || !response.trim()) {
            throw new Error('Aux model returned an empty response.');
        }

        return response;
    } finally {
        if (savedProfile) {
            try {
                await switchProfile(savedProfile);
                debugLog(settings, `Profile restored: ${savedProfile}`);
            } catch (restoreError) {
                console.error('[AuxSplit] Failed to restore Connection Profile', restoreError);
                notifyWarning(`Aux Model Split: Connection Profile 복원 실패 (${savedProfile})`);
            }
        }

        isAuxCallInProgress = false;
    }
}
