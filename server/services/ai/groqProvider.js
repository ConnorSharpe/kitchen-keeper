import Groq from 'groq-sdk';
import { AIProvider, AIProviderError } from './providerInterface.js';

export const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';
export const GROQ_VISION_MODEL = 'llama-3.2-11b-vision-instruct';

export class GroqProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.groq = new Groq({ apiKey });
  }

  startChatSession({ systemPrompt, tools, history }) {
    const messages = [{ role: 'system', content: systemPrompt }];

    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }

    // tools are in OpenAI format — pass directly, no translation needed
    return { messages, tools };
  }

  async sendMessage(session, message) {
    if (typeof message === 'string') {
      session.messages.push({ role: 'user', content: message });
    } else {
      // Array of tool result parts — add each directly to message history
      for (const part of message) {
        session.messages.push(part);
      }
    }

    let response;
    try {
      response = await this.groq.chat.completions.create({
        model: GROQ_CHAT_MODEL,
        messages: session.messages,
        tools: session.tools.length > 0 ? session.tools : undefined,
        max_tokens: 1500,
      });
    } catch (err) {
      throw new AIProviderError('Groq API error', err);
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

  buildToolResult({ callId, name: _name, result }) {
    return {
      role: 'tool',
      tool_call_id: callId,
      content: JSON.stringify(result),
    };
  }

  isResponseValid(_response) {
    return true;
  }
}
