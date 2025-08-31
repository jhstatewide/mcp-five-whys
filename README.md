# Five Whys MCP Server

A stateful MCP server that guides AI models through the 5-Whys root cause analysis technique.

## Low-Powered Model Support

This server now includes a **simple mode** designed specifically for low-powered AI models. Simple mode provides:
- Shorter, more direct prompts
- Simplified formatting and instructions
- Clearer guidance for each step
- Reduced cognitive load for less capable models

To use simple mode, add `"mode": "simple"` to your first call.

## The Five Whys Technique

The Five Whys is a root cause analysis technique that involves iteratively asking "why" to uncover the underlying cause of a problem. Developed by Taiichi Ohno at Toyota, it is a foundational element of the Toyota Production System and lean manufacturing.

This method emphasizes direct observation and input from those directly involved in the process. By repeatedly questioning the cause of a symptom (typically five times), teams can move beyond surface-level issues to identify systemic root causes that, when addressed, prevent recurrence.

The technique is widely used for:
- Preventing recurring problems
- Improving processes
- Enhancing product quality
- Strengthening team understanding of complex systems

While simple in concept, its effectiveness relies on careful execution. Common best practices include:
- Asking "why" with a focus on factual evidence
- Avoiding assumptions and blame
- Stopping when the root cause is identified (not necessarily after exactly five questions)
- Using the method collaboratively with cross-functional teams

Limitations to be aware of:
- Can lead to superficial answers if team members lack sufficient knowledge
- May not uncover complex, systemic issues without deeper analysis
- Requires skilled facilitation to avoid going down irrelevant paths

The Five Whys is most effective when used as part of a broader problem-solving framework.

## Features

- **Stateful Sessions**: Maintains conversation state using session IDs
- **Automatic Cleanup**: Automatically removes old sessions (30-minute timeout, max 100 sessions)
- **Simple API**: Just provide a session ID to continue where you left off
- **No History Management**: The server handles all history internally

## Installation

```bash
yarn install
```

## Usage

### Starting a New Session (Standard Mode)

To start a new 5-Whys analysis in standard mode:

```json
{
  "name": "five_whys",
  "arguments": {
    "problem": "Customer complaints are increasing"
  }
}
```

The server will return a session ID and the first "why" question:

```json
{
  "content": [{"type": "text", "text": "FIVE WHYS ANALYSIS STARTED\n\nProblem: \"Customer complaints are increasing\"\n\nQuestion: Why does the problem \"Customer complaints are increasing\" occur?\n\nSESSION ID: session_1703123456789_abc123def\n\nNEXT CALL FORMAT:\n{\"sessionId\": \"session_1703123456789_abc123def\", \"currentReason\": \"your answer to this why question\"}\n\nCRITICAL: You MUST call this tool again with your answer. Do NOT think through the analysis yourself."}],
  "state": {
    "sessionId": "session_1703123456789_abc123def",
    "needsMoreWhys": true
  }
}
```

### Starting a New Session (Simple Mode)

To start a new 5-Whys analysis in simple mode for low-powered models:

```json
{
  "name": "five_whys",
  "arguments": {
    "mode": "simple",
    "problem": "Customer complaints are increasing"
  }
}
```

The server will return a simplified response:

```json
{
  "content": [{"type": "text", "text": "Problem: Customer complaints are increasing\n\nWhy? (Answer with just the reason)\nExample: \"The server response time is slow\"\n\nSESSION ID: session_1703123456789_abc123def"}],
  "state": {
    "sessionId": "session_1703123456789_abc123def",
    "needsMoreWhys": true
  }
}
```

### Continuing a Session

To continue with the next "why" question, use the session ID (same for both modes):

```json
{
  "name": "five_whys",
  "arguments": {
    "sessionId": "session_1703123456789_abc123def",
    "currentReason": "Our response time is too slow"
  }
}
```

### Completing the Analysis

Continue calling the tool until the analysis is complete. The server will automatically determine when to stop and return a summary.

## Session Management

- **Session IDs**: Automatically generated when starting a new session (format: `session_${timestamp}_${randomString}`)
- **Timeout**: Sessions expire after 30 minutes of inactivity
- **Capacity**: Maximum 100 concurrent sessions
- **Cleanup**: Old sessions are automatically removed when capacity is reached

## API Schema

### Input Schema

```typescript
{
  sessionId?: string;        // Optional: Session ID to continue existing session
  problem?: string;          // Required for new sessions: The problem to analyze
  currentReason?: string;    // Optional: Answer to the current "why" question
  needsMoreWhys?: boolean;   // Optional: Whether to continue asking "why" (defaults to true if not provided)
}
```

### Output

The server returns:
- `content`: The next question or final summary
- `state`: Contains the session ID for the next call

## Development

```bash
# Install dependencies
yarn install

# Run in development mode (requires tsx)
yarn dev

# Build for production
yarn build

# Run built version
yarn start
```

## Example Workflow

1. **Start**: Provide a problem → Get session ID and first question
2. **Continue**: Provide session ID + answer → Get next question
3. **Repeat**: Continue until you have 5 answers or want to stop
4. **Finish**: Provide session ID + final answer + `needsMoreWhys: false` → Get summary

The server handles all the complexity of maintaining the conversation state and history.
