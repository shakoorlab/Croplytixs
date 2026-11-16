"""
/api/local-objects/{token} — a stand-in for Cloud Storage's signed URLs, for
local runs only.

On Cloud Run the browser reads the map files from storage.googleapis.com through
signed URLs (app/storage.py). With STORAGE_BACKEND=local there is no bucket, so
`LocalObjectStore.signed_url` hands out links to this route instead, and it
answers the way Cloud Storage does: the whole file, or a 206 with the bytes a
Range header asks for (Starlette's FileResponse handles Range), and 403 once the
link has expired or if it was tampered with.

Like a signed URL it carries no sign-in check: the signed token is the
credential, for one object, until it expires. main.py registers this router only
when the local store is in use.
"""

from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..deps import get_store
from ..storage import LocalObjectStore, ObjectStore

router = APIRouter(prefix="/local-objects", tags=["local reads"])


@router.api_route("/{token}", methods=["GET", "HEAD"])
def read_object(token: str, store: ObjectStore = Depends(get_store)):
    if not isinstance(store, LocalObjectStore):
        raise HTTPException(404, "Local reads exist only when STORAGE_BACKEND=local.")
    try:
        path = store.resolve_link(token)
    except (KeyError, ValueError):
        # Cloud Storage answers a bad or expired signature with 403 too.
        raise HTTPException(403, "This link has expired or isn't valid.") from None
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "private, max-age=300"})
