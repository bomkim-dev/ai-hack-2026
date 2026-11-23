# Pantry and cooking integration

The pantry stores ingredients and tools in local storage. In normal mode, it recommends a supported recipe or checks the recipe picked in the selector. If bacon is unavailable and tuna is available, the recommendation is tuna one-pan pasta. It checks for the deep frying pan required by that recipe.

Starting from the pantry creates a one-time, same-tab handoff in session storage with the selected protein, method, ingredients, and tools. The cooking page consumes it and maps the selection to a recipe in [recipes.js](./recipes.js). Direct starts can choose either recipe and do not read or deduct stock.

## Browser and HTTP contract

| Function | Input | Output |
| --- | --- | --- |
| `startCooking` | Recipe selection and optional abort signal | `{ state, stepId, message, timer, done }` |
| `handleUtterance` | Japanese utterance, previous state, optional abort signal | Same |
| `handleTimerElapsed` | Previous state, optional abort signal | Same |

- `GET /api/cooking?recipe=tuna-one-pan` initializes the tuna recipe. The default without a recipe parameter is `bacon-standard`.
- `POST /api/cooking` accepts `{ utterance, progress }` or `{ event: 'timerElapsed', progress }`. Progress carries `recipeId`. Older bacon progress without a recipe ID uses the default. The server validates step IDs for the selected recipe and returns `{ progress, guidance, timer, finished }`.
- The timer is `{ action: 'start', durationSeconds, endsAt }`, `{ action: 'cancel' }`, or `null`. The deadline is Unix milliseconds. On expiry, the bacon recipe guides the cook to drain the pasta. The tuna recipe guides the cook to check the pasta and turn off the heat without draining it.
- `POST /api/transcribe` uses Aqua Voice to transcribe browser audio. Gemini interprets progress reports using only the selected recipe's steps. The cooking server selects guidance and controls the timer.

## Confirm actual usage

The guide stages usage only after a pantry-started recipe is plated. The completion screen shows the ingredients in that recipe and deducts the user's confirmed quantities once per cooking session. Opening the screen or skipping confirmation leaves quantities unchanged.
