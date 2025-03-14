/// <reference lib="deno.ns" />

/**
 * Web Scraping Script (Deno)
 * 
 * A generic web scraping script that accepts selector configurations for extracting content.
 * Works in conjunction with the selector-finder agent.
 * 
 * Usage: deno run --allow-read --allow-write --allow-net --allow-env --allow-run scraping-agent.ts <url> <selector-config>
 * Example: deno run scraping-agent.ts "https://example.com" '{"selector": ".product-card", "fields": {"title": ".title", "price": ".price"}}'
 */

import puppeteer from "npm:puppeteer";

// Scraping Configuration
const PUPPETEER_TIMEOUT = 60000; // Timeout for Puppeteer operations (60 seconds)
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

interface SelectorConfig {
  selector: string;           // Main container selector
  waitFor?: string;          // Optional selector to wait for before scraping
  fields: {                  // Fields to extract from each container
    [key: string]: {
      selector: string;      // Selector relative to container
      attribute?: string;    // Optional attribute to extract (e.g., "src" for images)
      property?: string;     // Optional property to extract (e.g., "value" for inputs)
    };
  };
}

async function scrapeContent(url: string, config: SelectorConfig): Promise<string> {
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

    // Wait for content if specified
    if (config.waitFor) {
      console.log(`Waiting for selector: ${config.waitFor}`);
      await page.waitForSelector(config.waitFor, { 
        timeout: PUPPETEER_TIMEOUT,
        visible: true 
      });
    }

    // Wait a bit for any dynamic content
    console.log("Waiting for dynamic content to load...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if elements exist
    const elementCount = await page.evaluate((selector) => {
      return document.querySelectorAll(selector).length;
    }, config.selector);
    
    console.log(`Found ${elementCount} elements matching selector: ${config.selector}`);

    // Extract content using provided selectors
    const results = await page.evaluate((cfg: SelectorConfig) => {
      const containers = document.querySelectorAll(cfg.selector);
      return Array.from(containers).map(container => {
        const result: Record<string, string> = {};
        
        // Extract each field using its selector
        for (const [fieldName, fieldConfig] of Object.entries(cfg.fields)) {
          // Check if the selector is a full selector (contains the container selector)
          const isFullSelector = fieldConfig.selector.includes(cfg.selector);
          
          // If it's a full selector, use document.querySelector, otherwise use container.querySelector
          let element;
          if (isFullSelector) {
            // For full selectors, use document.querySelector
            element = document.querySelector(fieldConfig.selector);
          } else {
            // For relative selectors, use container.querySelector
            element = container.querySelector(fieldConfig.selector);
          }
          
          if (element) {
            if (fieldConfig.attribute) {
              result[fieldName] = element.getAttribute(fieldConfig.attribute) || '';
            } else if (fieldConfig.property) {
              result[fieldName] = (element as any)[fieldConfig.property] || '';
            } else {
              result[fieldName] = element.textContent?.trim() || '';
            }
          } else {
            result[fieldName] = '';
          }
        }
        
        return result;
      });
    }, config);

    await browser.close();
    return JSON.stringify(results, null, 2);
  } catch (err) {
    await browser.close();
    throw err;
  }
}

if (Deno.args.length < 1) {
  console.error("Please provide a URL and either a selector configuration or a config file path");
  console.error("Usage: scrape <url> '<selector-config>'");
  console.error("   or: scrape <url> --config <config-file-path>");
  console.error("Example: scrape 'https://example.com' '{\"selector\": \".product-card\", \"fields\": {\"title\": {\"selector\": \".title\"}}}'");
  Deno.exit(1);
}

const url = Deno.args[0];
let config: SelectorConfig;

try {
  // Check if using a config file
  if (Deno.args[1] === "--config" && Deno.args.length > 2) {
    const configPath = Deno.args[2];
    console.log(`Loading configuration from file: ${configPath}`);
    const configText = await Deno.readTextFile(configPath);
    config = JSON.parse(configText);
  } else if (Deno.args.length > 1) {
    // Parse inline JSON config
    config = JSON.parse(Deno.args[1]);
  } else {
    throw new Error("No configuration provided");
  }
  
  if (!config.selector || !config.fields) {
    throw new Error("Invalid configuration: must include 'selector' and 'fields'");
  }
} catch (err) {
  console.error("Error parsing selector configuration:", err);
  Deno.exit(1);
}

try {
  const results = await scrapeContent(url, config);
  console.log(results);
} catch (err) {
  console.error("Error scraping content:", err);
  Deno.exit(1);
}
