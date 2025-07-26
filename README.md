# Five Whys MCP Server

A stateful MCP server that guides AI models through the 5-Whys root cause analysis technique.

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

### Starting a New Session

To start a new 5-Whys analysis:

```json
{
  "name": "five_whys",
  "arguments": {
    "problem": "Customer complaints are increasing",
    "needsMoreWhys": true
  }
}
```

The server will return a session ID and the first "why" question:

```json
{
  "content": [{"type": "text", "text": "Why does the problem \"Customer complaints are increasing\" occur?"}],
  "state": {
    "sessionId": "session_1703123456789_abc123def",
    "needsMoreWhys": true
  }
}
```

### Continuing a Session

To continue with the next "why" question, use the session ID:

```json
{
  "name": "five_whys",
  "arguments": {
    "sessionId": "session_1703123456789_abc123def",
    "currentReason": "Our response time is too slow",
    "needsMoreWhys": true
  }
}
```

### Completing the Analysis

When you want to finish the analysis, set `needsMoreWhys` to `false`:

```json
{
  "name": "five_whys",
  "arguments": {
    "sessionId": "session_1703123456789_abc123def",
    "currentReason": "We don't have enough staff",
    "needsMoreWhys": false
  }
}
```

The server will return a complete summary with the root cause.

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