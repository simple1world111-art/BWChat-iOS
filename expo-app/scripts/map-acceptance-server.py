#!/usr/bin/env python3
"""Deterministic localhost API used only for native/Expo MapDating screenshot acceptance."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


HOST = os.environ.get("MAP_ACCEPTANCE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MAP_ACCEPTANCE_PORT", "8787"))
USER = {
    "user_id": "map-visual-acceptance",
    "username": "map_visual_acceptance",
    "nickname": "Map Visual Acceptance",
    "avatar_url": "",
    "bio": "",
    "gender": "",
    "birthday": "",
    "location": "Tokyo",
    "following_count": 0,
    "follower_count": 0,
    "posts_count": 0,
    "moments_count": 0,
    "followed_by_me": False,
    "follows_me": False,
    "is_friend": False,
}
PRESENCE = {
    "enabled": True,
    "visibility_scope": "everyone",
    "online_status": "online",
    "visible_on_map": True,
    "status": "active",
    "latitude": 35.681236,
    "longitude": 139.767125,
    "display_lat": 35.681236,
    "display_lng": 139.767125,
    "accuracy_m": 5,
    "updated_at": "2026-08-07T00:41:00Z",
}
USERS = [
    {
        "user_id": "map-fixture-blue",
        "nickname": "Blue",
        "avatar_url": "",
        "online_status": "online",
        "display_lat": 35.681535,
        "display_lng": 139.767125,
    },
    {
        "user_id": "map-fixture-pink",
        "nickname": "Pink",
        "avatar_url": "",
        "online_status": "invisible",
        "display_lat": 35.681036,
        "display_lng": 139.767455,
    },
    {
        "user_id": "map-fixture-green",
        "nickname": "Green",
        "avatar_url": "",
        "online_status": "online",
        "display_lat": 35.680936,
        "display_lng": 139.766795,
    },
]
def envelope(data: object, message: str = "ok") -> dict[str, object]:
    return {"code": 0, "message": message, "data": data}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[map-acceptance] {self.command} {self.path} " + format_string % args, flush=True)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/v1/auth/verify":
            self.respond(envelope({"user": USER}))
        elif path == "/api/v1/map/me":
            self.respond(envelope({"presence": PRESENCE}))
        elif path == "/api/v1/map/users":
            self.respond(
                envelope(
                    {
                        "users": USERS,
                        "viewer_id": USER["user_id"],
                        "snapshot_id": "map-acceptance-20260807",
                    }
                )
            )
        elif path == "/api/v1/app/config":
            self.respond(envelope({}))
        else:
            self.respond(envelope({}), status=200)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        self.read_json_body()
        if path in {"/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/refresh"}:
            self.respond(
                envelope(
                    {
                        "token": "map.acceptance.token",
                        "refresh_token": "map.acceptance.refresh",
                        "user": USER,
                    }
                )
            )
        else:
            self.respond(envelope({}))

    def do_PUT(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        body = self.read_json_body()
        if path == "/api/v1/map/me/location":
            next_presence = dict(PRESENCE)
            if isinstance(body, dict):
                next_presence["latitude"] = body.get("latitude", PRESENCE["latitude"])
                next_presence["longitude"] = body.get("longitude", PRESENCE["longitude"])
                next_presence["display_lat"] = next_presence["latitude"]
                next_presence["display_lng"] = next_presence["longitude"]
            self.respond(envelope({"presence": next_presence}))
        elif path == "/api/v1/map/me/settings":
            self.respond(envelope({"presence": PRESENCE}))
        else:
            self.respond(envelope({}))

    def read_json_body(self) -> object:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        encoded = self.rfile.read(length)
        try:
            return json.loads(encoded)
        except json.JSONDecodeError:
            return {}

    def respond(self, payload: object, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


if __name__ == "__main__":
    print(f"Map acceptance API listening on http://{HOST}:{PORT}/api/v1", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
