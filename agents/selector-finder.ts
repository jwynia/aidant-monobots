/**
 * Single File ReAct Selector Finder Agent (Deno)
 *
 * This agent analyzes web pages to find optimal CSS selectors for specific content.
 * It works in conjunction with the scraping agent to make web scraping more efficient
 * by automatically identifying the right selectors for extracting content.
 *
 * ## Features
 * - Dual-mode operation (CLI and web server)
 * - ReACT pattern implementation (Thought → Action → Observation loop)
 * - Puppeteer integration for webpage analysis
 * - Automatic selector generation and testing
 * - Integration with scraping agent
 *
 * ## Setup
 * - Ensure you have a Deno runtime available
 * - Set the environment variable `OPENROUTER_API_KEY` with your OpenRouter API key
 * - (Optional) Set `OPENROUTER_MODEL` to specify the model (default is "openai/o3-mini-high")
 * - (Optional) Set `SERVER_API_KEY` to secure the web server API
 * - Run with: `deno run --allow-read --allow-write --allow-net --allow-env --allow-run selector-finder.ts`
 * - Install as command: `deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name find-selector selector-finder.ts`
 *
 * ## Usage
 * - CLI mode: `find-selector "Find selectors for product prices on example.com/products"`
 * - Web server: Send POST request to http://localhost:8001 with JSON body: `{ "query": "Find selectors for product prices on example.com/products" }`
 */

import { serve } from "std/http/server.ts";
import puppeteer, { ElementHandle, Page } from "puppeteer";

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
const PORT = parseInt(Deno.env.get("PORT") || "8001"); // Web server port (different from scraping agent)
const SERVER_MODE_ENABLED = true; // Set to false to disable web server mode

// Agent Configuration
const MAX_STEPS = 10; // Maximum reasoning steps
const DEFAULT_TEMPERATURE = 0.0; // Temperature for LLM calls
const MAX_TOKENS = 4000; // Maximum tokens for responses

// Analysis Configuration
const PUPPETEER_TIMEOUT = 30000; // Timeout for Puppeteer operations (30 seconds)
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const MAX_ELEMENTS_TO_ANALYZE = 100; // Maximum number of elements to analyze
const MIN_CONFIDENCE_SCORE = 0.5; // Minimum confidence score for selector recommendations

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

interface ElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  textContent: string;
  innerHtml: string;
  xpath: string;
  selector: string;
  role?: string;
  type?: string;
  name?: string;
}

interface SelectorRecommendation {
  purpose: string;
  selector: string;
  confidence: number;
  sample_matches: string[];
  usage: {
    scraping_agent: {
      selector: string;
      multiple: boolean;
      waitFor?: string;
      extractProperty?: string;
      extractAttribute?: string;
    };
  };
}

interface AnalysisResult {
  url: string;
  description: string;
  recommendations: SelectorRecommendation[];
}

// ===== HELPER FUNCTIONS =====
// Utility functions for selector analysis

/**
 * Extracts all relevant information about an element
 */
async function getElementInfo(element: ElementHandle): Promise<ElementInfo> {
  const info = await element.evaluate((el: HTMLElement) => {
    // Get element attributes
    const attrs: Record<string, string> = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }

    // Get xpath
    function getXPath(element: HTMLElement): string {
      if (element.id) {
        return `//*[@id="${element.id}"]`;
      }
      if (element === document.body) {
        return "/html/body";
      }
      if (!element.parentElement) {
        return "";
      }
      const sameTagSiblings = Array.from(element.parentElement.children).filter(
        (e: Element) => e.tagName === element.tagName
      );
      const idx = sameTagSiblings.indexOf(element) + 1;
      return `${getXPath(
        element.parentElement as HTMLElement
      )}/${element.tagName.toLowerCase()}[${idx}]`;
    }

    // Get unique selector
    function getSelector(element: HTMLElement): string {
      if (element.id) {
        return `#${element.id}`;
      }
      const classes = Array.from(element.classList).join(".");
      if (classes) {
        return `.${classes}`;
      }
      const tag = element.tagName.toLowerCase();
      if (!element.parentElement) {
        return tag;
      }
      const siblings = Array.from(element.parentElement.children).filter(
        (e: Element) => e.tagName === element.tagName
      );
      const idx = siblings.indexOf(element) + 1;
      return `${getSelector(
        element.parentElement as HTMLElement
      )} > ${tag}:nth-child(${idx})`;
    }

    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: Array.from(el.classList),
      attributes: attrs,
      textContent: el.textContent?.trim() || "",
      innerHtml: el.innerHTML,
      xpath: getXPath(el),
      selector: getSelector(el),
      role: el.getAttribute("role") || undefined,
      type: el.getAttribute("type") || undefined,
      name: el.getAttribute("name") || undefined,
    };
  });

  return info;
}

