/**
 * Single File ReAct Agent Template (Deno)
 * 
 * This template provides a foundation for building agents that follow the ReACT pattern
 * (Reasoning + Acting). It includes both CLI and web server modes, tool integration,
 * and robust error handling.
 * 
 * ## Features
 * - Dual-mode operation (CLI and web server)
 * - ReACT pattern implementation (Thought → Action → Observation loop)
 * - Flexible tool integration system
 * - API key authentication for web server
 * - Error handling with fallback mechanisms
 * - File output capabilities
 * 
 * ## Setup
 * - Ensure you have a Deno runtime available
 * - Set required environment variables (see Configuration section)
 * - Run with: `deno run --allow-read --allow-write --allow-net --allow-env --allow-run agent-template.ts`
 * - Install as command: `deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name agent agent-template.ts`
 * 
 * ## Usage
 * - CLI mode: `agent "Your query here"`
 * - Web server: Send POST request to http://localhost:8000 with JSON body: `{ "query": "Your query here" }`
 * 
 * ## Customization
 * - Modify the configuration section at the top of the file
 * - Add or modify tools in the Tools section
 * - Customize the system prompt to change agent behavior
 * - Adjust output formatting as needed
 */

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// ===== CONFIGURATION =====
// Modify these settings to customize your agent

// API Keys and Endpoints
const LLM_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || ""; // Your LLM API key (OpenRouter by default)
const LLM_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openai/o3-mini-high"; // Model to use
const LLM_API_URL = "https://openrouter.ai/api/v1/chat/completions"; // API endpoint
const SERVER_API_KEY = Deno.env.get("SERVER_API_KEY") || ""; // Optional: Secure web server

// Server Configuration
const PORT = parseInt(Deno.env.get("PORT") || "8000"); // Web server port
const SERVER_MODE_ENABLED = true; // Set to false to disable web server mode

// Agent Configuration
const MAX_STEPS = 10; // Maximum reasoning steps
const DEFAULT_TEMPERATURE = 0.0; // Temperature for LLM calls
const MAX_TOKENS = 4000; // Maximum tokens for responses

// Output Configuration
const OUTPUT_FORMAT = "markdown"; // Output format (markdown, json, text)
const INCLUDE_TIMESTAMP = true; // Include timestamp in output files

// ===== INTERFACE DEFINITIONS =====
// These define the structure of messages and tools

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Tool {
  name: string;
  description: string;
  run: (input: string) => Promise<string> | string;
}

// ===== TOOL DEFINITIONS =====
// Add, remove, or modify tools here to extend agent capabilities

const tools: Tool[] = [
  // Example tool: Web search
  {
    name: "WebSearch",
    description: "Searches the web for information. Usage: WebSearch[your search query]",
    run: async (input: string) => {
      try {
        // This is a placeholder. Replace with actual implementation.
        console.log(`Searching web for: "${input}"`);
        return `[Example search result for "${input}". Replace this with actual API call.]`;
        
        /* Example implementation using an API:
        const response = await fetch(`https://api.search.com/search?q=${encodeURIComponent(input)}`, {
          headers: { 'Authorization': `Bearer ${SEARCH_API_KEY}` }
        });
        if (!response.ok) throw new Error(`Search API error: ${response.status}`);
        const data = await response.json();
        return data.results.map(r => `${r.title}: ${r.snippet}`).join('\n\n');
        */
      } catch (err) {
        console.error("Search error:", err);
        return "Error: " + (err as Error).message;
      }
    }
  },
  
  /* Uncomment and modify to add more tools
  {
    name: "Calculator",
    description: "Performs mathematical calculations. Usage: Calculator[2 + 2]",
    run: (input: string) => {
      try {
        // Simple eval for calculations (be careful with this in production)
        return String(eval(input));
      } catch (err) {
        return "Error: " + (err as Error).message;
      }
    }
  },
  */
];

// ===== SYSTEM PROMPT =====
// Customize this prompt to change the agent's behavior

// Generate tool descriptions for the system prompt
const toolDescriptions = tools.map(t => `${t.name}: ${t.description}`).join("\n");

// The system prompt that instructs the model how to behave
const systemPrompt = 
`You are a helpful assistant that can use tools to answer questions and perform tasks.

You have access to the following tools:
${toolDescriptions}

Follow this format strictly:
Thought: <your reasoning here>
Action: <ToolName>[<tool input>]
Observation: <result of the tool action>
... (you can repeat Thought/Action/Observation as needed) ...
Thought: <final reasoning>
Answer: <your final answer to the user's query>

Only provide one action at a time, and wait for the observation before continuing.
Your final answer MUST begin with "Answer: " and should be comprehensive and helpful.
You MUST use at least one tool before providing your final answer.
`;

