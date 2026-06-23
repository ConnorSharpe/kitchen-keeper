// Shared error type for all provider adapters.
// Adapters catch SDK-specific errors and re-throw as AIProviderError
// so aiService.js has a single catch target.
export class AIProviderError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AIProviderError';
    this.cause = cause;
  }
}

// Contract all provider adapters must implement.
// history passed to startChatSession uses DB format: [{ role: 'user'|'assistant', content: string }]
// tools passed to startChatSession use OpenAI function-calling format.
export class AIProvider {
  // Initialises a chat session. Returns an opaque session object.
  startChatSession({ systemPrompt, tools, history }) {
    throw new Error('Not implemented');
  }

  // Sends a message to an active session. Returns raw provider response.
  // message: string (user turn) | array (tool result parts)
  async sendMessage(session, message) {
    throw new Error('Not implemented');
  }

  // Extracts tool calls from a raw provider response.
  // Returns: [{ callId: string, name: string, args: object }]
  extractToolCalls(response) {
    throw new Error('Not implemented');
  }

  // Extracts the assistant text from a raw provider response.
  // Returns: string
  extractText(response) {
    throw new Error('Not implemented');
  }

  // Builds a tool result payload in the provider's required format.
  buildToolResult({ callId, name, result }) {
    throw new Error('Not implemented');
  }

  // Returns true if the response can continue (not blocked/errored at provider level).
  isResponseValid(response) {
    throw new Error('Not implemented');
  }
}