/**
 * Calculates a confidence score for a selector based on various factors
 */
function calculateConfidence(
  selector: string,
  matches: ElementInfo[],
  description: string
): number {
  let score = 0;

  // Prefer simpler selectors
  score += 1 - selector.split(/[\s>]/).length / 10; // Max depth of 10

  // Prefer ID-based selectors
  if (selector.includes("#")) {
    score += 0.3;
  }

  // Prefer class-based selectors
  if (selector.includes(".")) {
    score += 0.2;
  }

  // Prefer semantic selectors
  if (matches.some((m) => m.role || m.type || m.name)) {
    score += 0.2;
  }

  // Check if content matches description
  const descriptionWords = description.toLowerCase().split(/\W+/);
  const contentMatches = matches.some((m) =>
    descriptionWords.some(
      (word) =>
        m.textContent.toLowerCase().includes(word) ||
        m.attributes.title?.toLowerCase().includes(word) ||
        m.attributes["aria-label"]?.toLowerCase().includes(word)
    )
  );
  if (contentMatches) {
    score += 0.3;
  }

  // Normalize score to 0-1 range
  return Math.min(Math.max(score, 0), 1);
}

/**
 * Generates multiple potential selectors for an element
 */
function generateSelectors(info: ElementInfo): string[] {
  const selectors: string[] = [];

  // ID selector
  if (info.id) {
    selectors.push(`#${info.id}`);
  }

  // Class selectors
  if (info.classes.length > 0) {
    selectors.push(`.${info.classes.join(".")}`);
    // Try combinations of classes
    if (info.classes.length > 1) {
      for (const cls of info.classes) {
        selectors.push(`.${cls}`);
      }
    }
  }

  // Attribute selectors
  for (const [attr, value] of Object.entries(info.attributes)) {
    if (attr !== "id" && attr !== "class") {
      selectors.push(`[${attr}="${value}"]`);
    }
  }

  // Role selectors
  if (info.role) {
    selectors.push(`[role="${info.role}"]`);
  }

  // Tag + attribute combinations
  selectors.push(
    info.tagName + (info.classes.length ? `.${info.classes[0]}` : "")
  );
  if (info.type) {
    selectors.push(`${info.tagName}[type="${info.type}"]`);
  }
  if (info.name) {
    selectors.push(`${info.tagName}[name="${info.name}"]`);
  }

  return [...new Set(selectors)]; // Remove duplicates
}

// ===== TOOL DEFINITIONS =====
// Analysis tools for the agent to use

