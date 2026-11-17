"""User authentication (JWT in an httpOnly cookie) and device authentication (X-Device-Id/-Key)."""
from __future__ import annotations

import time
from collections import defaultdict, deque

import jwt
from fastapi import Cookie, Header, HTTPException, Request, Response, status

from . import config, store

COOKIE = "wsb_session"
_DUMMY_HASH = store.hash_secret("timing-equalizer-not-a-real-password")


def issue_token(username: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": username, "iat": now, "exp": now + config.JWT_TTL_HOURS * 3600},
                      config.JWT_SECRET, algorithm="HS256")


def verify_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if sub and store.get_user(sub) else None


def is_https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def set_session_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=is_https(request),
                        max_age=config.JWT_TTL_HOURS * 3600, path="/")


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def check_credentials(username: str, password: str) -> bool:
    user = store.get_user(username)
    ok = store.check_secret(password, user["password_hash"] if user else _DUMMY_HASH)
    return ok and user is not None


# --- brute-force throttling: N failed attempts per IP per window ---
_failures: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "?")


def throttle_check(ip: str) -> None:
    q = _failures[ip]
    cutoff = time.time() - config.LOGIN_WINDOW_SEC
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) >= config.LOGIN_MAX_ATTEMPTS:
        retry = int(q[0] + config.LOGIN_WINDOW_SEC - time.time()) + 1
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"Too many failed logins. Try again in {retry // 60 + 1} min.",
                            headers={"Retry-After": str(retry)})


def throttle_fail(ip: str) -> None:
    _failures[ip].append(time.time())


def throttle_reset(ip: str) -> None:
    _failures.pop(ip, None)


# --- FastAPI dependencies ---

def require_user(wsb_session: str | None = Cookie(default=None)) -> str:
    user = verify_token(wsb_session)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return user


def require_device(x_device_id: str | None = Header(default=None),
                   x_device_key: str | None = Header(default=None)) -> str:
    if not store.verify_device_key(x_device_id, x_device_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid device credentials")
    return x_device_id  # type: ignore[return-value]
