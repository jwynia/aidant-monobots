/**
 * Agentic Selector Finder (Deno)
 *
 * This agent analyzes web pages to find optimal CSS selectors for specific content.
 * It uses a ReACT pattern (Reasoning, Action, Observation) to dynamically explore
 * the DOM and determine appropriate selectors based on the user's query.
 *
 * ## Features
 * - Dual-mode operation (CLI and web server)
 * - ReACT pattern implementation for DOM analysis
 * - Puppeteer integration for webpage analysis
 * - LLM-driven selector generation and testing
 * - Integration with scraping agent
 *
 * ## Setup
 * - Ensure you have a Deno runtime available
 * - Set the environment variable `OPENROUTER_API_KEY` with your OpenRouter API key
 * - (Optional) Set `OPENROUTER_MODEL` to specify the model (default is "openai/o3-mini-high")
 * - (Optional) Set `SERVER_API_KEY` to secure the web server API
 * - Run with: `deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys selector-finder.ts`
 * - Install as command: `deno install --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --global --name find-selector selector-finder.ts`
 *
 * ## Usage
 * - CLI mode: `find-selector "Find selectors for product prices on example.com/products"`
 * - Web server: Send POST request to http://localhost:8001 with JSON body: `{ "query": "Find selectors for product prices on example.com/products" }`
 */

import { serve } from "std/http/server.ts";
import puppeteer from "npm:puppeteer";

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

// Server Configuration
const SERVER_API_KEY = Deno.env.get("SERVER_API_KEY") || ""; // Optional: Secure web server

// Server Configuration
const PORT = parseInt(Deno.env.get("PORT") || "8001"); // Web server port
const SERVER_MODE_ENABLED = true; // Set to false to disable web server mode


// Analysis Configuration
const PUPPETEER_TIMEOUT = 60000; // Timeout for Puppeteer operations (60 seconds)
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// Output Configuration
const INCLUDE_TIMESTAMP = true; // Include timestamp in output files

// ===== INTERFACE DEFINITIONS =====
interface Tool {
  name: string;
  description: string;
  run: (input: string) => Promise<string> | string;
}

interface SelectorResult {
  selector: string;
  count: number;
  sample: string;
}

interface SelectorConfig {
  selector: string;
  waitFor?: string;
  fields?: Record<string, {
    selector: string;
    attribute?: string;
  }>;
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
  query: string;
  recommendations: SelectorRecommendation[];
}

// ===== DOM ANALYSIS TOOLS =====
// These tools allow the LLM to explore and analyze the DOM

/**
 * Creates the tools for DOM analysis
 */
