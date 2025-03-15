/**
 * Single File ReAct Research Agent (Deno)
 *
 * This agent follows the ReACT (Reasoning + Acting) logic pattern, integrates with the OpenRouter API for LLM interactions,
 * and uses the Perplexity Sonar API for deep research capabilities. It is designed as a single-file TypeScript script for Deno,
 * optimized for minimal latency in serverless environments like Fly.io and Supabase Edge Functions.
 *
 * ## Features
 * - Dual-mode operation (CLI and web server)
 * - ReACT pattern implementation (Thought → Action → Observation loop)
 * - Perplexity Sonar integration for deep research
 * - API key authentication for web server
 * - Error handling with fallback mechanisms
 * - Markdown output with citations
 *
 * ## Setup
 * - Ensure you have a Deno runtime available
 * - Set the environment variable `OPENROUTER_API_KEY` with your OpenRouter API key
 * - Set the environment variable `PERPLEXITY_API_KEY` with your Perplexity API key
 * - (Optional) Set `OPENROUTER_MODEL` to specify the model (default is "openai/o3-mini-high")
 * - (Optional) Set `SERVER_API_KEY` to secure the web server API
 * - Run with: `deno run --allow-read --allow-write --allow-net --allow-env --allow-run research-agent-revised.ts`
 * - Install as command: `deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name research research-agent.ts`
 *
 * ## Usage
 * - CLI mode: `research "What caused the fall of the Roman Republic?"`
 * - Web server: Send POST request to http://localhost:8000 with JSON body: `{ "query": "What caused the fall of the Roman Republic?" }`
 *
 * ## Deployment (Fly.io)
 * 1. Create a Dockerfile using a Deno base image (e.g. `denoland/deno:alpine`).
 *    - In the Dockerfile, copy this script into the image and use `CMD ["run", \"--allow-net\", \"--allow-env\", \"agent.ts\"]`.
 * 2. Set the `OPENROUTER_API_KEY` and `PERPLEXITY_API_KEY` as secrets on Fly.io (e.g., `fly secrets set OPENROUTER_API_KEY=your_key`).
 * 3. Deploy with `fly deploy`. The app will start an HTTP server on port 8000 by default (adjust Fly.io config for port if needed).
 *
 * ## Deployment (Supabase Edge Functions)
 * 1. Install the Supabase CLI and login to your project.
 * 2. Create a new Edge Function: `supabase functions new myagent`.
 * 3. Replace the content of the generated `index.ts` with this entire script.
 * 4. Ensure to add your API keys: run `supabase secrets set OPENROUTER_API_KEY=your_key` and `supabase secrets set PERPLEXITY_API_KEY=your_key` for the function's environment.
 * 5. Deploy the function: `supabase functions deploy myagent --no-verify-jwt` (the `--no-verify-jwt` flag disables authentication if you want the function public).
 * 6. The function will be accessible at the URL provided by Supabase (e.g., `https://<project>.functions.supabase.co/myagent`).
 */

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// ===== CONFIGURATION =====
// Modify these settings to customize your agent

// API Keys and Endpoints
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || ""; // Your OpenRouter API key
const OPENROUTER_MODEL =
  Deno.env.get("OPENROUTER_MODEL") || "openai/o3-mini-high"; // Model to use
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY") || ""; // Your Perplexity API key
const PERPLEXITY_API_URL = "https://api.perplexity.ai/sonar/search"; // Perplexity API endpoint
const SERVER_API_KEY = Deno.env.get("SERVER_API_KEY") || ""; // Optional: Secure web server

// Server Configuration
const PORT = parseInt(Deno.env.get("PORT") || "8000"); // Web server port
const SERVER_MODE_ENABLED = true; // Set to false to disable web server mode

// Agent Configuration
const MAX_STEPS = 10; // Maximum reasoning steps
const DEFAULT_TEMPERATURE = 0.0; // Temperature for LLM calls
const MAX_TOKENS = 4000; // Maximum tokens for responses
const MAX_RETRIES = 3; // Maximum number of retries for failed API calls
const RETRY_DELAY_MS = 1000; // Delay between retries in milliseconds
const MAX_ITERATIONS = 10; // Maximum number of iterations for the agent
const INCLUDE_TIMESTAMP = true; // Include timestamp in output
const OUTPUT_DIR = Deno.env.get("OUTPUT_DIR") || "output"; // Directory to store output files

