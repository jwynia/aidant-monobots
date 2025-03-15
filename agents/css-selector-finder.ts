/**
 * CSS Selector Finder Agent (Deno)
 * 
 * This agent looks at a web URL and looks to figure out what the CSS selectors would be for the requested information.
 * It follows the ReACT pattern (Reasoning + Acting). It includes both CLI and web server modes, tool integration,
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
 * - Run with: `deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys css-selector-finder.ts`
 * - Install as command: `deno install --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --global --name css-selector-finder css-selector-finder.ts`
 * 
 * ## Usage
 * - CLI mode: `css-selector-finder "How do I get the product images, URLs, and titles for products on this page along with pagination links? http://example.com"`
 * - Web server: Send POST request to http://localhost:8000 with JSON body: `{ "query": "How do I get the product images, URLs, and titles for products on this page along with pagination links? http://example.com" }`
 * 
 * ## Configuration
 * - Set the OPENROUTER_API_KEY environment variable to your OpenRouter API key
 * - Set the OPENROUTER_MODEL environment variable to the model you want to use
 * - Set the SERVER_API_KEY environment variable to a secure key for the web server
 * - Set the PORT environment variable to the port you want to use for the web server
 * 
 */

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

// ===== CONFIGURATION =====
// Modify these settings to customize your agent
const PUPPETEER_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// API Keys and Endpoints
const LLM_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || ""; // Your LLM API key (OpenRouter by default)
const LLM_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openai/o3-mini-high"; // Model to use
const LLM_API_URL = "https://openrouter.ai/api/v1/chat/completions"; // API endpoint
const SERVER_API_KEY = Deno.env.get("SERVER_API_KEY") || ""; // Optional: Secure web server

// Server Configuration
const PORT = parseInt(Deno.env.get("PORT") || "8001"); // Web server port
const SERVER_MODE_ENABLED = true; // Set to false to disable web server mode

// Agent Configuration
const MAX_STEPS = 10; // Maximum reasoning steps
const DEFAULT_TEMPERATURE = 0.0; // Temperature for LLM calls
const MAX_TOKENS = 4000; // Maximum tokens for responses
const MAX_RETRIES = 3; // Maximum number of retries for failed API calls
const RETRY_DELAY_MS = 1000; // Delay between retries in milliseconds
const BROWSER_TIMEOUT = 60000; // Browser timeout in milliseconds (60 seconds)
const PAGE_LOAD_TIMEOUT = 30000; // Page load timeout in milliseconds (30 seconds)
const INCLUDE_TIMESTAMP = true; // Include timestamp in output files
const OUTPUT_FORMAT = "markdown"; // Output format: "markdown", "json", or "text"
const OUTPUT_DIR = Deno.env.get("OUTPUT_DIR") || "output"; // Directory to store output files

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

// ===== PUPPETEER BROWSER MANAGER =====
// Manages a single browser instance for all tools to use

let browser: any = null;

/**
 * Gets a browser instance, creating one if it doesn't exist.
 * @returns A Puppeteer browser instance
 */
async function getBrowser() {
  if (!browser) {
    console.log("Launching browser...");
    try {
      browser = await puppeteer.launch({
        executablePath: PUPPETEER_EXECUTABLE_PATH,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920,1080",
        ],
        timeout: BROWSER_TIMEOUT,
      });
    } catch (err) {
      console.error("Error launching browser:", err);
      // Try again with default executable path
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920,1080",
        ],
        timeout: BROWSER_TIMEOUT,
      });
    }
  }
  return browser;
}

/**
 * Closes the browser instance if it exists.
 */
async function closeBrowser() {
  if (browser) {
    console.log("Closing browser...");
    await browser.close();
    browser = null;
  }
}

// Make sure to close the browser when the process exits
Deno.addSignalListener("SIGINT", closeBrowser);
Deno.addSignalListener("SIGTERM", closeBrowser);

// ===== TOOL DEFINITIONS =====
// Add, remove, or modify tools here to extend agent capabilities

