// Participant copy for a rejected calibration click or a changed viewport.
const feedback = {
    ru: ['Размер видимой области или масштаб изменился. Оставьте окно в удобном размере и повторите калибровку.',
        'Не хватило подходящих кадров. Смотрите в центр круга и нажмите ещё раз.'],
    en: ['The visible area or zoom changed. Set the window to a comfortable size and recalibrate.',
        'There were not enough usable frames. Look at the centre of the circle and click again.'],
    zh: ['可视区域或缩放比例已改变。请将窗口调整到合适大小，然后重新校准。',
        '可用帧不足。请看着圆心并再次点击。'],
    es: ['El área visible o el zoom ha cambiado. Ajuste la ventana a un tamaño cómodo y vuelva a calibrar.',
        'No se obtuvieron suficientes fotogramas utilizables. Mire el centro del círculo y vuelva a pulsar.'],
    hi: ['दिखाई देने वाला क्षेत्र या ज़ूम बदल गया है। विंडो का आकार सुविधाजनक रखें और फिर से कैलिब्रेट करें।',
        'पर्याप्त उपयोगी फ़्रेम नहीं मिले। वृत्त के केंद्र पर देखें और फिर से क्लिक करें।'],
    ar: ['تغيّرت مساحة العرض أو نسبة التكبير. اضبط النافذة على حجم مناسب ثم أعد المعايرة.',
        'لم تتوفر إطارات صالحة كافية. انظر إلى مركز الدائرة وانقر مجددًا.'],
    fr: ['La zone visible ou le zoom a changé. Ajustez la fenêtre à une taille confortable, puis recalibrez.',
        'Le nombre d’images exploitables était insuffisant. Regardez le centre du cercle et cliquez de nouveau.'],
    bn: ['দৃশ্যমান অংশ বা জুম বদলেছে। উইন্ডোটি সুবিধাজনক আকারে রেখে আবার ক্যালিব্রেট করুন।',
        'পর্যাপ্ত ব্যবহারযোগ্য ফ্রেম পাওয়া যায়নি। বৃত্তের কেন্দ্রে তাকিয়ে আবার ক্লিক করুন।'],
    pt: ['A área visível ou o zoom mudou. Ajuste a janela a um tamanho confortável e volte a calibrar.',
        'Não houve fotogramas utilizáveis suficientes. Olhe para o centro do círculo e clique novamente.'],
    ur: ['دکھائی دینے والا حصہ یا زوم بدل گیا ہے۔ ونڈو کو مناسب سائز پر رکھیں اور دوبارہ کیلیبریٹ کریں۔',
        'کافی قابلِ استعمال فریم نہیں ملے۔ دائرے کے مرکز کو دیکھیں اور دوبارہ کلک کریں۔']
};

export function calibrationFeedback(locale, reason) {
    const index = reason === 'viewport_changed' ? 0 : 1;
    return feedback[locale]?.[index] ?? feedback.en[index];
}
