// Images attached to confessions.
//
// A Slack file permanently records who uploaded it, so the author's own files
// can never be shown to reviewers -- that would deanonymize every image
// confession, bypassing the deliberate (and logged) reveal flow. Instead the
// bot downloads each original using its own token and uploads a fresh copy
// that it owns. Those copies are the only thing anyone but the author sees.

import { web } from "./slack";
import { token } from "./secrets_wrapper";
import { stripMetadata, SUPPORTED_MIMETYPES } from "./strip_metadata";

export const MAX_IMAGES = 2;

// Anything bigger than this is skipped rather than pulled into memory.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// The subset of Slack's file object that we care about.
export interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
}

export interface ImageSelection {
  images: SlackFile[];
  dropped_images: number;
  dropped_format: number;
  dropped_other: number;
}

// Picks the images we will actually use, and counts what was left behind so
// callers can tell the author about it.
export function selectImages(files?: SlackFile[]): ImageSelection {
  const all = files ?? [];
  const images = all.filter((file) => file.mimetype?.startsWith("image/"));
  // Formats whose metadata we cannot strip are refused rather than sent on
  // unsanitized.
  const supported = images.filter((file) =>
    SUPPORTED_MIMETYPES.includes(file.mimetype ?? "")
  );
  return {
    images: supported.slice(0, MAX_IMAGES),
    dropped_images: Math.max(0, supported.length - MAX_IMAGES),
    dropped_format: images.length - supported.length,
    dropped_other: all.length - images.length,
  };
}

// Human-readable notes about everything selectImages left out.
export function droppedNotes(selection: ImageSelection): string[] {
  const notes = [];
  if (selection.dropped_images > 0) {
    notes.push(
      `Only the first ${MAX_IMAGES} images were included; ${
        selection.dropped_images
      } ${selection.dropped_images == 1 ? "was" : "were"} dropped.`
    );
  }
  if (selection.dropped_format > 0) {
    notes.push(
      `${selection.dropped_format} ${
        selection.dropped_format == 1 ? "image was" : "images were"
      } left out; only JPEG and PNG can have their metadata stripped.`
    );
  }
  if (selection.dropped_other > 0) {
    notes.push(
      `${selection.dropped_other} non-image ${
        selection.dropped_other == 1 ? "attachment was" : "attachments were"
      } skipped, since only images are supported.`
    );
  }
  return notes;
}

function extensionFor(file: SlackFile): string {
  if (file.filetype) return file.filetype;
  const name = file.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot > 0) return name.slice(dot + 1);
  return "png";
}

async function downloadFile(file: SlackFile): Promise<Buffer | null> {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    console.log(`File ${file.id} has no download URL, skipping`);
    return null;
  }
  if (file.size !== undefined && file.size > MAX_FILE_BYTES) {
    console.log(`File ${file.id} is ${file.size} bytes, too large, skipping`);
    return null;
  }
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    console.log(`Failed to download file ${file.id}: HTTP ${r.status}`);
    return null;
  }
  const contents = Buffer.from(await r.arrayBuffer());
  if (contents.length > MAX_FILE_BYTES) {
    console.log(`File ${file.id} is too large once downloaded, skipping`);
    return null;
  }
  return contents;
}

// Uploads via the external upload flow. The installed @slack/web-api (6.2.4)
// only types files.upload, which Slack retired in March 2025, so these go
// through the untyped apiCall escape hatch instead.
async function uploadImage(
  contents: Buffer,
  filename: string,
  channel: string,
  thread_ts?: string
): Promise<string | null> {
  const reserved = await web.apiCall("files.getUploadURLExternal", {
    filename,
    length: contents.length,
  });
  if (!reserved.ok) {
    console.log(`Failed to reserve an upload URL for ${filename}`);
    return null;
  }
  const upload_url = reserved.upload_url as string;
  const file_id = reserved.file_id as string;

  const form = new FormData();
  form.append("file", new Blob([contents]), filename);
  const uploaded = await fetch(upload_url, { method: "POST", body: form });
  if (!uploaded.ok) {
    console.log(`Failed to upload ${filename}: HTTP ${uploaded.status}`);
    return null;
  }

  const completed = await web.apiCall("files.completeUploadExternal", {
    // apiCall form-encodes its arguments, so this has to be a JSON string.
    files: JSON.stringify([{ id: file_id }]),
    channel_id: channel,
    ...(thread_ts ? { thread_ts } : {}),
  });
  if (!completed.ok) {
    console.log(`Failed to complete the upload of ${filename}`);
    return null;
  }
  return file_id;
}

// Downloads the author's originals and uploads bot-owned copies into a
// channel, returning the new file IDs. One bad image is skipped rather than
// failing the whole confession.
export async function copyImagesToChannel(
  file_ids: string[] | undefined,
  channel: string,
  thread_ts: string | undefined,
  confession_id: number
): Promise<string[]> {
  if (!file_ids || file_ids.length == 0) return [];
  const copies: string[] = [];
  for (const [index, id] of file_ids.entries()) {
    try {
      const info = await web.files.info({ file: id });
      if (!info.ok) {
        console.log(`Failed to look up file ${id}`);
        continue;
      }
      const file = (info as any).file as SlackFile;
      const contents = await downloadFile(file);
      if (contents == null) continue;
      // EXIF on a phone photo carries GPS coordinates. Hiding who uploaded
      // the file counts for little if the file still says where it was taken.
      const stripped = stripMetadata(contents, file.mimetype);
      if (stripped == null) {
        console.log(`Could not strip metadata from file ${id}, skipping it`);
        continue;
      }
      // Never reuse the author's filename; it frequently contains their name.
      const filename = `confession-${confession_id}-${index + 1}.${extensionFor(
        file
      )}`;
      const copy = await uploadImage(stripped, filename, channel, thread_ts);
      if (copy != null) copies.push(copy);
    } catch (e) {
      console.log(`Failed to copy image ${id} of confession #${confession_id}`);
      console.log(JSON.stringify(e));
    }
  }
  console.log(
    `Copied ${copies.length}/${file_ids.length} images of confession #${confession_id} to ${channel}`
  );
  return copies;
}
