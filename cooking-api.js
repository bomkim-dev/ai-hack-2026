async function post(path, context, signal) {
  const result = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!result.ok) throw new Error(`Cooking API HTTP ${result.status}`);
  return result.json();
}

export function requestRecipe(context, signal) {
  return post('/api/recipe', context, signal);
}

export async function requestCookingReply(context, signal) {
  const { reply } = await post('/api/cooking-chat', context, signal);
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('Invalid cooking reply');
  return reply;
}
