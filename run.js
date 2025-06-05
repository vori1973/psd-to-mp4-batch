#!/usr/bin/env node
const fs = require('fs-extra');
const path = require('path');
const csv = require('csv-parser');
const os = require('os');
const sharp = require('sharp');
const { exec } = require('child_process');
const args = require('minimist')(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`
Usage: psd-to-mp4-batch [options]
  --csv <path>         Path to input CSV file
  --template <path>    Path to PSD template
  --images <folder>    Path to folder with image assets

Options:
  --out <folder>       Output directory override (default: uses 'output' column from CSV)
  --width <number>     Video width override
  --height <number>    Video height override
  --size <string>      Video size (default: "document") 
                        Examples: "HDVHDTV720p", "HDVHDTV720p"
  --preset <string>    Video render preset (default: "1_High Quality.epr") has to match format
                        check system Adobe Media Encoder folder for available presets
                        Examples: "2_Medium Quality.epr", "YouTube HD 1080p 29.97.epr"  
  --aspect <string>    Video Aspect / Resolution  (default: document)
                        check system  Media Encoder for available aspects
                        Examples: "square", "hdAnamorphic", "palWide" 
  --timeout <number>   Script execution timeout in seconds (default: 1800)
  --ps-app <string>    Photoshop application name for macOS (default: Adobe Photoshop 2025)
  -h, --help           Show this help message
`);
  process.exit(0);
}

// Check mandatory args
if (!args.csv || !args.template || !args.images) {
  console.error(`❌ Missing required arguments.

Usage:
  --csv <path>         Path to input CSV file
  --template <path>    Path to PSD template
  --images <folder>    Path to folder with image assets

Example:
  psd-to-mp4-batch  --csv ./data.csv --template ./template.psd --images ./images/
`);
  process.exit(0);
}

// CLI Args
const RUN_SCRIPT = args.run || true;
const CSV_PATH = path.resolve(args.csv || '');
const TEMPLATE_PATH = path.resolve(args.template || '');
const IMAGE_DIR = path.resolve(args.images || '');
const BASE_OUT_DIR = args.out ? path.resolve(args.out) : null; // Will use CSV output column if not provided
const VIDEO_SIZE = args.size || 'document'; // Default video size
const VIDEO_WIDTH = args.width || null;
const VIDEO_HEIGHT = args.height || null;
const VIDEO_PRESET = args.preset || '1_High Quality.epr'; // Default video render preset
const ALLOWED_FORMATS = ['H.264', 'QuickTime'];
const VIDEO_FORMAT = args.format || 'H.264'; // Default video format 
const VIDEO_ASPECT = args.aspect || 'document'; // Default video aspect/resolution


const SCRIPT_TIMEOUT = args.timeout || 1800; // Default 30 minutes
const PS_APP_NAME = args['ps-app'] || 'Adobe Photoshop 2025'; // User configurable Photoshop app name

// Create temp directory in script location
// const SCRIPT_DIR = path.dirname(path.resolve(process.argv[1]));
// const TEMP_DIR = path.join(SCRIPT_DIR, 'temp');
const CWD = process.cwd(); // 👈 This is where the user runs the CLI from
const TEMP_DIR = path.join(CWD, 'temp');
// Create it if it doesn't exist
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
const SCRIPT_PATH = path.join(TEMP_DIR, 'generatedScript.jsx');
const RESIZED_IMAGE_DIR = path.join(TEMP_DIR, 'resized');

async function readCSV(csvPath) {
  const results = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', data => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

function parseBoundsFile(boundsFilePath) {
  const lines = fs.readFileSync(boundsFilePath, 'utf-8')
    .split(/\r?\n|\r/g)
    .map(l => l.trim())
    .filter(Boolean);

  const result = {};
  for (const line of lines) {
    const [key, value] = line.split('=');
    if (!key || !value) continue;

    const [w, h] = value.split(',').map(n => parseInt(n, 10));
    if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) {
      result[key] = { width: w, height: h };
    } else {
      console.warn(`⚠️ Skipping invalid bounds for ${key}: "${value}"`);
    }
  }

  return result;
}

