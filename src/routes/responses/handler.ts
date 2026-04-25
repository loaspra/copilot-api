import type { Context } from "hono"

import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createChatCompletions } from "~/services/copilot/create-chat-completions"

import {
  type ResponsesCreatePayload,
  translateChatCompletionToResponse,
  translateResponsesToChatCompletions,
} from "./translation"

export async function handleResponse(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesCreatePayload>()
  consola.debug(
    "Responses request payload:",
    JSON.stringify(payload).slice(-400),
  )

  const openAIPayload = translateResponsesToChatCompletions(payload)
  consola.debug(
    "Translated chat completions payload:",
    JSON.stringify(openAIPayload).slice(-400),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)
  if (!isNonStreaming(response)) {
    throw new Error("Streaming /v1/responses is not implemented")
  }

  const translatedResponse = translateChatCompletionToResponse(
    response,
    payload,
  )
  consola.debug(
    "Translated responses payload:",
    JSON.stringify(translatedResponse).slice(-400),
  )

  return c.json(translatedResponse)
}

function isNonStreaming(
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is Parameters<typeof translateChatCompletionToResponse>[0] {
  return Object.hasOwn(response, "choices")
}
