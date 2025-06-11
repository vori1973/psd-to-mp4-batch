# 📽️ PSD to MP4 Batch Renderer

A powerful Node.js CLI tool that automates the batch replacement of Smart Object images and text in Photoshop PSD templates, exports them as new PSD files, and optionally renders MP4 videos using Adobe Media Encoder presets.

---

## 🔧 Features

- ✅ Batch processing from a CSV file
- 🖼️ Replaces images and text in PSD templates
- 🧠 Validates required layers in templates
- 🪄 Auto-resizes images to Smart Object bounds
- 🎞️ Exports MP4 videos via Photoshop & Media Encoder
- 💾 Cross-platform: macOS and Windows (requires Photoshop)
- 🛠️ Configurable output folder, resolution, format, and more

---

## 🚀 Installation

```bash
npm install -g psd-to-mp4-batch
```

Or run directly using:

```bash
node run.js --csv ./data.csv --template ./template.psd --images ./images
```

---

## 🧪 Example Usage

```bash
psd-to-mp4-batch \
  --csv ./resources/data.csv \
  --template ./resources/template.psd \
  --images ./resources/images \
  --preset "YouTube HD 1080p 29.97.epr" \
```

---

## 📥 Required Inputs

### CSV File
Your CSV should contain:

- `product_id` – Unique ID for each output
- `output` – (Optional) Subfolder for export
- Columns matching layer names in the PSD:
  - For images: `Image 1`, `product_image`, etc.
  - For SmartObject text: `txt_Title`, `txt_Description`, etc.
  - For direct text layers: `ProductName`, `Price`, etc.

### PSD Template
- Contains Smart Objects and/or text layers with names matching the CSV headers
- Optional: include a `Links` folder for linked assets

### Images Directory
- Should include referenced image files used in the CSV

---

## 🧠 Layer Naming Conventions

This tool maps CSV columns to Photoshop layers using naming rules:

### 🔲 Smart Object Images

- **CSV columns**: Must contain the word `image` (case-insensitive), e.g., `Image 1`, `product_image`, `image_top_left`
- **PSD layers**: Must be **Smart Objects** with **exact matching names** as the CSV column (case-sensitive)

> ✅ `Image 1` in CSV ⟶ Smart Object layer named `Image 1` in PSD

---

### 🧠 Smart Object Text (Editable Smart Text)

- **CSV columns**: Must start with `txt_`, e.g., `txt_Title`, `txt_Description`
- **PSD layers**: Can have **any name**, but must be Smart Objects containing a **text layer** inside
- The tool will open the Smart Object and update the **first text layer** found

> ✅ `txt_Title` in CSV ⟶ Smart Object named `Title` in PSD

---

### 📝 Regular Text Layers

- **CSV columns**: Any other column names (not matching `image` or `txt_`) are treated as direct text layers
- **PSD layers**: Must be **text layers** with names **matching the column exactly**

> ✅ `ProductName` in CSV ⟶ Text layer named `ProductName` in PSD

---

## 🧾 CLI Options

| Option                     | Description |
|---------------------------|-------------|
| `--csv <path>`            | Path to input CSV file **(required)** |
| `--template <path>`       | Path to PSD template **(required)** |
| `--images <folder>`       | Path to folder with image assets **(required)** |
| `--out <folder>`          | Output directory (overrides `output` column in CSV) |
| `--width <number>`        | Custom video width |
| `--height <number>`       | Custom video height |
| `--size <string>`         | Adobe Export size (default: `"document"`) |
| `--preset <string>`       | Export preset (default: `"1_High Quality.epr"`) |
| `--format <string>`       | Video format (`"H.264"` or `"QuickTime"`) |
| `--aspect <string>`       | Aspect ratio (`"square"`, `"palWide"`, etc.) |
| `--export <boolean>`      | If true, skip PSD export and only generate MP4 |
| `--timeout <seconds>`     | Timeout for Photoshop script (default: `1800`) |
| `--ps-app <string>`       | Photoshop app name on macOS (default: `Adobe Photoshop 2025`) |
| `--use-preset-frame-rate` | Use frame rate from preset (default: true) |
| `--use-preset-size`       | Use size from preset (default: true) |
| `--run`                   | Run JSX script automatically after generation |
| `--help` or `-h`          | Show help message |

---

## 🖥️ System Requirements

- **Photoshop installed**
- **Adobe Media Encoder presets configured**
- macOS or Windows (CLI invokes Photoshop scripting APIs)

---

## 📂 Output

- Exported PSD and/or MP4 files into specified output folder
- Intermediate files stored in `./temp` (auto-created)
- Log files and validation reports saved to `temp` directory

---

## 🧹 Cleanup

Temporary files are stored in a `temp/` folder in the current working directory. You can delete it after processing:

```bash
rm -rf ./temp
```

---

## 📌 Notes

- Smart Object layers should be named clearly (`Image 1`, `txt_Title`, etc.)
- If layer validation fails, the tool will log missing layers and exit
- Custom sizes override preset-defined sizes

---

## 🧑‍💻 Developer

This tool was built with:
- Node.js
- `sharp` for image resizing
- Adobe Photoshop scripting via `osascript` (macOS) or `cscript` (Windows)

---

🎉 Thank you for using the Photoshop Batch Renderer!
