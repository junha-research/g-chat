"""
HWP 5.0 파일에서 텍스트와 표를 추출하는 파서.
- 외부 라이브러리(olefile, pyhwp) 없이 Python 표준 라이브러리만으로 동작
- 표는 마크다운 형식으로 변환하여 행/열 구조를 보존 (RAG 품질 향상 핵심)

사용법:
    from parser.hwp_parser import extract_hwp_text
    text = extract_hwp_text("data/raw/2-1-1s.hwp")
"""
import struct
import zlib


class _MiniOLE:
    """olefile 없이 OLE 복합 파일에서 스트림을 읽는 최소 구현."""

    def __init__(self, path):
        with open(path, 'rb') as f:
            self.data = f.read()
        self._parse_header()
        self._read_fat()
        self._read_directory()

    def _parse_header(self):
        d = self.data
        if d[:8] != bytes.fromhex('d0cf11e0a1b11ae1'):
            raise ValueError("올바른 HWP(OLE) 파일이 아닙니다.")
        self.sector_size = 1 << struct.unpack('<H', d[30:32])[0]
        self.mini_sector_size = 1 << struct.unpack('<H', d[32:34])[0]
        self.dir_start = struct.unpack('<I', d[48:52])[0]
        self.mini_cutoff = struct.unpack('<I', d[56:60])[0]
        self.minifat_start = struct.unpack('<I', d[60:64])[0]
        self.difat_start = struct.unpack('<I', d[68:72])[0]
        self.num_difat = struct.unpack('<I', d[72:76])[0]
        self.difat = list(struct.unpack('<109I', d[76:76 + 436]))

    def _read_sector(self, sid):
        off = 512 + sid * self.sector_size
        return self.data[off:off + self.sector_size]

    def _read_fat(self):
        difat = self.difat[:]
        nxt = self.difat_start
        for _ in range(self.num_difat):
            if nxt in (0xFFFFFFFE, 0xFFFFFFFF):
                break
            sec = self._read_sector(nxt)
            vals = struct.unpack('<%dI' % (self.sector_size // 4), sec)
            difat.extend(vals[:-1])
            nxt = vals[-1]
        self.fat = []
        for fsid in difat:
            if fsid in (0xFFFFFFFF, 0xFFFFFFFE):
                continue
            sec = self._read_sector(fsid)
            self.fat.extend(struct.unpack('<%dI' % (self.sector_size // 4), sec))

    def _chain(self, start):
        out = []
        sid = start
        while sid not in (0xFFFFFFFE, 0xFFFFFFFF) and sid < len(self.fat):
            out.append(sid)
            sid = self.fat[sid]
        return out

    def _read_stream_big(self, start, size):
        data = b''.join(self._read_sector(s) for s in self._chain(start))
        return data[:size]

    def _read_directory(self):
        dir_data = b''.join(self._read_sector(s) for s in self._chain(self.dir_start))
        self.entries = []
        for i in range(0, len(dir_data), 128):
            e = dir_data[i:i + 128]
            if len(e) < 128:
                break
            name_len = struct.unpack('<H', e[64:66])[0]
            if name_len == 0:
                continue
            name = e[:name_len - 2].decode('utf-16-le', errors='ignore')
            etype = e[66]
            start = struct.unpack('<I', e[116:120])[0]
            size = struct.unpack('<I', e[120:124])[0]
            self.entries.append({'name': name, 'type': etype, 'start': start, 'size': size})
        root = next((x for x in self.entries if x['type'] == 5), None)
        self.mini_container = self._read_stream_big(root['start'], root['size']) if root else b''
        self.minifat = []
        if self.minifat_start not in (0xFFFFFFFE, 0xFFFFFFFF):
            mf = b''.join(self._read_sector(s) for s in self._chain(self.minifat_start))
            self.minifat = list(struct.unpack('<%dI' % (len(mf) // 4), mf))

    def _mini_chain(self, start):
        out = []
        sid = start
        while sid not in (0xFFFFFFFE, 0xFFFFFFFF) and sid < len(self.minifat):
            out.append(sid)
            sid = self.minifat[sid]
        return out

    def read_stream(self, name):
        e = next((x for x in self.entries if x['name'] == name and x['type'] == 2), None)
        if not e:
            return None
        if e['size'] >= self.mini_cutoff:
            return self._read_stream_big(e['start'], e['size'])
        parts = []
        for m in self._mini_chain(e['start']):
            off = m * self.mini_sector_size
            parts.append(self.mini_container[off:off + self.mini_sector_size])
        return b''.join(parts)[:e['size']]


# HWP 레코드 태그 상수
_CTRL_HEADER = 71
_LIST_HEADER = 72
_PARA_TEXT = 67
_TABLE = 76
_PARA_HEADER = 66
# 인라인 제어문자 (뒤에 14바이트 추가 데이터를 가짐)
_INLINE_CTRL = {1, 2, 3, 4, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}


def _parse_records(data):
    pos = 0
    recs = []
    while pos + 4 <= len(data):
        header = struct.unpack('<I', data[pos:pos + 4])[0]
        tag = header & 0x3FF
        level = (header >> 10) & 0x3FF
        size = (header >> 20) & 0xFFF
        pos += 4
        if size == 0xFFF:
            size = struct.unpack('<I', data[pos:pos + 4])[0]
            pos += 4
        recs.append((tag, level, data[pos:pos + size]))
        pos += size
    return recs


def _parse_para_text(payload):
    out = []
    i = 0
    while i + 1 < len(payload):
        code = struct.unpack('<H', payload[i:i + 2])[0]
        if code in _INLINE_CTRL:
            i += 16
        elif code < 32:
            if code in (10, 13):
                out.append('\n')
            elif code == 9:
                out.append('\t')
            i += 2
        else:
            out.append(chr(code))
            i += 2
    return ''.join(out)


def _ctrl_id(payload):
    return payload[:4][::-1].decode('ascii', errors='ignore') if len(payload) >= 4 else None


def _cell_addr(payload):
    try:
        col = struct.unpack('<H', payload[8:10])[0]
        row = struct.unpack('<H', payload[10:12])[0]
        return (col, row)
    except struct.error:
        return None


def _table_to_markdown(cells):
    if not cells:
        return ""
    max_c = max((c['addr'][0] for c in cells if c['addr']), default=0)
    max_r = max((c['addr'][1] for c in cells if c['addr']), default=0)
    grid = [['' for _ in range(max_c + 1)] for _ in range(max_r + 1)]
    for c in cells:
        if c['addr']:
            col, row = c['addr']
            grid[row][col] = c['text'].strip().replace('\n', ' ')
    lines = []
    for ri, row in enumerate(grid):
        lines.append('| ' + ' | '.join(row) + ' |')
        if ri == 0:
            lines.append('| ' + ' | '.join(['---'] * len(row)) + ' |')
    return '\n'.join(lines)


def extract_hwp_text(path):
    """HWP 파일에서 본문 텍스트를 추출한다. 표는 마크다운으로 변환된다."""
    ole = _MiniOLE(path)
    fh = ole.read_stream('FileHeader')
    compressed = bool(struct.unpack('<I', fh[36:40])[0] & 1)

    # 본문이 여러 섹션(Section0, Section1...)일 수 있으므로 순회
    output = []
    section_idx = 0
    while True:
        raw = ole.read_stream(f'Section{section_idx}')
        if raw is None:
            break
        if compressed:
            raw = zlib.decompress(raw, -15)
        output.append(_extract_section(raw))
        section_idx += 1

    return '\n'.join(output)


def _extract_section(sec):
    records = _parse_records(sec)
    output = []
    i = 0
    n = len(records)
    while i < n:
        tag, level, payload = records[i]
        if tag == _CTRL_HEADER and _ctrl_id(payload) == 'tbl ':
            # 표가 위치한 레벨. 표 내부 셀 문단은 이보다 깊은 레벨을 가진다.
            # 같은/얕은 레벨의 문단(PARA_HEADER)이 나오면 표 밖 본문이 시작된 것.
            table_level = level
            cells = []
            pending = None
            j = i + 1
            while j < n:
                t2, l2, p2 = records[j]
                if t2 == _CTRL_HEADER and _ctrl_id(p2) == 'tbl ':
                    break
                if t2 == _PARA_HEADER and l2 <= table_level:
                    break  # 표 밖 본문 문단 시작 -> 표 종료
                if t2 == _LIST_HEADER:
                    pending = {'addr': _cell_addr(p2), 'text': ''}
                    cells.append(pending)
                elif t2 == _PARA_TEXT and pending is not None:
                    pending['text'] += _parse_para_text(p2)
                j += 1
            output.append('\n' + _table_to_markdown(cells) + '\n')
            i = j
        else:
            if tag == _PARA_TEXT:
                output.append(_parse_para_text(payload))
            i += 1
    return ''.join(output)

# 테스트
# if __name__ == '__main__':
#     import sys
#     text = extract_hwp_text(sys.argv[1])
#     print(text)