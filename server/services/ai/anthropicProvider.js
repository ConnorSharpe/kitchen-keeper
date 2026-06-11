import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIProviderError } from './providerInterface.js';

// Pinned to claude-sonnet-4-6: best tool-calling support in current family.
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

export class AnthropicProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.client = new Anthropic({ apiKey });
  }

  startChatSession({ systemPrompt, tools, history }) {
    const anthropicTools = _translateTools(tools);

    // Anthropic uses the same role names as the DB ('user'/'assistant').
    const messages = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return { messages, anthropicTools, systemPrompt };
  }

  async sendMessage(session, message) {
    if (typeof message === 'string') {
      session.messages.push({ role: 'user', content: message });
    } else {
      // Array of tool result parts — wrap as a user message with content array
      session.messages.push({ role: 'user', content: message });
    }

    let response;
    try {
      response = await this.client.messages.create({
        model: MODEL,
        system: session.systemPrompt,
        messages: session.messages,
        tools: session.anthropicTools,
        max_tokens: MAX_TOKENS,
      });
    } catch (err) {
      throw new AIProviderError('Anthropic API error', err);
    }

    session.messages.push({ role: 'assistant', content: response.content });
    return response;
  }

  extractToolCalls(response) {
    return (response.content || [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ callId: b.id, name: b.name, args: b.input }));
  }

  extractText(response) {
    return (response.content || []).find((b) => b.type === 'text')?.text?.trim() ?? '';
  }

  buildToolResult({ callId, name, result }) {
    return {
      type: 'tool_result',
      tool_use_id: callId,
      content: JSON.stringify(result),
    };
  }

  isResponseValid(response) {
    return response.stop_reason !== 'error';
  }
}

// OpenAI tools format → Anthropic tools format.
// Both use JSON Schema for parameters/input_schema.
function _translateTools(openAiTools) {
  return openAiTools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}
