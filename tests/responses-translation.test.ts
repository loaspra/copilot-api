import { describe, expect, test } from "bun:test"

import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import {
  translateChatCompletionToResponse,
  translateResponsesToChatCompletions,
} from "~/routes/responses/translation"

describe("Responses request translation", () => {
  test("maps messages, function calls, and tool outputs to chat completions", () => {
    const translated = translateResponsesToChatCompletions({
      model: "gpt-5.4",
      instructions: "Be concise.",
      max_output_tokens: 321,
      parallel_tool_calls: true,
      tool_choice: { type: "function", name: "lookup_weather" },
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          description: "Get the weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        },
      ],
      input: [
        {
          role: "user",
          type: "message",
          content: [
            { type: "input_text", text: "What is the weather?" },
            { type: "input_image", image_url: "https://example.com/a.png" },
          ],
        },
        {
          type: "function_call",
          call_id: "call_123",
          name: "lookup_weather",
          arguments: '{"city":"Paris"}',
        },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: "Sunny",
        },
      ],
    })

    expect(translated.model).toBe("gpt-5.4")
    expect(translated.max_completion_tokens).toBe(321)
    expect(translated.tool_choice).toEqual({
      type: "function",
      function: { name: "lookup_weather" },
    })
    expect(translated.messages).toEqual([
      { role: "system", content: "Be concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "What is the weather?" },
          {
            type: "image_url",
            image_url: { url: "https://example.com/a.png" },
          },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "lookup_weather",
              arguments: '{"city":"Paris"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_123",
        content: "Sunny",
      },
    ])
    expect(translated.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup_weather",
          description: "Get the weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        },
      },
    ])
  })
})

describe("Responses response translation", () => {
  test("maps assistant text and tool calls to response output items", () => {
    const response: ChatCompletionResponse = {
      id: "chatcmpl_123",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-5.4",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: "Let me check.",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "lookup_weather",
                  arguments: '{"city":"Paris"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }

    const translated = translateChatCompletionToResponse(response, {
      model: "gpt-5.4",
      parallel_tool_calls: true,
      tool_choice: "auto",
      tools: [],
    })

    expect(translated).toEqual({
      id: "resp_chatcmpl_123",
      created_at: 1700000000,
      model: "gpt-5.4",
      object: "response",
      output: [
        {
          id: "msg_chatcmpl_123_0",
          content: [
            {
              annotations: [],
              text: "Let me check.",
              type: "output_text",
            },
          ],
          role: "assistant",
          status: "completed",
          type: "message",
        },
        {
          arguments: '{"city":"Paris"}',
          call_id: "call_123",
          id: "call_123",
          name: "lookup_weather",
          status: "completed",
          type: "function_call",
        },
      ],
      parallel_tool_calls: true,
      status: "completed",
      tool_choice: "auto",
      tools: [],
    })
  })
})
