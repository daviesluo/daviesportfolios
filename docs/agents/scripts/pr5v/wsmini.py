"""A minimal websocket client (text frames only) through the environment's HTTPS proxy (CONNECT), standard library only."""
import base64, os, socket, ssl, struct, urllib.parse

CA = "/root/.ccr/ca-bundle.crt"


def _proxy():
    p = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    return urllib.parse.urlparse(p) if p else None


class WS:
    def __init__(self, host, path="/", timeout=20):
        px = _proxy()
        if px:
            s = socket.create_connection((px.hostname, px.port or 80), timeout=timeout)
            req = f"CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\n"
            if px.username:
                cred = base64.b64encode(f"{urllib.parse.unquote(px.username)}:{urllib.parse.unquote(px.password or '')}".encode()).decode()
                req += f"Proxy-Authorization: Basic {cred}\r\n"
            s.sendall((req + "\r\n").encode())
            resp = b""
            while b"\r\n\r\n" not in resp:
                chunk = s.recv(4096)
                if not chunk:
                    break
                resp += chunk
            status = resp.split(b"\r\n", 1)[0].decode(errors="replace")
            if " 200" not in status:
                raise OSError("proxy CONNECT refused: " + status)
        else:
            s = socket.create_connection((host, 443), timeout=timeout)
        ctx = ssl.create_default_context(cafile=CA if os.path.exists(CA) else None)
        self.s = ctx.wrap_socket(s, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                        "User-Agent: Mozilla/5.0 daviesportfolios-research/1.0\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.s.recv(4096)
            if not chunk:
                raise OSError("closed during handshake")
            resp += chunk
        head, self.buf = resp.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        if " 101" not in status:
            raise OSError("handshake refused: " + status)

    def send(self, text):
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        hdr = bytes([0x81])
        if n < 126:
            hdr += bytes([0x80 | n])
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _need(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise OSError("closed")
            self.buf += chunk

    def recv(self):
        """The next complete text message (pings answered, fragments joined)."""
        msg = b""
        while True:
            self._need(2)
            b0, b1 = self.buf[0], self.buf[1]
            op, n, i = b0 & 0x0F, b1 & 0x7F, 2
            if n == 126:
                self._need(4); n = struct.unpack(">H", self.buf[2:4])[0]; i = 4
            elif n == 127:
                self._need(10); n = struct.unpack(">Q", self.buf[2:10])[0]; i = 10
            self._need(i + n)
            payload, self.buf = self.buf[i:i + n], self.buf[i + n:]
            if op == 0x9:  # ping -> pong
                mask = os.urandom(4)
                self.s.sendall(bytes([0x8A, 0x80 | len(payload)]) + mask + bytes(b ^ mask[k % 4] for k, b in enumerate(payload)))
                continue
            if op == 0x8:
                raise OSError("server closed")
            if op in (0x1, 0x0, 0x2):
                msg += payload
                if b0 & 0x80:
                    return msg.decode(errors="replace")

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass
