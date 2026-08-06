# Document-to-stimuli conversion: backend handoff

The researcher frontend calls `POST /stimuli/convert` as authenticated
`multipart/form-data`.

## Request

- `file`: one `.pdf`, `.ppt`, or `.pptx` document.
- `project_id`: integer project identifier.
- `folder_id`: optional integer stimulus-folder identifier (reserved for future UI use).

The endpoint must apply the same authentication, role checks, and project access
checks as `POST /stimuli/upload`.

## Successful response

Status `201`:

```json
{
  "source": { "name": "deck.pptx", "page_count": 3 },
  "stimuli": [
    {
      "id": 101,
      "project_id": 7,
      "folder_id": null,
      "name": "deck_slide_1.jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 124000,
      "content_url": "/stimuli/101/content",
      "preview_url": "/stimuli/101/preview",
      "metadata": {
        "source_document_name": "deck.pptx",
        "source_page": 1,
        "source_page_count": 3,
        "content_path": "server-generated-relative-path.jpg"
      }
    }
  ]
}
```

## Backend/deployment requirements

- Convert PPT/PPTX to PDF with headless LibreOffice.
- Rasterize PDF pages with Poppler at a bounded DPI (for example 150–200).
- Store each generated image using the same durable storage abstraction as other
  stimulus binaries and create one `stimuli` database row per page.
- Never trust the filename or MIME type alone; validate extension, MIME signature,
  page count, file size, and conversion timeout.
- Use a per-request temporary directory and remove the source, intermediate PDF,
  and partial outputs in `finally`.
- Apply limits for upload size, page count, image dimensions, CPU time, and
  concurrent conversion jobs.
- On partial failure, remove generated files and roll back inserted database rows.
- Production deployment must provide LibreOffice and Poppler and use persistent
  object/file storage. The current process-local `uploads/stimuli` directory is
  insufficient when containers are ephemeral or horizontally scaled.

The existing `apps/researcher-web/converter.py` is a conversion helper only. It is
not an HTTP service, is not connected to `apps/api`, has no access control or
resource limits, and therefore must not be called directly by the browser.