// Perplexity Configuration
const PERPLEXITY_MODEL = "sonar-deep-research"; // Perplexity model to use
const PERPLEXITY_MAX_TOKENS = 4000; // Maximum tokens for Perplexity responses
const PERPLEXITY_TEMPERATURE = 0.2; // Temperature for Perplexity calls

// Output Configuration
// INCLUDE_TIMESTAMP is already defined above

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
// Research tools for the agent to use

const tools: Tool[] = [
  {
    name: "PerplexitySonar",
    description:
      "Uses Perplexity's Sonar Deep Research API to answer research questions/topics with AI-powered agents. Usage: PerplexitySonar[your question]",
    run: async (input: string) => {
      try {
        const options = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: PERPLEXITY_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "Be precise and concise. Provide comprehensive, detailed answers with citations.",
              },
              { role: "user", content: input },
            ],
            max_tokens: PERPLEXITY_MAX_TOKENS,
            temperature: PERPLEXITY_TEMPERATURE,
            top_p: 0.9,
            return_images: false,
            return_related_questions: false,
            stream: false,
            presence_penalty: 0,
            frequency_penalty: 1,
          }),
        };

        console.log(
          `Calling Perplexity API with input: "${input.substring(0, 100)}..."`
        );
        const response = await fetch(
          "https://api.perplexity.ai/chat/completions",
          options
        );
        if (!response.ok) {
          throw new Error(`Perplexity API error: ${response.status}`);
        }

        const data = await response.json();
        const result = data.choices[0].message.content;
        console.log(`Perplexity API returned ${result.length} chars`);
        return result;
      } catch (err) {
        console.error("Perplexity API error:", err);
        return "Error: " + (err as Error).message;
      }
    },
  },
];

// ===== SYSTEM PROMPT =====
// Research-focused system prompt

// Generate tool descriptions for the system prompt
const toolDescriptions = tools
  .map((t) => `${t.name}: ${t.description}`)
  .join("\n");

// The system prompt that instructs the model how to behave
const systemPrompt = `You are a research assistant, tasked with providing comprehensive, well-researched answers to questions.

You have access to the following tools:
${toolDescriptions}

When answering the user, you MUST use the tools to access research information to build your research report.
Follow this format strictly:
Thought: <your reasoning here>
Action: <ToolName>[<tool input>]
Observation: <result of the tool action>
... (you can repeat Thought/Action/Observation as needed) ...
Thought: <final reasoning>
Answer: <your final answer to the user's query>

Your final answer MUST begin with "Answer: " and should be comprehensive and detailed.
Only provide one action at a time, and wait for the observation before continuing.
You MUST use at least one tool before providing your final answer.
`;

// ===== LLM INTEGRATION =====
// Functions for interacting with the language model

// Store the last observation for fallback purposes
let lastObservation = "";

/**
 * Calls the OpenRouter API with retry logic.
 * @param messages The chat messages to send to the API
 * @returns The assistant's reply
 */
