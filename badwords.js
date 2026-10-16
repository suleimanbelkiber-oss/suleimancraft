/**
 * badwords.js — список запрещённых слов.
 */

const BAD_WORDS = [
  // Русский мат
  'хуй', 'хуя', 'хую', 'хуе', 'хуи', 'хуё',
  'пизд', 'пизж',
  'бляд', 'блят', 'блядь', 'бля',
  'ебат', 'ебал', 'ебан', 'ебуч', 'ебал', 'ебло', 'ебуч',
  'ёбат', 'ёбал', 'ёбан',
  'муд', 'мудак', 'мудил',
  'гандон', 'гондон',
  'залуп',
  'манда', 'мандав',
  'срак', 'срать', 'срал',
  'жоп', 'жопу', 'жопы',
  'дроч', 'дрочи',
  'шлюх', 'шлюшк',
  'пидор', 'пидар', 'пидр', 'педик',
  'нахуй', 'нахуя', 'нахуй',
  'похуй', 'похуя',
  'охуе', 'охуен',
  'ахуе', 'ахуен',
  'вхуя', 'вхуяч',
  'въеб', 'въебал',
  'выеб', 'выебал',
  'долбоёб', 'долбоеб',
  'хер', 'херн',
  'курв', 'курва',
  'мразь', 'мрази',
  'тварь', 'твари',
  'ублюд',
  'нигер', 'ниггер',
  'чурка', 'чурк',
  'хохол', 'хохл',
  'москал',
  // Английский
  'fuck', 'fuk', 'fck', 'phuck',
  'shit', 'sh1t',
  'bitch', 'b1tch',
  'asshole', 'asshol',
  'dick', 'd1ck',
  'pussy', 'puss1',
  'cunt', 'c0nt',
  'cock', 'c0ck',
  'nigger', 'nigga',
  'faggot', 'fag',
  'whore', 'slut',
  'bastard',
  'damn',
];

// Заменяем все буквы в словах на нижний регистр для поиска
const NORMALIZED = BAD_WORDS.map(w => w.toLowerCase());

/**
 * Проверяет текст и заменяет мат на ***.
 * @param {string} text
 * @returns {{clean: string, found: boolean}}
 */
function filterBadWords(text) {
  let clean = text;
  let found = false;

  // Нормализуем: убираем пробелы, знаки препинания, заменяем латиницу похожую на кириллицу
  const normalized = text.toLowerCase()
    .replace(/[^а-яa-z0-9]/g, '')
    .replace(/a/g, 'а')
    .replace(/e/g, 'е')
    .replace(/o/g, 'о')
    .replace(/p/g, 'р')
    .replace(/c/g, 'с')
    .replace(/x/g, 'х')
    .replace(/y/g, 'у')
    .replace(/k/g, 'к')
    .replace(/m/g, 'м')
    .replace(/t/g, 'т')
    .replace(/h/g, 'н')
    .replace(/b/g, 'в')
    .replace(/0/g, 'о')
    .replace(/1/g, 'и')
    .replace(/3/g, 'з')
    .replace(/4/g, 'а')
    .replace(/5/g, 's')
    .replace(/6/g, 'б')
    .replace(/7/g, 'т')
    .replace(/8/g, 'в')
    .replace(/9/g, 'д');

  for (const word of NORMALIZED) {
    if (normalized.includes(word)) {
      found = true;

      // Заменяем в оригинальном тексте все вхождения (по частям)
      const regex = new RegExp(
        word.split('').map(c => c + '[\\s\\W_]*').join(''),
        'gi'
      );
      clean = clean.replace(regex, '*'.repeat(word.length));
    }
  }

  return { clean, found };
}

module.exports = { filterBadWords, BAD_WORDS };
