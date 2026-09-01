## 2025-09-01 - Dynamic ARIA Label & Icon Synchronization for Audio Controls
**Learning:** Single-page media players that update button icons dynamically during playback (`audio.play()`) must synchronize `aria-label` and `title` attributes via `audio.onplay` / `audio.onpause` media events, ensuring screen reader state remains aligned with the actual HTML5 `<audio>` playback state.
**Action:** Always bind accessibility attribute updates (`aria-label`, `title`, visual symbol) to audio media events rather than inline click handlers.
