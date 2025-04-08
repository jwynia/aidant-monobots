/**
 * ResearchStorage Module
 * 
 * This module provides a class for managing research storage in a local .research folder.
 * It handles storing, retrieving, and finding similar research based on query similarity.
 * Compatible with both Node.js and Deno environments.
 */

// Import Deno standard library modules conditionally
let denoEnsureDir: any;
if (typeof Deno !== 'undefined') {
  import('https://deno.land/std@0.192.0/fs/ensure_dir.ts')
    .then(module => {
      denoEnsureDir = module.ensureDir;
    })
    .catch(err => {
      console.error("Failed to import Deno std library:", err);
    });
}

// TypeScript declarations for Deno APIs (only used for type checking)
declare namespace Deno {
  function readTextFile(path: string): Promise<string>;
  function writeTextFile(path: string, data: string): Promise<void>;
  function stat(path: string): Promise<any>;
  function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  
  namespace errors {
    class NotFound extends Error {}
  }
  
  const build: { os: string };
}

// Import Node.js modules conditionally to avoid errors in Deno
let path: any;
let fs: any;
let util: any;
let uuidv4: any;

// Environment detection
const isDeno = typeof Deno !== 'undefined';

if (!isDeno) {
  // Only import Node.js modules in Node.js environment
  path = require('path');
  fs = require('fs');
  util = require('util');
  const { v4 } = require('uuid');
  uuidv4 = v4;
}

/**
 * Interface for research entry metadata
 */
export interface ResearchMetadata {
  id: string;
  query: string;
  topics: string[];
  related: string[];
  created: string;
  updated: string;
  path: string;
}

/**
 * Interface for the research index
 */
export interface ResearchIndex {
  entries: Record<string, ResearchMetadata>;
  keywords: Record<string, string[]>;
}

/**
 * Interface for the topic graph
 */
export interface TopicGraph {
  nodes: Record<string, {
    id: string;
    label: string;
    weight: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
  }>;
}

/**
 * Configuration options for ResearchStorage
 */
export interface ResearchStorageOptions {
  researchDir: string;
  topicsDir: string;
  indexPath: string;
  graphPath: string;
  similarityThreshold: number;
}

/**
 * Class for managing research storage
 */
export class ResearchStorage {
  private index: ResearchIndex;
  private graph: TopicGraph;
  private initialized: boolean = false;
  private researchDir: string;
  private topicsDir: string;
  private indexPath: string;
  private graphPath: string;
  private similarityThreshold: number;

  /**
   * Create a new ResearchStorage instance
   * @param options Configuration options
   */
  constructor(options: ResearchStorageOptions) {
    this.researchDir = options.researchDir;
    this.topicsDir = options.topicsDir;
    this.indexPath = options.indexPath;
    this.graphPath = options.graphPath;
    this.similarityThreshold = options.similarityThreshold;
    
    this.index = { entries: {}, keywords: {} };
    this.graph = { nodes: {}, edges: [] };
  }

