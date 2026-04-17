// СЛОВАРЬ — финальная версия
// Основа: translations (2).js (улучшенная)
// + все ключи из translations.js (репо) для полной совместимости
// - pathology / visionIssues ключи удалены

export const translations = {
    ru: {
        // ── Welcome ──────────────────────────────────────────────
        welcome_title:    "Добро пожаловать",
        welcome_subtitle: "Платформа оценки внимания и эмоций",

        warning_title: "Важно:",
        warning_1: "Вам понадобится веб-камера",
        warning_2: "Данные о взгляде обрабатываются на вашем устройстве",
        warning_3: "Мы не сохраняем видео вашего лица",

        privacy_policy_short: "Видео не записывается и не передается; все расчеты выполняются на вашем устройстве; на сервер отправляются только обезличенные сводки.",

        btn_start: "Начать исследование",

        // ── Consent (расширенная версия — 6 разделов, 2 чекбокса) ──
        consent_header: "Информированное согласие",

        consent_1_title: "1. Цель исследования",
        consent_1_text:  "Мы проводим научное исследование когнитивных и эмоциональных реакций. Ваше участие поможет нам понять, как люди воспринимают визуальную информацию и реагируют на различные стимулы.",

        consent_2_title: "2. Процедура исследования",
        consent_2_text:  "Вам будет предложено выполнить несколько заданий перед веб-камерой. Система будет отслеживать движения ваших глаз для анализа внимания. Общая продолжительность участия — около 15–20 минут.",

        consent_3_title: "3. Конфиденциальность и безопасность данных",
        consent_3_text:  "Все данные обезличены и защищены. Мы НЕ сохраняем видеозапись вашего лица. Обработка видеопотока происходит локально в вашем браузере. На сервер передаются только обезличенные метрики (координаты взгляда, время реакции). Ваш email будет храниться отдельно от данных исследования и использоваться только для связи с вами по результатам.",

        consent_4_title: "4. Добровольность участия",
        consent_4_text:  "Ваше участие полностью добровольно. Вы можете прекратить участие в любой момент без объяснения причин. Это не повлечёт никаких негативных последствий.",

        consent_5_title: "5. Риски и дискомфорт",
        consent_5_text:  "Исследование не предполагает физических или психологических рисков. Если вы почувствуете дискомфорт, вы можете остановить участие в любой момент.",

        consent_6_title: "6. Контактная информация",
        consent_6_text:  "Если у вас возникнут вопросы о исследовании, вы можете связаться с нами по email: research@emocog.com",

        consent_checkbox_read:  "Я прочитал(а) полный текст согласия и понимаю условия участия",
        consent_checkbox_agree: "Мне есть 18 лет, и я добровольно согласен(а) участвовать в исследовании",
        consent_required:       "Необходимо отметить оба согласия для продолжения",

        // Обратная совместимость (старый одиночный чекбокс)
        consent_link:     "Полный текст согласия",
        consent_checkbox: "Я прочитал(а), мне есть 18 лет, и я согласен(а).",
        btn_confirm:      "Подтвердить и продолжить",

        // ── Registration ─────────────────────────────────────────
        reg_title: "Регистрация участника",
        reg_desc:  "Пожалуйста, укажите ваш Email",
        email_label: "Email",
        btn_next: "Далее",

        // ── Form ─────────────────────────────────────────────────
        form_title:        "Анкета участника",
        form_section_user: "О вас",

        label_age:    "Возраст",
        label_gender: "Пол",
        opt_select:   "Выбрать..",
        opt_m:        "Мужской",
        opt_f:        "Женский",
        opt_other_gender: "Другой",

        label_lang: "Родной язык",
        opt_ru:     "Русский",
        opt_en:     "English",
        opt_other:  "Другой",

        label_edu:          "Образование",
        opt_edu_school:     "Среднее",
        opt_edu_student:    "Студент",
        opt_edu_higher:     "Высшее",
        opt_edu_degree:     "Ученая степень",

        // ── Tech / Equipment ─────────────────────────────────────
        form_section_tech: "Оборудование и условия",

        // Зрение (без медицинских терминов, без патологий)
        label_vision_condition: "Используете ли вы средства коррекции зрения во время исследования?",
        opt_vis_none:  "Нет, не использую",
        opt_vis_glass: "Да, очки",
        opt_vis_lens:  "Да, контактные линзы",

        // Ведущая рука
        label_hand:   "Ведущая рука",
        opt_hand_r:   "Правая",
        opt_hand_l:   "Левая",

        // Устройство ввода
        label_device:   "Устройство ввода",
        opt_dev_mouse:  "Мышь",
        opt_dev_touch:  "Тачпад",

        // Клавиатура
        label_keyboard: "Тип клавиатуры",
        opt_kb_int:     "Встроенная (ноутбук)",
        opt_kb_ext:     "Внешняя",

        // Дополнительные опросники
        form_section_additional: "Дополнительные вопросы",

        // Валидация возраста
        age_min_error:      "Возраст должен быть не менее 18 лет",
        age_max_error:      "Возраст должен быть не более 99 лет",
        age_integer_error:  "Возраст должен быть целым числом",
        age_negative_error: "Возраст не может быть отрицательным",
        age_zero_error:     "Возраст не может быть равен нулю",

        // ── Calibration / Pre-check ───────────────────────────────
        calib_title: "Настройка камеры",
        calib_desc:  "Перед началом нам нужно убедиться, что всё готово: проверим освещение и положение камеры, а затем настроим систему.",

        msg_press_btn: "Подготовка калибровки...",
        status_label:  "Статус:",
        points_label:  "Записано точек:",
        btn_camera:    "Включить камеру",

        // Pre-check статусы
        precheck_initial:      "Нажмите \"Начать проверку\" чтобы включить камеру",
        precheck_requesting:   "⏳ Запрашиваем доступ к камере...",
        precheck_checking:     "⏳ Проверяем условия...",
        precheck_camera_error: "❌ Ошибка: ",
        precheck_all_good:     "✅ Check is passed! You can start calibration",
        btn_start_precheck:    "🎥 Начать проверку",
        btn_start_calib:       "✅ Начать калибровку",

        // Индикаторы
        label_light:      "Освещение",
        label_face:       "Лицо",
        label_pose:       "Поза головы",
        label_visibility: "Видимость лица",
        status_waiting:   "Ожидание...",
        status_error:     "❌ Error",

        guide_text: "Расположите лицо в кадре. Веб-камеру — примерно на уровне глаз; смотрите прямо в объектив.",

        // ── Final ─────────────────────────────────────────────────
        final_title: "Сессия завершена!",
        final_desc:  "Спасибо за участие. Данные сформированы.",
        qc_passed:   "✅ Данные валидны (QC Passed)",

        label_secure_sender: "Включить дополнительную защищенную отправку (security2 sender)",
        btn_download: "📥 Скачать JSON",
        btn_restart:  "Начать заново",

        // ── IDs ───────────────────────────────────────────────────
        id_participant:    "ID участника:",
        id_not_generated:  "ID не сгенерирован",
    },

    en: {
        // ── Welcome ──────────────────────────────────────────────
        welcome_title:    "Welcome",
        welcome_subtitle: "Attention & Emotion Assessment Platform",

        warning_title: "Important:",
        warning_1: "You will need a webcam",
        warning_2: "Gaze data is processed on your device",
        warning_3: "We do not store video of your face",

        privacy_policy_short: "Video is not recorded or transmitted; all calculations are performed on your device; only anonymized summaries are sent to the server.",

        btn_start: "Start Research",

        // ── Consent ───────────────────────────────────────────────
        consent_header: "Informed Consent",

        consent_1_title: "1. Purpose of the Study",
        consent_1_text:  "We are conducting a scientific study of cognitive and emotional responses. Your participation will help us understand how people perceive visual information and respond to various stimuli.",

        consent_2_title: "2. Study Procedure",
        consent_2_text:  "You will be asked to complete several tasks in front of a webcam. The system will track your eye movements to analyze attention. Total participation time is approximately 15–20 minutes.",

        consent_3_title: "3. Confidentiality and Data Security",
        consent_3_text:  "All data is anonymized and protected. We do NOT store video recordings of your face. Video stream processing occurs locally in your browser. Only anonymized metrics (gaze coordinates, reaction time) are sent to the server. Your email will be stored separately from study data and used only to contact you about results.",

        consent_4_title: "4. Voluntary Participation",
        consent_4_text:  "Your participation is entirely voluntary. You may discontinue at any time without explanation. This will have no negative consequences.",

        consent_5_title: "5. Risks and Discomfort",
        consent_5_text:  "The study does not involve physical or psychological risks. If you feel discomfort, you may stop at any time.",

        consent_6_title: "6. Contact Information",
        consent_6_text:  "If you have questions about the study, please contact us at: research@emocog.com",

        consent_checkbox_read:  "I have read the full consent text and understand the terms of participation",
        consent_checkbox_agree: "I am 18 years of age or older and voluntarily agree to participate in the study",
        consent_required:       "Both consents must be checked to continue",

        consent_link:     "Full consent text",
        consent_checkbox: "I have read it, I am 18+, and I agree.",
        btn_confirm:      "Confirm and Continue",

        // ── Registration ─────────────────────────────────────────
        reg_title:   "Participant Registration",
        reg_desc:    "Please enter your Email",
        email_label: "Email",
        btn_next:    "Next",

        // ── Form ─────────────────────────────────────────────────
        form_title:        "Participant Questionnaire",
        form_section_user: "About You",

        label_age:    "Age",
        label_gender: "Gender",
        opt_select:   "Select..",
        opt_m:        "Male",
        opt_f:        "Female",
        opt_other_gender: "Other",

        label_lang: "Native Language",
        opt_ru:     "Russian",
        opt_en:     "English",
        opt_other:  "Other",

        label_edu:          "Education",
        opt_edu_school:     "Secondary",
        opt_edu_student:    "Student",
        opt_edu_higher:     "Higher",
        opt_edu_degree:     "Academic Degree",

        // ── Tech / Equipment ─────────────────────────────────────
        form_section_tech: "Equipment & Conditions",

        label_vision_condition: "Do you use vision correction during the study?",
        opt_vis_none:  "No, I don't",
        opt_vis_glass: "Yes, glasses",
        opt_vis_lens:  "Yes, contact lenses",

        label_hand:   "Dominant Hand",
        opt_hand_r:   "Right",
        opt_hand_l:   "Left",

        label_device:   "Input Device",
        opt_dev_mouse:  "Mouse",
        opt_dev_touch:  "Touchpad",

        label_keyboard: "Keyboard Type",
        opt_kb_int:     "Built-in (laptop)",
        opt_kb_ext:     "External",

        form_section_additional: "Additional Questions",

        age_min_error:      "Age must be at least 18",
        age_max_error:      "Age must be no more than 99",
        age_integer_error:  "Age must be a whole number",
        age_negative_error: "Age cannot be negative",
        age_zero_error:     "Age cannot be zero",

        // ── Calibration / Pre-check ───────────────────────────────
        calib_title: "Camera Setup",
        calib_desc:  "Before we begin, let's make sure everything is ready: we'll check the lighting and camera position, then calibrate the system.",

        msg_press_btn: "Preparing calibration...",
        status_label:  "Status:",
        points_label:  "Points recorded:",
        btn_camera:    "Enable Camera",

        precheck_initial:      "Click \"Start Check\" to enable the camera",
        precheck_requesting:   "⏳ Requesting camera access...",
        precheck_checking:     "⏳ Checking conditions...",
        precheck_camera_error: "❌ Error: ",
        precheck_all_good:     "✅ Check is passed! You can start calibration",
        btn_start_precheck:    "🎥 Start Check",
        btn_start_calib:       "✅ Start Calibration",

        label_light:      "Lighting",
        label_face:       "Face",
        label_pose:       "Head Pose",
        label_visibility: "Face Visibility",
        status_waiting:   "Waiting...",
        status_error:     "❌ Error",

        guide_text: "Position your face in the frame. Place the webcam approximately at eye level; look directly into the lens.",

        // ── Final ─────────────────────────────────────────────────
        final_title: "Session Complete!",
        final_desc:  "Thank you for participating. Data has been collected.",
        qc_passed:   "✅ Data is valid (QC Passed)",

        label_secure_sender: "Enable additional secure transmission (security2 sender)",
        btn_download: "📥 Download JSON",
        btn_restart:  "Start Over",

        // ── IDs ───────────────────────────────────────────────────
        id_participant:   "Participant ID:",
        id_not_generated: "ID not generated",
    }
};