async function resizeImageToFit(imagePath, outputPath, dim) {
  return sharp(imagePath)
    .resize(dim.width, dim.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(outputPath);
}

// Combined function to extract bounds AND validate required layers
async function extractBoundsAndValidate(templatePath, boundsOutPath, requiredLayers) {
  const jsx = `#target photoshop
var doc = app.open(new File("${templatePath.replace(/\\/g, '/')}"));
var boundsMsg = "";
var validationMsg = "";
var debugMsg = "=== DEBUG: All layers found ===\\r\\n";

// Track found layers for validation
var foundLayers = {};
var requiredLayers = [${requiredLayers.map(layer => `"${layer}"`).join(', ')}];

function collectImageBoundsAndValidate(container, depth) {
  if (!depth) depth = 0;
  var indent = "";
  for (var d = 0; d < depth; d++) indent += "  ";
  
  for (var i = 0; i < container.layers.length; i++) {
    var layer = container.layers[i];
    var layerName = layer.name.toLowerCase();
    
    // Debug: log all layers
    debugMsg += indent + "Layer: '" + layer.name + "' (type: " + layer.typename;
    if (layer.kind) debugMsg += ", kind: " + layer.kind;
    debugMsg += ")\\r\\n";
    
    // Mark layer as found for validation
    foundLayers[layer.name] = true;
    
    // Check for image layers
    if (layerName.indexOf("image") !== -1) {
      if (layer.kind === LayerKind.SMARTOBJECT) {
        var b = layer.bounds;
        var width = b[2].as("px") - b[0].as("px");
        var height = b[3].as("px") - b[1].as("px");
        boundsMsg += layer.name + "=" + width + "," + height + String.fromCharCode(13);
        debugMsg += indent + "  -> FOUND SMART OBJECT: " + layer.name + " (" + width + "x" + height + ")\\r\\n";
      } else {
        debugMsg += indent + "  -> Found image layer but NOT smart object: " + layer.name + "\\r\\n";
      }
    }
    
    if (layer.typename === "LayerSet") {
      collectImageBoundsAndValidate(layer, depth + 1);
    }
  }
}

collectImageBoundsAndValidate(doc);

// Validate required layers
var missingLayers = [];
for (var i = 0; i < requiredLayers.length; i++) {
  if (!foundLayers[requiredLayers[i]]) {
    missingLayers.push(requiredLayers[i]);
  }
}

if (missingLayers.length > 0) {
  validationMsg = "MISSING_LAYERS:" + missingLayers.join(",") + String.fromCharCode(13);
} else {
  validationMsg = "ALL_LAYERS_FOUND" + String.fromCharCode(13);
}

// Write bounds file
var boundsFile = new File("${boundsOutPath.replace(/\\/g, '/')}");
var boundsFolder = boundsFile.parent;
if (!boundsFolder.exists) boundsFolder.create();
if (boundsFile.open("w")) {
  boundsFile.write(boundsMsg);
  boundsFile.close();
} else {
  alert("❌ Failed to open bounds file for writing.");
}

// Write validation file
var validationFile = new File("${boundsOutPath.replace(/\\/g, '/').replace('.txt', '_validation.txt')}");
if (validationFile.open("w")) {
  validationFile.write(validationMsg + debugMsg);
  validationFile.close();
} else {
  alert("❌ Failed to open validation file for writing.");
}

doc.close(SaveOptions.SAVECHANGES);
`;

  const jsxPath = path.join(TEMP_DIR, 'extractBoundsAndValidate_temp.jsx');
  await fs.writeFile(jsxPath, jsx);

  await executePhotoshopScript(jsxPath);
  await fs.remove(jsxPath);
}

// Reusable function to execute Photoshop scripts
async function executePhotoshopScript(jsxPath, timeoutSeconds = 300) {
  const jsxAbsPath = path.resolve(jsxPath);

  return new Promise((resolve, reject) => {
    if (os.platform() === 'darwin') {
      const osaCmd = [
        `osascript`,
        `-e 'with timeout of ${timeoutSeconds} seconds'`,
        `-e 'tell application "${PS_APP_NAME}"'`,
        `-e 'do javascript file "${jsxAbsPath}"'`,
        `-e 'end tell'`,
        `-e 'end timeout'`
      ].join(' ');

      exec(osaCmd, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`❌ Error executing Photoshop script: ${error.message}`));
        } else {
          console.log(`✅ Photoshop script executed successfully`);
          resolve(stdout);
        }
      });
    } else if (os.platform() === 'win32') {
      const vbscript = `
        Set app = CreateObject("Photoshop.Application")
        app.DoJavaScriptFile("${jsxAbsPath.replace(/\\/g, "\\\\")}")
      `;
      const vbsPath = path.join(TEMP_DIR, 'run_temp.vbs');
      fs.writeFileSync(vbsPath, vbscript);

      exec(`cscript //nologo ${vbsPath}`, (error, stdout, stderr) => {
        fs.removeSync(vbsPath);
        if (error) {
          reject(new Error(`❌ Error executing Photoshop script: ${error.message}`));
        } else {
          console.log(`✅ Photoshop script executed successfully`);
          resolve(stdout);
        }
      });
    } else {
      reject(new Error("❌ Script execution is only supported on macOS and Windows."));
    }
  });
}

