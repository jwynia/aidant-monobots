// deno run --allow-read --allow-write --allow-net --allow-env --allow-run md-to-docx.ts
// deno install --allow-read --allow-write --allow-net --allow-env --allow-run --global --name md2docx md-to-docx.ts
import { parse } from "https://deno.land/std@0.220.1/flags/mod.ts";
import { marked } from "npm:marked@12.0.0";
import { exists } from "https://deno.land/std@0.220.1/fs/exists.ts";

// Parse command line arguments
const args = parse(Deno.args, {
  string: ["input", "output", "debug"],
  boolean: ["help", "install-deps"],
  alias: {
    i: "input",
    o: "output",
    h: "help",
    d: "debug",
    a: "install-deps",
  },
});

// Show help message if requested or if required arguments are missing
if (args.help || (!args.input && !args["install-deps"])) {
  console.log(`
  Markdown to DOCX Converter

  Usage:
    deno run --allow-read --allow-write --allow-net --allow-env --allow-run md-to-docx.ts -i <input.md> -o [output.docx] [-d]

  Options:
    -i, --input         Input Markdown file (required unless --install-deps is used)
    -o, --output        Output DOCX file (default: same name as input with .docx extension)
    -h, --help          Show this help message
    -d, --debug         Save intermediate HTML file for debugging
    -a, --install-deps  Install dependencies (Pandoc and package managers) if missing

  Installation:
    deno install --allow-read --allow-write --allow-net --allow-env --allow-run --name md2docx md-to-docx.ts

  After installation, you can use:
    md2docx -i input.md -o output.docx
  `);
  Deno.exit(0);
}

// OS detection
const isWindows = Deno.build.os === "windows";
const isMac = Deno.build.os === "darwin";
const isLinux = Deno.build.os === "linux";

// Check if command exists in PATH
async function commandExists(command: string): Promise<boolean> {
  try {
    const cmd = isWindows ? "where" : "which";
    const p = new Deno.Command(cmd, {
      args: [command],
      stderr: "null",
      stdout: "null",
    });
    const status = await p.output();
    return status.code === 0;
  } catch {
    return false;
  }
}

// Install dependencies if needed
async function installDependenciesIfNeeded(): Promise<void> {
  console.log("Checking for required dependencies...");
  
  const hasPandoc = await commandExists("pandoc");
  if (!hasPandoc) {
    console.log("Pandoc not found. Attempting to install...");
    
    if (isWindows) {
      // Check for Scoop
      const hasScoop = await commandExists("scoop");
      if (!hasScoop) {
        console.log("Scoop not found. Installing Scoop...");
        try {
          // PowerShell command to install Scoop
          const installScoopCmd = new Deno.Command("powershell", {
            args: ["-Command", "iwr -useb get.scoop.sh | iex"],
          });
          const scoopResult = await installScoopCmd.output();
          if (scoopResult.code !== 0) {
            throw new Error("Failed to install Scoop");
          }
          console.log("Scoop installed successfully");
        } catch (error) {
          console.error("Error installing Scoop:", error.message);
          console.log("Please install Scoop manually from https://scoop.sh");
          Deno.exit(1);
        }
      }
      
      // Install Pandoc using Scoop
      try {
        console.log("Installing Pandoc using Scoop...");
        const installPandocCmd = new Deno.Command("scoop", {
          args: ["install", "pandoc"],
        });
        const pandocResult = await installPandocCmd.output();
        if (pandocResult.code !== 0) {
          throw new Error("Failed to install Pandoc");
        }
        console.log("Pandoc installed successfully");
      } catch (error) {
        console.error("Error installing Pandoc:", error.message);
        console.log("Please install Pandoc manually from https://pandoc.org/installing.html");
        Deno.exit(1);
      }
    } else if (isMac) {
      // Check for Homebrew
      const hasBrew = await commandExists("brew");
      if (!hasBrew) {
        console.log("Homebrew not found. Installing Homebrew...");
        try {
          // Install Homebrew
          const installBrewCmd = new Deno.Command("bash", {
            args: ["-c", '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'],
          });
          const brewResult = await installBrewCmd.output();
          if (brewResult.code !== 0) {
            throw new Error("Failed to install Homebrew");
          }
          console.log("Homebrew installed successfully");
        } catch (error) {
          console.error("Error installing Homebrew:", error.message);
          console.log("Please install Homebrew manually from https://brew.sh");
          Deno.exit(1);
        }
      }
      
      // Install Pandoc using Homebrew
      try {
        console.log("Installing Pandoc using Homebrew...");
        const installPandocCmd = new Deno.Command("brew", {
          args: ["install", "pandoc"],
        });
        const pandocResult = await installPandocCmd.output();
        if (pandocResult.code !== 0) {
          throw new Error("Failed to install Pandoc");
        }
        console.log("Pandoc installed successfully");
      } catch (error) {
        console.error("Error installing Pandoc:", error.message);
        console.log("Please install Pandoc manually from https://pandoc.org/installing.html");
        Deno.exit(1);
      }
    } else if (isLinux) {
      console.log("On Linux, please install Pandoc using your distribution's package manager.");
      console.log("For example:");
      console.log("  - Ubuntu/Debian: sudo apt-get install pandoc");
      console.log("  - Fedora: sudo dnf install pandoc");
      console.log("  - Arch: sudo pacman -S pandoc");
      console.log("\nAlternatively, download from https://pandoc.org/installing.html");
      Deno.exit(1);
    }
  } else {
    console.log("Pandoc is already installed.");
  }
  
  console.log("All dependencies are installed and ready to use.");
}

