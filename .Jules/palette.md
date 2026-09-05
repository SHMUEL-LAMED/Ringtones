## 2025-09-03 - Accessible Audio Range Sliders and Toggle Buttons
**Learning:** For audio editor interfaces with custom duration range sliders and play/pause toggle controls, explicitly associating labels with `for="id"`, updating `aria-valuetext` dynamically in Hebrew, and switching `aria-label` / `aria-pressed` on play state change dramatically improves screen reader clarity.
**Action:** Always maintain aria-valuetext and aria-pressed attributes when handling range inputs and toggle play buttons in audio widgets.

## 2025-09-05 - Initial Preset State Sync and Fine-Tuning Accessibility
**Learning:** When audio snippet selections default to an automatically detected segment (such as chorus) upon file loading, preset choice buttons (`data-kind`) must explicitly sync their `active` visual class and `aria-pressed="true"` state to avoid screen reader state mismatches. Additionally, relative adjustment ("nudge") controls require descriptive `aria-label` attributes to clarify their directional impact.
**Action:** Always synchronize initial UI selection states and ARIA pressed values on async data load, and provide descriptive aria-labels for relative nudge buttons.
