# Research Agent

A research agent that uses local storage and external APIs to provide comprehensive answers to research questions.

## Project Structure

- `agents/research-agent.ts`: The main Deno-based research agent that can be run as a CLI tool or web server
- `agents/research-storage.ts`: A Node.js compatible module for managing research storage
- `agents/research-agent.test.ts`: Unit tests for the research storage system

## Features

- Local storage of research in a `.research` folder in the user's home directory
- Similarity-based search to find relevant previous research
- Topic graph for linking related research
- Fallback to external APIs (Perplexity) when local research is not available
- Markdown output with frontmatter metadata

## Setup

### Dependencies

```bash
npm install uuid @types/node @types/uuid
```

### Environment Variables

- `OPENROUTER_API_KEY`: Your OpenRouter API key
- `PERPLEXITY_API_KEY`: Your Perplexity API key
- `OPENROUTER_MODEL` (optional): Model to use (default is "openai/o3-mini-high")
- `SERVER_API_KEY` (optional): Secure web server
- `PORT` (optional): Web server port (default is 8000)
- `OUTPUT_DIR` (optional): Directory to store output files (default is "output")

## Usage

### Running the Agent (Deno)

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run agents/research-agent.ts "What caused the fall of the Roman Republic?"
```

### Installing as a Command (Deno)

```bash
deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name research agents/research-agent.ts
```

Then use:

```bash
research "What caused the fall of the Roman Republic?"
```

### Running Tests (Node.js)

```bash
npm test
```

## How It Works

1. When a query is received, the agent first checks the local research storage for similar queries
2. If similar research is found, it returns the stored result
3. If no similar research is found, it uses the Perplexity API to perform new research
4. The result is stored in the local research storage for future use
5. The agent outputs the result as a markdown file

## Storage Structure

- `.research/`: Root directory for research storage
  - `topics/`: Directory containing markdown files with research content
  - `index.json`: Index of all research entries with metadata
  - `graph.json`: Topic graph for linking related research

## Development

### Running Tests

```bash
node --test agents/research-agent.test.ts
```

### Building for Production

The research agent is designed to be run in a Deno environment. For production deployment, you can use:

- **Fly.io**: Create a Dockerfile using a Deno base image
- **Supabase Edge Functions**: Deploy as a Supabase Edge Function

See the comments in `agents/research-agent.ts` for detailed deployment instructions.