async function callOpenRouter(messages: ChatMessage[]): Promise<string> {
  let retries = 0;
  
  while (retries <= MAX_RETRIES) {
    try {
      console.log(`Calling OpenRouter API (attempt ${retries + 1}/${MAX_RETRIES + 1})...`);
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://github.com/jwynia/aidant-monobots",
          "X-Title": "Aidant Research Agent",
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: messages,
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: MAX_TOKENS,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error (${response.status}): ${errorText}`);
        
        if (response.status === 429 || response.status >= 500) {
          // Retry on rate limit or server errors
          retries++;
          if (retries <= MAX_RETRIES) {
            console.log(`Retrying in ${RETRY_DELAY_MS}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * retries));
            continue;
          }
        }
        
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (err) {
      console.error(`Error calling OpenRouter API:`, err);
      
      retries++;
      if (retries <= MAX_RETRIES) {
        console.log(`Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * retries));
        continue;
      }
      
      throw err;
    }
  }
  
  throw new Error(`Failed to call OpenRouter API after ${MAX_RETRIES + 1} attempts`);
}

/**
 * Runs the ReACT agent loop for a given user query.
 * @param query - The user's question or command for the agent.
 * @returns The final answer from the agent.
 */
async function runAgent(query: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  console.log(`Starting agent with query: "${query}"`);
  lastObservation = ""; // Reset the last observation
  let partialAnswer = ""; // Store partial answers in case of premature termination

  // The agent will iterate, allowing up to MAX_STEPS reasoning loops
  for (let step = 0; step < MAX_STEPS; step++) {
    console.log(`Step ${step + 1}/${MAX_STEPS}`);

    try {
      // Call the LLM via OpenRouter
      const assistantReply = await callOpenRouter(messages);

      if (!assistantReply || assistantReply.trim().length === 0) {
        console.log("Received empty reply from assistant, using fallback");
        if (lastObservation && lastObservation.length > 0) {
          // If we have a previous observation, use it as the answer
          console.log("Using last observation as fallback answer");
          return `Based on research, here's what I found:\n\n${lastObservation}`;
        } else if (partialAnswer && partialAnswer.length > 0) {
          // If we have a partial answer, use it
          console.log("Using partial answer as fallback");
          return `Based on partial research, here's what I found:\n\n${partialAnswer}`;
        } else {
          throw new Error(
            "Empty response from assistant and no fallback available"
          );
        }
      }

      console.log(
        `Assistant reply (${
          assistantReply.length
        } chars):\n${assistantReply.substring(0, 200)}...`
      );

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
            return `Based on research, here's what I found:\n\n${lastObservation}`;
          } else if (partialAnswer && partialAnswer.length > 0) {
            // If we have a partial answer, use it
            console.log("Using partial answer as fallback");
            return `Based on partial research, here's what I found:\n\n${partialAnswer}`;
          }
        }
      }

      // Look for a Thought section to capture as a partial answer
      const thoughtMatch = assistantReply.match(/Thought:\s*([\s\S]*?)(?=\n\n|$)/);
      if (thoughtMatch && thoughtMatch[1].trim().length > 0) {
        // Store the thought as a potential partial answer
        partialAnswer = `${partialAnswer}\n\n${thoughtMatch[1].trim()}`;
        console.log(`Updated partial answer (${partialAnswer.length} chars)`);
      }

      // Otherwise, look for an action to perform
      const actionMatch = assistantReply.match(
        /Action:\s*([^\[]+)\[([^\]]+)\]/
      );
      if (actionMatch) {
        const toolName = actionMatch[1].trim();
        const toolInput = actionMatch[2].trim();
        console.log(`Tool use: ${toolName}[${toolInput}]`);

        // Find the tool by name (case-insensitive match)
        const tool = tools.find(
          (t) => t.name.toLowerCase() === toolName.toLowerCase()
        );
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
        console.log(
          `Observation (${observation.length} chars):\n${observation.substring(
            0,
            200
          )}...`
        );

        // Append the observation as a system message for the next LLM call
        messages.push({
          role: "system",
          content: `Observation: ${observation}`,
        });
        // Continue loop for next reasoning step with the new observation in context
        continue;
      }

      console.log("No Action or Answer found in reply, checking for fallback");
      // If no Action or Answer was found in the assistant's reply, check if we have a fallback
      if (lastObservation && lastObservation.length > 0) {
        console.log("Using last observation as fallback answer");
        return `Based on research, here's what I found:\n\n${lastObservation}`;
      } else if (partialAnswer && partialAnswer.length > 0) {
        // If we have a partial answer, use it
        console.log("Using partial answer as fallback");
        return `Based on partial research, here's what I found:\n\n${partialAnswer}`;
      }

      // If we have no fallback, return the assistant's reply as is
      console.log("No fallback available, returning assistant reply as answer");
      return assistantReply.trim();
    } catch (err) {
      console.error(`Error in step ${step + 1}:`, err);

      // If we have a fallback observation, use it instead of failing
      if (lastObservation && lastObservation.length > 0) {
        console.log(
          "Error occurred, using last observation as fallback answer"
        );
        return `Based on research, here's what I found:\n\n${lastObservation}`;
      } else if (partialAnswer && partialAnswer.length > 0) {
        // If we have a partial answer, use it
        console.log("Error occurred, using partial answer as fallback");
        return `Based on partial research, here's what I found:\n\n${partialAnswer}`;
      }

      throw err;
    }
  }

  console.error("Agent did not produce a final answer within the step limit");

  // If we have a fallback observation, use it instead of failing
  if (lastObservation && lastObservation.length > 0) {
    console.log(
      "Step limit reached, using last observation as fallback answer"
    );
    return `Based on research, here's what I found:\n\n${lastObservation}`;
  } else if (partialAnswer && partialAnswer.length > 0) {
    // If we have a partial answer, use it
    console.log("Step limit reached, using partial answer as fallback");
    return `Based on partial research, here's what I found:\n\n${partialAnswer}`;
  }

  throw new Error(
    "Agent did not produce a final answer within the step limit."
  );
}

