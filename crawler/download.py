import requests
import os
from config.settings import BASE_URL, RAW_DIR

def download_hwp(doc):
    url = BASE_URL + doc["path"]
    resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp.raise_for_status()

    os.makedirs(RAW_DIR, exist_ok=True)

    # 서버 파일명 대신 우리가 정한 code로 고정 -> 항상 같은 이름 = 확실한 덮어쓰기
    save_path = os.path.join(RAW_DIR, f"{doc['code']}.hwp")

    with open(save_path, 'wb') as f:
        f.write(resp.content)

    return save_path