# NEW 산수천재 (포켓산수 PWA)

**바로 실행하기 (PWA):** https://devsunni.github.io/pokectsansu/

1980년대 후반 한국로보콤(ROBOCOM)에서 출시한 레트로 휴대용 전자게임기 **‘NEW 산수천재(노란색 본체 버전)’**를 재현한 오프라인 웹앱(PWA)입니다.

## 주요 기능
- **레트로 하드웨어 & 흑백 세그먼트 LCD**: 일체형 손잡이가 달린 노란색 본체, 삐에로 일러스트, 서커스 무대 배경, LCD 잔상(Ghosting) 효과, 7-세그먼트 숫자 표시
- **삐에로 공받기 게임**: 원버튼(`공받기` / `Space`) 타이밍 게임, 10점 이상 2구 동시 낙하, 10점 단위 가속(100점 부근 극한 속도), 최고 점수 `localStorage` 저장
- **산수 퀴즈 모드**: 덧셈(`+`), 뺄셈(`-`), 구구단(`×`), 자릿수 자동 판정 및 `=` 제출
- **계산기 모드**: 원작 고증 `+`, `-`, `=` 덧셈·뺄셈 계산기
- **듀얼 사운드 엔진**: Web Audio API 기반 **레트로(80년대 사각파 피에조 부저)** ↔ **모던(부드러운 하이파이 차임)** 실시간 전환(`T`) 및 음소거(`M`)

## 폰에 설치 방법
1. 위 주소(https://devsunni.github.io/pokectsansu/)로 접속
2. **Android Chrome / 삼성 인터넷**: 브라우저 메뉴(⋮) → **홈 화면에 추가 / 앱 설치**
3. **iPhone Safari**: 공유 버튼 → **홈 화면에 추가**
4. **PC Chrome / Edge**: 주소창 오른쪽 설치 아이콘 클릭

## 구성
- `index.html`: 레트로 하드웨어 UI, SVG 세그먼트 LCD, 버튼·키보드 연결
- `engine.js`: 전원/부팅, 공받기 게임, 산수 퀴즈, 계산기 상태 머신
- `sound.js`: Web Audio API 레트로/모던 사운드 합성 엔진
- `manifest.json`: PWA 매니페스트
- `sw.js`: 서비스 워커 (오프라인 캐시)
- `icons/`: 앱 아이콘 (`icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`)
- `tests/`: Node.js 유닛 테스트 및 PWA E2E 검증 (`node --test tests/*.test.js`)
