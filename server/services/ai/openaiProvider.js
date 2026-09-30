import OpenAI from 'openai';
import { AIProvider, AIProviderError } from './providerInterface.js';

// TASK-069 D6: the model name is stored per search_documents row, so changing it makes every
// existing embedding detectably stale.
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export class OpenAIProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.client = new OpenAI({ apiKey });
  }

  startChatSession({ systemPrompt, tools, history = [], requestId = 'n/a' }) {
    return {
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      tools,
      requestId,
    };
  }

  async sendMessage(session, message) {
    if (typeof message === 'string') {
      session.messages.push({ role: 'user', content: message });
    } else {
      for (const part of message) {
        session.messages.push(part);
      }
    }

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: session.messages,
        tools: session.tools?.length ? session.tools : undefined,
        prompt_cache_key: 'kitchen-keeper-chat-v1',
      });
    } catch (err) {
      throw new AIProviderError(err.message, err);
    }

    console.log(
      `[kitchen-keeper] request_id=${session.requestId} function=chat model=gpt-4o-mini` +
        ` prompt_tokens=${response.usage?.prompt_tokens} completion_tokens=${response.usage?.completion_tokens}` +
        ` total_tokens=${response.usage?.total_tokens} cached_tokens=${response.usage?.prompt_tokens_details?.cached_tokens ?? 0}`
    );

    session.messages.push(response.choices[0].message);
    return response;
  }

  async streamMessage(session, message, onToken, { signal } = {}) {
    if (typeof message === 'string') {
      session.messages.push({ role: 'user', content: message });
    } else {
      for (const part of message) {
        session.messages.push(part);
      }
    }

    let response;
    try {
      const stream = this.client.beta.chat.completions.stream(
        {
          model: 'gpt-4o-mini',
          messages: session.messages,
          tools: session.tools?.length ? session.tools : undefined,
          prompt_cache_key: 'kitchen-keeper-chat-v1',
          stream_options: { include_usage: true },
        },
        { signal }
      );
      stream.on('content', (delta) => onToken(delta));
      response = await stream.finalChatCompletion();
    } catch (err) {
      throw new AIProviderError(err.message, err);
    }

    console.log(
      `[kitchen-keeper] request_id=${session.requestId} function=chat model=gpt-4o-mini` +
        ` prompt_tokens=${response.usage?.prompt_tokens} completion_tokens=${response.usage?.completion_tokens}` +
        ` total_tokens=${response.usage?.total_tokens} cached_tokens=${response.usage?.prompt_tokens_details?.cached_tokens ?? 0}`
    );

    session.messages.push(response.choices[0].message);
    return response;
  }

  extractToolCalls(response) {
    const toolCalls = response.choices[0].message.tool_calls ?? [];
    return toolCalls.map((tc) => ({
      callId: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));
  }

  extractText(response) {
    return response.choices[0].message.content?.trim() ?? '';
  }

  buildToolResult({ callId, name, result }) {
    return {
      role: 'tool',
      tool_call_id: callId,
      name,
      content: JSON.stringify(result),
    };
  }

  isResponseValid(response) {
    return response.choices[0].finish_reason !== 'content_filter';
  }

  // One API call for the whole batch. Vectors come back in input order (the API's `index`
  // field is authoritative, not array position). onUsage receives usage.prompt_tokens so
  // callers can log billed tokens without changing the return shape.
  async embed(texts, { onUsage } = {}) {
    let response;
    try {
      response = await this.client.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
    } catch (err) {
      throw new AIProviderError(err.message, err);
    }

    const vectors = new Array(texts.length);
    for (const item of response.data ?? []) vectors[item.index] = item.embedding;
    for (let i = 0; i < texts.length; i++) {
      if (!Array.isArray(vectors[i]) || vectors[i].length !== EMBEDDING_DIMENSIONS) {
        throw new AIProviderError(
          `Embedding ${i} has ${vectors[i]?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}`
        );
      }
    }
    onUsage?.(response.usage?.prompt_tokens ?? null);
    return vectors;
  }
}
