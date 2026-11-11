# Светлана — управление расписанием (Android)

Мобильное приложение для мастера: отмечает занято/свободно → сайт показывает это клиентам.

## Настройка

1. На сервере задайте `MASTER_TOKEN` (см. `.env.example` в корне проекта).
2. В приложении: вкладка **Настройки**
   - URL: `http://IP_ВАШЕГО_ПК:3080` (телефон и ПК в одной Wi‑Fi)
   - Токен: тот же `MASTER_TOKEN`
3. **Проверить связь** → **Сохранить**.

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
- копия: `../releases/svetlana-schedule-1.0.0.apk`

Установка: скопируйте APK на телефон → разрешите установку из неизвестных источников.

Через EAS (облако Expo):

```bash
npx eas-cli login
npx eas build -p android --profile preview
```
