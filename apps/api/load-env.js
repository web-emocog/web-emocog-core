/**
 * Загрузка .env из каталога apps/api (путь от __dirname, не от process.cwd).
 * override: true — переменные из файла перекрывают окружение процесса; иначе пустой
 * JWT_SECRET из PM2 мог блокировать актуальное значение из .env (dotenv по умолчанию не перезаписывает).
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: true });
} else {
  require('dotenv').config();
}
