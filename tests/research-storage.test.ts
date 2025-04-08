/**
 * Unit tests for the ResearchStorage class
 * 
 * These tests verify the functionality of the local research storage system
 * that tracks queries, stores results, and implements topic-based indexing.
 * Compatible with both Node.js and Deno environments.
 */

// TypeScript declarations for Deno APIs (only used for type checking)
declare namespace Deno {
  function readTextFile(path: string): Promise<string>;
  function writeTextFile(path: string, data: string): Promise<void>;
  function stat(path: string): Promise<any>;
  function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  function remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  
  function test(name: string, fn: () => void | Promise<void>): void;
  namespace test {
    function beforeEach(fn: () => void | Promise<void>): void;
    function afterEach(fn: () => void | Promise<void>): void;
  }
  
  namespace errors {
    class NotFound extends Error {}
  }
}

// Environment detection
const isDeno = typeof Deno !== 'undefined';

// Import appropriate testing modules based on environment
let describe: any;
let it: any;
let beforeEach: any;
let afterEach: any;
let assert: any;
let path: any;
let fs: any;
let os: any;
let util: any;
let mkdir: any;
let rm: any;
let access: any;

if (isDeno) {
  // Deno environment
  describe = (name: string, fn: () => void) => {
    console.log(`\n# ${name}`);
    fn();
  };
  
  it = Deno.test;
  beforeEach = Deno.test.beforeEach;
  afterEach = Deno.test.afterEach;
  
  assert = {
    strictEqual: (actual: any, expected: any) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    ok: (value: any) => {
      if (!value) {
        throw new Error(`Expected truthy value, got ${value}`);
      }
    }
  };
} else {
  // Node.js environment
  const nodeTest = require('node:test');
  const nodeAssert = require('node:assert');
  
  describe = (name: string, fn: () => void) => {
    console.log(`\n# ${name}`);
    fn();
  };
  
  it = nodeTest.test;
  beforeEach = nodeTest.beforeEach;
  afterEach = nodeTest.afterEach;
  assert = nodeAssert.strict;
  
  path = require('path');
  fs = require('fs');
  os = require('os');
  util = require('util');
  
  mkdir = util.promisify(fs.mkdir);
  rm = util.promisify(fs.rm);
  access = util.promisify(fs.access);
}

import { ResearchStorage } from '../lib/research-storage.ts';

// Test environment setup
let TEST_DIR: string;
let TEST_RESEARCH_DIR: string;
let TEST_TOPICS_DIR: string;
let TEST_INDEX_PATH: string;
let TEST_GRAPH_PATH: string;

if (isDeno) {
  // Deno environment
  TEST_DIR = '/tmp/research-agent-test';
  TEST_RESEARCH_DIR = `${TEST_DIR}/.research`;
  TEST_TOPICS_DIR = `${TEST_RESEARCH_DIR}/topics`;
  TEST_INDEX_PATH = `${TEST_RESEARCH_DIR}/index.json`;
  TEST_GRAPH_PATH = `${TEST_RESEARCH_DIR}/graph.json`;
} else {
  // Node.js environment
  TEST_DIR = path.join(os.tmpdir(), 'research-agent-test');
  TEST_RESEARCH_DIR = path.join(TEST_DIR, '.research');
  TEST_TOPICS_DIR = path.join(TEST_RESEARCH_DIR, 'topics');
  TEST_INDEX_PATH = path.join(TEST_RESEARCH_DIR, 'index.json');
  TEST_GRAPH_PATH = path.join(TEST_RESEARCH_DIR, 'graph.json');
}

// Helper function to check if a file exists
async function fileExists(path: string): Promise<boolean> {
  if (isDeno) {
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
    try {
      await access(path, fs.constants.F_OK);
      return true;
    } catch (err) {
      return false;
    }
  }
}

// Setup and teardown functions
async function setupTestEnvironment() {
  if (isDeno) {
    try {
      await Deno.mkdir(TEST_DIR, { recursive: true });
      await Deno.mkdir(TEST_RESEARCH_DIR, { recursive: true });
      await Deno.mkdir(TEST_TOPICS_DIR, { recursive: true });
    } catch (err) {
      // Ignore if directories already exist
    }
  } else {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(TEST_RESEARCH_DIR, { recursive: true });
    await mkdir(TEST_TOPICS_DIR, { recursive: true });
  }
}

