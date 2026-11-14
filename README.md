# Job Autofill AI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](manifest.json)

A privacy-first browser extension (Chrome, Edge, Brave, and Firefox) that reads the job application form on the page you are viewing (without taking screenshots), sends the form fields, job description text, and your local profile to **Google Gemini**, **DeepSeek**, or **any OpenAI-compatible API**, and suggests tailored answers for every field. Review, edit, copy individual fields, or click **Fill all on page**.

**Repository:** [https://github.com/Sandun-S/Job-Autofill-AI](https://github.com/Sandun-S/Job-Autofill-AI)  
**Author:** [Sandun-S](https://github.com/Sandun-S)

---

## Features

- **Multi-provider AI support:** Works with Google Gemini (`gemini-2.5-flash` default), DeepSeek (`deepseek-chat` default), or any custom OpenAI-compatible endpoint (OpenAI, OpenRouter, local LLMs, etc.).
- **Multiple profiles:** Maintain separate profiles (with their own CV text, career goals, and preferences) for different target roles.
- **Broad form & iframe support:** Handles standard inputs, textareas, `<select>` dropdowns, radio buttons, checkboxes, and React-Select style custom dropdowns (e.g., Greenhouse), including inside cross-origin iframes.
- **Multi-step forms:** Use **Fill & Next step** to fill the current page, advance to the next step (never clicking Submit/Apply), and re-scan the new step for review.
- **Saved answers ("Missing data"):** If the AI cannot answer a field, enter it once in the popup and click **Save for later & fill** to store it in Saved Answers for future applications.
- **Application log:** Tracks applications (`In progress`, `Applied`, `Interview`, `Offer`, `Rejected`, `Withdrawn`) with links, notes, dates, and CSV export.
- **Local-only storage:** All profiles, API keys, saved answers, and logs are stored locally in `storage.local`.

---

## Install

### 1. Get the code

```bash
git clone https://github.com/Sandun-S/Job-Autofill-AI.git
cd Job-Autofill-AI
```

Or download the repository ZIP from [GitHub](https://github.com/Sandun-S/Job-Autofill-AI) and extract it.

### 2. Load in your browser

**Chrome / Edge / Brave**
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `Job-Autofill-AI` folder.

**Firefox (128+)**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `manifest.json` inside the `Job-Autofill-AI` folder.  
   *(Temporary add-ons are removed when Firefox restarts. For a permanent install, the add-on must be signed via addons.mozilla.org as "unlisted".)*
3. If requests fail with a permission error, go to `about:addons` > **Job Autofill AI** > **Permissions** and allow access to the API sites.

---

## First-time setup

1. Click the extension icon, then **Settings / profile** (or open the extension's options page).
2. Pick an AI provider and paste your API key:
   - **Gemini:** [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   - **DeepSeek:** [https://platform.deepseek.com](https://platform.deepseek.com)
   - **Custom (OpenAI-compatible):** Enter your Base URL (e.g., `https://api.openai.com/v1` or `https://openrouter.ai/api/v1`), API key, and model name.
3. Fill in your profile: personal data, **Target roles**, **Career goals**, preferences, writing tone, and paste your CV text.
4. Click **Save everything**.

---

## Using it

1. Open a job application form.
2. Click the extension icon, choose a profile, and press **Scan & suggest**.
3. Review and edit the suggested values, then use **Copy** per field, **Fill**, or **Fill all on page**.
4. Submit the application yourself — **the extension never clicks Submit**.

---

## Notes and limits

- File upload fields (e.g., CV PDF) and password fields are skipped on purpose; attach your CV manually.
- Forms embedded from another domain (e.g., Greenhouse in an iframe) require the "all sites" permission, which the extension requests. Allow it when prompted.
- Custom dropdowns (React-Select style) are supported: the extension opens each one, reads its options, and selects the matching value. Unusual custom widgets may still require using the **Copy** button.
- Always review AI-generated answers before submitting, especially salary expectations, work authorization, and legal/EEO questions.

---

## Privacy

- Everything is stored locally in your browser (`storage.local`).
- Your CV, profile, and API keys are sent **only** to the AI provider you configure, and **only** when you click **Scan & suggest**.

---

## Contributing

Contributions, bug reports, and feature suggestions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, or open an issue on [GitHub](https://github.com/Sandun-S/Job-Autofill-AI/issues).

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
