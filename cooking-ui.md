# Cooking input and timer

Run `npm start` with Node.js 22 or later and open `http://127.0.0.1:3001/`. In normal mode, set `GEMINI_API_KEY` in the local `.env`. The browser conversation mode also requires `AQUA_API_KEY`.

## Mac dictation

1. In Aqua Voice, use Instant dictation. In the cooking guide, select 「すぐに料理する」 and enable 「Aqua Voice の入力を自動送信」.
2. Focus the input, hold the Aqua Voice key, and say 「お湯は沸いた。玉ねぎは切った。ベーコンはまだ」. Release the key to insert the transcript.
3. Say 「パスタを入れた。7分」. Use 「パスタを入れた。10秒」 to exercise the end alert in a short rehearsal.
4. Follow the spoken guidance through 「ベーコン切った」「炒めた」「湯を切った」「味付けできた」「盛り付けた」.

Auto-send responds to a single paste, replacement, or multi-character insertion once the guide is ready. The browser cannot identify which app produced an input event, so the setting is opt-in. The form's Send button and Enter remain available for ordinary typing, edits, and dictation insertions that do not match those events.

## Browser conversation and demo

Select 「会話を始める」 to use the browser microphone and automatic silence detection. The conversation and Mac auto-send cannot run at the same time. The browser needs a secure context for microphone access.

Open `/?demo=1` for local recipe and timer rehearsal without API keys. Use the same input field to test typing or Mac dictation. The browser's Japanese speech synthesis reads instructions and timer alerts.
