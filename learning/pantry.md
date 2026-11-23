# How the optional pantry works

The [pantry screen](../pantry.html) edits the stock, equipment, shopping list and dates held in the current browser. A row can store availability or a count, and the user's cooking flow can bypass pantry storage entirely.

[Pantry data](../pantry-data.js) uses the recorded ingredients and tools to choose a supported pasta variant. Choosing a variant prepares a one-time, same-tab handoff to the cooking screen. The [integration notes](../pantry-integration.md) describe what the cooking UI needs to read and how the completion screen can ask the user to confirm actual usage. A uniquely identified cook can only deduct the confirmed quantity once.

The expiry label represents the date printed on the package. The UI flags a nearby or elapsed date and leaves the recorded quantity intact.
