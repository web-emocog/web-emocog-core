# wecog interface system

## Direction

The system uses a neutral research canvas, graphite surfaces and one lime
focus color. Electric blue is reserved for navigation focus and links. This
keeps the product distinctive without introducing decorative color into
participant stimuli.

The logo combines three concepts in one reproducible construction: a `w`, a
gaze path and a focus point. Source assets and usage rules are in
`apps/web/assets/BRAND.md`.

## Navigation

Researcher navigation contains six destinations at most:

1. Overview.
2. Studies and protocols.
3. Stimulus/AOI library.
4. Analytics.
5. Access management for authorized roles.
6. Settings.

The logo and breadcrumb both return to Overview. Global search resolves every
main destination without loading or transmitting project content. Billing is
kept in the DOM for backward compatibility but is hidden until the feature is
implemented.

Developer navigation reuses the brand but has its own operational information
architecture: modules, invitations, sessions, access and the researcher
workspace. The Access item is rendered only for an authenticated admin role.

Participant pages intentionally have no product navigation during a session.
They expose only the current task, a language selector and research-critical
status/actions.

## Themes and language

- Researcher/developer: light, dark and automatic system mode.
- Participant: light mode only, independent of the operating-system theme.
- Researcher: Russian and English.
- Participant: Russian, English, Chinese, Spanish, Hindi, Arabic, French,
  Bengali, Portuguese and Urdu.
- The consent/onboarding surface is translated in every participant locale.
  Technical QC terminology falls back to English outside Russian to preserve
  stable cross-team error semantics.
- Arabic and Urdu switch the document to right-to-left layout.

## Accessibility constraints

- Local Atkinson Hyperlegible Next font under OFL-1.1.
- Main participant action height: 54 px; language control: 44 px.
- Keyboard focus ring: 3 px high-contrast blue (lime in dark researcher mode).
- `prefers-reduced-motion` disables nonessential motion.
- Mobile layouts are checked at 390 x 844 with no horizontal overflow.
- The participant interface does not use a dark theme, glass effects or
  decorative animation that could alter the research experience.

## Verification

Automated checks live in `apps/autotests/tests/design-system.spec.ts` and run
in Chromium and Firefox. They cover role navigation, theme switching, ten
participant locales, breadcrumbs/search, mobile navigation, control sizes and
horizontal overflow.