const tools: Tool[] = [
  {
    name: "GetPageContent",
    description: "Gets the HTML content of a web page. Usage: GetPageContent[http://example.com]",
    run: async (input: string) => {
      try {
        console.log(`Getting page content for: "${input}"`);
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        // Set a reasonable timeout and viewport
        await page.setDefaultNavigationTimeout(30000);
        await page.setViewport({ width: 1280, height: 800 });
        
        // Navigate to the URL
        await page.goto(input, { waitUntil: "networkidle0" });
        
        // Get the page HTML
        const content = await page.content();
        await page.close();
        
        // Return a truncated version if it's too large
        if (content.length > 10000) {
          return content.substring(0, 10000) + "... [content truncated due to size]";
        }
        return content;
      } catch (err) {
        console.error("Page content error:", err);
        return "Error: " + (err as Error).message;
      }
    }
  },
  {
    name: "QuerySelector",
    description: "Tests a CSS selector on the page and returns matching elements. Usage: QuerySelector[http://example.com | .product-title]",
    run: async (input: string) => {
      try {
        const [url, selector] = input.split("|").map(s => s.trim());
        if (!url || !selector) {
          return "Error: Input must be in format 'URL | CSS selector'";
        }
        
        console.log(`Testing selector "${selector}" on page "${url}"`);
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(url, { waitUntil: "networkidle0" });
        
        // Get count of matching elements
        // @ts-ignore - Element types are available in browser context
        const count = await page.$$eval(selector, (elements: Element[]) => elements.length);
        
        // Get text content of first few matching elements
        // @ts-ignore - Element types are available in browser context
        const elements = await page.$$eval(selector, (elements: Element[], maxElements = 5) => {
          return elements.slice(0, maxElements).map(el => {
            // Get basic info about the element
            const tagName = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const className = el.className && typeof el.className === 'string' ? `.${el.className.replace(/\s+/g, '.')}` : '';
            const text = el.textContent ? el.textContent.trim().substring(0, 100) : '';
            const href = el.href || '';
            const src = el.src || '';
            
            // Return a summary of the element
            return {
              element: `<${tagName}${id}${className}>`,
              text: text.length > 0 ? text : undefined,
              href: href.length > 0 ? href : undefined,
              src: src.length > 0 ? src : undefined
            };
          });
        });
        
        await page.close();
        
        return JSON.stringify({
          selector,
          count,
          sampleElements: elements
        }, null, 2);
      } catch (err) {
        console.error("Selector query error:", err);
        return "Error: " + (err as Error).message;
      }
    }
  },
  {
    name: "ExtractElements",
    description: "Extracts specific attributes from elements matching a CSS selector. Usage: ExtractElements[http://example.com | .product-card | title:h2, price:.price, image:img@src, link:a@href]",
    run: async (input: string) => {
      try {
        const parts = input.split("|").map(s => s.trim());
        if (parts.length < 3) {
          return "Error: Input must be in format 'URL | CSS selector | attribute1:selector1, attribute2:selector2@attr'";
        }
        
        const [url, baseSelector, attributesStr] = parts;
        const attributeMap = attributesStr.split(",").reduce((map, item) => {
          const [key, selectorWithAttr] = item.trim().split(":");
          if (key && selectorWithAttr) {
            const [selector, attr] = selectorWithAttr.split("@");
            map[key.trim()] = { selector: selector.trim(), attribute: attr?.trim() };
          }
          return map;
        }, {} as Record<string, {selector: string, attribute?: string}>);
        
        console.log(`Extracting elements with selector "${baseSelector}" from "${url}"`);
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(url, { waitUntil: "networkidle0" });
        
        // Extract data using the provided selectors and attributes
        // @ts-ignore - Element types are available in browser context
        const results = await page.$$eval(baseSelector, (elements: Element[], attributeMap: Record<string, {selector: string, attribute?: string}>) => {
          // @ts-ignore - Element types are available in browser context
          return elements.slice(0, 10).map((baseElement: Element) => {
            const result: Record<string, string | null> = {};
            
            for (const [key, {selector, attribute}] of Object.entries(attributeMap)) {
              try {
                // If selector is ".", use the base element itself
                const targetElement = selector === "." ? 
                  baseElement : 
                  baseElement.querySelector(selector);
                
                if (targetElement) {
                  if (attribute) {
                    result[key] = targetElement.getAttribute(attribute);
                  } else {
                    result[key] = targetElement.textContent?.trim() || null;
                  }
                } else {
                  result[key] = null;
                }
              } catch (e: unknown) {
                result[key] = `Error: ${(e as Error).message}`;
              }
            }
            
            return result;
          });
        }, attributeMap);
        
        await page.close();
        
        return JSON.stringify({
          baseSelector,
          count: results.length,
          results
        }, null, 2);
      } catch (err) {
        console.error("Element extraction error:", err);
        return "Error: " + (err as Error).message;
      }
    }
  },
  {
    name: "AnalyzePage",
    description: "Analyzes a page to identify common elements and suggests selectors. Usage: AnalyzePage[http://example.com]",
    run: async (input: string) => {
      try {
        console.log(`Analyzing page structure for: "${input}"`);
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(input, { waitUntil: "networkidle0" });
        
        // Analyze the page structure to find common patterns
        // Note: TypeScript will show errors for 'document' references, but this code runs in the browser context via puppeteer
        // where document is available. These errors can be ignored or suppressed with // @ts-ignore if needed.
        const analysis = await page.evaluate(() => {
          // Using any here since we're in the browser context where document is available
          const analysis: Record<string, any> = {
            // @ts-ignore - document exists in browser context
            title: document.title,
            links: {
              // @ts-ignore - document exists in browser context
              count: document.querySelectorAll('a').length,
              commonPatterns: []
            },
            images: {
              // @ts-ignore - document exists in browser context
              count: document.querySelectorAll('img').length,
              commonPatterns: []
            },
            lists: {
              // @ts-ignore - document exists in browser context
              count: document.querySelectorAll('ul, ol').length
            },
            tables: {
              // @ts-ignore - document exists in browser context
              count: document.querySelectorAll('table').length
            },
            forms: {
              // @ts-ignore - document exists in browser context
              count: document.querySelectorAll('form').length
            },
            possibleProductElements: [],
            possiblePaginationElements: []
          };
          
          // Look for common product patterns
          const productPatterns = [
            // @ts-ignore - document exists in browser context
            { selector: '.product', count: document.querySelectorAll('.product').length },
            // @ts-ignore - document exists in browser context
            { selector: '.product-card', count: document.querySelectorAll('.product-card').length },
            // @ts-ignore - document exists in browser context
            { selector: '.item', count: document.querySelectorAll('.item').length },
            // @ts-ignore - document exists in browser context
            { selector: '.card', count: document.querySelectorAll('.card').length },
            // @ts-ignore - document exists in browser context
            { selector: '[class*="product"]', count: document.querySelectorAll('[class*="product"]').length },
            // @ts-ignore - document exists in browser context
            { selector: '[class*="item"]', count: document.querySelectorAll('[class*="item"]').length }
          ];
          
          analysis.possibleProductElements = productPatterns
            .filter(p => p.count > 0)
            .sort((a, b) => b.count - a.count);
          
          // Look for pagination patterns
          const paginationPatterns = [
            // @ts-ignore - document exists in browser context
            { selector: '.pagination', count: document.querySelectorAll('.pagination').length },
            // @ts-ignore - document exists in browser context
            { selector: '.pager', count: document.querySelectorAll('.pager').length },
            // @ts-ignore - document exists in browser context
            { selector: 'nav ul li a', count: document.querySelectorAll('nav ul li a').length },
            // @ts-ignore - document exists in browser context
            { selector: '[class*="pagination"]', count: document.querySelectorAll('[class*="pagination"]').length },
            // @ts-ignore - document exists in browser context
            { selector: '[class*="pager"]', count: document.querySelectorAll('[class*="pager"]').length }
          ];
          
          analysis.possiblePaginationElements = paginationPatterns
            .filter(p => p.count > 0)
            .sort((a, b) => b.count - a.count);
          
          return analysis;
        });
        
        await page.close();
        
        return JSON.stringify(analysis, null, 2);
      } catch (err) {
        console.error("Page analysis error:", err);
        return "Error: " + (err as Error).message;
      }
    }
  }
];

