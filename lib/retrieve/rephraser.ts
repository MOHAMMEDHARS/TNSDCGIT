import { ChatMessage } from "@/types"
import OpenAI from "openai"
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions.mjs"

const buildContextMessages = (
  chatMessages: ChatMessage[],
  numberOfMessagesConsidered: number,
  maxHistoryTokens: number
) => {
  const contextMessages = chatMessages
    .slice(-numberOfMessagesConsidered)
    .map(
      message => "**" + message.message.role + "**: " + message.message.content
    )

  const encode = require("gpt-tokenizer").encode
  let totalTokens = 0
  let truncatedContextMessages = []

  for (let i = contextMessages.length - 1; i >= 0; i--) {
    const messageTokens = encode(contextMessages[i]).length
    if (totalTokens + messageTokens <= maxHistoryTokens) {
      truncatedContextMessages.unshift(contextMessages[i])
      totalTokens += messageTokens
    } else {
      break
    }
  }

  return truncatedContextMessages.join("\n\n")
}

export const rephraser = async (
  client: OpenAI,
  model: ChatCompletionCreateParamsBase["model"],
  messageContent: string,
  prompt: string,
  mode: "rephrase" | "rephrase-and-chunks" | undefined,
  chatMessages: ChatMessage[],
  numberOfMessagesConsidered: number,
  maxHistoryTokens: number
) => {
  const contextMessages = buildContextMessages(
    chatMessages,
    numberOfMessagesConsidered,
    maxHistoryTokens
  )

  let rephraserPrompt = ""
  switch (mode) {
    case "rephrase":
      rephraserPrompt =
        "You are a summarizer expert. You will go through the prompt, the conversation messages and the user input and create an enriched " +
        " question based on the user input that will  be useful to create good vector embeddings for semantic search.\n\n" +
        (prompt ? "<PROMPT>" + prompt + "</PROMPT>\n\n" : "") +
        "<CONVERSATION>" +
        contextMessages +
        "</CONVERSATION>\n\n" +
        "<USER INPUT>" +
        messageContent +
        "</USER INPUT>" +
        "Output the enriched user input as a complete and atomic question that incorporates everything required from the PROMPT and CONVERSATION " +
        "(i.e. the conversation subject, replace item numbers with the actual item descriptions, etc). " +
        "Use the following format:\n\n" +
        "```xml\n" +
        "<REPHRASER>\n" +
        "<COULD_IMPROVE_USER_INPUT>{reply with true or false}</COULD_IMPROVE_USER_INPUT>\n" +
        "<RESULT>\n" +
        "Question: {YOUR QUESTION}\n" +
        "</RESULT>\n" +
        "</REPHRASER>```"
      break

    case "rephrase-and-chunks":
    default:
      rephraserPrompt =
        "You are a summarizer expert. You will go through the prompt, the conversation messages and the user input and create " +
        "an enriched version of the question with 5 diverse chunks or sources of informtion generated by AI,  that will  be useful " +
        "to create good vector embeddings for semantic search.\n\n" +
        (prompt ? "<PROMPT>" + prompt + "</PROMPT>\n\n" : "") +
        "<CONVERSATION>" +
        contextMessages +
        "</CONVERSATION>\n\n" +
        "<USER INPUT>" +
        messageContent +
        "</USER INPUT>\n\n" +
        "Output the enriched user input as a complete and atomic question that incorporates everything required from the prompt and context of the conversation " +
        "(i.e. the conversation subject, replace item numbers with the actual item descriptions, etc). " +
        "Then create 5 possible paragraphs that might have the information that answer the question. " +
        "Use the following format:\n\n" +
        "```xml\n" +
        "<REPHRASER>\n" +
        "<COULD_IMPROVE_USER_INPUT>{reply with true or false}</COULD_IMPROVE_USER_INPUT>\n" +
        "<CHUNKS_QUALITY>{Rate the quality of the chunks 0 (completely fake, clueless) - 10 (resonable good chunks)}</CHUNKS_QUALITY>\n" +
        "<RESULT>\n" +
        "Question: {YOUR QUESTION}\n" +
        "Chunk 1: {YOUR CHUNK}\n" +
        "Chunk 2: {YOUR CHUNK}\n" +
        "Chunk 3: {YOUR CHUNK}\n" +
        "Chunk 4: {YOUR CHUNK}\n" +
        "Chunk 5: {YOUR CHUNK}\n" +
        "</RESULT>\n" +
        "</REPHRASER>```"
  }

  const enrichResponseCall = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: rephraserPrompt }],
    temperature: 1.0,
    max_tokens: 512,
    stream: false
  })

  const result = enrichResponseCall.choices[0].message.content

  console.log({
    rephraserPrompt,
    result
  })
  const couldImprove = result
    ?.split("<COULD_IMPROVE_USER_INPUT>")[1]
    .split("</COULD_IMPROVE_USER_INPUT>")[0]
    .trim()

  if (couldImprove?.toLowerCase() === "false") {
    return messageContent
  }

  return result?.split("<RESULT>")[1].split("</RESULT>")[0].trim()
}
