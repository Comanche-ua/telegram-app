# 📋 Контроль дедлайнів — Telegram Mini App

Трекер завдань і дедлайнів, що працює як Telegram Mini App. Локальне зберігання на пристрої, синхронізація через Google Drive, парсинг завдань через Gemini AI.

## 🚀 Швидкий старт

### 1. Розгортання на GitHub Pages

1. Створіть репозиторій на GitHub
2. Завантажте файли з цієї папки в корінь репозиторію
3. У налаштуваннях репозиторію → **Pages** → виберіть:
   - **Source:** GitHub Actions
4. Пуште в `main` — GitHub Actions автоматично задеплоїть на GitHub Pages
5. Отримайте URL: `https://<ваш-нік>.github.io/<репо>/`

### 2. Створення Telegram Mini App

1. Відкрийте [@BotFather](https://t.me/BotFather) у Telegram
2. Створіть нового бота: `/newbot`
3. Після створення бота:
   - `/mybots` → виберіть бота → **Bot Settings** → **Menu Button**
   - Вкажіть URL вашого GitHub Pages
4. Готово! Бот відкриває ваш трекер дедлайнів прямо в Telegram

### 3. Налаштування Google OAuth (для Drive синхронізації)

1. Перейдіть у [Google Cloud Console](https://console.cloud.google.com/)
2. Створіть проект → **APIs & Services** → **Credentials**
3. Створіть OAuth 2.0 Client ID (тип: Web application)
4. Додайте в **Authorized JavaScript origins** URL вашого GitHub Pages
5. Увімкніть **Google Drive API** у Library
6. Скопіюйте Client ID → вставте в налаштуваннях додатку (⚙️ → Безпека)

### 4. Gemini API Key (для AI-парсингу)

1. Отримайте ключ на [Google AI Studio](https://aistudio.google.com/apikey)
2. Вставте в налаштуваннях додатку (⚙️ → AI та дані)

## 📱 Особливості

- **Локальне зберігання:** Усі дані зберігаються в localStorage вашого телефону
- **Офлайн-режим:** Працює без інтернету (PWA Service Worker)
- **Google Drive синк:** Автоматична синхронізація між пристроями
- **AI-парсинг:** Додавайте завдання списком — Gemini розпізнає дати, виконавців
- **Шеринг:** Поділіться списком завдань через WhatsApp/Telegram/будь-який месенджер
- **Темна тема:** Автоматично підлаштовується під тему Telegram

## 🔒 Безпека

- Паролі та API-ключі хешуються (SHA-256) і зберігаються тільки локально
- Google OAuth використовує стандартний протокол — токени не передаються на сторонні сервери
- Усі дані на вашому пристрої

## 🛠 Технічний стек

- Vanilla JS (без фреймворків)
- Telegram WebApp API
- Google Identity Services (OAuth 2.0)
- Google Drive API (синхронізація)
- Google Gemini API (AI-парсинг)
- PWA Service Worker (офлайн)
- GitHub Pages (хостинг)

## 📂 Структура проекту

```
├── index.html          # Основний HTML + CSS (single page app)
├── script.js           # Вся логіка (≈5000 рядків)
├── manifest.json       # PWA маніфест
├── sw.js               # Service Worker для офлайн-режиму
├── .github/workflows/  # GitHub Actions авто-деплой
└── README.md           # Цей файл
```

## 📲 Як поділитися через WhatsApp

1. Натисніть кнопку 📤 у верхній панелі
2. Якщо підтримується Web Share API — відкриється системний діалог
3. Виберіть WhatsApp (або інший месенджер)
4. Якщо Web Share не підтримується — список скопіюється в буфер обміну
