# aidant-monobots Project Brief

## Overview

aidant-monobots is a project focused on creating single-file, single-task LLM agents implemented in Deno. Each agent is designed to be self-contained, following the ReACT (Reasoning + Acting) pattern, and capable of operating in both CLI and web server modes.

## Core Requirements

### Agent Architecture

- Single-file implementation for each agent
- ReACT pattern integration (Thought → Action → Observation loop)
- Dual-mode operation (CLI and web server)
- Tool-based extensibility

### Technical Requirements

- Deno runtime environment
- TypeScript implementation
- LLM API integration (OpenRouter, etc.)
- Error handling with fallback mechanisms
- Secure API key management

### Deployment Requirements

- Minimal latency for serverless environments
- Support for platforms like Fly.io and Supabase Edge Functions
- Configurable through environment variables
- Optional API key authentication for web server mode

## Project Goals

### Primary Goals

1. Provide a flexible framework for single-file LLM agents
2. Enable rapid development of task-specific agents
3. Maintain simplicity while ensuring robustness
4. Support both CLI and web-based interactions

### Design Goals

1. Self-contained implementation
2. Clear separation of concerns
3. Extensible tool system
4. Comprehensive error handling
5. Flexible output formatting

## Project Scope

### Included

- Single-file agent implementations
- Template for creating new agents
- ReACT pattern implementation
- CLI and web server interfaces
- Tool integration system
- Error handling and fallbacks
- File output capabilities
- API authentication options

### Not Included

- Multi-file agent architectures
- Complex state management
- Database integrations
- Frontend implementations
- Authentication beyond API keys

## Success Criteria

1. Agents can be created from template with minimal modification
2. Each agent operates independently in a single file
3. Robust error handling and fallback mechanisms
4. Successful operation in both CLI and web server modes
5. Clear documentation and examples