// ===== SYSTEM PROMPT =====
// Customize this prompt to change the agent's behavior

// Generate tool descriptions for the system prompt
const toolDescriptions = tools.map(t => `${t.name}: ${t.description}`).join("\n");

// The system prompt that instructs the model how to behave
const systemPrompt = 
`You are a CSS selector expert. You are given a web page URL and a query about the page. You will use the provided tools to look at the page's DOM and figure out the CSS selectors to extract the requested information. Your final answer should be a data structure like the example below that indicates which piece of information is found via which CSS selector. 

You have access to the following tools:
${toolDescriptions}

Follow this process to find the right CSS selectors:
1. First use GetPageContent to see the HTML structure of the page
2. Use AnalyzePage to get an overview of the page structure and common patterns
3. Test potential selectors with QuerySelector to see if they match the expected elements
4. Use ExtractElements to extract specific data using the selectors you've identified

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

In your final answer, provide only a data structure like the example below that indicates which piece of information is found via which CSS selector.

Example output:

{
  "products": {
    "title": ".product-card a[href*='/products/']",
    "image": ".product-card img",
    "link": ".product-card a[href*='/products/']"
  },
  "pagination": "nav ul li a"
}
`;
// ===== LLM INTEGRATION =====
// Functions for interacting with the language model

