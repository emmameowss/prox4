// Removal of metadata from image files.
//
// Re-uploading an image under the bot's name hides who sent it, but says
// nothing about the image itself: a photo straight off a phone carries EXIF
// with GPS coordinates, a capture timestamp and often a device serial. For a
// tool whose entire purpose is anonymity, that has to come off before anyone
// else sees the file.
//
// These functions work on the container structure only. They never decode or
// re-encode pixels, so output is byte-identical to the input apart from the
// removed sections. Anything that cannot be parsed with confidence returns
// null, and the caller is expected to drop the image rather than send an
// unsanitized one.

// Only formats we can actually strip are accepted; see stripMetadata.
export const SUPPORTED_MIMETYPES = ["image/jpeg", "image/png"];

// JPEG application segments worth keeping. Everything else in the APPn range
// is metadata of one kind or another -- APP1 holds EXIF and XMP, APP13 holds
// IPTC -- and goes.
const JPEG_KEEP_APP = new Set([
  0xe0, // APP0, JFIF density information
  0xe2, // APP2, ICC colour profile
  0xee, // APP14, Adobe colour transform (CMYK renders wrong without it)
]);

function stripJpeg(contents: Buffer): Buffer | null {
  if (contents.length < 4) return null;
  // SOI
  if (contents[0] !== 0xff || contents[1] !== 0xd8) return null;

  const kept: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;

  while (i < contents.length) {
    if (contents[i] !== 0xff) return null;
    // Fill bytes: any number of 0xff may precede the marker itself.
    while (i < contents.length && contents[i] === 0xff) i++;
    if (i >= contents.length) return null;
    const marker = contents[i];
    i++;

    // End of image.
    if (marker === 0xd9) {
      kept.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(kept);
    }

    // Markers that carry no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(Buffer.from([0xff, marker]));
      continue;
    }

    if (i + 2 > contents.length) return null;
    const length = contents.readUInt16BE(i);
    // The length field counts itself, so anything under 2 is malformed.
    if (length < 2) return null;
    const end = i + length;
    if (end > contents.length) return null;

    if (marker === 0xda) {
      // Start of scan. Past this segment's header lies entropy-coded data
      // that is not marker-structured, so the rest of the file is copied
      // through untouched.
      kept.push(Buffer.from([0xff, marker]));
      kept.push(contents.slice(i, contents.length));
      return Buffer.concat(kept);
    }

    const is_app = marker >= 0xe0 && marker <= 0xef;
    const is_comment = marker === 0xfe;
    const drop = (is_app && !JPEG_KEEP_APP.has(marker)) || is_comment;
    if (!drop) {
      kept.push(Buffer.from([0xff, marker]));
      kept.push(contents.slice(i, end));
    }
    i = end;
  }

  // Ran off the end without ever reaching SOS or EOI.
  return null;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// PNG chunks worth keeping: the critical ones, the ones that affect how the
// image renders, and the APNG animation chunks. Dropped by omission are
// tEXt, zTXt, iTXt (arbitrary text, often authorship), eXIf (the same EXIF
// payload as JPEG) and tIME.
const PNG_KEEP_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "pHYs",
  "bKGD",
  "sBIT",
  "acTL",
  "fcTL",
  "fdAT",
]);

function stripPng(contents: Buffer): Buffer | null {
  if (contents.length < PNG_SIGNATURE.length) return null;
  if (!contents.slice(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }

  const kept: Buffer[] = [PNG_SIGNATURE];
  let i = PNG_SIGNATURE.length;

  while (i + 8 <= contents.length) {
    const length = contents.readUInt32BE(i);
    const type = contents.toString("ascii", i + 4, i + 8);
    // 4 length + 4 type + data + 4 CRC
    const end = i + 12 + length;
    if (end > contents.length) return null;

    // Chunks are copied whole, so their CRCs stay valid.
    if (PNG_KEEP_CHUNKS.has(type)) kept.push(contents.slice(i, end));
    i = end;

    if (type === "IEND") return Buffer.concat(kept);
  }

  // No IEND: truncated or not really a PNG.
  return null;
}

// Returns a copy of the image with its metadata removed, or null if the file
// cannot be parsed or is a format we do not know how to sanitize. A null
// result means the image must not be uploaded.
export function stripMetadata(
  contents: Buffer,
  mimetype?: string
): Buffer | null {
  if (mimetype === "image/jpeg") return stripJpeg(contents);
  if (mimetype === "image/png") return stripPng(contents);
  return null;
}
