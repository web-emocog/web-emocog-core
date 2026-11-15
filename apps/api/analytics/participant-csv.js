'use strict';

const { escapeCsv } = require('../security/csv');

const columns = [
  ['rt.mean', 'Среднее время реакции, мс', 'Mean reaction time, ms'],
  ['rt.median', 'Медиана времени реакции, мс', 'Median reaction time, ms'],
  ['rt.sd', 'Разброс времени реакции, мс', 'Reaction time SD, ms'],
  ['rt.q90', '90-й процентиль времени реакции, мс', 'Reaction time 90th percentile, ms'],
  ['task.accuracy', 'Правильные ответы, %', 'Correct responses, %', 100],
  ['physiology.bpm', 'Пульс, уд/мин', 'Pulse, bpm'],
  ['physiology.respiration', 'Частота дыхания, дых/мин', 'Respiration, breaths/min'],
  ['blink.rate', 'Частота морганий, в мин', 'Blink rate, per min'],
  ['blink.duration', 'Длительность морганий, мс', 'Blink duration, ms'],
  ['blink.incompletePct', 'Неполные моргания, %', 'Incomplete blinks, %'],
  ['body.lean', 'Наклон корпуса, градусы', 'Torso inclination, degrees'],
  ['body.shoulders', 'Наклон плеч, градусы', 'Shoulder inclination, degrees'],
  ['body.bursts', 'Всплески движения', 'Movement bursts'],
  ['face.valence', 'Индекс направления мимики', 'Facial valence index'],
  ['audio.pitch', 'Высота голоса, Гц', 'Voice pitch, Hz'],
  ['audio.speechFraction', 'Доля речи, %', 'Speech share, %', 100],
  ['survey.duration', 'Время заполнения анкеты, мс', 'Survey completion time, ms'],
  ['gaze.transitionCount', 'Переходы взгляда за показ', 'Gaze transitions per presentation'],
  ['gaze.spatialEntropy', 'Разброс взгляда, бит', 'Gaze spatial entropy, bits'],
];

function participantCsv(data, en = false) {
  const people = Array.isArray(data.participants) ? data.participants : [];
  const scales = (data.plan?.surveyScoring || []).map((scale, index) => [
    'survey.score.' + scale.id, 'Баллы анкеты ' + (index + 1), 'Survey score ' + (index + 1),
  ]);
  const available = [...columns, ...scales].filter(([id]) => people.some(person =>
    Object.hasOwn(person.metrics || {}, id) && Number.isFinite(person.metrics[id])));
  const header = [en ? 'Participant' : 'Участник', en ? 'Sessions in selection' : 'Сессий в выборке',
    ...available.map(column => column[en ? 2 : 1])];
  const rows = people.map(person => [person.id, person.sessions?.length ?? null,
    ...available.map(([id, , , factor = 1]) => Number.isFinite(person.metrics?.[id])
      ? Number((person.metrics[id] * factor).toFixed(6)) : null)]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
}

module.exports = { participantCsv };
