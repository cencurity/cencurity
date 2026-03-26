# Cencurity Connector

이 VS Code 익스텐션은 마켓플레이스에 배포하는 단일 connector VSIX 입니다.

## 역할

- 공개 VSIX 안에는 경량 launcher 만 포함합니다.
- 실제 Cencurity core 는 private source repo 에서 빌드된 OS별 바이너리로 배포합니다.
- connector 는 release manifest 를 읽고 현재 OS/아키텍처에 맞는 바이너리를 내려받아 로컬에서 실행합니다.

## 실행 흐름

1. 사용자가 `Cencurity Connector: Open Security Center` 실행
2. connector 가 `cencurityConnector.manifestUrl` 에서 manifest 조회
3. 현재 플랫폼 예: `win32-x64`, `darwin-arm64`, `linux-x64` 에 맞는 artifact 선택
4. SHA-256 검증 후 VS Code global storage 에 바이너리 저장
5. 로컬에서 `serve --host --port` 로 core 실행
6. `/healthz` 확인 후 Simple Browser 또는 외부 브라우저로 연결

## 사용자 관점

- 사용자는 마켓플레이스에서 connector VSIX 하나만 설치합니다.
- 로그인이나 bootstrap API key 입력 없이 `Cencurity Connector: Open Security Center`만 실행하면 됩니다.
- 첫 실행 시 현재 OS에 맞는 core binary를 자동 다운로드하고, 이후에는 캐시된 binary를 재사용합니다.
- 개발 중에는 `manifestUrl`이 없어도 워크스페이스의 `vscode-extension/dist/releases/<target>/` 아래 local binary를 자동 감지해 실행할 수 있습니다.
- `manifestUrl`과 artifact URL이 공개되어 있다면 특정 고객이 아니라 누구나 설치해서 사용할 수 있습니다.

## 설정

- `cencurityConnector.manifestUrl` : release manifest URL
- `cencurityConnector.releaseChannel` : stable/canary 같은 채널 이름
- `cencurityConnector.binaryName` : manifest 에 파일명이 없을 때 사용할 기본 바이너리 이름
- `cencurityConnector.host` : 로컬 런타임 바인딩 호스트
- `cencurityConnector.port` : 로컬 런타임 포트
- `cencurityConnector.openInSimpleBrowser` : VS Code Simple Browser 우선 사용 여부

## 명령

- `Cencurity Connector: Install or Update Core`
- `Cencurity Connector: Open Security Center`
- `Cencurity Connector: Show Runtime Info`

## Manifest 예시

- 샘플 파일: [manifest.sample.json](manifest.sample.json)

필수 필드:

- `version`: connector가 설치된 core 버전을 표시할 때 사용
- `channel`: stable/canary 같은 채널 메타데이터
- `artifacts[platform-arch].url`: 사용자가 직접 접근 가능한 공개 다운로드 URL
- `artifacts[platform-arch].sha256`: 다운로드 후 무결성 검증 값
- `artifacts[platform-arch].fileName`: 로컬 저장 파일명

지원 예시 target:

- `win32-x64`
- `linux-x64`
- `darwin-x64`
- 필요하면 이후 `win32-arm64`, `linux-arm64`, `darwin-arm64` 확장 가능

## 운영자가 마지막으로 해야 할 일

1. private core repo에서 release workflow 실행
2. OS별 binary를 공개 다운로드 위치에 업로드
3. 공개 `manifest.json` 생성 및 배포
4. connector 설정 `cencurityConnector.manifestUrl`에 그 공개 URL 입력
5. connector VSIX를 Marketplace에 게시

## 주의

- 소스 코드는 private repo 에만 두고, 사용자는 바이너리만 받게 됩니다.
- 누구나 설치 가능하게 하려면 manifest 와 artifact URL 은 공개 접근이 가능해야 합니다.
- private GitHub Release asset URL 같은 인증 필요한 주소만 쓰면 공개 connector 사용성이 깨집니다.
- 공개 VSIX 안에는 private source 나 product runtime JS 를 넣지 않습니다.