  /**
   * Initialize the research storage system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directories exist
      await this.ensureDir(this.researchDir);
      await this.ensureDir(this.topicsDir);

      // Load index if it exists
      try {
        const indexText = await this.readTextFile(this.indexPath);
        this.index = JSON.parse(indexText);
      } catch (err) {
        // Create new index if not found
        this.index = { entries: {}, keywords: {} };
        await this.saveIndex();
      }

      // Load graph if it exists
      try {
        const graphText = await this.readTextFile(this.graphPath);
        this.graph = JSON.parse(graphText);
      } catch (err) {
        // Create new graph if not found
        this.graph = { nodes: {}, edges: [] };
        await this.saveGraph();
      }

      this.initialized = true;
      console.log("Research storage initialized");
    } catch (err) {
      console.error("Failed to initialize research storage:", err);
      throw err;
    }
  }

  /**
   * Ensure a directory exists
   */
  private async ensureDir(dir: string): Promise<void> {
    if (isDeno) {
      // Deno implementation
      if (denoEnsureDir) {
        // Use the standard library's ensureDir function if available
        try {
          await denoEnsureDir(dir);
          return;
        } catch (err) {
          console.error("Error using Deno ensureDir:", err);
          // Fall back to manual implementation if ensureDir fails
        }
      }
      
      // Fallback implementation for Deno
      try {
        // Try to create the directory directly with recursive option
        try {
          await Deno.mkdir(dir, { recursive: true });
          return;
        } catch (mkdirErr) {
          // If mkdir fails, fall back to our manual implementation
          console.error("Error using Deno.mkdir:", mkdirErr);
        }
        
        // Check if directory already exists
        await Deno.stat(dir);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          // Create parent directories recursively
          // Use platform-agnostic path handling
          const lastSeparatorIndex = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'));
          const parentDir = dir.substring(0, lastSeparatorIndex);
          if (parentDir) {
            await this.ensureDir(parentDir);
          }
          
          // Create the directory directly instead of creating a .keep file
          try {
            await Deno.mkdir(dir);
          } catch (mkdirErr) {
            console.error(`Error creating directory ${dir}:`, mkdirErr);
            throw mkdirErr;
          }
        } else {
          throw err;
        }
      }
    } else {
      // Node.js implementation
      const mkdir = util.promisify(fs.mkdir);
      try {
        await mkdir(dir, { recursive: true });
      } catch (err: any) {
        // Ignore if directory already exists
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }
    }
  }

  /**
   * Check if a file exists
   */
  async fileExists(path: string): Promise<boolean> {
    if (isDeno) {
      // Deno implementation
      try {
        await Deno.stat(path);
        return true;
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return false;
        }
        throw err;
      }
    } else {
      // Node.js implementation
      const access = util.promisify(fs.access);
      try {
        await access(path, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Read text from a file
   */
  private async readTextFile(path: string): Promise<string> {
    if (isDeno) {
      // Deno implementation
      return await Deno.readTextFile(path);
    } else {
      // Node.js implementation
      const readFile = util.promisify(fs.readFile);
      return await readFile(path, 'utf-8');
    }
  }

  /**
   * Write text to a file
   */
  private async writeTextFile(path: string, data: string): Promise<void> {
    if (isDeno) {
      // Deno implementation
      await Deno.writeTextFile(path, data);
    } else {
      // Node.js implementation
      const writeFile = util.promisify(fs.writeFile);
      await writeFile(path, data);
    }
  }

  /**
   * Generate a UUID
   */
  private generateUUID(): string {
    if (isDeno) {
      // Deno implementation
      return crypto.randomUUID();
    } else {
      // Node.js implementation
      return uuidv4();
    }
  }

  /**
   * Join path segments
   */
  private joinPath(...segments: string[]): string {
    if (isDeno) {
      // Platform-aware path join implementation for Deno
      // Use backslashes on Windows, forward slashes elsewhere
      const isWindows = Deno.build?.os === "windows" || 
                       (typeof navigator !== 'undefined' && 
                        navigator.userAgent?.includes('Windows'));
      
      const separator = isWindows ? '\\' : '/';
      
      // Join segments with the appropriate separator
      let result = segments.join(separator);
      
      // Replace multiple consecutive separators with a single one
      const separatorRegex = new RegExp(`${separator === '\\' ? '\\\\' : '/'}+`, 'g');
      return result.replace(separatorRegex, separator);
    } else {
      // Node.js implementation
      return path.join(...segments);
    }
  }

  /**
   * Save the index to disk
   */
  private async saveIndex(): Promise<void> {
    await this.writeTextFile(
      this.indexPath,
      JSON.stringify(this.index, null, 2)
    );
  }

  /**
   * Save the graph to disk
   */
  private async saveGraph(): Promise<void> {
    await this.writeTextFile(
      this.graphPath,
      JSON.stringify(this.graph, null, 2)
    );
  }

  /**
   * Extract keywords from a query
   */
  extractKeywords(text: string): string[] {
    // Remove punctuation and convert to lowercase
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ");
    
    // Split into words and filter out common stop words and short words
    const stopWords = new Set([
      "a", "an", "the", "and", "or", "but", "is", "are", "was", "were",
      "be", "been", "being", "in", "on", "at", "to", "for", "with", "by",
      "about", "against", "between", "into", "through", "during", "before",
      "after", "above", "below", "from", "up", "down", "of", "off", "over",
      "under", "again", "further", "then", "once", "here", "there", "when",
      "where", "why", "how", "all", "any", "both", "each", "few", "more",
      "most", "other", "some", "such", "no", "nor", "not", "only", "own",
      "same", "so", "than", "too", "very", "can", "will", "just", "should",
      "now", "what", "who", "whom", "this", "that", "these", "those"
    ]);

    return normalized
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 20); // Limit to 20 keywords
  }

  /**
   * Calculate similarity between two queries
   */
  calculateSimilarity(query1: string, query2: string): number {
    const keywords1 = new Set(this.extractKeywords(query1));
    const keywords2 = new Set(this.extractKeywords(query2));
    
    if (keywords1.size === 0 || keywords2.size === 0) return 0;
    
    // Count common keywords
    let common = 0;
    for (const keyword of keywords1) {
      if (keywords2.has(keyword)) common++;
    }
    
    // Jaccard similarity: intersection / union
    return common / (keywords1.size + keywords2.size - common);
  }

  /**
   * Find similar research entries for a query
   */
  async findSimilarResearch(query: string): Promise<ResearchMetadata[]> {
    await this.initialize();
    
    const results: Array<[ResearchMetadata, number]> = [];
    
    // Calculate similarity for each entry
    for (const id in this.index.entries) {
      const entry = this.index.entries[id];
      const similarity = this.calculateSimilarity(query, entry.query);
      
      if (similarity >= this.similarityThreshold) {
        results.push([entry, similarity]);
      }
    }
    
    // Sort by similarity (highest first)
    results.sort((a, b) => b[1] - a[1]);
    
    // Return just the entries
    return results.map(([entry]) => entry);
  }

  /**
   * Store a research result
   */
  async storeResearch(query: string, content: string): Promise<ResearchMetadata> {
    await this.initialize();
    
    const id = this.generateUUID();
    const timestamp = new Date().toISOString();
    const topics = this.extractKeywords(query);
    
    // Create file path
    const filename = `${id}.md`;
    const filePath = this.joinPath(this.topicsDir, filename);
    
    // Find related research
    const similarEntries = await this.findSimilarResearch(query);
    const related = similarEntries.map(entry => entry.id);
    
    // Create metadata
    const metadata: ResearchMetadata = {
      id,
      query,
      topics,
      related,
      created: timestamp,
      updated: timestamp,
      path: filePath
    };
    
    // Create markdown content with frontmatter
    const frontmatter = [
      '---',
      `id: ${id}`,
      `query: "${query.replace(/"/g, '\\"')}"`,
      `topics: ${JSON.stringify(topics)}`,
      `related: ${JSON.stringify(related)}`,
      `created: ${timestamp}`,
      `updated: ${timestamp}`,
      '---',
      '',
      content
    ].join('\n');
    
    // Write to file
    await this.writeTextFile(filePath, frontmatter);
    
    // Update index
    this.index.entries[id] = metadata;
    
    // Update keyword index
    for (const keyword of topics) {
      if (!this.index.keywords[keyword]) {
        this.index.keywords[keyword] = [];
      }
      if (!this.index.keywords[keyword].includes(id)) {
        this.index.keywords[keyword].push(id);
      }
    }
    
    // Update graph
    this.updateTopicGraph(id, topics, related);
    
    // Save changes
    await this.saveIndex();
    await this.saveGraph();
    
    return metadata;
  }

  /**
   * Update the topic graph with a new entry
   */
  private updateTopicGraph(id: string, topics: string[], related: string[]): void {
    // Add or update node for this research
    const nodeId = `research:${id}`;
    this.graph.nodes[nodeId] = {
      id: nodeId,
      label: id,
      weight: 1
    };
    
    // Add or update nodes for topics
    for (const topic of topics) {
      const topicId = `topic:${topic}`;
      if (!this.graph.nodes[topicId]) {
        this.graph.nodes[topicId] = {
          id: topicId,
          label: topic,
          weight: 0
        };
      }
      this.graph.nodes[topicId].weight++;
      
      // Add edge between research and topic
      this.graph.edges.push({
        source: nodeId,
        target: topicId,
        weight: 1
      });
    }
    
    // Add edges to related research
    for (const relatedId of related) {
      const relatedNodeId = `research:${relatedId}`;
      this.graph.edges.push({
        source: nodeId,
        target: relatedNodeId,
        weight: 1
      });
    }
  }

  /**
   * Get a research entry by ID
   */
  async getResearchById(id: string): Promise<string | null> {
    await this.initialize();
    
    const entry = this.index.entries[id];
    if (!entry) return null;
    
    try {
      return await this.readTextFile(entry.path);
    } catch (err) {
      console.error(`Error reading research file ${entry.path}:`, err);
      return null;
    }
  }

  /**
   * Extract content from a research entry (removing frontmatter)
   */
  extractContent(markdown: string): string {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    return match ? match[2] : markdown;
  }

  /**
   * Get related research for a given entry
   */
  async getRelatedResearch(id: string): Promise<ResearchMetadata[]> {
    await this.initialize();
    
    const entry = this.index.entries[id];
    if (!entry) return [];
    
    return entry.related
      .map(relatedId => this.index.entries[relatedId])
      .filter(Boolean);
  }

  /**
   * Get the current index
   */
  getIndex(): ResearchIndex {
    return this.index;
  }

  /**
   * Get the current graph
   */
  getGraph(): TopicGraph {
    return this.graph;
  }
}