// ===== OUTPUT HANDLING =====
// Functions for formatting and saving output

/**
 * Generates a unique filename with timestamp and UUID.
 * @returns A string in the format "YYYY-MM-DD-HH-mm-ss-UUID.md"
 */
function generateFilename(): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/T/, "-")
    .replace(/\..+/, "")
    .replace(/:/g, "-");
  const uuid = crypto.randomUUID();
  return `${timestamp}-${uuid}.md`;
}

/**
 * Formats the agent's answer as a markdown document.
 * @param query The original research query
 * @param answer The agent's answer
 * @returns A formatted markdown string
 */
function formatMarkdown(query: string, answer: string): string {
  return `# Research: ${query}\n\n${answer}\n\n${
    INCLUDE_TIMESTAMP ? `*Generated on ${new Date().toLocaleString()}*` : ""
  }`;
}

/**
 * Writes the formatted markdown to a file.
 * @param content The content to write
 * @param filename The filename to write to
 */
async function writeMarkdownFile(
  content: string,
  filename: string
): Promise<void> {
  try {
    // Ensure output directory exists
    try {
      await Deno.mkdir(OUTPUT_DIR, { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) {
        throw err;
      }
    }
    
    const filePath = `${OUTPUT_DIR}/${filename}`;
    await Deno.writeTextFile(filePath, content);
  } catch (err) {
    console.error(`Error writing file: ${err}`);
    throw err;
  }
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
    // Check if API keys are set
    if (!OPENROUTER_API_KEY) {
      console.error("Error: OPENROUTER_API_KEY is not set in environment.");
      console.error("Please set it with: export OPENROUTER_API_KEY=your_key");
      Deno.exit(1);
    }
    if (!PERPLEXITY_API_KEY) {
      console.error("Error: PERPLEXITY_API_KEY is not set in environment.");
      console.error("Please set it with: export PERPLEXITY_API_KEY=your_key");
      Deno.exit(1);
    }

    console.log("Starting research agent...");
    const answer = await runAgent(query);
    console.log(`Got answer (${answer.length} chars)`);

    const filename = generateFilename();
    console.log(`Generated filename: ${filename}`);

    const markdown = formatMarkdown(query, answer);
    console.log(`Formatted markdown (${markdown.length} chars)`);

    await writeMarkdownFile(markdown, filename);
    console.log(`Wrote markdown to file: ${filename}`);

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

  serve(
    async (req: Request) => {
      // Check for API key if SERVER_API_KEY is set
      if (SERVER_API_KEY) {
        const authHeader = req.headers.get("Authorization");
        const apiKey = authHeader?.startsWith("Bearer ")
          ? authHeader.substring(7)
          : null;

        if (apiKey !== SERVER_API_KEY) {
          return new Response(
            JSON.stringify({
              error: "Unauthorized: Invalid or missing API key",
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      if (req.method === "GET") {
        return new Response(
          JSON.stringify({
            message: "Welcome to the Research Agent API",
            usage:
              'Send a POST request with JSON body: { "query": "your research question" }' +
              (SERVER_API_KEY
                ? " Include your API key in the Authorization header: 'Authorization: Bearer your-api-key'"
                : ""),
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      let query: string;
      try {
        const data = await req.json();
        query = data.query ?? data.question;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!query || typeof query !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing query parameter" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      try {
        const answer = await runAgent(query);
        const responseData = { query, answer };
        return new Response(JSON.stringify(responseData), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("Agent error:", err);
        const errorMsg = (err as Error).message || String(err);
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
    { port: PORT }
  );
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
