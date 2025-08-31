import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';

// Define the input schema for the five_whys tool using zod
const WhyEntrySchema = z.object({
  whyNumber: z.number().int().min(1).max(5),
  answer: z.string().min(1),
});

const FiveWhysSchema = z.object({
  mode: z.enum(['standard', 'simple']).optional().default('standard').describe("Operation mode: 'standard' for full functionality, 'simple' for low-powered models"),
  sessionId: z.string().optional().describe("Session ID to maintain state across calls. REQUIRED for all calls after the first one. The tool will automatically create and provide this in the first response - do not generate session IDs yourself."),
  problem: z.string().min(1).optional().describe("The initial problem statement. REQUIRED only for the first call to start a new analysis."),
  currentReason: z.string().optional().describe("Your answer to the previous 'why' question. REQUIRED for all calls after the first one."),
  needsMoreWhys: z.boolean().optional().describe("Whether to continue asking 'why' questions. Let the tool determine this value - do not set this yourself."),
});

// Simple test to verify Jest is working
describe('Five Whys Server', () => {
  

  it('should validate input schema correctly', () => {
    // Test valid first call
    const validFirstCall = {
          problem: 'The website is slow'
    };
    
    const parsed = FiveWhysSchema.parse(validFirstCall);
    expect(parsed).toHaveProperty('problem', 'The website is slow');
    expect(parsed).not.toHaveProperty('sessionId');
    expect(parsed).not.toHaveProperty('currentReason');
    expect(parsed).toHaveProperty('mode', 'standard'); // Default mode

    // Test valid continuation call
    const validContinuationCall = {
      sessionId: 'test_session_123',
      currentReason: 'The server is overloaded'
    };

    const parsedContinuation = FiveWhysSchema.parse(validContinuationCall);
    expect(parsedContinuation).toHaveProperty('sessionId', 'test_session_123');
    expect(parsedContinuation).toHaveProperty('currentReason', 'The server is overloaded');
    expect(parsedContinuation).not.toHaveProperty('problem');

    // Test simple mode
    const simpleModeCall = {
      mode: 'simple',
      problem: 'The website is slow'
    };

    const parsedSimpleMode = FiveWhysSchema.parse(simpleModeCall);
    expect(parsedSimpleMode).toHaveProperty('mode', 'simple');
    expect(parsedSimpleMode).toHaveProperty('problem', 'The website is slow');
  });

  it('should reject invalid input', () => {
    // Test empty string problem
    expect(() => {
      FiveWhysSchema.parse({
        problem: '' // Empty string not allowed
      })
    }).toThrow();
    
    // Test invalid session ID format (number instead of string)
    expect(() => {
      FiveWhysSchema.parse({
        sessionId: 123 as any, // TypeScript will complain, but we're testing runtime validation
        currentReason: 'Test'
      })
    }).toThrow();
    
    // Test invalid problem format (number instead of string)
    expect(() => {
      FiveWhysSchema.parse({
        problem: 123 as any // TypeScript will complain, but we're testing runtime validation
      })
    }).toThrow();
  });
    // Test invalid currentReason format (number instead of string)
    expect(() => {
      FiveWhysSchema.parse({
        sessionId: 'test_session_123',
        currentReason: 123 as any // TypeScript will complain, but we're testing runtime validation
      })
    }).toThrow();

  
});
