export const VISUOSPATIAL_PROMPTS = Object.freeze([
    {
        id: 'draw_circle',
        i18nTitleKey: 'visuospatial_prompt_circle_title',
        i18nTextKey: 'visuospatial_prompt_circle_text',
        fallbackTitle: 'Нарисуйте круг',
        fallbackText: 'Нарисуйте взглядом ровный круг.'
    },
    {
        id: 'draw_clock',
        i18nTitleKey: 'visuospatial_prompt_clock_title',
        i18nTextKey: 'visuospatial_prompt_clock_text',
        fallbackTitle: 'Нарисуйте часы',
        fallbackText: 'Нарисуйте циферблат часов и стрелки на 11:10.'
    },
    {
        id: 'draw_person',
        i18nTitleKey: 'visuospatial_prompt_person_title',
        i18nTextKey: 'visuospatial_prompt_person_text',
        fallbackTitle: 'Нарисуйте человечка',
        fallbackText: 'Нарисуйте фигуру человека: голову, туловище, руки и ноги.'
    }
]);

export function pickRandomPrompt() {
    const prompts = VISUOSPATIAL_PROMPTS;
    const idx = Math.floor(Math.random() * prompts.length);
    return prompts[idx];
}
