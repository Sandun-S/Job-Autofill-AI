# Job Autofill AI

Reads the application form on the page you are viewing (no screenshots), sends the form fields, the job text and your profile to Gemini / DeepSeek / any OpenAI-compatible API, and gives you the value for each field. Copy each one, or click **Fill all on page**.

## Install

**Chrome / Edge / Brave**
1. Open `chrome://extensions`, turn on *Developer mode*.
2. Click *Load unpacked* and choose this folder.

**Firefox (128+)**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click *Load Temporary Add-on* and pick `manifest.json` in this folder.
   (Temporary add-ons are removed when Firefox restarts. For a permanent install, the add-on must be signed via addons.mozilla.org as "unlisted".)
3. If requests fail with a permission error: `about:addons` > Job Autofill AI > Permissions, and allow access to the API sites.

## First-time setup
1. Click the extension icon, then *Settings / profile* (or open the extension's options).
2. Pick a provider, paste your API key. Gemini keys: https://aistudio.google.com/apikey. DeepSeek keys: https://platform.deepseek.com
3. Fill in your profile: personal data, **My goals and targets**, preferences, and paste your CV text. Save.

## Using it
1. Open a job application form.
2. Click the extension icon, choose a profile, press **Scan & suggest**.
3. Review/edit the suggestions, then **Copy** per field, or **Fill** / **Fill all on page**.
4. Submit the application yourself. The extension never clicks Submit.

## Notes and limits
- Works on normal inputs, textareas, selects, radios and checkboxes, including inside iframes.
- File upload (CV PDF) and password fields are skipped on purpose; attach your CV manually.
- Forms embedded from another site (e.g. Greenhouse in an iframe) need the "all sites" permission, which the extension requests. If asked, allow it.
- Custom dropdowns (React-Select style, as used by Greenhouse) are supported: the extension opens each one, reads its options, and later picks the match. Very unusual widgets may still need the Copy button.
- Multi-step forms: use **Fill & Next step**. It fills the current step, clicks Next/Continue (never Submit/Apply), waits, then scans the new step and shows fresh suggestions for you to review.
- Everything is stored in this browser (`storage.local`). Your data goes only to the provider you chose.
- **Missing data:** fields the AI could not answer appear in a "Missing data" section in the popup. Type the answer and press "Save for later & fill": it is filled now and stored in Saved answers (editable in Settings), and the AI reuses it on future forms.
- **Application log:** filling a form adds the page to the log as "In progress". Press "Mark as applied" in the popup when you submit, or change the status in the log page (Applied, Interview, Offer, Rejected, Withdrawn). Each entry keeps the link, notes and date. Export as CSV from the log page.
- Always review AI answers, especially salary, work authorization and legal questions.
