#!/usr/bin/env python3
"""Health Balance Race v19 — authoritative classroom server, Python standard library.
Only QR generation uses the optional `qrcode` package. No student data is persisted.
"""
from __future__ import annotations

import io
import json
import mimetypes
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

ROOT = Path(__file__).parent
PUBLIC = ROOT / 'public'
PORT = int(os.getenv('PORT', '10000'))
MAX_PLAYERS = 7
DISTANCE = 16800.0
START_DELAY = 3.5
BASE_SPEED = 112.0
ROW_GAP = 560
PENALTY_TIME = 2.2
COLORS = ('#328bb8', '#db965b', '#816cc7', '#49a68a')
PERMUTATIONS = ((1,0,2), (0,2,1), (2,1,0), (1,2,0), (2,0,1), (0,1,2))
# Pedagogical values, NOT calorie values.
ITEMS = (
    (("규칙적", "식사", "🍽️", 19, "🕒"), ("골고루", "먹기", "🥗", 18, "🥕"),
     ("건강한", "간식", "🍎", 13, "🥛"), ("아침", "식사", "🍳", 17, "🌅"),
     ("점심", "식사", "🍱", 19, "☀️"), ("저녁", "식사", "🍲", 19, "🌙")),
    (("걷기", "", "🚶", -19, "👟"), ("자전거", "타기", "🚴", -21, "💨"),
     ("계단", "이용", "STAIRS", -17, "👟"), ("산책", "", "🚶", -16, "🌳"),
     ("수영", "", "🏊", -23, "💦"), ("축구", "", "⚽", -22, "🥅")),
    (("야식", "먹기", "🍜", 27, "🌙"), ("끼니", "거르기", "🍽️", -39, "🚫"),
     ("반복적", "과식", "🍽️", 39, "➕")),
)


def permutation(seed, index):
    # Reproducible, independent per-player layouts; same category set each row.
    x = (((seed + 1) * 0x9e3779b1) ^ ((index + 17) * 0x85ebca6b)) & 0xffffffff
    x = ((x ^ (x >> 16)) * 0xc2b2ae35) & 0xffffffff
    x ^= x >> 16
    return PERMUTATIONS[x % 6]


def make_rows(seed):
    out = []
    for i, at in enumerate(range(670, int(DISTANCE) - 470, ROW_GAP)):
        pack = [ITEMS[k][(i + (1 if k == 1 else 2 if k == 2 else 0)) % len(ITEMS[k])] for k in range(3)]
        out.append({'at': at, 'items': [{'kind': k, 'item': pack[k]} for k in permutation(seed, i)]})
    return out


@dataclass
class Racer:
    ident: str
    token: str
    name: str
    color: str
    seed: int
    joined: int
    lane: int = 1
    side: float = 1
    distance: float = 0
    speed: float = 0
    energy: int = 12
    penalty: float = 0
    finish: float | None = None
    row_index: int = 0
    last_item: dict | None = None
    last_seen: float = field(default_factory=time.monotonic)
    rows: list = field(default_factory=list)

    def reset(self):
        self.lane = 1
        self.side = 1
        self.distance = 0
        self.speed = 0
        self.energy = 12
        self.penalty = 0
        self.finish = None
        self.row_index = 0
        self.last_item = None

    def view(self):
        return {'id': self.ident, 'name': self.name, 'color': self.color, 'distance': round(self.distance, 3),
                'speed': round(self.speed, 3), 'side': round(self.side, 4), 'lane': self.lane,
                'finished': self.finish is not None}


