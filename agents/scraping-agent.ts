/**
 * Single File ReAct Scraping Agent (Deno)
 *
 * This agent follows the ReACT (Reasoning + Acting) logic pattern and uses Puppeteer for web scraping.
 * It is designed as a single-file TypeScript script for Deno, optimized for minimal latency in serverless
 * environments like Fly.io and Supabase Edge Functions.
 *
 * ## Features
 * - Dual-mode operation (CLI and web server)
 * - ReACT pattern implementation (Thought → Action → Observation loop)
 * - Puppeteer integration for web scraping
 * - API key authentication for web server
 * - Error handling with fallback mechanisms
 * - Markdown output with extracted data
 *
 * ## Setup
 * - Ensure you have a Deno runtime available
 * - Set the environment variable `OPENROUTER_API_KEY` with your OpenRouter API key
 * - (Optional) Set `OPENROUTER_MODEL` to specify the model (default is "openai/o3-mini-high")
 * - (Optional) Set `SERVER_API_KEY` to secure the web server API
 * - Run with: `deno run --allow-read --allow-write --allow-net --allow-env --allow-run scraping-agent.ts`
 * - Install as command: `deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name scrape scraping-agent.ts`
 *
 * ## Usage
 * - CLI mode: `scrape "Extract product prices from example.com/products"`
 * - Web server: Send POST request to http://localhost:8000 with JSON body: `{ "query": "Extract product prices from example.com/products" }`
 */

import { serve } from "std/http/server.ts";
import puppeteer, { ElementHandle } from "puppeteer";

// Deno types
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  args: string[];
  exit(code: number): never;
  writeTextFile(path: string, data: string): Promise<void>;
};

// ===== CONFIGURATION =====
// Modify these settings to customize your agent

// API Keys and Endpoints
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || ""; // Your OpenRouter API key
const OPENROUTER_MODEL =
  Deno.env.get("OPENROUTER_MODEL") || "openai/o3-mini-high"; // Model to use
const SERVER_API_KEY = Deno.env.get("SERVER_API_KEY") || ""; // Optional: Secure web server

// Server Configuration
const PORT = parseInt(Deno.env.get("PORT") || "8000"); // Web server port
const SERVER_MODE_ENABLED = true; // Set to false to disable web server mode

// Agent Configuration
const MAX_STEPS = 10; // Maximum reasoning steps
const DEFAULT_TEMPERATURE = 0.0; // Temperature for LLM calls
const MAX_TOKENS = 4000; // Maximum tokens for responses

// Scraping Configuration
const PUPPETEER_TIMEOUT = 30000; // Timeout for Puppeteer operations (30 seconds)
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"; // Default user agent

// Output Configuration
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

interface ScrapeConfig {
  url: string;
  selector?: string;
  waitFor?: string;
  extractProperty?: string;
  extractAttribute?: string;
  multiple?: boolean;
}

// ===== TOOL DEFINITIONS =====
// Scraping tools for the agent to use

const tools: Tool[] = [
  {
    name: "ScrapeURL",
    description:
      'Scrapes content from a URL using CSS selectors. Usage: ScrapeURL[{"url": "https://example.com", "selector": ".product-price", "multiple": true}]',
    run: async (input: string) => {
      try {
        const config: ScrapeConfig = JSON.parse(input);

        if (!config.url) {
          throw new Error("URL is required");
        }

        console.log(`Launching Puppeteer for URL: ${config.url}`);
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        // Set user agent and viewport
        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1280, height: 800 });

        try {
          // Navigate to the URL with timeout
          await page.goto(config.url, {
            timeout: PUPPETEER_TIMEOUT,
            waitUntil: "networkidle0",
          });

          // Wait for specific element if specified
          if (config.waitFor) {
            await page.waitForSelector(config.waitFor, {
              timeout: PUPPETEER_TIMEOUT,
            });
          }

          let result: string;
          if (config.selector) {
            if (config.multiple) {
              // Extract multiple elements
              result = await page.evaluate((params: ScrapeConfig) => {
                const elements = Array.from(
                  document.querySelectorAll(params.selector || "")
                );
                return elements
                  .map((el: Element) => {
                    if (params.extractProperty) {
                      return (el as any)[params.extractProperty];
                    } else if (params.extractAttribute) {
                      return el.getAttribute(params.extractAttribute);
                    } else {
                      return el.textContent;
                    }
                  })
                  .filter(Boolean)
                  .join("\n");
              }, config);
            } else {
              // Extract single element
              const element = await page.$(config.selector);
              if (!element) {
                result = `No element found matching selector: ${config.selector}`;
              } else {
                if (config.extractProperty) {
                  result = await element.evaluate((el: HTMLElement) => {
                    return String((el as any)[config.extractProperty || ""]);
                  });
                } else if (config.extractAttribute) {
                  result = await element.evaluate((el: HTMLElement) => {
                    return el.getAttribute(config.extractAttribute || "") || "";
                  });
                } else {
                  result = await element.evaluate((el: HTMLElement) => {
                    return el.textContent || "";
                  });
                }
              }
            }
          } else {
            // If no selector, get page title and URL as default
            result = await page.evaluate(() => {
              return `Title: ${document.title}\nURL: ${window.location.href}`;
            });
          }

          await browser.close();
          return result?.trim() || "No content extracted";
        } catch (err) {
          await browser.close();
          throw err;
        }
      } catch (err) {
        console.error("Scraping error:", err);
        return "Error: " + (err as Error).message;
      }
    },
  },

  {
    name: "ValidateURL",
    description:
      "Validates if a URL is properly formatted and accessible. Usage: ValidateURL[https://example.com]",
    run: async (input: string) => {
      try {
        const url = new URL(input.trim());
        const response = await fetch(url, { method: "HEAD" });
        return `URL is valid and returned status ${response.status}`;
      } catch (err) {
        return (
          "Error: Invalid URL or not accessible - " + (err as Error).message
        );
      }
    },
  },
];

