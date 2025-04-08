import { ResearchStorage } from '../lib/research-storage.ts';

// Test environment setup
const TEST_DIR = '/tmp/research-agent-test';
const TEST_RESEARCH_DIR = `${TEST_DIR}/.research`;
const TEST_TOPICS_DIR = `${TEST_RESEARCH_DIR}/topics`;
const TEST_INDEX_PATH = `${TEST_RESEARCH_DIR}/index.json`;
const TEST_GRAPH_PATH = `${TEST_RESEARCH_DIR}/graph.json`;

// Helper function to check if a file exists
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

// Setup and teardown functions
async function setupTestEnvironment() {
  try {
    await Deno.mkdir(TEST_DIR, { recursive: true });
    await Deno.mkdir(TEST_RESEARCH_DIR, { recursive: true });
    await Deno.mkdir(TEST_TOPICS_DIR, { recursive: true });
  } catch (err) {
    // Ignore if directories already exist
  }
}

async function cleanupTestEnvironment() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch (err) {
    console.error("Error cleaning up test environment:", err);
  }
}

// Basic initialization test
Deno.test("ResearchStorage - initialization", async () => {
  await setupTestEnvironment();
  
  try {
    const storage = new ResearchStorage({
      researchDir: TEST_RESEARCH_DIR,
      topicsDir: TEST_TOPICS_DIR,
      indexPath: TEST_INDEX_PATH,
      graphPath: TEST_GRAPH_PATH,
      similarityThreshold: 0.7
    });
    
    await storage.initialize();
    
    // Verify directories were created
    const researchDirExists = await fileExists(TEST_RESEARCH_DIR);
    const topicsDirExists = await fileExists(TEST_TOPICS_DIR);
    const indexPathExists = await fileExists(TEST_INDEX_PATH);
    const graphPathExists = await fileExists(TEST_GRAPH_PATH);
    
    console.log(`Research dir exists: ${researchDirExists}`);
    console.log(`Topics dir exists: ${topicsDirExists}`);
    console.log(`Index file exists: ${indexPathExists}`);
    console.log(`Graph file exists: ${graphPathExists}`);
    
    // Basic assertions
    if (!researchDirExists) throw new Error("Research directory was not created");
    if (!topicsDirExists) throw new Error("Topics directory was not created");
    if (!indexPathExists) throw new Error("Index file was not created");
    if (!graphPathExists) throw new Error("Graph file was not created");
    
    // Verify index structure
    const index = storage.getIndex();
    if (!index.entries) throw new Error("Index entries not initialized");
    if (!index.keywords) throw new Error("Index keywords not initialized");
    
    // Verify graph structure
    const graph = storage.getGraph();
    if (!graph.nodes) throw new Error("Graph nodes not initialized");
    if (!graph.edges) throw new Error("Graph edges not initialized");
    
    console.log("All initialization checks passed!");
  } finally {
    await cleanupTestEnvironment();
  }
});

// Test keyword extraction
Deno.test("ResearchStorage - keyword extraction", async () => {
  await setupTestEnvironment();
  
  try {
    const storage = new ResearchStorage({
      researchDir: TEST_RESEARCH_DIR,
      topicsDir: TEST_TOPICS_DIR,
      indexPath: TEST_INDEX_PATH,
      graphPath: TEST_GRAPH_PATH,
      similarityThreshold: 0.7
    });
    
    await storage.initialize();
    
    // Test with a simple query
    const keywords1 = storage.extractKeywords("What is the capital of France?");
    console.log(`Keywords for "What is the capital of France?": ${keywords1.join(', ')}`);
    
    if (!keywords1.includes("capital")) throw new Error("Should include 'capital'");
    if (!keywords1.includes("france")) throw new Error("Should include 'france'");
    if (keywords1.includes("what")) throw new Error("Should not include stop word 'what'");
    
    // Test with a more complex query
    const keywords2 = storage.extractKeywords("The history and economic impact of the Industrial Revolution in England");
    console.log(`Keywords for complex query: ${keywords2.join(', ')}`);
    
    if (!keywords2.includes("history")) throw new Error("Should include 'history'");
    if (!keywords2.includes("economic")) throw new Error("Should include 'economic'");
    if (!keywords2.includes("impact")) throw new Error("Should include 'impact'");
    if (!keywords2.includes("industrial")) throw new Error("Should include 'industrial'");
    if (!keywords2.includes("revolution")) throw new Error("Should include 'revolution'");
    if (!keywords2.includes("england")) throw new Error("Should include 'england'");
    if (keywords2.includes("the")) throw new Error("Should not include stop word 'the'");
    
    console.log("All keyword extraction tests passed!");
  } finally {
    await cleanupTestEnvironment();
  }
});

// Test storing and retrieving research
Deno.test("ResearchStorage - store and retrieve", async () => {
  await setupTestEnvironment();
  
  try {
    const storage = new ResearchStorage({
      researchDir: TEST_RESEARCH_DIR,
      topicsDir: TEST_TOPICS_DIR,
      indexPath: TEST_INDEX_PATH,
      graphPath: TEST_GRAPH_PATH,
      similarityThreshold: 0.7
    });
    
    await storage.initialize();
    
    // Store a research entry
    const query = "What is the capital of France?";
    const content = "The capital of France is Paris. It is known as the City of Light.";
    const metadata = await storage.storeResearch(query, content);
    
    console.log(`Stored research with ID: ${metadata.id}`);
    console.log(`Topics: ${metadata.topics.join(', ')}`);
    
    // Verify metadata
    if (metadata.query !== query) throw new Error("Query mismatch");
    if (metadata.topics.length === 0) throw new Error("No topics extracted");
    if (!metadata.topics.includes("capital")) throw new Error("Missing topic 'capital'");
    if (!metadata.topics.includes("france")) throw new Error("Missing topic 'france'");
    
    // Verify file was created
    const fileCreated = await fileExists(metadata.path);
    if (!fileCreated) throw new Error("Research file was not created");
    
    // Retrieve the research
    const retrieved = await storage.getResearchById(metadata.id);
    if (!retrieved) throw new Error("Failed to retrieve research");
    
    // Verify content
    const extractedContent = storage.extractContent(retrieved);
    if (!extractedContent.includes("The capital of France is Paris")) {
      throw new Error("Content mismatch");
    }
    
    console.log("All store and retrieve tests passed!");
  } finally {
    await cleanupTestEnvironment();
  }
});
