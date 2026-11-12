# Светлана — управление расписанием (Android)

Мобильное приложение для мастера: отмечает занято/свободно → сайт показывает это клиентам.

## Настройка (боевой сервер)

1. На VPS в `.env` задан `MASTER_TOKEN` (см. `.env.example` в корне проекта).
2. В приложении: вкладка **Настройки**
   - URL: `https://test-fas.ru`
   - Токен: тот же `MASTER_TOKEN`, что на сервере
3. **Проверить связь** → **Сохранить**.

Для локальной отладки можно указать `http://IP_ВАШЕГО_ПК:3080` (телефон и ПК в одной Wi‑Fi).

## Разработка

```bash
cd mobile
npm start
```

## Сборка APK

Локально (нужен Android SDK). На Windows задайте короткий `GRADLE_USER_HOME`, иначе путь кэша может превысить 260 символов:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:GRADLE_USER_HOME = "E:\g"
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease -g E:\g
```

Готовый файл:

- `android/app/build/outputs/apk/release/app-release.apk`
- версия: `../releases/svetlana-schedule-1.0.3.apk`
- для сайта: `../releases/svetlana-schedule.apk` (это имя читает `/app-download`)

### Скачать с сайта (без USB)

1. На VPS в `.env` задайте короткий `APK_DOWNLOAD_PIN`.
2. Положите актуальный APK как `releases/svetlana-schedule.apk`.
3. С телефона откройте `https://test-fas.ru/app-download` → введите PIN → скачайте.
4. Разрешите установку из неизвестных источников.

Установка с ПК: скопируйте APK на телефон → разрешите установку из неизвестных источников.

Через EAS (облако Expo):

```bash
npx eas-cli login
npx eas build -p android --profile preview
```
