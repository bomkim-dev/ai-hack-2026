# How the optional pantry works

The [pantry screen](../pantry.html) edits the stock, equipment, shopping list and dates held in the current browser. A row can store availability or a count, and the user's cooking flow can bypass pantry storage entirely.

[Pantry data](../pantry-data.js) uses the recorded ingredients and tools to choose a supported pasta variant. Choosing a variant prepares a one-time, same-tab handoff to the cooking screen. The [integration notes](../pantry-integration.md) describe what the cooking UI needs to read and how the completion screen can ask the user to confirm actual usage. A uniquely identified cook can only deduct the confirmed quantity once.

The expiry label represents the date printed on the package. The UI flags a nearby or elapsed date and leaves the recorded quantity intact.

## How recipes share the cooking guide

[The recipe catalog](../recipes.js) holds each recipe's supported ingredient/equipment pairing, step descriptions, and the step that finishes boiling. [The cooking server](../server/cooking.js) keeps the timer and progress rules shared. It follows the selected order before adding pasta, lets any parallel topping preparation continue during boiling, and chooses the recipe-specific next step when the timer expires.

For tuna one-pan pasta, the expired timer leads to a doneness check and turning off the heat. The cook can request more time before confirming that step. After seasoning and plating, a pantry-started session can deduct the confirmed amount of tuna; bacon is outside that recipe's usage form. This keeps recipe selection, voice guidance, and confirmed inventory changes tied to the same cooking session.