/**
 * Calls the LLM API with retry logic.
 * @param messages The chat messages to send to the API
 * @returns The assistant's reply
 */
async function callLLM(messages: ChatMessage[]): Promise<string> {
  let retries = 0;
  
  while (retries <= MAX_RETRIES) {
    try {
      console.log(`Calling LLM API (attempt ${retries + 1}/${MAX_RETRIES + 1})...`);
      
      const response = await fetch(LLM_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LLM_API_KEY}`,
          "HTTP-Referer": "https://github.com/jwynia/aidant-monobots",
          "X-Title": "Aidant CSS Selector Finder",
        },
        body: JSON.stringify({
          model: LLM_MODEL,
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
      console.error(`Error calling LLM API:`, err);
      
      retries++;
      if (retries <= MAX_RETRIES) {
        console.log(`Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * retries));
        continue;
      }
      
      throw err;
    }
  }
  
  throw new Error(`Failed to call LLM API after ${MAX_RETRIES + 1} attempts`);
}

/**
 * Runs the agent with the provided query.
 * @param query The user's query
 * @returns The agent's answer
 */
async function runAgent(query: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  console.log(`Starting agent with query: "${query}"`);
  let partialAnswer = ""; // Store partial answers in case of premature termination
  let lastObservation = ""; // Store the last observation as a potential fallback
  let fallbackAnswer = ""; // Default fallback answer

  // Create a default fallback answer based on the query
  const urlMatch = query.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    const url = urlMatch[1];
    fallbackAnswer = `{
  "productSelectors": {
    "image": ".product-card img, .product img, [class*='product'] img",
    "url": ".product-card a[href*='/products/'], .product a[href*='/products/'], [class*='product'] a[href*='/products/']",
    "title": ".product-card [class*='title'], .product [class*='title'], .product-card h2, .product h2, .product-card h3, .product h3"
  },
  "paginationSelector": "nav ul li a, .pagination a, [class*='pagination'] a"
}

Explanation:
• Product image selectors target img tags within product cards or containers
• Product URL selectors target anchor tags with '/products/' in the href
• Product title selectors target elements with 'title' in the class name or heading elements
• Pagination selectors target anchor tags within navigation elements or pagination containers

These are generic selectors that should work for many e-commerce sites. You may need to adjust them based on the specific structure of ${url}.`;
  } else {
    fallbackAnswer = `{
  "productSelectors": {
    "image": ".product-card img, .product img, [class*='product'] img",
    "url": ".product-card a[href*='/products/'], .product a[href*='/products/'], [class*='product'] a[href*='/products/']",
    "title": ".product-card [class*='title'], .product [class*='title'], .product-card h2, .product h2, .product-card h3, .product h3"
  },
  "paginationSelector": "nav ul li a, .pagination a, [class*='pagination'] a"
}

Explanation:
• Product image selectors target img tags within product cards or containers
• Product URL selectors target anchor tags with '/products/' in the href
• Product title selectors target elements with 'title' in the class name or heading elements
• Pagination selectors target anchor tags within navigation elements or pagination containers

These are generic selectors that should work for many e-commerce sites. You may need to adjust them based on the specific page structure.`;
  }

  try {
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
          } else if (partialAnswer && partialAnswer.length > 0) {
            // If we have a partial answer, use it
            console.log("Using partial answer as fallback");
            return `Based on partial analysis, here's what I found:\n\n${partialAnswer}`;
          } else {
            // Use the default fallback answer
            console.log("Found empty answer, using default fallback");
            return fallbackAnswer;
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
        const answerMatch = assistantReply.match(/Answer:\s*([\s\S]*?)$/);
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
            } else if (partialAnswer && partialAnswer.length > 0) {
              // If we have a partial answer, use it
              console.log("Using partial answer as fallback");
              return `Based on partial analysis, here's what I found:\n\n${partialAnswer}`;
            } else {
              // Use the default fallback answer
              console.log("Found empty answer, using default fallback");
              return fallbackAnswer;
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
          return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
        } else if (partialAnswer && partialAnswer.length > 0) {
          // If we have a partial answer, use it
          console.log("Using partial answer as fallback");
          return `Based on partial analysis, here's what I found:\n\n${partialAnswer}`;
        } else {
          // Use the default fallback answer
          console.log("No fallback available, using default fallback");
          return fallbackAnswer;
        }
      } catch (err) {
        console.error(`Error in step ${step + 1}:`, err);

        // If we have a fallback observation, use it instead of failing
        if (lastObservation && lastObservation.length > 0) {
          console.log(
            "Error occurred, using last observation as fallback answer"
          );
          return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
        } else if (partialAnswer && partialAnswer.length > 0) {
          // If we have a partial answer, use it
          console.log("Error occurred, using partial answer as fallback");
          return `Based on partial analysis, here's what I found:\n\n${partialAnswer}`;
        } else {
          // Use the default fallback answer
          console.log("Error occurred, using default fallback answer");
          return fallbackAnswer;
        }
      }
    }

    console.error("Agent did not produce a final answer within the step limit");

    // If we have a fallback observation, use it instead of failing
    if (lastObservation && lastObservation.length > 0) {
      console.log(
        "Step limit reached, using last observation as fallback answer"
      );
      return `Based on my analysis, here's what I found:\n\n${lastObservation}`;
    } else if (partialAnswer && partialAnswer.length > 0) {
      // If we have a partial answer, use it
      console.log("Step limit reached, using partial answer as fallback");
      return `Based on partial analysis, here's what I found:\n\n${partialAnswer}`;
    } else {
      // Use the default fallback answer
      console.log("Step limit reached, using default fallback answer");
      return fallbackAnswer;
    }
  } finally {
    // Always close the browser when done
    await closeBrowser();
  }
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
  runCliMode(query).finally(closeBrowser);
} else {
  // Start in web server mode
  startWebServer();
  
  // Add a shutdown hook for the web server mode
  Deno.addSignalListener("SIGINT", async () => {
    await closeBrowser();
    Deno.exit(0);
  });
}
