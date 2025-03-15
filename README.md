# Web Scraping Agents

Single file LLM-powered ReACT agents, built with Deno and powered by OpenRouter LLMs. Inspired by/based on https://github.com/ruvnet/hello_world_agent/tree/main by @ruvnet.

## Features
- 🧠 ReACT (Reasoning + Acting) pattern for intelligent decision making
- 🌐 Dual-mode operation (CLI and web server)
- 🎯 Automatic selector generation and testing
- 📊 Confidence scoring for selector recommendations
- 🔄 Error handling with fallback mechanisms
- 📝 Markdown output formatting
- 🔍 Deep research capabilities with Perplexity Sonar integration
- 🌍 Web scraping with Puppeteer

## Implemented Agents

### CSS Selector Finder
A specialized agent that analyzes web pages and generates optimal CSS selectors for extracting specific content. Features include:
- Automatic selector generation and testing
- Confidence scoring for recommendations
- Multiple selector strategy suggestions
- Puppeteer integration for real-time testing

### Research Agent
A powerful research assistant that leverages the Perplexity Sonar API for deep research capabilities:
- Comprehensive web research with citations
- Markdown output with properly formatted references
- Deployable to serverless environments (Fly.io, Supabase Edge Functions)

## Agent Template

The project includes a robust agent template (`templates/agent-template.ts`) that can be used as a foundation for creating new agents. The template includes:

- ⚡ Retry logic for API calls with exponential backoff
- ⏱️ Timeout handling for API requests
- 🧩 Partial answer collection to prevent incomplete results
- 🛡️ Improved error handling and fallback mechanisms
- 🧹 Proper resource cleanup
- 🔄 ReACT pattern implementation (Thought → Action → Observation loop)

## Prerequisites

- [Deno](https://deno.land/) runtime
- [OpenRouter](https://openrouter.ai/) API key
- [Perplexity](https://www.perplexity.ai/) API key (for Research Agent)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/web-scraping-agents.git
cd web-scraping-agents

# Set up environment variables
export OPENROUTER_API_KEY="your_openrouter_api_key"
export PERPLEXITY_API_KEY="your_perplexity_api_key" # For Research Agent
export OPENROUTER_MODEL="openai/o3-mini-high" # Optional, defaults to o3-mini-high

# Run an agent (CSS Selector Finder example)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys agents/css-selector-finder.ts "How do I extract product titles and prices from https://example.com/products"

# Install agents globally
deno install --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys --global --name css-selector-finder agents/css-selector-finder.ts
deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name research agents/research-agent.ts
```

## Usage

### CSS Selector Finder
```bash
# CLI mode
css-selector-finder "How do I extract product titles and prices from https://example.com/products"

# Web server mode
# Send POST request to http://localhost:8001 with JSON body: { "query": "How do I extract product titles and prices from https://example.com/products" }
```

### Research Agent
```bash
# CLI mode
research "What caused the fall of the Roman Republic?"

# Web server mode
# Send POST request to http://localhost:8000 with JSON body: { "query": "What caused the fall of the Roman Republic?" }
```

## License
MIT
