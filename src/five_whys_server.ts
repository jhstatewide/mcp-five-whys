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
import { sessionStore, SessionState } from "./session_store.js";

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

// Create the server instance
// TODO: Remember to update version number for each release
export const server = new Server({
  name: "five-whys-mcp-server",
  version: "1.0.6",
});

// Handle the list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "five_whys",
        description: "CRITICAL: You MUST call this tool for each step. Do NOT think through the analysis yourself. FIRST CALL: Provide ONLY 'problem' parameter. The tool creates a session and returns a sessionId. SUBSEQUENT CALLS: Use the returned sessionId + 'currentReason' (your answer to the previous why). Continue until tool says 'ANALYSIS COMPLETE'.",
        inputSchema: zodToJsonSchema(FiveWhysSchema),
        usageInstructions: `This tool implements the 5-Whys root cause analysis technique. 

CRITICAL WARNING: You MUST call this tool for each step. Do NOT think through the analysis yourself.

USAGE PATTERN:
1. FIRST CALL: {"problem": "your problem statement"}
   → Tool creates session and returns sessionId + first why question
2. SUBSEQUENT CALLS: {"sessionId": "returned_session_id", "currentReason": "your answer"}
   → Tool asks next why question
3. CONTINUE until tool returns "ANALYSIS COMPLETE"

EXAMPLE STEP-BY-STEP PROCESS:
Call 1: {"problem": "The website is slow"}
  → Tool responds with sessionId and first why question
Call 2: {"sessionId": "session_1234567890_abc123", "currentReason": "The server is overloaded"}
  → Tool responds with next why question
Call 3: {"sessionId": "session_1234567890_abc123", "currentReason": "Too many users are accessing it"}
  → Tool responds with next why question
...continue until tool says "ANALYSIS COMPLETE"

WHAT NOT TO DO:
- Do NOT think through the analysis yourself
- Do NOT generate session IDs yourself
- Do NOT attempt to complete the analysis yourself
- Do NOT provide all 5 answers at once
- Do NOT skip calling the tool multiple times

WHAT TO DO:
- Call the tool for EACH why question
- Use the sessionId returned by the tool
- Provide ONE answer per call
- Continue until tool says "ANALYSIS COMPLETE"`,
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
          `Example: {"problem": "The website is slow"}\n\n` +
          `CRITICAL: Do NOT think through the 5-Whys analysis yourself. You MUST call this tool for each step.`
        );
      }

      // Validate that LLM is not providing unnecessary parameters for first call
      if (parsed.sessionId || parsed.currentReason) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `FIRST CALL ERROR: Provide ONLY the 'problem' parameter.\n\n` +
          `CORRECT FORMAT: {"problem": "your problem statement"}\n\n` +
          `DO NOT include sessionId or currentReason in the first call - the tool creates the session automatically.\n\n` +
          `CRITICAL: Do NOT think through the 5-Whys analysis yourself. You MUST call this tool for each step.`
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
            text: `FIVE WHYS ANALYSIS STARTED\n\n` +
                  `Problem: "${parsed.problem}"\n\n` +
                  `Question: ${firstPrompt}\n\n` +
                  `SESSION ID: ${sessionId}\n\n` +
                  `NEXT CALL FORMAT:\n` +
                  `{"sessionId": "${sessionId}", "currentReason": "your answer to this why question"}\n\n` +
                  `CRITICAL: You MUST call this tool again with your answer. Do NOT think through the analysis yourself.`,
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
          `CONTINUATION ERROR: currentReason is required when continuing an existing session.\n\n` +
          `CORRECT FORMAT: {"sessionId": "${sessionId}", "currentReason": "your answer to the previous why question"}\n\n` +
          `Current session: Why #${sessionState.whyNumber} for problem: "${sessionState.problem}"`
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
        `PARAMETER ERROR: Do not set the 'needsMoreWhys' parameter - let the tool determine when to continue or stop.\n\n` +
        `CORRECT FORMAT: {"sessionId": "${sessionId}", "currentReason": "your answer"}\n\n` +
        `The tool automatically determines if more 'why' questions are needed.`
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
            text: `WHY #${nextWhyNumber} OF 5\n\n` +
                  `Problem: "${sessionState.problem}"\n\n` +
                  `Question: ${prompt}\n\n` +
                  `SESSION ID: ${sessionId}\n\n` +
                  `NEXT CALL FORMAT:\n` +
                  `{"sessionId": "${sessionId}", "currentReason": "your answer to this why question"}\n\n` +
                  `CRITICAL: You MUST call this tool again with your answer. Do NOT think through the analysis yourself.`,
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
    sessionState.history.forEach((entry: { whyNumber: number; answer: string }) => {
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
          text: `FIVE WHYS ANALYSIS COMPLETE\n\n` +
                summaryLines.join("\n") +
                `\n\nSESSION ID: ${sessionId}\n` +
                `ANALYSIS FINISHED - No more calls needed`,
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
  console.error("Five‑Whys MCP server v1.0.6 running over stdio");
}

runServer().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