// ===== SYSTEM PROMPT =====
// Scraping-focused system prompt

// Generate tool descriptions for the system prompt
const toolDescriptions = tools
  .map((t) => `${t.name}: ${t.description}`)
  .join("\n");

// The system prompt that instructs the model how to behave
const systemPrompt = `You are a web scraping assistant, tasked with extracting data from websites based on user requests.

You have access to the following tools:
${toolDescriptions}

When scraping websites:
1. Always validate URLs before scraping
2. Use appropriate CSS selectors to target specific content
3. Handle errors gracefully and provide meaningful feedback
4. Extract data in a structured format when possible

Follow this format strictly:
Thought: <your reasoning here>
Action: <ToolName>[<tool input>]
Observation: <result of the tool action>
... (you can repeat Thought/Action/Observation as needed) ...
Thought: <final reasoning>
Answer: <your final answer with the scraped data>

Your final answer MUST begin with "Answer: " and should include the extracted data in a clear format.
Only provide one action at a time, and wait for the observation before continuing.
You MUST use at least one tool before providing your final answer.

For ScrapeURL tool, you can specify these options in the JSON input:
- url: (required) The URL to scrape
- selector: CSS selector to target specific elements
- waitFor: CSS selector to wait for before scraping
- extractProperty: Property to extract (e.g., "innerText", "value")
- extractAttribute: Attribute to extract (e.g., "href", "src")
- multiple: true to extract multiple elements, false for single element
`;

// ===== LLM INTEGRATION =====
// Functions for interacting with the language model

// Store the last observation for fallback purposes
let lastObservation = "";

/**
 * Calls the OpenRouter API with the given messages.
 * @param messages - Array of chat messages to send to the LLM
 * @returns The model's response text
 */
async function callOpenRouter(messages: ChatMessage[]): Promise<string> {
  try {
    console.log("Calling OpenRouter API...");
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: messages,
          stop: ["Observation:"], // Stop generation before the model writes an observation
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: MAX_TOKENS,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error: HTTP ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    console.log(`OpenRouter API response received`);

    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      console.error("Empty or invalid response from OpenRouter API");
      throw new Error("Empty or invalid response from LLM");
    }

    return content;
  } catch (err) {
    console.error("Error calling OpenRouter:", err);
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
    { role: "user", content: query },
  ];

  console.log(`Starting agent with query: "${query}"`);
  lastObservation = ""; // Reset the last observation

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
          return `Based on the scraped data, here's what I found:\n\n${lastObservation}`;
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
            return `Based on the scraped data, here's what I found:\n\n${lastObservation}`;
          }
        }
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
        return `Based on the scraped data, here's what I found:\n\n${lastObservation}`;
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
        return `Based on the scraped data, here's what I found:\n\n${lastObservation}`;
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
    return `Based on the scraped data, here's what I found:\n\n${lastObservation}`;
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
 * @param query The original scraping query
 * @param answer The agent's answer
 * @returns A formatted markdown string
 */
function formatMarkdown(query: string, answer: string): string {
  return `# Scraping Results: ${query}\n\n${answer}\n\n${
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
    if (!OPENROUTER_API_KEY) {
      console.error("Error: OPENROUTER_API_KEY is not set in environment.");
      console.error("Please set it with: export OPENROUTER_API_KEY=your_key");
      Deno.exit(1);
    }

    console.log("Starting scraping agent...");
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
            message: "Welcome to the Scraping Agent API",
            usage:
              'Send a POST request with JSON body: { "query": "your scraping request" }' +
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
