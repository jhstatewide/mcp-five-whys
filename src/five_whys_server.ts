#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/*
 * 5 Whys MCP Server
 *
 * This server exposes a single tool called `five_whys`.  The tool guides
 * an AI model through the 5‑Whys root‑cause analysis technique.  It
 * accepts the current problem statement, the current "why" iteration,
 * the answer to the previous why (if any), a history of previous
 * answers, and a flag indicating whether more why questions are needed.
 *
 * The server maintains session state using session IDs; the caller can
 * either start a new session or continue an existing one by providing
 * the session ID.
 */

// Define the input schema for the five_whys tool using zod
const WhyEntrySchema = z.object({
  whyNumber: z.number().int().min(1).max(5),
  answer: z.string().min(1),
});

const FiveWhysSchema = z.object({
  sessionId: z.string().optional().describe("Session ID to maintain state across calls. REQUIRED for all calls after the first one. The tool will automatically create and provide this in the first response - do not generate session IDs yourself."),
  problem: z.string().min(1).optional().describe("The initial problem statement. REQUIRED only for the first call to start a new analysis."),
  currentReason: z.string().optional().describe("Your answer to the previous 'why' question. REQUIRED for all calls after the first one."),
  needsMoreWhys: z.boolean().optional().describe("Whether to continue asking 'why' questions. Let the tool determine this value - do not set this yourself."),
});

// Session state interface
interface SessionState {
  problem: string;
  whyNumber: number;
  history: Array<{ whyNumber: number; answer: string }>;
  needsMoreWhys: boolean;
  lastActivity: number;
}

// In-memory session store with cleanup
class SessionStore {
  private sessions = new Map<string, SessionState>();
  private readonly maxSessions = 100; // Maximum number of sessions to keep
  private readonly sessionTimeout = 30 * 60 * 1000; // 30 minutes

  set(sessionId: string, state: SessionState): void {
    // Clean up old sessions if we're at capacity
    if (this.sessions.size >= this.maxSessions) {
      this.cleanup();
    }
    
    state.lastActivity = Date.now();
    this.sessions.set(sessionId, state);
  }

  get(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.lastActivity = Date.now(); // Update activity timestamp
    }
    return state;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];
    
    for (const [sessionId, state] of this.sessions.entries()) {
      if (now - state.lastActivity > this.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }
    
    // Remove expired sessions
    expiredSessions.forEach(sessionId => this.sessions.delete(sessionId));
    
    // If still at capacity, remove oldest sessions
    if (this.sessions.size >= this.maxSessions) {
      const sortedSessions = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      
      const toRemove = this.sessions.size - this.maxSessions + 1;
      for (let i = 0; i < toRemove; i++) {
        this.sessions.delete(sortedSessions[i][0]);
      }
    }
  }

  getStats(): { totalSessions: number; maxSessions: number } {
    return {
      totalSessions: this.sessions.size,
      maxSessions: this.maxSessions,
    };
  }
}

// Create the session store
const sessionStore = new SessionStore();

// Create the server instance
export const server = new Server({
  name: "five-whys-mcp-server",
  version: "1.0.0",
});

// Handle the list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "five_whys",
        description: "Guide the model through a 5‑Whys root cause analysis. IMPORTANT: On first call, provide only the 'problem' parameter. The tool will automatically create a session and return a sessionId - you MUST use this sessionId in all subsequent calls until the analysis is complete. Continue calling until needsMoreWhys is false.",
        inputSchema: zodToJsonSchema(FiveWhysSchema),
        usageInstructions: `This tool implements the 5-Whys root cause analysis technique. 

USAGE PATTERN:
1. First call: Provide only 'problem' parameter (tool creates session automatically)
2. Tool returns sessionId and first 'why' question
3. Subsequent calls: Provide 'sessionId' and 'currentReason' (your answer to the previous why)
4. Continue until tool returns needsMoreWhys: false

EXAMPLE CALLS:
Call 1: {"problem": "The website is slow"}
Call 2: {"sessionId": "session_1234567890_abc123", "currentReason": "The server is overloaded"}
Call 3: {"sessionId": "session_1234567890_abc123", "currentReason": "Too many users are accessing it"}
...continue until needsMoreWhys: false

IMPORTANT: Do not generate session IDs yourself - the tool will create them automatically. Do not attempt to complete the analysis yourself - let the tool guide you through all 5 iterations.`,
      },
    ],
  };
});

