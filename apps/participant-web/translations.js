// СЛОВАРЬ

export const translations = {
    ru: {
        welcome_title: "Добро пожаловать",
        welcome_subtitle: "Платформа оценки внимания и эмоций",
        warning_title: "⚠️ Важно:",
        warning_1: "Вам понадобится веб-камера",
        warning_2: "Данные о взгляде обрабатываются на вашем устройстве",
        warning_3: "Мы не сохраняем видео вашего лица",
        privacy_policy_short: "Видео не записывается и не передается; все расчеты выполняются на вашем устройстве; на сервер отправляются только обезличенные сводки.",
        language_label: "Язык интерфейса",
        invite_link_title: "Ссылка-приглашение",
        invite_link_desc: "Вставьте полную ссылку приглашения или только код, чтобы продолжить как участник.",
        invite_link_placeholder: "Ссылка или код приглашения",
        invite_link_apply: "Применить ссылку",
        btn_start: "Начать исследование",
        consent_header: "Информированное согласие",
        consent_1_title: "1. Цель исследования",
        consent_1_text: "Мы проводим научное исследование когнитивных реакций. Ваше участие поможет нам понять, как люди воспринимают информацию.",
        consent_2_title: "2. Конфиденциальность",
        consent_2_text: "Мы собираем обезличенные данные. Видеопоток обрабатывается локально.",
        consent_link: "Полный текст согласия",
        consent_checkbox: "Я прочитал(а), мне есть 18 лет, и я согласен(а).",
        btn_confirm: "Подтвердить и продолжить",
        reg_title: "Регистрация участника",
        reg_desc: "Пожалуйста, укажите ваш Email.",
        email_label: "Email",
        btn_next: "Далее",
        form_title: "Анкета участника",
        form_section_user: "👤 О вас",
        label_age: "Возраст",
        label_gender: "Пол",
        opt_select: "Выбрать...",
        opt_m: "Мужской",
        opt_f: "Женский",
        label_lang: "Родной язык",
        opt_ru: "русский",
        opt_en: "English",
        opt_other: "Другой",
        label_edu: "Образование",
        opt_edu_school: "Среднее",
        opt_edu_student: "Студент",
        opt_edu_higher: "Высшее",
        opt_edu_degree: "Ученая степень",
        form_section_tech: "👁️ Зрение & Оборудование",
        label_vision: "Зрение",
        opt_vis_norm: "Норма",
        opt_vis_glass: "Очки",
        opt_vis_lens: "Линзы",
        label_pathology: "Патологии",
        opt_path_none: "Нет",
        opt_path_hemi: "Гемианопсия",
        opt_path_scot: "Скотома",
        opt_path_color: "Дальтонизм",
        label_hand: "Ведущая рука",
        opt_hand_r: "Правая",
        opt_hand_l: "Левая",
        label_device: "Устройство ввода",
        opt_dev_mouse: "Мышь",
        opt_dev_touch: "Тачпад",
        label_keyboard: "Клавиатура",
        opt_kb_int: "Встроенная",
        opt_kb_ext: "Внешняя",
        calib_title: "Настройка камеры",
        calib_desc: "Сначала проверим условия для участия в исследовании, затем начнём калибровку.",
        msg_press_btn: "Подготовка калибровки...",
        status_label: "Статус:",
        points_label: "Записано точек:",
        btn_camera: "Включить камеру",
        final_title: "Сессия завершена!",
        final_desc: "Спасибо за участие. Данные сформированы.",
        qc_passed: "✅ Данные прошли проверку качества",
        label_secure_sender: "Включить дополнительную защищенную отправку (security2 sender)",
        btn_download: "📥 Скачать JSON",
        btn_restart: "Начать заново",
        // pre-check
        label_light: "Освещение",
        label_face: "Лицо",
        label_pose: "Поза головы",
        label_visibility: "Видимость лица",
        status_waiting: "Ожидание...",
        guide_text: "Расположите лицо в кадре. Веб-камеру — примерно на уровне глаз; смотрите прямо в объектив.",
        precheck_criteria_help: "Зелёный индикатор означает, что условие выполнено. Длина полосы не является оценкой результата. Если индикатор жёлтый или красный, следуйте подсказкам.",
        precheck_initial: "Нажмите \"Начать проверку\" чтобы включить камеру",
        precheck_requesting: "⏳ Запрашиваем доступ к камере...",
        precheck_checking: "⏳ Проверяем условия...",
        precheck_camera_error: "❌ Ошибка: ",
        precheck_all_good: "✅ Проверка пройдена! Можно начинать калибровку",
        btn_start_precheck: "🎥 Начать проверку",
        btn_start_calib: "✅ Начать калибровку",
        status_error: "❌ Ошибка",
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
        status_all_good: "🎉  Проверка пройдена! Можно начинать калибровку",
        precheck_must_pass: "Сначала успешно пройдите проверку камеры (pre-check).",
        status_needs_fix: "🔴 Требуется исправить",
        status_checking: "⏳ Проверяем условия",
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
        tip_precheck_camera_eye_level: "Камеру разместите на уровне глаз (верх монитора поднимите или опустите ноутбук), смотрите в объектив — так стабильнее предчек и калибровка.",
        tip_pose_move_right: "Сместитесь немного вправо",
        tip_pose_move_left: "Сместитесь немного влево", 
        tip_pose_move_up: "Поднимите камеру или опуститесь ниже",
        tip_pose_move_down: "Опустите камеру или поднимитесь выше",
        tip_pose_turn_down: "Наклоните голову немного вниз",
        tip_pose_turn_up: "Наклоните голову немного вверх",
        tip_pose_tilt_right: "поверните голову влево",
        tip_pose_tilt_left: "поверните голову вправо",
        tip_pose_turn_left: "Поверните голову немного влево",
        tip_pose_turn_right: "Поверните голову немного вправо",
        tip_pose_raise_head: "Немного поднимите голову",
        tip_pose_lower_head: "Немного опустите голову",
        tip_pose_straighten: "Выровняйте голову, не наклоняйте её вбок",
        tip_eyes_closed: "Откройте глаза и смотрите в камеру",
        tip_face_occluded: "Уберите предметы, закрывающие лицо (руки, волосы, аксессуары)",
        tip_hand_on_face: "Уберите всё, что закрывает лицо (руки, волосы, аксессуары)",
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
        msg_init: "Инициализация нейросети... Разрешите доступ к камере.",
        msg_face_ok: "Лицо найдено (OK)",
        msg_face_err: "Лицо НЕ найдено (Подвиньтесь)",
        msg_wait_stable: "Ждем стабилизации лица...",
        msg_face_locked: "Лицо захвачено! Калибровка через 2 сек...",
        msg_no_face: "Не вижу лица. Проверьте освещение.",
        // Тест слежения
        test_tracking_title: "Тест слежения",
        test_follow_shape: "Следите глазами за фигурой",
        test_progress: "Прогресс:",
        test_complete: "Тест завершён!",

        // Test Hub
        test_hub_title: "Выбор теста",
        test_hub_subtitle: "Выберите тест для запуска. После завершения можно запустить следующий.",
        test_hub_finish: "Завершить сессию",
        test_hub_ready: "Выберите тест, который хотите пройти.",
        test_hub_running: "Тест выполняется...",
        test_hub_last_result: "Последний результат",
        test_hub_error: "Ошибка теста",
        test_card_rt_title: "RT test (Go/NoGo)",
        test_card_tracking_title: "Tracking test",
        test_card_bpm_title: "BPM test (rPPG)",
        test_card_vpc_title: "VPC (Felidae)",
        test_card_visuospatial_title: "Visuospatial drawing",
        hub_emotion_label: "Эмоция (оценка)",
        hub_emotion_no_camera: "Камера недоступна — эмоцию здесь не показываем.",
        emotion_neutral: "нейтральная",
        emotion_happiness: "радость",
        emotion_sadness: "грусть",
        emotion_anger: "злость / напряжение",
        emotion_fear: "страх / тревога",
        emotion_surprise: "удивление",
        emotion_disgust: "отвращение",

        // VPC
        vpc_progress: "Проба",
        vpc_instruction: "Смотрите на изображения естественно. Нажимать ничего не нужно.",
        vpc_phase_fixation: "Фиксация",
        vpc_phase_familiar: "Знакомое изображение",
        vpc_phase_isi: "Пауза",
        vpc_phase_pair: "Пара изображений",
        vpc_phase_iti: "Интервал между пробами",

        // Visuospatial
        visuospatial_btn_start: "Начать рисование",
        visuospatial_btn_finish: "Завершить",
        visuospatial_status_wait_start: "Нажмите «Начать рисование», чтобы начать.",
        visuospatial_status_drawing: "Рисование активно. Следите взглядом и завершите, когда будете готовы.",
        visuospatial_hint_hold_space: "Удерживайте ПРОБЕЛ, чтобы рисовать. Отпустите — пауза. Завершить — кнопка в правом верхнем углу.",
        visuospatial_status_pen_down: "Рисование (Пробел зажат)",
        visuospatial_status_pen_up: "Пауза (Пробел отпущен)",
        visuospatial_prompt_circle_title: "Задание: круг",
        visuospatial_prompt_circle_text: "Нарисуйте взглядом ровный круг.",
        visuospatial_prompt_clock_title: "Задание: часы",
        visuospatial_prompt_clock_text: "Нарисуйте циферблат часов и стрелки на 11:10.",
        visuospatial_prompt_person_title: "Задание: человечек",
        visuospatial_prompt_person_text: "Нарисуйте фигуру человека: голову, туловище, руки и ноги.",

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
        validation_complete: "✅ Валидация завершена!",
        validation_accuracy: "Точность",
        validation_precision: "Стабильность",
        
        // Calibration instructions
        calib_click_instruction: "👆 Кликайте на красную точку, смотря на неё",
        calib_progress: "Точка",
        calib_complete: "✅ Калибровка завершена!",
        
        // Validation instructions
        validation_look_instruction: "👁️ Смотрите на зелёную точку (не кликайте)",
        
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
        qc_passed_full: "✅ Данные прошли проверку качества",
        qc_failed_full: "⚠️ Качество данных ниже нормы",
        qc_duration: "Длительность",
        qc_valid: "Валидных",
        qc_face_ok: "Лицо обнаружено",
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
        warning_title: "⚠️ Important:",
        warning_1: "You will need a webcam",
        warning_2: "Gaze data is processed on your device",
        warning_3: "We do not save video of your face",
        privacy_policy_short: "Video is not recorded or transmitted; processing happens on your device; only anonymized summaries are sent to the server.",
        language_label: "Interface language",
        invite_link_title: "Invitation link",
        invite_link_desc: "Paste the full invitation link or its code to continue as a participant.",
        invite_link_placeholder: "Invitation link or code",
        invite_link_apply: "Apply link",
        btn_start: "Start Research",
        consent_header: "Informed Consent",
        consent_1_title: "1. Research Goal",
        consent_1_text: "We are conducting scientific research on cognitive reactions. Your participation helps us understand perception.",
        consent_2_title: "2. Privacy",
        consent_2_text: "We collect anonymized data. Video stream is processed locally.",
        consent_link: "Full Consent Text",
        consent_checkbox: "I have read, I am 18+, and I agree.",
        btn_confirm: "Confirm and Continue",
        reg_title: "Participant Registration",
        reg_desc: "Please provide your Email.",
        email_label: "Email",
        btn_next: "Next",
        form_title: "Participant Survey",
        form_section_user: "👤 About You",
        label_age: "Age",
        label_gender: "Gender",
        opt_select: "Select...",
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
        form_section_tech: "👁️ Vision & Hardware",
        label_vision: "Vision",
        opt_vis_norm: "Normal",
        opt_vis_glass: "Glasses",
        opt_vis_lens: "Contact Lenses",
        label_pathology: "Pathologies",
        opt_path_none: "None",
        opt_path_hemi: "Hemianopsia",
        opt_path_scot: "Scotoma",
        opt_path_color: "Color Blindness",
        label_hand: "Dominant Hand",
        opt_hand_r: "Right",
        opt_hand_l: "Left",
        label_device: "Input Device",
        opt_dev_mouse: "Mouse",
        opt_dev_touch: "Touchpad",
        label_keyboard: "Keyboard",
        opt_kb_int: "Internal",
        opt_kb_ext: "External",
        calib_title: "Camera Setup",
        calib_desc: "First we'll check conditions for participation, then start calibration.",
        msg_press_btn: "Preparing calibration...",
        status_label: "Status:",
        points_label: "Points recorded:",
        btn_camera: "Enable Camera",
        final_title: "Session Completed!",
        final_desc: "Thank you for participating. Data generated.",
        qc_passed: "✅ Data Valid (QC Passed)",
        label_secure_sender: "Enable additional secure upload (security2 sender)",
        btn_download: "📥 Download JSON",
        btn_restart: "Start Over",
        // pre-check
        label_light: "Lighting",
        label_face: "Face",
        label_pose: "Head Pose",
        label_visibility: "Face Visibility",
        status_waiting: "Waiting...",
        guide_text: "Keep your face in frame. Place the webcam near eye level and look straight into the lens.",
        precheck_criteria_help: "A green indicator means the requirement is met. Bar length is not a score. If an indicator is yellow or red, follow the guidance below.",
        precheck_initial: "Click \"Start Check\" to enable camera",
        precheck_requesting: "⏳ Requesting camera access...",
        precheck_checking: "⏳ Checking conditions...",
        precheck_camera_error: "❌ Error: ",
        precheck_all_good: "✅ Check passed. You can start calibration",
        btn_start_precheck: "🎥 Start Check",
        btn_start_calib: "✅ Start Calibration",
        status_error: "❌ Error",
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
        status_all_good: "🎉 All good! You can start calibration",
        precheck_must_pass: "Complete the camera pre-check successfully first.",
        status_needs_fix: "🔴 Needs Correction",
        status_checking: "⏳ Under Review",
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
        tip_precheck_camera_eye_level: "Put the webcam near eye level (raise/lower the screen or laptop) and look at the lens — pre-check and calibration work better.",
        tip_pose_move_right: "Move slightly to the right",
        tip_pose_move_left: "Move slightly to the left",
        tip_pose_move_up: "Raise the camera or lower yourself",
        tip_pose_move_down: "Lower the camera or raise yourself",
        tip_pose_turn_down: "Turn your head slightly to the top",
        tip_pose_turn_up: "Turn your head slightly to the bottom",
        tip_pose_tilt_right: "Move your head to the left",
        tip_pose_tilt_left: "Move your head to the right",
        tip_pose_turn_left: "Turn your head slightly to the left",
        tip_pose_turn_right: "Turn your head slightly to the right",
        tip_pose_raise_head: "Raise your head slightly",
        tip_pose_lower_head: "Lower your head slightly",
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
        msg_init: "Initializing AI... Allow camera access.",
        msg_face_ok: "Face Found (OK)",
        msg_face_err: "Face NOT Found (Move closer)",
        msg_wait_stable: "Waiting for face stabilization...",
        msg_face_locked: "Face locked! Calibration in 2s...",
        msg_no_face: "Cannot see face. Check lighting.",
       // Тест слежения
        test_tracking_title: "Tracking Test",
        test_follow_shape: "Follow the shape with your eyes",
        test_progress: "Progress:",
        test_complete: "Test complete!",

        // Test Hub
        test_hub_title: "Test Selection",
        test_hub_subtitle: "Choose a test to run. After completion, you can run another one.",
        test_hub_finish: "Finish Session",
        test_hub_ready: "Choose the test you want to run.",
        test_hub_running: "Test is running...",
        test_hub_last_result: "Last result",
        test_hub_error: "Test error",
        test_card_rt_title: "RT test (Go/NoGo)",
        test_card_tracking_title: "Tracking test",
        test_card_bpm_title: "BPM test (rPPG)",
        test_card_vpc_title: "VPC (Felidae)",
        test_card_visuospatial_title: "Visuospatial drawing",
        hub_emotion_label: "Emotion (estimate)",
        hub_emotion_no_camera: "Camera unavailable — no live emotion readout.",
        emotion_neutral: "neutral",
        emotion_happiness: "happiness",
        emotion_sadness: "sadness",
        emotion_anger: "anger / tension",
        emotion_fear: "fear / anxiety",
        emotion_surprise: "surprise",
        emotion_disgust: "disgust",

        // VPC
        vpc_progress: "Trial",
        vpc_instruction: "Look at the images naturally. No button press is required.",
        vpc_phase_fixation: "Fixation",
        vpc_phase_familiar: "Familiar image",
        vpc_phase_isi: "Pause",
        vpc_phase_pair: "Image pair",
        vpc_phase_iti: "Inter-trial interval",

        // Visuospatial
        visuospatial_btn_start: "Start drawing",
        visuospatial_btn_finish: "Finish",
        visuospatial_status_wait_start: "Press \"Start drawing\" to begin.",
        visuospatial_status_drawing: "Drawing is active. Follow with your gaze and finish when ready.",
        visuospatial_hint_hold_space: "Hold SPACE to draw. Release to pause. End the test — button in the top-right corner.",
        visuospatial_status_pen_down: "Drawing (Space held)",
        visuospatial_status_pen_up: "Paused (Space released)",
        visuospatial_prompt_circle_title: "Task: circle",
        visuospatial_prompt_circle_text: "Draw a smooth circle using your gaze.",
        visuospatial_prompt_clock_title: "Task: clock",
        visuospatial_prompt_clock_text: "Draw a clock face and set hands to 11:10.",
        visuospatial_prompt_person_title: "Task: person",
        visuospatial_prompt_person_text: "Draw a person: head, body, arms and legs.",

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
        validation_complete: "✅ Validation complete!",
        validation_accuracy: "Accuracy",
        validation_precision: "Precision",
        
        // Calibration instructions
        calib_click_instruction: "👆 Click on the red dot while looking at it",
        calib_progress: "Point",
        calib_complete: "✅ Calibration complete!",
        
        // Validation instructions
        validation_look_instruction: "👁️ Look at the green dot (don't click)",
        
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
        qc_passed_full: "✅ Data Valid (QC Passed)",
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

// The eight additional participant locales cover the complete consent/onboarding
// surface. Technical QC details intentionally fall back to the English contract
// terminology so error codes remain consistent across research teams.
const participantLocaleOverrides = {
    zh: {
        welcome_title: '欢迎', welcome_subtitle: '注意力与情绪评估平台', warning_title: '重要提示',
        language_label: '界面语言', invite_link_title: '邀请链接', invite_link_desc: '粘贴完整邀请链接或仅输入代码，以参与者身份继续。', invite_link_placeholder: '邀请链接或代码', invite_link_apply: '应用链接',
        warning_1: '您需要使用网络摄像头', warning_2: '视线数据仅在您的设备上处理', warning_3: '我们不会保存您的面部视频',
        privacy_policy_short: '视频不会被录制或传输；所有处理均在您的设备上完成；服务器仅接收匿名汇总数据。',
        btn_start: '开始研究', consent_header: '知情同意', consent_1_title: '1. 研究目的',
        consent_1_text: '我们正在研究认知反应。您的参与将帮助我们了解人们如何感知信息。',
        consent_2_title: '2. 隐私保护', consent_2_text: '我们只收集匿名数据。视频流在本地处理。',
        consent_link: '查看完整同意书', consent_checkbox: '我已阅读上述内容，年满18岁，并同意参加。',
        btn_confirm: '确认并继续', reg_title: '参与者信息', reg_desc: '如需联系，请填写电子邮箱（可选）。',
        email_label: '电子邮箱', btn_next: '下一步', form_title: '参与者问卷', form_section_user: '关于您',
        label_age: '年龄', label_gender: '性别', opt_select: '请选择', opt_m: '男', opt_f: '女',
        label_lang: '母语', label_edu: '教育程度', form_section_tech: '视力与设备',
        calib_title: '摄像头设置', calib_desc: '我们将先检查环境条件，然后进行校准。', btn_camera: '打开摄像头',
        final_title: '会话已完成', final_desc: '感谢您的参与。数据已生成。', btn_download: '下载 JSON', btn_restart: '重新开始'
    },
    es: {
        welcome_title: 'Bienvenido/a', welcome_subtitle: 'Plataforma de evaluación de atención y emociones', warning_title: 'Importante',
        language_label: 'Idioma de la interfaz', invite_link_title: 'Enlace de invitación', invite_link_desc: 'Pegue el enlace completo o el código de invitación para continuar como participante.', invite_link_placeholder: 'Enlace o código de invitación', invite_link_apply: 'Aplicar enlace',
        warning_1: 'Necesitará una cámara web', warning_2: 'Los datos de mirada se procesan en su dispositivo', warning_3: 'No guardamos el vídeo de su rostro',
        privacy_policy_short: 'El vídeo no se graba ni se transmite; todo se procesa en su dispositivo y solo se envían resúmenes anónimos.',
        btn_start: 'Comenzar el estudio', consent_header: 'Consentimiento informado', consent_1_title: '1. Objetivo del estudio',
        consent_1_text: 'Estudiamos las respuestas cognitivas. Su participación nos ayuda a entender cómo se percibe la información.',
        consent_2_title: '2. Privacidad', consent_2_text: 'Recogemos datos anónimos. El vídeo se procesa localmente.',
        consent_link: 'Texto completo del consentimiento', consent_checkbox: 'He leído la información, tengo al menos 18 años y acepto participar.',
        btn_confirm: 'Confirmar y continuar', reg_title: 'Datos del participante', reg_desc: 'Indique su correo para contacto (opcional).',
        email_label: 'Correo electrónico', btn_next: 'Siguiente', form_title: 'Cuestionario', form_section_user: 'Sobre usted',
        label_age: 'Edad', label_gender: 'Género', opt_select: 'Seleccionar', opt_m: 'Masculino', opt_f: 'Femenino',
        label_lang: 'Idioma nativo', label_edu: 'Educación', form_section_tech: 'Visión y equipo',
        calib_title: 'Configuración de cámara', calib_desc: 'Primero comprobaremos las condiciones y después iniciaremos la calibración.', btn_camera: 'Activar cámara',
        final_title: 'Sesión completada', final_desc: 'Gracias por participar. Los datos están listos.', btn_download: 'Descargar JSON', btn_restart: 'Empezar de nuevo'
    },
    hi: {
        welcome_title: 'स्वागत है', welcome_subtitle: 'ध्यान और भावनाओं के आकलन का मंच', warning_title: 'महत्वपूर्ण',
        language_label: 'इंटरफ़ेस भाषा', invite_link_title: 'आमंत्रण लिंक', invite_link_desc: 'प्रतिभागी के रूप में आगे बढ़ने के लिए पूरा आमंत्रण लिंक या उसका कोड पेस्ट करें।', invite_link_placeholder: 'आमंत्रण लिंक या कोड', invite_link_apply: 'लिंक लागू करें',
        warning_1: 'आपको वेबकैम की आवश्यकता होगी', warning_2: 'नज़र का डेटा आपके डिवाइस पर संसाधित होता है', warning_3: 'हम आपके चेहरे का वीडियो सहेजते नहीं हैं',
        privacy_policy_short: 'वीडियो रिकॉर्ड या भेजा नहीं जाता; सारी प्रक्रिया आपके डिवाइस पर होती है और केवल अनाम सारांश भेजे जाते हैं।',
        btn_start: 'अध्ययन शुरू करें', consent_header: 'सूचित सहमति', consent_1_title: '1. अध्ययन का उद्देश्य',
        consent_1_text: 'हम संज्ञानात्मक प्रतिक्रियाओं का अध्ययन कर रहे हैं। आपकी भागीदारी हमें जानकारी की धारणा समझने में मदद करेगी।',
        consent_2_title: '2. गोपनीयता', consent_2_text: 'हम अनाम डेटा एकत्र करते हैं। वीडियो स्थानीय रूप से संसाधित होता है।',
        consent_link: 'पूरी सहमति पढ़ें', consent_checkbox: 'मैंने जानकारी पढ़ी है, मेरी आयु 18 वर्ष या अधिक है और मैं सहमत हूँ।',
        btn_confirm: 'पुष्टि करें और आगे बढ़ें', reg_title: 'प्रतिभागी की जानकारी', reg_desc: 'संपर्क के लिए ईमेल दें (वैकल्पिक)।',
        email_label: 'ईमेल', btn_next: 'आगे', form_title: 'प्रतिभागी प्रश्नावली', form_section_user: 'आपके बारे में',
        label_age: 'आयु', label_gender: 'लिंग', opt_select: 'चुनें', opt_m: 'पुरुष', opt_f: 'महिला',
        label_lang: 'मातृभाषा', label_edu: 'शिक्षा', form_section_tech: 'दृष्टि और उपकरण',
        calib_title: 'कैमरा सेटअप', calib_desc: 'पहले हम परिस्थितियाँ जाँचेंगे, फिर कैलिब्रेशन शुरू करेंगे।', btn_camera: 'कैमरा चालू करें',
        final_title: 'सत्र पूरा हुआ', final_desc: 'भाग लेने के लिए धन्यवाद। डेटा तैयार है।', btn_download: 'JSON डाउनलोड करें', btn_restart: 'फिर से शुरू करें'
    },
    ar: {
        welcome_title: 'مرحبًا', welcome_subtitle: 'منصة لتقييم الانتباه والمشاعر', warning_title: 'مهم',
        language_label: 'لغة الواجهة', invite_link_title: 'رابط الدعوة', invite_link_desc: 'الصق رابط الدعوة الكامل أو الرمز للمتابعة كمشارك.', invite_link_placeholder: 'رابط الدعوة أو الرمز', invite_link_apply: 'استخدام الرابط',
        warning_1: 'ستحتاج إلى كاميرا ويب', warning_2: 'تتم معالجة بيانات النظر على جهازك', warning_3: 'لا نحفظ فيديو وجهك',
        privacy_policy_short: 'لا يتم تسجيل الفيديو أو إرساله؛ تتم المعالجة على جهازك ولا تُرسل إلا ملخصات مجهولة الهوية.',
        btn_start: 'بدء الدراسة', consent_header: 'الموافقة المستنيرة', consent_1_title: '1. هدف الدراسة',
        consent_1_text: 'ندرس الاستجابات المعرفية. تساعدنا مشاركتك على فهم كيفية إدراك المعلومات.',
        consent_2_title: '2. الخصوصية', consent_2_text: 'نجمع بيانات مجهولة الهوية ويُعالج الفيديو محليًا.',
        consent_link: 'قراءة نص الموافقة الكامل', consent_checkbox: 'قرأت المعلومات، وعمري 18 عامًا أو أكثر، وأوافق على المشاركة.',
        btn_confirm: 'تأكيد ومتابعة', reg_title: 'بيانات المشارك', reg_desc: 'أدخل بريدك الإلكتروني للتواصل (اختياري).',
        email_label: 'البريد الإلكتروني', btn_next: 'التالي', form_title: 'استبيان المشارك', form_section_user: 'معلومات عنك',
        label_age: 'العمر', label_gender: 'الجنس', opt_select: 'اختر', opt_m: 'ذكر', opt_f: 'أنثى',
        label_lang: 'اللغة الأم', label_edu: 'التعليم', form_section_tech: 'البصر والمعدات',
        calib_title: 'إعداد الكاميرا', calib_desc: 'سنفحص الظروف أولًا ثم نبدأ المعايرة.', btn_camera: 'تشغيل الكاميرا',
        final_title: 'اكتملت الجلسة', final_desc: 'شكرًا لمشاركتك. البيانات جاهزة.', btn_download: 'تنزيل JSON', btn_restart: 'البدء من جديد'
    },
    fr: {
        welcome_title: 'Bienvenue', welcome_subtitle: 'Plateforme d’évaluation de l’attention et des émotions', warning_title: 'Important',
        language_label: 'Langue de l’interface', invite_link_title: 'Lien d’invitation', invite_link_desc: 'Collez le lien complet ou le code d’invitation pour continuer en tant que participant.', invite_link_placeholder: 'Lien ou code d’invitation', invite_link_apply: 'Appliquer le lien',
        warning_1: 'Vous aurez besoin d’une webcam', warning_2: 'Les données du regard sont traitées sur votre appareil', warning_3: 'Nous ne conservons pas la vidéo de votre visage',
        privacy_policy_short: 'La vidéo n’est ni enregistrée ni transmise ; tout est traité sur votre appareil et seuls des résumés anonymes sont envoyés.',
        btn_start: 'Commencer l’étude', consent_header: 'Consentement éclairé', consent_1_title: '1. Objectif de l’étude',
        consent_1_text: 'Nous étudions les réponses cognitives. Votre participation nous aide à comprendre la perception de l’information.',
        consent_2_title: '2. Confidentialité', consent_2_text: 'Nous recueillons des données anonymes. La vidéo est traitée localement.',
        consent_link: 'Lire le consentement complet', consent_checkbox: 'J’ai lu ces informations, j’ai au moins 18 ans et j’accepte de participer.',
        btn_confirm: 'Confirmer et continuer', reg_title: 'Informations du participant', reg_desc: 'Indiquez votre e-mail pour être contacté(e) (facultatif).',
        email_label: 'E-mail', btn_next: 'Suivant', form_title: 'Questionnaire', form_section_user: 'À propos de vous',
        label_age: 'Âge', label_gender: 'Genre', opt_select: 'Sélectionner', opt_m: 'Masculin', opt_f: 'Féminin',
        label_lang: 'Langue maternelle', label_edu: 'Études', form_section_tech: 'Vision et équipement',
        calib_title: 'Réglage de la caméra', calib_desc: 'Nous vérifierons d’abord les conditions, puis lancerons l’étalonnage.', btn_camera: 'Activer la caméra',
        final_title: 'Session terminée', final_desc: 'Merci pour votre participation. Les données sont prêtes.', btn_download: 'Télécharger le JSON', btn_restart: 'Recommencer'
    },
    bn: {
        welcome_title: 'স্বাগতম', welcome_subtitle: 'মনোযোগ ও আবেগ মূল্যায়নের প্ল্যাটফর্ম', warning_title: 'গুরুত্বপূর্ণ',
        language_label: 'ইন্টারফেসের ভাষা', invite_link_title: 'আমন্ত্রণ লিংক', invite_link_desc: 'অংশগ্রহণকারী হিসেবে এগোতে সম্পূর্ণ আমন্ত্রণ লিংক বা কোড পেস্ট করুন।', invite_link_placeholder: 'আমন্ত্রণ লিংক বা কোড', invite_link_apply: 'লিংক প্রয়োগ করুন',
        warning_1: 'আপনার একটি ওয়েবক্যাম প্রয়োজন হবে', warning_2: 'দৃষ্টির তথ্য আপনার ডিভাইসেই প্রক্রিয়াকৃত হয়', warning_3: 'আমরা আপনার মুখের ভিডিও সংরক্ষণ করি না',
        privacy_policy_short: 'ভিডিও রেকর্ড বা পাঠানো হয় না; সব প্রক্রিয়া আপনার ডিভাইসে হয় এবং শুধু পরিচয়বিহীন সারাংশ পাঠানো হয়।',
        btn_start: 'গবেষণা শুরু করুন', consent_header: 'অবহিত সম্মতি', consent_1_title: '১. গবেষণার উদ্দেশ্য',
        consent_1_text: 'আমরা জ্ঞানীয় প্রতিক্রিয়া নিয়ে গবেষণা করছি। আপনার অংশগ্রহণ তথ্য উপলব্ধি বুঝতে সাহায্য করবে।',
        consent_2_title: '২. গোপনীয়তা', consent_2_text: 'আমরা পরিচয়বিহীন তথ্য সংগ্রহ করি। ভিডিও স্থানীয়ভাবে প্রক্রিয়াকৃত হয়।',
        consent_link: 'সম্পূর্ণ সম্মতিপত্র পড়ুন', consent_checkbox: 'আমি তথ্য পড়েছি, আমার বয়স ১৮ বা তার বেশি এবং আমি অংশগ্রহণে সম্মত।',
        btn_confirm: 'নিশ্চিত করে এগিয়ে যান', reg_title: 'অংশগ্রহণকারীর তথ্য', reg_desc: 'যোগাযোগের জন্য ইমেইল দিন (ঐচ্ছিক)।',
        email_label: 'ইমেইল', btn_next: 'পরবর্তী', form_title: 'অংশগ্রহণকারী প্রশ্নাবলি', form_section_user: 'আপনার সম্পর্কে',
        label_age: 'বয়স', label_gender: 'লিঙ্গ', opt_select: 'নির্বাচন করুন', opt_m: 'পুরুষ', opt_f: 'নারী',
        label_lang: 'মাতৃভাষা', label_edu: 'শিক্ষা', form_section_tech: 'দৃষ্টি ও সরঞ্জাম',
        calib_title: 'ক্যামেরা সেটআপ', calib_desc: 'প্রথমে পরিবেশ যাচাই হবে, তারপর ক্যালিব্রেশন শুরু হবে।', btn_camera: 'ক্যামেরা চালু করুন',
        final_title: 'সেশন সম্পন্ন', final_desc: 'অংশগ্রহণের জন্য ধন্যবাদ। তথ্য প্রস্তুত।', btn_download: 'JSON ডাউনলোড করুন', btn_restart: 'আবার শুরু করুন'
    },
    pt: {
        welcome_title: 'Boas-vindas', welcome_subtitle: 'Plataforma de avaliação de atenção e emoções', warning_title: 'Importante',
        language_label: 'Idioma da interface', invite_link_title: 'Link de convite', invite_link_desc: 'Cole o link completo ou o código do convite para continuar como participante.', invite_link_placeholder: 'Link ou código do convite', invite_link_apply: 'Aplicar link',
        warning_1: 'Você precisará de uma webcam', warning_2: 'Os dados do olhar são processados no seu dispositivo', warning_3: 'Não salvamos o vídeo do seu rosto',
        privacy_policy_short: 'O vídeo não é gravado nem transmitido; todo o processamento ocorre no seu dispositivo e apenas resumos anônimos são enviados.',
        btn_start: 'Iniciar o estudo', consent_header: 'Consentimento informado', consent_1_title: '1. Objetivo do estudo',
        consent_1_text: 'Estudamos respostas cognitivas. Sua participação ajuda a entender como as pessoas percebem informações.',
        consent_2_title: '2. Privacidade', consent_2_text: 'Coletamos dados anônimos. O vídeo é processado localmente.',
        consent_link: 'Ler o consentimento completo', consent_checkbox: 'Li as informações, tenho 18 anos ou mais e concordo em participar.',
        btn_confirm: 'Confirmar e continuar', reg_title: 'Dados do participante', reg_desc: 'Informe seu e-mail para contato (opcional).',
        email_label: 'E-mail', btn_next: 'Próximo', form_title: 'Questionário', form_section_user: 'Sobre você',
        label_age: 'Idade', label_gender: 'Gênero', opt_select: 'Selecionar', opt_m: 'Masculino', opt_f: 'Feminino',
        label_lang: 'Idioma nativo', label_edu: 'Escolaridade', form_section_tech: 'Visão e equipamento',
        calib_title: 'Configuração da câmera', calib_desc: 'Primeiro verificaremos as condições e depois iniciaremos a calibração.', btn_camera: 'Ativar câmera',
        final_title: 'Sessão concluída', final_desc: 'Agradecemos sua participação. Os dados estão prontos.', btn_download: 'Baixar JSON', btn_restart: 'Começar novamente'
    },
    ur: {
        welcome_title: 'خوش آمدید', welcome_subtitle: 'توجہ اور جذبات کی جانچ کا پلیٹ فارم', warning_title: 'اہم',
        language_label: 'انٹرفیس کی زبان', invite_link_title: 'دعوتی لنک', invite_link_desc: 'شرکت کنندہ کے طور پر آگے بڑھنے کے لیے مکمل دعوتی لنک یا کوڈ پیسٹ کریں۔', invite_link_placeholder: 'دعوتی لنک یا کوڈ', invite_link_apply: 'لنک استعمال کریں',
        warning_1: 'آپ کو ویب کیم درکار ہوگا', warning_2: 'نگاہ کا ڈیٹا آپ کے آلے پر پراسیس ہوتا ہے', warning_3: 'ہم آپ کے چہرے کی ویڈیو محفوظ نہیں کرتے',
        privacy_policy_short: 'ویڈیو ریکارڈ یا منتقل نہیں ہوتی؛ تمام پراسیسنگ آپ کے آلے پر ہوتی ہے اور صرف گمنام خلاصے بھیجے جاتے ہیں۔',
        btn_start: 'مطالعہ شروع کریں', consent_header: 'باخبر رضامندی', consent_1_title: '1. مطالعے کا مقصد',
        consent_1_text: 'ہم ادراکی ردعمل کا مطالعہ کر رہے ہیں۔ آپ کی شرکت معلومات کے ادراک کو سمجھنے میں مدد دے گی۔',
        consent_2_title: '2. رازداری', consent_2_text: 'ہم گمنام ڈیٹا جمع کرتے ہیں۔ ویڈیو مقامی طور پر پراسیس ہوتی ہے۔',
        consent_link: 'مکمل رضامندی پڑھیں', consent_checkbox: 'میں نے معلومات پڑھ لی ہیں، میری عمر 18 سال یا زیادہ ہے اور میں شرکت سے متفق ہوں۔',
        btn_confirm: 'تصدیق کریں اور آگے بڑھیں', reg_title: 'شرکت کنندہ کی معلومات', reg_desc: 'رابطے کے لیے ای میل درج کریں (اختیاری)۔',
        email_label: 'ای میل', btn_next: 'اگلا', form_title: 'سوالنامہ', form_section_user: 'آپ کے بارے میں',
        label_age: 'عمر', label_gender: 'جنس', opt_select: 'منتخب کریں', opt_m: 'مرد', opt_f: 'عورت',
        label_lang: 'مادری زبان', label_edu: 'تعلیم', form_section_tech: 'نظر اور آلات',
        calib_title: 'کیمرہ سیٹ اپ', calib_desc: 'پہلے حالات کی جانچ ہوگی، پھر کیلیبریشن شروع ہوگی۔', btn_camera: 'کیمرہ چلائیں',
        final_title: 'سیشن مکمل', final_desc: 'شرکت کا شکریہ۔ ڈیٹا تیار ہے۔', btn_download: 'JSON ڈاؤن لوڈ کریں', btn_restart: 'دوبارہ شروع کریں'
    }
};

Object.entries(participantLocaleOverrides).forEach(([locale, overrides]) => {
    translations[locale] = { ...translations.en, ...overrides };
});

const participantPrecheckLocaleOverrides = {
    zh: {
        label_light: '光线', label_face: '面部', label_pose: '头部姿态', label_visibility: '面部可见度',
        status_waiting: '等待中...', guide_text: '请将面部保持在画面内。摄像头应接近眼睛高度，并直视镜头。',
        precheck_criteria_help: '绿色表示条件已满足。进度条长度不是评分。若显示黄色或红色，请按照提示调整。',
        precheck_initial: '点击“开始检查”以启用摄像头', precheck_requesting: '正在请求摄像头权限...', precheck_checking: '正在检查环境...', precheck_camera_error: '摄像头错误：',
        precheck_all_good: '检查通过，可以开始校准', btn_start_precheck: '开始检查', btn_start_calib: '开始校准', precheck_must_pass: '请先完成摄像头检查。',
        status_error: '错误', status_too_dark: '光线太暗', status_too_bright: '光线太亮', status_optimal: '良好', status_normal: '正常', status_not_found: '未检测到',
        status_too_small: '距离太远', status_too_large: '距离太近', status_out_of_zone: '不在区域内', status_tilted: '头部倾斜', status_stable: '稳定', status_unstable: '不稳定',
        status_no_face: '未检测到面部', status_all_good: '检查通过，可以开始校准', status_needs_fix: '需要调整', status_checking: '正在检查', status_partial_face: '部分面部不可见',
        status_off_center: '未居中', status_face_occluded: '面部被遮挡', status_hair_occlusion: '头发遮挡面部', status_face_visible: '面部完全可见',
        tip_light_dark: '光线太暗，请打开灯或靠近窗户。', tip_light_bright: '光线太亮，请避开直射光。', tip_face_not_found: '未检测到面部，请移到画面中央。',
        tip_face_too_small: '请靠近摄像头。', tip_face_too_large: '请远离摄像头。', tip_face_out_of_zone: '请将面部移到画面中央。', tip_face_tilted: '请保持头部直立。',
        tip_pose_unstable: '请直视摄像头并保持片刻稳定。', tip_pose_partial_face: '请确保整个面部都在画面内。', tip_pose_eyes_off_center: '请直视镜头。',
        tip_precheck_camera_eye_level: '请将摄像头调整到接近眼睛的高度并直视镜头。', tip_hand_on_face: '请将手移开面部。', tip_face_occluded: '请移除遮挡面部的物体。',
        precheck_generic_tip: '请根据指示调整摄像头、光线和头部位置。'
    },
    hi: {
        label_light: 'रोशनी', label_face: 'चेहरा', label_pose: 'सिर की स्थिति', label_visibility: 'चेहरे की दृश्यता',
        status_waiting: 'प्रतीक्षा...', guide_text: 'चेहरा फ्रेम में रखें। कैमरा आँखों की ऊँचाई के पास रखें और सीधे लेंस में देखें।',
        precheck_criteria_help: 'हरा संकेत बताता है कि शर्त पूरी है। पट्टी की लंबाई स्कोर नहीं है। पीला या लाल होने पर निर्देशों का पालन करें।',
        precheck_initial: 'कैमरा चालू करने के लिए “जाँच शुरू करें” दबाएँ', precheck_requesting: 'कैमरे की अनुमति माँगी जा रही है...', precheck_checking: 'परिस्थितियाँ जाँची जा रही हैं...', precheck_camera_error: 'कैमरा त्रुटि: ',
        precheck_all_good: 'जाँच पूरी हुई। कैलिब्रेशन शुरू कर सकते हैं', btn_start_precheck: 'जाँच शुरू करें', btn_start_calib: 'कैलिब्रेशन शुरू करें', precheck_must_pass: 'पहले कैमरा जाँच पूरी करें।',
        status_error: 'त्रुटि', status_too_dark: 'बहुत अँधेरा', status_too_bright: 'बहुत तेज़ रोशनी', status_optimal: 'उत्तम', status_normal: 'सामान्य', status_not_found: 'नहीं मिला',
        status_too_small: 'बहुत दूर', status_too_large: 'बहुत पास', status_out_of_zone: 'क्षेत्र से बाहर', status_tilted: 'सिर झुका है', status_stable: 'स्थिर', status_unstable: 'अस्थिर',
        status_no_face: 'चेहरा नहीं मिला', status_all_good: 'जाँच पूरी हुई', status_needs_fix: 'सुधार आवश्यक', status_checking: 'जाँच जारी है', status_partial_face: 'चेहरे का भाग नहीं दिख रहा',
        status_off_center: 'केंद्र से बाहर', status_face_occluded: 'चेहरा ढका है', status_hair_occlusion: 'बाल चेहरा ढक रहे हैं', status_face_visible: 'पूरा चेहरा दिख रहा है',
        tip_light_dark: 'रोशनी कम है। लैंप जलाएँ या खिड़की के पास जाएँ।', tip_light_bright: 'रोशनी बहुत तेज़ है। सीधी रोशनी से बचें।', tip_face_not_found: 'चेहरा नहीं मिला। फ्रेम के बीच में आएँ।',
        tip_face_too_small: 'कैमरे के थोड़ा पास आएँ।', tip_face_too_large: 'कैमरे से थोड़ा दूर जाएँ।', tip_face_out_of_zone: 'चेहरा फ्रेम के बीच में रखें।', tip_face_tilted: 'सिर सीधा रखें।',
        tip_pose_unstable: 'कैमरे की ओर देखें और कुछ क्षण स्थिर रहें।', tip_pose_partial_face: 'पूरा चेहरा फ्रेम में रखें।', tip_pose_eyes_off_center: 'सीधे लेंस में देखें।',
        tip_precheck_camera_eye_level: 'कैमरा आँखों की ऊँचाई के पास रखें और लेंस में देखें।', tip_hand_on_face: 'हाथ चेहरे से हटाएँ।', tip_face_occluded: 'चेहरे को ढकने वाली वस्तु हटाएँ।',
        precheck_generic_tip: 'कैमरा, रोशनी और सिर की स्थिति को संकेत के अनुसार समायोजित करें।'
    },
    ar: {
        label_light: 'الإضاءة', label_face: 'الوجه', label_pose: 'وضع الرأس', label_visibility: 'وضوح الوجه',
        status_waiting: 'في الانتظار...', guide_text: 'أبقِ وجهك داخل الإطار. ضع الكاميرا قرب مستوى العين وانظر مباشرة إلى العدسة.',
        precheck_criteria_help: 'يعني المؤشر الأخضر أن الشرط مستوفى. طول الشريط ليس درجة. اتبع الإرشادات إذا كان المؤشر أصفر أو أحمر.',
        precheck_initial: 'اضغط «بدء الفحص» لتشغيل الكاميرا', precheck_requesting: 'جارٍ طلب إذن الكاميرا...', precheck_checking: 'جارٍ فحص الظروف...', precheck_camera_error: 'خطأ في الكاميرا: ',
        precheck_all_good: 'تم اجتياز الفحص ويمكن بدء المعايرة', btn_start_precheck: 'بدء الفحص', btn_start_calib: 'بدء المعايرة', precheck_must_pass: 'أكمل فحص الكاميرا أولًا.',
        status_error: 'خطأ', status_too_dark: 'إضاءة ضعيفة', status_too_bright: 'إضاءة شديدة', status_optimal: 'ممتاز', status_normal: 'طبيعي', status_not_found: 'غير مكتشف',
        status_too_small: 'بعيد جدًا', status_too_large: 'قريب جدًا', status_out_of_zone: 'خارج النطاق', status_tilted: 'الرأس مائل', status_stable: 'ثابت', status_unstable: 'غير ثابت',
        status_no_face: 'لم يُكتشف الوجه', status_all_good: 'تم اجتياز الفحص', status_needs_fix: 'يلزم التعديل', status_checking: 'جارٍ الفحص', status_partial_face: 'جزء من الوجه غير ظاهر',
        status_off_center: 'خارج المنتصف', status_face_occluded: 'الوجه محجوب', status_hair_occlusion: 'الشعر يحجب الوجه', status_face_visible: 'الوجه ظاهر بالكامل',
        tip_light_dark: 'الإضاءة ضعيفة. شغّل مصباحًا أو اقترب من نافذة.', tip_light_bright: 'الإضاءة شديدة. تجنب الضوء المباشر.', tip_face_not_found: 'لم يُكتشف الوجه. انتقل إلى وسط الإطار.',
        tip_face_too_small: 'اقترب قليلًا من الكاميرا.', tip_face_too_large: 'ابتعد قليلًا عن الكاميرا.', tip_face_out_of_zone: 'ضع الوجه في وسط الإطار.', tip_face_tilted: 'أبقِ الرأس مستقيمًا.',
        tip_pose_unstable: 'انظر إلى الكاميرا وابقَ ثابتًا للحظات.', tip_pose_partial_face: 'تأكد من ظهور الوجه كاملًا.', tip_pose_eyes_off_center: 'انظر مباشرة إلى العدسة.',
        tip_precheck_camera_eye_level: 'ضع الكاميرا قرب مستوى العين وانظر إلى العدسة.', tip_hand_on_face: 'أبعد يدك عن وجهك.', tip_face_occluded: 'أزل ما يحجب الوجه.',
        precheck_generic_tip: 'اضبط الكاميرا والإضاءة ووضع الرأس وفقًا للمؤشر.'
    },
    fr: {
        label_light: 'Éclairage', label_face: 'Visage', label_pose: 'Position de la tête', label_visibility: 'Visibilité du visage',
        status_waiting: 'En attente...', guide_text: 'Gardez le visage dans le cadre. Placez la webcam près du niveau des yeux et regardez l’objectif.',
        precheck_criteria_help: 'Un indicateur vert signifie que la condition est remplie. La longueur de la barre n’est pas une note. Suivez les conseils si l’indicateur est jaune ou rouge.',
        precheck_initial: 'Appuyez sur « Démarrer la vérification » pour activer la caméra', precheck_requesting: 'Demande d’accès à la caméra...', precheck_checking: 'Vérification des conditions...', precheck_camera_error: 'Erreur de caméra : ',
        precheck_all_good: 'Vérification réussie. Vous pouvez lancer l’étalonnage', btn_start_precheck: 'Démarrer la vérification', btn_start_calib: 'Lancer l’étalonnage', precheck_must_pass: 'Effectuez d’abord la vérification de la caméra.',
        status_error: 'Erreur', status_too_dark: 'Trop sombre', status_too_bright: 'Trop lumineux', status_optimal: 'Optimal', status_normal: 'Normal', status_not_found: 'Non détecté',
        status_too_small: 'Trop loin', status_too_large: 'Trop près', status_out_of_zone: 'Hors zone', status_tilted: 'Tête inclinée', status_stable: 'Stable', status_unstable: 'Instable',
        status_no_face: 'Visage non détecté', status_all_good: 'Vérification réussie', status_needs_fix: 'Correction nécessaire', status_checking: 'Vérification en cours', status_partial_face: 'Une partie du visage est masquée',
        status_off_center: 'Décentré', status_face_occluded: 'Visage masqué', status_hair_occlusion: 'Les cheveux masquent le visage', status_face_visible: 'Visage entièrement visible',
        tip_light_dark: 'L’éclairage est insuffisant. Allumez une lampe ou rapprochez-vous d’une fenêtre.', tip_light_bright: 'L’éclairage est trop fort. Évitez la lumière directe.', tip_face_not_found: 'Visage non détecté. Placez-vous au centre du cadre.',
        tip_face_too_small: 'Rapprochez-vous légèrement de la caméra.', tip_face_too_large: 'Éloignez-vous légèrement de la caméra.', tip_face_out_of_zone: 'Placez le visage au centre du cadre.', tip_face_tilted: 'Gardez la tête droite.',
        tip_pose_unstable: 'Regardez la caméra et restez stable quelques secondes.', tip_pose_partial_face: 'Assurez-vous que tout le visage est visible.', tip_pose_eyes_off_center: 'Regardez directement l’objectif.',
        tip_precheck_camera_eye_level: 'Placez la caméra près du niveau des yeux et regardez l’objectif.', tip_hand_on_face: 'Éloignez la main du visage.', tip_face_occluded: 'Retirez ce qui masque le visage.',
        precheck_generic_tip: 'Ajustez la caméra, l’éclairage et la position de la tête selon l’indicateur.'
    },
    bn: {
        label_light: 'আলো', label_face: 'মুখ', label_pose: 'মাথার অবস্থান', label_visibility: 'মুখের দৃশ্যমানতা',
        status_waiting: 'অপেক্ষা...', guide_text: 'মুখ ফ্রেমের মধ্যে রাখুন। ক্যামেরা চোখের উচ্চতার কাছে রাখুন এবং লেন্সের দিকে তাকান।',
        precheck_criteria_help: 'সবুজ সূচক মানে শর্ত পূরণ হয়েছে। বারের দৈর্ঘ্য কোনো স্কোর নয়। হলুদ বা লাল হলে নির্দেশনা অনুসরণ করুন।',
        precheck_initial: 'ক্যামেরা চালু করতে “পরীক্ষা শুরু করুন” চাপুন', precheck_requesting: 'ক্যামেরার অনুমতি চাওয়া হচ্ছে...', precheck_checking: 'পরিবেশ পরীক্ষা করা হচ্ছে...', precheck_camera_error: 'ক্যামেরা ত্রুটি: ',
        precheck_all_good: 'পরীক্ষা সফল। ক্যালিব্রেশন শুরু করা যাবে', btn_start_precheck: 'পরীক্ষা শুরু করুন', btn_start_calib: 'ক্যালিব্রেশন শুরু করুন', precheck_must_pass: 'আগে ক্যামেরা পরীক্ষা সম্পন্ন করুন।',
        status_error: 'ত্রুটি', status_too_dark: 'খুব অন্ধকার', status_too_bright: 'খুব উজ্জ্বল', status_optimal: 'উত্তম', status_normal: 'স্বাভাবিক', status_not_found: 'পাওয়া যায়নি',
        status_too_small: 'খুব দূরে', status_too_large: 'খুব কাছে', status_out_of_zone: 'সীমার বাইরে', status_tilted: 'মাথা কাত', status_stable: 'স্থিতিশীল', status_unstable: 'অস্থিতিশীল',
        status_no_face: 'মুখ পাওয়া যায়নি', status_all_good: 'পরীক্ষা সফল', status_needs_fix: 'সংশোধন প্রয়োজন', status_checking: 'পরীক্ষা চলছে', status_partial_face: 'মুখের অংশ দেখা যাচ্ছে না',
        status_off_center: 'কেন্দ্রের বাইরে', status_face_occluded: 'মুখ ঢাকা', status_hair_occlusion: 'চুল মুখ ঢেকেছে', status_face_visible: 'সম্পূর্ণ মুখ দেখা যাচ্ছে',
        tip_light_dark: 'আলো কম। বাতি জ্বালান বা জানালার কাছে যান।', tip_light_bright: 'আলো খুব বেশি। সরাসরি আলো এড়িয়ে চলুন।', tip_face_not_found: 'মুখ পাওয়া যায়নি। ফ্রেমের মাঝখানে আসুন।',
        tip_face_too_small: 'ক্যামেরার একটু কাছে আসুন।', tip_face_too_large: 'ক্যামেরা থেকে একটু দূরে যান।', tip_face_out_of_zone: 'মুখ ফ্রেমের মাঝখানে রাখুন।', tip_face_tilted: 'মাথা সোজা রাখুন।',
        tip_pose_unstable: 'ক্যামেরার দিকে তাকিয়ে কয়েক সেকেন্ড স্থির থাকুন।', tip_pose_partial_face: 'সম্পূর্ণ মুখ ফ্রেমে রাখুন।', tip_pose_eyes_off_center: 'সরাসরি লেন্সের দিকে তাকান।',
        tip_precheck_camera_eye_level: 'ক্যামেরা চোখের উচ্চতার কাছে রাখুন।', tip_hand_on_face: 'মুখ থেকে হাত সরান।', tip_face_occluded: 'মুখ ঢেকে রাখা বস্তু সরান।',
        precheck_generic_tip: 'সূচক অনুযায়ী ক্যামেরা, আলো ও মাথার অবস্থান ঠিক করুন।'
    },
    pt: {
        label_light: 'Iluminação', label_face: 'Rosto', label_pose: 'Posição da cabeça', label_visibility: 'Visibilidade do rosto',
        status_waiting: 'Aguardando...', guide_text: 'Mantenha o rosto no enquadramento. Coloque a câmera perto do nível dos olhos e olhe para a lente.',
        precheck_criteria_help: 'O indicador verde significa que a condição foi atendida. O comprimento da barra não é uma nota. Siga as orientações se o indicador estiver amarelo ou vermelho.',
        precheck_initial: 'Pressione “Iniciar verificação” para ativar a câmera', precheck_requesting: 'Solicitando acesso à câmera...', precheck_checking: 'Verificando as condições...', precheck_camera_error: 'Erro da câmera: ',
        precheck_all_good: 'Verificação concluída. Você pode iniciar a calibração', btn_start_precheck: 'Iniciar verificação', btn_start_calib: 'Iniciar calibração', precheck_must_pass: 'Conclua primeiro a verificação da câmera.',
        status_error: 'Erro', status_too_dark: 'Muito escuro', status_too_bright: 'Muito claro', status_optimal: 'Ótimo', status_normal: 'Normal', status_not_found: 'Não detectado',
        status_too_small: 'Muito longe', status_too_large: 'Muito perto', status_out_of_zone: 'Fora da área', status_tilted: 'Cabeça inclinada', status_stable: 'Estável', status_unstable: 'Instável',
        status_no_face: 'Rosto não detectado', status_all_good: 'Verificação concluída', status_needs_fix: 'Ajuste necessário', status_checking: 'Verificando', status_partial_face: 'Parte do rosto não está visível',
        status_off_center: 'Fora do centro', status_face_occluded: 'Rosto coberto', status_hair_occlusion: 'O cabelo cobre o rosto', status_face_visible: 'Rosto totalmente visível',
        tip_light_dark: 'Há pouca luz. Acenda uma lâmpada ou aproxime-se de uma janela.', tip_light_bright: 'Há luz demais. Evite luz direta.', tip_face_not_found: 'Rosto não detectado. Posicione-se no centro.',
        tip_face_too_small: 'Aproxime-se um pouco da câmera.', tip_face_too_large: 'Afaste-se um pouco da câmera.', tip_face_out_of_zone: 'Posicione o rosto no centro.', tip_face_tilted: 'Mantenha a cabeça reta.',
        tip_pose_unstable: 'Olhe para a câmera e fique estável por alguns segundos.', tip_pose_partial_face: 'Mantenha o rosto inteiro no enquadramento.', tip_pose_eyes_off_center: 'Olhe diretamente para a lente.',
        tip_precheck_camera_eye_level: 'Coloque a câmera perto do nível dos olhos e olhe para a lente.', tip_hand_on_face: 'Afaste a mão do rosto.', tip_face_occluded: 'Remova o que está cobrindo o rosto.',
        precheck_generic_tip: 'Ajuste a câmera, a iluminação e a posição da cabeça conforme o indicador.'
    },
    ur: {
        label_light: 'روشنی', label_face: 'چہرہ', label_pose: 'سر کی پوزیشن', label_visibility: 'چہرے کی نمائش',
        status_waiting: 'انتظار...', guide_text: 'چہرہ فریم میں رکھیں۔ کیمرہ آنکھوں کی سطح کے قریب رکھیں اور لینس کی طرف دیکھیں۔',
        precheck_criteria_help: 'سبز اشارہ شرط پوری ہونے کو ظاہر کرتا ہے۔ بار کی لمبائی اسکور نہیں ہے۔ پیلا یا سرخ ہونے پر ہدایات پر عمل کریں۔',
        precheck_initial: 'کیمرہ چلانے کے لیے “جانچ شروع کریں” دبائیں', precheck_requesting: 'کیمرے کی اجازت مانگی جا رہی ہے...', precheck_checking: 'حالات کی جانچ ہو رہی ہے...', precheck_camera_error: 'کیمرہ خرابی: ',
        precheck_all_good: 'جانچ مکمل۔ کیلیبریشن شروع کی جا سکتی ہے', btn_start_precheck: 'جانچ شروع کریں', btn_start_calib: 'کیلیبریشن شروع کریں', precheck_must_pass: 'پہلے کیمرہ جانچ مکمل کریں۔',
        status_error: 'خرابی', status_too_dark: 'بہت اندھیرا', status_too_bright: 'بہت روشن', status_optimal: 'بہتر', status_normal: 'نارمل', status_not_found: 'نہیں ملا',
        status_too_small: 'بہت دور', status_too_large: 'بہت قریب', status_out_of_zone: 'حد سے باہر', status_tilted: 'سر جھکا ہوا', status_stable: 'مستحکم', status_unstable: 'غیر مستحکم',
        status_no_face: 'چہرہ نہیں ملا', status_all_good: 'جانچ مکمل', status_needs_fix: 'درستگی درکار', status_checking: 'جانچ جاری', status_partial_face: 'چہرے کا حصہ نظر نہیں آ رہا',
        status_off_center: 'مرکز سے باہر', status_face_occluded: 'چہرہ ڈھکا ہوا', status_hair_occlusion: 'بال چہرہ ڈھانپ رہے ہیں', status_face_visible: 'پورا چہرہ نظر آ رہا ہے',
        tip_light_dark: 'روشنی کم ہے۔ لیمپ جلائیں یا کھڑکی کے قریب جائیں۔', tip_light_bright: 'روشنی بہت تیز ہے۔ براہ راست روشنی سے بچیں۔', tip_face_not_found: 'چہرہ نہیں ملا۔ فریم کے درمیان آئیں۔',
        tip_face_too_small: 'کیمرے کے تھوڑا قریب آئیں۔', tip_face_too_large: 'کیمرے سے تھوڑا دور جائیں۔', tip_face_out_of_zone: 'چہرہ فریم کے درمیان رکھیں۔', tip_face_tilted: 'سر سیدھا رکھیں۔',
        tip_pose_unstable: 'کیمرے کی طرف دیکھیں اور چند لمحے مستحکم رہیں۔', tip_pose_partial_face: 'پورا چہرہ فریم میں رکھیں۔', tip_pose_eyes_off_center: 'سیدھا لینس کی طرف دیکھیں۔',
        tip_precheck_camera_eye_level: 'کیمرہ آنکھوں کی سطح کے قریب رکھیں۔', tip_hand_on_face: 'ہاتھ چہرے سے ہٹائیں۔', tip_face_occluded: 'چہرہ ڈھانپنے والی چیز ہٹائیں۔',
        precheck_generic_tip: 'اشارے کے مطابق کیمرہ، روشنی اور سر کی پوزیشن درست کریں۔'
    }
};

Object.entries(participantPrecheckLocaleOverrides).forEach(([locale, overrides]) => {
    Object.assign(translations[locale], overrides);
});

// The pre-check and measurement flow must not silently switch to English after
// Spanish was selected. These strings cover every screen shown during a session.
Object.assign(translations.es, {
    opt_ru: 'Ruso', opt_en: 'Inglés', opt_other: 'Otro',
    opt_edu_school: 'Educación secundaria', opt_edu_student: 'Estudiante', opt_edu_higher: 'Educación superior', opt_edu_degree: 'Título académico',
    label_vision: 'Visión', opt_vis_norm: 'Normal', opt_vis_glass: 'Gafas', opt_vis_lens: 'Lentes de contacto',
    label_pathology: 'Alteraciones visuales', opt_path_none: 'Ninguna', opt_path_hemi: 'Hemianopsia', opt_path_scot: 'Escotoma', opt_path_color: 'Daltonismo',
    label_hand: 'Mano dominante', opt_hand_r: 'Derecha', opt_hand_l: 'Izquierda', label_device: 'Dispositivo de entrada',
    opt_dev_mouse: 'Ratón', opt_dev_touch: 'Panel táctil', label_keyboard: 'Teclado', opt_kb_int: 'Integrado', opt_kb_ext: 'Externo',
    msg_press_btn: 'Preparando la calibración...', status_label: 'Estado:', points_label: 'Puntos registrados:',
    qc_passed: 'Los datos superaron el control de calidad', label_secure_sender: 'Activar el envío seguro adicional',
    label_light: 'Iluminación', label_face: 'Rostro', label_pose: 'Posición de la cabeza', label_visibility: 'Visibilidad del rostro',
    status_waiting: 'Esperando...', guide_text: 'Mantenga el rostro dentro del encuadre. Coloque la cámara cerca del nivel de los ojos y mire directamente al objetivo.',
    precheck_criteria_help: 'Cuando un indicador se vuelve verde, el criterio está cumplido. La longitud de la barra y el porcentaje no son importantes. Si aparece en amarillo o rojo, siga las indicaciones.',
    precheck_initial: 'Pulse «Iniciar comprobación» para activar la cámara', precheck_requesting: 'Solicitando acceso a la cámara...',
    precheck_checking: 'Comprobando las condiciones...', precheck_camera_error: 'Error de cámara: ',
    precheck_all_good: 'Comprobación superada. Puede iniciar la calibración', btn_start_precheck: 'Iniciar comprobación', btn_start_calib: 'Iniciar calibración',
    status_error: 'Error', status_too_dark: 'Demasiado oscuro', status_too_bright: 'Demasiado claro', status_optimal: 'Óptimo', status_normal: 'Normal',
    status_not_found: 'No detectado', status_too_small: 'Demasiado lejos', status_too_large: 'Demasiado cerca', status_out_of_zone: 'Fuera de la zona',
    status_tilted: 'Cabeza inclinada', status_stable: 'Estable', status_unstable: 'Inestable', status_no_face: 'Rostro no detectado',
    status_all_good: 'Comprobación superada. Puede iniciar la calibración', precheck_must_pass: 'Primero debe superar la comprobación de cámara.',
    status_needs_fix: 'Requiere corrección', status_checking: 'Comprobando las condiciones', status_partial_face: 'Parte del rostro no es visible',
    status_off_center: 'Rostro fuera del centro', status_face_occluded: 'Rostro cubierto', status_hair_occlusion: 'El cabello cubre el rostro', status_face_visible: 'Rostro completamente visible',
    tip_light_dark: 'Hay poca luz. Encienda una lámpara o acérquese a una ventana.', tip_light_bright: 'Hay demasiada luz. Evite la luz directa o aléjese de la ventana.',
    tip_face_not_found: 'No se detecta el rostro. Sitúese en el centro del encuadre.', tip_face_too_small: 'Acérquese a la cámara sin salir del encuadre.',
    tip_face_too_large: 'Está demasiado cerca. Aléjese de la cámara.', tip_face_out_of_zone: 'Sitúe el rostro en el centro del encuadre.', tip_face_tilted: 'Mantenga la cabeza recta.',
    tip_pose_no_face: 'No se detecta el rostro.', tip_pose_unstable: 'Mantenga la cabeza quieta durante unos segundos.',
    tip_pose_partial_face: 'Asegúrese de que el rostro completo esté dentro del encuadre.', tip_pose_eyes_off_center: 'Mire directamente al objetivo de la cámara.',
    tip_precheck_camera_eye_level: 'Coloque la cámara cerca del nivel de los ojos y mire al objetivo.',
    tip_pose_move_right: 'Muévase ligeramente hacia la derecha.', tip_pose_move_left: 'Muévase ligeramente hacia la izquierda.',
    tip_pose_move_up: 'Suba ligeramente.', tip_pose_move_down: 'Baje ligeramente.', tip_pose_turn_down: 'Baje un poco la cabeza.', tip_pose_turn_up: 'Levante un poco la cabeza.',
    tip_pose_tilt_right: 'Incline menos la cabeza hacia la derecha.', tip_pose_tilt_left: 'Incline menos la cabeza hacia la izquierda.',
    tip_pose_turn_left: 'Gire menos hacia la izquierda.', tip_pose_turn_right: 'Gire menos hacia la derecha.', tip_pose_raise_head: 'Levante un poco la cabeza.',
    tip_pose_lower_head: 'Baje un poco la cabeza.', tip_pose_straighten: 'Enderece la cabeza.', tip_eyes_closed: 'Abra los ojos y mire a la cámara.',
    tip_face_occluded: 'Retire los objetos que cubren el rostro.', tip_hand_on_face: 'Retire la mano del rostro.', tip_hair_covers_face: 'Retire el cabello del rostro.',
    tip_left_side_occluded: 'Libere el lado izquierdo del rostro.', tip_right_side_occluded: 'Libere el lado derecho del rostro.',
    tip_left_hand_on_face: 'Retire la mano izquierda del rostro.', tip_right_hand_on_face: 'Retire la mano derecha del rostro.',
    tip_forehead_covered: 'Deje visible la frente.', tip_chin_covered: 'Deje visible la barbilla.', tip_eyes_area_covered: 'Deje visible la zona de los ojos.',
    tip_nose_covered: 'Deje visible la nariz.', tip_mouth_covered: 'Deje visible la boca.',
    id_participant: 'ID del participante:', id_not_generated: 'El ID aún no se ha generado', msg_init: 'Inicializando el módulo...',
    msg_face_ok: 'Rostro detectado', msg_face_err: 'Rostro no detectado', msg_wait_stable: 'Mantenga una posición estable', msg_face_locked: 'Posición registrada', msg_no_face: 'No se detecta el rostro',
    test_tracking_title: 'Seguimiento visual', test_follow_shape: 'Siga la figura con la mirada', test_progress: 'Progreso', test_complete: 'Prueba completada',
    test_hub_title: 'Pruebas de la sesión', test_hub_subtitle: 'Complete los bloques en el orden indicado', test_hub_finish: 'Finalizar sesión',
    test_hub_ready: 'Listo para comenzar', test_hub_running: 'Prueba en curso', test_hub_last_result: 'Último resultado', test_hub_error: 'Error de la prueba',
    test_card_rt_title: 'Tiempo de reacción', test_card_tracking_title: 'Seguimiento de la mirada', test_card_bpm_title: 'Frecuencia cardíaca',
    test_card_vpc_title: 'Comparación visual por pares', test_card_visuospatial_title: 'Habilidades visoespaciales',
    hub_emotion_label: 'Estado emocional', hub_emotion_no_camera: 'No hay señal válida de la cámara', emotion_neutral: 'Neutral', emotion_happiness: 'Alegría',
    emotion_sadness: 'Tristeza', emotion_anger: 'Ira', emotion_fear: 'Miedo', emotion_surprise: 'Sorpresa', emotion_disgust: 'Asco',
    vpc_progress: 'Comparación', vpc_instruction: 'Mire las imágenes de forma natural.', vpc_phase_fixation: 'Fije la mirada en el centro.',
    vpc_phase_familiar: 'Observe la imagen.', vpc_phase_isi: 'Prepárese para la siguiente imagen.', vpc_phase_pair: 'Observe ambas imágenes.', vpc_phase_iti: 'Breve pausa.',
    visuospatial_btn_start: 'Empezar a dibujar', visuospatial_btn_finish: 'Terminar dibujo', visuospatial_status_wait_start: 'Pulse el botón para comenzar.',
    visuospatial_status_drawing: 'Dibuje con la mirada.', visuospatial_hint_hold_space: 'Mantenga pulsada la barra espaciadora para dibujar.',
    visuospatial_status_pen_down: 'Dibujando', visuospatial_status_pen_up: 'Pincel levantado',
    visuospatial_prompt_circle_title: 'Dibuje un círculo', visuospatial_prompt_circle_text: 'Dibuje un círculo cerrado con la mirada.',
    visuospatial_prompt_clock_title: 'Dibuje un reloj', visuospatial_prompt_clock_text: 'Dibuje una esfera de reloj con sus elementos principales.',
    visuospatial_prompt_person_title: 'Dibuje una persona', visuospatial_prompt_person_text: 'Dibuje una persona con la mirada.',
    validation_complete: 'Validación completada', validation_accuracy: 'Precisión', validation_precision: 'Estabilidad', pixels: ' px',
    calib_click_instruction: 'Mire el punto y púlselo cuando esté listo.', calib_progress: 'Calibración', calib_complete: 'Calibración completada',
    validation_look_instruction: 'Mire cada punto sin pulsarlo.', point_of: 'de',
    issue_insufficient_data: 'Datos insuficientes', issue_low_gaze_valid_pct: 'Pocos datos válidos de mirada', issue_low_face_ok_pct: 'El rostro se detectó con poca frecuencia',
    issue_high_offscreen: 'La mirada estuvo a menudo fuera de la pantalla', issue_short_duration: 'Duración insuficiente', issue_low_face_visible: 'Baja visibilidad del rostro',
    issue_low_pose_ok_pct: 'Posición de la cabeza inestable', issue_low_illumination_ok_pct: 'Iluminación inadecuada', issue_low_eyes_open_pct: 'Ojos cerrados con demasiada frecuencia',
    issue_high_occlusion_pct: 'Rostro cubierto con demasiada frecuencia', issue_low_fps_time: 'Frecuencia de cámara insuficiente',
    qc_passed_full: 'Datos válidos: control de calidad superado', qc_failed_full: 'La calidad de los datos no alcanza el umbral',
    qc_duration: 'Duración', qc_valid: 'Válido', qc_face_ok: 'Rostro correcto', qc_issues: 'Problemas', service_unavailable: 'Servicio no disponible'
});

translations.ru.pixels = ' пкс';
translations.en.pixels = ' px';

const participantSessionLocaleAdditions = {
    ru: {
        privacy_policy_link: 'Политика конфиденциальности',
        audio_consent_checkbox: 'Разрешить анализ голоса во время сессии. Аудиозапись не сохраняется и не передаётся; отправляются только обезличенные признаки и показатели качества.',
        session_reservation_error: 'Не удалось открыть сессию. Проверьте ссылку приглашения и подключение к сети.'
    },
    en: {
        privacy_policy_link: 'Privacy policy',
        audio_consent_checkbox: 'Allow voice analysis during the session. Audio is neither stored nor transmitted; only anonymized features and quality metrics are sent.',
        session_reservation_error: 'The session could not be opened. Check the invitation link and network connection.'
    },
    zh: {
        privacy_policy_link: '隐私政策',
        audio_consent_checkbox: '允许在会话期间分析语音。音频不会被保存或传输；仅发送匿名特征和质量指标。',
        session_reservation_error: '无法打开会话。请检查邀请链接和网络连接。'
    },
    es: {
        privacy_policy_link: 'Política de privacidad',
        audio_consent_checkbox: 'Permitir el análisis de voz durante la sesión. El audio no se guarda ni se transmite; solo se envían características anónimas y métricas de calidad.',
        session_reservation_error: 'No se pudo abrir la sesión. Compruebe el enlace de invitación y la conexión de red.'
    },
    hi: {
        privacy_policy_link: 'गोपनीयता नीति',
        audio_consent_checkbox: 'सत्र के दौरान आवाज़ के विश्लेषण की अनुमति दें। ऑडियो न तो सहेजा जाता है और न भेजा जाता है; केवल अनाम विशेषताएँ और गुणवत्ता माप भेजे जाते हैं।',
        session_reservation_error: 'सत्र नहीं खुल सका। आमंत्रण लिंक और नेटवर्क कनेक्शन जाँचें।'
    },
    ar: {
        privacy_policy_link: 'سياسة الخصوصية',
        audio_consent_checkbox: 'السماح بتحليل الصوت أثناء الجلسة. لا يتم حفظ الصوت أو إرساله؛ تُرسل فقط السمات المجهولة ومؤشرات الجودة.',
        session_reservation_error: 'تعذر فتح الجلسة. تحقق من رابط الدعوة واتصال الشبكة.'
    },
    fr: {
        privacy_policy_link: 'Politique de confidentialité',
        audio_consent_checkbox: 'Autoriser l’analyse de la voix pendant la session. L’audio n’est ni conservé ni transmis ; seuls des indicateurs anonymisés et des mesures de qualité sont envoyés.',
        session_reservation_error: 'Impossible d’ouvrir la session. Vérifiez le lien d’invitation et la connexion réseau.'
    },
    bn: {
        privacy_policy_link: 'গোপনীয়তা নীতি',
        audio_consent_checkbox: 'সেশনের সময় কণ্ঠ বিশ্লেষণের অনুমতি দিন। অডিও সংরক্ষণ বা পাঠানো হয় না; শুধু পরিচয়বিহীন বৈশিষ্ট্য ও মানের সূচক পাঠানো হয়।',
        session_reservation_error: 'সেশন খোলা যায়নি। আমন্ত্রণের লিংক ও নেটওয়ার্ক সংযোগ পরীক্ষা করুন।'
    },
    pt: {
        privacy_policy_link: 'Política de privacidade',
        audio_consent_checkbox: 'Permitir a análise de voz durante a sessão. O áudio não é guardado nem transmitido; apenas características anónimas e métricas de qualidade são enviadas.',
        session_reservation_error: 'Não foi possível abrir a sessão. Verifique o link de convite e a ligação de rede.'
    },
    ur: {
        privacy_policy_link: 'رازداری کی پالیسی',
        audio_consent_checkbox: 'سیشن کے دوران آواز کے تجزیے کی اجازت دیں۔ آڈیو محفوظ یا منتقل نہیں کیا جاتا؛ صرف گمنام خصوصیات اور معیار کے پیمانے بھیجے جاتے ہیں۔',
        session_reservation_error: 'سیشن نہیں کھل سکا۔ دعوتی لنک اور نیٹ ورک کنکشن چیک کریں۔'
    }
};

const participantRuntimeLocaleAdditions = {
    ru: {
        runtime_policy_title: 'Условия проведения',
        runtime_policy_body: 'Не проходите исследование в движущемся транспорте, в темноте, при ярком свете за спиной, лёжа или с закрытым лицом. Краткие естественные движения головы допустимы. При недостаточном качестве будет повторена только затронутая часть.',
        runtime_policy_note: 'Пауза доступна только на экране инструкции. Во время задания остановка запрещена.',
        runtime_continue: 'Продолжить', runtime_pause: 'Пауза', runtime_resume: 'Продолжить сессию',
        runtime_repeat_block_action: 'Условия восстановлены, повторить блок', runtime_repeat_trials_action: 'Повторить незасчитанные пробы', runtime_repeat_limit_action: 'Продолжить сессию',
        runtime_recovery_title: 'Сессия восстановлена', runtime_recovery_body: 'После перезагрузки проверку камеры и персональную калибровку необходимо пройти заново.', runtime_recovery_action: 'Перейти к проверке камеры',
        runtime_instruction_title: 'Инструкция', runtime_instruction_action: 'Начать', runtime_block_complete_title: 'Блок завершён', runtime_block_complete_body: 'Данные блока сохранены. Далее будет показана инструкция следующего блока.', runtime_block_complete_action: 'Далее',
        runtime_dismiss: 'Закрыть уведомление', runtime_continuous_start_failed: 'Не удалось запустить анализ камеры. Вернитесь к проверке камеры и попробуйте снова.', runtime_generic_technical: 'Возникла техническая ошибка анализа.', runtime_generic_quality: 'Условия измерения временно не соответствуют требованиям.',
        runtime_repeat_trials_title: 'Часть проб необходимо повторить', runtime_repeat_block_title: 'Блок необходимо повторить', runtime_repeat_reason_prefix: 'Причины', runtime_repeat_trials_suffix: 'Будут повторены только незасчитанные пробы.', runtime_repeat_block_body: 'Предыдущая попытка не принята. Исправьте условия перед продолжением.', runtime_repeat_limit_title: 'Достигнут лимит повторов', runtime_repeat_limit_body: 'Оставшиеся пробы отмечены как невалидные; сессия продолжится без нового цикла.'
    },
    en: {
        runtime_policy_title: 'Test conditions',
        runtime_policy_body: 'Do not take the study in a moving vehicle, in darkness, with strong backlight, while lying down, or with your face covered. Brief natural head movements are allowed. If quality becomes insufficient, only the affected part will be repeated.',
        runtime_policy_note: 'Pause is available only on instruction screens and is disabled during a task.',
        runtime_continue: 'Continue', runtime_pause: 'Pause', runtime_resume: 'Resume session',
        runtime_repeat_block_action: 'Conditions restored, repeat block', runtime_repeat_trials_action: 'Repeat invalid trials', runtime_repeat_limit_action: 'Continue session',
        runtime_recovery_title: 'Session restored', runtime_recovery_body: 'After a reload, the camera check and personal calibration must be completed again.', runtime_recovery_action: 'Go to camera check',
        runtime_instruction_title: 'Instructions', runtime_instruction_action: 'Start', runtime_block_complete_title: 'Block completed', runtime_block_complete_body: 'The block data has been saved. Instructions for the next block will follow.', runtime_block_complete_action: 'Continue',
        runtime_dismiss: 'Dismiss notification', runtime_continuous_start_failed: 'Camera analysis could not start. Return to the camera check and try again.', runtime_generic_technical: 'A technical analysis error occurred.', runtime_generic_quality: 'Measurement conditions temporarily do not meet the requirements.',
        runtime_repeat_trials_title: 'Some trials must be repeated', runtime_repeat_block_title: 'Block must be repeated', runtime_repeat_reason_prefix: 'Reasons', runtime_repeat_trials_suffix: 'Only the invalid trials will be repeated.', runtime_repeat_block_body: 'The previous attempt was not accepted. Correct the conditions before continuing.', runtime_repeat_limit_title: 'Repeat limit reached', runtime_repeat_limit_body: 'The remaining trials are marked invalid; the session will continue without another loop.'
    },
    zh: {
        runtime_policy_title: '测试条件', runtime_policy_body: '请勿在移动的车辆、黑暗、强背光、躺卧或面部被遮挡时参加研究。允许短暂自然的头部动作。质量不足时只会重复受影响的部分。', runtime_policy_note: '仅可在说明页面暂停，任务进行时不能暂停。',
        runtime_continue: '继续', runtime_pause: '暂停', runtime_resume: '继续会话', runtime_repeat_block_action: '条件已恢复，重复该区块', runtime_repeat_trials_action: '重复无效试次', runtime_repeat_limit_action: '继续会话',
        runtime_recovery_title: '会话已恢复', runtime_recovery_body: '页面重新加载后，必须重新完成摄像头检查和个人校准。', runtime_recovery_action: '前往摄像头检查', runtime_instruction_title: '说明', runtime_instruction_action: '开始', runtime_block_complete_title: '区块已完成', runtime_block_complete_body: '区块数据已保存，接下来将显示下一区块的说明。', runtime_block_complete_action: '继续',
        runtime_dismiss: '关闭通知', runtime_continuous_start_failed: '无法启动摄像头分析。请返回摄像头检查后重试。', runtime_generic_technical: '分析发生技术错误。', runtime_generic_quality: '当前测量条件不符合要求。', runtime_repeat_trials_title: '部分试次需要重复', runtime_repeat_block_title: '需要重复该区块', runtime_repeat_reason_prefix: '原因', runtime_repeat_trials_suffix: '只会重复无效试次。', runtime_repeat_block_body: '上一次尝试未被接受。请先调整条件。', runtime_repeat_limit_title: '已达到重复上限', runtime_repeat_limit_body: '剩余试次将标记为无效，会话将继续。'
    },
    es: {
        runtime_policy_title: 'Condiciones de la prueba', runtime_policy_body: 'No realice el estudio en un vehículo en movimiento, a oscuras, con contraluz intenso, tumbado ni con el rostro cubierto. Se permiten movimientos naturales breves de la cabeza. Si la calidad baja, solo se repetirá la parte afectada.', runtime_policy_note: 'La pausa solo está disponible en las pantallas de instrucciones.',
        runtime_continue: 'Continuar', runtime_pause: 'Pausa', runtime_resume: 'Continuar la sesión', runtime_repeat_block_action: 'Condiciones restablecidas, repetir bloque', runtime_repeat_trials_action: 'Repetir ensayos no válidos', runtime_repeat_limit_action: 'Continuar la sesión',
        runtime_recovery_title: 'Sesión restaurada', runtime_recovery_body: 'Tras recargar la página debe repetir la comprobación de cámara y la calibración.', runtime_recovery_action: 'Ir a la comprobación de cámara', runtime_instruction_title: 'Instrucciones', runtime_instruction_action: 'Comenzar', runtime_block_complete_title: 'Bloque completado', runtime_block_complete_body: 'Los datos se han guardado. A continuación verá las instrucciones del siguiente bloque.', runtime_block_complete_action: 'Continuar',
        runtime_dismiss: 'Cerrar aviso', runtime_continuous_start_failed: 'No se pudo iniciar el análisis de cámara. Vuelva a la comprobación e inténtelo de nuevo.', runtime_generic_technical: 'Se produjo un error técnico de análisis.', runtime_generic_quality: 'Las condiciones de medición no cumplen temporalmente los requisitos.', runtime_repeat_trials_title: 'Deben repetirse algunos ensayos', runtime_repeat_block_title: 'Debe repetirse el bloque', runtime_repeat_reason_prefix: 'Motivos', runtime_repeat_trials_suffix: 'Solo se repetirán los ensayos no válidos.', runtime_repeat_block_body: 'El intento anterior no fue aceptado. Corrija las condiciones.', runtime_repeat_limit_title: 'Se alcanzó el límite de repeticiones', runtime_repeat_limit_body: 'Los ensayos restantes quedan marcados como no válidos y la sesión continuará.'
    },
    hi: {
        runtime_policy_title: 'परीक्षण की शर्तें', runtime_policy_body: 'चलते वाहन, अंधेरे, तेज़ पीछे की रोशनी, लेटे हुए या चेहरा ढका होने पर अध्ययन न करें। थोड़ी स्वाभाविक सिर की गति स्वीकार्य है। गुणवत्ता कम होने पर केवल प्रभावित भाग दोहराया जाएगा।', runtime_policy_note: 'विराम केवल निर्देश स्क्रीन पर उपलब्ध है।',
        runtime_continue: 'आगे बढ़ें', runtime_pause: 'विराम', runtime_resume: 'सत्र जारी रखें', runtime_repeat_block_action: 'स्थिति ठीक है, ब्लॉक दोहराएँ', runtime_repeat_trials_action: 'अमान्य परीक्षण दोहराएँ', runtime_repeat_limit_action: 'सत्र जारी रखें',
        runtime_recovery_title: 'सत्र पुनर्स्थापित हुआ', runtime_recovery_body: 'पेज फिर लोड होने के बाद कैमरा जाँच और व्यक्तिगत कैलिब्रेशन दोबारा करना होगा।', runtime_recovery_action: 'कैमरा जाँच पर जाएँ', runtime_instruction_title: 'निर्देश', runtime_instruction_action: 'शुरू करें', runtime_block_complete_title: 'ब्लॉक पूरा हुआ', runtime_block_complete_body: 'ब्लॉक का डेटा सहेजा गया। अगला निर्देश दिखाया जाएगा।', runtime_block_complete_action: 'आगे',
        runtime_dismiss: 'सूचना बंद करें', runtime_continuous_start_failed: 'कैमरा विश्लेषण शुरू नहीं हुआ। कैमरा जाँच पर लौटें और फिर प्रयास करें।', runtime_generic_technical: 'विश्लेषण में तकनीकी त्रुटि हुई।', runtime_generic_quality: 'मापन की स्थिति अभी आवश्यकताओं के अनुरूप नहीं है।', runtime_repeat_trials_title: 'कुछ परीक्षण दोहराने होंगे', runtime_repeat_block_title: 'ब्लॉक दोहराना होगा', runtime_repeat_reason_prefix: 'कारण', runtime_repeat_trials_suffix: 'केवल अमान्य परीक्षण दोहराए जाएँगे।', runtime_repeat_block_body: 'पिछला प्रयास स्वीकार नहीं हुआ। पहले स्थिति ठीक करें।', runtime_repeat_limit_title: 'दोहराव की सीमा पूरी हुई', runtime_repeat_limit_body: 'बाकी परीक्षण अमान्य चिह्नित होंगे और सत्र जारी रहेगा।'
    },
    ar: {
        runtime_policy_title: 'شروط الاختبار', runtime_policy_body: 'لا تُجرِ الدراسة في مركبة متحركة أو في الظلام أو مع إضاءة خلفية قوية أو أثناء الاستلقاء أو تغطية الوجه. يُسمح بحركات الرأس الطبيعية القصيرة. عند انخفاض الجودة سيُعاد الجزء المتأثر فقط.', runtime_policy_note: 'يتوفر الإيقاف المؤقت في شاشات التعليمات فقط.',
        runtime_continue: 'متابعة', runtime_pause: 'إيقاف مؤقت', runtime_resume: 'متابعة الجلسة', runtime_repeat_block_action: 'تم تصحيح الظروف، أعد المقطع', runtime_repeat_trials_action: 'إعادة المحاولات غير الصالحة', runtime_repeat_limit_action: 'متابعة الجلسة',
        runtime_recovery_title: 'تمت استعادة الجلسة', runtime_recovery_body: 'بعد إعادة تحميل الصفحة يجب تكرار فحص الكاميرا والمعايرة الشخصية.', runtime_recovery_action: 'الانتقال إلى فحص الكاميرا', runtime_instruction_title: 'التعليمات', runtime_instruction_action: 'ابدأ', runtime_block_complete_title: 'اكتمل المقطع', runtime_block_complete_body: 'تم حفظ بيانات المقطع وستظهر تعليمات المقطع التالي.', runtime_block_complete_action: 'متابعة',
        runtime_dismiss: 'إغلاق الإشعار', runtime_continuous_start_failed: 'تعذر بدء تحليل الكاميرا. ارجع إلى فحص الكاميرا وحاول مجددًا.', runtime_generic_technical: 'حدث خطأ تقني في التحليل.', runtime_generic_quality: 'ظروف القياس لا تستوفي المتطلبات مؤقتًا.', runtime_repeat_trials_title: 'يجب إعادة بعض المحاولات', runtime_repeat_block_title: 'يجب إعادة المقطع', runtime_repeat_reason_prefix: 'الأسباب', runtime_repeat_trials_suffix: 'ستُعاد المحاولات غير الصالحة فقط.', runtime_repeat_block_body: 'لم تُقبل المحاولة السابقة. صحح الظروف أولًا.', runtime_repeat_limit_title: 'تم بلوغ حد الإعادة', runtime_repeat_limit_body: 'ستبقى المحاولات المتبقية غير صالحة وستستمر الجلسة.'
    },
    fr: {
        runtime_policy_title: 'Conditions du test', runtime_policy_body: 'Ne réalisez pas l’étude dans un véhicule en mouvement, dans l’obscurité, à contre-jour, allongé(e) ou avec le visage masqué. Les mouvements naturels brefs de la tête sont permis. Seule la partie affectée sera répétée.', runtime_policy_note: 'La pause est disponible uniquement sur les écrans d’instructions.',
        runtime_continue: 'Continuer', runtime_pause: 'Pause', runtime_resume: 'Reprendre la session', runtime_repeat_block_action: 'Conditions rétablies, répéter le bloc', runtime_repeat_trials_action: 'Répéter les essais invalides', runtime_repeat_limit_action: 'Continuer la session',
        runtime_recovery_title: 'Session restaurée', runtime_recovery_body: 'Après un rechargement, le contrôle de la caméra et l’étalonnage doivent être recommencés.', runtime_recovery_action: 'Aller au contrôle de la caméra', runtime_instruction_title: 'Instructions', runtime_instruction_action: 'Commencer', runtime_block_complete_title: 'Bloc terminé', runtime_block_complete_body: 'Les données sont enregistrées. Les instructions du bloc suivant vont s’afficher.', runtime_block_complete_action: 'Continuer',
        runtime_dismiss: 'Fermer la notification', runtime_continuous_start_failed: 'L’analyse de la caméra n’a pas pu démarrer. Revenez au contrôle de la caméra et réessayez.', runtime_generic_technical: 'Une erreur technique d’analyse est survenue.', runtime_generic_quality: 'Les conditions de mesure ne satisfont temporairement pas les exigences.', runtime_repeat_trials_title: 'Certains essais doivent être répétés', runtime_repeat_block_title: 'Le bloc doit être répété', runtime_repeat_reason_prefix: 'Raisons', runtime_repeat_trials_suffix: 'Seuls les essais invalides seront répétés.', runtime_repeat_block_body: 'La tentative précédente n’a pas été acceptée. Corrigez les conditions.', runtime_repeat_limit_title: 'Limite de répétition atteinte', runtime_repeat_limit_body: 'Les essais restants sont marqués invalides et la session continuera.'
    },
    bn: {
        runtime_policy_title: 'পরীক্ষার শর্ত', runtime_policy_body: 'চলন্ত যানবাহনে, অন্ধকারে, তীব্র পেছনের আলোতে, শুয়ে বা মুখ ঢাকা অবস্থায় গবেষণায় অংশ নেবেন না। অল্প স্বাভাবিক মাথা নড়াচড়া গ্রহণযোগ্য। মান কমলে শুধু প্রভাবিত অংশ পুনরাবৃত্তি হবে।', runtime_policy_note: 'শুধু নির্দেশনার পর্দায় বিরতি দেওয়া যায়।',
        runtime_continue: 'এগিয়ে যান', runtime_pause: 'বিরতি', runtime_resume: 'সেশন চালিয়ে যান', runtime_repeat_block_action: 'অবস্থা ঠিক হয়েছে, ব্লকটি আবার করুন', runtime_repeat_trials_action: 'অকার্যকর ট্রায়াল আবার করুন', runtime_repeat_limit_action: 'সেশন চালিয়ে যান',
        runtime_recovery_title: 'সেশন পুনরুদ্ধার হয়েছে', runtime_recovery_body: 'পৃষ্ঠা পুনরায় লোড হলে ক্যামেরা পরীক্ষা ও ব্যক্তিগত ক্যালিব্রেশন আবার করতে হবে।', runtime_recovery_action: 'ক্যামেরা পরীক্ষায় যান', runtime_instruction_title: 'নির্দেশনা', runtime_instruction_action: 'শুরু করুন', runtime_block_complete_title: 'ব্লক সম্পন্ন', runtime_block_complete_body: 'ব্লকের তথ্য সংরক্ষিত হয়েছে। পরবর্তী নির্দেশনা দেখানো হবে।', runtime_block_complete_action: 'এগিয়ে যান',
        runtime_dismiss: 'বার্তা বন্ধ করুন', runtime_continuous_start_failed: 'ক্যামেরা বিশ্লেষণ শুরু হয়নি। ক্যামেরা পরীক্ষায় ফিরে আবার চেষ্টা করুন।', runtime_generic_technical: 'বিশ্লেষণে প্রযুক্তিগত ত্রুটি হয়েছে।', runtime_generic_quality: 'পরিমাপের অবস্থা এখন প্রয়োজনীয় মান পূরণ করছে না।', runtime_repeat_trials_title: 'কিছু ট্রায়াল আবার করতে হবে', runtime_repeat_block_title: 'ব্লকটি আবার করতে হবে', runtime_repeat_reason_prefix: 'কারণ', runtime_repeat_trials_suffix: 'শুধু অকার্যকর ট্রায়ালগুলো আবার হবে।', runtime_repeat_block_body: 'আগের প্রচেষ্টা গ্রহণ করা হয়নি। আগে অবস্থা ঠিক করুন।', runtime_repeat_limit_title: 'পুনরাবৃত্তির সীমা পূর্ণ', runtime_repeat_limit_body: 'বাকি ট্রায়াল অকার্যকর হিসেবে চিহ্নিত থাকবে এবং সেশন চলবে।'
    },
    pt: {
        runtime_policy_title: 'Condições do teste', runtime_policy_body: 'Não realize o estudo num veículo em movimento, no escuro, com contraluz forte, deitado ou com o rosto coberto. Movimentos naturais breves da cabeça são permitidos. Apenas a parte afetada será repetida.', runtime_policy_note: 'A pausa só está disponível nos ecrãs de instruções.',
        runtime_continue: 'Continuar', runtime_pause: 'Pausa', runtime_resume: 'Retomar sessão', runtime_repeat_block_action: 'Condições restabelecidas, repetir bloco', runtime_repeat_trials_action: 'Repetir tentativas inválidas', runtime_repeat_limit_action: 'Continuar sessão',
        runtime_recovery_title: 'Sessão restaurada', runtime_recovery_body: 'Após recarregar, a verificação da câmara e a calibração devem ser repetidas.', runtime_recovery_action: 'Ir para a verificação da câmara', runtime_instruction_title: 'Instruções', runtime_instruction_action: 'Começar', runtime_block_complete_title: 'Bloco concluído', runtime_block_complete_body: 'Os dados foram guardados. A seguir verá as instruções do próximo bloco.', runtime_block_complete_action: 'Continuar',
        runtime_dismiss: 'Fechar aviso', runtime_continuous_start_failed: 'Não foi possível iniciar a análise da câmara. Volte à verificação e tente novamente.', runtime_generic_technical: 'Ocorreu um erro técnico de análise.', runtime_generic_quality: 'As condições de medição não cumprem temporariamente os requisitos.', runtime_repeat_trials_title: 'Algumas tentativas devem ser repetidas', runtime_repeat_block_title: 'O bloco deve ser repetido', runtime_repeat_reason_prefix: 'Motivos', runtime_repeat_trials_suffix: 'Apenas as tentativas inválidas serão repetidas.', runtime_repeat_block_body: 'A tentativa anterior não foi aceite. Corrija as condições.', runtime_repeat_limit_title: 'Limite de repetições atingido', runtime_repeat_limit_body: 'As tentativas restantes ficam inválidas e a sessão continuará.'
    },
    ur: {
        runtime_policy_title: 'ٹیسٹ کی شرائط', runtime_policy_body: 'چلتی گاڑی، اندھیرے، تیز پچھلی روشنی، لیٹے ہوئے یا چہرہ ڈھکا ہونے کی حالت میں مطالعہ نہ کریں۔ سر کی مختصر قدرتی حرکت قابل قبول ہے۔ معیار کم ہونے پر صرف متاثرہ حصہ دہرایا جائے گا۔', runtime_policy_note: 'وقفہ صرف ہدایات کی اسکرین پر دستیاب ہے۔',
        runtime_continue: 'جاری رکھیں', runtime_pause: 'وقفہ', runtime_resume: 'سیشن جاری رکھیں', runtime_repeat_block_action: 'حالات درست ہیں، بلاک دہرائیں', runtime_repeat_trials_action: 'غلط آزمائشیں دہرائیں', runtime_repeat_limit_action: 'سیشن جاری رکھیں',
        runtime_recovery_title: 'سیشن بحال ہو گیا', runtime_recovery_body: 'صفحہ دوبارہ لوڈ ہونے کے بعد کیمرہ چیک اور ذاتی کیلیبریشن دوبارہ کرنا ضروری ہے۔', runtime_recovery_action: 'کیمرہ چیک پر جائیں', runtime_instruction_title: 'ہدایات', runtime_instruction_action: 'شروع کریں', runtime_block_complete_title: 'بلاک مکمل', runtime_block_complete_body: 'بلاک کا ڈیٹا محفوظ ہو گیا۔ اگلی ہدایات دکھائی جائیں گی۔', runtime_block_complete_action: 'جاری رکھیں',
        runtime_dismiss: 'اطلاع بند کریں', runtime_continuous_start_failed: 'کیمرہ تجزیہ شروع نہیں ہو سکا۔ کیمرہ چیک پر واپس جا کر دوبارہ کوشش کریں۔', runtime_generic_technical: 'تجزیے میں تکنیکی خرابی ہوئی۔', runtime_generic_quality: 'پیمائش کی حالت فی الحال مطلوبہ معیار پر نہیں۔', runtime_repeat_trials_title: 'کچھ آزمائشیں دوبارہ کرنا ہوں گی', runtime_repeat_block_title: 'بلاک دوبارہ کرنا ہوگا', runtime_repeat_reason_prefix: 'وجوہات', runtime_repeat_trials_suffix: 'صرف غلط آزمائشیں دہرائی جائیں گی۔', runtime_repeat_block_body: 'پچھلی کوشش قبول نہیں ہوئی۔ پہلے حالات درست کریں۔', runtime_repeat_limit_title: 'دہرانے کی حد مکمل', runtime_repeat_limit_body: 'باقی آزمائشیں غلط نشان زد رہیں گی اور سیشن جاری رہے گا۔'
    }
};

const participantResponseLocaleAdditions = {
    ru: {
        runtime_standard_instruction_body: 'Внимательно следуйте правилу задания. Отвечайте только после появления стимула.',
        runtime_response_method: 'Способ ответа', runtime_response_space: 'нажмите Пробел', runtime_response_left: 'нажмите стрелку влево', runtime_response_right: 'нажмите стрелку вправо', runtime_response_down: 'нажмите стрелку вниз', runtime_response_up: 'нажмите стрелку вверх', runtime_response_click: 'нажмите левую кнопку мыши', runtime_response_pointer: 'начните осознанное движение мышью', runtime_response_none: 'ничего не нажимайте', runtime_response_withhold: 'Для части стимулов ответ не требуется.', runtime_feedback_correct: 'Верно', runtime_feedback_incorrect: 'Ошибка'
    },
    en: {
        runtime_standard_instruction_body: 'Follow the task rule carefully. Respond only after the stimulus appears.',
        runtime_response_method: 'Response method', runtime_response_space: 'press Space', runtime_response_left: 'press the Left Arrow', runtime_response_right: 'press the Right Arrow', runtime_response_down: 'press the Down Arrow', runtime_response_up: 'press the Up Arrow', runtime_response_click: 'click the left mouse button', runtime_response_pointer: 'start a deliberate mouse movement', runtime_response_none: 'do not press anything', runtime_response_withhold: 'Some stimuli require no response.', runtime_feedback_correct: 'Correct', runtime_feedback_incorrect: 'Incorrect'
    },
    zh: {
        runtime_standard_instruction_body: '请仔细遵循任务规则，仅在刺激出现后作答。',
        runtime_response_method: '作答方式', runtime_response_space: '按空格键', runtime_response_left: '按左方向键', runtime_response_right: '按右方向键', runtime_response_down: '按下方向键', runtime_response_up: '按上方向键', runtime_response_click: '单击鼠标左键', runtime_response_pointer: '开始有意识地移动鼠标', runtime_response_none: '不要按任何键', runtime_response_withhold: '部分刺激无需作答。', runtime_feedback_correct: '正确', runtime_feedback_incorrect: '错误'
    },
    es: {
        runtime_standard_instruction_body: 'Siga atentamente la regla de la tarea. Responda solo después de que aparezca el estímulo.',
        runtime_response_method: 'Método de respuesta', runtime_response_space: 'pulse Espacio', runtime_response_left: 'pulse Flecha izquierda', runtime_response_right: 'pulse Flecha derecha', runtime_response_down: 'pulse Flecha abajo', runtime_response_up: 'pulse Flecha arriba', runtime_response_click: 'haga clic con el botón izquierdo', runtime_response_pointer: 'inicie un movimiento intencionado del ratón', runtime_response_none: 'no pulse nada', runtime_response_withhold: 'Algunos estímulos no requieren respuesta.', runtime_feedback_correct: 'Correcto', runtime_feedback_incorrect: 'Incorrecto'
    },
    hi: {
        runtime_standard_instruction_body: 'कार्य के नियम का ध्यान से पालन करें। उद्दीपन दिखाई देने के बाद ही उत्तर दें।',
        runtime_response_method: 'उत्तर देने का तरीका', runtime_response_space: 'स्पेस दबाएँ', runtime_response_left: 'बायाँ तीर दबाएँ', runtime_response_right: 'दायाँ तीर दबाएँ', runtime_response_down: 'नीचे तीर दबाएँ', runtime_response_up: 'ऊपर तीर दबाएँ', runtime_response_click: 'माउस का बायाँ बटन क्लिक करें', runtime_response_pointer: 'माउस को जानबूझकर चलाना शुरू करें', runtime_response_none: 'कुछ न दबाएँ', runtime_response_withhold: 'कुछ उद्दीपनों पर उत्तर नहीं देना है।', runtime_feedback_correct: 'सही', runtime_feedback_incorrect: 'गलत'
    },
    ar: {
        runtime_standard_instruction_body: 'اتبع قاعدة المهمة بعناية ولا تستجب إلا بعد ظهور المنبه.',
        runtime_response_method: 'طريقة الاستجابة', runtime_response_space: 'اضغط مفتاح المسافة', runtime_response_left: 'اضغط السهم الأيسر', runtime_response_right: 'اضغط السهم الأيمن', runtime_response_down: 'اضغط السهم لأسفل', runtime_response_up: 'اضغط السهم لأعلى', runtime_response_click: 'انقر بزر الفأرة الأيسر', runtime_response_pointer: 'ابدأ حركة مقصودة بالفأرة', runtime_response_none: 'لا تضغط شيئًا', runtime_response_withhold: 'بعض المنبهات لا تتطلب استجابة.', runtime_feedback_correct: 'صحيح', runtime_feedback_incorrect: 'خطأ'
    },
    fr: {
        runtime_standard_instruction_body: 'Suivez attentivement la règle de la tâche. Répondez uniquement après l’apparition du stimulus.',
        runtime_response_method: 'Mode de réponse', runtime_response_space: 'appuyez sur Espace', runtime_response_left: 'appuyez sur Flèche gauche', runtime_response_right: 'appuyez sur Flèche droite', runtime_response_down: 'appuyez sur Flèche bas', runtime_response_up: 'appuyez sur Flèche haut', runtime_response_click: 'cliquez avec le bouton gauche', runtime_response_pointer: 'commencez un mouvement volontaire de la souris', runtime_response_none: 'n’appuyez sur rien', runtime_response_withhold: 'Certains stimuli ne nécessitent aucune réponse.', runtime_feedback_correct: 'Correct', runtime_feedback_incorrect: 'Incorrect'
    },
    bn: {
        runtime_standard_instruction_body: 'কাজের নিয়ম মনোযোগ দিয়ে অনুসরণ করুন। উদ্দীপনা দেখানোর পরেই উত্তর দিন।',
        runtime_response_method: 'উত্তরের পদ্ধতি', runtime_response_space: 'স্পেস চাপুন', runtime_response_left: 'বাঁ তীর চাপুন', runtime_response_right: 'ডান তীর চাপুন', runtime_response_down: 'নিচের তীর চাপুন', runtime_response_up: 'উপরের তীর চাপুন', runtime_response_click: 'মাউসের বাঁ বোতামে ক্লিক করুন', runtime_response_pointer: 'ইচ্ছাকৃতভাবে মাউস নড়ানো শুরু করুন', runtime_response_none: 'কিছু চাপবেন না', runtime_response_withhold: 'কিছু উদ্দীপনায় উত্তর দিতে হবে না।', runtime_feedback_correct: 'সঠিক', runtime_feedback_incorrect: 'ভুল'
    },
    pt: {
        runtime_standard_instruction_body: 'Siga atentamente a regra da tarefa. Responda apenas depois de o estímulo aparecer.',
        runtime_response_method: 'Modo de resposta', runtime_response_space: 'prima Espaço', runtime_response_left: 'prima Seta esquerda', runtime_response_right: 'prima Seta direita', runtime_response_down: 'prima Seta para baixo', runtime_response_up: 'prima Seta para cima', runtime_response_click: 'clique com o botão esquerdo', runtime_response_pointer: 'inicie um movimento intencional do rato', runtime_response_none: 'não prima nada', runtime_response_withhold: 'Alguns estímulos não exigem resposta.', runtime_feedback_correct: 'Correto', runtime_feedback_incorrect: 'Incorreto'
    },
    ur: {
        runtime_standard_instruction_body: 'کام کے اصول پر غور سے عمل کریں۔ محرک ظاہر ہونے کے بعد ہی جواب دیں۔',
        runtime_response_method: 'جواب کا طریقہ', runtime_response_space: 'اسپیس دبائیں', runtime_response_left: 'بایاں تیر دبائیں', runtime_response_right: 'دایاں تیر دبائیں', runtime_response_down: 'نیچے کا تیر دبائیں', runtime_response_up: 'اوپر کا تیر دبائیں', runtime_response_click: 'ماؤس کا بایاں بٹن کلک کریں', runtime_response_pointer: 'جان بوجھ کر ماؤس چلانا شروع کریں', runtime_response_none: 'کچھ نہ دبائیں', runtime_response_withhold: 'کچھ محرکات پر جواب نہیں دینا۔', runtime_feedback_correct: 'درست', runtime_feedback_incorrect: 'غلط'
    }
};

const participantSurveyLocaleAdditions = {
    ru: { runtime_survey_title: 'Опрос', runtime_survey_configuration_error: 'Опрос настроен некорректно. Ошибка записана в технический журнал; этот экран можно пропустить.', runtime_survey_translation_missing: 'Для выбранного языка нет проверенного перевода этого опроса. Экран будет пропущен, а исследователь получит уведомление.', runtime_survey_required_label: 'обязательный вопрос', runtime_survey_open_placeholder: 'Введите ответ', runtime_survey_privacy: 'Не указывайте ФИО, телефон, адрес электронной почты и другие прямые идентификаторы.', runtime_survey_pii_error: 'Удалите персональные контактные данные из ответа.', runtime_survey_required_error: 'Ответьте на обязательный вопрос.' },
    en: { runtime_survey_title: 'Survey', runtime_survey_configuration_error: 'This survey is configured incorrectly. The error was recorded; you may skip this screen.', runtime_survey_translation_missing: 'This survey has no verified translation for the selected language. It will be skipped and the researcher will be notified.', runtime_survey_required_label: 'required question', runtime_survey_open_placeholder: 'Enter your answer', runtime_survey_privacy: 'Do not enter names, phone numbers, email addresses, or other direct identifiers.', runtime_survey_pii_error: 'Remove personal contact data from the answer.', runtime_survey_required_error: 'Answer this required question.' },
    zh: { runtime_survey_title: '问卷', runtime_survey_configuration_error: '问卷配置不正确。错误已记录；您可以跳过此页面。', runtime_survey_translation_missing: '该问卷没有所选语言的审核译文。页面将被跳过并通知研究人员。', runtime_survey_required_label: '必答题', runtime_survey_open_placeholder: '请输入答案', runtime_survey_privacy: '请勿填写姓名、电话号码、电子邮箱或其他直接身份信息。', runtime_survey_pii_error: '请删除答案中的个人联系信息。', runtime_survey_required_error: '请回答必答题。' },
    es: { runtime_survey_title: 'Encuesta', runtime_survey_configuration_error: 'La encuesta está configurada incorrectamente. El error se registró; puede omitir esta pantalla.', runtime_survey_translation_missing: 'Esta encuesta no tiene una traducción verificada para el idioma elegido. Se omitirá y se avisará al investigador.', runtime_survey_required_label: 'pregunta obligatoria', runtime_survey_open_placeholder: 'Escriba su respuesta', runtime_survey_privacy: 'No introduzca nombres, teléfonos, correos electrónicos ni otros identificadores directos.', runtime_survey_pii_error: 'Elimine los datos personales de contacto de la respuesta.', runtime_survey_required_error: 'Responda a esta pregunta obligatoria.' },
    hi: { runtime_survey_title: 'सर्वेक्षण', runtime_survey_configuration_error: 'सर्वेक्षण सही ढंग से कॉन्फ़िगर नहीं है। त्रुटि दर्ज हो गई है; आप यह स्क्रीन छोड़ सकते हैं।', runtime_survey_translation_missing: 'चुनी हुई भाषा में इस सर्वेक्षण का सत्यापित अनुवाद उपलब्ध नहीं है। इसे छोड़ दिया जाएगा और शोधकर्ता को सूचित किया जाएगा।', runtime_survey_required_label: 'अनिवार्य प्रश्न', runtime_survey_open_placeholder: 'अपना उत्तर लिखें', runtime_survey_privacy: 'नाम, फ़ोन, ईमेल या अन्य प्रत्यक्ष पहचानकर्ता दर्ज न करें।', runtime_survey_pii_error: 'उत्तर से व्यक्तिगत संपर्क जानकारी हटाएँ।', runtime_survey_required_error: 'अनिवार्य प्रश्न का उत्तर दें।' },
    ar: { runtime_survey_title: 'استبيان', runtime_survey_configuration_error: 'إعداد الاستبيان غير صحيح. سُجل الخطأ ويمكنك تخطي هذه الشاشة.', runtime_survey_translation_missing: 'لا توجد ترجمة موثقة لهذا الاستبيان باللغة المختارة. سيتم تخطيه وإبلاغ الباحث.', runtime_survey_required_label: 'سؤال مطلوب', runtime_survey_open_placeholder: 'أدخل إجابتك', runtime_survey_privacy: 'لا تدخل الاسم أو الهاتف أو البريد الإلكتروني أو أي معرّفات مباشرة أخرى.', runtime_survey_pii_error: 'احذف بيانات الاتصال الشخصية من الإجابة.', runtime_survey_required_error: 'أجب عن السؤال المطلوب.' },
    fr: { runtime_survey_title: 'Questionnaire', runtime_survey_configuration_error: 'Ce questionnaire est mal configuré. L’erreur a été enregistrée ; vous pouvez ignorer cet écran.', runtime_survey_translation_missing: 'Ce questionnaire ne possède pas de traduction vérifiée dans la langue choisie. Il sera ignoré et le chercheur sera averti.', runtime_survey_required_label: 'question obligatoire', runtime_survey_open_placeholder: 'Saisissez votre réponse', runtime_survey_privacy: 'N’indiquez pas de nom, téléphone, adresse e-mail ou autre identifiant direct.', runtime_survey_pii_error: 'Supprimez les coordonnées personnelles de la réponse.', runtime_survey_required_error: 'Répondez à cette question obligatoire.' },
    bn: { runtime_survey_title: 'জরিপ', runtime_survey_configuration_error: 'জরিপটি সঠিকভাবে কনফিগার করা নেই। ত্রুটি নথিভুক্ত হয়েছে; আপনি এই পর্দা এড়িয়ে যেতে পারেন।', runtime_survey_translation_missing: 'নির্বাচিত ভাষায় এই জরিপের যাচাইকৃত অনুবাদ নেই। এটি এড়িয়ে গবেষককে জানানো হবে।', runtime_survey_required_label: 'আবশ্যিক প্রশ্ন', runtime_survey_open_placeholder: 'আপনার উত্তর লিখুন', runtime_survey_privacy: 'নাম, ফোন, ইমেইল বা অন্য কোনো সরাসরি পরিচয়সূচক লিখবেন না।', runtime_survey_pii_error: 'উত্তর থেকে ব্যক্তিগত যোগাযোগের তথ্য সরান।', runtime_survey_required_error: 'আবশ্যিক প্রশ্নের উত্তর দিন।' },
    pt: { runtime_survey_title: 'Questionário', runtime_survey_configuration_error: 'O questionário está configurado incorretamente. O erro foi registado; pode ignorar este ecrã.', runtime_survey_translation_missing: 'Este questionário não tem uma tradução verificada para o idioma escolhido. Será ignorado e o investigador será avisado.', runtime_survey_required_label: 'pergunta obrigatória', runtime_survey_open_placeholder: 'Introduza a sua resposta', runtime_survey_privacy: 'Não introduza nomes, telefones, e-mails ou outros identificadores diretos.', runtime_survey_pii_error: 'Remova os dados pessoais de contacto da resposta.', runtime_survey_required_error: 'Responda à pergunta obrigatória.' },
    ur: { runtime_survey_title: 'سروے', runtime_survey_configuration_error: 'سروے درست طور پر ترتیب نہیں دیا گیا۔ خرابی درج ہو گئی ہے؛ آپ اس اسکرین کو چھوڑ سکتے ہیں۔', runtime_survey_translation_missing: 'منتخب زبان میں اس سروے کا تصدیق شدہ ترجمہ موجود نہیں۔ اسے چھوڑ دیا جائے گا اور محقق کو اطلاع دی جائے گی۔', runtime_survey_required_label: 'لازمی سوال', runtime_survey_open_placeholder: 'اپنا جواب درج کریں', runtime_survey_privacy: 'نام، فون، ای میل یا دیگر براہ راست شناختی معلومات درج نہ کریں۔', runtime_survey_pii_error: 'جواب سے ذاتی رابطے کی معلومات ہٹا دیں۔', runtime_survey_required_error: 'لازمی سوال کا جواب دیں۔' }
};

const participantUploadLocaleAdditions = {
    ru: { runtime_recalibrate: 'Повторить калибровку', runtime_upload_retry_action: 'Отправить результаты ещё раз', runtime_upload_preparing: 'Подготовка к отправке данных…', runtime_upload_attempt: 'Загрузка данных: попытка {attempt}/{retries}…', runtime_upload_retry_wait: 'Ошибка отправки. Повтор через {seconds} с…', runtime_upload_success: 'Данные успешно загружены на сервер.', runtime_upload_failure: 'Не удалось загрузить данные автоматически. Проверьте сеть и сохраните JSON локально.', runtime_upload_prepare_failure: 'Не удалось подготовить данные для отправки.', runtime_upload_retrying: 'Повторная отправка итоговых данных…' },
    en: { runtime_recalibrate: 'Recalibrate', runtime_upload_retry_action: 'Send results again', runtime_upload_preparing: 'Preparing data for upload…', runtime_upload_attempt: 'Uploading data: attempt {attempt}/{retries}…', runtime_upload_retry_wait: 'Upload failed. Retrying in {seconds} s…', runtime_upload_success: 'Data uploaded successfully.', runtime_upload_failure: 'Automatic upload failed. Check the connection and save the JSON locally.', runtime_upload_prepare_failure: 'The data could not be prepared for upload.', runtime_upload_retrying: 'Sending the final data again…' },
    zh: { runtime_recalibrate: '重新校准', runtime_upload_retry_action: '再次发送结果', runtime_upload_preparing: '正在准备上传数据…', runtime_upload_attempt: '正在上传数据：第 {attempt}/{retries} 次…', runtime_upload_retry_wait: '上传失败，将在 {seconds} 秒后重试…', runtime_upload_success: '数据已成功上传。', runtime_upload_failure: '自动上传失败。请检查网络并在本地保存 JSON。', runtime_upload_prepare_failure: '无法准备要上传的数据。', runtime_upload_retrying: '正在重新发送最终数据…' },
    es: { runtime_recalibrate: 'Repetir calibración', runtime_upload_retry_action: 'Volver a enviar los resultados', runtime_upload_preparing: 'Preparando los datos para el envío…', runtime_upload_attempt: 'Cargando datos: intento {attempt}/{retries}…', runtime_upload_retry_wait: 'Error de envío. Nuevo intento en {seconds} s…', runtime_upload_success: 'Los datos se cargaron correctamente.', runtime_upload_failure: 'La carga automática falló. Compruebe la conexión y guarde el JSON localmente.', runtime_upload_prepare_failure: 'No se pudieron preparar los datos para el envío.', runtime_upload_retrying: 'Volviendo a enviar los datos finales…' },
    hi: { runtime_recalibrate: 'फिर कैलिब्रेट करें', runtime_upload_retry_action: 'परिणाम फिर भेजें', runtime_upload_preparing: 'अपलोड के लिए डेटा तैयार हो रहा है…', runtime_upload_attempt: 'डेटा अपलोड हो रहा है: प्रयास {attempt}/{retries}…', runtime_upload_retry_wait: 'अपलोड विफल। {seconds} सेकंड में फिर प्रयास होगा…', runtime_upload_success: 'डेटा सफलतापूर्वक अपलोड हुआ।', runtime_upload_failure: 'स्वचालित अपलोड विफल रहा। कनेक्शन जाँचें और JSON को स्थानीय रूप से सहेजें।', runtime_upload_prepare_failure: 'अपलोड के लिए डेटा तैयार नहीं किया जा सका।', runtime_upload_retrying: 'अंतिम डेटा फिर भेजा जा रहा है…' },
    ar: { runtime_recalibrate: 'إعادة المعايرة', runtime_upload_retry_action: 'إرسال النتائج مرة أخرى', runtime_upload_preparing: 'جارٍ تجهيز البيانات للرفع…', runtime_upload_attempt: 'جارٍ رفع البيانات: المحاولة {attempt}/{retries}…', runtime_upload_retry_wait: 'فشل الرفع. ستتم المحاولة بعد {seconds} ث…', runtime_upload_success: 'تم رفع البيانات بنجاح.', runtime_upload_failure: 'فشل الرفع التلقائي. تحقق من الاتصال واحفظ ملف JSON محليًا.', runtime_upload_prepare_failure: 'تعذر تجهيز البيانات للرفع.', runtime_upload_retrying: 'جارٍ إعادة إرسال البيانات النهائية…' },
    fr: { runtime_recalibrate: 'Recalibrer', runtime_upload_retry_action: 'Renvoyer les résultats', runtime_upload_preparing: 'Préparation des données à envoyer…', runtime_upload_attempt: 'Téléversement des données : tentative {attempt}/{retries}…', runtime_upload_retry_wait: 'Échec de l’envoi. Nouvelle tentative dans {seconds} s…', runtime_upload_success: 'Les données ont été envoyées.', runtime_upload_failure: 'L’envoi automatique a échoué. Vérifiez la connexion et enregistrez le JSON localement.', runtime_upload_prepare_failure: 'Impossible de préparer les données à envoyer.', runtime_upload_retrying: 'Nouvel envoi des données finales…' },
    bn: { runtime_recalibrate: 'আবার ক্যালিব্রেট করুন', runtime_upload_retry_action: 'ফলাফল আবার পাঠান', runtime_upload_preparing: 'আপলোডের জন্য ডেটা প্রস্তুত হচ্ছে…', runtime_upload_attempt: 'ডেটা আপলোড হচ্ছে: প্রচেষ্টা {attempt}/{retries}…', runtime_upload_retry_wait: 'আপলোড ব্যর্থ। {seconds} সেকেন্ড পরে আবার চেষ্টা হবে…', runtime_upload_success: 'ডেটা সফলভাবে আপলোড হয়েছে।', runtime_upload_failure: 'স্বয়ংক্রিয় আপলোড ব্যর্থ হয়েছে। সংযোগ পরীক্ষা করুন এবং JSON স্থানীয়ভাবে সংরক্ষণ করুন।', runtime_upload_prepare_failure: 'আপলোডের জন্য ডেটা প্রস্তুত করা যায়নি।', runtime_upload_retrying: 'চূড়ান্ত ডেটা আবার পাঠানো হচ্ছে…' },
    pt: { runtime_recalibrate: 'Recalibrar', runtime_upload_retry_action: 'Enviar os resultados novamente', runtime_upload_preparing: 'A preparar os dados para envio…', runtime_upload_attempt: 'A carregar dados: tentativa {attempt}/{retries}…', runtime_upload_retry_wait: 'Falha no envio. Nova tentativa em {seconds} s…', runtime_upload_success: 'Dados enviados com sucesso.', runtime_upload_failure: 'O envio automático falhou. Verifique a ligação e guarde o JSON localmente.', runtime_upload_prepare_failure: 'Não foi possível preparar os dados para envio.', runtime_upload_retrying: 'A reenviar os dados finais…' },
    ur: { runtime_recalibrate: 'دوبارہ کیلیبریٹ کریں', runtime_upload_retry_action: 'نتائج دوبارہ بھیجیں', runtime_upload_preparing: 'اپ لوڈ کے لیے ڈیٹا تیار ہو رہا ہے…', runtime_upload_attempt: 'ڈیٹا اپ لوڈ ہو رہا ہے: کوشش {attempt}/{retries}…', runtime_upload_retry_wait: 'اپ لوڈ ناکام۔ {seconds} سیکنڈ بعد دوبارہ کوشش ہوگی…', runtime_upload_success: 'ڈیٹا کامیابی سے اپ لوڈ ہو گیا۔', runtime_upload_failure: 'خودکار اپ لوڈ ناکام ہوا۔ کنکشن چیک کریں اور JSON مقامی طور پر محفوظ کریں۔', runtime_upload_prepare_failure: 'اپ لوڈ کے لیے ڈیٹا تیار نہیں ہو سکا۔', runtime_upload_retrying: 'حتمی ڈیٹا دوبارہ بھیجا جا رہا ہے…' }
};

const participantValidationLocaleAdditions = {
    ru: { validation_intro_kicker: 'Проверка точности', validation_intro_title: 'Теперь проверим взгляд', validation_intro_body: 'Смотрите на каждый зелёный круг до его перемещения. Нажимать на круги или клавиши не нужно.', validation_intro_action: 'Начать проверку', validation_result_passed_advice: 'Точность достаточная. Повторять калибровку не нужно; можно продолжить сессию.', validation_result_failed_advice: 'Точность ниже допустимого уровня. Повторите калибровку перед продолжением.' },
    en: { validation_intro_kicker: 'Accuracy check', validation_intro_title: 'Now we will check your gaze', validation_intro_body: 'Look at each green circle until it moves. Do not click the circles or press any keys.', validation_intro_action: 'Start the check', validation_result_passed_advice: 'Accuracy is sufficient. You do not need to recalibrate and may continue the session.', validation_result_failed_advice: 'Accuracy is below the required level. Recalibrate before continuing.' },
    zh: { validation_intro_kicker: '准确度检查', validation_intro_title: '现在检查视线', validation_intro_body: '注视每个绿色圆点，直到它移动。请勿点击圆点或按键。', validation_intro_action: '开始检查', validation_result_passed_advice: '准确度符合要求，无需重新校准，可以继续。', validation_result_failed_advice: '准确度低于要求，请先重新校准。' },
    es: { validation_intro_kicker: 'Comprobación de precisión', validation_intro_title: 'Ahora comprobaremos la mirada', validation_intro_body: 'Mire cada círculo verde hasta que se mueva. No haga clic ni pulse ninguna tecla.', validation_intro_action: 'Iniciar comprobación', validation_result_passed_advice: 'La precisión es suficiente. No necesita recalibrar y puede continuar.', validation_result_failed_advice: 'La precisión está por debajo del nivel requerido. Repita la calibración.' },
    hi: { validation_intro_kicker: 'सटीकता जाँच', validation_intro_title: 'अब नज़र की जाँच होगी', validation_intro_body: 'हर हरे गोले को उसके हिलने तक देखें। क्लिक या कोई कुंजी न दबाएँ।', validation_intro_action: 'जाँच शुरू करें', validation_result_passed_advice: 'सटीकता पर्याप्त है। दोबारा कैलिब्रेशन की ज़रूरत नहीं है।', validation_result_failed_advice: 'सटीकता आवश्यक स्तर से कम है। कैलिब्रेशन दोहराएँ।' },
    ar: { validation_intro_kicker: 'فحص الدقة', validation_intro_title: 'سنفحص اتجاه النظر الآن', validation_intro_body: 'انظر إلى كل دائرة خضراء حتى تنتقل. لا تنقر ولا تضغط أي مفتاح.', validation_intro_action: 'بدء الفحص', validation_result_passed_advice: 'الدقة كافية. لا حاجة لإعادة المعايرة ويمكنك المتابعة.', validation_result_failed_advice: 'الدقة أقل من المستوى المطلوب. أعد المعايرة قبل المتابعة.' },
    fr: { validation_intro_kicker: 'Contrôle de précision', validation_intro_title: 'Nous allons vérifier votre regard', validation_intro_body: 'Regardez chaque cercle vert jusqu’à son déplacement. Ne cliquez pas et n’appuyez sur aucune touche.', validation_intro_action: 'Démarrer le contrôle', validation_result_passed_advice: 'La précision est suffisante. Il n’est pas nécessaire de recalibrer.', validation_result_failed_advice: 'La précision est insuffisante. Recalibrez avant de continuer.' },
    bn: { validation_intro_kicker: 'নির্ভুলতা পরীক্ষা', validation_intro_title: 'এখন দৃষ্টি পরীক্ষা করা হবে', validation_intro_body: 'প্রতিটি সবুজ বৃত্ত সরে যাওয়া পর্যন্ত তাকিয়ে থাকুন। ক্লিক বা কোনো কী চাপবেন না।', validation_intro_action: 'পরীক্ষা শুরু করুন', validation_result_passed_advice: 'নির্ভুলতা যথেষ্ট। আবার ক্যালিব্রেশন দরকার নেই।', validation_result_failed_advice: 'নির্ভুলতা প্রয়োজনীয় মাত্রার নিচে। আবার ক্যালিব্রেশন করুন।' },
    pt: { validation_intro_kicker: 'Verificação de precisão', validation_intro_title: 'Agora vamos verificar o olhar', validation_intro_body: 'Olhe para cada círculo verde até ele mudar de posição. Não clique nem prima teclas.', validation_intro_action: 'Iniciar verificação', validation_result_passed_advice: 'A precisão é suficiente. Não é necessário recalibrar.', validation_result_failed_advice: 'A precisão está abaixo do nível exigido. Recalibre antes de continuar.' },
    ur: { validation_intro_kicker: 'درستگی کی جانچ', validation_intro_title: 'اب نگاہ کی جانچ ہوگی', validation_intro_body: 'ہر سبز دائرے کو اس کے منتقل ہونے تک دیکھیں۔ کلک یا کوئی کلید نہ دبائیں۔', validation_intro_action: 'جانچ شروع کریں', validation_result_passed_advice: 'درستگی کافی ہے۔ دوبارہ کیلیبریشن کی ضرورت نہیں۔', validation_result_failed_advice: 'درستگی مطلوبہ سطح سے کم ہے۔ دوبارہ کیلیبریٹ کریں۔' }
};

const participantProtocolErrorLocaleAdditions = {
    ru: { runtime_protocol_start_failure_title: 'Техническая ошибка протокола', runtime_protocol_start_failure_body: 'Не удалось открыть следующий блок. Проверьте соединение и попробуйте снова. Сессия не завершена.', runtime_protocol_retry_action: 'Повторить попытку' },
    en: { runtime_protocol_start_failure_title: 'Protocol technical error', runtime_protocol_start_failure_body: 'The next block could not be opened. Check the connection and try again. The session is not complete.', runtime_protocol_retry_action: 'Try again' },
    zh: { runtime_protocol_start_failure_title: '协议技术错误', runtime_protocol_start_failure_body: '无法打开下一个区块。请检查连接后重试。会话尚未完成。', runtime_protocol_retry_action: '重试' },
    es: { runtime_protocol_start_failure_title: 'Error técnico del protocolo', runtime_protocol_start_failure_body: 'No se pudo abrir el siguiente bloque. Compruebe la conexión e inténtelo de nuevo. La sesión no está completa.', runtime_protocol_retry_action: 'Intentar de nuevo' },
    hi: { runtime_protocol_start_failure_title: 'प्रोटोकॉल की तकनीकी त्रुटि', runtime_protocol_start_failure_body: 'अगला ब्लॉक नहीं खुल सका। कनेक्शन जाँचें और फिर प्रयास करें। सत्र पूरा नहीं हुआ है।', runtime_protocol_retry_action: 'फिर प्रयास करें' },
    ar: { runtime_protocol_start_failure_title: 'خطأ تقني في البروتوكول', runtime_protocol_start_failure_body: 'تعذر فتح المقطع التالي. تحقق من الاتصال وحاول مرة أخرى. الجلسة غير مكتملة.', runtime_protocol_retry_action: 'المحاولة مرة أخرى' },
    fr: { runtime_protocol_start_failure_title: 'Erreur technique du protocole', runtime_protocol_start_failure_body: 'Le bloc suivant n’a pas pu être ouvert. Vérifiez la connexion et réessayez. La session n’est pas terminée.', runtime_protocol_retry_action: 'Réessayer' },
    bn: { runtime_protocol_start_failure_title: 'প্রোটোকলের প্রযুক্তিগত ত্রুটি', runtime_protocol_start_failure_body: 'পরবর্তী ব্লক খোলা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন। সেশন সম্পূর্ণ হয়নি।', runtime_protocol_retry_action: 'আবার চেষ্টা করুন' },
    pt: { runtime_protocol_start_failure_title: 'Erro técnico do protocolo', runtime_protocol_start_failure_body: 'Não foi possível abrir o bloco seguinte. Verifique a ligação e tente novamente. A sessão não está concluída.', runtime_protocol_retry_action: 'Tentar novamente' },
    ur: { runtime_protocol_start_failure_title: 'پروٹوکول کی تکنیکی خرابی', runtime_protocol_start_failure_body: 'اگلا بلاک نہیں کھل سکا۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔ سیشن مکمل نہیں ہوا۔', runtime_protocol_retry_action: 'دوبارہ کوشش کریں' }
};

Object.entries(participantSessionLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});
Object.entries(participantRuntimeLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});
Object.entries(participantResponseLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});
Object.entries(participantSurveyLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});
Object.entries(participantUploadLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});
Object.entries(participantValidationLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});
Object.entries(participantProtocolErrorLocaleAdditions).forEach(([locale, additions]) => {
    Object.assign(translations[locale], additions);
});

export const participantLocales = ['ru', 'en', 'zh', 'es', 'hi', 'ar', 'fr', 'bn', 'pt', 'ur'];