// Function to validate layer presence from validation file
function validateLayersFromFile(validationFilePath) {
  try {
    const content = fs.readFileSync(validationFilePath, 'utf-8');
    const lines = content.split(/\r?\n|\r/g);
    const validationLine = lines.find(line => line.startsWith('MISSING_LAYERS:') || line.startsWith('ALL_LAYERS_FOUND'));

    if (!validationLine) {
      throw new Error('❌ Could not find validation results in file');
    }

    if (validationLine.startsWith('MISSING_LAYERS:')) {
      const missingLayers = validationLine.replace('MISSING_LAYERS:', '').split(',');
      throw new Error(`❌ Missing required layers in template: ${missingLayers.join(', ')}`);
    }

    console.log('✅ All required layers found in template');
    return true;
  }
  catch (err) {
    console.error(`❌ Error reading validation file: ${err.message}`);
    return false;
  }
}

// Function to get all required layers from CSV data
function getRequiredLayersFromData(rows) {
  const requiredLayers = new Set();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || key === "product_id" || key === "_templatePath" || key === "output") continue;

      if (key.toLowerCase().includes('image')) {
        requiredLayers.add(key);
      } else if (key.startsWith("txt_")) {
        const smartLayer = key.slice(4);
        requiredLayers.add(smartLayer);
      } else {
        // Regular text layers
        requiredLayers.add(key);
      }
    }
  }

  return Array.from(requiredLayers);
}

// NEW: Function to validate all paths before processing
async function validateAllPaths(rows) {
  console.log('🔍 Validating all file paths before processing...');

  const errors = [];

  // Check CSV file
  if (!fs.existsSync(CSV_PATH)) {
    errors.push(`CSV file not found: ${CSV_PATH}`);
  }

  // Check template file
  if (!fs.existsSync(TEMPLATE_PATH)) {
    errors.push(`Template PSD not found: ${TEMPLATE_PATH}`);
  }

  // Check images directory
  if (!fs.existsSync(IMAGE_DIR)) {
    errors.push(`Images directory not found: ${IMAGE_DIR}`);
  }

  // Check all image files referenced in CSV
  const missingImages = [];
  const invalidOutputPaths = [];

  for (const row of rows) {
    const productId = row["product_id"];

    // Check output directory path
    let outputDir;
    try {
      if (BASE_OUT_DIR) {
        outputDir = BASE_OUT_DIR;
      } else if (row.output) {
        outputDir = path.resolve(IMAGE_DIR + "/" + row.output);
      } else {
        invalidOutputPaths.push(`Product ${productId}: No output directory specified`);
        continue;
      }

      // Try to ensure output directory exists to validate path
      await fs.ensureDir(outputDir);
    } catch (err) {
      invalidOutputPaths.push(`Product ${productId}: Invalid output path - ${err.message}`);
    }

    // Check all image files for this row
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase().includes('image') && value) {
        const imagePath = path.resolve(IMAGE_DIR, value);
        if (!fs.existsSync(imagePath)) {
          missingImages.push(`${key}: ${imagePath}`);
        }
      }
    }
  }

  // Collect all errors
  if (missingImages.length > 0) {
    errors.push(`Missing image files:\n  ${missingImages.join('\n  ')}`);
  }

  if (invalidOutputPaths.length > 0) {
    errors.push(`Invalid output paths:\n  ${invalidOutputPaths.join('\n  ')}`);
  }

  // Report results
  if (errors.length > 0) {
    console.error('❌ Path validation failed:');
    errors.forEach(error => console.error(`   ${error}`));
    return false;
  }

  console.log('✅ All paths validated successfully');
  return true;
}

