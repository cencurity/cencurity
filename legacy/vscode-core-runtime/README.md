# Cencurity VS Code Core Runtime

이 폴더는 현재 Cencurity VS Code 경험의 **private core runtime** 입니다.

실제 사용자 배포는 이 폴더 전체를 직접 VSIX로 내보내기보다, 공개용 `vscode-connector/` 가 이 runtime 을 로컬에서 실행하거나 release manifest 기반으로 내려받아 구동하는 구조를 기준으로 합니다.

## 현재 역할

- 로컬 Cencurity runtime 제공
- Security Center UI가 붙는 API 및 proxy entrypoint 제공
- `/healthz`, `/api/config`, `/api/audit-logs`, `/api/policies`, `/api/dry-run` 제공
- provider-compatible proxy route 제공:
	- `/v1/*`
	- `/v1beta/*`
- connector 가 선택한 provider / upstream base URL / protection 상태를 반영
- 실제 proxied request 를 로컬 audit log 로 저장
- internal protection test 요청은 main audit feed 에서 제외

즉, **사용자 UX는 connector 가 담당하고**, 이 폴더는 그 뒤에서 동작하는 runtime/server 역할입니다.

## 현재 제품 흐름에서의 위치

현재 사용자 흐름은 다음과 같습니다.

1. 사용자가 공개 VSIX인 connector 를 설치
2. connector 가 runtime 을 시작하거나 재사용
3. 사용자가 `Protection on` 으로 provider 선택
4. connector 가 base URL 라우팅을 로컬 proxy 로 바꿈
5. 이 runtime 이 실제 `/v1/*`, `/v1beta/*` 요청을 upstream 으로 proxy
6. runtime 이 audit log 를 기록하고 Security Center 가 이를 표시

이 구조에서는 예전 bootstrap login 흐름이 핵심이 아닙니다.

## 주요 파일

- [core-server.js](core-server.js): 현재 connector 가 기대하는 standalone runtime entrypoint
- [main.js](main.js): private extension host entry
- [extension.js](extension.js): 기존 private extension 흐름 코드
- [standalone/](standalone/): standalone UI 자산
- [scripts/generate_manifest.js](scripts/generate_manifest.js): release manifest 생성기

## Commands

이 폴더에는 private/dev 용 명령도 남아 있습니다.

- `Cencurity: Bootstrap Session`
- `Cencurity: Open Security Center`
- `Cencurity: Start Local Stack`
- `Cencurity: Open Browser Dashboard`
- `Cencurity: Copy Proxy Base URL`

다만 현재 public 제품 흐름의 중심은 `vscode-connector/` 쪽입니다.

## Settings

- `cencurity.dashboardBaseUrl` (default: `http://localhost:18080`)
- `cencurity.proxyBaseUrl` (default: `http://localhost:18082`)

이 설정들은 과거 private/dev 흐름 기준이며, 현재 connector 기반 runtime 은 기본적으로 `127.0.0.1:38180` 에서 동작합니다.

## Local development

### Option 1: run as a private extension project

1. Open this folder as a VS Code extension project.
2. Press `F5` to launch an Extension Development Host.
3. Run `Cencurity: Open Security Center`.

### Option 2: run the standalone runtime directly

```bash
npm run serve:core
```

동일한 방식으로도 실행할 수 있습니다.

```bash
cencurity-core serve --host 127.0.0.1 --port 38180
```

## Runtime contract expected by the connector

connector 는 이 runtime 에 대해 다음 계약을 기대합니다.

- `serve --host --port` 로 실행 가능해야 함
- `/healthz` 가 `200 OK` 를 반환해야 함
- protection 설정을 `/api/config` 로 읽고 쓸 수 있어야 함
- provider-compatible proxy route 가 동작해야 함
- audit log 가 `/api/audit-logs` 로 조회 가능해야 함

## Audit and protection behavior

현재 구현 기준:

- protection state 는 runtime config 에 persist 됨
- 선택된 upstream base URL 은 connector 가 sync 함
- proxied request 는 local audit store 에 기록됨
- `Test Protection` probe 는 internal event 로 마킹됨
- internal probe 는 main audit feed 에서 필터링됨
- real traffic 만 user-facing audit table 에 보이게 설계됨

## Release pipeline

이 repo 는 connector 가 읽는 binary release source 역할을 합니다.

기본 artifact 구조:

- `dist/releases/win32-x64/cencurity-core.exe`
- `dist/releases/linux-x64/cencurity-core`
- `dist/releases/darwin-x64/cencurity-core`

기본 스크립트:

- `npm run build:binary:win32-x64`
- `npm run build:binary:linux-x64`
- `npm run build:binary:darwin-x64`
- `npm run generate:manifest`

manifest 생성 예시:

```bash
npm run generate:manifest -- --version 1.0.0 --base-url https://downloads.example.com/cencurity/1.0.0 --artifacts-dir ./dist/releases --output ./dist/releases/manifest.json
```

관련 파일:

- [release-core workflow](.github/workflows/release-core.yml)
- [manifest generator](scripts/generate_manifest.js)

## Packaging notes

- workflow 는 `pkg` 로 [core-server.js](core-server.js)를 native binary 로 패키징합니다.
- 첫 release 전에는 private repo 에서 한 번 `npm install` 을 실행해 `pkg` lockfile 을 확정하는 편이 안전합니다.
- 공개 connector 용 manifest 는 공개 접근 가능한 artifact URL 을 가리켜야 합니다.
- private GitHub Release asset URL 은 인증 없는 공개 connector 에서 직접 fetch 할 수 없습니다.

## 운영 권장사항

- 사용자 배포는 `vscode-connector/` 를 공개 VSIX 로 운영
- 이 폴더는 private repo + binary release source 로 유지
- 사용자 API key 는 connector/IDE 쪽에 남기고, runtime 은 라우팅과 audit 역할에 집중

## Notes

- 현재 runtime 은 로그인 중심 UX 대신 local protection runtime 역할에 맞춰져 있습니다.
- connector 가 없으면 제품형 Protection on/off UX 는 완성되지 않습니다.
- lightweight 배포가 필요하면 이 폴더를 직접 배포하지 말고 connector + released core artifact 구조를 유지하는 편이 좋습니다.
