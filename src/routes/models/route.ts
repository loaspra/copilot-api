import { Hono } from "hono"

import type { Model } from "~/services/copilot/get-models"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

const isChatCompletionsCandidate = (model: Model) => {
  if (model.id.startsWith("text-embedding-")) return false

  if (model.supported_endpoints?.length) {
    return model.supported_endpoints.includes("/chat/completions")
  }

  return true
}

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    const models = state.models?.data
      .filter((model) => isChatCompletionsCandidate(model))
      .map((model) => ({
        id: model.id,
        object: "model",
        type: "model",
        created: 0, // No date available from source
        created_at: new Date(0).toISOString(), // No date available from source
        owned_by: model.vendor,
        display_name: model.name,
      }))

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
