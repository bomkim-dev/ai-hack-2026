# How hands-free conversation works

The [cooking page](../app.js) opens the microphone when the user starts conversation mode. [The capture worklet](../voice-capture.js) collects short frames. [The turn detector](../conversation.js) keeps a short buffer in front of speech and closes the utterance after a short silence. It sends the resulting WAV to the same Aqua Voice endpoint as manual recording, then sends the transcript to the existing Gemini-backed cooking guide.

While a request is in flight or the browser is reading guidance, the app disables the microphone track and discards unsent samples. When both finish it listens again. A timer alert has priority over the next listening window. Stopping, resetting, switching tabs, or finishing the recipe closes the microphone stream. Microphone and API errors leave typed input available.

The detector uses sound level. Steady background noise and nearby speech need to be checked in the intended kitchen because quiet isolated test audio does not establish performance there.
