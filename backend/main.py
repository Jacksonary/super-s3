import os
from urllib.parse import quote
from typing import Optional, List

import boto3
import yaml
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Super S3 Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG_PATH = os.environ.get("CONFIG_PATH", "/config/config.yaml")

# ─── Config ──────────────────────────────────────────────────────────────────

def load_config() -> list:
    with open(CONFIG_PATH, "r") as f:
        data = yaml.safe_load(f)
    return data if isinstance(data, list) else [data]


def _provider_name(endpoint: str) -> str:
    if not endpoint:
        return "AWS S3"
    ep = endpoint.lower()
    if "myhuaweicloud" in ep:
        return "华为云 OBS"
    if "aliyuncs" in ep:
        return "阿里云 OSS"
    if "volcengineapi" in ep or "volces.com" in ep or "tos-" in ep:
        return "火山云 TOS"
    if "bcebos" in ep:
        return "百度云 BOS"
    if "qiniucs" in ep or "qbox" in ep:
        return "七牛云 Kodo"
    if "amazonaws" in ep:
        return "AWS S3"
    if "tencentcos" in ep or "myqcloud" in ep:
        return "腾讯云 COS"
    host = endpoint.split("//")[-1].split("/")[0]
    return host


def make_client(account: dict):
    endpoint = account.get("endpoint") or ""
    ep = endpoint.lower()
    # TOS requires virtual-hosted style; path-style returns InvalidPathAccess
    is_tos = "volces.com" in ep or "volcengineapi" in ep or "tos-s3" in ep
    addressing_style = "virtual" if is_tos else "path"
    return boto3.client(
        "s3",
        aws_access_key_id=account["ak"],
        aws_secret_access_key=account["sk"],
        endpoint_url=endpoint or None,
        region_name=account.get("region", "us-east-1"),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": addressing_style},
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def get_client(account_idx: int):
    accounts = load_config()
    if account_idx < 0 or account_idx >= len(accounts):
        raise HTTPException(status_code=404, detail="Account not found")
    return make_client(accounts[account_idx])


# ─── Config CRUD ─────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    """Return raw account config list (without ak/sk masked)."""
    accounts = load_config()
    return accounts


@app.put("/api/config")
def put_config(accounts: list = Body(...)):
    """Overwrite the entire config file with the given account list."""
    try:
        with open(CONFIG_PATH, "w") as f:
            yaml.dump(accounts, f, allow_unicode=True, sort_keys=False)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")
    return {"ok": True}


# ─── Accounts ────────────────────────────────────────────────────────────────

@app.get("/api/accounts")
def list_accounts():
    accounts = load_config()
    result = []
    for i, acct in enumerate(accounts):
        endpoint = acct.get("endpoint", "")
        result.append(
            {
                "id": i,
                "name": acct.get("name") or _provider_name(endpoint),
                "endpoint": endpoint,
                "region": acct.get("region", "us-east-1"),
                "buckets": acct.get("buckets") or [],
            }
        )
    return result


# ─── Buckets ─────────────────────────────────────────────────────────────────

@app.get("/api/buckets/{account_idx}")
def list_buckets(account_idx: int):
    accounts = load_config()
    if account_idx < 0 or account_idx >= len(accounts):
        raise HTTPException(status_code=404, detail="Account not found")

    configured = accounts[account_idx].get("buckets") or []
    if configured:
        return {"buckets": configured}

    try:
        client = get_client(account_idx)
        resp = client.list_buckets()
        return {"buckets": [b["Name"] for b in resp.get("Buckets", [])]}
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Objects ─────────────────────────────────────────────────────────────────

@app.get("/api/objects/{account_idx}/{bucket}")
def list_objects(
    account_idx: int,
    bucket: str,
    prefix: str = "",
    delimiter: str = "/",
    continuation_token: Optional[str] = None,
    limit: int = Query(default=200, le=1000),
):
    """
    List objects under a prefix.  Uses delimiter='/' by default so that
    common prefixes appear as "folders" instead of expanding the whole tree.
    Pass delimiter='' to list recursively (used by search).
    """
    try:
        client = get_client(account_idx)
        kwargs: dict = {
            "Bucket": bucket,
            "Prefix": prefix,
            "MaxKeys": limit,
        }
        if delimiter:
            kwargs["Delimiter"] = delimiter
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        resp = client.list_objects_v2(**kwargs)

        folders = [
            {
                "key": cp["Prefix"],
                "name": cp["Prefix"][len(prefix):],
                "type": "folder",
                "size": None,
                "last_modified": None,
                "etag": None,
                "storage_class": None,
            }
            for cp in resp.get("CommonPrefixes", [])
        ]

        files = [
            {
                "key": obj["Key"],
                "name": obj["Key"][len(prefix):],
                "type": "file",
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
                "etag": obj.get("ETag", "").strip('"'),
                "storage_class": obj.get("StorageClass", "STANDARD"),
            }
            for obj in resp.get("Contents", [])
            if obj["Key"] != prefix  # skip placeholder folder object
        ]

        return {
            "prefix": prefix,
            "delimiter": delimiter,
            "items": folders + files,
            "next_continuation_token": resp.get("NextContinuationToken"),
            "is_truncated": resp.get("IsTruncated", False),
            "key_count": resp.get("KeyCount", 0),
        }
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search/{account_idx}/{bucket}")
def search_objects(
    account_idx: int,
    bucket: str,
    q: str = Query(...),
    prefix: str = "",
    limit: int = Query(default=200, le=500),
):
    """Recursive prefix search – no delimiter."""
    try:
        client = get_client(account_idx)
        resp = client.list_objects_v2(
            Bucket=bucket,
            Prefix=prefix + q,
            MaxKeys=limit,
        )
        items = [
            {
                "key": obj["Key"],
                "name": obj["Key"],
                "type": "file",
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
                "etag": obj.get("ETag", "").strip('"'),
                "storage_class": obj.get("StorageClass", "STANDARD"),
            }
            for obj in resp.get("Contents", [])
        ]
        return {"items": items, "is_truncated": resp.get("IsTruncated", False)}
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Delete ──────────────────────────────────────────────────────────────────

class DeleteRequest(BaseModel):
    keys: List[str]


@app.delete("/api/objects/{account_idx}/{bucket}")
def delete_objects(account_idx: int, bucket: str, req: DeleteRequest):
    if not req.keys:
        return {"deleted": 0, "errors": []}
    try:
        client = get_client(account_idx)
        errors = []
        deleted = 0
        for i in range(0, len(req.keys), 1000):
            batch = req.keys[i : i + 1000]
            resp = client.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": k} for k in batch], "Quiet": False},
            )
            deleted += len(batch) - len(resp.get("Errors", []))
            errors.extend(resp.get("Errors", []))
        return {"deleted": deleted, "errors": errors}
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Download ────────────────────────────────────────────────────────────────

