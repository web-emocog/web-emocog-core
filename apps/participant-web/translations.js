// СЛОВАРЬ

export const translations = {
    ru: {
        welcome_title: "Добро пожаловать",
        welcome_subtitle: "Платформа оценки внимания и эмоций",
        warning_title: "Важно:",
        warning_1: "Вам понадобится веб-камера",
        warning_2: "Данные о взгляде обрабатываются на вашем устройстве",
        warning_3: "Мы не сохраняем видео вашего лица",
        btn_start: "Начать исследование",
        
        // ✅ Новые переводы для Step 2
        consent_1_title: "1. Цель исследования",
        consent_1_text: "Мы проводим научное исследование когнитивных и эмоциональных реакций. Ваше участие поможет нам понять, как люди воспринимают визуальную информацию и реагируют на различные стимулы.",
        
        consent_2_title: "2. Процедура исследования",
        consent_2_text: "Вам будет предложено выполнить несколько заданий перед веб-камерой. Система будет отслеживать движения ваших глаз для анализа внимания. Общая продолжительность участия — около 15-20 минут.",
        
        consent_3_title: "3. Конфиденциальность и безопасность данных",
        consent_3_text: "Все данные обезличены и защищены. Мы НЕ сохраняем видеозапись вашего лица. Обработка видеопотока происходит локально в вашем браузере. На сервер передаются только обезличенные метрики (координаты взгляда, время реакции). Ваш email будет храниться отдельно от данных исследования и использоваться только для связи с вами по результатам.",
        
        consent_4_title: "4. Добровольность участия",
        consent_4_text: "Ваше участие полностью добровольно. Вы можете прекратить участие в любой момент без объяснения причин. Это не повлечёт никаких негативных последствий.",
        
        consent_5_title: "5. Риски и дискомфорт",
        consent_5_text: "Исследование не предполагает физических или психологических рисков. Если вы почувствуете дискомфорт, вы можете остановить участие в любой момент.",
        
        consent_6_title: "6. Контактная информация",
        consent_6_text: "Если у вас возникнут вопросы о исследовании, вы можете связаться с нами по email: research@emocog.com",
        
        consent_checkbox_read: "Я прочитал(а) полный текст согласия и понимаю условия участия",
        consent_checkbox_agree: "Мне есть 18 лет, и я добровольно согласен(а) участвовать в исследовании",
        
        consent_required: "Необходимо отметить оба согласия для продолжения",

        reg_title: "Регистрация участника",
        reg_desc: "Пожалуйста, укажите ваш Email",
        email_label: "Email",
        btn_next: "Далее",
        form_title: "Анкета участника",
        form_section_user: "О вас",
        label_age: "Возраст",
        label_gender: "Пол",
        opt_select: "Выбрать..",
        opt_m: "Мужской",
        opt_f: "Женский",
        label_lang: "Родной язык",
        opt_ru: "Русский",
        opt_en: "English",
        opt_other: "Другой",
        label_edu: "Образование",
        opt_edu_school: "Среднее",
        opt_edu_student: "Студент",
        opt_edu_higher: "Высшее",
        opt_edu_degree: "Ученая степень",
        // === ОБНОВЛЕННЫЕ ПЕРЕВОДЫ ДЛЯ STEP 4 ===
        form_section_tech: "Оборудование и условия",
        
        // Зрение (БЕЗ медицинских терминов)
        label_vision_condition: "Используете ли вы средства коррекции зрения во время исследования?",
        opt_vis_none: "Нет, не использую",
        opt_vis_glass: "Да, очки",
        opt_vis_lens: "Да, контактные линзы",
        
        // Пол (добавляем опцию "Другой")
        opt_other_gender: "Другой",
        
        // Клавиатура (уже есть, но проверим)
        label_keyboard: "Тип клавиатуры",
        opt_kb_int: "Встроенная (ноутбук)",
        opt_kb_ext: "Внешняя",
        
        // Дополнительные опросники (для будущего)
        form_section_additional: "Дополнительные вопросы",
        
        // Валидация
        age_min_error: "Возраст должен быть не менее 18 лет",
        age_max_error: "Возраст должен быть не более 99 лет",
        age_integer_error: "Возраст должен быть целым числом",
        age_negative_error: "Возраст не может быть отрицательным",
        age_zero_error: "Возраст не может быть равен нулю",

        calib_title: "Настройка камеры",
        calib_desc: "Перед началом нам нужно убедиться, что всё готово: проверим освещение и положение камеры, а затем настроим систему, чтобы она могла отслеживать движения ваших глаз",
        msg_press_btn: "Подготовка калибровки..",
        status_label: "Статус:",
        points_label: "Записано точек:",
        btn_camera: "Включить камеру",
        final_title: "Сессия завершена!",
        final_desc: "Спасибо за участие. Данные сформированы",
        qc_passed: "Данные валидны (QC Passed)",
        btn_download: "Скачать JSON",
        btn_restart: "Начать заново",

        id_participant_label: "Ваш ID участника:",
        email_consent_storage: "Я подтверждаю, что указанный email корректен и даю согласие на его хранение в связке с моим ID участника для целей данного исследования.",
        email_consent_contact: "Я согласен(на) получать уведомления о статусе моих сессий и результатах исследования на указанный email.",
        consent_required: "Необходимо отметить оба согласия для продолжения",
        reg_desc: "Для участия в исследовании необходимо указать email. Он будет связан с вашим уникальным ID участника.",

        final_privacy_note: "Ваши данные обезличены и защищены. Исследователь получит только анонимные результаты.",

        // pre-check
        label_light: "Освещение",
        label_face: "Лицо",
        label_pose: "Поза головы",
        label_visibility: "Видимость лица",
        status_waiting: "Ожидание..",
        guide_text: "Расположите лицо внутри рамки",
        precheck_initial: "Нажмите \"Начать проверку\" чтобы включить камеру",
        precheck_requesting: "Запрашиваем доступ к камере..",
        precheck_checking: "Проверяем условия..",
        precheck_camera_error: "Ошибка: ",
        precheck_all_good: "Сheck is passed! You can start calibration",
        btn_start_precheck: "Начать проверку",
        btn_start_calib: "Начать калибровку",
        status_error: "Error",
        // статусы индикаторов (pre-check)
        status_too_dark: "Темно",
        status_too_bright: "Ярко",
        status_optimal: "Отлично",
        status_normal: "Норма",
        status_not_found: "Не найдено",
        status_too_small: "Далеко от камеры",
        status_too_large: "Близко к камере",
        status_out_of_zone: "Вне зоны",
        status_tilted: "Голова наклонена",
        status_stable: "Стабильно",
        status_unstable: "Нестабильно",
        status_no_face: "Нет лица",
        status_all_good: " Проверка пройдена! Можно начинать калибровку",
        status_needs_fix: "Требуется исправить",
        status_checking: "Проверяем условия",
        status_partial_face: "Часть лица скрыта",
        status_off_center: "Не по центру",
        status_face_occluded: "Лицо закрыто",
        status_hair_occlusion: "Волосы закрывают лицо",
        status_face_visible: "Лицо видно полностью",
        //подсказки
        tip_light_dark: "Слишком темно, необходимо включить лампу или подойти к окну",
        tip_light_bright: "Слишком ярко, не направляйте свет прямо в камеру или отойдите от окна",
        tip_face_not_found: "Лицо не обнаружено, убедитесь, что вы в центре кадра",
        tip_face_too_small: "Подвиньтесь ближе к камере, лицо должно быть полностью видно",
        tip_face_too_large: "Вы слишком близко, отодвиньтесь от камеры",
        tip_face_out_of_zone: "Расположите лицо по центру кадра",
        tip_face_tilted: "Держите голову прямо, не наклоняйте её",
        tip_pose_no_face: "Лицо не обнаружено, расположитесь по центру кадра",
        tip_pose_unstable: "Постарайтесь смотреть прямо в камеру и не двигаться",
        tip_pose_partial_face: "Часть лица не видна. Расположитесь так, чтобы всё лицо было в кадре",
        tip_pose_eyes_off_center: "Глаза не по центру экрана. Сместитесь так, чтобы смотреть прямо в камеру",
        tip_pose_move_right: "Сместитесь немного вправо",
        tip_pose_move_left: "Сместитесь немного влево", 
        tip_pose_move_up: "Поднимите камеру или опуститесь ниже",
        tip_pose_move_down: "Опустите камеру или поднимитесь выше",
        tip_pose_turn_down: "Наклоните голову немного вниз",
        tip_pose_turn_up: "Наклоните голову немного вверх",
        tip_pose_tilt_right: "поверните голову влево",
        tip_pose_tilt_left: "поверните голову вправо",
        tip_pose_straighten: "Выровняйте голову, не наклоняйте её вбок",
        tip_eyes_closed: "Откройте глаза и смотрите в камеру",
        tip_face_occluded: "Уберите предметы, закрывающие лицо (руки, волосы)",
        tip_hand_on_face: "Уберите руку от лица",
        tip_hair_covers_face: "Уберите волосы с лица, чтобы щёки и лоб были видны",
        tip_left_side_occluded: "Левая сторона лица закрыта — поверните голову или уберите помеху",
        tip_right_side_occluded: "Правая сторона лица закрыта — поверните голову или уберите помеху",
        tip_left_hand_on_face: "Уберите левую руку от лица",
        tip_right_hand_on_face: "Уберите правую руку от лица",
        tip_forehead_covered: "Лоб закрыт — уберите руку или волосы со лба",
        tip_chin_covered: "Подбородок закрыт — уберите руку от подбородка",
        tip_eyes_area_covered: "Область глаз закрыта — уберите помеху",
        tip_nose_covered: "Нос закрыт — уберите руку от носа",
        tip_mouth_covered: "Рот закрыт — уберите руку от рта",
        // Dynamic JS strings
        id_participant: "Ваш ID участника:",
        id_not_generated: "ID не сгенерирован",
        msg_init: "Инициализация нейросети... Разрешите доступ к камере",
        msg_face_ok: "Лицо найдено (OK)",
        msg_face_err: "Лицо НЕ найдено (Подвиньтесь)",
        msg_wait_stable: "Ждем стабилизации лица..",
        msg_face_locked: "Лицо захвачено! Калибровка через 2 сек..",
        msg_no_face: "Не вижу лица. Проверьте освещение",
        // Тест слежения
        test_tracking_title: "Тест слежения",
        test_follow_shape: "Следите глазами за фигурой",
        test_progress: "Прогресс:",
        test_complete: "Тест завершён!",

        // Test Hub
        test_hub_title: "Выбор теста",
        test_hub_subtitle: "Выберите тест для запуска. После завершения можно запустить следующий",
        test_hub_finish: "Завершить сессию",
        test_hub_ready: "Выберите тест, который хотите пройти",
        test_hub_running: "Тест выполняется..",
        test_hub_last_result: "Последний результат",
        test_hub_error: "Ошибка теста",
        test_card_rt_title: "RT test (Go/NoGo)",
        test_card_tracking_title: "Tracking test",
        test_card_vpc_title: "VPC (Felidae)",
        test_card_visuospatial_title: "Visuospatial drawing",

        // VPC
        vpc_progress: "Проба",
        vpc_instruction: "Смотрите на изображения естественно. Нажимать ничего не нужно",
        vpc_phase_fixation: "Фиксация",
        vpc_phase_familiar: "Знакомое изображение",
        vpc_phase_isi: "Пауза",
        vpc_phase_pair: "Пара изображений",
        vpc_phase_iti: "Интервал между пробами",

        // Visuospatial
        visuospatial_btn_start: "Начать рисование",
        visuospatial_btn_finish: "Завершить",
        visuospatial_status_wait_start: "Нажмите «Начать рисование», чтобы начать",
        visuospatial_status_drawing: "Рисование активно. Следите взглядом и завершите, когда будете готовы",
        visuospatial_prompt_circle_title: "Задание: круг",
        visuospatial_prompt_circle_text: "Нарисуйте взглядом ровный круг",
        visuospatial_prompt_clock_title: "Задание: часы",
        visuospatial_prompt_clock_text: "Нарисуйте циферблат часов и стрелки на 11:10",
        visuospatial_prompt_person_title: "Задание: человечек",
        visuospatial_prompt_person_text: "Нарисуйте фигуру человека: голову, туловище, руки и ноги",

        // Email validation errors 
        email_required: "Email обязателен для заполнения",
        email_emoji_error: "Email не может содержать emoji",
        email_format_error: "Неверный формат email",
        email_double_dots: "Email не может содержать двойные точки",
        email_spaces_error: "Email не может содержать пробелы",
        email_cyrillic_error: "Email не может содержать кириллицу",
        
        // Age validation errors
        age_integer_error: "Возраст должен быть целым числом",
        age_min_error: "Возраст должен быть не менее 18 лет",
        age_max_error: "Возраст должен быть не более 99 лет",
        age_negative_error: "Возраст не может быть отрицательным",
        age_zero_error: "Возраст должен быть не менее 18 лет",
        
        // File download messages
        file_copied: "ID скопирован!",
        
        // Gaze validation display texts
        validation_complete: "Валидация завершена!",
        validation_accuracy: "Точность",
        validation_precision: "Precision",
        
        // Calibration instructions
        calib_click_instruction: "Кликайте на красную точку, смотря на неё",
        calib_progress: "Точка",
        calib_complete: "Калибровка завершена!",
        
        // Validation instructions
        validation_look_instruction: "Смотрите на зелёную точку (не кликайте)",
        
        // Grammar
        point_of: "из",
        
        // QC issue descriptions 
        issue_insufficient_data: "Недостаточно данных",
        issue_low_gaze_valid_pct: "Мало валидных точек взгляда",
        issue_low_face_ok_pct: "Лицо часто терялось",
        issue_high_offscreen: "Взгляд часто за пределами экрана",
        issue_short_duration: "Слишком короткая сессия",
        issue_low_face_visible: "Лицо плохо видно",
        issue_low_pose_ok_pct: "Нестабильная поза головы",
        issue_low_illumination_ok_pct: "Плохое освещение",
        issue_low_eyes_open_pct: "Глаза часто закрыты",
        issue_high_occlusion_pct: "Лицо часто закрыто",
        issue_low_fps_time: "Низкий FPS камеры",
        
        // QC status messages
        qc_passed_full: "Данные валидны (QC Passed)",
        qc_failed_full: "⚠️ Качество данных ниже нормы",
        qc_duration: "Длительность",
        qc_valid: "Валидных",
        qc_face_ok: "Лицо OK",
        qc_issues: "Проблемы",
        
        // Error keys
        service_unavailable: "Сервис недоступен",
        
        // Tracking test
        test_follow_shape: "Следите глазами за фигурой",
        test_complete: "Тест завершён!"
    },
    en: {
        welcome_title: "Welcome",
        welcome_subtitle: "Attention and Emotion Assessment Platform",
        warning_title: "Important:",
        warning_1: "You will need a webcam",
        warning_2: "Gaze data is processed on your device",
        warning_3: "We do not save video of your face",
        btn_start: "Start Research",
        
        // ✅ Новые переводы для Step 2
        consent_1_title: "1. Purpose of the Study",
        consent_1_text: "We are conducting a scientific study of cognitive and emotional responses. Your participation will help us understand how people perceive visual information and respond to various stimuli.",
        
        consent_2_title: "2. Study Procedure",
        consent_2_text: "You will be asked to complete several tasks in front of a webcam. The system will track your eye movements to analyze attention. Total participation time is approximately 15-20 minutes.",
        
        consent_3_title: "3. Privacy and Data Security",
        consent_3_text: "All data is anonymized and protected. We DO NOT save video recordings of your face. Video stream processing occurs locally in your browser. Only anonymized metrics (gaze coordinates, reaction times) are transmitted to the server. Your email will be stored separately from research data and used only to contact you about results.",
        
        consent_4_title: "4. Voluntary Participation",
        consent_4_text: "Your participation is completely voluntary. You may stop participating at any time without explanation. This will not result in any negative consequences.",
        
        consent_5_title: "5. Risks and Discomfort",
        consent_5_text: "The study does not involve physical or psychological risks. If you feel discomfort, you can stop participating at any time.",
        
        consent_6_title: "6. Contact Information",
        consent_6_text: "If you have questions about the study, you can contact us by email: research@emocog.com",
        
        consent_checkbox_read: "I have read the full consent text and understand the conditions of participation",
        consent_checkbox_agree: "I am 18 years old or older and voluntarily agree to participate in the study",
        
        consent_required: "Both consents must be checked to continue",


        reg_title: "Participant Registration",
        reg_desc: "Please provide your Email",
        email_label: "Email",
        btn_next: "Next",
        form_title: "Participant Survey",
        form_section_user: "About You",
        label_age: "Age",
        label_gender: "Gender",
        opt_select: "Select..",
        opt_m: "Male",
        opt_f: "Female",
        label_lang: "Native Language",
        opt_ru: "Russian",
        opt_en: "English",
        opt_other: "Other",
        label_edu: "Education",
        opt_edu_school: "Secondary",
        opt_edu_student: "Student",
        opt_edu_higher: "Higher",
        opt_edu_degree: "PhD / Degree",
        // === ENGLISH TRANSLATIONS FOR STEP 4 ===
        form_section_tech: "Equipment and conditions",
        
        // Vision (NO medical terms)
        label_vision_condition: "Do you use vision correction during the study?",
        opt_vis_none: "No, I don't",
        opt_vis_glass: "Yes, glasses",
        opt_vis_lens: "Yes, contact lenses",
        
        // Gender (add "Other" option)
        opt_other_gender: "Other",
        
        // Keyboard
        label_keyboard: "Keyboard type",
        opt_kb_int: "Built-in (laptop)",
        opt_kb_ext: "External",
        
        // Additional surveys (for future)
        form_section_additional: "Additional questions",
        
        // Validation
        age_min_error: "Age must be at least 18",
        age_max_error: "Age must be no more than 99",
        age_integer_error: "Age must be an integer",
        age_negative_error: "Age cannot be negative",
        age_zero_error: "Age cannot be zero",

        final_privacy_note: "Your data is anonymized and protected. The researcher will only receive anonymous results.",

        calib_title: "Camera Setup",
        calib_desc: "Before we begin, we need to make sure everything is ready: we'll check the lighting and camera position, then set up the system so it can track your eye movements",
        msg_press_btn: "Preparing calibration..",
        status_label: "Status:",
        points_label: "Points recorded:",
        btn_camera: "Enable Camera",
        final_title: "Session Completed!",
        final_desc: "Thank you for participating. Data generated",
        qc_passed: "Data Valid (QC Passed)",
        btn_download: "Download JSON",
        btn_restart: "Start Over",

        id_participant_label: "Your participant ID:",
        email_consent_storage: "I confirm that the provided email is correct and consent to its storage linked to my participant ID for the purposes of this study.",
        email_consent_contact: "I agree to receive notifications about my session status and study results via the provided email.",
        consent_required: "Both consents must be checked to proceed",
        reg_desc: "To participate in the study, please provide your email. It will be linked to your unique participant ID.",
        
        // pre-check
        label_light: "Lighting",
        label_face: "Face",
        label_pose: "Head Pose",
        label_visibility: "Face Visibility",
        status_waiting: "Waiting..",
        guide_text: "Position your face inside the frame",
        precheck_initial: "Click \"Start Check\" to enable camera",
        precheck_requesting: "Requesting camera access..",
        precheck_checking: "Checking conditions..",
        precheck_camera_error: "Error: ",
        precheck_all_good: "Сheck is passed! You can start calibration",
        btn_start_precheck: "Start Check",
        btn_start_calib: "Start Calibration",
        status_error: "Error",
        // статусы индикаторов (pre-check)
        status_too_dark: "Too Dark",
        status_too_bright: "Too Bright",
        status_optimal: "Optimal",
        status_normal: "Normal",
        status_not_found: "Not Found",
        status_too_small: "Far from the camera",
        status_too_large: "Close to the camera",
        status_out_of_zone: "Out of frame",
        status_tilted: "Head tilted",
        status_stable: "Stable",
        status_unstable: "Unstable",
        status_no_face: "No Face",
        status_all_good: "All good! You can start calibration",
        status_needs_fix: "Needs Correction",
        status_checking: "Under Review",
        status_partial_face: "Partially obscured Face",
        status_off_center: "Off center",
        status_face_occluded: "Face Occluded",
        status_hair_occlusion: "Hair Covers Face",
        status_face_visible: "Face Fully Visible",
        //подсказки
        tip_light_dark: "Too dark, turn on a lamp or move closer to a window",
        tip_light_bright: "Too bright, don't point light directly at the camera or move away from the window",
        tip_face_not_found: "Face not detected, make sure you're in the center of the frame",
        tip_face_too_small: "Move closer to the camera, your face must be fully visible",
        tip_face_too_large: "You're too close, move away from the camera",
        tip_face_out_of_zone: "Position your face in the center of the frame",
        tip_face_tilted: "Keep your head straight, don't tilt it",
        tip_pose_no_face: "Face not detected, position yourself in the center of the frame",
        tip_pose_unstable: "Try to look straight at the camera and don't move",
        tip_pose_partial_face: "Part of your face is not visible. Position yourself so your entire face is in frame",
        tip_pose_eyes_off_center: "Eyes are not centered on screen. Move so you're looking straight at the camera",
        tip_pose_move_right: "Move slightly to the right",
        tip_pose_move_left: "Move slightly to the left",
        tip_pose_move_up: "Raise the camera or lower yourself",
        tip_pose_move_down: "Lower the camera or raise yourself",
        tip_pose_turn_down: "Turn your head slightly to the top",
        tip_pose_turn_up: "Turn your head slightly to the bottom",
        tip_pose_tilt_right: "Move your head to the left",
        tip_pose_tilt_left: "Move your head to the right",
        tip_pose_straighten: "Straighten your head, don't tilt it sideways",
        tip_eyes_closed: "Open your eyes and look at the camera",
        tip_face_occluded: "Remove objects covering your face (hands, hair)",
        tip_hand_on_face: "Remove your hand from your face",
        tip_hair_covers_face: "Move hair away from your face so cheeks and forehead are visible",
        tip_left_side_occluded: "Left side of the face is covered — turn your head or remove the obstruction",
        tip_right_side_occluded: "Right side of the face is covered — turn your head or remove the obstruction",
        tip_left_hand_on_face: "Remove your left hand from your face",
        tip_right_hand_on_face: "Remove your right hand from your face",
        tip_forehead_covered: "Forehead is covered — remove your hand or hair from forehead",
        tip_chin_covered: "Chin is covered — remove your hand from chin",
        tip_eyes_area_covered: "Eyes area is covered — remove the obstruction",
        tip_nose_covered: "Nose is covered — remove your hand from nose",
        tip_mouth_covered: "Mouth is covered — remove your hand from mouth",
        // Dynamic JS strings
        id_participant: "Your Participant ID:",
        id_not_generated: "ID not generated",
        msg_init: "Initializing AI... Allow camera access",
        msg_face_ok: "Face Found (OK)",
        msg_face_err: "Face NOT Found (Move closer)",
        msg_wait_stable: "Waiting for face stabilization..",
        msg_face_locked: "Face locked! Calibration in 2s..",
        msg_no_face: "Cannot see face. Check lighting",
       // Тест слежения
        test_tracking_title: "Tracking Test",
        test_follow_shape: "Follow the shape with your eyes",
        test_progress: "Progress:",
        test_complete: "Test complete!",

        // Test Hub
        test_hub_title: "Test Selection",
        test_hub_subtitle: "Choose a test to run. After completion, you can run another one",
        test_hub_finish: "Finish Session",
        test_hub_ready: "Choose the test you want to run",
        test_hub_running: "Test is running..",
        test_hub_last_result: "Last result",
        test_hub_error: "Test error",
        test_card_rt_title: "RT test (Go/NoGo)",
        test_card_tracking_title: "Tracking test",
        test_card_vpc_title: "VPC (Felidae)",
        test_card_visuospatial_title: "Visuospatial drawing",

        // VPC
        vpc_progress: "Trial",
        vpc_instruction: "Look at the images naturally. No button press is required",
        vpc_phase_fixation: "Fixation",
        vpc_phase_familiar: "Familiar image",
        vpc_phase_isi: "Pause",
        vpc_phase_pair: "Image pair",
        vpc_phase_iti: "Inter-trial interval",

        // Visuospatial
        visuospatial_btn_start: "Start drawing",
        visuospatial_btn_finish: "Finish",
        visuospatial_status_wait_start: "Press \"Start drawing\" to begin",
        visuospatial_status_drawing: "Drawing is active. Follow with your gaze and finish when ready",
        visuospatial_prompt_circle_title: "Task: circle",
        visuospatial_prompt_circle_text: "Draw a smooth circle using your gaze",
        visuospatial_prompt_clock_title: "Task: clock",
        visuospatial_prompt_clock_text: "Draw a clock face and set hands to 11:10",
        visuospatial_prompt_person_title: "Task: person",
        visuospatial_prompt_person_text: "Draw a person: head, body, arms and legs",

        // Email validation errors
        email_required: "Email is required",
        email_emoji_error: "Email cannot contain emoji",
        email_format_error: "Invalid email format",
        email_double_dots: "Email cannot contain double dots",
        email_spaces_error: "Email cannot contain spaces",
        email_cyrillic_error: "Email cannot contain Cyrillic characters",
        
        // Age validation errors
        age_integer_error: "Age must be an integer",
        age_min_error: "Age must be at least 18 years",
        age_max_error: "Age must be no more than 99 years",
        age_negative_error: "Age cannot be negative",
        age_zero_error: "Age must be at least 18 years",
        
        // File download messages
        file_copied: "ID copied!",
        
        // Gaze validation display texts
        validation_complete: "Validation complete!",
        validation_accuracy: "Accuracy",
        validation_precision: "Precision",
        
        // Calibration instructions
        calib_click_instruction: "Click on the red dot while looking at it",
        calib_progress: "Point",
        calib_complete: "Calibration complete!",
        
        // Validation instructions
        validation_look_instruction: "Look at the green dot (don't click)",
        
        // Grammar
        point_of: "of",
        
        // QC issue descriptions
        issue_insufficient_data: "Insufficient data",
        issue_low_gaze_valid_pct: "Low valid gaze percentage",
        issue_low_face_ok_pct: "Face frequently lost",
        issue_high_offscreen: "Gaze often offscreen",
        issue_short_duration: "Session too short",
        issue_low_face_visible: "Face poorly visible",
        issue_low_pose_ok_pct: "Unstable head pose",
        issue_low_illumination_ok_pct: "Poor lighting",
        issue_low_eyes_open_pct: "Eyes often closed",
        issue_high_occlusion_pct: "Face often occluded",
        issue_low_fps_time: "Low camera FPS",
        
        // QC status messages
        qc_passed_full: "Data Valid (QC Passed)",
        qc_failed_full: "⚠️ Data quality below threshold",
        qc_duration: "Duration",
        qc_valid: "Valid",
        qc_face_ok: "Face OK",
        qc_issues: "Issues",
        
        // Error keys
        service_unavailable: "Service unavailable",
        
        // Tracking test
        test_follow_shape: "Follow the shape with your eyes",
        test_complete: "Test complete!"
    }
};