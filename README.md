# 🎲 YouTube Random Videos

Everyone knows that on a YouTube channel you can sort your favorite YouTuber's videos by popularity or date — but now you can also sort them randomly! ;)

A lightweight Chrome/Chromium browser extension that adds a **"Casuale" (Random)** option to the sort menu on a YouTube channel's *Videos* tab. Instead of only seeing the newest or most popular uploads, you get the entire public catalog shuffled — including videos from years ago that the algorithm never resurfaces.

![sort menu example](https://img.shields.io/badge/status-personal%20project-lightgrey)
![license](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

- Adds a **"Casuale"** button right next to the native sort options (works both on the dropdown-menu layout and the fixed-chips layout YouTube uses on different channels/screen sizes).
- Fetches the channel's **entire public video catalog** via the YouTube Data API — not just what's already loaded on the page.
- Shows each video with **thumbnail, title, view count, upload date, and duration**, similar to YouTube's native cards.
- **24-hour local cache** per channel, so repeated use doesn't waste API quota.
- **Bring your own API key** — each user's key stays local to their own browser, stored via the extension's Options page. Nothing is shared or sent anywhere except Google's own API.

## 📦 Installation

1. Download or clone this repository.
2. Open `chrome://extensions` (or `opera://extensions` on Opera GX — any Chromium-based browser works).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the folder you downloaded.

## 🔑 Setup (required)

This extension needs a free **YouTube Data API v3** key — it's not bundled with the code for security and quota reasons. Every user needs their own.

Full step-by-step instructions (with screenshots-style walkthrough) are in **[readme.html](./readme.html)** — open it in your browser for the complete guide covering:
- Creating a free API key on Google Cloud Console
- Entering it in the extension's Options page
- Daily quota info (10,000 free requests/day — plenty for personal use)

## 🚀 Usage

1. Go to any YouTube channel.
2. Open the **Videos** tab.
3. Click the new **"Casuale"** option next to "Most recent / Popular / Oldest".
4. First time on a channel it may take a few seconds (downloading the full catalog); after that it's cached for 24 hours.

## ⚠️ Limitations

- Only works on **public** videos — member-only content isn't accessible through a plain API key.
- Very large channels (thousands of videos) take longer on first load since the full catalog has to be fetched page by page.
- YouTube periodically changes its internal page structure; if the button ever stops appearing, please open an issue.

## 🛠️ Tech

Plain JavaScript, Manifest V3, no build step, no external dependencies. Uses `chrome.storage.local` for the API key and caching.

## 📄 License

MIT — see [LICENSE](./LICENSE).


made by claude
