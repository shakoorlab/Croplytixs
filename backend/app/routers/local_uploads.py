"""
/api/local-uploads/{session_id} — a stand-in for Cloud Storage's upload
sessions, for local runs only.

On Cloud Run the browser uploads to storage.googleapis.com. With
STORAGE_BACKEND=local there is no bucket, so `LocalObjectStore.start_upload`
hands out URLs to this route instead, and this route answers the way Cloud
Storage does: 308 with `Range: bytes=0-N` while bytes are missing, 200 with
the object when the last one arrives, 499 on DELETE. The browser's uploader
can't tell the difference, which is the point — it is tested here, on a laptop.

It carries no sign-in check, like the real thing: the session id in the path is
the credential (32 random characters, one object, its size fixed). main.py
registers this router only when the local store is in use.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ..deps import get_store
from ..storage import LocalObjectStore, ObjectStore, UploadProtocolError

router = APIRouter(prefix="/local-uploads", tags=["local uploads"])


def _local(store: ObjectStore) -> LocalObjectStore:
    if not isinstance(store, LocalObjectStore):
        raise HTTPException(404, "Local uploads exist only when STORAGE_BACKEND=local.")
    return store


@router.put("/{session_id}")
async def put_chunk(session_id: str, request: Request, store: ObjectStore = Depends(get_store)):
    local = _local(store)
    body = await request.body()  # one chunk: 8 MiB from the browser's uploader
    try:
        reply = local.receive(session_id, request.headers.get("content-range"), body)
    except KeyError:
        raise HTTPException(404, "No such upload session.") from None
    except UploadProtocolError as exc:
        raise HTTPException(400, str(exc)) from None
    if reply.status == 200:
        return JSONResponse(reply.body)
    # 308 "Resume Incomplete", Cloud Storage's way of saying "send the rest".
    # No Range header until at least one byte is kept — exactly like Cloud Storage.
    headers = {"Range": f"bytes=0-{reply.persisted - 1}"} if reply.persisted else {}
    return Response(status_code=308, headers=headers)


@router.delete("/{session_id}")
def cancel_session(session_id: str, store: ObjectStore = Depends(get_store)):
    try:
        _local(store).cancel(session_id)
    except KeyError:
        raise HTTPException(404, "No such upload session.") from None
    # Cloud Storage answers a cancelled session with 499 ("client closed request").
    return Response(status_code=499)
