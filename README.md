# ObsiCal – Markdown → Google Calendar

**Turn your Obsidian notes into Google Calendar events — just type, save, and go!**

---

## 🚀 Features

- Automatically detects lines ending with #event
- Creates events in Google Calendar with start and end times
- Marks processed lines with ✔ to prevent duplicates
- OAuth authentication for secure access
- Minimal: no buttons, commands, or clutter

## ⚡ Version 1.0

This is ObsiCal v1.0 — a minimal, functional version. Future updates may include:

- Configurable timezones
- Default calendar selection (not just primary)
- Custom event durations
- More flexible date/time parsing

---

## 📝 How to Use

Type a line like this in any Markdown file:
```
Team Sync 202602011000:202602011030 #event

```
- Title: Team Sync
- Start/End: YYYYMMDDHHmm
- Trigger: #event at the end
- After saving, the plugin creates the event and marks the line with ✔

## ⚙️ Settings & OAuth

Go to Settings → ObsiCal and enter:

- Client ID – Google OAuth Client ID
- Client Secret – Google OAuth Client Secret
- Redirect URI – usually http://localhost

### First-time Authentication

1. After typing your first #event line and saving the file, ObsiCal will open a Google OAuth page in your browser.
2. Authorize access to your Google Calendar.
3. Google will redirect to a URL like:

```http://localhost/?code=XXXXXX```

4. Copy the value after `code=` and paste it into the ObsiCal prompt/modal in Obsidian.
5. ObsiCal will store your access & refresh tokens securely. Future events are created automatically.

---

## 📝 Notes

- Only lines ending with #event are processed
- Timezone is currently Europe/Dublin
- Make sure start and end times are 12-digit format: YYYYMMDDHHmm
- Tokens are stored securely in Obsidian plugin data
