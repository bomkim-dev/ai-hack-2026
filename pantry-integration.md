# Pantry UI integration

This add-on is for role A. It can be served by any static HTTP server alongside the existing cooking UI. It has no dependencies, account setup, or API key.

## Cooking UI boundary

The integrated A preview includes the route and consumption links. It reads the optional one-time selection from `pantry-data.js`, passes confirmed ingredients and tools to the local server, and opens the consumption screen only after that cook completes.

B provides `cooking-logic.js` as a browser ES module. The UI accepts either immediate return values or promises.

| Export | Input | Return |
| --- | --- | --- |
| `startCooking` | `{ protein, method, ingredients, tools, recipe }`. The recipe may be null if the server was unavailable. | `{ state, message, stepId?, recipe? }` |
| `handleUtterance` | Confirmed Japanese text and the last opaque state. | `{ state, message, stepId?, timerSeconds?, done? }`, or `{ needsChat: true }` |

`timerSeconds` is an integer between 1 and 3600. Only the UI starts the timer. Setting `done` after plating triggers a consumption check for pantry-assisted cooks. When the API is unavailable and `startCooking` selects the built-in recipe, B returns that recipe so A can still send it with a later chat request. The chat endpoint should also accept `recipe: null` and derive the built-in recipe from the route if needed. IDs and units in a generated recipe must match the selection. Pasta and bacon use grams, onion uses units of one onion, and tuna uses cans.

The A-side API contract is `POST /api/recipe` with `{ protein, method, ingredients, tools }` and result `{ source, recipe }`. The recipe contains `title`, `ingredients` (`{ id, amount }`), and `steps`. `POST /api/cooking-chat` also receives `recipe`, `stepId`, `question`, and `remainingSeconds`, and returns `{ reply }`. The countdown stays independent of the request, and replies to a session that has ended are discarded. Keep the key on B's server.

## Verify the UI

- Choose quantity tracking for tuna and set it to two cans. Leave onion in availability mode.
- Set pasta and onion to present, bacon and the pot to absent, and a deep frying pan to present. The recommendation is 「ツナ缶と玉ねぎのワンパンパスタ」.
- Add bacon to the shopping list and confirm a purchase. Check that the chosen stock update survived a reload.
- Save a date, then update the date to yesterday or three days from today. Check both expiry messages.
- Start cooking with the selection and check that the cooking UI receives its summary. On completion, confirm one can used and that onion remains. Confirming the same cook a second time leaves the quantities alone.

## Connection check

Chrome passed the client integration with a simulated B module and API. The UI sent the selected route to the recipe endpoint, kept counting down while a cooking reply was delayed, recovered from an unavailable endpoint, and discarded stale replies after reset. Live OpenAI calls, desktop Aqua Voice insertion, and audible Japanese playback still need to be checked on the demo Mac with B's local server.
