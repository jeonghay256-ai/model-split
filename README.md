# Aux Model Split

SillyTavern extension for splitting structured bot outputs into an auxiliary model.

The main model can focus on roleplay prose while an auxiliary model generates structured tags such as status panels, choice blocks, and variable updates. The final output is composed back into the normal chat message so existing bot-card regex, mvu, and UI rendering continue to work.

## Current Version

`0.2.0`

## Features

- Preset model with `outputs[]`
- Output types: `block`, `marker`, `nested`
- Output positions: `prepend`, `append`
- Response modes:
  - `raw`: auxiliary model outputs complete tags
  - `json+template`: auxiliary model outputs structured values, then `outputTemplate` assembles tags
- Built-in presets:
  - `dh-29-builtin`
  - `eden-univ-builtin`
- Connection Profile auxiliary calls with `/profile` fallback
- Partial retry for failed outputs
- Main-output stripping, including incomplete blocked tags
- JSONPatch repair helpers for nested outputs
- Current known variables injection for auxiliary prompts
- Debug API exposed as `AuxModelSplitDebug`

## Recommended Workflow

1. Move status/choices/variable-output instructions out of the bot card's World Info, author's note, or system prompt.
2. Put those structured-output instructions into the active Aux Model Split preset.
3. Keep the bot-card regex scripts unchanged.
4. Let the main model write RP prose and the auxiliary model write structured tags.

## Installation

Place this folder in:

```text
SillyTavern/data/<user-handle>/extensions/third-party/aux-model-split
```

Then reload SillyTavern and enable the extension.

## Debug API

Open F12 Console:

```js
AuxModelSplitDebug.listPresets()
AuxModelSplitDebug.getActivePreset()
AuxModelSplitDebug.setActivePreset(0)
AuxModelSplitDebug.exportAll()
AuxModelSplitDebug.diagnoseCurrentVariables()
AuxModelSplitDebug.diagnoseTavernHelper()
AuxModelSplitDebug.simulateAuxResponse('<상태창>...</상태창>')
AuxModelSplitDebug.simulateMainStrip('<상태창>...</상태창>RP')
```

## Notes

The preset editor UI is still limited. For deeper preset edits, use the debug API or export/import JSON.
