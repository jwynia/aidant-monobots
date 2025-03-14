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

## Prerequisites

- [Deno](https://deno.land/) runtime
- [OpenRouter](https://openrouter.ai/) API key

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/web-scraping-agents.git
cd web-scraping-agents
```

2. Set your OpenRouter API key:

```bash
export OPENROUTER_API_KEY=your_key_here
```

3. (Optional) Configure additional settings:

```bash
# Use a specific model
export OPENROUTER_MODEL=openai/o3-mini-high

# Secure web server endpoints
export SERVER_API_KEY=your_server_key
```

## Usage

### Selector Finder Agent

1. Find optimal selectors for a website:

```bash
deno task find-selector "Find selectors for product prices on example.com"
```

2. Install globally:

```bash
deno task find-selector:install
find-selector "Find selectors for product prices on example.com"
```

3. Run as web server:

```bash
deno task find-selector
# Server runs on http://localhost:8001
```

Example API request:

```bash
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -d '{"query": "Find selectors for product prices on example.com"}'
```

The selector finder will analyze the page and provide:

- Multiple selector recommendations
- Confidence scores for each selector
- Sample content matches
- Ready-to-use configurations for the scraping agent

Example output:

```json
{
  "recommendations": [
    {
      "purpose": "product prices",
      "selector": ".product-price",
      "confidence": 0.95,
      "sample_matches": ["$19.99", "$24.50", "$15.75"],
      "usage": {
        "scraping_agent": {
          "selector": ".product-price",
          "multiple": true
        }
      }
    }
  ]
}
```

### Scraping Agent

1. Extract content using selectors:

```bash
deno task scrape "Extract product prices from example.com using .product-price"
deno task scrape "Extract product prices from example.com" --config output-file-from-selector.json
```

2. Install globally:

```bash
deno task scrape:install
scrape "Extract product prices from example.com using .product-price"
scrape "Extract product prices from example.com" --config output-file-from-selector.json
```

3. Run as web server:

```bash
deno task scrape
# Server runs on http://localhost:8000
```

Example API request:

```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{"query": "Extract product prices from example.com using .product-price"}'
```

The scraping agent supports:

- Single or multiple element extraction
- Dynamic content waiting
- Property/attribute extraction
- Error handling with fallbacks

Example scraping options:

```json
{
  "url": "https://example.com",
  "selector": ".product-price",
  "multiple": true,
  "waitFor": ".products-loaded",
  "extractProperty": "innerText"
}
```

## Advanced Usage

### Selector Finding

The selector finder uses multiple strategies to identify optimal selectors:

1. **ID-based selectors** (highest confidence):

```css
#product-123
```

2. **Class combinations** (high confidence):

```css
.product.price.current
```

3. **Semantic selectors** (good confidence):

```css
[role="price"]
[data-testid="product-price"]
```

4. **Structural selectors** (fallback):

```css
.product-list > div:nth-child(2) > span
```

### Content Extraction

The scraping agent provides multiple extraction methods:

1. **Text content** (default):

```json
{
  "selector": ".price"
}
```

2. **Specific property**:

```json
{
  "selector": "input.quantity",
  "extractProperty": "value"
}
```

3. **HTML attribute**:

```json
{
  "selector": "img.product-image",
  "extractAttribute": "src"
}
```

4. **Multiple elements**:

```json
{
  "selector": ".product-card",
  "multiple": true
}
```

## Development

### Project Structure

```
web-scraping-agents/
├── agents/
│   ├── scraping-agent.ts     # Content extraction agent
│   └── selector-finder.ts    # Selector analysis agent
├── types.d.ts               # TypeScript declarations
├── deno.json               # Deno configuration
└── README.md
```

### Adding New Features

1. Update type definitions in `types.d.ts`
2. Add new tools to the relevant agent
3. Update the system prompt to document new capabilities
4. Test in both CLI and web server modes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details