class Room:
    def __init__(self, code=None):
        self.code = code or ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
        self.host_key = secrets.token_urlsafe(32)
        self.players: dict[str, Racer] = {}
        self.phase = 'lobby'
        self.race_start = 0.0  # monotonic timestamp; fixed for the whole race
        self.elapsed = 0.0
        self.all_finished_at: float | None = None
        self.last_tick = time.monotonic()
        self.created = time.monotonic()
        self.updated = self.created
        self.round_index = 1
        self.lock = threading.RLock()

    def require_teacher(self, key):
        if not isinstance(key, str) or not secrets.compare_digest(key, self.host_key):
            raise PermissionError('교사용 인증 정보가 올바르지 않아요.')

    def require_student(self, token):
        if not isinstance(token, str):
            raise PermissionError('학생 인증 정보가 필요해요.')
        for racer in self.players.values():
            if secrets.compare_digest(racer.token, token):
                racer.last_seen = time.monotonic()
                return racer
        raise PermissionError('참가 정보가 만료되었어요. 선생님께 확인해 주세요.')

    def join(self, name, color):
        if self.phase != 'lobby':
            raise ValueError('이미 게임이 시작되었어요. 선생님이 다음 경기를 준비할 때 참여할 수 있어요.')
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError('참가자가 7명 모두 찼어요.')
        name = str(name).strip()
        if not name or len(name) > 10 or any(ord(ch) < 32 for ch in name):
            raise ValueError('닉네임은 1~10글자로 입력해 주세요.')
        if any(r.name.casefold() == name.casefold() for r in self.players.values()):
            raise ValueError('이미 사용 중인 닉네임이에요. 다른 이름을 선택해 주세요.')
        color = color if color in COLORS else COLORS[len(self.players) % len(COLORS)]
        ident = secrets.token_hex(8)
        seed = int.from_bytes(secrets.token_bytes(4), 'big')
        r = Racer(ident, secrets.token_urlsafe(24), name, color, seed, len(self.players), rows=make_rows(seed))
        self.players[ident] = r
        self.updated = time.monotonic()
        return r

    def ranking(self):
        return sorted(self.players.values(), key=lambda r: (r.finish is None, r.finish if r.finish is not None else -r.distance, r.joined))

    def start(self, now=None):
        if self.phase != 'lobby':
            raise ValueError('대기 중인 게임만 시작할 수 있어요.')
        if not self.players:
            raise ValueError('학생이 최소 1명 입장해야 시작할 수 있어요.')
        now = now or time.monotonic()
        self.phase = 'countdown'
        self.race_start = now + START_DELAY
        self.elapsed = 0.0
        self.all_finished_at = None
        self.updated = now

    def reset(self):
        self.phase = 'lobby'
        self.elapsed = 0.0
        self.race_start = 0.0
        self.all_finished_at = None
        self.round_index += 1
        for r in self.players.values():
            r.rows = make_rows(int.from_bytes(secrets.token_bytes(4), 'big'))
            r.reset()
        self.updated = time.monotonic()

    def pace(self, r):
        stage = min(2, int(r.distance // (DISTANCE / 3)))
        base = BASE_SPEED * (1.5, 2.0, 3.0)[stage]
        normal = 1.0 if abs(r.energy) <= 23 else 0.7
        factor = (0.5 + (normal - 0.5) * (1 - r.penalty / PENALTY_TIME)) if r.penalty > 0 else normal
        return base * factor

    def _advance_racer(self, r, dt, elapsed_before):
        if r.finish is not None:
            return
        r.penalty = max(0, r.penalty - dt)
        goal = self.pace(r)
        r.speed += (goal - r.speed) * min(1, dt * 7)
        before = r.distance
        next_distance = before + r.speed * dt
        r.distance = min(DISTANCE, next_distance)
        r.side += (r.lane - r.side) * min(1, dt * 9)
        if abs(r.lane - r.side) < .003:
            r.side = float(r.lane)
        # Impact is determined by the same distance used to draw the cards.
        while r.row_index < len(r.rows) and before < r.rows[r.row_index]['at'] <= r.distance:
            row = r.rows[r.row_index]
            choice = row['items'][r.lane]
            data, kind = choice['item'], choice['kind']
            r.energy = max(-75, min(75, r.energy + data[3]))
            if kind == 2:
                r.penalty = PENALTY_TIME
                r.speed = min(r.speed, BASE_SPEED * (1.5, 2.0, 3.0)[min(2, int(r.distance // (DISTANCE / 3)))] * 0.5)
            r.last_item = {'index': r.row_index, 'name': data[0] + (' ' + data[1] if data[1] else ''),
                           'kind': kind, 'delta': data[3], 'at': self.elapsed}
            r.row_index += 1
        if r.distance >= DISTANCE:
            fraction = max(0., min(1., (DISTANCE - before) / (next_distance - before))) if next_distance > before else 1
            r.finish = elapsed_before + fraction * dt
            r.speed = 0

    def tick(self, now=None):
        with self.lock:
            now = time.monotonic() if now is None else now
            dt = max(0.0, min(0.07, now - self.last_tick))
            self.last_tick = now
            if self.phase == 'countdown' and now >= self.race_start:
                self.phase = 'running'
                self.last_tick = now
                self.elapsed = max(0, now - self.race_start)
                dt = 0.0
            elif self.phase == 'running':
                elapsed_before = self.elapsed
                self.elapsed += dt
                for r in self.players.values():
                    self._advance_racer(r, dt, elapsed_before)
                if self.players and all(r.finish is not None for r in self.players.values()):
                    self.phase = 'finished'
                    self.all_finished_at = now
                    self.updated = now

    def state(self, teacher=False, player=None):
        with self.lock:
            now = time.monotonic()
            if teacher:
                live_ranking = self.ranking()
                participants = [{**r.view(), 'rank': i + 1, 'time': fmt(r.finish) if r.finish is not None else None}
                                for i, r in enumerate(live_ranking)]
            elif self.phase == 'revealed':
                participants = [{**r.view(), 'rank': i + 1, 'time': fmt(r.finish) if r.finish is not None else None}
                                for i, r in enumerate(self.ranking())]
            elif self.phase in ('running', 'countdown'):
                participants = [{**r.view(), 'rank': i + 1}
                                for i, r in enumerate(self.ranking())]
            elif self.phase == 'finished':
                # Do not leak final ranking before the teacher presses reveal.
                participants = [{**r.view(), 'distance': None, 'speed': 0, 'rank': None}
                                for r in sorted(self.players.values(), key=lambda x: x.joined)]
            else:
                participants = [{**r.view(), 'rank': None} for r in sorted(self.players.values(), key=lambda x: x.joined)]
            result = {'ok': True, 'room': self.code, 'phase': self.phase, 'count': len(self.players),
                      'capacity': MAX_PLAYERS, 'round': self.round_index,
                      'countdown_ms': max(0, int((self.race_start - now) * 1000)) if self.phase == 'countdown' else 0,
                      'elapsed': round(self.elapsed, 3), 'players': participants}
            if player:
                result['me'] = {**player.view(), 'energy': player.energy, 'penalty': round(player.penalty, 3),
                                'last_item': player.last_item, 'rank': next((r['rank'] for r in participants if r['id'] == player.ident), None)}
                if self.phase in ('running', 'countdown'):
                    result['rows'] = [row for row in player.rows if player.distance - 100 <= row['at'] <= player.distance + 900]
                else:
                    result['rows'] = []
            return result


def fmt(t):
    if t is None:
        return ''
    ms = max(0, round(t * 1000))
    return f'{ms // 60000}:{(ms // 1000) % 60:02}.{ms % 1000:03}'


ROOMS = {}
LOCK = threading.RLock()


def get_room(code):
    code = str(code or '').upper().strip()
    with LOCK:
        room = ROOMS.get(code)
    if not room:
        raise ValueError('존재하지 않거나 만료된 게임방이에요. 선생님께 QR코드를 다시 요청해 주세요.')
    return room


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


class Handler(BaseHTTPRequestHandler):
    server_version = 'BalanceRace/19'

    def log_message(self, fmt, *args):
        # Never log request bodies (tokens, names, or teacher secrets).
        pass

    def send_data(self, data, code=200, typ='application/json; charset=utf-8', cache='no-store'):
        self.send_response(code)
        self.send_header('Content-Type', typ)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path in ('/', '/teacher'):
                target = PUBLIC / 'teacher.html'
            elif path == '/play':
                target = PUBLIC / 'play.html'
            elif path == '/health':
                self.send_data(b'{"ok":true,"service":"balance-race-v19"}')
                return
            elif path == '/api/qr':
                room = get_room(parse_qs(urlsplit(self.path).query).get('room', [''])[0])
                import qrcode
                host = self.headers.get('Host', f'localhost:{PORT}')
                scheme = self.headers.get('X-Forwarded-Proto', 'http').split(',')[0]
                base = os.getenv('APP_BASE_URL', '').rstrip('/') or f'{scheme}://{host}'
                url = f'{base}/play?room={quote(room.code)}'
                q = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=3)
                q.add_data(url); q.make(fit=True)
                buf = io.BytesIO(); q.make_image(fill_color='#163f45', back_color='#ffffff').save(buf, format='PNG')
                self.send_data(buf.getvalue(), typ='image/png')
                return
            elif path.startswith('/public/'):
                name = path[len('/public/'):]
                if not name or '/' in name or '\\' in name or name.startswith('.'):
                    raise ValueError('잘못된 파일 경로예요.')
                target = PUBLIC / name
            else:
                self.send_data(b'Not Found', 404, 'text/plain; charset=utf-8')
                return
            if not target.is_file():
                self.send_data(b'Not Found', 404, 'text/plain; charset=utf-8'); return
            typ = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
            if typ.startswith('text/') or typ in ('application/javascript', 'application/json'):
                typ += '; charset=utf-8'
            self.send_data(target.read_bytes(), typ=typ, cache='public, max-age=180' if path.startswith('/public/') else 'no-store')
        except Exception as e:
            self.send_data(json_bytes({'error': str(e)}), 400)

    def do_POST(self):
        path = urlsplit(self.path).path
        length = int(self.headers.get('Content-Length', '0') or '0')
        if length > 8192:
            self.send_data(json_bytes({'error': '요청이 너무 커요.'}), 413); return
        try:
            payload = json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(payload, dict):
                raise ValueError('요청 형식을 확인해 주세요.')
            if path == '/api/create':
                with LOCK:
                    if len(ROOMS) >= 100:
                        raise ValueError('현재 생성할 수 있는 게임방이 모두 찼어요.')
                    while True:
                        room = Room()
                        if room.code not in ROOMS: break
                    ROOMS[room.code] = room
                result = {'ok': True, 'room': room.code, 'host_token': room.host_key}
            else:
                room = get_room(payload.get('room'))
                with room.lock:
                    if path == '/api/join':
                        r = room.join(payload.get('name',''), payload.get('color',''))
                        result = {'ok': True, 'room': room.code, 'token': r.token, 'id': r.ident}
                    elif path == '/api/student/state':
                        racer = room.require_student(payload.get('token'))
                        result = room.state(player=racer)
                    elif path == '/api/student/move':
                        r = room.require_student(payload.get('token'))
                        lane = payload.get('lane')
                        if type(lane) is not int or lane not in (0,1,2):
                            raise ValueError('차선을 선택할 수 없어요.')
                        if room.phase == 'running' and r.finish is None:
                            r.lane = lane
                        result = {'ok': True, 'lane': r.lane}
                    elif path == '/api/teacher/state':
                        room.require_teacher(payload.get('host_token'))
                        result = room.state(teacher=True)
                    elif path == '/api/teacher/action':
                        room.require_teacher(payload.get('host_token'))
                        action = payload.get('action')
                        if action == 'start': room.start()
                        elif action == 'reveal':
                            if room.phase != 'finished':
                                raise ValueError('모든 선수가 결승선을 통과한 다음 결과를 공개할 수 있어요.')
                            room.phase = 'revealed'
                        elif action == 'reset': room.reset()
                        elif action == 'kick':
                            if room.phase != 'lobby':
                                raise ValueError('대기 중인 선수만 퇴장시킬 수 있어요.')
                            pid = str(payload.get('id', ''))
                            if pid not in room.players: raise ValueError('선수를 찾을 수 없어요.')
                            del room.players[pid]
                        else: raise ValueError('알 수 없는 명령이에요.')
                        result = room.state(teacher=True)
                    else:
                        self.send_data(json_bytes({'error': '없는 API예요.'}), 404);return
            self.send_data(json_bytes(result))
        except PermissionError as e:
            self.send_data(json_bytes({'error': str(e)}), 403)
        except (ValueError, TypeError, KeyError) as e:
            self.send_data(json_bytes({'error': str(e)}), 400)
        except Exception:
            self.send_data(json_bytes({'error': '서버 처리 중 오류가 발생했어요.'}), 500)


def ticker():
    while True:
        time.sleep(0.04)
        with LOCK:
            rooms = list(ROOMS.values())
        for room in rooms:
            room.tick()
        with LOCK:
            now = time.monotonic()
            # Idle rooms are temporary; never retain student names across days.
            for room in rooms:
                if now - room.updated > 4*3600:
                    ROOMS.pop(room.code, None)


if __name__ == '__main__':
    threading.Thread(target=ticker, daemon=True).start()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    print(f'Balance Race v19: listening on 0.0.0.0:{PORT}', flush=True)
    server.serve_forever()
