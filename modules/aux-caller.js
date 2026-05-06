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

function normalizeAuxResponse(response) {
    if (typeof response === 'string') {
        return response;
    }

    if (typeof response?.content === 'string') {
        return response.content;
    }

    if (typeof response?.text === 'string') {
        return response.text;
    }

    if (typeof response?.message === 'string') {
        return response.message;
    }

    if (typeof response?.data === 'string') {
        return response.data;
    }

    return '';
}

function getConnectionProfiles() {
    const context = getContext();
    const profiles = context?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(profiles) ? profiles : [];
}

function getAuxProfile(settings) {
    const profiles = getConnectionProfiles();
    debugLog(settings, `Connection profiles count: ${profiles.length}`);
    return profiles.find((profile) => profile.id === settings.auxProfileId)
        ?? profiles.find((profile) => profile.name === settings.auxProfileName)
        ?? null;
}

async function callConnectionProfile(prompts, settings) {
    const context = getContext();
    const service = context?.ConnectionManagerRequestService;
    if (!service?.sendRequest) {
        throw new Error('Connection Manager direct request service is not available.');
    }

    const profile = getAuxProfile(settings);
    if (!profile?.id) {
        throw new Error('Aux Connection Profile is not configured.');
    }

    const messages = [
        {
            role: 'system',
            content: prompts.systemPrompt,
        },
        {
            role: 'user',
            content: prompts.userPrompt,
        },
    ];
    const maxTokens = Math.max(100, Number(settings.auxMaxTokens) || 600);
    const custom = {
        stream: false,
        extractData: true,
        includePreset: false,
        includeInstruct: true,
    };
    const overridePayload = {
        temperature: 0.3,
    };

    debugLog(settings, `Selected aux profile: ${profile.name || profile.id} (${profile.id})`);
    debugLog(settings, `Direct profile request: ${profile.name || profile.id}`);
    const response = await service.sendRequest(profile.id, messages, maxTokens, custom, overridePayload);
    return normalizeAuxResponse(response);
}

export async function callAuxModel(prompts, settings) {
    if (isAuxCallInProgress) {
        throw new Error('Aux call is already in progress.');
    }

    if (!settings.auxProfileId && !settings.auxProfileName) {
        throw new Error('Aux Connection Profile is not configured.');
    }

    isAuxCallInProgress = true;

    try {
        const response = await callConnectionProfile(prompts, settings);

        if (typeof response !== 'string' || !response.trim()) {
            throw new Error('Aux model returned an empty response.');
        }

        return response;
    } catch (directError) {
        console.warn('[AuxSplit] Direct Connection Profile request failed, falling back to /profile switching', directError);
        return callAuxModelWithProfileSwitch(prompts, settings);
    } finally {
        isAuxCallInProgress = false;
    }
}

async function callAuxModelWithProfileSwitch(prompts, settings) {
    const profile = getAuxProfile(settings);
    const profileName = profile?.name ?? settings.auxProfileName;
    debugLog(settings, `Selected aux profile fallback: ${profileName || '(none)'}`);
    let savedProfile = '';

    try {
        savedProfile = await getCurrentProfileName();
        debugLog(settings, `Profile switch fallback: ${savedProfile || '(unknown)'} -> ${profileName}`);

        await switchProfile(profileName);
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
    }
}
