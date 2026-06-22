import OpenAI from 'openai';
import { AIProvider, AIProviderError } from './providerInterface.js';

export class OpenAIProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.client = new OpenAI({ apiKey });
  }

  startChatSession({ systemPrompt, tools, history = [] }) {
    return {
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      tools,
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
      });
    } catch (err) {
      throw new AIProviderError(err.message, err);
    }

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
}
