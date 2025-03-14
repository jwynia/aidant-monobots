# Technical Context

## Technologies Used

### Core Runtime

- **Deno**: Modern runtime for JavaScript and TypeScript
  - Version: Latest stable
  - Features used:
    - Native TypeScript support
    - Top-level await
    - Built-in testing
    - Standard library modules

### Languages

- **TypeScript**: Primary implementation language
  - Strict type checking
  - Interface definitions
  - Modern ECMAScript features
  - Async/await support

### APIs and Services

1. **OpenRouter API**

   - Primary LLM interface
   - Model: openai/o3-mini-high (default)
   - Authentication via API key
   - Streaming support

2. **Perplexity API** (Research Agent)
   - Deep research capabilities
   - Model: sonar-deep-research
   - Authentication via API key
   - JSON response format

## Development Setup

### Development Container

```json
{
  "name": "Claude Code Sandbox",
  "image": "jwynia/aidant-python-node:latest",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "eamodio.gitlens"
      ]
    }
  }
}
```

### Environment Variables

- `OPENROUTER_API_KEY`: OpenRouter authentication
- `OPENROUTER_MODEL`: Model selection (default: "openai/o3-mini-high")
- `PERPLEXITY_API_KEY`: Perplexity API authentication
- `SERVER_API_KEY`: Web server authentication
- `PORT`: Web server port (default: 8000)

### VSCode Configuration

- Prettier for code formatting
- ESLint for code linting
- GitLens for version control
- Customized terminal profiles (zsh/bash)

### Required Permissions

- Network access (`--allow-net`)
- File system access (`--allow-read`, `--allow-write`)
- Environment variables (`--allow-env`)
- Process execution (`--allow-run`)

## Technical Constraints

### Runtime Constraints

1. **Memory Management**

   - Token limits for LLM calls (default: 4000)
   - Maximum reasoning steps (default: 10)
   - Response size limitations

2. **API Limitations**

   - Rate limiting considerations
   - Token quota management
   - Response time expectations

3. **File System**
   - Write permissions for output
   - File naming conventions
   - Output format requirements

### Security Constraints

1. **API Security**

   - Secure key management
   - Authentication handling
   - Input validation

2. **Server Security**

   - Optional API key authentication
   - Request validation
   - Error handling

3. **File Operations**
   - Safe file writing
   - Path validation
   - Permission management

## Dependencies

### Standard Library

- `std/http/server.ts`: Web server implementation
- `std/crypto`: UUID generation
- `std/fs`: File system operations

### External Dependencies

None required beyond API services:

- OpenRouter API
- Perplexity API (for Research Agent)

## Development Tools

### Required Tools

- Deno runtime
- VSCode or compatible IDE
- Git for version control
- API keys for services

### Optional Tools

- Postman/curl for API testing
- Docker for container development
- Terminal for CLI testing

## Deployment Options

### Fly.io Deployment

1. **Requirements**

   - Dockerfile with Deno base image
   - Environment variables configuration
   - Port configuration

2. **Process**
   ```bash
   # Example deployment steps
   fly launch
   fly secrets set OPENROUTER_API_KEY=your_key
   fly deploy
   ```

### Supabase Edge Functions

1. **Requirements**

   - Supabase CLI
   - Project configuration
   - Environment setup

2. **Process**
   ```bash
   # Example deployment steps
   supabase functions new agent
   supabase secrets set OPENROUTER_API_KEY=your_key
   supabase functions deploy agent
   ```

## Testing Approach

### Local Testing

- CLI mode testing
- Web server testing
- Tool integration testing
- Error handling verification

### Deployment Testing

- Environment variable verification
- API endpoint testing
- Error recovery testing
- Performance monitoring

## Monitoring and Debugging

### Console Logging

- Step-by-step execution logging
- Error tracking
- API response monitoring
- Tool execution tracking

### Error Handling

- Fallback mechanisms
- API error recovery
- Input validation
- Output verification