function createDomTools(page: any, url: string): Tool[] {
  return [
    {
      name: "AnalyzePageStructure",
      description: "Get a high-level overview of the page structure to understand its organization",
      run: async () => {
        try {
          const structure = await page.evaluate(() => {
            // Get basic page info
            const title = document.title;
            const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            
            // Count elements by tag
            const tagCounts: Record<string, number> = {};
            const allElements = document.querySelectorAll('*');
            allElements.forEach((el: Element) => {
              const tag = el.tagName.toLowerCase();
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
            
            // Find most common class names
            const classCounts: Record<string, number> = {};
            allElements.forEach((el: Element) => {
              if (el.classList) {
                Array.from(el.classList).forEach((cls: string) => {
                  classCounts[cls] = (classCounts[cls] || 0) + 1;
                });
              }
            });
            
            // Sort class counts and get top 20
            const topClasses = Object.entries(classCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([cls, count]) => ({ class: cls, count }));
            
            // Identify potential container elements
            const containers: any[] = [];
            const containerTags = ['div', 'section', 'article', 'main', 'ul', 'ol'];
            
            for (const tag of containerTags) {
              const elements = document.querySelectorAll(tag);
              for (const el of elements) {
                // Check if it has multiple similar children
                const children = el.children;
                if (children.length >= 3) {
                  // Check if children are similar (same tag)
                  const childTags = Array.from(children).map((c: Element) => c.tagName);
                  const uniqueTags = new Set(childTags);
                  
                  if (uniqueTags.size <= 3 && children.length >= 3) {
                    // This might be a container
                    const classes = Array.from(el.classList).join('.');
                    const selector = tag + (classes ? '.' + classes : '');
                    containers.push({
                      selector,
                      childCount: children.length,
                      childTags: Array.from(uniqueTags)
                    });
                  }
                }
              }
            }
            
            // Sort containers by child count
            containers.sort((a, b) => b.childCount - a.childCount);
            
            return {
              title,
              metaDescription,
              tagCounts,
              topClasses,
              potentialContainers: containers.slice(0, 10)
            };
          });
          
          return JSON.stringify(structure, null, 2);
        } catch (err) {
          return `Error analyzing page structure: ${(err as Error).message}`;
        }
      }
    },
    
    {
      name: "QueryElements",
      description: 'Find elements matching a description. Usage: QueryElements[{"description": "product prices", "limit": 5}]',
      run: async (input: string) => {
        try {
          const { description, limit = 5 } = JSON.parse(input);
          
          // Use the description to generate potential selectors
          const selectors = await generateSelectorsFromDescription(description);
          
          // Test each selector
          const results = [];
          for (const selector of selectors) {
            try {
              const elements = await page.$$(selector);
              if (elements.length > 0) {
                // Get sample content
                const samples = await Promise.all(
                  elements.slice(0, limit).map(async (el: any) => {
                    return page.evaluate((element: any) => {
                      return {
                        text: element.textContent?.trim() || '',
                        html: element.innerHTML,
                        outerHTML: element.outerHTML
                      };
                    }, el);
                  })
                );
                
                results.push({
                  selector,
                  count: elements.length,
                  samples
                });
              }
            } catch (err) {
              console.error(`Error testing selector ${selector}:`, err);
            }
          }
          
          return JSON.stringify(results, null, 2);
        } catch (err) {
          return `Error querying elements: ${(err as Error).message}`;
        }
      }
    },
    
    {
      name: "TestSelector",
      description: 'Test a CSS selector and return matching elements. Usage: TestSelector[{"selector": ".product-price", "limit": 5, "attribute": "src"}]',
      run: async (input: string) => {
        try {
          const { selector, limit = 5, attribute } = JSON.parse(input);
          
          const elements = await page.$$(selector);
          if (elements.length === 0) {
            return `No elements found matching selector: ${selector}`;
          }
          
          // Get sample content
          const samples = await Promise.all(
            elements.slice(0, limit).map(async (el: any) => {
              return page.evaluate((element: any, attr: string) => {
                let attributeValue = null;
                if (attr) {
                  attributeValue = element.getAttribute(attr);
                }
                
                return {
                  text: element.textContent?.trim() || '',
                  html: element.innerHTML,
                  attribute: attr ? { name: attr, value: attributeValue } : null
                };
              }, el, attribute);
            })
          );
          
          return JSON.stringify({
            selector,
            count: elements.length,
            samples
          }, null, 2);
        } catch (err) {
          return `Error testing selector: ${(err as Error).message}`;
        }
      }
    },
    
    {
      name: "ExtractURL",
      description: "Extract the URL from the query if it contains one",
      run: async (input: string) => {
        try {
          // Look for URL patterns in the input
          const urlPattern = /(https?:\/\/[^\s]+)/g;
          const matches = input.match(urlPattern);
          
          if (matches && matches.length > 0) {
            return matches[0];
          } else {
            return `No URL found in: ${input}`;
          }
        } catch (err) {
          return `Error extracting URL: ${(err as Error).message}`;
        }
      }
    },
    
    {
      name: "AnalyzeContent",
      description: 'Analyze content of elements to determine patterns. Usage: AnalyzeContent[{"selector": ".product-card", "limit": 10}]',
      run: async (input: string) => {
        try {
          const { selector, limit = 10 } = JSON.parse(input);
          
          const elements = await page.$$(selector);
          if (elements.length === 0) {
            return `No elements found matching selector: ${selector}`;
          }
          
          // Analyze the elements to find common patterns
          const analysis = await page.evaluate((sel: string, lim: number) => {
            const elements = document.querySelectorAll(sel);
            const sampleElements = Array.from(elements).slice(0, lim);
            
            // Find common child elements
            const childSelectors: Record<string, number> = {};
            
            sampleElements.forEach((el: Element) => {
              // Check direct children
              Array.from(el.children).forEach((child: any) => {
                const tag = child.tagName.toLowerCase();
                const classes = Array.from(child.classList).join('.');
                const selector = tag + (classes ? '.' + classes : '');
                
                childSelectors[selector] = (childSelectors[selector] || 0) + 1;
              });
              
              // Check for common patterns like images, links, headings
              if (el.querySelector('img')) {
                childSelectors['img'] = (childSelectors['img'] || 0) + 1;
              }
              
              if (el.querySelector('a')) {
                childSelectors['a'] = (childSelectors['a'] || 0) + 1;
              }
              
              if (el.querySelector('h1, h2, h3, h4, h5, h6')) {
                childSelectors['heading'] = (childSelectors['heading'] || 0) + 1;
              }
              
              // Check for price patterns
              const text = el.textContent || '';
              if (text.match(/\$\d+(\.\d{2})?/) || 
                  text.match(/€\d+(\.\d{2})?/) || 
                  text.match(/£\d+(\.\d{2})?/)) {
                childSelectors['price_pattern'] = (childSelectors['price_pattern'] || 0) + 1;
              }
            });
            
            // Sort by frequency
            const commonChildren = Object.entries(childSelectors)
              .sort((a, b) => b[1] - a[1])
              .map(([selector, count]) => ({ 
                selector, 
                count, 
                percentage: Math.round((count / sampleElements.length) * 100) 
              }));
            
            return {
              totalElements: elements.length,
              analyzed: sampleElements.length,
              commonChildren
            };
          }, selector, limit);
          
          return JSON.stringify(analysis, null, 2);
        } catch (err) {
          return `Error analyzing content: ${(err as Error).message}`;
        }
      }
    },
    
    {
      name: "GenerateConfig",
      description: 'Generate a scraping configuration based on findings. Usage: GenerateConfig[{"containerSelector": ".product-card", "fields": {"title": ".title", "price": ".price", "image": {"selector": "img", "attribute": "src"}}}]',
      run: async (input: string) => {
        try {
          const config = JSON.parse(input);
          
          // Extract domain from URL for config filename
          const domain = new URL(url).hostname.replace(/^www\./, '');
          const configFilename = `${domain}-config.json`;
          
          // Write the config to a file
          await Deno.writeTextFile(configFilename, JSON.stringify(config, null, 2));
          
          return `Configuration saved to ${configFilename}`;
        } catch (err) {
          return `Error generating config: ${(err as Error).message}`;
        }
      }
    }
  ];
}

/**
 * Generate potential selectors based on a natural language description
 */
async function generateSelectorsFromDescription(description: string): Promise<string[]> {
  // This is a simplified version - in a real implementation, we would use the LLM
  // to generate selectors based on the description
  
  const descriptionLower = description.toLowerCase();
  
  // Common selector patterns based on description keywords
  const selectorPatterns: Record<string, string[]> = {
    'price': ['.price', '[class*="price"]', '.amount', '.money', '[data-price]'],
    'title': ['h1', 'h2', 'h3', '.title', '[class*="title"]', '.name', '[class*="name"]'],
    'image': ['img', '[class*="image"] img', 'picture img', '[data-src]'],
    'product': ['.product', '.product-card', '.item', '.card', '[class*="product"]'],
    'article': ['article', '.post', '.article', '.blog-post'],
    'navigation': ['nav', '.nav', '.menu', '.navigation', 'header a'],
    'button': ['button', '.btn', '[class*="button"]', 'a.button'],
    'link': ['a', '.link', '[href]'],
    'container': ['.container', '.wrapper', '.content', 'main', 'section'],
    'list': ['ul', 'ol', '.list', '[class*="list"]', '.grid'],
    'form': ['form', '.form', '[class*="form"]'],
    'input': ['input', 'textarea', 'select', '[class*="input"]'],
    'header': ['header', '.header', '[class*="header"]'],
    'footer': ['footer', '.footer', '[class*="footer"]'],
    'sidebar': ['.sidebar', '[class*="sidebar"]', 'aside'],
    'card': ['.card', '[class*="card"]', '.item', '.box'],
    'text': ['p', '.text', '[class*="text"]', '.description'],
    'date': ['.date', '[class*="date"]', 'time', '[datetime]'],
    'author': ['.author', '[class*="author"]', '.byline'],
    'comment': ['.comment', '[class*="comment"]'],
    'rating': ['.rating', '[class*="rating"]', '.stars'],
    'social': ['.social', '[class*="social"]', '.share'],
    'search': ['.search', '[class*="search"]', 'input[type="search"]'],
    'video': ['video', '.video', '[class*="video"]', 'iframe[src*="youtube"]'],
    'audio': ['audio', '.audio', '[class*="audio"]'],
    'gallery': ['.gallery', '[class*="gallery"]', '.carousel', '.slider']
  };
  
  // Find matching patterns based on description
  const selectors: string[] = [];
  
  for (const [key, patterns] of Object.entries(selectorPatterns)) {
    if (descriptionLower.includes(key)) {
      selectors.push(...patterns);
    }
  }
  
  // Add some generic selectors if we don't have many matches
  if (selectors.length < 5) {
    selectors.push('div', 'span', 'a', 'p', 'h1', 'h2', 'h3', 'img');
  }
  
  // Remove duplicates
  return [...new Set(selectors)];
}

// ===== LLM INTEGRATION =====
// Functions for interacting with the language model


/**
 * Parse the query to extract the URL and content description
 */
function parseQuery(query: string): { url: string; contentDescription: string } {
  // Extract URL from query
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const urlMatches = query.match(urlPattern);
  
  if (!urlMatches || urlMatches.length === 0) {
    throw new Error("No URL found in the query. Please include a URL to analyze.");
  }
  
  const url = urlMatches[0];
  
  // Remove the URL from the query to get the content description
  let contentDescription = query.replace(url, "").trim();
  
  // Clean up the content description
  contentDescription = contentDescription
    .replace(/^find\s+/i, "")
    .replace(/^get\s+/i, "")
    .replace(/^extract\s+/i, "")
    .replace(/\s+on\s+$/i, "")
    .replace(/\s+from\s+$/i, "")
    .replace(/\s+in\s+$/i, "");
  
  // If no content description is provided, use a default
  if (!contentDescription) {
    contentDescription = "product information";
  }
  
  return { url, contentDescription };
}

/**
 * Determine the content type from the content description
 */
function determineContentType(contentDescription: string): string {
  const contentDescription_lower = contentDescription.toLowerCase();
  
  // Check for product-related terms
  if (
    contentDescription_lower.includes("product") ||
    contentDescription_lower.includes("price") ||
    contentDescription_lower.includes("item") ||
    contentDescription_lower.includes("shop") ||
    contentDescription_lower.includes("store") ||
    contentDescription_lower.includes("buy")
  ) {
    return "product";
  }
  
  // Check for article-related terms
  if (
    contentDescription_lower.includes("article") ||
    contentDescription_lower.includes("blog") ||
    contentDescription_lower.includes("post") ||
    contentDescription_lower.includes("news") ||
    contentDescription_lower.includes("author") ||
    contentDescription_lower.includes("date") ||
    contentDescription_lower.includes("publish")
  ) {
    return "article";
  }
  
  // Check for navigation-related terms
  if (
    contentDescription_lower.includes("nav") ||
    contentDescription_lower.includes("menu") ||
    contentDescription_lower.includes("header") ||
    contentDescription_lower.includes("link") ||
    contentDescription_lower.includes("site map")
  ) {
    return "navigation";
  }
  
  // Check for form-related terms
  if (
    contentDescription_lower.includes("form") ||
    contentDescription_lower.includes("input") ||
    contentDescription_lower.includes("field") ||
    contentDescription_lower.includes("button") ||
    contentDescription_lower.includes("submit") ||
    contentDescription_lower.includes("contact")
  ) {
    return "form";
  }
  
  // Default to product if no specific type is detected
  return "product";
}

/**
 * Get container selectors based on content type
 */
function getContainerSelectors(contentType: string): string[] {
  switch (contentType) {
    case "product":
      return [
        '.product-card', 
        '.product-wrap', 
        '.product', 
        '.product-item',
        '.grid__item',
        '[data-product-card]',
        '.product-grid-item',
        '.product-list-item',
        '.item',
        '.card'
      ];
    case "article":
      return [
        'article',
        '.post',
        '.blog-post',
        '.article',
        '.news-item',
        '.entry',
        '.blog-entry',
        '.content-item',
        '.post-item',
        '.story'
      ];
    case "navigation":
      return [
        'nav',
        '.nav',
        '.navigation',
        '.menu',
        '.main-menu',
        '.navbar',
        'header ul',
        '.site-nav',
        '.header-menu',
        '.nav-menu'
      ];
    case "form":
      return [
        'form',
        '.form',
        '.contact-form',
        '.form-container',
        '.input-group',
        '.form-group',
        '.form-wrapper',
        '.contact-container',
        '.form-section',
        '.form-area'
      ];
    default:
      return [
        '.product-card', 
        '.product-wrap', 
        '.product', 
        '.item',
        '.card',
        'article',
        '.post',
        'li',
        '.grid-item',
        '.col'
      ];
  }
}

/**
 * Get field selectors based on content type and field name
 */
function getFieldSelectors(contentType: string, fieldName: string): string[] {
  const fieldName_lower = fieldName.toLowerCase();
  
  // Common selectors for different field types
  const titleSelectors = [
    'h1', 'h2', 'h3', '.title', '[class*="title"]', '.name', '[class*="name"]', 'a'
  ];
  
  const priceSelectors = [
    '.price', '[class*="price"]', '.amount', '.money', '[data-price]'
  ];
  
  const imageSelectors = [
    'img', '[class*="image"] img', 'picture img', '[data-src]'
  ];
  
  const authorSelectors = [
    '.author', '[class*="author"]', '.byline', '.meta-author', '.writer'
  ];
  
  const dateSelectors = [
    '.date', '[class*="date"]', 'time', '[datetime]', '.published', '.meta-date'
  ];
  
  const linkSelectors = [
    'a', '.link', '[href]', '.read-more', '.more-link'
  ];
  
  const buttonSelectors = [
    'button', '.btn', '[class*="button"]', 'input[type="submit"]', '.submit'
  ];
  
  const inputSelectors = [
    'input', 'textarea', 'select', '.input', '.field', '[class*="input"]'
  ];
  
  // Determine which selectors to return based on field name and content type
  if (
    fieldName_lower.includes("title") || 
    fieldName_lower.includes("name") || 
    fieldName_lower.includes("heading")
  ) {
    return titleSelectors;
  }
  
  if (
    fieldName_lower.includes("price") || 
    fieldName_lower.includes("cost") || 
    fieldName_lower.includes("amount")
  ) {
    return priceSelectors;
  }
  
  if (
    fieldName_lower.includes("image") || 
    fieldName_lower.includes("img") || 
    fieldName_lower.includes("photo") || 
    fieldName_lower.includes("picture")
  ) {
    return imageSelectors;
  }
  
  if (
    fieldName_lower.includes("author") || 
    fieldName_lower.includes("writer") || 
    fieldName_lower.includes("by")
  ) {
    return authorSelectors;
  }
  
  if (
    fieldName_lower.includes("date") || 
    fieldName_lower.includes("time") || 
    fieldName_lower.includes("published")
  ) {
    return dateSelectors;
  }
  
  if (
    fieldName_lower.includes("link") || 
    fieldName_lower.includes("url") || 
    fieldName_lower.includes("href")
  ) {
    return linkSelectors;
  }
  
  if (
    fieldName_lower.includes("button") || 
    fieldName_lower.includes("submit") || 
    fieldName_lower.includes("action")
  ) {
    return buttonSelectors;
  }
  
  if (
    fieldName_lower.includes("input") || 
    fieldName_lower.includes("field") || 
    fieldName_lower.includes("form") ||
    fieldName_lower.includes("text")
  ) {
    return inputSelectors;
  }
  
  // Default to title selectors if no specific field type is detected
  switch (contentType) {
    case "product":
      return titleSelectors;
    case "article":
      return titleSelectors;
    case "navigation":
      return linkSelectors;
    case "form":
      return inputSelectors;
    default:
      return titleSelectors;
  }
}

/**
 * Extract field names from content description
 */
function extractFieldNames(contentDescription: string): string[] {
  // Common field names to look for
  const commonFields = [
    "title", "name", "price", "cost", "image", "photo", "picture", 
    "description", "detail", "author", "date", "time", "link", "url", 
    "button", "input", "field", "text"
  ];
  
  // Check if any common fields are mentioned in the content description
  const mentionedFields = commonFields.filter(field => 
    contentDescription.toLowerCase().includes(field)
  );
  
  // If no specific fields are mentioned, return default fields based on content type
  if (mentionedFields.length === 0) {
    const contentType = determineContentType(contentDescription);
    
    switch (contentType) {
      case "product":
        return ["title", "price", "image"];
      case "article":
        return ["title", "author", "date"];
      case "navigation":
        return ["link", "text"];
      case "form":
        return ["input", "button"];
      default:
        return ["title", "link"];
    }
  }
  
  return mentionedFields;
}

/**
 * Main function to find selectors on a webpage
 */
async function findSelectors(query: string): Promise<string> {
  // Parse the query to extract the URL and content description
  const { url, contentDescription } = parseQuery(query);
  
  console.log(`Query: "${query}"`);
  console.log(`URL: ${url}`);
  console.log(`Content Description: ${contentDescription}`);
  
  // Determine the content type
  const contentType = determineContentType(contentDescription);
  console.log(`Detected Content Type: ${contentType}`);
  
  // Extract field names from content description
  const fieldNames = extractFieldNames(contentDescription);
  console.log(`Fields to Find: ${fieldNames.join(", ")}`);
  
  console.log(`Launching Puppeteer for URL: ${url}`);
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  try {
    // Set user agent and viewport
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the URL with timeout
    console.log("Navigating to URL...");
    await page.goto(url, {
      timeout: PUPPETEER_TIMEOUT,
      waitUntil: "networkidle0",
    });

    // Wait for body to ensure page is loaded
    await page.waitForSelector('body', { timeout: PUPPETEER_TIMEOUT });
    
    // Wait a bit for any dynamic content
    console.log("Waiting for dynamic content to load...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Find containers based on content type
    console.log(`Finding ${contentType} containers...`);
    const containerSelectors = getContainerSelectors(contentType);
    
    const containerResults = await Promise.all(
      containerSelectors.map(async (selector) => {
        const count = await page.$$eval(selector, elements => elements.length);
        return { selector, count };
      })
    );
    
    console.log("Product container candidates:");
    containerResults.forEach(result => {
      console.log(`  ${result.selector}: ${result.count} elements`);
    });
    
    // Find best container selector (one with most elements)
    const bestContainer = containerResults.reduce((best, current) => 
      current.count > best.count ? current : best, 
      { selector: '', count: 0 }
    );
    
    if (bestContainer.count === 0) {
      console.log("No product containers found! Trying generic selectors...");
      // Try to find any repeating elements
      const genericSelectors = [
        'li', 
        'div > div',
        'article',
        'section > div',
        '.item',
        '.col'
      ];
      
      const genericResults = await Promise.all(
        genericSelectors.map(async (selector) => {
          const count = await page.$$eval(selector, elements => elements.length);
          return { selector, count };
        })
      );
      
      // Filter to only selectors with multiple elements (more than 3)
      const filteredGenericResults = genericResults.filter(r => r.count > 3);
      
      if (filteredGenericResults.length > 0) {
        // Sort by count (ascending, as we want the most specific selector with multiple matches)
        filteredGenericResults.sort((a, b) => a.count - b.count);
        bestContainer.selector = filteredGenericResults[0].selector;
        bestContainer.count = filteredGenericResults[0].count;
      } else {
        await browser.close();
        return JSON.stringify({
          error: "Could not find any suitable container elements on the page",
          url: url
        }, null, 2);
      }
    }
    
    console.log(`\nBest container selector: ${bestContainer.selector} (${bestContainer.count} elements)`);
    
    // Find selectors for each field
    const fieldResults: Record<string, SelectorResult[]> = {};
    const bestFields: Record<string, { selector: string; attribute?: string }> = {};
    
    for (const fieldName of fieldNames) {
      console.log(`\nFinding ${fieldName} selectors...`);
      
      // Get appropriate selectors for this field
      const fieldSelectors = getFieldSelectors(contentType, fieldName);
      
      // Determine if we need to look for an attribute
      const needsAttribute = 
        fieldName.toLowerCase().includes("image") || 
        fieldName.toLowerCase().includes("link") ||
        fieldName.toLowerCase().includes("url");
      
      const attribute = needsAttribute ? (fieldName.toLowerCase().includes("image") ? "src" : "href") : undefined;
      
      // Test the selectors
      const results = await testSelectorsInContainer(page, bestContainer.selector, fieldSelectors, attribute);
      fieldResults[fieldName] = results;
      
      console.log(`${fieldName} selector candidates:`);
      results.forEach(result => {
        console.log(`  ${result.selector}: ${result.count} elements, Sample: "${result.sample}"`);
      });
      
      // Store the best selector for this field
      if (results.length > 0) {
        bestFields[fieldName] = {
          selector: results[0].selector,
          ...(attribute && { attribute })
        };
      }
    }
    
    // Generate config file
    const config: SelectorConfig = {
      selector: bestContainer.selector,
      waitFor: "body",
      fields: bestFields
    };
    
    console.log("\nGenerated scraping configuration:");
    console.log(JSON.stringify(config, null, 2));
    
    // Format the result
    const recommendations: SelectorRecommendation[] = [
      {
        purpose: `${contentType} container`,
        selector: bestContainer.selector,
        confidence: 0.9,
        sample_matches: await getSampleContent(page, bestContainer.selector, 3),
        usage: {
          scraping_agent: {
            selector: bestContainer.selector,
            multiple: true,
            waitFor: "body"
          }
        }
      }
    ];
    
    // Add recommendations for each field
    for (const fieldName of fieldNames) {
      const results = fieldResults[fieldName];
      if (results && results.length > 0) {
        const bestSelector = results[0].selector;
        const fullSelector = `${bestContainer.selector} ${bestSelector}`;
        
        recommendations.push({
          purpose: fieldName,
          selector: fullSelector,
          confidence: 0.8,
          sample_matches: await getSampleContent(page, fullSelector, 3),
          usage: {
            scraping_agent: {
              selector: fullSelector,  // Use the full selector instead of just the relative one
              multiple: false,
              ...(bestFields[fieldName].attribute && { 
                extractAttribute: bestFields[fieldName].attribute 
              })
            }
          }
        });
      }
    }
    
    const result: AnalysisResult = {
      url,
      query,
      recommendations
    };
    
    // Extract domain from URL for config filename
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const configFilename = `${domain}-config.json`;
    
    // Ensure proper JSON formatting with commas between properties
    await Deno.writeTextFile(configFilename, JSON.stringify(config, null, 2));
    console.log(`\nConfiguration saved to ${configFilename}`);
    
    await browser.close();
    return JSON.stringify(result, null, 2);
  } catch (err) {
    console.error("Error finding selectors:", err);
    await browser.close();
    return JSON.stringify({
      error: `Error analyzing page: ${(err as Error).message}`,
      url
    }, null, 2);
  }
}

/**
 * Tests selectors within a container element
 */
async function testSelectorsInContainer(
  page: puppeteer.Page, 
  containerSelector: string, 
  selectors: string[],
  attribute?: string
): Promise<SelectorResult[]> {
  const results = [];
  
  for (const selector of selectors) {
    const fullSelector = `${containerSelector} ${selector}`;
    
    try {
      const { count, sample } = await page.evaluate((sel, attr) => {
        const elements = document.querySelectorAll(sel);
        if (elements.length === 0) return { count: 0, sample: '' };
        
        let sampleText = '';
        if (attr) {
          sampleText = elements[0].getAttribute(attr) || '';
        } else {
          sampleText = elements[0].textContent?.trim() || '';
        }
        
        return { 
          count: elements.length,
          sample: sampleText.substring(0, 50) + (sampleText.length > 50 ? '...' : '')
        };
      }, fullSelector, attribute);
      
      if (count > 0) {
        results.push({ selector, count, sample });
      }
    } catch (err) {
      console.error(`Error testing selector ${fullSelector}:`, err);
    }
  }
  
  // Sort by count (descending)
  return results.sort((a, b) => b.count - a.count);
}

/**
 * Gets sample content from elements matching a selector
 */
async function getSampleContent(
  page: puppeteer.Page,
  selector: string,
  limit: number
): Promise<string[]> {
  try {
    return await page.evaluate((sel, lim) => {
      const elements = document.querySelectorAll(sel);
      return Array.from(elements)
        .slice(0, lim)
        .map(el => el.textContent?.trim() || '')
        .filter(text => text.length > 0);
    }, selector, limit);
  } catch (err) {
    console.error(`Error getting sample content for ${selector}:`, err);
    return [];
  }
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
    console.log("Starting selector finder agent...");
    const answer = await findSelectors(query);
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
              'Send a POST request with JSON body: { "query": "Find selectors for product prices on example.com/products" }' +
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
        const answer = await findSelectors(query);
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
