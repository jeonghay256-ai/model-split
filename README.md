# Aux Model Split

SillyTavern extension MVP for splitting DH-29's status block generation into an auxiliary model.

실리태번 전용 보조 모델 출력 확장입니다. 현재는 DH-29 봇카드의 `<상태창>` 분리를 검증하는 MVP입니다.

## What It Does

- Instructs the main model not to output the DH-29 `<상태창>` block.
- Calls an auxiliary model after the main response is received.
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
- Not yet supported: preset editor, choices, JSONPatch, multi-output routing, community preset import/export
- Not modified: bot-card regex scripts, character-assets, QR-triggered tags

## Installation

Place this folder in:

```text
SillyTavern/data/<user-handle>/extensions/third-party/aux-model-split
```

Then reload SillyTavern and enable the extension from the extensions panel.

## Notes

The current MVP can switch Connection Profiles through `/profile`. A future version should use Connection Manager's direct request service, similar to Scenario-Summarizer, to avoid changing the active global profile during auxiliary calls.