function generateJSX(dataRow, templateName, videoPreset, videoFormat, videoAspect, videoSize, videoWidth, videoHeight, outputDir) {
  const jsx = [];
  const productId = dataRow["product_id"];
  const templatePath = dataRow._templatePath.replace(/\\/g, "/");

  jsx.push(`var doc = app.open(new File("${templatePath}"));`);

  // Helper: recursive layer search
  jsx.push(`
function findLayerByName(container, name) {
  for (var i = 0; i < container.layers.length; i++) {
    var layer = container.layers[i];
    if (layer.name === name) return layer;
    if (layer.typename === "LayerSet") {
      var found = findLayerByName(layer, name);
      if (found) return found;
    }
  }
  return null;
}
`);

  for (const [key, value] of Object.entries(dataRow)) {
    if (key === "id" || key === "product_id" || key === "_templatePath" || key === "output") continue;

    if (key.toLowerCase().includes('image')) {
      const imagePath = value.includes('resized/')
        ? path.resolve(IMAGE_DIR, value).replace(/\\/g, "/")
        : path.resolve(IMAGE_DIR, value).replace(/\\/g, "/");

      jsx.push(`
        try {
          var imageLayer = findLayerByName(doc, "${key}");
          if (!imageLayer) throw "Layer not found";
          doc.activeLayer = imageLayer;
          var desc = new ActionDescriptor();
          desc.putPath(charIDToTypeID("null"), new File("${imagePath}"));
          executeAction(stringIDToTypeID("placedLayerReplaceContents"), desc, DialogModes.NO);
          var idplacedLayerResetTransforms = stringIDToTypeID("placedLayerResetTransforms");
          executeAction(idplacedLayerResetTransforms, undefined, DialogModes.NO);
        } catch (e) {
          alert("❌ Failed to replace image for ${key}: " + e);
        }
      `);
    } else if (key.startsWith("txt_")) {
      const smartLayer = key.slice(4);
      jsx.push(`
        try {
          var smartLayer = findLayerByName(doc, "${smartLayer}");
          if (!smartLayer) throw "Smart Object layer not found";
          doc.activeLayer = smartLayer;

          app.executeAction(stringIDToTypeID("placedLayerEditContents"), undefined, DialogModes.NO);
          var smartDoc = app.activeDocument;

          var textReplaced = false;
          for (var i = 0; i < smartDoc.layers.length; i++) {
            var lyr = smartDoc.layers[i];
            if (lyr.kind === LayerKind.TEXT) {
              lyr.textItem.contents = "${value}";
              textReplaced = true;
              break;
            }
          }

          if (!textReplaced) {
            alert("❌ No text layer found in Smart Object '${smartLayer}'");
          }

          smartDoc.close(SaveOptions.SAVECHANGES);
        } catch (e) {
          alert("🚨 Error editing Smart Object '${smartLayer}': " + e);
        }
      `);
    } else {
      jsx.push(`
        try {
          var textLayer = findLayerByName(doc, "${key}");
          if (textLayer && textLayer.kind === LayerKind.TEXT) {
            textLayer.textItem.contents = "${value}";
          }
        } catch(e) {
          alert("Text replacement error (${key}): " + e);
        }
      `);
    }
  }

  // Save PSD to output directory
  jsx.push(`
    try {
      var psdSaveOptions = new PhotoshopSaveOptions();
      psdSaveOptions.embedColorProfile = true;
      psdSaveOptions.alphaChannels = true;
      var psdFile = new File("${outputDir.replace(/\\/g, "/")}/${templateName}_${productId}.psd");
      doc.saveAs(psdFile, psdSaveOptions, true, Extension.LOWERCASE);
    } catch(e) {
      alert("❌ Failed to save PSD for ${productId}: " + e);
    }
    `);

  // Export MP4 to output directory
  jsx.push(`
    try {
      var desc = new ActionDescriptor();
      var using = new ActionDescriptor();

      using.putBoolean(stringIDToTypeID("allFrames"), true);
      using.putString(stringIDToTypeID("ameFormatName"), "${videoFormat}");
      using.putString(stringIDToTypeID("amePresetName"), "${videoPreset}");


      var exportFolder = new File("${outputDir.replace(/\\/g, "/")}");
      using.putPath(stringIDToTypeID("directory"), exportFolder);

      using.putEnumerated(stringIDToTypeID("fieldOrder"), stringIDToTypeID("videoField"), stringIDToTypeID("preset"));
      using.putBoolean(stringIDToTypeID("manage"), true);
      using.putEnumerated(stringIDToTypeID("pixelAspectRatio"), stringIDToTypeID("pixelAspectRatio"), stringIDToTypeID("${videoAspect}"));
      using.putEnumerated(stringIDToTypeID("renderAlpha"), stringIDToTypeID("alphaRendering"), stringIDToTypeID("none"));
      using.putEnumerated(stringIDToTypeID("sizeSelector"), stringIDToTypeID("footageSize"), stringIDToTypeID("${videoSize}"));
     
    ${videoWidth && videoHeight ? `
      // Custom size export
      using.putEnumerated(stringIDToTypeID("sizeSelector"), stringIDToTypeID("footageSize"), stringIDToTypeID("customSize"));
      using.putInteger(stringIDToTypeID("width"), "${videoWidth}");
      using.putInteger(stringIDToTypeID("height"), "${videoHeight}");
      ` : `
      // Using preset size
      `}
      
      using.putBoolean(stringIDToTypeID("useDocumentFrameRate"), true);

      desc.putObject(stringIDToTypeID("using"), stringIDToTypeID("videoExport"), using);
      executeAction(stringIDToTypeID("export"), desc, DialogModes.NO);
    } catch(e) {
      alert("❌ Render failed for ${productId}: " + e);
    }
    doc.close(SaveOptions.SAVECHANGES);
  `);

  return jsx.join("\n");
}