// Handle tool invocation
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new McpError(ErrorCode.InvalidRequest, "Arguments are required");
    }

    if (name !== "five_whys") {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    // Validate and parse input using zod
    const parsed = FiveWhysSchema.parse(args);

    let sessionId = parsed.sessionId;
    let sessionState: SessionState;

    // Handle session management automatically
    if (!sessionId) {
      // Start a new session - sessionId is optional, we'll create one
      if (!parsed.problem) {
        throw new McpError(
          ErrorCode.InvalidRequest, 
          `Problem is required to start a new analysis.\n\n` +
          `Expected format: {"problem": "your problem statement"}\n\n` +
          `Example: {"problem": "The website is slow"}`
        );
      }

      // Validate that LLM is not providing unnecessary parameters for first call
      if (parsed.sessionId || parsed.currentReason) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `For the first call, provide ONLY the 'problem' parameter.\n\n` +
          `Expected format: {"problem": "your problem statement"}\n\n` +
          `Do not provide sessionId or currentReason in the first call - the tool will create the session automatically.`
        );
      }
      
      // Generate a unique session ID
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionState = {
        problem: parsed.problem,
        whyNumber: 1,
        history: [],
        needsMoreWhys: true,
        lastActivity: Date.now(),
      };
      sessionStore.set(sessionId, sessionState);
      
      // Return session ID with first question
      const firstPrompt = `Why does the problem "${parsed.problem}" occur?`;
      
      return {
        content: [
          {
            type: "text",
            text: `${firstPrompt}\n\nSESSION CREATED: ${sessionId}\n\nIMPORTANT: I've created session ${sessionId} for you. You MUST use this sessionId in all subsequent calls until the analysis is complete.\n\nNext call should be: {"sessionId": "${sessionId}", "currentReason": "your answer to this why question"}`,
          },
        ],
        state: {
          sessionId: sessionId,
          needsMoreWhys: true,
        },
      };
    } else {
      // Continue existing session
      const existingState = sessionStore.get(sessionId);
      if (!existingState) {
        throw new McpError(
          ErrorCode.InvalidRequest, 
          `Session ${sessionId} not found. This could be because:\n` +
          `1. The session has expired (sessions expire after 30 minutes)\n` +
          `2. The sessionId was mistyped\n` +
          `3. The session was cleared from memory\n\n` +
          `Please start a new analysis by providing only the 'problem' parameter:\n` +
          `{"problem": "your problem statement"}`
        );
      }
      sessionState = existingState;
    }

    // Validate that currentReason is provided for continuing sessions
    if (sessionId && !parsed.currentReason) {
      throw new McpError(
        ErrorCode.InvalidRequest, 
        `currentReason is required when continuing an existing session. Please provide your answer to the previous 'why' question.\n\n` +
        `Expected format: {"sessionId": "${sessionId}", "currentReason": "your answer to the previous why question"}\n\n` +
        `Current session state: Why #${sessionState.whyNumber} for problem: "${sessionState.problem}"`
      );
    }

    // Append current reason to history if provided
    if (parsed.currentReason) {
      sessionState.history.push({ 
        whyNumber: sessionState.whyNumber, 
        answer: parsed.currentReason 
      });
    }

    // Validate that LLM is not trying to control the flow
    if (parsed.needsMoreWhys !== undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Do not set the 'needsMoreWhys' parameter - let the tool determine when to continue or stop the analysis.\n\n` +
        `Expected format: {"sessionId": "${sessionId}", "currentReason": "your answer"}\n\n` +
        `The tool will automatically determine if more 'why' questions are needed.`
      );
    }

    // Determine whether to continue asking why
    const nextWhyNumber = sessionState.whyNumber + 1;
    const continueAsking = sessionState.needsMoreWhys && nextWhyNumber <= 5;

    if (continueAsking) {
      // Prompt the model (or user) for the next why
      const lastReason = parsed.currentReason || sessionState.problem;
      const prompt =
        sessionState.whyNumber === 1
          ? `Why does the problem "${lastReason}" occur?`
          : `Why does "${lastReason}" occur?`;

      // Update session state
      sessionState.whyNumber = nextWhyNumber;
      sessionState.needsMoreWhys = true;
      sessionStore.set(sessionId, sessionState);

      return {
        content: [
          {
            type: "text",
            text: `${prompt}\n\nIMPORTANT: You must call this tool again with your answer using sessionId: ${sessionId}. Do not stop here - continue the 5-Whys process until the tool indicates completion.\n\nNext call: {"sessionId": "${sessionId}", "currentReason": "your answer to this why question"}`,
          },
        ],
        // Return session ID for the next call
        state: {
          sessionId: sessionId,
          needsMoreWhys: true,
        },
      };
    }

    // If no more whys are needed, produce a summary
    const summaryLines: string[] = [];
    summaryLines.push(`Problem: ${sessionState.problem}`);
    sessionState.history.forEach((entry) => {
      summaryLines.push(`Why ${entry.whyNumber}: ${entry.answer}`);
    });

    // Derive a simple root cause from the last answer
    const rootCause = sessionState.history.length > 0 
      ? sessionState.history[sessionState.history.length - 1].answer 
      : sessionState.problem;
    summaryLines.push(`\nRoot cause: ${rootCause}`);

    // Update session state
    sessionState.needsMoreWhys = false;
    sessionStore.set(sessionId, sessionState);

    return {
      content: [
        {
          type: "text",
          text: summaryLines.join("\n"),
        },
      ],
      state: {
        sessionId: sessionId,
        needsMoreWhys: false,
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorDetails = error.errors.map(err => {
        const field = err.path.join('.');
        const message = err.message;
        return `- ${field}: ${message}`;
      }).join('\n');

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid input format:\n\n${errorDetails}\n\n` +
        `Expected format for first call: {"problem": "your problem statement"}\n` +
        `Expected format for subsequent calls: {"sessionId": "session_id", "currentReason": "your answer"}`
      );
    }
    throw error;
  }
});

// Start the server over stdio
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Avoid using console.log with MCP servers – use stderr instead
  console.error("Five‑Whys MCP server running over stdio");
}

runServer().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
