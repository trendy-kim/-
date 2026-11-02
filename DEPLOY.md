# 배포 가이드 (리스크 최소안)

## 원칙
1. 사내망 전용으로 연다 (인터넷 공개 금지).
2. 인터넷에 올려야 한다면 반드시 로그인(Cloudflare Access 등)을 앞에 둔다.
3. 카드 원본 데이터는 서버에 올리지 않는다. 이 앱은 브라우저 안에서만 처리한다.

## 올릴 파일 (이 4개만)
index.html, app.js, style.css, _headers
(server.ps1, start.bat, DEPLOY.md 는 올리지 않는다. 개인 PC 테스트용)

## 안 1. 사내 웹서버 (권장)
- IIS: 폴더를 `C:\inetpub\wwwroot\card-home` 로 복사 → 사이트 추가 → HTTPS 바인딩.
  `_headers` 는 IIS에서 동작하지 않으므로 [HTTP 응답 헤더]에 아래를 직접 추가:
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Cache-Control: no-store`
- nginx: 폴더를 root 로 지정하고 위 헤더를 `add_header` 로 추가.
- 접속 대상 PC는 인터넷으로 `dapi.kakao.com`, `*.daumcdn.net`, `cdnjs.cloudflare.com` 에 나갈 수 있어야 한다.

## 안 2. Cloudflare Pages + Access (외부 호스팅이 필요할 때)
1. Workers & Pages > Create > Pages > Upload assets 로 위 4개 파일 업로드 (`_headers` 자동 적용).
2. Zero Trust > Access > Applications > Self-hosted 에 `xxx.pages.dev` 등록.
3. 정책: Include > Emails ending in `@회사도메인` (또는 허용할 이메일 목록).
4. `*.pages.dev` 의 미리보기 주소(브랜치별 주소)도 같은 Access 앱에 포함시킨다.

## 카카오 설정 (공통)
- 카카오 개발자센터 > 앱 설정 > 플랫폼 > Web 에 **실제 접속 주소**(https:// 포함, 포트 있으면 포함) 등록.
- 제품 설정 > 카카오맵 > 사용 설정 ON.
- JavaScript 키는 공개돼도 되는 키지만, 도메인 제한이 보호 수단이므로 불필요한 도메인은 등록하지 않는다.
- 접속자별로 설정 탭에 키를 입력한다 (각자 브라우저에 저장).

## 운영 체크리스트
- [ ] 개인정보(집주소·카드 사용내역) 처리에 대해 감사/인사/정보보호 담당 승인
- [ ] 접속 가능자 명단 확정 (Access 정책 또는 사내 AD 그룹)
- [ ] 샘플 데이터·샘플 집주소 삭제 확인 (설정 > 모든 저장값 초기화)
- [ ] 공용 PC에서는 사용 후 [모든 저장값 초기화]
- [ ] 분기 1회 접속자 목록 점검

## 이 앱이 하는 보호 조치
- 카드 거래 원본은 sessionStorage에만 저장 (탭 닫으면 삭제), 카드번호는 뒤 4자리만 보관
- CSP로 연결 대상을 자기 서버·카카오로 제한 (데이터 외부 전송 차단)
- noindex, no-referrer, no-store, iframe 삽입 금지

## 한계
- 접근 통제는 앱이 아니라 호스팅 쪽(사내망/Access)이 담당한다.
- 집주소·좌표는 각 PC의 localStorage에 남는다.
- CSP는 fetch/XHR 전송을 막지만 모든 경로를 막지는 못한다. 외부 스크립트는 SheetJS(cdnjs)만 사용한다.