async function main() {
  try {
    console.log(`⚙️ Configuration:`);
    console.log(`   CSV Path: ${CSV_PATH}`);
    console.log(`   Template Path: ${TEMPLATE_PATH}`);
    console.log(`   Images Directory: ${IMAGE_DIR}`);
    console.log(`   Script Timeout: ${SCRIPT_TIMEOUT} seconds`);
    console.log(`   Photoshop App: ${PS_APP_NAME}`);
    console.log(`   Output Directory: ${BASE_OUT_DIR || 'From CSV output column'}`);
    // Check mandatory args

    if (!fs.existsSync(CSV_PATH)) throw new Error("❌ CSV file not found: " + CSV_PATH);
    if (!fs.existsSync(TEMPLATE_PATH)) throw new Error("❌ Template PSD not found: " + TEMPLATE_PATH);
    if (!(fs.existsSync(IMAGE_DIR) && fs.lstatSync(IMAGE_DIR).isDirectory())) throw new Error("❌ Images directory not found: " + IMAGE_DIR);
    if (!ALLOWED_FORMATS.includes(VIDEO_FORMAT)) throw new Error(`❌ Invalid --format "${VIDEO_FORMAT}". Supported values: ${ALLOWED_FORMATS.join(', ')}`);

    // Ensure temp directory exists
    await fs.ensureDir(TEMP_DIR);
    await fs.ensureDir(RESIZED_IMAGE_DIR);

    const rows = await readCSV(CSV_PATH);
    const TEMPLATE_NAME = path.basename(TEMPLATE_PATH, path.extname(TEMPLATE_PATH));

    console.log(`📁 Temp directory: ${TEMP_DIR}`);
    console.log(`📂 Resized images will be stored in: ${RESIZED_IMAGE_DIR}`);

    // NEW: Validate all paths before proceeding
    const pathsValid = await validateAllPaths(rows);
    if (!pathsValid) {
      console.error('❌ Aborting due to path validation errors. Please fix the issues above and try again.');
      process.exit(1);
    }

    // Step 1: Extract bounds ONCE and validate ALL required layers
    console.log("🔍 Analyzing template and validating required layers...");
    const requiredLayers = getRequiredLayersFromData(rows);
    console.log(`📋 Required layers: ${requiredLayers.join(', ')}`);

    const boundsOutPath = path.join(TEMP_DIR, `${TEMPLATE_NAME}_bounds.txt`);
    const validationOutPath = path.join(TEMP_DIR, `${TEMPLATE_NAME}_bounds_validation.txt`);

    await extractBoundsAndValidate(TEMPLATE_PATH, boundsOutPath, requiredLayers);

    // Validate that all required layers were found
    const isValid = validateLayersFromFile(validationOutPath);
    if (!isValid) process.exit(1);

    // Parse bounds once
    const bounds = parseBoundsFile(boundsOutPath);
    console.log(`📐 Found bounds for layers: ${Object.keys(bounds).join(', ')}`);

    // Step 2: Process each row - copy template and resize images
    const scriptParts = [];

    for (const row of rows) {
      const productId = row["product_id"];

      // Determine output directory for this record
      let outputDir;
      if (BASE_OUT_DIR) {
        // Use provided output directory
        outputDir = BASE_OUT_DIR;
      } else if (row.output) {
        // Use output column from CSV
        outputDir = path.resolve(IMAGE_DIR + "/" + row.output);
      } else {
        throw new Error(`❌ No output directory specified for product ${productId}. Either provide --out parameter or include 'output' column in CSV.`);
      }

      // Ensure output directory exists
      await fs.ensureDir(outputDir);

      const newTemplateName = `${TEMPLATE_NAME}_${productId}.psd`;
      const newTemplatePath = path.join(TEMP_DIR, newTemplateName);

      console.log(`📄 Processing product ${productId} -> Output: ${outputDir}`);
      await fs.copy(TEMPLATE_PATH, newTemplatePath);
      row._templatePath = newTemplatePath;

      // Resize images using shared bounds
      for (const [key, value] of Object.entries(row)) {
        if (key.toLowerCase().includes("image")) {
          const originalImage = path.resolve(IMAGE_DIR, value);
          const resizedImage = path.join(RESIZED_IMAGE_DIR, `${productId}_${key}.png`);
          const dim = bounds[key];

          if (dim && fs.existsSync(originalImage)) {
            console.log(`📐 Resizing ${key} to ${dim.width}x${dim.height}`);
            await resizeImageToFit(originalImage, resizedImage, dim);
            row[key] = path.relative(IMAGE_DIR, resizedImage).replace(/\\/g, '/');
          } else {
            if (!dim) {
              console.warn(`⚠️ No bounds found for ${key}. Available bounds: ${Object.keys(bounds).join(', ')}`);
            }
            if (!fs.existsSync(originalImage)) {
              console.warn(`⚠️ Original image not found: ${originalImage}`);
            }
          }
        }
      }

      // Generate JSX for this record with its output directory
      scriptParts.push(generateJSX(row, TEMPLATE_NAME, VIDEO_PRESET, VIDEO_FORMAT, VIDEO_ASPECT, VIDEO_SIZE, VIDEO_WIDTH, VIDEO_HEIGHT, outputDir));
    }

    // Step 3: Generate JSX script in temp directory
    console.log("📝 Generating JSX script...");
    const fullScript = `#target photoshop\n` + scriptParts.join("\n");
    await fs.writeFile(SCRIPT_PATH, fullScript);

    console.log(`✅ Script written to: ${SCRIPT_PATH}`);
    console.log(`📂 Temporary files location: ${TEMP_DIR}`);

    // Step 4: Optionally run the script
    if (RUN_SCRIPT) {
      console.log(`🚀 Launching Photoshop and running script with ${SCRIPT_TIMEOUT}s timeout...`);
      try {
        await executePhotoshopScript(SCRIPT_PATH, SCRIPT_TIMEOUT);
        console.log(`✅ All products processed successfully!`);
      } catch (error) {
        console.error(`❌ Error running script: ${error.message}`);
      }
    } else {
      console.log(`📌 To run the script, use --run flag or open Photoshop > File > Scripts > Browse... and select ${SCRIPT_PATH}`);
    }

    // Cleanup info
    console.log(`📄 Bounds file saved to: ${boundsOutPath}`);
    console.log(`📄 Validation file saved to: ${validationOutPath}`);
    console.log(`📁 Resized images saved to: ${RESIZED_IMAGE_DIR}`);
    console.log(`🗂️ To clean up temporary files, delete: ${TEMP_DIR}`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
  console.log("✅ All tasks completed successfully!");
  console.log("🎉 Thank you for using the Photoshop Batch Renderer!");
}

main().catch(console.error);