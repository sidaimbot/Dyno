"""
Windows SMTC bridge. Install with: py -m pip install winsdk
Streams one JSON object per line on stdout. Commands arrive as JSON lines on stdin.
"""

import asyncio, base64, json, sys, time
from datetime import datetime, timezone

POLL_SECONDS = 0.35
ART_CACHE_LIMIT = 12


def projected_position(timeline, playing):
    """SMTC reports the position as of timeline.last_updated_time, so the raw value is
    already a poll interval old by the time we read it. Project it to 'now' and the UI
    clock matches the audio instead of trailing it."""
    try:
        position = max(0.0, float(timeline.position.total_seconds()))
    except Exception:
        return 0.0
    if playing:
        try:
            updated = timeline.last_updated_time
            if updated is not None:
                now = datetime.now(timezone.utc) if updated.tzinfo else datetime.now()
                delta = (now - updated).total_seconds()
                if 0 < delta < 30:
                    position += delta
        except Exception:
            pass
    return position


async def read_art(props):
    try:
        stream = await props.thumbnail.open_read_async()
        size = stream.size
        reader = __import__('winsdk').windows.storage.streams.DataReader(stream.get_input_stream_at(0))
        await reader.load_async(size)
        raw = bytearray(size)
        reader.read_bytes(raw)
        return "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
    except Exception:
        return None


async def main():
    try:
        from winsdk.windows.media.control import (
            GlobalSystemMediaTransportControlsSessionManager as Manager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
        )
    except Exception as exc:
        print(json.dumps({"error": "winsdk missing", "detail": str(exc)}), flush=True)
        return

    manager = await Manager.request_async()
    current = None
    art_cache = {}

    async def commands():
        nonlocal current
        loop = asyncio.get_running_loop()
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                return
            try:
                cmd = json.loads(line)
                if current is None:
                    continue
                action = cmd.get("action")
                if action == "playPause":
                    await current.try_toggle_play_pause_async()
                elif action == "play":
                    await current.try_play_async()
                elif action == "pause":
                    await current.try_pause_async()
                elif action == "next":
                    await current.try_skip_next_async()
                elif action == "previous":
                    await current.try_skip_previous_async()
                elif action == "seek":
                    await current.try_change_playback_position_async(int(float(cmd.get("value", 0)) * 10_000_000))
            except Exception:
                pass

    asyncio.create_task(commands())
    while True:
        try:
            session = manager.get_current_session()
            if session:
                current = session
                props = await session.try_get_media_properties_async()
                playback = session.get_playback_info()
                timeline = session.get_timeline_properties()
                playing = playback.playback_status == Status.PLAYING

                duration = max(0.0, float(timeline.end_time.total_seconds())) if timeline else 0.0
                position = projected_position(timeline, playing)
                if duration > 0:
                    position = min(position, duration)

                # Artwork extraction is slow; cache it per track so the poll stays responsive.
                key = (props.title or "", props.artist or "", props.album_title or "")
                if key in art_cache:
                    art = art_cache[key]
                else:
                    art = await read_art(props)
                    art_cache[key] = art
                    if len(art_cache) > ART_CACHE_LIMIT:
                        art_cache.pop(next(iter(art_cache)))

                payload = {
                    "title": props.title or "Unknown title",
                    "artist": props.artist or "Unknown artist",
                    "album": props.album_title or "",
                    "art": art, "position": position, "duration": duration,
                    "playing": playing,
                    "source": session.source_app_user_model_id or "Media session",
                    "sampled_at": time.time(),
                }
                print(json.dumps(payload, ensure_ascii=False), flush=True)
            else:
                current = None
                print(json.dumps({
                    "title": "", "artist": "", "playing": False, "position": 0,
                    "duration": 0, "source": "", "sampled_at": time.time(),
                }), flush=True)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}), flush=True)
        await asyncio.sleep(POLL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
