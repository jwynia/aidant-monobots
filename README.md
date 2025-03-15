# Web Scraping Agents

A pair of intelligent agents for efficient web scraping, built with Deno and powered by OpenRouter LLMs.

## Features

- 🤖 Two complementary agents:
  - **Scraping Agent**: Extracts content from websites using CSS selectors
  - **Selector Finder**: Analyzes websites to find optimal CSS selectors
- 🧠 ReACT (Reasoning + Acting) pattern for intelligent decision making
- 🌐 Dual-mode operation (CLI and web server)
- 🎯 Automatic selector generation and testing
- 📊 Confidence scoring for selector recommendations
- 🔄 Error handling with fallback mechanisms
- 📝 Markdown output formatting

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

## Installation