@app.get("/api/download/{account_idx}/{bucket}")
def download_object(account_idx: int, bucket: str, key: str = Query(...)):
    try:
        client = get_client(account_idx)
        resp = client.get_object(Bucket=bucket, Key=key)
        filename = key.split("/")[-1] or "file"
        # RFC 5987: safely handle Unicode and special chars in filename
        encoded_name = quote(filename, safe="")
        content_type = resp.get("ContentType", "application/octet-stream")
        content_length = str(resp.get("ContentLength", ""))

        def stream():
            for chunk in resp["Body"].iter_chunks(chunk_size=65536):
                yield chunk

        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}",
        }
        if content_length:
            headers["Content-Length"] = content_length

        return StreamingResponse(stream(), media_type=content_type, headers=headers)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Presign ─────────────────────────────────────────────────────────────────

@app.get("/api/presign/{account_idx}/{bucket}")
def presign_object(
    account_idx: int,
    bucket: str,
    key: str = Query(...),
    expires: int = Query(default=3600, ge=60, le=86400),
):
    try:
        client = get_client(account_idx)
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires,
        )
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Upload ──────────────────────────────────────────────────────────────────

@app.post("/api/upload/{account_idx}/{bucket}")
async def upload_object(
    account_idx: int,
    bucket: str,
    key: str = Query(...),
    file: UploadFile = File(...),
):
    try:
        client = get_client(account_idx)
        data = await file.read()
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=file.content_type or "application/octet-stream",
        )
        return {"success": True, "key": key, "size": len(data)}
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Folder ──────────────────────────────────────────────────────────────────

class FolderRequest(BaseModel):
    prefix: str


@app.post("/api/folder/{account_idx}/{bucket}")
def create_folder(account_idx: int, bucket: str, req: FolderRequest):
    folder_key = req.prefix.rstrip("/") + "/"
    try:
        client = get_client(account_idx)
        client.put_object(Bucket=bucket, Key=folder_key, Body=b"")
        return {"success": True, "key": folder_key}
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Object head (metadata) ──────────────────────────────────────────────────

@app.get("/api/meta/{account_idx}/{bucket}")
def object_meta(account_idx: int, bucket: str, key: str = Query(...)):
    try:
        client = get_client(account_idx)
        resp = client.head_object(Bucket=bucket, Key=key)
        expires = resp.get("Expires")
        return {
            "content_type": resp.get("ContentType"),
            "content_length": resp.get("ContentLength"),
            "last_modified": resp.get("LastModified").isoformat()
            if resp.get("LastModified")
            else None,
            "etag": resp.get("ETag", "").strip('"'),
            "expires": expires.isoformat() if hasattr(expires, "isoformat") else expires,
            "metadata": resp.get("Metadata", {}),
        }
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Text preview ─────────────────────────────────────────────────────────────

@app.get("/api/preview/{account_idx}/{bucket}")
def preview_object(
    account_idx: int,
    bucket: str,
    key: str = Query(...),
    limit: int = Query(default=51200, le=204800),
):
    """Return first N bytes of an object decoded as text."""
    try:
        client = get_client(account_idx)
        resp = client.get_object(
            Bucket=bucket, Key=key, Range=f"bytes=0-{limit - 1}"
        )
        raw = resp["Body"].read()
        truncated = resp.get("ContentRange") is not None
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        return {"text": text, "truncated": truncated}
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Static frontend ─────────────────────────────────────────────────────────

_static = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(_static):
    app.mount("/", StaticFiles(directory=_static, html=True), name="static")
