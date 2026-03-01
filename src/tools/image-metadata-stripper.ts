import { z } from "zod";
import sharp from "sharp";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  image: z
    .string()
    .min(1)
    .describe("Base64-encoded image data (JPEG, PNG, WebP, TIFF). Do not include the data URI prefix."),
  format: z
    .enum(["jpeg", "png", "webp", "preserve"])
    .default("preserve")
    .describe("Output format. 'preserve' keeps the original format."),
  quality: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(90)
    .describe("Output quality for lossy formats (jpeg, webp). 1-100, default 90."),
});

type Input = z.infer<typeof inputSchema>;

// ----- Handler -----
async function handler(input: Input) {
  const { image, format, quality } = input;

  // Decode base64
  let buffer: Buffer;
  try {
    buffer = Buffer.from(image, "base64");
  } catch {
    throw new Error("Invalid base64 image data");
  }

  if (buffer.length === 0) throw new Error("Empty image data");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("Image too large (max 10MB)");

  // Read metadata before stripping
  let originalMeta: Record<string, unknown> = {};
  try {
    const img = sharp(buffer);
    const meta = await img.metadata();
    originalMeta = {
      format: meta.format,
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      hasExif: !!meta.exif,
      hasIcc: !!meta.icc,
      hasIptc: !!meta.iptc,
      hasXmp: !!meta.xmp,
      orientation: meta.orientation,
      density: meta.density,
    };
  } catch {
    throw new Error("Could not read image — ensure it is a valid JPEG, PNG, WebP, or TIFF");
  }

  // Determine output format
  const outputFormat = format === "preserve" ? (originalMeta.format as string || "jpeg") : format;

  // Strip all metadata and re-encode (sharp strips metadata by default when not calling withMetadata)
  let stripped: sharp.Sharp;
  try {
    stripped = sharp(buffer);

    switch (outputFormat) {
      case "jpeg":
        stripped = stripped.jpeg({ quality, mozjpeg: true });
        break;
      case "png":
        stripped = stripped.png({ compressionLevel: 9 });
        break;
      case "webp":
        stripped = stripped.webp({ quality });
        break;
      default:
        stripped = stripped.jpeg({ quality });
    }
  } catch {
    throw new Error("Failed to process image");
  }

  const outputBuffer = await stripped.toBuffer();
  const outputBase64 = outputBuffer.toString("base64");

  const strippedFields: string[] = [];
  if (originalMeta.hasExif) strippedFields.push("EXIF (camera settings, GPS, timestamps)");
  if (originalMeta.hasIcc) strippedFields.push("ICC color profile");
  if (originalMeta.hasIptc) strippedFields.push("IPTC (copyright, captions)");
  if (originalMeta.hasXmp) strippedFields.push("XMP (editing history)");
  if (originalMeta.orientation) strippedFields.push("Orientation data");

  return {
    image: outputBase64,
    outputFormat,
    original: {
      sizeBytes: buffer.length,
      ...originalMeta,
    },
    output: {
      sizeBytes: outputBuffer.length,
      reductionBytes: buffer.length - outputBuffer.length,
      reductionPercent: parseFloat(((1 - outputBuffer.length / buffer.length) * 100).toFixed(1)),
    },
    metadataStripped: strippedFields.length > 0,
    strippedFields,
  };
}

// ----- Register -----
const imageMetadataStripperTool: ToolDefinition<Input> = {
  name: "image-metadata-stripper",
  description:
    "Strip EXIF, GPS, IPTC, XMP, and ICC metadata from images for privacy. Accepts base64-encoded JPEG, PNG, WebP, or TIFF images. Returns a cleaned base64 image with a report of what was removed.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["image", "exif", "privacy", "metadata", "gps", "security"],
    pricing: "$0.001 per call",
    exampleInput: {
      image: "<base64-encoded-image>",
      format: "preserve",
      quality: 90,
    },
  },
};

registerTool(imageMetadataStripperTool);

export default imageMetadataStripperTool;
