import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
} from "~/services/copilot/create-chat-completions"

interface ResponsesTextContent {
  text: string
  type: "input_text" | "output_text"
}

interface ResponsesImageContent {
  type: "input_image"
  image_url?: string
  detail?: "low" | "high" | "auto" | "original"
}

function isResponsesImageContent(
  part: ResponsesTextContent | ResponsesImageContent,
): part is ResponsesImageContent {
  return part.type === "input_image"
}

interface ResponsesMessageInputItem {
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<ResponsesTextContent | ResponsesImageContent>
  type?: "message"
}

interface ResponsesFunctionCallItem {
  arguments: string
  call_id: string
  name: string
  type: "function_call"
}

interface ResponsesFunctionCallOutputItem {
  call_id: string
  output: string | Array<ResponsesTextContent | ResponsesImageContent>
  type: "function_call_output"
}

type ResponsesInputItem =
  | ResponsesMessageInputItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem

interface ResponsesFunctionTool {
  type: "function"
  name: string
  description?: string
  parameters?: Record<string, unknown>
  strict?: boolean
}

type ResponsesTool = ResponsesFunctionTool | Tool

type ResponsesToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; name?: string; function?: { name: string } }

export interface ResponsesCreatePayload {
  input?: string | Array<ResponsesInputItem>
  instructions?: string
  max_output_tokens?: number
  model: string
  parallel_tool_calls?: boolean
  temperature?: number | null
  tool_choice?: ResponsesToolChoice
  tools?: Array<ResponsesTool>
  top_p?: number | null
}

interface ResponsesOutputText {
  annotations: Array<never>
  text: string
  type: "output_text"
}

interface ResponsesOutputMessage {
  id: string
  content: Array<ResponsesOutputText>
  role: "assistant"
  status: "completed"
  type: "message"
}

interface ResponsesFunctionCallOutput {
  arguments: string
  call_id: string
  id: string
  name: string
  status: "completed"
  type: "function_call"
}

export interface ResponsesCreateResponse {
  id: string
  created_at: number
  model: string
  object: "response"
  output: Array<ResponsesOutputMessage | ResponsesFunctionCallOutput>
  parallel_tool_calls: boolean
  status: "completed"
  tool_choice: ResponsesToolChoice | "auto"
  tools: Array<ResponsesTool>
}

export function translateResponsesToChatCompletions(
  payload: ResponsesCreatePayload,
): ChatCompletionsPayload {
  const tools = translateTools(payload.tools)
  return {
    messages: translateInputToMessages(payload.input, payload.instructions),
    model: payload.model,
    max_completion_tokens: payload.max_output_tokens,
    stream: false,
    temperature: payload.temperature,
    tool_choice: translateToolChoice(payload.tool_choice, tools),
    tools,
    top_p: payload.top_p,
  }
}

export function translateChatCompletionToResponse(
  response: ChatCompletionResponse,
  payload: ResponsesCreatePayload,
): ResponsesCreateResponse {
  const createdAt =
    typeof response.created === "number" && response.created > 0 ?
      response.created
    : Math.floor(Date.now() / 1000)

  return {
    id: response.id.startsWith("resp_") ? response.id : `resp_${response.id}`,
    created_at: createdAt,
    model: response.model,
    object: "response",
    output: response.choices.flatMap((choice, index) =>
      translateChoiceToOutput(choice.message, response.id, index),
    ),
    parallel_tool_calls: payload.parallel_tool_calls ?? false,
    status: "completed",
    tool_choice: payload.tool_choice ?? "auto",
    tools: payload.tools ?? [],
  }
}

function translateInputToMessages(
  input: ResponsesCreatePayload["input"],
  instructions: string | undefined,
): Array<Message> {
  const messages: Array<Message> = []

  if (instructions) {
    messages.push({ role: "system", content: instructions })
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input })
    return messages
  }

  for (const item of input ?? []) {
    switch (item.type) {
      case "function_call": {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: item.call_id,
              type: "function",
              function: {
                name: item.name,
                arguments: item.arguments,
              },
            },
          ],
        })
        break
      }
      case "function_call_output": {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id,
          content: mapFunctionOutput(item.output),
        })
        break
      }
      case "message":
      case undefined: {
        messages.push({
          role: item.role,
          content: mapMessageContent(item.content),
        })
        break
      }
      default: {
        break
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" })
  }

  return messages
}

function mapMessageContent(
  content: ResponsesMessageInputItem["content"],
): Message["content"] {
  if (typeof content === "string") {
    return content
  }

  const parts: Array<ContentPart> = []
  for (const part of content) {
    if (part.type === "input_text" || part.type === "output_text") {
      parts.push({ type: "text", text: part.text })
      continue
    }

    if (isResponsesImageContent(part) && part.image_url) {
      parts.push({
        type: "image_url",
        image_url: {
          url: part.image_url,
          ...(part.detail && part.detail !== "original" ?
            { detail: part.detail }
          : {}),
        },
      })
    }
  }

  return parts.length > 0 ? parts : ""
}

function mapFunctionOutput(
  output: ResponsesFunctionCallOutputItem["output"],
): Message["content"] {
  if (typeof output === "string") {
    return output
  }

  return mapMessageContent(output)
}

function translateTools(
  tools: Array<ResponsesTool> | undefined,
): Array<Tool> | undefined {
  if (!tools) {
    return undefined
  }

  const functionTools = tools.flatMap((tool) => {
    if ("function" in tool) {
      return [tool]
    }

    return [
      {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? {},
        },
      } satisfies Tool,
    ]
  })

  return functionTools.length > 0 ? functionTools : undefined
}

function translateToolChoice(
  toolChoice: ResponsesCreatePayload["tool_choice"],
  tools: Array<Tool> | undefined,
): ChatCompletionsPayload["tool_choice"] {
  if (!tools || tools.length === 0) {
    return undefined
  }

  if (!toolChoice || typeof toolChoice === "string") {
    return toolChoice
  }

  const functionName = toolChoice.function?.name ?? toolChoice.name
  return functionName ?
      {
        type: "function",
        function: { name: functionName },
      }
    : "auto"
}

function translateChoiceToOutput(
  message: ChatCompletionResponse["choices"][number]["message"],
  responseId: string,
  index: number,
): Array<ResponsesOutputMessage | ResponsesFunctionCallOutput> {
  const output: Array<ResponsesOutputMessage | ResponsesFunctionCallOutput> = []

  if (message.content) {
    output.push({
      id: `msg_${responseId}_${index}`,
      content: [
        {
          annotations: [],
          text: message.content,
          type: "output_text",
        },
      ],
      role: "assistant",
      status: "completed",
      type: "message",
    })
  }

  for (const toolCall of message.tool_calls ?? []) {
    output.push({
      arguments: toolCall.function.arguments,
      call_id: toolCall.id,
      id: toolCall.id,
      name: toolCall.function.name,
      status: "completed",
      type: "function_call",
    })
  }

  return output
}