// ===== LLM INTEGRATION =====
// Functions for interacting with the language model

// Store the last observation for fallback purposes
let lastObservation = "";

/**
 * Calls the language model API with the given messages.
 * @param messages - Array of chat messages to send to the LLM
 * @returns The model's response text
 */
async function callLLM(messages: ChatMessage[]): Promise<string> {
  try {
    console.log("Calling LLM API...");
    const response = await fetch(LLM_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: messages,
        stop: ["Observation:"],  // Stop generation before the model writes an observation
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: MAX_TOKENS
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: HTTP ${response.status} - ${errorText}`);
    } 
    
    const data = await response.json();
    console.log(`LLM API response received`);
    
    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      console.error("Empty or invalid response from LLM API");
      throw new Error("Empty or invalid response from LLM");
    }
    
    return content;
  } catch (err) {
    console.error("Error calling LLM:", err);
    throw err;
  }
}

/**
 * Runs the ReACT agent loop for a given user query.
 * @param query - The user's question or command for the agent.
 * @returns The final answer from the agent.
 */
async function runAgent(query: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query }
  ];

  console.log(`Starting agent with query: "${query}"`);
  lastObservation = ""; // Reset the last observation
  
  // The agent will iterate, allowing up to MAX_STEPS reasoning loops
  for (let step = 0; step < MAX_STEPS; step++) {
    console.log(`Step ${step + 1}/${MAX_STEPS}`);
    
    try {
      // Call the LLM
      const assistantReply = await callLLM(messages);
      
      if (!assistantReply || assistantReply.trim().length === 0) {
        console.log("Received empty reply from assistant, using fallback");
        if (lastObservation && lastObservation.length > 0) {
          // If we have a previous observation, use it as the answer
          console.log("Using last observation as fallback answer");
          return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
        } else {
          throw new Error("Empty response from assistant and no fallback available");
        }
      }
      
      console.log(`Assistant reply (${assistantReply.length} chars):\n${assistantReply.substring(0, 200)}...`);
      
      // Append the assistant's reply to the message history
      messages.push({ role: "assistant", content: assistantReply });
      
      // Check if the assistant's reply contains a final answer
      const answerMatch = assistantReply.match(/Answer:\s*([\s\S]*?)$/); // Use [\s\S] to match any character including newlines
      if (answerMatch) {
        const answer = answerMatch[1].trim();
        if (answer.length > 0) {
          console.log(`Found answer (${answer.length} chars)`);
          // Return the text after "Answer:" as the final answer
          return answer;
        } else {
          console.log("Found empty answer, using fallback");
          if (lastObservation && lastObservation.length > 0) {
            // If we have a previous observation, use it as the answer
            console.log("Using last observation as fallback answer");
            return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
          }
        }
      }
      
      // Otherwise, look for an action to perform
      const actionMatch = assistantReply.match(/Action:\s*([^\[]+)\[([^\]]+)\]/);
      if (actionMatch) {
        const toolName = actionMatch[1].trim();
        const toolInput = actionMatch[2].trim();
        console.log(`Tool use: ${toolName}[${toolInput}]`);
        
        // Find the tool by name (case-insensitive match)
        const tool = tools.find(t => t.name.toLowerCase() === toolName.toLowerCase());
        let observation: string;
        if (!tool) {
          observation = `Tool "${toolName}" not found`;
        } else {
          try {
            const result = await tool.run(toolInput);
            observation = String(result);
            // Store this observation as a potential fallback answer
            lastObservation = observation;
          } catch (err) {
            observation = `Error: ${(err as Error).message}`;
          }
        }
        console.log(`Observation (${observation.length} chars):\n${observation.substring(0, 200)}...`);
        
        // Append the observation as a system message for the next LLM call
        messages.push({ role: "system", content: `Observation: ${observation}` });
        // Continue loop for next reasoning step with the new observation in context
        continue;
      }
      
      console.log("No Action or Answer found in reply, checking for fallback");
      // If no Action or Answer was found in the assistant's reply, check if we have a fallback
      if (lastObservation && lastObservation.length > 0) {
        console.log("Using last observation as fallback answer");
        return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
      }
      
      // If we have no fallback, return the assistant's reply as is
      console.log("No fallback available, returning assistant reply as answer");
      return assistantReply.trim();
    } catch (err) {
      console.error(`Error in step ${step + 1}:`, err);
      
      // If we have a fallback observation, use it instead of failing
      if (lastObservation && lastObservation.length > 0) {
        console.log("Error occurred, using last observation as fallback answer");
        return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
      }
      
      throw err;
    }
  }
  
  console.error("Agent did not produce a final answer within the step limit");
  
  // If we have a fallback observation, use it instead of failing
  if (lastObservation && lastObservation.length > 0) {
    console.log("Step limit reached, using last observation as fallback answer");
    return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
  }
  
  throw new Error("Agent did not produce a final answer within the step limit.");
}

// ===== OUTPUT HANDLING =====
// Functions for formatting and saving output

/**
 * Generates a unique filename with timestamp and UUID.
 * @returns A string in the format "YYYY-MM-DD-HH-mm-ss-UUID.extension"
 */
function generateFilename(extension = "md"): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/T/, '-')
    .replace(/\..+/, '')
    .replace(/:/g, '-');
  const uuid = crypto.randomUUID();
  return `${timestamp}-${uuid}.${extension}`;
}

/**
 * Formats the agent's answer based on the configured output format.
 * @param query The original user query
 * @param answer The agent's answer
 * @returns Formatted output string
 */
function formatOutput(query: string, answer: string): string {
  switch (OUTPUT_FORMAT.toLowerCase()) {
    case "markdown":
      return `# Query: ${query}\n\n${answer}\n\n${INCLUDE_TIMESTAMP ? `*Generated on ${new Date().toLocaleString()}*` : ''}`;
    case "json":
      return JSON.stringify({
        query,
        answer,
        timestamp: INCLUDE_TIMESTAMP ? new Date().toISOString() : undefined
      }, null, 2);
    case "text":
    default:
      return `Query: ${query}\n\n${answer}${INCLUDE_TIMESTAMP ? `\n\nGenerated on ${new Date().toLocaleString()}` : ''}`;
  }
}

/**
 * Writes the formatted output to a file.
 * @param content The content to write
 * @param filename The filename to write to
 */
async function writeOutputFile(content: string, filename: string): Promise<void> {
  await Deno.writeTextFile(filename, content);
}

// ===== RUNTIME MODES =====
// CLI and web server implementations

/**
 * Runs the agent in CLI mode with the provided query.
 * @param query The user's query from command line
 */
async function runCliMode(query: string): Promise<void> {
  console.log(`Running in CLI mode with query: "${query}"`);
  
  try {
    // Check if API key is set
    if (!LLM_API_KEY) {
      console.error("Error: LLM API key is not set in environment.");
      console.error("Please set it with: export OPENROUTER_API_KEY=your_key");
      Deno.exit(1);
    }
    
    console.log("Starting agent...");
    const answer = await runAgent(query);
    console.log(`Got answer (${answer.length} chars)`);
    
    const extension = OUTPUT_FORMAT.toLowerCase() === "json" ? "json" : 
                     OUTPUT_FORMAT.toLowerCase() === "markdown" ? "md" : "txt";
    const filename = generateFilename(extension);
    console.log(`Generated filename: ${filename}`);
    
    const output = formatOutput(query, answer);
    console.log(`Formatted output (${output.length} chars)`);
    
    await writeOutputFile(output, filename);
    console.log(`Wrote output to file: ${filename}`);
    
    // Echo just the filename for easy use in scripts
    console.log(filename);
  } catch (err) {
    console.error("Agent error:", err);
    Deno.exit(1);
  }
  Deno.exit(0);
}

/**
 * Starts the web server to handle agent requests.
 */
function startWebServer(): void {
  if (!SERVER_MODE_ENABLED) return;
  
  console.log(`Starting web server on port ${PORT}...`);
  
  serve(async (req: Request) => {
    // Check for API key if SERVER_API_KEY is set
    if (SERVER_API_KEY) {
      const authHeader = req.headers.get("Authorization");
      const apiKey = authHeader?.startsWith("Bearer ") 
        ? authHeader.substring(7) 
        : null;
      
      if (apiKey !== SERVER_API_KEY) {
        return new Response(JSON.stringify({ 
          error: "Unauthorized: Invalid or missing API key" 
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    if (req.method === "GET") {
      return new Response(JSON.stringify({
        message: "Agent API",
        usage: "Send a POST request with JSON body: { \"query\": \"your question\" }" + 
              (SERVER_API_KEY ? " Include your API key in the Authorization header: 'Authorization: Bearer your-api-key'" : "")
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    let query: string;
    try {
      const data = await req.json();
      query = data.query ?? data.question;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing query parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    try {
      const answer = await runAgent(query);
      const responseData = { query, answer };
      return new Response(JSON.stringify(responseData), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Agent error:", err);
      const errorMsg = (err as Error).message || String(err);
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }, { port: PORT });
}

// ===== ENTRY POINT =====
// Determine whether to run in CLI or web server mode

// Check if being run from command line with arguments
if (Deno.args.length > 0) {
  const query = Deno.args[0];
  runCliMode(query);
} else {
  // Start in web server mode
  startWebServer();
}