const tools: Tool[] = [
  {
    name: "AnalyzePage",
    description:
      'Analyzes a webpage to find elements matching a description. Usage: AnalyzePage[{"url": "https://example.com", "description": "product prices"}]',
    run: async (input: string) => {
      try {
        const { url, description } = JSON.parse(input);

        if (!url) {
          throw new Error("URL is required");
        }

        console.log(`Launching Puppeteer for URL: ${url}`);
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        try {
          // Set user agent and viewport
          await page.setUserAgent(USER_AGENT);
          await page.setViewport({ width: 1280, height: 800 });

          // Navigate to the URL
          await page.goto(url, {
            timeout: PUPPETEER_TIMEOUT,
            waitUntil: "networkidle0",
          });

          // Get all elements
          const elements = await page.$$("*");
          const elementInfos: ElementInfo[] = [];

          // Analyze each element (up to MAX_ELEMENTS_TO_ANALYZE)
          for (const element of elements.slice(0, MAX_ELEMENTS_TO_ANALYZE)) {
            const info = await getElementInfo(element);
            elementInfos.push(info);
          }

          // Group similar elements
          const groups = new Map<string, ElementInfo[]>();
          for (const info of elementInfos) {
            const key = `${info.tagName}-${info.classes.sort().join("-")}`;
            if (!groups.has(key)) {
              groups.set(key, []);
            }
            groups.get(key)?.push(info);
          }

          // Generate and test selectors for each group
          const recommendations: SelectorRecommendation[] = [];

          for (const [_key, group] of groups) {
            if (group.length === 0) continue;

            // Generate potential selectors
            const selectors = generateSelectors(group[0]);

            for (const selector of selectors) {
              // Test selector
              const matches = await page.$$(selector);
              if (matches.length === 0) continue;

              // Get info for all matching elements
              const matchInfos: ElementInfo[] = [];
              for (const match of matches) {
                matchInfos.push(await getElementInfo(match));
              }

              // Calculate confidence score
              const confidence = calculateConfidence(
                selector,
                matchInfos,
                description
              );
              if (confidence < MIN_CONFIDENCE_SCORE) continue;

              // Get sample content
              const samples = matchInfos
                .map((m) => m.textContent)
                .filter(Boolean)
                .slice(0, 3);

              // Add recommendation
              recommendations.push({
                purpose: description,
                selector,
                confidence,
                sample_matches: samples,
                usage: {
                  scraping_agent: {
                    selector,
                    multiple: matches.length > 1,
                  },
                },
              });
            }
          }

          // Sort by confidence
          recommendations.sort((a, b) => b.confidence - a.confidence);

          // Take top 3 recommendations
          const result: AnalysisResult = {
            url,
            description,
            recommendations: recommendations.slice(0, 3),
          };

          await browser.close();
          return JSON.stringify(result, null, 2);
        } catch (err) {
          await browser.close();
          throw err;
        }
      } catch (err) {
        console.error("Analysis error:", err);
        return "Error: " + (err as Error).message;
      }
    },
  },

  {
    name: "TestSelector",
    description:
      'Tests a CSS selector on a webpage. Usage: TestSelector[{"url": "https://example.com", "selector": ".product-price"}]',
    run: async (input: string) => {
      try {
        const { url, selector } = JSON.parse(input);

        if (!url || !selector) {
          throw new Error("URL and selector are required");
        }

        console.log(`Testing selector "${selector}" on ${url}`);
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        try {
          await page.setUserAgent(USER_AGENT);
          await page.setViewport({ width: 1280, height: 800 });
          await page.goto(url, {
            timeout: PUPPETEER_TIMEOUT,
            waitUntil: "networkidle0",
          });

          // Test the selector
          const elements = await page.$$(selector);
          const results = [];

          for (const element of elements) {
            const info = await getElementInfo(element);
            results.push({
              text: info.textContent,
              html: info.innerHtml,
              attributes: info.attributes,
            });
          }

          await browser.close();
          return JSON.stringify(
            {
              selector,
              matches: elements.length,
              samples: results.slice(0, 3),
            },
            null,
            2
          );
        } catch (err) {
          await browser.close();
          throw err;
        }
      } catch (err) {
        console.error("Testing error:", err);
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
// Selector analysis focused system prompt

// Generate tool descriptions for the system prompt
const toolDescriptions = tools
  .map((t) => `${t.name}: ${t.description}`)
  .join("\n");

// The system prompt that instructs the model how to behave
const systemPrompt = `You are a CSS selector finder assistant, tasked with analyzing web pages to find optimal selectors for extracting specific content.

You have access to the following tools:
${toolDescriptions}

When analyzing web pages:
1. Always validate URLs before analysis
2. Use AnalyzePage to find potential selectors
3. Test promising selectors to verify accuracy
4. Provide clear recommendations with examples

Follow this format strictly:
Thought: <your reasoning here>
Action: <ToolName>[<tool input>]
Observation: <result of the tool action>
... (you can repeat Thought/Action/Observation as needed) ...
Thought: <final reasoning>
Answer: <your final answer with recommended selectors>

Your final answer MUST begin with "Answer: " and should include:
1. The recommended selectors
2. Sample content they match
3. Confidence scores
4. Ready-to-use configurations for the scraping agent

Only provide one action at a time, and wait for the observation before continuing.
You MUST use at least one tool before providing your final answer.`;

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
          return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
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
            return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
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
        return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
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
        return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
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
    return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
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
 * @param query The original analysis query
 * @param answer The agent's answer
 * @returns A formatted markdown string
 */
function formatMarkdown(query: string, answer: string): string {
  return `# Selector Analysis: ${query}\n\n${answer}\n\n${
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

    console.log("Starting selector finder agent...");
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
            message: "Welcome to the Selector Finder API",
            usage:
              'Send a POST request with JSON body: { "query": "Find selectors for product prices on example.com" }' +
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
