# 🚀 Chang'an File Server - Быстрый старт

## **Требования**
- Node.js 18.0+
- Windows/Linux/macOS

## **Установка и запуск**

### 1. Установка зависимостей
```bash
cd changan-file-server
npm install
```

### 2. Запуск сервера

**Development режим (HTTP):**
```bash
npm run dev-local
# Сервер: http://localhost:3001
```

**Production режим (HTTPS):**
```bash
npm start  
# Сервер: https://192.168.137.1:443
```

## **Добавление приложений**

### Автоматически через CLI:
```bash
node scripts/add-app.js \
  --name "YouTube AA" \
  --package "com.carwizard.li.youtube" \
  --apk ./youtube.apk \
  --icon ./icon.png \
  --category "1"
```

### Вручную:
1. Создать папку в `apps/store/my-app/`
2. Добавить `metadata.json`
3. Создать папку `releases/1.0.0/`
4. Добавить `info.json` и `app.apk`
5. Добавить `icon.png`

## **Структура приложения**
```
apps/store/my-app/
├── metadata.json     # Информация о приложении
├── icon.png         # Иконка (512x512)
├── screenshots/     # Скриншоты приложения
└── releases/
    └── 1.0.0/
        ├── info.json    # Информация о версии
        └── app.apk      # APK файл
```

## **Основные команды**

```bash
# Валидация приложений
node scripts/validate-apps.js

# Генерация SSL сертификатов
node scripts/generate-certs.js

# Проверка статуса сервера
curl http://localhost:3001/health
```

## **API эндпоинты Chang'an**

- `GET /hu-apigw/appstore/api/v1/app/list` - Список приложений
- `GET /hu-apigw/appstore/api/v1/app/details` - Детали приложения  
- `GET /hu-apigw/appstore/api/v1/app/query` - Категории приложений
- `GET /static/apks/{app}/{version}/app.apk` - Скачивание APK

## **Для использования в автомобиле Chang'an**

1. Подключитесь к хотспоту автомобиля
2. Установите IP компьютера: `192.168.137.1`
3. Запустите: `npm start`
4. Автомобиль автоматически найдет сервер

## **Готовые примеры**

В проекте уже есть пример приложения **YouTube AA**:
- `apps/store/youtube-aa/`
- ID: `youtube-aa-20250703001`
- Можно использовать как шаблон

---

**🎉 Система готова к работе!** Для подробной документации см. README.md
