"""
파싱된 학칙 텍스트를 벡터DB 임베딩에 적합하도록 정제한다.

처리 내용:
  1. 자간 띄어쓰기 복원  ("한 림 대 학 교" → "한림대학교")
  2. 문서 앞 개정일 나열 제거  ("제정 1982... 개정 1983..." 덩어리)
  3. 부칙 전체 제거  (본문만 남김)
  4. 빈 셀만 있는 표 제거
  5. 연속 공백/빈 줄 정리

사용법:
    from preprocessor.preprocess import clean_text
    cleaned = clean_text(raw_text)
"""
import re


def _fix_spacing(t):
    """낱글자 자간 벌림 복원. 단, '및·또·내지' 등 연결어는 보호한다."""
    def collapse(m):
        s = m.group(0)
        # 연결어가 포함되면 정상 문장이므로 건드리지 않음
        if any(conn in s for conn in [' 및 ', ' 또 ', ' 내 지 ', ' 및', '및 ']):
            return s
        return s.replace(' ', '')
    # 한글 낱글자가 공백으로 4회 이상 이어지는 구간만 (제목·조문 스타일)
    pattern = re.compile(r'([가-힣] ){3,}[가-힣]')
    return pattern.sub(collapse, t)


def _remove_revision_dates(t):
    """문서 맨 앞의 '제정/개정 날짜' 나열 덩어리를 제거한다."""
    m = re.search(r'제정\s*\d{4}', t)
    if not m:
        return t
    start = m.start()
    # 개정일 나열이 끝나는 지점 = 첫 '제 1 장' 또는 '제 1 조'
    m2 = re.search(r'제\s*1\s*[장조]', t[start:])
    if not m2:
        return t
    end = start + m2.start()
    return t[:start] + t[end:]


def _remove_appendix(t):
    """부칙(개정 이력)만 제거한다. 부칙 뒤에 오는 별표(정원표·학위표 등)는 보존한다.

    학칙 구조는 보통  [본문] → [부칙: 개정 이력] → [별표: 정원표 등]  순서다.
    따라서 부칙 시작 지점부터, 그 뒤 첫 별표 지점 전까지만 잘라낸다.
    부칙 뒤에 별표가 없으면 부칙부터 문서 끝까지 제거한다.
    """
    m = re.search(r'부\s{2,}칙', t)
    if not m:
        m = re.search(r'\n부\s*칙\n', t)
    if not m:
        return t

    appendix_start = m.start()
    after = t[appendix_start:]

    # 부칙 이후 첫 별표/별지 위치 = 부칙 끝
    m_appendix_end = re.search(r'\(?\s*별\s*표\s*\d|\[별표|별\s*지\s*서식', after)
    if m_appendix_end:
        byeolpyo_start = appendix_start + m_appendix_end.start()
        # 본문 + 별표 구간만 남기고, 그 사이 부칙만 삭제
        return t[:appendix_start].rstrip() + '\n\n' + t[byeolpyo_start:]
    else:
        # 부칙 뒤에 별표가 없으면 부칙부터 끝까지 제거
        return t[:appendix_start].rstrip() + '\n'


def _remove_empty_table_rows(t):
    """빈 셀만 있는 표 행( |  |  |  | )을 제거한다."""
    lines = t.split('\n')
    out = []
    for line in lines:
        stripped = line.strip()
        # '|'와 공백만으로 이루어진 줄은 빈 표 행
        if stripped.startswith('|') and re.fullmatch(r'[|\s]+', stripped):
            continue
        out.append(line)
    return '\n'.join(out)


def _normalize_whitespace(t):
    """연속 공백과 과도한 빈 줄을 정리한다."""
    # 2칸 이상 연속 공백 → 1칸
    t = re.sub(r'[ \t]{2,}', ' ', t)
    # 3줄 이상 연속 빈 줄 → 2줄
    t = re.sub(r'\n{3,}', '\n\n', t)
    # 각 줄 끝 공백 제거
    t = '\n'.join(line.rstrip() for line in t.split('\n'))
    return t.strip()


def clean_text(raw):
    """전체 전처리 파이프라인을 순서대로 적용한다."""
    t = raw
    t = _fix_spacing(t)
    t = _remove_revision_dates(t)
    t = _remove_appendix(t)
    t = _remove_empty_table_rows(t)
    t = _normalize_whitespace(t)
    return t

# 테스트
# if __name__ == '__main__':
#     import sys
#     raw = open(sys.argv[1], encoding='utf-8').read()
#     print(clean_text(raw))