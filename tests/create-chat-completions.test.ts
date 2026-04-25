import { test, expect, mock } from "bun:test"

import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

let mockJsonResponse: Record<string, unknown> = {
  id: "123",
  object: "chat.completion",
  created: 1,
  choices: [],
}

// Helper to mock fetch
const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string> }) => {
    return {
      ok: true,
      json: () => mockJsonResponse,
      headers: opts.headers,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

test("sets X-Initiator to agent if tool/assistant present", async () => {
  mockJsonResponse = {
    id: "123",
    object: "chat.completion",
    created: 1,
    choices: [],
  }
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  mockJsonResponse = {
    id: "123",
    object: "chat.completion",
    created: 1,
    choices: [],
  }
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[1][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("normalizes non-streaming responses to OpenAI shape", async () => {
  mockJsonResponse = {
    id: "chatcmpl-123",
    model: "gpt-test",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: "Hello!",
          padding: "abcd",
        },
      },
    ],
  }

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-test",
  }

  const response = await createChatCompletions(payload)
  if (!Object.hasOwn(response, "choices")) {
    throw new Error("Expected non-streaming chat completion response")
  }

  const normalizedResponse = response as ChatCompletionResponse

  expect(normalizedResponse.object).toBe("chat.completion")
  expect(typeof normalizedResponse.created).toBe("number")
  expect(normalizedResponse.created).toBeGreaterThan(0)
  expect(normalizedResponse.choices[0]?.message).toEqual({
    role: "assistant",
    content: "Hello!",
  })
})

test("fills missing non-streaming choice index", async () => {
  mockJsonResponse = {
    id: "chatcmpl-456",
    model: "claude-test",
    choices: [
      {
        finish_reason: "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: "Hello from Claude!",
        },
      },
    ],
  }

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "claude-test",
  }

  const response = await createChatCompletions(payload)
  if (!Object.hasOwn(response, "choices")) {
    throw new Error("Expected non-streaming chat completion response")
  }

  const normalizedResponse = response as ChatCompletionResponse
  expect(normalizedResponse.choices[0]?.index).toBe(0)
})
