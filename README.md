# Aux Model Split

SillyTavern extension MVP for splitting DH-29's status block generation into an auxiliary model.

실리태번 전용 보조 모델 출력 확장입니다. 현재는 DH-29 봇카드의 `<상태창>` 분리를 검증하는 MVP입니다.

## What It Does

- Instructs the main model not to output the DH-29 `<상태창>` block.
- Calls an auxiliary model through a saved SillyTavern Connection Profile after the main response is received.
- Extracts the auxiliary model's `<상태창>...</상태창>` output.
- Rebuilds the visible chat message as:

```text
<상태창>
...
</상태창>

Main roleplay text and any remaining tags such as <메뉴>
```

The final output stays inside the normal SillyTavern chat message so existing bot-card regex rendering continues to work.

## Current Scope

This is a DH-29 MVP.

- Supported: `<상태창>` generation only
- Supported: optional footer marker composition such as DH-29's `<메뉴>`
- Supported: editable auxiliary output prompts in the extension settings UI
- Not yet supported: preset editor, choices, JSONPatch, multi-output routing, community preset import/export
- Not modified: bot-card regex scripts, character-assets, QR-triggered tags

## Recommended Workflow

To reduce the main model's status-output workload:

1. Disable or remove the status header instruction from the bot card, World Info, or author's note.
2. Paste that status-header instruction into Aux Model Split's auxiliary output prompt field.
3. Keep the bot card's regex scripts unchanged.
4. Let the main model generate roleplay prose while the auxiliary model generates the structured tag block.

The extension then composes the auxiliary status block back into the normal chat message so the original SillyTavern regex UI still renders.

For DH-29, keep the footer marker setting enabled so `<메뉴>` is placed at the bottom of the final message.

## Installation

Place this folder in:

```text
SillyTavern/data/<user-handle>/extensions/third-party/aux-model-split
```

Then reload SillyTavern and enable the extension from the extensions panel.

## Auxiliary Model Connection

The extension reads saved Connection Profiles from SillyTavern's Connection Manager and lets you choose one in the settings panel.

The preferred call path uses `ConnectionManagerRequestService.sendRequest(...)`, similar to Scenario-Summarizer, so the active global profile does not need to change during auxiliary calls.

If the direct request service is unavailable, the MVP falls back to the older `/profile` switch-and-restore path.
