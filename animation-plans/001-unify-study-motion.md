# 001 — Unify and soften study motion

- **Status**: DONE
- **Commit**: f3f53d9
- **Severity**: HIGH
- **Category**: Easing, cohesion, accessibility
- **Estimated scope**: 3 files, about 120 lines

## Problem

Motion is fragmented across `styles.css` and `app.js`: view entry uses a 280ms keyframe, article hover has a bare transition, vocabulary flip lasts 550ms, progress animates width, and reduced-motion removes every transition. Frequent card navigation needs faster, interruptible feedback, while state changes need consistent easing. The learning-mode control is also in the toolbar instead of below the card, away from the decision controls.

## Target

Define `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--motion-fast: 140ms`, and `--motion-ui: 220ms`. Use transform and opacity for movement. Keep card flips at 260ms. Add subtle press feedback at `scale(0.97)` for pointer buttons. Gate hover motion behind `@media (hover: hover) and (pointer: fine)`. Preserve short color/opacity feedback under reduced motion while removing spatial movement. Move the `vocabLearnMode` button beneath the card footer as a full-width secondary CTA.

## Repo conventions to follow

- Keep all motion in `styles.css` and the existing WAAPI helper in `app.js`.
- Follow the existing article-card vertical-flip direction and editorial/brutalist visual language.
- Do not add dependencies.

## Steps

1. In `index.html`, move `#vocabLearnMode` from `.vocab-toolbar` to a new wrapper immediately beneath `.vocab-card-footer` inside `#vocabStudy`.
2. In `styles.css`, add the four motion tokens to `:root` and replace ad-hoc UI easing/durations with them.
3. Make view entry, cards, rows, progress, buttons, bottom navigation, and filters use brief transform/opacity/color feedback. Do not animate layout properties.
4. Add `button:active { transform: scale(0.97) }` only for pointer interaction and exclude disabled controls and the large card surfaces.
5. Keep vocabulary and article vertical flips at 260ms with `--ease-in-out`; add a subtle opacity transition when card content changes.
6. Style the relocated learning-mode CTA as a full-width control beneath the card, with a clear active state.
7. Replace the global reduced-motion animation shutdown with rules that remove transforms and smooth scrolling but retain 120ms opacity/color feedback.
8. Preserve all existing functionality and dark-theme colors.

## Boundaries

- Do not change vocabulary selection, grading, authentication, persistence, or Supabase behavior.
- Do not add libraries.
- Do not animate width, height, padding, margin, top, or left.

## Verification

- **Mechanical**: `node --check app.js` and `git diff --check` both pass.
- **Feel check**: navigate all main tabs, flip and advance both article and vocabulary cards, toggle filters, mark a word known, and open dialogs. Nothing should jump or take longer than 300ms. Rapid repeated actions must remain responsive.
- Verify `prefers-reduced-motion` removes spatial motion but retains clear state/color feedback.
- Confirm the learning-mode button is directly beneath the vocabulary card controls on desktop and mobile.
- **Done when**: motion feels consistent, no layout property is animated, and all controls remain keyboard accessible.
