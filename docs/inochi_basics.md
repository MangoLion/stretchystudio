Exporting to the **Inochi2D (`.inp`)** format is an excellent choice for an open-source, "local-first" animation tool like yours. Since you are already working with **Three.js** and **React/Vite**, you'll find that Inochi2D is relatively approachable because its core data structure is JSON-based, wrapped in a simple binary container.

-----

## 1\. The `.inp` File Structure

An `.inp` file (Inochi Puppet) is a binary container that packages model metadata, node hierarchies, and texture atlases into a single file. All multi-byte numbers in the header are encoded in **Big Endian**.

### Binary Layout

| Offset | Length | Content | Description |
| :--- | :--- | :--- | :--- |
| `0x00` | 8 bytes | `TRNSRTS\0` | **Magic Bytes** (Stands for "Trans Rights\!"). |
| `0x08` | 4 bytes | `uint32` | **JSON Payload Length**. |
| `0x0C` | Variable | `JSON` | The model's skeletal and mesh data (UTF-8). |
| `EOF` | Variable | `Blobs` | Texture data section. |

### Texture Blobs

After the JSON payload, the file contains one or more texture segments:

1.  **Texture Payload Length** (4 bytes, `uint32`).
2.  **Texture Encoding** (1 byte): Typically `0` for PNG or `1` for TGA.
3.  **Texture Data**: The raw bytes of the image.

-----

## 2\. JSON Data Specification

The JSON section defines the "Puppet." It consists of two primary keys: `meta` and `nodes`.

### Metadata (`meta`)

Includes fields like `name`, `version`, `authors`, `copyright`, and `contact`.

### Node Hierarchy (`nodes`)

This is a recursive tree of nodes. For your "Stretchy Studio" tool, the most important node type is the **`Part`**.

  * **Node Properties:** `name`, `type`, `uuid`, `enabled`, `zSort`, `transform`.
  * **Mesh Data (inside a `Part`):**
      * `vertices`: A flat array of `float32` [x, y] coordinates.
      * `uvs`: A flat array of `float32` [u, v] coordinates.
      * `indices`: A flat array of `uint16` for triangle definitions.

-----

## 3\. Implementation Resources

Since you use **Three.js**, you can reference the existing (though experimental) TypeScript implementation to see how they handle the binary parsing and mesh reconstruction.

### Key Repositories

  * **[Inochi2D TypeScript (inochi2d-ts)](https://github.com/Inochi2D/inochi2d-ts):** This is the most relevant for your stack. It uses `binary-parser` for the header and `three` for rendering.
  * **[Official Inochi2D Spec](https://www.google.com/search?q=https://docs.inochi2d.com/en/latest/inochi2d/index.html):** The definitive guide for implementers.
  * **[Inochi2D-rs (Rust)](https://www.google.com/search?q=https://github.com/linkmauve/inochi2d-rs):** A high-performance implementation that might be useful if you decide to move your export logic to a backend or WASM module.

### Developer Tips

  * **Coordinate System:** Inochi2D generally uses a coordinate system where (0,0) is the center of the puppet, rather than the top-left corner.
  * **Versioning:** The format is evolving rapidly (currently v0.7–v0.8). Ensure your exporter writes the `version` string in the `meta` block to match the current stable release to ensure compatibility with **Inochi Creator** or **Inochi Session**.
  * **Compression:** While the format supports PNG, keeping textures optimized is key for real-time VTubing performance.