// Process Markdown to DOCX
async function convertMarkdownToDocx(inputPath: string, outputPath: string, debugMode: boolean): Promise<void> {
  try {
    // Check if Pandoc is installed
    if (!await commandExists("pandoc")) {
      console.error("Error: Pandoc is not installed or not in your PATH.");
      console.error("Please run with --install-deps flag to attempt automatic installation");
      console.error("or install Pandoc manually from https://pandoc.org/installing.html");
      Deno.exit(1);
    }
    
    // Read the markdown file
    console.log(`Reading Markdown file: ${inputPath}`);
    const markdownContent = await Deno.readTextFile(inputPath);
    
    if (markdownContent.trim().length === 0) {
      throw new Error("Input markdown file is empty");
    }
    
    console.log(`Markdown content length: ${markdownContent.length} characters`);

    // Convert markdown to HTML
    console.log("Converting Markdown to HTML...");
    const htmlContent = marked.parse(markdownContent);
    
    console.log(`HTML content length: ${htmlContent.length} characters`);
    
    // Save HTML content for debugging if requested
    if (debugMode) {
      const htmlFilePath = outputPath.replace(/\.docx$/i, ".html");
      await Deno.writeTextFile(htmlFilePath, htmlContent);
      console.log(`Debug HTML file saved to: ${htmlFilePath}`);
    }

    // Wrap HTML in proper document structure to ensure content appears in the DOCX
    const fullHtmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Document</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 1em; }
          h1 { color: #333; }
          p { line-height: 1.5; }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
      </html>
    `;

    // Convert HTML to DOCX using Pandoc
    console.log("Converting HTML to DOCX...");
    
    // Create a temporary HTML file that will be used with Pandoc
    const tempHtmlPath = `${Deno.makeTempFileSync()}.html`;
    await Deno.writeTextFile(tempHtmlPath, fullHtmlContent);
    console.log(`Temporary HTML file created at: ${tempHtmlPath}`);
    
    // Create a temporary output path in the same directory as the script
    const tempOutputPath = `${Deno.makeTempFileSync()}.docx`;
    console.log(`Using temporary output path: ${tempOutputPath}`);
    
    // Use Pandoc via command line
    const command = new Deno.Command("pandoc", {
      args: [
        "-f", "html",
        "-t", "docx",
        "-o", tempOutputPath,
        tempHtmlPath
      ],
    });
    
    const { code, stdout, stderr } = await command.output();
    
    // Clean up the temporary HTML file
    await Deno.remove(tempHtmlPath);
    
    if (code !== 0) {
      const errorOutput = new TextDecoder().decode(stderr);
      console.error("Pandoc error:", errorOutput);
      throw new Error(`Pandoc conversion failed with exit code ${code}`);
    }
    
    // Copy the temporary file to the final destination
    try {
      // Read the temporary file
      const docxData = await Deno.readFile(tempOutputPath);
      
      // Write to the final destination
      await Deno.writeFile(outputPath, docxData);
      
      // Remove the temporary output file
      await Deno.remove(tempOutputPath);
      
      console.log(`DOCX file successfully created at: ${outputPath}`);
    } catch (error) {
      console.error(`Error copying output file: ${error.message}`);
      console.log(`Your converted file is available at: ${tempOutputPath}`);
      throw error;
    }
  } catch (error) {
    console.error("Error during conversion:", error);
    Deno.exit(1);
  }
}

// Main function
async function main() {
  // If install-deps flag is set, install dependencies regardless of conversion
  if (args["install-deps"]) {
    await installDependenciesIfNeeded();
    if (!args.input) {
      console.log("Dependencies check complete. Run again with an input file to convert.");
      Deno.exit(0);
    }
  }

  // Set input and output file paths for conversion
  const inputFile = args.input;
  const outputFile = args.output || inputFile.replace(/\.md$/i, ".docx");
  const debugMode = !!args.debug;

  // Run the conversion
  await convertMarkdownToDocx(inputFile, outputFile, debugMode);
}

// Execute the main function
main();