async function cleanupTestEnvironment() {
  try {
    if (isDeno) {
      await Deno.remove(TEST_DIR, { recursive: true });
    } else {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Error cleaning up test environment:", err);
  }
}

describe('ResearchStorage', () => {
  let storage: ResearchStorage;
  
  beforeEach(async () => {
    await setupTestEnvironment();
    
    storage = new ResearchStorage({
      researchDir: TEST_RESEARCH_DIR,
      topicsDir: TEST_TOPICS_DIR,
      indexPath: TEST_INDEX_PATH,
      graphPath: TEST_GRAPH_PATH,
      similarityThreshold: 0.7
    });
    
    await storage.initialize();
  });
  
  afterEach(async () => {
    await cleanupTestEnvironment();
  });
  
  it('should initialize correctly', async () => {
    // Verify directories were created
    assert.strictEqual(await fileExists(TEST_RESEARCH_DIR), true);
    assert.strictEqual(await fileExists(TEST_TOPICS_DIR), true);
    
    // Verify index and graph files were created
    assert.strictEqual(await fileExists(TEST_INDEX_PATH), true);
    assert.strictEqual(await fileExists(TEST_GRAPH_PATH), true);
    
    // Verify index structure
    const index = storage.getIndex();
    assert.ok(index.entries);
    assert.ok(index.keywords);
    
    // Verify graph structure
    const graph = storage.getGraph();
    assert.ok(graph.nodes);
    assert.ok(graph.edges);
  });
  
  it('should extract keywords correctly', () => {
    // Test with a simple query
    const keywords1 = storage.extractKeywords("What is the capital of France?");
    assert.strictEqual(keywords1.includes("capital"), true);
    assert.strictEqual(keywords1.includes("france"), true);
    assert.strictEqual(keywords1.includes("what"), false); // Should filter out stop words
    
    // Test with a more complex query
    const keywords2 = storage.extractKeywords("The history and economic impact of the Industrial Revolution in England");
    assert.strictEqual(keywords2.includes("history"), true);
    assert.strictEqual(keywords2.includes("economic"), true);
    assert.strictEqual(keywords2.includes("impact"), true);
    assert.strictEqual(keywords2.includes("industrial"), true);
    assert.strictEqual(keywords2.includes("revolution"), true);
    assert.strictEqual(keywords2.includes("england"), true);
    assert.strictEqual(keywords2.includes("the"), false); // Should filter out stop words
  });
  
  it('should calculate similarity correctly', () => {
    // Test identical queries
    const similarity1 = storage.calculateSimilarity(
      "What is the capital of France?",
      "What is the capital of France?"
    );
    assert.strictEqual(similarity1, 1.0);
    
    // Test similar queries
    const similarity2 = storage.calculateSimilarity(
      "What is the capital of France?",
      "What's the capital city of France?"
    );
    assert.ok(similarity2 > 0.5);
    
    // Test somewhat related queries
    const similarity3 = storage.calculateSimilarity(
      "What is the capital of France?",
      "Tell me about Paris, France"
    );
    assert.ok(similarity3 > 0);
    assert.ok(similarity3 < 0.5);
    
    // Test unrelated queries
    const similarity4 = storage.calculateSimilarity(
      "What is the capital of France?",
      "How to make chocolate chip cookies"
    );
    assert.ok(similarity4 < 0.1);
  });
  
  it('should store and retrieve research correctly', async () => {
    // Store a research entry
    const query = "What is the capital of France?";
    const content = "The capital of France is Paris. It is known as the City of Light.";
    const metadata = await storage.storeResearch(query, content);
    
    // Verify metadata
    assert.strictEqual(metadata.query, query);
    assert.ok(metadata.topics.length > 0);
    assert.strictEqual(metadata.topics.includes("capital"), true);
    assert.strictEqual(metadata.topics.includes("france"), true);
    
    // Verify file was created
    assert.strictEqual(await fileExists(metadata.path), true);
    
    // Retrieve the research
    const retrieved = await storage.getResearchById(metadata.id);
    assert.ok(retrieved);
    
    // Verify content
    const extractedContent = storage.extractContent(retrieved!);
    assert.ok(extractedContent.includes("The capital of France is Paris"));
    
    // Verify index was updated
    const index = storage.getIndex();
    assert.ok(index.entries[metadata.id]);
    assert.strictEqual(index.entries[metadata.id].query, query);
    
    // Verify keyword index was updated
    for (const topic of metadata.topics) {
      assert.strictEqual(index.keywords[topic].includes(metadata.id), true);
    }
    
    // Verify graph was updated
    const graph = storage.getGraph();
    assert.ok(graph.nodes[`research:${metadata.id}`]);
    
    // Check for topic nodes
    for (const topic of metadata.topics) {
      assert.ok(graph.nodes[`topic:${topic}`]);
    }
    
    // Check for edges
    const hasTopicEdge = graph.edges.some((edge: any) => 
      edge.source === `research:${metadata.id}` && 
      edge.target.startsWith("topic:")
    );
    assert.strictEqual(hasTopicEdge, true);
  });
  
  it('should find similar research correctly', async () => {
    // Create a storage with lower threshold for testing
    const lowThresholdStorage = new ResearchStorage({
      researchDir: TEST_RESEARCH_DIR,
      topicsDir: TEST_TOPICS_DIR,
      indexPath: TEST_INDEX_PATH,
      graphPath: TEST_GRAPH_PATH,
      similarityThreshold: 0.5 // Lower threshold for testing
    });
    
    await lowThresholdStorage.initialize();
    
    // Store multiple research entries
    const queries = [
      "What is the capital of France?",
      "Tell me about Paris, the capital city of France",
      "What is the population of Paris?",
      "What is the capital of Germany?",
      "How to make chocolate chip cookies"
    ];
    
    const contents = [
      "The capital of France is Paris.",
      "Paris is the capital and most populous city of France.",
      "The population of Paris is approximately 2.2 million.",
      "The capital of Germany is Berlin.",
      "Recipe for chocolate chip cookies: Mix flour, sugar, butter..."
    ];
    
    for (let i = 0; i < queries.length; i++) {
      await lowThresholdStorage.storeResearch(queries[i], contents[i]);
    }
    
    // Find similar research for a query about Paris
    const similar1 = await lowThresholdStorage.findSimilarResearch("Information about Paris, France");
    assert.ok(similar1.length >= 3); // Should match the first 3 queries
    
    // Find similar research for a query about capitals
    const similar2 = await lowThresholdStorage.findSimilarResearch("What are the capitals of European countries?");
    assert.ok(similar2.length >= 2); // Should match queries about capitals
    
    // Find similar research for an unrelated query
    const similar3 = await lowThresholdStorage.findSimilarResearch("How to bake cookies at home");
    assert.ok(similar3.length >= 1); // Should match the cookie recipe
    assert.strictEqual(similar3[0].query, "How to make chocolate chip cookies");
  });
  
  it('should handle related research correctly', async () => {
    // Create a storage with lower threshold for testing
    const lowThresholdStorage = new ResearchStorage({
      researchDir: TEST_RESEARCH_DIR,
      topicsDir: TEST_TOPICS_DIR,
      indexPath: TEST_INDEX_PATH,
      graphPath: TEST_GRAPH_PATH,
      similarityThreshold: 0.5 // Lower threshold for testing
    });
    
    await lowThresholdStorage.initialize();
    
    // Store related research entries
    const query1 = "What is the capital of France?";
    const content1 = "The capital of France is Paris.";
    const metadata1 = await lowThresholdStorage.storeResearch(query1, content1);
    
    const query2 = "Tell me about Paris, the capital city of France";
    const content2 = "Paris is the capital and most populous city of France.";
    const metadata2 = await lowThresholdStorage.storeResearch(query2, content2);
    
    // The second entry should have the first as related
    const related = await lowThresholdStorage.getRelatedResearch(metadata2.id);
    assert.strictEqual(related.length, 1);
    assert.strictEqual(related[0].id, metadata1.id);
    
    // Store a third entry that should be related to both
    const query3 = "What is the population of Paris?";
    const content3 = "The population of Paris is approximately 2.2 million.";
    const metadata3 = await lowThresholdStorage.storeResearch(query3, content3);
    
    // The third entry should have both previous entries as related
    const related2 = await lowThresholdStorage.getRelatedResearch(metadata3.id);
    assert.strictEqual(related2.length, 2);
    assert.ok(related2.some((r: any) => r.id === metadata1.id));
    assert.ok(related2.some((r: any) => r.id === metadata2.id));
  });
});
